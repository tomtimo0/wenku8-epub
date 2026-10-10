# 站点资料：塔读（tadu.com）

> 适配器：`src/sites/tadu/`　状态：**目录/元数据 HTTP，正文浏览器渲染抓取**（登录章需 `book2epub login tadu`）
> 样本：<https://www.tadu.com/book/catalogue/1020572>（1 个"免费章节"分组，122 章）
> 最后核实：2026-10-10

## 访问方式

- 详情、目录、章节外壳均为 UTF-8 SSR，普通 HTTP 即 200，未遇到质询；响应经 CDN，会下发 `__jsluid_s` 等 Cookie。
- 不存在的页面也可能返回 **HTTP 200 + 标题"出错了"**，必须做语义校验，不能只看状态码。
- 无头 Chrome 可正常渲染章节正文。

## URL 体系

| 用途 | 形式 |
| --- | --- |
| 详情 | `https://www.tadu.com/book/{bookId}` |
| 目录 | `https://www.tadu.com/book/catalogue/{bookId}` |
| 章节 | `https://www.tadu.com/book/{bookId}/{chapterId}/`（目录里的 href 首尾带空格，须 `trim()`） |
| 正文数据 | `/getPartContentByCodeTable/{bookId}/{ordinal}`，`ordinal` 是目录顺序号，**不是** `chapterId`；以章节页 `#bookPartResourceUrl` 的值为准 |
| 封面 | 详情页 `og:image` 或 `.bookCover img[data-src]`；`src` 是懒加载占位图 |

## 目录页

```html
<div class="boxCenter directory">
  <h1>书名</h1>
  <div class="itct"><span><em>作者：</em>…</span><span><em>分类：</em>…</span><span><em>字数：</em>…</span></div>
  <div class="chapter clearfix">
    <h2><span>免费章节<i>/122章</i></span></h2>
    <a title="首发时间:2024-04-23 21:13:58  章节字数:1034" href="  /book/{bookId}/{chapterId}/ ">章名</a>
    …
  </div>
</div>
```

- 一次返回全部章节，未见分页。`a[title]` 中的"章节字数"用于正文完整性校验。
- 分组标题含"免费"→ `public`；含"收费/VIP/会员"→ `restricted`；其他 → `unknown`。

## 详情页

Open Graph 最可靠：`og:novel:book_name`、`og:novel:author`、`og:novel:category`、`og:novel:status`、`og:description`、`og:image`。JSON-LD 另有 `pubDate`、`upDate`。可见 DOM：`.bookNm .bkNm`、`.bookNm .author`（去尾部"著"）、`p.intro`。

## 章节页与正文

初始 HTML 只有外壳：

```html
<div id="content" data-bookid="…" data-chapterid="…" data-needimagepart="0">
  <div class="read_details" id="partContent"></div>
</div>
<input id="bookPartResourceUrl" value="/getPartContentByCodeTable/{bookId}/{ordinal}">
<input id="canReadFlag" value="1">
```

页面脚本请求正文 JSON（`{ status, msg, redirectUrl, data: { content, url } }`），`data.content` 是被**打乱顺序**并掺入推广段落的 `<p data-limit="…">` 列表，脚本重排后注入 `#partContent`。

实测结论（第 1 章）：

- 渲染后 `#partContent` 有 27 个 `<p>`，正文约 1034 字，与目录声明一致。
- `data-limit` 是 **Base64 编码的数字 ID**（如 `MTAxODI2OTA2` → `101826906`）。
- 推广段落的 `data-limit` 解码后**等于当前 `chapterId`**；按此规则剔除即可，比文案匹配可靠。现有 `parse-rendered-chapter.ts` 直接拿未解码的属性和 chapterId 比较，永远匹配不上（ROADMAP 缺陷 D3）。
- 匿名访问时，约第 30 章以后的页面出现 `.shelter` 遮挡层和扫码登录提示；`canReadFlag` 仍可能为 `1`，因此"是否可读"必须看渲染后的遮挡层和正文长度。
- `data-needimagepart="1"` 时正文以图片分页呈现（`img.chapterImg`），样本书未出现，未实现。

## 推荐实现

目录、详情走 HTTP；正文用浏览器打开章节页，等待 `#partContent p` 或 `.shelter` 出现，再在页面内按**渲染后的视觉顺序**（`getBoundingClientRect().top`）提取段落，剔除推广段，最后与 `expectedCharacters` 比对。需要读取登录后可见的章节时，使用 `book2epub login tadu` 在持久化 profile 中人工登录一次（ROADMAP 工作包 W2）。
