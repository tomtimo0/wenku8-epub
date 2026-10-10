import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRuleCatalogue } from '../src/sites/rules/parse-catalogue.js';
import { RuleAdapter } from '../src/sites/rules/rule-adapter.js';
import { validateSiteRule } from '../src/sites/rules/schema.js';
import { htmlToBlocks } from '../src/extract/dom-text.js';
const ficStatic = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/sites/rules/builtin/fic-static.json'),
    'utf8',
  ),
);

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('validateSiteRule', () => {
  it('拒绝缺少 catalogue.chapter 的规则', () => {
    const { issues } = validateSiteRule({ id: 'x', name: 'x', version: '1', match: { hosts: ['a'] }, book: { title: 't' }, catalogue: {}, chapter: {} });
    expect(issues.some((i) => i.path.includes('chapter'))).toBe(true);
  });

  it('接受内置 fic-static 规则', () => {
    const { rule, issues } = validateSiteRule(ficStatic);
    expect(issues).toHaveLength(0);
    expect(rule?.id).toBe('fic-static');
  });
});

describe('RuleAdapter 离线解析', () => {
  it('解析虚构静态目录', () => {
    const html = readFileSync(path.join(fixtures, 'generic-static.html'), 'utf8');
    const book = parseRuleCatalogue(
      ficStatic as import('../src/sites/rules/schema.js').SiteRule,
      html,
      '1234',
      'https://novel.example.com/book/1234/',
    );
    expect(book.title).toBe('虚构静态小说');
    expect(book.volumes[0].chapters).toHaveLength(3);
  });

  it('解析虚构章节正文', () => {
    const html = readFileSync(path.join(fixtures, 'generic-chapter.html'), 'utf8');
    const { blocks } = htmlToBlocks(html, { rootSelector: 'article', remove: ['nav', 'footer'] });
    expect(blocks.filter((b) => b.kind === 'paragraph').length).toBeGreaterThanOrEqual(3);
  });

  it('匹配 novel.example.com', () => {
    const adapter = new RuleAdapter(ficStatic as import('../src/sites/rules/schema.js').SiteRule);
    expect(adapter.match('https://novel.example.com/book/1234/')).toBe(85);
    expect(adapter.match('https://other.com/')).toBe(0);
  });
});
