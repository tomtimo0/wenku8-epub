import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import type { Book, Chapter, IllusPosition, ResolvedImage, Volume } from '../types.js';
import { escapeXml } from './escape.js';
import {
  CONTAINER_XML,
  chapterXhtml,
  contentOpf,
  coverXhtml,
  navXhtml,
  titlePageXhtml,
  tocNcx,
  volumeXhtml,
  type ManifestItem,
  type NavVolume,
} from './templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BuildEpubOptions {
  book: Book;
  cover?: { buffer: Buffer; mediaType: string } | null;
  imageMap: Map<string, ResolvedImage>;
  /** `${chapterId}:${src}:${seq}` → epub 相对路径（OEBPS/ 下） */
  chapterImagePaths: Map<string, string>;
  illusPosition: IllusPosition;
  seriesTitle?: string;
  groupPosition?: number;
  /** 仅包含这些卷（分卷模式） */
  volumeFilter?: Volume[];
  /** 为受限/失败章节写入占位章 */
  includePlaceholders?: boolean;
}

interface SpineEntry {
  id: string;
  href: string;
  linear?: 'no';
}

/**
 * 按策略重排卷内章节（插图章位置）
 * @param chapters - 原始章节列表
 * @param position - 插图章策略
 */
export function reorderChaptersForIllus(
  chapters: Chapter[],
  position: IllusPosition,
): Chapter[] {
  if (position === 'keep') {
    return chapters;
  }
  const illus = chapters.filter((c) => c.isIllustration);
  const rest = chapters.filter((c) => !c.isIllustration);
  return position === 'start' ? [...illus, ...rest] : [...rest, ...illus];
}

/**
 * 生成章节正文 HTML 片段
 * @param chapter - 章节
 * @param chapterImagePaths - 图片路径映射
 * @param imageMap - 已下载图片
 */
function renderChapterBody(
  chapter: Chapter,
  chapterImagePaths: Map<string, string>,
  imageMap: Map<string, ResolvedImage>,
): string {
  const parts: string[] = [];
  if (!chapter.isIllustration) {
    parts.push(`    <h2 class="chapter-title">${escapeXml(chapter.title)}</h2>`);
  }
  let imgIndex = 0;
  for (const block of chapter.blocks) {
    if (block.kind === 'paragraph') {
      parts.push(`    <p>${escapeXml(block.text)}</p>`);
    } else {
      imgIndex++;
      const href = chapterImagePaths.get(`${chapter.id}:${block.src}:${imgIndex}`);
      const resolved = imageMap.get(block.src);
      if (!href || resolved?.failed) {
        parts.push(`    <p class="missing-image">〔插图缺失〕</p>`);
      } else {
        parts.push(`    <div class="illus"><img src="../${href}" alt=""/></div>`);
      }
    }
  }
  return parts.join('\n');
}

/**
 * 是否为可写入 spine 的章节
 * @param chapter - 章节
 */
function isRenderable(chapter: Chapter): boolean {
  return chapter.blocks.length > 0;
}

/**
 * 构建 EPUB 二进制
 * @param options - 构建选项
 */
export async function buildEpub(options: BuildEpubOptions): Promise<Buffer> {
  const book = options.book;
  const volumes = options.volumeFilter ?? book.volumes;
  const source = book.source;
  const identifier = `urn:book2epub:${source.site}:${source.bookId}`;
  const scrapedAt = new Date().toISOString().slice(0, 10);

  const zip = new JSZip();
  // EPUB 规范：mimetype 必须是第一个条目且不压缩，因此先写入它再创建其它条目
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  const metaInf = zip.folder('META-INF')!;
  const oebps = zip.folder('OEBPS')!;
  metaInf.file('container.xml', CONTAINER_XML);

  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  oebps.folder('styles')!.file('main.css', css);

  const manifest: ManifestItem[] = [];
  const spine: SpineEntry[] = [];
  const navVolumes: NavVolume[] = [];
  const ncxVolumes: Array<{
    id: string;
    title: string;
    href: string;
    children: Array<{ id: string; title: string; href: string }>;
  }> = [];

  const addManifest = (item: ManifestItem): void => {
    manifest.push(item);
  };

  let coverHref: string | undefined;
  if (options.cover) {
    const ext = options.cover.mediaType === 'image/png' ? 'png' : 'jpg';
    const coverPath = `images/cover.${ext}`;
    oebps.file(coverPath, options.cover.buffer);
    addManifest({
      id: 'cover-image',
      href: coverPath,
      mediaType: options.cover.mediaType,
      properties: 'cover-image',
    });
    oebps.folder('text')!.file('cover.xhtml', coverXhtml(coverPath));
    addManifest({
      id: 'cover',
      href: 'text/cover.xhtml',
      mediaType: 'application/xhtml+xml',
    });
    spine.push({ id: 'cover', href: 'text/cover.xhtml' });
    coverHref = 'text/cover.xhtml';
  }

  // 正文插图
  for (const [, img] of options.imageMap) {
    if (img.failed || !img.epubPath) {
      continue;
    }
    if (manifest.some((m) => m.href === img.epubPath)) {
      continue;
    }
    oebps.file(img.epubPath, img.buffer);
    addManifest({
      id: `img-${img.epubPath.replace(/[^\w]+/g, '-')}`,
      href: img.epubPath,
      mediaType: img.mediaType,
    });
  }

  const titleFields = {
    title: book.title,
    author: book.author,
    category: book.category,
    status: book.status,
    lastUpdate: book.lastUpdate,
    length: book.length,
    intro: book.intro,
    sourceSite: source.site,
    sourceUrl: source.canonicalUrl,
    scrapedAt,
  };
  if (options.seriesTitle && options.groupPosition !== undefined) {
    titleFields.title = `${book.title} ${volumes[0]?.title ?? ''}`.trim();
    titleFields.sourceUrl = volumes[0]?.chapters[0]?.url ?? source.canonicalUrl;
  }

  oebps.file('text/titlepage.xhtml', titlePageXhtml(titleFields));
  addManifest({
    id: 'titlepage',
    href: 'text/titlepage.xhtml',
    mediaType: 'application/xhtml+xml',
  });
  spine.push({ id: 'titlepage', href: 'text/titlepage.xhtml' });

  const navSpineEntry: SpineEntry = { id: 'nav', href: 'nav.xhtml', linear: 'no' };

  let bodyStartHref = 'text/titlepage.xhtml';
  let vi = 0;
  for (const volume of volumes) {
    const renderableInVolume = volume.chapters.filter(
      (c) => isRenderable(c) || options.includePlaceholders,
    );
    if (renderableInVolume.length === 0) {
      continue;
    }
    vi++;
    const volFile = `text/v${vi}.xhtml`;
    oebps.file(volFile, volumeXhtml(volume.title));
    const volId = `vol-${vi}`;
    addManifest({ id: volId, href: volFile, mediaType: 'application/xhtml+xml' });
    spine.push({ id: volId, href: volFile });
    if (bodyStartHref === 'text/titlepage.xhtml') {
      bodyStartHref = volFile;
    }

    const renderable = volume.chapters.filter(
      (c) => isRenderable(c) || options.includePlaceholders,
    );
    const chapters = reorderChaptersForIllus(renderable, options.illusPosition);
    const navChapters: NavVolume['chapters'] = [];
    const ncxChildren: Array<{ id: string; title: string; href: string }> = [];

    let ci = 0;
    for (const chapter of chapters) {
      ci++;
      const chFile = `text/v${vi}c${ci}.xhtml`;
      const body = isRenderable(chapter)
        ? renderChapterBody(chapter, options.chapterImagePaths, options.imageMap)
        : `    <h2 class="chapter-title">${escapeXml(chapter.title)}</h2>\n    <p class="restricted-note">本章内容受限或抓取失败，未包含正文。</p>`;
      oebps.file(chFile, chapterXhtml(chapter.title, body));
      const chId = `ch-${vi}-${ci}`;
      addManifest({ id: chId, href: chFile, mediaType: 'application/xhtml+xml' });
      spine.push({ id: chId, href: chFile });
      navChapters.push({ id: chId, title: chapter.title, href: chFile });
      ncxChildren.push({ id: chId, title: chapter.title, href: chFile });
    }

    navVolumes.push({ id: volId, title: volume.title, href: volFile, chapters: navChapters });
    ncxVolumes.push({ id: volId, title: volume.title, href: volFile, children: ncxChildren });
  }

  oebps.file('nav.xhtml', navXhtml(book.title, navVolumes, bodyStartHref, coverHref));
  addManifest({
    id: 'nav',
    href: 'nav.xhtml',
    mediaType: 'application/xhtml+xml',
    properties: 'nav',
  });
  spine.splice(options.cover ? 2 : 1, 0, navSpineEntry);

  oebps.file('toc.ncx', tocNcx(book.title, identifier, ncxVolumes));

  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const opfTitle =
    options.seriesTitle && options.groupPosition !== undefined
      ? `${book.title} ${volumes[0]?.title ?? ''}`.trim()
      : book.title;

  oebps.file(
    'content.opf',
    contentOpf({
      identifier,
      title: opfTitle,
      author: book.author,
      modified,
      sourceUrl: source.canonicalUrl,
      manifest: [
        ...manifest,
        { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
      ],
      spine: spine.map((s) => ({ id: s.id, linear: s.linear })),
      coverId: options.cover ? 'cover-image' : undefined,
      seriesTitle: options.seriesTitle,
      groupPosition: options.groupPosition,
    }),
  );

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

/**
 * 为每章内图片生成稳定的路径映射键
 * @param book - 书籍
 * @param imageMap - 已下载图片（会更新 epubPath）
 */
export function buildChapterImagePathMap(
  book: Book,
  imageMap: Map<string, ResolvedImage>,
): Map<string, string> {
  const paths = new Map<string, string>();
  for (const vol of book.volumes) {
    for (const ch of vol.chapters) {
      let imgSeq = 0;
      for (const b of ch.blocks) {
        if (b.kind !== 'image') {
          continue;
        }
        imgSeq++;
        const resolved = imageMap.get(b.src);
        if (resolved && !resolved.failed) {
          const ext = extFromMedia(resolved.mediaType);
          const epubPath = `images/${ch.id}_${imgSeq}.${ext}`;
          resolved.epubPath = epubPath;
          paths.set(`${ch.id}:${b.src}:${imgSeq}`, epubPath);
        }
      }
    }
  }
  return paths;
}

/**
 * @param mediaType - MIME
 */
function extFromMedia(mediaType: string): string {
  if (mediaType.includes('png')) {
    return 'png';
  }
  if (mediaType.includes('gif')) {
    return 'gif';
  }
  if (mediaType.includes('webp')) {
    return 'webp';
  }
  return 'jpg';
}

/**
 * Windows 安全文件名
 * @param name - 原始书名
 */
export function sanitizeFileName(name: string): string {
  const replaced = name.replace(/[\\/:*?"<>|]/g, (ch) => {
    const map: Record<string, string> = {
      '\\': '＼',
      '/': '／',
      ':': '：',
      '*': '＊',
      '?': '？',
      '"': '＂',
      '<': '＜',
      '>': '＞',
      '|': '｜',
    };
    return map[ch] ?? ch;
  });
  return replaced.length <= 150 ? replaced : replaced.slice(0, 150);
}
