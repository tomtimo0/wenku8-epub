import type { Book, Volume } from './types.js';
import type { ResolvedImage } from './types.js';

/**
 * 解析 --volumes 参数，如 1-3,5
 * @param spec - 卷范围字符串
 * @param total - 总卷数
 */
export function parseVolumeRange(
  spec: string,
  total: number,
): number[] {
  const set = new Set<number>();
  for (const part of spec.split(',')) {
    const p = part.trim();
    if (!p) {
      continue;
    }
    if (p.includes('-')) {
      const [a, b] = p.split('-').map((x) => Number.parseInt(x.trim(), 10));
      if (Number.isNaN(a) || Number.isNaN(b)) {
        throw new Error(`无效的卷范围: ${part}`);
      }
      for (let i = a; i <= b; i++) {
        if (i >= 1 && i <= total) {
          set.add(i);
        }
      }
    } else {
      const n = Number.parseInt(p, 10);
      if (Number.isNaN(n) || n < 1 || n > total) {
        throw new Error(`无效的卷号: ${p}`);
      }
      set.add(n);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 取卷内第一张插图章的首图作为分卷封面
 * @param volume - 卷
 * @param imageMap - 图片映射
 */
export function firstIllusImageInVolume(
  volume: Volume,
  imageMap: Map<string, ResolvedImage>,
): ResolvedImage | undefined {
  for (const ch of volume.chapters) {
    if (!ch.isIllustration) {
      continue;
    }
    for (const b of ch.blocks) {
      if (b.kind === 'image') {
        const img = imageMap.get(b.src);
        if (img && !img.failed) {
          return img;
        }
      }
    }
  }
  return undefined;
}

/**
 * 统计全书字数（段落字符数）
 * @param book - 书籍
 */
export function countCharacters(book: Book): number {
  let n = 0;
  for (const vol of book.volumes) {
    for (const ch of vol.chapters) {
      for (const b of ch.blocks) {
        if (b.kind === 'paragraph') {
          n += b.text.length;
        }
      }
    }
  }
  return n;
}

/**
 * 统计图片块数量
 * @param book - 书籍
 */
export function countImages(book: Book): number {
  let n = 0;
  for (const vol of book.volumes) {
    for (const ch of vol.chapters) {
      n += ch.blocks.filter((b) => b.kind === 'image').length;
    }
  }
  return n;
}
