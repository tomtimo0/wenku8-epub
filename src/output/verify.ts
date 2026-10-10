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
