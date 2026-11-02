# -*- coding: utf-8 -*-
"""Escucha mensajes al bot y responde el menú de /start."""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

_loop_started = {'started': False}
_loop_lock = threading.Lock()


def _poll_loop(app):
    while True:
        wait = 0.4
        try:
            with app.app_context():
                from app.store.telegram_bot_service import poll_telegram_updates

                poll_telegram_updates()
        except Exception:
            logger.exception('telegram start poll')
            wait = 2
        time.sleep(wait)


def start_telegram_start_poll_loop(app):
    """Un solo proceso escucha el bot. Si hay varios workers, los demás no responden /start."""
    holder = _acquire_single_poll_lock(app)
    if holder is None:
        logger.info('telegram start poll ya está activo en otro proceso')
        return
    with _loop_lock:
        if _loop_started['started']:
            return
        _loop_started['started'] = True
    _poll_lock_holder['file'] = holder
    threading.Thread(
        target=_poll_loop,
        args=(app,),
        daemon=True,
        name='telegram-start-poll',
    ).start()


def _acquire_single_poll_lock(app):
    import os
    import sys

    try:
        os.makedirs(app.instance_path, exist_ok=True)
    except Exception:
        return None
    path = os.path.join(app.instance_path, 'telegram_poll.lock')
    handle = open(path, 'a+')
    try:
        if sys.platform == 'win32':
            import msvcrt
            handle.seek(0)
            handle.write('1')
            handle.flush()
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


_poll_lock_holder = {'file': None}
