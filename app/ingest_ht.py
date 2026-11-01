"""HackerTube export'unu (ODC-By, hackertube.org) SQLite'a yükler. Tekrar çalıştırılabilir."""
import json
import math
import time

from . import config, db


def ht_quality(score):
    """HackerTube skorunu (ay sayısı) bizim 0-10 ölçeğine taşır: kalibrasyon için."""
    return round(min(10.0, 3.0 + 2.1 * math.log1p(max(0.0, score or 0))), 2)


def main():
    db.init()
    con = db.connect()
    now = time.time()
    rows = []
    for line in open(config.DATA / "videos.jsonl", encoding="utf-8"):
        v = json.loads(line)
        card = {k: v.get(k) for k in ("summary", "content_type", "level", "shelf_life", "primary_topic", "tags", "categories")}
        card["why"] = v.get("why_hn")
        ht = {"hn": v.get("hn"), "quote": v.get("quote")}
        rows.append((v["vid"], "ht", v["title"], v["channel"], None, None, None, None, None,
                     json.dumps(card, ensure_ascii=False), json.dumps(ht, ensure_ascii=False), v["score"], "ht",
                     None, ht_quality(v["score"]), None, None, None, 0, now, now))
    with db.tx(con):
        # abonelikten gelmiş ve sonradan HackerTube'da da olan videoyu ezme: kartı ht'den, durumu koru
        con.executemany(
            """INSERT INTO videos(vid,source,title,channel,channel_id,duration,views,upload_date,lang,card,ht,ht_score,status,
                 triage,quality,eval,emb,pos,attempts,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(vid) DO UPDATE SET ht=excluded.ht, ht_score=excluded.ht_score,
                 card=CASE WHEN videos.source='ht' THEN excluded.card ELSE videos.card END,
                 quality=CASE WHEN videos.source='ht' THEN excluded.quality ELSE videos.quality END""",
            rows)
        con.execute("DELETE FROM mentions")  # türetilmiş tablo, kaynak dosyadan yeniden kurulur
        batch = []
        for line in open(config.DATA / "mentions.jsonl", encoding="utf-8"):
            m = json.loads(line)
            batch.append((m["hn_comment_id"], m["vid"], m.get("author"), m.get("month"), m.get("story_title"),
                          m.get("stance"), m.get("why"), m.get("quote"), m.get("text")))
        con.executemany("INSERT INTO mentions VALUES(?,?,?,?,?,?,?,?,?)", batch)
        rel = []
        for line in open(config.DATA / "related.jsonl", encoding="utf-8"):
            r = json.loads(line)
            rel.append((r["vid"], json.dumps(r["related"])))
        con.executemany("INSERT OR REPLACE INTO related VALUES(?,?)", rel)
    print(f"videos={len(rows)} mentions={len(batch)} related={len(rel)}")


if __name__ == "__main__":
    main()
