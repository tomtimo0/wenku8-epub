#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { Command } from 'commander';
import type { IllusPosition } from './types.js';
import { allAdapters, selectAdapter } from './registry.js';
import { runConvert } from './orchestrator.js';
import { runInspect } from './sites/generic/run-inspect.js';
import type { InspectionReport } from './sites/generic/index.js';
import { scaffoldAdapter } from './scaffold.js';
import { runLogin } from './commands/login.js';
import { runDoctor } from './commands/doctor.js';
import { runRulesList, runRulesValidate } from './commands/rules.js';
import { runLearn } from './commands/learn.js';
import { runUpdate } from './commands/update.js';
import { loadConfig } from './config.js';

const CACHE_DIR = path.resolve('.cache');
const DEFAULT_OUT = path.resolve('output');

const program = new Command();

program.enablePositionalOptions();

program
  .name('book2epub')
  .description('将受支持站点的公开小说页面转为 EPUB（多站点适配器架构）')
  .argument('[urlOrId]', '目录页/书籍页 URL，或（配 --site）纯书号')
  .option('--site <id>', '强制指定站点适配器')
  .option('--rule <file>', '使用指定声明式规则 JSON')
  .option('-o, --out <dir>', '输出目录', DEFAULT_OUT)
  .option('--format <fmt>', 'epub | txt | both', 'epub')
  .option('--txt-crlf', 'TXT 使用 CRLF 换行')
  .option('--verify-epub', '写出 EPUB 后做结构自检')
  .option('--split <mode>', 'full（整本）或 volume（每卷一个）', 'full')
  .option('--volumes <range>', '只处理部分卷，如 1-3,5')
  .option('--illus-position <pos>', 'start | end | keep', 'start')
  .option('--no-images', '不下载图片（调试）')
  .option('--image-quality <n>', 'JPEG 质量 1-100', (v) => Number.parseInt(v, 10))
  .option('--max-image-width <px>', '图片最大宽度', (v) => Number.parseInt(v, 10))
  .option('--delay <ms>', '请求间隔基数', (v) => Number.parseInt(v, 10), 1500)
  .option('--concurrency <n>', '章节并发（受适配器上限约束）', (v) =>
    Number.parseInt(v, 10),
  )
  .option('--limit-chapters <n>', '只抓取前 n 章（集成测试/探测）', (v) => Number.parseInt(v, 10))
  .option('--include-placeholders', '为受限/失败章节写入占位章')
  .option('--strict', '内容可疑或失败时以非零码结束')
  .option('--refresh', '忽略章节缓存')
  .option('--headful', '显示浏览器窗口（wenku8 过 Cloudflare / 排查渲染）')
  .option('--experimental-auto', '（实验）未知站点启发式探测；默认只做 dry-run 诊断')
  .option('--accept-detected', '（实验，已弃用别名）接受探测并抓取')
  .option('--no-auto', '关闭无匹配时自动启用启发式')
  .option('--dry-run', '只探测不抓取（与 --experimental-auto 联用）')
  .action(async (urlOrId: string | undefined, opts) => {
    if (!urlOrId) {
      throw new Error('缺少输入：请提供目录页/书籍页 URL，或配 --site 的书号。');
    }

    if (opts.acceptDetected === true) {
      console.warn('提示：--accept-detected 已弃用，请直接使用默认转换流程或 --experimental-auto。');
    }

    const config = await loadConfig();
    const experimental =
      opts.experimentalAuto === true || opts.acceptDetected === true;

    let adapters = await allAdapters({
      cacheRoot: CACHE_DIR,
      experimental,
      ruleFile: opts.rule,
    });

    let selection;
    try {
      selection = selectAdapter(urlOrId, adapters, opts.site);
    } catch (e) {
      if (opts.noAuto === true) {
        throw e;
      }
      adapters = await allAdapters({
        cacheRoot: CACHE_DIR,
        experimental: true,
        ruleFile: opts.rule,
      });
      selection = selectAdapter(urlOrId, adapters, opts.site);
      console.warn('提示：无内置适配器匹配，已自动启用启发式探测。');
    }
    const { adapter, notice } = selection;
    if (notice) {
      console.warn(`提示：${notice}`);
    }

    const dryOnly =
      (opts.experimentalAuto === true || opts.dryRun === true) &&
      opts.acceptDetected !== true &&
      adapter.id === 'generic';

    if (dryOnly) {
      const report = await runInspect(urlOrId, {
        out: path.resolve(opts.out ?? config.out ?? DEFAULT_OUT),
        cacheRoot: CACHE_DIR,
        headless: opts.headful !== true,
      });
      if (!report.accepted) {
        process.exitCode = 1;
      }
      return;
    }

    const illus = (opts.illusPosition as IllusPosition) ?? 'start';
    if (!['start', 'end', 'keep'].includes(illus)) {
      throw new Error('--illus-position 必须是 start、end 或 keep');
    }
    const split = opts.split as 'full' | 'volume';
    if (split !== 'full' && split !== 'volume') {
      throw new Error('--split 必须是 full 或 volume');
    }

    const defaultHeadless = adapter.id !== 'wenku8';
    const concurrency = Math.min(
      adapter.capabilities.maxConcurrency,
      Math.max(1, opts.concurrency ?? 1),
    );

    const format = (opts.format ?? config.format ?? 'epub') as 'epub' | 'txt' | 'both';

    const exitCode = await runConvert(
      urlOrId,
      adapter,
      {
        out: path.resolve(opts.out ?? config.out ?? DEFAULT_OUT),
        split,
        volumes: opts.volumes,
        illusPosition: illus,
        noImages: opts.images === false,
        imageQuality: opts.imageQuality ?? config.imageQuality,
        maxImageWidth: opts.maxImageWidth ?? config.maxImageWidth,
        delay: opts.delay ?? config.delay ?? 1500,
        concurrency,
        refresh: opts.refresh === true,
        headless: opts.headful === true ? false : (config.headless ?? defaultHeadless),
        includePlaceholders: opts.includePlaceholders === true,
        strict: opts.strict === true,
        limitChapters: opts.limitChapters,
        format,
        txtCrlf: opts.txtCrlf === true,
        verifyEpub: opts.verifyEpub === true,
      },
      CACHE_DIR,
    );
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });

program
  .command('login')
  .description('有头打开站点，人工登录后保存浏览器会话')
  .argument('<siteOrUrl>', '站点 id（tadu | wenku8）或站点 URL')
  .action(async (siteOrUrl: string) => {
    await runLogin(siteOrUrl, CACHE_DIR);
  });

program
  .command('doctor')
  .description('检查 Node、sharp、浏览器等运行环境')
  .action(async () => {
    const report = await runDoctor();
    for (const line of report.lines) {
      console.log(line);
    }
    if (!report.ok) {
      process.exitCode = 1;
    }
  });

program
  .command('learn')
  .description('探测 URL 并保存声明式规则')
  .argument('<url>', '入口 URL')
  .option('--out <file>', '规则输出路径')
  .option('--headful', '显示浏览器')
  .action(async (url: string, opts) => {
    await runLearn(url, {
      out: opts.out,
      cacheRoot: CACHE_DIR,
      headless: opts.headful !== true,
    });
  });

program
  .command('update')
  .description('增量更新：只抓取缓存中缺失的章节')
  .argument('<urlOrEpub>', '来源 URL 或已有 EPUB')
  .option('--site <id>', '强制站点')
  .option('-o, --out <dir>', '输出目录', DEFAULT_OUT)
  .action(async (input: string, opts) => {
    const adapters = await allAdapters({ cacheRoot: CACHE_DIR });
    const { adapter } = selectAdapter(input, adapters, opts.site);
    const code = await runUpdate(
      input,
      adapter,
      {
        out: path.resolve(opts.out),
        split: 'full',
        illusPosition: 'start',
        noImages: false,
        delay: 1500,
        concurrency: 1,
        refresh: false,
        headless: adapter.id !== 'wenku8',
        includePlaceholders: false,
        strict: false,
        onlyMissing: true,
        format: 'epub',
      },
      CACHE_DIR,
    );
    if (code !== 0) {
      process.exitCode = code;
    }
  });

const rules = program.command('rules').description('声明式规则管理');

rules
  .command('list')
  .description('列出全部规则')
  .action(async () => {
    await runRulesList(CACHE_DIR);
  });

rules
  .command('validate')
  .description('校验规则 JSON')
  .argument('<file>', '规则文件')
  .action(async (file: string) => {
    const code = await runRulesValidate(file);
    process.exitCode = code;
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
