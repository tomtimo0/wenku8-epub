#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { Command } from 'commander';
import { parseBookId, indexPageUrl } from './urls.js';
import { Wenku8Session } from './session.js';
import { BookFetcher } from './fetcher.js';
import {
  resolveBookImages,
  failedImageUrls,
} from './images.js';
import {
  buildEpub,
  buildChapterImagePathMap,
  sanitizeFileName,
} from './epub/builder.js';
import { fetchCover } from './cover.js';
import type { IllusPosition } from './types.js';
import {
  countCharacters,
  countImages,
  firstIllusImageInVolume,
  parseVolumeRange,
} from './illus.js';

const CACHE_DIR = path.resolve('.cache');
const DEFAULT_OUT = path.resolve('output');

export interface CliOptions {
  out: string;
  split: 'full' | 'volume';
  volumes?: string;
  illusPosition: IllusPosition;
  noImages: boolean;
  imageQuality?: number;
  maxImageWidth?: number;
  delay: number;
  concurrency: number;
  refresh: boolean;
  headful: boolean;
}

/**
 * 运行转换主流程
 * @param bookId - 书号
 * @param options - CLI 选项
 */
export async function runConvert(
  bookId: string,
  options: CliOptions,
): Promise<void> {
  const session = new Wenku8Session({
    cacheDir: CACHE_DIR,
    /** 默认有头；`--headful` 显式保持有头（与默认相同） */
    headless: false,
  });
  await session.start();

  try {
    const fetcher = new BookFetcher({
      cacheDir: CACHE_DIR,
      session,
      delayMs: options.delay,
      concurrency: options.concurrency,
      refresh: options.refresh,
      onProgress: (msg) => console.log(msg),
    });

    console.log(`书号 ${bookId}：抓取目录与书籍信息…`);
    const book = await fetcher.fetchBookSkeleton(bookId);
    book.coverUrl = indexPageUrl(bookId);

    const allVolumes = book.volumes;
    let volumeIndices: number[] | null = null;
    if (options.volumes) {
      volumeIndices = parseVolumeRange(
        options.volumes,
        allVolumes.length,
      );
      book.volumes = volumeIndices.map((i) => allVolumes[i - 1]);
    }

    console.log(
      `《${book.title}》${book.author} — ${book.volumes.length} 卷，开始抓取章节…`,
    );
    await fetcher.fetchChapters(book);

    let cover = await fetchCover(bookId);
    let imageMap = new Map<string, import('./types.js').ResolvedImage>();

    if (!options.noImages) {
      console.log('下载插图…');
      imageMap = await resolveBookImages(book, {
        cacheDir: CACHE_DIR,
        bookId,
        imageQuality: options.imageQuality,
        maxImageWidth: options.maxImageWidth,
        concurrency: 4,
      });
    }

    const chapterImagePaths = buildChapterImagePathMap(book, imageMap);
    await fs.mkdir(options.out, { recursive: true });

    if (options.split === 'full') {
      const buf = await buildEpub({
        book,
        coverBuffer: cover.buffer,
        coverMediaType: cover.mediaType,
        imageMap,
        chapterImagePaths,
        illusPosition: options.illusPosition,
      });
      const fileName = `${sanitizeFileName(book.title)}.epub`;
      const outPath = path.join(options.out, fileName);
      await fs.writeFile(outPath, buf);
      console.log(`已写入 ${outPath}`);
    } else {
      const originalVolumes = book.volumes;
      for (let i = 0; i < originalVolumes.length; i++) {
        const vol = originalVolumes[i];
        const groupPosition = volumeIndices ? volumeIndices[i] : i + 1;
        let volCover = cover;
        const illus = firstIllusImageInVolume(vol, imageMap);
        if (illus) {
          volCover = {
            buffer: illus.buffer,
            mediaType: illus.mediaType,
          };
        }
        const buf = await buildEpub({
          book,
          coverBuffer: volCover.buffer,
          coverMediaType: volCover.mediaType,
          imageMap,
          chapterImagePaths,
          illusPosition: options.illusPosition,
          seriesTitle: book.title,
          groupPosition,
          volumeFilter: [vol],
        });
        const fileName = `${sanitizeFileName(book.title)} 第${groupPosition}卷 ${sanitizeFileName(vol.title)}.epub`;
        const outPath = path.join(options.out, fileName);
        await fs.writeFile(outPath, buf);
        console.log(`已写入 ${outPath}`);
      }
    }

    const failed = failedImageUrls(imageMap);
    console.log('—— 统计 ——');
    console.log(
      `章节：${book.volumes.reduce((n, v) => n + v.chapters.length, 0)}`,
    );
    console.log(`字数约：${countCharacters(book)}`);
    console.log(`图片块：${countImages(book)}`);
    if (failed.length) {
      console.log(`插图下载失败 ${failed.length} 张：`);
      for (const u of failed) {
        console.log(`  - ${u}`);
      }
    }
  } finally {
    await session.close();
  }
}

const program = new Command();
program
  .name('wenku8-epub')
  .description('将轻小说文库（wenku8）转为 EPUB')
  .argument('<urlOrId>', '目录页 URL、书籍页 URL 或书号')
  .option('-o, --out <dir>', '输出目录', DEFAULT_OUT)
  .option(
    '--split <mode>',
    'full（整本）或 volume（每卷一个）',
    'full',
  )
  .option('--volumes <range>', '只处理部分卷，如 1-3,5')
  .option(
    '--illus-position <pos>',
    'start | end | keep',
    'start',
  )
  .option('--no-images', '不下载图片（调试）')
  .option('--image-quality <n>', 'JPEG 质量 1-100', (v) =>
    Number.parseInt(v, 10),
  )
  .option('--max-image-width <px>', '图片最大宽度', (v) =>
    Number.parseInt(v, 10),
  )
  .option('--delay <ms>', '请求间隔基数', (v) => Number.parseInt(v, 10), 1500)
  .option('--concurrency <n>', '章节并发（最大 2）', (v) =>
    Math.min(2, Number.parseInt(v, 10)),
    1,
  )
  .option('--refresh', '忽略章节 HTML 缓存')
  .option('--headful', '显示浏览器窗口（便于过 Cloudflare）')
  .action(async (urlOrId: string, opts) => {
    const bookId = parseBookId(urlOrId);
    const illus = opts.illusPosition as IllusPosition;
    if (!['start', 'end', 'keep'].includes(illus)) {
      throw new Error('--illus-position 必须是 start、end 或 keep');
    }
    const split = opts.split as 'full' | 'volume';
    if (split !== 'full' && split !== 'volume') {
      throw new Error('--split 必须是 full 或 volume');
    }
    await runConvert(bookId, {
      out: path.resolve(opts.out),
      split,
      volumes: opts.volumes,
      illusPosition: illus,
      noImages: opts.images === false,
      imageQuality: opts.imageQuality,
      maxImageWidth: opts.maxImageWidth,
      delay: opts.delay,
      concurrency: opts.concurrency,
      refresh: opts.refresh === true,
      headful: opts.headful === true,
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
