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
const fmtDate = (d) => d ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : "";
const ago = (ts) => { const s = Date.now() / 1000 - ts; if (s < 60) return "az önce"; if (s < 3600) return `${Math.floor(s / 60)} dk önce`; if (s < 86400) return `${Math.floor(s / 3600)} sa önce`; if (s < 30 * 86400) return `${Math.floor(s / 86400)} gün önce`; if (s < 365 * 86400) return `${Math.floor(s / (30 * 86400))} ay önce`; return `${Math.floor(s / (365 * 86400))} yıl önce`; };
const dateAgo = (d) => d ? ago(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 1000) : "";
const fmtViews = (n) => { if (n == null) return ""; const f = (x) => x.toLocaleString("tr-TR", { maximumFractionDigits: x < 10 ? 1 : 0 }); if (n >= 1e9) return `${f(n / 1e9)} Mr görüntüleme`; if (n >= 1e6) return `${f(n / 1e6)} Mn görüntüleme`; if (n >= 1e3) return `${f(n / 1e3)} B görüntüleme`; return `${n} görüntüleme`; };
const thumbUrl = (vid) => `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
const thumb = (vid) => `<img loading="lazy" alt="" src="https://i.ytimg.com/vi/${vid}/hq2.jpg" onerror="this.onerror=null;this.src='${thumbUrl(vid)}'">`;
const STATUS = { new: "sırada", triaging: "ön elemede", triage_pass: "derin incelemede sırada", triage_skip: "elendi (ön eleme)", evaluating: "agent inceliyor…", evaluated: "değerlendirildi", failed: "başarısız", unavailable: "erişilemiyor" };
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
};

/* ---------- menü, tema ---------- */
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

/* ---------- yönlendirici ---------- */
function go(path, replace = false) {
  if (replace) history.replaceState({}, "", path); else history.pushState({}, "", path);
  route();
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.origin === location.origin) { e.preventDefault(); setMenu(false); go(a.getAttribute("href")); }
});
window.addEventListener("popstate", route);
$("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#q").value.trim(); if (q) { $("#q").blur(); go(`/ara?q=${encodeURIComponent(q)}`); } });

let cleanup = null;
async function route() {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  closePop();
  const p = location.pathname, qs = new URLSearchParams(location.search);
  const nav = p === "/" ? "home" : p.startsWith("/abonelikler") ? "subs" : p.startsWith("/algoritma") ? "algo" : p === "/liste" ? (qs.get("t") === "liked" ? "liked" : qs.get("t") === "later" ? "later" : "") : p.startsWith("/gecmis") ? "history" : p.startsWith("/kategoriler") ? "cats" : p.startsWith("/hakkinda") ? "about" : "";
  $$("#side a").forEach((a) => a.classList.toggle("on", a.dataset.nav === nav));
  document.body.classList.toggle("watching", p.startsWith("/v/"));
  document.title = TITLE;
  window.scrollTo(0, 0);
  try {
    if (p === "/") await pageFeed(qs.get("area"));
    else if (p.startsWith("/v/")) await pageWatch(p.slice(3), Number(qs.get("t")) || null);
    else if (p === "/ara") await pageSearch(qs.get("q") || "");
    else if (p === "/abonelikler") await pageSubs();
    else if (p === "/algoritma") await pageAlgo();
    else if (p === "/liste") await pageList(qs.get("t") || "later");
    else if (p === "/gecmis") await pageHistory();
    else if (p === "/kategoriler") await pageCats();
    else if (p === "/hakkinda") await pageAbout();
    else main.innerHTML = `<div class="empty">Sayfa yok. <a href="/" data-link>Ana sayfaya dön</a></div>`;
  } catch (e) {
    main.innerHTML = `<div class="empty">Bir şey ters gitti: ${esc(e.message)}</div>`;
  }
}

/* ---------- kartlar ---------- */
function metaLine(it) {
  const a = [];
  if (it.views != null) a.push(fmtViews(it.views));
  else if (it.recs) a.push(`${it.recs} HN önerisi`);
  if (it.upload_date) a.push(dateAgo(it.upload_date));
  else if (it.hn_first) a.push(`HN'de ${it.hn_first}'den beri`);
  return a.join(" • ");
}
function cardHTML(it) {
  const prog = it.pos && it.dur ? `<span class="prog"><i style="width:${Math.min(100, (100 * it.pos) / it.dur)}%"></i></span>` : "";
  const why = [it.pool_name, it.why].filter(Boolean).join(": ");
  return `<article class="card" data-vid="${it.vid}" data-title="${esc(it.title)}" data-channel="${esc(it.channel || "")}" data-dur="${it.duration || ""}" data-later="${it.later ? 1 : 0}">
    <a class="thumb" href="/v/${it.vid}" data-link>${thumb(it.vid)}${it.duration ? `<span class="dur">${fmtDur(it.duration)}</span>` : ""}${prog}</a>
    <div class="info">
      <div><a class="title" href="/v/${it.vid}" data-link title="${esc(it.title)}">${esc(it.title)}</a>
        <div class="meta"><div>${esc(it.channel || "")}</div><div title="${esc(why)}">${it.source === "sub" ? `<span class="badge sub" title="Aboneliklerinden; agent puanı">${(it.quality ?? 0).toFixed(1)}</span>` : ""}${esc(metaLine(it))}</div></div></div>
      <button class="menu-btn" data-menu aria-label="Seçenekler">${I.dots}</button>
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
      popEl.innerHTML = `<button data-do="listen">${I.listen}Arka planda dinle</button>
        <button data-do="later">${I.later}${later ? "Sonra izle'den çıkar" : "Sonra izle'ye ekle"}</button>
        ${card.classList.contains("hrow") ? `<button data-do="forget">${I.trash}Geçmişten kaldır</button>` : `<button data-do="hide">${I.hide}İlgilenmiyorum</button>`}
        <button data-do="yt">${I.yt}YouTube'da aç</button>`;
      document.body.appendChild(popEl);
      const r = b.getBoundingClientRect();
      const w = 230, left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w + window.scrollX));
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
          card.dataset.later = later ? "0" : "1"; toast(!later ? "Sonra izle listene eklendi" : "Listeden çıkarıldı");
        } else if (x.dataset.do === "hide") {
          await api(`/api/video/${vid}/state`, { method: "POST", body: { hidden: true, rating: -1 } });
          card.style.opacity = ".25"; card.style.pointerEvents = "none"; toast("Anlaşıldı. Benzerleri de daha az gelecek");
        } else if (x.dataset.do === "forget") {
          await api(`/api/history/${vid}`, { method: "DELETE" }); card.remove(); toast("Geçmişten kaldırıldı");
        } else if (x.dataset.do === "yt") window.open(`https://www.youtube.com/watch?v=${vid}`, "_blank", "noopener");
      });
    }
  });
}

/* =====================================================================
   ARKA PLANDA DİNLEME — ekran kapalıyken de çalan <audio> + Media Session
   ===================================================================== */
const P = {
  a: $("#audio"), cur: null, queue: [], session: null, played: 0, playedHidden: 0, wasHidden: false, lastW: null, lastT: null, lastSent: 0, unlocked: false, auto: false,
  rates: [1, 1.25, 1.5, 1.75, 2, 0.75],
  fmt() { return this.a.canPlayType('audio/mp4; codecs="mp4a.40.2"') ? "m4a" : "webm"; },
  // NOT: iOS için play() kullanıcı dokunuşunun içinde, araya await girmeden çağrılmalı.
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
    if (pr) pr.catch((e) => { if (e.name !== "AbortError") toast("Ses başlatılamadı: " + e.message); });
    this.ui(); this.meta();
    if (!queue && !this.queue.length) this.fill();
    document.dispatchEvent(new CustomEvent("audiochange"));
    return pr;
  },
  async fill() {  // sıradaki listesi: videonun benzerleri
    if (!this.cur) return;
    try { const d = await api(`/api/video/${this.cur.vid}`); if (!this.queue.length) this.queue = d.related.map((r) => ({ vid: r.vid, title: r.title, channel: r.channel, duration: r.duration })); } catch (e) {}
  },
  next() {
    const n = this.queue.shift();
    if (!n) { toast("Sırada video yok"); return; }
    this.play(n, 0, null);
  },
  stop() { this.flush(); this.a.pause(); this.a.removeAttribute("src"); this.a.load(); this.cur = null; $("#mini").hidden = true; document.body.classList.remove("mini-on"); if ("mediaSession" in navigator) navigator.mediaSession.metadata = null; document.dispatchEvent(new CustomEvent("audiochange")); },
  playing() { return !!this.cur && !this.a.paused; },
  seek(t) {  // bazı motorlar parçalı MP4'te yanlış yere (dosya sonuna) sarabiliyor: 'seeked'de doğrulanıp yeniden denenir
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
  account() {  // gerçekten çalan süreyi biriktir. Kilitli ekranda JS uyuyabilir: aralık, geçen duvar saatine sığıyorsa sayılır
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
  flush(beacon = false) {  // izleme geçmişine yaz
    if (!this.cur || !this.session) return;
    this.account();
    const body = JSON.stringify({ pos: this.a.currentTime || this._start || 0, dur: (isFinite(this.a.duration) && this.a.duration) || this.cur.duration || null, delta: Math.round(this.played * 10) / 10, hidden: Math.round(this.playedHidden * 10) / 10, mode: "audio", session: this.session });
    this.played = 0; this.playedHidden = 0; this.lastSent = Date.now();
    sendProgress(this.cur.vid, body, beacon);
  },
  unlock() {  // iOS: ilk dokunuşta ses öğesini "kullanıcı başlattı" say; ekran kapanınca otomatik geçiş için
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
    if (P._seekT != null && Date.now() - P._seekAt < 20000 && isFinite(a.duration) && P._seekT < a.duration - 10) { a.currentTime = P._seekT; a.play().catch(() => {}); return; }  /* sahte bitiş */ P.flush(); if (ls.get("autonext", true) && P.queue.length) P.next(); else P.tick(); });
  a.addEventListener("error", () => { if (P.cur && a.error) toast("Ses akışı hatası (" + a.error.code + "). Tekrar dene."); });
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

/* ---------- ana sayfa ---------- */
async function pageFeed(area) {
  state.area = area || null;
  if (!state.areas) state.areas = await api("/api/areas").catch(() => []);
  const me = await api("/api/me").catch(() => null);
  state.me = me;
  const first = me && !me.channels && !me.liked && !(me.profile && (me.profile.more || []).length);
  const showF = !!state.area || ls.get("filtersOpen", false);
  main.innerHTML = `
    ${first ? `<div class="notice"><b>Hoş geldin.</b> Akış, Hacker News'in yıllardır birbirine önerdiği videolarla başlıyor.
      <a href="/abonelikler" data-link>Aboneliklerini içe aktar</a>; agent'lar yeni videolarını izleyip iyilerini buraya ekler.
      Ya da <a href="/algoritma" data-link>algoritmana ne izlemek istediğini söyle</a>. Telefonda bir videonun ⋮ menüsünden “Arka planda dinle” dersen ekran kapalıyken de çalar.</div>` : ""}
    <div class="filters"><button class="fbtn ${showF ? "on" : ""}" id="fbtn">${I.filt}Filtreler</button>
      <div class="chips" id="areas" ${showF ? "" : "hidden"}>
        <button class="chip ${!state.area ? "on" : ""}" data-area="">Tümü</button>
        ${state.areas.map((a) => `<button class="chip ${state.area === a.id ? "on" : ""}" data-area="${a.id}">${esc(a.name)}</button>`).join("")}
      </div></div>
    <div class="grid" id="grid">${Array.from({ length: 9 }, () => `<div><div class="skel" style="aspect-ratio:16/9"></div></div>`).join("")}</div>
    <button class="btn more" id="more" hidden>Daha fazla</button>`;
  $("#fbtn").onclick = () => { const h = !$("#areas").hidden; $("#areas").hidden = h; $("#fbtn").classList.toggle("on", !h); ls.set("filtersOpen", !h); };
  $("#areas").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; go(c.dataset.area ? `/?area=${c.dataset.area}` : "/"); });
  bindCards($("#grid"));
  let page = 0, loading = false;
  const load = async () => {
    if (loading) return; loading = true;
    const d = await api(`/api/feed?page=${page}&seed=${state.seed}${state.area ? `&area=${state.area}` : ""}`);
    const g = $("#grid"); if (!g) return;
    if (page === 0) g.innerHTML = "";
    g.insertAdjacentHTML("beforeend", d.items.map(cardHTML).join("") || (page === 0 ? `<div class="empty">Bu filtrede video kalmadı.</div>` : ""));
    $("#more").hidden = !d.more; page++; loading = false;
  };
  await load();
  $("#more").onclick = load;
  const io = new IntersectionObserver((en) => { if (en[0].isIntersecting && !$("#more").hidden) load(); }, { rootMargin: "800px" });
  io.observe($("#more"));
  cleanup = () => io.disconnect();
}

async function pageSearch(q) {
  $("#q").value = q;
  document.title = `${q} - ${TITLE}`;
  main.innerHTML = `<div class="grid" id="grid"></div>`;
  const d = await api(`/api/search?q=${encodeURIComponent(q)}`);
  $("#grid").innerHTML = d.items.map(cardHTML).join("") || `<div class="empty">Sonuç yok.</div>`;
  bindCards($("#grid"));
}

async function pageCats() {
  if (!state.areas) state.areas = await api("/api/areas").catch(() => []);
  main.innerHTML = `<div class="page"><h1>Kategoriler</h1><p class="lead">HackerTube'un konu ağacı. Bir alana tıkla, ana sayfa o alana süzülür.</p>
    <div class="cats">${state.areas.map((a) => `<section class="panel"><h2><a href="/?area=${a.id}" data-link>${esc(a.name)}</a> <span class="small muted">${a.count} video</span></h2>
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

/* ---------- sohbet bileşeni ---------- */
function chatBox({ kind, vid, title, intro, suggestions, onChange, messages }) {
  const el = document.createElement("section");
  el.className = "chat";
  el.innerHTML = `<div class="hd"><b>${esc(title)}</b><button class="btn small" data-new title="Yeni sohbet">Yeni</button></div>
    <div class="msgs" aria-live="polite"></div>
    <div class="sugg">${(suggestions || []).map((s) => `<button type="button">${esc(s)}</button>`).join("")}</div>
    <form><textarea rows="1" placeholder="Sor ya da söyle…" aria-label="Mesaj"></textarea><button class="btn primary" type="submit">Gönder</button></form>`;
  const box = $(".msgs", el), ta = $("textarea", el), form = $("form", el);
  const add = (role, html, cls = "") => { const d = document.createElement("div"); d.className = `msg ${role} ${cls}`; d.innerHTML = html; box.appendChild(d); box.scrollTop = box.scrollHeight; return d; };
  const addChange = (ch) => { if (!ch || !ch.length) return; const d = document.createElement("div"); d.className = "change"; d.innerHTML = `<b>Algoritman güncellendi:</b> ${ch.map(esc).join(" · ")} · <a href="/" data-link>akışı gör</a>`; box.appendChild(d); box.scrollTop = box.scrollHeight; };
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
    const a = add("assistant", `<span class="typing">düşünüyor…</span>`);
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
          else if (ev.t === "delta") { full += ev.x; const vis = full.split("<profil>")[0]; a.innerHTML = md(vis) || `<span class="typing">yazıyor…</span>`; box.scrollTop = box.scrollHeight; }
          else if (ev.t === "done") { a.innerHTML = md(ev.x); addChange(ev.changes); if (ev.changes && onChange) onChange(ev.changes); }
          else if (ev.t === "error") { a.innerHTML = `<span style="color:var(--bad)">${esc(ev.x)}</span>`; }
        }
      }
    } catch (e) { a.innerHTML = `<span style="color:var(--bad)">Bağlantı hatası: ${esc(e.message)}</span>`; }
    busy = false;
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); send(ta.value); });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !isPhone()) { e.preventDefault(); send(ta.value); } });
  ta.addEventListener("input", () => { ta.style.height = ""; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; });
  $(".sugg", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) send(b.textContent); });
  $("[data-new]", el).addEventListener("click", async () => { await api("/api/chat/new", { method: "POST", body: { kind, vid } }); render([]); $(".sugg", el).hidden = false; });
  return el;
}

/* ---------- izleme ---------- */
async function pageWatch(vid, tParam) {
  main.innerHTML = `<div class="watch"><div><div class="player skel"></div></div><div></div></div>`;
  const v = await api(`/api/video/${encodeURIComponent(vid)}`);
  document.title = `${v.title} - ${TITLE}`;
  const c = v.card || {}, ev = v.eval, ht = v.ht && v.ht.hn, st = v.state || {};
  const resumeAt = tParam != null ? tParam : (st.pos && (!st.dur || st.pos < st.dur - 20) && st.pos > 15 ? Math.floor(st.pos) : 0);
  const recs = v.mentions.filter((m) => m.stance === "rec" || m.stance === "strong_rec");
  const other = v.mentions.filter((m) => !(m.stance === "rec" || m.stance === "strong_rec"));
  const stanceTr = { strong_rec: "coşkuyla öneriyor", rec: "öneriyor", reference: "atıf", joke: "espri", critical: "eleştiriyor" };
  const mention = (m) => `<div class="mention ${m.stance}"><div class="who">${esc(m.author)} · ${esc(m.month)} · ${stanceTr[m.stance] || m.stance} · <a href="https://news.ycombinator.com/item?id=${m.hn_comment_id}" target="_blank" rel="noopener">HN'de aç</a>${m.story_title ? ` · “${esc(m.story_title)}” başlığında` : ""}</div>${esc(m.text).replace(/\[VIDEO\]/g, "<i>[bu video]</i>").replace(/\[LINK\]/g, "<i>[link]</i>")}</div>`;
  const vinfo = { vid: v.vid, title: v.title, channel: v.channel, duration: v.duration };
  const queue = v.related.map((r) => ({ vid: r.vid, title: r.title, channel: r.channel, duration: r.duration }));
  const autoBg = ls.get("autoBg", true);
  const hybridOk = isPhone() && autoBg;  // telefonda: ses <audio>'dan, görüntü sessiz iframe'den (kilitlenince ses sürer)
  main.innerHTML = `<div class="watch">
    <div class="wmain">
      <div class="player" id="player"><div id="ytp"></div>${hybridOk && !(P.cur && P.cur.vid === v.vid) ? `<button class="tapplay" id="tapPlay" style="background-image:url(${thumbUrl(v.vid)})" aria-label="Oynat"><span class="pc"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span><span class="pt">Ekran kapanınca da çalmaya devam eder</span></button>` : ""}<div class="audio-cover" id="cover" hidden style="background-image:url(${thumbUrl(v.vid)})"><div><b>Arka planda çalıyor</b><span class="small">Ekranı kapatabilirsin; ses devam eder.</span><br><br><button class="btn" id="toVideo">${I.video}Videoya geç</button></div></div></div>
      <div class="wbody">
      <h1 class="wtitle">${esc(v.title)}</h1>
      <div class="wrow">
        <div class="wchan">${esc(v.channel || "")}<small>${[v.views ? fmtViews(v.views) : "", v.upload_date ? dateAgo(v.upload_date) : "", v.duration ? fmtDur(v.duration) : ""].filter(Boolean).join(" • ")}</small></div>
        <div class="actions">
          <button class="btn accent" id="bgBtn" title="Ekran kapalıyken de çalar">${I.listen}<span>Arka planda dinle</span></button>
          <button class="btn ${st.rating > 0 ? "on" : ""}" data-r="1" aria-label="Beğen">${I.up}<span class="lbl-long">Beğen</span></button>
          <button class="btn ${st.rating < 0 ? "on" : ""}" data-r="-1" aria-label="Daha az böyle">${I.down}<span class="lbl-long">Daha az</span></button>
          <button class="btn ${st.later ? "on" : ""}" data-later aria-label="Sonra izle">${I.later}<span class="lbl-long">Sonra izle</span></button>
          <a class="btn" href="https://www.youtube.com/watch?v=${v.vid}" target="_blank" rel="noopener" aria-label="YouTube'da aç">${I.yt}<span class="lbl-long">YouTube</span></a>
        </div>
      </div>
      ${resumeAt ? `<p class="resume">Kaldığın yerden devam ediyor: ${fmtDur(resumeAt)} · <button class="ts" data-t="0:00">baştan başlat</button></p>` : ""}
      <label class="toggle autobg" style="margin-top:8px"><input type="checkbox" id="autoBg" ${autoBg ? "checked" : ""}> Telefonda ekran kapanınca da çalsın</label>
      <div class="desc">
        <div class="dm">${[v.views ? fmtViews(v.views) : "", v.upload_date ? fmtDate(v.upload_date) : "", ht ? `HN'de ${ht.recommenders} kişi önerdi` : "", v.source === "sub" && v.quality != null ? `agent puanı ${v.quality.toFixed(1)}/10` : ""].filter(Boolean).join(" • ")}</div>
        <p>${esc(c.summary || "Özet yok.")}</p>
        ${c.why ? `<p class="muted"><b>${v.source === "ht" ? "HN neden seviyor:" : "Neden izlenir:"}</b> ${esc(c.why)}</p>` : ""}
        <div>${c.content_type ? `<span class="tag">${esc(c.content_type)}</span>` : ""}${c.level ? `<span class="tag">${esc(c.level)}</span>` : ""}${(c.categories || []).map((x) => `<span class="tag">${esc(x.name)}</span>`).join("")}${(c.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>
      </div>
      <div id="chatMobile"></div>
      ${ev ? `<section class="panel"><h3>Agent değerlendirmesi</h3>
        <div class="evalhead"><span class="score">${(v.quality ?? 0).toFixed(1)}<small>/10</small></span><div><b>${esc(ev.verdict || "")}</b></div></div>
        <p>${esc(ev.reasoning || "")}</p>
        ${ev.audience ? `<p class="small muted"><b>Kime:</b> ${esc(ev.audience)}</p>` : ""}
        ${ev.hn_signal ? `<p class="small muted"><b>HN sinyali:</b> ${esc(ev.hn_signal)}</p>` : ""}
        ${(ev.highlights || []).length ? `<ul class="hl">${ev.highlights.map((h) => `<li><button class="ts" data-t="${fmtTs(h.t)}">${fmtTs(h.t)}</button> ${esc(h.note)}</li>`).join("")}</ul>` : ""}
        <p class="small muted" style="margin-top:8px">${ev.agent ? `Claude Code agent'ı <code>${esc(ev.agent)}</code>` : esc(ev.model || "")} · ${(ev.tools || []).length} araç çağrısı (${esc([...new Set(ev.tools || [])].join(", "))})${ev.seconds ? ` · ${ev.seconds} sn` : ""}</p>
      </section>` : ""}
      ${ht ? `<section class="panel"><h3>Hacker News'te</h3>
        <p class="small muted">${ht.recommenders} kişi önerdi · ${ht.rec_months} ayrı ayda · ${ht.strong_recs} coşkulu öneri · ${ht.first_year}–${ht.last_year}</p>
        ${v.ht.quote ? `<p style="font-size:16px"><i>“${esc(v.ht.quote.text)}”</i></p>` : ""}
        ${recs.slice(0, 5).map(mention).join("")}
        ${recs.length > 5 || other.length ? `<details><summary>Tüm yorumlar (${v.mentions.length})</summary>${recs.slice(5).concat(other).map(mention).join("")}</details>` : ""}
      </section>` : ""}
      </div>
    </div>
    <aside class="wside"><div id="chatDesk"></div>
      <div class="row" style="justify-content:space-between"><div class="sectitle">Sıradaki</div><label class="toggle"><input type="checkbox" id="autonext" ${ls.get("autonext", true) ? "checked" : ""}> Otomatik oynat</label></div>
      <div id="rels">${v.related.map((r) => `<a class="rel" href="/v/${r.vid}" data-link><span class="thumb">${thumb(r.vid)}${r.duration ? `<span class="dur">${fmtDur(r.duration)}</span>` : ""}</span><span><span class="t">${esc(r.title)}</span><span class="m">${esc(r.channel || "")}</span><span class="m">${esc(metaLine(r))}</span></span></a>`).join("")}</div>
    </aside>
  </div>`;
  const cb = chatBox({
    kind: "video", vid: v.vid, title: "Bu video hakkında konuş", messages: v.chat,
    intro: "Video hakkında ne istersen sor: özet, bir iddianın doğruluğu, bir kısmın açıklaması, ne izlemeli. Transcript'i ve HN yorumlarını okuyorum. “Bu tarz videolardan daha çok” dersen algoritmanı da güncellerim.",
    suggestions: ["Bunu 5 maddede özetle", "En güçlü ve en zayıf argümanı ne?", "İzlemeye değer mi, hangi kısımlar?", "Bu tarz videolardan daha çok göster"],
  });
  const mq = matchMedia("(max-width: 1000px)");
  const place = () => { const tgt = mq.matches ? $("#chatMobile") : $("#chatDesk"); if (tgt && cb.parentElement !== tgt) tgt.appendChild(cb); };
  place(); mq.addEventListener("change", place);

  /* --- oynatıcı: YouTube iframe (video) ⇄ <audio> (arka plan) --- */
  let ytp = null, vSession = Math.random().toString(36).slice(2), vPlayed = 0, vLast = null, vTimer = null, vLastSent = Date.now(), vSentPos = resumeAt || 0;
  const sameAudio = () => P.cur && P.cur.vid === v.vid;
  let hybrid = hybridOk && sameAudio() && !P.a.paused, ourSeek = 0, syncT = null, ytPauseAt = 0;
  const showCover = () => { $("#cover").hidden = !sameAudio() || hybrid; };
  const vAccount = () => { if (hybrid) return; if (!ytp || !ytp.getCurrentTime) return; const t = ytp.getCurrentTime(); if (vLast != null && ytp.getPlayerState() === 1) { const d = t - vLast; if (d > 0 && d < 5) vPlayed += d; } vLast = t; };
  const vFlush = (beacon = false) => {
    if (!ytp || !ytp.getCurrentTime || hybrid) return;
    vAccount(); const pos = ytp.getCurrentTime();
    if (vPlayed < 0.5 && Math.abs(pos - vSentPos) < 1) return;  // video oynamadıysa (ör. ses çalarken) konumu ezme
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
  /* telefon karma modu: ses kullanıcı dokunuşuyla <audio>'da başlar (iOS'un istediği), iframe sessiz ve senkron.
     Ekran kilitlenince iOS iframe'i durdurur ama ses zaten çalıyordur; açılınca görüntü sese yetişir. */
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
    if (!P.cur) { hybrid = false; ytp.pauseVideo(); showCover(); return; }               // mini oynatıcı kapatıldı
    if (!sameAudio()) { go(`/v/${P.cur.vid}`); return; }                                  // ses sıradakine geçti
    if (!ytp.isMuted()) ytp.mute();
    const st = ytp.getPlayerState(), at = P.a.currentTime, yt = ytp.getCurrentTime();
    if (P.a.paused) { if (st === 1) ytp.pauseVideo(); return; }
    if (st === 2 && Date.now() - ytPauseAt < 1500) return;                               // kullanıcı duraklatıyor olabilir
    if (st !== 1 && st !== 3) { ytSeek(at); ytp.playVideo(); return; }
    if (st === 1) {
      const d = yt - at;
      if (Math.abs(d) > 2.5 && Date.now() - ourSeek > 4000) { P.seek(yt); ourSeek = Date.now(); return; }  // kullanıcı videoda sardı
      if (Math.abs(d) > 0.6 && Date.now() - ourSeek > 1500) ytSeek(at + 0.2);
      if (ytp.getPlaybackRate() !== P.a.playbackRate) ytp.setPlaybackRate(P.a.playbackRate);
    }
  };
  const onWake = () => { if (document.visibilityState === "visible" && hybrid) { ourSeek = 0; sync(); } };
  document.addEventListener("visibilitychange", onWake);
  if ($("#tapPlay")) $("#tapPlay").onclick = startHybrid;
  $("#bgBtn").onclick = () => { if (hybrid) { toast("Zaten ses olarak çalıyor; ekranı kapatabilirsin"); return; } if (sameAudio()) { toast("Zaten arka planda çalıyor"); return; } toAudio(false); toast("Arka planda çalıyor. Ekranı kapatabilirsin"); };
  $("#toVideo").onclick = toVideo;
  $("#autoBg").onchange = (e) => ls.set("autoBg", e.target.checked);
  $("#autonext").onchange = (e) => ls.set("autonext", e.target.checked);
  document.addEventListener("audiochange", showCover);
  showCover();
  const onVis = () => {  // telefon kilitlenince/uygulama değişince video durur; o an sese geç
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
            if (e.data === 2) setTimeout(() => {  // kullanıcı videoyu duraklattıysa sesi de durdur (kilit kaynaklı duraklamayı ayırmak için bekle)
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
    toast(on ? (r > 0 ? "Beğenildi. Benzerleri öne çıkacak" : "Tamam. Benzerleri daha az gelecek") : "Geri alındı");
  }));
  $(".actions [data-later]").addEventListener("click", async (e) => {
    const b = e.currentTarget, on = !b.classList.contains("on");
    await api(`/api/video/${v.vid}/state`, { method: "POST", body: { later: on } }); b.classList.toggle("on", on);
    toast(on ? "Sonra izle listene eklendi" : "Listeden çıkarıldı");
  });
  cleanup = () => {
    vFlush(); clearInterval(vTimer); clearTimeout(syncT); hybrid = false;
    document.removeEventListener("visibilitychange", onWake);
    document.removeEventListener("visibilitychange", onVis); document.removeEventListener("audiochange", showCover);
    mq.removeEventListener("change", place); main.removeEventListener("click", seekHandler);
    try { if (ytp && ytp.destroy) ytp.destroy(); } catch (e) {}
  };
  window.__ytp = () => ytp;  // testler için
  window.__hybrid = () => hybrid;
}

/* ---------- geçmiş ---------- */
async function pageHistory() {
  main.innerHTML = `<div class="hist"><h1>İzleme geçmişi</h1><p class="lead">İzlediğin ve arka planda dinlediğin her video, kaldığın yerle birlikte burada. Tıklayınca kaldığın yerden devam eder. Geçmiş, öneri akışından izlenmişleri çıkarmak için de kullanılır.</p><div id="hl"></div></div>`;
  const d = await api("/api/list/history");
  if (!d.items.length) { $("#hl").innerHTML = `<div class="empty">Henüz bir şey izlemedin.</div>`; return; }
  const dayKey = (ts) => { const dt = new Date(ts * 1000), now = new Date(); const diff = Math.floor((new Date(now.toDateString()) - new Date(dt.toDateString())) / 86400000); return diff === 0 ? "Bugün" : diff === 1 ? "Dün" : dt.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: dt.getFullYear() === now.getFullYear() ? undefined : "numeric" }); };
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
        <div class="m">${dur && it.pos >= dur - 20 ? "Bitirdin" : it.pos ? `${fmtDur(it.pos)}${dur ? " / " + fmtDur(dur) : ""}'da kaldın` : "Açtın"}${it.watch_s ? ` · ${Math.max(1, Math.round(it.watch_s / 60))} dk izledin` : ""} · ${ago(it.seen_at)}</div></div>
      <button class="ib" data-menu aria-label="Seçenekler">${I.dots}</button></div>`;
  }
  $("#hl").innerHTML = html;
  bindCards($("#hl"));
}

/* ---------- abonelikler ---------- */
const BOOKMARKLET = `(()=>{const s=new Set();const add=h=>{if(!h)return;const m=h.match(/\\/(@[^/?#]+|channel\\/UC[\\w-]{22})/);if(m)s.add('https://www.youtube.com/'+m[1])};document.querySelectorAll('ytd-channel-renderer a, ytd-grid-channel-renderer a').forEach(a=>add(a.getAttribute('href')));if(!s.size)document.querySelectorAll('ytd-guide-entry-renderer a').forEach(a=>add(a.getAttribute('href')));const t=[...s].join('\\n');if(!s.size){alert('Kanal bulunamadı. youtube.com/feed/channels sayfasında, sayfayı en alta kadar kaydırıp tekrar dene.');return}const w=window.open('${location.origin}/abonelikler#ice='+encodeURIComponent(t),'_blank');if(!w){navigator.clipboard.writeText(t).then(()=>alert(s.size+' kanal panoya kopyalandı; yt sayfasına yapıştır.'),()=>prompt('Kopyala:',t))}})()`;

function agentsHTML(p) {
  if (!p.agents || !p.agents.length) return "";
  const kindTr = { deep: "derin değerlendirme", triage: "ön eleme", fit: "kişisel uyum" };
  return `<h3 style="margin-top:14px">Değerlendirme agent'ları (Claude Code, bp)</h3>${p.agents.map((a) => `<div class="agent"><b>${esc(a.name)}</b><span class="st ${a.job ? "working" : a.state === "closed" ? "closed" : "idle"}">${a.job ? "çalışıyor" : a.state === "closed" ? "kapalı" : "boşta"}</span>
    <span class="d">${a.kinds.map((k) => kindTr[k] || k).join(" + ")} · son 24 saatte ${a.done_24h} iş${a.job ? ` · şimdi: iş #${a.job.id} (${kindTr[a.job.kind] || a.job.kind}${a.job.vid ? `, <a href="/v/${a.job.vid}" data-link>${a.job.vid}</a>` : ""}), ${ago(a.job.since)} başladı` : ""}${a.last_poll ? ` · kuyruğa son bakış ${ago(a.last_poll)}` : ""}</span></div>`).join("")}`;
}

async function pageSubs() {
  main.innerHTML = `<div class="page"><h1>Abonelikler</h1><p class="lead">YouTube hesabına bağlanmadan: kanal listeni ver; arka plandaki Claude Code agent'ları yeni videolarını tarar, izleyip puanlar, eşiği (≥ 6/10) geçenler akışına girer. Liste herkese açık değil; yalnız bu tarayıcıya (ve senkron linkine) bağlı.</p>
  <div class="two">
    <section class="panel"><h2>İçe aktar</h2>
      <textarea class="big" id="imp" placeholder="Her satıra bir kanal: https://www.youtube.com/@3blue1brown, @veritasium, UC… kimliği. Ya da Takeout subscriptions.csv / OPML içeriği"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="impGo">İçe aktar</button>
        <label class="btn" for="impFile">Dosya seç (CSV/OPML)</label><input id="impFile" type="file" accept=".csv,.opml,.xml,.txt" hidden>
        <span class="small muted" id="impMsg"></span></div>
      <div id="impProg"></div>
      <details><summary>Listeyi YouTube'dan nasıl alırım?</summary>
        <ol class="steps small">
          <li><b>En kolayı (bilgisayarda):</b> şu düğmeyi yer imleri çubuğuna sürükle: <a class="bm" id="bm" href="#">yt'ye aktar</a>. Sonra <a href="https://www.youtube.com/feed/channels" target="_blank" rel="noopener">youtube.com/feed/channels</a> sayfasını aç, en alta kadar kaydır, yer imine tıkla; liste buraya gelir.</li>
          <li><b>Google Takeout:</b> takeout.google.com → yalnız “YouTube ve YouTube Music” → “abonelikler” → indirdiğin <code>subscriptions.csv</code>'yi yukarıdan seç.</li>
          <li><b>Elle:</b> kanal linklerini ya da @kullanıcıadlarını yapıştır.</li>
        </ol></details>
    </section>
    <section class="panel"><h2>Değerlendirme hattı</h2><div id="pipe">…</div></section>
  </div>
  <section class="panel"><h2>Aboneliklerinden son videolar</h2><p class="small muted">Her video önce ön elemeden geçer (Haiku agent'ı, toplu), kalanları Opus agent'ları transcript'i okuyup Hacker News'te arayıp HackerTube'daki benzerleriyle kıyaslayarak puanlar.</p><div id="recent"></div></section>
  <section class="panel"><h2>Kanalların <span class="muted small" id="chCount"></span></h2><div class="tablewrap" id="chans"></div></section></div>`;
  $("#bm").href = "javascript:" + encodeURIComponent(BOOKMARKLET);
  $("#bm").addEventListener("click", (e) => { e.preventDefault(); toast("Bunu yer imleri çubuğuna sürükle, sonra YouTube'da tıkla"); });
  const m = location.hash.match(/^#ice=(.*)$/s);
  if (m) { $("#imp").value = decodeURIComponent(m[1]); history.replaceState({}, "", "/abonelikler"); toast("Liste geldi. “İçe aktar”a bas"); }
  let filename = "";
  $("#impFile").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; filename = f.name; $("#imp").value = await f.text(); $("#impMsg").textContent = f.name; });
  $("#impGo").addEventListener("click", async () => {
    try {
      const d = await api("/api/import", { method: "POST", body: { text: $("#imp").value, filename } });
      $("#impMsg").textContent = `${d.total} kanal sıraya alındı`; $("#imp").value = ""; refresh();
    } catch (e) { $("#impMsg").textContent = e.message; }
  });
  let timer;
  const refresh = async () => {
    const d = await api("/api/subs");
    if (!$("#pipe")) return;
    const p = d.pipeline, s = p.status;
    const imp = d.imports.find((i) => i.status !== "done") || d.imports[0];
    $("#impProg").innerHTML = imp ? `<div style="margin-top:12px"><div class="small">İçe aktarma #${imp.id}: ${imp.done}/${imp.total} ${imp.status === "done" ? "tamam" : "işleniyor…"}</div><div class="bar"><i style="width:${imp.total ? (100 * imp.done) / imp.total : 0}%"></i></div>
      <details><summary>Ayrıntı</summary><ul class="log">${imp.log.slice(-40).reverse().map((l) => `<li>${l.ok ? "✓" : "✕"} ${esc(l.name || l.ref)}${l.ok ? (l.new ? `: ${l.new} yeni video` : "") : `: <span style="color:var(--bad)">${esc(l.error)}</span>`}</li>`).join("")}</ul></details></div>` : "";
    $("#pipe").innerHTML = `<div class="stats">
        <div class="stat"><b>${(s.new || 0) + (s.triaging || 0) + (s.triage_pass || 0) + (s.evaluating || 0)}</b><span>sırada</span></div>
        <div class="stat"><b>${s.evaluated || 0}</b><span>agent değerlendirdi</span></div>
        <div class="stat"><b>${s.triage_skip || 0}</b><span>ön elemede elendi</span></div>
        <div class="stat"><b>${p.deep_today}/${p.deep_cap}</b><span>bugünkü derin inceleme</span></div></div>
      ${agentsHTML(p)}
      <div class="small" style="margin-top:10px">Sohbet bütçesi (tüm site): $${p.chat_usd} / $${p.chat_cap}<div class="bar"><i style="width:${Math.min(100, (100 * p.chat_usd) / p.chat_cap)}%"></i></div></div>
      <p class="small ${p.worker_alive ? "muted" : ""}" style="margin:8px 0 4px;${p.worker_alive ? "" : "color:var(--bad)"}">${p.worker_alive ? "● Worker çalışıyor" : "● Worker yanıt vermiyor"}</p>
      <details><summary>Hat günlüğü (tüm site)</summary>${p.events.map((e) => `<div class="ev">${ago(e.ts)} · <b>${esc(e.stage)}</b> · ${e.vid ? `<a href="/v/${e.vid}" data-link>${e.vid}</a> · ` : ""}${esc(e.msg)}</div>`).join("")}</details>`;
    $("#recent").innerHTML = d.recent.length ? d.recent.slice(0, 60).map((r) => {
      const low = r.status === "evaluated" && r.quality < p.threshold;
      const lab = r.status === "evaluated" ? (low ? `${r.quality.toFixed(1)} · eşiğin altında` : `${r.quality.toFixed(1)} · akışta`) : STATUS[r.status] || r.status;
      return `<a class="evrow" href="/v/${r.vid}" data-link><span class="thumb">${thumb(r.vid)}</span><span><span class="t">${esc(r.title)}</span>
        <span class="d" style="display:block"><span class="st ${low ? "low" : r.status}">${esc(lab)}</span> ${esc(r.channel)}${r.duration ? ` · ${fmtDur(r.duration)}` : ""}</span>
        <span class="d" style="display:block">${r.verdict ? esc(r.verdict) : r.triage ? `Ön eleme: ${esc(r.triage)}` : ""}${r.fit != null && r.fit >= 0 ? ` · <b>sana uyum ${r.fit.toFixed(0)}/10</b>${r.fit_reason ? `: ${esc(r.fit_reason)}` : ""}` : ""}</span></span></a>`;
    }).join("") : `<div class="empty">Henüz abonelik yok. Yukarıdan içe aktar.</div>`;
    $("#chCount").textContent = d.channels.length ? `(${d.channels.length})` : "";
    $("#chans").innerHTML = d.channels.length ? `<table><thead><tr><th>Kanal</th><th>Video</th><th>Değerl.</th><th>Akışta</th><th>Ort.</th><th>HackerTube</th><th></th></tr></thead><tbody>${d.channels.map((c) => `<tr>
      <td><a href="https://www.youtube.com/channel/${c.channel_id}" target="_blank" rel="noopener">${esc(c.name || c.channel_id)}</a>${c.fetch_error ? ` <span class="st failed" title="${esc(c.fetch_error)}">hata</span>` : ""}</td>
      <td>${c.n_videos}${c.n_queue ? ` <span class="muted">(${c.n_queue} sırada)</span>` : ""}</td><td>${c.n_eval}</td><td>${c.n_pass}</td><td>${c.avg_q ?? "–"}</td><td>${c.ht_count || "–"}</td>
      <td><button class="btn small" data-unsub="${c.channel_id}" title="Takipten çıkar">✕</button></td></tr>`).join("")}</tbody></table>` : `<p class="muted small">Henüz kanal yok.</p>`;
    const busy = s.evaluating || s.new || s.triaging || (imp && imp.status !== "done") || (p.agents || []).some((a) => a.job);
    timer = setTimeout(refresh, busy ? 4000 : 15000);
  };
  main.addEventListener("click", unsubHandler);
  await refresh();
  cleanup = () => { clearTimeout(timer); main.removeEventListener("click", unsubHandler); };
}
async function unsubHandler(e) {
  const b = e.target.closest("[data-unsub]"); if (!b) return;
  if (!confirm("Bu kanalı aboneliklerinden çıkarayım mı?")) return;
  await api(`/api/subs/${b.dataset.unsub}`, { method: "DELETE" }); b.closest("tr").remove(); toast("Çıkarıldı");
}

/* ---------- algoritma ---------- */
async function pageAlgo() {
  const [p, me] = await Promise.all([api("/api/profile"), api("/api/me")]);
  main.innerHTML = `<div class="page"><h1>Algoritma</h1><p class="lead">Akışın neye göre dizildiği burada, açıkça. Elle düzenleyebilir ya da agent'la konuşarak değiştirebilirsin: “daha az siyaset, daha çok donanım”, “neden bu videoyu görüyorum?”, “kısa videolar istiyorum”.</p>
  <div class="two"><section class="panel" id="prof"></section><div id="steer"></div></div></div>`;
  const prof = $("#prof");
  const draw = (p) => {
    const mix = p.prefs.mix || {};
    prof.innerHTML = `<h2>Profilin</h2>
      <label class="small muted" for="about">Kendini/ne aradığını anlat (öneriler bu metne de benzetiliyor)</label>
      <textarea class="big" id="about" style="min-height:80px">${esc(p.about)}</textarea>
      <h3 style="margin-top:12px">Daha çok</h3><div class="pill-list" id="more">${p.more.map((t) => `<span class="pill">${esc(t)}<button data-del="more" data-t="${esc(t)}" aria-label="sil">×</button></span>`).join("") || `<span class="small muted">henüz yok</span>`}</div>
      <div class="addrow"><input id="moreIn" placeholder="ör. rust systems programming"><button class="btn" data-add="more">Ekle</button></div>
      <h3 style="margin-top:12px">Daha az</h3><div class="pill-list" id="less">${p.less.map((t) => `<span class="pill less">${esc(t)}<button data-del="less" data-t="${esc(t)}" aria-label="sil">×</button></span>`).join("") || `<span class="small muted">henüz yok</span>`}</div>
      <div class="addrow"><input id="lessIn" placeholder="ör. celebrity drama"><button class="btn" data-add="less">Ekle</button></div>
      <h3 style="margin-top:14px">Tercihler</h3>
      <div class="field"><label for="maxm">En uzun video (dk)</label><input id="maxm" type="number" min="5" max="600" placeholder="sınırsız" value="${p.prefs.max_minutes || ""}"></div>
      <div class="field"><label for="hn">Haber videolarını gizle</label><select id="hn"><option value="1" ${p.prefs.hide_news ? "selected" : ""}>Evet</option><option value="0" ${!p.prefs.hide_news ? "selected" : ""}>Hayır</option></select></div>
      <h3 style="margin-top:14px">Havuz karışımı</h3>
      ${Object.entries(p.pools).map(([k, n]) => `<div class="mix"><label for="mx_${k}">${esc(n)}</label><input type="range" id="mx_${k}" data-mix="${k}" min="0" max="3" step="0.25" value="${mix[k] ?? 1}"><span>${(mix[k] ?? 1).toFixed(2).replace(/\.?0+$/, "")}×</span></div>`).join("")}
      <div class="row" style="margin-top:12px"><button class="btn primary" id="save">Kaydet</button><a class="btn" href="/" data-link>Akışı gör</a></div>
      ${p.changelog.length ? `<h3 style="margin-top:16px">Değişiklik geçmişi</h3><ul class="log">${p.changelog.map((c) => `<li><span class="muted">${ago(c.at)} · ${esc(c.source)}:</span> ${c.changes.map(esc).join(" · ")}</li>`).join("")}</ul>` : ""}
      <h3 style="margin-top:16px">Senkron linki</h3><p class="small muted">Hesap yok. Bu link profilini, aboneliklerini ve izleme geçmişini başka cihaza taşır. Kimseyle paylaşma.</p><div class="copy">${esc(me.sync_url)}</div>`;
  };
  let cur = p;
  draw(cur);
  const collect = () => {
    const mix = {}; $$("[data-mix]", prof).forEach((i) => { if (Number(i.value) !== 1) mix[i.dataset.mix] = Number(i.value); });
    return { about: $("#about").value, more: cur.more, less: cur.less, prefs: { hide_news: $("#hn").value === "1", max_minutes: Number($("#maxm").value) || null, mix } };
  };
  const save = async (body) => {
    const r = await api("/api/profile", { method: "PUT", body });
    toast(r.changes.length ? "Kaydedildi: " + r.changes.join(" · ") : "Değişiklik yok");
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
    kind: "steer", title: "Algoritmanla konuş", messages: hist.messages,
    intro: "Merhaba! Akışını ben diziyorum. Neyi daha çok, neyi daha az görmek istediğini söyle; ya da akışındaki bir şeyin neden orada olduğunu sor. Söylediklerini profiline işlerim, profil kutusunda görürsün.",
    suggestions: ["Şu an akışım neye göre diziliyor?", "Daha çok derin teknik konuşmalar, daha az komedi", "Aboneliklerimden daha çok video göster", "20 dakikadan uzun video istemiyorum"],
    onChange: async () => { cur = await api("/api/profile"); draw(cur); },
  }));
}

/* ---------- listeler ---------- */
async function pageList(tab) {
  const tabs = { later: "Sonra izle", liked: "Beğenilenler", hidden: "Gizlediklerim" };
  if (!tabs[tab]) tab = "later";
  document.title = `${tabs[tab]} - ${TITLE}`;
  main.innerHTML = `<h1>${tabs[tab]}</h1><div class="tabs">${Object.entries(tabs).map(([k, n]) => `<a class="chip ${k === tab ? "on" : ""}" href="/liste?t=${k}" data-link>${n}</a>`).join("")}<a class="chip" href="/gecmis" data-link>Geçmiş</a></div><div class="grid" id="grid"></div>`;
  const d = await api(`/api/list/${tab}`);
  $("#grid").innerHTML = d.items.map(cardHTML).join("") || `<div class="empty">Boş.</div>`;
  bindCards($("#grid"));
}

/* ---------- hakkında ---------- */
async function pageAbout() {
  const me = await api("/api/me");
  main.innerHTML = `<div class="page prose" style="max-width:780px">
  <h1>Bu ne?</h1>
  <p>Bir <a href="https://hackertube.org" target="_blank" rel="noopener">HackerTube</a> çatalı. HackerTube, Hacker News yorumlarında 2007'den beri linklenen YouTube videolarından <b>en az 3 kişinin, en az 3 ayrı ayda</b> önerdiklerini topluyor (skor = önerilen ay sayısı + coşkulu önerilerin yarısı). Buradaki akış o 6.454 videoyla başlıyor ve şunları ekliyor:</p>
  <section class="panel"><h3>1 · Aboneliklerinden agent seçkisi</h3>
  <p>Kanal listeni verirsin (YouTube hesabına bağlanmadan). Değerlendirmeyi sunucuda <code>bp</code> ile açılmış, sürekli çalışan <b>Claude Code agent'ları</b> yapar; her biri kuyruktan kendi işini çeker:</p>
  <ol class="steps"><li><b>Tarama:</b> kanalların “Videolar” sekmesi düzenli okunur; Shorts ve 2,5 dakikadan kısa videolar elenir.</li>
  <li><b>Ön eleme</b> (<code>youtube-triage</code>, Haiku 5.5): başlık/kanal/süre/izlenme ve kanalın HackerTube geçmişine bakıp derin incelemeye değer mi diye karar verir.</li>
  <li><b>Derin değerlendirme</b> (<code>youtube-eval-1</code>, <code>youtube-eval-2</code>, Opus 5.5): videonun metadata'sını ve transcript'ini okur, Hacker News'te arar, HackerTube'daki en benzer videolarla ve kanalın geçmişiyle kıyaslar; HackerTube formatında kart, 0–10 puan, gerekçe ve öne çıkan anları yazar.</li>
  <li><b>Kişisel uyum</b> (<code>youtube-triage</code>): eşiği (6/10) geçen videolar senin profilinle tekrar puanlanır.</li></ol>
  <p class="small muted">Agent'ların kabuğu bir kancayla yalnızca <code>ytctl</code> aracına kilitli: dosya, web ya da başka komut yok. Transcript içindeki talimatlar onları yönlendiremez.</p></section>
  <section class="panel"><h3>2 · Ekran kapalıyken dinleme</h3><p>Telefonda video sayfasında <b>Arka planda dinle</b>'ye bas (ya da bir kartın ⋮ menüsünden seç): video, sesi sunucu üzerinden aktarılan bir ses oynatıcısına geçer. Ekranı kilitlesen de çalar; kilit ekranından duraklat/ileri/geri/sıradaki çalışır. Telefonda bir videoyu oynattığında ses zaten bu oynatıcıdan gelir, görüntü sessiz ve senkron akar; telefonu kilitlesen de ses sürer, açınca görüntü sese yetişir (ayar: “Telefonda ekran kapanınca da çalsın”). Bittiğinde sıradaki benzer video çalar.</p></section>
  <section class="panel"><h3>3 · İzleme geçmişi</h3><p>Video ya da ses, izlediğin her şey kaldığın saniyeyle <a href="/gecmis" data-link>Geçmiş</a>'e yazılır; tekrar açınca oradan devam eder. 30 saniyeden fazla izlenenler akıştan çıkar.</p></section>
  <section class="panel"><h3>4 · Video sohbeti ve konuşarak yönlendirilen algoritma</h3><p>İzleme sayfasında videonun transcript'ini, kartını ve HN yorumlarını okuyan bir sohbet var; zaman damgalarına tıklayınca video oraya atlar. <a href="/algoritma" data-link>Algoritma</a> sayfasında profilin açıkça duruyor; konuşunca profili günceller.</p></section>
  <h2 style="margin-top:20px">Hesap ve gizlilik</h2>
  <p>Hesap yok. Tarayıcına rastgele bir kimlik çerezi konur; beğenilerin, aboneliklerin, geçmişin, profilin ve sohbetlerin bu kimliğe bağlı olarak sunucuda durur. Başka cihaza taşımak için senkron linkini aç (kimseyle paylaşma):</p>
  <div class="copy">${esc(me.sync_url)}</div>
  <p class="small muted" style="margin-top:8px">Video oynatıcı youtube-nocookie.com üzerinden gömülür. Arka plan sesi YouTube'dan bu sunucu üzerinden aktarılır, kaydedilmez. Sohbet mesajların yanıt üretmek için Anthropic'in Claude modeline gönderilir.</p>
  <h2 style="margin-top:20px">Emek</h2>
  <p class="small">Veri: <a href="https://hackertube.org" target="_blank" rel="noopener">HackerTube</a> (ODC-By 1.0) ve <a href="https://huggingface.co/datasets/open-index/hacker-news" target="_blank" rel="noopener">open-index/hacker-news</a>. Arayüz düzeni HackerTube'dan esinlenir; kod bu siteye aittir. Hacker News verisi Y Combinator'ındır; yorumlar yazarlarına aittir. Video başlıkları ve kanal adları sahiplerinindir. Bu site YouTube, Google, Hacker News ya da Y Combinator ile bağlantılı değildir.</p>
  </div>`;
}

route();
