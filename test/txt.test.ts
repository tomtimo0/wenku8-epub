import { describe, expect, it } from 'vitest';
import { buildTxt, centerLine, displayWidth } from '../src/output/txt.js';

describe('txt layout', () => {
  it('计算全角宽度', () => {
    expect(displayWidth('ab')).toBe(2);
    expect(displayWidth('中文')).toBe(4);
  });

  it('居中标题', () => {
    expect(centerLine('书', 5)).toContain('书');
  });

  it('生成带 BOM 的 TXT', () => {
    const buf = buildTxt({
      book: {
        source: { site: 't', bookId: '1', canonicalUrl: 'https://x' },
        id: '1',
        title: '测试书',
        author: '作者',
        volumes: [
          {
            id: 'v1',
            title: '卷一',
            chapters: [
              {
                id: '1',
                title: '第一章',
                url: 'https://x/1',
                access: 'public',
                blocks: [{ kind: 'paragraph', text: '正文' }],
                isIllustration: false,
              },
            ],
          },
        ],
      },
    });
    expect(buf[0]).toBe(0xef);
    expect(buf.toString('utf8')).toContain('测试书');
    expect(buf.toString('utf8')).toContain('　　正文');
  });
});
