"""HackerTune web sunucusu (FastAPI). 127.0.0.1:3030, önünde nginx."""
import asyncio
import hashlib
import json
import secrets
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

import re
from urllib.parse import parse_qs, quote, urlparse

import httpx

from . import agents, chat, config, db, llm, reco, showcase, tools, yt
from .pipeline import get_profile

db.init()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=config.STATIC), name="static")
PUBLIC = config.PUBLIC_URL


def _uid_of(tok):
    return hashlib.sha256(tok.encode()).hexdigest()[:32]


@app.middleware("http")
async def identity(request: Request, call_next):
    tok = request.cookies.get(config.COOKIE)
    host = (request.headers.get("host") or "").split(":")[0].lower()
    if host in config.OLD_HOSTS:
        path = request.url.path + (("?" + request.url.query) if request.url.query else "")
        if request.method == "GET" and tok and 20 <= len(tok) <= 100 and not path.startswith("/api/"):
            return RedirectResponse(f"{PUBLIC}/s/{tok}?next={quote(path, safe='')}", status_code=302)
        return RedirectResponse(PUBLIC + path, status_code=301 if request.method == "GET" else 308)
    new = False
    if not tok or len(tok) < 20 or len(tok) > 100:
        tok, new = secrets.token_urlsafe(24), True
    request.state.tok = tok
    request.state.uid = _uid_of(tok)
    if request.method in ("POST", "PUT", "DELETE"):
        origin = request.headers.get("origin")
        if origin and origin not in (PUBLIC, f"http://127.0.0.1:{config.PORT}", f"http://localhost:{config.PORT}"):
            return JSONResponse({"error": "origin"}, status_code=403)
    resp = await call_next(request)
    if new:
        resp.set_cookie(config.COOKIE, tok, max_age=2 * 365 * 86400, httponly=True, samesite="lax",
                        secure=request.headers.get("x-forwarded-proto") == "https")
    return resp


def con_user(request):
    con = db.connect()
    uid = request.state.uid
    con.execute("""INSERT INTO users(uid,created_at,last_seen,profile,profile_version) VALUES(?,?,?,NULL,0)
                   ON CONFLICT(uid) DO UPDATE SET last_seen=excluded.last_seen""", (uid, time.time(), time.time()))
    return con, uid


# ---------------- sayfalar ----------------

INDEX = config.STATIC / "index.html"


@app.get("/")
@app.get("/showcase")
@app.get("/subscriptions")
@app.get("/algorithm")
@app.get("/library")
@app.get("/about")
@app.get("/history")
@app.get("/topics")
@app.get("/search")
@app.get("/abonelikler")
@app.get("/algoritma")
@app.get("/liste")
@app.get("/hakkinda")
@app.get("/gecmis")
@app.get("/kategoriler")
@app.get("/ara")
@app.get("/v/{vid}")
async def spa(request: Request, vid: str = None):
    return FileResponse(INDEX, headers={"Cache-Control": "no-cache"})


@app.get("/s/{tok}")
async def sync_link(tok: str, next: str = "/"):
    if not (20 <= len(tok) <= 100):
        raise HTTPException(400)
    if not next.startswith("/") or next.startswith("//") or "\\" in next:
        next = "/"
    r = RedirectResponse(next, status_code=303)
    r.set_cookie(config.COOKIE, tok, max_age=2 * 365 * 86400, httponly=True, samesite="lax", secure=True)
    return r


@app.get("/healthz")
async def healthz():
    con = db.connect()
    hb = db.kv_get(con, "worker_heartbeat", 0) or 0
    return {"ok": True, "worker_age_s": round(time.time() - hb)}


# ---------------- API ----------------

@app.get("/api/me")
async def me(request: Request):
    con, uid = con_user(request)
    n = lambda q: con.execute(q, (uid,)).fetchone()[0]
    return {"sync_url": f"{PUBLIC}/s/{request.state.tok}", "uid": uid[:8],
            "channels": n("SELECT COUNT(*) FROM user_channels WHERE uid=?"),
            "liked": n("SELECT COUNT(*) FROM user_video WHERE uid=? AND rating>0"),
            "later": n("SELECT COUNT(*) FROM user_video WHERE uid=? AND later=1"),
            "profile": chat.prof_public(get_profile(con, uid))}


@app.get("/api/areas")
async def areas():
    ix = reco.index()
    cnt = {}
    for m in ix.metas:
        for a in m["areas"]:
            cnt[a] = cnt.get(a, 0) + 1
    return [{"id": a["id"], "name": a["name"], "count": cnt.get(a["id"], 0),
             "categories": [{"id": c["id"], "name": c["name"]} for c in a["categories"]]} for a in tools.taxonomy()["areas"]]


@app.get("/api/feed")
async def feed(request: Request, page: int = 0, seed: str = "0", area: str = None):
    con, uid = con_user(request)
    return await asyncio.to_thread(reco.build_feed, con, uid, max(0, min(page, 40)), seed[:20], area or None)


@app.get("/api/search")
async def search(request: Request, q: str):
    con, uid = con_user(request)
    if not q.strip():
        return {"items": []}
    return {"items": await asyncio.to_thread(reco.search, con, uid, q[:200])}


@app.get("/api/search/youtube")
async def search_youtube(request: Request, q: str):
    con, uid = con_user(request)
    if not q.strip():
        return {"items": []}
    try:
        items = await asyncio.to_thread(yt.youtube_search, q[:200])
    except Exception as e:
        raise HTTPException(502, f"YouTube search failed: {str(e)[:200]}")
    known = {r["vid"]: r for r in con.execute(
        f"SELECT vid, source, quality FROM videos WHERE vid IN ({','.join('?' * len(items))})", [i["vid"] for i in items])} if items else {}
    for i in items:  # already in the catalog: say so (same card, but with its score)
        k = known.get(i["vid"])
        if k and k["source"] in ("ht", "sub"):
            i["source"], i["quality"] = k["source"], k["quality"]
    return {"items": items}


def _add_outside_video(con, vid):
    """A video opened from YouTube search or a pasted link: fetch its metadata once and keep it as source='search'
    (outside the feed and the catalog index; it gets history, chat and background audio like any other video)."""
    m = yt.video_meta(vid)
    if not m.get("title"):
        raise RuntimeError("no metadata")
    now = time.time()
    with db.tx(con):
        con.execute("""INSERT OR IGNORE INTO videos(vid,source,title,channel,channel_id,duration,views,upload_date,status,
                       attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,0,?,?)""",
                    (vid, "search", m["title"], m.get("channel"), m.get("channel_id"), m.get("duration"), m.get("views"),
                     m.get("upload_date"), "search", now, now))


@app.get("/api/video/{vid}")
async def video(request: Request, vid: str):
    if not yt.VID_RE.match(vid):
        raise HTTPException(404)
    con, uid = con_user(request)
    r = con.execute("SELECT * FROM videos WHERE vid=?", (vid,)).fetchone()
    if not r:
        try:
            await asyncio.to_thread(_add_outside_video, con, vid)
        except Exception:
            raise HTTPException(404, "Couldn't load this video from YouTube (private, removed or region-locked?)")
        r = con.execute("SELECT * FROM videos WHERE vid=?", (vid,)).fetchone()
    ments = [dict(m) for m in con.execute(
        """SELECT hn_comment_id, author, month, story_title, stance, why, quote, text FROM mentions WHERE vid=?
           ORDER BY CASE stance WHEN 'strong_rec' THEN 0 WHEN 'rec' THEN 1 WHEN 'critical' THEN 2 ELSE 3 END, month DESC""",
        (vid,))]
    st = con.execute("SELECT * FROM user_video WHERE uid=? AND vid=?", (uid, vid)).fetchone()
    cid = chat.get_chat(con, uid, "video", vid) if con.execute(
        "SELECT 1 FROM chats WHERE uid=? AND kind='video' AND vid=?", (uid, vid)).fetchone() else None
    return {
        "vid": vid, "source": r["source"], "title": r["title"], "channel": r["channel"], "channel_id": r["channel_id"],
        "duration": r["duration"], "views": r["views"], "upload_date": r["upload_date"], "status": r["status"],
        "quality": r["quality"], "card": db.jload(r["card"], {}), "ht": db.jload(r["ht"], None),
        "eval": db.jload(r["eval"], None), "triage": db.jload(r["triage"], None), "mentions": ments,
        "related": (await asyncio.to_thread(reco.similar, vid)) or (await asyncio.to_thread(
            reco.similar_text, f"{r['title'] or ''} {r['channel'] or ''}", 10, (vid,))),
        "state": dict(st) if st else {}, "chat": chat.messages(con, cid) if cid else [],
    }


@app.post("/api/video/{vid}/state")
async def video_state(request: Request, vid: str):
    con, uid = con_user(request)
    b = await request.json()
    if not con.execute("SELECT 1 FROM videos WHERE vid=?", (vid,)).fetchone():
        raise HTTPException(404)
    con.execute("INSERT OR IGNORE INTO user_video(uid,vid) VALUES(?,?)", (uid, vid))
    now = time.time()
    if "rating" in b:
        con.execute("UPDATE user_video SET rating=?, rated_at=? WHERE uid=? AND vid=?",
                    (max(-1, min(1, int(b["rating"]))), now, uid, vid))
    if "later" in b:
        con.execute("UPDATE user_video SET later=?, later_at=? WHERE uid=? AND vid=?", (1 if b["later"] else 0, now, uid, vid))
    if "hidden" in b:
        con.execute("UPDATE user_video SET hidden=? WHERE uid=? AND vid=?", (1 if b["hidden"] else 0, uid, vid))
    if "watched" in b:
        con.execute("UPDATE user_video SET watched_at=? WHERE uid=? AND vid=?", (now if b["watched"] else None, uid, vid))
    st = con.execute("SELECT * FROM user_video WHERE uid=? AND vid=?", (uid, vid)).fetchone()
    return dict(st)


@app.get("/api/list/{kind}")
async def lists(request: Request, kind: str):
    con, uid = con_user(request)
    q = {"later": "x.later=1 ORDER BY x.later_at DESC", "liked": "x.rating>0 ORDER BY x.rated_at DESC",
         "history": "(x.seen_at IS NOT NULL OR x.watched_at IS NOT NULL) ORDER BY COALESCE(x.seen_at, x.watched_at) DESC",
         "hidden": "(x.hidden=1 OR x.rating<0) ORDER BY x.rated_at DESC"}.get(kind)
    if not q:
        raise HTTPException(404)
    rows = con.execute(f"SELECT x.vid, x.pos, x.dur, x.seen_at, x.watched_at, x.watch_s FROM user_video x "
                       f"WHERE x.uid=? AND {q} LIMIT 300", (uid,)).fetchall()
    metas = showcase._metas(con, [r["vid"] for r in rows])  # indeks dışı videolar (vitrin seçkileri) dahil
    out = []
    for r in rows:
        if r["vid"] in metas:
            c = reco.card_out(metas[r["vid"]])
            c.update({"pos": r["pos"], "dur": r["dur"], "seen_at": r["seen_at"] or r["watched_at"], "watch_s": r["watch_s"]})
            out.append(c)
    return {"items": out}


# ---------------- vitrin (küratör agent'ının rafları) ----------------

@app.get("/api/showcase")
async def showcase_get(request: Request):
    con, uid = con_user(request)
    return await asyncio.to_thread(showcase.get, con, uid)


@app.post("/api/showcase/refresh")
async def showcase_refresh(request: Request):
    con, uid = con_user(request)
    return showcase.refresh(con, uid)


@app.delete("/api/history/{vid}")
async def history_forget(request: Request, vid: str):
    con, uid = con_user(request)
    con.execute("UPDATE user_video SET seen_at=NULL, watched_at=NULL, pos=NULL, watch_s=NULL WHERE uid=? AND vid=?",
                (uid, vid))
    return {"ok": True}


@app.post("/api/video/{vid}/progress")
async def video_progress(request: Request, vid: str):
    """İzleme geçmişi: oynatıcı (video ya da arka plan sesi) ~15 sn'de bir konum + izlenen süre gönderir."""
    con, uid = con_user(request)
    b = await request.json()
    if not con.execute("SELECT 1 FROM videos WHERE vid=?", (vid,)).fetchone():
        raise HTTPException(404)
    now = time.time()
    pos = max(0.0, float(b.get("pos") or 0))
    dur = float(b.get("dur") or 0) or None
    delta = max(0.0, min(120.0, float(b.get("delta") or 0)))  # bu aralıkta gerçekten oynayan saniye
    mode = "audio" if b.get("mode") == "audio" else "video"
    sid = str(b.get("session") or "")[:40]
    hid = max(0.0, min(delta, float(b.get("hidden") or 0)))  # bu aralıkta sayfa gizliyken (ekran kapalı) çalan saniye
    ua = (request.headers.get("user-agent") or "")[:160]
    con.execute("INSERT OR IGNORE INTO user_video(uid,vid) VALUES(?,?)", (uid, vid))
    con.execute("""UPDATE user_video SET pos=?, dur=COALESCE(?,dur), seen_at=?, watch_s=COALESCE(watch_s,0)+? WHERE uid=? AND vid=?""",
                (pos, dur, now, delta, uid, vid))
    st = con.execute("SELECT watch_s, dur, watched_at FROM user_video WHERE uid=? AND vid=?", (uid, vid)).fetchone()
    if not st["watched_at"] and ((st["watch_s"] or 0) >= 30 or (st["dur"] and pos / st["dur"] > 0.5)):
        con.execute("UPDATE user_video SET watched_at=? WHERE uid=? AND vid=?", (now, uid, vid))
    w = con.execute("SELECT id FROM watch WHERE uid=? AND vid=? AND mode=? AND updated_at>? ORDER BY id DESC LIMIT 1",
                    (uid, vid, mode, now - 1800)).fetchone() if sid else None
    if w:
        con.execute("UPDATE watch SET updated_at=?, pos=?, dur=COALESCE(?,dur), seconds=seconds+?, "
                    "hidden_s=COALESCE(hidden_s,0)+?, ua=? WHERE id=?", (now, pos, dur, delta, hid, ua, w["id"]))
    else:
        con.execute("INSERT INTO watch(uid,vid,mode,started_at,updated_at,pos,dur,seconds,hidden_s,ua) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)", (uid, vid, mode, now, now, pos, dur, delta, hid, ua))
    return {"ok": True}


# ---------------- arka planda dinleme (ses akışı vekili) ----------------
# Telefonda ekran kilitlenince YouTube iframe'i durur; <audio> öğesi ise çalmaya devam eder. Ses akışının adresi
# sunucunun IP'sine bağlı olduğu için tarayıcıya doğrudan verilemez; buradan parça parça (Range) aktarılır.

_AU = {}
_AU_LOCK = asyncio.Lock()
FORMATS = {"m4a": ("140/139/bestaudio[ext=m4a]", "audio/mp4"), "webm": ("251/250/249/bestaudio[ext=webm]", "audio/webm")}
CHUNK = 4 * 1024 * 1024
_http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=60.0), follow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                                                 "Chrome/124.0 Safari/537.36"})


async def _audio_src(vid, fmt, fresh=False):
    k = (vid, fmt)
    c = _AU.get(k)
    if c and not fresh and c["exp"] - time.time() > 900:
        return c
    async with _AU_LOCK:
        c = _AU.get(k)
        if c and not fresh and c["exp"] - time.time() > 900:
            return c
        proc = await asyncio.create_subprocess_exec(
            config.YTDLP_BIN, "--js-runtimes", "node", "--no-warnings", "--no-playlist", "-f", FORMATS[fmt][0], "-g",
            f"https://www.youtube.com/watch?v={vid}", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), 60)
        except asyncio.TimeoutError:
            proc.kill()
            raise HTTPException(504, "Timed out getting the YouTube audio URL")
        url = out.decode().strip().splitlines()[0] if out.strip() else ""
        if not url.startswith("http"):
            raise HTTPException(502, "Could not get the audio stream: " + err.decode()[-200:])
        q = parse_qs(urlparse(url).query)
        clen = int(q["clen"][0]) if "clen" in q else None
        if not clen:
            h = await _http.head(url)
            clen = int(h.headers.get("content-length") or 0)
        c = {"url": url, "clen": clen, "exp": int(q.get("expire", [time.time() + 3600])[0]),
             "dur": float(q["dur"][0]) if "dur" in q else None}
        _AU[k] = c
        if len(_AU) > 300:
            for kk in sorted(_AU, key=lambda x: _AU[x]["exp"])[:100]:
                _AU.pop(kk, None)
        return c


@app.get("/api/audio/{vid}.{fmt}")
async def audio(request: Request, vid: str, fmt: str):
    if not yt.VID_RE.match(vid) or fmt not in FORMATS:
        raise HTTPException(404)
    con = db.connect()
    if not con.execute("SELECT 1 FROM videos WHERE vid=?", (vid,)).fetchone():
        raise HTTPException(404, "This video is not in the catalog")
    src = await _audio_src(vid, fmt)
    total = src["clen"]
    start, end = 0, total - 1
    m = re.match(r"bytes=(\d*)-(\d*)", request.headers.get("range", ""))
    if m:
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else total - 1
        elif m.group(2):  # son N bayt
            start = max(0, total - int(m.group(2)))
    if start >= total:
        return JSONResponse({"error": "range"}, status_code=416, headers={"Content-Range": f"bytes */{total}"})
    end = min(end, total - 1, start + CHUNK - 1)  # googlevideo büyük tek isteği yavaşlatır; parça parça ver

    async def fetch(s):
        req = _http.build_request("GET", s["url"], headers={"Range": f"bytes={start}-{end}"})
        return await _http.send(req, stream=True)

    up = await fetch(src)
    if up.status_code in (403, 410):  # adres düştü: tazele
        await up.aclose()
        src = await _audio_src(vid, fmt, fresh=True)
        up = await fetch(src)
    if up.status_code not in (200, 206):
        await up.aclose()
        raise HTTPException(502, f"YouTube {up.status_code}")

    async def body():
        try:
            async for chunk in up.aiter_bytes(64 * 1024):
                yield chunk
        finally:
            await up.aclose()

    return StreamingResponse(body(), status_code=206, media_type=FORMATS[fmt][1], headers={
        "Content-Range": f"bytes {start}-{end}/{total}", "Content-Length": str(end - start + 1),
        "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"})


# ---------------- abonelikler ----------------

@app.post("/api/import")
async def do_import(request: Request):
    con, uid = con_user(request)
    b = await request.json()
    text = str(b.get("text") or "")
    if len(text) > 3_000_000:
        raise HTTPException(413, "file too large")
    items = yt.parse_import(text, str(b.get("filename") or ""))
    if not items:
        return JSONResponse({"error": "No channels found in that list. Paste a Takeout subscriptions.csv, an OPML "
                                      "file, or channel links / @handles."}, status_code=400)
    if con.execute("SELECT 1 FROM imports WHERE uid=? AND status IN ('pending','running')", (uid,)).fetchone():
        return JSONResponse({"error": "Your previous import is still running."}, status_code=409)
    have = {r["channel_id"] for r in con.execute("SELECT channel_id FROM user_channels WHERE uid=?", (uid,))}
    items = [i for i in items if i["ref"] not in have][: config.MAX_CHANNELS_PER_USER]
    cur = con.execute("INSERT INTO imports(uid,created_at,status,total,done,log,items) VALUES(?,?,?,?,0,'[]',?)",
                      (uid, time.time(), "pending", len(items), json.dumps(items, ensure_ascii=False)))
    return {"id": cur.lastrowid, "total": len(items)}


@app.get("/api/import/{iid}")
async def import_status(request: Request, iid: int):
    con, uid = con_user(request)
    r = con.execute("SELECT id,status,total,done,log,created_at FROM imports WHERE id=? AND uid=?", (iid, uid)).fetchone()
    if not r:
        raise HTTPException(404)
    d = dict(r)
    d["log"] = db.jload(d["log"], [])
    return d


@app.delete("/api/subs/{cid}")
async def unsub(request: Request, cid: str):
    con, uid = con_user(request)
    con.execute("DELETE FROM user_channels WHERE uid=? AND channel_id=?", (uid, cid))
    return {"ok": True}


@app.get("/api/subs")
async def subs(request: Request):
    con, uid = con_user(request)
    chans = [dict(r) for r in con.execute("""
        SELECT c.channel_id, c.name, c.handle, c.ht_count, c.last_fetched, c.fetch_error,
          (SELECT COUNT(*) FROM videos v WHERE v.channel_id=c.channel_id AND v.source='sub') n_videos,
          (SELECT COUNT(*) FROM videos v WHERE v.channel_id=c.channel_id AND v.status='evaluated') n_eval,
          (SELECT COUNT(*) FROM videos v WHERE v.channel_id=c.channel_id AND v.status='evaluated' AND v.quality>=?) n_pass,
          (SELECT COUNT(*) FROM videos v WHERE v.channel_id=c.channel_id AND v.status IN ('new','triage_pass','evaluating')) n_queue,
          (SELECT ROUND(AVG(v.quality),1) FROM videos v WHERE v.channel_id=c.channel_id AND v.status='evaluated') avg_q
        FROM user_channels u JOIN channels c ON c.channel_id=u.channel_id WHERE u.uid=? ORDER BY c.name COLLATE NOCASE""",
        (config.QUALITY_THRESHOLD, uid))]
    recent = []
    for r in con.execute("""
        SELECT v.vid, v.title, v.channel, v.status, v.quality, v.triage, v.eval, v.duration, v.updated_at, x.fit, x.fit_reason
        FROM videos v JOIN user_channels u ON u.channel_id=v.channel_id AND u.uid=?
        LEFT JOIN user_video x ON x.uid=u.uid AND x.vid=v.vid
        WHERE v.source='sub' ORDER BY CASE v.status WHEN 'evaluating' THEN 0 WHEN 'evaluated' THEN 1 ELSE 2 END,
          v.updated_at DESC LIMIT 120""", (uid,)):
        ev = db.jload(r["eval"], {}) or {}
        tr = db.jload(r["triage"], {}) or {}
        recent.append({"vid": r["vid"], "title": r["title"], "channel": r["channel"], "status": r["status"],
                       "quality": r["quality"], "duration": r["duration"], "verdict": ev.get("verdict"),
                       "triage": tr.get("reason"), "tools": ev.get("tools"), "cost": ev.get("cost_usd"),
                       "fit": r["fit"] if r["fit"] is not None and r["fit"] >= 0 else None, "fit_reason": r["fit_reason"]})
    imp = [dict(r) | {"log": db.jload(r["log"], [])} for r in con.execute(
        "SELECT id,status,total,done,log,created_at FROM imports WHERE uid=? ORDER BY id DESC LIMIT 3", (uid,))]
    return {"channels": chans, "recent": recent, "imports": imp, "pipeline": pipeline_stats(con)}


def pipeline_stats(con):
    st = {r["status"]: r["n"] for r in con.execute("SELECT status, COUNT(*) n FROM videos WHERE source='sub' GROUP BY status")}
    ev_usd, _ = db.spent(con, ["triage", "deep", "fit"])
    ch_usd, _ = db.spent(con, ["chat"])
    _, deep_n = db.spent(con, ["deep"])
    hb = db.kv_get(con, "worker_heartbeat", 0) or 0
    events = [dict(r) for r in con.execute("SELECT ts, stage, vid, msg, usd FROM events ORDER BY id DESC LIMIT 25")]
    return {"status": st, "eval_usd": round(ev_usd, 3), "eval_cap": config.BUDGET_EVAL_USD_DAY,
            "chat_usd": round(ch_usd, 3), "chat_cap": config.BUDGET_CHAT_USD_DAY, "deep_today": deep_n,
            "deep_cap": config.DEEP_MAX_PER_DAY, "worker_alive": time.time() - hb < 120, "events": events,
            "threshold": config.QUALITY_THRESHOLD, "backend": config.BACKEND,
            "agents": agents.summary(con) if config.BACKEND == "agents" else []}


@app.get("/api/pipeline")
async def pipeline_api():
    return pipeline_stats(db.connect())


# ---------------- profil + sohbet ----------------

@app.get("/api/profile")
async def profile_get(request: Request):
    con, uid = con_user(request)
    p = get_profile(con, uid)
    return chat.prof_public(p) | {"changelog": list(reversed(p.get("changelog") or []))[:20], "pools":
                                  {k: v[0] for k, v in reco.POOLS.items()}}


@app.put("/api/profile")
async def profile_put(request: Request):
    con, uid = con_user(request)
    try:
        ch = chat.apply_profile(con, uid, await request.json(), "manual")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"changes": ch or []}


@app.get("/api/chat")
async def chat_get(request: Request, kind: str, vid: str = None):
    con, uid = con_user(request)
    r = con.execute("SELECT id FROM chats WHERE uid=? AND kind=? AND vid IS ? ORDER BY id DESC LIMIT 1",
                    (uid, kind, vid)).fetchone()
    return {"messages": chat.messages(con, r["id"]) if r else []}


@app.post("/api/chat/new")
async def chat_new(request: Request):
    con, uid = con_user(request)
    b = await request.json()
    chat.get_chat(con, uid, b.get("kind", "video"), b.get("vid"), new=True)
    return {"ok": True}


def sse(obj):
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.post("/api/chat")
async def chat_post(request: Request):
    con, uid = con_user(request)
    b = await request.json()
    kind, vid, text = b.get("kind"), b.get("vid"), str(b.get("text") or "").strip()[:4000]
    if kind not in ("video", "steer") or not text:
        raise HTTPException(400)
    if kind == "video" and not (vid and con.execute("SELECT 1 FROM videos WHERE vid=?", (vid,)).fetchone()):
        raise HTTPException(404)
    err = chat.rate_check(con, uid)
    if err:
        return StreamingResponse(iter([sse({"t": "error", "x": err})]), media_type="text/event-stream")
    cid = chat.get_chat(con, uid, kind, vid if kind == "video" else None)
    hist = chat.messages(con, cid)
    con.execute("INSERT INTO messages(chat_id,role,content,created_at) VALUES(?,?,?,?)", (cid, "user", text, time.time()))

    async def gen():
        yield sse({"t": "status", "x": "Preparing context…"})
        if kind == "video":
            ctx = await chat.video_context(con, vid)
            system = chat.VIDEO_SYSTEM
        else:
            ctx = await asyncio.to_thread(chat.steer_context, con, uid)
            system = chat.STEER_SYSTEM
        prof = chat.prof_public(get_profile(con, uid))
        prompt = (f"{ctx}\n<current_profile>\n{json.dumps(prof, ensure_ascii=False)}\n</current_profile>\n"
                  if kind == "video" else ctx + "\n")
        if hist:
            prompt += f"<conversation_so_far>\n{chat._history_text(hist)}\n</conversation_so_far>\n"
        prompt += f"\nUSER: {text}"
        full, usd = "", 0.0
        try:
            async for ev, x in llm.stream(prompt, system, config.MODEL_CHAT, effort="low"):
                if ev == "delta":
                    full += x
                    yield sse({"t": "delta", "x": x})
                else:
                    full, usd = x["text"], x["usd"]
        except Exception as e:
            yield sse({"t": "error", "x": f"The model could not answer: {str(e)[:200]}"})
            return
        changes = None
        m = chat.TAG_RE.search(full)
        visible = chat.TAG_RE.sub("", full).strip()
        if m:
            try:
                changes = chat.apply_profile(con, uid, json.loads(m.group(1)), "chat" if kind == "steer" else "video chat")
            except Exception as e:
                changes = [f"(profile could not be updated: {e})"]
        meta = {"usd": round(usd, 4), "profile_changes": changes}
        con.execute("INSERT INTO messages(chat_id,role,content,meta,created_at) VALUES(?,?,?,?,?)",
                    (cid, "assistant", visible, json.dumps(meta, ensure_ascii=False), time.time()))
        db.add_spend(con, "chat", usd, 1)
        yield sse({"t": "done", "x": visible, "changes": changes})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
