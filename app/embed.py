"""bge-small-en-v1.5 (fastembed, HackerTube'un kullandığı model) — sorgu ve yeni video gömmeleri."""
import json
import threading

import numpy as np

from . import config

_model = None
_lock = threading.Lock()


def model():
    global _model
    with _lock:
        if _model is None:
            from fastembed import TextEmbedding
            _model = TextEmbedding("BAAI/bge-small-en-v1.5", cache_dir=str(config.MODELS), threads=2)
    return _model


def embed(texts):
    texts = list(texts)
    if not texts:
        return np.zeros((0, 384), dtype=np.float32)
    m = model()
    with _lock:
        arr = np.array(list(m.embed(texts)), dtype=np.float32)
    arr /= np.linalg.norm(arr, axis=1, keepdims=True) + 1e-9
    return arr


def video_text(title, channel, card):
    """HackerTube'un gömdüğü alanlara yakın bir metin: başlık, kanal, konu, kategoriler, özet, gerekçe."""
    card = card or {}
    cats = ", ".join(c.get("name", "") for c in card.get("categories") or [])
    parts = [title or "", channel or "", card.get("primary_topic") or "", ", ".join(card.get("tags") or []), cats,
             card.get("summary") or "", card.get("why") or ""]
    return ". ".join(p for p in parts if p)


def load_ht():
    emb = np.load(config.DATA / "embeddings.npy").astype(np.float32)
    ids = json.load(open(config.DATA / "embedding_ids.json"))
    return ids, emb
