/**
 * Cloudflare Worker：静态资源 + 解析/下载 API
 */

const PLATFORM_NAMES = {
  douyin: "抖音",
  tiktok: "TikTok",
  xhs: "小红书",
  kuaishou: "快手",
  bilibili: "哔哩哔哩",
  weibo: "微博",
  generic: "通用",
};

function detectPlatform(url) {
  const u = String(url).toLowerCase();
  if (/douyin|iesdouyin|v\.douyin/.test(u)) return "douyin";
  if (/tiktok|vm\.tiktok|vt\.tiktok/.test(u)) return "tiktok";
  if (/xiaohongshu|xhslink|xhs\.com/.test(u)) return "xhs";
  if (/kuaishou|chenzhongtech|gifshow/.test(u)) return "kuaishou";
  if (/bilibili|b23\.tv/.test(u)) return "bilibili";
  if (/weibo/.test(u)) return "weibo";
  return "generic";
}

function extractUrls(text) {
  const m = String(text || "").match(/https?:\/\/[^\s，。、；;！!？?"'）)】\]]+/gi) || [];
  return [...new Set(m.map((u) => u.replace(/[.,;:]+$/, "")))];
}

function normalizeVideoUrl(u) {
  if (!u) return u;
  return String(u)
    .replace(/^http:\/\//i, "https://")
    .replace(/\/playwm\//g, "/play/")
    .replace(/([?&])watermark=1/g, "$1watermark=0");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function probeResolution(url) {
  try {
    const res = await fetch(url, {
      headers: {
        Range: "bytes=0-262143",
        Referer: "https://www.douyin.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    for (let i = 4; i + 8 < buf.length; i++) {
      if (buf[i] === 0x74 && buf[i + 1] === 0x6b && buf[i + 2] === 0x68 && buf[i + 3] === 0x64) {
        const s = i - 4;
        const size = (buf[s] << 24) | (buf[s + 1] << 16) | (buf[s + 2] << 8) | buf[s + 3];
        const ver = buf[s + 8];
        const wOff = ver === 1 ? s + 92 : s + 84;
        const hOff = wOff + 4;
        if (hOff + 4 <= buf.length && size >= 84) {
          const w = (((buf[wOff] << 24) | (buf[wOff + 1] << 16) | (buf[wOff + 2] << 8) | buf[wOff + 3]) >>> 16);
          const h = (((buf[hOff] << 24) | (buf[hOff + 1] << 16) | (buf[hOff + 2] << 8) | buf[hOff + 3]) >>> 16);
          if (w > 0 && h > 0 && w < 20000 && h < 20000) return { width: w, height: h };
        }
      }
    }
  } catch {}
  return null;
}

async function enrich(payload) {
  if (!payload?.video) return payload;
  const dim = await probeResolution(payload.video);
  let res = "原画质";
  if (dim) {
    const s = Math.min(dim.width, dim.height);
    const l = Math.max(dim.width, dim.height);
    if (l >= 3200) res = "4K";
    else if (l >= 2400) res = "2K";
    else if (s >= 1000 || l >= 1900) res = "1080P";
    else if (s >= 700) res = "720P";
    else res = `${dim.height}P`;
    if (dim.width < dim.height && dim.width >= 540) res = `${dim.width}×${dim.height}`;
  }
  const brm = String(payload.video).match(/[?&]br=(\d+)/);
  const br = brm ? Number(brm[1]) : 0;
  payload.quality = br > 0 ? `${res} · ${br}kbps` : res;
  return payload;
}

async function parseViaAggregator(url, platformName) {
  const res = await fetch("https://video.zacao.top/api/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Referer: "https://video.zacao.top/",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ url, text: url, hd: true, quality: "origin" }),
  });
  const data = await res.json();
  const d = data?.data || data;
  if (!d) return null;

  const title = d.title || d.desc || `${platformName}内容`;
  const cover = d.cover_url || d.cover || "";
  const author = typeof d.author === "string" ? d.author : d.author?.nickname || "";
  const imgs = d.image_list || d.images || d.imgUrls || [];
  if (Array.isArray(imgs) && imgs.length) {
    const images = imgs.map((x) => (typeof x === "string" ? x : x?.url)).filter(Boolean);
    if (images.length) {
      return {
        type: "images",
        platform: platformName,
        title,
        desc: d.desc || title,
        cover: cover || images[0],
        images: images.map(normalizeVideoUrl),
        author,
        quality: "原图",
      };
    }
  }

  const cands = [];
  if (d.source_video_url) cands.push({ url: d.source_video_url, prefer: 2, bit: 0 });
  if (d.video_url) cands.push({ url: d.video_url, prefer: 1, bit: 0 });
  for (const it of d.video_list || []) {
    const u = typeof it === "string" ? it : it?.url;
    if (u) cands.push({ url: u, prefer: 0, bit: it?.bit_rate || 0, label: it?.level });
  }
  cands.sort((a, b) => b.bit - a.bit || b.prefer - a.prefer);
  if (!cands.length) return null;
  const best = cands[0];
  return {
    type: "video",
    platform: platformName,
    title,
    desc: d.desc || title,
    cover,
    video: normalizeVideoUrl(best.url),
    author,
    music: d.source_audio_url || d.audio_url || null,
    quality: "原画质",
    qualityNote: "已取公开最高可用流",
  };
}

async function parseBilibili(url) {
  const bvid = (url.match(/BV[0-9A-Za-z]+/) || [])[0];
  if (!bvid) return parseViaAggregator(url, "哔哩哔哩");
  const info = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
    headers: { Referer: "https://www.bilibili.com/" },
  }).then((r) => r.json());
  const data = info?.data;
  if (!data) throw new Error("无法识别 B 站视频");
  const cid = data.cid || data.pages?.[0]?.cid;
  let video = "";
  let quality = "原画质";
  if (cid) {
    const play = await fetch(
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=127&fnval=4048&fourk=1`,
      { headers: { Referer: "https://www.bilibili.com/" } }
    ).then((r) => r.json());
    const dash = play?.data?.dash;
    if (dash?.video?.length) {
      const best = [...dash.video].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
      video = best?.baseUrl || best?.base_url || best?.url;
      const bw = Math.round((best?.bandwidth || 0) / 1000);
      quality = `原画 · ${best?.id || ""}P${bw ? " · " + bw + "kbps" : ""}`;
    }
    if (!video && play?.data?.durl?.length) video = play.data.durl[0].url;
  }
  return {
    type: "video",
    platform: "哔哩哔哩",
    title: data.title || "B站视频",
    desc: data.desc || "",
    cover: data.pic || "",
    video,
    author: data.owner?.name || "",
    quality,
    qualityNote: "B 站最高码率",
  };
}

async function handleParse(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("url") || url.searchParams.get("text") || "";
  const urls = extractUrls(q);
  if (!urls.length) return json({ ok: false, error: "未识别到有效链接。请复制完整分享口令。" }, 400);
  try {
    const target = urls[0];
    const pid = detectPlatform(target);
    const name = PLATFORM_NAMES[pid] || "通用";
    let payload = pid === "bilibili" ? await parseBilibili(target) : await parseViaAggregator(target, name);
    if (payload && (payload.video || payload.images?.length)) {
      payload = await enrich(payload);
      return json({ ok: true, data: payload });
    }
    return json({ ok: false, error: "解析失败：未找到媒体地址。" }, 502);
  } catch (e) {
    return json({ ok: false, error: e.message || "解析失败" }, 502);
  }
}

async function handleFetchMedia(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) return json({ ok: false, error: "missing url" }, 400);
  try {
    const extra = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://www.douyin.com/",
    };
    try {
      const host = new URL(target).hostname;
      if (/bilibili|hdslb|bilivideo/i.test(host)) extra.Referer = "https://www.bilibili.com/";
      if (/xiaohongshu|xhscdn/i.test(host)) extra.Referer = "https://www.xiaohongshu.com/";
    } catch {}
    const remote = await fetch(target, { headers: extra, redirect: "follow" });
    return new Response(remote.body, {
      status: remote.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": remote.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return json({ ok: false, error: e.message || "fetch failed" }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "yuancun", time: Date.now(), cloudflare: true });
    }
    if (url.pathname === "/api/parse") return handleParse(request);
    if (url.pathname === "/api/fetch") return handleFetchMedia(request);

    // 静态资源
    return env.ASSETS.fetch(request);
  },
};
