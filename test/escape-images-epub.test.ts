import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { escapeXml } from '../src/epub/escape.js';
import { detectImageFormat, isSafeAssetUrl } from '../src/images.js';
import { buildEpub, buildChapterImagePathMap } from '../src/epub/builder.js';
import type { Book } from '../src/types.js';

function sampleBook(): Book {
  return {
    source: {
      site: 'wenku8',
      bookId: '1',
      canonicalUrl: 'https://www.wenku8.net/novel/0/1/index.htm',
    },
    id: '1',
    title: '测试书',
    author: '作者',
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        chapters: [
          {
            id: 'c1',
            title: '第一章',
            url: 'https://www.wenku8.net/novel/0/1/c1.htm',
            access: 'public',
            isIllustration: false,
            blocks: [{ kind: 'paragraph', text: '你好世界' }],
          },
        ],
      },
    ],
  };
}

describe('escapeXml', () => {
  it('转义特殊字符', () => {
    expect(escapeXml(`a & b <c> "d" 'e'`)).toBe(
      'a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;',
    );
  });
});

describe('detectImageFormat', () => {
  it('识别 JPEG 与 PNG', () => {
    expect(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(
      detectImageFormat(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe('png');
  });
});

describe('isSafeAssetUrl', () => {
  it('拒绝私网、file 与非 http(s)', () => {
    expect(isSafeAssetUrl('https://media3.example.com/a.jpg')).toBe(true);
    expect(isSafeAssetUrl('http://127.0.0.1/a.jpg')).toBe(false);
    expect(isSafeAssetUrl('http://localhost/a.jpg')).toBe(false);
    expect(isSafeAssetUrl('http://192.168.1.1/a.jpg')).toBe(false);
    expect(isSafeAssetUrl('http://172.16.0.1/a.jpg')).toBe(false);
    expect(isSafeAssetUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeAssetUrl('ftp://example.com/a.jpg')).toBe(false);
  });
});

describe('buildEpub', () => {
  it('identifier 站点无关，manifest 与 spine 一致（含封面）', async () => {
    const book = sampleBook();
    const cover = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const imageMap = new Map();
    const chapterImagePaths = buildChapterImagePathMap(book, imageMap);
    const buf = await buildEpub({
      book,
      cover: { buffer: cover, mediaType: 'image/jpeg' },
      imageMap,
      chapterImagePaths,
      illusPosition: 'keep',
    });
    // mimetype 必须是 zip 的第一个条目且以 STORE（method 0）写入
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    const firstNameLen = buf.readUInt16LE(26);
    expect(buf.toString('utf8', 30, 30 + firstNameLen)).toBe('mimetype');
    expect(buf.readUInt16LE(8)).toBe(0);

    const zip = await JSZip.loadAsync(buf);
    const mime = zip.files['mimetype'];
    expect(mime).toBeTruthy();
    expect(await mime?.async('string')).toBe('application/epub+zip');

    const opf = await zip.file('OEBPS/content.opf')?.async('string');
    expect(opf).toContain('urn:bookscraper:wenku8:1');
    const idrefs = [...(opf?.matchAll(/idref="([^"]+)"/g) ?? [])].map((m) => m[1]);
    const manifestIds = [...(opf?.matchAll(/<item id="([^"]+)"/g) ?? [])].map(
      (m) => m[1],
    );
    for (const id of idrefs) {
      expect(manifestIds).toContain(id);
    }
    for (const href of opf?.matchAll(/href="(text\/[^"]+)"/g) ?? []) {
      expect(zip.file(`OEBPS/${href[1]}`)).toBeTruthy();
    }
  });

  it('无封面也能生成，且不写 cover landmark', async () => {
    const book = sampleBook();
    const imageMap = new Map();
    const chapterImagePaths = buildChapterImagePathMap(book, imageMap);
    const buf = await buildEpub({
      book,
      cover: null,
      imageMap,
      chapterImagePaths,
      illusPosition: 'keep',
    });
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file('OEBPS/text/cover.xhtml')).toBeNull();
    const nav = await zip.file('OEBPS/nav.xhtml')?.async('string');
    expect(nav).toContain('bodymatter');
  });

  it('受限章节默认不写入，includePlaceholders 时写占位章', async () => {
    const book = sampleBook();
    book.volumes[0].chapters.push({
      id: 'c2',
      title: '受限章',
      url: 'https://www.wenku8.net/novel/0/1/c2.htm',
      access: 'restricted',
      isIllustration: false,
      blocks: [],
    });
    const imageMap = new Map();
    const chapterImagePaths = buildChapterImagePathMap(book, imageMap);

    const noPlaceholder = await JSZip.loadAsync(
      await buildEpub({
        book,
        cover: null,
        imageMap,
        chapterImagePaths,
        illusPosition: 'keep',
      }),
    );
    const ncx1 = await noPlaceholder.file('OEBPS/toc.ncx')?.async('string');
    expect(ncx1).not.toContain('受限章');

    const withPlaceholder = await JSZip.loadAsync(
      await buildEpub({
        book,
        cover: null,
        imageMap,
        chapterImagePaths,
        illusPosition: 'keep',
        includePlaceholders: true,
      }),
    );
    const ncx2 = await withPlaceholder.file('OEBPS/toc.ncx')?.async('string');
    expect(ncx2).toContain('受限章');
    const placeholderXhtml = await withPlaceholder
      .file('OEBPS/text/v1c2.xhtml')
      ?.async('string');
    expect(placeholderXhtml).toContain('受限章');
  });
});
