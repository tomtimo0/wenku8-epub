import path from 'node:path';
import fs from 'node:fs/promises';
import type { Book, Chapter, IllusPosition, ResolvedImage, Volume } from './types.js';
import type { ChapterFetchResult, ScrapeContext, SiteAdapter } from './site.js';
import { HttpTransport } from './transports/http.js';
import { BrowserTransport } from './transports/browser.js';
import { ContentCache, bookCachePrefix, browserProfileDir } from './transports/cache.js';
import { resolveBookImages, failedImageUrls, fetchCover } from './images.js';
import {
  buildEpub,
  buildChapterImagePathMap,
  sanitizeFileName,
} from './epub/builder.js';
import {
  countCharacters,
  countImages,
  firstIllusImageInVolume,
  parseVolumeRange,
} from './illus.js';
import { RunController } from './core/run.js';
import { CookieJar, siteCookiesPath } from './transports/cookies.js';
import { buildTxt } from './output/txt.js';
import { verifyEpubBuffer } from './output/verify.js';
import {
  emptyRunState,
  patchChapterRun,
  type BookRunState,
} from './core/run-state.js';

export interface RunOptions {
  out: string;
  split: 'full' | 'volume';
  volumes?: string;
  illusPosition: IllusPosition;
  noImages: boolean;
  imageQuality?: number;
  maxImageWidth?: number;
  delay: number;
  concurrency: number;
  refresh: boolean;
  headless: boolean;
  includePlaceholders: boolean;
  strict: boolean;
  limitChapters?: number;
  format?: 'epub' | 'txt' | 'both';
  txtCrlf?: boolean;
  verifyEpub?: boolean;
  onlyMissing?: boolean;
}

interface CachedChapter {
  parserVersion: string;
  status: ChapterFetchResult['status'];
  blocks?: Chapter['blocks'];
  reason?: string;
  warnings?: string[];
  fetchedAt: string;
  sourceUrl: string;
}

interface ChapterStats {
  ok: number;
  restricted: number;
  failed: number;
  suspect: number;
}

type ProgressStatus = 'ok' | 'restricted' | 'failed' | 'suspect' | 'cached-ok';

/**
 * 应用抓取结果到章节
 * @param chapter - 章节
 * @param result - 抓取结果
 */
function applyResult(chapter: Chapter, result: ChapterFetchResult): void {
  if (result.status === 'ok') {
    chapter.blocks = result.blocks;
    chapter.isIllustration =
      result.blocks.length > 0 && result.blocks.every((b) => b.kind === 'image');
  }
}

/**
 * 运行一次完整转换流程
 * @param input - 用户输入
 * @param adapter - 已选站点适配器
 * @param options - 运行选项
 * @param cacheRoot - 缓存根目录
 * @returns 进程退出码
 */
export async function runConvert(
  input: string,
  adapter: SiteAdapter,
  options: RunOptions,
  cacheRoot: string,
): Promise<number> {
  const run = new RunController();
  const cache = new ContentCache(cacheRoot);
  const minInterval = adapter.capabilities.minIntervalMs ?? options.delay;
  const cookieJar = new CookieJar();
  await cookieJar.load(siteCookiesPath(cacheRoot, adapter.id));
  const http = new HttpTransport({ minIntervalMs: minInterval, cookieJar });
  const maxConcurrency = Math.min(
    adapter.capabilities.maxConcurrency,
    Math.max(1, options.concurrency),
  );
  const browser = new BrowserTransport({
    profileDir: cache.pathFor(browserProfileDir(adapter.id)),
    headless: options.headless,
    poolSize: adapter.capabilities.chapterNeedsPage ? maxConcurrency : 1,
    signal: run.signal,
  });

  const ctx: ScrapeContext = {
    http,
    browser,
    cache,
    signal: run.signal,
    refresh: options.refresh,
  };
  const stats: ChapterStats = { ok: 0, restricted: 0, failed: 0, suspect: 0 };
  const notes: string[] = [];
  let runState: BookRunState | null = null;

  try {
    const ref = await adapter.resolve(input);
    console.log(`站点 ${adapter.id}（${adapter.displayName}）书号 ${ref.bookId}`);
    const book = await fetchBookWithFallback(adapter, ref, ctx, cache);
    runState = await loadRunState(cache, adapter.id, ref.bookId);

    let volumeIndices: number[] | null = null;
    if (options.volumes) {
      volumeIndices = parseVolumeRange(options.volumes, book.volumes.length);
      book.volumes = volumeIndices.map((i) => book.volumes[i - 1]);
    }

    const totalChapters = book.volumes.reduce((n, v) => n + v.chapters.length, 0);
    console.log(
      `《${book.title}》${book.author} — ${book.volumes.length} 卷 ${totalChapters} 章`,
    );

    const startedAt = Date.now();
    await fetchAllChapters(
      adapter,
      book,
      ctx,
      options,
      stats,
      notes,
      runState,
      maxConcurrency,
      startedAt,
    );

    if (run.aborted) {
      await persistRunState(cache, adapter.id, ref.bookId, runState);
      return 130;
    }

    if (stats.ok === 0) {
      report(adapter, book, new Map(), stats, notes, options);
      await persistRunState(cache, adapter.id, ref.bookId, runState);
      await cookieJar.save(siteCookiesPath(cacheRoot, adapter.id));
      return 3;
    }

    const imageMap = await collectImages(adapter, book, options, cache);
    const chapterImagePaths = buildChapterImagePathMap(book, imageMap);
    await fs.mkdir(options.out, { recursive: true });

    const cover = await resolveCover(adapter, book);

    const format = options.format ?? 'epub';
    const writeEpub = format === 'epub' || format === 'both';
    const writeTxt = format === 'txt' || format === 'both';

    if (options.split === 'full') {
      const baseName = sanitizeFileName(book.title);
      if (writeEpub) {
        const buf = await buildEpub({
          book,
          cover,
          imageMap,
          chapterImagePaths,
          illusPosition: options.illusPosition,
          includePlaceholders: options.includePlaceholders,
        });
        const outPath = path.join(options.out, `${baseName}.epub`);
        await fs.writeFile(outPath, buf);
        if (options.verifyEpub) {
          const v = await verifyEpubBuffer(buf);
          if (!v.ok) {
            throw new Error(`EPUB 自检失败：${v.errors.join('; ')}`);
          }
        }
        console.log(`已写入 ${outPath}`);
      }
      if (writeTxt) {
        const txtPath = path.join(options.out, `${baseName}.txt`);
        const txtBuf = buildTxt({ book, crlf: options.txtCrlf });
        await fs.writeFile(txtPath, txtBuf);
        console.log(`已写入 ${txtPath}`);
      }
    } else {
      const originalVolumes = book.volumes;
      for (let i = 0; i < originalVolumes.length; i++) {
        const vol = originalVolumes[i];
        const groupPosition = volumeIndices ? volumeIndices[i] : i + 1;
        const volCover = volumeCover(vol, imageMap) ?? cover;
        const buf = await buildEpub({
          book,
          cover: volCover,
          imageMap,
          chapterImagePaths,
          illusPosition: options.illusPosition,
          seriesTitle: book.title,
          groupPosition,
          volumeFilter: [vol],
          includePlaceholders: options.includePlaceholders,
        });
        const fileName = `${sanitizeFileName(book.title)} 第${groupPosition}卷 ${sanitizeFileName(vol.title)}.epub`;
        const outPath = path.join(options.out, fileName);
        await fs.writeFile(outPath, buf);
        console.log(`已写入 ${outPath}`);
      }
    }

    report(adapter, book, imageMap, stats, notes, options);
    await persistRunState(cache, adapter.id, ref.bookId, runState);
    await browser.syncCookiesTo(cookieJar);
    await cookieJar.save(siteCookiesPath(cacheRoot, adapter.id));
    return RunController.exitCode(stats, options.strict);
  } finally {
    await browser.close();
  }
}

/**
 * 读取或初始化 run.json
 */
async function loadRunState(
  cache: ContentCache,
  site: string,
  bookId: string,
): Promise<BookRunState> {
  const key = `${bookCachePrefix(site, bookId)}/run.json`;
  const existing = await cache.readJson<BookRunState>(key);
  return existing ?? emptyRunState(site, bookId);
}

/**
 * 持久化 run.json
 */
async function persistRunState(
  cache: ContentCache,
  site: string,
  bookId: string,
  state: BookRunState | null,
): Promise<void> {
  if (!state) {
    return;
  }
  const key = `${bookCachePrefix(site, bookId)}/run.json`;
  await cache.writeJson(key, state);
}

/**
 * 抓取目录与元数据；网络失败时回退到缓存 book.json（断网仍可重新生成 EPUB）
 * @param adapter - 站点适配器
 * @param ref - 来源引用
 * @param ctx - 抓取环境
 * @param cache - 内容缓存
 */
async function fetchBookWithFallback(
  adapter: SiteAdapter,
  ref: { site: string; bookId: string; canonicalUrl: string },
  ctx: ScrapeContext,
  cache: ContentCache,
): Promise<Book> {
  try {
    return await adapter.fetchBook(ref, ctx);
  } catch (e) {
    const cached = await cache.readJson<Book>(
      `${bookCachePrefix(adapter.id, ref.bookId)}/book.json`,
    );
    if (cached) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`抓取目录失败（${msg}），改用缓存元数据离线生成。`);
      return cached;
    }
    throw e;
  }
}

/**
 * 抓取全部章节（含缓存与断点续抓）
 */
async function fetchAllChapters(
  adapter: SiteAdapter,
  book: Book,
  ctx: ScrapeContext,
  options: RunOptions,
  stats: ChapterStats,
  notes: string[],
  runState: BookRunState,
  concurrency: number,
  startedAt: number,
): Promise<void> {
  const tasks: Array<{ volume: Volume; vi: number; chapter: Chapter; ci: number }> = [];
  book.volumes.forEach((volume, vi) => {
    volume.chapters.forEach((chapter, ci) => {
      tasks.push({ volume, vi, chapter, ci });
    });
  });

  const targets =
    options.limitChapters !== undefined
      ? tasks.slice(0, options.limitChapters)
      : tasks;

  let next = 0;
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      if (ctx.signal?.aborted) {
        return;
      }
      const i = next++;
      if (i >= targets.length) {
        return;
      }
      const t = targets[i];
      const prefix = bookCachePrefix(adapter.id, book.source.bookId);
      const cacheKey = `${prefix}/chapters/${t.chapter.id}.json`;

      if (t.chapter.access === 'restricted') {
        stats.restricted++;
        notes.push(`受限：${t.chapter.title}`);
        patchChapterRun(runState, t.chapter.id, {
          status: 'restricted',
          lastError: '站点标记为受限',
        });
        completed++;
        logProgress(t, targets.length, completed, startedAt, 'restricted');
        continue;
      }

      let cached: CachedChapter | null = null;
      if (!options.refresh) {
        cached = await ctx.cache.readJson<CachedChapter>(cacheKey);
      }
      if (cached && cached.status === 'failed') {
        cached = null;
      }
      if (cached && cached.parserVersion === adapter.parserVersion) {
        const status = applyCached(t.chapter, cached, stats, notes);
        patchChapterRun(runState, t.chapter.id, {
          status: status === 'suspect' ? 'suspect' : cached.status === 'ok' ? 'ok' : 'failed',
          fetchedAt: cached.fetchedAt,
        });
        completed++;
        logProgress(t, targets.length, completed, startedAt, status);
        continue;
      }

      if (adapter.capabilities.needsBrowser) {
        await ctx.browser.ensureStarted();
      }

      const result = await fetchWithRetry(adapter, book, t.chapter, ctx, options);

      if (result.status !== 'failed') {
        await ctx.cache.writeJson(cacheKey, {
          parserVersion: adapter.parserVersion,
          status: result.status,
          blocks: result.status === 'ok' ? result.blocks : undefined,
          reason: result.status === 'restricted' ? result.reason : undefined,
          warnings: result.status === 'ok' ? result.warnings : undefined,
          fetchedAt: new Date().toISOString(),
          sourceUrl: t.chapter.url,
        } satisfies CachedChapter);
      }

      const progressStatus = handleResult(result, t.chapter, stats, notes, options);
      const runStatus =
        progressStatus === 'cached-ok'
          ? 'ok'
          : progressStatus === 'ok' && result.status === 'ok' && result.warnings.length
            ? 'suspect'
            : progressStatus;
      patchChapterRun(runState, t.chapter.id, {
        status: runStatus,
        attempts: (runState.chapters[t.chapter.id]?.attempts ?? 0) + 1,
        lastError:
          result.status !== 'ok' && result.status !== 'restricted'
            ? result.reason
            : result.status === 'restricted'
              ? result.reason
              : undefined,
        fetchedAt: new Date().toISOString(),
      });
      completed++;
      logProgress(t, targets.length, completed, startedAt, progressStatus);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

/**
 * 带重试的章节抓取（仅对可重试失败重试）
 */
async function fetchWithRetry(
  adapter: SiteAdapter,
  book: Book,
  chapter: Chapter,
  ctx: ScrapeContext,
  options: RunOptions,
): Promise<ChapterFetchResult> {
  let last: ChapterFetchResult = { status: 'failed', reason: 'unknown', retryable: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (ctx.signal?.aborted) {
      return { status: 'failed', reason: '已中断', retryable: false };
    }
    try {
      last = await adapter.fetchChapter(book, chapter, ctx);
    } catch (e) {
      last = {
        status: 'failed',
        reason: e instanceof Error ? e.message : String(e),
        retryable: true,
      };
    }
    if (last.status !== 'failed' || !last.retryable) {
      return last;
    }
    if (options.strict) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  return last;
}

/**
 * 应用缓存结果
 * @returns 用于进度行的状态
 */
function applyCached(
  chapter: Chapter,
  cached: CachedChapter,
  stats: ChapterStats,
  notes: string[],
): ProgressStatus {
  if (cached.status === 'ok' && cached.blocks) {
    chapter.blocks = cached.blocks;
    chapter.isIllustration =
      cached.blocks.length > 0 && cached.blocks.every((b) => b.kind === 'image');
    stats.ok++;
    if (cached.warnings?.length) {
      stats.suspect++;
      for (const w of cached.warnings) {
        notes.push(`可疑：${chapter.title} — ${w}`);
      }
      return 'suspect';
    }
    return 'cached-ok';
  }
  if (cached.status === 'restricted') {
    stats.restricted++;
    notes.push(`受限：${chapter.title} — ${cached.reason ?? ''}`);
    return 'restricted';
  }
  stats.failed++;
  notes.push(`失败：${chapter.title} — ${cached.reason ?? ''}`);
  return 'failed';
}

/**
 * 处理抓取结果
 * @returns 用于进度行的状态
 */
function handleResult(
  result: ChapterFetchResult,
  chapter: Chapter,
  stats: ChapterStats,
  notes: string[],
  options: RunOptions,
): ProgressStatus {
  if (result.status === 'ok') {
    applyResult(chapter, result);
    stats.ok++;
    if (result.warnings.length) {
      stats.suspect++;
      for (const w of result.warnings) {
        notes.push(`可疑：${chapter.title} — ${w}`);
      }
      if (options.strict) {
        throw new Error(`严格模式：章节内容可疑 ${chapter.title}`);
      }
      return 'suspect';
    }
    return 'ok';
  }
  if (result.status === 'restricted') {
    stats.restricted++;
    notes.push(`受限：${chapter.title} — ${result.reason}`);
    if (options.strict) {
      throw new Error(`严格模式：章节受限 ${chapter.title}`);
    }
    return 'restricted';
  }
  stats.failed++;
  notes.push(`失败：${chapter.title} — ${result.reason}`);
  if (options.strict) {
    throw new Error(`严格模式：章节抓取失败 ${chapter.title}`);
  }
  return 'failed';
}

/**
 * 下载图片（可禁用）
 */
async function collectImages(
  adapter: SiteAdapter,
  book: Book,
  options: RunOptions,
  cache: ContentCache,
): Promise<Map<string, ResolvedImage>> {
  if (options.noImages) {
    return new Map();
  }
  console.log('下载插图…');
  return resolveBookImages(book, {
    cache,
    site: adapter.id,
    bookId: book.source.bookId,
    resolveRequest: (url) => adapter.assetRequest(url, book),
    imageQuality: options.imageQuality,
    maxImageWidth: options.maxImageWidth,
    concurrency: 4,
  });
}

/**
 * 解析封面
 */
async function resolveCover(
  adapter: SiteAdapter,
  book: Book,
): Promise<{ buffer: Buffer; mediaType: string } | null> {
  const candidates =
    adapter.coverCandidates?.(book) ?? (book.coverUrl ? [book.coverUrl] : []);
  if (candidates.length === 0) {
    return null;
  }
  return fetchCover(candidates, (url) => adapter.assetRequest(url, book));
}

/**
 * 分卷模式下的卷封面
 */
function volumeCover(
  volume: Volume,
  imageMap: Map<string, ResolvedImage>,
): { buffer: Buffer; mediaType: string } | null {
  const illus = firstIllusImageInVolume(volume, imageMap);
  return illus ? { buffer: illus.buffer, mediaType: illus.mediaType } : null;
}

/**
 * 输出进度
 */
function logProgress(
  t: { volume: Volume; vi: number; chapter: Chapter; ci: number },
  total: number,
  completed: number,
  startedAt: number,
  status: ProgressStatus,
): void {
  const symbol =
    status === 'ok' || status === 'cached-ok'
      ? '✓'
      : status === 'restricted'
        ? '⊘'
        : status === 'suspect'
          ? '⚠'
          : '✗';
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const eta =
    completed > 0
      ? Math.round((elapsed / completed) * (total - completed))
      : 0;
  console.log(
    `[${completed}/${total}] [卷 ${t.vi + 1}] ${t.chapter.title} ${symbol} （已用 ${elapsed}s，约剩 ${eta}s）`,
  );
}

/**
 * 结束统计报告
 */
function report(
  adapter: SiteAdapter,
  book: Book,
  imageMap: Map<string, ResolvedImage>,
  stats: ChapterStats,
  notes: string[],
  options: RunOptions,
): void {
  const failed = failedImageUrls(imageMap);
  console.log('—— 统计 ——');
  console.log(
    `章节：成功 ${stats.ok} / 受限跳过 ${stats.restricted} / 失败 ${stats.failed} / 内容可疑 ${stats.suspect}`,
  );
  console.log(`字数约：${countCharacters(book)}`);
  console.log(`图片块：${countImages(book)}`);
  if (failed.length) {
    console.log(`插图下载失败 ${failed.length} 张：`);
    for (const u of failed) {
      console.log(`  - ${u}`);
    }
  }
  if (notes.length) {
    console.log('明细：');
    for (const n of notes) {
      console.log(`  - ${n}`);
    }
  }
  if (stats.suspect > 0 && !options.strict) {
    console.log('提示：存在内容可疑章节，可用 --strict 让其失败。');
  }
  if (stats.ok === 0) {
    console.log('未生成 EPUB：没有成功抓取的章节。');
  }
}
