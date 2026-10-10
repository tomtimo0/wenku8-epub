/** 取值描述：CSS 选择器，可指定属性、正则提取或 meta 名称 */
export type ValueSpec =
  | string
  | {
      selector?: string;
      attr?: string;
      meta?: string;
      regex?: string;
      join?: string;
    };

/** 一个站点的声明式抓取规则 */
export interface SiteRule {
  id: string;
  name: string;
  version: string;
  match: { hosts: string[]; path?: string };
  charset?: 'auto' | 'utf-8' | 'gbk' | 'gb18030' | 'big5';
  fetch?: {
    catalogue?: 'http' | 'browser';
    chapter?: 'http' | 'browser';
    minIntervalMs?: number;
    headers?: Record<string, string>;
    waitFor?: string;
  };
  entry?: {
    rewrite?: Array<{ from: string; to: string }>;
    catalogueLink?: string;
  };
  book: {
    title: ValueSpec;
    author?: ValueSpec;
    intro?: ValueSpec;
    cover?: ValueSpec;
    status?: ValueSpec;
    category?: ValueSpec;
  };
  catalogue: {
    root?: string;
    volume?: string;
    chapter: string;
    nextPage?: string;
    order?: 'asc' | 'desc';
    skipFirst?: number;
  };
  chapter: {
    content: string;
    remove?: string[];
    nextPage?: { selector: string; samePattern?: string };
    paragraphMode?: 'auto' | 'block' | 'br';
    wall?: string[];
    dropLines?: string[];
    visualOrder?: boolean;
  };
  errorPage?: { title?: string; selector?: string };
  assets?: { referer?: 'origin' | 'page' | string };
}

export interface RuleValidationIssue {
  path: string;
  message: string;
}

/**
 * 校验规则 JSON 结构
 * @param raw - 解析后的对象
 */
export function validateSiteRule(raw: unknown): {
  rule?: SiteRule;
  issues: RuleValidationIssue[];
} {
  const issues: RuleValidationIssue[] = [];
  if (!raw || typeof raw !== 'object') {
    return { issues: [{ path: '', message: '根节点必须是对象' }] };
  }
  const o = raw as Record<string, unknown>;
  requireString(o, 'id', issues);
  requireString(o, 'name', issues);
  requireString(o, 'version', issues);
  if (!o.match || typeof o.match !== 'object') {
    issues.push({ path: 'match', message: '缺少 match' });
  } else {
    const m = o.match as Record<string, unknown>;
    if (!Array.isArray(m.hosts) || m.hosts.length === 0) {
      issues.push({ path: 'match.hosts', message: 'hosts 必须为非空数组' });
    }
  }
  if (!o.book || typeof o.book !== 'object') {
    issues.push({ path: 'book', message: '缺少 book' });
  } else if (!(o.book as Record<string, unknown>).title) {
    issues.push({ path: 'book.title', message: '缺少 book.title' });
  }
  if (!o.catalogue || typeof o.catalogue !== 'object') {
    issues.push({ path: 'catalogue', message: '缺少 catalogue' });
  } else if (!(o.catalogue as Record<string, unknown>).chapter) {
    issues.push({ path: 'catalogue.chapter', message: '缺少 catalogue.chapter' });
  }
  if (!o.chapter || typeof o.chapter !== 'object') {
    issues.push({ path: 'chapter', message: '缺少 chapter' });
  } else if (!(o.chapter as Record<string, unknown>).content) {
    issues.push({ path: 'chapter.content', message: '缺少 chapter.content' });
  }
  if (issues.length > 0) {
    return { issues };
  }
  return { rule: raw as SiteRule, issues: [] };
}

/**
 * @param obj - 对象
 * @param key - 字段
 * @param issues - 问题列表
 */
function requireString(
  obj: Record<string, unknown>,
  key: string,
  issues: RuleValidationIssue[],
): void {
  if (typeof obj[key] !== 'string' || !(obj[key] as string).trim()) {
    issues.push({ path: key, message: `缺少或非法 ${key}` });
  }
}
