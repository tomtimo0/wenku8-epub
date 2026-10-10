import type { Book, Chapter, SourceRef } from '../../types.js';
import type {
  AssetRequest,
  AdapterCapabilities,
  ChapterFetchResult,
  ScrapeContext,
  SiteAdapter,
} from '../../site.js';
import { bookCachePrefix } from '../../transports/cache.js';
import { parseTaduCatalogue } from './parse-catalogue.js';
import { parseTaduBookPage } from './parse-book.js';
import {
  parseTaduRenderedChapter,
  taduCharacterWarnings,
} from './parse-rendered-chapter.js';
import { bookUrl, catalogueUrl, isTaduHost, parseTaduInput } from './urls.js';

/** 塔读章节页内提取结果 */
interface TaduPageExtract {
  html: string;
  hasShelter: boolean;
  canReadFlag: string;
  needImagePart: boolean;
  chapterId: string;
}

/**
 * 塔读（tadu.com）站点适配器：目录/元数据走 HTTP，正文用浏览器渲染后提取。
 */
export class TaduAdapter implements SiteAdapter {
  readonly id = 'tadu';
  readonly displayName = '塔读文学';
  readonly parserVersion = '0.2.0';
  readonly capabilities: AdapterCapabilities = {
    chapterNeedsPage: true,
    needsBrowser: true,
    minIntervalMs: 1500,
    maxConcurrency: 2,
  };

  /**
   * @param input - 塔读 URL
   */
  match(input: string): number {
    try {
      const url = new URL(input.trim());
      return isTaduHost(url.hostname) ? 100 : 0;
    } catch {
      return 0;
    }
  }

  /**
   * @param input - 塔读 URL
   */
  async resolve(input: string): Promise<SourceRef> {
    const { bookId } = parseTaduInput(input);
    return { site: this.id, bookId, canonicalUrl: catalogueUrl(bookId) };
  }

  /**
   * 抓取目录与元数据（结构性解析，不含正文）
   * @param ref - 来源引用
   * @param ctx - 抓取环境
   */
  async fetchBook(ref: SourceRef, ctx: ScrapeContext): Promise<Book> {
    const prefix = bookCachePrefix(this.id, ref.bookId);
    const catalogueRes = await ctx.http.get(ref.canonicalUrl, {
      charset: 'utf-8',
    });
    if (catalogueRes.status !== 200) {
      throw new Error(`塔读目录页 HTTP ${catalogueRes.status}`);
    }
    await ctx.cache.writeText(`${prefix}/catalogue.html`, catalogueRes.text);
    const { book, warnings } = parseTaduCatalogue(
      catalogueRes.text,
      ref.bookId,
      ref.canonicalUrl,
    );
    for (const w of warnings) {
      ctx.cache.writeText(`${prefix}/catalogue.warnings.txt`, w).catch(() => {});
    }

    const infoRes = await ctx.http.get(bookUrl(ref.bookId), {
      charset: 'utf-8',
    });
    if (infoRes.status === 200) {
      Object.assign(book, parseTaduBookPage(infoRes.text));
    }

    await ctx.cache.writeJson(`${prefix}/book.json`, book);
    return book;
  }

  /**
   * 浏览器打开章节页，等待正文或遮挡层，按视觉顺序提取并解析。
   * @param book - 书籍
   * @param chapter - 章节
   * @param ctx - 抓取环境
   */
  async fetchChapter(
    book: Book,
    chapter: Chapter,
    ctx: ScrapeContext,
  ): Promise<ChapterFetchResult> {
    if (chapter.access === 'restricted') {
      return { status: 'restricted', reason: '站点标记为收费/受限章节' };
    }
    if (ctx.signal?.aborted) {
      return { status: 'failed', reason: '已中断', retryable: false };
    }

    const page = await ctx.browser.acquirePage();
    try {
      const url = chapter.url;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      await page
        .waitForFunction(
          () => {
            const shelter = document.querySelector('.shelter');
            const paras = document.querySelectorAll('#partContent p');
            return !!shelter || paras.length > 0;
          },
          { timeout: 15_000 },
        )
        .catch(() => {});

      const extracted = await page.evaluate((): TaduPageExtract => {
        const content = document.querySelector('#content');
        const needImagePart = content?.getAttribute('data-needimagepart') === '1';
        const canReadFlag =
          document.querySelector<HTMLInputElement>('#canReadFlag')?.value ?? '';
        const hasShelter = !!document.querySelector('.shelter');
        const chapterId = content?.getAttribute('data-chapterid') ?? '';
        const container = document.querySelector('#partContent');
        let html = '';
        if (container) {
          const children = Array.from(container.children);
          children.sort(
            (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
          );
          const wrapper = document.createElement('div');
          wrapper.id = 'partContent';
          for (const el of children) {
            wrapper.appendChild(el.cloneNode(true));
          }
          html = wrapper.outerHTML;
        }
        return {
          html,
          hasShelter,
          canReadFlag,
          needImagePart,
          chapterId,
        };
      });

      if (extracted.needImagePart) {
        return {
          status: 'failed',
          reason: '图片化正文，暂不支持',
          retryable: false,
        };
      }

      if (extracted.hasShelter) {
        return {
          status: 'restricted',
          reason: '章节被登录/扫码遮挡，请运行 book2epub login tadu 后重试',
        };
      }

      const chapterId = extracted.chapterId || chapter.id;
      const { blocks, warnings } = parseTaduRenderedChapter(
        extracted.html,
        chapterId,
      );

      if (blocks.length === 0 && extracted.canReadFlag !== '1') {
        return {
          status: 'restricted',
          reason: '无法读取正文，请运行 book2epub login tadu 后重试',
        };
      }
      if (blocks.length === 0) {
        return {
          status: 'failed',
          reason: '正文为空或页面结构变化',
          retryable: false,
        };
      }

      const allWarnings = [
        ...warnings,
        ...taduCharacterWarnings(blocks, chapter.expectedCharacters),
      ];
      return { status: 'ok', blocks, warnings: allWarnings };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        status: 'failed',
        reason: msg,
        retryable: !msg.includes('已中断'),
      };
    } finally {
      ctx.browser.releasePage(page);
    }
  }

  /**
   * @param url - 资源 URL
   * @param book - 书籍
   */
  assetRequest(url: string, book: Book): AssetRequest {
    return { url, headers: { Referer: book.source.canonicalUrl } };
  }

  /**
   * @param book - 书籍
   */
  coverCandidates(book: Book): string[] {
    return book.coverUrl ? [book.coverUrl] : [];
  }
}
