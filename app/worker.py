"""Değerlendirme hattı worker'ı (systemd: yt-worker.service)."""
import os

from . import db, pipeline

if __name__ == "__main__":
    db.init()
    pipeline.Worker(parallel=int(os.environ.get("YT_DEEP_PARALLEL", "2"))).loop()
