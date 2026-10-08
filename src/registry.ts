import type { SiteAdapter } from './site.js';
import { Wenku8Adapter } from './sites/wenku8/index.js';
import { TaduAdapter } from './sites/tadu/index.js';

export interface AdapterSelection {
  adapter: SiteAdapter;
  /** 非致命提示，如弃用警告 */
  notice?: string;
}

/**
 * 内置适配器（按优先级从高到低）
 */
export function defaultAdapters(): SiteAdapter[] {
  return [new Wenku8Adapter(), new TaduAdapter()];
}

/**
 * 按匹配分数选择唯一站点适配器
 * @param input - URL 或书号
 * @param adapters - 候选适配器
 * @param forcedSite - 显式指定的站点 id
 */
export function selectAdapter(
  input: string,
  adapters: SiteAdapter[],
  forcedSite?: string,
): AdapterSelection {
  if (forcedSite) {
    const found = adapters.find((a) => a.id === forcedSite);
    if (!found) {
      throw new Error(
        `未知站点 "${forcedSite}"，可用：${adapters.map((a) => a.id).join(', ')}`,
      );
    }
    return { adapter: found };
  }

  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    const fallback = adapters.find((a) => a.id === 'wenku8');
    if (!fallback) {
      throw new Error('纯数字输入需要 --site 指定站点');
    }
    return {
      adapter: fallback,
      notice:
        '纯数字输入默认按 wenku8 处理（弃用）；建议改用 --site wenku8 <书号>',
    };
  }

  const scored = adapters
    .map((adapter) => ({ adapter, score: adapter.match(trimmed) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    throw new Error(
      `无法识别输入来源：${input}。请使用 --site 指定站点，或提供受支持站点的 URL。`,
    );
  }
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    throw new Error(
      `输入同时匹配多个站点（${scored
        .filter((s) => s.score === scored[0].score)
        .map((s) => s.adapter.id)
        .join(', ')}），请用 --site 指定。`,
    );
  }
  return { adapter: scored[0].adapter };
}

/**
 * 检查适配器合规门禁是否允许运行
 * @param adapter - 站点适配器
 * @param acknowledgePermission - 用户是否显式确认已获许可
 */
export function assertAdapterAllowed(
  adapter: SiteAdapter,
  acknowledgePermission: boolean,
): void {
  const policy = adapter.policy;
  if (!policy?.requiresWrittenPermission) {
    return;
  }
  if (!acknowledgePermission) {
    throw new Error(
      `${adapter.displayName} 适配器默认禁用。${policy.notice ?? ''}`,
    );
  }
}
