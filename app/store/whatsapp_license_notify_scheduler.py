"""Scheduler adaptativo: avisos WhatsApp licencias (6 h / 30 min / 10 min)."""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

_loop_started = {'started': False}
_loop_lock = threading.Lock()


def run_whatsapp_license_notify_tick(app):
    with app.app_context():
        try:
            from app.store.whatsapp_license_notify_job import run_whatsapp_license_notify_for_config
            from app.store.whatsapp_license_notify_schedule import (
                should_run_catchup_notify,
                should_run_scheduled_notify,
            )
            from app.store.whatsapp_web_db import ensure_whatsapp_web_columns
            from app.store.whatsapp_web_service import get_whatsapp_singleton_config
            from app.utils.timezone import get_colombia_datetime

            ensure_whatsapp_web_columns()
            co_now = get_colombia_datetime()
            cfg = get_whatsapp_singleton_config()
            if not cfg or not cfg.is_enabled:
                return
            try:
                if should_run_catchup_notify(cfg, co_now):
                    result = run_whatsapp_license_notify_for_config(cfg)
                elif should_run_scheduled_notify(cfg, co_now):
                    result = run_whatsapp_license_notify_for_config(cfg)
                else:
                    return
                if not result.get('skipped'):
                    logger.info(
                        'Job WhatsApp licencias config=%s status=%s enviados=%s errores=%s',
                        cfg.id,
                        result.get('status'),
                        result.get('sent'),
                        result.get('errors'),
                    )
            except Exception as exc:
                logger.exception('WhatsApp licencias config %s: %s', cfg.id, exc)
        except Exception as exc:
            logger.exception('run_whatsapp_license_notify_tick: %s', exc)


def _compute_sleep_sec(app) -> int:
    with app.app_context():
        try:
            from app.store.whatsapp_license_notify_schedule import compute_notify_poll_interval_sec
            from app.store.whatsapp_web_service import get_whatsapp_singleton_config
            from app.utils.timezone import get_colombia_datetime

            cfg = get_whatsapp_singleton_config()
            configs = [cfg] if cfg and cfg.is_enabled else []
            return compute_notify_poll_interval_sec(configs, get_colombia_datetime())
        except Exception:
            return 6 * 3600


def _notify_loop(app):
    while True:
        try:
            run_whatsapp_license_notify_tick(app)
        except Exception as exc:
            logger.exception('whatsapp license notify loop: %s', exc)
        sleep_sec = _compute_sleep_sec(app)
        logger.debug('WhatsApp licencias notify: próximo tick en %ss', sleep_sec)
        time.sleep(sleep_sec)


def start_whatsapp_license_notify_loop(app):
    with _loop_lock:
        if _loop_started['started']:
            return
        _loop_started['started'] = True
    t = threading.Thread(
        target=_notify_loop,
        args=(app,),
        daemon=True,
        name='whatsapp-license-notify',
    )
    t.start()
    logger.debug(
        'WhatsApp licencias notify loop iniciado (6 h / 30 min / 10 min según hora CO)'
    )
