"""ytctl — değerlendirme agent'larının tek aracı. Kullanım: ytctl <komut> <iş-no> [argümanlar]"""
import json
import sys
import time

from . import agents, channel, db, showcase, tools

USAGE = """ytctl next <agent-name> | cron-set <agent-name> | job <N> | submit <N> [file] (default stdin) | fail <N> <reason>
  deep jobs:    meta <N> | transcript <N> [offset] [max_chars] | hn <N> [query] | similar <N> [text] | channel <N>
  curate jobs:  user <N> | topics <N> | search <N> <query> | similar <N> <vid|text> | top <N> [area|category]
                | ytsearch <N> <query> | ytplaylists <N> <query> | playlist <N> <playlist-id> | inspect <N> <vid>
  chanrev jobs: user <N> | channel <N> | transcript <N> <vid> [offset] | inspect <N> <vid> | hn <N> | ytsearch <N> <query>"""
CHANREV_CMDS = ("user", "channel", "transcript", "inspect", "hn", "ytsearch")
CURATE_CMDS = ("user", "topics", "search", "similar", "top", "ytsearch", "ytplaylists", "playlist", "inspect")


def out(o):
    print(o if isinstance(o, str) else json.dumps(o, ensure_ascii=False, indent=1))


CRON_DAYS = 6  # oturum zamanlayıcısı 7 günde düşer; 6 günde yeniletiriz


def cmd_next(agent, wait=100):
    if agent not in agents.AGENTS:
        out(f"unknown agent: {agent}")
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
        print("!! RENEW THE TIMER: find your job with CronList, delete it with CronDelete, recreate it with CronCreate "
              f"(cron '*/10 * * * *', prompt: 'run {agents.YTCTL} next {agent} and follow the instructions'), then run "
              f"'{agents.YTCTL} cron-set {agent}'.\n")
    if not jid:
        out("No jobs. End this turn with one short sentence; the timer will call you again.")
        return 0
    out(agents.job_text(con, agents.job_get(con, jid)))
    print(f"\nWhen this job is finished (submit or fail), immediately run '{agents.YTCTL} next {agent}' again; "
          "keep going until it says 'No jobs'.")
    return 0


def main(argv):
    if len(argv) >= 2 and argv[0] == "next":
        db.init()
        return cmd_next(argv[1])
    if len(argv) >= 2 and argv[0] == "cron-set":
        db.init()
        con = db.connect()
        if argv[1] not in agents.AGENTS:
            out("unknown agent")
            return 2
        c = db.kv_get(con, "agent_cron", {}) or {}
        c[argv[1]] = time.time()
        db.kv_set(con, "agent_cron", c)
        out("Timer registered.")
        return 0
    if len(argv) < 2 or not argv[1].isdigit():
        out(USAGE)
        return 2
    cmd, jid, rest = argv[0], int(argv[1]), argv[2:]
    db.init()
    con = db.connect()
    j = agents.job_get(con, jid)
    if not j:
        out(f"job #{jid} does not exist")
        return 1
    if cmd == "job":
        out(agents.job_text(con, j))
        return 0
    if j["status"] != "sent":
        out(f"job #{jid} is closed (status: {j['status']}). Do nothing; wait for the next message.")
        return 1
    vid = j["payload"].get("vid")
    try:
        if j["kind"] == "curate" and cmd in CURATE_CMDS:
            return curate_cmd(con, j, cmd, rest)
        if j["kind"] == "chanrev" and cmd in CHANREV_CMDS:
            arg = " ".join(rest).strip().strip('"').strip("'").strip()[:200]
            res = channel.tool(con, j, cmd, arg)
            agents.record_call(con, jid, cmd, "error" not in res)
            if cmd == "transcript" and res.get("available"):
                print(f"[transcript {res['offset']}-{res['offset'] + len(res['text'])} / {res['total_chars']} chars; "
                      f"next_offset={res['next_offset']}]")
                print(res["text"])
                return 0
            print(json.dumps(res, ensure_ascii=False, separators=(",", ":")))
            return 0
        if cmd in ("meta", "transcript", "hn", "similar", "channel"):
            if j["kind"] != "deep":
                out("this command only exists for deep evaluation jobs")
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
                print(f"[transcript {res['offset']}-{res['offset'] + len(res['text'])} / {res['total_chars']} chars; "
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
                out({"ok": False, "errors": [f"invalid JSON: {e}"]})
                return 1
            res = agents.submit(con, j, data)
            agents.record_call(con, jid, "submit", bool(res.get("ok")))
            out(res)
            return 0 if res.get("ok") else 1
        if cmd == "fail":
            out(agents.fail(con, j, " ".join(rest) or "no reason given"))
            return 0
    except Exception as e:
        agents.record_call(con, jid, cmd, False)
        out({"error": f"{type(e).__name__}: {e}"})
        return 1
    out(USAGE)
    return 2


def curate_cmd(con, j, cmd, rest):
    """Küratör (vitrin) işinin araştırma komutları."""
    jid, uid = j["id"], j["payload"]["uid"]
    arg = " ".join(rest).strip().strip('"').strip("'").strip()
    if cmd in ("search", "similar", "ytsearch", "ytplaylists", "playlist", "inspect") and not arg:
        out(f"usage: ytctl {cmd} {jid} <argument>")
        return 2
    arg = arg[:200]
    if cmd == "user":
        res = showcase.user_context(con, uid)
    elif cmd == "topics":
        res = showcase.topics(con)
    elif cmd == "search":
        res = showcase.search(con, uid, arg)
    elif cmd == "similar":
        res = showcase.similar(con, uid, arg)
    elif cmd == "top":
        res = showcase.top(con, uid, arg or None)
    elif cmd == "ytsearch":
        res = showcase.ytsearch(con, jid, arg)
    elif cmd == "ytplaylists":
        res = showcase.ytplaylists(con, jid, arg)
    elif cmd == "playlist":
        res = showcase.playlist(con, jid, arg)
    else:
        res = showcase.inspect(con, uid, jid, arg)
    agents.record_call(con, jid, cmd, "error" not in res)
    print(json.dumps(res, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
