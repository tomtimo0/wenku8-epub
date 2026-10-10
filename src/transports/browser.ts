import { chromium, type BrowserContext, type Page } from 'playwright';
import type { Charset } from './http.js';
import type { CookieJar } from './cookies.js';

export interface BrowserTransportOptions {
  /** 持久化用户目录 */
  profileDir: string;
  /** 是否无头 */
  headless: boolean;
  /** 优先使用的浏览器 channel */
  channel?: string;
  /** 页面池大小（等于章节并发） */
  poolSize?: number;
  /** 用户中断信号 */
  signal?: AbortSignal;
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
  private defaultPage: Page | null = null;
  private pool: Page[] = [];
  private poolInUse = new Set<Page>();
  private closed = false;
  private starting: Promise<void> | null = null;

  /**
   * @param options - 传输配置
   */
  constructor(private readonly options: BrowserTransportOptions) {}

  /**
   * 懒启动持久化浏览器上下文
   */
  async ensureStarted(): Promise<void> {
    if (this.context) {
      return;
    }
    if (this.starting) {
      await this.starting;
      return;
    }
    this.starting = this.launch();
    await this.starting;
    this.starting = null;
  }

  private async launch(): Promise<void> {
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
    this.defaultPage = this.context.pages()[0] ?? (await this.context.newPage());
    await this.setupPage(this.defaultPage);
    const size = Math.max(1, this.options.poolSize ?? 1);
    this.pool = [this.defaultPage];
    while (this.pool.length < size) {
      const p = await this.context.newPage();
      await this.setupPage(p);
      this.pool.push(p);
    }
  }

  /**
   * 拦截静态资源以加快正文页渲染
   * @param page - Playwright 页面
   */
  private async setupPage(page: Page): Promise<void> {
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'font' || type === 'media') {
        void route.abort();
        return;
      }
      void route.continue();
    });
  }

  /**
   * 从池中借用一个页面（章节并发时各 worker 独占）
   */
  async acquirePage(): Promise<Page> {
    await this.ensureStarted();
    if (this.options.signal?.aborted) {
      throw new Error('已中断');
    }
    const free = this.pool.find((p) => !this.poolInUse.has(p));
    if (!free) {
      throw new Error('浏览器页面池已满');
    }
    this.poolInUse.add(free);
    return free;
  }

  /**
   * 归还页面到池
   * @param page - 借用的页面
   */
  releasePage(page: Page): void {
    this.poolInUse.delete(page);
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
      if (this.options.signal?.aborted) {
        throw new Error('已中断');
      }
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
   * 打开页面并返回渲染后的完整 HTML（用于 CSR 站点的探测与正文提取）。
   * @param url - 目标 URL
   * @param waitSelector - 可选：需先出现的选择器
   * @param settleMs - 选择器出现后的额外等待，给异步注入留时间
   */
  async renderHtml(
    url: string,
    waitSelector?: string,
    settleMs = 800,
  ): Promise<string> {
    const page = this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (waitSelector) {
      await page
        .waitForSelector(waitSelector, { timeout: 30_000 })
        .catch(() => {});
    }
    await page.waitForTimeout(settleMs);
    return page.content();
  }

  /**
   * 将浏览器 Cookie 同步到 HTTP CookieJar
   * @param jar - 目标容器
   */
  async syncCookiesTo(jar: CookieJar): Promise<void> {
    if (!this.context) {
      return;
    }
    jar.importPlaywright(await this.context.cookies());
  }

  /**
   * 质询页时等待用户验证（最多 180 秒）
   * @param url - 探测 URL
   */
  async ensureChallengePassed(url: string): Promise<void> {
    await this.ensureStarted();
    const page = this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (this.options.signal?.aborted) {
        throw new Error('已中断');
      }
      const challenged = await page.evaluate(() => {
        const t = document.title;
        return /Just a moment|请稍候|Checking your browser/i.test(t);
      });
      if (!challenged) {
        return;
      }
      if (this.options.headless) {
        console.warn('检测到质询页：若持续失败请使用 --headful 完成验证');
      }
      await page.waitForTimeout(2000);
    }
    throw new Error('质询页验证超时（180s）');
  }

  /**
   * 暴露默认页面（单页 fetch / ensureReady）
   */
  getPage(): Page {
    if (!this.defaultPage) {
      throw new Error('浏览器传输层未启动，请先调用 ensureStarted()');
    }
    return this.defaultPage;
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
      this.defaultPage = null;
      this.pool = [];
      this.poolInUse.clear();
    }
  }
}
