# -*- coding: utf-8 -*-
"""
Guardia de espacio en disco.

Cuando quedan menos de DISK_SPACE_MIN_FREE_GB (2 GB por defecto) libres:
- Se avisa al admin/soporte en la campana de la tienda (con anti-spam).
- Se bloquea la subida de archivos del chat (fotos, videos, documentos, audios),
  que es lo que más disco consume.

Ventas, licencias y mensajes de texto siguen funcionando: son solo texto en la BD
y tardarían muchísimo en llenar el disco.
"""
import logging
import os
import shutil
import time

from flask import current_app

logger = logging.getLogger(__name__)

# Cache corto del espacio libre para no consultar el disco en cada request.
_free_cache = {'ts': 0.0, 'free': None}
_FREE_CACHE_TTL_SEC = 30

# Aviso al admin como máximo cada 6 horas mientras siga bajo.
_last_admin_notify_ts = 0.0
_NOTIFY_EVERY_SEC = 6 * 3600

CHAT_UPLOAD_BLOCKED_MSG = (
    'No se pueden enviar archivos ahora: el servidor está casi sin espacio en disco. '
    'Puedes seguir enviando mensajes de texto.'
)


def _disk_probe_dir() -> str:
    """Carpeta instance (misma unidad donde viven BD, backups y archivos del chat)."""
    try:
        root = os.path.abspath(os.path.dirname(current_app.root_path))
        d = os.path.join(root, 'instance')
        if os.path.isdir(d):
            return d
        return root
    except Exception:
        return os.path.abspath('.')


def disk_free_bytes(force: bool = False):
    """Bytes libres en el disco (cache de 30 s). None si no se puede medir."""
    now = time.time()
    if not force and _free_cache['free'] is not None and now - _free_cache['ts'] < _FREE_CACHE_TTL_SEC:
        return _free_cache['free']
    try:
        free = shutil.disk_usage(_disk_probe_dir()).free
    except OSError:
        free = None
    _free_cache['ts'] = now
    _free_cache['free'] = free
    return free


def min_free_bytes() -> int:
    try:
        gb = float(current_app.config.get('DISK_SPACE_MIN_FREE_GB', 2))
    except (TypeError, ValueError):
        gb = 2.0
    return int(max(0.1, gb) * 1024 * 1024 * 1024)


def disk_space_low(notify_admins: bool = True) -> bool:
    """True si quedan menos de DISK_SPACE_MIN_FREE_GB libres. Avisa al admin (throttled)."""
    free = disk_free_bytes()
    if free is None:
        return False
    low = free < min_free_bytes()
    if low and notify_admins:
        _maybe_notify_admins_low(free)
    return low


def _maybe_notify_admins_low(free_bytes: int) -> None:
    global _last_admin_notify_ts
    now = time.time()
    if now - _last_admin_notify_ts < _NOTIFY_EVERY_SEC:
        return
    _last_admin_notify_ts = now
    try:
        from app.extensions import db
        from app.store.store_event_notify import notify_admins_app

        free_mb = int(free_bytes // (1024 * 1024))
        limit_gb = min_free_bytes() / (1024 * 1024 * 1024)
        notify_admins_app(
            kind='admin_disk_space_low',
            title='⚠ Poco espacio en disco: archivos del chat pausados',
            body=(
                f'Quedan {free_mb} MB libres (límite: {limit_gb:g} GB). '
                'El envío de fotos, videos, documentos y audios por el chat quedó pausado '
                'hasta que haya espacio; las ventas y licencias siguen funcionando. '
                'Borra archivos viejos del chat manualmente o ajusta el borrado automático '
                'para liberar espacio.'
            ),
            payload={'free_mb': free_mb, 'url': '/tienda/admin'},
        )
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
        logger.warning('Disco bajo: %s MB libres — subida de archivos del chat pausada.', free_mb)
    except Exception as ex:
        logger.warning('aviso admin disco bajo: %s', ex)
