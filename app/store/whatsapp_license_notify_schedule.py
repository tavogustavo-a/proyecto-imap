# -*- coding: utf-8 -*-
"""Intervalos de revisión y ventanas de ejecución (hora Colombia)."""

from __future__ import annotations

from datetime import datetime, timedelta, time

from app.store.whatsapp_license_notify_log import notify_success_for_co_date
from app.utils.timezone import get_colombia_datetime

POLL_6H_SEC = 6 * 3600
POLL_30M_SEC = 30 * 60
POLL_10M_SEC = 10 * 60
RECONNECT_CATCHUP_MINUTES = 10


def _co_minutes(co_now) -> int:
    return int(co_now.hour) * 60 + int(co_now.minute)


def _target_minutes(target: time) -> int:
    return int(target.hour) * 60 + int(target.minute)


def minutes_until_notify_target(co_now, target: time) -> int:
    """Minutos hasta la hora programada hoy (0 si ya pasó)."""
    return max(0, _target_minutes(target) - _co_minutes(co_now))


def minutes_since_notify_target(co_now, target: time) -> int:
    """Minutos transcurridos desde la hora programada hoy (0 si aún no llega)."""
    return max(0, _co_minutes(co_now) - _target_minutes(target))


def is_past_notify_target_today(co_now, target: time) -> bool:
    return _co_minutes(co_now) >= _target_minutes(target)


def catchup_due(config, co_now=None) -> bool:
    co_now = co_now or get_colombia_datetime()
    if notify_success_for_co_date(config, co_now.date()):
        return False
    raw = getattr(config, 'notify_catchup_after', None)
    if not raw:
        return False
    try:
        due = raw if isinstance(raw, datetime) else datetime.fromisoformat(str(raw))
    except Exception:
        return False
    return datetime.utcnow() >= due


def schedule_reconnect_catchup(config, co_now=None) -> None:
    """
    Tras reconectar WhatsApp: intentar avisos ~10 min después (mismo día calendario CO).
    Si van varios días sin envío, solo se evalúa el estado actual al ejecutar (no backlog).
    """
    co_now = co_now or get_colombia_datetime()
    if notify_success_for_co_date(config, co_now.date()):
        return
    config.notify_catchup_after = datetime.utcnow() + timedelta(minutes=RECONNECT_CATCHUP_MINUTES)


def clear_reconnect_catchup(config) -> None:
    config.notify_catchup_after = None


def notify_poll_interval_sec_for_config(config, co_now=None) -> int:
    """6 h lejos; 30 min en la última hora; 10 min cerca o si ya pasó la hora sin éxito."""
    co_now = co_now or get_colombia_datetime()
    if not config.is_enabled:
        return POLL_6H_SEC

    if notify_success_for_co_date(config, co_now.date()):
        from app.store.whatsapp_daily_sales import has_pending_daily_digests_ready

        if not has_pending_daily_digests_ready(config, co_now):
            return POLL_6H_SEC

    if catchup_due(config, co_now):
        return POLL_10M_SEC

    target = config.notification_time
    if not target:
        return POLL_6H_SEC

    if is_past_notify_target_today(co_now, target):
        return POLL_10M_SEC

    until = minutes_until_notify_target(co_now, target)
    if until <= 30:
        return POLL_10M_SEC
    if until <= 60:
        return POLL_30M_SEC
    return POLL_6H_SEC


def compute_notify_poll_interval_sec(configs, co_now=None) -> int:
    co_now = co_now or get_colombia_datetime()
    enabled = [c for c in configs if c.is_enabled]
    if not enabled:
        return POLL_6H_SEC
    return min(notify_poll_interval_sec_for_config(c, co_now) for c in enabled)


def should_run_scheduled_notify(config, co_now=None) -> bool:
    """Ejecutar si ya pasó la hora programada y faltan avisos o resúmenes diarios."""
    if not config.is_enabled:
        return False
    co_now = co_now or get_colombia_datetime()
    target = config.notification_time
    if not target:
        return False
    if not is_past_notify_target_today(co_now, target):
        return False
    if not notify_success_for_co_date(config, co_now.date()):
        return True
    from app.store.whatsapp_daily_sales import has_pending_daily_digests_ready

    return has_pending_daily_digests_ready(config, co_now)


def should_run_catchup_notify(config, co_now=None) -> bool:
    if not config.is_enabled:
        return False
    co_now = co_now or get_colombia_datetime()
    return catchup_due(config, co_now) and not notify_success_for_co_date(config, co_now.date())
