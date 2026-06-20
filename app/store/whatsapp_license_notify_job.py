# -*- coding: utf-8 -*-
"""Job diario: avisos WhatsApp de licencias por vencer (Evolution API)."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Any

from app.extensions import db
from app.models.user import User
from app.store.models import WhatsAppConfig
from app.store.whatsapp_license_notify_log import (
    append_notify_run_log,
    build_notify_log_entry,
    notify_success_for_co_date,
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

NOTIFY_MAX_DAYS = 5
SEND_PAUSE_SEC = 2.5
NOTIFY_FAIL_ALERT_COOLDOWN = timedelta(hours=1)
MAX_DELIVERY_DETAILS = 100


def _append_delivery_detail(
    stats: dict[str, Any],
    *,
    username: str,
    phone: str | None,
    kind: str,
    outcome: str,
    reason: str = '',
) -> None:
    """Registra usuario/teléfono cuando un envío falla o no tiene número listo."""
    details = stats.setdefault('delivery_details', [])
    if len(details) >= MAX_DELIVERY_DETAILS:
        return
    details.append(
        {
            'username': (username or '').strip() or '—',
            'phone': (phone or '').strip(),
            'kind': kind,
            'outcome': outcome,
            'reason': (reason or '').strip(),
        }
    )


def _resolve_user_whatsapp_phone(user: User) -> str | None:
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


def _effective_days_until_notify(row: dict[str, Any]) -> int | None:
    candidates: list[int] = []
    for key in ('days_until_expiry', 'days_until_calendar_sale'):
        raw = row.get(key)
        if raw is None or raw == '':
            continue
        try:
            n = int(raw)
            if n >= 0:
                candidates.append(n)
        except (TypeError, ValueError):
            continue
    return min(candidates) if candidates else None


def _customer_display_name(user: User) -> str:
    full = (getattr(user, 'full_name', None) or '').strip()
    if full:
        return full
    return (user.username or 'cliente').strip() or 'cliente'


def render_whatsapp_license_template(
    template: str,
    *,
    customer_name: str,
    product_names: str,
    days_left: int,
) -> str:
    text = str(template or '')
    replacements = {
        'customer_name': customer_name,
        'product_names': product_names,
        'days_left': str(days_left),
    }
    for key, val in replacements.items():
        text = text.replace('{{' + key + '}}', val)
    return text


def _build_user_notify_payload(user: User) -> dict[str, Any] | None:
    """
    Estado actual de licencias por vencer (≤5 días).
    Si hubo días sin envío, no acumula avisos viejos: solo lo vigente hoy.
    """
    from app.store.routes import (
        USER_LIC_CADUCIDAD_VIEW_MAX_DAYS,
        _eligible_tienda_user_licencias_portal,
        _user_my_license_accounts_list_for_portal,
    )

    if not _eligible_tienda_user_licencias_portal(user):
        return None

    accounts = _user_my_license_accounts_list_for_portal(user)
    if not accounts:
        return None

    max_days = USER_LIC_CADUCIDAD_VIEW_MAX_DAYS or NOTIFY_MAX_DAYS
    qualifying: list[tuple[str, int]] = []
    for row in accounts:
        days = _effective_days_until_notify(row)
        if days is None or days < 0 or days > max_days:
            continue
        pname = str(row.get('product_name') or '').strip() or 'Licencia'
        qualifying.append((pname, days))

    if not qualifying:
        return None

    seen_products: set[str] = set()
    product_names: list[str] = []
    min_days = qualifying[0][1]
    for pname, days in qualifying:
        min_days = min(min_days, days)
        key = pname.lower()
        if key not in seen_products:
            seen_products.add(key)
            product_names.append(pname)

    return {
        'customer_name': _customer_display_name(user),
        'product_names': ', '.join(product_names),
        'days_left': min_days,
    }


def _send_notify_failure_alert(config: WhatsAppConfig, entry: dict[str, Any]) -> None:
    from app.store.whatsapp_web_service import resolve_whatsapp_admin_alert_email, send_whatsapp_alert_email

    alert_to = resolve_whatsapp_admin_alert_email()
    if not alert_to:
        return
    now = datetime.utcnow()
    last = getattr(config, 'last_notify_fail_alert_at', None)
    if last and (now - last) < NOTIFY_FAIL_ALERT_COOLDOWN:
        return

    body = (
        'Falló el job de avisos WhatsApp de licencias en tu tienda IMAP.\n\n'
        f"Fecha (Colombia): {entry.get('co_date')} {entry.get('co_time')}\n"
        f"Origen: {entry.get('trigger')}\n"
        f"Estado: {entry.get('status')}\n"
        f"Enviados: {entry.get('sent', 0)} · Errores: {entry.get('errors', 0)}\n"
        f"Motivo: {entry.get('reason') or '—'}\n\n"
        'Revisá Configuraciones → WhatsApp Web (salud y últimas ejecuciones).\n'
    )
    if send_whatsapp_alert_email(
        alert_to,
        '[IMAP] Fallo avisos WhatsApp licencias',
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
    total_sent = int(result.get('sent') or 0) + int(result.get('daily_sent') or 0)
    total_errors = int(result.get('errors') or 0)

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
        refresh_config_health,
        resolve_config_api_key,
        resolve_config_base_url,
        resolve_license_notify_template,
        send_text_message,
    )
    from app.store.whatsapp_daily_sales import (
        has_pending_daily_digests_ready,
        send_pending_daily_digests_for_config,
    )

    if not resolve_config_api_key(config):
        result = {'skipped': True, 'reason': 'sin_api_key'}
        return _finalize_notify_run(config, trigger=run_trigger, result=result)

    run_expiry = not notify_success_for_co_date(config, co_now.date())
    run_daily = has_pending_daily_digests_ready(config, co_now)
    if not run_expiry and not run_daily and not force:
        return {'skipped': True, 'reason': 'nada_pendiente'}

    health = refresh_config_health(config, send_alerts=False)
    if health.get('status') != STATUS_CONNECTED:
        result = {
            'skipped': True,
            'reason': 'whatsapp_no_conectado',
            'status': health.get('status'),
        }
        return _finalize_notify_run(config, trigger=run_trigger, result=result)

    template = resolve_license_notify_template(config)

    stats: dict[str, Any] = {
        'sent': 0,
        'skipped_no_phone': 0,
        'errors': 0,
        'user_ids_sent': [],
        'trigger': run_trigger,
        'daily_sent': 0,
        'daily_errors': 0,
        'daily_skipped_no_phone': 0,
    }

    if run_expiry or force:
        users = User.query.filter_by(enabled=True).order_by(User.id.asc()).all()
        for user in users:
            phone = _resolve_user_whatsapp_phone(user)
            payload = _build_user_notify_payload(user)
            if not payload:
                continue
            if not phone:
                stats['skipped_no_phone'] += 1
                _append_delivery_detail(
                    stats,
                    username=user.username or '',
                    phone=None,
                    kind='aviso',
                    outcome='sin_telefono',
                    reason='Sin teléfono en perfil',
                )
                continue

            body = render_whatsapp_license_template(
                template,
                customer_name=payload['customer_name'],
                product_names=payload['product_names'],
                days_left=int(payload['days_left']),
            )
            try:
                send_result = send_text_message(
                    resolve_config_base_url(config),
                    resolve_config_api_key(config),
                    config_evolution_instance(config),
                    phone,
                    body,
                )
                if send_result.get('success'):
                    stats['sent'] += 1
                    stats['user_ids_sent'].append(user.id)
                    logger.info(
                        'WhatsApp licencia enviado user=%s días=%s trigger=%s',
                        user.username,
                        payload['days_left'],
                        run_trigger,
                    )
                    time.sleep(SEND_PAUSE_SEC)
                else:
                    stats['errors'] += 1
                    err_msg = str(send_result.get('error') or 'Envío fallido')
                    _append_delivery_detail(
                        stats,
                        username=user.username or '',
                        phone=phone,
                        kind='aviso',
                        outcome='error',
                        reason=err_msg,
                    )
                    logger.warning(
                        'WhatsApp licencia falló user=%s: %s',
                        user.username,
                        send_result.get('error'),
                    )
            except Exception as exc:
                stats['errors'] += 1
                _append_delivery_detail(
                    stats,
                    username=user.username or '',
                    phone=phone,
                    kind='aviso',
                    outcome='error',
                    reason=str(exc),
                )

    if run_daily or force:
        daily_stats = send_pending_daily_digests_for_config(
            config,
            co_now,
            send_text_message=send_text_message,
            resolve_config_base_url=resolve_config_base_url,
            resolve_config_api_key=resolve_config_api_key,
            config_evolution_instance=config_evolution_instance,
            resolve_phone=_resolve_user_whatsapp_phone,
            customer_name_fn=_customer_display_name,
            pause_sec=SEND_PAUSE_SEC,
            force=force,
            delivery_details=stats.setdefault('delivery_details', []),
        )
        stats['daily_sent'] = daily_stats.get('daily_sent', 0)
        stats['daily_errors'] = daily_stats.get('daily_errors', 0)
        stats['daily_skipped_no_phone'] = daily_stats.get('daily_skipped_no_phone', 0)
        stats['errors'] += int(daily_stats.get('daily_errors') or 0)

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
    'notify_success_for_co_date',
]
