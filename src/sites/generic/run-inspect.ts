import path from 'node:path';
import fs from 'node:fs/promises';
import { HttpTransport } from '../../transports/http.js';
import { BrowserTransport } from '../../transports/browser.js';
import {
  ContentCache,
  browserProfileDir,
} from '../../transports/cache.js';
import { isSafeHttpUrl } from '../../net/safe-url.js';
import { probeGeneric, type InspectionReport } from './probe.js';

export interface RunInspectOptions {
  /** 诊断 JSON 输出目录 */
  out: string;
  /** 缓存根目录 */
  cacheRoot: string;
  headless: boolean;
}

/**
 * 只读探测一个 URL，输出结构化诊断（不保存正文），供 `book2epub inspect` 使用。
 * @param input - 入口 URL
 * @param options - 运行选项
 */
export async function runInspect(
  input: string,
  options: RunInspectOptions,
): Promise<InspectionReport> {
  const url = new URL(input.trim()).href;
  if (!isSafeHttpUrl(url)) {
    throw new Error(`拒绝探测不安全或非 http(s) 的地址: ${url}`);
  }

  const cache = new ContentCache(options.cacheRoot);
  const http = new HttpTransport({ minIntervalMs: 1200 });
  const browser = new BrowserTransport({
    profileDir: cache.pathFor(browserProfileDir('generic')),
    headless: options.headless,
  });
  await browser.start();

  try {
    const { report } = await probeGeneric(
      url,
      {
        fetchText: async (target) => {
          const res = await http.get(target, { charset: 'utf-8' });
          return { status: res.status, text: res.text };
        },
        render: (target) => browser.renderHtml(target),
      },
      { site: 'generic' },
    );

    await fs.mkdir(options.out, { recursive: true });
    const outPath = path.join(options.out, 'inspection.json');
    await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
    printReport(report, outPath);
    return report;
  } finally {
    await browser.close();
  }
}

/**
 * 打印探测报告
 * @param report - 探测报告
 * @param outPath - 诊断 JSON 路径
 */
export function printReport(report: InspectionReport, outPath?: string): void {
  console.log(`站点探测：${report.url}`);
  console.log(`书名：${report.title ?? '（未识别）'}`);
  console.log(`作者：${report.author ?? '（未识别）'}`);
  console.log(
    `结果：${report.accepted ? '达到门槛，可抓取' : `未达门槛 — ${report.reason ?? '未知原因'}`}`,
  );
  console.log(`章节链接簇 ${report.catalogue.length} 个：`);
  for (const c of report.catalogue.slice(0, 5)) {
    console.log(
      `  ${c.pattern} ×${c.count}（章节文本占比 ${(c.chapterTextRatio * 100).toFixed(0)}%，分数 ${c.score}）`,
    );
  }
  if (report.sample) {
    console.log(
      `样章：${report.sample.url}｜${report.sample.chars} 字｜${report.sample.paragraphs} 段｜链接密度 ${report.sample.linkDensity}`,
    );
  }
  if (report.warnings.length) {
    console.log('告警：');
    for (const w of report.warnings) {
      console.log(`  - ${w}`);
    }
  }
  if (outPath) {
    console.log(`已写入诊断：${outPath}`);
  }
}
