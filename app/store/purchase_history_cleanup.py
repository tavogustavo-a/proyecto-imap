# Limpieza del historial de compras (store_sales) — manual y programada.
#
# Solo se eliminan filas de store_sales. En cascada (FK ON DELETE SET NULL):
# LicenseAccount.sale_id pasa a NULL; las licencias, usuarios y productos no se borran.

import json
import logging
import threading
import time
from datetime import datetime, time as dt_time, timedelta, timezone

from app.extensions import db
from app.store.models import Sale, StoreSetting
from app.utils.timezone import COLOMBIA_TZ, get_colombia_now

logger = logging.getLogger(__name__)

SETTINGS_KEY = 'purchase_history_cleanup'
LOG_SETTINGS_KEY = 'purchase_history_cleanup_log'
MAX_LOG_ENTRIES = 150
PURGE_BATCH_SIZE = 250
PURGE_BATCH_PAUSE_SEC = 0.08

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
            name='purchase-history-cleanup',
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


def _cutoff_utc(days):
    """Antigüedad mínima en días calendario (Colombia). None = sin filtro de fecha (0 = todo)."""
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


def _sales_query_before_cutoff(cutoff, user_id=None):
    q = Sale.query
    if cutoff is not None:
        q = q.filter(Sale.created_at <= cutoff)
    if user_id is not None:
        q = q.filter(Sale.user_id == int(user_id))
    return q


def count_sales_to_purge(retention_days, user_id=None):
    cutoff = _cutoff_utc(retention_days)
    return _sales_query_before_cutoff(cutoff, user_id).count()


def purge_sales_batched(retention_days, user_id=None, batch_size=PURGE_BATCH_SIZE):
    """Elimina ventas antiguas por lotes para no bloquear el servidor."""
    cutoff = _cutoff_utc(retention_days)
    total_deleted = 0
    batch_size = max(50, int(batch_size or PURGE_BATCH_SIZE))

    while True:
        sale_ids = [
            row[0]
            for row in (
                _sales_query_before_cutoff(cutoff, user_id)
                .with_entities(Sale.id)
                .order_by(Sale.id.asc())
                .limit(batch_size)
                .all()
            )
        ]
        if not sale_ids:
            break

        from app.store.sale_purchase_snapshot import (
            archive_sales_before_purge,
            detach_snapshots_after_sale_purge,
        )

        archive_sales_before_purge(sale_ids)
        Sale.query.filter(Sale.id.in_(sale_ids)).delete(synchronize_session=False)
        detach_snapshots_after_sale_purge(sale_ids)
        db.session.commit()
        total_deleted += len(sale_ids)

        if len(sale_ids) < batch_size:
            break
        time.sleep(PURGE_BATCH_PAUSE_SEC)

    from app.store.sale_purchase_snapshot import repair_stale_snapshot_sale_ids

    repair_stale_snapshot_sale_ids()

    from app.store.balance_recharge_historial_snapshot import purge_snapshots_batched

    purge_snapshots_batched(retention_days, user_id=user_id)

    try:
        from app.store.proveedor_daily_summaries import purge_proveedor_daily_summaries_before

        cutoff_day = (get_colombia_now().date() - timedelta(days=max(0, int(retention_days or 0))))
        purge_proveedor_daily_summaries_before(cutoff_day, user_id=user_id)
    except Exception as prov_purge_exc:
        logger.warning('Limpieza resúmenes proveedor: %s', prov_purge_exc)

    try:
        from flask import current_app
        from app.services.disk_orphan_maintenance import run_disk_orphan_maintenance

        app = current_app._get_current_object()
        if app:
            run_disk_orphan_maintenance(app)
    except Exception:
        pass
    return total_deleted


def purge_sales(retention_days, user_id=None):
    """Compatibilidad: delega en purga por lotes."""
    return purge_sales_batched(retention_days, user_id=user_id)


def _load_cleanup_logs():
    row = StoreSetting.query.filter_by(key=LOG_SETTINGS_KEY).first()
    if not row or not row.value:
        return []
    try:
        data = json.loads(row.value)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _save_cleanup_logs(logs):
    payload = json.dumps(logs[:MAX_LOG_ENTRIES], ensure_ascii=False)
    row = StoreSetting.query.filter_by(key=LOG_SETTINGS_KEY).first()
    if row:
        row.value = payload
    else:
        db.session.add(StoreSetting(key=LOG_SETTINGS_KEY, value=payload))
    db.session.commit()


def append_cleanup_log(kind, deleted_count, retention_days, scope='all', user_id=None):
    """Registra una ejecución de limpieza (manual o automática) para el historial admin."""
    kind = (kind or 'manual').strip().lower()
    if kind not in ('manual', 'automatica'):
        kind = 'manual'
    logs = _load_cleanup_logs()
    entry = {
        'id': f"{int(time.time() * 1000)}",
        'at': datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        'kind': kind,
        'deleted_count': max(0, int(deleted_count or 0)),
        'retention_days': max(1, int(retention_days or 90)),
        'scope': scope or 'all',
        'user_id': int(user_id) if user_id is not None else None,
    }
    logs.insert(0, entry)
    _save_cleanup_logs(logs)
    return entry


def get_cleanup_logs():
    return _load_cleanup_logs()


def cleanup_log_product_label(kind, retention_days=None):
    """Texto de la columna Producto para filas de limpieza en el historial admin."""
    k = (kind or 'manual').strip().lower()
    base = (
        'Ejecutado limpieza automática'
        if k == 'automatica'
        else 'Ejecutado limpieza manual'
    )
    try:
        days = max(1, int(retention_days))
    except (TypeError, ValueError):
        return base
    return f'{base} ({days} días)'


def enqueue_purge_background(
    app,
    retention_days,
    user_id=None,
    kind='manual',
    scope='all',
    mark_auto_run=False,
):
    """
    Lanza la purga en un hilo daemon (segundo plano).
    Retorna False si ya hay otra limpieza en curso.
    """
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
                deleted = purge_sales_batched(retention_days, user_id=user_id)
                append_cleanup_log(
                    kind,
                    deleted,
                    retention_days,
                    scope=scope,
                    user_id=user_id,
                )
                if mark_auto_run:
                    now = datetime.now(timezone.utc).replace(tzinfo=None)
                    settings = get_cleanup_settings()
                    settings['last_run_at'] = now.isoformat()
                    settings['last_deleted_count'] = deleted
                    save_cleanup_settings(settings)
                if deleted:
                    logger.info(
                        'Limpieza %s historial compras (segundo plano): %s ventas (> %s días)',
                        kind,
                        deleted,
                        retention_days,
                    )
        except Exception as exc:
            logger.exception('Error en limpieza %s del historial (segundo plano): %s', kind, exc)
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
        name=f'purchase-history-purge-{kind}',
    )
    thread.start()
    return True


def run_scheduled_cleanup_if_due(app):
    """Programa limpieza automática en segundo plano si está habilitada y venció el intervalo."""
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

            # Marcar ejecución al encolar para no disparar duplicados en el loop programado
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
            if not started:
                return 0
            return -1  # en curso (segundo plano)
        except Exception as exc:
            logger.exception('Error al programar limpieza automática: %s', exc)
            db.session.rollback()
            return 0


def _cleanup_loop(app):
    from app.store.cleanup_poll_schedule import run_adaptive_cleanup_loop

    run_adaptive_cleanup_loop(app, get_cleanup_settings, run_scheduled_cleanup_if_due)


def start_purchase_history_cleanup_loop(app):
    _ensure_cleanup_loop_running(app)
