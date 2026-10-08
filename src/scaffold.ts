import path from 'node:path';
import fs from 'node:fs/promises';
import type { InspectionReport } from './sites/generic/index.js';

export interface ScaffoldResult {
  dir: string;
  files: string[];
}

/**
 * 依据探测报告生成站点适配器脚手架（adapter / urls / 解析函数 / 契约测试骨架）。
 * 生成的代码只是起点，需要人工补全选择器与访问策略；不包含任何抓取正文的逻辑。
 * @param siteId - 站点 id（小写字母、数字、连字符）
 * @param inspection - `inspect` 生成的诊断
 * @param outDir - 输出目录
 */
export async function scaffoldAdapter(
  siteId: string,
  inspection: InspectionReport,
  outDir: string,
): Promise<ScaffoldResult> {
  if (!/^[a-z][a-z0-9-]*$/.test(siteId)) {
    throw new Error(`站点 id 必须是 [a-z][a-z0-9-]*，收到：${siteId}`);
  }
  const displayName = inspection.title ?? siteId;
  const sampleUrl = inspection.catalogue[0]?.samples[0]?.url ?? inspection.url;
  const chapterSelector = inspection.contentCandidates[0]?.selector ?? 'article';
  const cataloguePattern = inspection.catalogue[0]?.pattern ?? 'https://example.com';

  const files: Record<string, string> = {
    'urls.ts': `const HOSTS = new Set(['${new URL(inspection.url).hostname}']);

/**
 * 判断 hostname 是否精确属于该站点（不做子串匹配）
 * @param hostname - 主机名
 */
export function isSiteHost(hostname: string): boolean {
  return HOSTS.has(hostname.toLowerCase());
}

/**
 * 由书号构造入口 URL（TODO：按站点真实形态修正）
 * @param bookId - 书号
 */
export function entryUrl(bookId: string): string {
  return \`${inspection.url}\`;
}

/**
 * 从输入解析书号（TODO：覆盖站点支持的 URL 形态）
 * @param input - URL
 */
export function parseBookId(input: string): string {
  const url = new URL(input.trim());
  if (!isSiteHost(url.hostname)) {
    throw new Error(\`非目标站点域名: \${url.hostname}\`);
  }
  const id = url.pathname.match(/(\\d+)/)?.[1];
  if (!id) {
    throw new Error(\`无法解析书号: \${input}\`);
  }
  return id;
}
`,
    'parse-catalogue.ts': `import * as cheerio from 'cheerio';
import type { Book } from '../../types.js';

/**
 * 解析目录页为 Book 骨架（TODO：用 fixture 固定选择器）
 * 起手线索：链接簇模式 ${cataloguePattern}
 * @param html - 目录页 HTML
 * @param bookId - 书号
 * @param pageUrl - 目录页 URL
 */
export function parseCatalogue(
  html: string,
  bookId: string,
  pageUrl: string,
): Book {
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim();
  const chapters = $('a[href]')
    .toArray()
    .map((el) => ({
      id: $(el).attr('href')?.match(/(\\d+)/)?.[1] ?? '',
      title: $(el).text().trim(),
      url: new URL($(el).attr('href') ?? '', pageUrl).href,
    }))
    .filter((c) => c.id && c.title);

  return {
    source: { site: '${siteId}', bookId, canonicalUrl: pageUrl },
    id: bookId,
    title,
    author: '',
    volumes: [
      {
        id: 'main',
        title: '正文',
        chapters: chapters.map((c) => ({
          id: c.id,
          title: c.title,
          url: c.url,
          access: 'unknown',
          blocks: [],
          isIllustration: false,
        })),
      },
    ],
  };
}
`,
    'parse-chapter.ts': `import * as cheerio from 'cheerio';
import type { Block } from '../../types.js';
import { normalizeLine } from '../../text/normalize.js';

/**
 * 解析章节正文为 Block[]（TODO：确认正文容器与段落规则）
 * 探测阶段建议的容器选择器：${chapterSelector}
 * @param html - 章节页 HTML
 */
export function parseChapter(html: string): Block[] {
  const $ = cheerio.load(html);
  const container = $('${chapterSelector}').first();
  const blocks: Block[] = [];
  container.find('p').each((_, el) => {
    const text = normalizeLine($(el).text());
    if (text) {
      blocks.push({ kind: 'paragraph', text });
    }
  });
  return blocks;
}
`,
    'adapter.ts': `import type { Book, Chapter, SourceRef } from '../../types.js';
import type {
  AssetRequest,
  ChapterFetchResult,
  ScrapeContext,
  SiteAdapter,
} from '../../site.js';
import { parseCatalogue } from './parse-catalogue.js';
import { parseChapter } from './parse-chapter.js';
import { entryUrl, isSiteHost, parseBookId } from './urls.js';

/**
 * ${displayName} 适配器（脚手架，等待人工补全）
 */
export class ${className(siteId)}Adapter implements SiteAdapter {
  readonly id = '${siteId}';
  readonly displayName = '${displayName}';
  readonly parserVersion = '0.1.0';

  match(input: string): number {
    try {
      return isSiteHost(new URL(input.trim()).hostname) ? 100 : 0;
    } catch {
      return 0;
    }
  }

  async resolve(input: string): Promise<SourceRef> {
    const bookId = parseBookId(input);
    return { site: this.id, bookId, canonicalUrl: entryUrl(bookId) };
  }

  async fetchBook(ref: SourceRef, ctx: ScrapeContext): Promise<Book> {
    const res = await ctx.http.get(ref.canonicalUrl, { charset: 'utf-8' });
    if (res.status !== 200) {
      throw new Error(\`入口页 HTTP \${res.status}\`);
    }
    const book = parseCatalogue(res.text, ref.bookId, ref.canonicalUrl);
    await ctx.cache.writeJson(\`books/\${this.id}/\${ref.bookId}/book.json\`, book);
    return book;
  }

  async fetchChapter(
    book: Book,
    chapter: Chapter,
    ctx: ScrapeContext,
  ): Promise<ChapterFetchResult> {
    const html = await ctx.browser.renderHtml(chapter.url);
    const blocks = parseChapter(html);
    if (blocks.length === 0) {
      return { status: 'failed', reason: '正文为空或结构变化', retryable: false };
    }
    return { status: 'ok', blocks, warnings: [] };
  }

  assetRequest(url: string, book: Book): AssetRequest {
    return { url, headers: { Referer: book.source.canonicalUrl } };
  }

  coverCandidates(book: Book): string[] {
    return book.coverUrl ? [book.coverUrl] : [];
  }
}
`,
    'index.ts': `export { ${className(siteId)}Adapter } from './adapter.js';
export { parseCatalogue } from './parse-catalogue.js';
export { parseChapter } from './parse-chapter.js';
export { entryUrl, isSiteHost, parseBookId } from './urls.js';
`,
    'README.md': `# ${siteId} 适配器脚手架

由 \`book2epub scaffold-adapter\` 依据 \`inspect\` 诊断生成，仅为起点，需要人工补全。

## 下一步

1. 用手写的**虚构** HTML 替换 fixture，覆盖目录页与章节页；
2. 修正 \`parse-catalogue.ts\` / \`parse-chapter.ts\` 的选择器；
3. 补齐访问状态（\`public\` / \`restricted\` / \`unknown\`）与合规策略（\`policy\`）；
4. 在 \`src/registry.ts\` 的 \`defaultAdapters()\` 中注册；
5. 运行 \`npm test\`，并把本目录移入 \`src/sites/${siteId}/\`。

> 探测线索：入口 ${inspection.url}
> 目录链接模式：${cataloguePattern}
> 样章正文选择器：${chapterSelector}
`,
    'fixtures/README.md': `在此放置手写的虚构 HTML fixture（不要提交真实站点内容）。样例章节链接：${sampleUrl}
`,
  };

  const targetDir = path.join(outDir, siteId);
  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(targetDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
    written.push(full);
  }
  return { dir: targetDir, files: written };
}

/**
 * 站点 id → 类名前缀（PascalCase）
 * @param siteId - 站点 id
 */
function className(siteId: string): string {
  return siteId
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}
