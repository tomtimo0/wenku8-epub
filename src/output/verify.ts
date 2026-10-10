import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

export interface VerifyResult {
  ok: boolean;
  errors: string[];
}

/**
 * 重新打开 EPUB zip 做结构自检
 * @param buffer - EPUB 二进制
 */
export async function verifyEpubBuffer(buffer: Buffer): Promise<VerifyResult> {
  const errors: string[] = [];
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  if (!zip.files.mimetype) {
    errors.push('缺少 mimetype 条目');
  }
  const mime = zip.file('mimetype');
  if (!mime) {
    errors.push('缺少 mimetype');
  } else {
    const text = await mime.async('string');
    if (text !== 'application/epub+zip') {
      errors.push('mimetype 内容不正确');
    }
  }
  const container = zip.file('META-INF/container.xml');
  if (!container) {
    errors.push('缺少 META-INF/container.xml');
  }
  const opf = zip.file('OEBPS/content.opf');
  if (!opf) {
    errors.push('缺少 OEBPS/content.opf');
  } else {
    const opfText = await opf.async('string');
    const hrefs = [...opfText.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      if (href.startsWith('http')) {
        continue;
      }
      const p = href.startsWith('OEBPS/') ? href : `OEBPS/${href}`;
      if (!zip.file(p) && !zip.file(href)) {
        errors.push(`manifest 引用缺失文件: ${href}`);
      }
    }
    for (const m of opfText.matchAll(/idref="([^"]+)"/g)) {
      const id = m[1];
      if (!opfText.includes(`id="${id}"`)) {
        errors.push(`spine idref 未在 manifest 中找到: ${id}`);
      }
    }
  }
  for (const name of names) {
    if (name.endsWith('.xhtml') || name.endsWith('.html')) {
      const xml = await zip.file(name)!.async('string');
      if (!xml.includes('<?xml')) {
        errors.push(`${name} 不是合法 XHTML`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 结构自检；若设置了 EPUBCHECK_JAR 且内置自检通过，再运行 epubcheck
 * @param buffer - EPUB 二进制
 */
export async function verifyEpubBufferWithEpubcheck(buffer: Buffer): Promise<VerifyResult> {
  const base = await verifyEpubBuffer(buffer);
  const errors = [...base.errors];
  const jar = process.env.EPUBCHECK_JAR?.trim();
  if (!jar || !base.ok) {
    return { ok: errors.length === 0, errors };
  }
  const tmp = path.join(os.tmpdir(), `book2epub-verify-${Date.now()}.epub`);
  try {
    await fs.writeFile(tmp, buffer);
    const run = spawnSync('java', ['-jar', jar, tmp], {
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
    });
    if (run.error) {
      errors.push(`epubcheck 无法启动：${run.error.message}`);
    } else if (run.status !== 0) {
      const detail = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().slice(0, 4000);
      errors.push(`epubcheck 报告错误：${detail || `退出码 ${run.status}`}`);
    }
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
  return { ok: errors.length === 0, errors };
}
