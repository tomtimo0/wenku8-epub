import { loadAllRules, validateRuleFile } from '../sites/rules/loader.js';

/**
 * 列出全部规则
 * @param cacheRoot - 缓存根
 */
export async function runRulesList(cacheRoot: string): Promise<void> {
  const rules = await loadAllRules({ cacheRoot });
  if (rules.length === 0) {
    console.log('（无规则）');
    return;
  }
  for (const r of rules) {
    console.log(`${r.rule.id}\t${r.source}\t${r.rule.name}\tv${r.rule.version}\t${r.path}`);
  }
}

/**
 * 校验规则文件
 * @param file - JSON 路径
 */
export async function runRulesValidate(file: string): Promise<number> {
  const { ok, issues } = await validateRuleFile(file);
  if (ok) {
    console.log('规则合法');
    return 0;
  }
  for (const i of issues) {
    console.error(`${i.path}: ${i.message}`);
  }
  return 1;
}
