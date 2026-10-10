# 站点资料：启迪小说（qidiy.com）

> 适配器：声明式规则 `qidiy`（`src/sites/rules/builtin/qidiy.json`）  
> 样本：<https://www.qidiy.com/book/94389/>  
> 最后核实：2026-10-10

## 访问方式

- 站点前置 **Cloudflare Turnstile**，裸 HTTP 常返回 403；需浏览器会话。
- 首次使用：`book2epub login qidiy` 或 `book2epub login https://www.qidiy.com/` 在有头窗口完成验证，profile 在 `.cache/sites/qidiy/browser-profile`。
- 目录按块分页（如「第 1–20 章」「第 21–40 章」），规则通过 `catalogue.nextPage` 自动跟页合并章节列表。

## URL 体系

| 用途 | 形式 |
| --- | --- |
| 书籍目录 | `https://www.qidiy.com/book/{bookId}/` |
| 章节正文 | `https://www.qidiy.com/book/{bookId}/{chapterId}.html`（以目录链接为准） |

## 选择器（规则内）

- 目录链接：`.listmain a`（限定 `root`）
- 目录分页：`.pagebtn a` / `.pagination a`
- 正文：`#content`、`.showtxt` 等（见规则 `chapter.content`）

## 测试

- 离线：`test/rules-paging.test.ts`（虚构 `paging.example.com` 分页目录）
- 在线：先 `login qidiy`，再 `npm run dev -- https://www.qidiy.com/book/94389/ --limit-chapters 2 --headful`
