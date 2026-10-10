import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { runConvert, type RunOptions } from '../orchestrator.js';
import type { SiteAdapter } from '../site.js';

/**
 * 从 EPUB 的 content.opf 读取 dc:source
 * @param epubPath - EPUB 路径
 */
export async function readSourceFromEpub(epubPath: string): Promise<string | null> {
  const buf = await fs.readFile(epubPath);
  const zip = await JSZip.loadAsync(buf);
  const opf = await zip.file('OEBPS/content.opf')?.async('string');
  if (!opf) {
    return null;
  }
  const m = opf.match(/<dc:source[^>]*>([^<]+)<\/dc:source>/i);
  return m?.[1]?.trim() ?? null;
}

/**
 * 增量更新：只抓缓存中缺失的章节
 * @param input - URL 或 EPUB 路径
 * @param adapter - 适配器
 * @param options - 运行选项
 * @param cacheRoot - 缓存根
 */
export async function runUpdate(
  input: string,
  adapter: SiteAdapter,
  options: RunOptions,
  cacheRoot: string,
): Promise<number> {
  let url = input;
  if (input.toLowerCase().endsWith('.epub')) {
    const source = await readSourceFromEpub(input);
    if (!source) {
      throw new Error('EPUB 中未找到 dc:source，无法增量更新');
    }
    url = source;
  }
  return runConvert(url, adapter, { ...options, refresh: false, onlyMissing: true }, cacheRoot);
}
