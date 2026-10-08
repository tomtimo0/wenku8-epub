import * as cheerio from 'cheerio';
import type { Book } from '../types.js';

const FIELD_RE = /^(文库分类|小说作者|文章状态|最后更新|全文长度)[：:](.*)$/;

/**
 * 解析书籍信息页元数据
 * @param html - 信息页 HTML
 */
export function parseBookPage(html: string): Partial<Book> {
  const $ = cheerio.load(html);
  const partial: Partial<Book> = {};

  $('table td').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const m = text.match(FIELD_RE);
    if (!m) {
      return;
    }
    const [, label, value] = m;
    const v = value.trim();
    switch (label) {
      case '文库分类':
        partial.category = v;
        break;
      case '小说作者':
        partial.author = v;
        break;
      case '文章状态':
        partial.status = v;
        break;
      case '最后更新':
        partial.lastUpdate = v;
        break;
      case '全文长度':
        partial.length = v;
        break;
      default:
        break;
    }
  });

  const introHeading = $('span, td, div')
    .filter((_, el) => /内容简介/.test($(el).text()))
    .first();
  if (introHeading.length) {
    const container = introHeading.parent();
    const spans = container.find('span');
    if (spans.length >= 2) {
      partial.intro = spans
        .eq(1)
        .text()
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      const full = container.text().replace(/内容简介[：:]?\s*/, '');
      if (full.trim()) {
        partial.intro = full.replace(/\s+/g, ' ').trim();
      }
    }
  }

  return partial;
}
