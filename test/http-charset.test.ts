import { describe, expect, it } from 'vitest';
import { decodeBuffer, sniffCharset } from '../src/transports/charset.js';
import { classifyHttpResponse } from '../src/transports/classify.js';

describe('sniffCharset', () => {
  it('识别 UTF-8 BOM', () => {
    const buf = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('你好', 'utf8')]);
    expect(sniffCharset(buf)).toBe('utf-8');
  });

  it('识别 meta charset=gbk', () => {
    const buf = Buffer.from(
      '<html><head><meta charset="gbk"></head><body></body></html>',
      'latin1',
    );
    expect(sniffCharset(buf)).toBe('gbk');
  });
});

describe('decodeBuffer', () => {
  it('gbk 与 gb18030 解码中文', () => {
    const buf = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
    expect(decodeBuffer(buf, 'gbk')).toBe('你好');
  });
});

describe('classifyHttpResponse', () => {
  it('429 记为 rate-limited', () => {
    expect(
      classifyHttpResponse({ status: 429, headers: {}, text: '' }),
    ).toBe('rate-limited');
  });

  it('塔读式错误页记为 semantic', () => {
    expect(
      classifyHttpResponse({
        status: 200,
        headers: {},
        text: '<html><title>出错了</title></html>',
      }),
    ).toBe('semantic');
  });
});
