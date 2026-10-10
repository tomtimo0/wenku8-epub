import type { Block, Book, Chapter, SourceRef } from './types.js';
import type { HttpTransport } from './transports/http.js';
import type { BrowserTransport } from './transports/browser.js';
import type { ContentCache } from './transports/cache.js';

/** 站点适配器能力声明，供编排层决定并发与传输 */
export interface AdapterCapabilities {
  /** 章节抓取是否需要独占浏览器页面 */
  chapterNeedsPage: boolean;
  /** 是否需要启动浏览器（false 时编排层不启动 Chrome） */
  needsBrowser: boolean;
  /** 建议的每主机最小请求间隔（毫秒） */
  minIntervalMs: number;
  /** 允许的最大章节并发 */
  maxConcurrency: number;
}

/** 站点抓取执行环境，由核心层提供 */
export interface ScrapeContext {
  http: HttpTransport;
  browser: BrowserTransport;
  cache: ContentCache;
  signal?: AbortSignal;
  /** 为 true 时跳过只读兼容缓存（如 wenku8 旧版 HTML） */
  refresh?: boolean;
}

/** 图片请求所需的来源策略 */
export interface AssetRequest {
  url: string;
  headers?: Record<string, string>;
}

/** 单章抓取结果 */
export type ChapterFetchResult =
  | { status: 'ok'; blocks: Block[]; warnings: string[] }
  | { status: 'restricted'; reason: string }
  | { status: 'failed'; reason: string; retryable: boolean };

/** 一个网站的完整适配器 */
export interface SiteAdapter {
  readonly id: string;
  readonly displayName: string;
  /** 解析器版本；正文解析规则变化时提升以失效缓存 */
  readonly parserVersion: string;
  readonly capabilities: AdapterCapabilities;

  /** 返回 0 表示不匹配；数值越高越确定 */
  match(input: string): number;

  /** 把任意受支持输入规范化为来源引用 */
  resolve(input: string): Promise<SourceRef>;

  /** 抓取目录和书籍元数据，不抓正文 */
  fetchBook(ref: SourceRef, ctx: ScrapeContext): Promise<Book>;

  /** 抓取一章公开正文 */
  fetchChapter(
    book: Book,
    chapter: Chapter,
    ctx: ScrapeContext,
  ): Promise<ChapterFetchResult>;

  /** 返回封面或正文图片的请求头等策略 */
  assetRequest(url: string, book: Book): AssetRequest;

  /** 封面候选 URL（按优先级），默认使用 book.coverUrl */
  coverCandidates?(book: Book): string[];

  /** 可选：站点级文本清洗，不污染通用清洗 */
  normalizeBlock?(block: Block): Block | null;
}
