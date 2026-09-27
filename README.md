# 六祖坛经阅读器

静态阅读器，首页为 `index.html`。点击原文句子可展开整段译文，并高亮对应片段。

## 发布

Vercel 选择 **Other** 框架，项目根目录为仓库根目录，不需要构建命令。`.vercelignore` 只发布以下五个文件：

- `index.html`
- `translation-map.js`
- `service-worker.js`
- `manifest.webmanifest`
- `icon.svg`

`坛经.txt` 是原书校对依据，不参与网站运行。`build_tanjing.js` 和 `build_tanjing.py` 是历史脚本，目前不会生成正在使用的 `index.html`，发布时无需运行。候选、复核、报告和备份文件保留在本地，不纳入正式提交。
