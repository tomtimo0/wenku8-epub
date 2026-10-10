import { escapeXml } from './escape.js';

/**
 * 章节 XHTML
 * @param title - 章标题
 * @param bodyInner - section 内 HTML
 */
export function chapterXhtml(title: string, bodyInner: string): string {
  const t = escapeXml(title);
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>${t}</title><link rel="stylesheet" href="../styles/main.css"/></head>
<body>
  <section epub:type="chapter">
${bodyInner}
  </section>
</body>
</html>`;
}

/**
 * 卷标题页
 * @param volumeTitle - 卷名
 */
export function volumeXhtml(volumeTitle: string): string {
  const t = escapeXml(volumeTitle);
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>${t}</title><link rel="stylesheet" href="../styles/main.css"/></head>
<body>
  <section epub:type="part" class="volume-page">
    <h1 class="volume-title">${t}</h1>
  </section>
</body>
</html>`;
}

/**
 * 封面页
 * @param coverHref - 封面图相对路径（相对 text/）
 */
export function coverXhtml(coverHref: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>封面</title><link rel="stylesheet" href="../styles/main.css"/></head>
<body>
  <section epub:type="cover" class="cover">
    <img src="../${coverHref}" alt=""/>
  </section>
</body>
</html>`;
}

export interface TitlePageFields {
  title: string;
  author: string;
  category?: string;
  status?: string;
  lastUpdate?: string;
  length?: string;
  intro?: string;
  sourceSite?: string;
  sourceUrl?: string;
  scrapedAt?: string;
}

/**
 * 书名页
 * @param fields - 元数据
 */
export function titlePageXhtml(fields: TitlePageFields): string {
  const lines: string[] = [];
  lines.push(`<h1>${escapeXml(fields.title)}</h1>`);
  lines.push(`<p>${escapeXml(fields.author)}</p>`);
  const meta: string[] = [];
  if (fields.category) {
    meta.push(`文库分类：${escapeXml(fields.category)}`);
  }
  if (fields.status) {
    meta.push(`状态：${escapeXml(fields.status)}`);
  }
  if (fields.lastUpdate) {
    meta.push(`最后更新：${escapeXml(fields.lastUpdate)}`);
  }
  if (fields.length) {
    meta.push(`全文长度：${escapeXml(fields.length)}`);
  }
  if (fields.sourceSite) {
    meta.push(`来源站点：${escapeXml(fields.sourceSite)}`);
  }
  if (fields.sourceUrl) {
    meta.push(`来源链接：${escapeXml(fields.sourceUrl)}`);
  }
  if (fields.scrapedAt) {
    meta.push(`抓取日期：${escapeXml(fields.scrapedAt)}`);
  }
  const metaHtml = meta.length
    ? `<div class="meta">${meta.map((m) => `<p>${m}</p>`).join('')}</div>`
    : '';
  const introHtml = fields.intro
    ? `<div class="intro"><p>${escapeXml(fields.intro)}</p></div>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>${escapeXml(fields.title)}</title><link rel="stylesheet" href="../styles/main.css"/></head>
<body>
  <section epub:type="titlepage" class="titlepage">
    ${lines.join('\n    ')}
    ${metaHtml}
    ${introHtml}
  </section>
</body>
</html>`;
}

export interface NavVolume {
  id: string;
  title: string;
  href: string;
  chapters: Array<{ id: string; title: string; href: string }>;
}

/**
 * EPUB 3 导航文档
 * @param bookTitle - 书名
 * @param volumes - 卷章导航
 * @param bodyStartHref - 正文起点 href
 * @param coverHref - 封面页 href（无封面时省略 landmark）
 */
export function navXhtml(
  bookTitle: string,
  volumes: NavVolume[],
  bodyStartHref: string,
  coverHref?: string,
): string {
  const volItems = volumes
    .map(
      (v) => `        <li><a href="${v.href}">${escapeXml(v.title)}</a>
          <ol>
${v.chapters
  .map((c) => `            <li><a href="${c.href}">${escapeXml(c.title)}</a></li>`)
  .join('\n')}
          </ol>
        </li>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeXml(bookTitle)}</h1>
    <ol>
${volItems}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="">
    <ol>
${coverHref ? `      <li><a epub:type="cover" href="${coverHref}">封面</a></li>\n` : ''}      <li><a epub:type="toc" href="nav.xhtml">目录</a></li>
      <li><a epub:type="bodymatter" href="${bodyStartHref}">正文</a></li>
    </ol>
  </nav>
</body>
</html>`;
}

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

/**
 * content.opf
 */
export function contentOpf(params: {
  identifier: string;
  title: string;
  author: string;
  modified: string;
  sourceUrl?: string;
  manifest: ManifestItem[];
  spine: Array<{ id: string; linear?: 'no' }>;
  coverId?: string;
  seriesTitle?: string;
  groupPosition?: number;
}): string {
  const manifestXml = params.manifest
    .map((m) => {
      const props = m.properties ? ` properties="${m.properties}"` : '';
      return `    <item id="${m.id}" href="${m.href}" media-type="${m.mediaType}"${props}/>`;
    })
    .join('\n');
  const spineXml = params.spine
    .map((s) => {
      const linear = s.linear === 'no' ? ' linear="no"' : '';
      return `    <itemref idref="${s.id}"${linear}/>`;
    })
    .join('\n');

  const coverMeta = params.coverId
    ? `\n    <meta name="cover" content="${params.coverId}"/>`
    : '';

  let collectionMeta = '';
  if (params.seriesTitle && params.groupPosition !== undefined) {
    collectionMeta = `
    <meta property="belongs-to-collection" id="series-id">${escapeXml(params.seriesTitle)}</meta>
    <meta refines="#series-id" property="group-position">${params.groupPosition}</meta>`;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(params.identifier)}</dc:identifier>
    <dc:title>${escapeXml(params.title)}</dc:title>
    <dc:creator>${escapeXml(params.author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    ${params.sourceUrl ? `<dc:source>${escapeXml(params.sourceUrl)}</dc:source>` : ''}
    <meta property="dcterms:modified">${params.modified}</meta>${coverMeta}${collectionMeta}
  </metadata>
  <manifest>
${manifestXml}
  </manifest>
  <spine>
${spineXml}
  </spine>
</package>`;
}

/**
 * toc.ncx（EPUB 2 兼容）
 */
export function tocNcx(
  bookTitle: string,
  uid: string,
  navPoints: Array<{
    id: string;
    title: string;
    href: string;
    children?: Array<{ id: string; title: string; href: string }>;
  }>,
): string {
  let playOrder = 0;
  const nextOrder = (): number => ++playOrder;

  const renderPoint = (
    np: {
      id: string;
      title: string;
      href: string;
      children?: Array<{ id: string; title: string; href: string }>;
    },
    indent: string,
  ): string => {
    const order = nextOrder();
    let childrenXml = '';
    if (np.children?.length) {
      childrenXml = np.children
        .map((c) => {
          const co = nextOrder();
          return `${indent}  <navPoint id="${c.id}" playOrder="${co}">
${indent}    <navLabel><text>${escapeXml(c.title)}</text></navLabel>
${indent}    <content src="${c.href}"/>
${indent}  </navPoint>`;
        })
        .join('\n');
      childrenXml = `\n${childrenXml}`;
    }
    return `${indent}<navPoint id="${np.id}" playOrder="${order}">
${indent}  <navLabel><text>${escapeXml(np.title)}</text></navLabel>
${indent}  <content src="${np.href}"/>${childrenXml}
${indent}</navPoint>`;
  };

  const points = navPoints.map((np) => renderPoint(np, '    ')).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(uid)}"/>
    <meta name="dtb:depth" content="2"/>
  </head>
  <docTitle><text>${escapeXml(bookTitle)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>`;
}

export const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
