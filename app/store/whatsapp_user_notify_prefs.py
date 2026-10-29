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
            _ensure_user_telegram_chat_id_column()
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
        _ensure_user_telegram_chat_id_column()
    except Exception as exc:
        db.session.rollback()
        logger.warning('ensure_user_whatsapp_notify_enabled_column: %s', exc)
        _ensure_user_telegram_chat_id_column()


def _ensure_user_telegram_chat_id_column() -> None:
    try:
        insp = inspect(db.engine)
        if not insp.has_table('users'):
            return
        cols = {c['name'].lower() for c in insp.get_columns('users')}
        if 'telegram_chat_id' not in cols:
            db.session.execute(text('ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(255)'))
            db.session.commit()
            cols.add('telegram_chat_id')
        else:
            col = next(
                (c for c in insp.get_columns('users') if str(c.get('name') or '').lower() == 'telegram_chat_id'),
                None,
            )
            length = getattr(col.get('type'), 'length', None) if col else None
            if length is not None and int(length) < 255:
                try:
                    dialect = getattr(db.engine.dialect, 'name', '') or ''
                    if dialect == 'postgresql':
                        db.session.execute(text(
                            'ALTER TABLE users ALTER COLUMN telegram_chat_id TYPE VARCHAR(255)'
                        ))
                    else:
                        db.session.execute(text(
                            'ALTER TABLE users ALTER COLUMN telegram_chat_id VARCHAR(255)'
                        ))
                    db.session.commit()
                except Exception as widen_exc:
                    db.session.rollback()
                    logger.warning('widen telegram_chat_id: %s', widen_exc)
        if 'telegram_notify_enabled' not in cols:
            dialect = getattr(db.engine.dialect, 'name', '') or ''
            if dialect == 'postgresql':
                notify_sql = (
                    'ALTER TABLE users ADD COLUMN telegram_notify_enabled '
                    'BOOLEAN NOT NULL DEFAULT FALSE'
                )
            else:
                notify_sql = (
                    'ALTER TABLE users ADD COLUMN telegram_notify_enabled '
                    'INTEGER NOT NULL DEFAULT 0'
                )
            db.session.execute(text(notify_sql))
            db.session.commit()
            cols.add('telegram_notify_enabled')
        if 'can_use_telegram_bot' not in cols:
            dialect = getattr(db.engine.dialect, 'name', '') or ''
            if dialect == 'postgresql':
                bot_sql = (
                    'ALTER TABLE users ADD COLUMN can_use_telegram_bot '
                    'BOOLEAN NOT NULL DEFAULT FALSE'
                )
            else:
                bot_sql = (
                    'ALTER TABLE users ADD COLUMN can_use_telegram_bot '
                    'INTEGER NOT NULL DEFAULT 0'
                )
            db.session.execute(text(bot_sql))
            db.session.commit()
            cols.add('can_use_telegram_bot')
        if 'telegram_bot_menu_buttons' not in cols:
            db.session.execute(
                text('ALTER TABLE users ADD COLUMN telegram_bot_menu_buttons TEXT')
            )
            db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.warning('ensure telegram_chat_id: %s', exc)


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


def user_telegram_notify_enabled_flag(user: User | None) -> bool:
    if not user:
        return False
    return bool(getattr(user, 'telegram_notify_enabled', False))


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
                'telegram_chat_id': (getattr(u, 'telegram_chat_id', None) or '').strip(),
                'telegram_notify_enabled': user_telegram_notify_enabled_flag(u),
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


def set_user_telegram_notify_enabled(user_id: int, enabled: bool, admin_username: str) -> tuple[bool, str]:
    from app.store.routes import _is_principal_store_license_saldo_client

    ensure_user_whatsapp_notify_enabled_column()
    user = User.query.get(int(user_id))
    if not user:
        return False, 'Usuario no encontrado.'
    if is_store_subuser(user):
        return False, 'Los sub-usuarios no pueden recibir Telegram.'
    if not _is_principal_store_license_saldo_client(user, admin_username):
        return False, 'Usuario no permitido.'
    user.telegram_notify_enabled = bool(enabled)
    db.session.commit()
    try:
        from app.store.drive_telegram_send import sync_store_user_telegram_groups
        sync_store_user_telegram_groups(user)
    except Exception:
        logger.warning('No se pudo actualizar el acceso al grupo de Telegram')
    return True, ''


def _phone_digits(raw: str | None) -> str:
    return ''.join(ch for ch in (raw or '') if ch.isdigit())


def _phone_taken_by(digits: str, exclude_user_id=None):
    """Usuario o sub-usuario que ya usa esos dígitos. None si está libre."""
    if not digits:
        return None
    rows = User.query.filter(User.phone.isnot(None), User.phone != '').all()
    for row in rows:
        if exclude_user_id is not None and int(row.id) == int(exclude_user_id):
            continue
        if _phone_digits(row.phone) == digits:
            return row
    return None


def _phone_in_use_message(owner, digits: str) -> str:
    name = (getattr(owner, 'username', None) or '').strip() or 'otro'
    if getattr(owner, 'parent_id', None):
        parent = getattr(owner, 'parent', None)
        parent_name = (getattr(parent, 'username', None) or '').strip() or 'desconocido'
        return (
            f'El sub-usuario {name} del padre usuario {parent_name} '
            f'ya tiene el teléfono {digits}.'
        )
    return f'El usuario {name} ya tiene el teléfono {digits}.'


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
        taken = _phone_taken_by(digits, exclude_user_id=user.id)
        if taken:
            return False, _phone_in_use_message(taken, digits), ''

    user.phone = raw
    db.session.commit()
    return True, '', raw


def set_user_telegram_chat_id(user_id: int, chat_id: str | None, admin_username: str) -> tuple[bool, str, str]:
    from app.store.routes import _is_principal_store_license_saldo_client
    from app.store.telegram_bot_service import chat_id_taken_by, parse_chat_id_list, telegram_id_in_use_message

    ensure_user_whatsapp_notify_enabled_column()
    user = User.query.get(int(user_id))
    if not user:
        return False, 'Usuario no encontrado.', ''
    if is_store_subuser(user):
        return False, 'Los sub-usuarios no pueden recibir Telegram.', ''
    if not _is_principal_store_license_saldo_client(user, admin_username):
        return False, 'Usuario no permitido.', ''

    previous_chat_id = (getattr(user, 'telegram_chat_id', None) or '').strip()
    raw = (chat_id or '').strip()
    if raw:
        ids, err = parse_chat_id_list(raw)
        if err:
            return False, err, ''
        for one in ids:
            taken = chat_id_taken_by(one, exclude_user_id=user.id)
            if taken:
                return False, telegram_id_in_use_message(taken, one), ''
        raw = ','.join(ids)
    user.telegram_chat_id = raw or None
    db.session.commit()
    try:
        from app.store.drive_telegram_send import sync_store_user_telegram_groups
        sync_store_user_telegram_groups(user, previous_chat_id=previous_chat_id)
    except Exception:
        logger.warning('No se pudo actualizar el acceso al grupo de Telegram')
    return True, '', raw
