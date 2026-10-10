import { describe, expect, it } from 'vitest';
import { defaultAdapters, selectAdapter } from '../src/registry.js';
import { TaduAdapter } from '../src/sites/tadu/index.js';
import { Wenku8Adapter } from '../src/sites/wenku8/index.js';

const adapters = defaultAdapters();

describe('selectAdapter', () => {
  it('按 URL 自动选择站点', () => {
    expect(
      selectAdapter('https://www.tadu.com/book/catalogue/1020572', adapters)
        .adapter.id,
    ).toBe('tadu');
    expect(
      selectAdapter('https://www.wenku8.net/novel/2/2896/index.htm', adapters)
        .adapter.id,
    ).toBe('wenku8');
  });

  it('纯数字默认 wenku8 并给出弃用提示', () => {
    const { adapter, notice } = selectAdapter('2896', adapters);
    expect(adapter.id).toBe('wenku8');
    expect(notice).toBeTruthy();
  });

  it('--site 强制指定', () => {
    expect(selectAdapter('anything', adapters, 'tadu').adapter.id).toBe('tadu');
    expect(() => selectAdapter('x', adapters, 'unknown')).toThrow();
  });

  it('无法识别时明确报错', () => {
    expect(() => selectAdapter('https://example.com/book/1', adapters)).toThrow();
  });
});

describe('adapter capabilities', () => {
  it('塔读支持章节页面池并发', () => {
    const tadu = new TaduAdapter();
    expect(tadu.capabilities.chapterNeedsPage).toBe(true);
    expect(tadu.capabilities.maxConcurrency).toBe(2);
  });

  it('wenku8 需要浏览器但单页抓取', () => {
    const wk = new Wenku8Adapter();
    expect(wk.capabilities.needsBrowser).toBe(true);
    expect(wk.capabilities.chapterNeedsPage).toBe(false);
  });
});
