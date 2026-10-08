import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import {
  collectLinkClusters,
  evaluateCatalogue,
  inspectCatalogue,
  pathPattern,
  scoreContentCandidates,
} from '../src/sites/generic/inspect.js';
import { parseGenericChapter } from '../src/sites/generic/parse-chapter.js';
import { probeGeneric, type ProbeTransport } from '../src/sites/generic/probe.js';
import { GenericAdapter } from '../src/sites/generic/index.js';
import { experimentalAdapters, defaultAdapters, selectAdapter } from '../src/registry.js';
import { scaffoldAdapter } from '../src/scaffold.js';

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

function fixture(name: string): string {
  return readFileSync(path.join(fixtures, name), 'utf8');
}

const ENTRY = 'https://novel.example.com/book/1234/';

/** 构造一个离线假传输：入口页返回静态 HTML，书籍页返回渲染后 DOM，章节页返回样章 */
function fakeTransport(options?: {
  entry?: string;
  renderedEntry?: string;
  chapter?: string;
}): ProbeTransport {
  return {
    fetchText: async () => ({ status: 200, text: options?.entry ?? '' }),
    render: async (url: string) => {
      if (url.includes('/book/1234/1.html') || url.endsWith('/1')) {
        return options?.chapter ?? '';
      }
      return options?.renderedEntry ?? options?.entry ?? '';
    },
  };
}

describe('generic inspectCatalogue', () => {
  it('识别静态小说页：书名、作者、封面与章节链接簇', () => {
    const inspection = inspectCatalogue(fixture('generic-static.html'), ENTRY);
    expect(inspection.title).toBe('虚构静态小说');
    expect(inspection.author).toBe('虚构作者');
    expect(inspection.blocked).toBe(false);
    expect(inspection.coverCandidates[0]).toBe(
      'https://cdn.example.com/cover.jpg',
    );
    const verdict = evaluateCatalogue(inspection);
    expect(verdict.ok).toBe(true);
    expect(verdict.bestCluster?.count).toBe(3);
    expect(verdict.bestCluster?.chapterTextRatio).toBe(1);
    expect(verdict.bestCluster?.pattern).toContain(':n');
  });

  it('CSR 应用壳静态不足，渲染后才识别', () => {
    const shell = inspectCatalogue(fixture('generic-js-shell.html'), ENTRY);
    expect(shell.clusters).toHaveLength(0);
    expect(evaluateCatalogue(shell).ok).toBe(false);

    const rendered = inspectCatalogue(fixture('generic-js-rendered.html'), ENTRY);
    const verdict = evaluateCatalogue(rendered);
    expect(verdict.ok).toBe(true);
    expect(verdict.bestCluster?.count).toBe(3);
  });

  it('非小说页明确拒绝（链接文本不像章节）', () => {
    const inspection = inspectCatalogue(
      fixture('generic-non-novel.html'),
      'https://corp.example.com/',
    );
    const verdict = evaluateCatalogue(inspection);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/章节特征|章节链接/);
  });

  it('pathPattern 归一化数字段', () => {
    expect(pathPattern('https://a.example.com/book/12/34.html')).toBe(
      'https://a.example.com/book/:n/:n.html',
    );
  });

  it('跨域链接可成簇但会被置信度门槛拒绝', () => {
    const html = `<html><head><title>跨域测试</title></head><body>
      <a href="https://other.example.com/book/1/1">第一章</a>
      <a href="https://other.example.com/book/1/2">第二章</a>
    </body></html>`;
    const inspection = inspectCatalogue(html, ENTRY);
    expect(inspection.clusters).toHaveLength(1);
    expect(inspection.clusters[0].allSameOrigin).toBe(false);
    const verdict = evaluateCatalogue(inspection);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/跨域/);
  });
});

describe('generic scoreContentCandidates', () => {
  it('优先选择段落化、低链接密度的 article', () => {
    const content = scoreContentCandidates(fixture('generic-chapter.html'));
    expect(content.best?.selector).toBe('article');
    expect(content.best?.linkDensity).toBeLessThan(0.2);
  });
});

describe('generic parseGenericChapter', () => {
  it('块级分段、br 换行、图片原位保留，且跳过导航页脚', () => {
    const { blocks } = parseGenericChapter(fixture('generic-chapter.html'));
    expect(blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
      'image',
      'paragraph',
    ]);
    expect(blocks[0]).toMatchObject({ text: expect.stringContaining('第一段') });
    expect(blocks[3]).toMatchObject({ kind: 'image', src: '/img/1.jpg' });
    const joined = blocks
      .filter((b) => b.kind === 'paragraph')
      .map((b) => (b.kind === 'paragraph' ? b.text : ''))
      .join('');
    expect(joined).not.toContain('页脚');
  });
});

describe('generic probeGeneric', () => {
  it('静态页达到门槛并构建 Book（单合成卷 + 正文选择器）', async () => {
    const result = await probeGeneric(
      ENTRY,
      fakeTransport({
        entry: fixture('generic-static.html'),
        chapter: fixture('generic-chapter.html'),
      }),
      { site: 'generic' },
    );
    expect(result.report.accepted).toBe(true);
    expect(result.book?.title).toBe('虚构静态小说');
    expect(result.book?.volumes).toHaveLength(1);
    expect(result.book?.volumes[0].chapters).toHaveLength(3);
    expect(result.contentSelector).toBe('article');
    expect(result.book?.volumes[0].chapters[0].locator).toEqual({
      contentSelector: 'article',
    });
  });

  it('CSR 站点回退浏览器渲染后达到门槛', async () => {
    const result = await probeGeneric(
      ENTRY,
      fakeTransport({
        entry: fixture('generic-js-shell.html'),
        renderedEntry: fixture('generic-js-rendered.html'),
        chapter: fixture('generic-chapter.html'),
      }),
      { site: 'generic' },
    );
    expect(result.report.accepted).toBe(true);
    expect(result.book?.volumes[0].chapters).toHaveLength(3);
    expect(
      result.report.warnings.some((w) => w.includes('浏览器渲染')),
    ).toBe(true);
  });

  it('非小说页不构建 Book 并给出原因', async () => {
    const result = await probeGeneric(
      'https://corp.example.com/',
      fakeTransport({ entry: fixture('generic-non-novel.html') }),
      { site: 'generic' },
    );
    expect(result.report.accepted).toBe(false);
    expect(result.book).toBeUndefined();
    expect(result.report.reason).toBeTruthy();
  });

  it('样章遮挡时拒绝接受', async () => {
    const blocked = `<html><body><div class="shelter">请先登录后继续阅读</div></body></html>`;
    const result = await probeGeneric(
      ENTRY,
      fakeTransport({
        entry: fixture('generic-static.html'),
        chapter: blocked,
      }),
      { site: 'generic' },
    );
    expect(result.report.accepted).toBe(false);
    expect(result.report.reason).toMatch(/遮挡/);
  });

  it('拒绝私网/非 http(s) 地址', async () => {
    await expect(
      probeGeneric('http://127.0.0.1/novel', fakeTransport(), { site: 'generic' }),
    ).rejects.toThrow(/不安全/);
  });
});

describe('GenericAdapter', () => {
  const adapter = new GenericAdapter();

  it('仅作为最低优先级匹配 http(s) URL', () => {
    expect(adapter.match('https://novel.example.com/book/1')).toBe(1);
    expect(adapter.match('https://www.wenku8.net/novel/2/2896/index.htm')).toBe(1);
    expect(adapter.match('http://127.0.0.1/x')).toBe(0);
    expect(adapter.match('2896')).toBe(0);
  });

  it('resolve 得到稳定 canonical URL 与书号', async () => {
    const ref = await adapter.resolve('https://novel.example.com/book/1234/');
    expect(ref.site).toBe('generic');
    expect(ref.bookId).toBe('1234');
    expect(ref.canonicalUrl).toBe('https://novel.example.com/book/1234/');
  });

  it('默认适配器不含通用探测，实验列表才纳入', () => {
    expect(defaultAdapters().some((a) => a.id === 'generic')).toBe(false);
    const experimental = experimentalAdapters();
    expect(experimental.some((a) => a.id === 'generic')).toBe(true);
    expect(
      selectAdapter('https://novel.example.com/book/1', experimental).adapter.id,
    ).toBe('generic');
    expect(() =>
      selectAdapter('https://novel.example.com/book/1', defaultAdapters()),
    ).toThrow();
  });
});

describe('scaffoldAdapter', () => {
  it('依据诊断生成适配器脚手架文件', async () => {
    const probe = await probeGeneric(
      ENTRY,
      fakeTransport({
        entry: fixture('generic-static.html'),
        chapter: fixture('generic-chapter.html'),
      }),
      { site: 'generic' },
    );
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-'));
    const result = await scaffoldAdapter('example', probe.report, dir);
    const adapterFile = result.files.find((f) => f.endsWith('adapter.ts'));
    expect(adapterFile).toBeTruthy();
    const content = await fs.readFile(adapterFile!, 'utf8');
    expect(content).toContain('class ExampleAdapter');
    expect(content).toContain("readonly id = 'example'");
    const chapterFile = result.files.find((f) => f.endsWith('parse-chapter.ts'));
    expect(await fs.readFile(chapterFile!, 'utf8')).toContain('article');
    await fs.rm(dir, { recursive: true, force: true });
  });
});
