/**
 * 运行生命周期：统一中断信号，避免传输层各自注册 SIGINT。
 */
export class RunController {
  private readonly abortController = new AbortController();
  private interruptCount = 0;

  /** 贯穿 HTTP、浏览器与章节 worker 的中断信号 */
  readonly signal: AbortSignal;

  constructor() {
    this.signal = this.abortController.signal;
    const onInterrupt = (): void => {
      this.interruptCount++;
      if (this.interruptCount === 1) {
        console.warn('\n收到中断信号，正在停止新章节并保存进度…（再按一次 Ctrl+C 立即退出）');
        this.abortController.abort();
        return;
      }
      process.exit(130);
    };
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onInterrupt);
  }

  /** 用户是否已请求中断 */
  get aborted(): boolean {
    return this.signal.aborted;
  }

  /**
   * 根据章节统计计算进程退出码
   * @param stats - 章节统计
   * @param strict - 是否把可疑/受限视为失败
   */
  static exitCode(
    stats: {
      ok: number;
      restricted: number;
      failed: number;
      suspect: number;
    },
    strict: boolean,
  ): number {
    if (stats.ok === 0) {
      return 3;
    }
    const hasProblems =
      stats.failed > 0 || stats.restricted > 0 || stats.suspect > 0;
    if (hasProblems) {
      return 2;
    }
    return 0;
  }
}
