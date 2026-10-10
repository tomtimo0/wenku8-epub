# book2epub 路线图：从多站点工具到通用小说爬取器

> 面向接手实现的 agent。本文是项目**唯一的规划文档**；现状结构见 [ARCHITECTURE.md](ARCHITECTURE.md)，站点细节见 [sites/](sites/)。
> 验收日期：2026-10-10，基线提交 `aa2ab65`。

## 0. 目标与完成定义

目标：给定一个小说网站的目录页、书籍页或章节页 URL，工具能自动产出**排版正确、章节完整、带插图**的 EPUB（附带 TXT 选项）；失败时给出可操作的诊断，而不是残缺文件。

完成定义（全部满足才算完成）：

1. **已适配站点**（wenku8、tadu 及第 4 节新增的规则站点）：整本运行一次成功，章节成功率 ≥ 99%，每章字数与站点声明偏差在阈值内，EPUB 通过结构校验与 epubcheck。
2. **未适配站点**：启发式探测要么生成合格的 EPUB 并把学到的规则存盘复用，要么以明确原因拒绝；不出现"静默缺章"。
3. **鲁棒性**：Ctrl+C 后能干净退出并断点续抓；网络抖动、限流、Cloudflare 质询、200 错误页、编码差异都有对应处理；重复运行只抓新增章节。
4. **结果可判定**：退出码区分全部成功、部分成功、无产出、用法错误；结束报告列出每个问题章节及原因。

设计边界：工具读取**当前浏览器会话能看到的内容**。需要登录的站点由用户在持久化 profile 中自己登录一次（`book2epub login <site>`），工具复用该会话；不集成验证码破解服务，也不实现付费内容解锁。

---

## 1. 验收结果

### 1.1 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm test` | 7 个文件 58 个用例全部通过 |
| `npx tsc --noEmit` / `npm run build` | 通过 |
| `.gitignore` | `.cache/`、`output/`、`dist/`、`scaffold/`、`*.epub` 均已忽略，仓库中无抓取产物 |

### 1.2 端到端实测

| 场景 | 命令 | 结果 |
| --- | --- | --- |
| wenku8 | `<目录URL> --limit-chapters 2 --no-images --refresh` | **通过**。识别 8 卷 58 章，2 章成功，生成 EPUB：`mimetype` 位于首条目，有封面，正文非空 |
| 塔读（默认） | `<目录URL> --limit-chapters 2` | **失败**：策略门禁直接拒绝运行 |
| 塔读（加 `--acknowledge-permission`） | 同上 | **假成功**：识别 122 章，但 2 章全部"受限"，写出 0 字 EPUB，退出码仍为 0 |
| 通用探测 | `inspect <塔读目录URL>` | **误判**：判为"可抓取"，但选中外层 `#content`（1675 字），真实正文 `#partContent` 只有约 1034 字；封面取到懒加载占位图；作者未识别 |

结论：项目骨架（适配器、缓存、EPUB、SSRF 防护）质量可以，但**只有 wenku8 能产出最终结果**，离"通用"还差规则层、启发式质量和若干鲁棒性缺陷。

### 1.3 缺陷清单

| 编号 | 位置 | 问题 | 处理（工作包） |
| --- | --- | --- | --- |
| D1 | `sites/tadu/policy.ts`、`adapter.ts`、`registry.assertAdapterAllowed` | 塔读被许可门禁禁用，`fetchChapter` 固定返回受限，正文从未实现 | 删除门禁，实现正文（W2） |
| D2 | `orchestrator.ts` | 0 章成功仍写 EPUB、退出码 0；进度行对受限/失败章节也打 ✓ | 退出码与产出判定（W1） |
| D3 | `tadu/parse-rendered-chapter.ts` | `data-limit` 是 Base64，代码拿原值和 chapterId 比较，推广段永远剔除不掉 | 先解码再比较（W2） |
| D4 | `orchestrator.ts` + `transports/browser.ts` | `--concurrency 2` 时两个 worker 共用同一个 Page，`page.goto` 互相覆盖 | 页面池（W3） |
| D5 | `transports/browser.ts` | 注册 `SIGINT` 监听会取消 Node 默认退出；Ctrl+C 只关浏览器，主流程继续跑并连环报错 | 统一 `AbortController`（W1） |
| D6 | `sites/generic/*` | 编码写死 UTF-8（GBK 站乱码）；正文选最外层容器；封面取占位图；无目录分页、章内分页、卷识别；`--accept-detected` 硬限 3 章 | 启发式 v2（W5） |
| D7 | `sites/wenku8/adapter.ts` | 旧版 HTML 缓存绕过 `--refresh` | `refresh` 时跳过旧缓存（W1） |
| D8 | `epub/builder.ts` | 部分抓取时没有章节的卷仍生成卷标题页（实测 8 个卷页只配 2 章） | 跳过空卷（W6） |
| D9 | `orchestrator.ts` | 无论是否需要都启动 Chrome；HTTP-only 流程也依赖浏览器 | 浏览器懒启动（W3） |
| D10 | `transports/http.ts` | 无重试、无 Cookie、无编码嗅探、无质询/错误页识别 | HTTP 传输重写（W3） |
| D11 | `scaffold.ts` | 生成的 TS 骨架需要手工补代码，新增站点成本高 | 规则引擎取代（W4） |
| D12 | `orchestrator.ts` | 章节前的 `jitterDelay` 与 HTTP 层限速叠加，实际间隔翻倍 | 限速只留在传输层（W3） |

---

## 2. 目标架构

### 2.1 三级适配

```
输入 URL
  │
  ├─ 1. 手写适配器（TypeScript）    站点有特殊机制：Cloudflare、正文 JSON、打乱顺序……  wenku8、tadu
  ├─ 2. 声明式规则（JSON）          普通站点：选择器 + 少量开关即可描述              rules/*.json
  └─ 3. 启发式探测                  完全陌生站点：自动推断，达标后产出一份规则存盘    learned/*.json
```

选择优先级：`--rule <file>` > 用户规则目录 > 手写适配器 > 内置规则 > 已学习规则 > 启发式。规则与启发式都通过同一个 `RuleAdapter` 执行，所以启发式的产出天然可复用、可人工修改。

### 2.2 目标目录

```
src/
  core/
    types.ts            领域模型（现 src/types.ts）
    site.ts             SiteAdapter 接口（删除 SitePolicy）
    errors.ts           ScrapeError 分类
    run.ts              RunController：AbortSignal、退出码、事件总线
    orchestrator.ts
    run-state.ts        章节状态清单（run.json）
  transports/
    http.ts             重试、Cookie jar、编码嗅探、质询识别
    browser.ts          懒启动、页面池、Cookie 同步
    cache.ts
    classify.ts         响应分类（质询/遮挡/错误页/限流）
  extract/
    dom-text.ts         元素 → Block[]（段落/br/图片，含视觉顺序）
    boilerplate.ts      跨章节重复行学习
    normalize.ts
  sites/
    wenku8/  tadu/      手写适配器
    rules/
      schema.ts         SiteRule 类型与校验
      rule-adapter.ts   执行规则
      builtin/*.json    内置规则
    generic/            启发式：产出 SiteRule
  output/
    epub/  txt/
  cli/
    index.ts  commands/{convert,inspect,learn,login,update,doctor,rules}.ts
```

迁移按"先移动、后改动"：每次移动文件单独提交，保证 `npm test` 全绿。

### 2.3 核心接口调整

```ts
/** 站点适配器能力声明，供编排层决定并发与传输 */
export interface AdapterCapabilities {
  /** 章节抓取是否需要独占浏览器页面 */
  chapterNeedsPage: boolean;
  /** 是否需要启动浏览器（false 时编排层不启动 Chrome） */
  needsBrowser: boolean;
  /** 建议的每主机最小请求间隔（毫秒） */
  minIntervalMs: number;
  /** 允许的最大章节并发 */
  maxConcurrency: number;
}

/** 一个网站的完整适配器 */
export interface SiteAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly parserVersion: string;
  readonly capabilities: AdapterCapabilities;
  match(input: string): number;
  resolve(input: string, ctx: ScrapeContext): Promise<SourceRef>;
  fetchBook(ref: SourceRef, ctx: ScrapeContext): Promise<Book>;
  fetchChapter(book: Book, chapter: Chapter, ctx: ScrapeContext): Promise<ChapterFetchResult>;
  assetRequest(url: string, book: Book): AssetRequest;
  coverCandidates?(book: Book): string[];
}
```

`resolve` 增加 `ctx` 参数，以便从章节页 URL 反查目录页（需要发请求）。

---

## 3. 工作包

### W1 核心鲁棒性（修 D2、D5、D7）

**错误分类**（`core/errors.ts`）：

```ts
/** 抓取错误类别，决定是否重试、是否中止整本 */
export type ScrapeErrorKind =
  | 'transient'      // 5xx、超时、连接重置：退避重试
  | 'rate-limited'   // 429 或频控提示：退避并调大间隔
  | 'challenge'      // Cloudflare/JS 质询：切浏览器或提示有头人工验证
  | 'access-wall'    // 登录/扫码/订阅遮挡：标记 restricted，提示 login
  | 'semantic'       // 200 但是错误页或预期结构缺失：不重试
  | 'parse-empty'    // 结构在但正文为空：不重试，提示站点改版
  | 'aborted';       // 用户中断

/** 带类别的抓取错误 */
export class ScrapeError extends Error {
  /**
   * @param kind - 错误类别
   * @param message - 可读信息
   * @param retryAfterMs - 服务端建议的等待时间
   */
  constructor(
    readonly kind: ScrapeErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}
```

重试策略集中在编排层：`transient` 和 `rate-limited` 指数退避（2s/4s/8s，`rate-limited` 同时把该主机间隔翻倍、上限 30s，连续成功 20 章后逐步恢复）；`challenge` 交给传输层处理一次后再重试；其余不重试。

**中断**（`core/run.ts`）：`RunController` 持有唯一的 `AbortController`，只在这里监听 `SIGINT`/`SIGTERM`。第一次 Ctrl+C：停止派发新章节，等待进行中的章节完成并落盘，关闭浏览器，以退出码 130 结束；第二次 Ctrl+C 立即退出。删除 `BrowserTransport.start()` 里的信号监听。`signal` 贯穿 HTTP、浏览器和图片下载。

**运行状态**（`core/run-state.ts`）：`.cache/books/{site}/{bookId}/run.json` 记录每章 `status`、`attempts`、`lastError`、`fetchedAt`。提供 `--retry-failed`（只重抓失败章）和 `--only <章节范围>`。

**产出判定与退出码**：

| 退出码 | 含义 |
| --- | --- |
| 0 | 所有目标章节成功 |
| 2 | 部分成功：已生成 EPUB，但有失败/受限/可疑章节 |
| 3 | 无产出：0 章成功，**不写 EPUB** |
| 1 | 用法错误或致命错误 |
| 130 | 用户中断 |

`--strict` 把"可疑"和"受限"也计为失败。进度行改为 `[12/122] 第十二章 ✓ / ⊘ 受限 / ✗ 失败：原因 / ⚠ 可疑`，带累计耗时与预计剩余时间；`--json-log` 输出 NDJSON 事件，便于其他程序调用。

**D7**：wenku8 读取旧缓存前检查 `refresh`。

### W2 塔读正文（修 D1、D3）

1. 删除 `src/sites/tadu/policy.ts`、`SitePolicy`、`PolicyError`、`assertAdapterAllowed`、CLI 的 `--acknowledge-permission`，以及相关测试与 README 段落。
2. `capabilities = { needsBrowser: true, chapterNeedsPage: true, minIntervalMs: 1500, maxConcurrency: 2 }`。
3. `fetchChapter`：
   - 从页面池借一个 Page，`goto(chapter.url, { waitUntil: 'domcontentloaded' })`；
   - `waitForFunction`：`#partContent p` 出现，或 `.shelter` 出现，或 15 秒超时；
   - 出现 `.shelter`、或正文为空且 `canReadFlag` 不为 `1` → `access-wall`，原因提示"运行 `book2epub login tadu` 后重试"；
   - 页面内提取：遍历 `#partContent` 子元素，按 `getBoundingClientRect().top` 排序（防御 CSS 视觉重排），把 `atob(data-limit)` 等于当前 `chapterId` 的段落剔除，返回 `{ html, paragraphs: [{ limitDecoded, text }] }`；
   - Node 侧用 `parseTaduRenderedChapter` 归一化（改为接收解码后的 limit）；
   - 字数校验：与 `expectedCharacters` 比较，偏差超过 `max(80, expected × 8%)` 记为可疑。
4. `data-needimagepart="1"` 的章节：返回 `parse-empty`，原因"图片化正文，暂不支持"，并在报告里单列。
5. 详情页解析改为优先 Open Graph（`og:novel:*`、`og:image`），DOM 兜底。
6. 新增 `login` 命令（W7）：有头打开站点首页，用户登录后回车，profile 保存在 `.cache/sites/tadu/browser-profile`。

验收：样本书 `--limit-chapters 5` 生成 EPUB，每章字数偏差在阈值内、无推广段；登录后整本 122 章成功率 ≥ 99%；未登录时约 30 章后的章节被标为受限且退出码为 2。

### W3 传输层（修 D4、D9、D10、D12）

**HTTP**（`transports/http.ts`）：

- Cookie jar（按域名存储，持久化到 `.cache/sites/{site}/cookies.json`），可从浏览器 context 导入（`context.cookies()`），使"浏览器过质询、HTTP 批量抓"成为可能；导入时 User-Agent 必须同步为浏览器的 UA。
- 编码嗅探，顺序：`Content-Type` 的 charset → BOM → 前 4KB 中的 `<meta charset>` / `http-equiv` → 用 `TextDecoder('utf-8', { fatal: true })` 试解码 → 失败则 `gb18030`。`Charset` 类型扩展为 `'auto' | 'utf-8' | 'gbk' | 'gb18030' | 'big5'`，默认 `auto`。注意 `gbk` 统一用 `gb18030` 解码（超集，避免生僻字乱码）。
- 每次响应交给 `classify.ts`：Cloudflare（`cf-mitigated`、`<title>Just a moment`、`challenge-platform`）→ `challenge`；`429` 或 `Retry-After` → `rate-limited`；`5xx`/超时 → `transient`；规则或适配器提供的"错误页标记"（如标题含"出错了""404"）→ `semantic`。
- 限速只在这里做（每主机最小间隔 + ±30% 抖动），编排层删除 `jitterDelay`。
- 所有请求经 `fetchWithSafeRedirects`，统一 SSRF 防护。

**浏览器**（`transports/browser.ts`）：

- 懒启动：首次 `getPage()` 时才启动 Chrome；`needsBrowser: false` 的流程完全不碰 Playwright。
- 页面池：`acquirePage()` / `releasePage()`，大小等于实际并发；页面崩溃或导航超时时丢弃并新建。
- `ensureChallengePassed(url)`：无头模式检测到质询时，自动以有头模式重启同一 profile 并提示用户手动验证（最多等 180 秒），通过后切回无头，并把 Cookie 同步给 HTTP。
- 拦截图片、字体、媒体请求（`page.route`），加快正文渲染；需要图片时由 Node 侧单独下载。
- `doctor` 命令检查：本机 Chrome、Playwright 浏览器是否已安装、`sharp` 是否可加载。

### W4 声明式规则引擎（取代 D11）

**规则结构**（`sites/rules/schema.ts`，规则文件为 JSON，加载时做严格校验并给出字段级错误）：

```ts
/** 取值描述：CSS 选择器，可指定属性、正则提取或 meta 名称 */
export type ValueSpec =
  | string
  | { selector?: string; attr?: string; meta?: string; regex?: string; join?: string };

/** 一个站点的声明式抓取规则 */
export interface SiteRule {
  id: string;
  name: string;
  /** 规则版本，变化时使章节缓存失效 */
  version: string;
  match: { hosts: string[]; path?: string };
  charset?: 'auto' | 'utf-8' | 'gbk' | 'gb18030' | 'big5';
  fetch?: {
    catalogue?: 'http' | 'browser';
    chapter?: 'http' | 'browser';
    minIntervalMs?: number;
    headers?: Record<string, string>;
    /** 页面渲染完成的判定选择器（browser 模式） */
    waitFor?: string;
  };
  /** 从书籍页/章节页定位目录页 */
  entry?: {
    rewrite?: Array<{ from: string; to: string }>;
    catalogueLink?: string;
  };
  book: {
    title: ValueSpec;
    author?: ValueSpec;
    intro?: ValueSpec;
    cover?: ValueSpec;
    status?: ValueSpec;
    category?: ValueSpec;
  };
  catalogue: {
    /** 目录根容器，限定后续选择器范围 */
    root?: string;
    /** 卷标题元素；与章节链接按文档顺序交错出现 */
    volume?: string;
    chapter: string;
    /** 目录分页的"下一页"链接 */
    nextPage?: string;
    /** 站点目录倒序时设为 desc */
    order?: 'asc' | 'desc';
    /** 跳过目录顶部"最新章节"区块的前 N 个链接 */
    skipFirst?: number;
  };
  chapter: {
    content: string;
    /** 提取前删除的节点 */
    remove?: string[];
    /** 章内分页："下一页"链接；仅当目标 URL 匹配 samePattern 时视为同一章 */
    nextPage?: { selector: string; samePattern?: string };
    /** 段落切分：块级元素或 <br> */
    paragraphMode?: 'auto' | 'block' | 'br';
    /** 出现即判为访问遮挡 */
    wall?: string[];
    /** 整行匹配即丢弃 */
    dropLines?: string[];
    /** 按视觉位置排序段落（防 CSS 重排） */
    visualOrder?: boolean;
  };
  /** 200 状态下的错误页标记 */
  errorPage?: { title?: string; selector?: string };
  assets?: { referer?: 'origin' | 'page' | string };
}
```

**`RuleAdapter`**：一个类执行任意 `SiteRule`，复用 W3 传输层与 `extract/dom-text.ts`。章内分页循环上限 50 页并检测 URL 环路；目录分页上限 200 页；章节 URL 去重，保持首次出现顺序。

**规则来源**：`src/sites/rules/builtin/*.json`（随包发布）、`~/.book2epub/rules/*.json` 与 `./rules/*.json`（用户）、`.cache/learned/{host}.json`（启发式产出）。`book2epub rules list` 列出全部规则及来源，`rules validate <file>` 校验。

**示范规则**：接手 agent 选 2 个结构不同的公开小说站（建议一个 GBK 静态站、一个章内分页站）各写一份内置规则，各自在 `docs/sites/` 补一页资料、在 `test/fixtures/` 补虚构夹具。wenku8 与塔读保留手写适配器。

`scaffold-adapter` 保留，但改为默认输出规则 JSON；`--typescript` 时才生成 TS 骨架。

### W5 启发式探测 v2（修 D6）

启发式的职责改为**产出一份 `SiteRule`**，然后交给 `RuleAdapter` 执行。

1. **入口判型**：对入口页同时计算"目录分"（章节链接簇规模）和"正文分"（最佳正文候选）。若是章节页，找文本为"目录 / 章节目录 / 返回目录"的链接；若是书籍页且章节簇 < 20 条，找"全部章节 / 查看目录 / 开始阅读"类链接跳转，最多 2 跳。
2. **目录**：
   - 沿用链接簇聚类；增加"最新章节"去重：同一章节 URL 出现两次时保留出现在最大簇里的那次，顶部的小簇丢弃；
   - 卷识别：取最佳簇链接的最近公共祖先容器，在其中按文档顺序找夹在链接之间的标题元素（`h1-h4`、`dt`、`td[colspan]`、类名含 `volume`/`juan`/`vcss` 的元素，且自身不含章节链接）；
   - 倒序识别：簇内数字 ID 或"第 N 章"序号整体递减时翻转；
   - 分页：`a[rel=next]`、文本"下一页 / 下页 / ›"、或 URL 中 `page=N`、`_N.html` 递增模式，最多跟 200 页。
3. **正文**：
   - 候选打分 = 文本字数 ×（1 − 链接密度）× 段落因子；
   - **向下收缩**：若某个子元素包含父元素 ≥ 85% 的有效文本，则改选该子元素，循环到底。这能把塔读这类页面从 `#content` 收缩到 `#partContent`；
   - 提取前删除 `script, style, nav, header, footer, aside, form, iframe`，以及 id/class 匹配 `ad|share|comment|recommend|related|footer|nav|toolbar` 的节点；
   - 章内分页：与目录相同的"下一页"识别，但要求目标 URL 与当前章节 URL 共享 ID 前缀（如 `123.html` → `123_2.html`），否则视为"下一章"。
4. **样板学习**（`extract/boilerplate.ts`）：抽样 3～5 章（首、中、尾），出现在 ≥ 60% 样章中的整行（长度 ≤ 80）写入规则的 `dropLines`；这样能自动去掉"本章未完，点击下一页""请收藏本站"等站点水印。
5. **元数据**：`og:novel:*`、`og:title`、JSON-LD `Book`、`<meta name="author">`，再退到页面上"作者："标签；封面优先 `og:image`、`data-src`、`data-original`，排除含 `default|nocover|placeholder|loading` 的地址。
6. **编码**：使用 W3 的 `auto`。
7. **门槛**：保留现有门槛，另加"样章之间正文字数变异系数 < 1.5"和"至少 2 个样章成功"。通过后把规则写入 `.cache/learned/{host}.json`，并打印规则路径，提示用户可编辑后放入 `./rules/`。
8. 取消 `--accept-detected` 的 3 章硬限制；默认流程改为：探测 → 打印摘要 → 自动开始抓取（`--dry-run` 只探测）。`--experimental-auto` 改为在没有其他匹配时自动启用，`--no-auto` 关闭。

验收：`test/fixtures/generic-*` 扩充到至少 6 类（静态 UTF-8、静态 GBK、CSR、章内分页、目录分页 + 卷、非小说页），前 5 类产出正确规则，非小说页明确拒绝；塔读目录用启发式跑时正文容器为 `#partContent`。

### W6 输出（修 D8）

- EPUB：跳过没有可输出章节的卷；`dc:source` 写入来源 URL；`dc:identifier` 维持 `urn:book2epub:{site}:{bookId}`；书名页显示来源站点与抓取日期。
- 分卷模式：每卷封面取该卷第一张插图，没有则用书籍封面；文件名冲突时追加序号。
- 新增 `--format epub|txt|both`。TXT：UTF-8 带 BOM，CRLF 可选，书名信息头、卷章标题居中（按东亚字符宽度计算）、段首两个全角空格、段间空行、图片以 `〔插图：文件名〕` 占位，`--txt-images` 时把图片另存到同名目录。
- 构建后自检（`output/verify.ts`）：重新打开 zip 校验 `mimetype` 首条目且未压缩、manifest 文件都存在、spine idref 都在 manifest 中、XHTML 能被 XML 解析；失败视为致命错误。检测到 `java` 与 `epubcheck.jar`（或环境变量 `EPUBCHECK_JAR`）时自动运行 epubcheck。
- **增量更新**：`book2epub update <url|epub>`。从 EPUB 的 `dc:source` 读回来源，重新抓目录，只抓缓存里没有的章节，然后整本重建。

### W7 CLI 与体验

```
book2epub <url> [选项]              转换（默认命令）
book2epub inspect <url>             只探测，输出诊断与候选规则
book2epub learn <url> [--out f]     探测并保存规则
book2epub login <site|url>          有头打开站点，人工登录后保存会话
book2epub update <url|epub>         增量更新
book2epub rules list|validate       规则管理
book2epub doctor                    环境检查
```

- 删除 `--acknowledge-permission`；`--experimental-auto` / `--accept-detected` 保留一个版本作为别名并提示弃用。
- `--concurrency` 上限取 `adapter.capabilities.maxConcurrency`，不再写死 2。
- 配置文件 `book2epub.config.json`（输出目录、默认格式、限速、图片质量），命令行参数优先。
- 所有用户可见信息集中在一个 `ui/messages.ts`，避免中英混杂。

### W8 测试

- **单元**：每个解析器、规则引擎每个字段、编码嗅探（UTF-8/GBK/BOM/错误 meta）、响应分类、重试与退避（假时钟）、`RunController` 中断、页面池、TXT 排版宽度计算、样板学习。
- **契约**：`test/contract.test.ts` 扩展为对每个手写适配器和每份内置规则运行同一套断言。
- **规则夹具**：每份内置规则必须附带目录页、章节页夹具（虚构文本）与期望输出 JSON；`npm test` 自动遍历。
- **黄金文件**：固定一本虚构书，生成 EPUB 后比较规范化的 OPF/nav/章节 XHTML 快照。
- **在线冒烟**（不进 CI）：`npm run test:live`，读取 `test/live/matrix.json`（站点、URL、`limitChapters`、期望最少章节数），逐个运行并输出健康报告到 `output/live-report.md`。站点改版时这里最先报警。

---

## 4. 里程碑

每个里程碑结束时：`npm test`、`npm run build` 通过，README 与 `docs/` 同步更新。

| 里程碑 | 内容 | 验收标准 |
| --- | --- | --- |
| M1 核心修复 | W1 全部；D8；删除策略门禁代码（D1 的前半部分） | 塔读运行时 0 章成功不写文件且退出码 3；Ctrl+C 后 3 秒内干净退出，重跑从断点继续 |
| M2 塔读可用 | W2；W3 的页面池与懒启动 | 塔读样本 5 章正确；登录后整本成功率 ≥ 99%；`--concurrency 2` 无串页 |
| M3 传输层 | W3 其余部分 | 编码嗅探与分类单测齐全；wenku8 在无头模式遇到质询时自动切有头并恢复 |
| M4 规则引擎 | W4；2 份内置规则 | 两个规则站点整本生成 EPUB；`rules validate` 能指出错误字段 |
| M5 启发式 v2 | W5 | 6 类夹具全部符合预期；对 M4 的两个站点删除规则后，启发式学出的规则能产出与手写规则字数差异 < 2% 的结果 |
| M6 输出与更新 | W6 | TXT 排版正确；增量更新只请求新章节；自检与 epubcheck 0 错误 |
| M7 收尾 | W7、W8；文档 | 在线冒烟矩阵全部通过；`doctor` 能定位缺失依赖 |

建议提交顺序：先 M1 的纯重构（移动文件到 `core/`），再逐个修缺陷，每个缺陷一个提交并附测试。

---

## 5. 交接注意事项

- 实施 W2 前，用样本 URL 重新核对 [sites/tadu.md](sites/tadu.md) 中的选择器与 `data-limit` 规则；站点改版时先更新资料和夹具，再改代码。
- 测试夹具一律使用虚构文本；抓取产物只放在 `.cache/` 与 `output/`。
- Windows 环境：PowerShell 会吞掉 `python -c` / `node -e` 中的引号，临时脚本请写成文件或用 here-string 管道给 `node --input-type=module`；本机 Anaconda Python 的 SSL 证书库有问题，项目只用 Node。
- 本机 Playwright 自带 Chromium 未安装，当前依赖本机 Chrome（`channel: 'chrome'`）；`doctor` 命令需要把这一点报告出来。
