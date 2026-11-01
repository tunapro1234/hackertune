"""YouTube erişimi: yalnızca yt-dlp (API anahtarı yok). RSS bu sunucudan 404 veriyor (2026-11-01)."""
import csv
import html
import io
import json
import re
import subprocess
import time
import urllib.parse
import xml.etree.ElementTree as ET

import httpx

from . import config

VID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
CID_RE = re.compile(r"(UC[A-Za-z0-9_-]{22})")
_last_call = [0.0]


def _pace(min_gap=1.5):
    # YouTube'a nazik ol: çağrılar arası en az min_gap saniye (429 almamak için)
    gap = time.time() - _last_call[0]
    if gap < min_gap:
        time.sleep(min_gap - gap)
    _last_call[0] = time.time()


def ytdlp_json(url, extra=(), timeout=120):
    _pace()
    cmd = [config.YTDLP_BIN, "--js-runtimes", "node", "--no-warnings", "-J", "--skip-download", *extra, url]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        err = (p.stderr or "").strip().splitlines()
        raise RuntimeError(err[-1][:300] if err else f"yt-dlp çıkış kodu {p.returncode}")
    return json.loads(p.stdout)


# ---------- içe aktarma ayrıştırma ----------

def parse_import(text, filename=""):
    """Takeout subscriptions.csv, OPML ya da serbest liste (URL/@handle/UC id) -> [{'ref','name'}]."""
    text = text.strip().lstrip("﻿")
    out, seen = [], set()

    def add(ref, name=""):
        ref = ref.strip()
        if not ref or ref.lower() in seen:
            return
        seen.add(ref.lower())
        out.append({"ref": ref, "name": name.strip()})

    if text.startswith("<") and ("<opml" in text[:500].lower() or "<outline" in text):
        try:
            root = ET.fromstring(text)
            for o in root.iter("outline"):
                u = o.get("xmlUrl") or o.get("htmlUrl") or ""
                m = CID_RE.search(u)
                if m:
                    add(m.group(1), o.get("title") or o.get("text") or "")
            return out
        except ET.ParseError:
            pass
    first = text.splitlines()[0].lower() if text else ""
    if "channel id" in first or "kanal kimliği" in first or (filename.endswith(".csv") and "," in first):
        rdr = csv.reader(io.StringIO(text))
        next(rdr, None)
        for row in rdr:
            if not row:
                continue
            m = CID_RE.search(",".join(row))
            if m:
                add(m.group(1), row[2] if len(row) > 2 else "")
        if out:
            return out
    for tok in re.split(r"[\s,;]+", text):
        tok = tok.strip().strip("\"'<>()[]")
        if not tok:
            continue
        m = CID_RE.search(tok)
        if m:
            add(m.group(1))
        elif tok.startswith("@") and len(tok) > 1:
            add(tok)
        elif "youtube.com/" in tok:
            u = tok if tok.startswith("http") else "https://" + tok
            p = urllib.parse.urlparse(u)
            parts = [x for x in p.path.split("/") if x]
            if parts and parts[0].startswith("@"):
                add(urllib.parse.unquote(parts[0]))
            elif len(parts) >= 2 and parts[0] in ("c", "user"):
                add(f"https://www.youtube.com/{parts[0]}/{parts[1]}")
    return out


def channel_url(ref):
    if CID_RE.fullmatch(ref):
        return f"https://www.youtube.com/channel/{ref}/videos"
    if ref.startswith("@"):
        return f"https://www.youtube.com/{urllib.parse.quote(ref)}/videos"
    return ref.rstrip("/") + "/videos"


def list_channel(ref, limit):
    """Kanalın 'Videolar' sekmesi (Shorts ve canlı yayınlar ayrı sekmede, buraya girmez)."""
    d = ytdlp_json(channel_url(ref), ["--flat-playlist", "--playlist-end", str(limit)], timeout=120)
    cid = d.get("channel_id")
    if not cid:
        m = CID_RE.search(json.dumps({k: d.get(k) for k in ("id", "channel_url", "uploader_url", "webpage_url")}))
        cid = m.group(1) if m else None
    name = d.get("channel") or d.get("uploader") or d.get("title", "").replace(" - Videos", "")
    handle = d.get("uploader_id") if (d.get("uploader_id") or "").startswith("@") else None
    vids = []
    for i, e in enumerate(d.get("entries") or []):
        vid = e.get("id")
        if not vid or not VID_RE.match(vid):
            continue
        if e.get("live_status") in ("is_upcoming", "is_live"):
            continue
        vids.append({"vid": vid, "title": e.get("title"), "duration": int(e["duration"]) if e.get("duration") else None,
                     "views": e.get("view_count"), "pos": i})
    return {"channel_id": cid, "name": name, "handle": handle, "videos": vids}


# ---------- video meta + transcript ----------

def _cache_path(vid, kind):
    return config.CACHE / f"{vid}.{kind}.json"


def video_meta(vid, refresh=False):
    p = _cache_path(vid, "meta")
    if p.exists() and not refresh:
        return json.loads(p.read_text())
    d = ytdlp_json(f"https://www.youtube.com/watch?v={vid}", timeout=150)
    caps = {}
    for kind in ("subtitles", "automatic_captions"):
        for lang, tracks in (d.get(kind) or {}).items():
            for t in tracks:
                if t.get("ext") == "json3":
                    caps.setdefault(kind, {})[lang] = t.get("url")
    meta = {
        "vid": vid, "title": d.get("title"), "channel": d.get("channel"), "channel_id": d.get("channel_id"),
        "duration": d.get("duration"), "upload_date": d.get("upload_date"), "views": d.get("view_count"),
        "likes": d.get("like_count"), "comments": d.get("comment_count"), "language": d.get("language"),
        "description": (d.get("description") or "")[:6000], "tags": (d.get("tags") or [])[:30],
        "categories": d.get("categories"), "chapters": [{"start": int(c.get("start_time") or 0), "title": c.get("title")}
                                                        for c in (d.get("chapters") or [])][:60],
        "age_limit": d.get("age_limit"), "availability": d.get("availability"), "live_status": d.get("live_status"),
        "_caps": caps, "_fetched": time.time(),
    }
    p.write_text(json.dumps(meta, ensure_ascii=False))
    return meta


def _pick_track(meta):
    caps = meta.get("_caps") or {}
    lang = (meta.get("language") or "").split("-")[0] or None
    man, auto = caps.get("subtitles", {}), caps.get("automatic_captions", {})
    prefs = [l for l in (lang, "en", "tr") if l]
    for l in prefs:  # elle yazılmış altyazı
        for k in man:
            if k == l or k.startswith(l + "-"):
                return k, man[k], "manual"
    for l in prefs:  # otomatik: videonun asıl dili ('xx-orig' ya da 'xx'), çeviri değil
        for k in (f"{l}-orig", l):
            if k in auto:
                return k, auto[k], "auto"
    return None, None, None


def transcript(vid):
    """[(saniye, metin)] satırları; yoksa []. Önbellekli."""
    p = _cache_path(vid, "tr")
    if p.exists():
        return json.loads(p.read_text())
    meta = video_meta(vid)
    lang, url, kind = _pick_track(meta)
    lines = []
    if url:
        _pace(1.0)
        r = httpx.get(url, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        ev = r.json().get("events") or []
        buf, start = [], None
        for e in ev:
            segs = e.get("segs")
            if not segs:
                continue
            t = (e.get("tStartMs") or 0) / 1000
            txt = "".join(s.get("utf8", "") for s in segs).replace("\n", " ").strip()
            if not txt:
                continue
            if start is None:
                start = t
            buf.append(txt)
            if t - start >= 20 or sum(len(b) for b in buf) > 400:
                lines.append([int(start), html.unescape(" ".join(buf))])
                buf, start = [], None
        if buf:
            lines.append([int(start or 0), html.unescape(" ".join(buf))])
    out = {"lang": lang, "kind": kind, "lines": lines}
    p.write_text(json.dumps(out, ensure_ascii=False))
    return out


def fmt_ts(s):
    s = int(s)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def transcript_text(vid, max_chars=None):
    t = transcript(vid)
    txt = "\n".join(f"[{fmt_ts(s)}] {x}" for s, x in t["lines"])
    if max_chars and len(txt) > max_chars:
        half = max_chars // 2
        txt = txt[:half] + "\n[... orta kısım kısaltıldı ...]\n" + txt[-half:]
    return txt


# ---------- Hacker News (Algolia) ----------

def hn_search(vid, limit=12):
    r = httpx.get("https://hn.algolia.com/api/v1/search", params={"query": vid, "hitsPerPage": limit}, timeout=30)
    r.raise_for_status()
    out = []
    for h in r.json().get("hits", []):
        tags = h.get("_tags") or []
        kind = "story" if "story" in tags else "comment" if "comment" in tags else "other"
        text = h.get("comment_text") or h.get("story_text") or ""
        text = html.unescape(re.sub(r"<[^>]+>", " ", text))
        text = re.sub(r"\s+", " ", text).strip()
        url = h.get("url") or ""
        if vid not in (url + text + (h.get("comment_text") or "")):
            continue  # Algolia bulanık eşleşmesi; gerçekten bu videoyu linklemeyenleri at
        out.append({"kind": kind, "id": h.get("objectID"), "author": h.get("author"),
                    "date": (h.get("created_at") or "")[:10], "points": h.get("points"),
                    "num_comments": h.get("num_comments"), "title": h.get("title") or h.get("story_title"),
                    "text": text[:900]})
    return out


def player_info(vid):
    """Hafif metadata (innertube player, ~10 KB): süre, yayın tarihi, izlenme; silinmişse {'gone': True}."""
    _pace(2.5)
    r = httpx.post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", timeout=30,
                   json={"videoId": vid, "context": {"client": {"clientName": "WEB", "clientVersion": "2.20250101.00.00",
                                                                "hl": "en"}}})
    r.raise_for_status()
    d = r.json()
    vd = d.get("videoDetails") or {}
    ps = (d.get("playabilityStatus") or {}).get("status")
    if not vd:
        return {"gone": ps == "ERROR", "status": ps}
    mf = (d.get("microformat") or {}).get("playerMicroformatRenderer") or {}
    pub = (mf.get("publishDate") or mf.get("uploadDate") or "")[:10].replace("-", "")
    return {"gone": False, "status": ps, "duration": int(vd.get("lengthSeconds") or 0) or None,
            "views": int(vd.get("viewCount") or 0) or None, "upload_date": pub or None,
            "is_live": bool(vd.get("isLiveContent"))}
