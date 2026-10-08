import * as cheerio from 'cheerio';
import type { Block } from '../types.js';
import { normalizeLine } from '../text/normalize.js';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/**
 * 按文档顺序遍历节点，收集段落与图片块
 * @param $ - cheerio 实例
 * @param nodes - 起始子节点
 */
function walkContent($: CheerioAPI, nodes: Cheerio<AnyNode>): Block[] {
  const blocks: Block[] = [];
  let lineBuf = '';

  const flushLine = (): void => {
    const normalized = normalizeLine(lineBuf);
    if (normalized) {
      blocks.push({ kind: 'paragraph', text: normalized });
    }
    lineBuf = '';
  };

  const visit = (el: AnyNode): void => {
    if (el.type === 'text') {
      lineBuf += el.data ?? '';
      return;
    }
    if (el.type !== 'tag') {
      return;
    }
    const tag = (el as Element).name.toLowerCase();
    if (tag === 'br') {
      flushLine();
      return;
    }
    if (tag === 'img') {
      flushLine();
      const src = $(el as Element).attr('src') ?? '';
      if (src) {
        blocks.push({ kind: 'image', src });
      }
      return;
    }
    if (tag === 'ul' && $(el as Element).attr('id') === 'contentdp') {
      return;
    }
    const children = $(el as Element).contents().toArray();
    for (const child of children) {
      visit(child);
    }
  };

  nodes.each((_, el) => {
    visit(el);
  });
  flushLine();
  return blocks;
}

/**
 * 解析章节页为内容块列表
 * @param html - 章节页 HTML
 */
export function parseChapterPage(html: string): Block[] {
  const $ = cheerio.load(html);
  const $content = $('#content');
  $content.find('ul[id="contentdp"]').remove();
  const nodes = $content.contents();
  return walkContent($, nodes);
}

/**
 * 根据块列表判断是否为纯插图章
 * @param blocks - 章节块
 */
export function isIllustrationChapter(blocks: Block[]): boolean {
  if (blocks.length === 0) {
    return false;
  }
  return blocks.every((b) => b.kind === 'image');
}
