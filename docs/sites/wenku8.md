# 站点资料：轻小说文库（wenku8）

> 适配器：`src/sites/wenku8/`　状态：**可用**（2026-10-10 端到端验收通过）
> 样本：<https://www.wenku8.net/novel/2/2896/index.htm>（书号 2896，8 卷 58 章，含插图章）

## 访问方式

| 项目 | 结论 |
| --- | --- |
| 直接 HTTP（curl/fetch） | 403，`cf-mitigated: challenge`，Cloudflare 托管质询 |
| 真实浏览器（Playwright + 本机 Chrome） | 可通过质询；持久化 profile 后通常不用再验证 |
| 质询通过后页内 `fetch()` 同源页面 | 可行，约 0.8 秒/页 |
| 图床 `pic.777743.xyz`、封面 `img.wenku8.com` | 无 Cloudflare，Node 直接下载，带 `Referer: https://www.wenku8.net/` |
| 官方 TXT 打包下载 `packshow.php` | 需登录，不使用 |

页面编码 **GBK**：页内 `fetch` 后用 `new TextDecoder('gbk')` 解码再传回 Node，不能用 `res.text()`。

## URL 规律

- 目录：`/novel/{floor(bookId/1000)}/{bookId}/index.htm`
- 章节：同目录 `{chapterId}.htm`
- 书籍信息：`/book/{bookId}.htm`
- 封面：`http://img.wenku8.com/image/{floor(bookId/1000)}/{bookId}/{bookId}s.jpg`（`s` 为缩略图；适配器先试去掉 `s` 的大图）

## DOM 要点

目录页：`#title` 书名，`#info` 作者（去掉"作者："）；按文档顺序遍历 `table.css td`，`td.vcss`（`vid` 属性）开新卷，含 `a` 的 `td.ccss` 追加章节，空单元格跳过。

信息页：`table td` 中的"文库分类 / 小说作者 / 文章状态 / 最后更新 / 全文长度：值"。

章节页：正文在 `#content`，模式为 `&nbsp;×4 + 文本 + <br><br>`；其中夹两个 `ul#contentdp` 水印（**id 重复**，用 `ul[id="contentdp"]` 删除）。插图为 `#content img.imagecontent`；纯插图章以"全部块都是图片"判定，不看标题。

## 已知问题

- 默认有头运行（需要时人工过 Cloudflare）；无头模式能否稳定通过未系统验证。
- `fetchChapter` 会先读旧版缓存 `.cache/html/{bookId}/{chapterId}.html`，此路径不受 `--refresh` 控制（见 ROADMAP 缺陷 D7）。
