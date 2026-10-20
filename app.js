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

  function showToast(msg, ms = 2200) {
    toast.textContent = msg;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.hidden = true;
      }, 220);
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
    const matches = String(text || "").match(/https?:\/\/[^\s，。、；;！!？?"'）)】\]]+/gi) || [];
    return [...new Set(matches.map((u) => u.replace(/[.,;:]+$/, "")))];
  }

  function detectPlatform(url) {
    const u = String(url).toLowerCase();
    if (/douyin|iesdouyin|v\.douyin/.test(u)) return { id: "douyin", name: "抖音" };
    if (/tiktok|vm\.tiktok|vt\.tiktok/.test(u)) return { id: "tiktok", name: "TikTok" };
    if (/xiaohongshu|xhslink|xhs\.com/.test(u)) return { id: "xhs", name: "小红书" };
    if (/kuaishou|chenzhongtech|gifshow/.test(u)) return { id: "kuaishou", name: "快手" };
    if (/bilibili|b23\.tv/.test(u)) return { id: "bilibili", name: "哔哩哔哩" };
    if (/weibo/.test(u)) return { id: "weibo", name: "微博" };
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

  function extFromUrl(url, fallback = "mp4") {
    try {
      const path = new URL(url).pathname;
      const m = path.match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
      return m ? m[1].toLowerCase() : fallback;
    } catch {
      return fallback;
    }
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

  async function parseUrl(url) {
    try {
      statusText.textContent = `正在解析 ${detectPlatform(url).name} …`;
      const local = await fetchJSON(`/api/parse?url=${encodeURIComponent(url)}`, 22000);
      if (local && local.ok && local.data && (local.data.video || local.data.images?.length || local.data.cover)) {
        return local.data;
      }
      if (local && local.error) throw new Error(local.error);
      throw new Error("解析失败：未找到媒体地址");
    } catch (e) {
      throw e;
    }
  }

  async function fetchBlob(url) {
    const tries = [`/api/fetch?url=${encodeURIComponent(url)}`];
    for (const target of tries) {
      try {
        const res = await fetch(target, { mode: "cors" });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob && blob.size > 0) return blob;
      } catch (_) {}
    }
    throw new Error("download failed");
  }

  async function downloadFile(url, filename) {
    try {
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
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("已在新窗口打开，请长按或右键另存为");
    }
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
        parsed.pathname.length > 36 ? parsed.pathname.slice(0, 36) + "…" : parsed.pathname;
      return parsed.hostname.replace(/^www\./, "") + path;
    } catch {
      return String(u).slice(0, 48);
    }
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

      if (Array.isArray(payload.alternates) && payload.alternates.length) {
        payload.alternates.forEach((alt) => {
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
            <div class="dl-label">下载音频</div>
            <div class="dl-sub">${escapeHtml(shortUrl(String(payload.music)))}</div>
          </div>
        `;
        const mBtn = document.createElement("button");
        mBtn.className = "dl-btn secondary";
        mBtn.type = "button";
        mBtn.textContent = "下载音频";
        mBtn.addEventListener("click", () => {
          downloadFile(
            String(payload.music),
            fileNameFrom(payload.title + "-audio", String(payload.music), "video")
          );
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
          } catch (_) {}
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
    } catch (_) {}
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

  input.addEventListener("paste", () => {
    setTimeout(() => {
      clearBtn.hidden = !input.value.trim();
    }, 0);
  });
})();
