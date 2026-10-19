// Cloudflare Pages Function: /api/fetch — 代理下载媒体
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const target = url.searchParams.get("url");
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Disposition, Content-Type, Content-Length",
  };

  if (!target) {
    return new Response(JSON.stringify({ ok: false, error: "missing url" }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const extra = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Referer: "https://www.douyin.com/",
    };
    try {
      const host = new URL(target).hostname;
      if (/bilibili|hdslb|akamaized|bilivideo/i.test(host)) {
        extra.Referer = "https://www.bilibili.com/";
      }
      if (/xiaohongshu|xhscdn/i.test(host)) extra.Referer = "https://www.xiaohongshu.com/";
      if (/kuaishou|chenzhongtech|gifshow/i.test(host)) extra.Referer = "https://www.kuaishou.com/";
    } catch {
      /* ignore */
    }

    const remote = await fetch(target, { headers: extra, redirect: "follow" });
    const contentType = remote.headers.get("content-type") || "application/octet-stream";
    const disposition = remote.headers.get("content-disposition");

    return new Response(remote.body, {
      status: remote.status,
      headers: {
        ...headers,
        "Content-Type": contentType,
        ...(disposition ? { "Content-Disposition": disposition } : {}),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message || "fetch failed" }), {
      status: 502,
      headers: { ...headers, "Content-Type": "application/json" },
    });
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
