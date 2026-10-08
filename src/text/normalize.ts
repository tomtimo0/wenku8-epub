const WATERMARK_RE = /轻小说文库|wenku8\.(com|net)/i;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

/**
 * 清洗单行正文：去缩进、零宽字符与水印行
 * @param line - 原始行文本
 */
export function normalizeLine(line: string): string | null {
  let s = line.replace(ZERO_WIDTH_RE, '');
  s = s.replace(/^[\s\u00A0\u3000\t]+|[\s\u00A0\u3000\t]+$/g, '');
  s = s.replace(/\s+/g, ' ');
  if (!s) {
    return null;
  }
  if (WATERMARK_RE.test(s)) {
    return null;
  }
  return s;
}
