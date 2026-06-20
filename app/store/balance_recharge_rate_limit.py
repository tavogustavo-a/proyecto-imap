# Límite de envíos de comprobantes por usuario (anti-spam).

from __future__ import annotations

import threading
import time

_SUBMIT_STORE: dict[str, list[float]] = {}
_SUBMIT_LOCK = threading.Lock()
_SUBMIT_MAX_PER_WINDOW = 10
_SUBMIT_WINDOW_SEC = 600


def balance_recharge_submit_rate_limit_error(user_id: int, ip: str = '') -> str | None:
    """None si puede enviar; mensaje de error si superó el límite."""
    uid = int(user_id or 0)
    if uid <= 0:
        return None
    key = f'u:{uid}'
    if ip:
        key = f'{key}:ip:{ip.strip()}'
    now = time.time()
    with _SUBMIT_LOCK:
        bucket = [t for t in _SUBMIT_STORE.get(key, []) if now - t < _SUBMIT_WINDOW_SEC]
        if len(bucket) >= _SUBMIT_MAX_PER_WINDOW:
            return (
                'Demasiados envíos de comprobantes. Espera unos minutos e intenta de nuevo.'
            )
        bucket.append(now)
        _SUBMIT_STORE[key] = bucket
    return None
