import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { Block } from '../types.js';
import { normalizeLine } from '../text/normalize.js';

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

export interface DomTextOptions {
  /** 正文根选择器 */
  rootSelector: string;
  /** 提取前删除的子选择器 */
  remove?: string[];
  /** 丢弃的整行（精确匹配） */
  dropLines?: string[];
  paragraphMode?: 'auto' | 'block' | 'br';
}

/**
 * 将正文容器 HTML 转为 Block[]
 * @param html - 页面或片段 HTML
 * @param options - 提取选项
 */
export function htmlToBlocks(
  html: string,
  options: DomTextOptions,
): { blocks: Block[]; warnings: string[] } {
  const $ = cheerio.load(html);
  for (const sel of options.remove ?? []) {
    $(sel).remove();
  }
  const root = $(options.rootSelector).first();
  if (root.length === 0) {
    return { blocks: [], warnings: [`未找到正文容器 ${options.rootSelector}`] };
  }
  const blocks: Block[] = [];
  const drop = new Set(options.dropLines ?? []);
  const walk = (node: AnyNode): void => {
    if (node.type !== 'tag') {
      return;
    }
    const el = node as Element;
    const tag = el.name.toLowerCase();
    if (SKIP_TAGS.has(tag)) {
      return;
    }
    if (tag === 'img') {
      const src =
        $(el).attr('data-original')?.trim() ||
        $(el).attr('data-src')?.trim() ||
        $(el).attr('src')?.trim();
      if (src) {
        blocks.push({ kind: 'image', src });
      }
      return;
    }
    if (tag === 'br' && options.paragraphMode === 'br') {
      return;
    }
    const paragraphLike =
      tag === 'p' ||
      /^h[1-6]$/.test(tag) ||
      tag === 'li' ||
      tag === 'blockquote' ||
      (options.paragraphMode === 'block' && BLOCK_TAGS.has(tag));
    if (paragraphLike) {
      const text = textContent($, el);
      const line = normalizeLine(text);
      if (line && !drop.has(line)) {
        blocks.push({ kind: 'paragraph', text: line });
      }
      return;
    }
    if (BLOCK_TAGS.has(tag) || tag === 'article' || tag === 'section') {
      for (const child of $(el).contents().toArray()) {
        walk(child);
      }
      return;
    }
    for (const child of $(el).contents().toArray()) {
      walk(child);
    }
  };
  walk(root.get(0) as AnyNode);
  const warnings: string[] = [];
  if (blocks.length === 0) {
    warnings.push('正文为空');
  }
  return { blocks, warnings };
}

/**
 * @param $ - cheerio
 * @param el - 元素
 */
function textContent($: CheerioAPI, el: Element): string {
  const pieces: string[] = [];
  const inner = (node: AnyNode): void => {
    if (node.type === 'text') {
      pieces.push(node.data ?? '');
      return;
    }
    if (node.type !== 'tag') {
      return;
    }
    const tag = (node as Element).name.toLowerCase();
    if (tag === 'br') {
      pieces.push('\n');
      return;
    }
    if (tag === 'img') {
      return;
    }
    for (const c of $(node as Element).contents().toArray()) {
      inner(c);
    }
  };
  inner(el);
  return pieces.join('').replace(/\n+/g, ' ');
}
