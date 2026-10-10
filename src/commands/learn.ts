import path from 'node:path';
import fs from 'node:fs/promises';
import { HttpTransport } from '../transports/http.js';
import { BrowserTransport } from '../transports/browser.js';
import { ContentCache, browserProfileDir } from '../transports/cache.js';
import { learnSiteRule } from '../sites/generic/learn-rule.js';

/**
 * 探测 URL 并保存学到的规则
 * @param url - 入口 URL
 * @param options - 输出与缓存
 */
export async function runLearn(
  url: string,
  options: { out?: string; cacheRoot: string; headless: boolean },
): Promise<string> {
  const cache = new ContentCache(options.cacheRoot);
  const http = new HttpTransport();
  const browser = new BrowserTransport({
    profileDir: cache.pathFor(browserProfileDir('generic')),
    headless: options.headless,
  });
  try {
    const rule = await learnSiteRule(url, {
      fetchText: (u) => http.get(u, { charset: 'auto' }).then((r) => ({ status: r.status, text: r.text })),
      render: (u) => browser.renderHtml(u),
    });
    const host = new URL(url).hostname.replace(/[^\w.-]+/g, '_');
    const outPath =
      options.out ??
      path.join(options.cacheRoot, 'learned', `${host}.json`);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(rule, null, 2), 'utf8');
    console.log(`已保存规则：${outPath}`);
    return outPath;
  } finally {
    await browser.close();
  }
}
