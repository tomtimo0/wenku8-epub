import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { Block } from '../../types.js';
import { normalizeLine } from '../../text/normalize.js';

/** 会被视作段落边界（换行）的块级标签 */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'li',
  'blockquote',
  'tr',
  'dd',
  'dt',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
]);

/** 直接跳过的非正文标签（含 head/title，避免文档标题混入正文） */
const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'form',
  'iframe',
  'nav',
  'aside',
  'footer',
  'header',
  'head',
  'title',
  'meta',
  'link',
  'button',
  'select',
  'input',
]);

export interface GenericChapterParseResult {
  blocks: Block[];
  warnings: string[];
}

/**
 * 解析通用正文容器 HTML 为 Block[]（纯函数，不发起网络请求）。
 * 规则：块级标签作为段落边界；`<br>` 换行；`<img>` 输出图片块；
 * 链接密度过高时给出告警，便于上层判定内容可疑。
 * @param html - 正文容器（或整页）HTML
 */
export function parseGenericChapter(html: string): GenericChapterParseResult {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const blocks: Block[] = [];
  let lineBuf = '';

  const flushLine = (): void => {
    const normalized = normalizeLine(lineBuf);
    if (normalized) {
      blocks.push({ kind: 'paragraph', text: normalized });
    }
    lineBuf = '';
  };

  const visit = (node: AnyNode): void => {
    if (node.type === 'text') {
      lineBuf += node.data ?? '';
      return;
    }
    if (node.type === 'root') {
      for (const child of $(node).contents().toArray()) {
        visit(child);
      }
      return;
    }
    if (node.type !== 'tag') {
      return;
    }
    const tag = (node as Element).name.toLowerCase();
    if (SKIP_TAGS.has(tag)) {
      return;
    }
    if (tag === 'br') {
      flushLine();
      return;
    }
    if (tag === 'img') {
      flushLine();
      const $img = $(node as Element);
      const src =
        $img.attr('data-original')?.trim() ||
        $img.attr('data-src')?.trim() ||
        $img.attr('src')?.trim();
      if (src) {
        blocks.push({ kind: 'image', src });
      }
      return;
    }
    if (BLOCK_TAGS.has(tag)) {
      flushLine();
      for (const child of $(node as Element).contents().toArray()) {
        visit(child);
      }
      flushLine();
      return;
    }
    for (const child of $(node as Element).contents().toArray()) {
      visit(child);
    }
  };

  for (const rootNode of $.root().contents().toArray()) {
    visit(rootNode);
  }
  flushLine();

  const textChars = blocks.reduce(
    (n, b) => (b.kind === 'paragraph' ? n + b.text.length : n),
    0,
  );
  const linkChars = countLinkChars($);
  if (textChars > 0 && linkChars / textChars > 0.5) {
    warnings.push('链接密度偏高，正文可能不完整');
  }
  if (textChars > 0 && blocks.length < 2) {
    warnings.push('段落数偏少，正文结构可能变化');
  }
  if (textChars > 0 && textChars < 60) {
    warnings.push('正文字符数偏少');
  }
  return { blocks, warnings };
}

/**
 * 统计页面内链接文本长度（用于链接密度）
 * @param $ - cheerio 实例
 */
function countLinkChars($: CheerioAPI): number {
  let n = 0;
  $('a').each((_, a) => {
    n += $(a).text().trim().length;
  });
  return n;
}
