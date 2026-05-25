# Mantenimiento periódico: archivos en disco sin fila en BD (chat, recargas, fondos IMAP2).

import logging

logger = logging.getLogger(__name__)


def run_disk_orphan_maintenance(app) -> dict:
    """Escanea carpetas de uploads y elimina ficheros huérfanos."""
    chat_deleted = 0
    recharge_deleted = 0
    imap2_background_deleted = 0
    try:
        with app.app_context():
            from app.models.chat import ChatMessage
            from app.store.balance_recharge_cleanup import cleanup_orphan_proof_files
            from app.services.imap_service import cleanup_orphaned_imap2_backgrounds

            chat_result = ChatMessage.cleanup_orphaned_files()
            if isinstance(chat_result, dict):
                chat_deleted = int(chat_result.get('orphaned_files_deleted') or 0)
            recharge_deleted = int(cleanup_orphan_proof_files(app) or 0)
            imap2_background_deleted = int(cleanup_orphaned_imap2_backgrounds(app) or 0)
    except Exception as exc:
        logger.exception('Error en mantenimiento de huérfanos en disco: %s', exc)

    return {
        'chat_orphan_files': chat_deleted,
        'recharge_orphan_files': recharge_deleted,
        'imap2_background_orphan_files': imap2_background_deleted,
    }
