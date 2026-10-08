import crypto from 'node:crypto';
import path from 'node:path';
import type { Book, ResolvedImage } from './types.js';
import type { ContentCache } from './transports/cache.js';
import { fetchWithSafeRedirects, isSafeHttpUrl } from './net/safe-url.js';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 单张图片大小上限（默认 12MB） */
const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** 单本书图片下载总量上限（默认 200MB） */
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export { isSafeHttpUrl };

/** 兼容旧名：判断资源 URL 是否可安全下载 */
export const isSafeAssetUrl = isSafeHttpUrl;

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'unknown';

export interface ImageResolveRequest {
  url: string;
  headers?: Record<string, string>;
}

export interface ImageDownloadOptions {
  cache: ContentCache;
  site: string;
  bookId: string;
  /** 由适配器提供的每 URL 请求策略 */
  resolveRequest: (url: string) => ImageResolveRequest;
  imageQuality?: number;
  maxImageWidth?: number;
  concurrency: number;
  maxImageBytes?: number;
  /** 单本书图片总量上限，默认 200MB */
  maxTotalBytes?: number;
}

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
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') {
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

/**
 * 资产缓存键：URL 的 SHA-256
 * @param url - 资源 URL
 * @param ext - 扩展名
 */
export function assetCacheKey(url: string, ext: string): string {
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  return `${hash}.${ext}`;
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

  const map = new Map<string, ResolvedImage>();
  const list = [...urls];
  const maxBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  let totalBytes = 0;
  let idx = 0;
  const concurrency = Math.max(1, options.concurrency);

  const worker = async (): Promise<void> => {
    while (true) {
      const i = idx++;
      if (i >= list.length) {
        return;
      }
      const url = list[i];
      if (!isSafeAssetUrl(url)) {
        map.set(url, {
          url,
          epubPath: '',
          mediaType: '',
          buffer: Buffer.alloc(0),
          failed: true,
        });
        continue;
      }
      try {
        const { headers } = options.resolveRequest(url);
        // 手动跟随重定向，逐跳校验目标地址，阻止跳到私网/非 http(s)
        const res = await fetchWithSafeRedirects(url, {
          headers: { 'User-Agent': DEFAULT_UA, ...headers },
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > maxBytes) {
          throw new Error(`图片超过大小上限 ${maxBytes} 字节`);
        }
        if (totalBytes + buf.byteLength > maxTotalBytes) {
          throw new Error(`图片总量超过上限 ${maxTotalBytes} 字节`);
        }
        totalBytes += buf.byteLength;
        const format = detectImageFormat(buf);
        if (format === 'unknown') {
          throw new Error('无法识别的图片格式');
        }
        const ext = extForFormat(format);
        await options.cache.writeBuffer(
          `books/${options.site}/${options.bookId}/assets/${assetCacheKey(url, ext)}`,
          buf,
        );
        map.set(url, {
          url,
          epubPath: '',
          mediaType: mediaTypeForFormat(format),
          buffer: buf,
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
  return [...imageMap.values()].filter((r) => r.failed).map((r) => r.url);
}

/**
 * 下载封面候选（按优先级），返回首个成功的图片
 * @param candidates - 候选 URL 列表
 * @param resolveRequest - 请求策略
 */
export async function fetchCover(
  candidates: string[],
  resolveRequest: (url: string) => ImageResolveRequest,
): Promise<{ buffer: Buffer; mediaType: string } | null> {
  for (const url of candidates) {
    if (!isSafeAssetUrl(url)) {
      continue;
    }
    try {
      const { headers } = resolveRequest(url);
      const res = await fetchWithSafeRedirects(url, {
        headers: { 'User-Agent': DEFAULT_UA, ...headers },
      });
      if (!res.ok) {
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const format = detectImageFormat(buf);
      if (format === 'unknown') {
        continue;
      }
      return { buffer: buf, mediaType: mediaTypeForFormat(format) };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 图片缓存目录的绝对路径（供调试）
 * @param cacheDir - 缓存根
 * @param site - 站点
 * @param bookId - 书号
 */
export function assetDir(cacheDir: string, site: string, bookId: string): string {
  return path.join(cacheDir, 'books', site, bookId, 'assets');
}
