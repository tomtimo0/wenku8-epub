/** 单章在 run.json 中的记录 */
export interface ChapterRunRecord {
  status: 'pending' | 'ok' | 'restricted' | 'failed' | 'suspect';
  attempts: number;
  lastError?: string;
  fetchedAt?: string;
}

/** 一本书的运行状态清单 */
export interface BookRunState {
  bookId: string;
  site: string;
  updatedAt: string;
  chapters: Record<string, ChapterRunRecord>;
}

/**
 * 更新章节运行记录
 * @param state - 当前状态
 * @param chapterId - 章节 ID
 * @param patch - 要合并的字段
 */
export function patchChapterRun(
  state: BookRunState,
  chapterId: string,
  patch: Partial<ChapterRunRecord>,
): void {
  const prev = state.chapters[chapterId] ?? { status: 'pending', attempts: 0 };
  state.chapters[chapterId] = {
    ...prev,
    ...patch,
    attempts: patch.attempts ?? prev.attempts,
  };
  state.updatedAt = new Date().toISOString();
}

/**
 * 创建空的运行状态
 * @param site - 站点 id
 * @param bookId - 书号
 */
export function emptyRunState(site: string, bookId: string): BookRunState {
  return {
    site,
    bookId,
    updatedAt: new Date().toISOString(),
    chapters: {},
  };
}
