# Notificaciones en tiempo real (SSE) para recargas de saldo — solo empuja cuando hay cambios.
# Con BALANCE_RECHARGE_EVENTS_REDIS_URL reparte eventos entre workers Gunicorn vía Redis pub/sub.

from __future__ import annotations

import json
import logging
import os
import queue
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

_HEARTBEAT_SEC = 25
_MAX_QUEUE = 32
_REDIS_CHANNEL = 'balance_recharge:sse'
_redis_listener_started = False
_redis_listener_lock = threading.Lock()
_redis_unavailable_logged = False


class _RechargeEventHub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._admin_subs: list[queue.Queue[str]] = []
        self._user_subs: dict[int, list[queue.Queue[str]]] = {}

    def subscribe_admin(self) -> queue.Queue[str]:
        q: queue.Queue[str] = queue.Queue(maxsize=_MAX_QUEUE)
        with self._lock:
            self._admin_subs.append(q)
        return q

    def unsubscribe_admin(self, q: queue.Queue[str]) -> None:
        with self._lock:
            if q in self._admin_subs:
                self._admin_subs.remove(q)

    def subscribe_user(self, user_id: int) -> queue.Queue[str]:
        q: queue.Queue[str] = queue.Queue(maxsize=_MAX_QUEUE)
        uid = int(user_id)
        with self._lock:
            self._user_subs.setdefault(uid, []).append(q)
        return q

    def unsubscribe_user(self, user_id: int, q: queue.Queue[str]) -> None:
        uid = int(user_id)
        with self._lock:
            subs = self._user_subs.get(uid)
            if not subs:
                return
            if q in subs:
                subs.remove(q)
            if not subs:
                self._user_subs.pop(uid, None)

    def _push_many(self, subs: list[queue.Queue[str]], payload: dict[str, Any]) -> list[queue.Queue[str]]:
        if not subs:
            return []
        line = json.dumps(payload, ensure_ascii=False)
        dead: list[queue.Queue[str]] = []
        for q in list(subs):
            try:
                q.put_nowait(line)
            except queue.Full:
                try:
                    q.get_nowait()
                except queue.Empty:
                    pass
                try:
                    q.put_nowait(line)
                except queue.Full:
                    dead.append(q)
            except Exception:
                dead.append(q)
        return dead

    def publish_admin(self, payload: dict[str, Any]) -> None:
        with self._lock:
            subs = list(self._admin_subs)
        dead = self._push_many(subs, payload)
        if dead:
            with self._lock:
                for q in dead:
                    if q in self._admin_subs:
                        self._admin_subs.remove(q)

    def publish_user(self, user_id: int, payload: dict[str, Any]) -> None:
        uid = int(user_id)
        with self._lock:
            subs = list(self._user_subs.get(uid) or [])
        dead = self._push_many(subs, payload)
        if dead:
            with self._lock:
                live = self._user_subs.get(uid) or []
                for q in dead:
                    if q in live:
                        live.remove(q)
                if not live:
                    self._user_subs.pop(uid, None)


_hub = _RechargeEventHub()


def _redis_url_from_env() -> str | None:
    url = (os.environ.get('BALANCE_RECHARGE_EVENTS_REDIS_URL') or '').strip()
    return url or None


def _redis_url_from_app() -> str | None:
    try:
        from flask import current_app

        url = (current_app.config.get('BALANCE_RECHARGE_EVENTS_REDIS_URL') or '').strip()
        return url or None
    except RuntimeError:
        return None


def recharge_events_redis_url() -> str | None:
    return _redis_url_from_app() or _redis_url_from_env()


def _log_redis_unavailable_once(exc: Exception) -> None:
    global _redis_unavailable_logged
    if _redis_unavailable_logged:
        return
    _redis_unavailable_logged = True
    logger.warning(
        'SSE recargas: Redis no disponible (%s); solo notificaciones en el worker local.',
        exc,
    )


def _local_deliver(
    payload: dict[str, Any],
    user_id: int | None,
    *,
    broadcast_admin: bool,
) -> None:
    if user_id is not None:
        _hub.publish_user(int(user_id), payload)
    if broadcast_admin:
        _hub.publish_admin(payload)


def _redis_publish_envelope(
    payload: dict[str, Any],
    user_id: int | None,
    *,
    broadcast_admin: bool,
) -> bool:
    url = recharge_events_redis_url()
    if not url:
        return False
    try:
        import redis

        client = redis.from_url(url, decode_responses=True)
        envelope = {
            'user_id': int(user_id) if user_id is not None else None,
            'broadcast_admin': bool(broadcast_admin),
            'payload': payload,
        }
        client.publish(_REDIS_CHANNEL, json.dumps(envelope, ensure_ascii=False))
        return True
    except Exception as exc:
        _log_redis_unavailable_once(exc)
        return False


def _redis_listener_loop(app, url: str) -> None:
    import redis

    while True:
        pubsub = None
        try:
            client = redis.from_url(url, decode_responses=True)
            pubsub = client.pubsub(ignore_subscribe_messages=True)
            pubsub.subscribe(_REDIS_CHANNEL)
            for raw in pubsub.listen():
                if not raw or raw.get('type') != 'message':
                    continue
                data = raw.get('data')
                if not data:
                    continue
                try:
                    envelope = json.loads(data)
                except (json.JSONDecodeError, TypeError):
                    continue
                if not isinstance(envelope, dict):
                    continue
                payload = envelope.get('payload')
                if not isinstance(payload, dict):
                    continue
                uid = envelope.get('user_id')
                broadcast_admin = bool(envelope.get('broadcast_admin', True))
                with app.app_context():
                    _local_deliver(
                        payload,
                        int(uid) if uid is not None else None,
                        broadcast_admin=broadcast_admin,
                    )
        except Exception as exc:
            logger.warning('SSE recargas: listener Redis interrumpido (%s); reconectando…', exc)
        finally:
            if pubsub is not None:
                try:
                    pubsub.close()
                except Exception:
                    pass
        time.sleep(3.0)


def start_balance_recharge_events_redis_listener(app) -> None:
    """Suscriptor Redis por worker (opcional). Sin URL configurada, no hace nada."""
    global _redis_listener_started
    url = (app.config.get('BALANCE_RECHARGE_EVENTS_REDIS_URL') or '').strip()
    if not url:
        return
    with _redis_listener_lock:
        if _redis_listener_started:
            return
        _redis_listener_started = True
    thread = threading.Thread(
        target=_redis_listener_loop,
        args=(app, url),
        daemon=True,
        name='balance-recharge-events-redis',
    )
    thread.start()
    logger.info('SSE recargas: listener Redis activo (%s).', _REDIS_CHANNEL)


def subscribe_admin_recharge_events() -> queue.Queue[str]:
    return _hub.subscribe_admin()


def unsubscribe_admin_recharge_events(q: queue.Queue[str]) -> None:
    _hub.unsubscribe_admin(q)


def subscribe_user_recharge_events(user_id: int) -> queue.Queue[str]:
    return _hub.subscribe_user(user_id)


def unsubscribe_user_recharge_events(user_id: int, q: queue.Queue[str]) -> None:
    _hub.unsubscribe_user(user_id, q)


def notify_balance_recharge_updated(
    user_id: int | None,
    *,
    recharge_id: int | None = None,
    reason: str = 'update',
    broadcast_admin: bool = True,
) -> None:
    """Avisa a clientes SSE conectados (usuario y/o admin) que hubo un cambio."""
    payload: dict[str, Any] = {
        'type': 'recharge_update',
        'reason': (reason or 'update').strip() or 'update',
    }
    if user_id is not None:
        payload['user_id'] = int(user_id)
    if recharge_id is not None:
        payload['recharge_id'] = int(recharge_id)
    try:
        if _redis_publish_envelope(payload, user_id, broadcast_admin=broadcast_admin):
            return
        _local_deliver(payload, user_id, broadcast_admin=broadcast_admin)
    except Exception as exc:
        logger.warning('No se pudo publicar evento de recarga: %s', exc)


def notify_from_recharge_row(
    row,
    *,
    reason: str = 'update',
    broadcast_admin: bool = True,
) -> None:
    uid = getattr(row, 'user_id', None)
    rid = getattr(row, 'id', None)
    if uid is None:
        if broadcast_admin:
            notify_balance_recharge_updated(None, recharge_id=rid, reason=reason, broadcast_admin=True)
        return
    notify_balance_recharge_updated(
        int(uid),
        recharge_id=int(rid) if rid is not None else None,
        reason=reason,
        broadcast_admin=broadcast_admin,
    )


def recharge_events_heartbeat_seconds() -> int:
    return _HEARTBEAT_SEC
