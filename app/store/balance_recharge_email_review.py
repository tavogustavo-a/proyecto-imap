# Configuración de revisión automática por correo (regex propios + IMAP + buzón admin opcional).

from __future__ import annotations

import json
import re
from typing import Any

from app.extensions import db
from app.store.models import StoreSetting

SETTINGS_KEY = 'balance_recharge_email_review'

# Los regex de correo se configuran solo en admin (Revisión automática → Regex).
# No hay patrones integrados en código: así puedes cambiarlos sin desplegar.

# Aviso Bancolombia clásico: monto + *XXXX + fecha + hora (sin comprobante de la app).
BANCOLOMBIA_TRANSFER_EMAIL_REGEX = (
    r'bancolombia\s*:\s*recibiste\s+una\s+transferencia\s+por\s+\$\s*'
    r'([\d][\d,.\s]*)\s+de\s+'
    r'[\s\S]{0,400}?'
    r'en\s+tu\s+cuenta\s*\*+(\d{2,4}),\s*'
    r'el\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+a\s+las\s+(\d{1,2}:\d{2})'
)


def _default_settings() -> dict[str, Any]:
    return {
        'regex_entries': [],
        'imap_servers': [],
        'buzon_enabled': False,
    }


def _payment_method_option_currency_label(currency: str) -> str:
    cur = str(currency or '').strip().upper()
    if cur == 'ACCUM':
        return 'Acumulador'
    return cur


def _payment_method_option_sort_key(option: dict[str, Any]) -> tuple:
    cur = str(option.get('currency_bucket') or option.get('currency') or '').upper()
    order = {'COP': 0, 'USD': 1, 'ACCUM': 2}
    return (order.get(cur, 9), str(option.get('label') or ''))


def list_payment_method_options() -> list[dict[str, Any]]:
    """Medios de pago configurados (mismo Nombre que en Medios de pago)."""
    from app.store.balance_recharge_payment import (
        get_payment_methods_config,
        payment_method_option_display_label,
    )

    config = get_payment_methods_config()
    out: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for currency, methods in config.items():
        cur = str(currency or '').strip().upper()
        if cur not in ('COP', 'USD', 'ACCUM'):
            continue
        for m in methods or []:
            label = str(m.get('label') or '').strip()
            mid = str(m.get('id') or '').strip()
            if not label or not mid or mid in seen_ids:
                continue
            if m.get('enabled') is False:
                continue
            seen_ids.add(mid)
            display_label = payment_method_option_display_label(m)
            out.append({
                'id': mid,
                'label': label,
                'display_label': display_label or label,
                'currency': _payment_method_option_currency_label(cur),
                'currency_bucket': cur,
            })
    out.sort(key=_payment_method_option_sort_key)
    return out


def _resolve_payment_method_option(
    payment_method_label: str = '',
    payment_method_id: str = '',
) -> dict[str, Any] | None:
    pm_id = (payment_method_id or '').strip()
    if pm_id:
        pm = resolve_payment_method_by_id(pm_id)
        if pm:
            return pm
    label = (payment_method_label or '').strip()
    if label:
        return resolve_payment_method_by_label(label)
    return None


def resolve_payment_method_by_label(label: str) -> dict[str, Any] | None:
    needle = (label or '').strip()
    if not needle:
        return None
    for opt in list_payment_method_options():
        if opt.get('label') == needle:
            return opt
    return None


def resolve_payment_method_by_id(pm_id: str) -> dict[str, Any] | None:
    needle = (pm_id or '').strip()
    if not needle:
        return None
    for opt in list_payment_method_options():
        if opt.get('id') == needle:
            return opt
    return None


def _load_raw_stored_dict(row: StoreSetting | None) -> dict[str, Any]:
    if not row or not row.value:
        return _default_settings()
    try:
        stored = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return _default_settings()
    if not isinstance(stored, dict):
        return _default_settings()
    return stored


def _repair_regex_entry_ids(raw_list: list[Any]) -> tuple[list[dict[str, Any]], bool]:
    """Asigna IDs positivos únicos a entradas legadas (p. ej. id -1 de integrados)."""
    if not raw_list:
        return [], False
    changed = False
    used: set[int] = set()
    max_id = 0
    items: list[dict[str, Any]] = []
    for item in raw_list:
        if not isinstance(item, dict):
            changed = True
            continue
        items.append(dict(item))
        try:
            eid = int(item.get('id'))
        except (TypeError, ValueError):
            continue
        if eid > 0:
            max_id = max(max_id, eid)
    next_id = max(max_id, 0) + 1
    out: list[dict[str, Any]] = []
    for item in items:
        try:
            eid = int(item.get('id'))
        except (TypeError, ValueError):
            eid = 0
            changed = True
        if eid <= 0 or eid in used:
            item['id'] = next_id
            next_id += 1
            changed = True
            eid = int(item['id'])
        used.add(eid)
        out.append(item)
    return out, changed


def _is_bancolombia_classic_regex_entry(entry: dict[str, Any]) -> bool:
    pm_id = str(entry.get('payment_method_id') or '').strip().lower()
    label = str(entry.get('payment_method_label') or entry.get('description') or '').strip().lower()
    haystack = f'{pm_id} {label}'
    if not any(tok in haystack for tok in ('bancolombia', 'cuenta de ahorros')):
        return False
    return not any(tok in haystack for tok in ('bre-b', 'bre_b', 'breb', 'breve', 'kamin'))


def _upgrade_bancolombia_regex_pattern(entry: dict[str, Any]) -> dict[str, Any]:
    """Regex canónico: grupo 1 monto, 2 sufijo *XXXX, 3 fecha, 4 hora (sin comprobante)."""
    if not _is_bancolombia_classic_regex_entry(entry):
        return entry
    pattern = str(entry.get('pattern') or '').strip()
    if not pattern:
        entry['pattern'] = BANCOLOMBIA_TRANSFER_EMAIL_REGEX
        return entry
    low = pattern.lower()
    if 'recibiste' not in low or 'cuenta' not in low:
        return entry
    if pattern == BANCOLOMBIA_TRANSFER_EMAIL_REGEX:
        return entry
    entry['pattern'] = BANCOLOMBIA_TRANSFER_EMAIL_REGEX
    return entry


def _sync_regex_entry_payment_method(entry: dict[str, Any]) -> dict[str, Any]:
    """Alinea id y etiqueta con el medio actual (ids legados como bancolombia_cuenta_de_ahorros)."""
    label = str(entry.get('payment_method_label') or entry.get('description') or '').strip()
    pm_id = str(entry.get('payment_method_id') or '').strip()
    pm = _resolve_payment_method_option(label, pm_id)
    if pm:
        canonical_id = str(pm.get('id') or '').strip()
        canonical_label = str(pm.get('label') or '').strip()
        if canonical_id:
            entry['payment_method_id'] = canonical_id
        if canonical_label:
            entry['payment_method_label'] = canonical_label
            entry['description'] = canonical_label
        return entry
    if pm_id:
        pm_by_id = resolve_payment_method_by_id(pm_id)
        if pm_by_id and pm_by_id.get('label'):
            entry['payment_method_label'] = pm_by_id['label']
            entry['description'] = pm_by_id['label']
    return entry


def _normalize_regex_entry(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    try:
        entry_id = int(raw.get('id'))
    except (TypeError, ValueError):
        return None
    if entry_id <= 0:
        return None

    payment_method_id = str(raw.get('payment_method_id') or '').strip()
    if not payment_method_id:
        pm_ids_raw = raw.get('payment_method_ids') or []
        if isinstance(pm_ids_raw, list) and pm_ids_raw:
            payment_method_id = str(pm_ids_raw[0] or '').strip()

    payment_method_label = str(
        raw.get('payment_method_label') or raw.get('description') or ''
    ).strip()
    if not payment_method_label and payment_method_id:
        pm = resolve_payment_method_by_id(payment_method_id)
        if pm:
            payment_method_label = str(pm.get('label') or '').strip()
    if not payment_method_label:
        return None

    sender = str(raw.get('sender') or '').strip()
    pattern = str(raw.get('pattern') or '').strip()

    if pattern:
        try:
            re.compile(pattern)
        except re.error:
            return None

    enabled = raw.get('enabled')
    if enabled is None:
        enabled = True

    out = {
        'id': entry_id,
        'payment_method_label': payment_method_label,
        'payment_method_id': payment_method_id,
        'sender': sender,
        'pattern': pattern,
        'note': str(raw.get('note') or '').strip(),
        'enabled': bool(enabled),
        # Alias legado para UI antigua
        'description': payment_method_label,
    }
    out = _sync_regex_entry_payment_method(out)
    out = _upgrade_bancolombia_regex_pattern(out)
    pm = _resolve_payment_method_option(
        str(out.get('payment_method_label') or ''),
        str(out.get('payment_method_id') or ''),
    )
    if pm:
        display = str(pm.get('display_label') or pm.get('label') or payment_method_label).strip()
        cur = str(pm.get('currency') or '').strip()
        if display and cur:
            display = f'{display} ({cur})'
        if display:
            out['display_label'] = display
    return out


def _parse_settings_row(row: StoreSetting | None) -> dict[str, Any]:
    data = _default_settings()
    if not row or not row.value:
        return data
    stored = _load_raw_stored_dict(row)
    if not stored:
        return data

    entries: list[dict[str, Any]] = []
    if isinstance(stored.get('regex_entries'), list):
        repaired, fixed_ids = _repair_regex_entry_ids(stored['regex_entries'])
        repaired_pm_ids = False
        repaired_patterns = False
        for item in repaired:
            before_id = str(item.get('payment_method_id') or '').strip()
            before_pattern = str(item.get('pattern') or '').strip()
            item = _upgrade_bancolombia_regex_pattern(item)
            if str(item.get('pattern') or '').strip() != before_pattern:
                repaired_patterns = True
            normalized = _normalize_regex_entry(item)
            if not normalized:
                continue
            after_id = str(normalized.get('payment_method_id') or '').strip()
            if after_id and after_id != before_id:
                item['payment_method_id'] = after_id
                item['payment_method_label'] = normalized.get('payment_method_label') or item.get(
                    'payment_method_label'
                )
                item['description'] = item['payment_method_label']
                repaired_pm_ids = True
            if not any(x['id'] == normalized['id'] for x in entries):
                entries.append(normalized)
        if fixed_ids or repaired_pm_ids or repaired_patterns:
            stored['regex_entries'] = repaired
            row.value = json.dumps(stored, ensure_ascii=False)
            db.session.commit()
    data['regex_entries'] = entries

    imap_servers: list[dict[str, Any]] = []
    if isinstance(stored.get('imap_servers'), list):
        from app.store.balance_recharge_imap import _normalize_imap_server

        for item in stored['imap_servers']:
            normalized = _normalize_imap_server(item)
            if normalized and not any(x['id'] == normalized['id'] for x in imap_servers):
                imap_servers.append(normalized)
    data['imap_servers'] = imap_servers

    data['buzon_enabled'] = bool(stored.get('buzon_enabled', False))
    return data


def _persist_settings(data: dict[str, Any]) -> dict[str, Any]:
    row = StoreSetting.query.filter_by(key=SETTINGS_KEY).first()
    payload = json.dumps(data, ensure_ascii=False)
    if row:
        row.value = payload
    else:
        db.session.add(StoreSetting(key=SETTINGS_KEY, value=payload))
    db.session.commit()
    return data


def get_email_review_settings() -> dict[str, Any]:
    row = StoreSetting.query.filter_by(key=SETTINGS_KEY).first()
    return _parse_settings_row(row)


def _next_regex_id(entries: list[dict[str, Any]]) -> int:
    if not entries:
        return 1
    return max(int(e['id']) for e in entries) + 1


def _stored_regex_entries() -> list[dict[str, Any]]:
    return list(get_email_review_settings().get('regex_entries') or [])


def list_email_regex_entries() -> list[dict[str, Any]]:
    return _stored_regex_entries()


def _find_duplicate_entry(
    entries: list[dict[str, Any]],
    payment_method_id: str,
    sender: str,
    pattern: str,
    *,
    exclude_id: int | None = None,
) -> dict[str, Any] | None:
    pm = (payment_method_id or '').strip().lower()
    sender_n = (sender or '').strip().lower()
    pattern_n = (pattern or '').strip()
    for item in entries:
        if exclude_id is not None and int(item.get('id')) == int(exclude_id):
            continue
        if str(item.get('payment_method_id') or '').strip().lower() != pm:
            continue
        if (item.get('sender') or '').strip().lower() != sender_n:
            continue
        if (item.get('pattern') or '').strip() != pattern_n:
            continue
        return item
    return None


def create_email_regex_entry(
    payment_method_label: str,
    sender: str = '',
    pattern: str = '',
    note: str = '',
    payment_method_id: str = '',
) -> dict[str, Any]:
    payment_method_label = (payment_method_label or '').strip()
    sender = (sender or '').strip()
    pattern = (pattern or '').strip()
    note = (note or '').strip()
    pm = _resolve_payment_method_option(payment_method_label, payment_method_id)
    if not pm:
        raise ValueError('Selecciona el medio de pago.')
    payment_method_label = str(pm.get('label') or payment_method_label).strip()
    if pattern:
        _validate_pattern(pattern)

    data = get_email_review_settings()
    entries = list(data.get('regex_entries') or [])
    if _find_duplicate_entry(entries, pm.get('id') or '', sender, pattern):
        raise ValueError('Ya existe un regex idéntico (mismo medio, remitente y patrón).')

    entry = {
        'id': _next_regex_id(entries),
        'payment_method_label': payment_method_label,
        'payment_method_id': pm.get('id') or '',
        'sender': sender,
        'pattern': pattern,
        'note': note[:120],
        'enabled': True,
    }
    entries.append(entry)
    data['regex_entries'] = entries
    _persist_settings(data)
    normalized = _normalize_regex_entry(entry)
    return normalized or entry


def update_email_regex_entry(
    entry_id: int,
    payment_method_label: str,
    sender: str = '',
    pattern: str = '',
    note: str = '',
    payment_method_id: str = '',
) -> dict[str, Any]:
    payment_method_label = (payment_method_label or '').strip()
    sender = (sender or '').strip()
    pattern = (pattern or '').strip()
    note = (note or '').strip()
    pm = _resolve_payment_method_option(payment_method_label, payment_method_id)
    if not pm:
        raise ValueError('Selecciona el medio de pago.')
    payment_method_label = str(pm.get('label') or payment_method_label).strip()
    if pattern:
        _validate_pattern(pattern)

    data = get_email_review_settings()
    entries = list(data.get('regex_entries') or [])
    if _find_duplicate_entry(
        entries,
        pm.get('id') or '',
        sender,
        pattern,
        exclude_id=entry_id,
    ):
        raise ValueError('Ya existe otro regex idéntico (mismo medio, remitente y patrón).')

    found = None
    for item in entries:
        if int(item.get('id')) == int(entry_id):
            item['payment_method_label'] = payment_method_label
            item['payment_method_id'] = pm.get('id') or ''
            item['sender'] = sender
            item['pattern'] = pattern
            item['note'] = note[:120]
            found = item
            break
    if not found:
        raise ValueError('Regex no encontrado.')
    data['regex_entries'] = entries
    _persist_settings(data)
    normalized = _normalize_regex_entry(found)
    return normalized or found


def delete_email_regex_entry(entry_id: int) -> bool:
    entry_id = int(entry_id)
    if entry_id <= 0:
        return False

    row = StoreSetting.query.filter_by(key=SETTINGS_KEY).first()
    if not row or not row.value:
        return False
    stored = _load_raw_stored_dict(row)
    raw_list = stored.get('regex_entries')
    if not isinstance(raw_list, list):
        return False

    new_raw: list[Any] = []
    removed = False
    for item in raw_list:
        if not isinstance(item, dict):
            new_raw.append(item)
            continue
        try:
            rid = int(item.get('id'))
        except (TypeError, ValueError):
            new_raw.append(item)
            continue
        if rid == entry_id:
            removed = True
            continue
        new_raw.append(item)
    if not removed:
        return False

    stored['regex_entries'] = new_raw
    row.value = json.dumps(stored, ensure_ascii=False)
    db.session.commit()
    return True


def _validate_pattern(pattern: str) -> None:
    try:
        re.compile(pattern)
    except re.error as exc:
        raise ValueError(f'Patrón regex inválido: {exc}') from exc


def list_imap_server_options() -> list[dict[str, Any]]:
    from app.store.balance_recharge_imap import list_recarga_imap_servers

    return list_recarga_imap_servers()


def buzon_enabled() -> bool:
    """True si la revisión de recargas debe consultar el buzón de mensajes (ReceivedEmail)."""
    return bool(get_email_review_settings().get('buzon_enabled'))


def set_buzon_enabled(enabled: bool) -> bool:
    data = get_email_review_settings()
    data['buzon_enabled'] = bool(enabled)
    _persist_settings(data)
    return bool(enabled)
