const BASE = 'https://www.wenku8.net';
const HOSTS = new Set(['www.wenku8.net', 'wenku8.net', 'wenku8.com', 'www.wenku8.com']);

/**
 * 判断 hostname 是否属于 wenku8
 * @param hostname - 主机名
 */
export function isWenku8Host(hostname: string): boolean {
  return HOSTS.has(hostname.toLowerCase());
}

/**
 * 书号对应的路径前缀（floor(bookId/1000)）
 * @param bookId - 书籍 ID
 */
export function bookPathSegment(bookId: string): string {
  const n = Number.parseInt(bookId, 10);
  return String(Math.floor(n / 1000));
}

/**
 * 目录页 URL
 * @param bookId - 书籍 ID
 */
export function indexPageUrl(bookId: string): string {
  const seg = bookPathSegment(bookId);
  return `${BASE}/novel/${seg}/${bookId}/index.htm`;
}

/**
 * 书籍信息页 URL
 * @param bookId - 书籍 ID
 */
export function bookInfoPageUrl(bookId: string): string {
  return `${BASE}/book/${bookId}.htm`;
}

/**
 * 章节页 URL
 * @param bookId - 书籍 ID
 * @param chapterId - 章节 ID
 */
export function chapterPageUrl(bookId: string, chapterId: string): string {
  const seg = bookPathSegment(bookId);
  return `${BASE}/novel/${seg}/${bookId}/${chapterId}.htm`;
}

/**
 * 封面图 URL
 * @param bookId - 书籍 ID
 * @param large - 是否尝试大图（去掉 s）
 */
export function coverImageUrl(bookId: string, large = false): string {
  const seg = bookPathSegment(bookId);
  const suffix = large ? '' : 's';
  return `http://img.wenku8.com/image/${seg}/${bookId}/${bookId}${suffix}.jpg`;
}

/**
 * 从用户输入解析书号
 * @param input - URL 或纯数字书号
 */
export function parseBookId(input: string): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  const novelMatch = trimmed.match(/\/novel\/\d+\/(\d+)\//i);
  if (novelMatch) {
    return novelMatch[1];
  }
  const bookMatch = trimmed.match(/\/book\/(\d+)\.htm/i);
  if (bookMatch) {
    return bookMatch[1];
  }
  throw new Error(`无法从输入解析 wenku8 书号: ${input}`);
}
