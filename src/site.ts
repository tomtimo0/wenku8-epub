import type { Block, Book, Chapter, SourceRef } from './types.js';
import type { HttpTransport } from './transports/http.js';
import type { BrowserTransport } from './transports/browser.js';
import type { ContentCache } from './transports/cache.js';

/** 站点抓取执行环境，由核心层提供 */
export interface ScrapeContext {
  http: HttpTransport;
  browser: BrowserTransport;
  cache: ContentCache;
  signal?: AbortSignal;
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

/** 站点合规策略门禁 */
export interface SitePolicy {
  /** 是否要求事先取得站点书面许可 */
  requiresWrittenPermission: boolean;
  /** 当前默认是否启用 */
  enabled: boolean;
  /** 面向用户的说明 */
  notice?: string;
}

/** 一个网站的完整适配器 */
export interface SiteAdapter {
  readonly id: string;
  readonly displayName: string;
  /** 解析器版本；正文解析规则变化时提升以失效缓存 */
  readonly parserVersion: string;
  /** 合规策略（可选） */
  readonly policy?: SitePolicy;

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

/** 缺少授权等合规原因导致的拒绝运行 */
export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}
