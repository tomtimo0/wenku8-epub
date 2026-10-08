/** 章节正文中的一个内容块 */
export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'image'; src: string };

/** 一个章节 */
export interface Chapter {
  /** 章节 ID，如 "116725" */
  id: string;
  /** 目录中的章节名 */
  title: string;
  /** 抓取并解析后填充 */
  blocks: Block[];
  /** 是否为纯插图章（只有图片块） */
  isIllustration: boolean;
}

/** 一卷 */
export interface Volume {
  /** td.vcss 的 vid */
  id: string;
  title: string;
  chapters: Chapter[];
}

/** 一本书 */
export interface Book {
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
