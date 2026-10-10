import type { Block } from '../types.js';

/**
 * 从多章正文中学习重复水印行（≥60% 章出现、长度 ≤80）
 * @param chapters - 各章 Block 列表
 */
export function learnDropLines(chapters: Block[][]): string[] {
  if (chapters.length < 2) {
    return [];
  }
  const counts = new Map<string, number>();
  for (const blocks of chapters) {
    const lines = new Set<string>();
    for (const b of blocks) {
      if (b.kind === 'paragraph' && b.text.length <= 80) {
        lines.add(b.text);
      }
    }
    for (const line of lines) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  const threshold = Math.ceil(chapters.length * 0.6);
  return [...counts.entries()]
    .filter(([line, n]) => n >= threshold && line.length > 0)
    .map(([line]) => line);
}
