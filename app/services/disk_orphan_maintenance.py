# Mantenimiento periódico: archivos en disco sin fila en BD (chat, recargas, fondos IMAP2).

import logging
import threading
import time

logger = logging.getLogger(__name__)

_DISK_ORPHAN_ADVISORY_LOCK_KEY = 84729103
_DISK_ORPHAN_POLL_SEC = 3600
_loop_started = False
_loop_lock = threading.Lock()
_PROCESS_LOCK_PATH = '/tmp/proyectoimap_disk_orphan.lock'


def _try_disk_orphan_lock(db, uri: str) -> bool:
    if not str(uri or '').startswith('postgresql'):
        return True
    from sqlalchemy import text

    return bool(
        db.session.execute(
            text('SELECT pg_try_advisory_lock(:key)'),
            {'key': _DISK_ORPHAN_ADVISORY_LOCK_KEY},
        ).scalar()
    )


def _release_disk_orphan_lock(db, uri: str) -> None:
    if not str(uri or '').startswith('postgresql'):
        return
    from sqlalchemy import text

    db.session.execute(
        text('SELECT pg_advisory_unlock(:key)'),
        {'key': _DISK_ORPHAN_ADVISORY_LOCK_KEY},
    )


def run_disk_orphan_maintenance(app) -> dict:
    """Escanea carpetas de uploads y elimina ficheros huérfanos."""
    chat_deleted = 0
    recharge_deleted = 0
    imap2_background_deleted = 0
    skipped = False
    try:
        with app.app_context():
            from app.extensions import db
            from app.models.chat import ChatMessage
            from app.store.balance_recharge_cleanup import cleanup_orphan_proof_files
            from app.services.imap_service import cleanup_orphaned_imap2_backgrounds

            uri = app.config.get('SQLALCHEMY_DATABASE_URI') or ''
            if not _try_disk_orphan_lock(db, uri):
                skipped = True
                return {
                    'skipped': True,
                    'chat_orphan_files': 0,
                    'recharge_orphan_files': 0,
                    'imap2_background_orphan_files': 0,
                }

            try:
                chat_result = ChatMessage.cleanup_orphaned_files()
                if isinstance(chat_result, dict):
                    chat_deleted = int(chat_result.get('orphaned_files_deleted') or 0)
                recharge_deleted = int(cleanup_orphan_proof_files(app) or 0)
                imap2_background_deleted = int(cleanup_orphaned_imap2_backgrounds(app) or 0)
            finally:
                _release_disk_orphan_lock(db, uri)
    except Exception as exc:
        logger.exception('Error en mantenimiento de huérfanos en disco: %s', exc)

    return {
        'skipped': skipped,
        'chat_orphan_files': chat_deleted,
        'recharge_orphan_files': recharge_deleted,
        'imap2_background_orphan_files': imap2_background_deleted,
    }


def _disk_orphan_worker(app):
    time.sleep(_DISK_ORPHAN_POLL_SEC)
    while True:
        try:
            run_disk_orphan_maintenance(app)
        except Exception:
            logger.exception('Error en loop de mantenimiento de huérfanos en disco')
        time.sleep(_DISK_ORPHAN_POLL_SEC)


def start_disk_orphan_maintenance_loop(app):
    """Escaneo horario de huérfanos en un solo worker Gunicorn."""
    global _loop_started

    if app is None:
        return

    with _loop_lock:
        if _loop_started:
            return

        from app.utils.process_lock import process_lock_acquired, try_acquire_process_lock

        lock_fd = try_acquire_process_lock(_PROCESS_LOCK_PATH)
        if not process_lock_acquired(lock_fd):
            return

        _loop_started = True

    threading.Thread(
        target=_disk_orphan_worker,
        args=(app,),
        daemon=True,
        name='disk-orphan-hourly',
    ).start()
