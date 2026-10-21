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
        wait = 2
        try:
            with app.app_context():
                from app.store.telegram_bot_service import poll_telegram_updates

                idle = poll_telegram_updates()
            wait = 8 if idle else 1
        except Exception:
            logger.exception('telegram start poll')
            wait = 8
        time.sleep(wait)


def start_telegram_start_poll_loop(app):
    with _loop_lock:
        if _loop_started['started']:
            return
        _loop_started['started'] = True
    threading.Thread(
        target=_poll_loop,
        args=(app,),
        daemon=True,
        name='telegram-start-poll',
    ).start()
