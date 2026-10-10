import type { ScrapeErrorKind } from '../core/errors.js';

export interface ClassifyInput {
  status: number;
  headers: Record<string, string>;
  text: string;
}

/**
 * 根据 HTTP 响应判断错误类别（200 时检查常见质询/错误页）
 * @param input - 响应摘要
 */
export function classifyHttpResponse(input: ClassifyInput): ScrapeErrorKind | null {
  const h = input.headers;
  if (input.status === 429 || h['retry-after']) {
    return 'rate-limited';
  }
  if (input.status >= 500) {
    return 'transient';
  }
  if (input.status === 0) {
    return 'transient';
  }
  const cf =
    h['cf-mitigated'] ||
    /challenge-platform/i.test(input.text) ||
    /<title>\s*Just a moment/i.test(input.text);
  if (cf) {
    return 'challenge';
  }
  if (input.status === 200) {
    const titleMatch = input.text.match(/<title[^>]*>([^<]*)</i);
    const title = titleMatch?.[1]?.trim() ?? '';
    if (/出错了|404|页面不存在|Not Found/i.test(title)) {
      return 'semantic';
    }
  }
  return null;
}
