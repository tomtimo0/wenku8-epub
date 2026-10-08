#!/usr/bin/env node
import path from 'node:path';
import { Command } from 'commander';
import type { IllusPosition } from './types.js';
import {
  assertAdapterAllowed,
  defaultAdapters,
  selectAdapter,
} from './registry.js';
import { runConvert } from './orchestrator.js';

const CACHE_DIR = path.resolve('.cache');
const DEFAULT_OUT = path.resolve('output');

const program = new Command();

program
  .name('book2epub')
  .description('将受支持站点的公开小说页面转为 EPUB（多站点适配器架构）')
  .argument('<urlOrId>', '目录页/书籍页 URL，或（配 --site）纯书号')
  .option('--site <id>', '强制指定站点适配器（wenku8 | tadu）')
  .option('-o, --out <dir>', '输出目录', DEFAULT_OUT)
  .option('--split <mode>', 'full（整本）或 volume（每卷一个）', 'full')
  .option('--volumes <range>', '只处理部分卷，如 1-3,5')
  .option('--illus-position <pos>', 'start | end | keep', 'start')
  .option('--no-images', '不下载图片（调试）')
  .option('--image-quality <n>', 'JPEG 质量 1-100', (v) => Number.parseInt(v, 10))
  .option('--max-image-width <px>', '图片最大宽度', (v) => Number.parseInt(v, 10))
  .option('--delay <ms>', '请求间隔基数', (v) => Number.parseInt(v, 10), 1500)
  .option('--concurrency <n>', '章节并发（最大 2）', (v) => Math.min(2, Number.parseInt(v, 10)), 1)
  .option('--limit-chapters <n>', '只抓取前 n 章（集成测试/探测）', (v) => Number.parseInt(v, 10))
  .option('--include-placeholders', '为受限/失败章节写入占位章')
  .option('--strict', '内容可疑或失败时以非零码结束')
  .option('--refresh', '忽略章节缓存')
  .option('--headful', '显示浏览器窗口（wenku8 过 Cloudflare）')
  .option('--acknowledge-permission', '确认已取得需要书面许可站点的授权')
  .option('--experimental-auto', '（实验）未知站点自动探测')
  .option('--accept-detected', '（实验）接受自动探测结果并抓取')
  .action(async (urlOrId: string, opts) => {
    if (opts.experimentalAuto || opts.acceptDetected) {
      throw new Error(
        '未知站点启发式探测尚未实现（计划中的 M6），当前仅支持已注册站点。',
      );
    }

    const illus = opts.illusPosition as IllusPosition;
    if (!['start', 'end', 'keep'].includes(illus)) {
      throw new Error('--illus-position 必须是 start、end 或 keep');
    }
    const split = opts.split as 'full' | 'volume';
    if (split !== 'full' && split !== 'volume') {
      throw new Error('--split 必须是 full 或 volume');
    }

    const { adapter, notice } = selectAdapter(
      urlOrId,
      defaultAdapters(),
      opts.site,
    );
    if (notice) {
      console.warn(`提示：${notice}`);
    }
    assertAdapterAllowed(adapter, opts.acknowledgePermission === true);

    /** wenku8 需要浏览器过 Cloudflare；其他站点默认无头 */
    const defaultHeadless = adapter.id !== 'wenku8';

    await runConvert(
      urlOrId,
      adapter,
      {
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
        headless: opts.headful === true ? false : defaultHeadless,
        includePlaceholders: opts.includePlaceholders === true,
        strict: opts.strict === true,
        limitChapters: opts.limitChapters,
      },
      CACHE_DIR,
    );
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
