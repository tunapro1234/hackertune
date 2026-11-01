"""Değerlendirme agent'ının araçları (MCP 'yt' sunucusu ve ytctl CLI aynı fonksiyonları kullanır)."""
import json
import time

import numpy as np

from . import config, db, embed, yt
from .ingest_ht import ht_quality

CONTENT_TYPES = ["talk", "lecture", "course", "documentary", "explainer", "interview", "podcast", "tutorial", "demo",
                 "news", "commentary", "comedy", "music", "other"]
LEVELS = ["general", "intro", "intermediate", "advanced"]
SHELF = ["evergreen", "dated", "news"]

_ht = None


def _ht_index():
    global _ht
    if _ht is None:
        ids, emb = embed.load_ht()
        _ht = (ids, emb)
    return _ht


def taxonomy():
    return json.load(open(config.DATA / "taxonomy.json"))


def _cat_index():
    out = {}
    for a in taxonomy()["areas"]:
        for c in a["categories"]:
            out[c["id"]] = {"id": c["id"], "name": c["name"], "area": a["id"], "area_name": a["name"]}
    return out


def tool_meta(vid):
    m = yt.video_meta(vid)
    t = yt.transcript(vid)
    chars = sum(len(x) for _, x in t["lines"])
    return {k: v for k, v in m.items() if not k.startswith("_")} | {
        "transcript": {"available": bool(t["lines"]), "lang": t["lang"], "kind": t["kind"], "chars": chars}}


def tool_transcript(vid, offset=0, max_chars=30000):
    max_chars = max(2000, min(int(max_chars or 30000), 60000))
    full = yt.transcript_text(vid)
    if not full:
        return {"available": False, "text": "", "note": "This video has no captions/transcript. Judge it from the metadata and description."}
    offset = max(0, int(offset or 0))
    chunk = full[offset:offset + max_chars]
    nxt = offset + len(chunk)
    return {"available": True, "total_chars": len(full), "offset": offset,
            "next_offset": nxt if nxt < len(full) else None, "text": chunk}


def tool_hn(vid, query=None):
    hits = yt.hn_search(query or vid)
    return {"query": query or vid, "hits": hits,
            "note": "Only HN posts/comments that link this video (Algolia)." if not query else "Free-text query results."}


def tool_similar(vid, text=None, k=8):
    con = db.connect()
    if not text:
        r = con.execute("SELECT title, channel FROM videos WHERE vid=?", (vid,)).fetchone()
        m = yt.video_meta(vid)
        text = f"{m.get('title') or (r and r['title'])}. {m.get('channel') or ''}. {(m.get('description') or '')[:600]}"
    q = embed.embed([text])[0]
    ids, emb = _ht_index()
    sims = emb @ q
    out = []
    for i in np.argsort(-sims)[: int(k or 8)]:
        r = con.execute("SELECT title, channel, card, ht, ht_score FROM videos WHERE vid=?", (ids[i],)).fetchone()
        if not r:
            continue
        card, ht = db.jload(r["card"], {}), db.jload(r["ht"], {})
        hn = ht.get("hn") or {}
        out.append({"vid": ids[i], "similarity": round(float(sims[i]), 3), "title": r["title"], "channel": r["channel"],
                    "hackertube_score": r["ht_score"], "quality_equiv_0_10": ht_quality(r["ht_score"]),
                    "recommenders": hn.get("recommenders"), "years": f"{hn.get('first_year')}-{hn.get('last_year')}",
                    "content_type": card.get("content_type"), "summary": card.get("summary"), "why_hn": card.get("why")})
    return {"query_text": text[:300], "neighbors": out,
            "note": "HackerTube videos: linked on HN by >=3 people in >=3 different months. quality_equiv = the score mapped to 0-10."}


def tool_channel(vid):
    con = db.connect()
    r = con.execute("SELECT channel, channel_id FROM videos WHERE vid=?", (vid,)).fetchone()
    name = r["channel"] if r else yt.video_meta(vid).get("channel")
    ht = con.execute("SELECT title, ht_score FROM videos WHERE source='ht' AND channel=? ORDER BY ht_score DESC",
                     (name,)).fetchall()
    ours = con.execute("SELECT title, quality, json_extract(eval,'$.verdict') verdict FROM videos "
                       "WHERE source='sub' AND channel_id=? AND status='evaluated' AND vid<>? ORDER BY updated_at DESC LIMIT 12",
                       (r["channel_id"] if r else "", vid)).fetchall()
    return {"channel": name,
            "hackertube": {"videos": len(ht), "avg_score": round(sum(x["ht_score"] for x in ht) / len(ht), 2) if ht else None,
                           "top": [{"title": x["title"], "score": x["ht_score"]} for x in ht[:8]]},
            "our_previous_evaluations": [dict(x) for x in ours]}


def tool_submit(vid, card, model=None):
    cats = _cat_index()
    errs = []
    req = ["summary", "why", "content_type", "level", "shelf_life", "primary_topic", "tags", "categories", "quality",
           "verdict", "reasoning"]
    for k in req:
        if k not in card or card[k] in (None, "", []):
            errs.append(f"'{k}' is missing")
    if errs:
        return {"ok": False, "errors": errs}
    try:
        q = float(card["quality"])
        assert 0 <= q <= 10
    except Exception:
        return {"ok": False, "errors": ["quality must be a number between 0 and 10"]}
    if card["content_type"] not in CONTENT_TYPES:
        errs.append(f"content_type must be one of: {CONTENT_TYPES}")
    if card["level"] not in LEVELS:
        errs.append(f"level must be one of: {LEVELS}")
    if card["shelf_life"] not in SHELF:
        errs.append(f"shelf_life must be one of: {SHELF}")
    bad = [c for c in card["categories"] if c not in cats]
    if bad:
        errs.append(f"unknown category id: {bad}")
    if errs:
        return {"ok": False, "errors": errs}
    hl = []
    for h in (card.get("highlights") or [])[:6]:
        try:
            hl.append({"t": int(h["t"]), "note": str(h["note"])[:200]})
        except Exception:
            pass
    stored = {
        "summary": card["summary"][:700], "why": card["why"][:400], "content_type": card["content_type"],
        "level": card["level"], "shelf_life": card["shelf_life"], "primary_topic": card["primary_topic"][:80],
        "tags": [str(t)[:40] for t in card["tags"]][:8], "categories": [cats[c] for c in card["categories"][:3]],
    }
    ev = {"verdict": str(card["verdict"])[:300], "reasoning": str(card["reasoning"])[:2500], "highlights": hl,
          "hn_signal": str(card.get("hn_signal") or "")[:400], "audience": str(card.get("audience") or "")[:300],
          "model": model, "at": time.time()}
    con = db.connect()
    with db.tx(con):
        r = con.execute("SELECT 1 FROM videos WHERE vid=?", (vid,)).fetchone()
        if not r:
            return {"ok": False, "errors": ["video is not in the DB"]}
        m = yt.video_meta(vid)
        con.execute("""UPDATE videos SET card=?, quality=?, eval=?, upload_date=COALESCE(?,upload_date),
                       duration=COALESCE(?,duration), views=COALESCE(?,views), lang=COALESCE(?,lang), updated_at=?
                       WHERE vid=?""",
                    (json.dumps(stored, ensure_ascii=False), round(q, 1), json.dumps(ev, ensure_ascii=False),
                     m.get("upload_date"), m.get("duration"), m.get("views"), m.get("language"), time.time(), vid))
    return {"ok": True, "message": "Saved. You are done; finish with one short confirmation sentence."}


TOOLS = {
    "meta": (tool_meta, "The video's YouTube metadata: title, channel, length, upload date, views/likes, language, "
                        "description, tags, chapters and whether a transcript exists (and its length).", {}),
    "transcript": (tool_transcript, "Reads the transcript as timestamped text, chunk by chunk. For long videos "
                                    "continue with next_offset.",
                   {"offset": {"type": "integer", "description": "character offset (start at 0)"},
                    "max_chars": {"type": "integer", "description": "chunk size, at most 60000"}}),
    "hn": (tool_hn, "Hacker News posts and comments (Algolia) that link this video. Optionally search the topic with a free "
                    "'query'.", {"query": {"type": "string"}}),
    "similar": (tool_similar, "The most similar HackerTube videos (what HN has recommended for years) and their scores, "
                              "for calibration. Without 'text' the title+description is used.",
                {"text": {"type": "string"}, "k": {"type": "integer"}}),
    "channel": (tool_channel, "The channel's HackerTube record (how many videos, average score) and this system's earlier "
                              "evaluations of the same channel.", {}),
    "submit": (tool_submit, "Saves the evaluation (call once). Returns a list of errors for missing/invalid fields; "
                            "fix them and call again.",
               {"card": {"type": "object", "description": "summary, why, content_type, level, shelf_life, primary_topic, "
                                                          "tags[], categories[] (taksonomi id'leri, 1-3), quality (0-10), "
                                                          "verdict, reasoning, highlights[{t,note}], hn_signal, audience"}}),
}
