import type { SiteRule } from '../rules/schema.js';
import { probeGeneric, type ProbeTransport } from './probe.js';
import { shrinkContentRoot } from './inspect.js';

/**
 * 启发式探测并产出 SiteRule
 * @param url - 入口 URL
 * @param transport - 传输
 */
export async function learnSiteRule(
  url: string,
  transport: ProbeTransport,
): Promise<SiteRule> {
  const host = new URL(url).hostname;
  const { report, contentSelector } = await probeGeneric(url, transport, {
    site: host,
    sampleChapter: true,
  });
  if (!report.accepted || !contentSelector) {
    throw new Error(report.reason ?? '探测未达门槛，无法生成规则');
  }
  let selector = contentSelector;
  if (report.sample?.url) {
    const sampleHtml = await transport.render(report.sample.url);
    selector = shrinkContentRoot(sampleHtml, contentSelector);
  }
  const best = report.catalogue[0];
  const chapterSel = best?.pattern
    ? `a[href*="${best.pattern.split(':')[0]}"]`
    : 'a[href*="chapter"], .chapter-list a';
  return {
    id: `learned-${host.replace(/\./g, '-')}`,
    name: `学习规则：${host}`,
    version: '1.0.0',
    match: { hosts: [host] },
    charset: 'auto',
    fetch: { catalogue: 'http', chapter: 'http' },
    book: {
      title: { meta: 'og:title' },
      author: { meta: 'og:novel:author' },
      cover: { meta: 'og:image' },
    },
    catalogue: {
      chapter: '.chapter-list a, a[href*="/book/"]',
    },
    chapter: {
      content: selector,
      remove: ['nav', 'footer', 'header', 'aside', 'script', 'style'],
      paragraphMode: 'auto',
    },
  };
}
