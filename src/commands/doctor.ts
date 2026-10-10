import { chromium } from 'playwright';

export interface DoctorReport {
  ok: boolean;
  lines: string[];
}

/**
 * 检查本机运行 book2epub 所需的环境
 */
export async function runDoctor(): Promise<DoctorReport> {
  const lines: string[] = [];
  let ok = true;

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (nodeMajor < 20) {
    ok = false;
    lines.push(`Node.js 版本 ${process.versions.node} 过低，需要 ≥ 20`);
  } else {
    lines.push(`Node.js ${process.versions.node} ✓`);
  }

  try {
    const sharpMod = await import('sharp');
    const sharp = sharpMod.default;
    await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    lines.push('sharp 可加载 ✓');
  } catch (e) {
    ok = false;
    lines.push(`sharp 不可用：${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    await chromium.launch({ channel: 'chrome', headless: true });
    lines.push('本机 Chrome（Playwright channel: chrome）可用 ✓');
  } catch {
    try {
      await chromium.launch({ headless: true });
      lines.push('Playwright 自带 Chromium 可用 ✓');
    } catch (e) {
      ok = false;
      lines.push(
        '未检测到可用浏览器：请安装本机 Chrome，或执行 npx playwright install chromium',
      );
      lines.push(`  详情：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const epubcheck = process.env.EPUBCHECK_JAR;
  if (epubcheck) {
    lines.push(`EPUBCHECK_JAR=${epubcheck}`);
  } else {
    lines.push('未设置 EPUBCHECK_JAR（可选，用于 EPUB 结构校验）');
  }

  return { ok, lines };
}
