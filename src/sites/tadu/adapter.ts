import type { Book, Chapter, SourceRef } from '../../types.js';
import type {
  AssetRequest,
  ChapterFetchResult,
  ScrapeContext,
  SiteAdapter,
} from '../../site.js';
import { bookCachePrefix } from '../../transports/cache.js';
import { parseTaduCatalogue } from './parse-catalogue.js';
import { parseTaduBookPage } from './parse-book.js';
import {
  TADU_PERMISSION_REASON,
  TADU_POLICY,
} from './policy.js';
import { bookUrl, catalogueUrl, isTaduHost, parseTaduInput } from './urls.js';

/**
 * 塔读（tadu.com）站点适配器骨架。
 *
 * 合规说明：依据 TADU_RESEARCH.md，官方用户协议禁止未经书面许可自动读取/复制/存储，
 * 因此本适配器默认禁用（见 TADU_POLICY），且不实现真实正文下载——`fetchChapter`
 * 始终返回受限结果。目录与元数据解析为纯结构性能力，仅在显式确认许可后由 CLI 运行。
 */
export class TaduAdapter implements SiteAdapter {
  readonly id = 'tadu';
  readonly displayName = '塔读文学';
  readonly parserVersion = '0.1.0';
  readonly policy = TADU_POLICY;

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
   * 塔读正文不予下载：始终返回受限结果（合规门禁）。
   * @param book - 书籍
   * @param chapter - 章节
   */
  async fetchChapter(
    book: Book,
    chapter: Chapter,
  ): Promise<ChapterFetchResult> {
    if (chapter.access === 'restricted') {
      return { status: 'restricted', reason: '站点标记为收费/受限章节' };
    }
    return { status: 'restricted', reason: TADU_PERMISSION_REASON };
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
