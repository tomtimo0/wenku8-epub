import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseIndexPage } from '../src/sites/wenku8/parse-index.js';
import {
  parseChapterPage,
  isIllustrationChapter,
} from '../src/sites/wenku8/parse-chapter.js';
import { parseBookPage } from '../src/sites/wenku8/parse-book.js';
import { indexPageUrl, parseBookId } from '../src/sites/wenku8/urls.js';

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

function fixture(name: string): string {
  return readFileSync(path.join(fixtures, name), 'utf8');
}

describe('wenku8 parseIndexPage', () => {
  it('解析多卷、空单元格与插图章', () => {
    const url = indexPageUrl('9999');
    const book = parseIndexPage(fixture('index-page.html'), '9999', url);
    expect(book.source).toEqual({ site: 'wenku8', bookId: '9999', canonicalUrl: url });
    expect(book.title).toBe('虚构书名');
    expect(book.author).toBe('测试作者');
    expect(book.volumes).toHaveLength(2);
    expect(book.volumes[0].id).toBe('100');
    expect(book.volumes[0].chapters.map((c) => c.title)).toEqual([
      '序章',
      '第一章',
      '插图',
    ]);
    expect(book.volumes[1].chapters[0].title).toBe('第二章');
    expect(book.volumes[1].chapters[0].id).toBe('201');
  });
});

describe('wenku8 parseChapterPage', () => {
  it('删除水印与 contentdp 并保留段落', () => {
    const blocks = parseChapterPage(fixture('chapter-text.html'));
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.kind === 'paragraph')).toBe(true);
    expect(blocks[0]).toMatchObject({ text: '段落一' });
    expect(blocks[2]).toMatchObject({ text: '段落三' });
    for (const b of blocks) {
      if (b.kind === 'paragraph') {
        expect(b.text).not.toMatch(/[\u00A0\u3000]/);
        expect(b.text).not.toMatch(/轻小说文库/);
      }
    }
  });

  it('文字与图片顺序正确', () => {
    const blocks = parseChapterPage(fixture('chapter-mixed.html'));
    expect(blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'image',
      'paragraph',
    ]);
  });

  it('纯插图章', () => {
    const blocks = parseChapterPage(fixture('chapter-illus.html'));
    expect(isIllustrationChapter(blocks)).toBe(true);
    expect(blocks).toHaveLength(2);
  });
});

describe('wenku8 parseBookPage', () => {
  it('解析元数据字段', () => {
    const html = `
    <table>
      <tr><td>文库分类：奇幻</td></tr>
      <tr><td>小说作者：作者甲</td></tr>
      <tr><td>文章状态：连载中</td></tr>
      <tr><td>最后更新：2020-01-02</td></tr>
      <tr><td>全文长度：12345字</td></tr>
    </table>`;
    const meta = parseBookPage(html);
    expect(meta).toMatchObject({
      category: '奇幻',
      author: '作者甲',
      status: '连载中',
      lastUpdate: '2020-01-02',
      length: '12345字',
    });
  });
});

describe('wenku8 urls', () => {
  it('解析书号', () => {
    expect(parseBookId('2896')).toBe('2896');
    expect(parseBookId('https://www.wenku8.net/novel/2/2896/index.htm')).toBe('2896');
    expect(parseBookId('https://www.wenku8.net/book/2896.htm')).toBe('2896');
    expect(indexPageUrl('2896')).toBe('https://www.wenku8.net/novel/2/2896/index.htm');
  });
});
