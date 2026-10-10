# book2epub

把小说网站上的书转换为排版良好的 EPUB 3（含插图），供个人离线阅读。
核心流程（抓取编排、缓存、图片、EPUB 生成）与站点无关，站点差异封装在适配器里。

## 当前状态

| 站点 | 适配器 | 状态 |
| --- | --- | --- |
| 轻小说文库 wenku8 | `wenku8` | 可用：GBK 页面，浏览器会话通过 Cloudflare |
| 塔读 tadu | `tadu` | 正文经浏览器渲染抓取；登录后章节需 `book2epub login tadu` |
| 声明式规则 | `fic-static` 等 | 内置 JSON 规则（`src/sites/rules/builtin/`） |
| 其他站点 | `generic` | 启发式探测 → 学到规则或 `RuleAdapter` 抓取 |

开发计划与已知缺陷见 [docs/ROADMAP.md](docs/ROADMAP.md)，代码结构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，各站点页面资料见 [docs/sites/](docs/sites/)。

## 环境

- Node.js ≥ 20
- 本机 Chrome（推荐），或执行 `npx playwright install chromium`

## 安装

```bash
npm install
```

## 使用

```bash
# 自动识别站点
npm run dev -- https://www.wenku8.net/novel/2/2896/index.htm

# 指定站点 + 书号
npm run dev -- --site wenku8 2896 --volumes 1

# 构建后使用
npm run build && npm start -- <URL>
```

常用选项：

| 选项 | 说明 |
| --- | --- |
| `--site <id>` | 强制指定适配器 |
| `-o, --out <dir>` | 输出目录，默认 `./output` |
| `--split full\|volume` | 整本一个 EPUB / 每卷一个 |
| `--volumes <range>` | 只处理部分卷，如 `1-3,5` |
| `--illus-position start\|end\|keep` | 插图章位置，默认 `start`（彩页在卷首） |
| `--limit-chapters <n>` | 只抓前 n 章 |
| `--no-images` | 不下载图片 |
| `--image-quality <n>` / `--max-image-width <px>` | 用 sharp 重编码图片 |
| `--include-placeholders` | 为受限/失败章节写占位章 |
| `--strict` | 有失败或可疑章节时以非零码结束 |
| `--refresh` | 忽略章节缓存重新抓取 |
| `--headful` | 显示浏览器窗口 |

首次运行 wenku8 若遇 Cloudflare，请在弹出的浏览器窗口完成验证，会话保存在 `.cache/sites/wenku8/browser-profile`。

需要登录的站点（如塔读付费章）可先执行：

```bash
npm run dev -- login tadu
npm run dev -- doctor
npm run dev -- rules list
npm run dev -- learn https://novel.example.com/book/1234/
npm run dev -- update ./output/书名.epub
npm run dev -- --format both --verify-epub <URL>
```

转换结束时的退出码：`0` 全部成功，`2` 部分成功（仍写出 EPUB），`3` 无章节成功（不写 EPUB），`130` 用户中断。

## 未知站点探测（实验）

```bash
book2epub inspect <url> -o ./output          # 只输出结构诊断到 ./output/inspection.json
npm run dev -- --experimental-auto --accept-detected <url> --limit-chapters 3
book2epub scaffold-adapter <siteId> --from ./output/inspection.json --out ./scaffold
```

## 缓存

```text
.cache/
  sites/{site}/browser-profile/
  books/{site}/{bookId}/
    book.json
    catalogue.html
    chapters/{chapterId}.json
    assets/{sha256(url)}.{ext}
```

章节缓存保存解析后的 JSON，适配器提升 `parserVersion` 后自动失效；失败章节不缓存，重跑即断点续抓；断网时可用缓存重新生成 EPUB。

## 测试

```bash
npm test                                         # 单元与契约测试，夹具均为虚构文本
npm run test:live   # 按 test/live/matrix.json 跑在线冒烟，报告 output/live-report.md
```

## 新增站点

1. 在 `src/sites/<id>/` 实现纯解析函数并用夹具单测；
2. 实现 `SiteAdapter`（`src/site.ts`），在 `src/registry.ts` 注册；
3. 运行 `test/contract.test.ts` 契约测试；
4. 在 `docs/sites/<id>.md` 记录页面结构。

计划中的声明式规则引擎（ROADMAP W4）会让大多数站点只需一份 JSON 规则。

请勿把抓取到的正文、图片提交到 git（`.cache/`、`output/`、`*.epub` 已忽略）。
