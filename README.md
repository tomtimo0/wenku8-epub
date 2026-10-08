# wenku8-epub

将 [轻小说文库](https://www.wenku8.net/) 小说转为 EPUB 3，供个人离线阅读。

## 环境

- Node.js ≥ 20
- 本机 Chrome（推荐，便于通过 Cloudflare 质询）或 Playwright Chromium

## 安装

```bash
npm install
npx playwright install chromium
```

## 使用

```bash
npm run dev -- 2896
# 或
npm run build && npm start -- https://www.wenku8.net/novel/2/2896/index.htm
```

常用选项见 `docs/PLAN.md` 第 5.7 节（如 `--volumes 1`、`--split volume`、`--refresh`）。

输出默认在 `./output`，缓存与浏览器配置在 `./.cache`（勿提交仓库）。

## 测试

```bash
npm test
```

## 说明

- 请勿将抓取的正文、图片提交到 git。
- 首次运行若遇 Cloudflare，请在弹出的浏览器窗口完成验证；会话会保存在 `.cache/browser-profile`。
