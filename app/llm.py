"""claude -p (headless) sarmalayıcısı.

Güvenlik: her çağrı --setting-sources "" (sunucu CLAUDE.md/ayarları yüklenmez), --tools "" (yerleşik
araç yok: Bash/Read/Write/WebFetch kapalı), --strict-mcp-config (yalnız bizim verdiğimiz MCP), boş bir
cwd ve --permission-mode dontAsk ile çalışır. Derin değerlendirme agent'ı yalnız `yt` MCP araçlarını
görür; sohbetler hiç araç görmez. Transcript ya da kullanıcı metnindeki prompt injection'ın
dokunabileceği bir araç yüzeyi bu yüzden yok.
"""
import asyncio
import json
import os
import re
import subprocess

from . import config

ENV = {"HOME": os.environ.get("HOME", "/root"), "PATH": os.path.dirname(config.CLAUDE_BIN) + ":/usr/local/bin:/usr/bin:/bin",
       "LANG": "C.UTF-8", "DISABLE_AUTOUPDATER": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}


def _cmd(model, system, fmt="json", mcp_config=None, allowed=None, effort=None, max_usd=None):
    c = [config.CLAUDE_BIN, "-p", "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence",
         "--tools", "", "--permission-mode", "dontAsk", "--model", model, "--system-prompt", system,
         "--output-format", fmt]
    if fmt == "stream-json":
        c += ["--verbose", "--include-partial-messages"]
    if mcp_config:
        c += ["--mcp-config", mcp_config]
    if allowed:
        c += ["--allowedTools", allowed]
    if effort:
        c += ["--effort", effort]
    if max_usd:
        c += ["--max-budget-usd", str(max_usd)]
    return c


class LLMError(RuntimeError):
    pass


def run(prompt, system, model, timeout=300, **kw):
    """Senkron çağrı -> {'text', 'usd', 'turns', 'raw'}"""
    p = subprocess.run(_cmd(model, system, **kw), input=prompt, capture_output=True, text=True,
                       timeout=timeout, cwd=config.AGENT_CWD, env=ENV)
    try:
        d = json.loads(p.stdout)
    except Exception:
        raise LLMError(f"could not read claude output (rc={p.returncode}): {(p.stderr or p.stdout)[-400:]}")
    if d.get("is_error") or d.get("subtype") not in ("success", None):
        raise LLMError(f"claude error: {d.get('subtype')} {str(d.get('result'))[:300]}")
    return {"text": d.get("result") or "", "usd": d.get("total_cost_usd") or 0.0,
            "turns": d.get("num_turns"), "raw": d}


async def stream(prompt, system, model, timeout=240, **kw):
    """Asenkron akış: ('delta', metin) ... ve sonunda ('done', {'text','usd'}) üretir."""
    proc = await asyncio.create_subprocess_exec(
        *_cmd(model, system, fmt="stream-json", **kw), stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=str(config.AGENT_CWD), env=ENV,
        limit=16 * 1024 * 1024)
    proc.stdin.write(prompt.encode())
    await proc.stdin.drain()
    proc.stdin.close()
    text, usd, ok = "", 0.0, False
    try:
        async with asyncio.timeout(timeout):
            async for line in proc.stdout:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                t = d.get("type")
                if t == "stream_event":
                    e = d.get("event") or {}
                    if e.get("type") == "content_block_delta" and e.get("delta", {}).get("type") == "text_delta":
                        piece = e["delta"].get("text", "")
                        text += piece
                        yield ("delta", piece)
                elif t == "result":
                    usd = d.get("total_cost_usd") or 0.0
                    ok = not d.get("is_error")
                    if d.get("result") and len(d["result"]) > len(text):
                        text = d["result"]
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        await proc.wait()
    if not ok and not text:
        err = (await proc.stderr.read()).decode()[-300:] if proc.stderr else ""
        raise LLMError("the chat model did not answer " + err)
    yield ("done", {"text": text, "usd": usd})


def extract_json(text):
    """Model çıktısındaki ilk JSON nesnesini/dizisini bulur (```json blokları dahil)."""
    m = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    cands = [m.group(1)] if m else []
    cands.append(text)
    for c in cands:
        c = c.strip()
        for opener, closer in (("[", "]"), ("{", "}")):
            i, j = c.find(opener), c.rfind(closer)
            if i != -1 and j > i:
                try:
                    return json.loads(c[i:j + 1])
                except Exception:
                    continue
    raise LLMError("no JSON in model output: " + text[:200])
