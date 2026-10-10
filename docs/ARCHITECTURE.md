# 架构说明（现状）

> 描述 2026-10-10 时代码的实际结构。目标架构与待办见 [ROADMAP.md](ROADMAP.md)，各站点的页面细节见 [sites/](sites/)。

## 数据流

```
CLI (src/cli.ts)
  └─ registry.selectAdapter(input)          按 match() 分数选唯一适配器
       └─ orchestrator.runConvert()
            ├─ adapter.resolve(input)        → SourceRef { site, bookId, canonicalUrl }
            ├─ adapter.fetchBook(ref, ctx)   → Book 骨架（卷/章，无正文）
            ├─ 逐章 adapter.fetchChapter()   → ok | restricted | failed（带缓存、重试）
            ├─ images.resolveBookImages()    → 图片下载、魔数识别、可选 sharp 重编码
            ├─ epub/builder.buildEpub()      → EPUB 3（nav + ncx，卷→章两级）
            └─ report()                      → 成功/受限/失败/可疑统计
```

`ScrapeContext = { http, browser, cache }` 由编排层创建并注入适配器；适配器自己决定用 HTTP 还是浏览器。

## 模块地图

| 路径 | 职责 |
| --- | --- |
| `src/types.ts` | 领域模型：`SourceRef`、`Book`、`Volume`、`Chapter`（含 `url`、`access`、`expectedCharacters`、`locator`）、`Block`（段落/图片） |
| `src/site.ts` | `SiteAdapter`、`AdapterCapabilities`、`ChapterFetchResult`、`ScrapeContext` |
| `src/core/` | `errors.ts`、`run.ts`（`RunController` 与退出码）、`run-state.ts`（`run.json`） |
| `src/registry.ts` | 适配器注册与选择；纯数字输入默认 wenku8（弃用提示）；`experimentalAdapters()` 追加 `generic` |
| `src/orchestrator.ts` | 抓取编排、章节缓存、退出码 0/2/3/130、0 章成功不写 EPUB、`run.json` |
| `src/commands/` | `login.ts`、`doctor.ts` |
| `src/transports/http.ts` | 编码嗅探（`charset.ts`）、响应分类（`classify.ts`）、限速抖动、退避重试 |
| `src/transports/browser.ts` | 懒启动、页面池、`ensureReady` / `fetchHtml` / `renderHtml`；无 SIGINT 监听 |
| `src/transports/cache.ts` | `.cache/` 下的文本/JSON/二进制读写与键约定 |
| `src/net/safe-url.ts` | http(s) 白名单、私网地址拦截、逐跳校验重定向 |
| `src/images.ts` | 图片收集与下载（按 URL SHA-256 缓存）、格式识别、大小上限、封面获取 |
| `src/epub/` | `builder.ts` 组装 zip，`templates.ts` 生成 OPF/nav/NCX/XHTML，`style.css` 排版，`escape.ts` XML 转义 |
| `src/illus.ts` | 卷范围解析、插图章统计、分卷封面 |
| `src/text/normalize.ts` | 行级清洗：空白、零宽字符、wenku8 水印 |
| `src/sites/wenku8/` | 浏览器过 Cloudflare + 页内 fetch + GBK；三个纯解析器 |
| `src/sites/tadu/` | HTTP 目录/详情；章节正文经浏览器渲染 + `parse-rendered-chapter`（含 Base64 `data-limit`） |
| `src/sites/generic/` | 启发式探测：链接簇聚类（`inspect.ts`）、置信度门槛（`probe.ts`）、正文候选评分、遮挡检测；`run-inspect.ts` 供 `inspect` 命令 |
| `src/scaffold.ts` | 依据 `inspection.json` 生成 TypeScript 适配器骨架 |

## 缓存布局

```text
.cache/
  sites/{site}/browser-profile/          每站点独立的浏览器 profile（含 Cookie、登录态）
  books/{site}/{bookId}/
    book.json                            Book 骨架（断网重建 EPUB 用）
    catalogue.html
    chapters/{chapterId}.json            { parserVersion, status, blocks, warnings, fetchedAt, sourceUrl }
    assets/{sha256(url)}.{ext}
  html/{bookId}/{chapterId}.html         旧版 wenku8 缓存，只读兼容
```

失败结果不落盘，下次运行自动续抓；`parserVersion` 变化使旧章节缓存失效。

## 扩展点

新增站点目前需要写一个 `SiteAdapter`（`src/sites/<id>/`）并在 `registry.defaultAdapters()` 注册，再跑 `test/contract.test.ts` 的通用契约测试。ROADMAP 计划在适配器之下增加"声明式站点规则"一层，让大多数站点只需一份 JSON。

## 测试

`npm test` 运行 9 个测试文件、67 个用例（fixtures 全为虚构文本）：wenku8/tadu 解析器、HTTP 编码、注册表、适配器契约、通用探测、SSRF、EPUB 结构。
