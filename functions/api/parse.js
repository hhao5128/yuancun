// Cloudflare Pages Function: /api/parse
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

function detectPlatform(url) {
  const u = String(url).toLowerCase();
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

function extractUrls(text) {
  const matches = String(text || "").match(/https?:\/\/[^\s，。、；;！!？?"'）)】\]]+/gi) || [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:]+$/, "")))];
}

function normalizeDouyinVideoUrl(u) {
  if (!u) return u;
  let url = String(u).replace(/^http:\/\//i, "https://");
  url = url.replace(/\/playwm\//g, "/play/");
  url = url.replace(/([?&])watermark=1/g, "$1watermark=0");
  return url;
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((a, c) => (a == null ? a : a[c]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

async function probeVideoResolution(url) {
  try {
    const res = await fetch(url, {
      headers: {
        Range: "bytes=0-262143",
        Referer: "https://www.douyin.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf || buf.length < 32) return null;
    for (let i = 4; i + 8 < buf.length; i++) {
      if (buf[i] === 0x74 && buf[i + 1] === 0x6b && buf[i + 2] === 0x68 && buf[i + 3] === 0x64) {
        const atomStart = i - 4;
        const atomSize =
          (buf[atomStart] << 24) | (buf[atomStart + 1] << 16) | (buf[atomStart + 2] << 8) | buf[atomStart + 3];
        const ver = buf[atomStart + 8];
        const wOff = ver === 1 ? atomStart + 92 : atomStart + 84;
        const hOff = wOff + 4;
        if (hOff + 4 <= buf.length && atomSize >= 84) {
          const w = (((buf[wOff] << 24) | (buf[wOff + 1] << 16) | (buf[wOff + 2] << 8) | buf[wOff + 3]) >>> 16);
          const h = (((buf[hOff] << 24) | (buf[hOff + 1] << 16) | (buf[hOff + 2] << 8) | buf[hOff + 3]) >>> 16);
          if (w > 0 && h > 0 && w < 20000 && h < 20000) return { width: w, height: h };
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

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
    if (dim.width < dim.height && dim.width >= 540) res = `${dim.width}×${dim.height}`;
    payload.resolution = `${dim.width}×${dim.height}`;
    payload.width = dim.width;
    payload.height = dim.height;
  }
  const brm = String(payload.video).match(/[?&]br=(\d+)/);
  const br = brm ? Number(brm[1]) : payload.qualityMeta?.br || 0;
  const parts = [];
  if (res) parts.push(res);
  else parts.push("原画质");
  if (br > 0) parts.push(`${br}kbps`);
  if (/dolby|dovi/i.test(String(payload.video))) parts.push("杜比");
  payload.quality = parts.join(" · ");
  return payload;
}

async function parseViaAggregator(url, platformName) {
  try {
    const res = await fetch("https://video.zacao.top/api/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://video.zacao.top/",
      },
      body: JSON.stringify({ url, text: url, hd: true, quality: "origin" }),
    });
    const data = await res.json();
    const d = data?.data || data;
    if (!d) return null;

    const title = d.title || d.desc || `${platformName}内容`;
    const cover = d.cover_url || d.cover || "";
    const author =
      typeof d.author === "string" ? d.author : d.author?.nickname || d.nickname || "";
    const desc = d.desc || title;

    const imgs = d.image_list || d.images || d.imgUrls || [];
    if (Array.isArray(imgs) && imgs.length) {
      const images = imgs
        .map((x) => (typeof x === "string" ? x : x?.url || x?.image_url))
        .filter(Boolean);
      if (images.length) {
        return {
          type: "images",
          platform: platformName,
          title,
          desc,
          cover: cover || images[0],
          images: images.map(normalizeDouyinVideoUrl),
          author,
          quality: "原图",
        };
      }
    }

    const candidates = [];
    if (d.source_video_url) candidates.push({ url: d.source_video_url, prefer: 2, bit: 0, label: "源画质" });
    if (d.video_url) candidates.push({ url: d.video_url, prefer: 1, bit: 0, label: "高清" });
    const list = d.video_list || [];
    for (const item of list) {
      const u = typeof item === "string" ? item : item?.url || item?.play;
      if (!u) continue;
      candidates.push({
        url: u,
        prefer: 0,
        bit: item?.bit_rate || item?.bitrate || 0,
        label: item?.level || item?.gear || "备选",
      });
    }
    candidates.sort((a, b) => b.bit - a.bit || b.prefer - a.prefer);
    if (!candidates.length) return null;

    const best = candidates[0];
    return {
      type: "video",
      platform: platformName,
      title,
      desc,
      cover,
      video: normalizeDouyinVideoUrl(best.url),
      author,
      music: d.source_audio_url || d.audio_url || null,
      quality: best.prefer === 2 ? "源画质" : "原画质",
      qualityMeta: { br: best.bit || 0 },
      qualityNote: "已取公开最高可用流",
      alternates: candidates.slice(1, 5).map((c) => ({
        url: normalizeDouyinVideoUrl(c.url),
        label: c.label || "备选",
        bit: c.bit || 0,
      })),
    };
  } catch {
    return null;
  }
}

async function parseBilibili(url) {
  const bvid = (url.match(/BV[0-9A-Za-z]+/) || [])[0];
  const aid = (url.match(/[?&]av(\d+)/) || [])[1];
  let data = null;
  if (bvid) {
    const info = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: { Referer: "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0" },
    }).then((r) => r.json());
    data = info?.data;
  } else if (aid) {
    const info = await fetch(`https://api.bilibili.com/x/web-interface/view?aid=${aid}`, {
      headers: { Referer: "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0" },
    }).then((r) => r.json());
    data = info?.data;
  }
  if (!data) throw new Error("无法识别 B 站视频");

  const cid = data.cid || data.pages?.[0]?.cid;
  let video = "";
  let quality = "原画质";
  let audio = "";
  let qualityBitrate = 0;

  if (cid) {
    const play = await fetch(
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid || data.bvid}&cid=${cid}&qn=127&fnval=4048&fourk=1`,
      { headers: { Referer: "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0" } }
    ).then((r) => r.json());
    const dash = play?.data?.dash;
    if (dash?.video?.length) {
      const sorted = [...dash.video].sort(
        (a, b) => (b.bandwidth || 0) - (a.bandwidth || 0) || (b.id || 0) - (a.id || 0)
      );
      const bestV = sorted[0];
      video = bestV?.baseUrl || bestV?.base_url || bestV?.url;
      qualityBitrate = Math.round((bestV?.bandwidth || 0) / 1000);
      quality = `原画 · ${bestV?.id || ""}P${qualityBitrate ? " · " + qualityBitrate + "kbps" : ""}`;
    }
    if (!video && play?.data?.durl?.length) video = play.data.durl[0].url;
    const audioList = [
      ...(dash?.flac?.audio ? [dash.flac.audio] : []),
      ...(Array.isArray(dash?.dolby?.audio) ? dash.dolby.audio : []),
      ...(Array.isArray(dash?.audio) ? dash.audio : []),
    ].filter(Boolean);
    if (audioList.length) {
      const bestA = [...audioList].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
      audio = bestA?.baseUrl || bestA?.base_url || bestA?.url || "";
    }
  }

  return {
    type: "video",
    platform: "哔哩哔哩",
    title: data.title || "B站视频",
    desc: data.desc || "",
    cover: data.pic || "",
    video: video || "",
    author: data.owner?.name || "",
    music: audio || null,
    quality,
    qualityMeta: { br: qualityBitrate },
    qualityNote: "B 站已请求最高码率视频流",
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = url.searchParams.get("url") || url.searchParams.get("text") || "";
  const urls = extractUrls(q);
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (!urls.length) {
    return new Response(
      JSON.stringify({ ok: false, error: "未识别到有效链接。请从 App 复制完整分享口令（含 https 链接）。" }),
      { status: 400, headers }
    );
  }

  try {
    const target = urls[0];
    const pid = detectPlatform(target);
    const platformName = PLATFORM_NAMES[pid] || "通用";
    let payload = null;

    if (pid === "bilibili") payload = await parseBilibili(target);
    else payload = await parseViaAggregator(target, platformName);

    if (payload && (payload.video || payload.images?.length || payload.cover)) {
      payload = await enrichQuality(payload);
      return new Response(JSON.stringify({ ok: true, data: payload }), { status: 200, headers });
    }
    return new Response(
      JSON.stringify({ ok: false, error: "解析失败：未找到媒体地址，请更换链接后重试。" }),
      { status: 502, headers }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message || "解析失败" }),
      { status: 502, headers }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
