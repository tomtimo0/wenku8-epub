import * as cheerio from 'cheerio';
import type { Book, Chapter } from '../../types.js';
import { isSafeHttpUrl } from '../../net/safe-url.js';
import {
  detectWall,
  evaluateCatalogue,
  inspectCatalogue,
  scoreContentCandidates,
  type ContentCandidate,
  type LinkSample,
} from './inspect.js';

/** 探测所需的最小传输能力（便于离线单测注入假实现） */
export interface ProbeTransport {
  /** 轻量 HTTP 获取文本（UTF-8） */
  fetchText(url: string): Promise<{ status: number; text: string }>;
  /** 浏览器渲染后返回完整 HTML */
  render(url: string): Promise<string>;
}

export interface ProbeOptions {
  /** 站点 id，写入 Book.source */
  site: string;
  /** 是否抽样打开一章验证正文（默认 true） */
  sampleChapter?: boolean;
}

export interface InspectionReport {
  url: string;
  site: string;
  generatedAt: string;
  /** 是否达到自动接受门槛 */
  accepted: boolean;
  /** 未接受时的原因 */
  reason?: string;
  title?: string;
  author?: string;
  coverCandidates: string[];
  catalogue: Array<{
    pattern: string;
    count: number;
    chapterTextRatio: number;
    numericRatio: number;
    score: number;
    samples: LinkSample[];
  }>;
  contentCandidates: ContentCandidate[];
  sample?: {
    url: string;
    chars: number;
    paragraphs: number;
    linkDensity: number;
  };
  warnings: string[];
}

/** 探测结果：报告 + 达到门槛时构建出的 Book */
export interface ProbeResult {
  report: InspectionReport;
  book?: Book;
  /** 抽样选定的正文选择器，写入章节 locator */
  contentSelector?: string;
}

/** 自动接受门槛：样章最少字符数 */
const SAMPLE_MIN_CHARS = 120;
/** 自动接受门槛：样章最大链接密度 */
const SAMPLE_MAX_LINK_DENSITY = 0.5;

/**
 * 从 URL 推导一个稳定的书号（优先取最长的数字路径段）
 * @param url - 入口 URL
 */
export function deriveBookId(url: string): string {
  const u = new URL(url);
  const nums = u.pathname.match(/\d{2,}/g);
  if (nums && nums.length > 0) {
    return nums[nums.length - 1];
  }
  const slug = u.pathname.split('/').filter(Boolean).pop() ?? 'book';
  const cleaned = slug.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 60) || 'book';
}

/**
 * 为章节链接生成唯一 ID
 * @param sample - 链接
 * @param index - 序号
 * @param used - 已使用的 ID 集合
 */
function deriveChapterId(
  sample: LinkSample,
  index: number,
  used: Set<string>,
): string {
  const segs = new URL(sample.url).pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  let id = /^\d+$/.test(last) ? last : `c${index + 1}`;
  while (used.has(id)) {
    id = `${id}-${index + 1}`;
  }
  used.add(id);
  return id;
}

/**
 * 探测一个未知站点：静态 HTML → （必要时）浏览器渲染 → 样章正文评分。
 * 未达门槛时只返回报告，不构建 Book（避免静默生成残缺 EPUB）。
 * @param url - 入口 URL
 * @param transport - 传输能力
 * @param options - 探测选项
 */
export async function probeGeneric(
  url: string,
  transport: ProbeTransport,
  options: ProbeOptions,
): Promise<ProbeResult> {
  if (!isSafeHttpUrl(url)) {
    throw new Error(`拒绝探测不安全或非 http(s) 的地址: ${url}`);
  }

  const warnings: string[] = [];
  const baseReport = {
    url,
    site: options.site,
    generatedAt: new Date().toISOString(),
  };

  const res = await transport.fetchText(url);
  if (res.status !== 200) {
    return {
      report: {
        ...baseReport,
        accepted: false,
        reason: `入口页 HTTP ${res.status}`,
        coverCandidates: [],
        catalogue: [],
        contentCandidates: [],
        warnings,
      },
    };
  }

  let inspection = inspectCatalogue(res.text, url);
  warnings.push(...inspection.warnings);
  if (inspection.clusters.length === 0) {
    // 静态 HTML 不足（CSR 应用壳），回退到浏览器渲染
    try {
      const rendered = await transport.render(url);
      const renderedInspection = inspectCatalogue(rendered, url);
      if (renderedInspection.clusters.length > 0) {
        warnings.push('静态 HTML 不足，已改用浏览器渲染结果进行探测');
        inspection = renderedInspection;
        warnings.push(...renderedInspection.warnings);
      }
    } catch (e) {
      warnings.push(
        `浏览器渲染失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const catalogue = inspection.clusters.map((c) => ({
    pattern: c.pattern,
    count: c.count,
    chapterTextRatio: Number(c.chapterTextRatio.toFixed(2)),
    numericRatio: Number(c.numericRatio.toFixed(2)),
    score: Number(c.score.toFixed(1)),
    samples: c.links.slice(0, 3),
  }));

  const verdict = evaluateCatalogue(inspection);
  if (!verdict.ok || !verdict.bestCluster) {
    return {
      report: {
        ...baseReport,
        accepted: false,
        reason: verdict.reason,
        title: inspection.title,
        author: inspection.author,
        coverCandidates: inspection.coverCandidates,
        catalogue,
        contentCandidates: [],
        warnings,
      },
    };
  }

  const best = verdict.bestCluster;
  let contentCandidates: ContentCandidate[] = [];
  let contentSelector: string | undefined;
  let sample:
    | { url: string; chars: number; paragraphs: number; linkDensity: number }
    | undefined;

  if (options.sampleChapter !== false) {
    const sampleUrl = best.links[0].url;
    try {
      const chapterHtml = await transport.render(sampleUrl);
      const wall = detectWall(cheerio.load(chapterHtml));
      if (wall.blocked) {
        return {
          report: {
            ...baseReport,
            accepted: false,
            reason: `样章出现访问遮挡：${wall.reason ?? ''}`,
            title: inspection.title,
            author: inspection.author,
            coverCandidates: inspection.coverCandidates,
            catalogue,
            contentCandidates: [],
            warnings,
          },
        };
      }
      const content = scoreContentCandidates(chapterHtml);
      contentCandidates = content.candidates.slice(0, 5);
      contentSelector = content.best?.selector;
      if (content.best) {
        sample = {
          url: sampleUrl,
          chars: content.best.chars,
          paragraphs: content.best.paragraphCount,
          linkDensity: Number(content.best.linkDensity.toFixed(2)),
        };
      }
    } catch (e) {
      warnings.push(
        `样章渲染失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const sampleOk =
      sample !== undefined &&
      sample.chars >= SAMPLE_MIN_CHARS &&
      sample.linkDensity <= SAMPLE_MAX_LINK_DENSITY &&
      (sample.paragraphs >= 2 || sample.chars >= 600);
    if (!sampleOk) {
      return {
        report: {
          ...baseReport,
          accepted: false,
          reason: '样章正文置信度不足（字符数/段落数/链接密度未达门槛）',
          title: inspection.title,
          author: inspection.author,
          coverCandidates: inspection.coverCandidates,
          catalogue,
          contentCandidates,
          sample,
          warnings,
        },
      };
    }
  }

  const book = buildBook(url, inspection, best.links, options.site, contentSelector);
  return {
    report: {
      ...baseReport,
      accepted: true,
      title: inspection.title,
      author: inspection.author,
      coverCandidates: inspection.coverCandidates,
      catalogue,
      contentCandidates,
      sample,
      warnings,
    },
    book,
    contentSelector,
  };
}

/**
 * 依据探测结果构建 Book 骨架（单合成卷）
 * @param url - 入口 URL
 * @param inspection - 目录页探测结果
 * @param links - 章节链接
 * @param site - 站点 id
 * @param contentSelector - 抽样得到的正文选择器
 */
function buildBook(
  url: string,
  inspection: ReturnType<typeof inspectCatalogue>,
  links: LinkSample[],
  site: string,
  contentSelector?: string,
): Book {
  const used = new Set<string>();
  const chapters: Chapter[] = links.map((sample, index) => ({
    id: deriveChapterId(sample, index, used),
    title: sample.title,
    url: sample.url,
    access: 'public',
    blocks: [],
    isIllustration: false,
    locator: contentSelector ? { contentSelector } : undefined,
  }));

  return {
    source: { site, bookId: deriveBookId(url), canonicalUrl: url },
    id: deriveBookId(url),
    title: inspection.title ?? '未命名',
    author: inspection.author ?? '',
    intro: inspection.intro,
    coverUrl: inspection.coverCandidates[0],
    volumes: [{ id: 'main', title: '正文', chapters }],
  };
}
