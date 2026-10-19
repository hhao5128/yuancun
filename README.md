# 原质存 · 原画质提取下载

极简风格短视频 / 图文原画质下载站。粘贴分享链接，解析并保存原画质视频或图片。

## 本地运行

```powershell
node server.js
# 浏览器打开 http://127.0.0.1:4173
```

## 功能

- 粘贴分享口令或链接，自动识别平台
- 提取原画质视频 / 图片地址
- 一键下载，图片支持批量
- 极简 UI，移动端适配

## 支持平台

抖音 · TikTok · 小红书 · 快手 · 哔哩哔哩 · 微博 · Instagram · Twitter/X

## 部署成永久网址（免费）

### 方式 A：Vercel（推荐，有免费额度）

1. 把 `media-save` 文件夹推到 GitHub 仓库
2. 打开 [vercel.com](https://vercel.com) → Import Project
3. Framework 选 **Other**，启动命令 `node server.js`，输出目录留空
4. Deploy 完成后会得到 `https://xxx.vercel.app` 永久网址

### 方式 B：Render

1. GitHub 仓库导入 Render
2. Environment: Web Service
3. Build Command: 留空
4. Start Command: `node server.js`
5. Deploy 后得到 `https://xxx.onrender.com`

### 方式 C：Railway / Fly.io

同样导入仓库，启动命令 `node server.js` 即可。

## 说明

- 仅用于保存你有权访问的公开内容
- 请尊重创作者版权，勿用于商业盗用
- 部分平台接口可能变动，失败时可稍后重试
