/* 鍘熻川瀛?路 鍘熺敾璐ㄨВ鏋愪笅杞?*/
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
    btnLabel.textContent = on ? "瑙ｆ瀽涓€? : "瑙ｆ瀽涓嬭浇";
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
    errorMsg.textContent = msg || "璇锋鏌ラ摼鎺ユ槸鍚︽湁鏁堬紝鎴栫◢鍚庨噸璇曘€?;
    setLoading(false);
    submitBtn.disabled = false;
    btnLabel.textContent = "瑙ｆ瀽涓嬭浇";
    btnSpinner.hidden = true;
  }

  function extractUrls(text) {
    if (!text) return [];
    const matches = text.match(/https?:\/\/[^\s锛屻€傘€侊紱;锛?锛?"'锛?銆慭]]+/gi) || [];
    return [...new Set(matches.map((u) => u.replace(/[.,;:]+$/, "")))];
  }

  function detectPlatform(url) {
    const u = url.toLowerCase();
    if (/douyin|iesdouyin|v\.douyin/.test(u)) return { id: "douyin", name: "鎶栭煶" };
    if (/tiktok|vm\.tiktok|vt\.tiktok/.test(u)) return { id: "tiktok", name: "TikTok" };
    if (/xiaohongshu|xhslink|xhs\.com/.test(u)) return { id: "xhs", name: "灏忕孩涔? };
    if (/kuaishou|chenzhongtech|gifshow/.test(u)) return { id: "kuaishou", name: "蹇墜" };
    if (/bilibili|b23\.tv/.test(u)) return { id: "bilibili", name: "鍝斿摡鍝斿摡" };
    if (/weibo|weibo\.cn|weibo\.com/.test(u)) return { id: "weibo", name: "寰崥" };
    if (/instagram|instagr\.am/.test(u)) return { id: "instagram", name: "Instagram" };
    if (/(twitter|x)\.com|t\.co/.test(u)) return { id: "twitter", name: "Twitter / X" };
    return { id: "generic", name: "閫氱敤" };
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

  /** 灏濊瘯澶氫釜 CORS 浠ｇ悊锛屾彁楂橀潤鎬佺珯鍙敤鎬?*/
  const CORS_PROXIES = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?encodeURIComponent=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  async function fetchJSONViaProxies(target, timeout = 18000) {
    // 鍏堢洿杩?    try {
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
    throw new Error("鏃犳硶杩炴帴瑙ｆ瀽鏈嶅姟锛岃绋嶅悗閲嶈瘯鎴栨洿鎹㈤摼鎺ャ€?);
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
  /** 鎶栭煶 / TikTok */
  async function parseDouyinTikTok(url, platform) {
    // tikwm 鍚屾椂鏀寔鎶栭煶涓?TikTok
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
        const title = d.title || d.desc || "鍘熺敾璐ㄨ棰?;

        if (isImages) {
          return {
            type: "images",
            platform: platform.name,
            title: d.title || d.desc || "鍘熺敾璐ㄥ浘鐗?,
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
    throw new Error("璇ユ姈闊?/ TikTok 閾炬帴瑙ｆ瀽澶辫触锛岃鏇存柊閾炬帴鍚庨噸璇曘€?);
  }

  /** 灏忕孩涔?*/
  async function parseXhs(url, platform) {
    // 澶氫釜绀惧尯鎺ュ彛杞
    const candidates = [
      `https://api.xhscdn.com/?url=${encodeURIComponent(url)}`,
      `https://api.douyin.wtf/api?url=${encodeURIComponent(url)}&minimal=true`,
    ];

    // 鍏堢敤閫氱敤 HTML 瑙ｆ瀽鎬濊矾锛氶€氳繃浠ｇ悊鎶撻〉闈?meta
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
        const title = pick(data, ["title", "data.title", "note.title", "result.title"]) || "灏忕孩涔︾瑪璁?;
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

    // 鍏滃簳锛氭姄鍙栭〉闈?og 鏍囩
    const og = await parseViaOg(url, platform);
    if (og) return og;
    throw new Error("灏忕孩涔﹁В鏋愬け璐ャ€傝澶嶅埗瀹屾暣鍒嗕韩鍙ｄ护锛堝惈閾炬帴锛夊悗閲嶈瘯銆?);
  }

  /** 蹇墜 */
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
        const title = d?.title || d?.desc || "蹇墜浣滃搧";
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

  /** B 绔?/ 寰崥 / 閫氱敤 OG 鏍囩瑙ｆ瀽 */
  async function parseViaOg(url, platform) {
    try {
      const html = await fetchHtml(url);
      const title =
        matchMeta(html, ["og:title", "twitter:title"]) ||
        (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] ||
        "鍘熺敾璐ㄥ唴瀹?;
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
    throw new Error("鏆傛湭鑳芥彁鍙栧埌鍘熺敾璐ㄥ湴鍧€銆傚彲灏濊瘯鎹㈠垎浜摼鎺ワ紝鎴栫◢鍚庨噸璇曘€?);
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

  /** 鍝斿摡鍝斿摡 / 寰崥 浼樺厛 OG锛屽啀鍏滃簳閫氱敤 */
  async function parseBilibiliOrWeibo(url, platform) {
    // 灏濊瘯甯歌鏃犳按鍗?/ 鍘熺敾鎺ュ彛
    const apis = [
      `https://api.douyin.wtf/api?url=${encodeURIComponent(url)}&minimal=true`,
    ];
    for (const ep of apis) {
      try {
        const data = await fetchJSONViaProxies(ep);
        const d = data?.data || data;
        const video = d?.video || d?.play || d?.nwm_video_url || d?.video_url;
        const images = d?.images || d?.image_list;
        const title = d?.title || d?.desc || platform.name + "鍐呭";
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
    // 閫氱敤锛氬厛璇曡仛鍚堟帴鍙ｏ紝鍐?OG
    try {
      const data = await fetchJSONViaProxies(
        `https://api.douyin.wtf/api?url=${encodeURIComponent(url)}&minimal=true`
      );
      const d = data?.data || data;
      const video = d?.video || d?.play || d?.nwm_video_url;
      const images = d?.images;
      const title = d?.title || d?.desc || "鍘熺敾璐ㄥ唴瀹?;
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
    statusText.textContent = `姝ｅ湪璇嗗埆 ${platform.name} 鍐呭鈥;

    // 浼樺厛璧板悓婧?/api/parse锛堣嚜鎵樼鏈嶅姟锛屾洿绋筹級
    try {
      statusText.textContent = `姝ｅ湪瑙ｆ瀽 ${platform.name} 鈥;
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
      // 浼樺厛璧颁唬鐞嗘嬁 blob锛岄伩鍏嶈法鍩熷鑷存棤娉曞彟瀛樹负
      const blob = await fetchBlob(url);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      showToast("宸插紑濮嬩笅杞藉師鐢昏川鏂囦欢");
    } catch {
      // 鍏滃簳锛氱洿鎺ユ墦寮€
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("宸插湪鏂扮獥鍙ｆ墦寮€锛岃鍙抽敭鍙﹀瓨涓?);
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
    platformTag.textContent = payload.platform || "鍐呭";
    resultTitle.textContent = payload.title || "鏈懡鍚嶅唴瀹?;
    resultDesc.textContent = payload.desc || payload.author || "";
    const qLabel = payload.quality || (payload.type === "images" ? "鍘熷浘" : "鍘熺敾璐?);
    qualityNote.textContent =
      payload.type === "images"
        ? `${qLabel} 路 鍏?${payload.images?.length || 1} 寮燻
        : qLabel;
    if (payload.qualityNote) {
      qualityNote.textContent += " 路 " + payload.qualityNote;
      qualityNote.title = payload.qualityNote;
    }

    // 棰勮
    if (payload.type === "video" && payload.video) {
      previewImg.hidden = true;
      previewVideo.hidden = false;
      previewVideo.src = payload.video;
      previewVideo.poster = payload.cover || "";
      mediaBadge.hidden = false;
      mediaBadge.textContent = `VIDEO 路 ${qLabel}`;
    } else if (payload.cover) {
      previewVideo.hidden = true;
      previewVideo.removeAttribute("src");
      previewImg.hidden = false;
      previewImg.src = payload.cover;
      mediaBadge.hidden = false;
      mediaBadge.textContent = payload.type === "images" ? `IMAGES 路 ${qLabel}` : `IMAGE 路 ${qLabel}`;
    } else {
      previewImg.hidden = true;
      previewVideo.hidden = true;
      mediaBadge.hidden = true;
    }

    // 涓嬭浇鍖?    downloadStack.innerHTML = "";

    if (payload.type === "video" && payload.video) {
      const row = document.createElement("div");
      row.className = "dl-row";
      row.innerHTML = `
        <div class="dl-info">
          <div class="dl-label">涓嬭浇瑙嗛锛?{escapeHtml(qLabel)}锛?/div>
          <div class="dl-sub">${escapeHtml(shortUrl(payload.video))}</div>
        </div>
      `;
      const btn = document.createElement("button");
      btn.className = "dl-btn";
      btn.type = "button";
      btn.textContent = "涓嬭浇瑙嗛";
      btn.addEventListener("click", () => {
        btn.disabled = true;
        btn.textContent = "涓嬭浇涓€?;
        downloadFile(payload.video, fileNameFrom(payload.title, payload.video, "video")).finally(() => {
          btn.disabled = false;
          btn.textContent = "涓嬭浇瑙嗛";
        });
      });
      row.appendChild(btn);
      downloadStack.appendChild(row);

      // 澶囬€夌敾璐?      if (Array.isArray(payload.alternates) && payload.alternates.length) {
        payload.alternates.forEach((alt, idx) => {
          if (!alt?.url) return;
          const altRow = document.createElement("div");
          altRow.className = "dl-row";
          altRow.innerHTML = `
            <div class="dl-info">
              <div class="dl-label">澶囬€夌敾璐?路 ${escapeHtml(alt.label || "澶囩敤")}</div>
              <div class="dl-sub">${escapeHtml(shortUrl(alt.url))}</div>
            </div>
          `;
          const altBtn = document.createElement("button");
          altBtn.className = "dl-btn secondary";
          altBtn.type = "button";
          altBtn.textContent = "涓嬭浇";
          altBtn.addEventListener("click", () => {
            altBtn.disabled = true;
            altBtn.textContent = "涓嬭浇涓€?;
            downloadFile(alt.url, fileNameFrom(payload.title + "-alt", alt.url, "video")).finally(() => {
              altBtn.disabled = false;
              altBtn.textContent = "涓嬭浇";
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
            <div class="dl-label">涓嬭浇闊抽${payload.quality && /鏉滄瘮|Hi-Res/.test(payload.quality) ? "锛堥珮瑙勬牸锛? : ""}</div>
            <div class="dl-sub">${escapeHtml(shortUrl(String(payload.music)))}</div>
          </div>
        `;
        const mBtn = document.createElement("button");
        mBtn.className = "dl-btn secondary";
        mBtn.type = "button";
        mBtn.textContent = "涓嬭浇闊抽";
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
      label.textContent = `涓嬭浇鍥剧墖锛堝師鐢昏川 路 ${payload.images.length} 寮狅級`;
      downloadStack.appendChild(label);

      const grid = document.createElement("div");
      grid.className = "image-grid";

      payload.images.forEach((imgUrl, idx) => {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.title = `涓嬭浇绗?${idx + 1} 寮燻;
        const img = document.createElement("img");
        img.src = imgUrl;
        img.alt = `鍥剧墖 ${idx + 1}`;
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
          <div class="dl-label">鎵归噺淇濆瓨鍏ㄩ儴鍥剧墖</div>
          <div class="dl-sub">閫愬紶涓嬭浇鍘熺敾璐ㄦ枃浠?/div>
        </div>
      `;
      const allBtn = document.createElement("button");
      allBtn.className = "dl-btn";
      allBtn.type = "button";
      allBtn.textContent = `鍏ㄩ儴涓嬭浇锛?{payload.images.length}锛塦;
      allBtn.addEventListener("click", async () => {
        allBtn.disabled = true;
        allBtn.textContent = "涓嬭浇涓€?;
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
        allBtn.textContent = `鍏ㄩ儴涓嬭浇锛?{payload.images.length}锛塦;
      });
      allRow.appendChild(allBtn);
      downloadStack.appendChild(allRow);
    }

    if (!downloadStack.children.length) {
      const empty = document.createElement("p");
      empty.style.color = "var(--muted)";
      empty.style.margin = "0";
      empty.textContent = "鏈壘鍒板彲涓嬭浇鐨勫獟浣撳湴鍧€銆?;
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
          ? parsed.pathname.slice(0, 36) + "鈥?
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
    // 浼樺厛 Clipboard API锛堥渶 HTTPS 鎴?localhost锛?    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          input.value = text;
          clearBtn.hidden = false;
          showToast("宸茬矘璐?);
          return;
        }
      }
    } catch {
      /* 闈炲畨鍏ㄤ笂涓嬫枃鎴栫敤鎴锋嫆缁?鈫?璧版墜鍔ㄧ矘璐?*/
    }

    // 鍥為€€锛氳仛鐒﹁緭鍏ユ锛屾彁绀虹郴缁熺矘璐?    input.focus();
    input.select?.();
    const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
    showToast(
      isMobile
        ? "璇烽暱鎸変笂鏂硅緭鍏ユ锛岄€夋嫨銆岀矘璐淬€?
        : "璇锋寜 Ctrl+V锛圡ac 涓?Cmd+V锛夌矘璐?
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
      showToast("璇峰厛绮樿创鍒嗕韩閾炬帴鎴栧彛浠?);
      input.focus();
      return;
    }

    const urls = extractUrls(text);
    if (!urls.length) {
      showError("娌℃湁璇嗗埆鍒版湁鏁堥摼鎺ャ€傝澶嶅埗瀹屾暣鐨勫垎浜枃妗堬紙鍏朵腑搴斿寘鍚?https 閾炬帴锛夈€?);
      return;
    }

    setLoading(true);
    statusText.textContent = "姝ｅ湪瑙ｆ瀽鍐呭鈥?;

    let lastError = null;
    for (const url of urls) {
      try {
        statusText.textContent = `姝ｅ湪瑙ｆ瀽 ${detectPlatform(url).name} 鈥;
        const payload = await parseUrl(url);
        if (payload && (payload.video || payload.images?.length || payload.cover)) {
          setLoading(false);
          renderResult(payload);
          return;
        }
        lastError = new Error("鏈壘鍒板獟浣撹祫婧?);
      } catch (err) {
        lastError = err;
      }
    }

    showError(lastError?.message || "瑙ｆ瀽澶辫触锛岃鏇存崲閾炬帴鍚庨噸璇曘€?);
  });

  // 绮樿创鑷姩濉叆
  input.addEventListener("paste", () => {
    setTimeout(() => {
      clearBtn.hidden = !input.value.trim();
    }, 0);
  });

  // 灞€鍩熺綉鍦板潃鎻愮ず锛堟墜鏈哄彲璁块棶锛?  (async function loadLan() { return;
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
            "瑕佺敤<strong>涓€閿矘璐?/strong>锛岃鏀圭敤 <strong>HTTPS</strong> 鍦板潃鎵撳紑锛堥娆￠€夈€岀户缁闂€嶄俊浠昏瘉涔︼級";
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
            "鎵嬫満璁块棶锛氫笌鐢佃剳杩?strong>鍚屼竴 WiFi</strong>銆傛帹鑽?<strong>HTTPS</strong> 鍦板潃锛堢矘璐村彲鐢級";
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

