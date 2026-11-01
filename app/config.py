"""yt.tunapro.xyz — ortak ayarlar. Değerler /srv/youtube/yt.env ile ezilebilir."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VAR = Path(os.environ.get("YT_VAR", ROOT / "var"))
DATA = ROOT / "data" / "raw" / "hackertube-data"
DB_PATH = VAR / "yt.db"
CACHE = VAR / "cache"           # yt-dlp meta + transcript önbelleği
MODELS = VAR / "models"         # fastembed modeli
AGENT_CWD = VAR / "agent-cwd"   # claude -p çalışma dizini (boş)
STATIC = ROOT / "app" / "static"

for p in (VAR, CACHE, MODELS, AGENT_CWD):
    p.mkdir(parents=True, exist_ok=True)


def _env(name, default, cast=str):
    v = os.environ.get(name)
    return cast(v) if v not in (None, "") else default


PORT = _env("YT_PORT", 3030, int)
PUBLIC_URL = _env("YT_PUBLIC_URL", "https://yt.tunapro.xyz").rstrip("/")  # Origin kontrolü ve senkron linki için
CLAUDE_BIN = _env("YT_CLAUDE_BIN", "/root/.local/bin/claude")
YTDLP_BIN = _env("YT_YTDLP_BIN", "/usr/local/bin/yt-dlp")

# Modeller: ön eleme/uyum için ucuz model, derin değerlendirme ve sohbet için güçlü model
MODEL_TRIAGE = _env("YT_MODEL_TRIAGE", "claude-haiku-5-5")
MODEL_DEEP = _env("YT_MODEL_DEEP", "claude-sonnet-5-5")
MODEL_FIT = _env("YT_MODEL_FIT", "claude-haiku-5-5")
MODEL_CHAT = _env("YT_MODEL_CHAT", "claude-sonnet-5-5")

# Değerlendirme nerede: "agents" = bp ile açılmış Claude Code agent'ları (tmux; varsayılan), "cli" = claude -p
BACKEND = _env("YT_BACKEND", "agents")

# Bütçeler (claude -p'nin bildirdiği total_cost_usd üzerinden, liste fiyatı eşdeğeri)
BUDGET_EVAL_USD_DAY = _env("YT_BUDGET_EVAL_USD_DAY", 6.0, float)   # triage + derin + uyum
BUDGET_CHAT_USD_DAY = _env("YT_BUDGET_CHAT_USD_DAY", 5.0, float)   # tüm kullanıcıların sohbeti
DEEP_MAX_PER_DAY = _env("YT_DEEP_MAX_PER_DAY", 60, int)
DEEP_MAX_USD_EACH = _env("YT_DEEP_MAX_USD_EACH", 0.60, float)
CHAT_MSGS_PER_USER_DAY = _env("YT_CHAT_MSGS_PER_USER_DAY", 60, int)
CHAT_MSGS_PER_USER_MIN = _env("YT_CHAT_MSGS_PER_USER_MIN", 6, int)
MAX_CHANNELS_PER_USER = _env("YT_MAX_CHANNELS_PER_USER", 400, int)

# Hat ayarları
QUALITY_THRESHOLD = _env("YT_QUALITY_THRESHOLD", 6.0, float)    # akışa girme eşiği
COMMUNITY_THRESHOLD = _env("YT_COMMUNITY_THRESHOLD", 7.5, float)  # başkalarının akışına girme
CHANNEL_REFRESH_HOURS = _env("YT_CHANNEL_REFRESH_HOURS", 8, float)
VIDEOS_PER_CHANNEL_FIRST = _env("YT_VIDEOS_PER_CHANNEL_FIRST", 8, int)
VIDEOS_PER_CHANNEL_REFRESH = _env("YT_VIDEOS_PER_CHANNEL_REFRESH", 15, int)
MIN_DURATION_S = _env("YT_MIN_DURATION_S", 150, int)  # Shorts ve kırıntıları ele

COOKIE = "yt_tok"
