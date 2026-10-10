import path from 'node:path';
import type { Book, Chapter } from '../types.js';

export interface BuildTxtOptions {
  book: Book;
  crlf?: boolean;
  imageDir?: string;
  imageMap?: Map<string, { fileName: string }>;
}

/**
 * 计算东亚显示宽度（全角=2）
 * @param text - 文本
 */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += ch.codePointAt(0)! > 0xff ? 2 : 1;
  }
  return w;
}

/**
 * 居中一行（按显示宽度）
 * @param text - 文本
 * @param width - 行宽
 */
export function centerLine(text: string, width = 40): string {
  const w = displayWidth(text);
  const pad = Math.max(0, Math.floor((width - w) / 2));
  return ' '.repeat(pad) + text;
}

/**
 * 生成 UTF-8 BOM 的 TXT 内容
 * @param options - 选项
 */
export function buildTxt(options: BuildTxtOptions): Buffer {
  const nl = options.crlf ? '\r\n' : '\n';
  const lines: string[] = [];
  lines.push(centerLine(options.book.title));
  lines.push(centerLine(options.book.author));
  lines.push('');
  if (options.book.intro) {
    lines.push(options.book.intro);
    lines.push('');
  }
  for (const vol of options.book.volumes) {
    lines.push(centerLine(vol.title));
    lines.push('');
    for (const ch of vol.chapters) {
      if (!ch.blocks?.length) {
        continue;
      }
      lines.push(centerLine(ch.title));
      lines.push('');
      for (const b of ch.blocks) {
        if (b.kind === 'paragraph') {
          lines.push(`　　${b.text}`);
          lines.push('');
        } else if (b.kind === 'image') {
          const name = options.imageMap?.get(b.src)?.fileName ?? b.src;
          lines.push(`　　〔插图：${name}〕`);
          lines.push('');
        }
      }
    }
  }
  const body = lines.join(nl);
  return Buffer.from('\ufeff' + body, 'utf8');
}

/**
 * 写入 TXT 与可选图片目录
 * @param outPath - 输出 .txt 路径
 * @param options - 选项
 */
export async function writeTxtFile(
  outPath: string,
  options: BuildTxtOptions,
): Promise<void> {
  const fs = await import('node:fs/promises');
  const buf = buildTxt(options);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buf);
}
