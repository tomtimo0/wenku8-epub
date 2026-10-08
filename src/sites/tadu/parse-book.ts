import * as cheerio from 'cheerio';
import type { Book } from '../../types.js';

/**
 * 压缩空白
 * @param s - 原始字符串
 */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 去除作者名尾部“著”
 * @param author - 原始作者文本
 */
function stripAuthorSuffix(author: string): string {
  return author.replace(/[著|着]\s*$/, '').trim();
}

/**
 * 解析塔读书籍详情页元数据（Open Graph / JSON-LD 优先）
 * @param html - 详情页 HTML（UTF-8）
 */
export function parseTaduBookPage(html: string): Partial<Book> {
  const $ = cheerio.load(html);
  const partial: Partial<Book> = {};

  const og = (name: string): string | undefined =>
    $(`meta[property="og:${name}"]`).attr('content')?.trim() || undefined;

  const title = og('novel:book_name') ?? og('title');
  if (title) {
    partial.title = collapse(title);
  }

  const author = og('novel:author');
  if (author) {
    partial.author = stripAuthorSuffix(collapse(author));
  } else {
    const domAuthor = $('.bookNm .author').first().text();
    if (domAuthor) {
      partial.author = stripAuthorSuffix(collapse(domAuthor));
    }
  }

  const category = og('novel:category');
  if (category) {
    partial.category = collapse(category);
  }

  const status = og('novel:status');
  if (status) {
    partial.status = collapse(status);
  }

  const intro = og('description');
  if (intro) {
    partial.intro = collapse(intro);
  } else {
    const domIntro = $('p.intro').first().text();
    if (domIntro) {
      partial.intro = collapse(domIntro);
    }
  }

  const cover =
    og('image') ??
    $('.bookCover img[data-src]').first().attr('data-src')?.trim() ??
    $('.bookCover img').first().attr('src')?.trim();
  if (cover) {
    try {
      partial.coverUrl = new URL(cover, 'https://www.tadu.com/').href;
    } catch {
      // 忽略非法封面 URL
    }
  }

  return partial;
}
