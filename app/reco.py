"""Öneri motoru: HackerTube tarzı havuz karışımı + abonelik havuzu + konuşarak yönlendirilen profil.

Her havuz kendi sıralı listesini ve "neden burada" cümlesini üretir; akış, ağırlıklı round-robin ile
havuzları karıştırır. Profil: 'more' / 'less' konuları gömülür (bge-small) ve tüm adaylara benzerlik
olarak uygulanır; beğenilen/beğenilmeyen videolar da aynı şekilde sinyal olur.
"""
import json
import random
import threading
import time
from functools import lru_cache

import numpy as np

from . import config, db, embed
from .ingest_ht import ht_quality

POOLS = {
    "subs": ("Your subscriptions", 0.30),
    "foryou": ("For you", 0.22),
    "cohort": ("Same HN crowd", 0.10),
    "classics": ("Classics", 0.12),
    "gems": ("Hidden gems", 0.09),
    "fresh": ("New favorites", 0.09),
    "explore": ("Explore", 0.06),
    "community": ("From the community", 0.05),
}


def meta_of(r):
    """videos satırı -> öneri motorunun video sözlüğü (Index ve vitrin aynı biçimi kullanır)."""
    card = db.jload(r["card"], {}) or {}
    ht = db.jload(r["ht"], {}) or {}
    ev = db.jload(r["eval"], {}) or {}
    hn = ht.get("hn") or {}
    return {
        "vid": r["vid"], "source": r["source"], "title": r["title"], "channel": r["channel"],
        "channel_id": r["channel_id"], "duration": r["duration"], "upload_date": r["upload_date"],
        "views": r["views"], "quality": r["quality"] if r["quality"] is not None else
        (ht_quality(r["ht_score"]) if r["source"] == "ht" else None),
        "ht_score": r["ht_score"], "hn": hn, "quote": ht.get("quote"), "summary": card.get("summary"),
        "why": card.get("why"), "content_type": card.get("content_type"), "level": card.get("level"),
        "shelf_life": card.get("shelf_life"), "topic": card.get("primary_topic"),
        "cats": [c["id"] for c in card.get("categories") or []],
        "cat_names": [c["name"] for c in card.get("categories") or []],
        "areas": list(dict.fromkeys(c["area"] for c in card.get("categories") or [])),
        "verdict": ev.get("verdict"),
    }


class Index:
    def __init__(self):
        self.lock = threading.Lock()
        self.loaded_at = 0
        self.version = None
        self.load()

    def load(self):
        con = db.connect()
        ids, ht_emb = embed.load_ht()
        ht_row = {v: i for i, v in enumerate(ids)}
        rows = con.execute("""SELECT vid, source, title, channel, channel_id, duration, upload_date, views, card, ht, ht_score, quality,
                              status, emb, eval, triage FROM videos WHERE (source='ht' AND status='ht') OR (source='sub' AND status='evaluated'
                              AND emb IS NOT NULL)""").fetchall()
        vids, metas, embs = [], [], []
        for r in rows:
            if r["source"] == "ht":
                i = ht_row.get(r["vid"])
                if i is None:
                    continue
                e = ht_emb[i]
            else:
                e = np.frombuffer(r["emb"], dtype=np.float32)
            metas.append(meta_of(r))
            vids.append(r["vid"])
            embs.append(e)
        rel = {r["vid"]: json.loads(r["related"]) for r in con.execute("SELECT vid, related FROM related")}
        with self.lock:
            self.vids, self.metas = vids, metas
            self.row = {v: i for i, v in enumerate(vids)}
            self.E = np.vstack(embs).astype(np.float32)
            self.related = rel
            self.quality = np.array([m["quality"] or 0 for m in metas], dtype=np.float32)
            self.is_ht = np.array([m["source"] == "ht" for m in metas])
            self.news = np.array([m["shelf_life"] == "news" for m in metas])
            self.loaded_at = self.built_at = time.time()
            self.version = db.kv_get(con, "emb_version")

    def maybe_reload(self):
        if time.time() - self.loaded_at < 20:
            return
        con = db.connect()
        v = db.kv_get(con, "emb_version")
        if v != self.version or time.time() - self.built_at > 600:  # süre/silinme bilgisi yavaşça dolduğu için 10 dk'da bir
            self.load()
        else:
            self.loaded_at = time.time()


_index = None
_ilock = threading.Lock()


def index():
    global _index
    with _ilock:
        if _index is None:
            _index = Index()
    _index.maybe_reload()
    return _index


@lru_cache(maxsize=4096)
def _topic_vec(text):
    return embed.embed([text])[0]


def user_ctx(con, uid):
    from .pipeline import get_profile
    prof = get_profile(con, uid)
    uv = con.execute("SELECT vid, rating, later, hidden, watched_at, fit, fit_reason FROM user_video WHERE uid=?", (uid,)).fetchall()
    chans = {r["channel_id"] for r in con.execute("SELECT channel_id FROM user_channels WHERE uid=?", (uid,))}
    ctx = {"profile": prof, "channels": chans, "liked": [], "disliked": [], "seen": set(), "fit": {}, "later": set()}
    for r in uv:
        if r["rating"] > 0:
            ctx["liked"].append(r["vid"])
        if r["rating"] < 0:
            ctx["disliked"].append(r["vid"])
        if r["watched_at"] or r["hidden"] or r["rating"] < 0:
            ctx["seen"].add(r["vid"])
        if r["later"]:
            ctx["later"].add(r["vid"])
        if r["fit"] is not None and r["fit"] >= 0:
            ctx["fit"][r["vid"]] = (r["fit"], r["fit_reason"])
    return ctx


def _signals(ix, ctx):
    """pozitif/negatif vektörler ve etiketleri."""
    pos, pos_lab, neg, neg_lab = [], [], [], []
    for t in ctx["profile"].get("more") or []:
        pos.append(_topic_vec(t)); pos_lab.append(("topic", t))
    for v in ctx["liked"][-40:]:
        if v in ix.row:
            pos.append(ix.E[ix.row[v]]); pos_lab.append(("liked", ix.metas[ix.row[v]]["title"]))
    about = (ctx["profile"].get("about") or "").strip()
    if about:
        pos.append(_topic_vec(about[:500])); pos_lab.append(("about", "your profile"))
    for t in ctx["profile"].get("less") or []:
        neg.append(_topic_vec(t)); neg_lab.append(t)
    for v in ctx["disliked"][-40:]:
        if v in ix.row:
            neg.append(ix.E[ix.row[v]]); neg_lab.append(ix.metas[ix.row[v]]["title"])
    return pos, pos_lab, neg, neg_lab


def _recency_bonus(upload_date):
    if not upload_date:
        return 0.0
    try:
        days = (time.time() - time.mktime(time.strptime(upload_date, "%Y%m%d"))) / 86400
    except Exception:
        return 0.0
    return 1.5 if days < 14 else 0.8 if days < 60 else 0.3 if days < 365 else 0.0


def build_feed(con, uid, page=0, seed=None, area=None, per_page=24):
    ix = index()
    ctx = user_ctx(con, uid)
    prof = ctx["profile"]
    prefs = prof.get("prefs") or {}
    rng = random.Random(f"{uid}:{seed}")
    N = len(ix.vids)
    pos, pos_lab, neg, neg_lab = _signals(ix, ctx)
    interest = np.zeros(N, dtype=np.float32)
    best_pos = np.full(N, -1, dtype=np.int32)
    if pos:
        S = ix.E @ np.vstack(pos).T
        best_pos = S.argmax(1)
        raw = S.max(1)
        interest = np.clip((raw - 0.55) / 0.25, 0, 1)
    aversion = np.zeros(N, dtype=np.float32)
    best_neg = np.full(N, -1, dtype=np.int32)
    if neg:
        S = ix.E @ np.vstack(neg).T
        best_neg = S.argmax(1)
        aversion = np.clip((S.max(1) - 0.62) / 0.18, 0, 1)

    ok = np.ones(N, dtype=bool)
    for v in ctx["seen"]:
        if v in ix.row:
            ok[ix.row[v]] = False
    if prefs.get("hide_news", True):
        ok &= ~ix.news
    ok &= aversion < 0.8
    maxm = prefs.get("max_minutes")
    if maxm:
        for i, m in enumerate(ix.metas):
            if m["duration"] and m["duration"] > maxm * 60:
                ok[i] = False
    if area:
        ok &= np.array([area in m["areas"] for m in ix.metas])
    # sub videoları: yalnız kendi kanalların (subs) ya da topluluk eşiğini geçenler (community)
    mine = np.array([m["channel_id"] in ctx["channels"] if m["channel_id"] else False for m in ix.metas])
    sub_ok = ix.is_ht | mine | (ix.quality >= config.COMMUNITY_THRESHOLD)
    ok &= sub_ok
    ok &= ix.is_ht | (ix.quality >= config.QUALITY_THRESHOLD)  # eşiği geçmeyen abonelik videosu akışa girmez
    pen = aversion * 3.0

    def why_interest(i):
        j = best_pos[i]
        if j < 0:
            return None
        kind, lab = pos_lab[j]
        if kind == "topic":
            return f"Close to your interest: “{lab}”"
        if kind == "liked":
            return f"Similar to “{lab[:60]}”, which you liked"
        return "Matches the description in your profile"

    pools = {}
    # 1) abonelikler
    idx = [i for i in np.nonzero(ok & mine)[0]]
    sc = []
    for i in idx:
        m = ix.metas[i]
        if m["source"] == "sub" and (m["quality"] or 0) < config.QUALITY_THRESHOLD:
            continue
        fit = ctx["fit"].get(m["vid"])
        s = 0.5 * m["quality"] + 0.5 * (fit[0] if fit else m["quality"]) + _recency_bonus(m["upload_date"]) - pen[i]
        if fit and fit[1]:
            why = f"quality {m['quality']:.1f} · fit for you {fit[0]:.0f}/10 — {fit[1]}"
        elif m["source"] == "sub":
            why = f"agent score {m['quality']:.1f}/10 — {m['verdict'] or ''}"
        else:
            why = f"{m['channel']} · also recommended on HN in {m['hn'].get('rec_months', 0)} different months"
        sc.append((s, i, why))
    pools["subs"] = [(i, w) for s, i, w in sorted(sc, key=lambda x: -x[0])]

    # 2) sana göre (profil + beğeniler)
    if pos:
        s = interest * 6 + ix.quality * 0.6 - pen
        cand = np.nonzero(ok & (interest > 0.25) & (ix.is_ht | (ix.quality >= config.COMMUNITY_THRESHOLD) | mine))[0]
        cand = cand[np.argsort(-s[cand])][:300]
        pools["foryou"] = [(i, why_interest(i)) for i in cand]
    # 3) aynı HN kullanıcıları (related.jsonl)
    if ctx["liked"]:
        agg = {}
        for v in ctx["liked"][-30:]:
            for r in ix.related.get(v, [])[:20]:
                if r["vid"] in ix.row:
                    a = agg.setdefault(r["vid"], [0, v])
                    a[0] += r["shared_recommenders"]
        lst = sorted(agg.items(), key=lambda kv: -kv[1][0])
        pools["cohort"] = [(ix.row[v], f"People who recommended “{ix.metas[ix.row[src]]['title'][:50]}” also recommended this "
                                       f"({n} in common)") for v, (n, src) in lst if ok[ix.row[v]]]
    boost = interest * 2 - pen

    def sample(mask, weights, k, reason):
        cand = np.nonzero(ok & mask)[0]
        if not len(cand):
            return []
        w = np.maximum(weights[cand] + boost[cand], 0.05)
        w = w / w.sum()
        pick = np.random.default_rng(rng.randrange(1 << 30)).choice(cand, size=min(k, len(cand)), replace=False, p=w)
        return [(i, reason(i)) for i in pick]

    hs = np.array([m["ht_score"] or 0 for m in ix.metas], dtype=np.float32)
    recs = np.array([(m["hn"] or {}).get("recommenders", 0) for m in ix.metas])
    strong = np.array([(m["hn"] or {}).get("strong_recs", 0) for m in ix.metas])
    first = np.array([(m["hn"] or {}).get("first_year") or 0 for m in ix.metas])
    pools["classics"] = sample(ix.is_ht & (hs >= 9), hs, 200,
                               lambda i: f"Recommended on HN by {ix.metas[i]['hn'].get('recommenders')} people "
                                         f"in {ix.metas[i]['hn'].get('rec_months')} different months")
    pools["gems"] = sample(ix.is_ht & (hs >= 3.5) & (hs < 9) & (recs <= 7) & (strong >= 2), hs, 200,
                           lambda i: f"Recommended by {ix.metas[i]['hn'].get('recommenders')} people, "
                                     f"{ix.metas[i]['hn'].get('strong_recs')} of them enthusiastically")
    pools["fresh"] = sample(ix.is_ht & (first >= 2024) & (hs >= 3), hs, 200,
                            lambda i: f"Recommended on HN since {ix.metas[i]['hn'].get('first_year')}")
    # keşfet: kullanıcının hiç dokunmadığı kategoriler
    touched = set()
    for v in ctx["liked"] + ctx["disliked"]:
        if v in ix.row:
            touched.update(ix.metas[ix.row[v]]["cats"])
    allcats = sorted({c for m in ix.metas for c in m["cats"]} - touched)
    rng.shuffle(allcats)
    ex = []
    for c in allcats[:30]:
        cand = [i for i in np.nonzero(ok & ix.is_ht & (hs >= 5))[0] if ix.metas[i]["cats"] and ix.metas[i]["cats"][0] == c]
        if cand:
            i = max(cand, key=lambda j: hs[j] + rng.random() * 4)
            ex.append((i, f"A topic you haven't explored yet: {ix.metas[i]['cat_names'][0]}"))
    pools["explore"] = ex
    # topluluk: başkalarının aboneliklerinden yüksek puanlı
    comm = np.nonzero(ok & ~ix.is_ht & ~mine & (ix.quality >= config.COMMUNITY_THRESHOLD))[0]
    comm = comm[np.argsort(-(ix.quality[comm] + boost[comm]))]
    pools["community"] = [(i, f"From another user's subscriptions, agent score {ix.quality[i]:.1f}/10")
                          for i in comm]

    # karışım (profil prefs.mix ile ağırlık değişir)
    mix = prefs.get("mix") or {}
    weights = {k: w * float(mix.get(k, 1.0)) for k, (_, w) in POOLS.items() if pools.get(k)}
    weights = {k: w for k, w in weights.items() if w > 0}
    out, used, cur = [], set(), {k: 0.0 for k in weights}
    ptr = {k: 0 for k in weights}
    need = (page + 1) * per_page
    total = sum(weights.values()) or 1
    while len(out) < need and weights:
        for k in weights:
            cur[k] += weights[k]
        k = max(cur, key=cur.get)
        cur[k] -= total
        lst = pools[k]
        while ptr[k] < len(lst) and ix.vids[lst[ptr[k]][0]] in used:
            ptr[k] += 1
        if ptr[k] >= len(lst):
            total -= weights.pop(k)
            cur.pop(k)
            continue
        i, why = lst[ptr[k]]
        ptr[k] += 1
        used.add(ix.vids[i])
        if aversion[i] > 0.3 and best_neg[i] >= 0:
            why += " (note: a bit like “" + str(neg_lab[best_neg[i]])[:40] + "”)"
        out.append(card_out(ix.metas[i], pool=k, why=why, later=ix.vids[i] in ctx["later"]))
    return {"items": out[page * per_page:need], "more": len(out) >= need,
            "pools": {k: POOLS[k][0] for k in pools if pools[k]}}


def card_out(m, pool=None, why=None, later=False):
    return {"vid": m["vid"], "title": m["title"], "channel": m["channel"], "duration": m["duration"],
            "quality": round(m["quality"], 1) if m["quality"] is not None else None, "source": m["source"],
            "summary": m["summary"], "type": m["content_type"], "topic": m["topic"],
            "pool": pool, "pool_name": POOLS.get(pool, ("",))[0] if pool else None, "why": why,
            "recs": (m["hn"] or {}).get("recommenders"), "hn_first": (m["hn"] or {}).get("first_year"),
            "later": later, "upload_date": m["upload_date"], "views": m.get("views")}


def search(con, uid, q, k=40):
    ix = index()
    qv = _topic_vec(q.strip()[:300])
    s = ix.E @ qv
    ql = q.lower().strip()
    bonus = np.array([0.15 if ql and (ql in (m["title"] or "").lower() or ql in (m["channel"] or "").lower()) else 0.0
                      for m in ix.metas], dtype=np.float32)
    total = s + bonus + ix.quality * 0.01
    top = np.argsort(-total)[:k]
    return [card_out(ix.metas[i], why=f"Search match {s[i]:.2f}") for i in top]


def similar(vid, k=8):
    ix = index()
    out = []
    if vid in ix.related:
        for r in ix.related[vid][:6]:
            if r["vid"] in ix.row:
                out.append(card_out(ix.metas[ix.row[r["vid"]]], why=f"Recommended by {r['shared_recommenders']} of the same HN users"))
    if vid in ix.row:
        s = ix.E @ ix.E[ix.row[vid]]
        have = {o["vid"] for o in out} | {vid}
        for i in np.argsort(-s)[1:k + 6]:
            if ix.vids[i] not in have and len(out) < k + 4 and not ix.news[i]:
                out.append(card_out(ix.metas[i], why=f"Content similarity {s[i]:.2f}"))
                have.add(ix.vids[i])
    return out
