"""Monitoreo periódico de salud WhatsApp Web (Evolution API)."""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

POLL_SEC = 120
_loop_started = {'started': False}
_loop_lock = threading.Lock()


def run_whatsapp_health_checks(app):
    with app.app_context():
        try:
            from app.store.whatsapp_web_db import ensure_whatsapp_web_columns
            from app.store.whatsapp_web_service import get_whatsapp_singleton_config, refresh_config_health

            ensure_whatsapp_web_columns()
            cfg = get_whatsapp_singleton_config()
            if not cfg or not cfg.is_enabled:
                return
            if not (cfg.api_key or '').strip():
                return
            try:
                refresh_config_health(cfg, send_alerts=True)
            except Exception as exc:
                logger.warning('Health check WhatsApp config %s: %s', cfg.id, exc)
        except Exception as exc:
            logger.exception('run_whatsapp_health_checks: %s', exc)


def _health_loop(app):
    while True:
        try:
            run_whatsapp_health_checks(app)
        except Exception as exc:
            logger.exception('whatsapp health loop: %s', exc)
        time.sleep(POLL_SEC)


def start_whatsapp_health_loop(app):
    with _loop_lock:
        if _loop_started['started']:
            return
        _loop_started['started'] = True
    t = threading.Thread(target=_health_loop, args=(app,), daemon=True, name='whatsapp-health')
    t.start()
