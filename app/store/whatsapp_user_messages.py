# -*- coding: utf-8 -*-
"""Textos legibles para logs, API y alertas de resúmenes WhatsApp."""

from __future__ import annotations

from typing import Any

WHATSAPP_NOTIFY_REASON_LABELS: dict[str, str] = {
    'whatsapp_desactivado': 'WhatsApp está desactivado. Activá el uso de WhatsApp para enviar resúmenes.',
    'whatsapp_no_conectado': 'WhatsApp no está conectado. Verificá el estado y escaneá el QR si hace falta.',
    'sin_api_key': 'Falta la API Key de Evolution (revisá EVOLUTION_API_KEY en el servidor).',
    'nada_pendiente': 'No hay resúmenes pendientes para enviar.',
    'fuera_de_ventana_o_ya_ejecutado': 'Aún no corresponde enviar o el resumen del día ya se procesó.',
}

WHATSAPP_NOTIFY_TRIGGER_LABELS: dict[str, str] = {
    'scheduled': 'Programado',
    'reconnect_catchup': 'Reconexión (+10 min)',
    'manual': 'Manual',
}

WHATSAPP_NOTIFY_STATUS_LABELS: dict[str, str] = {
    'success': 'OK',
    'partial': 'Parcial',
    'failed': 'Falló',
    'skipped': 'Omitido',
}

WHATSAPP_DELIVERY_OUTCOME_LABELS: dict[str, str] = {
    'ok': 'Enviado',
    'error': 'Falló el envío',
    'sin_telefono': 'Sin teléfono en perfil',
    'deshabilitado': 'WhatsApp desactivado para el usuario',
}

WHATSAPP_DELIVERY_KIND_LABELS: dict[str, str] = {
    'aviso': 'Aviso de licencia (registro antiguo)',
    'resumen': 'Resumen diario',
}


def humanize_whatsapp_notify_reason(
    raw: str | None,
    *,
    connection_status: str | None = None,
) -> str:
    """Convierte códigos técnicos del job en mensajes para el admin."""
    text = str(raw or '').strip()
    if not text:
        return '—'

    key = text.lower()
    if key in WHATSAPP_NOTIFY_REASON_LABELS:
        label = WHATSAPP_NOTIFY_REASON_LABELS[key]
        if key == 'whatsapp_no_conectado' and connection_status:
            from app.store.whatsapp_web_service import status_label_es

            estado = status_label_es(connection_status)
            if estado and estado != 'Desconocido':
                return f'{label} Estado actual: {estado}.'
        return label

    if ' ' in text or any(ch in text for ch in 'áéíóúñÁÉÍÓÚÑ¿¡'):
        return text

    if '_' in text and text.replace('_', '').isascii():
        return text.replace('_', ' ').capitalize()

    return text


def humanize_whatsapp_notify_trigger(trigger: str | None) -> str:
    key = str(trigger or '').strip().lower()
    return WHATSAPP_NOTIFY_TRIGGER_LABELS.get(key, trigger or '—')


def humanize_whatsapp_notify_status(status: str | None) -> str:
    key = str(status or '').strip().lower()
    return WHATSAPP_NOTIFY_STATUS_LABELS.get(key, status or '—')


def humanize_whatsapp_delivery_detail(detail: dict[str, Any]) -> dict[str, Any]:
    """Normaliza un detalle por cliente para la API."""
    if not isinstance(detail, dict):
        return detail
    out = dict(detail)
    outcome = str(out.get('outcome') or '').strip().lower()
    reason = str(out.get('reason') or '').strip()
    kind = str(out.get('kind') or '').strip().lower()

    if kind in WHATSAPP_DELIVERY_KIND_LABELS:
        out['kind_label'] = WHATSAPP_DELIVERY_KIND_LABELS[kind]

    if reason:
        out['reason'] = humanize_whatsapp_notify_reason(reason)
    elif outcome in WHATSAPP_DELIVERY_OUTCOME_LABELS:
        out['reason'] = WHATSAPP_DELIVERY_OUTCOME_LABELS[outcome]

    if outcome in WHATSAPP_DELIVERY_OUTCOME_LABELS:
        out['outcome_label'] = WHATSAPP_DELIVERY_OUTCOME_LABELS[outcome]

    return out


def humanize_whatsapp_notify_attempt(entry: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(entry, dict):
        return entry
    out = dict(entry)
    raw_reason = out.get('reason') or ''
    out['reason'] = humanize_whatsapp_notify_reason(
        raw_reason,
        connection_status=out.get('connection_status'),
    )
    out['trigger_label'] = humanize_whatsapp_notify_trigger(out.get('trigger'))
    out['status_label'] = humanize_whatsapp_notify_status(out.get('status'))
    details = out.get('delivery_details') or []
    if isinstance(details, list):
        out['delivery_details'] = [humanize_whatsapp_delivery_detail(d) for d in details]
    return out


def humanize_whatsapp_notify_log_entry(entry: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(entry, dict):
        return entry
    out = dict(entry)
    out['reason'] = humanize_whatsapp_notify_reason(out.get('reason'))
    out['trigger_label'] = humanize_whatsapp_notify_trigger(out.get('trigger'))
    out['status_label'] = humanize_whatsapp_notify_status(out.get('status'))
    attempts = []
    for att in out.get('attempts') or []:
        if isinstance(att, dict):
            attempts.append(humanize_whatsapp_notify_attempt(att))
    out['attempts'] = attempts
    return out


def whatsapp_manual_run_user_message(result: dict[str, Any]) -> str:
    """Mensaje de éxito al pulsar «Resúmenes» manualmente."""
    sent = int(result.get('daily_sent') or 0)
    errors = int(result.get('errors') or result.get('daily_errors') or 0)
    skipped = int(result.get('daily_skipped_no_phone') or result.get('skipped_no_phone') or 0)
    if sent <= 0 and errors <= 0:
        return 'No había resúmenes pendientes para enviar.'
    parts = [f'Se enviaron {sent} resumen(es) por WhatsApp.']
    if skipped > 0:
        parts.append(f'{skipped} cliente(s) omitido(s) (sin teléfono o desactivados).')
    if errors > 0:
        parts.append(f'{errors} error(es) de envío.')
    return ' '.join(parts)
