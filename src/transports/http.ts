import { fetchWithSafeRedirects } from '../net/safe-url.js';
import { ScrapeError } from '../core/errors.js';
import { classifyHttpResponse } from './classify.js';
import { type Charset, decodeBuffer } from './charset.js';
import type { CookieJar } from './cookies.js';

export type { Charset };

export interface HttpRequestOptions {
  charset?: Charset;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface HttpResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  buffer: Buffer;
  text: string;
}

export interface HttpTransportOptions {
  userAgent?: string;
  /** 每个 host 的最小请求间隔（毫秒） */
  minIntervalMs?: number;
  /** 单次请求超时（毫秒） */
  timeoutMs?: number;
  /** 可选 Cookie 容器 */
  cookieJar?: CookieJar;
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 轻量 HTTP 传输层：编码嗅探、按主机限速与抖动、超时与响应分类。
 */
export class HttpTransport {
  private readonly lastRequestAt = new Map<string, number>();
  private userAgent: string;
  private minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly cookieJar?: CookieJar;

  /**
   * @param options - 传输配置
   */
  constructor(private readonly options: HttpTransportOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_UA;
    this.minIntervalMs = options.minIntervalMs ?? 1200;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.cookieJar = options.cookieJar;
  }

  /**
   * 与浏览器 UA 同步（导入 Cookie 时应同时调用）
   * @param ua - User-Agent
   */
  setUserAgent(ua: string): void {
    this.userAgent = ua;
  }

  /**
   * 调整全局请求间隔（用于遇到频控后退避）
   * @param ms - 新的基础间隔
   */
  setMinInterval(ms: number): void {
    this.minIntervalMs = ms;
  }

  /**
   * GET 请求并按 charset 解码（含 transient / rate-limited 退避重试）
   * @param url - 目标 URL
   * @param options - 请求选项
   */
  async get(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (options.signal?.aborted) {
        throw new ScrapeError('aborted', '已中断');
      }
      try {
        const res = await this.getOnce(url, options);
        const kind = classifyHttpResponse({
          status: res.status,
          headers: res.headers,
          text: res.text,
        });
        if (kind === 'rate-limited') {
          this.setMinInterval(Math.min(30_000, this.minIntervalMs * 2));
          const retryAfter = Number.parseInt(res.headers['retry-after'] ?? '', 10);
          await this.sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
          continue;
        }
        if (kind === 'transient' || kind === 'challenge') {
          await this.sleep(2000 * 2 ** attempt);
          continue;
        }
        if (kind === 'semantic') {
          throw new ScrapeError('semantic', `语义错误页：${res.url}`);
        }
        return res;
      } catch (e) {
        lastError = e;
        if (e instanceof ScrapeError && e.kind === 'aborted') {
          throw e;
        }
        if (attempt < 2) {
          await this.sleep(2000 * 2 ** attempt);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async getOnce(
    url: string,
    options: HttpRequestOptions,
  ): Promise<HttpResponse> {
    await this.throttle(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const cookie = this.cookieJar?.cookieHeader(url);
      const res = await fetchWithSafeRedirects(
        url,
        {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            ...(cookie ? { Cookie: cookie } : {}),
            ...options.headers,
          },
          signal: options.signal ?? controller.signal,
        },
        { signal: options.signal ?? controller.signal },
      );
      const buffer = Buffer.from(await res.arrayBuffer());
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      if (setCookie.length > 0) {
        this.cookieJar?.absorbSetCookie(res.url || url, setCookie);
      } else {
        const single = res.headers.get('set-cookie');
        if (single) {
          this.cookieJar?.absorbSetCookie(res.url || url, single);
        }
      }
      const charset = options.charset ?? 'auto';
      return {
        url: res.url || url,
        status: res.status,
        headers,
        buffer,
        text: decodeBuffer(buffer, charset),
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async throttle(url: string): Promise<void> {
    let host = 'unknown';
    try {
      host = new URL(url).hostname;
    } catch {
      // 保持默认 host
    }
    const now = Date.now();
    const last = this.lastRequestAt.get(host) ?? 0;
    const jitter = 0.7 + Math.random() * 0.6;
    const wait = last + this.minIntervalMs * jitter - now;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequestAt.set(host, Date.now());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

/** @deprecated 请使用 charset.ts 中的 decodeBuffer */
export { decodeBuffer } from './charset.js';
