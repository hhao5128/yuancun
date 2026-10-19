/**
 * 原质存 · 本地/局域网服务
 * - 托管前端
 * - /api/parse  解析分享链接（重点加强抖音）
 * - /api/fetch  代理下载媒体
 * - HTTP + HTTPS（HTTPS 用于手机剪贴板权限）
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 4173);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 4174);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const CERT_DIR = path.join(ROOT, "certs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
const UA_PC =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept");
}

function sendJSON(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function absUrl(u, base) {
  if (!u) return u;
  if (typeof u === "string" && /^https?:\/\//i.test(u)) return u;
  try {
    return new URL(u, base).toString();
  } catch {
    return u;
  }
}

function fetchRemote(url, options = {}) {
  const {
    timeout = 20000,
    headers = {},
    method = "GET",
    maxRedirects = 8,
    body = null,
  } = options;

  return new Promise((resolve, reject) => {
    const doRequest = (targetUrl, redirectsLeft, cookieHeader) => {
      let parsed;
      try {
        parsed = new URL(targetUrl);
      } catch {
        return reject(new Error("无效 URL"));
      }
      const lib = parsed.protocol === "http:" ? http : https;
      const hdrs = {
        "User-Agent": UA_PC,
        Accept: "*/*",
        ...headers,
      };
      if (cookieHeader) hdrs.Cookie = cookieHeader;

      const req = lib.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
          path: parsed.pathname + parsed.search,
          method,
          headers: hdrs,
        },
        (res) => {
          const loc = res.headers.location;
          if (loc && res.statusCode >= 300 && res.statusCode < 400 && redirectsLeft > 0) {
            res.resume();
            const nextCookies = collectCookies(cookieHeader, res.headers["set-cookie"]);
            return doRequest(absUrl(loc, targetUrl), redirectsLeft - 1, nextCookies);
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
              finalUrl: targetUrl,
            });
          });
        }
      );
      req.setTimeout(timeout, () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    };
    doRequest(url, maxRedirects, headers.Cookie || null);
  });
}

function collectCookies(existing, setCookie) {
  const map = new Map();
  if (existing) {
    existing.split(";").forEach((pair) => {
      const [k, ...v] = pair.trim().split("=");
      if (k) map.set(k, v.join("="));
    });
  }
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const raw of list) {
    const first = String(raw).split(";")[0];
    const idx = first.indexOf("=");
    if (idx > 0) map.set(first.slice(0, idx).trim(), first.slice(idx + 1).trim());
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function tryJson(url, options = {}) {
  try {
    const res = await fetchRemote(url, {
      timeout: 18000,
      ...options,
      headers: {
        Accept: "application/json, text/plain, */*",
        ...(options.headers || {}),
      },
    });
    const text = res.body.toString("utf8");
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function fetchHtml(url, options = {}) {
  const res = await fetchRemote(url, {
    timeout: 20000,
    maxRedirects: 8,
    ...options,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: safeOrigin(url),
      ...(options.headers || {}),
    },
  });
  return res.body.toString("utf8");
}

/** 第三方解析（抖音等本地 SSR 已不返回媒体地址时使用） */
async function parseViaAggregator(url, platformName) {
  const endpoints = [
    {
      method: "POST",
      url: "https://video.zacao.top/api/parse",
      body: JSON.stringify({ url, text: url, hd: true, quality: "origin" }),
    },
    {
      method: "POST",
      url: "https://video.zacao.top/api/parse",
      body: JSON.stringify({ url }),
    },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetchRemote(ep.url, {
        method: ep.method,
        body: ep.body,
        timeout: 25000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": UA_PC,
          Referer: "https://video.zacao.top/",
        },
        maxRedirects: 2,
      });
      const text = res.body.toString("utf8");
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }
      const d = data?.data || data;
      if (!d) continue;

      const title = d.title || d.desc || `${platformName}内容`;
      const cover = d.cover_url || d.cover || d.image || "";
      const author =
        typeof d.author === "string"
          ? d.author
          : d.author?.nickname || d.nickname || d.author?.name || "";
      const desc = d.desc || title;

      // 图片
      const imgs = d.image_list || d.images || d.imageList || [];
      if (Array.isArray(imgs) && imgs.length) {
        const images = imgs
          .map((x) => (typeof x === "string" ? x : x?.url || x?.image_url || x?.src))
          .filter(Boolean);
        if (images.length) {
          return {
            type: "images",
            platform: platformName,
            title,
            desc,
            cover: cover || images[0],
            images: images.map((x) => normalizeDouyinVideoUrl(x)),
            author,
            quality: "原图",
          };
        }
      }

      // 视频：优先 source（更接近原片），再从列表挑最高码率
      const videoList = Array.isArray(d.video_list) ? d.video_list : [];
      const candidates = [];
      if (d.source_video_url) candidates.push({ url: d.source_video_url, label: "源画质", bit: 0, prefer: 2 });
      if (d.video_url) candidates.push({ url: d.video_url, label: "高清", bit: 0, prefer: 1 });
      for (const item of videoList) {
        const u = typeof item === "string" ? item : item?.url || item?.play || item?.play_addr;
        if (!u) continue;
        const bit = item?.bit_rate || item?.bitRate || item?.bitrate || item?.br || 0;
        candidates.push({ url: u, label: item?.gear || item?.quality || "备用", bit, prefer: 0 });
      }

      // 去重 + 排序：码率优先，其次 source
      const seen = new Set();
      const uniq = candidates.filter((c) => {
        const key = String(c.url).split("?")[0];
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      uniq.sort((a, b) => {
        if (b.bit !== a.bit) return b.bit - a.bit;
        return b.prefer - a.prefer;
      });

      if (uniq.length) {
        const best = uniq[0];
        const video = normalizeDouyinVideoUrl(best.url);
        const q = describeQuality(video, best);
        if (best.prefer === 2 && !q.label.includes("源画质")) {
          q.label = q.label && q.label !== "原画质" ? `源画质 · ${q.label}` : "源画质";
        }
        return {
          type: "video",
          platform: platformName,
          title,
          desc,
          cover,
          video,
          author,
          music: d.source_audio_url || d.audio_url || d.music_url || null,
          quality: q.label,
          qualityMeta: q,
          qualityNote: "已取公开最高可用流（分辨率在前 · 码率在后）",
          alternates: uniq.slice(1, 5).map((c) => ({
            url: normalizeDouyinVideoUrl(c.url),
            label: c.label || "备选",
            bit: c.bit || 0,
          })),
        };
      }
    } catch {
      /* next */
    }
  }
  return null;
}

/** 从 URL / 元数据粗估画质标签：分辨率在前，码率在后 */
function describeQuality(url, meta = {}) {
  const u = String(url || "");
  let br = meta.bit || 0;
  const brm = u.match(/[?&]br=(\d+)/);
  if (!br && brm) br = Number(brm[1]);

  // 分辨率
  let res = meta.resolution || meta.res || "";
  if (!res) {
    const rm = u.match(/(?:ratio=)?(\d{3,4})p\b/i) || u.match(/[_-](\d{3,4})p[_-]/i);
    if (rm) res = `${rm[1]}p`;
    if (/4k|2160/i.test(u)) res = "4K";
    if (/2k|1440/i.test(u)) res = "2K";
  }

  // 编码 / 杜比标记
  let extra = "";
  if (/h\.?265|hevc|h266|av1/i.test(u) || meta.codec) {
    const c = (meta.codec || (/h\.?265|hevc/i.test(u) ? "H.265" : /av1/i.test(u) ? "AV1" : "")).toString();
    if (c) extra = c;
  }
  if (/dolby|dovi|dvhe/i.test(u) || meta.dolby) {
    return { label: res ? `${res} · 杜比` : "杜比原片", br, res, dolby: true };
  }

  const parts = [];
  if (res) parts.push(res);
  else if (meta.label && meta.label !== "备选" && meta.label !== "高清") parts.push(String(meta.label));
  else parts.push("原画质");
  if (br > 0) parts.push(`${Math.round(br)}kbps`);
  if (extra && !parts.some((p) => /h\.?26|av1/i.test(p))) parts.push(extra);
  return { label: parts.join(" · "), br, res };
}

/** 拉 MP4 头解析真实分辨率（tkhd box） */
async function probeVideoResolution(url) {
  try {
    const res = await fetchRemote(url, {
      timeout: 15000,
      maxRedirects: 4,
      headers: {
        Range: "bytes=0-262143",
        Referer: "https://www.douyin.com/",
        "User-Agent": UA_PC,
      },
    });
    const buf = res.body;
    if (!buf || buf.length < 32) return null;
    // 扫描 tkhd
    for (let i = 4; i + 8 < buf.length; i++) {
      if (buf[i] === 0x74 && buf[i + 1] === 0x6b && buf[i + 2] === 0x68 && buf[i + 3] === 0x64) {
        const atomStart = i - 4;
        const atomSize = buf.readUInt32BE(atomStart);
        const ver = buf[atomStart + 8];
        const wOff = ver === 1 ? atomStart + 92 : atomStart + 84;
        const hOff = wOff + 4;
        if (hOff + 4 <= buf.length && atomSize >= 84) {
          const w = buf.readUInt32BE(wOff) >>> 16;
          const h = buf.readUInt32BE(hOff) >>> 16;
          if (w > 0 && h > 0 && w < 20000 && h < 20000) {
            return { width: w, height: h };
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 组装最终画质标签：分辨率 · 码率 */
async function enrichQuality(payload) {
  if (!payload || payload.type !== "video" || !payload.video) return payload;
  const dim = await probeVideoResolution(payload.video);
  let res = "";
  if (dim) {
    const shortSide = Math.min(dim.width, dim.height);
    const longSide = Math.max(dim.width, dim.height);
    if (longSide >= 3200) res = "4K";
    else if (longSide >= 2400) res = "2K";
    else if (shortSide >= 1000 || longSide >= 1900) res = "1080P";
    else if (shortSide >= 700 || longSide >= 1200) res = "720P";
    else res = `${dim.height}P`;
    // 竖屏保留完整分辨率更直观
    if (dim.width < dim.height && dim.width >= 540) {
      res = `${dim.width}×${dim.height}`;
    }
    payload.resolution = `${dim.width}×${dim.height}`;
    payload.width = dim.width;
    payload.height = dim.height;
  }

  const brm = String(payload.video).match(/[?&]br=(\d+)/);
  const br = brm ? Number(brm[1]) : payload.qualityMeta?.br || 0;
  const parts = [];
  if (res) parts.push(res);
  else if (payload.quality && !/kbps/i.test(payload.quality)) parts.push(payload.quality.split("·")[0].trim());
  else parts.push("原画质");
  if (br > 0) parts.push(`${br}kbps`);
  if (/dolby|dovi/i.test(String(payload.video)) || payload.qualityMeta?.dolby) parts.push("杜比");
  else if (payload.quality && /杜比|Hi-Res/i.test(payload.quality)) {
    // 保留原标签里的音效信息
    if (!parts.some((p) => /杜比|Hi-Res/i.test(p))) parts.push(/Hi-Res/i.test(payload.quality) ? "Hi-Res" : "杜比音效");
  }

  payload.quality = parts.join(" · ");
  return payload;
}

function safeOrigin(url) {
  try {
    const u = new URL(url);
    return u.origin + "/";
  } catch {
    return "https://www.douyin.com/";
  }
}

function matchMeta(html, keys) {
  for (const key of keys) {
    const re = new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`, "i");
    const re2 = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${key}"`, "i");
    const m = html.match(re) || html.match(re2);
    if (m && m[1]) return m[1];
  }
  return null;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeMaybeJson(str) {
  if (!str) return null;
  let s = str;
  try {
    s = decodeURIComponent(str);
  } catch {
    /* keep */
  }
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((a, c) => (a == null ? a : a[c]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function walkFind(obj, pred, max = 80, found = []) {
  if (!obj || typeof obj !== "object" || found.length >= max) return found;
  if (pred(obj)) found.push(obj);
  if (Array.isArray(obj)) {
    for (const item of obj.slice(0, 50)) walkFind(item, pred, max, found);
  } else {
    for (const k of Object.keys(obj).slice(0, 80)) walkFind(obj[k], pred, max, found);
  }
  return found;
}

function extractUrls(text) {
  const matches = String(text || "").match(/https?:\/\/[^\s，。、；;！!？?"'）)】\]]+/gi) || [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:]+$/, "")))];
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (/douyin|iesdouyin|v\.douyin/.test(u)) return "douyin";
  if (/tiktok|vm\.tiktok|vt\.tiktok/.test(u)) return "tiktok";
  if (/xiaohongshu|xhslink|xhs\.com/.test(u)) return "xhs";
  if (/kuaishou|chenzhongtech|gifshow/.test(u)) return "kuaishou";
  if (/bilibili|b23\.tv/.test(u)) return "bilibili";
  if (/weibo/.test(u)) return "weibo";
  if (/instagram|instagr\.am/.test(u)) return "instagram";
  if (/(twitter|x)\.com|t\.co/.test(u)) return "twitter";
  return "generic";
}

const PLATFORM_NAMES = {
  douyin: "抖音",
  tiktok: "TikTok",
  xhs: "小红书",
  kuaishou: "快手",
  bilibili: "哔哩哔哩",
  weibo: "微博",
  instagram: "Instagram",
  twitter: "Twitter / X",
  generic: "通用",
};

/* ---------------- Douyin ---------------- */

function extractAwemeId(text) {
  const s = String(text || "");
  const patterns = [
    /\/video\/(\d{15,25})/,
    /\/note\/(\d{15,25})/,
    /[?&]modal_id=(\d{15,25})/,
    /[?&]aweme_id=(\d{15,25})/,
    /[?&]item_ids?=(\d{15,25})/,
    /aweme\/v1\/(?:video|aweme)\/(?:detail|info)[^"']*?[\?&](?:aweme_id|item_id)=(\d{15,25})/,
    /\b(\d{18,22})\b/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

async function getTtwid() {
  const body = JSON.stringify({
    region: "cn",
    aid: 1128,
    needFid: false,
    service: "www.iesdouyin.com",
    migrate_info: { ticket: "", source: "node" },
    cbUrlProtocol: "https",
    union: true,
  });
  const res = await fetchRemote("https://ttwid.bytedance.com/ttwid/union/register/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: "https://www.douyin.com/",
      "User-Agent": UA_PC,
    },
    body,
    timeout: 15000,
    maxRedirects: 0,
  }).catch(() => null);
  if (!res) return "";
  return collectCookies("", res.headers["set-cookie"]);
}

function normalizeDouyinVideoUrl(u) {
  if (!u) return u;
  let url = String(u).replace(/^http:\/\//i, "https://");
  // 无水印：playwm -> play
  url = url.replace(/\/playwm\//g, "/play/");
  url = url.replace(/([?&])watermark=1/g, "$1watermark=0");
  return url;
}

function payloadFromAweme(aweme, platformName = "抖音") {
  if (!aweme || typeof aweme !== "object") return null;

  const desc = aweme.desc || aweme.content || "";
  const title = (desc || "抖音作品").slice(0, 80);
  const author = aweme.author?.nickname || aweme.author?.unique_id || aweme.nickname || "";
  const cover =
    aweme.video?.cover?.url_list?.[0] ||
    aweme.video?.origin_cover?.url_list?.[0] ||
    aweme.video?.dynamic_cover?.url_list?.[0] ||
    aweme.images?.[0]?.url_list?.[0] ||
    "";

  // 图文
  const images = [];
  if (Array.isArray(aweme.images)) {
    for (const img of aweme.images) {
      const u =
        img?.url_list?.[img.url_list.length - 1] ||
        img?.url_list?.[0] ||
        img?.download_url?.url_list?.[0] ||
        (typeof img === "string" ? img : null);
      if (u) images.push(normalizeDouyinVideoUrl(u));
    }
  }
  // 兼容 image_post / image_list
  const extraImgs = aweme.image_post?.images || aweme.image_list;
  if (!images.length && Array.isArray(extraImgs)) {
    for (const img of extraImgs) {
      const u = img?.url_list?.slice(-1)[0] || img?.url || (typeof img === "string" ? img : null);
      if (u) images.push(normalizeDouyinVideoUrl(u));
    }
  }
  if (images.length) {
    return {
      type: "images",
      platform: platformName,
      title,
      desc,
      cover: cover || images[0],
      images,
      author,
    };
  }

  const playList =
    aweme.video?.play_addr?.url_list ||
    aweme.video?.play_addr_265?.url_list ||
    aweme.video?.playAddr ||
    aweme.video?.download_addr?.url_list ||
    [];
  let video = "";
  for (const u of playList) {
    if (!u) continue;
    // 优先无水印 / 高清
    if (/\/play\//.test(u) || /ratio=1080|ratio=720|is_play_url=1/.test(u) || !/playwm/.test(u)) {
      video = normalizeDouyinVideoUrl(u);
      if (!/playwm/.test(u)) break;
    }
  }
  if (!video && playList.length) video = normalizeDouyinVideoUrl(playList[0]);

  // bit_rate 更高码率 / 杜比
  const rates = aweme.video?.bit_rate || aweme.video?.bitRate || [];
  if (Array.isArray(rates) && rates.length) {
    const sorted = [...rates].sort(
      (a, b) =>
        (b?.bit_rate || b?.bitRate || 0) - (a?.bit_rate || a?.bitRate || 0) ||
        (b?.gear === "normal_1080p" ? 1 : 0) - (a?.gear === "normal_1080p" ? 1 : 0)
    );
    const best = sorted[0]?.play_addr?.url_list?.[0];
    if (best) video = normalizeDouyinVideoUrl(best);
  }
  // ultra / HDR / 杜比档
  const ultra =
    aweme.video?.ultra_bit_rate?.play_addr?.url_list?.[0] ||
    aweme.video?.play_addr_h264?.url_list?.[0] ||
    aweme.video?.play_addr_265?.url_list?.[0];
  if (ultra) video = normalizeDouyinVideoUrl(ultra);

  if (!video) return null;
  const q = describeQuality(video, { bit: aweme.video?.bit_rate?.[0]?.bit_rate });

  return {
    type: "video",
    platform: platformName,
    title,
    desc,
    cover: cover ? normalizeDouyinVideoUrl(cover) : "",
    video,
    author,
    music: aweme.music?.play_url?.url_list?.[0] || aweme.music?.playUrl?.[0] || null,
    quality: q.label,
    qualityMeta: q,
  };
}

function findAwemeInObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.aweme_id || obj.awemeId || obj.item_id) {
    if (obj.video || obj.images) return obj;
  }
  const candidates = walkFind(
    obj,
    (o) => {
      if (!o || typeof o !== "object") return false;
      const hasId = o.aweme_id || o.awemeId || o.itemId || o.item_id;
      const hasMedia = o.video || o.images || o.image_post;
      return Boolean(hasId && hasMedia) || Boolean(o.video?.play_addr?.url_list?.length) || Boolean(o.images?.length && o.desc !== undefined);
    },
    40
  );
  return candidates[0] || null;
}

function extractDouyinFromHtml(html) {
  const blobs = [];

  // RENDER_DATA（URI 编码 JSON）
  const rd = html.match(/id="RENDER_DATA"[^>]*>([^<]+)</);
  if (rd) {
    const j = decodeMaybeJson(rd[1]);
    if (j) blobs.push(j);
  }

  // window._ROUTER_DATA = {...};
  const router = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (router) {
    try {
      blobs.push(JSON.parse(router[1]));
    } catch {
      /* ignore */
    }
  }

  // window.__INITIAL_STATE__
  const init = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:\(function|<\/script>)/);
  if (init) {
    try {
      blobs.push(JSON.parse(init[1]));
    } catch {
      /* ignore */
    }
  }

  // application/json scripts
  for (const m of [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)].slice(0, 8)) {
    try {
      blobs.push(JSON.parse(m[1]));
    } catch {
      /* ignore */
    }
  }

  for (const blob of blobs) {
    const aweme = findAwemeInObject(blob);
    if (aweme) {
      const p = payloadFromAweme(aweme);
      if (p && (p.video || p.images?.length)) return p;
    }
    // 有些结构直接是 video/play_addr
    const p2 = payloadFromAweme(blob);
    if (p2 && (p2.video || p2.images?.length)) return p2;
  }

  // 正则兜底：play_addr / playApi / url_list
  const playAddr =
    (html.match(/"play_addr"\s*:\s*\{[\s\S]*?"url_list"\s*:\s*\[\s*"([^"]+)"/i) || [])[1] ||
    (html.match(/"playApi"\s*:\s*"([^"]+)"/i) || [])[1] ||
    (html.match(/"playAddr"\s*:\s*\[\s*"([^"]+)"/i) || [])[1] ||
    (html.match(/"(?:src|url)"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/i) || [])[1];

  const title =
    (html.match(/"desc"\s*:\s*"([^"]{2,200})"/i) || [])[1] ||
    matchMeta(html, ["og:title", "twitter:title"]) ||
    (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] ||
    "抖音作品";
  const cover =
    matchMeta(html, ["og:image", "twitter:image"]) ||
    (html.match(/"cover"\s*:\s*\{\s*"url_list"\s*:\s*\[\s*"([^"]+)"/i) || [])[1] ||
    "";

  // 图片列表正则
  const imgMatches = [...html.matchAll(/"url_list"\s*:\s*\[\s*"(https?:\/\/[^"]+?)(?:\?[^"]*)?"/gi)]
    .map((m) => m[1])
    .filter((u) => /\.(jpeg|jpg|webp|png)(\?|$)/i.test(u) || /aweme|douyinpic|p3-sign/i.test(u));
  const uniqueImgs = [...new Set(imgMatches)].slice(0, 12);

  if (playAddr) {
    return {
      type: "video",
      platform: "抖音",
      title: decodeEntities(title),
      desc: decodeEntities(title),
      cover: absUrl(cover || "", "https://www.douyin.com/"),
      video: normalizeDouyinVideoUrl(absUrl(playAddr, "https://www.douyin.com/")),
      author: "",
    };
  }
  if (uniqueImgs.length >= 1) {
    // 避免把封面误判成图集：多张或明确 images
    const images = uniqueImgs.map((u) => normalizeDouyinVideoUrl(u));
    if (images.length > 1 || /"images"\s*:/.test(html)) {
      return {
        type: "images",
        platform: "抖音",
        title: decodeEntities(title),
        desc: decodeEntities(title),
        cover: images[0],
        images,
        author: "",
      };
    }
  }
  return null;
}

async function parseDouyin(url) {
  const original = url;

  // 1) 解析短链，尝试本地提取（部分页面仍可能带数据）
  let finalUrl = original;
  try {
    const res = await fetchRemote(original, {
      headers: {
        "User-Agent": UA_MOBILE,
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: 15000,
      maxRedirects: 10,
    });
    finalUrl = res.finalUrl || original;

    const html = res.body.toString("utf8");
    const fromHtml = extractDouyinFromHtml(html);
    if (fromHtml && (fromHtml.video || fromHtml.images?.length)) return fromHtml;
  } catch {
    /* continue */
  }

  // 2) 聚合解析接口（2026 后 iesdouyin SSR 只给壳，这层最稳）
  const agg = await parseViaAggregator(original, "抖音");
  if (agg && (agg.video || agg.images?.length)) return agg;
  const agg2 = await parseViaAggregator(finalUrl, "抖音");
  if (agg2 && (agg2.video || agg2.images?.length)) return agg2;

  // 3) 规范化 share 页再抓 + ttwid
  const awemeId = extractAwemeId(finalUrl) || extractAwemeId(original);
  const shareUrls = [];
  if (awemeId) {
    shareUrls.push(`https://www.iesdouyin.com/share/video/${awemeId}/`);
    shareUrls.push(`https://www.iesdouyin.com/share/note/${awemeId}/`);
    shareUrls.push(`https://www.douyin.com/video/${awemeId}`);
  }
  if (!shareUrls.includes(finalUrl)) shareUrls.unshift(finalUrl);

  const ttwid = await getTtwid();

  for (const u of shareUrls) {
    try {
      const html = await fetchHtml(u, {
        headers: {
          "User-Agent": UA_MOBILE,
          Cookie: ttwid || undefined,
          Referer: "https://www.douyin.com/",
        },
      });
      const p = extractDouyinFromHtml(html);
      if (p && (p.video || p.images?.length)) return p;
    } catch {
      /* next */
    }
  }

  // 4) 详情接口（需要 ttwid）
  if (awemeId && ttwid) {
    const apis = [
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${awemeId}&aid=6383&channel=channel_pc_web&device_platform=webapp&os_name=windows&os_version=10&update_version_code=170400`,
      `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${awemeId}`,
    ];
    for (const api of apis) {
      const data = await tryJson(api, {
        headers: {
          Cookie: ttwid,
          Referer: "https://www.douyin.com/",
          "User-Agent": UA_PC,
        },
      });
      if (!data) continue;
      const aweme =
        data.aweme_detail ||
        data.awemeDetail ||
        data.itemList?.[0] ||
        data.item_list?.[0] ||
        data.data?.aweme_detail ||
        findAwemeInObject(data);
      const p = payloadFromAweme(aweme || data);
      if (p && (p.video || p.images?.length)) return p;
    }
  }

  // 5) video_id 直链构造
  const vidMatch =
    finalUrl.match(/[?&]video_id=([a-z0-9]+)/i) ||
    original.match(/[?&]video_id=([a-z0-9]+)/i);
  const vid = vidMatch?.[1];
  if (vid) {
    const play = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${vid}&line=0&ratio=1080p&watermark=0`;
    return {
      type: "video",
      platform: "抖音",
      title: awemeId ? `抖音作品 ${awemeId}` : "抖音作品",
      desc: "",
      cover: "",
      video: play,
      author: "",
    };
  }

  throw new Error(
    "抖音解析失败：可能是链接已失效、仅自己可见，或平台风控。请从抖音 App 重新复制完整分享口令（含 v.douyin.com 链接）后再试。"
  );
}

/* ---------------- Bilibili ---------------- */

async function parseBilibili(url) {
  let finalUrl = url;
  try {
    const res = await fetchRemote(url, {
      headers: { "User-Agent": UA_PC, Referer: "https://www.bilibili.com/" },
      maxRedirects: 6,
    });
    finalUrl = res.finalUrl || url;
  } catch {
    /* keep */
  }

  const bvid = (finalUrl.match(/BV[0-9A-Za-z]+/) || [])[0];
  const aid = (finalUrl.match(/[?&]av(\d+)/) || [])[1];

  let data = null;
  if (bvid) {
    const info = await tryJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
    data = info?.data;
  } else if (aid) {
    const info = await tryJson(`https://api.bilibili.com/x/web-interface/view?aid=${aid}`);
    data = info?.data;
  }
  if (!data) {
    const og = await parseViaOg(url, "哔哩哔哩");
    if (og) return og;
    throw new Error("无法识别 B 站视频");
  }

  const cid = data.cid || data.pages?.[0]?.cid;
  const title = data.title || "B站视频";
  const cover = data.pic || "";
  const desc = data.desc || "";
  const author = data.owner?.name || "";

  let video = "";
  let quality = "";
  let qualityBitrate = 0;
  let audio = "";
  if (cid) {
    const play =
      (await tryJson(
        `https://api.bilibili.com/x/player/playurl?bvid=${bvid || data.bvid}&cid=${cid}&qn=127&fnval=4048&fourk=1`,
        { headers: { Referer: "https://www.bilibili.com/" } }
      )) ||
      (await tryJson(
        `https://api.bilibili.com/x/player/playurl?avid=${data.aid}&cid=${cid}&qn=127&fnval=4048&fourk=1`,
        { headers: { Referer: "https://www.bilibili.com/" } }
      ));
    const dash = play?.data?.dash;
    if (dash?.video?.length) {
      // 按带宽取最高，兼容 H264/H265/AV1 多编码
      const sorted = [...dash.video].sort((a, b) => {
        const aw = a.bandwidth || a.band_width || 0;
        const bw = b.bandwidth || b.band_width || 0;
        if (bw !== aw) return bw - aw;
        return (b.id || 0) - (a.id || 0);
      });
      const bestV = sorted[0];
      video = bestV?.baseUrl || bestV?.base_url || bestV?.url;
      const bwKbps = Math.round((bestV?.bandwidth || bestV?.band_width || 0) / 1000);
      quality = `原画 · ${bestV?.id || ""}P${bwKbps ? " · " + bwKbps + "kbps" : ""}`;
      qualityBitrate = bwKbps;
    }
    if (!video && play?.data?.durl?.length) {
      video = play.data.durl[0].url;
      quality = `原画 · ${play?.data?.quality || ""}`;
    }

    // 音频：杜比 / Hi-Res 优先，再最高码率
    const audioList = [
      ...(dash?.flac?.audio ? [dash.flac.audio] : []),
      ...(Array.isArray(dash?.dolby?.audio) ? dash.dolby.audio : dash?.dolby?.audio ? [dash.dolby.audio] : []),
      ...(Array.isArray(dash?.audio) ? dash.audio : []),
    ].filter(Boolean);
    if (audioList.length) {
      const sortedA = [...audioList].sort(
        (a, b) => (b.bandwidth || 0) - (a.bandwidth || 0) || (b.id || 0) - (a.id || 0)
      );
      const bestA = sortedA[0];
      audio = bestA?.baseUrl || bestA?.base_url || bestA?.url || "";
      if (dash?.flac?.audio || dash?.dolby?.audio) {
        quality = (quality ? quality + " · " : "") + (dash?.flac?.audio ? "Hi-Res" : "杜比音效");
      }
    }
  }

  return {
    type: "video",
    platform: "哔哩哔哩",
    title,
    desc,
    cover,
    video: video || "",
    author,
    music: audio || null,
    quality: quality || "原画质",
    qualityMeta: { label: quality || "原画质", br: qualityBitrate || 0 },
    qualityNote: "B 站已请求最高码率视频流",
  };
}

async function parseViaOg(url, platformName) {
  const html = await fetchHtml(url);
  const title =
    matchMeta(html, ["og:title", "twitter:title"]) ||
    (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] ||
    "原画质内容";
  const video =
    matchMeta(html, ["og:video", "og:video:url", "og:video:secure_url", "twitter:player:stream"]) ||
    (html.match(/<video[^>]+src="([^"]+)"/i) || [])[1];
  const image = matchMeta(html, ["og:image", "twitter:image", "og:image:url"]);
  const desc = matchMeta(html, ["og:description", "description"]) || "";

  if (video) {
    return {
      type: "video",
      platform: platformName,
      title: decodeEntities(title),
      desc: decodeEntities(desc),
      cover: absUrl(image || "", url),
      video: absUrl(video, url),
      author: "",
    };
  }
  if (image) {
    return {
      type: "images",
      platform: platformName,
      title: decodeEntities(title),
      desc: decodeEntities(desc),
      cover: absUrl(image, url),
      images: [absUrl(image, url)],
      author: "",
    };
  }
  return null;
}

/* ---------------- others ---------------- */

async function parseByHtml(url, platformName) {
  // 优先本地 HTML / JSON
  try {
    const html = await fetchHtml(url, { headers: { "User-Agent": UA_MOBILE } });

    const rd = html.match(/id="RENDER_DATA"[^>]*>([^<]+)</);
    const blobs = [];
    if (rd) {
      const j = decodeMaybeJson(rd[1]);
      if (j) blobs.push(j);
    }
    for (const m of [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)].slice(0, 6)) {
      try {
        blobs.push(JSON.parse(m[1]));
      } catch {
        /* ignore */
      }
    }

    for (const blob of blobs) {
      const hits = walkFind(
        blob,
        (o) =>
          o &&
          typeof o === "object" &&
          (typeof o.play === "string" && o.play.startsWith("http") ||
            typeof o.videoUrl === "string" ||
            typeof o.video_url === "string" ||
            o.play_addr?.url_list?.length ||
            o.playUrl ||
            o.masterUrl),
        30
      );
      for (const hit of hits) {
        const v =
          hit.play ||
          hit.videoUrl ||
          hit.video_url ||
          hit.play_addr?.url_list?.[0] ||
          hit.playUrl ||
          hit.masterUrl;
        if (v) {
          return {
            type: "video",
            platform: platformName,
            title: pick(blob, ["title", "desc", "shareDesc"]) || `${platformName}内容`,
            desc: pick(blob, ["desc", "title"]) || "",
            cover: pick(blob, ["cover", "coverUrl", "originCover", "images.0"]) || "",
            video: absUrl(v, url),
            author: pick(blob, ["nickname", "author.nickname", "user.nickname"]) || "",
          };
        }
      }

      const imgs = pick(blob, ["images", "imageList", "image_list", "note.imageList"]);
      if (Array.isArray(imgs) && imgs.length) {
        const list = imgs
          .map((x) => (typeof x === "string" ? x : x?.url || x?.urlDefault || x?.infoList?.[0]?.url))
          .filter(Boolean)
          .map((x) => absUrl(x, url));
        if (list.length) {
          return {
            type: "images",
            platform: platformName,
            title: pick(blob, ["title", "desc"]) || `${platformName}图片`,
            desc: pick(blob, ["desc"]) || "",
            cover: list[0],
            images: list,
            author: pick(blob, ["nickname", "author.nickname"]) || "",
          };
        }
      }
    }

    const og = parseViaOgFromHtml(html, url, platformName);
    if (og) return og;
  } catch {
    /* fallthrough */
  }

  // 聚合接口兜底
  const agg = await parseViaAggregator(url, platformName);
  if (agg && (agg.video || agg.images?.length)) return agg;

  throw new Error(`${platformName}解析失败，请更换链接或稍后重试。`);
}

function parseViaOgFromHtml(html, baseUrl, platformName) {
  const title =
    matchMeta(html, ["og:title", "twitter:title"]) ||
    (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] ||
    "原画质内容";
  const video =
    matchMeta(html, ["og:video", "og:video:url", "og:video:secure_url"]) ||
    (html.match(/<video[^>]+src="([^"]+)"/i) || [])[1];
  const image = matchMeta(html, ["og:image", "twitter:image"]);
  const desc = matchMeta(html, ["og:description", "description"]) || "";

  if (video) {
    return {
      type: "video",
      platform: platformName,
      title: decodeEntities(title),
      desc: decodeEntities(desc),
      cover: absUrl(image || "", baseUrl),
      video: absUrl(video, baseUrl),
      author: "",
    };
  }
  if (image) {
    return {
      type: "images",
      platform: platformName,
      title: decodeEntities(title),
      desc: decodeEntities(desc),
      cover: absUrl(image, baseUrl),
      images: [absUrl(image, baseUrl)],
      author: "",
    };
  }
  return null;
}

async function parseMedia(url) {
  const pid = detectPlatform(url);
  const platformName = PLATFORM_NAMES[pid] || "通用";

  let payload = null;
  if (pid === "douyin") payload = await parseDouyin(url);
  else if (pid === "bilibili") payload = await parseBilibili(url);
  else payload = await parseByHtml(url, platformName);

  return enrichQuality(payload);
}

/* ---------------- static & routes ---------------- */

function serveStatic(res, pathname) {
  let rel = pathname === "/" || pathname === "" ? "/index.html" : pathname;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const sendFile = (buf, ext) => {
    cors(res);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(buf);
  };

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      const name = path.basename(safe).toLowerCase();
      const fallback = FALLBACK_STATIC[name];
      if (fallback) return sendFile(fallback.body, fallback.ext);
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    sendFile(buf, path.extname(filePath).toLowerCase());
  });
}

// Serverless 打包可能丢静态文件，启动时读进内存
const FALLBACK_STATIC = {};
for (const [name, ext] of [
  ["index.html", ".html"],
  ["style.css", ".css"],
  ["app.js", ".js"],
]) {
  try {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p)) FALLBACK_STATIC[name] = { body: fs.readFileSync(p), ext };
  } catch {
    /* ignore */
  }
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        out.push({ name, address: iface.address });
      }
    }
  }
  return out;
}

function buildUrls() {
  const lans = lanAddresses();
  const httpUrls = [`http://127.0.0.1:${PORT}`];
  const httpsUrls = [];
  for (const l of lans) {
    httpUrls.push(`http://${l.address}:${PORT}`);
    httpsUrls.push(`https://${l.address}:${HTTPS_PORT}`);
  }
  httpsUrls.unshift(`https://127.0.0.1:${HTTPS_PORT}`);
  return { httpUrls, httpsUrls, lans };
}

function handleRequest(req, res) {
  return (async () => {
    let parsed;
    try {
      parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }
    const pathname = decodeURIComponent(parsed.pathname);

    if (req.method === "OPTIONS") {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === "/api/health") {
      const urls = buildUrls();
      return sendJSON(res, 200, {
        ok: true,
        service: "yuancun",
        time: Date.now(),
        lan: urls.httpUrls,
        https: urls.httpsUrls,
        clipboardReady: true,
      });
    }

    if (pathname === "/api/parse") {
      const q = parsed.searchParams.get("url") || parsed.searchParams.get("text") || "";
      const urls = extractUrls(q);
      if (!urls.length) {
        return sendJSON(res, 400, {
          ok: false,
          error: "未识别到有效链接。请从 App 复制完整分享口令（含 https 链接）。",
        });
      }
      try {
        const payload = await parseMedia(urls[0]);
        return sendJSON(res, 200, { ok: true, data: payload });
      } catch (e) {
        return sendJSON(res, 502, { ok: false, error: e.message || "解析失败" });
      }
    }

    if (pathname === "/api/fetch") {
      const target = parsed.searchParams.get("url");
      if (!target) return sendJSON(res, 400, { ok: false, error: "missing url" });
      try {
        const extra = {};
        try {
          const host = new URL(target).hostname;
          if (/bilibili|hdslb|akamaized|bilivideo/i.test(host)) {
            extra.Referer = "https://www.bilibili.com/";
            extra["User-Agent"] = UA_PC;
          }
          if (/douyin|iesdouyin|tiktok|byteoversea|ibytedtos|snssdk|douyinvod/i.test(host)) {
            extra.Referer = "https://www.douyin.com/";
            extra["User-Agent"] = UA_PC;
          }
          if (/xiaohongshu|xhscdn/i.test(host)) {
            extra.Referer = "https://www.xiaohongshu.com/";
          }
          if (/kuaishou|chenzhongtech|gifshow/i.test(host)) {
            extra.Referer = "https://www.kuaishou.com/";
          }
        } catch {
          /* ignore */
        }
        const remote = await fetchRemote(target, { timeout: 120000, headers: extra, maxRedirects: 8 });
        cors(res);
        res.writeHead(remote.status || 200, {
          "Content-Type": remote.headers["content-type"] || "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
          "Content-Disposition": remote.headers["content-disposition"] || "inline",
          "Content-Length": remote.body.length,
        });
        res.end(remote.body);
      } catch (e) {
        return sendJSON(res, 502, { ok: false, error: e.message || "fetch failed" });
      }
      return;
    }

    serveStatic(res, pathname);
  })();
}

// ---------- export for serverless (Vercel / Cloudflare-style) ----------
module.exports = (req, res) => {
  handleRequest(req, res).catch(() => {
    try {
      res.writeHead(500);
      res.end("Internal Error");
    } catch {
      /* ignore */
    }
  });
};

// ---------- local / VPS listen (skip on Vercel) ----------
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  // HTTP
  http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      try {
        res.writeHead(500);
        res.end("Internal Error");
      } catch {
        /* ignore */
      }
    });
  }).listen(PORT, HOST, () => {
    const urls = buildUrls();
    console.log(`原质存已启动`);
    for (const u of urls.httpUrls) console.log(`  HTTP  ${u}`);
  });

  // HTTPS（手机剪贴板需要安全上下文）
  try {
    const keyPath = path.join(CERT_DIR, "key.pem");
    const certPath = path.join(CERT_DIR, "cert.pem");
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      const ssl = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
      https.createServer(ssl, (req, res) => {
        handleRequest(req, res).catch(() => {
          try {
            res.writeHead(500);
            res.end("Internal Error");
          } catch {
            /* ignore */
          }
        });
      }).listen(HTTPS_PORT, HOST, () => {
        const urls = buildUrls();
        console.log(`---`);
        for (const u of urls.httpsUrls) console.log(`  HTTPS ${u}  ← 手机请优先用这个（粘贴可用）`);
        console.log(`  首次打开 HTTPS 需点「继续访问 / 高级 → 继续」信任自签名证书`);
      });
    } else {
      console.log(`  (未找到 certs/key.pem，跳过 HTTPS)`);
    }
  } catch (e) {
    console.log(`  HTTPS 启动失败: ${e.message}`);
  }
}
