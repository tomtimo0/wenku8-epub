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
 * 解码塔读 `data-limit`（明文数字或 Base64 编码的数字 ID）
 * @param limit - 属性原始值
 */
export function decodeTaduDataLimit(limit: string): string {
  const trimmed = limit.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
    if (/^\d+$/.test(decoded)) {
      return decoded;
    }
  } catch {
    // 非 Base64，按原值处理
  }
  return trimmed;
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
 * @param currentChapterId - 当前章节 ID，用于识别推广段（data-limit 解码后相等则剔除）
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

    const rawLimit = $el.attr('data-limit');
    if (rawLimit && currentChapterId) {
      const decoded = decodeTaduDataLimit(rawLimit);
      if (decoded === currentChapterId) {
        promotionCount++;
        return;
      }
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
  return normalizeLine(raw.replace(/\n+/g, ' ')) ?? '';
}

/**
 * 与目录声明字数比对，偏差过大时记为可疑
 * @param blocks - 正文块
 * @param expectedCharacters - 目录声明字数
 */
export function taduCharacterWarnings(
  blocks: Block[],
  expectedCharacters?: number,
): string[] {
  if (expectedCharacters === undefined) {
    return [];
  }
  const total = blocks
    .filter((b): b is Extract<Block, { kind: 'paragraph' }> => b.kind === 'paragraph')
    .reduce((n, b) => n + b.text.length, 0);
  const threshold = Math.max(80, expectedCharacters * 0.08);
  if (Math.abs(total - expectedCharacters) > threshold) {
    return [
      `字数 ${total} 与目录声明 ${expectedCharacters} 偏差超过阈值（±${Math.round(threshold)}）`,
    ];
  }
  return [];
}
