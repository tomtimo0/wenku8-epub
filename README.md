# book2epub

把受支持站点上**公开、无需登录**的小说页面转换为 EPUB 3，供个人离线阅读。
项目采用**多站点适配器架构**：核心流程（抓取编排、缓存、图片、EPUB 生成）与站点无关，
新增站点只需增加一个适配器。

## 支持的站点

| 站点 | 适配器 | 状态 | 备注 |
| --- | --- | --- | --- |
| 轻小说文库 wenku8 | `wenku8` | 可用 | GBK 页面；需浏览器会话通过 Cloudflare |
| 塔读 tadu | `tadu` | **默认禁用（仅结构性骨架）** | 官方协议禁止未经书面许可的自动读取/复制/存储；见 `docs/TADU_RESEARCH.md` |
| 未知站点 | `generic` | **实验，默认关闭** | 启发式探测（`--experimental-auto`）；未达置信度门槛会明确拒绝 |

> 塔读适配器**不提供正文下载**。即使显式确认许可，`fetchChapter` 仍返回受限。
>
> 通用探测不承诺"任意网址都能抓取"：它只在书名列、章节链接簇、样章正文三项都达到
> 置信度门槛时才运行，否则输出诊断并提示编写专用适配器，绝不静默生成残缺 EPUB。

## 环境

- Node.js ≥ 20
- 本机 Chrome（推荐，便于通过 Cloudflare）或 Playwright Chromium

## 安装

```bash
npm install
npx playwright install chromium
```

## 使用

```bash
# 自动识别站点
npm run dev -- https://www.wenku8.net/novel/2/2896/index.htm

# 或指定站点（推荐，避免纯数字歧义）
npm run dev -- --site wenku8 2896

# 构建后使用
npm run build && npm start -- --site wenku8 2896 --volumes 1
```

常用选项：

| 选项 | 说明 |
| --- | --- |
| `--site <wenku8\|tadu>` | 强制指定适配器 |
| `-o, --out <dir>` | 输出目录，默认 `./output` |
| `--split full\|volume` | 整本一个 EPUB / 每卷一个 |
| `--volumes <range>` | 只处理部分卷，如 `1-3,5` |
| `--illus-position start\|end\|keep` | 插图章位置策略，默认 `start` |
| `--limit-chapters <n>` | 只抓前 n 章（集成测试/探测） |
| `--no-images` | 不下载图片（调试） |
| `--image-quality` / `--max-image-width` | 用 sharp 重编码图片 |
| `--include-placeholders` | 为受限/失败章节写占位章 |
| `--strict` | 内容可疑或失败时以非零码结束 |
| `--refresh` | 忽略章节缓存 |
| `--headful` | 显示浏览器窗口 |
| `--acknowledge-permission` | 确认已取得需要书面许可站点的授权 |
| `--experimental-auto` | （实验）未知站点启发式探测；默认只输出 dry-run 诊断 |
| `--accept-detected` | （实验）接受探测结果并抓取（首版最多 3 章） |

输出默认在 `./output`，缓存与浏览器配置在 `./.cache`（已忽略，勿提交仓库）。

## 未知站点（实验探测）

对没有专用适配器的站点，可先只读探测其结构（不会保存正文），确认后再抓取：

```bash
# 1) dry-run：输出诊断并写入 ./output/inspection.json
npm run dev -- --experimental-auto https://example.com/book/1234

# 2) 接受探测结果并抓取（首版最多 3 章，配合 --limit-chapters 调整）
npm run dev -- --experimental-auto --accept-detected \
  https://example.com/book/1234 --limit-chapters 3 --no-images
```

诊断命令与脚手架：

```bash
book2epub inspect https://example.com/book/1234 -o ./output
book2epub scaffold-adapter example --from ./output/inspection.json --out ./scaffold
```

`inspect` 只保存结构化诊断（选择器候选、链接簇、样章字数等），不保存正文；
`scaffold-adapter` 生成适配器、解析函数与契约定制骨架，需要人工补全后再注册。

探测的置信度门槛（必须同时满足）：识别到书名、至少 2 条同构同源章节链接、
链接文本以"第…章/卷"等章节特征为主、样章正文有足够字符且链接密度低、
未检测到登录/付费/验证码遮挡。任一不满足即拒绝运行并说明原因。

## 缓存布局

```text
.cache/
  sites/{site}/browser-profile/
  books/{site}/{bookId}/
    book.json
    catalogue.html
    chapters/{chapterId}.json
    assets/{sha256(url)}.{ext}
```

章节缓存保存**规范化结果 JSON**（含 `parserVersion`）；适配器提升 `parserVersion` 后旧缓存自动失效。
断网时若已有 `book.json` 与章节缓存，仍可重新生成 EPUB。

## 测试

```bash
npm test          # 单元测试与适配器契约测试（fixtures 全为虚构文本）
```

受控集成测试（会访问真实站点，请自行确认合规）：

```bash
npm run test:live -- https://www.wenku8.net/novel/2/2896/index.htm \
  --site wenku8 --limit-chapters 2 --no-images
```

## 新增站点适配器

0. 可选：用 `book2epub inspect <url>` 得到诊断，再用 `book2epub scaffold-adapter` 生成骨架；
1. 在 `src/sites/<id>/` 下实现纯解析函数（URL、目录、元数据、正文），用 fixture 单测覆盖；
2. 实现 `SiteAdapter`（见 `src/site.ts`）：`match` / `resolve` / `fetchBook` / `fetchChapter` /
   `assetRequest`，必要时提供 `coverCandidates`、`normalizeBlock`、`policy`；
3. 在 `src/registry.ts` 的 `defaultAdapters()` 中注册；
4. 运行 `test/contract.test.ts` 的通用契约测试。

若站点协议要求事先取得许可，请设置 `policy.requiresWrittenPermission = true` 并将 `enabled` 设为 `false`；
CLI 会在未显式 `--acknowledge-permission` 时拒绝运行。

## 说明

- 仅下载公开、无需登录、无需付费的内容；不绕过验证码、登录、付费、DRM 或访问控制。
- 图片下载只允许 `http(s)`，拒绝私网/保留地址、`file:` 与 SVG；逐跳校验重定向，
  并限制单图与整本图片总量，避免 SSRF 与资源耗尽。
- 请勿将抓取到的正文、图片提交到 git。
