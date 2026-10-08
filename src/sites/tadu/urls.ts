const HOSTS = new Set(['tadu.com', 'www.tadu.com']);

/**
 * 判断 hostname 是否精确属于塔读（不做子串匹配）
 * @param hostname - 主机名
 */
export function isTaduHost(hostname: string): boolean {
  return HOSTS.has(hostname.toLowerCase());
}

/**
 * 目录页 URL
 * @param bookId - 书号
 */
export function catalogueUrl(bookId: string): string {
  return `https://www.tadu.com/book/catalogue/${bookId}`;
}

/**
 * 书籍详情页 URL
 * @param bookId - 书号
 */
export function bookUrl(bookId: string): string {
  return `https://www.tadu.com/book/${bookId}`;
}

/**
 * 章节页 URL
 * @param bookId - 书号
 * @param chapterId - 章节 ID
 */
export function chapterUrl(bookId: string, chapterId: string): string {
  return `https://www.tadu.com/book/${bookId}/${chapterId}/`;
}

export interface TaduInput {
  bookId: string;
  /** 若输入本身是章节页，则带出章节 ID */
  chapterId?: string;
}

/**
 * 解析塔读输入并规范化为书号（可含章节 ID）
 * @param input - 三类受支持 URL 之一
 */
export function parseTaduInput(input: string): TaduInput {
  const url = new URL(input.trim());
  if (!isTaduHost(url.hostname)) {
    throw new Error(`非塔读域名: ${url.hostname}`);
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'book') {
    throw new Error(`无法识别的塔读路径: ${url.pathname}`);
  }
  if (segments[1] === 'catalogue' && /^\d+$/.test(segments[2] ?? '')) {
    return { bookId: segments[2] };
  }
  if (/^\d+$/.test(segments[1] ?? '')) {
    const bookId = segments[1];
    const chapterId = /^\d+$/.test(segments[2] ?? '') ? segments[2] : undefined;
    return { bookId, chapterId };
  }
  throw new Error(`无法从塔读 URL 解析书号: ${input}`);
}
