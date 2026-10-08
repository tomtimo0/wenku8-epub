import {
  detectImageFormat,
  extForFormat,
  mediaTypeForFormat,
} from './images.js';
import { coverImageUrl } from './urls.js';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 下载书籍封面（先尝试大图，失败则用缩略图）
 * @param bookId - 书号
 */
export async function fetchCover(
  bookId: string,
): Promise<{ buffer: Buffer; mediaType: string }> {
  const urls = [coverImageUrl(bookId, true), coverImageUrl(bookId, false)];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          Referer: 'https://www.wenku8.net/',
          'User-Agent': DEFAULT_UA,
        },
      });
      if (!res.ok) {
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const format = detectImageFormat(buf);
      if (format === 'unknown') {
        continue;
      }
      return {
        buffer: buf,
        mediaType: mediaTypeForFormat(format),
      };
    } catch {
      continue;
    }
  }
  throw new Error('封面下载失败');
}

/**
 * 从 Buffer 推断封面扩展名
 * @param buf - 图片数据
 */
export function coverExtFromBuffer(buf: Buffer): string {
  return extForFormat(detectImageFormat(buf));
}
