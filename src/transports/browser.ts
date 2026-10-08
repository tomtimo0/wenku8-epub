import { chromium, type BrowserContext, type Page } from 'playwright';
import type { Charset } from './http.js';

export interface BrowserTransportOptions {
  /** 持久化用户目录 */
  profileDir: string;
  /** 是否无头 */
  headless: boolean;
  /** 优先使用的浏览器 channel */
  channel?: string;
}

export interface BrowserHtmlResult {
  status: number;
  text: string;
}

/**
 * 浏览器传输层：按站点隔离持久化 profile，支持页内 fetch 与渲染后提取。
 * 不包含任何站点 DOM 选择器。
 */
export class BrowserTransport {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private closed = false;

  /**
   * @param options - 传输配置
   */
  constructor(private readonly options: BrowserTransportOptions) {}

  /**
   * 启动持久化浏览器上下文并注册退出清理
   */
  async start(): Promise<void> {
    const base = {
      headless: this.options.headless,
      viewport: { width: 1280, height: 800 },
    };
    const channel = this.options.channel ?? 'chrome';
    try {
      this.context = await chromium.launchPersistentContext(
        this.options.profileDir,
        { ...base, channel },
      );
    } catch {
      this.context = await chromium.launchPersistentContext(
        this.options.profileDir,
        base,
      );
    }
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    const onExit = (): void => {
      void this.close();
    };
    process.once('SIGINT', onExit);
    process.once('SIGTERM', onExit);
    process.once('beforeExit', onExit);
  }

  /**
   * 打开探测页并轮询直到 check 返回 true
   * @param probeUrl - 探测 URL
   * @param check - 页内判定脚本
   * @param timeoutMs - 超时
   */
  async ensureReady(
    probeUrl: string,
    check: () => boolean,
    timeoutMs = 120_000,
  ): Promise<void> {
    const page = this.getPage();
    await page.goto(probeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await page.evaluate(check)) {
        return;
      }
      await page.waitForTimeout(2000);
    }
    throw new Error(`等待站点就绪超时（${timeoutMs}ms）`);
  }

  /**
   * 在已就绪的会话中 fetch 页面并按 charset 解码
   * @param url - 目标 URL
   * @param charset - 编码
   */
  async fetchHtml(url: string, charset: Charset = 'utf-8'): Promise<BrowserHtmlResult> {
    const page = this.getPage();
    return page.evaluate(
      async (params: { url: string; charset: string }) => {
        const res = await fetch(params.url, { credentials: 'include' });
        const buf = await res.arrayBuffer();
        const text =
          params.charset === 'gbk'
            ? new TextDecoder('gbk').decode(buf)
            : new TextDecoder('utf-8').decode(buf);
        return { status: res.status, text };
      },
      { url, charset },
    );
  }

  /**
   * 打开页面、等待选择器，再在页面上下文中提取数据
   * @param url - 目标 URL
   * @param waitSelector - 需出现的选择器
   * @param extract - 页内提取函数
   */
  async gotoAndExtract<T>(
    url: string,
    waitSelector: string,
    extract: () => T,
  ): Promise<T> {
    const page = this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector(waitSelector, { timeout: 30_000 });
    return page.evaluate(extract);
  }

  /**
   * 暴露当前页面（供适配器做站点级交互）
   */
  getPage(): Page {
    if (!this.page) {
      throw new Error('浏览器传输层未启动');
    }
    return this.page;
  }

  /**
   * 关闭浏览器上下文
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
    }
  }
}
