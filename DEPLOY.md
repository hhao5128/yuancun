# 部署到公网（国内可访问）

> 已实测：Vercel（\*.vercel.app）在大陆网络**打不开**。请用下面方案。

## 推荐：Render（国内可打开 onrender.com）

1. 浏览器打开 https://render.com → **Get Started for Free** 注册（邮箱即可）
2. 邮箱验证后进入控制台
3. **New +** → **Web Service**
4. 选 **Upload**（或从 GitHub 导入），上传桌面的 `原质存-网站源码.zip` 或本文件夹
5. 填写：
   - Name: `yuancun`（任意）
   - Runtime: **Node**
   - Build Command: 留空
   - Start Command: `node server.js`
   - Instance Type: **Free**
6. **Create Web Service** → 等待部署完成
7. 得到网址：`https://yuancun-xxxx.onrender.com`，手机电脑联网即可用

## 备选：Railway

1. 打开 https://railway.app 注册
2. **New Project** → **Deploy from GitHub / Upload**
3. Start Command: `node server.js`
4. 生成域名（\*.up.railway.app）

## 备选：Netlify

1. https://app.netlify.com 注册
2. 拖拽上传 zip（若只支持静态，则需再配 Functions，较麻烦）— **优先用 Render**

## 本地源码位置

`C:\Users\20853\XiaomiMiMoProjects\.mimo-sessions\2026\10\20\new-chat\media-save`

桌面压缩包：`原质存-网站源码.zip`

## 电脑本机（临时用）

- 电脑：https://127.0.0.1:4174
- 手机同 WiFi：https://192.168.31.41:4174

公网 HTTPS 下「粘贴」按钮可自动读剪贴板。
