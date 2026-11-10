"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const main = $("#main");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { area: null, seed: String(Math.floor(Math.random() * 1e6)), areas: null, me: null };
const TITLE = "HackerTune";
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const isPhone = () => matchMedia("(hover: none) and (pointer: coarse)").matches;

async function api(path, opts = {}) {
  const o = { headers: {}, ...opts };
  if (o.body && typeof o.body !== "string") { o.body = JSON.stringify(o.body); o.headers["Content-Type"] = "application/json"; }
  const r = await fetch(path, o);
  let d = null;
  try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((d && (d.error || d.detail)) || `HTTP ${r.status}`);
  return d;
}
function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}
const fmtDur = (s) => { if (!s && s !== 0) return ""; s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const fmtTs = fmtDur;
const fmtDate = (d) => d ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ago = (ts) => { const s = Date.now() / 1000 - ts; if (s < 60) return "just now"; if (s < 3600) return `${plural(Math.floor(s / 60), "minute")} ago`; if (s < 86400) return `${plural(Math.floor(s / 3600), "hour")} ago`; if (s < 30 * 86400) return `${plural(Math.floor(s / 86400), "day")} ago`; if (s < 365 * 86400) return `${plural(Math.floor(s / (30 * 86400)), "month")} ago`; return `${plural(Math.floor(s / (365 * 86400)), "year")} ago`; };
const dateAgo = (d) => d ? ago(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 1000) : "";
const fmtViews = (n) => { if (n == null) return ""; const f = (x) => x.toLocaleString("en-US", { maximumFractionDigits: x < 10 ? 1 : 0 }); if (n >= 1e9) return `${f(n / 1e9)}B views`; if (n >= 1e6) return `${f(n / 1e6)}M views`; if (n >= 1e3) return `${f(n / 1e3)}K views`; return plural(n, "view"); };
const thumbUrl = (vid) => `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
const thumb = (vid) => `<img loading="lazy" alt="" src="https://i.ytimg.com/vi/${vid}/hq2.jpg" onerror="this.onerror=null;this.src='${thumbUrl(vid)}'">`;
const STATUS = { new: "queued", triaging: "screening", triage_pass: "queued for review", triage_skip: "filtered out", evaluating: "agent reviewing…", evaluated: "reviewed", failed: "failed", unavailable: "unavailable" };
const I = {
  later: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7z"/></svg>',
  hide: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12a8 8 0 0 1 12.9-6.3L5.7 16.9A7.9 7.9 0 0 1 4 12zm8 8a7.9 7.9 0 0 1-4.9-1.7L18.3 7.1A8 8 0 0 1 12 20z"/></svg>',
  listen: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z"/></svg>',
  yt: '<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7z"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1 6.6 7.6C6.2 8 6 8.5 6 9v10a2 2 0 0 0 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7v-2z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M22 3h-4v12h4V3zM2 14a2 2 0 0 0 2 2h6.3l-1 4.6v.3c0 .4.2.8.4 1.1l1.1 1L17.4 16.4c.4-.4.6-.9.6-1.4V5a2 2 0 0 0-2-2H7c-.8 0-1.5.5-1.8 1.2l-3 7.1c-.1.2-.2.5-.2.7v2z"/></svg>',
  filt: '<svg viewBox="0 0 24 24"><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  video: '<svg viewBox="0 0 24 24"><path d="M10 8v8l6-4-6-4zm11-5H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H3V5h18v14z"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M12 3 2 12h3v8h6v-6h2v6h6v-8h3z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.9H21l-5.4 4.1 2 7L12 15.8 6.4 20l2-7L3 8.9h6.6z"/></svg>',
  subs: '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm2-4h12v2H6zm14 8H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-10 9v-6l5 3z"/></svg>',
  algo: '<svg viewBox="0 0 24 24"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 1l2.2 6.8L21 10l-6.8 2.2L12 19l-2.2-6.8L3 10l6.8-2.2zM19 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>',
  dive: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm1-13h-2v6l5 3 1-1.7-4-2.3z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
};

/* ---------- menu, theme ---------- */
const setMenu = (open) => { document.body.classList.toggle("menu-open", open); $("#scrim").hidden = !open; $("#menuBtn").setAttribute("aria-expanded", open); };
const menuIsDrawer = () => matchMedia("(max-width: 1000px)").matches || document.body.classList.contains("watching");
$("#menuBtn").addEventListener("click", () => {
  if (menuIsDrawer()) setMenu(!document.body.classList.contains("menu-open"));
  else document.body.classList.toggle("side-collapsed");
});
$("#scrim").addEventListener("click", () => setMenu(false));
$("#themeBtn").addEventListener("click", () => {
  const dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");
  const t = dark ? "light" : "dark"; document.documentElement.dataset.theme = t; ls.set("theme", t); try { localStorage.setItem("theme", t); } catch (e) {}
});

/* ---------- router ---------- */
const ALIAS = { "/abonelikler": "/subscriptions", "/algoritma": "/algorithm", "/liste": "/library", "/hakkinda": "/about", "/gecmis": "/history", "/kategoriler": "/topics", "/ara": "/search" };
function go(path, replace = false) {
  if (replace) history.replaceState({}, "", path); else history.pushState({}, "", path);
  route();
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.origin === location.origin) { e.preventDefault(); setMenu(false); go(a.getAttribute("href")); }
});
window.addEventListener("popstate", route);
const YT_LINK = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#q").value.trim(); if (!q) return;
  $("#q").blur();
  const m = q.match(YT_LINK);  // a pasted YouTube link opens the video directly
  go(m ? `/v/${m[1]}` : `/search?q=${encodeURIComponent(q)}`);
});

let cleanup = null;
async function route() {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  closePop();
  if (ALIAS[location.pathname]) history.replaceState({}, "", ALIAS[location.pathname] + location.search + location.hash);
  const p = location.pathname, qs = new URLSearchParams(location.search);
  const nav = p === "/" ? "home" : p === "/showcase" ? "showcase" : p === "/subscriptions" ? "subs" : p === "/algorithm" ? "algo" : p === "/library" ? (qs.get("t") === "liked" ? "liked" : qs.get("t") === "hidden" ? "" : "later") : p === "/history" ? "history" : p === "/topics" ? "cats" : p === "/about" ? "about" : "";
  $$("#side a").forEach((a) => a.classList.toggle("on", a.dataset.nav === nav));
  document.body.classList.toggle("watching", p.startsWith("/v/"));
  document.title = TITLE;
  window.scrollTo(0, 0);
  try {
    if (p === "/") await pageFeed(qs.get("area"));
    else if (p === "/showcase") await pageShowcase();
    else if (p.startsWith("/v/")) await pageWatch(p.slice(3), Number(qs.get("t")) || null);
    else if (p === "/search") await pageSearch(qs.get("q") || "");
    else if (p === "/subscriptions") await pageSubs();
    else if (p === "/algorithm") await pageAlgo();
    else if (p === "/library") await pageList(qs.get("t") || "later");
    else if (p === "/history") await pageHistory();
    else if (p === "/topics") await pageCats();
    else if (p === "/about") await pageAbout();
    else main.innerHTML = `<div class="empty">Page not found. <a href="/" data-link>Back to the feed</a></div>`;
  } catch (e) {
    main.innerHTML = `<div class="empty">Something went wrong: ${esc(e.message)}</div>`;
  }
}

/* ---------- cards ---------- */
function metaLine(it) {
  const a = [];
  if (it.views != null) a.push(fmtViews(it.views));
  else if (it.recs) a.push(`${plural(it.recs, "HN recommendation")}`);
  if (it.upload_date) a.push(dateAgo(it.upload_date));
  else if (it.hn_first) a.push(`on HN since ${it.hn_first}`);
  return a.join(" · ");
}
function cardHTML(it, o = {}) {
  const prog = it.pos && it.dur ? `<span class="prog"><i style="width:${Math.min(100, (100 * it.pos) / it.dur)}%"></i></span>` : "";
  const why = [it.pool_name, it.why].filter(Boolean).join(": ");
  return `<article class="card" data-vid="${it.vid}" data-title="${esc(it.title)}" data-channel="${esc(it.channel || "")}" data-dur="${it.duration || ""}" data-later="${it.later ? 1 : 0}">
    <a class="thumb" href="/v/${it.vid}" data-link>${thumb(it.vid)}${o.num ? `<span class="num">${o.num}</span>` : ""}${it.duration ? `<span class="dur">${fmtDur(it.duration)}</span>` : ""}${prog}</a>
    <div class="info">
      <div><a class="title" href="/v/${it.vid}" data-link title="${esc(it.title)}">${esc(it.title)}</a>
        <div class="meta"><div>${esc(it.channel || "")}</div><div title="${esc(why)}">${it.source === "sub" ? `<span class="badge sub" title="From your subscriptions; agent score">${(it.quality ?? 0).toFixed(1)}</span>` : ""}${esc(metaLine(it))}</div></div>
        ${o.why && it.why ? `<div class="why">${esc(it.why)}</div>` : ""}</div>
      <button class="menu-btn" data-menu aria-label="Options">${I.dots}</button>
    </div>
  </article>`;
}
let popEl = null;
function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
document.addEventListener("click", (e) => { if (popEl && !e.target.closest(".popmenu") && !e.target.closest("[data-menu]")) closePop(); });
function bindCards(root) {
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-menu]");
    if (b) {
      e.preventDefault();
      const card = b.closest(".card,.hrow");
      if (popEl && popEl.dataset.vid === card.dataset.vid) return closePop();
      closePop();
      const later = card.dataset.later === "1";
      popEl = document.createElement("div");
      popEl.className = "popmenu"; popEl.dataset.vid = card.dataset.vid;
      popEl.innerHTML = `<button data-do="listen">${I.listen}Listen in background</button>
        <button data-do="later">${I.later}${later ? "Remove from Watch later" : "Save to Watch later"}</button>
        ${card.classList.contains("hrow") ? `<button data-do="forget">${I.trash}Remove from history</button>` : `<button data-do="hide">${I.hide}Not interested</button>`}
        <button data-do="yt">${I.yt}Open on YouTube</button>`;
      document.body.appendChild(popEl);
      const r = b.getBoundingClientRect();
      const w = 236, left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w + window.scrollX));
      let top = r.bottom + window.scrollY + 4;
      if (r.bottom + 200 > window.innerHeight) top = r.top + window.scrollY - popEl.offsetHeight - 4;
      popEl.style.left = left + "px"; popEl.style.top = top + "px";
      popEl.addEventListener("click", async (ev) => {
        const x = ev.target.closest("[data-do]"); if (!x) return;
        const vid = card.dataset.vid; closePop();
        if (x.dataset.do === "listen") {
          P.play({ vid, title: card.dataset.title, channel: card.dataset.channel, duration: Number(card.dataset.dur) || null }, Number(card.dataset.pos) || 0);
        } else if (x.dataset.do === "later") {
          await api(`/api/video/${vid}/state`, { method: "POST", body: { later: !later } });
          card.dataset.later = later ? "0" : "1"; toast(!later ? "Saved to Watch later" : "Removed from Watch later");
        } else if (x.dataset.do === "hide") {
          await api(`/api/video/${vid}/state`, { method: "POST", body: { hidden: true, rating: -1 } });
          card.style.opacity = ".25"; card.style.pointerEvents = "none"; toast("Got it. You'll see less like this");
        } else if (x.dataset.do === "forget") {
          await api(`/api/history/${vid}`, { method: "DELETE" }); card.remove(); toast("Removed from history");
        } else if (x.dataset.do === "yt") window.open(`https://www.youtube.com/watch?v=${vid}`, "_blank", "noopener");
      });
    }
  });
}

/* =====================================================================
   BACKGROUND LISTENING: an <audio> element + Media Session that keeps
   playing with the screen off
   ===================================================================== */
const P = {
  a: $("#audio"), cur: null, queue: [], session: null, played: 0, playedHidden: 0, wasHidden: false, lastW: null, lastT: null, lastSent: 0, unlocked: false, auto: false,
  rates: [1, 1.25, 1.5, 1.75, 2, 0.75],
  fmt() { return this.a.canPlayType('audio/mp4; codecs="mp4a.40.2"') ? "m4a" : "webm"; },
  // NOTE: on iOS play() must be called inside the user's tap, with no await in between.
  play(v, start = 0, queue = null, auto = false) {
    this.flush();
    this.cur = v; this.auto = auto; this.played = 0; this.playedHidden = 0; this.lastT = null; this.lastW = null;
    this.session = Math.random().toString(36).slice(2);
    if (queue) this.queue = queue.filter((q) => q.vid !== v.vid);
    const a = this.a;
    a.src = `/api/audio/${v.vid}.${this.fmt()}${start > 1 ? `#t=${Math.floor(start)}` : ""}`;
    a.muted = false; a.playbackRate = ls.get("rate", 1);
    this._start = start;
    const pr = a.play();
    if (pr) pr.catch((e) => { if (e.name !== "AbortError") toast("Couldn't start audio: " + e.message); });
    this.ui(); this.meta();
    if (!queue && !this.queue.length) this.fill();
    document.dispatchEvent(new CustomEvent("audiochange"));
    return pr;
  },
  async fill() {  // up next: the video's related videos
    if (!this.cur) return;
    try { const d = await api(`/api/video/${this.cur.vid}`); if (!this.queue.length) this.queue = d.related.map((r) => ({ vid: r.vid, title: r.title, channel: r.channel, duration: r.duration })); } catch (e) {}
  },
  next() {
    const n = this.queue.shift();
    if (!n) { toast("Nothing up next"); return; }
    this.play(n, 0, null);
  },
  stop() { this.flush(); this.a.pause(); this.a.removeAttribute("src"); this.a.load(); this.cur = null; $("#mini").hidden = true; document.body.classList.remove("mini-on"); if ("mediaSession" in navigator) navigator.mediaSession.metadata = null; document.dispatchEvent(new CustomEvent("audiochange")); },
  playing() { return !!this.cur && !this.a.paused; },
  seek(t) {  // some engines seek to the wrong place (end of file) in fragmented MP4: verified on 'seeked' and retried
    const d = this.a.duration; t = Math.max(0, isFinite(d) && d ? Math.min(t, d - 0.5) : t);
    this._seekT = t; this._seekAt = Date.now(); this._seekTry = 0; this.a.currentTime = t;
  },
  ui() {
    const v = this.cur; if (!v) return;
    $("#mini").hidden = false; document.body.classList.add("mini-on");
    $("#miniThumb").style.backgroundImage = `url(${thumbUrl(v.vid)})`;
    $("#miniThumb").href = $("#miniTitle").href = `/v/${v.vid}`;
    $("#miniTitle").textContent = v.title || v.vid;
    $("#miniRate").textContent = (ls.get("rate", 1) + "×").replace("0.", ".");
    this.tick();
  },
  tick() {
    const a = this.a, v = this.cur; if (!v) return;
    const d = a.duration && isFinite(a.duration) ? a.duration : v.duration;
    $("#miniSub").textContent = `${fmtDur(a.currentTime)}${d ? " / " + fmtDur(d) : ""} · ${v.channel || ""}`;
    if (d && !this._drag) $("#miniSeek").value = Math.round((1000 * a.currentTime) / d);
    $("#miniPlayPath").setAttribute("d", a.paused ? "M8 5v14l11-7z" : "M6 19h4V5H6v14zm8-14v14h4V5h-4z");
  },
  meta() {
    if (!("mediaSession" in navigator) || !this.cur) return;
    const v = this.cur;
    navigator.mediaSession.metadata = new MediaMetadata({ title: v.title || v.vid, artist: v.channel || "", album: "HackerTune",
      artwork: [{ src: thumbUrl(v.vid), sizes: "480x360", type: "image/jpeg" }, { src: `https://i.ytimg.com/vi/${v.vid}/mqdefault.jpg`, sizes: "320x180", type: "image/jpeg" }] });
  },
  pos() {
    const a = this.a, d = a.duration;
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !d || !isFinite(d)) return;
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(a.currentTime, d), playbackRate: a.playbackRate }); } catch (e) {}
  },
  account() {  // accumulate time actually played. JS may sleep on a locked screen: an interval counts if it fits the elapsed wall clock
    const t = this.a.currentTime, now = performance.now();
    if (this.lastT != null && !this.a.paused) {
      const d = t - this.lastT, wall = (now - (this.lastW || now)) / 1000;
      if (d > 0 && d <= wall * (this.a.playbackRate || 1) + 3) {
        const s = d / (this.a.playbackRate || 1);
        this.played += s;
        if (document.visibilityState === "hidden" || this.wasHidden) this.playedHidden += s;
      }
    }
    if (document.visibilityState === "visible") this.wasHidden = false;
    this.lastT = t; this.lastW = now;
  },
  flush(beacon = false) {  // write to watch history
    if (!this.cur || !this.session) return;
    this.account();
    const body = JSON.stringify({ pos: this.a.currentTime || this._start || 0, dur: (isFinite(this.a.duration) && this.a.duration) || this.cur.duration || null, delta: Math.round(this.played * 10) / 10, hidden: Math.round(this.playedHidden * 10) / 10, mode: "audio", session: this.session });
    this.played = 0; this.playedHidden = 0; this.lastSent = Date.now();
    sendProgress(this.cur.vid, body, beacon);
  },
  unlock() {  // iOS: treat the audio element as user-started on the first tap, for the automatic switch when the screen locks
    if (this.unlocked || this.cur) return; this.unlocked = true;
    const a = this.a; a.muted = true;
    a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    const pr = a.play(); const done = () => { a.muted = false; if ((a.getAttribute("src") || "").startsWith("data:")) { a.pause(); a.removeAttribute("src"); } };
    if (pr) pr.then(done, done); else done();
  },
};
function sendProgress(vid, body, beacon) {
  if (beacon && navigator.sendBeacon) { navigator.sendBeacon(`/api/video/${vid}/progress`, new Blob([body], { type: "application/json" })); return; }
  fetch(`/api/video/${vid}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}
(() => {
  const a = P.a;
  a.addEventListener("timeupdate", () => {
    if (!P.cur) return;
    P.account(); P.tick();
    if (Date.now() - P.lastSent > 15000) P.flush();
    if (!P._posT || Date.now() - P._posT > 5000) { P._posT = Date.now(); P.pos(); }
  });
  a.addEventListener("loadedmetadata", () => { if (P._start > 1 && Math.abs(a.currentTime - P._start) > 3) P.seek(P._start); P.pos(); P.tick(); });
  a.addEventListener("seeked", () => {
    if (P._seekT == null || Date.now() - P._seekAt > 20000) return;
    if (Math.abs(a.currentTime - P._seekT) > 5 && P._seekTry < 3) { P._seekTry++; a.currentTime = P._seekT; } else P._seekT = null;
  });
  a.addEventListener("play", () => { if (P.cur) { P.lastT = a.currentTime; P.tick(); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; document.dispatchEvent(new CustomEvent("audiochange")); } });
  a.addEventListener("pause", () => { if (P.cur) { P.flush(); P.tick(); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; document.dispatchEvent(new CustomEvent("audiochange")); } });
  a.addEventListener("ended", () => {
    if (!P.cur) return;
    if (P._seekT != null && Date.now() - P._seekAt < 20000 && isFinite(a.duration) && P._seekT < a.duration - 10) { a.currentTime = P._seekT; a.play().catch(() => {}); return; }  /* fake end */ P.flush(); if (ls.get("autonext", true) && P.queue.length) P.next(); else P.tick(); });
  a.addEventListener("error", () => { if (P.cur && a.error) toast("Audio stream error (" + a.error.code + "). Try again."); });
  $("#miniPlay").onclick = () => { if (!P.cur) return; a.paused ? a.play() : a.pause(); };
  $("#miniBack").onclick = () => P.seek(a.currentTime - 15);
  $("#miniFwd").onclick = () => P.seek(a.currentTime + 30);
  $("#miniNext").onclick = () => P.next();
  $("#miniClose").onclick = () => P.stop();
  $("#miniRate").onclick = () => { const r = ls.get("rate", 1); const n = P.rates[(P.rates.indexOf(r) + 1) % P.rates.length]; ls.set("rate", n); a.playbackRate = n; P.ui(); };
  const sk = $("#miniSeek");
  sk.addEventListener("input", () => { P._drag = true; });
  sk.addEventListener("change", () => { P._drag = false; const d = a.duration || (P.cur && P.cur.duration); if (d) P.seek((sk.value / 1000) * d); });
  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession, h = (k, f) => { try { ms.setActionHandler(k, f); } catch (e) {} };
    h("play", () => a.play()); h("pause", () => a.pause());
    h("seekbackward", (d) => P.seek(a.currentTime - ((d && d.seekOffset) || 15)));
    h("seekforward", (d) => P.seek(a.currentTime + ((d && d.seekOffset) || 30)));
    h("seekto", (d) => { P.seek(d.seekTime); P.pos(); });
    h("nexttrack", () => P.next());
    h("previoustrack", () => P.seek(0));
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { P.account(); P.wasHidden = true; P.flush(true); } else if (P.cur) { P.account(); P.flush(); } });
  window.addEventListener("pagehide", () => P.flush(true));
  const unlock = () => { P.unlock(); document.removeEventListener("touchend", unlock, true); document.removeEventListener("click", unlock, true); };
  document.addEventListener("touchend", unlock, true); document.addEventListener("click", unlock, true);
})();

/* ---------- YouTube IFrame API ---------- */
let ytReady = null;
function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((res) => {
    if (window.YT && window.YT.Player) return res(window.YT);
    window.onYouTubeIframeAPIReady = () => res(window.YT);
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true; document.head.appendChild(s);
  });
  return ytReady;
}

/* ---------- feed (home) ---------- */
const segBar = (on, extra = "") => `<div class="bar-top"><nav class="seg" aria-label="View"><a href="/" data-link class="${on === "feed" ? "on" : ""}">${I.home}Feed</a><a href="/showcase" data-link class="${on === "showcase" ? "on" : ""}">${I.star}Showcase</a></nav>${extra}</div>`;
const welcomeHTML = () => `<section class="welcome" id="welcome">
  <button class="ib x" id="wx" aria-label="Dismiss">${I.close}</button>
  <h2>Welcome to HackerTune</h2>
  <p>Your feed starts with the videos Hacker News readers have been recommending to each other since 2007. Three ways to make it yours:</p>
  <div class="steps3">
    <a class="step" href="/subscriptions" data-link><span class="ic">${I.subs}</span><span><b>Bring your subscriptions</b><span>Agents watch new uploads from your channels and only let the good ones through.</span></span></a>
    <a class="step" href="/algorithm" data-link><span class="ic">${I.algo}</span><span><b>Tell the algorithm what you want</b><span>In plain words, like “more hardware, less politics”.</span></span></a>
    <a class="step" href="/showcase" data-link><span class="ic">${I.star}</span><span><b>Open your showcase</b><span>Series and surprising picks your curator agent chose for you.</span></span></a>
  </div>
</section>`;
async function pageFeed(area) {
  state.area = area || null;
  if (!state.areas) state.areas = await api("/api/areas").catch(() => []);
  const me = await api("/api/me").catch(() => null);
  state.me = me;
  const first = me && !me.channels && !me.liked && !(me.profile && (me.profile.more || []).length) && !ls.get("welcomeDone", false);
  const showF = !!state.area || ls.get("filtersOpen", false);
  main.innerHTML = `
    ${first ? welcomeHTML() : ""}
    ${segBar("feed", `<button class="fbtn ${showF ? "on" : ""}" id="fbtn">${I.filt}Filters</button>
      <div class="chips" id="areas" ${showF ? "" : "hidden"}>
        <button class="chip ${!state.area ? "on" : ""}" data-area="">All</button>
        ${state.areas.map((a) => `<button class="chip ${state.area === a.id ? "on" : ""}" data-area="${a.id}">${esc(a.name)}</button>`).join("")}
      </div>`)}
    <div class="grid" id="grid">${Array.from({ length: 9 }, () => `<div><div class="skel" style="aspect-ratio:16/9"></div></div>`).join("")}</div>
    <button class="btn more" id="more" hidden>Load more</button>`;
  if ($("#wx")) $("#wx").onclick = () => { ls.set("welcomeDone", true); $("#welcome").remove(); };
  $("#fbtn").onclick = () => { const h = !$("#areas").hidden; $("#areas").hidden = h; $("#fbtn").classList.toggle("on", !h); ls.set("filtersOpen", !h); };
  $("#areas").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; go(c.dataset.area ? `/?area=${c.dataset.area}` : "/"); });
  bindCards($("#grid"));
  let page = 0, loading = false;
  const load = async () => {
    if (loading) return; loading = true;
    const d = await api(`/api/feed?page=${page}&seed=${state.seed}${state.area ? `&area=${state.area}` : ""}`);
    const g = $("#grid"); if (!g) return;
    if (page === 0) g.innerHTML = "";
    g.insertAdjacentHTML("beforeend", d.items.map((it) => cardHTML(it)).join("") || (page === 0 ? `<div class="empty">No videos left with this filter.</div>` : ""));
    $("#more").hidden = !d.more; page++; loading = false;
  };
  await load();
  $("#more").onclick = load;
  const io = new IntersectionObserver((en) => { if (en[0].isIntersecting && !$("#more").hidden) load(); }, { rootMargin: "800px" });
  io.observe($("#more"));
  cleanup = () => io.disconnect();
}

/* ---------- showcase: shelves curated by the personal curator agent ---------- */
const KIND = { picks: ["Picked for you", I.star], series: ["Series", I.list], wildcard: ["Wildcards", I.spark], deep_dive: ["Deep dive", I.dive] };
async function pageShowcase() {
  document.title = `Showcase - ${TITLE}`;
  main.innerHTML = `${segBar("showcase")}
    <div class="sc-head"><div><h1>Showcase</h1><p>Hand-picked by your curator agent from what you watch, like and tell it, plus a few things you would never have searched for.</p></div>
      <div class="sc-meta"><span id="scWhen"></span><button class="btn small" id="scRefresh">${I.refresh}New edition</button></div></div>
    <div id="sc"><div class="sc-wait"><div class="spinner"></div></div></div>`;
  let timer = null, asked = false;
  const shelf = (s) => {
    const [label, icon] = KIND[s.kind] || [s.kind, I.star];
    const items = (s.items || []).filter((x) => x && x.vid);
    if (!items.length) return "";
    return `<section class="shelf ${esc(s.kind)}">
      <div class="shelf-hd"><div><span class="kind">${icon}${esc(label)}</span><h2>${esc(s.title)}</h2>${s.blurb ? `<p>${esc(s.blurb)}</p>` : ""}</div>
        <div class="shelf-nav"><button class="ib" data-scroll="-1" aria-label="Scroll left">${I.left}</button><button class="ib" data-scroll="1" aria-label="Scroll right">${I.right}</button></div></div>
      <div class="rowx">${items.map((it, i) => cardHTML(it, { why: true, num: s.kind === "series" ? i + 1 : 0 })).join("")}</div></section>`;
  };
  const draw = (d) => {
    const sc = $("#sc"); if (!sc) return;
    $("#scWhen").textContent = d.status === "pending" ? "Curator is preparing a new edition…" : d.generated_at ? `Updated ${ago(d.generated_at)}` : "";
    $("#scRefresh").disabled = d.status === "pending";
    const list = [...(d.shelves || [])], wi = list.findIndex((s) => s.kind === "wildcard");
    if (wi > 1) list.splice(1, 0, list.splice(wi, 1)[0]);  // the surprising shelf goes second, not buried at the bottom
    const shelves = list.map(shelf).join("");
    if (shelves) { sc.innerHTML = shelves; return; }
    sc.innerHTML = `<div class="sc-wait"><div class="spinner"></div><b>Your curator is picking videos</b><span>It reads your history, likes and algorithm notes, then looks well beyond them. This usually takes a few minutes; the page updates by itself.</span></div>`;
  };
  const load = async () => {
    const d = await api("/api/showcase").catch(() => ({ status: "none", shelves: [] }));
    if (!$("#sc")) return;
    if (d.status === "none" && !(d.shelves || []).length && !asked) { asked = true; await api("/api/showcase/refresh", { method: "POST" }).catch(() => {}); d.status = "pending"; }
    draw(d);
    clearTimeout(timer); if (d.status === "pending") timer = setTimeout(load, 15000);
  };
  $("#scRefresh").onclick = async () => {
    try { const r = await api("/api/showcase/refresh", { method: "POST" }); toast(r.error === "rate_limited" ? "A new edition was made recently. Try again in a bit" : "Your curator is preparing a new edition"); } catch (e) { toast(e.message); }
    load();
  };
  main.addEventListener("click", scrollHandler);
  function scrollHandler(e) { const b = e.target.closest("[data-scroll]"); if (!b) return; const row = b.closest(".shelf").querySelector(".rowx"); row.scrollBy({ left: Number(b.dataset.scroll) * row.clientWidth * 0.9, behavior: "smooth" }); }
  bindCards($("#sc"));
  await load();
  cleanup = () => { clearTimeout(timer); main.removeEventListener("click", scrollHandler); };
}

async function pageSearch(q) {
  $("#q").value = q;
  document.title = `${q} - ${TITLE}`;
  main.innerHTML = `<div class="srch"><section id="srCat" hidden></section>
    <section><div class="shelf-hd"><div><span class="kind">YouTube</span></div></div>
      <div id="srYt"><div class="sc-wait"><div class="spinner"></div>Searching YouTube</div></div></section>
    <section id="srLoose" hidden></section></div>`;
  const sec = (title, sub, items) => `<div class="shelf-hd"><div><span class="kind">${title}</span>${sub ? `<p>${sub}</p>` : ""}</div></div>
    <div class="grid">${items.map((it) => cardHTML(it)).join("")}</div>`;
  bindCards(main.firstElementChild);
  const [cat, ytr] = await Promise.allSettled([api(`/api/search?q=${encodeURIComponent(q)}`), api(`/api/search/youtube?q=${encodeURIComponent(q)}`)]);
  if (!$("#srYt")) return;  // navigated away
  const items = cat.status === "fulfilled" ? cat.value.items : [];
  const strong = items.filter((i) => i.strong), loose = items.filter((i) => !i.strong);
  const ytItems = ytr.status === "fulfilled" ? ytr.value.items : null;
  if (strong.length) { $("#srCat").hidden = false; $("#srCat").innerHTML = sec("On HackerTune", "From the curated catalog", strong.slice(0, 16)); }
  $("#srYt").innerHTML = ytItems == null ? `<div class="empty">YouTube search failed: ${esc(ytr.reason?.message || "error")}</div>`
    : ytItems.length ? `<div class="grid">${ytItems.map((it) => cardHTML(it)).join("")}</div>` : `<div class="empty">Nothing on YouTube for that.</div>`;
  if (!strong.length && (ytItems == null || !ytItems.length) && loose.length) {
    $("#srLoose").hidden = false; $("#srLoose").innerHTML = sec("Loosely related on HackerTune", "", loose.slice(0, 12));
  }
}

async function pageCats() {
  if (!state.areas) state.areas = await api("/api/areas").catch(() => []);
  document.title = `Topics - ${TITLE}`;
  main.innerHTML = `<div class="page"><h1>Topics</h1><p class="lead">HackerTube's topic tree. Pick an area and the feed narrows to it.</p>
    <div class="cats">${state.areas.map((a) => `<section class="panel"><h2><a href="/?area=${a.id}" data-link>${esc(a.name)}</a> <span class="small muted">${plural(a.count, "video")}</span></h2>
      <ul>${a.categories.map((c) => `<li>${esc(c.name)}</li>`).join("")}</ul></section>`).join("")}</div></div>`;
}

/* ---------- markdown-lite ---------- */
function md(s) {
  let h = esc(s);
  h = h.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`);
  h = h.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  h = h.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  h = h.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (_, t) => `<button class="ts" data-t="${t}">[${t}]</button>`);
  h = h.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const lines = h.split("\n"); let out = "", inList = false;
  for (const l of lines) {
    const m = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (m) { if (!inList) { out += "<ul>"; inList = true; } out += `<li>${m[1]}</li>`; continue; }
    if (inList) { out += "</ul>"; inList = false; }
    const hm = l.match(/^#{1,4}\s+(.*)/);
    if (hm) out += `<p><b>${hm[1]}</b></p>`; else if (l.trim()) out += `<p>${l}</p>`;
  }
  if (inList) out += "</ul>";
  return out;
}
const tsToSec = (t) => t.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);

/* ---------- chat component ---------- */
function chatBox({ kind, vid, title, intro, suggestions, onChange, messages }) {
  const el = document.createElement("section");
  el.className = "chat";
  el.innerHTML = `<div class="hd"><b>${esc(title)}</b><button class="btn small" data-new title="New conversation">New</button></div>
    <div class="msgs" aria-live="polite"></div>
    <div class="sugg">${(suggestions || []).map((s) => `<button type="button">${esc(s)}</button>`).join("")}</div>
    <form><textarea rows="1" placeholder="Ask or tell…" aria-label="Message"></textarea><button class="btn primary" type="submit">Send</button></form>`;
  const box = $(".msgs", el), ta = $("textarea", el), form = $("form", el);
  const add = (role, html, cls = "") => { const d = document.createElement("div"); d.className = `msg ${role} ${cls}`; d.innerHTML = html; box.appendChild(d); box.scrollTop = box.scrollHeight; return d; };
  const addChange = (ch) => { if (!ch || !ch.length) return; const d = document.createElement("div"); d.className = "change"; d.innerHTML = `<b>Algorithm updated:</b> ${ch.map(esc).join(" · ")} · <a href="/" data-link>see the feed</a>`; box.appendChild(d); box.scrollTop = box.scrollHeight; };
  const render = (msgs) => {
    box.innerHTML = "";
    if (!msgs.length && intro) add("assistant", md(intro));
    for (const m of msgs) { add(m.role, m.role === "user" ? esc(m.content) : md(m.content)); if (m.meta) addChange(m.meta.profile_changes); }
    $(".sugg", el).hidden = msgs.length > 0;
  };
  render(messages || []);
  let busy = false;
  const send = async (text) => {
    if (busy || !text.trim()) return;
    busy = true; $(".sugg", el).hidden = true;
    add("user", esc(text)); ta.value = ""; ta.style.height = "";
    const a = add("assistant", `<span class="typing">thinking…</span>`);
    let full = "";
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, vid, text }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!line.startsWith("data: ")) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.t === "status") a.innerHTML = `<span class="typing">${esc(ev.x)}</span>`;
          else if (ev.t === "delta") { full += ev.x; const vis = full.split("<profil>")[0]; a.innerHTML = md(vis) || `<span class="typing">writing…</span>`; box.scrollTop = box.scrollHeight; }
          else if (ev.t === "done") { a.innerHTML = md(ev.x); addChange(ev.changes); if (ev.changes && onChange) onChange(ev.changes); }
          else if (ev.t === "error") { a.innerHTML = `<span style="color:var(--bad)">${esc(ev.x)}</span>`; }
        }
      }
    } catch (e) { a.innerHTML = `<span style="color:var(--bad)">Connection error: ${esc(e.message)}</span>`; }
    busy = false;
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); send(ta.value); });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !isPhone()) { e.preventDefault(); send(ta.value); } });
  ta.addEventListener("input", () => { ta.style.height = ""; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; });
  $(".sugg", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) send(b.textContent); });
  $("[data-new]", el).addEventListener("click", async () => { await api("/api/chat/new", { method: "POST", body: { kind, vid } }); render([]); $(".sugg", el).hidden = false; });
  return el;
}

/* ---------- watch ---------- */
async function pageWatch(vid, tParam) {
  main.innerHTML = `<div class="watch"><div><div class="player skel"></div></div><div></div></div>`;
  const v = await api(`/api/video/${encodeURIComponent(vid)}`);
  document.title = `${v.title} - ${TITLE}`;
  const c = v.card || {}, ev = v.eval, ht = v.ht && v.ht.hn, st = v.state || {};
  const resumeAt = tParam != null ? tParam : (st.pos && (!st.dur || st.pos < st.dur - 20) && st.pos > 15 ? Math.floor(st.pos) : 0);
  const recs = v.mentions.filter((m) => m.stance === "rec" || m.stance === "strong_rec");
  const other = v.mentions.filter((m) => !(m.stance === "rec" || m.stance === "strong_rec"));
  const stanceEn = { strong_rec: "strongly recommends", rec: "recommends", reference: "reference", joke: "joke", critical: "critical" };
  const mention = (m) => `<div class="mention ${m.stance}"><div class="who">${esc(m.author)} · ${esc(m.month)} · ${stanceEn[m.stance] || m.stance} · <a href="https://news.ycombinator.com/item?id=${m.hn_comment_id}" target="_blank" rel="noopener">open on HN</a>${m.story_title ? ` · in “${esc(m.story_title)}”` : ""}</div>${esc(m.text).replace(/\[VIDEO\]/g, "<i>[this video]</i>").replace(/\[LINK\]/g, "<i>[link]</i>")}</div>`;
  const vinfo = { vid: v.vid, title: v.title, channel: v.channel, duration: v.duration };
  const queue = v.related.map((r) => ({ vid: r.vid, title: r.title, channel: r.channel, duration: r.duration }));
  const autoBg = ls.get("autoBg", true);
  const hybridOk = isPhone() && autoBg;  // on phones: sound from <audio>, picture from a muted iframe (sound keeps going when locked)
  main.innerHTML = `<div class="watch">
    <div class="wmain">
      <div class="player" id="player"><div id="ytp"></div>${hybridOk && !(P.cur && P.cur.vid === v.vid) ? `<button class="tapplay" id="tapPlay" style="background-image:url(${thumbUrl(v.vid)})" aria-label="Play"><span class="pc"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span><span class="pt">Keeps playing with the screen off</span></button>` : ""}<div class="audio-cover" id="cover" hidden style="background-image:url(${thumbUrl(v.vid)})"><div><b>Playing in the background</b><span class="small">You can turn the screen off; the sound keeps going.</span><br><br><button class="btn" id="toVideo">${I.video}Switch to video</button></div></div></div>
      <div class="wbody">
      <h1 class="wtitle">${esc(v.title)}</h1>
      <div class="wrow">
        <div class="wchan">${esc(v.channel || "")}<small>${[v.views ? fmtViews(v.views) : "", v.upload_date ? dateAgo(v.upload_date) : "", v.duration ? fmtDur(v.duration) : ""].filter(Boolean).join(" · ")}</small></div>
        <div class="actions">
          <button class="btn accent" id="bgBtn" title="Keeps playing with the screen off">${I.listen}<span>Listen in background</span></button>
          <button class="btn ${st.rating > 0 ? "on" : ""}" data-r="1" aria-label="Like">${I.up}<span class="lbl-long">Like</span></button>
          <button class="btn ${st.rating < 0 ? "on" : ""}" data-r="-1" aria-label="Show less like this">${I.down}<span class="lbl-long">Less</span></button>
          <button class="btn ${st.later ? "on" : ""}" data-later aria-label="Watch later">${I.later}<span class="lbl-long">Later</span></button>
          <a class="btn" href="https://www.youtube.com/watch?v=${v.vid}" target="_blank" rel="noopener" aria-label="Open on YouTube">${I.yt}<span class="lbl-long">YouTube</span></a>
        </div>
      </div>
      ${resumeAt ? `<p class="resume">Resuming where you left off: ${fmtDur(resumeAt)} · <button class="ts" data-t="0:00">start over</button></p>` : ""}
      <label class="toggle autobg" style="margin-top:10px"><input type="checkbox" id="autoBg" ${autoBg ? "checked" : ""}> Keep playing when the phone screen turns off</label>
      <div class="desc">
        <div class="dm">${[v.views ? fmtViews(v.views) : "", v.upload_date ? fmtDate(v.upload_date) : "", ht ? `recommended by ${ht.recommenders} ${ht.recommenders === 1 ? "person" : "people"} on HN` : "", v.source === "sub" && v.quality != null ? `agent score ${v.quality.toFixed(1)}/10` : ""].filter(Boolean).join(" · ")}</div>
        <p>${esc(c.summary || "No summary yet.")}</p>
        ${c.why ? `<p class="muted"><b>${v.source === "ht" ? "Why HN loves it:" : "Why watch:"}</b> ${esc(c.why)}</p>` : ""}
        <div>${c.content_type ? `<span class="tag">${esc(c.content_type)}</span>` : ""}${c.level ? `<span class="tag">${esc(c.level)}</span>` : ""}${(c.categories || []).map((x) => `<span class="tag">${esc(x.name)}</span>`).join("")}${(c.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>
      </div>
      <div id="chatMobile"></div>
      ${ev ? `<section class="panel"><h3>Agent review</h3>
        <div class="evalhead"><span class="score">${(v.quality ?? 0).toFixed(1)}<small>/10</small></span><div><b>${esc(ev.verdict || "")}</b></div></div>
        <p>${esc(ev.reasoning || "")}</p>
        ${ev.audience ? `<p class="small muted"><b>For:</b> ${esc(ev.audience)}</p>` : ""}
        ${ev.hn_signal ? `<p class="small muted"><b>HN signal:</b> ${esc(ev.hn_signal)}</p>` : ""}
        ${(ev.highlights || []).length ? `<ul class="hl">${ev.highlights.map((h) => `<li><button class="ts" data-t="${fmtTs(h.t)}">${fmtTs(h.t)}</button> ${esc(h.note)}</li>`).join("")}</ul>` : ""}
        <p class="small muted" style="margin-top:8px">${ev.agent ? `Claude Code agent <code>${esc(ev.agent)}</code>` : esc(ev.model || "")} · ${plural((ev.tools || []).length, "tool call")} (${esc([...new Set(ev.tools || [])].join(", "))})${ev.seconds ? ` · ${ev.seconds}s` : ""}</p>
      </section>` : ""}
      ${ht ? `<section class="panel"><h3>On Hacker News</h3>
        <p class="small muted">${plural(ht.recommenders, "recommender")} · across ${plural(ht.rec_months, "month")} · ${ht.strong_recs} strong · ${ht.first_year}–${ht.last_year}</p>
        ${v.ht.quote ? `<p style="font-size:16px"><i>“${esc(v.ht.quote.text)}”</i></p>` : ""}
        ${recs.slice(0, 5).map(mention).join("")}
        ${recs.length > 5 || other.length ? `<details><summary>All comments (${v.mentions.length})</summary>${recs.slice(5).concat(other).map(mention).join("")}</details>` : ""}
      </section>` : ""}
      </div>
    </div>
    <aside class="wside"><div id="chatDesk"></div>
      <div class="row" style="justify-content:space-between"><div class="sectitle">Up next</div><label class="toggle"><input type="checkbox" id="autonext" ${ls.get("autonext", true) ? "checked" : ""}> Autoplay</label></div>
      <div id="rels">${v.related.map((r) => `<a class="rel" href="/v/${r.vid}" data-link><span class="thumb">${thumb(r.vid)}${r.duration ? `<span class="dur">${fmtDur(r.duration)}</span>` : ""}</span><span><span class="t">${esc(r.title)}</span><span class="m">${esc(r.channel || "")}</span><span class="m">${esc(metaLine(r))}</span></span></a>`).join("")}</div>
    </aside>
  </div>`;
  const cb = chatBox({
    kind: "video", vid: v.vid, title: "Talk about this video", messages: v.chat,
    intro: "Ask anything about the video: a summary, whether a claim holds up, an explanation of a part, what to watch next. I read the transcript and the HN comments. Say “more videos like this” and I'll update your algorithm too.",
    suggestions: ["Summarize this in 5 bullets", "Strongest and weakest argument?", "Is it worth watching? Which parts?", "Show me more like this"],
  });
  const mq = matchMedia("(max-width: 1000px)");
  const place = () => { const tgt = mq.matches ? $("#chatMobile") : $("#chatDesk"); if (tgt && cb.parentElement !== tgt) tgt.appendChild(cb); };
  place(); mq.addEventListener("change", place);

  /* --- player: YouTube iframe (video) ⇄ <audio> (background) --- */
  let ytp = null, vSession = Math.random().toString(36).slice(2), vPlayed = 0, vLast = null, vTimer = null, vLastSent = Date.now(), vSentPos = resumeAt || 0;
  const sameAudio = () => P.cur && P.cur.vid === v.vid;
  let hybrid = hybridOk && sameAudio() && !P.a.paused, ourSeek = 0, syncT = null, ytPauseAt = 0;
  const showCover = () => { $("#cover").hidden = !sameAudio() || hybrid; };
  const vAccount = () => { if (hybrid) return; if (!ytp || !ytp.getCurrentTime) return; const t = ytp.getCurrentTime(); if (vLast != null && ytp.getPlayerState() === 1) { const d = t - vLast; if (d > 0 && d < 5) vPlayed += d; } vLast = t; };
  const vFlush = (beacon = false) => {
    if (!ytp || !ytp.getCurrentTime || hybrid) return;
    vAccount(); const pos = ytp.getCurrentTime();
    if (vPlayed < 0.5 && Math.abs(pos - vSentPos) < 1) return;  // if the video didn't play (e.g. audio was playing), don't overwrite the position
    vSentPos = pos;
    sendProgress(v.vid, JSON.stringify({ pos, dur: ytp.getDuration() || v.duration, delta: Math.round(vPlayed * 10) / 10, mode: "video", session: vSession }), beacon);
    vPlayed = 0; vLastSent = Date.now();
  };
  const toAudio = (auto = false) => {
    let t = resumeAt;
    try { if (ytp && ytp.getCurrentTime) { t = ytp.getCurrentTime() || t; vFlush(); ytp.pauseVideo(); } } catch (e) {}
    const pr = P.play(vinfo, t, queue, auto);
    showCover();
    return pr;
  };
  const toVideo = () => {
    const t = P.a.currentTime || 0; P.stop(); showCover();
    if (ytp && ytp.seekTo) { ytp.seekTo(t, true); ytp.playVideo(); }
  };
  /* phone hybrid mode: sound starts in <audio> from the user's tap (what iOS requires), the iframe is muted and synced.
     When the screen locks iOS stops the iframe but the sound is already playing; on wake the picture catches up. */
  const ytSeek = (t) => { ourSeek = Date.now(); ytp.seekTo(t, true); };
  const startHybrid = () => {
    hybrid = true; const tp = $("#tapPlay"); if (tp) tp.remove();
    const pr = sameAudio() ? (P.a.paused ? P.a.play() : null) : P.play(vinfo, resumeAt, queue);
    if (pr) pr.catch(() => {});
    if (ytp && ytp.mute) { ytp.mute(); ytSeek(resumeAt || P.a.currentTime || 0); ytp.playVideo(); }
    showCover(); sync();
  };
  const sync = () => {
    clearTimeout(syncT); syncT = setTimeout(sync, 700);
    if (!hybrid || !ytp || !ytp.getPlayerState || document.visibilityState !== "visible") return;
    if (!P.cur) { hybrid = false; ytp.pauseVideo(); showCover(); return; }               // mini player was closed
    if (!sameAudio()) { go(`/v/${P.cur.vid}`); return; }                                  // audio moved on to the next video
    if (!ytp.isMuted()) ytp.mute();
    const st = ytp.getPlayerState(), at = P.a.currentTime, yt = ytp.getCurrentTime();
    if (P.a.paused) { if (st === 1) ytp.pauseVideo(); return; }
    if (st === 2 && Date.now() - ytPauseAt < 1500) return;                               // the user may be pausing
    if (st !== 1 && st !== 3) { ytSeek(at); ytp.playVideo(); return; }
    if (st === 1) {
      const d = yt - at;
      if (Math.abs(d) > 2.5 && Date.now() - ourSeek > 4000) { P.seek(yt); ourSeek = Date.now(); return; }  // the user seeked in the video
      if (Math.abs(d) > 0.6 && Date.now() - ourSeek > 1500) ytSeek(at + 0.2);
      if (ytp.getPlaybackRate() !== P.a.playbackRate) ytp.setPlaybackRate(P.a.playbackRate);
    }
  };
  const onWake = () => { if (document.visibilityState === "visible" && hybrid) { ourSeek = 0; sync(); } };
  document.addEventListener("visibilitychange", onWake);
  if ($("#tapPlay")) $("#tapPlay").onclick = startHybrid;
  $("#bgBtn").onclick = () => { if (hybrid) { toast("Already playing as audio; you can turn the screen off"); return; } if (sameAudio()) { toast("Already playing in the background"); return; } toAudio(false); toast("Playing in the background. You can turn the screen off"); };
  $("#toVideo").onclick = toVideo;
  $("#autoBg").onchange = (e) => ls.set("autoBg", e.target.checked);
  $("#autonext").onchange = (e) => ls.set("autonext", e.target.checked);
  document.addEventListener("audiochange", showCover);
  showCover();
  const onVis = () => {  // when the phone locks or the app switches the video stops; switch to audio at that moment
    if (document.visibilityState !== "hidden" || !ls.get("autoBg", true) || !isPhone() || !ytp || !ytp.getPlayerState) return;
    if (ytp.getPlayerState() === 1 && !sameAudio()) { const pr = toAudio(true); if (pr) pr.catch(() => {}); }
  };
  document.addEventListener("visibilitychange", onVis);
  loadYT().then((YT) => {
    if (!$("#ytp")) return;
    ytp = new YT.Player("ytp", {
      host: "https://www.youtube-nocookie.com", videoId: v.vid,
      playerVars: { start: resumeAt || 0, rel: 0, playsinline: 1, modestbranding: 1, autoplay: sameAudio() || hybridOk ? 0 : 1 },
      events: {
        onReady: () => { if (hybrid) { ytp.mute(); ytSeek(P.a.currentTime || resumeAt || 0); ytp.playVideo(); sync(); } },
        onStateChange: (e) => {
          if (hybrid) {
            if (e.data === 2) ytPauseAt = Date.now();
            if (e.data === 2) setTimeout(() => {  // if the user paused the video, pause the audio too (wait to tell it apart from a lock-screen pause)
              if (hybrid && document.visibilityState === "visible" && ytp.getPlayerState() === 2 && !P.a.paused && Date.now() - ourSeek > 1500) P.a.pause();
            }, 700);
            if (e.data === 1 && P.a.paused && document.visibilityState === "visible") P.a.play().catch(() => {});
            return;
          }
          if (e.data === 1) { vLast = ytp.getCurrentTime(); if (sameAudio() && !P.a.paused) P.a.pause(); clearInterval(vTimer); vTimer = setInterval(() => { vAccount(); if (Date.now() - vLastSent > 15000) vFlush(); }, 1000); }
          else { clearInterval(vTimer); if (e.data === 2 || e.data === 0) vFlush(); }
          if (e.data === 0 && ls.get("autonext", true) && queue[0]) go(`/v/${queue[0].vid}`);
        },
      },
    });
  });
  main.addEventListener("click", seekHandler);
  function seekHandler(e) {
    const b = e.target.closest(".ts"); if (!b) return;
    const t = tsToSec(b.dataset.t);
    if (sameAudio()) { P.seek(t); if (P.a.paused) P.a.play(); return; }
    if (ytp && ytp.seekTo) { ytp.seekTo(t, true); ytp.playVideo(); $("#player").scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
  $$(".actions [data-r]").forEach((b) => b.addEventListener("click", async () => {
    const r = Number(b.dataset.r), on = !b.classList.contains("on");
    await api(`/api/video/${v.vid}/state`, { method: "POST", body: { rating: on ? r : 0 } });
    $$(".actions [data-r]").forEach((x) => x.classList.remove("on")); if (on) b.classList.add("on");
    toast(on ? (r > 0 ? "Liked. You'll see more like this" : "OK. You'll see less like this") : "Undone");
  }));
  $(".actions [data-later]").addEventListener("click", async (e) => {
    const b = e.currentTarget, on = !b.classList.contains("on");
    await api(`/api/video/${v.vid}/state`, { method: "POST", body: { later: on } }); b.classList.toggle("on", on);
    toast(on ? "Saved to Watch later" : "Removed from Watch later");
  });
  cleanup = () => {
    vFlush(); clearInterval(vTimer); clearTimeout(syncT); hybrid = false;
    document.removeEventListener("visibilitychange", onWake);
    document.removeEventListener("visibilitychange", onVis); document.removeEventListener("audiochange", showCover);
    mq.removeEventListener("change", place); main.removeEventListener("click", seekHandler);
    try { if (ytp && ytp.destroy) ytp.destroy(); } catch (e) {}
  };
  window.__ytp = () => ytp;  // for tests
  window.__hybrid = () => hybrid;
}

/* ---------- history ---------- */
async function pageHistory() {
  document.title = `History - ${TITLE}`;
  main.innerHTML = `<div class="hist"><h1>History</h1><p class="lead">Everything you watched or listened to, with the spot where you stopped. Open one to pick up from there. Watched videos also drop out of your feed.</p><div id="hl"></div></div>`;
  const d = await api("/api/list/history");
  if (!d.items.length) { $("#hl").innerHTML = `<div class="empty">Nothing watched yet.</div>`; return; }
  const dayKey = (ts) => { const dt = new Date(ts * 1000), now = new Date(); const diff = Math.floor((new Date(now.toDateString()) - new Date(dt.toDateString())) / 86400000); return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : dt.toLocaleDateString("en-US", { weekday: diff < 7 ? "long" : undefined, day: "numeric", month: "long", year: dt.getFullYear() === now.getFullYear() ? undefined : "numeric" }); };
  let html = "", last = null;
  for (const it of d.items) {
    const k = dayKey(it.seen_at || 0);
    if (k !== last) { html += `<div class="hday">${esc(k)}</div>`; last = k; }
    const dur = it.dur || it.duration;
    const prog = it.pos && dur ? `<span class="prog"><i style="width:${Math.min(100, (100 * it.pos) / dur)}%"></i></span>` : "";
    html += `<div class="hrow" data-vid="${it.vid}" data-title="${esc(it.title)}" data-channel="${esc(it.channel || "")}" data-dur="${dur || ""}" data-pos="${Math.floor(it.pos || 0)}" data-later="${it.later ? 1 : 0}">
      <a class="thumb" href="/v/${it.vid}" data-link>${thumb(it.vid)}${dur ? `<span class="dur">${fmtDur(dur)}</span>` : ""}${prog}</a>
      <div><a class="t" href="/v/${it.vid}" data-link>${esc(it.title)}</a>
        <div class="m">${esc(it.channel || "")}</div>
        <div class="m">${dur && it.pos >= dur - 20 ? "Finished" : it.pos ? `Stopped at ${fmtDur(it.pos)}${dur ? " / " + fmtDur(dur) : ""}` : "Opened"}${it.watch_s ? ` · watched ${Math.max(1, Math.round(it.watch_s / 60))} min` : ""} · ${ago(it.seen_at)}</div></div>
      <button class="ib" data-menu aria-label="Options">${I.dots}</button></div>`;
  }
  $("#hl").innerHTML = html;
  bindCards($("#hl"));
}

/* ---------- subscriptions ---------- */
const BOOKMARKLET = `(()=>{const s=new Set();const add=h=>{if(!h)return;const m=h.match(/\\/(@[^/?#]+|channel\\/UC[\\w-]{22})/);if(m)s.add('https://www.youtube.com/'+m[1])};document.querySelectorAll('ytd-channel-renderer a, ytd-grid-channel-renderer a').forEach(a=>add(a.getAttribute('href')));if(!s.size)document.querySelectorAll('ytd-guide-entry-renderer a').forEach(a=>add(a.getAttribute('href')));const t=[...s].join('\\n');if(!s.size){alert('No channels found. On youtube.com/feed/channels, scroll all the way down and try again.');return}const w=window.open('${location.origin}/subscriptions#ice='+encodeURIComponent(t),'_blank');if(!w){navigator.clipboard.writeText(t).then(()=>alert(s.size+' channels copied to the clipboard; paste them into HackerTune.'),()=>prompt('Copy:',t))}})()`;

function agentsHTML(p) {
  if (!p.agents || !p.agents.length) return "";
  const kindEn = { deep: "deep review", triage: "screening", fit: "personal fit", curate: "showcase curation" };
  return `<h3 style="margin-top:16px">Review agents (Claude Code, bp)</h3>${p.agents.map((a) => `<div class="agent"><b>${esc(a.name)}</b><span class="st ${a.job ? "working" : a.state === "closed" ? "closed" : "idle"}">${a.job ? "working" : a.state === "closed" ? "closed" : "idle"}</span>
    <span class="d">${a.kinds.map((k) => kindEn[k] || k).join(" + ")} · ${plural(a.done_24h, "job")} in the last 24h${a.job ? ` · now: job #${a.job.id} (${kindEn[a.job.kind] || a.job.kind}${a.job.vid ? `, <a href="/v/${a.job.vid}" data-link>${a.job.vid}</a>` : ""}), started ${ago(a.job.since)}` : ""}${a.last_poll ? ` · last checked the queue ${ago(a.last_poll)}` : ""}</span></div>`).join("")}`;
}

async function pageSubs() {
  document.title = `Subscriptions - ${TITLE}`;
  main.innerHTML = `<div class="page"><h1>Subscriptions</h1><p class="lead">No YouTube login needed: give us your channel list and background Claude Code agents scan new uploads, watch and score them; those above the bar (≥ 6/10) join your feed. The list isn't public; it's tied to this browser (and your sync link).</p>
  <div class="two">
    <section class="panel"><h2>Import</h2>
      <textarea class="big" id="imp" placeholder="One channel per line: https://www.youtube.com/@3blue1brown, @veritasium, a UC… id. Or paste a Takeout subscriptions.csv / OPML file"></textarea>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="impGo">Import</button>
        <label class="btn" for="impFile">Choose file (CSV/OPML)</label><input id="impFile" type="file" accept=".csv,.opml,.xml,.txt" hidden>
        <span class="small muted" id="impMsg"></span></div>
      <div id="impProg"></div>
      <details><summary>How do I get my list out of YouTube?</summary>
        <ol class="steps small">
          <li><b>Easiest (desktop):</b> drag this button to your bookmarks bar: <a class="bm" id="bm" href="#">Send to HackerTune</a>. Then open <a href="https://www.youtube.com/feed/channels" target="_blank" rel="noopener">youtube.com/feed/channels</a>, scroll to the bottom and click the bookmark; the list comes here.</li>
          <li><b>Google Takeout:</b> takeout.google.com → only “YouTube and YouTube Music” → “subscriptions” → pick the downloaded <code>subscriptions.csv</code> above.</li>
          <li><b>By hand:</b> paste channel links or @handles.</li>
        </ol></details>
    </section>
    <section class="panel"><h2>Review pipeline</h2><div id="pipe">…</div></section>
  </div>
  <section class="panel"><h2>Latest from your subscriptions</h2><p class="small muted">Each video is screened first (a Haiku agent, in batches); the rest are scored by Opus agents that read the transcript, search Hacker News and compare it with similar HackerTube videos.</p><div id="recent"></div></section>
  <section class="panel"><h2>Your channels <span class="muted small" id="chCount"></span></h2><div class="tablewrap" id="chans"></div></section></div>`;
  $("#bm").href = "javascript:" + encodeURIComponent(BOOKMARKLET);
  $("#bm").addEventListener("click", (e) => { e.preventDefault(); toast("Drag this to your bookmarks bar, then click it on YouTube"); });
  const m = location.hash.match(/^#ice=(.*)$/s);
  if (m) { $("#imp").value = decodeURIComponent(m[1]); history.replaceState({}, "", "/subscriptions"); toast("List received. Press “Import”"); }
  let filename = "";
  $("#impFile").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; filename = f.name; $("#imp").value = await f.text(); $("#impMsg").textContent = f.name; });
  $("#impGo").addEventListener("click", async () => {
    try {
      const d = await api("/api/import", { method: "POST", body: { text: $("#imp").value, filename } });
      $("#impMsg").textContent = `${plural(d.total, "channel")} queued`; $("#imp").value = ""; refresh();
    } catch (e) { $("#impMsg").textContent = e.message; }
  });
  let timer;
  const refresh = async () => {
    const d = await api("/api/subs");
    if (!$("#pipe")) return;
    const p = d.pipeline, s = p.status;
    const imp = d.imports.find((i) => i.status !== "done") || d.imports[0];
    $("#impProg").innerHTML = imp ? `<div style="margin-top:12px"><div class="small">Import #${imp.id}: ${imp.done}/${imp.total} ${imp.status === "done" ? "done" : "processing…"}</div><div class="bar"><i style="width:${imp.total ? (100 * imp.done) / imp.total : 0}%"></i></div>
      <details><summary>Details</summary><ul class="log">${imp.log.slice(-40).reverse().map((l) => `<li>${l.ok ? "✓" : "✕"} ${esc(l.name || l.ref)}${l.ok ? (l.new ? `: ${plural(l.new, "new video")}` : "") : `: <span style="color:var(--bad)">${esc(l.error)}</span>`}</li>`).join("")}</ul></details></div>` : "";
    $("#pipe").innerHTML = `<div class="stats">
        <div class="stat"><b>${(s.new || 0) + (s.triaging || 0) + (s.triage_pass || 0) + (s.evaluating || 0)}</b><span>in the queue</span></div>
        <div class="stat"><b>${s.evaluated || 0}</b><span>reviewed by agents</span></div>
        <div class="stat"><b>${s.triage_skip || 0}</b><span>filtered at screening</span></div>
        <div class="stat"><b>${p.deep_today}/${p.deep_cap}</b><span>deep reviews today</span></div></div>
      ${agentsHTML(p)}
      <div class="small" style="margin-top:12px">Chat budget (whole site): $${p.chat_usd} / $${p.chat_cap}<div class="bar"><i style="width:${Math.min(100, (100 * p.chat_usd) / p.chat_cap)}%"></i></div></div>
      <p class="small ${p.worker_alive ? "muted" : ""}" style="margin:10px 0 4px;${p.worker_alive ? "" : "color:var(--bad)"}">${p.worker_alive ? "● Worker running" : "● Worker not responding"}</p>
      <details><summary>Pipeline log (whole site)</summary>${p.events.map((e) => `<div class="ev">${ago(e.ts)} · <b>${esc(e.stage)}</b> · ${e.vid ? `<a href="/v/${e.vid}" data-link>${e.vid}</a> · ` : ""}${esc(e.msg)}</div>`).join("")}</details>`;
    $("#recent").innerHTML = d.recent.length ? d.recent.slice(0, 60).map((r) => {
      const low = r.status === "evaluated" && r.quality < p.threshold;
      const lab = r.status === "evaluated" ? (low ? `${r.quality.toFixed(1)} · below the bar` : `${r.quality.toFixed(1)} · in your feed`) : STATUS[r.status] || r.status;
      return `<a class="evrow" href="/v/${r.vid}" data-link><span class="thumb">${thumb(r.vid)}</span><span><span class="t">${esc(r.title)}</span>
        <span class="d" style="display:block"><span class="st ${low ? "low" : r.status}">${esc(lab)}</span> ${esc(r.channel)}${r.duration ? ` · ${fmtDur(r.duration)}` : ""}</span>
        <span class="d" style="display:block">${r.verdict ? esc(r.verdict) : r.triage ? `Screening: ${esc(r.triage)}` : ""}${r.fit != null && r.fit >= 0 ? ` · <b>fit for you ${r.fit.toFixed(0)}/10</b>${r.fit_reason ? `: ${esc(r.fit_reason)}` : ""}` : ""}</span></span></a>`;
    }).join("") : `<div class="empty">No subscriptions yet. Import them above.</div>`;
    $("#chCount").textContent = d.channels.length ? `(${d.channels.length})` : "";
    $("#chans").innerHTML = d.channels.length ? `<table><thead><tr><th>Channel</th><th>Videos</th><th>Reviewed</th><th>In feed</th><th>Avg.</th><th>HackerTube</th><th></th></tr></thead><tbody>${d.channels.map((c) => `<tr>
      <td><a href="https://www.youtube.com/channel/${c.channel_id}" target="_blank" rel="noopener">${esc(c.name || c.channel_id)}</a>${c.fetch_error ? ` <span class="st failed" title="${esc(c.fetch_error)}">error</span>` : ""}</td>
      <td>${c.n_videos}${c.n_queue ? ` <span class="muted">(${c.n_queue} queued)</span>` : ""}</td><td>${c.n_eval}</td><td>${c.n_pass}</td><td>${c.avg_q ?? "–"}</td><td>${c.ht_count || "–"}</td>
      <td><button class="btn small" data-unsub="${c.channel_id}" title="Unsubscribe">✕</button></td></tr>`).join("")}</tbody></table>` : `<p class="muted small">No channels yet.</p>`;
    const busy = s.evaluating || s.new || s.triaging || (imp && imp.status !== "done") || (p.agents || []).some((a) => a.job);
    timer = setTimeout(refresh, busy ? 4000 : 15000);
  };
  main.addEventListener("click", unsubHandler);
  await refresh();
  cleanup = () => { clearTimeout(timer); main.removeEventListener("click", unsubHandler); };
}
async function unsubHandler(e) {
  const b = e.target.closest("[data-unsub]"); if (!b) return;
  if (!confirm("Remove this channel from your subscriptions?")) return;
  await api(`/api/subs/${b.dataset.unsub}`, { method: "DELETE" }); b.closest("tr").remove(); toast("Removed");
}

/* ---------- algorithm ---------- */
async function pageAlgo() {
  document.title = `Algorithm - ${TITLE}`;
  const [p, me] = await Promise.all([api("/api/profile"), api("/api/me")]);
  main.innerHTML = `<div class="page"><h1>Algorithm</h1><p class="lead">What your feed is ranked by, in the open. Edit it by hand or just talk to it: “less politics, more hardware”, “why am I seeing this video?”, “I want shorter videos”.</p>
  <div class="two"><section class="panel" id="prof"></section><div id="steer"></div></div></div>`;
  const prof = $("#prof");
  const draw = (p) => {
    const mix = p.prefs.mix || {};
    prof.innerHTML = `<h2>Your profile</h2>
      <label class="small muted" for="about">Describe yourself and what you're looking for (recommendations are matched against this text too)</label>
      <textarea class="big" id="about" style="min-height:80px;margin-top:6px">${esc(p.about)}</textarea>
      <h3 style="margin-top:16px">More of</h3><div class="pill-list" id="more">${p.more.map((t) => `<span class="pill">${esc(t)}<button data-del="more" data-t="${esc(t)}" aria-label="remove">×</button></span>`).join("") || `<span class="small muted">nothing yet</span>`}</div>
      <div class="addrow"><input id="moreIn" placeholder="e.g. rust systems programming"><button class="btn" data-add="more">Add</button></div>
      <h3 style="margin-top:16px">Less of</h3><div class="pill-list" id="less">${p.less.map((t) => `<span class="pill less">${esc(t)}<button data-del="less" data-t="${esc(t)}" aria-label="remove">×</button></span>`).join("") || `<span class="small muted">nothing yet</span>`}</div>
      <div class="addrow"><input id="lessIn" placeholder="e.g. celebrity drama"><button class="btn" data-add="less">Add</button></div>
      <h3 style="margin-top:18px">Preferences</h3>
      <div class="field"><label for="maxm">Longest video (min)</label><input id="maxm" type="number" min="5" max="600" placeholder="no limit" value="${p.prefs.max_minutes || ""}"></div>
      <div class="field"><label for="hn">Hide news videos</label><select id="hn"><option value="1" ${p.prefs.hide_news ? "selected" : ""}>Yes</option><option value="0" ${!p.prefs.hide_news ? "selected" : ""}>No</option></select></div>
      <h3 style="margin-top:18px">Pool mix</h3>
      ${Object.entries(p.pools).map(([k, n]) => `<div class="mix"><label for="mx_${k}">${esc(n)}</label><input type="range" id="mx_${k}" data-mix="${k}" min="0" max="3" step="0.25" value="${mix[k] ?? 1}"><span>${(mix[k] ?? 1).toFixed(2).replace(/\.?0+$/, "")}×</span></div>`).join("")}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="save">Save</button><a class="btn" href="/" data-link>See the feed</a></div>
      ${p.changelog.length ? `<h3 style="margin-top:20px">Change log</h3><ul class="log">${p.changelog.map((c) => `<li><span class="muted">${ago(c.at)} · ${esc(c.source)}:</span> ${c.changes.map(esc).join(" · ")}</li>`).join("")}</ul>` : ""}
      <h3 style="margin-top:20px">Sync link</h3><p class="small muted">There are no accounts. This link moves your profile, subscriptions and history to another device. Don't share it.</p><div class="copy">${esc(me.sync_url)}</div>`;
  };
  let cur = p;
  draw(cur);
  const collect = () => {
    const mix = {}; $$("[data-mix]", prof).forEach((i) => { if (Number(i.value) !== 1) mix[i.dataset.mix] = Number(i.value); });
    return { about: $("#about").value, more: cur.more, less: cur.less, prefs: { hide_news: $("#hn").value === "1", max_minutes: Number($("#maxm").value) || null, mix } };
  };
  const save = async (body) => {
    const r = await api("/api/profile", { method: "PUT", body });
    toast(r.changes.length ? "Saved: " + r.changes.join(" · ") : "No changes");
    cur = await api("/api/profile"); draw(cur);
  };
  prof.addEventListener("input", (e) => { if (e.target.dataset.mix) e.target.nextElementSibling.textContent = Number(e.target.value) + "×"; });
  prof.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.id === "save") return save(collect());
    if (t.dataset.del) { const b = collect(); b[t.dataset.del] = b[t.dataset.del].filter((x) => x !== t.dataset.t); return save(b); }
    if (t.dataset.add) { const inp = $(`#${t.dataset.add}In`); const v = inp.value.trim(); if (!v) return; const b = collect(); b[t.dataset.add] = [...b[t.dataset.add], v]; return save(b); }
  });
  prof.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.target.id === "moreIn" || e.target.id === "lessIn")) { e.preventDefault(); $(`[data-add="${e.target.id.slice(0, 4)}"]`, prof).click(); } });
  const hist = await api("/api/chat?kind=steer");
  $("#steer").appendChild(chatBox({
    kind: "steer", title: "Talk to your algorithm", messages: hist.messages,
    intro: "Hi! I rank your feed. Tell me what you want more or less of, or ask why something is in your feed. I write what you say into your profile; you'll see it in the profile box.",
    suggestions: ["What is my feed ranked by right now?", "More deep technical talks, less comedy", "Show more from my subscriptions", "Nothing longer than 20 minutes"],
    onChange: async () => { cur = await api("/api/profile"); draw(cur); },
  }));
}

/* ---------- lists ---------- */
async function pageList(tab) {
  const tabs = { later: "Watch later", liked: "Liked", hidden: "Hidden" };
  if (!tabs[tab]) tab = "later";
  document.title = `${tabs[tab]} - ${TITLE}`;
  main.innerHTML = `<h1>${tabs[tab]}</h1><div class="tabs" style="margin-top:12px">${Object.entries(tabs).map(([k, n]) => `<a class="chip ${k === tab ? "on" : ""}" href="/library?t=${k}" data-link>${n}</a>`).join("")}<a class="chip" href="/history" data-link>History</a></div><div class="grid" id="grid"></div>`;
  const d = await api(`/api/list/${tab}`);
  $("#grid").innerHTML = d.items.map((it) => cardHTML(it)).join("") || `<div class="empty">Nothing here yet.</div>`;
  bindCards($("#grid"));
}

/* ---------- about ---------- */
async function pageAbout() {
  document.title = `About - ${TITLE}`;
  const me = await api("/api/me");
  main.innerHTML = `<div class="page prose" style="max-width:780px">
  <h1>What is this?</h1>
  <p>A fork of <a href="https://hackertube.org" target="_blank" rel="noopener">HackerTube</a>. HackerTube collects the YouTube videos linked in Hacker News comments since 2007 that <b>at least 3 people recommended in at least 3 different months</b> (score = months recommended + half the strong recommendations). The feed here starts from those 6,454 videos and adds:</p>
  <section class="panel"><h3>1 · Your subscriptions, vetted by agents</h3>
  <p>You hand over your channel list (no YouTube login). Reviews are done by always-on <b>Claude Code agents</b> started with <code>bp</code> on the server; each pulls its own jobs from a queue:</p>
  <ol class="steps"><li><b>Scan:</b> each channel's “Videos” tab is read regularly; Shorts and videos under 2.5 minutes are skipped.</li>
  <li><b>Screening</b> (<code>youtube-triage</code>, Haiku 5.5): looks at title, channel, length, views and the channel's HackerTube history to decide whether a deep review is worth it.</li>
  <li><b>Deep review</b> (<code>youtube-eval-1</code>, <code>youtube-eval-2</code>, Opus 5.5): reads the metadata and transcript, searches Hacker News, compares with the most similar HackerTube videos and the channel's history; writes a HackerTube-style card, a 0–10 score, reasoning and highlights.</li>
  <li><b>Personal fit</b> (<code>youtube-triage</code>): videos above the bar (6/10) are scored again against your profile.</li></ol>
  <p class="small muted">The agents' shell is locked by a hook to the <code>ytctl</code> tool only: no files, no web, no other commands. Instructions inside a transcript can't steer them.</p></section>
  <section class="panel"><h3>2 · Showcase</h3><p>A curator agent (<code>youtube-curator</code>) builds your <a href="/showcase" data-link>Showcase</a>: shelves of picks and series based on what you watch, like and tell the algorithm, plus wildcards from topics you'd never have searched for but probably won't be able to stop watching.</p></section>
  <section class="panel"><h3>3 · Listening with the screen off</h3><p>On a phone, when you play a video the sound comes from an audio player streamed through this server while the picture plays muted and in sync. Lock the phone and the sound keeps going; unlock and the picture catches up (setting: “Keep playing when the phone screen turns off”). You can also pick <b>Listen in background</b> on a video or from a card's ⋯ menu. Lock-screen controls work, and the next related video plays when one ends.</p></section>
  <section class="panel"><h3>4 · Watch history</h3><p>Everything you watch or listen to is saved to <a href="/history" data-link>History</a> with the second you stopped at; open it again to continue. Anything watched for more than 30 seconds leaves the feed.</p></section>
  <section class="panel"><h3>5 · Video chat and an algorithm you steer by talking</h3><p>The watch page has a chat that reads the video's transcript, card and HN comments; click a timestamp to jump there. On the <a href="/algorithm" data-link>Algorithm</a> page your profile is out in the open; talking to it updates the profile.</p></section>
  <h2 style="margin-top:24px">Account and privacy</h2>
  <p>There are no accounts. Your browser gets a random identity cookie; your likes, subscriptions, history, profile and chats live on the server under that identity. To move to another device, open your sync link (don't share it):</p>
  <div class="copy">${esc(me.sync_url)}</div>
  <p class="small muted" style="margin-top:10px">The video player is embedded via youtube-nocookie.com. Background audio is streamed from YouTube through this server and not stored. Chat messages are sent to Anthropic's Claude model to produce replies.</p>
  <h2 style="margin-top:24px">Credits</h2>
  <p class="small">Data: <a href="https://hackertube.org" target="_blank" rel="noopener">HackerTube</a> (ODC-By 1.0) and <a href="https://huggingface.co/datasets/open-index/hacker-news" target="_blank" rel="noopener">open-index/hacker-news</a>. The layout is inspired by HackerTube; the code is this site's own (<a href="https://github.com/tunapro1234/hackertune" target="_blank" rel="noopener">source</a>). Hacker News data belongs to Y Combinator; comments belong to their authors. Video titles and channel names belong to their owners. This site is not affiliated with YouTube, Google, Hacker News or Y Combinator.</p>
  </div>`;
}

route();
