import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { isSafeHttpUrl } from '../../net/safe-url.js';

/**
 * 章节链接的文本特征。用于给「像章节的链接簇」打分。
 * 故意保持保守：只有明确带「第…章/卷/话」或 Chapter N 等的链接才算。
 */
export const CHAPTER_TEXT_RE =
  /(第\s*[0-9０-９一二三四五六七八九十百千零两]+\s*[章节回卷话篇]|序章|楔子|终章|尾声|后记|插图|番外|chapter\s*[0-9ivxlc]+|^\s*[0-9]+\s*[.、．])/i;

/** 访问遮挡/风控提示（保守句式，避免误伤正文中的"登录"二字） */
const WALL_TEXT_PATTERNS: RegExp[] = [
  /请先登录/,
  /登录后(才)?(可)?(以)?(阅读|查看|继续)/,
  /开通(会员|VIP)/i,
  /订阅后(才)?(可|能)/,
  /扫码(下载|登录)/,
  /请输入验证码/,
];

/** 常见访问遮挡容器 */
const WALL_SELECTORS = [
  '.shelter',
  '.login-mask',
  '.pay-mask',
  '.vip-mask',
  '#loginDialog',
  '#login-dialog',
];

export interface LinkSample {
  url: string;
  title: string;
}

export interface LinkCluster {
  /** 归一化路径模式：数字段替换为 :n */
  pattern: string;
  origin: string;
  count: number;
  /** 链接文本命中章节特征的占比 */
  chapterTextRatio: number;
  /** 末段为纯数字的链接占比 */
  numericRatio: number;
  /** 是否全部与入口页同源 */
  allSameOrigin: boolean;
  /** 该簇的全部链接（按文档顺序） */
  links: LinkSample[];
  score: number;
}

export interface CatalogueInspection {
  url: string;
  title?: string;
  author?: string;
  intro?: string;
  coverCandidates: string[];
  clusters: LinkCluster[];
  blocked: boolean;
  blockedReason?: string;
  warnings: string[];
}

export interface ContentCandidate {
  selector: string;
  chars: number;
  paragraphCount: number;
  linkDensity: number;
  score: number;
}

export interface ContentInspection {
  candidates: ContentCandidate[];
  best?: ContentCandidate;
}

export interface CatalogueVerdict {
  ok: boolean;
  reason?: string;
  bestCluster?: LinkCluster;
}

/**
 * 压缩连续空白
 * @param s - 原始字符串
 */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 返回第一个非空候选（`??` 无法跳过空字符串，故单独封装）
 * @param values - 候选值
 */
function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim()) {
      return value;
    }
  }
  return undefined;
}

/**
 * 将相对链接解析为绝对 URL
 * @param href - 原始 href
 * @param base - 基准 URL
 */
function toAbsolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * 归一化路径模式，把数字段替换为 :n，便于把同构章节链接聚成一簇
 * @param url - 绝对 URL
 */
export function pathPattern(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\d+/g, ':n').replace(/\/+$/, '');
  return `${u.origin}${path}`;
}

/**
 * 从 JSON-LD 中提取第一个 Book/Novel 对象
 * @param $ - cheerio 实例
 */
function findBookJsonLd($: CheerioAPI): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  const consider = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        consider(item);
      }
      return;
    }
    const obj = node as Record<string, unknown>;
    const type = obj['@type'];
    const types = Array.isArray(type) ? type.map(String) : [String(type ?? '')];
    if (types.some((t) => /book|novel/i.test(t))) {
      found = obj;
      return;
    }
    if (obj['@graph']) {
      consider(obj['@graph']);
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) {
      return;
    }
    try {
      consider(JSON.parse($(el).contents().text()));
    } catch {
      // 忽略无法解析的 JSON-LD
    }
  });
  return found;
}

/**
 * 从 JSON-LD 的 author 字段提取作者名
 * @param book - JSON-LD Book 对象
 */
function jsonLdAuthor(book: Record<string, unknown> | null): string | undefined {
  if (!book) {
    return undefined;
  }
  const author = book.author;
  if (typeof author === 'string') {
    return collapse(author);
  }
  if (Array.isArray(author) && author.length > 0) {
    const first = author[0];
    if (typeof first === 'string') {
      return collapse(first);
    }
    if (first && typeof first === 'object' && 'name' in first) {
      return collapse(String((first as { name?: unknown }).name ?? ''));
    }
  }
  if (author && typeof author === 'object' && 'name' in author) {
    return collapse(String((author as { name?: unknown }).name ?? ''));
  }
  return undefined;
}

/**
 * 从 JSON-LD 的 image 字段提取封面
 * @param book - JSON-LD Book 对象
 */
function jsonLdImage(book: Record<string, unknown> | null): string | undefined {
  if (!book) {
    return undefined;
  }
  const image = book.image;
  if (typeof image === 'string') {
    return image;
  }
  if (Array.isArray(image) && typeof image[0] === 'string') {
    return image[0];
  }
  if (image && typeof image === 'object' && 'url' in image) {
    return String((image as { url?: unknown }).url ?? '');
  }
  return undefined;
}

/**
 * 把页面上的同源链接按路径模式聚簇
 * @param $ - cheerio 实例
 * @param pageUrl - 入口页 URL
 */
export function collectLinkClusters(
  $: CheerioAPI,
  pageUrl: string,
): LinkCluster[] {
  const pageOrigin = new URL(pageUrl).origin;
  interface Group {
    pattern: string;
    origin: string;
    links: LinkSample[];
    chapterish: number;
    numeric: number;
    foreign: number;
  }
  const groups = new Map<string, Group>();

  $('a[href]').each((_, el) => {
    const raw = ($(el).attr('href') ?? '').trim();
    if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) {
      return;
    }
    const absolute = toAbsolute(raw, pageUrl);
    if (!absolute || !isSafeHttpUrl(absolute)) {
      return;
    }
    const title = collapse($(el).text());
    if (!title) {
      return;
    }
    const u = new URL(absolute);
    const pattern = pathPattern(absolute);
    let group = groups.get(pattern);
    if (!group) {
      group = {
        pattern,
        origin: u.origin,
        links: [],
        chapterish: 0,
        numeric: 0,
        foreign: 0,
      };
      groups.set(pattern, group);
    }
    group.links.push({ url: absolute, title });
    if (CHAPTER_TEXT_RE.test(title)) {
      group.chapterish++;
    }
    const lastSeg = u.pathname.split('/').filter(Boolean).pop() ?? '';
    if (/^\d+$/.test(lastSeg)) {
      group.numeric++;
    }
    if (u.origin !== pageOrigin) {
      group.foreign++;
    }
  });

  const clusters: LinkCluster[] = [];
  for (const group of groups.values()) {
    if (group.links.length < 2) {
      continue;
    }
    const count = group.links.length;
    const chapterTextRatio = group.chapterish / count;
    const numericRatio = group.numeric / count;
    const allSameOrigin = group.foreign === 0;
    const patternBonus = group.pattern.includes(':n') ? 10 : 0;
    const score =
      Math.min(count, 60) * 0.5 +
      chapterTextRatio * 50 +
      numericRatio * 20 +
      patternBonus;
    clusters.push({
      pattern: group.pattern,
      origin: group.origin,
      count,
      chapterTextRatio,
      numericRatio,
      allSameOrigin,
      links: group.links,
      score,
    });
  }
  clusters.sort((a, b) => b.score - a.score);
  return clusters;
}

/**
 * 判断一段可见文本是否命中访问遮挡/风控提示
 * @param text - 可见文本
 */
export function detectBlockedText(text: string): string | null {
  for (const re of WALL_TEXT_PATTERNS) {
    if (re.test(text)) {
      return `页面提示命中 ${re}`;
    }
  }
  return null;
}

/**
 * 判定页面是否出现访问遮挡/风控提示
 * @param $ - cheerio 实例
 */
export function detectWall($: CheerioAPI): { blocked: boolean; reason?: string } {
  for (const sel of WALL_SELECTORS) {
    if ($(sel).length > 0) {
      return { blocked: true, reason: `存在遮挡容器 ${sel}` };
    }
  }
  const reason = detectBlockedText($('body').text());
  return reason ? { blocked: true, reason } : { blocked: false };
}

/**
 * 静态度量目录页：书名、元数据、封面、章节链接簇、遮挡提示（纯函数）
 * @param html - 页面 HTML
 * @param pageUrl - 页面 URL
 */
export function inspectCatalogue(
  html: string,
  pageUrl: string,
): CatalogueInspection {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const jsonLd = findBookJsonLd($);

  const metaContent = (property: string): string | undefined => {
    const v = $(`meta[property="${property}"], meta[name="${property}"]`)
      .first()
      .attr('content');
    return v ? collapse(v) : undefined;
  };

  const title = firstNonEmpty(
    metaContent('og:title'),
    metaContent('og:novel:book_name'),
    jsonLd && typeof jsonLd.name === 'string' ? collapse(jsonLd.name) : undefined,
    collapse($('h1').first().text()),
    collapse($('title').first().text()),
  );
  const author = firstNonEmpty(
    metaContent('og:novel:author'),
    metaContent('author'),
    jsonLdAuthor(jsonLd),
  );
  const intro = firstNonEmpty(
    metaContent('og:description'),
    metaContent('description'),
    jsonLd && typeof jsonLd.description === 'string'
      ? collapse(jsonLd.description)
      : undefined,
  );

  const rawCovers = [
    metaContent('og:image'),
    jsonLdImage(jsonLd),
    $('link[rel="image_src"]').first().attr('href'),
    $('img[data-src]').first().attr('data-src'),
  ];
  const coverCandidates: string[] = [];
  for (const raw of rawCovers) {
    if (!raw) {
      continue;
    }
    const absolute = toAbsolute(raw, pageUrl);
    if (absolute && isSafeHttpUrl(absolute) && !coverCandidates.includes(absolute)) {
      coverCandidates.push(absolute);
    }
  }

  const clusters = collectLinkClusters($, pageUrl);
  const wall = detectWall($);

  if (!title) {
    warnings.push('未识别到书名候选');
  }
  if (clusters.length === 0) {
    warnings.push('未在静态 HTML 中找到重复的同源链接簇（可能需要浏览器渲染）');
  }

  return {
    url: pageUrl,
    title: title || undefined,
    author: author || undefined,
    intro: intro || undefined,
    coverCandidates,
    clusters,
    blocked: wall.blocked,
    blockedReason: wall.reason,
    warnings,
  };
}

/**
 * 依据置信度门槛判定目录页是否可自动接受（见计划 §6.2）
 * @param inspection - 目录页探测结果
 */
export function evaluateCatalogue(
  inspection: CatalogueInspection,
): CatalogueVerdict {
  if (inspection.blocked) {
    return {
      ok: false,
      reason: `检测到访问遮挡/风控提示：${inspection.blockedReason ?? ''}`,
    };
  }
  if (!inspection.title) {
    return { ok: false, reason: '未识别到书名' };
  }
  const best = inspection.clusters[0];
  if (!best) {
    return { ok: false, reason: '未找到重复的章节链接簇' };
  }
  if (best.count < 2) {
    return { ok: false, reason: '章节链接少于 2 条' };
  }
  if (best.chapterTextRatio < 0.5) {
    return {
      ok: false,
      reason: `链接文本命中章节特征的占比过低（${(best.chapterTextRatio * 100).toFixed(0)}%）`,
    };
  }
  if (!best.allSameOrigin) {
    return { ok: false, reason: '章节链接包含跨域链接' };
  }
  return { ok: true, bestCluster: best };
}

/** 评分用的正文候选选择器（按优先级） */
export const CONTENT_SELECTORS = [
  'article',
  'main',
  '#chapterContent',
  '#content',
  '#partContent',
  '.chapter-content',
  '.read-content',
  '.article-content',
  '.content',
  '[class*="chapter"]',
  '[class*="read"]',
  '[class*="article"]',
  '[class*="content"]',
  'body',
];

/**
 * 给正文容器候选打分：文本越长、段落越多、链接密度越低越好（纯函数）
 * @param html - 章节页 HTML（可为渲染后 DOM）
 */
export function scoreContentCandidates(html: string): ContentInspection {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, form, nav, aside, footer, header, iframe').remove();

  const candidates: ContentCandidate[] = [];
  const seen = new Set<string>();
  for (const selector of CONTENT_SELECTORS) {
    if (seen.has(selector)) {
      continue;
    }
    seen.add(selector);
    const el = $(selector).first();
    if (el.length === 0) {
      continue;
    }
    const text = collapse(el.text());
    const chars = text.length;
    if (chars < 40) {
      continue;
    }
    const paragraphCount = el.find('p').length;
    let linkChars = 0;
    el.find('a').each((_, a) => {
      linkChars += collapse($(a).text()).length;
    });
    const linkDensity = Math.min(1, linkChars / chars);
    const score =
      (Math.min(chars, 4000) / 4000) * 50 +
      Math.min(paragraphCount, 40) * 0.8 +
      (1 - linkDensity) * 30;
    candidates.push({
      selector,
      chars,
      paragraphCount,
      linkDensity,
      score,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return { candidates, best: candidates[0] };
}

/**
 * 向下收缩正文容器（子节点覆盖 ≥85% 文本时改选子节点）
 * @param html - 章节页 HTML
 * @param selector - 初始选择器
 */
export function shrinkContentRoot(html: string, selector: string): string {
  const $ = cheerio.load(html);
  let el = $(selector).first();
  if (el.length === 0) {
    return selector;
  }
  const textLen = (): number => collapse(el.text()).length;
  for (let depth = 0; depth < 12; depth++) {
    let best: ReturnType<typeof $> | null = null;
    let bestLen = 0;
    const parentLen = textLen();
    el.children().each((_, child) => {
      const c = $(child);
      const len = collapse(c.text()).length;
      if (parentLen > 0 && len / parentLen >= 0.85 && len > bestLen) {
        best = c;
        bestLen = len;
      }
    });
    if (!best) {
      break;
    }
    el = best;
  }
  const id = el.attr('id');
  if (id) {
    return `#${id}`;
  }
  return selector;
}
