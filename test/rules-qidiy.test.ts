import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRuleCatalogue } from '../src/sites/rules/parse-catalogue.js';
import { validateSiteRule } from '../src/sites/rules/schema.js';
import { htmlToBlocks } from '../src/extract/dom-text.js';
import { RuleAdapter } from '../src/sites/rules/rule-adapter.js';

const qidiy = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/sites/rules/builtin/qidiy.json'),
    'utf8',
  ),
);

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rules');

describe('qidiy 内置规则（虚构夹具）', () => {
  it('规则字段合法', () => {
    const { issues } = validateSiteRule(qidiy);
    expect(issues).toHaveLength(0);
  });

  it('解析虚构目录与章节', () => {
    const rule = qidiy as import('../src/sites/rules/schema.js').SiteRule;
    const catalogueHtml = readFileSync(path.join(fixtures, 'qidiy-catalogue.html'), 'utf8');
    const book = parseRuleCatalogue(
      rule,
      catalogueHtml,
      '94389',
      'https://fiction.qidiy.example/book/94389/',
    );
    expect(book.title).toBe('虚构启迪书');
    expect(book.volumes[0].chapters).toHaveLength(2);
    expect(book.volumes[0].chapters[0].url).toContain('1001.html');

    const chapterHtml = readFileSync(path.join(fixtures, 'qidiy-chapter.html'), 'utf8');
    const { blocks } = htmlToBlocks(chapterHtml, {
      rootSelector: rule.chapter.content,
      remove: rule.chapter.remove,
    });
    expect(blocks.filter((b) => b.kind === 'paragraph').length).toBeGreaterThanOrEqual(2);
  });

  it('匹配 qidiy 域名', () => {
    const adapter = new RuleAdapter(qidiy as import('../src/sites/rules/schema.js').SiteRule);
    expect(adapter.match('https://www.qidiy.com/book/94389/')).toBeGreaterThan(0);
    expect(adapter.match('https://fiction.qidiy.example/book/94389/')).toBe(0);
  });
});
