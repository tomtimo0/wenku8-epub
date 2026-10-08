/** 可稳定标识一本来源书籍 */
export interface SourceRef {
  /** 站点适配器 id，如 wenku8、tadu */
  site: string;
  /** 站点内书号 */
  bookId: string;
  /** 规范化后的入口 URL */
  canonicalUrl: string;
}

/** 章节的公开访问状态 */
export type ChapterAccess = 'public' | 'restricted' | 'unknown';

/** 章节正文中的一个内容块 */
export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'image'; src: string };

/** 一个章节 */
export interface Chapter {
  /** 站点内章节 ID */
  id: string;
  /** 目录中的章节名 */
  title: string;
  /** 规范化后的章节 URL */
  url: string;
  /** 公开访问状态 */
  access: ChapterAccess;
  /** 抓取并解析后填充 */
  blocks: Block[];
  /** 是否为纯插图章（只有图片块） */
  isIllustration: boolean;
  /** 站点声明的期望字数，用于校验正文完整性 */
  expectedCharacters?: number;
  /** 站点声明的发布时间 */
  publishedAt?: string;
  /** 站点私有定位信息（如塔读的 ordinal、resourceUrl） */
  locator?: Record<string, string | number>;
}

/** 一卷 */
export interface Volume {
  /** 卷 ID（无真实卷时为合成值） */
  id: string;
  title: string;
  chapters: Chapter[];
}

/** 一本书 */
export interface Book {
  source: SourceRef;
  /** 等于 source.bookId，迁移期保留 */
  id: string;
  title: string;
  author: string;
  category?: string;
  status?: string;
  lastUpdate?: string;
  length?: string;
  intro?: string;
  coverUrl?: string;
  volumes: Volume[];
}

/** 已下载图片的本地信息 */
export interface ResolvedImage {
  url: string;
  /** EPUB 内相对路径，如 images/116725_1.jpg */
  epubPath: string;
  mediaType: string;
  buffer: Buffer;
  width?: number;
  height?: number;
  failed?: boolean;
}

/** 插图章在卷内的位置策略 */
export type IllusPosition = 'start' | 'end' | 'keep';
