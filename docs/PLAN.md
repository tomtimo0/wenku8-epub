# wenku8 → EPUB 转换工具：调研结论与实现规划

> 面向接手实现的 agent。本文档所有结论均已于 2026-10-08 实测验证（标注"待验证"的除外）。
> 目标示例：<https://www.wenku8.net/novel/2/2896/index.htm>（书号 2896，8 卷 58 章，含插图章）。
> 用途定位：个人离线阅读。不要把抓取到的正文、图片提交进仓库，测试夹具一律使用手写的虚构文本。

---

## 1. 调研结论

### 1.1 访问与反爬

| 项目 | 结论 |
| --- | --- |
| 直接 HTTP 请求（curl / urllib） | **403**，响应头 `cf-mitigated: challenge`，是 Cloudflare 托管质询 |
| 真实浏览器（Playwright Chromium） | 可以通过质询，正常打开目录页和章节页 |
| 浏览器上下文内 `fetch()` 同源页面 | **可行**，200，约 0.8 秒/页，复用质询通过后的 Cookie |
| 图床 `pic.777743.xyz`、封面 `img.wenku8.com` | **不受 Cloudflare 保护**，Node 直接 `fetch` 即可（建议带 `Referer: https://www.wenku8.net/`） |
| 官方 TXT 打包下载 `packshow.php` | 跳转登录页，**不使用** |
| 本机 Python | Anaconda 的 `ssl` 读取 Windows 证书库报错；**选 Node 技术栈即可绕开**，无需处理 |

结论：**HTML 页面必须经由浏览器会话获取；图片走 Node 原生请求。**

### 1.2 编码

- 页面编码为 **GBK**（`document.characterSet === "GBK"`）。
- 在浏览器内 `fetch` 后用 `new TextDecoder('gbk').decode(await res.arrayBuffer())` 解码，把字符串传回 Node。不要用 `res.text()`（会按 UTF-8 解码，产生乱码）。

### 1.3 URL 规律

- 目录页：`https://www.wenku8.net/novel/{floor(bookId/1000)}/{bookId}/index.htm`（2896 → `novel/2/2896`）
- 章节页：同目录下 `{chapterId}.htm`（目录中为相对链接）
- 书籍信息页：`https://www.wenku8.net/book/{bookId}.htm`
- 封面：`http://img.wenku8.com/image/{floor(bookId/1000)}/{bookId}/{bookId}s.jpg`（`s` 为缩略图，约 19KB；**待验证**：去掉 `s` 是否有大图，有则优先）

### 1.4 目录页 DOM（`index.htm`）

```html
<div id="title">书名</div>
<div id="info">作者：XXX</div>
<table class="css">
  <tr><td class="vcss" colspan="4" vid="116723">第一卷</td></tr>
  <tr>
    <td class="ccss"><a href="116724.htm">序章</a></td>
    <td class="ccss"><a href="116725.htm">第一章</a></td>
    ...
  </tr>
  <tr><td class="ccss"><a href="156204.htm">插图</a></td><td class="ccss">&nbsp;</td>...</tr>
  <tr><td class="vcss" colspan="4" vid="116915">第二卷</td></tr>
  ...
</table>
```

解析规则：按文档顺序遍历 `table.css td`；遇到 `td.vcss` 开新卷（`vid` 属性即卷 ID）；遇到含 `a` 的 `td.ccss` 往当前卷追加章节；只有 `&nbsp;` 的空单元格跳过。章节 ID 取自 `href` 去掉 `.htm`。

### 1.5 书籍信息页 DOM（`/book/{id}.htm`）

`table td` 中有若干 `标签：值` 文本：`文库分类`、`小说作者`、`文章状态`（如"连载中"）、`最后更新`（`YYYY-MM-DD`）、`全文长度`（如 `681145字`）。
**待验证**：简介所在节点（页面中"内容简介"附近的 `span`），实现时先用浏览器打开确认选择器。

### 1.6 章节页 DOM

```html
<div id="contentmain">
  <div id="title">第一卷 第一章</div>
  <div id="content">
    &nbsp;&nbsp;&nbsp;&nbsp;段落一<br>
    <br>
    &nbsp;&nbsp;&nbsp;&nbsp;段落二<br>
    <br>
    <ul id="contentdp">本文来自 轻小说文库(http://www.wenku8.com)</ul>
    ...
    <ul id="contentdp">最新最全的日本动漫轻小说 轻小说文库(http://www.wenku8.com) 为你一网打尽！</ul>
  </div>
</div>
```

- `#content` 的直接子节点只有：文本节点、`<br>`、2 个 `ul#contentdp`（站点水印，**必须删除**；注意页面上有重复 id）。
- 段落模式：`&nbsp;×4 + 文本 + <br><br>`。实测一章约 466 段，空行与段落严格交替。
- 首尾、外围的 `#adv*`、`#footlink` 等都是广告/导航，只取 `#content` 即可。
- `#foottext` 中有"上一页 / 下一页"链接，可用于校验顺序，非必需。

### 1.7 插图章 DOM

```html
<div id="content">
  <a href="https://pic.777743.xyz/2/2896/156204/192649.jpg" target="_blank">
    <img src="https://pic.777743.xyz/2/2896/156204/192649.jpg" border="0" class="imagecontent">
  </a>
  ...
</div>
```

- 选择器：`#content img.imagecontent`，取 `src`。插图章正文文本长度为 0。一卷约 19 张图（单张约 250KB JPEG）。
- 判断"插图章"**以是否含 `img.imagecontent` 为准**，不要只看标题叫"插图"；普通章节内也可能夹图，需要原位保留。

---

## 2. 技术选型

| 关注点 | 选择 | 理由 |
| --- | --- | --- |
| 语言 | **TypeScript（Node ≥ 20，本机 v24.19）**，代码注释用 **JSDoc** | 与 Playwright 同生态；Node 内置 `TextDecoder('gbk')` |
| 浏览器 | `playwright`（当前 1.x）`chromium.launchPersistentContext` | 持久化用户目录保存 `cf_clearance`，第二次运行通常不用再过质询 |
| HTML 解析 | `cheerio`（当前 1.1.x） | 在 Node 侧解析，解析逻辑是纯函数，方便单测 |
| EPUB 打包 | **`jszip` 手工组装 EPUB 3** | 完全控制 XHTML/CSS/目录结构，排版可控；不依赖维护状况不稳定的 epub 生成库 |
| 图片处理 | `sharp`（可选） | 识别真实尺寸/格式，可选压缩和缩放，控制体积 |
| CLI | `commander` | |
| 测试 | `vitest` | |
| 校验 | `epubcheck`（Java，可选） | 有 Java 就在 CI/本地跑一次 |

不选 `epub-gen` 这一类库的原因：它们对 CSS、目录层级（卷→章两级）、封面页、插图页的控制有限，排版质量是本项目的核心要求。

---

## 3. 目录结构

```
Books/
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ cli.ts               # 参数解析与流程编排
│  ├─ types.ts             # 领域类型
│  ├─ urls.ts              # URL 规律（书号 → 各类 URL）
│  ├─ session.ts           # 浏览器会话：启动、过质询、页内 fetch + GBK 解码
│  ├─ fetcher.ts           # 限速、重试、磁盘缓存、断点续抓
│  ├─ parse/
│  │  ├─ index-page.ts     # 目录页 → Book 骨架
│  │  ├─ book-page.ts      # 信息页 → 元数据
│  │  └─ chapter-page.ts   # 章节页 → Block[]
│  ├─ images.ts            # 图片下载、格式识别、可选压缩
│  ├─ epub/
│  │  ├─ builder.ts        # 组装 zip
│  │  ├─ templates.ts      # XHTML / OPF / NCX / nav 模板
│  │  ├─ style.css         # 排版样式
│  │  └─ escape.ts         # XML 转义
│  └─ text/normalize.ts    # 文本清洗
├─ test/
│  ├─ fixtures/            # 手写的虚构 HTML，结构与 1.4–1.7 一致
│  └─ *.test.ts
├─ .cache/                 # 浏览器配置、原始 HTML、图片缓存（加入 .gitignore）
└─ output/                 # 生成的 EPUB（加入 .gitignore）
```

---

## 4. 领域类型（`src/types.ts`）

```ts
/** 章节正文中的一个内容块 */
export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'image'; src: string };

/** 一个章节 */
export interface Chapter {
  id: string;          // 章节 ID，如 "116725"
  title: string;       // 目录中的章节名（比 #title 的 "第一卷 第一章" 更准确）
  blocks: Block[];     // 抓取并解析后填充
  isIllustration: boolean; // 是否为纯插图章（只有图片块）
}

/** 一卷 */
export interface Volume {
  id: string;          // td.vcss 的 vid
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
```

---

## 5. 模块实现要点

### 5.1 `session.ts`：浏览器会话

- `chromium.launchPersistentContext('.cache/browser-profile', { headless, channel })`。
  - 优先 `channel: 'chrome'`（本机装了 Chrome 时更容易过质询），失败回退到自带 Chromium。
  - **默认 `headless: false`**。M1 第一件事是测试无头模式能否过质询；能过就把默认值改为无头，提供 `--headful` 开关。
- `ensureReady()`：打开目录页，轮询直到满足以下条件，超时 120 秒：
  - `document.title` 不是"请稍候…"或 "Just a moment..."；
  - 页面上存在 `table.css`。
  - 有头模式下，如果需要人工点验证框，终端提示用户去浏览器窗口操作。
- `fetchHtml(path)`：`page.evaluate` 执行页内 `fetch(path, { credentials: 'include' })`，用 `TextDecoder('gbk')` 解码后返回 `{ status, html }`。
  - 若返回的 HTML 含 `cf-` 质询特征，或者状态码为 403/503，调用 `ensureReady()` 重新过质询再重试。
- 进程退出时关闭 context（包括 `SIGINT`）。

### 5.2 `fetcher.ts`：限速、重试、缓存

- 默认**串行**，每次请求间隔 `1000–2000ms` 随机抖动；`--concurrency` 最大允许 2。对站点保持克制。
- 重试：指数退避 3 次（2s/4s/8s）。
- 缓存：原始 HTML（已解码，存 UTF-8）写到 `.cache/html/{bookId}/{chapterId}.html`；命中缓存直接用，实现断点续抓。`--refresh` 强制重抓。
- 目录页和信息页**每次都重新抓**（书在连载中，会有新章节），章节页走缓存。
- 进度输出：`[卷 3/8] [章 5/7] 第四章 ✓`。

### 5.3 解析器（纯函数，输入 HTML 字符串）

`parseIndexPage(html, bookId) → Book`：按 1.4 的规则实现。卷名、章名需 `trim()`，并把内部连续空白压缩成一个空格。

`parseBookPage(html) → Partial<Book>`：按 1.5 的规则，用正则 `/^(文库分类|小说作者|文章状态|最后更新|全文长度)：(.*)$/` 匹配各 `td` 的文本。

`parseChapterPage(html) → Block[]`：

1. `$('#content')`，删除其中所有 `ul#contentdp`（用属性选择器 `ul[id="contentdp"]`，以兼容重复 id）。
2. 按文档顺序遍历子节点（递归进入 `a` 等内联元素）：
   - 文本节点 → 追加到当前行的缓冲区；
   - `<br>` → 结束当前行；
   - `img.imagecontent`（或任意 `img`）→ 先结束当前行，再输出 `{ kind: 'image', src }`。
3. 对每行调用 `normalizeLine`，丢弃空行，剩下的就是 `paragraph`。

`text/normalize.ts` 中的 `normalizeLine`：

- 实体解码（cheerio 的 `.text()` 已经处理）；
- 去掉首尾的半角空格、`\u00A0`（nbsp）、`\u3000`（全角空格）和制表符。**缩进统一由 CSS 实现，文本里不保留缩进字符。**
- 删除零宽字符 `\u200B-\u200D\uFEFF`；
- 过滤残留水印：整行匹配 `/轻小说文库|wenku8\.(com|net)/` 时丢弃。
- **不**做标点替换或繁简转换（避免误伤原文）；可选项见第 8 节。

### 5.4 `images.ts`

- Node 原生 `fetch`，请求头带 `Referer: https://www.wenku8.net/` 和常规浏览器 UA；并发 4，失败重试 3 次。
- 缓存到 `.cache/images/{bookId}/{原文件名}`。
- 根据文件头的魔数判断真实格式（JPEG `FF D8`、PNG `89 50`、WebP `RIFF....WEBP`、GIF），决定扩展名和 `media-type`；**不要相信 URL 的扩展名**。
- 可选 `--image-quality <1-100>` / `--max-image-width <px>`：用 `sharp` 重新编码为 JPEG，同时记录宽高，供判断横图使用。
- 下载失败的图片：在 EPUB 中输出占位段落"〔插图缺失〕"，并在结束时汇总报告，不中断整本书的生成。

### 5.5 `epub/builder.ts`：EPUB 3 结构

```
mimetype                       # 第一个条目，内容为 application/epub+zip，必须 STORE（不压缩）
META-INF/container.xml
OEBPS/content.opf
OEBPS/nav.xhtml                # EPUB 3 导航（卷→章两级）
OEBPS/toc.ncx                  # EPUB 2 兼容，给老阅读器用（如部分 Kindle 转换工具、多看旧版）
OEBPS/styles/main.css
OEBPS/text/cover.xhtml
OEBPS/text/titlepage.xhtml     # 书名、作者、分类、状态、更新日期、简介
OEBPS/text/v{n}.xhtml          # 卷标题页
OEBPS/text/v{n}c{m}.xhtml      # 每章一个文件（控制单文件体积，阅读器分页更快）
OEBPS/images/cover.jpg
OEBPS/images/{chapterId}_{序号}.{ext}
```

关键规则：

- `mimetype` 必须是 zip 中的第一个条目，并且用 `compression: 'STORE'`；其余条目用 `DEFLATE`。
- OPF 中 `dc:identifier` 使用稳定值 `urn:wenku8:{bookId}`，`dc:language` 为 `zh-CN`，`dcterms:modified` 为生成时间（格式 `YYYY-MM-DDThh:mm:ssZ`）。
- 封面：manifest 中封面图片条目加 `properties="cover-image"`，同时写入 `<meta name="cover" content="cover-image"/>` 兼容 EPUB 2。
- nav 中卷节点链接到卷标题页，章节作为子节点 `<ol>`；`toc.ncx` 中保持同样的层级。另加 `landmarks`（封面、目录、正文起点）。
- spine 顺序：封面 → 书名页 → nav（`linear="no"` 也可）→ 各卷标题页和章节。
- 所有文本都要经过 XML 转义（`& < > " '`）；XHTML 必须是严格 XML，自闭合标签写成 `<br/>`、`<img .../>`。
- 文件名只用 ASCII，避免阅读器兼容问题。

### 5.6 排版（`style.css` 与模板）

章节 XHTML 模板：

```html
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>{章名}</title><link rel="stylesheet" href="../styles/main.css"/></head>
<body>
  <section epub:type="chapter">
    <h2 class="chapter-title">{章名}</h2>
    <p>{段落}</p>
    <div class="illus"><img src="../images/xxx.jpg" alt=""/></div>
  </section>
</body>
</html>
```

样式要点：

```css
body { margin: 0 5%; line-height: 1.8; text-align: justify; }
p { text-indent: 2em; margin: 0 0 0.6em 0; }
h1, h2 { text-align: center; font-weight: bold; page-break-after: avoid; break-after: avoid; }
.chapter-title { margin: 2em 0 1.5em; font-size: 1.3em; }
.volume-page { page-break-before: always; text-align: center; padding-top: 30%; }
.volume-title { font-size: 1.8em; letter-spacing: 0.2em; }
.illus { text-align: center; margin: 0; padding: 0; page-break-inside: avoid; break-inside: avoid; }
.illus + .illus { page-break-before: always; break-before: always; }
.illus img { max-width: 100%; max-height: 95vh; height: auto; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { height: 100%; max-width: 100%; }
```

- 字体不写死 `font-family`，交给阅读器，避免在 Kindle、iOS 图书、多看、静读天下之间表现不一致；最多给出 `serif` 的回退。
- 纯插图章：每张图独占一页，不输出标题（或者把标题放在 nav 里、页面上隐藏）。图片 `alt` 为空字符串。
- 段落之间的间距使用 `margin`，**不**插入空的 `<p>`。
- 可选 `--illus-position start|end|keep`（默认 `start`）：把每卷的纯插图章移到卷首，紧跟卷标题页。这是轻小说 EPUB 的常见习惯（彩页在前）。
- 可选：用每卷插图章的第一张图作为卷标题页背景图，或者在卷标题页上方显示。默认关闭。

### 5.7 `cli.ts`

```
wenku8-epub <url|bookId> [options]

  -o, --out <dir>              输出目录，默认 ./output
  --split <mode>               full（整本一个 EPUB，默认）| volume（每卷一个 EPUB）
  --volumes <range>            只处理部分卷，如 1-3,5
  --illus-position <pos>       start | end | keep，默认 start
  --no-images                  不下载图片（调试用）
  --image-quality <n>          用 sharp 重新编码为 JPEG
  --max-image-width <px>
  --delay <ms>                 请求基础间隔，默认 1500
  --concurrency <n>            章节抓取并发数，最大 2，默认 1
  --refresh                    忽略章节缓存
  --headful                    显示浏览器窗口
```

- 输入既可以是目录页 URL，也可以是书详情页 URL 或纯书号；统一用正则解析出 `bookId`。
- 输出文件名：`{书名}.epub`，分卷模式下为 `{书名} 第N卷 {卷名}.epub`；要把 Windows 非法字符 `\/:*?"<>|` 替换为全角字符，并把长度截断到 150 个字符以内。
- 分卷模式下，每卷一个独立 EPUB：封面使用该卷第一张插图（没有插图时使用书籍封面），`dc:title` 为"书名 卷名"，并添加 `belongs-to-collection` 元数据（系列名为书名，`group-position` 为卷序号）。

整体流程：

```
解析参数 → 启动会话并过质询 → 抓目录页 + 信息页 → 解析出 Book 骨架
→ 按卷/章抓取（使用缓存）→ 解析为 Block[] → 收集所有图片 URL → 下载图片
→ 按 split 模式组装一个或多个 EPUB → 写文件 → 输出统计（章节数、字数、图片数、失败项）
```

---

## 6. 测试计划

单元测试（vitest，fixtures 全部手写虚构文本，结构严格照搬 1.4–1.7 的 DOM）：

- `parseIndexPage`：多卷、空单元格、卷下只有插图章、章名带空白。
- `parseChapterPage`：
  - 删除 `contentdp` 水印（包括重复 id 的情况）；
  - 段落数量正确，没有空段落，没有残留 `\u00A0` 或 `\u3000`；
  - 文字和图片交替出现时顺序正确；
  - 纯插图页识别为 `isIllustration`。
- `normalizeLine`：各种空白和零宽字符组合。
- `escape`：`&`、`<`、引号。
- 图片魔数识别。
- EPUB 结构：生成后用 JSZip 重新读取，断言 `mimetype` 是第一个条目且未压缩；OPF manifest 中的每个文件都实际存在；spine 中的 idref 都能在 manifest 中找到。

集成验证（手动，不进 CI）：

1. 用 `--volumes 1` 跑示例书，检查第一卷生成结果。
2. 如果本机有 Java，运行 `java -jar epubcheck.jar output/*.epub`，必须 0 error。
3. 至少在两个阅读器中打开检查：Calibre 阅读器，以及 Apple 图书 / 静读天下 / KOReader 中任意一个。检查目录层级、首行缩进、插图独占一页、封面显示。

---

## 7. 里程碑

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| M1 | 项目脚手架 + `session.ts` | 能打印目录页标题；确定无头模式是否可用并据此设置默认值 |
| M2 | 三个解析器 + 单元测试 | 测试全部通过；对真实目录页解析出 8 卷 58 章 |
| M3 | `fetcher.ts` 缓存/续抓 + `images.ts` | 中途 Ctrl+C 后重跑，不会重复请求已缓存章节 |
| M4 | EPUB 生成 + 样式 | 第一卷 EPUB 通过 epubcheck，在阅读器中排版符合 5.6 |
| M5 | CLI 全部选项、分卷模式、错误汇总 | 整本书与分卷两种模式都能一次跑通 |

---

## 8. 风险与注意事项

- **Cloudflare 策略变化**：如果页内 `fetch` 开始被拦截，退而使用 `page.goto` 逐页导航，再用 `page.content()` 获取 HTML（浏览器会按页面声明的 GBK 正确解码）。速度较慢，但最稳。
- **无头模式被识别**：保持持久化用户目录和真实 Chrome channel；不要随机修改 UA（UA 必须与浏览器指纹一致）。
- **请求频率**：默认串行并带抖动；如果遇到 429/503，自动把间隔加倍。
- **域名**：页面中混用 `wenku8.net` 和 `wenku8.com`，抓取统一使用 `www.wenku8.net`；图床域名 `pic.777743.xyz` 未来可能变化，**不要写死**，以页面中的 `img src` 为准。
- **重复 id**：`ul#contentdp` 出现两次，`#contentdp` 选择器在部分实现中只匹配第一个，需要使用属性选择器。
- **连载更新**：目录每次重新抓取，章节使用缓存，这样增量更新时只会下载新章节。
- **可选增强**（不在 M1–M5 范围内）：繁体输出（`opencc-js`）、`...` → `……` 等标点规范化开关、生成 MOBI/AZW3（调用 Calibre 的 `ebook-convert`）。
