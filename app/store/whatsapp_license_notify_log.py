# -*- coding: utf-8 -*-
"""Historial de ejecuciones del job de resúmenes WhatsApp (1 registro por día CO)."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from app.utils.timezone import get_colombia_datetime

logger = logging.getLogger(__name__)

MAX_NOTIFY_RUN_LOG = 10
_STATUS_RANK = {'success': 4, 'partial': 3, 'failed': 2, 'skipped': 1}


def _parse_raw_log(config) -> list[dict[str, Any]]:
    raw = getattr(config, 'notify_run_log_json', None) or ''
    if not str(raw).strip():
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _attempt_from_flat(entry: dict[str, Any]) -> dict[str, Any]:
    details = entry.get('delivery_details')
    return {
        'at_utc': entry.get('at_utc'),
        'co_time': entry.get('co_time'),
        'trigger': entry.get('trigger'),
        'status': entry.get('status'),
        'sent': int(entry.get('sent') or 0),
        'errors': int(entry.get('errors') or 0),
        'skipped_no_phone': int(entry.get('skipped_no_phone') or 0),
        'daily_skipped_no_phone': int(entry.get('daily_skipped_no_phone') or 0),
        'daily_sent': int(entry.get('daily_sent') or 0),
        'daily_errors': int(entry.get('daily_errors') or 0),
        'reason': entry.get('reason') or '',
        'delivery_details': details if isinstance(details, list) else [],
    }


def _new_daily_shell(co_date: str) -> dict[str, Any]:
    return {
        'co_date': co_date,
        'co_time': '',
        'at_utc': '',
        'trigger': '',
        'status': 'skipped',
        'sent': 0,
        'errors': 0,
        'skipped_no_phone': 0,
        'daily_sent': 0,
        'daily_errors': 0,
        'reason': '',
        'attempt_count': 0,
        'attempts': [],
    }


def _recompute_daily_summary(daily: dict[str, Any]) -> None:
    attempts = daily.get('attempts') or []
    if not attempts:
        daily['attempt_count'] = 0
        return

    latest = attempts[0]
    daily['co_time'] = latest.get('co_time') or ''
    daily['at_utc'] = latest.get('at_utc') or ''
    daily['trigger'] = latest.get('trigger') or ''
    daily['reason'] = latest.get('reason') or ''
    daily['attempt_count'] = len(attempts)

    daily['status'] = max(
        attempts,
        key=lambda a: _STATUS_RANK.get(str(a.get('status') or '').lower(), 0),
    ).get('status', 'skipped')

    daily['sent'] = sum(int(a.get('sent') or 0) for a in attempts)
    daily['errors'] = sum(int(a.get('errors') or 0) for a in attempts)
    daily['skipped_no_phone'] = sum(int(a.get('skipped_no_phone') or 0) for a in attempts)
    daily['daily_sent'] = sum(int(a.get('daily_sent') or 0) for a in attempts)
    daily['daily_errors'] = sum(int(a.get('daily_errors') or 0) for a in attempts)


def _coerce_daily_log(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Agrupa entradas planas (legacy) o consolida intentos bajo un día CO."""
    by_date: dict[str, dict[str, Any]] = {}

    for item in raw:
        if not isinstance(item, dict):
            continue
        co_date = str(item.get('co_date') or '').strip()
        if not co_date:
            continue

        if item.get('attempts') is not None and isinstance(item.get('attempts'), list):
            daily = by_date.get(co_date) or _new_daily_shell(co_date)
            attempts_list = item.get('attempts') or []
            if attempts_list:
                for att in attempts_list:
                    if isinstance(att, dict):
                        daily['attempts'].append(att)
            elif item.get('co_time') or item.get('at_utc') or item.get('status'):
                daily['attempts'].append(_attempt_from_flat(item))
            by_date[co_date] = daily
            continue

        daily = by_date.get(co_date) or _new_daily_shell(co_date)
        daily['attempts'].append(_attempt_from_flat(item))
        by_date[co_date] = daily

    for daily in by_date.values():
        daily['attempts'].sort(
            key=lambda a: (a.get('at_utc') or '', a.get('co_time') or ''),
            reverse=True,
        )
        _recompute_daily_summary(daily)

    return sorted(by_date.values(), key=lambda d: d.get('co_date') or '', reverse=True)


def parse_notify_run_log(config) -> list[dict[str, Any]]:
    return _coerce_daily_log(_parse_raw_log(config))


def _notify_log_needs_compaction(raw: list[dict[str, Any]]) -> bool:
    if not raw:
        return False
    daily = _coerce_daily_log(raw)
    if len(daily) != len(raw):
        return True
    for item in raw:
        if not isinstance(item, dict):
            continue
        attempts = item.get('attempts')
        if attempts is None:
            return True
        if (
            isinstance(attempts, list)
            and not attempts
            and (item.get('co_time') or item.get('at_utc') or item.get('status'))
        ):
            return True
    return False


def compact_notify_run_log(config, *, persist: bool = True) -> list[dict[str, Any]]:
    """Unifica entradas legacy en 1 registro por día CO (máx. MAX_NOTIFY_RUN_LOG días)."""
    raw = _parse_raw_log(config)
    compact = _coerce_daily_log(raw)[:MAX_NOTIFY_RUN_LOG]
    if persist and _notify_log_needs_compaction(raw):
        config.notify_run_log_json = json.dumps(compact, ensure_ascii=False)
    return compact


def append_notify_run_log(config, entry: dict[str, Any]) -> None:
    """Añade un intento al día CO; la tabla guarda como máximo MAX_NOTIFY_RUN_LOG días."""
    co_date = str(entry.get('co_date') or '').strip()
    if not co_date:
        return

    daily_log = parse_notify_run_log(config)
    by_date = {str(d.get('co_date')): d for d in daily_log}
    daily = by_date.get(co_date) or _new_daily_shell(co_date)

    attempt = _attempt_from_flat(entry)
    daily['attempts'].insert(0, attempt)
    _recompute_daily_summary(daily)
    by_date[co_date] = daily

    merged = sorted(by_date.values(), key=lambda d: d.get('co_date') or '', reverse=True)
    config.notify_run_log_json = json.dumps(merged[:MAX_NOTIFY_RUN_LOG], ensure_ascii=False)


def build_notify_log_entry(
    *,
    trigger: str,
    status: str,
    result: dict[str, Any],
    reason: str | None = None,
) -> dict[str, Any]:
    from app.store.whatsapp_user_messages import humanize_whatsapp_notify_reason

    co_now = get_colombia_datetime()
    now_utc = datetime.utcnow()
    raw_reason = reason or result.get('reason') or ''
    return {
        'at_utc': now_utc.isoformat() + 'Z',
        'co_date': co_now.date().isoformat(),
        'co_time': co_now.strftime('%H:%M:%S'),
        'trigger': trigger,
        'status': status,
        'sent': int(result.get('sent') or 0),
        'errors': int(result.get('errors') or 0),
        'skipped_no_phone': int(result.get('skipped_no_phone') or 0),
        'daily_skipped_no_phone': int(result.get('daily_skipped_no_phone') or 0),
        'daily_sent': int(result.get('daily_sent') or 0),
        'daily_errors': int(result.get('daily_errors') or 0),
        'reason': humanize_whatsapp_notify_reason(
            raw_reason,
            connection_status=result.get('status') or result.get('connection_status'),
        ),
        'delivery_details': result.get('delivery_details') or [],
    }


def serialize_notify_run_log_for_api(config) -> list[dict[str, Any]]:
    from app.store.whatsapp_user_messages import humanize_whatsapp_notify_log_entry

    out = []
    for entry in compact_notify_run_log(config, persist=True):
        attempts = []
        for att in entry.get('attempts') or []:
            if not isinstance(att, dict):
                continue
            attempts.append(
                {
                    'at_utc': att.get('at_utc'),
                    'co_time': att.get('co_time'),
                    'trigger': att.get('trigger'),
                    'status': att.get('status'),
                    'sent': att.get('sent', 0),
                    'errors': att.get('errors', 0),
                    'skipped_no_phone': att.get('skipped_no_phone', 0),
                    'daily_skipped_no_phone': att.get('daily_skipped_no_phone', 0),
                    'daily_sent': att.get('daily_sent', 0),
                    'daily_errors': att.get('daily_errors', 0),
                    'reason': att.get('reason') or '',
                    'delivery_details': att.get('delivery_details') or [],
                }
            )
        out.append(
            humanize_whatsapp_notify_log_entry(
                {
                    'co_date': entry.get('co_date'),
                    'co_time': entry.get('co_time'),
                    'at_utc': entry.get('at_utc'),
                    'trigger': entry.get('trigger'),
                    'status': entry.get('status'),
                    'sent': entry.get('sent', 0),
                    'errors': entry.get('errors', 0),
                    'skipped_no_phone': entry.get('skipped_no_phone', 0),
                    'daily_sent': entry.get('daily_sent', 0),
                    'daily_errors': entry.get('daily_errors', 0),
                    'reason': entry.get('reason') or '',
                    'attempt_count': entry.get('attempt_count', len(attempts)),
                    'attempts': attempts,
                }
            )
        )
    return out
