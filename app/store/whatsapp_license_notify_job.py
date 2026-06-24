# -*- coding: utf-8 -*-
"""Job programado: resúmenes WhatsApp de ventas y renovaciones (Evolution API)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from app.extensions import db
from app.models.user import User
from app.store.models import WhatsAppConfig
from app.store.whatsapp_license_notify_log import (
    append_notify_run_log,
    build_notify_log_entry,
)
from app.store.whatsapp_license_notify_schedule import (
    clear_reconnect_catchup,
    schedule_reconnect_catchup,
    should_run_catchup_notify,
    should_run_scheduled_notify,
)
from app.store.whatsapp_web_db import ensure_whatsapp_web_columns
from app.utils.timezone import get_colombia_datetime

logger = logging.getLogger(__name__)

NOTIFY_FAIL_ALERT_COOLDOWN = timedelta(hours=1)
NOTIFY_REPEAT_FAIL_LOG_COOLDOWN = timedelta(minutes=9)


def _should_append_notify_log(config: WhatsAppConfig, entry: dict[str, Any]) -> bool:
    """
    Tras la hora programada el loop corre cada 10 min; no duplicar el mismo fallo
    de desconexión en el historial en cada tick.
    """
    if str(entry.get('status') or '').lower() != 'failed':
        return True
    reason = str(entry.get('reason') or '')
    if reason != 'whatsapp_no_conectado':
        return True
    from app.store.whatsapp_license_notify_log import parse_notify_run_log

    co_date = str(entry.get('co_date') or '').strip()
    if not co_date:
        return True
    for day in parse_notify_run_log(config):
        if str(day.get('co_date') or '') != co_date:
            continue
        attempts = day.get('attempts') or []
        if not attempts:
            return True
        last = attempts[0]
        if str(last.get('reason') or '') != 'whatsapp_no_conectado':
            return True
        at_raw = str(last.get('at_utc') or '')
        try:
            last_at = datetime.fromisoformat(at_raw.replace('Z', ''))
        except Exception:
            return True
        if (datetime.utcnow() - last_at) < NOTIFY_REPEAT_FAIL_LOG_COOLDOWN:
            return False
    return True


def _resolve_user_whatsapp_phone(user: User) -> str | None:
    from app.store.whatsapp_user_notify_prefs import user_receives_whatsapp_notifications

    if not user_receives_whatsapp_notifications(user):
        return None
    raw = (getattr(user, 'phone', None) or '').strip()
    digits = ''.join(ch for ch in raw if ch.isdigit())
    if len(digits) >= 10:
        return raw
    parent_id = getattr(user, 'parent_id', None)
    if parent_id and parent_id != user.id:
        parent = User.query.get(parent_id)
        if parent:
            return _resolve_user_whatsapp_phone(parent)
    return None


def _customer_display_name(user: User) -> str:
    full = (getattr(user, 'full_name', None) or '').strip()
    if full:
        return full
    return (user.username or 'cliente').strip() or 'cliente'


def _send_notify_failure_alert(config: WhatsAppConfig, entry: dict[str, Any]) -> None:
    from app.store.whatsapp_user_messages import (
        humanize_whatsapp_notify_reason,
        humanize_whatsapp_notify_status,
        humanize_whatsapp_notify_trigger,
    )
    from app.store.whatsapp_web_service import resolve_whatsapp_admin_alert_email, send_whatsapp_alert_email

    alert_to = resolve_whatsapp_admin_alert_email()
    if not alert_to:
        return
    now = datetime.utcnow()
    last = getattr(config, 'last_notify_fail_alert_at', None)
    if last and (now - last) < NOTIFY_FAIL_ALERT_COOLDOWN:
        return

    body = (
        'Falló el job de resúmenes WhatsApp (ventas/renovaciones) en tu tienda IMAP.\n\n'
        f"Fecha (Colombia): {entry.get('co_date')} {entry.get('co_time')}\n"
        f"Origen: {humanize_whatsapp_notify_trigger(entry.get('trigger'))}\n"
        f"Estado: {humanize_whatsapp_notify_status(entry.get('status'))}\n"
        f"Resúmenes enviados: {entry.get('daily_sent', 0)} · Errores: {entry.get('errors', 0)}\n"
        f"Motivo: {humanize_whatsapp_notify_reason(entry.get('reason'))}\n\n"
        'Revisá Configuraciones → WhatsApp Web (salud y últimas ejecuciones).\n'
    )
    if send_whatsapp_alert_email(
        alert_to,
        '[IMAP] Fallo resúmenes WhatsApp',
        body,
    ):
        config.last_notify_fail_alert_at = now


def _finalize_notify_run(
    config: WhatsAppConfig,
    *,
    trigger: str,
    result: dict[str, Any],
) -> dict[str, Any]:
    """Registra historial (10), alertas y limpia catch-up si hubo éxito."""
    total_sent = int(result.get('daily_sent') or 0)
    total_errors = int(result.get('daily_errors') or 0)

    if result.get('skipped'):
        status = 'skipped'
        reason = str(result.get('reason') or '')
        if reason == 'whatsapp_no_conectado':
            status = 'failed'
    elif total_errors > 0 and total_sent == 0:
        status = 'failed'
    elif total_errors > 0:
        status = 'partial'
    else:
        status = 'success'

    entry = build_notify_log_entry(trigger=trigger, status=status, result=result)
    if _should_append_notify_log(config, entry):
        append_notify_run_log(config, entry)

    if status in ('failed', 'partial'):
        _send_notify_failure_alert(config, entry)

    if status in ('success', 'partial'):
        clear_reconnect_catchup(config)
        now_utc = datetime.utcnow()
        config.last_notify_at = now_utc
        if total_sent > 0:
            config.last_sent = now_utc

    db.session.commit()
    result['log_entry'] = entry
    result['status'] = status
    return result


def run_whatsapp_license_notify_for_config(
    config: WhatsAppConfig,
    *,
    force: bool = False,
    trigger: str | None = None,
) -> dict[str, Any]:
    ensure_whatsapp_web_columns()
    from app.store.whatsapp_daily_sales import ensure_whatsapp_daily_sales_columns

    ensure_whatsapp_daily_sales_columns()
    co_now = get_colombia_datetime()

    if not config.is_enabled:
        return {'skipped': True, 'reason': 'whatsapp_desactivado'}

    if force:
        run_trigger = trigger or 'manual'
    elif should_run_catchup_notify(config, co_now):
        run_trigger = 'reconnect_catchup'
    elif should_run_scheduled_notify(config, co_now):
        run_trigger = 'scheduled'
    else:
        return {'skipped': True, 'reason': 'fuera_de_ventana_o_ya_ejecutado'}

    from app.store.whatsapp_web_service import (
        STATUS_CONNECTED,
        config_evolution_instance,
        random_send_pause_sec,
        refresh_config_health,
        resolve_config_api_key,
        resolve_config_base_url,
        send_text_message,
    )
    from app.store.whatsapp_daily_sales import (
        has_pending_daily_digests_ready,
        send_pending_daily_digests_for_config,
    )

    if not resolve_config_api_key(config):
        result = {'skipped': True, 'reason': 'sin_api_key'}
        return _finalize_notify_run(config, trigger=run_trigger, result=result)

    run_daily = force or has_pending_daily_digests_ready(config, co_now)
    if not run_daily:
        return {'skipped': True, 'reason': 'nada_pendiente'}

    health = refresh_config_health(config, send_alerts=False)
    if health.get('status') != STATUS_CONNECTED:
        if not force:
            from app.store.whatsapp_daily_sales import record_daily_digest_connect_failures

            record_daily_digest_connect_failures(config, co_now, force=False)
        result = {
            'skipped': True,
            'reason': 'whatsapp_no_conectado',
            'status': health.get('status'),
        }
        return _finalize_notify_run(config, trigger=run_trigger, result=result)

    stats: dict[str, Any] = {
        'sent': 0,
        'skipped_no_phone': 0,
        'errors': 0,
        'trigger': run_trigger,
        'daily_sent': 0,
        'daily_errors': 0,
        'daily_skipped_no_phone': 0,
        'delivery_details': [],
    }

    daily_stats = send_pending_daily_digests_for_config(
        config,
        co_now,
        send_text_message=send_text_message,
        resolve_config_base_url=resolve_config_base_url,
        resolve_config_api_key=resolve_config_api_key,
        config_evolution_instance=config_evolution_instance,
        resolve_phone=_resolve_user_whatsapp_phone,
        customer_name_fn=_customer_display_name,
        pause_between_messages=lambda: random_send_pause_sec(config),
        force=force,
        delivery_details=stats['delivery_details'],
    )
    stats['daily_sent'] = daily_stats.get('daily_sent', 0)
    stats['daily_errors'] = daily_stats.get('daily_errors', 0)
    stats['daily_skipped_no_phone'] = daily_stats.get('daily_skipped_no_phone', 0)
    stats['errors'] = int(daily_stats.get('daily_errors') or 0)

    stats['skipped'] = False
    return _finalize_notify_run(config, trigger=run_trigger, result=stats)


def run_whatsapp_license_notify_pipeline(*, force: bool = False) -> dict[str, Any]:
    ensure_whatsapp_web_columns()
    from app.store.whatsapp_web_service import get_whatsapp_singleton_config

    cfg = get_whatsapp_singleton_config()
    if not cfg or not cfg.is_enabled:
        return {'ok': True, 'results': [], 'message': 'Sin configuración WhatsApp activa.'}

    results: list[dict[str, Any]] = []
    try:
        r = run_whatsapp_license_notify_for_config(cfg, force=force)
        r['config_id'] = cfg.id
        results.append(r)
    except Exception as exc:
        db.session.rollback()
        logger.exception('whatsapp_license_notify config %s: %s', cfg.id, exc)
        results.append({'config_id': cfg.id, 'error': str(exc)})
    return {'configs': results}


# Re-export para refresh_config_health
__all__ = [
    'run_whatsapp_license_notify_for_config',
    'run_whatsapp_license_notify_pipeline',
    'schedule_reconnect_catchup',
]
