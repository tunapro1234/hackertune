"""Minimal MCP (stdio, JSON-RPC) sunucusu: değerlendirme agent'ına yalnızca bu araçlar verilir.

Video kimliği ortamdan (YT_VID) gelir; agent başka bir videoya yazamaz.
"""
import json
import os
import sys
import traceback

from . import tools

VID = os.environ["YT_VID"]
MODEL = os.environ.get("YT_MODEL")
LOG = os.environ.get("YT_TOOL_LOG")
CALLED = set()


def send(o):
    sys.stdout.write(json.dumps(o, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(name, args, res):
    if LOG:
        with open(LOG, "a") as f:
            f.write(json.dumps({"tool": name, "args": args, "ok": "error" not in res,
                                "size": len(json.dumps(res, ensure_ascii=False))}, ensure_ascii=False) + "\n")


def main():
    for line in sys.stdin:
        try:
            m = json.loads(line)
        except Exception:
            continue
        mid, meth = m.get("id"), m.get("method")
        if meth == "initialize":
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": (m.get("params") or {}).get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {}}, "serverInfo": {"name": "yt", "version": "1.0"}}})
        elif meth == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [
                {"name": n, "description": d, "inputSchema": {"type": "object", "properties": p}}
                for n, (_, d, p) in tools.TOOLS.items()]}})
        elif meth == "tools/call":
            p = m.get("params") or {}
            name, args = p.get("name"), p.get("arguments") or {}
            try:
                fn = tools.TOOLS[name][0]
                if name == "submit":
                    # kalibrasyon şart: transcript (varsa), HN ve HackerTube benzerleri okunmadan puan kabul edilmez
                    need = {"meta", "hn", "similar"}
                    if tools.yt.transcript(VID)["lines"]:
                        need.add("transcript")
                    missing = sorted(need - CALLED)
                    if missing:
                        res = {"ok": False, "errors": [f"Önce şu araçları çağır: {', '.join(missing)}"]}
                        log(name, args, res)
                        send({"jsonrpc": "2.0", "id": mid, "result": {
                            "content": [{"type": "text", "text": json.dumps(res, ensure_ascii=False)}], "isError": True}})
                        continue
                    res = fn(VID, args.get("card") or {k: v for k, v in args.items()}, model=MODEL)
                else:
                    res = fn(VID, **{k: v for k, v in args.items() if k in tools.TOOLS[name][2]})
            except Exception as e:
                res = {"error": f"{type(e).__name__}: {e}"}
                traceback.print_exc(file=sys.stderr)
            if "error" not in res:
                CALLED.add(name)
            log(name, args, res)
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": json.dumps(res, ensure_ascii=False)}],
                "isError": "error" in res}})
        elif mid is not None:
            send({"jsonrpc": "2.0", "id": mid, "result": {}})


if __name__ == "__main__":
    main()
