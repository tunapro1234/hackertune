"""Değerlendirme işlerini bp ile açılmış Claude Code agent'larına (tmux) dağıtır.

Akış: worker bir iş (jobs satırı) oluşturur → `bp msg <agent> "İş #N ..."` → agent `ytctl job N` ile işi okur,
`ytctl meta/transcript/hn/similar/channel N` ile araştırır, `ytctl submit N` ile sonucu yazar. Agent'ın Bash'i bir
PreToolUse kancasıyla yalnızca ytctl'e kilitli (agents/<ad>/.claude/settings.local.json).
"""
import json
import os
import re
import subprocess
import time

from . import config, db, pipeline, tools

BP = os.environ.get("YT_BP_BIN", "/usr/local/bin/bp")
YTCTL = str(config.ROOT / "bin" / "ytctl")

# ad -> yapabildiği iş türleri. yt.env: YT_AGENTS="youtube-eval-1:deep,youtube-eval-2:deep,youtube-triage:triage+fit"
AGENTS = {}
for part in (os.environ.get("YT_AGENTS") or "youtube-eval-1:deep,youtube-eval-2:deep,youtube-triage:triage+fit").split(","):
    if ":" in part:
        name, kinds = part.split(":", 1)
        AGENTS[name.strip()] = set(kinds.strip().split("+"))

TIMEOUT = {"deep": 25 * 60, "triage": 12 * 60, "fit": 12 * 60}
KIND_TR = {"deep": "derin değerlendirme", "triage": "ön eleme", "fit": "kişisel uyum puanlama"}

_status_cache = {"at": 0, "data": {}}


def agent_states(max_age=15):
    """bp status --json → {ad: 'idle'|'working'|'closed'|...}. bp'nin kendi gözlemi; ekran deseni aramıyoruz."""
    if time.time() - _status_cache["at"] < max_age:
        return _status_cache["data"]
    out = {}
    try:
        p = subprocess.run([BP, "status", "--json"], capture_output=True, text=True, timeout=30)
        data = json.loads(p.stdout)
        rows = data if isinstance(data, list) else data.get("agents", [])
        for r in rows:
            if r.get("name") in AGENTS:
                t = r.get("tmux")  # systemd altından tmux gözlemi 'unknown' dönebiliyor; o zaman kayıt durumuna düş
                out[r["name"]] = "closed" if r.get("status") == "closed" else (t if t and t != "unknown" else r.get("status") or "unknown")
    except Exception as e:
        out = {"_error": str(e)[:200]}
    _status_cache.update(at=time.time(), data=out)
    return out


def send(agent, text):
    p = subprocess.run([BP, "msg", agent, text], capture_output=True, text=True, timeout=60)
    out = (p.stdout + p.stderr).strip()
    m = re.search(r"CHANNEL=(\S+)", out)
    ok = p.returncode == 0 and ("RESULT=" in out or "deliver" in out.lower() or "queued" in out.lower())
    return ok, (m.group(1) if m else None), out[:300]


def job_get(con, jid):
    r = con.execute("SELECT * FROM jobs WHERE id=?", (int(jid),)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["payload"] = db.jload(r["payload"], {})
    d["calls"] = db.jload(r["calls"], [])
    return d


def _new_job(con, kind, payload, agent):
    cur = con.execute("INSERT INTO jobs(kind,payload,agent,status,calls,created_at,sent_at) VALUES(?,?,?,?,?,?,?)",
                      (kind, json.dumps(payload, ensure_ascii=False), agent, "sent", "[]", time.time(), time.time()))
    return cur.lastrowid


def _release(con, job, note):
    """Biten/başarısız işin videolarını kuyruğa geri koy."""
    p = job["payload"]
    if job["kind"] == "deep":
        r = con.execute("SELECT attempts FROM videos WHERE vid=?", (p["vid"],)).fetchone()
        st = "failed" if r and (r["attempts"] or 0) >= 1 else "triage_pass"
        con.execute("UPDATE videos SET status=?, attempts=attempts+1, updated_at=? WHERE vid=? AND status='evaluating'",
                    (st, time.time(), p["vid"]))
    elif job["kind"] == "triage":
        con.execute(f"UPDATE videos SET status='new' WHERE status='triaging' AND vid IN ({','.join('?' * len(p['vids']))})",
                    p["vids"])
    con.execute("UPDATE jobs SET status='failed', note=?, done_at=? WHERE id=?", (note[:500], time.time(), job["id"]))
    db.event(con, job["kind"], p.get("vid"), f"agent işi #{job['id']} ({job['agent']}) başarısız: {note[:200]}")


def finish(con, jid, note=None):
    con.execute("UPDATE jobs SET status='done', note=?, done_at=? WHERE id=?", (note, time.time(), jid))


def _make_job(con, agent, kinds):
    if pipeline.eval_budget_left(con) <= 0:
        return None
    if "triage" in kinds:
        rows = pipeline.triage_rows(con, 30)
        if rows:
            vids = [r["vid"] for r in rows]
            con.execute(f"UPDATE videos SET status='triaging' WHERE vid IN ({','.join('?' * len(vids))})", vids)
            return "triage", {"vids": vids}
    if "deep" in kinds:
        _, n = db.spent(con, ["deep"])
        if n < config.DEEP_MAX_PER_DAY:
            r = con.execute("""SELECT v.vid FROM videos v WHERE v.status='triage_pass' ORDER BY
                               (SELECT COUNT(*) FROM user_channels u WHERE u.channel_id=v.channel_id) DESC, v.pos, v.created_at
                               LIMIT 1""").fetchone()
            if r:
                con.execute("UPDATE videos SET status='evaluating' WHERE vid=?", (r["vid"],))
                return "deep", {"vid": r["vid"]}
    if "fit" in kinds:
        job, _ = pipeline.fit_select(con, 25)
        if job:
            return "fit", job
    return None


def claim(con, agent):
    """Agent'ın açık işi varsa onu, yoksa yeni bir iş döndürür (yoksa None). ytctl next çağırır."""
    with db.tx(con):
        r = con.execute("SELECT id FROM jobs WHERE status='sent' AND agent=? ORDER BY id LIMIT 1", (agent,)).fetchone()
        if r:
            return r["id"]
        mk = _make_job(con, agent, AGENTS[agent])
        if not mk:
            return None
        kind, payload = mk
        jid = _new_job(con, kind, payload, agent)
        what = f"vid={payload['vid']}" if kind == "deep" else f"{len(payload['vids'])} video"
        db.event(con, kind, payload.get("vid"), f"iş #{jid} → {agent} ({KIND_TR[kind]}, {what})")
    return jid


def touch(con, agent, what="poll"):
    seen = db.kv_get(con, "agent_seen", {}) or {}
    seen[agent] = {"at": time.time(), "what": what}
    db.kv_set(con, "agent_seen", seen)


def step(con):
    """Worker döngüsünden: zaman aşımına uğrayan işleri kuyruğa geri koyar, agent durumunu kaydeder."""
    busy = False
    now = time.time()
    for r in con.execute("SELECT id FROM jobs WHERE status='sent'").fetchall():
        j = job_get(con, r["id"])
        if now - (j["sent_at"] or now) > TIMEOUT.get(j["kind"], 1200):
            with db.tx(con):
                _release(con, j, "zaman aşımı")
            busy = True
    states = agent_states(60)
    db.kv_set(con, "agent_states", {"at": now, "states": states})
    return busy


def summary(con):
    st = db.kv_get(con, "agent_states", {}) or {}
    seen = db.kv_get(con, "agent_seen", {}) or {}
    out = []
    for a, kinds in AGENTS.items():
        j = con.execute("SELECT id, kind, payload, sent_at FROM jobs WHERE agent=? AND status='sent'", (a,)).fetchone()
        done = con.execute("SELECT COUNT(*) FROM jobs WHERE agent=? AND status='done' AND done_at>?",
                           (a, time.time() - 86400)).fetchone()[0]
        out.append({"name": a, "kinds": sorted(kinds), "state": (st.get("states") or {}).get(a, "?"), "done_24h": done,
                    "last_poll": (seen.get(a) or {}).get("at"),
                    "job": {"id": j["id"], "kind": j["kind"], "since": j["sent_at"],
                            "vid": db.jload(j["payload"], {}).get("vid")} if j else None})
    return out


# ---------------- agent'ın gördüğü iş metinleri ----------------

def _cmds(jid, kind):
    c = YTCTL
    if kind == "deep":
        return f"""KOMUTLAR (Bash ile; yalnızca ytctl izinli, başka komut engellenir):
  {c} meta {jid}
  {c} transcript {jid} [offset] [max_chars<=20000]     (next_offset ile devam)
  {c} hn {jid} [serbest sorgu]
  {c} similar {jid} [metin]
  {c} channel {jid}
  {c} submit {jid} <<'EOF'
  {{ ...kart JSON... }}
  EOF
  {c} fail {jid} "sebep"        (video açılamıyor/silinmiş vb.)"""
    return f"""KOMUTLAR (Bash ile; yalnızca ytctl izinli):
  {c} submit {jid} <<'EOF'
  [ ...JSON dizi... ]
  EOF
  {c} fail {jid} "sebep\""""


def job_text(con, j):
    jid, kind, p = j["id"], j["kind"], j["payload"]
    head = f"İŞ #{jid} — {KIND_TR[kind]}  (durum: {j['status']})\n"
    if j["status"] != "sent":
        return head + "Bu iş artık açık değil; bir şey yapma."
    if kind == "deep":
        r = con.execute("SELECT * FROM videos WHERE vid=?", (p["vid"],)).fetchone()
        info = (f"vid={p['vid']}\nTitle: {r['title']}\nChannel: {r['channel']}\n"
                f"Length: {round((r['duration'] or 0) / 60)} min\n"
                f"Triage note: {(db.jload(r['triage'], {}) or {}).get('reason')}\n")
        sysm = pipeline.DEEP_SYSTEM.replace("{TAXONOMY}", pipeline._taxonomy_compact())
        sysm = sysm.replace("using your tools (you have no other tools)", "using the ytctl subcommands below")
        sysm = sysm.replace("Finish with one short sentence after submit succeeds.",
                            "submit requires meta, hn, similar (and transcript if one exists) to have been called. "
                            "Finish with one short sentence after submit succeeds.")
        return head + info + "\n" + _cmds(jid, kind) + "\n\n" + sysm
    if kind == "triage":
        items = pipeline.triage_items(con, p["vids"])
        return (head + _cmds(jid, kind) + "\n\n" + pipeline.TRIAGE_SYSTEM +
                "\n\nVIDEOS:\n" + json.dumps(items, ensure_ascii=False, indent=0))
    if kind == "fit":
        ctx = pipeline.fit_context(con, p["uid"], p["vids"])
        return head + _cmds(jid, kind) + "\n\n" + pipeline.FIT_SYSTEM + "\n\nINPUT:\n" + json.dumps(ctx, ensure_ascii=False)
    return head


def record_call(con, jid, name, ok=True):
    j = job_get(con, jid)
    calls = j["calls"] + [{"tool": name, "ok": ok, "at": round(time.time())}]
    con.execute("UPDATE jobs SET calls=? WHERE id=?", (json.dumps(calls), jid))


def submit(con, j, data):
    jid, kind, p = j["id"], j["kind"], j["payload"]
    by = f" — {j['agent']}"
    if kind == "deep":
        vid = p["vid"]
        called = {c["tool"] for c in j["calls"] if c["ok"]}
        need = {"meta", "hn", "similar"}
        if tools.yt.transcript(vid)["lines"]:
            need.add("transcript")
        missing = sorted(need - called)
        if missing:
            return {"ok": False, "errors": [f"Önce şunları çalıştır: {', '.join(missing)}"]}
        if not isinstance(data, dict):
            return {"ok": False, "errors": ["kart bir JSON nesnesi olmalı"]}
        res = tools.tool_submit(vid, data.get("card") if isinstance(data.get("card"), dict) else data,
                                model=f"agent:{j['agent']}")
        if not res.get("ok"):
            return res
        row = con.execute("SELECT eval, quality FROM videos WHERE vid=?", (vid,)).fetchone()
        ev = db.jload(row["eval"], {})
        used = [c["tool"] for c in j["calls"]]
        ev.update({"agent": j["agent"], "job": jid, "tools": used, "seconds": round(time.time() - j["sent_at"])})
        with db.tx(con):
            con.execute("UPDATE videos SET status='evaluated', eval=?, updated_at=? WHERE vid=?",
                        (json.dumps(ev, ensure_ascii=False), time.time(), vid))
            db.add_spend(con, "deep", 0.0, 1)
            db.event(con, "deep", vid, f"puan {row['quality']} — {ev.get('verdict', '')} "
                                       f"[{j['agent']}, iş #{jid}, {len(used)} komut: {', '.join(dict.fromkeys(used))}]")
            finish(con, jid)
        return {"ok": True, "message": "Kaydedildi. İş bitti; tek kısa cümleyle bitir ve sonraki mesajı bekle."}
    if not isinstance(data, list):
        return {"ok": False, "errors": ["JSON dizi bekleniyordu"]}
    if kind == "triage":
        n, npass = pipeline.triage_apply(con, p["vids"], data, f"agent:{j['agent']}", 0.0, by)
        with db.tx(con):
            finish(con, jid, f"{n} tarandı, {npass} geçti")
        miss = len(p["vids"]) - n
        return {"ok": True, "message": f"{n} video kaydedildi ({npass} derin incelemeye)."
                                       + (f" {miss} video eksikti, kuyruğa döndü." if miss else "") + " İş bitti."}
    if kind == "fit":
        n = pipeline.fit_apply(con, p, data, 0.0, by)
        with db.tx(con):
            finish(con, jid, f"{n} puanlandı")
        return {"ok": True, "message": f"{n} video puanlandı. İş bitti."}
    return {"ok": False, "errors": ["bilinmeyen iş türü"]}


def fail(con, j, reason):
    with db.tx(con):
        _release(con, j, f"agent vazgeçti: {reason}")
    return {"ok": True, "message": "Not alındı, iş kapandı."}
