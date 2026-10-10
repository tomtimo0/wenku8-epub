import * as cheerio from 'cheerio';
import type { Book, Chapter } from '../../types.js';
import type { SiteRule } from './schema.js';
import { parseRuleCatalogue } from './parse-catalogue.js';

/**
 * 合并多页目录 HTML 为一本书
 * @param rule - 站点规则
 * @param htmlPages - 各页 HTML（按顺序）
 * @param bookId - 书号
 * @param canonicalUrl - 目录首页 URL
 */
export function parseRuleCatalogueMerged(
  rule: SiteRule,
  htmlPages: string[],
  bookId: string,
  canonicalUrl: string,
): Book {
  let book: Book | null = null;
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  for (const html of htmlPages) {
    const part = parseRuleCatalogue(rule, html, bookId, canonicalUrl);
    if (!book) {
      book = part;
    } else {
      book.title = part.title || book.title;
      book.author = part.author || book.author;
      book.coverUrl = part.coverUrl ?? book.coverUrl;
      book.intro = part.intro ?? book.intro;
    }
    for (const ch of part.volumes[0]?.chapters ?? []) {
      if (seen.has(ch.url)) {
        continue;
      }
      seen.add(ch.url);
      chapters.push(ch);
    }
  }

  if (!book) {
    throw new Error('目录为空');
  }
  book.volumes = [{ id: 'main', title: '正文', chapters }];
  return book;
}

/**
 * 查找目录「下一页」链接
 * @param rule - 站点规则
 * @param html - 当前页 HTML
 * @param currentUrl - 当前页 URL
 */
export function findCatalogueNextPage(
  rule: SiteRule,
  html: string,
  currentUrl: string,
): string | null {
  const sel = rule.catalogue.nextPage;
  if (!sel) {
    return null;
  }
  const $ = cheerio.load(html);
  const links = $(sel).toArray();
  for (const el of links) {
    const href = $(el).attr('href');
    if (!href || href === '#' || href.startsWith('javascript:')) {
      continue;
    }
    const next = new URL(href, currentUrl).href;
    if (next !== currentUrl) {
      return next;
    }
  }
  return null;
}
