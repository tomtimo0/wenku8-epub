import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 磁盘内容缓存：以站点 + 书号为命名空间
 */
export class ContentCache {
  /**
   * @param rootDir - 缓存根目录，如 .cache
   */
  constructor(private readonly rootDir: string) {}

  /**
   * 解析相对缓存键为绝对路径
   * @param key - 相对路径
   */
  pathFor(key: string): string {
    return path.join(this.rootDir, key);
  }

  /**
   * 读取文本，缺失或失败返回 null
   * @param key - 相对路径
   */
  async readText(key: string): Promise<string | null> {
    try {
      return await fs.readFile(this.pathFor(key), 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * 写入文本
   * @param key - 相对路径
   * @param data - 内容
   */
  async writeText(key: string, data: string): Promise<void> {
    const p = this.pathFor(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, 'utf8');
  }

  /**
   * 读取 JSON，缺失或解析失败返回 null
   * @param key - 相对路径
   */
  async readJson<T>(key: string): Promise<T | null> {
    const text = await this.readText(key);
    if (text === null) {
      return null;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  /**
   * 写入 JSON
   * @param key - 相对路径
   * @param data - 数据
   */
  async writeJson(key: string, data: unknown): Promise<void> {
    await this.writeText(key, JSON.stringify(data, null, 2));
  }

  /**
   * 读取二进制，缺失返回 null
   * @param key - 相对路径
   */
  async readBuffer(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  /**
   * 写入二进制
   * @param key - 相对路径
   * @param data - 数据
   */
  async writeBuffer(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  }
}

/** 站点 + 书号级缓存键前缀 */
export function bookCachePrefix(site: string, bookId: string): string {
  return `books/${site}/${bookId}`;
}

/** 浏览器 profile 目录 */
export function browserProfileDir(site: string): string {
  return `sites/${site}/browser-profile`;
}
