#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { Command } from 'commander';
import type { IllusPosition } from './types.js';
import {
  assertAdapterAllowed,
  defaultAdapters,
  experimentalAdapters,
  selectAdapter,
} from './registry.js';
import { runConvert } from './orchestrator.js';
import { runInspect } from './sites/generic/run-inspect.js';
import type { InspectionReport } from './sites/generic/index.js';
import { scaffoldAdapter } from './scaffold.js';

const CACHE_DIR = path.resolve('.cache');
const DEFAULT_OUT = path.resolve('output');

const program = new Command();

// 关闭「父命令选项吞掉子命令同名选项」的行为，使 inspect/scaffold-adapter 的 --out 生效
program.enablePositionalOptions();

program
  .name('book2epub')
  .description('将受支持站点的公开小说页面转为 EPUB（多站点适配器架构）')
  .argument('[urlOrId]', '目录页/书籍页 URL，或（配 --site）纯书号')
  .option('--site <id>', '强制指定站点适配器（wenku8 | tadu | generic）')
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
  .option('--headful', '显示浏览器窗口（wenku8 过 Cloudflare / 排查渲染）')
  .option('--acknowledge-permission', '确认已取得需要书面许可站点的授权')
  .option('--experimental-auto', '（实验）未知站点启发式探测；默认只做 dry-run 诊断')
  .option('--accept-detected', '（实验）接受探测结果并抓取（首版最多 3 章）')
  .action(async (urlOrId: string | undefined, opts) => {
    if (!urlOrId) {
      throw new Error('缺少输入：请提供目录页/书籍页 URL，或配 --site 的书号。');
    }

    const experimental =
      opts.experimentalAuto === true || opts.acceptDetected === true;
    const adapters = experimental ? experimentalAdapters() : defaultAdapters();
    const { adapter, notice } = selectAdapter(urlOrId, adapters, opts.site);
    if (notice) {
      console.warn(`提示：${notice}`);
    }
    assertAdapterAllowed(adapter, opts.acknowledgePermission === true);

    // 仅 --experimental-auto：只输出诊断，不抓取
    if (experimental && opts.acceptDetected !== true) {
      const report = await runInspect(urlOrId, {
        out: path.resolve(opts.out),
        cacheRoot: CACHE_DIR,
        headless: opts.headful !== true,
      });
      if (!report.accepted) {
        process.exitCode = 1;
      }
      return;
    }

    const illus = opts.illusPosition as IllusPosition;
    if (!['start', 'end', 'keep'].includes(illus)) {
      throw new Error('--illus-position 必须是 start、end 或 keep');
    }
    const split = opts.split as 'full' | 'volume';
    if (split !== 'full' && split !== 'volume') {
      throw new Error('--split 必须是 full 或 volume');
    }

    /** wenku8 需要浏览器过 Cloudflare；其他站点默认无头 */
    const defaultHeadless = adapter.id !== 'wenku8';
    const limitChapters =
      opts.acceptDetected === true
        ? (opts.limitChapters ?? 3)
        : opts.limitChapters;

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
        limitChapters,
      },
      CACHE_DIR,
    );
  });

program
  .command('inspect')
  .description('只读探测一个 URL 的结构并输出诊断（不保存正文）')
  .argument('<url>', '入口 URL')
  .option('-o, --out <dir>', '诊断输出目录', DEFAULT_OUT)
  .option('--headful', '显示浏览器窗口（排查渲染）')
  .action(async (url: string, opts) => {
    const report = await runInspect(url, {
      out: path.resolve(opts.out),
      cacheRoot: CACHE_DIR,
      headless: opts.headful !== true,
    });
    if (!report.accepted) {
      process.exitCode = 1;
    }
  });

program
  .command('scaffold-adapter')
  .description('依据 inspect 诊断生成站点适配器脚手架')
  .argument('<siteId>', '站点 id，如 example')
  .option('--from <file>', 'inspection.json 路径', path.resolve('output/inspection.json'))
  .option('--out <dir>', '脚手架输出目录', path.resolve('scaffold'))
  .action(async (siteId: string, opts) => {
    const raw = await fs.readFile(path.resolve(opts.from), 'utf8');
    const inspection = JSON.parse(raw) as InspectionReport;
    const result = await scaffoldAdapter(siteId, inspection, path.resolve(opts.out));
    console.log(`已生成 ${result.files.length} 个文件到 ${result.dir}`);
    for (const f of result.files) {
      console.log(`  - ${f}`);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
