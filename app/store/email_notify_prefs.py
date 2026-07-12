# -*- coding: utf-8 -*-
"""
Preferencias de notificaciones de tienda por usuario (cuenta de facturación).

- email / push / in-app: activos por defecto; el cliente los gestiona en Licencias → Notificación.
- email_notify_enabled se sincroniza con el checkbox admin «Envío email notificaciones».
- vibrate / sound: desactivados por defecto; opt-in.
- type prefs (JSON): por tipo de aviso; ausente = activo.
- WhatsApp: solo admin (whatsapp_notify_enabled), no se gestiona aquí.
- Caducidad: avisos de vencimiento (opt-in + días).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from flask import current_app
from sqlalchemy import inspect, text

from app.extensions import db
from app.models.user import User

logger = logging.getLogger(__name__)

# Tipos admin (Menú Licencias → Notificaciones). Default ON.
ADMIN_NOTIFY_TYPE_DEFAULTS: dict[str, bool] = {
    'license_report': True,
    'balance_recharge': True,
    'reservation': True,
    'wa_digest': True,
}

KIND_TO_ADMIN_TYPE: dict[str, str] = {
    'admin_license_report_new': 'license_report',
    'admin_balance_recharge': 'balance_recharge',
    'admin_product_reservation': 'reservation',
    'admin_whatsapp_digest_fallback': 'wa_digest',
}


def ensure_user_email_notify_enabled_column() -> None:
    """Compat: asegura todas las columnas de prefs de notificación."""
    ensure_store_notify_prefs_columns()


def ensure_store_notify_prefs_columns() -> None:
    try:
        insp = inspect(db.engine)
        if not insp.has_table('users'):
            return
        cols = {c['name'].lower() for c in insp.get_columns('users')}
        dialect = getattr(db.engine.dialect, 'name', '') or ''

        def _add_bool(col: str, default_true: bool) -> None:
            nonlocal cols
            if col in cols:
                return
            if dialect == 'postgresql':
                dval = 'TRUE' if default_true else 'FALSE'
                ddl = f'ALTER TABLE users ADD COLUMN {col} BOOLEAN NOT NULL DEFAULT {dval}'
            else:
                dval = '1' if default_true else '0'
                ddl = f'ALTER TABLE users ADD COLUMN {col} INTEGER NOT NULL DEFAULT {dval}'
            db.session.execute(text(ddl))
            db.session.commit()
            cols.add(col)
            current_app.logger.info('Esquema: columna %s añadida a users (%s)', col, dialect)

        _add_bool('email_notify_enabled', True)
        _add_bool('push_notify_enabled', True)
        _add_bool('inapp_notify_enabled', True)
        _add_bool('notify_vibrate_enabled', False)
        _add_bool('notify_sound_enabled', False)
        _add_bool('caducidad_notify_enabled', False)

        if 'caducidad_notify_from_days' not in cols:
            ddl = (
                'ALTER TABLE users ADD COLUMN caducidad_notify_from_days '
                'INTEGER NOT NULL DEFAULT 5'
            )
            db.session.execute(text(ddl))
            db.session.commit()
            cols.add('caducidad_notify_from_days')
            current_app.logger.info(
                'Esquema: columna caducidad_notify_from_days añadida a users (%s)',
                dialect,
            )

        if 'notify_type_prefs_json' not in cols:
            ddl = 'ALTER TABLE users ADD COLUMN notify_type_prefs_json TEXT'
            db.session.execute(text(ddl))
            db.session.commit()
            cols.add('notify_type_prefs_json')
            current_app.logger.info(
                'Esquema: columna notify_type_prefs_json añadida a users (%s)',
                dialect,
            )
    except Exception as exc:
        db.session.rollback()
        logger.warning('ensure_store_notify_prefs_columns: %s', exc)


def _billing_user(user: User | None) -> User | None:
    if not user:
        return None
    try:
        from app.store.routes import _billing_user_for_store_debt_limit

        return _billing_user_for_store_debt_limit(user) or user
    except Exception:
        return user


def _flag(user: User | None, attr: str, default: bool = True) -> bool:
    if not user:
        return False
    if not hasattr(user, attr):
        return default
    raw = getattr(user, attr, default)
    if raw is None:
        return default
    return bool(raw)


def _parse_type_prefs(raw: Any) -> dict[str, bool]:
    out = dict(ADMIN_NOTIFY_TYPE_DEFAULTS)
    if raw is None or raw == '':
        return out
    try:
        if isinstance(raw, dict):
            data = raw
        else:
            data = json.loads(str(raw))
        if not isinstance(data, dict):
            return out
        for key in ADMIN_NOTIFY_TYPE_DEFAULTS:
            if key in data:
                out[key] = bool(data.get(key))
    except Exception:
        pass
    return out


def get_notify_type_prefs(user: User | None) -> dict[str, bool]:
    ensure_store_notify_prefs_columns()
    billing = _billing_user(user) or user
    if not billing:
        return dict(ADMIN_NOTIFY_TYPE_DEFAULTS)
    return _parse_type_prefs(getattr(billing, 'notify_type_prefs_json', None))


def user_wants_admin_notify_type(user: User | None, type_key: str) -> bool:
    """True si el usuario admin/soporte quiere ese tipo de aviso (default ON)."""
    key = str(type_key or '').strip()
    if not key:
        return True
    prefs = get_notify_type_prefs(user)
    if key not in prefs:
        return True
    return bool(prefs.get(key))


def user_wants_admin_notify_kind(user: User | None, kind: str) -> bool:
    type_key = KIND_TO_ADMIN_TYPE.get(str(kind or '').strip())
    if not type_key:
        return True
    return user_wants_admin_notify_type(user, type_key)


def user_email_notify_enabled_flag(user: User | None) -> bool:
    return _flag(user, 'email_notify_enabled', True)


def user_receives_email_notifications(user: User | None) -> bool:
    return user_email_notify_enabled_flag(_billing_user(user))


def user_receives_push_notifications(user: User | None) -> bool:
    return _flag(_billing_user(user), 'push_notify_enabled', True)


def user_receives_inapp_notifications(user: User | None) -> bool:
    return _flag(_billing_user(user), 'inapp_notify_enabled', True)


def get_store_notify_prefs(user: User | None) -> dict[str, Any]:
    ensure_store_notify_prefs_columns()
    billing = _billing_user(user)
    types = get_notify_type_prefs(billing or user)
    if not billing:
        return {
            'email_notify_enabled': True,
            'push_notify_enabled': True,
            'inapp_notify_enabled': True,
            'notify_vibrate_enabled': False,
            'notify_sound_enabled': False,
            'caducidad_notify_enabled': False,
            'caducidad_notify_from_days': 5,
            'whatsapp_admin_only': True,
            'notify_types': types,
        }
    try:
        from_days = int(getattr(billing, 'caducidad_notify_from_days', 5) or 5)
    except (TypeError, ValueError):
        from_days = 5
    if from_days < 1:
        from_days = 1
    if from_days > 5:
        from_days = 5
    return {
        'email_notify_enabled': user_email_notify_enabled_flag(billing),
        'push_notify_enabled': _flag(billing, 'push_notify_enabled', True),
        'inapp_notify_enabled': _flag(billing, 'inapp_notify_enabled', True),
        'notify_vibrate_enabled': _flag(billing, 'notify_vibrate_enabled', False),
        'notify_sound_enabled': _flag(billing, 'notify_sound_enabled', False),
        'caducidad_notify_enabled': _flag(billing, 'caducidad_notify_enabled', False),
        'caducidad_notify_from_days': from_days,
        'whatsapp_admin_only': True,
        'notify_types': types,
        'user_id': int(billing.id),
    }


def set_store_notify_prefs(user: User | None, data: dict[str, Any]) -> tuple[bool, str, dict[str, Any]]:
    """Actualiza prefs en la cuenta de facturación. Retorna (ok, error, prefs)."""
    ensure_store_notify_prefs_columns()
    billing = _billing_user(user)
    if not billing:
        return False, 'Usuario no encontrado.', {}

    if 'email_notify_enabled' in data:
        billing.email_notify_enabled = bool(data.get('email_notify_enabled'))
    if 'push_notify_enabled' in data:
        billing.push_notify_enabled = bool(data.get('push_notify_enabled'))
    if 'inapp_notify_enabled' in data:
        billing.inapp_notify_enabled = bool(data.get('inapp_notify_enabled'))
    if 'notify_vibrate_enabled' in data:
        billing.notify_vibrate_enabled = bool(data.get('notify_vibrate_enabled'))
    if 'notify_sound_enabled' in data:
        billing.notify_sound_enabled = bool(data.get('notify_sound_enabled'))
    if 'caducidad_notify_enabled' in data:
        billing.caducidad_notify_enabled = bool(data.get('caducidad_notify_enabled'))
    if 'caducidad_notify_from_days' in data:
        try:
            fd = int(data.get('caducidad_notify_from_days') or 5)
        except (TypeError, ValueError):
            fd = 5
        billing.caducidad_notify_from_days = max(1, min(5, fd))

    if 'notify_types' in data and isinstance(data.get('notify_types'), dict):
        merged = get_notify_type_prefs(billing)
        incoming = data.get('notify_types') or {}
        for key in ADMIN_NOTIFY_TYPE_DEFAULTS:
            if key in incoming:
                merged[key] = bool(incoming.get(key))
        billing.notify_type_prefs_json = json.dumps(merged, ensure_ascii=False)
    else:
        patched = False
        merged = get_notify_type_prefs(billing)
        for key in ADMIN_NOTIFY_TYPE_DEFAULTS:
            flat = f'type_{key}'
            if flat in data:
                merged[key] = bool(data.get(flat))
                patched = True
        if patched:
            billing.notify_type_prefs_json = json.dumps(merged, ensure_ascii=False)

    db.session.add(billing)
    try:
        db.session.commit()
    except Exception as ex:
        db.session.rollback()
        logger.warning('set_store_notify_prefs: %s', ex)
        return False, 'No se pudo guardar.', {}

    return True, '', get_store_notify_prefs(billing)
