import { describe, expect, it } from 'vitest';
import type { SiteAdapter } from '../src/site.js';
import { defaultAdapters } from '../src/registry.js';
import { loadAllRules, rulesToAdapters } from '../src/sites/rules/loader.js';
import { TaduAdapter } from '../src/sites/tadu/index.js';
import { Wenku8Adapter } from '../src/sites/wenku8/index.js';

/**
 * 每个适配器都需满足的最小契约（离线部分）。
 * @param name - 用例名
 * @param adapter - 适配器
 * @param sample - 该站点的样例 URL
 * @param foreign - 其他站点的 URL（不应匹配）
 */
function contract(
  name: string,
  adapter: SiteAdapter,
  sample: string,
  foreign: string,
): void {
  describe(`adapter contract: ${name}`, () => {
    it('具备稳定元数据', () => {
      expect(adapter.id).toBeTruthy();
      expect(adapter.displayName).toBeTruthy();
      expect(adapter.parserVersion).toMatch(/^\d+\.\d+/);
    });

    it('匹配自身且不误认他人', () => {
      expect(adapter.match(sample)).toBeGreaterThan(0);
      expect(adapter.match(foreign)).toBe(0);
    });

    it('resolve 返回稳定 canonical URL 与书号', async () => {
      const ref = await adapter.resolve(sample);
      expect(ref.site).toBe(adapter.id);
      expect(ref.bookId).toMatch(/^\d+$/);
      const again = await adapter.resolve(sample);
      expect(again.canonicalUrl).toBe(ref.canonicalUrl);
      expect(again.canonicalUrl).toMatch(/^https:\/\//);
    });

    it('assetRequest 只返回目标资源 URL', () => {
      const book = {
        source: { site: adapter.id, bookId: '1', canonicalUrl: sample },
        id: '1',
        title: 't',
        author: 'a',
        volumes: [],
      };
      const req = adapter.assetRequest('https://cdn.example.com/x.jpg', book);
      expect(req.url).toBe('https://cdn.example.com/x.jpg');
    });
  });
}

contract(
  'wenku8',
  new Wenku8Adapter(),
  'https://www.wenku8.net/novel/2/2896/index.htm',
  'https://www.tadu.com/book/catalogue/1020572',
);

contract(
  'tadu',
  new TaduAdapter(),
  'https://www.tadu.com/book/catalogue/1020572',
  'https://www.wenku8.net/novel/2/2896/index.htm',
);

describe('adapter registry', () => {
  it('内置适配器 id 唯一', () => {
    const ids = defaultAdapters().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('builtin rules', () => {
  it('内置规则可匹配并 resolve', async () => {
    const loaded = await loadAllRules();
    expect(loaded.length).toBeGreaterThanOrEqual(2);
    for (const entry of loaded) {
      const adapter = rulesToAdapters([entry])[0];
      const host = entry.rule.match.hosts[0];
      const url = `https://${host}/book/1234/`;
      expect(adapter.match(url)).toBeGreaterThan(0);
      const ref = await adapter.resolve(url);
      expect(ref.site).toBe(entry.rule.id);
      expect(ref.canonicalUrl).toMatch(/^https:\/\//);
    }
  });
});

describe('tadu capabilities', () => {
  it('声明浏览器与页面池能力', () => {
    const adapter = new TaduAdapter();
    expect(adapter.capabilities.needsBrowser).toBe(true);
    expect(adapter.capabilities.chapterNeedsPage).toBe(true);
    expect(adapter.parserVersion).toMatch(/^0\.2/);
  });
});
