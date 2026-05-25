# Limpieza de archivos en disco antes de borrar usuarios en BD (CASCADE no borra ficheros).

import logging
from typing import Iterable, List, Union

logger = logging.getLogger(__name__)


def _normalize_user_ids(user_ids: Union[int, Iterable[int], None]) -> List[int]:
    if user_ids is None:
        return []
    if isinstance(user_ids, int):
        return [int(user_ids)]
    out = []
    for x in user_ids:
        try:
            i = int(x)
            if i not in out:
                out.append(i)
        except (TypeError, ValueError):
            continue
    return out


def cleanup_disk_assets_for_user_ids(app, user_ids: Union[int, Iterable[int], None]) -> dict:
    """
    Borra adjuntos de chat y comprobantes de recarga ligados a user_id
    ANTES de db.session.delete(user) o User.query.delete().
    """
    ids = _normalize_user_ids(user_ids)
    if not ids:
        return {'chat_files': 0, 'recharge_files': 0}

    chat_files = 0
    recharge_files = 0
    try:
        from app.models.chat import ChatMessage
        from app.store.balance_recharge_cleanup import delete_proof_files_for_user_ids

        for uid in ids:
            chat_files += ChatMessage.delete_attachment_files_for_user(uid) or 0
        recharge_files = delete_proof_files_for_user_ids(app, ids) or 0
    except Exception as exc:
        logger.exception('Error limpiando archivos de usuario(s) %s: %s', ids, exc)

    return {'chat_files': chat_files, 'recharge_files': recharge_files}
