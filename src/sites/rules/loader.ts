import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { validateSiteRule, type SiteRule } from './schema.js';
import { RuleAdapter, type RuleSource } from './rule-adapter.js';

export interface LoadedRule {
  rule: SiteRule;
  source: RuleSource;
  path: string;
}

const BUILTIN_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'builtin',
);

/**
 * 加载全部规则（builtin → 用户 → learned）
 * @param options - 搜索路径
 */
export async function loadAllRules(options?: {
  cacheRoot?: string;
  extraFile?: string;
  cwd?: string;
}): Promise<LoadedRule[]> {
  const cwd = options?.cwd ?? process.cwd();
  const dirs: Array<{ dir: string; source: RuleSource }> = [
    { dir: BUILTIN_DIR, source: 'builtin' },
    { dir: path.join(cwd, 'rules'), source: 'user' },
    { dir: path.join(os.homedir(), '.book2epub', 'rules'), source: 'user' },
  ];
  if (options?.cacheRoot) {
    dirs.push({
      dir: path.join(options.cacheRoot, 'learned'),
      source: 'learned',
    });
  }
  const byId = new Map<string, LoadedRule>();
  for (const { dir, source } of dirs) {
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      const full = path.join(dir, f);
      const loaded = await loadRuleFile(full, source);
      if (loaded) {
        byId.set(loaded.rule.id, loaded);
      }
    }
  }
  if (options?.extraFile) {
    const loaded = await loadRuleFile(path.resolve(options.extraFile), 'cli');
    if (loaded) {
      byId.set(loaded.rule.id, loaded);
    }
  }
  return [...byId.values()];
}

/**
 * 将规则转为适配器列表
 * @param rules - 已加载规则
 */
export function rulesToAdapters(rules: LoadedRule[]): RuleAdapter[] {
  return rules.map((r) => new RuleAdapter(r.rule, r.source));
}

/**
 * @param filePath - JSON 路径
 * @param source - 来源标记
 */
export async function loadRuleFile(
  filePath: string,
  source: RuleSource,
): Promise<LoadedRule | null> {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    const { rule, issues } = validateSiteRule(raw);
    if (!rule) {
      return null;
    }
    if (issues.length > 0) {
      return null;
    }
    return { rule, source, path: filePath };
  } catch {
    return null;
  }
}

/**
 * 校验规则文件并返回字段级错误
 * @param filePath - JSON 路径
 */
export async function validateRuleFile(filePath: string): Promise<{
  ok: boolean;
  issues: { path: string; message: string }[];
}> {
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  const { rule, issues } = validateSiteRule(raw);
  return { ok: !!rule && issues.length === 0, issues };
}
