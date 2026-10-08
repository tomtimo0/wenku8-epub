# 塔读支持与多站点架构改造计划

> 面向接手实现的 agent。本文基于 2026-10-08 对现有代码和目标页面的少量、只读结构探测。
>
> 当前基线：`npm test` 的 12 个测试全部通过，`npm run build` 通过。
>
> 目标输入：<https://www.tadu.com/book/catalogue/1020572>

## 1. 边界与现实目标

第一阶段只读取无需登录、无需付费且网页正常公开展示的内容。不得绕过验证码、登录、付费章节、DRM、访问控制或站点限流；遇到受限章节时记录并跳过，最终报告原因。

“给出任何网站的网址都能自动爬取”不能作为可靠承诺：不同站点的目录、正文、JavaScript 渲染、鉴权和反爬机制没有统一协议。可交付的目标应定义为：

1. 已注册站点由独立适配器稳定支持；
2. 新站点只需新增一个适配器，不修改抓取器和 EPUB 生成器；
3. 未知站点由启发式探测器尝试识别，只有置信度足够时才运行，否则输出诊断信息；
4. 不允许未知站点探测器“猜中一部分后静默生成残缺 EPUB”。

## 2. 已核实的塔读页面行为

### 2.1 可访问性和编码

- 目录页、书籍页和示例免费章节对普通 HTTP 客户端均返回 `200`，无需 Cloudflare 会话。
- 页面是 UTF-8：响应 `Content-Type` 为 `text/html;charset=UTF-8`，浏览器中 `document.characterSet` 为 `UTF-8`。
- 无头 Chrome 可以正常打开章节并加载正文，未观察到验证码或浏览器挑战。
- `robots.txt` 允许普通 `/book/...` 页面，禁止 `/tadu/`、搜索页和直接抓取 `*.css`、`*.js`。实现不应主动分析或批量下载被禁止的静态脚本。
- `robots.txt`：<https://www.tadu.com/robots.txt>。

### 2.2 目录页

目录页为服务端渲染 HTML，不需要 JavaScript 才能得到章名和链接。

```html
<div class="boxCenter directory">
  <h1>书名</h1>
  <div class="itct">
    <span><em>作者：</em>作者名</span>
    <span><em>分类：</em>分类名</span>
    <span><em>字数：</em>34.6万</span>
  </div>
  <div class="chapter clearfix">
    <h2><span>免费章节<i>/122章</i></span></h2>
    <a
      title="首发时间:... 章节字数:1034"
      href="  /book/1020572/101826908/ "
    >第一章 ...</a>
  </div>
</div>
```

解析规则：

- 书名：`.boxCenter.directory > h1`。
- 作者、分类、字数：`.boxCenter.directory .itct span`，按其中 `em` 的标签文本识别字段，不依赖 span 顺序。
- 章节分组：`.boxCenter.directory .chapter`。
- 分组标题：每组的 `h2 span`；示例只有“免费章节/122章”，没有真实卷名。
- 章节：分组内直接子级 `a[href*="/book/"]`。
- 章节 URL 中含有首尾空格，必须先 `trim()` 再用 `new URL(href, pageUrl)` 归一化。
- 章节 URL 形式：`https://www.tadu.com/book/{bookId}/{chapterId}/`。
- 章节 ID 取 URL 最后一个数字路径段，不要按目录序号推导。
- `title` 属性可提取首发时间和章节字数，但只能作为可选元数据。
- 对“免费章节”建立合成卷 `id: "main"`、`title: "正文"`。未来若出现真实卷分组，应保留站点标题；“收费章节”不应伪装成普通卷。

示例页实测目录显示“免费章节/122章”。不要把这个数量写死，解析完成后要比较声明数量与实际链接数量，不一致时发出警告。

### 2.3 书籍元数据页

书籍页：`https://www.tadu.com/book/{bookId}`。

- 书名：`.bookNm .bkNm`，也可由目录页 `h1` 兜底。
- 作者：`.bookNm .author`，需去掉尾部“著”。
- 简介：`p.intro`。
- 封面：优先 `meta[property="og:image"]`，其次 `.bookCover img[data-src]`，最后才使用 `src`；示例的 `src` 是懒加载占位图。
- 状态：`.bookCover` 中的状态文本；不要从整个 `.bookIntro` 模糊搜索，以免误收其他文字。
- 标签：书籍详情区域的标签节点，选择器需在实现时用 fixture 固定。
- 字数：书籍页显示 `34.56万字`，目录页显示 `34.6万`；优先精度更高的书籍页。

### 2.4 章节页和正文加载

章节外壳是服务端渲染的，但正文不是：

```html
<div id="content"
     data-bookid="1020572"
     data-chapterid="101826908"
     data-needimagepart="0">
  ...
  <div class="read_details" id="partContent"></div>
</div>
<input id="bookPartResourceUrl"
       value="/getPartContentByCodeTable/1020572/1"/>
<input id="canReadFlag" value="1"/>
```

浏览器加载后会请求：

```text
GET https://www.tadu.com/getPartContentByCodeTable/{bookId}/{chapterNumber}
Referer: 当前章节 URL
```

返回 JSON 外形：

```json
{
  "status": 200,
  "msg": "...",
  "redirectUrl": null,
  "data": {
    "content": "<p data-limit=\"...\">...</p>",
    "url": ""
  }
}
```

重要限制：

- API 的第二个参数是章节序号，不是 URL 中的 `chapterId`。不要自行从目录下标拼接口 URL；以章节页隐藏字段 `#bookPartResourceUrl` 为准。
- 返回的 `<p>` 顺序经过扰动，并插有站点推广段落；站点自己的 JavaScript 会重排并渲染到 `#partContent`。第一版不要复刻未公开的扰动算法。
- 第一版应使用 Playwright 打开章节页，等待 `#partContent p`，再从渲染后的 DOM 提取。示例章节得到 27 个段落节点、约 1034 个非空白字符，与页面标注章节字数一致。
- 段落含 `data-limit`。示例中站点推广段落使用与当前 `chapterId` 相同的编码值。适配器需组合以下规则过滤，而不是只依赖广告文案：
  1. 删除明确的登录、客户端推广、充值提示；
  2. 对可疑 `data-limit` 重复值记录诊断；
  3. 提取后将正文字符数与目录 `title` 属性中的章节字数比较；
  4. 差异超过阈值时把章节标记为 `suspect`，不要静默通过。
- 是否可读先检查 `#canReadFlag[value="1"]`。不是 `1`、正文超时、出现登录/付费提示时，返回结构化的 `restricted`，禁止尝试绕过。
- 上一章/下一章：`.paging_left`、`.paging_right`；目录返回：`.paging_directory`。这些只用于链接顺序校验，目录页仍是唯一权威章节列表。
- 章节元信息在 `.chapter_details`，可提取作者、字数、更新时间；标题沿用目录页标题，避免从页面 `<title>` 拆字符串。
- 示例章节正文没有图片。提取时仍需支持 `#partContent img`，依次读取 `src`、`data-src`、`data-original`，并保持文字与图片的 DOM 顺序。

### 2.5 推荐的塔读抓取策略

目录和书籍元数据走轻量 HTTP；章节正文走一个复用的 Playwright context。不要为每章启动浏览器。

```text
HTTP GET 目录页
  → 解析 Book/Volume/Chapter 骨架
HTTP GET 书籍页
  → 合并元数据和封面 URL
Playwright 复用同一页面逐章 goto
  → 检查 canReadFlag
  → 等待 #partContent p 或受限提示
  → 从渲染后 DOM 提取 Block[]
```

默认串行，塔读适配器建议间隔 1200–2200ms 随机抖动。遇到 429/503 采用指数退避并降低后续速率。目录和书籍页可直接缓存；章节缓存应保存适配器产出的规范化 JSON，而不只保存 HTML，因为初始 HTML 不含正文。

## 3. 现有代码必须拆开的耦合

当前实现通过测试且可继续作为 wenku8 回归基线，但以下位置直接绑定了 wenku8：

- `src/cli.ts`：只接受 wenku8 书号，直接实例化 `Wenku8Session`、`BookFetcher` 和 `fetchCover`。
- `src/fetcher.ts`：直接导入 wenku8 URL 函数与三个解析器。
- `src/session.ts`：写死站点根 URL、GBK 解码和 Cloudflare 就绪条件。
- `src/images.ts`、`src/cover.ts`：`Referer` 写死为 wenku8。
- `src/text/normalize.ts`：写死 wenku8 水印。
- `src/epub/templates.ts`：EPUB identifier 和 NCX uid 写死 `urn:wenku8:*`。
- `.cache/html/{bookId}`：没有站点命名空间，不同网站相同数字 ID 会冲突。

不要复制一套 `TaduFetcher` 后在 CLI 写大型 `if/else`。这会使第三个站点再次复制缓存、重试、图片和报告逻辑。

## 4. 目标架构

### 4.1 领域模型

给 `Book` 增加来源信息；给章节保存规范 URL、访问状态和可选站点元数据。

```ts
/** 可稳定标识一本来源书籍 */
export interface SourceRef {
  site: string;
  bookId: string;
  canonicalUrl: string;
}

/** 章节的公开访问状态 */
export type ChapterAccess = 'public' | 'restricted' | 'unknown';

/** 一个章节 */
export interface Chapter {
  id: string;
  title: string;
  url: string;
  access: ChapterAccess;
  blocks: Block[];
  isIllustration: boolean;
  expectedCharacters?: number;
  publishedAt?: string;
}

/** 一本书 */
export interface Book {
  source: SourceRef;
  id: string;
  title: string;
  author: string;
  // 保留现有可选元数据和 volumes
}
```

迁移期保留 `Book.id`，其值等于 `source.bookId`，避免一次改动所有 EPUB 代码。后续内部逻辑统一以 `source.site + source.bookId` 作为缓存键和标识。

图片块暂时仍保留 `src`，但下载请求改由适配器提供策略，不能再在通用图片模块中写死 Referer。

### 4.2 深接口：`SiteAdapter`

核心流程只依赖一个较深的站点接口。URL 识别、页面策略、解析和访问限制都封装在适配器内。

```ts
/** 站点抓取执行环境，由核心层提供 */
export interface ScrapeContext {
  http: HttpTransport;
  browser: BrowserTransport;
  cache: ContentCache;
  signal?: AbortSignal;
}

/** 图片请求所需的来源策略 */
export interface AssetRequest {
  url: string;
  headers?: Record<string, string>;
}

/** 单章抓取结果 */
export type ChapterFetchResult =
  | { status: 'ok'; blocks: Block[]; warnings: string[] }
  | { status: 'restricted'; reason: string }
  | { status: 'failed'; reason: string; retryable: boolean };

/** 一个网站的完整适配器 */
export interface SiteAdapter {
  readonly id: string;
  readonly displayName: string;

  /** 返回 0 表示不匹配；数值越高越确定 */
  match(input: string): number;

  /** 把任意受支持输入规范化为来源引用 */
  resolve(input: string): Promise<SourceRef>;

  /** 抓取目录和书籍元数据，不抓正文 */
  fetchBook(ref: SourceRef, ctx: ScrapeContext): Promise<Book>;

  /** 抓取一章公开正文 */
  fetchChapter(
    book: Book,
    chapter: Chapter,
    ctx: ScrapeContext,
  ): Promise<ChapterFetchResult>;

  /** 返回封面或正文图片的请求头等策略 */
  assetRequest(url: string, book: Book): AssetRequest;

  /** 可选的站点级清洗，不污染通用文本清洗 */
  normalizeBlock?(block: Block): Block | null;
}
```

适配器公共接口不暴露 DOM 选择器和编码细节。每个适配器内部继续拆成纯解析函数，便于 fixture 单元测试：

```text
sites/wenku8/
  adapter.ts
  urls.ts
  parse-index.ts
  parse-book.ts
  parse-chapter.ts
  session.ts

sites/tadu/
  adapter.ts
  urls.ts
  parse-catalogue.ts
  parse-book.ts
  parse-rendered-chapter.ts
```

### 4.3 适配器注册表

```ts
/** 按匹配分数选择唯一站点适配器 */
export function selectAdapter(
  input: string,
  adapters: SiteAdapter[],
  forcedSite?: string,
): SiteAdapter;
```

规则：

1. `--site` 指定时只选该适配器，不再猜测；
2. URL 按 `match()` 最高分选择；
3. 两个适配器同分或都不匹配时明确报错；
4. 纯数字输入没有域名，存在歧义。为兼容旧命令，第一版仍默认 wenku8，但输出弃用提示；推荐 `--site wenku8 2896`；
5. `GenericAdapter` 永远是最低优先级，且必须显式 `--experimental-auto` 才启用。

### 4.4 通用传输层

建立两个 transport，站点适配器选择使用哪一个：

- `HttpTransport`：UTF-8/GBK 解码、Cookie jar、重试、状态码、响应头、每主机限速；
- `BrowserTransport`：按站点隔离持久化 profile，支持 `gotoAndExtract()`、等待选择器和页面内 fetch；
- 两者都接受 `AbortSignal`，统一处理 SIGINT；
- 限速按 hostname 维护，而不是全局一个延迟；
- 不在 transport 中写任何站点 DOM 选择器。

wenku8 使用 BrowserTransport 的页面内 fetch；塔读目录使用 HttpTransport，章节使用 BrowserTransport。

### 4.5 缓存

新路径：

```text
.cache/
  sites/{site}/browser-profile/
  books/{site}/{bookId}/
    book.json
    catalogue.html
    chapters/{chapterId}.json
    assets/{sha256(url)}.{ext}
```

- 缓存 key 至少含 `site`、规范 URL 和解析器版本；
- `chapter.json` 保存 `status`、`blocks`、抓取时间、来源 URL、适配器版本；
- 适配器改变正文解析规则时提升 `parserVersion`，自动失效旧缓存；
- 资源文件名用 URL 的 SHA-256，不能再只取 basename；
- 可一次性兼容读取旧 `.cache/html/{bookId}`，但新写入只用新结构。

### 4.6 EPUB 层保持站点无关

EPUB builder 只接受完整 `Book` 和图片映射，不知道网页如何抓取。

必须改动：

- identifier 改为 `urn:bookscraper:{site}:{bookId}`；
- NCX uid 使用同一稳定标识，不再写死 wenku8；
- 书名页可选增加“来源站点”和规范 URL；
- 受限/失败章节默认不写入 spine，仅在结束报告中列出；若用户显式选择 `--include-placeholders`，才写占位章；
- 没有真实卷时只生成“正文”一个卷，不在书名页展示伪造卷信息。

### 4.7 图片层

`resolveBookImages` 接收一个 `resolveRequest(url)` 回调或 `AssetRequest`，由当前 adapter 提供 Referer、Cookie 要求和允许的 host。

安全规则：

- 只允许 `http:`、`https:`；
- 默认只下载书籍页面实际引用的图片；
- 阻止 localhost、私网 IP、`file:` 和重定向到私网，避免未来“任意 URL”模式产生 SSRF；
- 限制单图大小、总下载大小和重定向次数；
- 复用现有魔数检测，不信任扩展名和 Content-Type；
- SVG 默认拒绝或严格清洗后再嵌入，第一版直接拒绝更安全。

## 5. 塔读适配器实现细节

### 5.1 输入识别

接受：

```text
https://www.tadu.com/book/catalogue/{bookId}
https://www.tadu.com/book/{bookId}
https://www.tadu.com/book/{bookId}/{chapterId}/
```

任意一种都规范化为目录页 URL。仅接受 hostname 精确为 `tadu.com` 或 `www.tadu.com`，不能用字符串 `includes("tadu.com")`。

### 5.2 目录与元数据

`fetchBook` 的步骤：

1. HTTP 请求目录页并运行 `parseTaduCatalogue()`；
2. HTTP 请求书籍页并运行 `parseTaduBookPage()`；
3. 以目录页的章节顺序为准；
4. 合并书籍页的精确字数、简介、状态和封面；
5. 对每章保存规范 URL与 `expectedCharacters`；
6. 仅把明确标为“免费章节”的链接设为 `public`；无法判断时为 `unknown`，抓取前再看 `canReadFlag`；
7. 声明章节数、解析链接数、链接唯一数三者不一致时记录警告。

### 5.3 渲染章节

`fetchChapter` 使用复用页面：

1. `page.goto(chapter.url, { waitUntil: "domcontentloaded" })`；
2. 等待以下任一条件：
   - `#partContent p` 出现；
   - `#canReadFlag` 明确不是 `1`；
   - 登录、付费或错误提示出现；
3. 非公开章返回 `restricted`；
4. 在页面上下文中按 DOM 顺序遍历 `#partContent`：
   - `p` 产生 paragraph；
   - `img` 产生 image；
   - `<br>` 只在当前段内转为换行，不创建大量空段；
5. 运行塔读专属推广过滤；
6. 删除空段、零宽字符和首尾空白，保留段内标点与换行；
7. 将结果字符数和 `expectedCharacters` 比较。建议偏差阈值取 `max(80, expected * 0.08)`；
8. 超阈值返回 `ok` 但附 `suspect-content-length` 警告；CLI 默认在最终报告醒目列出，可用 `--strict` 让它失败；
9. 缓存规范化后的 ChapterFetchResult。

不要在首版直接请求并自行重排 `getPartContentByCodeTable`。后续若需要性能优化，应单独实现 `TaduContentDecoder`，用站点渲染结果做契约测试，确认至少多个章节、不同长度和含图章节均完全一致后才能替换浏览器路径。

### 5.4 推广段落处理

站点推广过滤必须保守：

- 精确匹配已观察到的客户端推广句式；
- 识别 `data-limit` 重复且解码后等于当前 `chapterId` 的可疑节点；
- 任何过滤都记入 debug trace：节点索引、规则名、字符数，不记录正文内容；
- 不应使用“包含塔读就删整段”这种过宽规则，因为小说正文可能合法提到站名；
- 完成后依靠预期字数做二次检查。

## 6. 未知站点启发式适配器

这部分只作为后续实验功能，不应阻塞塔读适配器。

### 6.1 探测流水线

1. 校验 URL，阻止私网和非 HTTP(S)；
2. HTTP 获取页面；正文过少或检测到脚本应用壳时再用浏览器；
3. 提取 JSON-LD `Book`、Open Graph、`<title>`、作者和封面候选；
4. 在页面中寻找重复的同源链接簇；
5. 根据链接文本中的“第…章/Chapter/卷”、href 规律、DOM 邻近度给目录候选打分；
6. 只抽样打开一个明确可公开访问的章节；
7. 对 `article`、`main`、`#content`、类名含 `content/read/chapter/article` 的节点打正文分；
8. 排除导航、评论、推荐、页脚及链接密度过高的容器；
9. 输出探测报告：选择器候选、分数、章节数、样章字符数、警告；
10. 分数低于阈值时停止，提示用户新增 adapter。

### 6.2 置信度门槛

自动运行至少同时满足：

- 书名、章节列表和样章正文均有高置信候选；
- 至少两个章节链接符合相同 URL 模式；
- 样章正文有多个段落且链接密度低；
- 未检测到登录、订阅、付费或验证码；
- 章节链接均与初始站点同源，或图片 CDN 是页面真实引用的 HTTPS 主机。

默认只输出 dry-run 探测结果。用户显式 `--accept-detected` 后才抓取，且首版限制最多 3 章用于验证。

### 6.3 为手写适配器生成脚手架

比无限增强启发式规则更可维护的方式，是增加：

```text
book2epub inspect <url>
book2epub scaffold-adapter <site-id> --from inspection.json
```

`inspect` 保存结构化诊断，不保存正文；`scaffold-adapter` 生成 adapter、fixture 和契约测试骨架。接手 agent 可以先预留命令与数据类型，不必在塔读里程碑中实现代码生成。

## 7. CLI 变更

包和命令建议逐步改名为 `book2epub`，旧的 `wenku8-epub` bin 至少保留一个版本作为别名。

```text
book2epub <url-or-id>
  --site <wenku8|tadu>
  --experimental-auto
  --accept-detected
  --limit-chapters <n>
  --include-placeholders
  --strict
  --headful
  --refresh
  ...保留现有 EPUB 与图片选项
```

- 塔读 URL无需 `--site`。
- `--limit-chapters` 是集成测试和友好探测的重要选项，不只是调试功能。
- `--headful` 对 wenku8 用于 Cloudflare，对塔读用于排查渲染；正常塔读运行默认 headless。
- 最终统计按 `成功 / 受限跳过 / 失败 / 内容可疑` 分类。

## 8. 测试策略

所有 fixture 使用虚构文本，不提交实际小说正文或下载图片。

### 8.1 现有回归

- 原有 12 个测试必须保持通过；
- 将 wenku8 代码移动到 adapter 后，先只搬文件、保持行为不变；
- 为 wenku8 加一组 `SiteAdapter` 契约测试，防止重构时丢功能。

### 8.2 塔读单元测试

- URL：三类 URL 输入、尾部斜杠、错误域名、章节 URL反推 bookId；
- 目录：单分组、多分组、href 有空白、重复章节、声明数量不一致；
- 元数据：懒加载封面优先级、作者“著”后缀、简介缺失；
- 渲染正文：普通段落、`br`、段图混排、空段、推广段落、重复 `data-limit`；
- 访问状态：`canReadFlag=0`、登录提示、正文等待超时；
- 字数校验：正常、阈值内、超阈值；
- 图片：`data-src` 回退、非法协议、私网地址拒绝。

### 8.3 Adapter 契约测试

每个 adapter 都运行同一测试套件：

- `match()` 不误认其他已知站点；
- `resolve()` 返回稳定 canonical URL；
- Book 至少有 id、title、author 和一个 volume；
- 所有章节 ID 和 URL 唯一；
- `fetchChapter` 只能返回规定的三种状态；
- 成功章节没有空 paragraph，图片 URL 已规范化；
- `assetRequest` 不泄漏其他域 Cookie。

### 8.4 受控集成测试

不在普通 CI 抓取网站。提供显式命令：

```bash
npm run test:live -- \
  https://www.tadu.com/book/catalogue/1020572 \
  --limit-chapters 2 --no-images
```

验收：

1. 自动选择 tadu adapter；
2. 解析出 122 个唯一免费章节（以运行当日页面为准；若站点更新，以声明数与实际数一致为准）；
3. 只抓取前 2 章；
4. 两章正文非空且字数检查不过阈值；
5. EPUB 通过现有结构测试和 epubcheck；
6. 缓存命中后第二次运行不再打开章节页；
7. `--refresh` 能强制更新；
8. 断网时已缓存数据仍可重新生成 EPUB。

## 9. 实施顺序

### M1：建立多站点领域模型

- 增加 `SourceRef`、章节 URL 和访问状态；
- EPUB identifier 去除 wenku8 硬编码；
- 缓存和资源 key 增加 site；
- 所有原测试通过，不改变 CLI 行为。

完成标准：旧 wenku8 示例仍能生成等价 EPUB，测试与构建通过。

### M2：抽出适配器与传输层

- 定义 `SiteAdapter`、registry、HttpTransport、BrowserTransport；
- 将现有代码移动到 `sites/wenku8`；
- 核心 orchestrator 替代当前站点专属 `BookFetcher`；
- 图片和封面改用 adapter 的 AssetRequest。

完成标准：CLI 不直接导入任何 `sites/wenku8/*` 文件，只通过 registry 选择。

### M3：实现塔读目录和元数据

- 实现 Tadu URL、目录和书籍页纯解析器；
- 实现 fixture 单测；
- 加 `--site` 与 URL 自动选择；
- 此阶段先用 `--limit-chapters 0` 验证骨架，不抓正文。

完成标准：目标 URL得到正确书名、作者、简介、封面与 122 个唯一章节（以实时页面为准）。

### M4：实现塔读渲染正文

- 复用 headless Chrome context；
- 等待正文/受限状态；
- 按 DOM 顺序生成 blocks；
- 推广过滤、字数校验、JSON 缓存和报告；
- 加中断清理与超时测试。

完成标准：前两章可稳定生成 EPUB；二次运行完全命中缓存。

### M5：资产、安全和完整验证

- 通用图片请求策略、URL hash 缓存、SSRF 防护与大小限制；
- 对完整免费目录进行低频率运行；
- epubcheck 和至少两个阅读器人工检查；
- 更新 README 和迁移说明。

完成标准：失败、受限和可疑章节都有明确汇总，无静默丢章。

### M6：未知站点实验探测

- 实现 `inspect` 和评分模型；
- 默认 dry-run；
- 加 `GenericAdapter` 低优先级注册；
- 低置信度明确拒绝。

完成标准：对手写的三类 fixture（静态小说页、JS 渲染页、非小说页）分别做到正确识别、正确识别、明确拒绝。

## 10. 建议的小提交

1. `refactor: add source identity to book model`
2. `refactor: make epub identifiers site-neutral`
3. `refactor: introduce site adapter registry`
4. `refactor: move wenku8 implementation behind adapter`
5. `refactor: namespace cache and asset requests by site`
6. `feat: parse tadu catalogue and metadata`
7. `feat: extract rendered public tadu chapters`
8. `feat: report restricted and suspect chapters`
9. `test: add site adapter contract suite`
10. `docs: document tadu usage and adapter authoring`

每个提交都应保证 `npm test` 和 `npm run build` 通过。不要把架构重构、塔读功能和通用探测器压进同一个提交。

## 11. 接手 agent 开工前必须再次确认

站点页面可能变化，编码前用目标 URL做以下最小验证：

- 目录页仍为 200 且 `.boxCenter.directory .chapter a` 可获得章节；
- 书籍页封面仍优先来自 `og:image` 或 `data-src`；
- 章节页仍含 `#canReadFlag`、`#bookPartResourceUrl`；
- headless Chrome 加载后 `#partContent p` 的正文长度与页面章节字数接近；
- 仅处理公开免费章节符合用户的实际需求。

若任一关键选择器改变，先更新研究记录和 fixture，再实现；不要在通用层加入站点特例。
