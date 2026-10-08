import * as cheerio from 'cheerio';
import type { Book, Chapter, ChapterAccess, Volume } from '../../types.js';
import { catalogueUrl } from './urls.js';

export interface TaduCatalogueResult {
  book: Book;
  warnings: string[];
}

/**
 * 压缩空白
 * @param s - 原始字符串
 */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 从 title 属性解析章节字数与首发时间（可选元数据）
 * @param titleAttr - a[title] 文本
 */
function parseTitleAttr(titleAttr: string): {
  expectedCharacters?: number;
  publishedAt?: string;
} {
  const out: { expectedCharacters?: number; publishedAt?: string } = {};
  const chars = titleAttr.match(/章节字数[：:]\s*(\d+)/);
  if (chars) {
    out.expectedCharacters = Number.parseInt(chars[1], 10);
  }
  const time = titleAttr.match(/首发时间[：:]\s*([\d\-: ]+)/);
  if (time) {
    out.publishedAt = time[1].trim();
  }
  return out;
}

/**
 * 根据分组标题推断访问状态
 * @param groupTitle - 分组标题
 */
function accessForGroup(groupTitle: string): ChapterAccess {
  if (/收费|付费|VIP|会员/i.test(groupTitle)) {
    return 'restricted';
  }
  if (/免费/.test(groupTitle)) {
    return 'public';
  }
  return 'unknown';
}

/**
 * 解析塔读目录页为 Book 骨架
 * @param html - 目录页 HTML（UTF-8）
 * @param bookId - 书号
 * @param pageUrl - 目录页 URL（用于归一化相对链接）
 */
export function parseTaduCatalogue(
  html: string,
  bookId: string,
  pageUrl = catalogueUrl(bookId),
): TaduCatalogueResult {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const root = $('.boxCenter.directory');
  const title = collapse(root.find('> h1').first().text());

  const meta: { author?: string; category?: string; length?: string } = {};
  root.find('.itct span').each((_, el) => {
    const $span = $(el);
    const label = collapse($span.find('em').first().text()).replace(/[：:]/g, '');
    const value = collapse($span.clone().children('em').remove().end().text());
    if (!value) {
      return;
    }
    switch (label) {
      case '作者':
        meta.author = value;
        break;
      case '分类':
        meta.category = value;
        break;
      case '字数':
        meta.length = value;
        break;
      default:
        break;
    }
  });

  const volumes: Volume[] = [];
  const seenChapterIds = new Set<string>();
  let newVolumeSeq = 0;

  root.find('.chapter').each((_, groupEl) => {
    const $group = $(groupEl);
    const $h2span = $group.find('h2 span').first();
    const groupTitle = collapse(
      $h2span.clone().children('i').remove().end().text(),
    );
    const declaredText = collapse($h2span.find('i').first().text());
    const declaredMatch = declaredText.match(/(\d+)/);
    const declared = declaredMatch
      ? Number.parseInt(declaredMatch[1], 10)
      : undefined;

    const access = accessForGroup(groupTitle);
    const isFree = access === 'public';
    const volume: Volume = {
      id: isFree ? 'main' : `g${++newVolumeSeq}`,
      title: isFree ? '正文' : groupTitle,
      chapters: [],
    };

    const links = $group.find('a[href*="/book/"]');
    links.each((__, aEl) => {
      const $a = $(aEl);
      const rawHref = ($a.attr('href') ?? '').trim();
      if (!rawHref) {
        return;
      }
      let url: string;
      try {
        url = new URL(rawHref, pageUrl).href;
      } catch {
        warnings.push(`无法归一化章节链接: ${rawHref}`);
        return;
      }
      const pathSegments = new URL(url).pathname.split('/').filter(Boolean);
      const last = pathSegments[pathSegments.length - 1] ?? '';
      if (!/^\d+$/.test(last)) {
        warnings.push(`无法解析章节 ID: ${url}`);
        return;
      }
      const chapterId = last;
      const metaExtra = parseTitleAttr($a.attr('title') ?? '');
      const chapter: Chapter = {
        id: chapterId,
        title: collapse($a.text()),
        url,
        access,
        blocks: [],
        isIllustration: false,
        expectedCharacters: metaExtra.expectedCharacters,
        publishedAt: metaExtra.publishedAt,
      };
      if (seenChapterIds.has(chapterId)) {
        warnings.push(`重复章节 ID: ${chapterId}（${chapter.title}）`);
      }
      seenChapterIds.add(chapterId);
      volume.chapters.push(chapter);
    });

    if (declared !== undefined && declared !== volume.chapters.length) {
      warnings.push(
        `分组“${groupTitle}”声明 ${declared} 章，实际解析 ${volume.chapters.length} 章`,
      );
    }
    volumes.push(volume);
  });

  const book: Book = {
    source: { site: 'tadu', bookId, canonicalUrl: catalogueUrl(bookId) },
    id: bookId,
    title,
    author: meta.author ?? '',
    category: meta.category,
    length: meta.length,
    volumes,
  };

  const linkCount = volumes.reduce((n, v) => n + v.chapters.length, 0);
  if (linkCount !== seenChapterIds.size) {
    warnings.push(
      `章节链接总数 ${linkCount} 与唯一章节数 ${seenChapterIds.size} 不一致`,
    );
  }

  return { book, warnings };
}
