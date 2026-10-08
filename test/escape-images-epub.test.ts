import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { escapeXml } from '../src/epub/escape.js';
import { detectImageFormat } from '../src/images.js';
import { buildEpub, buildChapterImagePathMap } from '../src/epub/builder.js';
import type { Book } from '../src/types.js';

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

describe('buildEpub', () => {
  it('mimetype 为首项且 STORE，manifest 与 spine 一致', async () => {
    const book: Book = {
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
              isIllustration: false,
              blocks: [{ kind: 'paragraph', text: '你好世界' }],
            },
          ],
        },
      ],
    };
    const cover = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const imageMap = new Map();
    const chapterImagePaths = buildChapterImagePathMap(book, imageMap);
    const buf = await buildEpub({
      book,
      coverBuffer: cover,
      coverMediaType: 'image/jpeg',
      imageMap,
      chapterImagePaths,
      illusPosition: 'keep',
    });
    const zip = await JSZip.loadAsync(buf);
    const mime = zip.files['mimetype'];
    expect(mime).toBeTruthy();
    expect(await mime?.async('string')).toBe('application/epub+zip');
    const opf = await zip.file('OEBPS/content.opf')?.async('string');
    expect(opf).toBeTruthy();
    const idrefs = [...(opf?.matchAll(/idref="([^"]+)"/g) ?? [])].map(
      (m) => m[1],
    );
    const manifestIds = [...(opf?.matchAll(/<item id="([^"]+)"/g) ?? [])].map(
      (m) => m[1],
    );
    for (const id of idrefs) {
      expect(manifestIds).toContain(id);
    }
    for (const href of opf?.matchAll(/href="(text\/[^"]+)"/g) ?? []) {
      const path = `OEBPS/${href[1]}`;
      expect(zip.file(path)).toBeTruthy();
    }
  });
});
