/** 支持的页面编码 */
export type Charset = 'auto' | 'utf-8' | 'gbk' | 'gb18030' | 'big5';

/**
 * 从 Content-Type、BOM 与 HTML meta 嗅探编码
 * @param buffer - 响应体
 * @param contentType - Content-Type 头
 */
export function sniffCharset(buffer: Buffer, contentType?: string): Charset {
  if (contentType) {
    const m = /charset=([^;\s]+)/i.exec(contentType);
    if (m) {
      return normalizeCharsetLabel(m[1]);
    }
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf-8';
  }
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
  const meta =
    /<meta[^>]+charset=["']?([^"'>\s]+)/i.exec(head) ??
    /<meta[^>]+content=["'][^"']*charset=([^"';\s]+)/i.exec(head);
  if (meta) {
    return normalizeCharsetLabel(meta[1]);
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return 'utf-8';
  } catch {
    return 'gb18030';
  }
}

/**
 * @param label - 编码名称
 */
function normalizeCharsetLabel(label: string): Charset {
  const l = label.toLowerCase().replace(/_/g, '-');
  if (l.includes('utf-8') || l === 'utf8') {
    return 'utf-8';
  }
  if (l.includes('gb18030')) {
    return 'gb18030';
  }
  if (l.includes('gbk') || l.includes('gb2312')) {
    return 'gbk';
  }
  if (l.includes('big5')) {
    return 'big5';
  }
  return 'utf-8';
}

/**
 * 按编码解码二进制
 * @param buffer - 原始字节
 * @param charset - 编码（gbk 使用 gb18030 超集解码）
 */
export function decodeBuffer(buffer: Buffer, charset: Charset): string {
  const resolved = charset === 'auto' ? sniffCharset(buffer) : charset;
  const label =
    resolved === 'gbk' || resolved === 'gb18030' ? 'gb18030' : resolved === 'big5' ? 'big5' : 'utf-8';
  if (label === 'utf-8' && buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  return new TextDecoder(label).decode(buffer);
}
