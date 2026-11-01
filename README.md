# HackerTune

HackerTube'un ([hackertube.org](https://hackertube.org), Andrej Karpathy) verisi üzerine kurulu, kendi barındırdığın bir YouTube
arayüzü. Canlı örnek: https://ht.tunapro.xyz

*A self-hosted YouTube front end built on the HackerTube dataset: the videos Hacker News keeps recommending, plus your
own subscriptions vetted by Claude Code agents, chat about any video, a conversational recommender, and background
audio that keeps playing with the phone's screen off. The UI is in English; this README is in Turkish.*

## Ne yapar

- **HackerTube akışı:** HN yorumlarında 2007'den beri birbirine önerilen 6.454 video; konu ağacı, benzer videolar,
  HN alıntıları, anlamsal arama (bge-small embedding'leri).
- **Aboneliklerinden agent seçkisi:** kanal listeni (Takeout CSV, OPML ya da link listesi) verirsin, YouTube hesabına
  bağlanmadan. Yeni videolar arka plandaki **Claude Code agent'larına** gider: Haiku ön eleme yapar, Opus transcript'i
  okur, Hacker News'te arar, HackerTube'daki benzerleriyle kıyaslar ve 0–10 puan + HackerTube formatında kart yazar.
  Eşiği geçenler akışa girer.
- **Video sohbeti:** transcript'i, kartı ve HN yorumlarını okuyan sohbet; zaman damgalarına tıklayınca video oraya atlar.
- **Vitrin (Showcase):** kişisel küratör agent'ı (`youtube-curator`) geçmişine, beğenilerine ve profiline bakıp raflar kurar:
  seçkiler, sırayla izlenecek seriler ve hiç aramayacağın ama bayılacağın uzak konulardan sürprizler (katalog dışından da).
- **Konuşarak yönlendirilen algoritma:** "daha az siyaset, daha çok donanım" dersin, profilin açıkça güncellenir.
- **Ekran kapalıyken dinleme:** telefonda ses kendi `<audio>` oynatıcısından gelir, video sessiz ve senkron akar;
  telefonu kilitlesen de ses sürer (iPhone'da gerçek cihazda doğrulandı). Kilit ekranı kontrolleri Media Session ile.
- **İzleme geçmişi:** video ya da ses, kaldığın saniyeyle kaydedilir; kaldığın yerden devam.
- Hesap yok: rastgele kimlik çerezi + cihazlar arası senkron linki.

## Mimari

```
nginx ── yt-web  (FastAPI, app/web.py)      SPA (app/static), API, ses vekili (/api/audio), sohbet (SSE)
     └─ SQLite (var/yt.db, WAL)
         yt-worker (app/worker.py)           içe aktarma, kanal tarama, embedding, iş kuyruğu (jobs)
             ▲ ytctl next / submit
         Claude Code agent'ları (bp ile tmux'ta): youtube-eval-1/2 (derin), youtube-triage (ön eleme + uyum + çeviri),
                                             youtube-curator (vitrin)
```

- **Çekme modeli:** agent'lar `bin/ytctl next <ad>` ile kuyruktan iş alır, `ytctl meta|transcript|hn|similar|channel`
  ile araştırır, `ytctl submit` ile sonucu yazar. Oturum içi bir zamanlayıcı (CronCreate, 10 dk) onları uyandırır.
- **Kabuk kilidi:** `bin/agent-guard.py` bir PreToolUse kancası; agent'lar yalnızca `ytctl` çalıştırabilir.
  Transcript ve yorumlar veri olarak işlenir, içlerindeki talimatlar agent'ı yönlendiremez.
- `YT_BACKEND=claude-p` ile agent'sız çalışır: değerlendirme headless `claude -p` çağrılarıyla yapılır.

## Kurulum

Gerekenler: Linux, Python 3.12+, [yt-dlp](https://github.com/yt-dlp/yt-dlp), giriş yapılmış
[Claude Code](https://claude.com/claude-code) (`claude`), agent modu için `bp` (tmux tabanlı agent orkestratörü) ve tmux.

```sh
git clone https://github.com/tunapro1234/hackertune && cd hackertune
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# HackerTube verisi (ODC-By 1.0)
mkdir -p data/raw/hackertube-data
curl -L -o /tmp/hackertube-data.zip https://hackertube.org/download/hackertube-data.zip
unzip -j /tmp/hackertube-data.zip -d data/raw/hackertube-data
.venv/bin/python -m app.ingest_ht

# embedding modelini bir kez indir (servisler HF_HUB_OFFLINE=1 ile çalışır)
FASTEMBED_CACHE_PATH=var/models .venv/bin/python -c "from app import embed; embed.model()"

cp yt.env.example yt.env   # YT_PUBLIC_URL vb. ayarla
```

Servisler ve nginx için `deploy/` altındaki dosyalar örnek: `yt-web.service`, `yt-worker.service`, `nginx-yt.conf`
(yollar `/srv/youtube` varsayıyor; kendi dizinine göre düzenle). `/api/audio/` bloğu tamponsuz olmalı.

Agent'lar (isteğe bağlı, `YT_BACKEND=agents`):

```sh
bp open youtube-eval-1 $PWD/agents/eval-1 --claude --parent youtube
bp open youtube-eval-2 $PWD/agents/eval-2 --claude --parent youtube
bp open youtube-triage $PWD/agents/triage --claude --parent youtube
bp open youtube-curator $PWD/agents/curator --claude --parent youtube
```

iOS uygulaması (WKWebView kabuğu, arka plan sesi) `ios/` altında; Mac gerekmez, GitHub Actions'ta derlenip TestFlight'a
yüklenir. Adımlar: [ios/README.md](ios/README.md).

Her agent'ın modeli ve kancası `agents/<ad>/.claude/settings.local.json` içinde, talimatları `agents/<ad>/CLAUDE.md`.
Bu dosyalardaki `/srv/youtube` yolları mutlaktır; başka bir dizine kurduysan `grep -rl /srv/youtube agents | xargs sed -i
"s#/srv/youtube#$PWD#g"` ile değiştir. `bin/ytctl` ve `bin/agent-guard.py` yolu kendi konumlarından bulur.

Agent'lar oturum içi bir zamanlayıcıyla uyanır ve bu zamanlayıcı 7 günde sona erer; `ytctl next` 6. gün uyarır,
agent'a yeniden kurmasını söylemek yeterli.

## Notlar

- Arka plan sesi YouTube'un ses akışını sunucu üzerinden aktarır (akış adresi sunucunun IP'sine bağlı). Bu YouTube'un
  kullanım koşullarıyla çelişebilir; kişisel kullanım için tasarlandı, sorumluluk sende.
- Arayüz düzeni HackerTube'dan esinlenir; kod bu depoya aittir (HackerTube'un kodu yayımlanmadı).

## Emek ve lisans

- Veri: [HackerTube](https://hackertube.org) (ODC-By 1.0) ve
  [open-index/hacker-news](https://huggingface.co/datasets/open-index/hacker-news). Hacker News verisi Y Combinator'ın,
  yorumlar yazarlarınındır. Bu proje YouTube, Google, Hacker News ya da Y Combinator ile bağlantılı değildir.
- Simgeler: [Material Symbols](https://fonts.google.com/icons) (Apache-2.0).
- Kod: MIT, bkz. [LICENSE](LICENSE). Claude Code ile yazıldı.
