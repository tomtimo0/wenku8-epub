import fs from 'node:fs/promises';
import path from 'node:path';
import type { Book, Chapter, Volume } from './types.js';
import { parseChapterPage, isIllustrationChapter } from './parse/chapter-page.js';
import type { Wenku8Session } from './session.js';
import {
  bookInfoPageUrl,
  chapterPageUrl,
  indexPageUrl,
} from './urls.js';
import { parseIndexPage } from './parse/index-page.js';
import { parseBookPage } from './parse/book-page.js';

export interface FetcherOptions {
  cacheDir: string;
  session: Wenku8Session;
  delayMs: number;
  concurrency: number;
  refresh: boolean;
  onProgress?: (msg: string) => void;
}

/**
 * 随机延迟（delayMs ± 500ms）
 * @param baseMs - 基础间隔
 */
function jitterDelay(baseMs: number): Promise<void> {
  const extra = Math.floor(Math.random() * 1000) - 500;
  const ms = Math.max(500, baseMs + extra);
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 指数退避重试
 * @param fn - 异步操作
 * @param retries - 重试次数
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        const wait = 2000 * 2 ** i;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

/**
 * 抓取并填充 Book 的章节正文
 */
export class BookFetcher {
  private readonly htmlCacheRoot: string;
  private currentDelayMs: number;

  /**
   * @param options - 抓取配置
   */
  constructor(private readonly options: FetcherOptions) {
    this.htmlCacheRoot = path.join(options.cacheDir, 'html');
    this.currentDelayMs = options.delayMs;
  }

  /**
   * 抓取目录与信息页，合并为完整 Book 骨架
   * @param bookId - 书号
   */
  async fetchBookSkeleton(bookId: string): Promise<Book> {
    const indexUrl = indexPageUrl(bookId);
    await this.options.session.ensureReady(indexUrl);

    const indexRes = await withRetry(() =>
      this.options.session.fetchHtml(indexUrl),
    );
    if (indexRes.status !== 200) {
      throw new Error(`目录页 HTTP ${indexRes.status}`);
    }
    const book = parseIndexPage(indexRes.html, bookId);

    await jitterDelay(this.currentDelayMs);
    const infoRes = await withRetry(() =>
      this.options.session.fetchHtml(bookInfoPageUrl(bookId)),
    );
    if (infoRes.status === 200) {
      Object.assign(book, parseBookPage(infoRes.html));
    }

    return book;
  }

  /**
   * 抓取所有章节 HTML 并解析 blocks
   * @param book - 书籍（含卷章结构）
   */
  async fetchChapters(book: Book): Promise<void> {
    const tasks: Array<{
      volume: Volume;
      volumeIndex: number;
      chapter: Chapter;
      chapterIndex: number;
    }> = [];

    book.volumes.forEach((volume, vi) => {
      volume.chapters.forEach((chapter, ci) => {
        tasks.push({
          volume,
          volumeIndex: vi,
          chapter,
          chapterIndex: ci,
        });
      });
    });

    const concurrency = Math.min(2, Math.max(1, this.options.concurrency));
    let next = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const i = next++;
        if (i >= tasks.length) {
          return;
        }
        const t = tasks[i];
        await this.fetchOneChapter(
          book.id,
          t.volume,
          t.volumeIndex,
          t.chapter,
          t.chapterIndex,
          book.volumes.length,
        );
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  private async fetchOneChapter(
    bookId: string,
    volume: Volume,
    volumeIndex: number,
    chapter: Chapter,
    chapterIndex: number,
    volumeCount: number,
  ): Promise<void> {
    const cachePath = path.join(
      this.htmlCacheRoot,
      bookId,
      `${chapter.id}.html`,
    );
    let html: string | null = null;

    if (!this.options.refresh) {
      try {
        html = await fs.readFile(cachePath, 'utf8');
      } catch {
        html = null;
      }
    }

    if (!html) {
      await jitterDelay(this.currentDelayMs);
      const url = chapterPageUrl(bookId, chapter.id);
      const res = await withRetry(async () => {
        const r = await this.options.session.fetchHtml(url);
        if (r.status === 429 || r.status === 503) {
          this.currentDelayMs *= 2;
          throw new Error(`HTTP ${r.status}`);
        }
        if (r.status !== 200) {
          throw new Error(`章节 ${chapter.id} HTTP ${r.status}`);
        }
        return r;
      });
      html = res.html;
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, html, 'utf8');
    }

    chapter.blocks = parseChapterPage(html);
    chapter.isIllustration = isIllustrationChapter(chapter.blocks);

    this.options.onProgress?.(
      `[卷 ${volumeIndex + 1}/${volumeCount}] [章 ${chapterIndex + 1}/${volume.chapters.length}] ${chapter.title} ✓`,
    );
  }
}
