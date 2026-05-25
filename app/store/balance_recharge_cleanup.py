# Limpieza del historial de recargas/consignaciones — manual y programada.

import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.store.models import BalanceRecharge, StoreSetting

logger = logging.getLogger(__name__)

SETTINGS_KEY = 'balance_recharge_cleanup'
PURGE_BATCH_SIZE = 100
PURGE_BATCH_PAUSE_SEC = 0.08

_loop_started = False
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
    data = get_cleanup_settings()
    data.update(updates)
    row = StoreSetting.query.filter_by(key=SETTINGS_KEY).first()
    payload = json.dumps(data, ensure_ascii=False)
    if row:
        row.value = payload
    else:
        db.session.add(StoreSetting(key=SETTINGS_KEY, value=payload))
    db.session.commit()
    return data


def is_purge_running():
    with _purge_job_lock:
        return _purge_job_running


def _cutoff_utc(days):
    days = max(1, int(days))
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)


def _upload_dir(app):
    upload_dir = os.path.join(app.instance_path, 'uploads', 'balance_recharges')
    os.makedirs(upload_dir, exist_ok=True)
    return upload_dir


def _proof_files_list(recharge_row):
    raw = getattr(recharge_row, 'proof_files_json', None) or '[]'
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    return data if isinstance(data, list) else []


def _referenced_proof_filenames():
    """Nombres de archivo de comprobantes aún referenciados en BD."""
    refs = set()
    for row in BalanceRecharge.query.with_entities(BalanceRecharge.proof_files_json).all():
        raw = row[0] if row else None
        try:
            items = json.loads(raw or '[]')
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(items, list):
            continue
        for entry in items:
            if isinstance(entry, dict):
                stored = (entry.get('stored') or '').strip()
                if stored:
                    refs.add(stored)
    return refs


def cleanup_orphan_proof_files(app):
    """Elimina imágenes en disco sin fila en store_balance_recharges."""
    upload_dir = _upload_dir(app)
    if not os.path.isdir(upload_dir):
        return 0
    referenced = _referenced_proof_filenames()
    deleted = 0
    try:
        for name in os.listdir(upload_dir):
            path = os.path.join(upload_dir, name)
            if not os.path.isfile(path):
                continue
            if name in referenced:
                continue
            try:
                os.remove(path)
                deleted += 1
            except OSError as exc:
                logger.warning('No se pudo borrar comprobante huérfano %s: %s', path, exc)
    except OSError as exc:
        logger.warning('No se pudo listar directorio de comprobantes: %s', exc)
    return deleted


def _delete_proof_files(app, recharge_row):
    upload_dir = _upload_dir(app)
    deleted = 0
    for entry in _proof_files_list(recharge_row):
        if not isinstance(entry, dict):
            continue
        stored = entry.get('stored')
        if not stored:
            continue
        path = os.path.join(upload_dir, stored)
        try:
            if os.path.isfile(path):
                os.remove(path)
                deleted += 1
        except OSError as exc:
            logger.warning('No se pudo borrar comprobante %s: %s', path, exc)
    return deleted


def delete_proof_files_for_user_ids(app, user_ids):
    """Borra comprobantes en disco antes de eliminar usuarios (CASCADE solo limpia BD)."""
    if not user_ids:
        return 0
    ids = [int(x) for x in user_ids if x is not None]
    if not ids:
        return 0
    rows = BalanceRecharge.query.filter(BalanceRecharge.user_id.in_(ids)).all()
    total = 0
    for row in rows:
        total += _delete_proof_files(app, row)
    return total


def _recharges_query_before_cutoff(cutoff, user_id=None):
    q = BalanceRecharge.query.filter(BalanceRecharge.created_at < cutoff)
    if user_id is not None:
        q = q.filter(BalanceRecharge.user_id == int(user_id))
    return q


def count_recharges_to_purge(retention_days, user_id=None):
    cutoff = _cutoff_utc(retention_days)
    return _recharges_query_before_cutoff(cutoff, user_id).count()


def purge_recharges_batched(app, retention_days, user_id=None, batch_size=PURGE_BATCH_SIZE):
    cutoff = _cutoff_utc(retention_days)
    total_deleted = 0
    batch_size = max(25, int(batch_size or PURGE_BATCH_SIZE))

    while True:
        rows = (
            _recharges_query_before_cutoff(cutoff, user_id)
            .order_by(BalanceRecharge.id.asc())
            .limit(batch_size)
            .all()
        )
        if not rows:
            break

        ids = [r.id for r in rows]
        for row in rows:
            _delete_proof_files(app, row)

        BalanceRecharge.query.filter(BalanceRecharge.id.in_(ids)).delete(synchronize_session=False)
        db.session.commit()
        total_deleted += len(ids)

        if len(rows) < batch_size:
            break
        time.sleep(PURGE_BATCH_PAUSE_SEC)

    cleanup_orphan_proof_files(app)
    return total_deleted


def enqueue_purge_background(
    app,
    retention_days,
    user_id=None,
    mark_auto_run=False,
):
    global _purge_job_running

    with _purge_job_lock:
        if _purge_job_running:
            return False
        _purge_job_running = True

    def _worker():
        global _purge_job_running
        deleted = 0
        try:
            with app.app_context():
                deleted = purge_recharges_batched(app, retention_days, user_id=user_id)
                if mark_auto_run:
                    now = datetime.now(timezone.utc).replace(tzinfo=None)
                    settings = get_cleanup_settings()
                    settings['last_run_at'] = now.isoformat()
                    settings['last_deleted_count'] = deleted
                    save_cleanup_settings(settings)
                if deleted:
                    logger.info(
                        'Limpieza recargas saldo (segundo plano): %s solicitudes (> %s días)',
                        deleted,
                        retention_days,
                    )
        except Exception as exc:
            logger.exception('Error en limpieza del historial de recargas: %s', exc)
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
        name='balance-recharge-purge',
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
            if settings.get('scope') == 'user' and settings.get('user_id'):
                user_id = int(settings['user_id'])

            settings['last_run_at'] = now.isoformat()
            save_cleanup_settings(settings)

            started = enqueue_purge_background(
                app,
                retention,
                user_id=user_id,
                mark_auto_run=True,
            )
            if not started:
                cleanup_orphan_proof_files(app)
            return -1 if started else 0
        except Exception as exc:
            logger.exception('Error al programar limpieza automática de recargas: %s', exc)
            db.session.rollback()
            return 0


def _cleanup_loop():
    from app import create_app

    app = create_app()
    time.sleep(20)
    while True:
        try:
            with app.app_context():
                run_scheduled_cleanup_if_due(app)
                from app.services.disk_orphan_maintenance import run_disk_orphan_maintenance

                run_disk_orphan_maintenance(app)
        except Exception:
            pass
        time.sleep(300)


def start_balance_recharge_cleanup_loop():
    global _loop_started
    with _loop_lock:
        if _loop_started:
            return
        _loop_started = True
    thread = threading.Thread(
        target=_cleanup_loop,
        daemon=True,
        name='balance-recharge-cleanup',
    )
    thread.start()
