import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { Block } from '../../types.js';
import { normalizeLine } from '../../text/normalize.js';

/** 保守的站点推广段落句式（精确前缀匹配，避免误伤正文） */
const PROMOTION_PATTERNS: RegExp[] = [
  /^登录后看书更方便/,
  /^下载塔读(文学)?(客户端|APP|app)/,
  /^(打开|使用)塔读(客户端|APP|app)/,
  /^扫码(下载|登录)/,
  /^塔读文学[,，]?\s*更多精彩/,
];

export interface TaduChapterParseResult {
  blocks: Block[];
  warnings: string[];
}

/**
 * 判断一行是否命中站点推广句式
 * @param line - 已清洗的行
 */
function isPromotion(line: string): boolean {
  return PROMOTION_PATTERNS.some((re) => re.test(line));
}

/**
 * 解析浏览器渲染后的 `#partContent` HTML 为 Block[]。
 * 纯函数，仅做结构性解析与推广过滤，不发起任何网络请求。
 * @param html - 渲染后 DOM（含 #partContent）的 HTML
 * @param currentChapterId - 当前章节 ID，用于识别可疑 data-limit 节点
 */
export function parseTaduRenderedChapter(
  html: string,
  currentChapterId?: string,
): TaduChapterParseResult {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const container = $('#partContent');
  if (container.length === 0) {
    return { blocks: [], warnings: ['未找到 #partContent'] };
  }

  const blocks: Block[] = [];
  let suspiciousCount = 0;
  let promotionCount = 0;

  container.children().each((_, el) => {
    const $el = $(el as Element);
    const tag = (el as Element).name.toLowerCase();

    if (tag === 'img') {
      const src =
        $el.attr('data-original')?.trim() ||
        $el.attr('data-src')?.trim() ||
        $el.attr('src')?.trim();
      if (src) {
        blocks.push({ kind: 'image', src });
      }
      return;
    }

    if (tag !== 'p') {
      return;
    }

    const limit = $el.attr('data-limit');
    if (limit && currentChapterId && limit.trim() === currentChapterId) {
      suspiciousCount++;
    }

    const text = collectParagraphText($, $el);
    if (text.length === 0) {
      return;
    }
    if (isPromotion(text)) {
      promotionCount++;
      return;
    }
    blocks.push({ kind: 'paragraph', text });
  });

  if (suspiciousCount > 0) {
    warnings.push(
      `检测到 ${suspiciousCount} 个 data-limit 与当前章节 ID 相同的可疑节点`,
    );
  }
  if (promotionCount > 0) {
    warnings.push(`过滤站点推广段落 ${promotionCount} 段`);
  }
  return { blocks, warnings };
}

/**
 * 还原段内文本：`<br>` 转换行，其余按文本拼接
 * @param $ - cheerio 实例
 * @param $p - 段落节点
 */
function collectParagraphText(
  $: CheerioAPI,
  $p: Cheerio<Element>,
): string {
  const pieces: string[] = [];
  const walk = (node: AnyNode): void => {
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
    for (const child of $(node as Element).contents().toArray()) {
      walk(child);
    }
  };
  walk($p.get(0) as AnyNode);
  const raw = pieces.join('');
  // 段内换行先统一为空格（缩进交给 CSS），再走通用清洗
  return normalizeLine(raw.replace(/\n+/g, ' ')) ?? '';
}
