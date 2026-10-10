import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findCatalogueNextPage,
  parseRuleCatalogueMerged,
} from '../src/sites/rules/catalogue-pages.js';
import { htmlToBlocks } from '../src/extract/dom-text.js';
const ficPaging = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/sites/rules/builtin/fic-paging.json'),
    'utf8',
  ),
);

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rules');

function fixture(name: string): string {
  return readFileSync(path.join(fixtures, name), 'utf8');
}

describe('catalogue pagination', () => {
  it('合并两页目录章节', () => {
    const rule = ficPaging as import('../src/sites/rules/schema.js').SiteRule;
    const p1 = fixture('paging-catalogue-1.html');
    const p2 = fixture('paging-catalogue-2.html');
    const next = findCatalogueNextPage(rule, p1, 'https://paging.example.com/book/94389/');
    expect(next).toContain('page/2');
    const book = parseRuleCatalogueMerged(rule, [p1, p2], '94389', 'https://paging.example.com/book/94389/');
    expect(book.volumes[0].chapters).toHaveLength(4);
    expect(book.volumes[0].chapters[0].title).toContain('第一章');
    expect(book.volumes[0].chapters[2].title).toContain('第二十一章');
  });

  it('章内分页各页正文可解析', () => {
    const rule = ficPaging as import('../src/sites/rules/schema.js').SiteRule;
    const b1 = htmlToBlocks(fixture('paging-chapter-1.html'), {
      rootSelector: rule.chapter.content,
      remove: rule.chapter.remove,
    }).blocks;
    const b2 = htmlToBlocks(fixture('paging-chapter-2.html'), {
      rootSelector: rule.chapter.content,
      remove: rule.chapter.remove,
    }).blocks;
    expect(b1[0]).toMatchObject({ kind: 'paragraph' });
    expect(b2[0]).toMatchObject({ text: expect.stringContaining('第二页') });
  });
});
