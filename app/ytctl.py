"""ytctl — değerlendirme agent'larının tek aracı. Kullanım: ytctl <komut> <iş-no> [argümanlar]"""
import json
import sys
import time

from . import agents, db, tools

USAGE = """ytctl next <agent-adı> | cron-set <agent-adı> | job <N> | meta <N> | transcript <N> [offset] [max_chars] | hn <N> [sorgu] | similar <N> [metin]
      | channel <N> | submit <N> [dosya]  (yoksa stdin) | fail <N> <sebep>"""


def out(o):
    print(o if isinstance(o, str) else json.dumps(o, ensure_ascii=False, indent=1))


CRON_DAYS = 6  # oturum zamanlayıcısı 7 günde düşer; 6 günde yeniletiriz


def cmd_next(agent, wait=100):
    if agent not in agents.AGENTS:
        out(f"bilinmeyen agent: {agent}")
        return 2
    con = db.connect()
    agents.touch(con, agent, "next")
    crons = db.kv_get(con, "agent_cron", {}) or {}
    renew = time.time() - (crons.get(agent) or 0) > CRON_DAYS * 86400
    t0 = time.time()
    jid = None
    while True:
        jid = agents.claim(con, agent)
        if jid or time.time() - t0 > wait:
            break
        time.sleep(5)
    if renew:
        print("!! ZAMANLAYICI YENİLE: CronList ile mevcut işini bul, CronDelete ile sil, CronCreate ile yeniden kur "
              f"(cron '*/10 * * * *', prompt: '{agents.YTCTL} next {agent} çalıştır ve talimata uy'), sonra "
              f"'{agents.YTCTL} cron-set {agent}' çalıştır.\n")
    if not jid:
        out("İş yok. Turu kısa bir cümleyle bitir; zamanlayıcı seni yine çağıracak.")
        return 0
    out(agents.job_text(con, agents.job_get(con, jid)))
    print(f"\nBu iş bitince (submit ya da fail) hemen tekrar '{agents.YTCTL} next {agent}' çalıştır; "
          "'İş yok' diyene kadar devam et.")
    return 0


def main(argv):
    if len(argv) >= 2 and argv[0] == "next":
        db.init()
        return cmd_next(argv[1])
    if len(argv) >= 2 and argv[0] == "cron-set":
        db.init()
        con = db.connect()
        if argv[1] not in agents.AGENTS:
            out("bilinmeyen agent")
            return 2
        c = db.kv_get(con, "agent_cron", {}) or {}
        c[argv[1]] = time.time()
        db.kv_set(con, "agent_cron", c)
        out("Zamanlayıcı kaydı tamam.")
        return 0
    if len(argv) < 2 or not argv[1].isdigit():
        out(USAGE)
        return 2
    cmd, jid, rest = argv[0], int(argv[1]), argv[2:]
    db.init()
    con = db.connect()
    j = agents.job_get(con, jid)
    if not j:
        out(f"iş #{jid} yok")
        return 1
    if cmd == "job":
        out(agents.job_text(con, j))
        return 0
    if j["status"] != "sent":
        out(f"iş #{jid} kapalı (durum: {j['status']}). Bir şey yapma, sonraki mesajı bekle.")
        return 1
    vid = j["payload"].get("vid")
    try:
        if cmd in ("meta", "transcript", "hn", "similar", "channel"):
            if j["kind"] != "deep":
                out("bu komut yalnız derin değerlendirme işlerinde var")
                return 2
            if cmd == "meta":
                res = tools.tool_meta(vid)
            elif cmd == "transcript":
                off = int(rest[0]) if rest else 0
                mx = min(int(rest[1]) if len(rest) > 1 else 20000, 20000)
                res = tools.tool_transcript(vid, off, mx)
            elif cmd == "hn":
                res = tools.tool_hn(vid, " ".join(rest) or None)
            elif cmd == "similar":
                res = tools.tool_similar(vid, " ".join(rest) or None)
            else:
                res = tools.tool_channel(vid)
            agents.record_call(con, jid, cmd, "error" not in res)
            if cmd == "transcript" and res.get("available"):
                print(f"[transcript {res['offset']}-{res['offset'] + len(res['text'])} / {res['total_chars']} karakter; "
                      f"next_offset={res['next_offset']}]")
                print(res["text"])
                return 0
            out(res)
            return 0
        if cmd == "submit":
            raw = open(rest[0]).read() if rest else sys.stdin.read()
            try:
                data = json.loads(raw.strip())
            except Exception as e:
                out({"ok": False, "errors": [f"geçersiz JSON: {e}"]})
                return 1
            res = agents.submit(con, j, data)
            agents.record_call(con, jid, "submit", bool(res.get("ok")))
            out(res)
            return 0 if res.get("ok") else 1
        if cmd == "fail":
            out(agents.fail(con, j, " ".join(rest) or "sebep yok"))
            return 0
    except Exception as e:
        agents.record_call(con, jid, cmd, False)
        out({"error": f"{type(e).__name__}: {e}"})
        return 1
    out(USAGE)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
