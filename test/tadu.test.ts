import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTaduCatalogue } from '../src/sites/tadu/parse-catalogue.js';
import { parseTaduBookPage } from '../src/sites/tadu/parse-book.js';
import {
  decodeTaduDataLimit,
  parseTaduRenderedChapter,
  taduCharacterWarnings,
} from '../src/sites/tadu/parse-rendered-chapter.js';
import {
  catalogueUrl,
  parseTaduInput,
} from '../src/sites/tadu/urls.js';

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

function fixture(name: string): string {
  return readFileSync(path.join(fixtures, name), 'utf8');
}

describe('tadu urls', () => {
  it('接受三类 URL', () => {
    expect(parseTaduInput('https://www.tadu.com/book/catalogue/1020572')).toEqual({
      bookId: '1020572',
    });
    expect(parseTaduInput('https://www.tadu.com/book/1020572')).toEqual({
      bookId: '1020572',
    });
    expect(
      parseTaduInput('https://www.tadu.com/book/1020572/101826908/'),
    ).toEqual({ bookId: '1020572', chapterId: '101826908' });
    expect(catalogueUrl('1020572')).toBe(
      'https://www.tadu.com/book/catalogue/1020572',
    );
  });

  it('拒绝非塔读域名', () => {
    expect(() => parseTaduInput('https://evil.com/book/1020572')).toThrow();
    expect(() =>
      parseTaduInput('https://tadu.com.evil.com/book/1020572'),
    ).toThrow();
  });
});

describe('tadu parseCatalogue', () => {
  it('解析元数据与合成正文卷', () => {
    const { book, warnings } = parseTaduCatalogue(
      fixture('tadu-catalogue.html'),
      '1020572',
    );
    expect(book.title).toBe('虚构塔读书名');
    expect(book.author).toBe('测试作者');
    expect(book.category).toBe('西方奇幻');
    expect(book.length).toBe('34.6万');
    expect(book.volumes).toHaveLength(1);
    expect(book.volumes[0].id).toBe('main');
    expect(book.volumes[0].title).toBe('正文');
    expect(book.volumes[0].chapters).toHaveLength(3);
    const first = book.volumes[0].chapters[0];
    expect(first.id).toBe('101826908');
    expect(first.url).toBe('https://www.tadu.com/book/1020572/101826908/');
    expect(first.access).toBe('public');
    expect(first.expectedCharacters).toBe(1034);
    expect(first.publishedAt).toBe('2024-04-23 21:13:58');
    expect(warnings).toHaveLength(0);
  });

  it('声明数量不一致时告警', () => {
    const html = fixture('tadu-catalogue.html').replace('/3章', '/5章');
    const { warnings } = parseTaduCatalogue(html, '1020572');
    expect(warnings.some((w) => w.includes('声明 5 章'))).toBe(true);
  });

  it('重复章节 ID 时告警', () => {
    const html = fixture('tadu-catalogue.html').replace(
      '/book/1020572/101826909/',
      '/book/1020572/101826908/',
    );
    const { warnings } = parseTaduCatalogue(html, '1020572');
    expect(warnings.some((w) => w.includes('重复章节 ID'))).toBe(true);
  });
});

describe('tadu parseBookPage', () => {
  it('优先 Open Graph 并去除作者“著”', () => {
    const meta = parseTaduBookPage(fixture('tadu-book.html'));
    expect(meta.title).toBe('虚构塔读书名');
    expect(meta.author).toBe('测试作者');
    expect(meta.category).toBe('西方奇幻');
    expect(meta.status).toBe('连载');
    expect(meta.intro).toBe('这是一段虚构简介。');
    expect(meta.coverUrl).toBe('https://media3.example.com/cover_a.jpg');
  });
});

describe('tadu data-limit', () => {
  it('解码 Base64 章节 ID', () => {
    expect(decodeTaduDataLimit('MTAxODI2OTA4')).toBe('101826908');
    expect(decodeTaduDataLimit('101826908')).toBe('101826908');
  });
});

describe('tadu parseRenderedChapter', () => {
  it('按 DOM 顺序生成块并过滤推广与可疑节点', () => {
    const { blocks, warnings } = parseTaduRenderedChapter(
      fixture('tadu-chapter-rendered.html'),
      '101826908',
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'paragraph',
      'image',
      'paragraph',
    ]);
    expect(blocks[0]).toMatchObject({ text: '第一段虚构正文。' });
    expect(blocks[1]).toMatchObject({
      text: '第二段虚构正文。 换行后的同一段。',
    });
    expect(blocks[2]).toMatchObject({ kind: 'image' });
    expect(warnings.some((w) => w.includes('推广段落'))).toBe(true);
  });

  it('未找到 #partContent 时返回空与告警', () => {
    const { blocks, warnings } = parseTaduRenderedChapter('<div></div>');
    expect(blocks).toHaveLength(0);
    expect(warnings[0]).toContain('#partContent');
  });
});

describe('taduCharacterWarnings', () => {
  it('字数偏差过大时告警', () => {
    const blocks = [{ kind: 'paragraph' as const, text: '短' }];
    expect(taduCharacterWarnings(blocks, 1034).length).toBe(1);
  });
});
