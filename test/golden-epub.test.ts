import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildEpub } from '../src/epub/builder.js';
import { verifyEpubBuffer } from '../src/output/verify.js';

describe('golden epub', () => {
  it('虚构最小书 EPUB 通过自检', async () => {
    const book = {
      source: { site: 'fic', bookId: '1', canonicalUrl: 'https://novel.example.com/1' },
      id: '1',
      title: '黄金书',
      author: '测试',
      volumes: [
        {
          id: 'main',
          title: '正文',
          chapters: [
            {
              id: 'c1',
              title: '第一章',
              url: 'https://novel.example.com/1/1.html',
              access: 'public' as const,
              blocks: [{ kind: 'paragraph' as const, text: '段落。' }],
              isIllustration: false,
            },
          ],
        },
      ],
    };
    const buf = await buildEpub({
      book,
      imageMap: new Map(),
      chapterImagePaths: new Map(),
      illusPosition: 'start',
    });
    const v = await verifyEpubBuffer(buf);
    expect(v.ok).toBe(true);
    const zip = await JSZip.loadAsync(buf);
    const opf = await zip.file('OEBPS/content.opf')?.async('string');
    expect(opf).toContain('urn:book2epub:fic:1');
  });
});
