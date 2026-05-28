# Mantenimiento unificado de logs de conexión (presence + cleanup).
# Un solo proceso por máquina vía lock de archivo.

import logging
import threading
import time

logger = logging.getLogger(__name__)

_loop_started = False
_loop_lock = threading.Lock()
LOCK_PATH = '/tmp/proyectoimap_connection_logs.lock'
POLL_SEC = 3600
_last_daily_run_date = None
_last_daily_run_lock = threading.Lock()


def run_startup_maintenance(app=None):
    """Limpieza puntual al arrancar o desde API admin (sin hilo de fondo)."""
    from flask import has_app_context, current_app

    if app is None:
        if has_app_context():
            app = current_app._get_current_object()
        else:
            return {'deleted_count': 0, 'consolidated_count': 0}

    try:
        with app.app_context():
            from app.store.presence import cleanup_old_logs, consolidate_duplicate_logs

            deleted_count = cleanup_old_logs(28)
            consolidated_count = consolidate_duplicate_logs(hours_back=48)
            return {
                'deleted_count': deleted_count,
                'consolidated_count': consolidated_count,
            }
    except Exception:
        logger.exception('Error en mantenimiento inicial de logs de conexión')
        return {'deleted_count': 0, 'consolidated_count': 0}


def _run_daily_maintenance_if_due(app):
    global _last_daily_run_date

    from app.utils.timezone import get_colombia_now

    now = get_colombia_now()
    if now.hour != 5:
        return

    today = now.date()
    with _last_daily_run_lock:
        if _last_daily_run_date == today:
            return
        _last_daily_run_date = today

    with app.app_context():
        from app.store.presence import cleanup_inactive_sessions, cleanup_old_logs

        cleanup_inactive_sessions()
        cleanup_old_logs(days=28)


def _maintenance_worker(app):
    run_startup_maintenance(app)
    while True:
        try:
            _run_daily_maintenance_if_due(app)
        except Exception:
            logger.exception('Error en mantenimiento programado de logs de conexión')
        time.sleep(POLL_SEC)


def manual_cleanup():
    """Limpieza manual de logs de conexión (API admin)."""
    try:
        from app.store.presence import cleanup_inactive_sessions, cleanup_old_logs

        inactive_count = cleanup_inactive_sessions()
        deleted_count = cleanup_old_logs(days=28)

        return {
            'inactive_count': inactive_count,
            'deleted_count': deleted_count,
        }
    except Exception as e:
        return {
            'inactive_count': 0,
            'deleted_count': 0,
            'error': str(e),
        }


def start_connection_logs_maintenance_loop(app):
    """Inicia el loop de mantenimiento en un solo worker Gunicorn."""
    global _loop_started

    if app is None:
        return

    with _loop_lock:
        if _loop_started:
            return

        from app.utils.process_lock import process_lock_acquired, try_acquire_process_lock

        lock_fd = try_acquire_process_lock(LOCK_PATH)
        if not process_lock_acquired(lock_fd):
            return

        _loop_started = True

    threading.Thread(
        target=_maintenance_worker,
        args=(app,),
        daemon=True,
        name='connection-logs-maintenance',
    ).start()
