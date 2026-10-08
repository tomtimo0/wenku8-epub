/** 支持的页面编码 */
export type Charset = 'utf-8' | 'gbk';

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
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 轻量 HTTP 传输层：编码解码、按主机限速、超时与错误分类。
 * 不包含任何站点 DOM 选择器。
 */
export class HttpTransport {
  private readonly lastRequestAt = new Map<string, number>();
  private readonly userAgent: string;
  private minIntervalMs: number;
  private readonly timeoutMs: number;

  /**
   * @param options - 传输配置
   */
  constructor(private readonly options: HttpTransportOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_UA;
    this.minIntervalMs = options.minIntervalMs ?? 1200;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /**
   * 调整全局请求间隔（用于遇到频控后退避）
   * @param ms - 新的基础间隔
   */
  setMinInterval(ms: number): void {
    this.minIntervalMs = ms;
  }

  /**
   * GET 请求并按 charset 解码
   * @param url - 目标 URL
   * @param options - 请求选项
   */
  async get(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    await this.throttle(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal = options.signal ?? controller.signal;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          ...options.headers,
        },
        redirect: 'follow',
        signal,
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      return {
        url: res.url || url,
        status: res.status,
        headers,
        buffer,
        text: decodeBuffer(buffer, options.charset ?? 'utf-8'),
      };
    } finally {
      clearTimeout(timer);
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
    const wait = last + this.minIntervalMs - now;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequestAt.set(host, Date.now());
  }
}

/**
 * 按编码解码二进制
 * @param buffer - 原始字节
 * @param charset - 编码
 */
export function decodeBuffer(buffer: Buffer, charset: Charset): string {
  if (charset === 'gbk') {
    return new TextDecoder('gbk').decode(buffer);
  }
  return buffer.toString('utf8');
}
