import readline from 'node:readline';
import { BrowserTransport } from '../transports/browser.js';
import { ContentCache, browserProfileDir } from '../transports/cache.js';
import { defaultAdapters } from '../registry.js';

const LOGIN_URLS: Record<string, string> = {
  tadu: 'https://www.tadu.com/',
  wenku8: 'https://www.wenku8.net/',
};

/**
 * 有头打开站点，人工登录后保留持久化 profile
 * @param siteOrUrl - 站点 id 或任意该站 URL
 * @param cacheRoot - 缓存根目录
 */
export async function runLogin(siteOrUrl: string, cacheRoot: string): Promise<void> {
  const trimmed = siteOrUrl.trim();
  const adapters = defaultAdapters();
  let siteId = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    const matched = adapters.find((a) => a.match(trimmed) > 0);
    if (!matched) {
      throw new Error('无法从 URL 识别站点，请使用站点 id：tadu | wenku8');
    }
    siteId = matched.id;
  } else {
    const found = adapters.find((a) => a.id === siteId);
    if (!found) {
      throw new Error(`未知站点 "${siteId}"，可用：${adapters.map((a) => a.id).join(', ')}`);
    }
  }

  const loginUrl = LOGIN_URLS[siteId] ?? trimmed;
  const cache = new ContentCache(cacheRoot);
  const browser = new BrowserTransport({
    profileDir: cache.pathFor(browserProfileDir(siteId)),
    headless: false,
  });
  await browser.ensureStarted();
  const page = browser.getPage();
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.log(`已在浏览器打开 ${loginUrl}`);
  console.log('完成登录后，回到本终端按 Enter 保存会话并退出…');
  await waitForEnter();
  await browser.close();
  console.log(`会话已保存到 ${cache.pathFor(browserProfileDir(siteId))}`);
}

/**
 * 等待用户按 Enter
 */
function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}
