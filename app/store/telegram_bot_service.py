# -*- coding: utf-8 -*-
"""Bot de Telegram: guarda nombre y token y comprueba que coincidan con getMe."""

from __future__ import annotations

import logging
import re
import threading
from datetime import datetime

import requests
from flask import current_app
from sqlalchemy import inspect, text

from app.extensions import db
from app.store.models import TelegramBotConfig

logger = logging.getLogger(__name__)

_BTN_ID = 'Saber tu ID de tu usuario'
_BTN_ID_PREVIOUS = 'Saber el ID de tu cuenta'
_BTN_PRICES = 'Lista de precios'
_BTN_CODES = 'Qué hace cada botón de códigos'
_BTN_AD = 'Link de publicidad'
_MENU_TEXT_LIMIT = 4000

_schema_ready = False
_detail_lock = threading.Lock()
_detail_seen = set()
_updates_lock = threading.Lock()
_USERNAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]{3,31}$')
_CHAT_ID_RE = re.compile(r'^-?\d{5,20}$')


def _ensure_telegram_update_offset_column() -> None:
    try:
        insp = inspect(db.engine)
        cols = {c['name'] for c in insp.get_columns('telegram_bot_configs')}
        if 'update_offset' in cols:
            return
        db.session.execute(text('ALTER TABLE telegram_bot_configs ADD COLUMN update_offset BIGINT'))
        db.session.commit()
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        try:
            current_app.logger.warning('ensure telegram update_offset: %s', exc)
        except Exception:
            pass


def _ensure_telegram_bot_enabled_column() -> None:
    try:
        insp = inspect(db.engine)
        cols = {c['name'] for c in insp.get_columns('telegram_bot_configs')}
        if 'is_enabled' in cols:
            return
        db.session.execute(
            text(
                'ALTER TABLE telegram_bot_configs ADD COLUMN is_enabled '
                'INTEGER NOT NULL DEFAULT 0'
            )
        )
        db.session.commit()
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        try:
            current_app.logger.warning('ensure telegram is_enabled: %s', exc)
        except Exception:
            pass


def ensure_telegram_bot_schema() -> bool:
    """Crea telegram_bot_configs si falta. No usa db.create_all."""
    global _schema_ready
    if _schema_ready:
        return True
    try:
        insp = inspect(db.engine)
        if 'telegram_bot_configs' in set(insp.get_table_names()):
            _ensure_telegram_bot_enabled_column()
            _ensure_telegram_update_offset_column()
            _ensure_telegram_known_chats_table()
            _schema_ready = True
            return True
        dialect = getattr(db.engine.dialect, 'name', '') or ''
        if dialect == 'postgresql':
            ddl = """
                CREATE TABLE IF NOT EXISTS telegram_bot_configs (
                    id SERIAL PRIMARY KEY,
                    bot_username VARCHAR(64) NOT NULL DEFAULT '',
                    bot_token VARCHAR(255) NOT NULL DEFAULT '',
                    is_enabled INTEGER NOT NULL DEFAULT 0,
                    connection_status VARCHAR(40),
                    last_health_at TIMESTAMP WITHOUT TIME ZONE,
                    last_health_error TEXT,
                    updated_at TIMESTAMP WITHOUT TIME ZONE
                )
            """
        else:
            ddl = """
                CREATE TABLE IF NOT EXISTS telegram_bot_configs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bot_username VARCHAR(64) NOT NULL DEFAULT '',
                    bot_token VARCHAR(255) NOT NULL DEFAULT '',
                    is_enabled INTEGER NOT NULL DEFAULT 0,
                    connection_status VARCHAR(40),
                    last_health_at DATETIME,
                    last_health_error TEXT,
                    updated_at DATETIME
                )
            """
        with db.engine.begin() as conn:
            conn.execute(text(ddl))
        _ensure_telegram_known_chats_table()
        _schema_ready = True
        return True
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        try:
            current_app.logger.warning('ensure_telegram_bot_schema: %s', exc)
        except Exception:
            pass
        return False


def _ensure_telegram_known_chat_forum_column() -> None:
    try:
        insp = inspect(db.engine)
        if 'telegram_known_chats' not in set(insp.get_table_names()):
            return
        cols = {column['name'] for column in insp.get_columns('telegram_known_chats')}
        if 'is_forum' in cols:
            return
        db.session.execute(text('ALTER TABLE telegram_known_chats ADD COLUMN is_forum INTEGER'))
        db.session.commit()
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        try:
            current_app.logger.warning('ensure telegram is_forum: %s', exc)
        except Exception:
            pass


def _ensure_telegram_known_chats_table() -> None:
    """Guarda los grupos y canales que el bot fue conociendo. No usa db.create_all."""
    try:
        insp = inspect(db.engine)
        if 'telegram_known_chats' in set(insp.get_table_names()):
            _ensure_telegram_known_chat_forum_column()
            return
        dialect = getattr(db.engine.dialect, 'name', '') or ''
        if dialect == 'postgresql':
            ddl = """
                CREATE TABLE IF NOT EXISTS telegram_known_chats (
                    id SERIAL PRIMARY KEY,
                    chat_id VARCHAR(32) NOT NULL,
                    topic_id VARCHAR(32) NOT NULL DEFAULT '',
                    title VARCHAR(255) NOT NULL DEFAULT '',
                    chat_type VARCHAR(32) NOT NULL DEFAULT '',
                    member_count INTEGER,
                    linked_chat_id VARCHAR(32) NOT NULL DEFAULT '',
                    removed INTEGER NOT NULL DEFAULT 0,
                    is_forum INTEGER,
                    updated_at TIMESTAMP WITHOUT TIME ZONE,
                    UNIQUE (chat_id, topic_id)
                )
            """
        else:
            ddl = """
                CREATE TABLE IF NOT EXISTS telegram_known_chats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id VARCHAR(32) NOT NULL,
                    topic_id VARCHAR(32) NOT NULL DEFAULT '',
                    title VARCHAR(255) NOT NULL DEFAULT '',
                    chat_type VARCHAR(32) NOT NULL DEFAULT '',
                    member_count INTEGER,
                    linked_chat_id VARCHAR(32) NOT NULL DEFAULT '',
                    removed INTEGER NOT NULL DEFAULT 0,
                    is_forum INTEGER,
                    updated_at DATETIME,
                    UNIQUE (chat_id, topic_id)
                )
            """
        with db.engine.begin() as conn:
            conn.execute(text(ddl))
        _ensure_telegram_known_chat_forum_column()
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        try:
            current_app.logger.warning('ensure telegram known chats: %s', exc)
        except Exception:
            pass


def _chat_id_text(raw) -> str:
    if raw is None or isinstance(raw, bool):
        return ''
    text_id = str(raw).strip()
    if not _CHAT_ID_RE.match(text_id):
        return ''
    return text_id


def _topic_id_text(raw) -> str:
    text_id = str(raw or '').strip()
    if not text_id.isdigit():
        return ''
    return text_id


def _known_chat_rows() -> list[dict]:
    result = db.session.execute(
        text(
            'SELECT chat_id, topic_id, title, chat_type, member_count, linked_chat_id, removed, is_forum '
            'FROM telegram_known_chats'
        )
    )
    rows = []
    for item in result:
        rows.append({
            'chat_id': str(item[0] or ''),
            'topic_id': str(item[1] or ''),
            'title': str(item[2] or ''),
            'chat_type': str(item[3] or ''),
            'member_count': item[4] if isinstance(item[4], int) else None,
            'linked_chat_id': str(item[5] or ''),
            'removed': int(item[6] or 0),
            'is_forum': None if item[7] is None else int(item[7]),
        })
    return rows


def _upsert_known_chat(chat_id: str, topic_id: str = '', title: str = '', chat_type: str = '', member_count: int | None = None, linked_chat_id: str = '') -> None:
    chat_id = _chat_id_text(chat_id)
    topic_id = _topic_id_text(topic_id) if topic_id else ''
    if not chat_id:
        return
    title = str(title or '').strip()[:255]
    chat_type = str(chat_type or '').strip()[:32]
    linked_chat_id = _chat_id_text(linked_chat_id) if linked_chat_id else ''
    now = datetime.utcnow()
    found = db.session.execute(
        text(
            'SELECT title, chat_type, linked_chat_id FROM telegram_known_chats '
            'WHERE chat_id = :chat_id AND topic_id = :topic_id'
        ),
        {'chat_id': chat_id, 'topic_id': topic_id},
    ).first()
    if found:
        db.session.execute(
            text(
                'UPDATE telegram_known_chats SET '
                'title = :title, chat_type = :chat_type, '
                'member_count = COALESCE(:member_count, member_count), '
                'linked_chat_id = :linked_chat_id, removed = 0, updated_at = :updated_at '
                'WHERE chat_id = :chat_id AND topic_id = :topic_id'
            ),
            {
                'chat_id': chat_id,
                'topic_id': topic_id,
                'title': title or str(found[0] or ''),
                'chat_type': chat_type or str(found[1] or ''),
                'member_count': member_count,
                'linked_chat_id': linked_chat_id or str(found[2] or ''),
                'updated_at': now,
            },
        )
        return
    if topic_id == '1' and not title:
        title = 'General'
    db.session.execute(
        text(
            'INSERT INTO telegram_known_chats '
            '(chat_id, topic_id, title, chat_type, member_count, linked_chat_id, removed, updated_at) '
            'VALUES (:chat_id, :topic_id, :title, :chat_type, :member_count, :linked_chat_id, 0, :updated_at)'
        ),
        {
            'chat_id': chat_id,
            'topic_id': topic_id,
            'title': title,
            'chat_type': chat_type or ('topic' if topic_id else ''),
            'member_count': member_count,
            'linked_chat_id': linked_chat_id,
            'updated_at': now,
        },
    )


def _mark_known_chat_removed(chat_id: str) -> None:
    chat_id = _chat_id_text(chat_id)
    if not chat_id:
        return
    db.session.execute(
        text(
            'UPDATE telegram_known_chats SET removed = 1, updated_at = :updated_at '
            'WHERE chat_id = :chat_id'
        ),
        {'chat_id': chat_id, 'updated_at': datetime.utcnow()},
    )


def _capture_message_chat(message: dict) -> None:
    chat = message.get('chat') if isinstance(message.get('chat'), dict) else {}
    chat_type = str(chat.get('type') or '')
    if chat_type not in ('group', 'supergroup', 'channel'):
        return
    title = chat.get('title') or chat.get('username') or ''
    _upsert_known_chat(chat.get('id'), title=title, chat_type=chat_type)
    _schedule_chat_details(chat.get('id'))
    created = message.get('forum_topic_created') if isinstance(message.get('forum_topic_created'), dict) else {}
    edited = message.get('forum_topic_edited') if isinstance(message.get('forum_topic_edited'), dict) else {}
    topic_id = _topic_id_text(message.get('message_thread_id'))
    reply = message.get('reply_to_message') if isinstance(message.get('reply_to_message'), dict) else {}
    reply_created = reply.get('forum_topic_created') if isinstance(reply.get('forum_topic_created'), dict) else {}
    if not topic_id and reply_created:
        topic_id = _topic_id_text(reply.get('message_id'))
    if not topic_id:
        return
    topic_title = str(created.get('name') or edited.get('name') or reply_created.get('name') or '').strip()
    if topic_id == '1' and not topic_title:
        topic_title = 'General'
    _upsert_known_chat(chat.get('id'), topic_id=topic_id, title=topic_title, chat_type='topic')


def capture_telegram_update_chat(update: dict) -> bool:
    """Anota el grupo, canal o tema que vino en un aviso del bot."""
    try:
        ensure_telegram_bot_schema()
        member = update.get('my_chat_member') if isinstance(update.get('my_chat_member'), dict) else None
        if member:
            chat = member.get('chat') if isinstance(member.get('chat'), dict) else {}
            new_member = member.get('new_chat_member') if isinstance(member.get('new_chat_member'), dict) else {}
            status = str(new_member.get('status') or '')
            if status in ('left', 'kicked'):
                _mark_known_chat_removed(chat.get('id'))
                return True
            if status in ('member', 'administrator', 'creator', 'restricted'):
                _upsert_known_chat(
                    chat.get('id'),
                    title=chat.get('title') or chat.get('username') or '',
                    chat_type=str(chat.get('type') or ''),
                )
                _schedule_chat_details(chat.get('id'))
            return True
        for key in ('message', 'edited_message', 'channel_post', 'edited_channel_post'):
            message = update.get(key)
            if isinstance(message, dict):
                _capture_message_chat(message)
                return True
        return True
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass
        try:
            current_app.logger.warning('No se pudo anotar el grupo de Telegram')
        except Exception:
            pass
        return False


def _refresh_known_chat(token: str, row: dict) -> None:
    result = _telegram_call(token, 'getChat', {'chat_id': row['chat_id']}, timeout=4)
    if not result.get('ok'):
        if 'kicked' in str(result.get('description') or '').lower():
            _mark_known_chat_removed(row['chat_id'])
        return
    chat = result.get('result') if isinstance(result.get('result'), dict) else {}
    count_result = _telegram_call(token, 'getChatMemberCount', {'chat_id': row['chat_id']}, timeout=4)
    member_count = count_result.get('result') if count_result.get('ok') and isinstance(count_result.get('result'), int) else None
    linked = _chat_id_text(chat.get('linked_chat_id'))
    _upsert_known_chat(
        row['chat_id'],
        title=chat.get('title') or chat.get('username') or row.get('title') or '',
        chat_type=str(chat.get('type') or row.get('chat_type') or ''),
        member_count=member_count,
        linked_chat_id=linked,
    )
    _set_chat_forum(row['chat_id'], 1 if chat.get('is_forum') else 0)
    if not linked or linked == row['chat_id']:
        return
    linked_info = _telegram_call(token, 'getChat', {'chat_id': linked}, timeout=4)
    if linked_info.get('ok') and isinstance(linked_info.get('result'), dict):
        linked_chat = linked_info['result']
        linked_count = _telegram_call(token, 'getChatMemberCount', {'chat_id': linked}, timeout=4)
        _upsert_known_chat(
            linked,
            title=linked_chat.get('title') or linked_chat.get('username') or '',
            chat_type=str(linked_chat.get('type') or ''),
            member_count=linked_count.get('result') if linked_count.get('ok') and isinstance(linked_count.get('result'), int) else None,
            linked_chat_id=row['chat_id'],
        )
        return
    _upsert_known_chat(linked, title='Canal o grupo vinculado', chat_type='channel', linked_chat_id=row['chat_id'])


def _schedule_chat_details(chat_id) -> None:
    """Completa miembros y canal vinculado sin frenar el botón Extraer grupos."""
    chat_id = _chat_id_text(chat_id)
    if not chat_id:
        return
    with _detail_lock:
        if chat_id in _detail_seen:
            return
        _detail_seen.add(chat_id)
    app = current_app._get_current_object()

    def work():
        with app.app_context():
            try:
                token = _saved_bot_token()
                if token:
                    _refresh_known_chat(token, {'chat_id': chat_id, 'title': '', 'chat_type': ''})
                    db.session.commit()
            except Exception:
                try:
                    db.session.rollback()
                except Exception:
                    pass

    threading.Thread(target=work, daemon=True, name='tg-chat-detail').start()


def _set_chat_forum(chat_id: str, is_forum: int) -> None:
    chat_id = _chat_id_text(chat_id)
    if not chat_id:
        return
    db.session.execute(
        text(
            'UPDATE telegram_known_chats SET is_forum = :is_forum '
            'WHERE chat_id = :chat_id AND topic_id = \'\''
        ),
        {'chat_id': chat_id, 'is_forum': int(is_forum)},
    )


def _remember_forum_flags(token: str) -> None:
    """Marca los grupos que tienen temas. Solo consulta los que todavía no se saben."""
    pending = [
        row for row in _known_chat_rows()
        if not row['topic_id'] and not row['removed'] and row.get('is_forum') is None
    ]
    if not pending or not token:
        return
    from concurrent.futures import ThreadPoolExecutor

    def probe(chat_id: str):
        result = _telegram_call(token, 'getChat', {'chat_id': chat_id}, timeout=4)
        chat = result.get('result') if result.get('ok') and isinstance(result.get('result'), dict) else None
        if chat is None:
            return chat_id, None
        return chat_id, 1 if chat.get('is_forum') else 0

    with ThreadPoolExecutor(max_workers=4) as pool:
        flags = list(pool.map(lambda row: probe(row['chat_id']), pending))
    for chat_id, flag in flags:
        if flag is not None:
            _set_chat_forum(chat_id, flag)
    db.session.commit()


def list_bot_group_catalog() -> dict:
    """Devuelve grupos y canales del bot, con el canal vinculado y los temas vistos."""
    ensure_telegram_bot_schema()
    token = _saved_bot_token()
    if not token:
        return {
            'success': False,
            'groups': [],
            'message': 'Guardá el nombre y el token del bot para ver los grupos.',
        }
    _remember_forum_flags(token)
    rows = [row for row in _known_chat_rows() if not row['removed']]
    by_id = {row['chat_id']: row for row in rows if not row['topic_id']}

    def topics_for(chat_id: str) -> list[dict]:
        return [
            {
                'topic_id': topic['topic_id'],
                'title': topic['title'] or ('General' if topic['topic_id'] == '1' else f"Tema {topic['topic_id']}"),
                'chat_id': chat_id,
            }
            for topic in rows
            if topic['topic_id'] and topic['chat_id'] == chat_id
        ]

    child_of = {}
    for row in by_id.values():
        linked = row.get('linked_chat_id') or ''
        if not linked or linked not in by_id or linked == row['chat_id']:
            continue
        other = by_id[linked]
        if row.get('chat_type') == 'channel' and other.get('chat_type') != 'channel':
            parent, child = other, row
        else:
            parent, child = row, other
        if child['chat_id'] in child_of or child_of.get(parent['chat_id']) == child['chat_id']:
            continue
        child_of[child['chat_id']] = parent['chat_id']

    groups = []
    ordered = sorted(
        by_id.values(),
        key=lambda row: (1 if row.get('chat_type') == 'channel' else 0, (row.get('title') or '').lower()),
    )
    for row in ordered:
        if row['chat_id'] in child_of:
            continue
        linked_row = None
        for child_id, parent_id in child_of.items():
            if parent_id == row['chat_id']:
                linked_row = by_id.get(child_id)
                break
        linked_payload = None
        if linked_row:
            linked_payload = {
                'chat_id': linked_row['chat_id'],
                'title': linked_row['title'] or 'Sin nombre',
                'chat_type': linked_row['chat_type'] or 'channel',
                'member_count': linked_row['member_count'],
                'is_forum': bool(linked_row.get('is_forum')),
                'topics': topics_for(linked_row['chat_id']),
            }
        topics = topics_for(row['chat_id'])
        groups.append({
            'chat_id': row['chat_id'],
            'title': row['title'] or 'Sin nombre',
            'chat_type': row['chat_type'] or 'group',
            'member_count': row['member_count'],
            'is_forum': bool(row.get('is_forum')),
            'linked': linked_payload,
            'topics': topics,
        })
    return {'success': True, 'groups': groups[:50], 'message': ''}


def normalize_bot_username(raw: str | None) -> str:
    name = (raw or '').strip()
    if name.startswith('@'):
        name = name[1:].strip()
    return name


def usernames_match(left: str | None, right: str | None) -> bool:
    a = normalize_bot_username(left).lower()
    b = normalize_bot_username(right).lower()
    return bool(a) and a == b


def get_telegram_bot_config() -> TelegramBotConfig | None:
    ensure_telegram_bot_schema()
    return TelegramBotConfig.query.order_by(TelegramBotConfig.id.asc()).first()


def _get_or_create() -> TelegramBotConfig:
    row = get_telegram_bot_config()
    if row:
        return row
    row = TelegramBotConfig(
        bot_username='',
        bot_token='',
        connection_status='disconnected',
    )
    db.session.add(row)
    db.session.flush()
    return row


def telegram_get_me(token: str) -> dict:
    """Consulta getMe. No registra el token ni la URL."""
    clean = (token or '').strip()
    if not clean or any(ch.isspace() for ch in clean) or len(clean) > 200:
        return {'ok': False, 'error': 'El token no es válido.'}
    try:
        response = requests.get(
            f'https://api.telegram.org/bot{clean}/getMe',
            timeout=12,
        )
        data = response.json()
    except Exception:
        return {'ok': False, 'error': 'No se pudo consultar Telegram.'}
    if not isinstance(data, dict) or not data.get('ok'):
        return {'ok': False, 'error': 'Telegram no reconoce el token.'}
    result = data.get('result') if isinstance(data.get('result'), dict) else {}
    username = str((result or {}).get('username') or '').strip()
    if not username:
        return {'ok': False, 'error': 'Telegram no devolvió el nombre del bot.'}
    return {'ok': True, 'username': username}


def check_bot_credentials(username: str | None, token: str | None) -> dict:
    name = normalize_bot_username(username)
    clean_token = (token or '').strip()
    if not name or not clean_token:
        return {
            'connected': False,
            'message': 'Falta el nombre o el token.',
            'telegram_username': '',
        }
    if not _USERNAME_RE.match(name):
        return {
            'connected': False,
            'message': 'El nombre del bot no es válido. Usá el usuario que da BotFather, sin espacios.',
            'telegram_username': '',
        }
    me = telegram_get_me(clean_token)
    if not me.get('ok'):
        return {
            'connected': False,
            'message': me.get('error') or 'Telegram no reconoce el token.',
            'telegram_username': '',
        }
    telegram_name = str(me.get('username') or '')
    if not usernames_match(name, telegram_name):
        return {
            'connected': False,
            'message': f'El token pertenece a @{telegram_name}. No coincide con el nombre.',
            'telegram_username': telegram_name,
        }
    return {
        'connected': True,
        'message': 'Nombre y token coinciden.',
        'telegram_username': telegram_name,
    }


def apply_check(row: TelegramBotConfig, check: dict) -> None:
    connected = bool(check.get('connected'))
    row.connection_status = 'connected' if connected else 'disconnected'
    row.last_health_error = None if connected else (check.get('message') or 'Desconectado.')
    row.last_health_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    if connected and check.get('telegram_username'):
        row.bot_username = normalize_bot_username(check.get('telegram_username'))


def save_telegram_bot(username: str | None, token: str | None) -> tuple[TelegramBotConfig, dict]:
    row = _get_or_create()
    row.bot_username = normalize_bot_username(username)
    row.bot_token = (token or '').strip()
    check = check_bot_credentials(row.bot_username, row.bot_token)
    apply_check(row, check)
    db.session.commit()
    return row, check


def recheck_telegram_bot() -> tuple[TelegramBotConfig | None, dict]:
    row = get_telegram_bot_config()
    if not row or not (row.bot_username or '').strip() or not (row.bot_token or '').strip():
        check = {
            'connected': False,
            'message': 'Falta el nombre o el token.',
            'telegram_username': '',
        }
        if row:
            apply_check(row, check)
            db.session.commit()
        return row, check
    check = check_bot_credentials(row.bot_username, row.bot_token)
    apply_check(row, check)
    db.session.commit()
    return row, check


def serialize_telegram_bot(row: TelegramBotConfig | None) -> dict:
    if not row:
        return {
            'bot_username': '',
            'bot_token': '',
            'connection_status': 'disconnected',
            'last_health_error': '',
            'connected': False,
            'is_enabled': False,
        }
    status = (row.connection_status or 'disconnected').lower()
    return {
        'bot_username': row.bot_username or '',
        'bot_token': row.bot_token or '',
        'connection_status': 'connected' if status == 'connected' else 'disconnected',
        'last_health_error': row.last_health_error or '',
        'connected': status == 'connected',
        'is_enabled': bool(getattr(row, 'is_enabled', False)),
    }


def set_telegram_bot_enabled(enabled: bool) -> TelegramBotConfig:
    row = _get_or_create()
    row.is_enabled = bool(enabled)
    row.updated_at = datetime.utcnow()
    db.session.commit()
    return row


def telegram_digest_ready() -> bool:
    """El resumen puede salir por Telegram: interruptor, token y bot conectado."""
    ensure_telegram_bot_schema()
    row = get_telegram_bot_config()
    if not row or not bool(getattr(row, 'is_enabled', False)):
        return False
    if (row.connection_status or '').lower() != 'connected':
        return False
    return bool((row.bot_token or '').strip())


def digest_chat_id_for_user(user) -> str:
    """ID válido solo si el usuario tiene Telegram marcado y el bot está listo."""
    if not telegram_digest_ready() or user is None:
        return ''
    from app.store.whatsapp_user_notify_prefs import (
        is_store_subuser,
        user_telegram_notify_enabled_flag,
    )

    if not getattr(user, 'enabled', True) or is_store_subuser(user):
        return ''
    if not user_telegram_notify_enabled_flag(user):
        return ''
    chat_id, err = validate_chat_id(getattr(user, 'telegram_chat_id', None))
    if err:
        return ''
    return chat_id


def send_telegram_digest_message(chat_id: str, text: str) -> dict:
    """Envía el mismo texto del resumen. No borra el mensaje."""
    token = _saved_bot_token()
    if not token:
        return {'success': False, 'error': 'El bot no está conectado.'}
    result = _telegram_call(
        token,
        'sendMessage',
        {'chat_id': chat_id, 'text': str(text or '')},
    )
    if result.get('ok'):
        return {'success': True}
    return {
        'success': False,
        'error': humanize_telegram_chat_error(result.get('description')),
    }


def normalize_chat_id(raw: str | None) -> str:
    return ''.join((raw or '').split())


def validate_chat_id(raw: str | None) -> tuple[str, str | None]:
    chat_id = normalize_chat_id(raw)
    if not chat_id:
        return '', 'Falta el ID.'
    if not _CHAT_ID_RE.match(chat_id):
        return chat_id, 'El ID tiene que ser numérico, por ejemplo 123456789.'
    return chat_id, None


def humanize_telegram_chat_error(description: str | None) -> str:
    low = (description or '').strip().lower()
    if low in ('', 'network'):
        return 'No se pudo consultar Telegram.'
    if low in ('sin token', 'sin_bot'):
        return 'El bot no está conectado. Guardá el nombre y el token en Datos BotFather.'
    if 'unauthorized' in low:
        return 'Telegram no reconoce el token del bot.'
    if 'blocked by the user' in low:
        return 'La persona bloqueó el bot.'
    if 'user is deactivated' in low or 'deactivated' in low:
        return 'La cuenta de Telegram está desactivada.'
    if 'initiate conversation' in low:
        return 'La persona no autorizó el bot. Tiene que abrirlo y pulsar Iniciar.'
    if 'chat not found' in low or 'peer_id_invalid' in low:
        return 'Ese ID no existe o la persona no ha abierto el bot.'
    if 'chat_id' in low:
        return 'El ID no es válido.'
    return 'Telegram rechazó el ID.'


def _telegram_call(token: str, method: str, payload: dict, timeout: int = 12) -> dict:
    """Llama a la API del bot. No registra el token ni la URL."""
    clean = (token or '').strip()
    if not clean:
        return {'ok': False, 'description': 'sin token'}
    try:
        response = requests.post(
            f'https://api.telegram.org/bot{clean}/{method}',
            json=payload,
            timeout=timeout,
        )
        data = response.json()
    except Exception:
        return {'ok': False, 'description': 'network'}
    if not isinstance(data, dict):
        return {'ok': False, 'description': 'network'}
    if data.get('ok'):
        return {'ok': True, 'result': data.get('result')}
    return {'ok': False, 'description': str(data.get('description') or '')}


def _saved_bot_token() -> str:
    row = get_telegram_bot_config()
    if not row:
        return ''
    return (row.bot_token or '').strip()


def probe_telegram_chat(chat_id_raw: str | None) -> dict:
    """Comprueba si el bot reconoce el ID, sin enviar mensaje."""
    chat_id, err = validate_chat_id(chat_id_raw)
    if err:
        return {'connected': False, 'message': err}
    token = _saved_bot_token()
    if not token:
        return {
            'connected': False,
            'message': 'El bot no está conectado. Guardá el nombre y el token en Datos BotFather.',
        }
    result = _telegram_call(token, 'getChat', {'chat_id': chat_id})
    if result.get('ok'):
        return {'connected': True, 'message': 'Hay conexión. El bot reconoce este ID.'}
    return {'connected': False, 'message': humanize_telegram_chat_error(result.get('description'))}


def send_telegram_test(chat_id_raw: str | None) -> dict:
    """Envía un mensaje corto de prueba a ese ID."""
    chat_id, err = validate_chat_id(chat_id_raw)
    if err:
        return {'connected': False, 'message': err}
    token = _saved_bot_token()
    if not token:
        return {
            'connected': False,
            'message': 'El bot no está conectado. Guardá el nombre y el token en Datos BotFather.',
        }
    result = _telegram_call(
        token,
        'sendMessage',
        {
            'chat_id': chat_id,
            'text': 'prueba de mensaje',
        },
    )
    if not result.get('ok'):
        return {'connected': False, 'message': humanize_telegram_chat_error(result.get('description'))}
    sent = result.get('result') if isinstance(result.get('result'), dict) else {}
    message_id = sent.get('message_id')
    if not message_id:
        return {'connected': True, 'message': 'Prueba de mensaje enviada, pero no se pudo eliminar.'}
    deleted = _telegram_call(
        token,
        'deleteMessage',
        {'chat_id': chat_id, 'message_id': message_id},
    )
    if deleted.get('ok'):
        return {'connected': True, 'message': 'Prueba de mensaje enviada y eliminada.'}
    return {'connected': True, 'message': 'Prueba de mensaje enviada, pero no se pudo eliminar.'}


_poll_state = {'token_mark': '', 'offset': None, 'webhook_cleared': False}
_last_menu_message = {}


def reply_with_chat_id(token: str, chat_id) -> bool:
    """Tu ID es {id} Copiar en la misma línea. Debajo, pasalo a la tienda."""
    shown = str(chat_id)
    safe = _html_text(shown)
    sent = _telegram_call(token, 'sendRichMessage', {
        'chat_id': chat_id,
        'rich_message': {
            'html': (
                f'Tu ID es {safe} '
                f'<tg-button type="copy_text" text="{safe}">Copiar</tg-button>'
                '<br>pasalo a la tienda'
            ),
        },
    })
    if not sent.get('ok'):
        sent = _telegram_call(token, 'sendMessage', {
            'chat_id': chat_id,
            'text': f'Tu ID es {shown}\npasalo a la tienda',
            'reply_markup': {
                'inline_keyboard': [[{
                    'text': 'Copiar',
                    'copy_text': {'text': shown},
                }]],
            },
        })
    _send_with_menu(token, chat_id, 'Elige una opción:')
    return bool(sent.get('ok'))


def _menu_action(text: str) -> str:
    raw = (text or '').strip()
    if not raw:
        return ''
    if raw.startswith('/'):
        command = raw.split()[0].split('@')[0].lower()
        return 'start' if command == '/start' else ''
    key = raw.casefold()
    return {
        _BTN_ID.casefold(): 'id',
        _BTN_ID_PREVIOUS.casefold(): 'id',
        _BTN_PRICES.casefold(): 'prices',
        _BTN_CODES.casefold(): 'codes',
        _BTN_AD.casefold(): 'ad',
    }.get(key, '')


def _money_amount(value) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return '0'
    number = round(number + 0.0, 2)
    if abs(number - round(number)) < 1e-9:
        return str(int(round(number)))
    text = f'{number:.2f}'.rstrip('0').rstrip('.')
    return text or '0'


def _working_ad_group_id() -> str:
    """Grupo de publicidad configurado y visible para el bot. Vacío si falta o falla."""
    from app.store.drive_telegram_send import configured_telegram_group_ids

    if not _saved_bot_token():
        return ''
    for group_id in configured_telegram_group_ids():
        if probe_telegram_chat(group_id).get('connected'):
            return group_id
    return ''


def _chat_belongs_to_store_user(chat_id) -> bool:
    """True solo si el ID está en un usuario que sigue existiendo y está encendido."""
    from app.models.user import User
    from app.store.drive_telegram_send import ad_group_chat_id

    wanted = str(chat_id).strip()
    if not wanted:
        return False
    rows = User.query.filter(
        User.enabled.is_(True),
        User.telegram_chat_id.isnot(None),
        User.telegram_chat_id != '',
    ).all()
    for user in rows:
        if not bool(user.enabled):
            continue
        if ad_group_chat_id(user) == wanted:
            return True
    return False


def _inline_menu_button(text: str, data: str) -> dict:
    return {'text': text, 'callback_data': data, 'style': 'primary'}


def _inline_menu_markup(include_ad: bool) -> dict:
    rows = [
        [_inline_menu_button(_BTN_ID, 'id')],
        [_inline_menu_button(_BTN_PRICES, 'prices')],
        [_inline_menu_button(_BTN_CODES, 'codes')],
    ]
    if include_ad:
        rows.append([_inline_menu_button(_BTN_AD, 'ad')])
    return {'inline_keyboard': rows}


def _menu_markup_for(chat_id) -> dict:
    include_ad = bool(_working_ad_group_id()) and _chat_belongs_to_store_user(chat_id)
    return _inline_menu_markup(include_ad)


def _markup_without_style(markup: dict) -> dict:
    rows = []
    for row in markup.get('inline_keyboard') or []:
        cleaned = []
        for button in row:
            if isinstance(button, dict) and 'style' in button:
                button = {key: value for key, value in button.items() if key != 'style'}
            cleaned.append(button)
        rows.append(cleaned)
    return {'inline_keyboard': rows}


def _send_text(token: str, chat_id, text: str, reply_markup: dict | None = None) -> dict:
    payload = {'chat_id': chat_id, 'text': text}
    if reply_markup:
        payload['reply_markup'] = reply_markup
    sent = _telegram_call(token, 'sendMessage', payload)
    if reply_markup and not sent.get('ok') and 'style' in (sent.get('description') or '').lower():
        payload['reply_markup'] = _markup_without_style(reply_markup)
        sent = _telegram_call(token, 'sendMessage', payload)
    return sent


def _html_text(value: str) -> str:
    return (
        str(value)
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
    )


def _centered_menu_html(include_ad: bool) -> str:
    rows = []
    labels = [(_BTN_ID, 'id'), (_BTN_PRICES, 'prices'), (_BTN_CODES, 'codes')]
    if include_ad:
        labels.append((_BTN_AD, 'ad'))
    for label, data in labels:
        rows.append(
            '<tg-button-row align="center">'
            f'<tg-button type="callback_data" style="primary" data="{data}">{_html_text(label)}</tg-button>'
            '</tg-button-row>'
        )
    return ''.join(rows)


def _send_with_menu(token: str, chat_id, text: str, include_menu: bool = True) -> dict:
    """Mensaje con los botones azules centrados. Si Telegram no acepta el formato, usa el teclado inline."""
    include_ad = bool(include_menu) and bool(_working_ad_group_id()) and _chat_belongs_to_store_user(chat_id)
    body = _html_text(text).replace('\n', '<br>')
    buttons = _centered_menu_html(include_ad) if include_menu else ''
    sent = _telegram_call(
        token,
        'sendRichMessage',
        {
            'chat_id': chat_id,
            'rich_message': {'html': body + buttons},
            'reply_markup': {'remove_keyboard': True},
        },
    )
    if not sent.get('ok'):
        markup = _inline_menu_markup(include_ad) if include_menu else None
        sent = _send_text(token, chat_id, text, markup)
    if include_menu:
        _replace_previous_menu(token, chat_id, sent)
    return sent


def _replace_previous_menu(token: str, chat_id, sent: dict) -> None:
    """Guarda el menú nuevo y borra el anterior cuando la respuesta ya se envió."""
    result = sent.get('result') if isinstance(sent.get('result'), dict) else {}
    new_id = result.get('message_id')
    key = str(chat_id)
    previous = _last_menu_message.get(key)
    if new_id:
        _last_menu_message[key] = new_id
    if previous and previous != new_id:
        _telegram_call(token, 'deleteMessage', {'chat_id': chat_id, 'message_id': previous})


def _send_start_menu(token: str, chat_id) -> None:
    _send_with_menu(token, chat_id, 'Elige una opción:')


def _send_long_text(token: str, chat_id, text: str) -> None:
    body = (text or '').strip() or 'Sin datos.'
    parts = []
    if len(body) <= _MENU_TEXT_LIMIT:
        parts = [body]
    else:
        buf = ''
        for block in body.split('\n\n'):
            piece = block if not buf else f'{buf}\n\n{block}'
            if len(piece) <= _MENU_TEXT_LIMIT:
                buf = piece
                continue
            if buf:
                parts.append(buf)
            buf = block
            while len(buf) > _MENU_TEXT_LIMIT:
                parts.append(buf[:_MENU_TEXT_LIMIT])
                buf = buf[_MENU_TEXT_LIMIT:]
        if buf:
            parts.append(buf)
    for part in parts:
        _send_text(token, chat_id, part)
    _send_with_menu(token, chat_id, 'Elige una opción:')


def _enabled_user_for_chat(chat_id):
    """Usuario encendido cuyo ID de Telegram coincide. None si está apagado o no existe."""
    from app.models.user import User

    wanted, err = validate_chat_id(str(chat_id))
    if err or not wanted:
        return None
    rows = User.query.filter(
        User.enabled.is_(True),
        User.telegram_chat_id.isnot(None),
        User.telegram_chat_id != '',
    ).all()
    for user in rows:
        if not bool(user.enabled):
            continue
        saved, saved_err = validate_chat_id(user.telegram_chat_id)
        if not saved_err and saved == wanted:
            return user
    return None


def _final_price(base, discount) -> float:
    try:
        amount = float(base or 0) - float(discount or 0)
    except (TypeError, ValueError):
        amount = 0.0
    return max(round(amount, 2), 0.0)


def _price_list_payload(chat_id):
    """(título, líneas) de la lista, o un aviso en texto si no se puede armar."""
    from app.store.routes import catalog_products_for_store_user
    from app.store.routes_licencias import _product_billing_period_map

    user = _enabled_user_for_chat(chat_id)
    if user is None:
        return (
            'No se envió la lista de precios. '
            'Este ID no está en un usuario encendido, así que no hay moneda COP o USD.'
        )
    products, tipo_precio = catalog_products_for_store_user(user)
    currency = str(tipo_precio or '').strip().upper()
    if currency not in ('USD', 'COP'):
        return (
            'No se envió la lista de precios. '
            'Tu usuario no tiene tipo de precio COP o USD.'
        )
    if not products:
        return 'Cuentas y precios\n\nNo hay cuentas publicadas.'
    periods = _product_billing_period_map(products)
    lines = []
    for product in products:
        period = periods.get(product.id) or 'mensual'
        if currency == 'COP':
            amount = _final_price(product.price_cop, getattr(product, 'discount_cop_extra', 0))
        else:
            amount = _final_price(product.price_usd, getattr(product, 'discount_usd_extra', 0))
        name = ' '.join(str(product.name or '').split()) or 'Cuenta'
        lines.append(f'* {name}\n{period}: ${_money_amount(amount)} {currency}')
    return (f'Cuentas y precios {currency}', lines)


def _send_price_list(token: str, chat_id) -> None:
    """Título centrado y, por cuenta, el nombre y el periodo con el precio al lado."""
    payload = _price_list_payload(chat_id)
    if isinstance(payload, str):
        _send_long_text(token, chat_id, payload)
        return
    title, lines = payload
    plain = title + '\n\n' + '\n\n'.join(lines)
    blocks = [{'type': 'pullquote', 'text': title}]
    for line in lines:
        blocks.append({'type': 'paragraph', 'text': line})
    sent = _telegram_call(token, 'sendRichMessage', {
        'chat_id': chat_id,
        'rich_message': {'blocks': blocks},
    })
    if not sent.get('ok'):
        _send_long_text(token, chat_id, plain)
        return
    _send_with_menu(token, chat_id, 'Elige una opción:')


def _codes_help_text() -> str:
    """Los mismos botones visibles en Códigos, con el texto del icono de información."""
    from app.models.service import ServiceModel

    services = (
        ServiceModel.query
        .filter(
            ServiceModel.enabled.is_(True),
            ServiceModel.visibility_mode.in_(('on-usuarios', 'on-no-usuarios', 'sms')),
        )
        .order_by(ServiceModel.position.asc(), ServiceModel.id.asc())
        .all()
    )
    blocks = []
    for service in services:
        lines = [f'* {service.name}']
        aliases = sorted(service.aliases or [], key=lambda item: item.id or 0)
        for alias in aliases:
            if getattr(alias, 'enabled', True) is False:
                continue
            name = ' '.join(str(alias.alias_name or '').split())
            if name:
                lines.append(f'- {name}')
        if len(lines) > 1:
            blocks.append('\n'.join(lines))
    if not blocks:
        return 'No hay botones de códigos con descripción.'
    return '\n\n'.join(blocks)


def _send_ad_invite(token: str, chat_id) -> None:
    if not _chat_belongs_to_store_user(chat_id):
        return
    group_id = _working_ad_group_id()
    if not group_id:
        return
    _telegram_call(token, 'unbanChatMember', {
        'chat_id': group_id,
        'user_id': chat_id,
        'only_if_banned': True,
    })
    created = _telegram_call(token, 'createChatInviteLink', {
        'chat_id': group_id,
        'member_limit': 1,
    })
    invite = ''
    if created.get('ok') and isinstance(created.get('result'), dict):
        invite = str(created['result'].get('invite_link') or '')
    if not invite:
        exported = _telegram_call(token, 'exportChatInviteLink', {'chat_id': group_id})
        if exported.get('ok') and exported.get('result'):
            invite = str(exported.get('result'))
    if not invite:
        _send_text(
            token,
            chat_id,
            'El grupo está configurado, pero no se pudo crear el enlace para volver a entrar.',
        )
        _send_with_menu(token, chat_id, 'Elige una opción:')
        return
    _send_text(
        token,
        chat_id,
        'Enlace para volver a entrar a la publicidad:\n' + invite,
    )
    _send_with_menu(token, chat_id, 'Elige una opción:')


def _handle_menu_callback(token: str, callback: dict) -> None:
    query_id = callback.get('id')
    if query_id:
        _telegram_call(token, 'answerCallbackQuery', {'callback_query_id': query_id})
    action = str(callback.get('data') or '').strip()
    if action not in ('id', 'prices', 'codes', 'ad'):
        return
    sender = callback.get('from') if isinstance(callback.get('from'), dict) else {}
    message = callback.get('message') if isinstance(callback.get('message'), dict) else {}
    chat = message.get('chat') if isinstance(message.get('chat'), dict) else {}
    if sender.get('is_bot') or chat.get('type') != 'private':
        return
    chat_id = chat.get('id')
    if chat_id is None:
        return
    clicked_id = message.get('message_id')
    _dispatch_private_menu(token, chat_id, action)
    current_id = _last_menu_message.get(str(chat_id))
    if clicked_id and clicked_id != current_id:
        _telegram_call(token, 'deleteMessage', {'chat_id': chat_id, 'message_id': clicked_id})


def _dispatch_private_menu(token: str, chat_id, text: str) -> None:
    action = text if text in ('start', 'id', 'prices', 'codes', 'ad') else _menu_action(text)
    if not action:
        return
    try:
        if action == 'start':
            _send_start_menu(token, chat_id)
        elif action == 'id':
            reply_with_chat_id(token, chat_id)
        elif action == 'prices':
            _send_price_list(token, chat_id)
        elif action == 'codes':
            _send_long_text(token, chat_id, _codes_help_text())
        elif action == 'ad':
            _send_ad_invite(token, chat_id)
    except Exception:
        logger.exception('telegram menu %s', action)
        _telegram_call(
            token,
            'sendMessage',
            {'chat_id': chat_id, 'text': 'No se pudo completar esa opción. Intentalo de nuevo.'},
        )


def _consume_bot_updates(timeout_seconds: int, request_timeout: int) -> bool:
    """Lee avisos del bot. True si no había nada nuevo. Quien llama ya tiene el candado."""
    ensure_telegram_bot_schema()
    row = get_telegram_bot_config()
    token = (row.bot_token or '').strip() if row else ''
    if not token:
        return True
    mark = token[-6:]
    if _poll_state['token_mark'] != mark:
        _poll_state['token_mark'] = mark
        _poll_state['webhook_cleared'] = False
    if not _poll_state['webhook_cleared']:
        _telegram_call(token, 'deleteWebhook', {'drop_pending_updates': False})
        _poll_state['webhook_cleared'] = True
    payload = {
        'timeout': timeout_seconds,
        'allowed_updates': ['message', 'edited_message', 'callback_query', 'channel_post', 'edited_channel_post', 'my_chat_member'],
    }
    stored_offset = int(row.update_offset or 0) if row and row.update_offset else 0
    if stored_offset:
        payload['offset'] = stored_offset
    db.session.rollback()
    result = _telegram_call(token, 'getUpdates', payload, timeout=request_timeout)
    if not result.get('ok'):
        desc = (result.get('description') or '').lower()
        if 'webhook' in desc or 'conflict' in desc:
            _poll_state['webhook_cleared'] = False
        return True
    updates = result.get('result') if isinstance(result.get('result'), list) else []
    saved_through = None
    for upd in updates:
        if not isinstance(upd, dict):
            continue
        uid = upd.get('update_id')
        if not isinstance(uid, int):
            continue
        if not capture_telegram_update_chat(upd):
            break
        saved_through = uid
        callback = upd.get('callback_query') if isinstance(upd.get('callback_query'), dict) else None
        if callback:
            _handle_menu_callback(token, callback)
            continue
        msg = upd.get('message') if isinstance(upd.get('message'), dict) else {}
        sender = msg.get('from') if isinstance(msg.get('from'), dict) else {}
        chat = msg.get('chat') if isinstance(msg.get('chat'), dict) else {}
        if sender.get('is_bot') or chat.get('type') != 'private':
            continue
        if not _menu_action(str(msg.get('text') or '')):
            continue
        chat_id = chat.get('id')
        if chat_id is None:
            continue
        _dispatch_private_menu(token, chat_id, str(msg.get('text') or ''))
    if saved_through is not None:
        fresh = get_telegram_bot_config()
        if fresh is not None:
            fresh.update_offset = saved_through + 1
            db.session.commit()
    return not updates


def ingest_pending_group_updates() -> None:
    """Antes de mostrar la tabla, guarda los grupos que Telegram todavía no había entregado."""
    if not _updates_lock.acquire(timeout=4):
        return
    try:
        _consume_bot_updates(0, 5)
    finally:
        _updates_lock.release()


def poll_telegram_updates() -> bool:
    """Lee mensajes nuevos. /start abre el menú. Devuelve True si hay que esperar."""
    if not _updates_lock.acquire(timeout=1):
        return True
    try:
        return _consume_bot_updates(2, 8)
    finally:
        _updates_lock.release()
