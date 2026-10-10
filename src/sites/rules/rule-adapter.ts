import type { Book, Chapter, SourceRef } from '../../types.js';
import type {
  AdapterCapabilities,
  AssetRequest,
  ChapterFetchResult,
  ScrapeContext,
  SiteAdapter,
} from '../../site.js';
import { bookCachePrefix } from '../../transports/cache.js';
import { htmlToBlocks } from '../../extract/dom-text.js';
import { classifyHttpResponse } from '../../transports/classify.js';
import * as cheerio from 'cheerio';
import type { SiteRule } from './schema.js';
import { parseRuleCatalogue } from './parse-catalogue.js';

export type RuleSource = 'builtin' | 'user' | 'learned' | 'cli';

/**
 * 执行声明式 SiteRule 的适配器
 */
export class RuleAdapter implements SiteAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly parserVersion: string;
  readonly capabilities: AdapterCapabilities;

  /**
   * @param rule - 站点规则
   * @param source - 规则来源
   */
  constructor(
    private readonly rule: SiteRule,
    readonly source: RuleSource = 'builtin',
  ) {
    this.id = rule.id;
    this.displayName = rule.name;
    this.parserVersion = rule.version;
    const minMs = rule.fetch?.minIntervalMs ?? 1200;
    const chapterBrowser = rule.fetch?.chapter === 'browser';
    this.capabilities = {
      chapterNeedsPage: chapterBrowser,
      needsBrowser: chapterBrowser || rule.fetch?.catalogue === 'browser',
      minIntervalMs: minMs,
      maxConcurrency: chapterBrowser ? 2 : 1,
    };
  }

  /** @inheritdoc */
  match(input: string): number {
    try {
      const url = new URL(input.trim());
      const hosts = this.rule.match.hosts;
      const hostOk = hosts.some(
        (h) => url.hostname === h || url.hostname.endsWith(`.${h}`),
      );
      if (!hostOk) {
        return 0;
      }
      if (this.rule.match.path && !url.pathname.includes(this.rule.match.path)) {
        return 0;
      }
      return 85;
    } catch {
      return 0;
    }
  }

  /** @inheritdoc */
  async resolve(input: string): Promise<SourceRef> {
    const url = new URL(input.trim());
    let catalogue = url.href;
    if (this.rule.entry?.rewrite) {
      for (const { from, to } of this.rule.entry.rewrite) {
        catalogue = catalogue.replace(from, to);
      }
    }
    const nums = catalogue.match(/\d{2,}/g);
    const bookId = nums?.[nums.length - 1] ?? 'book';
    return {
      site: this.id,
      bookId,
      canonicalUrl: catalogue,
    };
  }

  /** @inheritdoc */
  async fetchBook(ref: SourceRef, ctx: ScrapeContext): Promise<Book> {
    const html = await this.fetchPage(ref.canonicalUrl, 'catalogue', ctx);
    const book = parseRuleCatalogue(this.rule, html, ref.bookId, ref.canonicalUrl);
    const prefix = bookCachePrefix(this.id, ref.bookId);
    await ctx.cache.writeJson(`${prefix}/book.json`, book);
    await ctx.cache.writeText(`${prefix}/catalogue.html`, html);
    return book;
  }

  /** @inheritdoc */
  async fetchChapter(
    book: Book,
    chapter: Chapter,
    ctx: ScrapeContext,
  ): Promise<ChapterFetchResult> {
    if (chapter.access === 'restricted') {
      return { status: 'restricted', reason: '受限章节' };
    }
    try {
      const pages: string[] = [];
      let url = chapter.url;
      const visited = new Set<string>();
      for (let i = 0; i < 50; i++) {
        if (visited.has(url)) {
          break;
        }
        visited.add(url);
        const html = await this.fetchPage(url, 'chapter', ctx);
        if (this.rule.chapter.wall?.some((w) => html.includes(w))) {
          return { status: 'restricted', reason: '访问遮挡' };
        }
        pages.push(html);
        const next = findChapterNextPage(this.rule, html, url, chapter.url);
        if (!next) {
          break;
        }
        url = next;
      }
      const combined = pages.join('\n');
      const { blocks, warnings } = htmlToBlocks(combined, {
        rootSelector: this.rule.chapter.content,
        remove: this.rule.chapter.remove,
        dropLines: this.rule.chapter.dropLines,
        paragraphMode: this.rule.chapter.paragraphMode ?? 'auto',
      });
      if (blocks.length === 0) {
        return { status: 'failed', reason: '正文为空', retryable: false };
      }
      return { status: 'ok', blocks, warnings };
    } catch (e) {
      return {
        status: 'failed',
        reason: e instanceof Error ? e.message : String(e),
        retryable: true,
      };
    }
  }

  /** @inheritdoc */
  assetRequest(url: string, book: Book): AssetRequest {
    const ref =
      this.rule.assets?.referer === 'page'
        ? book.volumes[0]?.chapters[0]?.url ?? book.source.canonicalUrl
        : this.rule.assets?.referer === 'origin'
          ? new URL(book.source.canonicalUrl).origin
          : (this.rule.assets?.referer ?? book.source.canonicalUrl);
    return { url, headers: { Referer: ref } };
  }

  /** @inheritdoc */
  coverCandidates(book: Book): string[] {
    return book.coverUrl ? [book.coverUrl] : [];
  }

  /**
   * 按规则抓取页面 HTML
   */
  private async fetchPage(
    url: string,
    kind: 'catalogue' | 'chapter',
    ctx: ScrapeContext,
  ): Promise<string> {
    const mode =
      kind === 'catalogue'
        ? (this.rule.fetch?.catalogue ?? 'http')
        : (this.rule.fetch?.chapter ?? 'http');
    if (mode === 'browser') {
      await ctx.browser.ensureStarted();
      return ctx.browser.renderHtml(url, this.rule.fetch?.waitFor);
    }
    const res = await ctx.http.get(url, {
      charset: this.rule.charset ?? 'auto',
      signal: ctx.signal,
      headers: this.rule.fetch?.headers,
    });
    const kindErr = classifyHttpResponse({
      status: res.status,
      headers: res.headers,
      text: res.text,
    });
    if (this.rule.errorPage?.title && res.text.includes(this.rule.errorPage.title)) {
      throw new Error(`错误页：${this.rule.errorPage.title}`);
    }
    if (kindErr === 'semantic') {
      throw new Error('语义错误页');
    }
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.text;
  }
}

/**
 * 章内下一页链接
 */
function findChapterNextPage(
  rule: SiteRule,
  html: string,
  currentUrl: string,
  chapterRootUrl: string,
): string | null {
  const np = rule.chapter.nextPage;
  if (!np) {
    return null;
  }
  const $ = cheerio.load(html);
  const href = $(np.selector).first().attr('href');
  if (!href) {
    return null;
  }
  const next = new URL(href, currentUrl).href;
  if (np.samePattern) {
    const re = new RegExp(np.samePattern);
    if (!re.test(next) || !re.test(chapterRootUrl)) {
      return null;
    }
  }
  return next;
}
