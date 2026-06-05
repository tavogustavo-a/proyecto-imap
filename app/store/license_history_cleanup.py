# Limpieza del historial · Licencias (portal_license_activity_log en users).
#
# Solo elimina entradas JSON del registro portal (reportes, caídas, renovaciones de estado).
# No borra cuentas ni licencias del inventario.

import json
import logging
import threading
import time
from datetime import datetime, time as dt_time, timedelta, timezone

from app.extensions import db
from app.models.user import User
from app.store.models import StoreSetting
from app.store.user_license_activity import _parse_iso_ts_naive
from app.utils.timezone import COLOMBIA_TZ, get_colombia_now

logger = logging.getLogger(__name__)

SETTINGS_KEY = 'license_history_cleanup'
PURGE_USER_BATCH = 40
PURGE_BATCH_PAUSE_SEC = 0.06

_loop_started = {'started': False}
_loop_lock = threading.Lock()
_purge_job_lock = threading.Lock()
_purge_job_running = False


def _default_settings():
    return {
        'auto_enabled': False,
        'retention_days': 90,
        'run_interval_hours': 24,
        'scope': 'all',
        'user_id': None,
        'last_run_at': None,
        'last_deleted_count': 0,
    }


def get_cleanup_settings():
    row = StoreSetting.query.filter_by(key=SETTINGS_KEY).first()
    data = _default_settings()
    if row and row.value:
        try:
            stored = json.loads(row.value)
            if isinstance(stored, dict):
                data.update({k: stored[k] for k in data if k in stored})
                if 'last_run_at' in stored:
                    data['last_run_at'] = stored.get('last_run_at')
                if 'last_deleted_count' in stored:
                    data['last_deleted_count'] = stored.get('last_deleted_count', 0)
        except (json.JSONDecodeError, TypeError):
            pass
    return data


def save_cleanup_settings(updates):
    prev = get_cleanup_settings()
    data = prev.copy()
    data.update(updates)
    row = StoreSetting.query.filter_by(key=SETTINGS_KEY).first()
    payload = json.dumps(data, ensure_ascii=False)
    if row:
        row.value = payload
    else:
        db.session.add(StoreSetting(key=SETTINGS_KEY, value=payload))
    db.session.commit()
    if data.get('auto_enabled') and not prev.get('auto_enabled'):
        try:
            from flask import current_app

            _ensure_cleanup_loop_running(current_app._get_current_object())
        except Exception:
            pass
    return data


def _ensure_cleanup_loop_running(app):
    from app.store.cleanup_poll_schedule import maybe_start_cleanup_loop

    def _start_thread():
        thread = threading.Thread(
            target=_cleanup_loop,
            args=(app,),
            daemon=True,
            name='license-history-cleanup',
        )
        thread.start()

    maybe_start_cleanup_loop(
        app,
        _loop_started,
        _loop_lock,
        _start_thread,
        get_cleanup_settings,
    )


def is_purge_running():
    with _purge_job_lock:
        return _purge_job_running


def _cutoff_naive(days):
    """Antigüedad mínima en días calendario (Colombia). None = sin filtro (0 = todo el registro)."""
    days = int(days)
    if days <= 0:
        return None
    days = max(1, days)
    today = get_colombia_now().date()
    last_eligible_date = today - timedelta(days=days)
    end_local = datetime.combine(last_eligible_date, dt_time.max)
    if end_local.tzinfo is None:
        end_local = COLOMBIA_TZ.localize(end_local)
    return end_local.astimezone(timezone.utc).replace(tzinfo=None)


def _load_log_items(raw):
    if not str(raw or '').strip():
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _count_removable_in_items(items, cutoff):
    n = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        if cutoff is None:
            n += 1
            continue
        dt = _parse_iso_ts_naive(it.get('ts'))
        if dt is not None and dt <= cutoff:
            n += 1
    return n


def _filter_items_keep_newer(items, cutoff):
    if cutoff is None:
        return []
    kept = []
    for it in items:
        if not isinstance(it, dict):
            continue
        dt = _parse_iso_ts_naive(it.get('ts'))
        if dt is None or dt > cutoff:
            kept.append(it)
    return kept


def _users_query(user_id=None):
    q = User.query.filter(User.portal_license_activity_log.isnot(None))
    if user_id is not None:
        q = q.filter(User.id == int(user_id))
    return q


def count_portal_entries_to_purge(retention_days, user_id=None):
    cutoff = _cutoff_naive(retention_days)
    total = 0
    for u in _users_query(user_id).all():
        total += _count_removable_in_items(
            _load_log_items(getattr(u, 'portal_license_activity_log', None)),
            cutoff,
        )
    return total


def purge_portal_logs_batched(retention_days, user_id=None):
    cutoff = _cutoff_naive(retention_days)
    total_deleted = 0
    offset = 0

    while True:
        batch = (
            _users_query(user_id)
            .order_by(User.id.asc())
            .offset(offset)
            .limit(PURGE_USER_BATCH)
            .all()
        )
        if not batch:
            break

        changed = False
        for u in batch:
            raw = getattr(u, 'portal_license_activity_log', None)
            items = _load_log_items(raw)
            if not items:
                continue
            before = len(items)
            kept = _filter_items_keep_newer(items, cutoff)
            removed = before - len(kept)
            if removed <= 0:
                continue
            u.portal_license_activity_log = json.dumps(kept, ensure_ascii=False)
            total_deleted += removed
            changed = True

        if changed:
            db.session.commit()

        if len(batch) < PURGE_USER_BATCH:
            break
        offset += PURGE_USER_BATCH
        time.sleep(PURGE_BATCH_PAUSE_SEC)

    return total_deleted


def enqueue_purge_background(
    app,
    retention_days,
    user_id=None,
    kind='manual',
    scope='all',
    mark_auto_run=False,
):
    global _purge_job_running

    with _purge_job_lock:
        if _purge_job_running:
            return False
        _purge_job_running = True

    kind = (kind or 'manual').strip().lower()
    if kind not in ('manual', 'automatica'):
        kind = 'manual'

    def _worker():
        global _purge_job_running
        deleted = 0
        try:
            with app.app_context():
                deleted = purge_portal_logs_batched(retention_days, user_id=user_id)
                if mark_auto_run:
                    now = datetime.now(timezone.utc).replace(tzinfo=None)
                    settings = get_cleanup_settings()
                    settings['last_run_at'] = now.isoformat()
                    settings['last_deleted_count'] = deleted
                    save_cleanup_settings(settings)
                if deleted:
                    logger.info(
                        'Limpieza %s historial licencias (portal): %s entradas (> %s días)',
                        kind,
                        deleted,
                        retention_days,
                    )
        except Exception as exc:
            logger.exception(
                'Error en limpieza %s del historial licencias: %s', kind, exc
            )
            try:
                with app.app_context():
                    db.session.rollback()
            except Exception:
                pass
        finally:
            with _purge_job_lock:
                _purge_job_running = False

    thread = threading.Thread(
        target=_worker,
        daemon=True,
        name=f'license-history-purge-{kind}',
    )
    thread.start()
    return True


def run_scheduled_cleanup_if_due(app):
    with app.app_context():
        try:
            settings = get_cleanup_settings()
            if not settings.get('auto_enabled'):
                return 0

            if is_purge_running():
                return 0

            interval_h = max(1, int(settings.get('run_interval_hours') or 24))
            retention = max(1, int(settings.get('retention_days') or 90))
            last_run = settings.get('last_run_at')
            now = datetime.now(timezone.utc).replace(tzinfo=None)

            if last_run:
                try:
                    last_dt = datetime.fromisoformat(str(last_run).replace('Z', ''))
                except ValueError:
                    last_dt = None
                if last_dt and (now - last_dt).total_seconds() < interval_h * 3600:
                    return 0

            user_id = None
            scope = settings.get('scope') or 'all'
            if settings.get('scope') == 'user' and settings.get('user_id'):
                user_id = int(settings['user_id'])

            settings['last_run_at'] = now.isoformat()
            save_cleanup_settings(settings)

            started = enqueue_purge_background(
                app,
                retention,
                user_id=user_id,
                kind='automatica',
                scope=scope,
                mark_auto_run=True,
            )
            return -1 if started else 0
        except Exception as exc:
            logger.exception('Error al programar limpieza historial licencias: %s', exc)
            db.session.rollback()
            return 0


def _cleanup_loop(app):
    from app.store.cleanup_poll_schedule import run_adaptive_cleanup_loop

    run_adaptive_cleanup_loop(app, get_cleanup_settings, run_scheduled_cleanup_if_due)


def start_license_history_cleanup_loop(app):
    _ensure_cleanup_loop_running(app)
