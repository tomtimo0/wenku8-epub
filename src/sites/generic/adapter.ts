import type { Book, Chapter, SourceRef } from '../../types.js';
import type {
  AdapterCapabilities,
  AssetRequest,
  ChapterFetchResult,
  ScrapeContext,
  SiteAdapter,
} from '../../site.js';
import { isSafeHttpUrl } from '../../net/safe-url.js';
import { bookCachePrefix } from '../../transports/cache.js';
import { detectBlockedText } from './inspect.js';
import { parseGenericChapter } from './parse-chapter.js';
import { deriveBookId, probeGeneric, type ProbeTransport } from './probe.js';

/**
 * 通用启发式适配器（实验，最低优先级）。
 *
 * 仅在用户显式启用（`--experimental-auto`）时才会被注册与选用；默认未达置信度门槛
 * 会明确拒绝，不会"猜中一部分后静默生成残缺 EPUB"。参见 docs/ROADMAP.md W5。
 */
export class GenericAdapter implements SiteAdapter {
  readonly id = 'generic';
  readonly displayName = '通用探测（实验）';
  readonly parserVersion = '0.1.0';
  readonly capabilities: AdapterCapabilities = {
    chapterNeedsPage: false,
    needsBrowser: true,
    minIntervalMs: 1500,
    maxConcurrency: 1,
  };

  /**
   * 最低优先级：任何安全的 http(s) URL 记 1 分，永远让位于已注册站点。
   * @param input - 用户输入
   */
  match(input: string): number {
    const trimmed = input.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      return 0;
    }
    return isSafeHttpUrl(trimmed) ? 1 : 0;
  }

  /**
   * @param input - 入口 URL
   */
  async resolve(input: string): Promise<SourceRef> {
    const url = new URL(input.trim()).href;
    if (!isSafeHttpUrl(url)) {
      throw new Error(`拒绝不安全或非 http(s) 的地址: ${url}`);
    }
    return { site: this.id, bookId: deriveBookId(url), canonicalUrl: url };
  }

  /**
   * 探测目录与元数据；未达门槛时抛出可读错误
   * @param ref - 来源引用
   * @param ctx - 抓取环境
   */
  async fetchBook(ref: SourceRef, ctx: ScrapeContext): Promise<Book> {
    const prefix = bookCachePrefix(this.id, ref.bookId);
    const result = await probeGeneric(ref.canonicalUrl, toProbeTransport(ctx), {
      site: this.id,
    });
    await ctx.cache.writeJson(`${prefix}/inspection.json`, result.report);
    if (!result.book) {
      throw new Error(
        `启发式探测未达门槛（${result.report.reason ?? '未知原因'}）。` +
          '请为该站点编写专用适配器；可用 `book2epub inspect <url>` 查看诊断。',
      );
    }
    await ctx.cache.writeJson(`${prefix}/book.json`, result.book);
    return result.book;
  }

  /**
   * 用浏览器打开章节并按探测得到的正文选择器提取
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
    const selector = String(chapter.locator?.contentSelector ?? 'body');
    try {
      const page = ctx.browser.getPage();
      await page.goto(chapter.url, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await page.waitForSelector(selector, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(500);

      const bodyText = await page.evaluate(() =>
        document.body ? document.body.innerText : '',
      );
      const blocked = detectBlockedText(bodyText);
      if (blocked) {
        return { status: 'restricted', reason: `检出访问遮挡：${blocked}` };
      }

      const outer = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        return el ? el.outerHTML : null;
      }, selector);
      if (!outer) {
        return {
          status: 'failed',
          reason: `未找到正文容器 ${selector}`,
          retryable: false,
        };
      }
      const { blocks, warnings } = parseGenericChapter(outer);
      if (blocks.length === 0) {
        return { status: 'failed', reason: '正文为空或结构变化', retryable: false };
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

  /**
   * @param url - 资源 URL
   * @param book - 书籍
   */
  assetRequest(url: string, book: Book): AssetRequest {
    let referer = book.source.canonicalUrl;
    try {
      referer = new URL(book.source.canonicalUrl).origin + '/';
    } catch {
      // 保持原值
    }
    return { url, headers: { Referer: referer } };
  }

  /**
   * @param book - 书籍
   */
  coverCandidates(book: Book): string[] {
    return book.coverUrl ? [book.coverUrl] : [];
  }
}

/**
 * 把抓取环境适配成探测所需的最小传输接口
 * @param ctx - 抓取环境
 */
function toProbeTransport(ctx: ScrapeContext): ProbeTransport {
  return {
    fetchText: async (url: string) => {
      const res = await ctx.http.get(url, { charset: 'utf-8' });
      return { status: res.status, text: res.text };
    },
    render: (url: string) => ctx.browser.renderHtml(url),
  };
}
