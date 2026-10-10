import * as cheerio from 'cheerio';
import type { ValueSpec } from './schema.js';

/**
 * 按 ValueSpec 从 HTML 提取字符串
 * @param html - 页面 HTML
 * @param spec - 取值规则
 * @param baseUrl - 用于补全相对 URL
 */
export function extractValue(
  html: string,
  spec: ValueSpec,
  baseUrl: string,
): string | undefined {
  const $ = cheerio.load(html);
  if (typeof spec === 'string') {
    const t = $(spec).first().text().trim();
    return t || undefined;
  }
  if (spec.meta) {
    const v =
      $(`meta[property="${spec.meta}"]`).attr('content') ??
      $(`meta[name="${spec.meta}"]`).attr('content');
    return v?.trim() || undefined;
  }
  if (!spec.selector) {
    return undefined;
  }
  const el = $(spec.selector).first();
  let raw = spec.attr ? el.attr(spec.attr) : el.text();
  if (!raw && spec.attr === 'content') {
    raw = el.attr('content');
  }
  if (!raw) {
    return undefined;
  }
  raw = raw.trim();
  if (spec.regex) {
    const m = new RegExp(spec.regex).exec(raw);
    if (!m) {
      return undefined;
    }
    raw = m[1] ?? m[0];
  }
  if (spec.join && spec.attr) {
    raw = $(spec.selector)
      .map((_, e) => $(e).attr(spec.attr!) ?? '')
      .get()
      .filter(Boolean)
      .join(spec.join);
  }
  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }
  if (raw.startsWith('/')) {
    return new URL(raw, baseUrl).href;
  }
  return raw;
}
