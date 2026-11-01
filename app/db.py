import json
import sqlite3
import time
import datetime as dt
from contextlib import contextmanager

from . import config

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS videos (
  vid TEXT PRIMARY KEY,
  source TEXT NOT NULL,              -- 'ht' (HackerTube verisi) | 'sub' (abonelikten gelen)
  title TEXT, channel TEXT, channel_id TEXT,
  duration INTEGER, views INTEGER, upload_date TEXT, lang TEXT,
  card TEXT,                         -- JSON: summary, why, content_type, level, shelf_life, primary_topic, tags, categories
  ht TEXT,                           -- JSON: HackerTube hn istatistikleri + quote
  ht_score REAL,
  status TEXT,                       -- sub: new|triage_skip|triage_pass|evaluating|evaluated|failed|unavailable ; ht: ht
  triage TEXT,                       -- JSON {deep, reason, model}
  quality REAL,                      -- 0-10 (sub: agent puanı; ht: skor->0-10)
  eval TEXT,                         -- JSON: reasoning, highlights, hn, sources, model, cost
  emb BLOB,                          -- float32[384] (sub videoları; ht'ninki npy'de)
  pos INTEGER,                       -- kanal listesindeki sıra (0 = en yeni)
  attempts INTEGER DEFAULT 0,
  created_at REAL, updated_at REAL
);
CREATE INDEX IF NOT EXISTS videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS videos_channel ON videos(channel_id);
CREATE TABLE IF NOT EXISTS mentions (
  hn_comment_id INTEGER, vid TEXT, author TEXT, month TEXT, story_title TEXT,
  stance TEXT, why TEXT, quote TEXT, text TEXT
);
CREATE INDEX IF NOT EXISTS mentions_vid ON mentions(vid);
CREATE TABLE IF NOT EXISTS related (vid TEXT PRIMARY KEY, related TEXT);
CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY, name TEXT, handle TEXT, url TEXT,
  last_fetched REAL, fetch_error TEXT, ht_count INTEGER DEFAULT 0, created_at REAL
);
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,              -- token'ın sha256'sı
  created_at REAL, last_seen REAL,
  profile TEXT,                      -- JSON
  profile_version INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_channels (
  uid TEXT, channel_id TEXT, added_at REAL, PRIMARY KEY(uid, channel_id)
);
CREATE TABLE IF NOT EXISTS user_video (
  uid TEXT, vid TEXT,
  rating INTEGER DEFAULT 0,          -- 1 beğen, -1 beğenme
  later INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0,
  watched_at REAL, rated_at REAL, later_at REAL,
  fit REAL, fit_reason TEXT, fit_version INTEGER,
  PRIMARY KEY(uid, vid)
);
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, created_at REAL,
  status TEXT, total INTEGER, done INTEGER, log TEXT, items TEXT
);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, kind TEXT, vid TEXT, created_at REAL
);
CREATE INDEX IF NOT EXISTS chats_uid ON chats(uid, kind, vid);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, role TEXT, content TEXT,
  meta TEXT, created_at REAL
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id);
CREATE TABLE IF NOT EXISTS spend (
  day TEXT, kind TEXT, usd REAL DEFAULT 0, n INTEGER DEFAULT 0, PRIMARY KEY(day, kind)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, stage TEXT, vid TEXT, msg TEXT, usd REAL
);
CREATE INDEX IF NOT EXISTS events_vid ON events(vid);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS jobs (           -- bp ile açılan Claude Code agent'larına verilen işler
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, payload TEXT, agent TEXT,
  status TEXT,                       -- sent|done|failed
  calls TEXT, note TEXT, channel TEXT,
  created_at REAL, sent_at REAL, done_at REAL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, agent);
CREATE TABLE IF NOT EXISTS watch (           -- izleme geçmişi (her açılış bir oturum)
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, vid TEXT, mode TEXT,
  started_at REAL, updated_at REAL, pos REAL, dur REAL, seconds REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS watch_uid ON watch(uid, updated_at);
"""


def connect():
    con = sqlite3.connect(config.DB_PATH, timeout=30, isolation_level=None, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=30000")
    con.execute("PRAGMA foreign_keys=OFF")
    return con


_inited = False


def init():
    global _inited
    con = connect()
    con.executescript(SCHEMA)
    cols = {r["name"] for r in con.execute("PRAGMA table_info(videos)")}
    if "checked_at" not in cols:
        con.execute("ALTER TABLE videos ADD COLUMN checked_at REAL")
    ucols = {r["name"] for r in con.execute("PRAGMA table_info(user_video)")}
    for c, t in (("pos", "REAL"), ("dur", "REAL"), ("seen_at", "REAL"), ("watch_s", "REAL")):
        if c not in ucols:
            con.execute(f"ALTER TABLE user_video ADD COLUMN {c} {t}")
    wcols = {r["name"] for r in con.execute("PRAGMA table_info(watch)")}
    for c, t in (("hidden_s", "REAL DEFAULT 0"), ("ua", "TEXT")):  # ekran kapalı/arka planda çalan saniye; cihaz
        if c not in wcols:
            con.execute(f"ALTER TABLE watch ADD COLUMN {c} {t}")
    con.close()
    _inited = True


@contextmanager
def tx(con):
    con.execute("BEGIN IMMEDIATE")
    try:
        yield con
        con.execute("COMMIT")
    except BaseException:
        con.execute("ROLLBACK")
        raise


def today():
    return dt.datetime.now().strftime("%Y-%m-%d")


def add_spend(con, kind, usd, n=1):
    con.execute(
        "INSERT INTO spend(day,kind,usd,n) VALUES(?,?,?,?) "
        "ON CONFLICT(day,kind) DO UPDATE SET usd=usd+excluded.usd, n=n+excluded.n",
        (today(), kind, float(usd or 0), n),
    )


def spent(con, kinds, day=None):
    day = day or today()
    q = "SELECT COALESCE(SUM(usd),0) u, COALESCE(SUM(n),0) n FROM spend WHERE day=? AND kind IN (%s)" % ",".join("?" * len(kinds))
    r = con.execute(q, (day, *kinds)).fetchone()
    return r["u"], r["n"]


def event(con, stage, vid, msg, usd=None):
    con.execute("INSERT INTO events(ts,stage,vid,msg,usd) VALUES(?,?,?,?,?)", (time.time(), stage, vid, msg[:2000], usd))


def jload(s, default=None):
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:
        return default


def kv_get(con, k, default=None):
    r = con.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return jload(r["v"], default) if r else default


def kv_set(con, k, v):
    con.execute("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, json.dumps(v)))
