import { describe, expect, it } from 'vitest';
import {
  parseBookId,
  indexPageUrl,
  chapterPageUrl,
  coverImageUrl,
} from '../src/urls.js';
import { reorderChaptersForIllus } from '../src/epub/builder.js';
import type { Chapter } from '../src/types.js';

describe('urls', () => {
  it('解析书号与 URL', () => {
    expect(parseBookId('2896')).toBe('2896');
    expect(parseBookId('https://www.wenku8.net/novel/2/2896/index.htm')).toBe(
      '2896',
    );
    expect(parseBookId('https://www.wenku8.net/book/2896.htm')).toBe('2896');
    expect(indexPageUrl('2896')).toBe(
      'https://www.wenku8.net/novel/2/2896/index.htm',
    );
    expect(chapterPageUrl('2896', '116725')).toBe(
      'https://www.wenku8.net/novel/2/2896/116725.htm',
    );
    expect(coverImageUrl('2896')).toContain('/2/2896/2896s.jpg');
  });
});

describe('reorderChaptersForIllus', () => {
  const illus: Chapter = {
    id: 'i',
    title: '插图',
    blocks: [],
    isIllustration: true,
  };
  const ch: Chapter = {
    id: 'c',
    title: '正文',
    blocks: [],
    isIllustration: false,
  };

  it('start 将插图章移到卷首', () => {
    expect(reorderChaptersForIllus([ch, illus], 'start').map((c) => c.id)).toEqual(
      ['i', 'c'],
    );
  });

  it('end 将插图章移到卷末', () => {
    expect(reorderChaptersForIllus([illus, ch], 'end').map((c) => c.id)).toEqual(
      ['c', 'i'],
    );
  });
});
