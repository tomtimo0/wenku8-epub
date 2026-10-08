import type { SitePolicy } from '../../site.js';

/**
 * 塔读合规策略。
 *
 * 依据调研（TADU_RESEARCH.md）：官方用户协议禁止未经书面许可以爬虫/自动程序读取、
 * 复制、存储站点内容。因此在取得书面许可前，该适配器默认禁用，且不提供正文下载。
 */
export const TADU_POLICY: SitePolicy = {
  requiresWrittenPermission: true,
  enabled: false,
  notice:
    '塔读适配器默认禁用：官方用户协议禁止未经书面许可的自动读取/复制/存储。' +
    '取得书面许可后，使用 --acknowledge-permission 显式确认方可运行结构性解析；' +
    '正文下载仍不提供。',
};

/** 缺少书面许可时返回的受限度原因 */
export const TADU_PERMISSION_REASON = '缺少塔读书面许可，未实现正文下载';
