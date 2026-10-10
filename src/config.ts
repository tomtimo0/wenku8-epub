import fs from 'node:fs/promises';
import path from 'node:path';

export interface Book2EpubConfig {
  out?: string;
  format?: 'epub' | 'txt' | 'both';
  delay?: number;
  imageQuality?: number;
  maxImageWidth?: number;
  headless?: boolean;
}

const CONFIG_NAMES = ['book2epub.config.json', '.book2epubrc.json'];

/**
 * 加载项目配置文件（命令行优先）
 * @param cwd - 工作目录
 */
export async function loadConfig(cwd = process.cwd()): Promise<Book2EpubConfig> {
  for (const name of CONFIG_NAMES) {
    const p = path.join(cwd, name);
    try {
      const raw = JSON.parse(await fs.readFile(p, 'utf8')) as Book2EpubConfig;
      return raw;
    } catch {
      // 尝试下一个
    }
  }
  return {};
}
