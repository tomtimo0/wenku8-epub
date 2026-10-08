const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

/**
 * 通用单行清洗：去缩进、零宽字符、压缩空白。
 * 站点特有过滤（如水印）由适配器的 normalizeBlock 负责。
 * @param line - 原始行文本
 */
export function normalizeLine(line: string): string | null {
  let s = line.replace(ZERO_WIDTH_RE, '');
  s = s.replace(/^[\s\u00A0\u3000\t]+|[\s\u00A0\u3000\t]+$/g, '');
  s = s.replace(/\s+/g, ' ');
  if (!s) {
    return null;
  }
  return s;
}
