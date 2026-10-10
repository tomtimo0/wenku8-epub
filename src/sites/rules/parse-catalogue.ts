import * as cheerio from 'cheerio';
import type { Book, Chapter, Volume } from '../../types.js';
import type { SiteRule } from './schema.js';
import { extractValue } from './value-spec.js';

/**
 * 从目录页 HTML 解析 Book 骨架
 * @param rule - 站点规则
 * @param html - 目录 HTML
 * @param bookId - 书号
 * @param canonicalUrl - 目录 URL
 */
export function parseRuleCatalogue(
  rule: SiteRule,
  html: string,
  bookId: string,
  canonicalUrl: string,
): Book {
  const $ = cheerio.load(html);
  const base = canonicalUrl;
  const title =
    extractValue(html, rule.book.title, base) ?? '未知书名';
  const author = rule.book.author
    ? extractValue(html, rule.book.author, base) ?? '未知作者'
    : '未知作者';
  const book: Book = {
    source: { site: rule.id, bookId, canonicalUrl },
    id: bookId,
    title,
    author,
    intro: rule.book.intro ? extractValue(html, rule.book.intro, base) : undefined,
    coverUrl: rule.book.cover ? extractValue(html, rule.book.cover, base) : undefined,
    category: rule.book.category
      ? extractValue(html, rule.book.category, base)
      : undefined,
    status: rule.book.status ? extractValue(html, rule.book.status, base) : undefined,
    volumes: [],
  };

  const scope = rule.catalogue.root ? $(rule.catalogue.root) : $('body');
  const linkEls = scope.find(rule.catalogue.chapter);
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  linkEls.each((i, el) => {
    if (rule.catalogue.skipFirst && i < rule.catalogue.skipFirst) {
      return;
    }
    const href = $(el).attr('href');
    if (!href) {
      return;
    }
    const url = new URL(href, base).href;
    if (seen.has(url)) {
      return;
    }
    seen.add(url);
    const segs = new URL(url).pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1] ?? `c${i + 1}`;
    const id = last.replace(/\.\w+$/, '');
    chapters.push({
      id,
      title: $(el).text().trim() || `第${i + 1}章`,
      url,
      access: 'public',
      blocks: [],
      isIllustration: false,
    });
  });

  if (rule.catalogue.order === 'desc') {
    chapters.reverse();
  }

  const vol: Volume = { id: 'main', title: '正文', chapters };
  book.volumes = [vol];
  return book;
}
