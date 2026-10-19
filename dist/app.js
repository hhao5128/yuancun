/* 原质存 · 原画质解析下载 */
(() => {
  const $ = (id) => document.getElementById(id);

  const form = $("parseForm");
  const input = $("shareInput");
  const submitBtn = $("submitBtn");
  const btnLabel = submitBtn.querySelector(".btn-label");
  const btnSpinner = submitBtn.querySelector(".spinner");
  const clearBtn = $("clearBtn");
  const pasteBtn = $("pasteBtn");
  const result = $("result");
  const resultCard = $("resultCard");
  const status = $("status");
  const statusText = $("statusText");
  const errorBox = $("errorBox");
  const errorMsg = $("errorMsg");
  const retryBtn = $("retryBtn");
  const againBtn = $("againBtn");
  const toast = $("toast");
  const downloadStack = $("downloadStack");
  const previewImg = $("previewImg");
  const previewVideo = $("previewVideo");
  const mediaBadge = $("mediaBadge");
  const platformTag = $("platformTag");
  const resultTitle = $("resultTitle");
  const resultDesc = $("resultDesc");
  const qualityNote = $("qualityNote");

  let toastTimer = null;
  let currentPayload = null;

  /* ---------- utils ---------- */
  function showToast(msg, ms = 2200) {
    toast.textContent = msg;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => { toast.hidden = true; }, 220);
    }, ms);
  }

  function setLoading(on) {
    submitBtn.disabled = on;
    btnLabel.textContent = on ? "解析中…" : "解析下载";
    btnSpinner.hidden = !on;
    if (on) {
      errorBox.hidden = true;
      result.hidden = true;
      status.hidden = false;
      status.classList.add("reveal");
    } else {
      status.hidden = true;
    }
  }

  function showError(msg) {
    status.hidden = true;
    result.hidden = true;
    errorBox.hidden = false;
    errorBox.classList.add("reveal");
    errorMsg.textContent = msg || "请检查链接是否有效，或稍后重试。";
    setLoading(false);
    submitBtn.disabled = false;
    btnLabel.textContent = "解析下载";
    btnSpinner.hidden = true;
  }

  function extractUrls(text) {
    if (!text) return [];
    const matches = text.match(/https?:\/\/[^\s，。、；;！!？?"'）)】\]]+/gi) || [];
    return [...new Set(matches.map((u) => u.replace(/[.,;:]+$/, "")))];
  }

  function detectPlatform(url) {
    const u = url.toLowerCase();
    if (/douyin|iesdouyin|v\.douyin/.test(u)) return { id: "douyin", name: "抖音" };
    if (/tiktok|vm\.tiktok|vt\.tiktok/.test(u)) return { id: "tiktok", name: "TikTok" };
    if (/xiaohongshu|xhslink|xhs\.com/.test(u)) return { id: "xhs", name: "小红书" };
    if (/kuaishou|chenzhongtech|gifshow/.test(u)) return { id: "kuaishou", name: "快手" };
    if (/bilibili|b23\.tv/.test(u)) return { id: "bilibili", name: "哔哩哔哩" };
    if (/weibo|weibo\.cn|weibo\.com/.test(u)) return { id: "weibo", name: "微博" };
    if (/instagram|instagr\.am/.test(u)) return { id: "instagram", name: "Instagram" };
    if (/(twitter|x)\.com|t\.co/.test(u)) return { id: "twitter", name: "Twitter / X" };
    return { id: "generic", name: "通用" };
  }

  async function fetchJSON(url, timeout = 18000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { __raw: text, __status: res.status };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** 尝试多个 CORS 代理，提高静态站可用性 */
  const CORS_PROXIES = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?encodeURIComponent=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  async function fetchJSONViaProxies(target, timeout = 18000) {
    // 先直连
    try {
      const direct = await fetchJSON(target, 12000);
      if (direct && typeof direct === "object" && !direct.__raw) return direct;
      if (direct && direct.__raw && direct.__raw.trim().startsWith("{")) {
        return JSON.parse(direct.__raw);
      }
    } catch (_) { /* fallthrough */ }

    for (const wrap of CORS_PROXIES) {
      try {
        const data = await fetchJSON(wrap(target), timeout);
        if (data && typeof data === "object" && !data.__raw) return data;
        if (data && data.__raw) {
          const raw = data.__raw.trim();
          if (raw.startsWith("{") || raw.startsWith("[")) return JSON.parse(raw);
        }
      } catch (_) { /* next */ }
    }
    throw new Error("无法连接解析服务，请稍后重试或更换链接。");
  }

  function extFromUrl(url, fallback = "mp4") {
    try {
      const path = new URL(url).pathname;
      const m = path.match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
      return m ? m[1].toLowerCase() : fallback;
    } catch {
      return fallback;
    }
  }

  function mimeFromExt(ext) {
    const map = {
      mp4: "video/mp4",
      mov: "video/quicktime",
      m3u8: "application/x-mpegURL",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      heic: "image/heic",
    };
    return map[ext] || "application/octet-stream";
  }

  function fileNameFrom(title, url, kind) {
    const safe = (title || "media")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48) || "media";
    const ext = extFromUrl(url, kind === "image" ? "jpg" : "mp4");
    return `${safe}.${ext}`;
  }

  /* ---------- parsers ---------- */
  /** 抖音 / TikTok */
  async function parseDouyinTikTok(url, platform) {
    // tikwm 同时支持抖音与 TikTok
    const endpoints = [
      `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
      `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
    ];

    for (const ep of endpoints) {
      try {
        const data = await fetchJSONViaProxies(ep);
        const d = data?.data || data;
        if (!d) continue;

        const isImages = Array.isArray(d.images) && d.images.length > 0;
        const videoUrl = d.hdplay || d.play || d.wmplay || d.video?.play_addr?.url_list?.[0];
        const cover = d.cover || d.origin_cover || d.video?.cover?.url_list?.[0];
        const title = d.title || d.desc || "原画质视频";

        if (isImages) {
          return {
            type: "images",
            platform: platform.name,
            title: d.title || d.desc || "原画质图片",
            desc: d.title || "",
            cover: d.images[0],
            images: d.images,
            author: d.author?.nickname || d.author || "",
          };
        }

        if (videoUrl) {
          return {
            type: "video",
            platform: platform.name,
            title,
            desc: d.desc || d.title || "",
            cover: cover || "",
            video: videoUrl,
            music: d.music?.play || d.music || null,
            author: d.author?.nickname || d.author || "",
          };
        }
      } catch (_) { /* next */ }
    }
    throw new Error("该抖音 / TikTok 链接解析失败，请更新链接后重试。");
  }

  /** 小红书 */
  async function parseXhs(url, platform) {
    // 多个社区接口轮询
    const candidates = [
      `https://api.xhscdn.com/?url=${encodeURIComponent(url)}`,
      `https://api.douyin.wtf/api?url=${encodeURIComponent(url)}&minimal=true`,
    ];

    // 先用通用 HTML 解析思路：通过代理抓页面 meta
    for (const ep of candidates) {
      try {
        const data = await fetchJSONViaProxies(ep);
        const pick = (obj, keys) => {
          for (const k of keys) {
            const v = k.split(".").reduce((a, c) => (a == null ? a : a[c]), obj);
            if (v) return v;
          }
          return null;
        };
        const title = pick(data, ["title", "data.title", "note.title", "result.title"]) || "小红书笔记";
        const images = pick(data, ["images", "data.images", "note.images", "image_list"]) || [];
        const video = pick(data, ["video", "data.video", "note.video", "videoUrl", "video_url"]);
        const cover = pick(data, ["cover", "data.cover", "image", "images.0"]) || (Array.isArray(images) ? images[0] : null);

        if (Array.isArray(images) && images.length) {
          return {
            type: "images",
            platform: platform.name,
            title,
            desc: pick(data, ["desc", "data.desc", "note.desc"]) || "",
            cover: cover || images[0],
            images: images.map((x) => (typeof x === "string" ? x : x.url || x)).filter(Boolean),
            author: pick(data, ["author", "data.author", "user.nickname"]) || "",
          };
        }
        if (video) {
          const v = typeof video === "string" ? video : video.url || video.play || video.masterUrl;
          return {
            type: "video",
            platform: platform.name,
            title,
            desc: pick(data, ["desc", "data.desc"]) || "",
            cover: cover || "",
            video: v,
            author: pick(data, ["author", "data.author"]) || "",
          };
        }
      } catch (_) { /* next */ }
    }

    // 兜底：抓取页面 og 标签
    const og = await parseViaOg(url, platform);
    if (og) return og;
    throw new Error("小红书解析失败。请复制完整分享口令（含链接）后重试。");
  }

  /** 快手 */
  async function parseKuaishou(url, platform) {
    const endpoints = [
      `https://api.douyin.wtf/api?url=${encodeURIComponent(url)}&minimal=true`,
      `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
    ];
    for (const ep of endpoints) {
      try {
        const data = await fetchJSONViaProxies(ep);
        const d = data?.data || data;
        const video = d?.video || d?.play || d?.hdplay || d?.video_url;
        const images = d?.images;
        const title = d?.title || d?.desc || "快手作品";
        const cover = d?.cover || d?.origin_cover;

        if (Array.isArray(images) && images.length) {
          return {
            type: "images",
            platform: platform.name,
            title,
            desc: d?.desc || "",
            cover: images[0],
            images: images.map((x) => (typeof x === "string" ? x : x.url || x)),
            author: d?.author?.nickname || d?.author || "",
          };
        }
        if (video) {
          const v = typeof video === "string" ? video : video.play || video.url;
          return {
            type: "video",
            platform: platform.name,
            title,
            desc: d?.desc || "",
            cover: cover || "",
            video: v,
            author: d?.author?.nickname || d?.author || "",
          };
        }
      } catch (_) { /* next */ }
    }
    return parseViaOg(url, platform);
  }

  /** B 站 / 微博 / 通用 OG 标签解析 */
  async function parseViaOg(url, platform) {
    try {
      const html = await fetchHtml(url);
      const title =
        matchMeta(html, ["og:title", "twitter:title"]) ||
        (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] ||
        "原画质内容";
      const video =
        matchMeta(html, ["og:video", "og:video:url", "og:video:secure_url", "twitter:player:stream"]) ||
        matchSrc(html, /<video[^>]+src="([^"]+)"/i);
      const image =
        matchMeta(html, ["og:image", "twitter:image", "og:image:url"]) ||
        matchSrc(html, /<img[^>]+src="([^"]+)"/i);
      const desc = matchMeta(html, ["og:description", "description", "twitter:description"]) || "";

      if (video) {
        return {
          type: "video",
          platform: platform.name,
          title: decodeEntities(title),
          desc: decodeEntities(desc),
          cover: image || "",
          video,
          author: "",
        };
      }
      if (image) {
        return {
          type: "images",
          platform: platform.name,
          title: decodeEntities(title),
          desc: decodeEntities(desc),
          cover: image,
          images: [image],
          author: "",
        };
      }
    } catch (_) { /* ignore */ }
    throw new Error("暂未能提取到原画质地址。可尝试换分享链接，或稍后重试。");
  }

  function matchMeta(html, keys) {
    for (const key of keys) {
      const re = new RegExp(
        `<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`,
        "i"
      );
      const re2 = new RegExp(
        `<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${key}"`,
        "i"
      );
      const m = html.match(re) || html.match(re2);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  function matchSrc(html, re) {
    const m = html.match(re);
    return m ? m[1] : null;
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  async function fetchHtml(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      for (const wrap of CORS_PROXIES) {
        try {
          const res = await fetch(wrap(url), {
            signal: ctrl.signal,
            headers: { Accept: "text/html" },
          });
          const text = await res.text();
          if (text && text.length > 50) return text;
        } catch (_) { /* next */ }
      }
      throw new Error("html fetch failed");
    } finally {
      clearTimeout(timer);
    }
  }

  /** 哔哩哔哩 / 微博 优先 OG，再兜底通用 */
  async function parseBilibiliOrWeibo(url, platform) {
    // 尝试常见无水印 / 原画接口
    const apis = [
      `https://api.douyin.wtf/api?url=${encodeURIComponent(url)}&minimal=true`,
    ];
    for (const ep of apis) {
      try {
        const data = await fetchJSONViaProxies(ep);
        const d = data?.data || data;
        const video = d?.video || d?.play || d?.nwm_video_url || d?.video_url;
        const images = d?.images || d?.image_list;
        const title = d?.title || d?.desc || platform.name + "内容";
        if (Array.isArray(images) && images.length) {
          return {
            type: "images",
            platform: platform.name,
            title,
            desc: d?.desc || "",
            cover: images[0],
            images: images.map((x) => (typeof x === "string" ? x : x.url || x)),
            author: d?.author?.nickname || d?.author || "",
          };
        }
        if (video) {
          return {
            type: "video",
            platform: platform.name,
            title,
            desc: d?.desc || "",
            cover: d?.cover || "",
            video: typeof video === "string" ? video : video.url || video.play,
            author: d?.author?.nickname || d?.author || "",
          };
        }
      } catch (_) { /* next */ }
    }
    return parseViaOg(url, platform);
  }

  async function parseGeneric(url, platform) {
    // 通用：先试聚合接口，再 OG
    try {
      const data = await fetchJSONViaProxies(
        `https://api.douyin.wtf/api?url=${encodeURIComponent(url)}&minimal=true`
      );
      const d = data?.data || data;
      const video = d?.video || d?.play || d?.nwm_video_url;
      const images = d?.images;
      const title = d?.title || d?.desc || "原画质内容";
      if (Array.isArray(images) && images.length) {
        return {
          type: "images",
          platform: platform.name,
          title,
          desc: d?.desc || "",
          cover: images[0],
          images: images.map((x) => (typeof x === "string" ? x : x.url || x)),
          author: d?.author?.nickname || d?.author || "",
        };
      }
      if (video) {
        return {
          type: "video",
          platform: platform.name,
          title,
          desc: d?.desc || "",
          cover: d?.cover || "",
          video: typeof video === "string" ? video : video.url || video.play,
          author: d?.author?.nickname || d?.author || "",
        };
      }
    } catch (_) { /* fallthrough */ }
    return parseViaOg(url, platform);
  }

  async function parseUrl(url) {
    const platform = detectPlatform(url);
    statusText.textContent = `正在识别 ${platform.name} 内容…`;

    // 优先走同源 /api/parse（自托管服务，更稳）
    try {
      statusText.textContent = `正在解析 ${platform.name} …`;
      const local = await fetchJSON(`/api/parse?url=${encodeURIComponent(url)}`, 22000);
      if (local && local.ok && local.data && (local.data.video || local.data.images?.length || local.data.cover)) {
        return local.data;
      }
    } catch (_) { /* fall through to public parsers */ }

    switch (platform.id) {
      case "douyin":
      case "tiktok":
        return parseDouyinTikTok(url, platform);
      case "xhs":
        return parseXhs(url, platform);
      case "kuaishou":
        return parseKuaishou(url, platform);
      case "bilibili":
      case "weibo":
        return parseBilibiliOrWeibo(url, platform);
      case "instagram":
      case "twitter":
      case "generic":
      default:
        return parseGeneric(url, platform);
    }
  }

  /* ---------- download ---------- */
  async function downloadFile(url, filename) {
    try {
      // 优先走代理拿 blob，避免跨域导致无法另存为
      const blob = await fetchBlob(url);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      showToast("已开始下载原画质文件");
    } catch {
      // 兜底：直接打开
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("已在新窗口打开，请右键另存为");
    }
  }

  async function fetchBlob(url) {
    const tries = [
      `/api/fetch?url=${encodeURIComponent(url)}`,
      url,
      ...CORS_PROXIES.map((w) => w(url)),
    ];
    for (const target of tries) {
      try {
        const res = await fetch(target, { mode: "cors" });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob && blob.size > 0) return blob;
      } catch (_) { /* next */ }
    }
    throw new Error("download failed");
  }

  function renderResult(payload) {
    currentPayload = payload;
    platformTag.textContent = payload.platform || "内容";
    resultTitle.textContent = payload.title || "未命名内容";
    resultDesc.textContent = payload.desc || payload.author || "";
    const qLabel = payload.quality || (payload.type === "images" ? "原图" : "原画质");
    qualityNote.textContent =
      payload.type === "images"
        ? `${qLabel} · 共 ${payload.images?.length || 1} 张`
        : qLabel;
    if (payload.qualityNote) {
      qualityNote.textContent += " · " + payload.qualityNote;
      qualityNote.title = payload.qualityNote;
    }

    // 预览
    if (payload.type === "video" && payload.video) {
      previewImg.hidden = true;
      previewVideo.hidden = false;
      previewVideo.src = payload.video;
      previewVideo.poster = payload.cover || "";
      mediaBadge.hidden = false;
      mediaBadge.textContent = `VIDEO · ${qLabel}`;
    } else if (payload.cover) {
      previewVideo.hidden = true;
      previewVideo.removeAttribute("src");
      previewImg.hidden = false;
      previewImg.src = payload.cover;
      mediaBadge.hidden = false;
      mediaBadge.textContent = payload.type === "images" ? `IMAGES · ${qLabel}` : `IMAGE · ${qLabel}`;
    } else {
      previewImg.hidden = true;
      previewVideo.hidden = true;
      mediaBadge.hidden = true;
    }

    // 下载区
    downloadStack.innerHTML = "";

    if (payload.type === "video" && payload.video) {
      const row = document.createElement("div");
      row.className = "dl-row";
      row.innerHTML = `
        <div class="dl-info">
          <div class="dl-label">下载视频（${escapeHtml(qLabel)}）</div>
          <div class="dl-sub">${escapeHtml(shortUrl(payload.video))}</div>
        </div>
      `;
      const btn = document.createElement("button");
      btn.className = "dl-btn";
      btn.type = "button";
      btn.textContent = "下载视频";
      btn.addEventListener("click", () => {
        btn.disabled = true;
        btn.textContent = "下载中…";
        downloadFile(payload.video, fileNameFrom(payload.title, payload.video, "video")).finally(() => {
          btn.disabled = false;
          btn.textContent = "下载视频";
        });
      });
      row.appendChild(btn);
      downloadStack.appendChild(row);

      // 备选画质
      if (Array.isArray(payload.alternates) && payload.alternates.length) {
        payload.alternates.forEach((alt, idx) => {
          if (!alt?.url) return;
          const altRow = document.createElement("div");
          altRow.className = "dl-row";
          altRow.innerHTML = `
            <div class="dl-info">
              <div class="dl-label">备选画质 · ${escapeHtml(alt.label || "备用")}</div>
              <div class="dl-sub">${escapeHtml(shortUrl(alt.url))}</div>
            </div>
          `;
          const altBtn = document.createElement("button");
          altBtn.className = "dl-btn secondary";
          altBtn.type = "button";
          altBtn.textContent = "下载";
          altBtn.addEventListener("click", () => {
            altBtn.disabled = true;
            altBtn.textContent = "下载中…";
            downloadFile(alt.url, fileNameFrom(payload.title + "-alt", alt.url, "video")).finally(() => {
              altBtn.disabled = false;
              altBtn.textContent = "下载";
            });
          });
          altRow.appendChild(altBtn);
          downloadStack.appendChild(altRow);
        });
      }

      if (payload.music) {
        const musicRow = document.createElement("div");
        musicRow.className = "dl-row";
        musicRow.innerHTML = `
          <div class="dl-info">
            <div class="dl-label">下载音频${payload.quality && /杜比|Hi-Res/.test(payload.quality) ? "（高规格）" : ""}</div>
            <div class="dl-sub">${escapeHtml(shortUrl(String(payload.music)))}</div>
          </div>
        `;
        const mBtn = document.createElement("button");
        mBtn.className = "dl-btn secondary";
        mBtn.type = "button";
        mBtn.textContent = "下载音频";
        mBtn.addEventListener("click", () => {
          downloadFile(String(payload.music), fileNameFrom(payload.title + "-audio", String(payload.music), "video"));
        });
        musicRow.appendChild(mBtn);
        downloadStack.appendChild(musicRow);
      }
    }

    if (payload.type === "images" && payload.images?.length) {
      const label = document.createElement("div");
      label.className = "dl-label";
      label.style.marginBottom = "2px";
      label.textContent = `下载图片（原画质 · ${payload.images.length} 张）`;
      downloadStack.appendChild(label);

      const grid = document.createElement("div");
      grid.className = "image-grid";

      payload.images.forEach((imgUrl, idx) => {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.title = `下载第 ${idx + 1} 张`;
        const img = document.createElement("img");
        img.src = imgUrl;
        img.alt = `图片 ${idx + 1}`;
        img.loading = "lazy";
        cell.appendChild(img);
        cell.addEventListener("click", () => {
          downloadFile(imgUrl, fileNameFrom(`${payload.title}-${idx + 1}`, imgUrl, "image"));
        });
        grid.appendChild(cell);
      });
      downloadStack.appendChild(grid);

      const allRow = document.createElement("div");
      allRow.className = "dl-row";
      allRow.style.marginTop = "8px";
      allRow.innerHTML = `
        <div class="dl-info">
          <div class="dl-label">批量保存全部图片</div>
          <div class="dl-sub">逐张下载原画质文件</div>
        </div>
      `;
      const allBtn = document.createElement("button");
      allBtn.className = "dl-btn";
      allBtn.type = "button";
      allBtn.textContent = `全部下载（${payload.images.length}）`;
      allBtn.addEventListener("click", async () => {
        allBtn.disabled = true;
        allBtn.textContent = "下载中…";
        for (let i = 0; i < payload.images.length; i++) {
          try {
            await downloadFile(
              payload.images[i],
              fileNameFrom(`${payload.title}-${i + 1}`, payload.images[i], "image")
            );
            await new Promise((r) => setTimeout(r, 350));
          } catch (_) { /* continue */ }
        }
        allBtn.disabled = false;
        allBtn.textContent = `全部下载（${payload.images.length}）`;
      });
      allRow.appendChild(allBtn);
      downloadStack.appendChild(allRow);
    }

    if (!downloadStack.children.length) {
      const empty = document.createElement("p");
      empty.style.color = "var(--muted)";
      empty.style.margin = "0";
      empty.textContent = "未找到可下载的媒体地址。";
      downloadStack.appendChild(empty);
    }

    result.hidden = false;
    result.classList.add("reveal");
    status.hidden = true;
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shortUrl(u) {
    try {
      const parsed = new URL(u);
      const path =
        parsed.pathname.length > 36
          ? parsed.pathname.slice(0, 36) + "…"
          : parsed.pathname;
      return parsed.hostname.replace(/^www\./, "") + path;
    } catch {
      return String(u).slice(0, 48);
    }
  }

  /* ---------- events ---------- */
  input.addEventListener("input", () => {
    clearBtn.hidden = !input.value.trim();
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.hidden = true;
    input.focus();
    result.hidden = true;
    errorBox.hidden = true;
  });

  pasteBtn.addEventListener("click", async () => {
    // 优先 Clipboard API（需 HTTPS 或 localhost）
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          input.value = text;
          clearBtn.hidden = false;
          showToast("已粘贴");
          return;
        }
      }
    } catch {
      /* 非安全上下文或用户拒绝 → 走手动粘贴 */
    }

    // 回退：聚焦输入框，提示系统粘贴
    input.focus();
    input.select?.();
    const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
    showToast(
      isMobile
        ? "请长按上方输入框，选择「粘贴」"
        : "请按 Ctrl+V（Mac 为 Cmd+V）粘贴"
    );
  });

  retryBtn.addEventListener("click", () => {
    errorBox.hidden = true;
    form.requestSubmit();
  });

  againBtn.addEventListener("click", () => {
    result.hidden = true;
    input.value = "";
    clearBtn.hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => input.focus(), 350);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      showToast("请先粘贴分享链接或口令");
      input.focus();
      return;
    }

    const urls = extractUrls(text);
    if (!urls.length) {
      showError("没有识别到有效链接。请复制完整的分享文案（其中应包含 https 链接）。");
      return;
    }

    setLoading(true);
    statusText.textContent = "正在解析内容…";

    let lastError = null;
    for (const url of urls) {
      try {
        statusText.textContent = `正在解析 ${detectPlatform(url).name} …`;
        const payload = await parseUrl(url);
        if (payload && (payload.video || payload.images?.length || payload.cover)) {
          setLoading(false);
          renderResult(payload);
          return;
        }
        lastError = new Error("未找到媒体资源");
      } catch (err) {
        lastError = err;
      }
    }

    showError(lastError?.message || "解析失败，请更换链接后重试。");
  });

  // 粘贴自动填入
  input.addEventListener("paste", () => {
    setTimeout(() => {
      clearBtn.hidden = !input.value.trim();
    }, 0);
  });

  // 局域网地址提示（手机可访问）
  (async function loadLan() {
    try {
      const data = await fetchJSON("/api/health", 5000);
      const httpUrls = data?.lan || [];
      const httpsUrls = data?.https || [];
      const isLocalHost =
        location.hostname === "127.0.0.1" ||
        location.hostname === "localhost" ||
        location.hostname === "::1";
      const isSecure = window.isSecureContext;

      const tip = document.getElementById("lanTip");
      const box = document.getElementById("lanUrls");
      if (!tip || !box) return;

      const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
      if (!isMobile && !isLocalHost) return;

      box.innerHTML = "";
      const tipP = tip.querySelector("p");

      if (!isSecure && httpsUrls.length) {
        if (tipP) {
          tipP.innerHTML =
            "要用<strong>一键粘贴</strong>，请改用 <strong>HTTPS</strong> 地址打开（首次选「继续访问」信任证书）";
        }
        httpsUrls.forEach((u) => {
          const a = document.createElement("a");
          a.href = u;
          a.textContent = u;
          a.target = "_blank";
          a.rel = "noopener";
          a.style.borderColor = "#0a0a0a";
          a.style.fontWeight = "600";
          box.appendChild(a);
        });
        httpUrls.forEach((u) => {
          const a = document.createElement("a");
          a.href = u;
          a.textContent = u;
          a.target = "_blank";
          a.rel = "noopener";
          box.appendChild(a);
        });
      } else {
        if (tipP) {
          tipP.innerHTML =
            "手机访问：与电脑连<strong>同一 WiFi</strong>。推荐 <strong>HTTPS</strong> 地址（粘贴可用）";
        }
        [...httpsUrls, ...httpUrls].forEach((u) => {
          const a = document.createElement("a");
          a.href = u;
          a.textContent = u;
          a.target = "_blank";
          a.rel = "noopener";
          if (u.startsWith("https")) {
            a.style.borderColor = "#0a0a0a";
            a.style.fontWeight = "600";
          }
          box.appendChild(a);
        });
      }
      tip.hidden = false;
    } catch (_) {
      /* ignore */
    }
  })();
})();
