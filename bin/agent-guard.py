#!/usr/bin/env python3
"""PreToolUse kancası: değerlendirme agent'larında yalnızca bu dizindeki ytctl çalışır.
Transcript/açıklama içindeki talimatlar agent'ı kandırsa bile sunucuda başka komut çalıştıramaz."""
import json
import re
import sys
from pathlib import Path

ALLOWED = str(Path(__file__).resolve().parent / "ytctl")
HEAD = re.compile(r"^" + re.escape(ALLOWED) + r" (job|meta|transcript|hn|similar|channel|submit|fail|user|topics|search|top|ytsearch|ytplaylists|playlist|inspect) \d+( [^;&|$`<>(){}\\\n]*)?$")
NEXT = re.compile(r"^" + re.escape(ALLOWED) + r" (next|cron-set) youtube-[a-z0-9-]+$")
HEREDOC = re.compile(r"^(" + re.escape(ALLOWED) + r" submit \d+) <<\s*'([A-Z_]+)'$")


def deny(msg):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": msg}}, ensure_ascii=False))
    sys.exit(0)


try:
    ev = json.load(sys.stdin)
except Exception:
    deny("kanca girdisi okunamadı")
if ev.get("tool_name") in ("CronCreate", "CronList", "CronDelete", "ToolSearch"):
    sys.exit(0)
if ev.get("tool_name") != "Bash":
    deny("Bu agent yalnızca Bash ile ytctl çalıştırabilir.")
cmd = (ev.get("tool_input") or {}).get("command", "").strip()
lines = cmd.split("\n")
first = lines[0].rstrip()
m = HEREDOC.match(first)
if m:
    delim = m.group(2)
    if len(lines) >= 3 and lines[-1].strip() == delim and delim not in [l.strip() for l in lines[1:-1]]:
        sys.exit(0)
    deny("heredoc biçimi: ytctl submit N <<'EOF' ... EOF (sonrasında başka satır yok)")
if len(lines) == 1 and (HEAD.match(first) or NEXT.match(first)):
    sys.exit(0)
deny(f"Yalnızca '{ALLOWED} <komut> <iş-no> ...' çalıştırabilirsin (;, |, $, ` ve yönlendirme yok). "
     "Kart için: ytctl submit N <<'EOF' ... EOF")
