/** 抓取错误类别，决定是否重试、是否中止整本 */
export type ScrapeErrorKind =
  | 'transient'
  | 'rate-limited'
  | 'challenge'
  | 'access-wall'
  | 'semantic'
  | 'parse-empty'
  | 'aborted';

/**
 * 带类别的抓取错误
 */
export class ScrapeError extends Error {
  /**
   * @param kind - 错误类别
   * @param message - 可读信息
   * @param retryAfterMs - 服务端建议的等待时间
   */
  constructor(
    readonly kind: ScrapeErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ScrapeError';
  }
}

/**
 * 判断章节失败结果是否可重试
 * @param kind - 错误类别
 */
export function isRetryableKind(kind: ScrapeErrorKind): boolean {
  return kind === 'transient' || kind === 'rate-limited' || kind === 'challenge';
}
