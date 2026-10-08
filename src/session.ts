import { chromium, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';

const CF_HTML_MARKERS = /cf-challenge|cf-mitigated|challenge-platform/i;

export interface SessionOptions {
  cacheDir: string;
  headless: boolean;
}

export interface FetchHtmlResult {
  status: number;
  html: string;
}

/**
 * 浏览器会话：过 Cloudflare 质询并在页内 fetch GBK HTML
 */
export class Wenku8Session {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly profileDir: string;
  private readonly headless: boolean;
  private bookIndexUrl: string | null = null;
  private closed = false;

  /**
   * @param options - 会话配置
   */
  constructor(options: SessionOptions) {
    this.profileDir = path.join(options.cacheDir, 'browser-profile');
    this.headless = options.headless;
  }

  /**
   * 启动浏览器并注册退出清理
   */
  async start(): Promise<void> {
    const launchOpts = {
      headless: this.headless,
      viewport: { width: 1280, height: 800 },
    };
    try {
      this.context = await chromium.launchPersistentContext(this.profileDir, {
        ...launchOpts,
        channel: 'chrome',
      });
    } catch {
      this.context = await chromium.launchPersistentContext(this.profileDir, launchOpts);
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
   * 打开目录页并等待质询通过
   * @param indexUrl - 目录页完整 URL
   */
  async ensureReady(indexUrl: string): Promise<void> {
    this.bookIndexUrl = indexUrl;
    const page = this.getPage();
    await page.goto(indexUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const ok = await page.evaluate(() => {
        const title = document.title;
        const badTitle =
          title.includes('请稍候') || /Just a moment/i.test(title);
        const hasTable = !!document.querySelector('table.css');
        return !badTitle && hasTable;
      });
      if (ok) {
        return;
      }
      if (!this.headless) {
        console.error(
          '等待 Cloudflare 验证：请在浏览器窗口中完成验证（若出现）…',
        );
      }
      await page.waitForTimeout(2000);
    }
    throw new Error('等待站点就绪超时（120s）');
  }

  /**
   * 在已通过质询的会话中 fetch 页面 HTML（GBK 解码）
   * @param url - 完整 URL 或相对路径（相对 wenku8 根）
   */
  async fetchHtml(url: string): Promise<FetchHtmlResult> {
    const absolute = url.startsWith('http')
      ? url
      : `https://www.wenku8.net${url.startsWith('/') ? '' : '/'}${url}`;

    const tryFetch = async (): Promise<FetchHtmlResult> => {
      const page = this.getPage();
      return page.evaluate(async (fetchUrl: string) => {
        const res = await fetch(fetchUrl, { credentials: 'include' });
        const buf = await res.arrayBuffer();
        const html = new TextDecoder('gbk').decode(buf);
        return { status: res.status, html };
      }, absolute);
    };

    let result = await tryFetch();
    if (
      result.status === 403 ||
      result.status === 503 ||
      CF_HTML_MARKERS.test(result.html)
    ) {
      if (this.bookIndexUrl) {
        await this.ensureReady(this.bookIndexUrl);
      }
      result = await tryFetch();
    }
    return result;
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

  private getPage(): Page {
    if (!this.page) {
      throw new Error('会话未启动');
    }
    return this.page;
  }
}
