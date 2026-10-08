# book2epub

把受支持站点上**公开、无需登录**的小说页面转换为 EPUB 3，供个人离线阅读。
项目采用**多站点适配器架构**：核心流程（抓取编排、缓存、图片、EPUB 生成）与站点无关，
新增站点只需增加一个适配器。

## 支持的站点

| 站点 | 适配器 | 状态 | 备注 |
| --- | --- | --- | --- |
| 轻小说文库 wenku8 | `wenku8` | 可用 | GBK 页面；需浏览器会话通过 Cloudflare |
| 塔读 tadu | `tadu` | **默认禁用（仅结构性骨架）** | 官方协议禁止未经书面许可的自动读取/复制/存储；见 `docs/TADU_RESEARCH.md` |

> 塔读适配器**不提供正文下载**。即使显式确认许可，`fetchChapter` 仍返回受限。

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

输出默认在 `./output`，缓存与浏览器配置在 `./.cache`（已忽略，勿提交仓库）。

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

1. 在 `src/sites/<id>/` 下实现纯解析函数（URL、目录、元数据、正文），用 fixture 单测覆盖；
2. 实现 `SiteAdapter`（见 `src/site.ts`）：`match` / `resolve` / `fetchBook` / `fetchChapter` /
   `assetRequest`，必要时提供 `coverCandidates`、`normalizeBlock`、`policy`；
3. 在 `src/registry.ts` 的 `defaultAdapters()` 中注册；
4. 运行 `test/contract.test.ts` 的通用契约测试。

若站点协议要求事先取得许可，请设置 `policy.requiresWrittenPermission = true` 并将 `enabled` 设为 `false`；
CLI 会在未显式 `--acknowledge-permission` 时拒绝运行。

## 说明

- 仅下载公开、无需登录、无需付费的内容；不绕过验证码、登录、付费、DRM 或访问控制。
- 请勿将抓取到的正文、图片提交到 git。
