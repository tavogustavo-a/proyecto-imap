# -*- coding: utf-8 -*-
"""Preferencias por usuario: quién recibe avisos y resúmenes WhatsApp (solo cuentas principales)."""
from __future__ import annotations

import logging

from sqlalchemy import inspect, text

from app.extensions import db
from app.models.user import User

logger = logging.getLogger(__name__)


def ensure_user_whatsapp_notify_enabled_column() -> None:
    try:
        insp = inspect(db.engine)
        if not insp.has_table('users'):
            return
        cols = {c['name'].lower() for c in insp.get_columns('users')}
        if 'whatsapp_notify_enabled' in cols:
            return
        dialect = getattr(db.engine.dialect, 'name', '') or ''
        if dialect == 'postgresql':
            ddl = (
                'ALTER TABLE users ADD COLUMN whatsapp_notify_enabled '
                'BOOLEAN NOT NULL DEFAULT TRUE'
            )
        else:
            ddl = (
                'ALTER TABLE users ADD COLUMN whatsapp_notify_enabled '
                'INTEGER NOT NULL DEFAULT 1'
            )
        db.session.execute(text(ddl))
        db.session.commit()
        try:
            db.session.execute(
                text(
                    'UPDATE users SET whatsapp_notify_enabled = 1 '
                    'WHERE parent_id IS NULL'
                )
            )
            db.session.commit()
        except Exception as backfill_exc:
            db.session.rollback()
            logger.warning('whatsapp_notify_enabled backfill: %s', backfill_exc)
    except Exception as exc:
        db.session.rollback()
        logger.warning('ensure_user_whatsapp_notify_enabled_column: %s', exc)


def is_store_subuser(user: User | None) -> bool:
    if not user:
        return False
    parent_id = getattr(user, 'parent_id', None)
    return parent_id is not None and int(parent_id) != int(user.id)


def user_whatsapp_notify_enabled_flag(user: User | None) -> bool:
    if not user:
        return False
    raw = getattr(user, 'whatsapp_notify_enabled', True)
    if raw is None:
        return True
    return bool(raw)


def user_receives_whatsapp_notifications(user: User | None) -> bool:
    """Sub-usuarios nunca reciben WhatsApp; principales según checkbox (predeterminado: sí)."""
    if not user or not getattr(user, 'enabled', True):
        return False
    if is_store_subuser(user):
        return False
    return user_whatsapp_notify_enabled_flag(user)


def list_whatsapp_notify_pref_users(admin_username: str) -> list[dict]:
    """Usuarios principales visibles en Configuraciones → WhatsApp (sin sub-usuarios)."""
    from app.store.routes import _is_principal_store_license_saldo_client

    ensure_user_whatsapp_notify_enabled_column()
    rows = User.query.filter(User.parent_id.is_(None)).order_by(User.username.asc()).all()
    out: list[dict] = []
    for u in rows:
        if not _is_principal_store_license_saldo_client(u, admin_username):
            continue
        out.append(
            {
                'id': int(u.id),
                'username': u.username or '',
                'full_name': (getattr(u, 'full_name', None) or '').strip(),
                'phone': (getattr(u, 'phone', None) or '').strip(),
                'whatsapp_notify_enabled': user_whatsapp_notify_enabled_flag(u),
            }
        )
    return out


def set_user_whatsapp_notify_enabled(user_id: int, enabled: bool, admin_username: str) -> tuple[bool, str]:
    from app.store.routes import _is_principal_store_license_saldo_client

    ensure_user_whatsapp_notify_enabled_column()
    user = User.query.get(int(user_id))
    if not user:
        return False, 'Usuario no encontrado.'
    if is_store_subuser(user):
        return False, 'Los sub-usuarios no pueden recibir WhatsApp.'
    if not _is_principal_store_license_saldo_client(user, admin_username):
        return False, 'Usuario no permitido.'
    user.whatsapp_notify_enabled = bool(enabled)
    db.session.commit()
    return True, ''


def set_user_whatsapp_phone(user_id: int, phone: str | None, admin_username: str) -> tuple[bool, str, str]:
    from app.store.routes import _is_principal_store_license_saldo_client

    ensure_user_whatsapp_notify_enabled_column()
    user = User.query.get(int(user_id))
    if not user:
        return False, 'Usuario no encontrado.', ''
    if is_store_subuser(user):
        return False, 'Los sub-usuarios no pueden recibir WhatsApp.', ''
    if not _is_principal_store_license_saldo_client(user, admin_username):
        return False, 'Usuario no permitido.', ''

    raw = (phone or '').strip()
    if len(raw) > 30:
        return False, 'El teléfono es demasiado largo.', ''
    if raw:
        digits = ''.join(ch for ch in raw if ch.isdigit())
        if len(digits) < 10:
            return False, 'Indica un teléfono válido (mínimo 10 dígitos).', ''

    user.phone = raw
    db.session.commit()
    return True, '', raw
