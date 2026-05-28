# Configuración de revisión automática por correo (regex propios + IMAP + buzón admin opcional).

from __future__ import annotations

import json
import re
from typing import Any

from app.extensions import db
from app.models.imap import IMAPServer
from app.store.models import StoreSetting

SETTINGS_KEY = 'balance_recharge_email_review'


def _default_settings() -> dict[str, Any]:
    return {
        'regex_entries': [],
        'imap_server_ids': [],
    }


def _normalize_regex_entry(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    try:
        entry_id = int(raw.get('id'))
    except (TypeError, ValueError):
        return None
    if entry_id <= 0:
        return None
    description = str(raw.get('description') or '').strip()
    sender = str(raw.get('sender') or '').strip()
    pattern = str(raw.get('pattern') or '').strip()
    if not description or not pattern:
        return None
    enabled = raw.get('enabled')
    if enabled is None:
        enabled = True
    return {
        'id': entry_id,
        'description': description,
        'sender': sender,
        'pattern': pattern,
        'enabled': bool(enabled),
    }


def _parse_settings_row(row: StoreSetting | None) -> dict[str, Any]:
    data = _default_settings()
    if not row or not row.value:
        return data
    try:
        stored = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return data
    if not isinstance(stored, dict):
        return data

    entries: list[dict[str, Any]] = []
    if isinstance(stored.get('regex_entries'), list):
        for item in stored['regex_entries']:
            normalized = _normalize_regex_entry(item)
            if normalized and not any(x['id'] == normalized['id'] for x in entries):
                entries.append(normalized)
    data['regex_entries'] = entries

    if isinstance(stored.get('imap_server_ids'), list):
        data['imap_server_ids'] = [
            int(x) for x in stored['imap_server_ids']
            if str(x).strip().isdigit() or isinstance(x, int)
        ]
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


def save_email_review_settings(updates: dict[str, Any]) -> dict[str, Any]:
    data = get_email_review_settings()
    if 'imap_server_ids' in updates:
        raw = updates.get('imap_server_ids') or []
        ids: list[int] = []
        if isinstance(raw, list):
            for x in raw:
                try:
                    uid = int(x)
                except (TypeError, ValueError):
                    continue
                if uid > 0 and uid not in ids:
                    ids.append(uid)
        data['imap_server_ids'] = ids
    return _persist_settings(data)


def _next_regex_id(entries: list[dict[str, Any]]) -> int:
    if not entries:
        return 1
    return max(int(e['id']) for e in entries) + 1


def list_email_regex_entries() -> list[dict[str, Any]]:
    return list(get_email_review_settings().get('regex_entries') or [])


def create_email_regex_entry(
    description: str,
    sender: str,
    pattern: str,
) -> dict[str, Any]:
    description = (description or '').strip()
    sender = (sender or '').strip()
    pattern = (pattern or '').strip()
    if not description:
        raise ValueError('La descripción es obligatoria.')
    if not pattern:
        raise ValueError('El patrón es obligatorio.')
    _validate_pattern(pattern)

    data = get_email_review_settings()
    entries = list(data.get('regex_entries') or [])
    entry = {
        'id': _next_regex_id(entries),
        'description': description,
        'sender': sender,
        'pattern': pattern,
        'enabled': True,
    }
    entries.append(entry)
    data['regex_entries'] = entries
    _persist_settings(data)
    return entry


def update_email_regex_entry(
    entry_id: int,
    description: str,
    sender: str,
    pattern: str,
) -> dict[str, Any]:
    description = (description or '').strip()
    sender = (sender or '').strip()
    pattern = (pattern or '').strip()
    if not description:
        raise ValueError('La descripción es obligatoria.')
    if not pattern:
        raise ValueError('El patrón es obligatorio.')
    _validate_pattern(pattern)

    data = get_email_review_settings()
    entries = list(data.get('regex_entries') or [])
    found = None
    for item in entries:
        if int(item.get('id')) == int(entry_id):
            item['description'] = description
            item['sender'] = sender
            item['pattern'] = pattern
            found = item
            break
    if not found:
        raise ValueError('Regex no encontrado.')
    data['regex_entries'] = entries
    _persist_settings(data)
    return found


def delete_email_regex_entry(entry_id: int) -> bool:
    data = get_email_review_settings()
    entries = list(data.get('regex_entries') or [])
    new_entries = [e for e in entries if int(e.get('id')) != int(entry_id)]
    if len(new_entries) == len(entries):
        return False
    data['regex_entries'] = new_entries
    _persist_settings(data)
    return True


def _validate_pattern(pattern: str) -> None:
    try:
        re.compile(pattern)
    except re.error as exc:
        raise ValueError(f'Patrón regex inválido: {exc}') from exc


def list_imap_server_options() -> list[dict[str, Any]]:
    rows = IMAPServer.query.order_by(IMAPServer.id.asc()).all()
    out: list[dict[str, Any]] = []
    for s in rows:
        out.append({
            'id': s.id,
            'host': s.host or '',
            'username': s.username or '',
            'description': s.description or '',
            'enabled': bool(s.enabled),
            'folders': s.folders or 'INBOX',
        })
    return out


def buzon_enabled() -> bool:
    """Lee el observador IMAP global (Admin Dashboard). Desactivado por defecto."""
    from app.admin.site_settings import get_site_setting

    return get_site_setting('observer_enabled', '0') == '1'


def set_buzon_enabled(enabled: bool) -> bool:
    from app.admin.site_settings import set_site_setting

    set_site_setting('observer_enabled', '1' if enabled else '0')
    return bool(enabled)
