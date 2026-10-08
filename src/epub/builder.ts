import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import type { Block, Book, Chapter, IllusPosition, Volume } from '../types.js';
import type { ResolvedImage } from '../types.js';
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
  coverBuffer: Buffer;
  coverMediaType: string;
  imageMap: Map<string, ResolvedImage>;
  /** 每章图片 url → epub 相对路径（OEBPS/ 下） */
  chapterImagePaths: Map<string, string>;
  illusPosition: IllusPosition;
  seriesTitle?: string;
  groupPosition?: number;
  /** 仅包含这些卷（分卷模式） */
  volumeFilter?: Volume[];
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
  if (position === 'start') {
    return [...illus, ...rest];
  }
  return [...rest, ...illus];
}

/**
 * 生成章节正文 HTML 片段
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
      const key = `${chapter.id}:${block.src}:${imgIndex}`;
      const href = chapterImagePaths.get(key);
      const resolved = imageMap.get(block.src);
      if (!href || resolved?.failed) {
        parts.push(`    <p class="missing-image">〔插图缺失〕</p>`);
      } else {
        parts.push(
          `    <div class="illus"><img src="../${href}" alt=""/></div>`,
        );
      }
    }
  }
  return parts.join('\n');
}

/**
 * 构建 EPUB 二进制
 * @param options - 构建选项
 */
export async function buildEpub(options: BuildEpubOptions): Promise<Buffer> {
  const book = options.book;
  const volumes = options.volumeFilter ?? book.volumes;
  const zip = new JSZip();
  const oebps = zip.folder('OEBPS')!;
  const metaInf = zip.folder('META-INF')!;

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  metaInf.file('container.xml', CONTAINER_XML);

  const stylePath = path.join(__dirname, 'style.css');
  const css = fs.readFileSync(stylePath, 'utf8');
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

  const coverExt =
    options.coverMediaType === 'image/png' ? 'png' : 'jpg';
  oebps.folder('images')!.file(`cover.${coverExt}`, options.coverBuffer);
  addManifest({
    id: 'cover-image',
    href: `images/cover.${coverExt}`,
    mediaType: options.coverMediaType,
    properties: 'cover-image',
  });

  for (const [, img] of options.imageMap) {
    if (img.failed || !img.epubPath || img.epubPath === '') {
      continue;
    }
    if (img.epubPath.startsWith('images/cover')) {
      continue;
    }
    const id = `img-${img.epubPath.replace(/[^\w]+/g, '-')}`;
    if (manifest.some((m) => m.href === img.epubPath)) {
      continue;
    }
    oebps.file(img.epubPath, img.buffer);
    addManifest({
      id,
      href: img.epubPath,
      mediaType: img.mediaType,
    });
  }

  oebps.folder('text')!.file('cover.xhtml', coverXhtml());
  addManifest({
    id: 'cover',
    href: 'text/cover.xhtml',
    mediaType: 'application/xhtml+xml',
  });
  spine.push({ id: 'cover', href: 'text/cover.xhtml' });

  const titleFields = {
    title: book.title,
    author: book.author,
    category: book.category,
    status: book.status,
    lastUpdate: book.lastUpdate,
    length: book.length,
    intro: book.intro,
  };
  if (options.seriesTitle && options.groupPosition !== undefined) {
    const vol = volumes[0];
    titleFields.title = `${book.title} ${vol?.title ?? ''}`.trim();
  }

  oebps.file('text/titlepage.xhtml', titlePageXhtml(titleFields));
  addManifest({
    id: 'titlepage',
    href: 'text/titlepage.xhtml',
    mediaType: 'application/xhtml+xml',
  });
  spine.push({ id: 'titlepage', href: 'text/titlepage.xhtml' });

  /** nav 在 spine 中稍后插入（位于书名页之后） */
  const navSpineEntry: SpineEntry = {
    id: 'nav',
    href: 'nav.xhtml',
    linear: 'no',
  };

  let bodyStartHref = 'text/titlepage.xhtml';
  let vi = 0;
  for (const volume of volumes) {
    vi++;
    const volFile = `text/v${vi}.xhtml`;
    oebps.file(volFile, volumeXhtml(volume.title));
    const volId = `vol-${vi}`;
    addManifest({
      id: volId,
      href: volFile,
      mediaType: 'application/xhtml+xml',
    });
    spine.push({ id: volId, href: volFile });
    if (bodyStartHref === 'text/titlepage.xhtml') {
      bodyStartHref = volFile;
    }

    const chapters = reorderChaptersForIllus(
      volume.chapters,
      options.illusPosition,
    );
    const navChapters: NavVolume['chapters'] = [];
    const ncxChildren: Array<{ id: string; title: string; href: string }> = [];

    let ci = 0;
    for (const chapter of chapters) {
      ci++;
      const chFile = `text/v${vi}c${ci}.xhtml`;
      const body = renderChapterBody(
        chapter,
        options.chapterImagePaths,
        options.imageMap,
      );
      oebps.file(chFile, chapterXhtml(chapter.title, body));
      const chId = `ch-${vi}-${ci}`;
      addManifest({
        id: chId,
        href: chFile,
        mediaType: 'application/xhtml+xml',
      });
      spine.push({ id: chId, href: chFile });
      navChapters.push({
        id: chId,
        title: chapter.title,
        href: chFile,
      });
      ncxChildren.push({
        id: chId,
        title: chapter.title,
        href: chFile,
      });
    }

    navVolumes.push({
      id: volId,
      title: volume.title,
      href: volFile,
      chapters: navChapters,
    });
    ncxVolumes.push({
      id: volId,
      title: volume.title,
      href: volFile,
      children: ncxChildren,
    });
  }

  const navContent = navXhtml(book.title, navVolumes, bodyStartHref);
  oebps.file('nav.xhtml', navContent);
  addManifest({
    id: 'nav',
    href: 'nav.xhtml',
    mediaType: 'application/xhtml+xml',
    properties: 'nav',
  });
  spine.splice(2, 0, navSpineEntry);

  oebps.file('toc.ncx', tocNcx(book.title, ncxVolumes));

  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const opfTitle =
    options.seriesTitle && options.groupPosition !== undefined
      ? `${book.title} ${volumes[0]?.title ?? ''}`.trim()
      : book.title;

  oebps.file(
    'content.opf',
    contentOpf({
      bookId: book.id,
      title: opfTitle,
      author: book.author,
      modified,
      manifest: [
        ...manifest,
        {
          id: 'ncx',
          href: 'toc.ncx',
          mediaType: 'application/x-dtbncx+xml',
        },
      ],
      spine: spine.map((s) => ({ id: s.id, linear: s.linear })),
      coverId: 'cover-image',
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
        let ext = 'jpg';
        if (resolved && !resolved.failed) {
          ext = extFromMedia(resolved.mediaType);
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
  if (replaced.length <= 150) {
    return replaced;
  }
  return replaced.slice(0, 150);
}
