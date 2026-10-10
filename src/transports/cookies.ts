import fs from 'node:fs/promises';
import path from 'node:path';
import type { Cookie } from 'playwright';

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * 按站点持久化的 Cookie 容器
 */
export class CookieJar {
  private cookies: StoredCookie[] = [];

  /**
   * @param filePath - cookies.json 路径
   */
  async load(filePath: string): Promise<void> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as StoredCookie[];
      this.cookies = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.cookies = [];
    }
  }

  /**
   * @param filePath - cookies.json 路径
   */
  async save(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(this.cookies, null, 2), 'utf8');
  }

  /**
   * 从 Playwright 会话导入 Cookie
   * @param cookies - 浏览器 Cookie 列表
   */
  importPlaywright(cookies: Cookie[]): void {
    this.cookies = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }));
  }

  /**
   * 生成请求用的 Cookie 头
   * @param url - 目标 URL
   */
  cookieHeader(url: string): string | undefined {
    const host = new URL(url).hostname;
    const matching = this.cookies.filter((c) => {
      const d = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
      return host === d || host.endsWith(`.${d}`);
    });
    if (matching.length === 0) {
      return undefined;
    }
    return matching.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * 合并 Set-Cookie 响应头
   * @param url - 响应 URL
   * @param setCookie - Set-Cookie 头（可能多条）
   */
  absorbSetCookie(url: string, setCookie: string | string[] | null): void {
    if (!setCookie) {
      return;
    }
    const lines = Array.isArray(setCookie) ? setCookie : [setCookie];
    const host = new URL(url).hostname;
    for (const line of lines) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      this.cookies = this.cookies.filter((c) => c.name !== name || c.domain !== host);
      this.cookies.push({ name, value, domain: host, path: '/' });
    }
  }
}

/**
 * 站点 Cookie 文件路径
 * @param cacheRoot - 缓存根
 * @param siteId - 站点 id
 */
export function siteCookiesPath(cacheRoot: string, siteId: string): string {
  return path.join(cacheRoot, 'sites', siteId, 'cookies.json');
}
