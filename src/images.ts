import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Book, Block, ResolvedImage } from './types.js';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'unknown';

/**
 * 根据魔数识别图片格式
 * @param buf - 文件头字节
 */
export function detectImageFormat(buf: Buffer): ImageFormat {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    return 'jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (
    buf.length >= 6 &&
    buf.toString('ascii', 0, 3) === 'GIF'
  ) {
    return 'gif';
  }
  return 'unknown';
}

/**
 * @param format - 图片格式
 */
export function mediaTypeForFormat(format: ImageFormat): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

/**
 * @param format - 图片格式
 */
export function extForFormat(format: ImageFormat): string {
  switch (format) {
    case 'jpeg':
      return 'jpg';
    case 'png':
      return 'png';
    case 'webp':
      return 'webp';
    case 'gif':
      return 'gif';
    default:
      return 'bin';
  }
}

export interface ImageDownloadOptions {
  cacheDir: string;
  bookId: string;
  imageQuality?: number;
  maxImageWidth?: number;
  concurrency: number;
}

/**
 * 从 URL 提取缓存文件名
 * @param url - 图片 URL
 */
function cacheFileName(url: string): string {
  const base = url.split('/').pop() ?? 'image';
  return base.replace(/[^\w.-]+/g, '_');
}

/**
 * 下载单张图片
 */
async function downloadOne(
  url: string,
  cachePath: string,
): Promise<Buffer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Referer: 'https://www.wenku8.net/',
          'User-Agent': DEFAULT_UA,
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, buf);
      return buf;
    } catch (e) {
      if (attempt === 2) {
        throw e;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}

/**
 * 收集书中所有图片 URL 并下载，返回 url → ResolvedImage 映射
 * @param book - 完整书籍
 * @param options - 下载选项
 */
export async function resolveBookImages(
  book: Book,
  options: ImageDownloadOptions,
): Promise<Map<string, ResolvedImage>> {
  const urls = new Set<string>();
  for (const vol of book.volumes) {
    for (const ch of vol.chapters) {
      for (const b of ch.blocks) {
        if (b.kind === 'image') {
          urls.add(b.src);
        }
      }
    }
  }

  const cacheRoot = path.join(options.cacheDir, 'images', options.bookId);
  const map = new Map<string, ResolvedImage>();
  const list = [...urls];
  let idx = 0;
  const concurrency = Math.max(1, options.concurrency);

  const worker = async (): Promise<void> => {
    while (true) {
      const i = idx++;
      if (i >= list.length) {
        return;
      }
      const url = list[i];
      const cachePath = path.join(cacheRoot, cacheFileName(url));
      let buf: Buffer | null = null;
      try {
        buf = await fs.readFile(cachePath);
      } catch {
        buf = null;
      }
      try {
        if (!buf) {
          buf = await downloadOne(url, cachePath);
        }
        let format = detectImageFormat(buf);
        let outBuf = buf;
        let width: number | undefined;
        let height: number | undefined;

        if (
          options.imageQuality !== undefined ||
          options.maxImageWidth !== undefined
        ) {
          let pipeline = sharp(buf);
          const meta = await pipeline.metadata();
          width = meta.width;
          height = meta.height;
          if (
            options.maxImageWidth &&
            meta.width &&
            meta.width > options.maxImageWidth
          ) {
            pipeline = pipeline.resize({ width: options.maxImageWidth });
          }
          const quality = options.imageQuality ?? 85;
          outBuf = await pipeline.jpeg({ quality }).toBuffer();
          format = 'jpeg';
          const m2 = await sharp(outBuf).metadata();
          width = m2.width;
          height = m2.height;
        }

        const ext = extForFormat(format);
        map.set(url, {
          url,
          epubPath: `images/${cacheFileName(url)}.${ext}`,
          mediaType: mediaTypeForFormat(format),
          buffer: outBuf,
          width,
          height,
        });
      } catch {
        map.set(url, {
          url,
          epubPath: '',
          mediaType: '',
          buffer: Buffer.alloc(0),
          failed: true,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return map;
}

/**
 * 统计下载失败的图片 URL
 * @param imageMap - 图片映射
 */
export function failedImageUrls(imageMap: Map<string, ResolvedImage>): string[] {
  return [...imageMap.values()]
    .filter((r) => r.failed)
    .map((r) => r.url);
}
