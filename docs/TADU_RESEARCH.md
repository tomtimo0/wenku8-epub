# 塔读（tadu.com）站点适配调研

> 调研日期：2026-10-08  
> 目标样本：<https://www.tadu.com/book/catalogue/1020572>  
> 范围：仅访问公开页面、公开静态资源，并对首章做一次结构探测；未登录、未处理验证码、未访问付费内容、未抓取整本正文。

## 结论摘要

1. **当前不应直接实现或启用塔读正文抓取。** 塔读官方《易天新动软件用户协议》明确写明：未经书面许可，禁止使用爬虫、蜘蛛、拟人程序、其他自动设备或手动程序读取、复制、存储软件或其中内容。robots.txt 虽未禁止 `/book`，但 robots 规则不是内容使用授权。应先取得书面许可或由项目使用者完成合规评估。
2. 目标站的图书详情和目录是 **UTF-8 的服务端渲染 HTML**；章节阅读页只有服务端渲染的页面外壳，正文由同源 JSON 接口异步加载，属于 **SSR 外壳 + CSR 正文**。
3. 目录页一次返回样本书全部 **122 个免费章节**，未发现分页控件或目录异步接口。章节链接包含稳定的 `bookId` 和 `chapterId`，但正文接口使用章节顺序号（1、2、……122），不能把二者混为一个 ID。
4. 首章可匿名读取；第 122 章页面出现登录遮挡层和 APP 扫码提示。即使页面 HTML 暴露正文接口路径，也不得直接调用来绕过遮挡。目录中的“免费章节”也不等于“所有章节均可匿名网页读取”。
5. 现有代码把 URL、会话和解析流程绑定到 wenku8。未来应引入站点适配器与访问策略层，但塔读适配器应保持禁用，直至取得明确授权。

## 1. 调研方法与限制

- 使用少量 `GET`/`HEAD` 请求检查目标目录页、详情页、首章阅读页、末章阅读页、首章公开正文接口、封面、robots.txt 和官方协议。
- 正文只探测首章一次，仅统计响应结构、标签和图片数量，不保存正文，不在本文引用正文。
- 末章只读取页面外壳以判断登录边界，**未请求末章正文接口**。
- 未做压力、并发、速率阈值或验证码测试；因此不能断言站点没有限流或风控。
- 浏览器自动化服务在本次环境中不可用；页面 HTML、官方 JS 和网络端点均通过普通 HTTP 请求核实。由于目标页面本身可直接返回完整 SSR 外壳，这不影响下述结构结论。

## 2. URL 体系

| 用途 | 已核实形式 | 备注 |
| --- | --- | --- |
| 图书详情 | `https://www.tadu.com/book/{bookId}` | 样本：<https://www.tadu.com/book/1020572> |
| 目录 | `https://www.tadu.com/book/catalogue/{bookId}` | 样本目标 URL |
| 章节阅读页 | `https://www.tadu.com/book/{bookId}/{chapterId}/` | 末尾 `/` 可省略，实测均返回 200 |
| 正文数据 | `https://www.tadu.com/getPartContentByCodeTable/{bookId}/{ordinal}` | `ordinal` 是目录顺序号，不是 `chapterId` |
| 移动阅读页 | `https://m.tadu.com/book/{bookId}/{chapterId}` | PC 阅读页的 `mobile-agent` 元数据公开声明此 URL；HTTP 会跳到 HTTPS |
| 封面 | 页面提供的 `og:image` / `img[data-src]` 绝对 URL | 位于 `media3.tadu.com`，不要推导路径 |

样本映射：

- 第 1 章：页面 `chapterId=101826908`，正文资源 `/getPartContentByCodeTable/1020572/1`。
- 第 2 章：页面 `chapterId=101826909`，正文资源 `/getPartContentByCodeTable/1020572/2`。
- 第 122 章：页面 `chapterId=101847860`，正文资源路径序号为 `122`，但页面存在登录遮挡，未请求其正文。

实现含义：领域模型至少要分开保存 `chapterId`、`ordinal`、`canonicalUrl` 和站点私有 locator，不能继续假定“章节 ID 就足以构造所有资源 URL”。

来源：

- <https://www.tadu.com/book/catalogue/1020572>
- <https://www.tadu.com/book/1020572>
- <https://www.tadu.com/book/1020572/101826908/>
- <https://www.tadu.com/book/1020572/101826909/>
- <https://www.tadu.com/book/1020572/101847860/>

## 3. 目录数据、分组与分页

目录页是 UTF-8 SSR HTML，不依赖 JS 才能取得目录：

```html
<div class="chapter clearfix">
  <h2><span>免费章节<i>/122章</i></span></h2>
  <a
    title="首发时间:2024-04-23 21:13:58  章节字数:1034"
    href="/book/1020572/101826908/"
  >
    第一章 大难不死的男孩
  </a>
</div>
```

实测：

- `.chapter` 容器 1 个，标题为“免费章节/122章”。
- 容器内有 122 个目标书章节链接，页面一次全部返回。
- 未发现 `.page`、`.pagination` 等分页标记，也未发现目录页发起章节目录 AJAX 的证据。
- 每个 `<a>` 的正文文本是章名，`href` 提供 `chapterId`，`title` 同时提供首发时间和章节字数。
- 当前样本只有“免费章节”这一组，未观察到卷级结构或收费章节组，不能据此推断其他书均无卷、无分页。

推荐解析规则：以 `.chapter h2` 建分组，以 `.chapter a[href*="/book/{bookId}/"]` 建章节；将链接两侧空白 `trim()` 后再解析。不要把“免费章节”直接映射成 EPUB 卷名，可将其视为站点目录分组。

来源：<https://www.tadu.com/book/catalogue/1020572>

## 4. 图书元数据、简介与封面

详情页 <https://www.tadu.com/book/1020572> 是 SSR HTML，并提供适合稳定解析的 Open Graph 小说字段：

- `og:novel:book_name`：书名
- `og:novel:author`：作者
- `og:novel:category`：分类
- `og:novel:status`：状态（样本为“连载”）
- `og:description`：简介
- `og:image`：封面绝对 URL
- `og:novel:latest_chapter_name` / `og:novel:latest_chapter_url`：最新章

页面 JSON-LD 还给出：

- `pubDate`：`2024-04-23 16:47:45`
- `upDate`：`2026-03-30 17:15:37`
- `images`：同一封面 URL

页面可见区还包含约 `34.6万` 字、分类“西方奇幻”、作者和连载状态。封面节点先放占位图，真实封面在 `img[data-src]`；`og:image` 与 `data-src` 一致。封面请求实测返回：

- HTTP 200
- `Content-Type: image/jpeg`
- `Content-Length: 3849`
- `Server: AliyunOSS`
- `Access-Control-Allow-Origin: *`

解析优先级建议：Open Graph/JSON-LD → 可见 DOM；封面直接使用页面声明的绝对 URL，不推导 CDN 路径。

来源：

- <https://www.tadu.com/book/1020572>
- <https://media3.tadu.com//2024/04/23/16/59/c7cfe701b69044e793f8a0d87946460a_a.jpg>

## 5. 章节正文与图片

### 5.1 阅读页外壳

章节页面是 UTF-8 SSR 外壳。关键字段：

```html
<div
  id="content"
  data-bookid="1020572"
  data-chapterid="101826908"
  data-islogin=""
  data-pagesize=""
  data-needimagepart="0"
>
  <div class="read_details" id="partContent"></div>
</div>
<input
  type="hidden"
  id="bookPartResourceUrl"
  value="/getPartContentByCodeTable/1020572/1"
>
<input type="hidden" id="canReadFlag" value="1">
```

`#partContent` 在初始 HTML 中为空。官方 `read300-*.js` 从 `#bookPartResourceUrl` 发起同源 GET，再把返回内容填入阅读区。

### 5.2 正文接口

只对首章做了一次请求：

`GET https://www.tadu.com/getPartContentByCodeTable/1020572/1`

响应：

- HTTP 200
- `Content-Type: application/json;charset=UTF-8`
- 顶层结构：`{ status, msg, redirectUrl, data }`
- `status=200`，`msg="成功"`
- `data` 含 `content` 与 `url`
- `data.content` 是 HTML 片段；首章共 28 个 `<p>`，无 `<br>`、无 `<img>`

注意：阅读页末尾保留了一段被注释掉的旧 JSONP 示例，它读取 `result.content`；当前公开脚本和实测响应使用 JSON，正文位于 `data.content`。实现不能照抄旧注释。

### 5.3 图片化正文与正文插图

官方 JS 存在两条分支：

- `data-needimagepart="0"`：请求 JSON，使用 `data.content`。
- `data-needimagepart="1"`：按 `data-pagesize` 创建多个 `img.chapterImg`，图片 URL 仍基于 `bookPartResourceUrl`，并带字体、页宽、背景和页码参数。

样本首章与末章页面的 `data-needimagepart` 均为 `0`。首章正文片段没有图片；本书目录标题也没有明确插图章。因此：

- **已核实**：文本正文是 `<p>` 列表；站点代码支持图片化正文。
- **未核实**：普通章节内插图的 HTML 属性、图片 CDN、防盗链要求和图片化正文响应格式。
- **禁止性建议**：图片化正文很可能是展示/保护机制，不应 OCR、拼接或转换来规避站点阅读方式。若未来获得授权，也应由站点方明确允许并提供接口说明。

来源：

- <https://www.tadu.com/book/1020572/101826908/>
- <https://www.tadu.com/getPartContentByCodeTable/1020572/1>
- <https://media3.tadu.com/web_dubbo_static//prod/js/v300/read300-a659f592db.js>

## 6. 编码与渲染模式

| 页面/资源 | 编码 | 渲染结论 |
| --- | --- | --- |
| 图书详情 | UTF-8 | SSR，元数据和主要可见内容在初始 HTML |
| 目录 | UTF-8 | SSR，122 个章节链接均在初始 HTML |
| 章节页 | UTF-8 | SSR 页面外壳，正文容器为空 |
| 正文接口 | UTF-8 JSON | CSR 注入 `data.content` |
| 封面 | JPEG | CDN/OSS 静态资源 |

这与 wenku8 的 GBK 页面和浏览器内解码流程不同。未来 `SiteAdapter` 必须声明编码及渲染模式，不能把 GBK、Cloudflare 会话或 `TextDecoder('gbk')` 设为全局默认。

## 7. 登录、免费与付费边界

目标目录显示“免费章节/122章”，但匿名 PC 阅读仍存在边界：

- 首章页面：`canReadFlag=1`，没有遮挡层；显示“登录后看书更方便”的普通游客提示。
- 第 122 章页面：`canReadFlag=1` 且暴露资源路径，但存在 `<div class="shelter">` 和 APP 扫码登录提示，不显示普通游客登录框。
- 页面源码注释明确称该区域为“超过30章节未登录用户遮挡章节内容”。
- 官方隐私政策说明，未登录不影响搜索、浏览等功能，但可能影响购买图书、评论等附加业务。这不构成对批量下载或绕过网页遮挡的授权。
- 官方用户协议说明数字内容同时包括免费和收费内容，付费内容订阅后有阅读期限。

因此访问策略必须基于**实际页面状态**，而不能只看目录标签或接口是否可猜：

1. 遇到 `.shelter`、APP 扫码、登录、VIP、订阅、充值等提示，停止该章节。
2. 不直接调用页面暴露的资源 URL 来绕过遮挡。
3. 不自动登录，不保存或复用用户凭据，不处理验证码，不访问已购内容。
4. “HTTP 200”不代表可读取：必须同时检查页面语义和访问提示。

来源：

- <https://www.tadu.com/book/catalogue/1020572>
- <https://www.tadu.com/book/1020572/101826908/>
- <https://www.tadu.com/book/1020572/101847860/>
- <http://media7.tadu.com/static_page/yinsixieyi.html>
- <http://media7.tadu.com/static_page/yonghuxieyi.html>

## 8. robots、协议与使用限制

### 8.1 robots.txt

<https://www.tadu.com/robots.txt> 当前内容：

```text
User-agent: *
Allow: /
Disallow: /tadu/
Disallow: /search
Disallow: /search?query=*
Disallow: /*.css
Disallow: /*.js

Sitemap: https://www.tadu.com/sitemap.xml
```

`/book` 和 `/getPartContentByCodeTable` 未被 robots 明示禁止；官方 JS/CSS 则被禁止抓取。本文仅为一次性结构核验读取了一个官方 JS，产品实现不应持续抓取这些静态脚本。

robots.txt 只表达爬虫路径偏好，**不授予复制、存储或再利用内容的许可**。

### 8.2 官方用户协议

官方《易天新动软件用户协议》（页面标注更新/生效日期为 2020-07-02）在“对用户和第三方知识产权的保护”中明确规定：

> 未经易天新动书面许可，禁止使用任何爬虫程序、蜘蛛程序、拟人程序、其他自动设备，或手动程序来读取、复制、存储本软件或其所包含的任何内容。

同一协议的会员条款还禁止未经明确授权通过机器人、蜘蛛、爬虫等自动程序获取会员服务、内容或数据。

这对“网站 → EPUB”自动化是直接风险。即使目的为个人离线阅读、目标章节标记为免费，也不能从公开可访问推导出允许自动读取和存储。**建议把取得塔读书面许可作为实现/启用适配器的前置条件。**

来源：

- <https://www.tadu.com/robots.txt>
- <http://media7.tadu.com/static_page/yonghuxieyi.html>
- <http://media7.tadu.com/static_page/yinsixieyi.html>

### 8.3 sitemap

robots.txt 声明了 <https://www.tadu.com/sitemap.xml>，但本次普通请求得到空响应，远程读取服务得到 504；未获得可用站点地图。它不影响单书 URL 的核实，但不能作为书籍发现来源。

## 9. 反爬与错误响应

少量请求下的实测：

- 详情、目录、章节外壳、首章正文接口均返回 HTTP 200。
- 空 User-Agent、`curl/8.0` 和常见浏览器 User-Agent 均取得相同目录页；未出现验证码或 JS 质询页。
- 响应经过 CDN，包含 `X-Via-JSL`，并设置 `__jsluid_s` 等 Cookie；这说明站点接入了风控/CDN，但本次未触发挑战。
- 未观察到 429、403 或 503；为了克制访问，没有主动测试请求频率阈值。
- 若干不存在的“协议猜测 URL”会返回 HTTP 200，但标题是“出错了-塔读文学网”。因此抓取器必须检查预期 DOM/语义，不能只检查状态码。

建议的通用失败分类：

- `access-denied`：登录、扫码、VIP、订阅、验证码、遮挡层；
- `challenge`：质询页或要求执行验证；
- `semantic-error`：HTTP 200 但预期结构不存在或是“出错了”页；
- `rate-limited`：429/明确频控提示；
- `transient`：5xx、超时；
- `unsupported-rendering`：图片化/加密正文等未获授权的展示方式。

实现必须对前三类立即停止，不应通过换 UA、换 IP、直调隐藏接口或自动登录来规避。

## 10. 面向多站点的架构建议

现有实现中的 `urls.ts`、`Wenku8Session`、`BookFetcher` 及解析器直接绑定 wenku8。建议把站点差异收进深适配器，而把 EPUB、缓存和流程编排保持站点无关。

建议接口轮廓：

```ts
/** 站点访问边界与渲染能力。 */
interface SiteCapabilities {
  charset: 'utf-8' | 'gbk';
  catalogueRendering: 'ssr' | 'csr';
  chapterRendering: 'ssr' | 'json' | 'browser';
  requiresWrittenPermission?: boolean;
}

/** 站点私有章节定位信息。 */
interface ChapterLocator {
  canonicalId: string;
  ordinal?: number;
  canonicalUrl: string;
  resourceUrl?: string;
}

/** 将站点差异封装在单一模块。 */
interface SiteAdapter {
  readonly id: string;
  readonly capabilities: SiteCapabilities;
  matches(input: string): boolean;
  parseInput(input: string): { bookId: string };
  fetchBook(bookId: string): Promise<Book>;
  fetchCatalogue(bookId: string): Promise<Volume[]>;
  inspectChapter(locator: ChapterLocator): Promise<AccessDecision>;
  fetchChapter(locator: ChapterLocator): Promise<Block[]>;
}
```

关键设计约束：

1. **访问判断先于正文请求**：`inspectChapter` 返回 `allow`、`login-required`、`paid`、`challenge`、`unsupported` 等；只有 `allow` 才能继续。
2. **URL 与资源定位解耦**：塔读章节 URL 使用 `chapterId`，正文接口使用 `ordinal`；wenku8 则可用同一个章节 ID 推导 HTML URL。
3. **抓取与解析解耦**：适配器负责返回规范化 `Book`/`Block[]`，EPUB 层不认识站点 DOM。
4. **会话按站点注入**：wenku8 需要浏览器/GBK；塔读公开页可用普通 UTF-8 HTTP，但不得因此绕过登录边界。
5. **能力与政策同为配置**：增加 `requiresWrittenPermission`、允许路径、最大匿名范围和停止条件；CLI 在未配置许可时拒绝启用受限适配器。
6. **缓存键包含站点**：建议 `.cache/{siteId}/{bookId}/...`，避免不同站点 ID 碰撞。
7. **原始页面最小化存储**：默认只缓存规范化数据；若站点协议不允许存储，则完全禁用该适配器缓存。
8. **不要实现通用“绕过器”**：自动登录、验证码处理、付费态 Cookie、遮挡层后直调接口、图片正文 OCR 均不应成为框架能力。

塔读适配器若未来取得书面授权，可按以下模块拆分：

- `tadu/urls.ts`：详情、目录、章节 canonical URL；
- `tadu/parse-book.ts`：Open Graph + JSON-LD；
- `tadu/parse-catalogue.ts`：`.chapter` 分组和章节 locator；
- `tadu/access.ts`：遮挡、登录、VIP、扫码、图片化正文检查；
- `tadu/parse-content.ts`：仅解析获准 JSON 的 `data.content > p`；
- `tadu/policy.ts`：许可状态及允许范围。

在取得授权前，只适合实现**纯结构性、默认禁用**的适配器骨架和测试夹具，不应实现真实正文下载。

## 11. 已核实与仍待验证

### 已核实

- 详情、目录、章节、正文接口、封面的 URL 形态。
- 详情和目录为 SSR；章节正文为 CSR JSON。
- UTF-8 编码。
- 目录样本一次返回 122 章，无可见分页。
- 元数据、简介、封面和更新日期的可靠来源。
- `chapterId` 与正文接口 `ordinal` 是两套标识。
- 首章正文是 `<p>` 列表，样本无图。
- 第 122 章匿名页面有遮挡和 APP 扫码提示。
- robots.txt 路径规则。
- 官方协议对未经许可自动读取、复制和存储的明确限制。
- 少量直接请求未触发验证码/限流，但存在 CDN/JSL Cookie。

### 待验证（必须在许可明确后）

- 塔读是否愿意为个人离线 EPUB 场景提供书面许可或官方导出/API。
- 其他书籍的卷结构、收费目录分组和目录分页。
- 登录后、会员、已购和付费章节的正式 API 与授权范围（本次未触碰）。
- 普通正文中的插图 DOM、图片来源、防盗链和格式。
- `data-needimagepart=1` 的适用条件与站点授权处理方式；不应通过 OCR 研究。
- 429/频控阈值、验证码触发条件和推荐请求频率；不应通过压力测试获取。
- sitemap 空响应是临时故障、CDN 行为还是已停用。
- 协议后续更新；实现前应重新核对官方协议和 robots.txt。

## 12. 实施决策建议

当前建议为 **No-Go（正文适配）/ Go（架构重构）**：

- 可以先把现有 wenku8 工具重构为 `SiteAdapter` 架构，并保持行为不变。
- 可以为塔读添加 URL 识别和“因缺少书面许可而拒绝运行”的政策门禁。
- 不应在当前许可状态下新增塔读正文抓取、缓存或 EPUB 导出。
- 下一步应联系塔读客服或版权/技术合作渠道，说明个人离线 EPUB 的具体范围、请求频率、缓存方式和是否处理图片，取得可留档的书面授权。

官方联系/说明入口：

- <https://www.tadu.com/help/all>
- <https://www.tadu.com/help/cooperate>
- 用户协议给出的联系邮箱：`kefu@tadu.com`

