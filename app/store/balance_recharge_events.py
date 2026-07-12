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

from app.extensions import db

logger = logging.getLogger(__name__)

_HEARTBEAT_SEC = 25
_MAX_QUEUE = 32
_REDIS_CHANNEL = 'balance_recharge:sse'
_redis_listener_started = False
_redis_listener_lock = threading.Lock()
_redis_unavailable_logged = False
_REDIS_LISTENER_RETRY_SEC = 1.0
_REDIS_LISTENER_MAX_ATTEMPTS = 20
_REDIS_LISTENER_START_DELAY_SEC = 3.0


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


def _cooperative_sleep(seconds: float) -> None:
    if seconds <= 0:
        return
    try:
        import gevent

        gevent.sleep(seconds)
    except ImportError:
        time.sleep(seconds)


def _resolve_redis_url_from_environ() -> str | None:
    for key in ('BALANCE_RECHARGE_EVENTS_REDIS_URL', 'REDIS_URL'):
        url = (os.environ.get(key) or '').strip()
        if url:
            return url
    host = (os.environ.get('REDIS_HOST') or '').strip()
    if not host:
        return None
    port = (os.environ.get('REDIS_PORT') or '6379').strip()
    db = (os.environ.get('REDIS_DB') or '0').strip()
    password = (os.environ.get('REDIS_PASSWORD') or '').strip()
    if password:
        return f'redis://:{password}@{host}:{port}/{db}'
    return f'redis://{host}:{port}/{db}'


def _redis_url_from_env() -> str | None:
    return _resolve_redis_url_from_environ()


def _redis_url_from_app() -> str | None:
    try:
        from flask import current_app

        url = (current_app.config.get('BALANCE_RECHARGE_EVENTS_REDIS_URL') or '').strip()
        return url or None
    except RuntimeError:
        return None


def recharge_events_redis_url() -> str | None:
    return _redis_url_from_app() or _resolve_redis_url_from_environ()


def balance_recharge_events_redis_enabled() -> bool:
    return bool(recharge_events_redis_url())


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


def _redis_client(url: str, *, pubsub_listener: bool = False):
    import redis

    kwargs: dict[str, Any] = {
        'decode_responses': True,
        'socket_connect_timeout': 10,
        'socket_keepalive': True,
        'health_check_interval': 30,
    }
    if pubsub_listener:
        kwargs['socket_timeout'] = None
    else:
        kwargs['socket_timeout'] = 10
    return redis.from_url(url, **kwargs)


def _redis_open_pubsub(url: str):
    """Conecta pub/sub con reintentos."""
    last_exc: Exception | None = None
    for attempt in range(1, _REDIS_LISTENER_MAX_ATTEMPTS + 1):
        client = None
        pubsub = None
        try:
            client = _redis_client(url, pubsub_listener=True)
            client.ping()
            pubsub = client.pubsub(ignore_subscribe_messages=True)
            pubsub.subscribe(_REDIS_CHANNEL)
            return client, pubsub
        except Exception as exc:
            last_exc = exc
            if pubsub is not None:
                try:
                    pubsub.close()
                except Exception:
                    pass
            if client is not None:
                try:
                    client.close()
                except Exception:
                    pass
            if attempt < _REDIS_LISTENER_MAX_ATTEMPTS:
                logger.warning(
                    'SSE recargas: esperando Redis (%s); reintento %s/%s',
                    exc,
                    attempt,
                    _REDIS_LISTENER_MAX_ATTEMPTS,
                )
                _cooperative_sleep(_REDIS_LISTENER_RETRY_SEC)
    raise last_exc or RuntimeError('Redis no disponible para SSE')


def _redis_publish_envelope(
    payload: dict[str, Any],
    user_id: int | None,
    *,
    broadcast_admin: bool,
    origin_pid: int,
) -> bool:
    url = recharge_events_redis_url()
    if not url:
        return False
    try:
        client = _redis_client(url, pubsub_listener=False)
        try:
            envelope = {
                'user_id': int(user_id) if user_id is not None else None,
                'broadcast_admin': bool(broadcast_admin),
                'origin_pid': int(origin_pid),
                'payload': payload,
            }
            client.publish(_REDIS_CHANNEL, json.dumps(envelope, ensure_ascii=False))
            return True
        finally:
            try:
                client.close()
            except Exception:
                pass
    except Exception as exc:
        _log_redis_unavailable_once(exc)
        return False


def _redis_listener_loop(app, url: str) -> None:
    """Escucha pub/sub en greenlet (compatible con gevent/Gunicorn)."""
    worker_pid = os.getpid()
    while True:
        pubsub = None
        client = None
        try:
            client, pubsub = _redis_open_pubsub(url)
            logger.warning(
                'SSE recargas: listener Redis conectado (worker pid=%s, canal %s).',
                worker_pid,
                _REDIS_CHANNEL,
            )
            while True:
                raw = pubsub.get_message(timeout=30.0)
                if raw is None:
                    continue
                if raw.get('type') != 'message':
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
                origin_pid = envelope.get('origin_pid')
                if origin_pid is not None and int(origin_pid) == worker_pid:
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
            logger.warning(
                'SSE recargas: listener Redis interrumpido en pid=%s (%s); reconectando…',
                worker_pid,
                exc,
            )
        finally:
            if pubsub is not None:
                try:
                    pubsub.unsubscribe(_REDIS_CHANNEL)
                    pubsub.close()
                except Exception:
                    pass
            if client is not None:
                try:
                    client.close()
                except Exception:
                    pass
        _cooperative_sleep(3.0)


def _redis_listener_loop_entry(app, url: str) -> None:
    if _REDIS_LISTENER_START_DELAY_SEC > 0:
        _cooperative_sleep(_REDIS_LISTENER_START_DELAY_SEC)
    _redis_listener_loop(app, url)


def start_balance_recharge_events_redis_listener(app) -> None:
    """Suscriptor Redis por worker (greenlet gevent, no thread)."""
    global _redis_listener_started
    url = (app.config.get('BALANCE_RECHARGE_EVENTS_REDIS_URL') or '').strip()
    if not url:
        url = (_resolve_redis_url_from_environ() or '').strip()
    if url and not (app.config.get('BALANCE_RECHARGE_EVENTS_REDIS_URL') or '').strip():
        app.config['BALANCE_RECHARGE_EVENTS_REDIS_URL'] = url
    if not url:
        env = (
            (app.config.get('FLASK_ENV') or os.environ.get('FLASK_ENV') or 'development')
            .strip()
            .lower()
        )
        if env == 'production':
            logger.warning(
                'SSE recargas: sin Redis (BALANCE_RECHARGE_EVENTS_REDIS_URL, REDIS_URL o REDIS_HOST). '
                'Con varios workers Gunicorn las actualizaciones en tiempo real solo llegan al worker '
                'que procesó la acción.'
            )
        return
    with _redis_listener_lock:
        if _redis_listener_started:
            return
        _redis_listener_started = True

    logger.info(
        'SSE recargas: Redis activo para repartir eventos entre workers (pid=%s).',
        os.getpid(),
    )

    try:
        import gevent

        gevent.spawn(_redis_listener_loop_entry, app, url)
        backend = 'gevent'
    except ImportError:
        thread = threading.Thread(
            target=_redis_listener_loop_entry,
            args=(app, url),
            daemon=True,
            name='balance-recharge-events-redis',
        )
        thread.start()
        backend = 'thread'

    logger.warning(
        'SSE recargas: listener Redis programado via %s (pid=%s, delay %.0fs).',
        backend,
        os.getpid(),
        _REDIS_LISTENER_START_DELAY_SEC,
    )


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

    origin_pid = os.getpid()
    try:
        redis_url = recharge_events_redis_url()
        if redis_url:
            _local_deliver(payload, user_id, broadcast_admin=broadcast_admin)
            if not _redis_publish_envelope(
                payload,
                user_id,
                broadcast_admin=broadcast_admin,
                origin_pid=origin_pid,
            ):
                logger.warning(
                    'SSE recargas: publish Redis falló en pid=%s; otros workers no verán el evento.',
                    origin_pid,
                )
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
    try:
        from app.store.store_event_notify import notify_balance_recharge_event

        notify_balance_recharge_event(row, reason=reason)
        db.session.commit()
    except Exception as exc:
        logger.warning('notify_balance_recharge_event: %s', exc)
        try:
            db.session.rollback()
        except Exception:
            pass


def recharge_events_heartbeat_seconds() -> int:
    return _HEARTBEAT_SEC
