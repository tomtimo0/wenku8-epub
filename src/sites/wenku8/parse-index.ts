import * as cheerio from 'cheerio';
import type { Book, Chapter, Volume } from '../../types.js';

/**
 * 压缩连续空白为单个空格
 * @param s - 原始字符串
 */
function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 解析目录页 HTML 为 Book 骨架（正文与 URL 由适配器补齐）
 * @param html - 目录页 HTML
 * @param bookId - 书籍 ID
 * @param indexUrl - 目录页规范化 URL
 */
export function parseIndexPage(html: string, bookId: string, indexUrl: string): Book {
  const $ = cheerio.load(html);
  const title = collapseWs($('#title').text());
  const infoText = $('#info').text();
  const authorMatch = infoText.match(/作者[：:]\s*(.+)/);
  const author = authorMatch ? collapseWs(authorMatch[1]) : '';

  const volumes: Volume[] = [];
  let currentVolume: Volume | null = null;

  $('table.css td').each((_, el) => {
    const $td = $(el);
    if ($td.hasClass('vcss')) {
      const vid = $td.attr('vid') ?? '';
      currentVolume = { id: vid, title: collapseWs($td.text()), chapters: [] };
      volumes.push(currentVolume);
      return;
    }
    if ($td.hasClass('ccss')) {
      const $a = $td.find('a').first();
      if ($a.length === 0) {
        return;
      }
      const href = $a.attr('href') ?? '';
      const id = href.replace(/\.htm$/i, '');
      if (!id) {
        return;
      }
      const chapter: Chapter = {
        id,
        title: collapseWs($a.text()),
        url: '',
        access: 'unknown',
        blocks: [],
        isIllustration: false,
      };
      if (!currentVolume) {
        currentVolume = { id: '0', title: '', chapters: [] };
        volumes.push(currentVolume);
      }
      currentVolume.chapters.push(chapter);
    }
  });

  return {
    source: { site: 'wenku8', bookId, canonicalUrl: indexUrl },
    id: bookId,
    title,
    author,
    volumes,
  };
}
