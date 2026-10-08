/**
 * URL 安全工具：仅允许 http/https 且非私网/保留地址，并支持安全重定向。
 * 说明：私网判断为字面判断（不做 DNS 解析），用于阻止常见的 SSRF 目标。
 */

/** 私网/保留地址的字面前缀 */
const PRIVATE_HOST_RE =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|::1$|\[::1\]$)/i;

/**
 * 判断 hostname 是否属于私网/保留地址
 * @param hostname - 主机名（不含端口）
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return true;
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  return false;
}

/**
 * 判断 URL 是否可安全访问（仅 http(s) 且非私网）
 * @param url - 目标 URL
 */
export function isSafeHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return !isPrivateHostname(parsed.hostname);
}

export type RedirectCheck =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/**
 * 计算安全的重定向目标（纯函数，不发起请求）
 * @param status - HTTP 状态码
 * @param location - Location 响应头
 * @param currentUrl - 当前 URL
 */
export function nextRedirectUrl(
  status: number,
  location: string | null,
  currentUrl: string,
): RedirectCheck {
  if (status < 300 || status >= 400) {
    return { ok: false, reason: `非重定向状态码 ${status}` };
  }
  if (!location) {
    return { ok: false, reason: '重定向缺少 Location 头' };
  }
  let next: string;
  try {
    next = new URL(location, currentUrl).href;
  } catch {
    return { ok: false, reason: `非法 Location: ${location}` };
  }
  if (!isSafeHttpUrl(next)) {
    return { ok: false, reason: `重定向到不安全地址: ${next}` };
  }
  return { ok: true, url: next };
}

export interface SafeFetchOptions {
  /** 最大重定向次数，默认 5 */
  maxRedirects?: number;
  signal?: AbortSignal;
}

/**
 * 手动跟随重定向的 fetch：每一跳都校验目标地址，阻止跳转到私网/非 http(s)。
 * 遇到不安全重定向直接抛错，不返回敏感响应。
 * @param url - 起始 URL
 * @param init - fetch 参数（redirect 会被强制为 manual）
 * @param options - 重定向上限与中断信号
 */
export async function fetchWithSafeRedirects(
  url: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    if (!isSafeHttpUrl(current)) {
      throw new Error(`不安全的地址: ${current}`);
    }
    const res = await fetch(current, {
      ...init,
      redirect: 'manual',
      signal: options.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const decision = nextRedirectUrl(
        res.status,
        res.headers.get('location'),
        current,
      );
      if (!decision.ok) {
        throw new Error(decision.reason);
      }
      current = decision.url;
      continue;
    }
    return res;
  }
  throw new Error(`重定向次数超过上限 ${maxRedirects}`);
}
