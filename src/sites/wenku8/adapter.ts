import type { Book, Chapter, SourceRef } from '../../types.js';
import type {
  AssetRequest,
  ChapterFetchResult,
  ScrapeContext,
  SiteAdapter,
} from '../../site.js';
import { bookCachePrefix } from '../../transports/cache.js';
import { parseIndexPage } from './parse-index.js';
import { parseBookPage } from './parse-book.js';
import { parseChapterPage, isIllustrationChapter } from './parse-chapter.js';
import {
  bookInfoPageUrl,
  chapterPageUrl,
  coverImageUrl,
  indexPageUrl,
  isWenku8Host,
  parseBookId,
} from './urls.js';

const REFERER = 'https://www.wenku8.net/';

/**
 * 轻小说文库（wenku8）站点适配器。
 * 通过浏览器会话绕过 Cloudflare 并就绪后，用页内 fetch + GBK 解码取 HTML。
 */
export class Wenku8Adapter implements SiteAdapter {
  readonly id = 'wenku8';
  readonly displayName = '轻小说文库';
  readonly parserVersion = '1.0.0';

  private readyUrl: string | null = null;

  /**
   * @param input - URL 或书号
   */
  match(input: string): number {
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) {
      return 0;
    }
    try {
      const url = new URL(trimmed);
      return isWenku8Host(url.hostname) ? 100 : 0;
    } catch {
      return 0;
    }
  }

  /**
   * @param input - URL 或书号
   */
  async resolve(input: string): Promise<SourceRef> {
    const bookId = parseBookId(input);
    return { site: this.id, bookId, canonicalUrl: indexPageUrl(bookId) };
  }

  /**
   * @param ref - 来源引用
   * @param ctx - 抓取环境
   */
  async fetchBook(ref: SourceRef, ctx: ScrapeContext): Promise<Book> {
    await this.ensureReady(ref.canonicalUrl, ctx);

    const prefix = bookCachePrefix(this.id, ref.bookId);
    const indexRes = await ctx.browser.fetchHtml(ref.canonicalUrl, 'gbk');
    if (indexRes.status !== 200) {
      throw new Error(`目录页 HTTP ${indexRes.status}`);
    }
    await ctx.cache.writeText(`${prefix}/catalogue.html`, indexRes.text);
    const book = parseIndexPage(indexRes.text, ref.bookId, ref.canonicalUrl);

    const infoRes = await ctx.browser.fetchHtml(
      bookInfoPageUrl(ref.bookId),
      'gbk',
    );
    if (infoRes.status === 200) {
      const meta = parseBookPage(infoRes.text);
      Object.assign(book, meta);
    }
    book.coverUrl = coverImageUrl(ref.bookId, true);

    for (const vol of book.volumes) {
      for (const ch of vol.chapters) {
        ch.url = chapterPageUrl(ref.bookId, ch.id);
        ch.access = 'public';
      }
    }

    await ctx.cache.writeJson(`${prefix}/book.json`, book);
    return book;
  }

  /**
   * @param book - 书籍
   * @param chapter - 章节
   * @param ctx - 抓取环境
   */
  async fetchChapter(
    book: Book,
    chapter: Chapter,
    ctx: ScrapeContext,
  ): Promise<ChapterFetchResult> {
    // 兼容旧版缓存布局 .cache/html/{bookId}/{chapterId}.html（迁移期只读）
    const legacyHtml = await ctx.cache.readText(
      `html/${book.source.bookId}/${chapter.id}.html`,
    );
    if (legacyHtml) {
      const legacyBlocks = parseChapterPage(legacyHtml);
      if (legacyBlocks.length > 0) {
        return { status: 'ok', blocks: legacyBlocks, warnings: [] };
      }
    }

    const url = chapter.url || chapterPageUrl(book.source.bookId, chapter.id);
    const res = await ctx.browser.fetchHtml(url, 'gbk');
    if (res.status === 403 || res.status === 503) {
      return {
        status: 'failed',
        reason: `HTTP ${res.status}（可能需重新通过 Cloudflare）`,
        retryable: true,
      };
    }
    if (res.status === 429) {
      return { status: 'failed', reason: 'HTTP 429（触发限流）', retryable: true };
    }
    if (res.status !== 200) {
      return {
        status: 'failed',
        reason: `HTTP ${res.status}`,
        retryable: res.status >= 500,
      };
    }
    const blocks = parseChapterPage(res.text);
    if (blocks.length === 0) {
      return { status: 'failed', reason: '正文为空或结构变化', retryable: false };
    }
    return { status: 'ok', blocks, warnings: [] };
  }

  /**
   * @param url - 资源 URL
   * @param book - 书籍
   */
  assetRequest(url: string, book: Book): AssetRequest {
    return { url, headers: { Referer: REFERER } };
  }

  /**
   * @param book - 书籍
   */
  coverCandidates(book: Book): string[] {
    return [coverImageUrl(book.id, true), coverImageUrl(book.id, false)];
  }

  /**
   * 确保浏览器会话已过 Cloudflare 质询
   * @param indexUrl - 目录页 URL
   * @param ctx - 抓取环境
   */
  private async ensureReady(indexUrl: string, ctx: ScrapeContext): Promise<void> {
    if (this.readyUrl === indexUrl) {
      return;
    }
    await ctx.browser.ensureReady(indexUrl, () => {
      const title = document.title;
      const badTitle = title.includes('请稍候') || /Just a moment/i.test(title);
      return !badTitle && !!document.querySelector('table.css');
    });
    this.readyUrl = indexUrl;
  }
}

/**
 * 依据块列表判断是否为纯插图章（供编排层复用）
 * @param blocks - 章节块
 */
export function isWenku8Illustration(blocks: Chapter['blocks']): boolean {
  return isIllustrationChapter(blocks);
}
