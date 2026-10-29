# -*- coding: utf-8 -*-
"""Bot de Telegram: guarda nombre y token y comprueba que coincidan con getMe."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime

import requests
from flask import current_app
from sqlalchemy import inspect, text

from app.extensions import db
from app.store.models import TelegramBotConfig

logger = logging.getLogger(__name__)

_BTN_ID = 'Saber tu ID de tu usuario'
_BTN_ID_PREVIOUS = 'Saber el ID de tu cuenta'
_BTN_PRICES = 'Lista de precios y mensualidades'
_BTN_PRICES_PREVIOUS = 'Lista de precios'
_BTN_CODES = 'Qué hace cada botón de códigos'
_BTN_PAGOS = 'Medios De Pago Que Recibo'
_BTN_TRABAJO = 'Cómo trabajo — Guía rápida'
_BTN_PANTALLAS = 'Foto de pantallas, perfiles, links de tv'
_BTN_AD = 'Link de publicidad'
_CODES_SECTION_TITLE = 'Página de códigos'
_MENU_TEXT_LIMIT = 4000
_REPEAT_SECONDS = 120
_recent_button_sends = {}
_recent_button_lock = threading.Lock()
_CODE_FIELD = 'correo@dominio.com'
_pending_code_search = {}
_pending_code_lock = threading.Lock()
_code_email_by_chat = {}
_code_email_lock = threading.Lock()
_last_menu_message = {}
_menu_message_ids = {}
_menu_message_lock = threading.Lock()
_twofa_watch = {}
_twofa_watch_lock = threading.Lock()

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
        columns = insp.get_columns('telegram_bot_configs')
        names = {c['name'] for c in columns}
        dialect = getattr(db.engine.dialect, 'name', '') or ''
        if 'is_enabled' in names:
            if dialect != 'postgresql':
                return
            current = next(c for c in columns if c['name'] == 'is_enabled')
            if 'BOOL' in str(current.get('type') or '').upper():
                return
            db.session.execute(
                text('ALTER TABLE telegram_bot_configs ALTER COLUMN is_enabled DROP DEFAULT')
            )
            db.session.execute(
                text(
                    'ALTER TABLE telegram_bot_configs '
                    'ALTER COLUMN is_enabled TYPE BOOLEAN '
                    "USING CASE WHEN is_enabled::text IN ('1', 't', 'true') THEN TRUE ELSE FALSE END"
                )
            )
            db.session.execute(
                text(
                    'ALTER TABLE telegram_bot_configs '
                    'ALTER COLUMN is_enabled SET DEFAULT FALSE'
                )
            )
            db.session.execute(
                text(
                    'ALTER TABLE telegram_bot_configs '
                    'ALTER COLUMN is_enabled SET NOT NULL'
                )
            )
            db.session.commit()
            return
        ddl = (
            'ALTER TABLE telegram_bot_configs ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT FALSE'
            if dialect == 'postgresql'
            else 'ALTER TABLE telegram_bot_configs ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 0'
        )
        db.session.execute(text(ddl))
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


def _ensure_telegram_menu_buttons_column() -> None:
    try:
        insp = inspect(db.engine)
        cols = {c['name'] for c in insp.get_columns('telegram_bot_configs')}
        if 'menu_buttons' in cols:
            return
        db.session.execute(text('ALTER TABLE telegram_bot_configs ADD COLUMN menu_buttons TEXT'))
        db.session.commit()
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        try:
            current_app.logger.warning('ensure telegram menu_buttons: %s', exc)
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
            _ensure_telegram_menu_buttons_column()
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
                    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
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
        _ensure_telegram_update_offset_column()
        _ensure_telegram_menu_buttons_column()
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
    name = normalize_bot_username(username)
    clean_token = (token or '').strip()
    if not name and not clean_token:
        row.bot_username = ''
        row.bot_token = ''
        row.is_enabled = False
        row.connection_status = 'disconnected'
        row.last_health_error = None
        row.last_health_at = datetime.utcnow()
        row.updated_at = datetime.utcnow()
        db.session.commit()
        return row, {
            'connected': False,
            'cleared': True,
            'message': 'Datos de BotFather borrados.',
            'telegram_username': '',
        }
    row.bot_username = name
    row.bot_token = clean_token
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
    ids = user_chat_ids(user)
    return ','.join(ids)


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


def parse_chat_id_list(raw: str | None) -> tuple[list[str], str | None]:
    """Varios ID separados por coma. Cada uno numérico y sin repetir en la misma lista."""
    text = str(raw or '').strip()
    if not text:
        return [], None
    ids: list[str] = []
    seen: set[str] = set()
    for part in text.split(','):
        piece = part.strip()
        if not piece:
            continue
        normalized, err = validate_chat_id(piece)
        if err:
            return [], err
        if normalized in seen:
            continue
        seen.add(normalized)
        ids.append(normalized)
    if not ids:
        return [], 'Falta el ID.'
    stored = ','.join(ids)
    if len(stored) > 255:
        return [], 'Hay demasiados ID para guardar.'
    return ids, None


def user_chat_ids(user) -> list[str]:
    if user is None:
        return []
    ids, err = parse_chat_id_list(getattr(user, 'telegram_chat_id', None))
    return [] if err else ids


def chat_id_taken_by(chat_id: str, exclude_user_id=None):
    """Usuario o sub-usuario que ya tiene ese ID. None si está libre."""
    from app.models.user import User

    wanted, err = validate_chat_id(chat_id)
    if err or not wanted:
        return None
    rows = User.query.filter(
        User.telegram_chat_id.isnot(None),
        User.telegram_chat_id != '',
    ).all()
    for row in rows:
        if exclude_user_id is not None and int(row.id) == int(exclude_user_id):
            continue
        if wanted in user_chat_ids(row):
            return row
    return None


def telegram_id_in_use_message(owner, chat_id: str) -> str:
    """Aviso con el dueño. Si es sub-usuario, incluye al padre."""
    name = (getattr(owner, 'username', None) or '').strip() or 'otro'
    if getattr(owner, 'parent_id', None):
        parent = getattr(owner, 'parent', None)
        parent_name = (getattr(parent, 'username', None) or '').strip() or 'desconocido'
        return (
            f'El sub-usuario {name} del padre usuario {parent_name} '
            f'ya tiene ese ID {chat_id}.'
        )
    return f'El usuario {name} ya tiene ese ID {chat_id}.'


def user_telegram_chat_active(user) -> bool:
    """True si el usuario tiene al menos un ID de Telegram válido."""
    return bool(user_chat_ids(user))


def validate_topic_id(raw: str | None) -> tuple[str, str | None]:
    """ID de tema de foro (message_thread_id): numérico corto, p. ej. 5811."""
    topic_id = normalize_chat_id(raw)
    if not topic_id:
        return '', None
    if not topic_id.isdigit():
        return topic_id, 'El ID del tema debe ser numérico, por ejemplo 5811.'
    return topic_id, None


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
    fixed = {
        _BTN_ID.casefold(): 'id',
        _BTN_ID_PREVIOUS.casefold(): 'id',
        _BTN_PRICES.casefold(): 'prices',
        _BTN_PRICES_PREVIOUS.casefold(): 'prices',
        _BTN_CODES.casefold(): 'codes',
        _BTN_PAGOS.casefold(): 'pagos',
        _BTN_TRABAJO.casefold(): 'trabajo',
        _BTN_PANTALLAS.casefold(): 'pantallas',
        _BTN_AD.casefold(): 'ad',
    }.get(key, '')
    if fixed:
        button = _menu_button(fixed)
        if button is not None and not button['enabled']:
            return ''
        return fixed
    for item in menu_button_catalog():
        names = {item['label'].casefold(), item['default_label'].casefold()}
        if key not in names:
            continue
        if not item['enabled']:
            return ''
        return item['key']
    return ''


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


def _inline_menu_button(text: str, data: str, style: str = 'primary') -> dict:
    button = {'text': text, 'callback_data': data}
    if style:
        button['style'] = style
    return button


def _code_services_for_menu() -> list:
    """Servicios que ve un usuario logueado en la página de códigos."""
    try:
        from app.models.service import ServiceModel

        rows = (
            ServiceModel.query.filter(
                ServiceModel.enabled.is_(True),
                ServiceModel.visibility_mode.in_(('on-usuarios', 'sms')),
            )
            .order_by(ServiceModel.position.asc(), ServiceModel.id.asc())
            .all()
        )
    except Exception:
        logger.exception('telegram code services')
        return []
    services = []
    for row in rows:
        name = (row.name or '').strip()
        if not name or not row.id:
            continue
        services.append({
            'id': int(row.id),
            'name': name,
            'sms': row.visibility_mode == 'sms',
        })
    return services


def _code_service_by_id(service_id: int):
    for service in _code_services_for_menu():
        if service['id'] == int(service_id):
            return service
    return None


def _html_preset_menu_defaults() -> list:
    """Un botón por cada HTML habilitado de pantallas / medios / cómo trabajo."""
    from app.store.html_presets import (
        COMO_TRABAJO_KEY,
        FOTO_PANTALLAS_KEY,
        MEDIOS_DE_PAGO_KEY,
        html_preset_label,
    )
    from app.store.models import HtmlInfo

    order = (FOTO_PANTALLAS_KEY, MEDIOS_DE_PAGO_KEY, COMO_TRABAJO_KEY)
    try:
        rows = (
            HtmlInfo.query
            .filter(
                HtmlInfo.enabled.is_(True),
                HtmlInfo.preset_key.in_(order),
            )
            .order_by(HtmlInfo.id.asc())
            .all()
        )
    except Exception:
        logger.exception('telegram html presets menu')
        return []
    rank = {key: index for index, key in enumerate(order)}
    rows = sorted(rows, key=lambda row: (rank.get(row.preset_key, 99), row.id or 0))
    fallback = {
        FOTO_PANTALLAS_KEY: _BTN_PANTALLAS,
        MEDIOS_DE_PAGO_KEY: _BTN_PAGOS,
        COMO_TRABAJO_KEY: _BTN_TRABAJO,
    }
    items = []
    for row in rows:
        label = (
            (row.title or '').strip()
            or fallback.get(row.preset_key)
            or html_preset_label(row.preset_key)
            or f'HTML {row.id}'
        )
        items.append((f'html:{int(row.id)}', label[:64]))
    return items


def _menu_button_defaults() -> list:
    """Botones fijos, HTMLs de plantilla y, al final, los servicios de códigos."""
    head = [
        ('id', _BTN_ID),
        ('prices', _BTN_PRICES),
        ('codes', _BTN_CODES),
    ]
    services = [
        (f"svc:{service['id']}", service['name'])
        for service in _code_services_for_menu()
    ]
    middle = _html_preset_menu_defaults() + [
        ('ad', _BTN_AD),
    ]
    return head + middle + services


def _load_menu_button_prefs() -> dict:
    row = get_telegram_bot_config()
    raw = (getattr(row, 'menu_buttons', None) or '') if row else ''
    try:
        data = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        data = {}
    return data if isinstance(data, dict) else {}


def menu_button_catalog() -> list:
    """Nombre visible, nombre original y si el botón está encendido."""
    prefs = _load_menu_button_prefs()
    items = []
    for key, default in _menu_button_defaults():
        pref = prefs.get(key) if isinstance(prefs.get(key), dict) else {}
        custom = str(pref.get('label') or '').strip()
        enabled = pref.get('enabled')
        items.append({
            'key': key,
            'label': (custom or default)[:64],
            'default_label': default,
            'enabled': True if enabled is None else bool(enabled),
        })
    return items


def _menu_button(key: str):
    for item in menu_button_catalog():
        if item['key'] == key:
            return item
    return None


def _menu_key_enabled(key: str) -> bool:
    if key == 'start':
        return True
    button = _menu_button(key)
    if button is None:
        return True
    return bool(button['enabled'])


def _load_subuser_menu_button_prefs(user) -> dict:
    raw = getattr(user, 'telegram_bot_menu_buttons', None) or ''
    try:
        data = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        data = {}
    return data if isinstance(data, dict) else {}


def _subuser_menu_catalog_eligible(key: str) -> bool:
    """Botones que el padre puede asignar a un sub-usuario (sin publicidad ni HTML solo admin)."""
    clean = str(key or '').strip()
    # 'id' es global: cualquier usuario lo ve si está encendido en BotFather.
    if not clean or clean in ('ad', 'id'):
        return False
    if not clean.startswith('html:'):
        return True
    from app.store.html_presets import COMO_TRABAJO_KEY, MEDIOS_DE_PAGO_KEY
    from app.store.models import HtmlInfo

    try:
        html_id = int(clean.split(':', 1)[1])
    except (TypeError, ValueError):
        return False
    row = HtmlInfo.query.get(html_id)
    if row is None:
        return False
    return row.preset_key not in (MEDIOS_DE_PAGO_KEY, COMO_TRABAJO_KEY)


def subuser_menu_key_enabled(user, key: str) -> bool:
    """Por defecto apagado hasta que el padre lo active en el modal del sub-usuario."""
    clean = str(key or '').strip()
    if clean in ('start', 'codes_section', 'id'):
        return True
    prefs = _load_subuser_menu_button_prefs(user)
    pref = prefs.get(clean) if isinstance(prefs.get(clean), dict) else {}
    return bool(pref.get('enabled', False))


def subuser_menu_button_catalog(user) -> list:
    """Lista para el modal del sub-usuario: mismos nombres que BotFather, estado individual."""
    items = []
    for item in menu_button_catalog():
        if not _subuser_menu_catalog_eligible(item['key']):
            continue
        items.append({
            'key': item['key'],
            'label': item['label'],
            'default_label': item['default_label'],
            'enabled': subuser_menu_key_enabled(user, item['key']),
        })
    return items


def update_subuser_menu_button(user, key: str, enabled=None) -> list:
    clean_key = str(key or '').strip()
    if not _subuser_menu_catalog_eligible(clean_key):
        raise ValueError('boton')
    if _menu_button(clean_key) is None:
        raise ValueError('boton')
    prefs = _load_subuser_menu_button_prefs(user)
    stored = prefs.get(clean_key) if isinstance(prefs.get(clean_key), dict) else {}
    if enabled is not None:
        stored['enabled'] = bool(enabled)
    if stored.get('enabled'):
        prefs[clean_key] = stored
    else:
        prefs.pop(clean_key, None)
    user.telegram_bot_menu_buttons = json.dumps(prefs, ensure_ascii=False) if prefs else None
    db.session.commit()
    return subuser_menu_button_catalog(user)


def update_menu_button(key: str, enabled=None, label=None) -> list:
    clean_key = str(key or '').strip()
    current = _menu_button(clean_key)
    if current is None:
        raise ValueError('boton')
    prefs = _load_menu_button_prefs()
    stored = prefs.get(clean_key) if isinstance(prefs.get(clean_key), dict) else {}
    if enabled is not None:
        stored['enabled'] = bool(enabled)
    if label is not None:
        text = re.sub(r'\s+', ' ', str(label)).strip()[:64]
        if not text or text == current['default_label']:
            stored.pop('label', None)
        else:
            stored['label'] = text
    if stored.get('enabled', True) is not False and 'label' not in stored:
        prefs.pop(clean_key, None)
    else:
        prefs[clean_key] = stored
    row = _get_or_create()
    row.menu_buttons = json.dumps(prefs, ensure_ascii=False)
    row.updated_at = datetime.utcnow()
    db.session.commit()
    return menu_button_catalog()


def _visible_menu_entries(include_ad: bool, user=None) -> list:
    """Botones encendidos. Publicidad solo si el chat tiene acceso; el sub-usuario ve solo lo permitido."""
    visible = []
    for item in menu_button_catalog():
        if not item['enabled']:
            continue
        if item['key'] == 'ad' and not include_ad:
            continue
        if user is not None and not _menu_allowed_for_user(user, item['key']):
            continue
        visible.append(item)
    return visible


def _rich_center_html(inner_html: str, *, title: bool = False) -> str:
    """Celda centrada. Telegram no centra un párrafo ni un h2 sueltos."""
    cell = 'th' if title else 'td'
    return (
        '<table compact>'
        f'<tr><{cell} align="center" valign="middle">{inner_html}</{cell}></tr>'
        '</table>'
    )


def _rich_title(text: str, level: int = 3) -> str:
    del level
    return _rich_center_html(f'<b>{_html_text(text)}</b>', title=True)


def _rich_error_title(text: str) -> str:
    """Aviso de error/permiso: texto marcado (Telegram lo resalta en rojo/naranja)."""
    return _rich_center_html(
        f'<mark><b>{_html_text(text)}</b></mark>',
        title=True,
    )


def _notice_is_error(text: str) -> bool:
    low = (text or '').strip().lower()
    return (
        'no tienes permiso' in low
        or 'cuenta está inhabilitada' in low
        or 'no se pudo completar' in low
    )


def _rich_button_rows(buttons: list[tuple[str, str]]) -> list[str]:
    """Dos botones por fila cuando caben; los textos largos van solos."""
    rows: list[str] = []
    pending: tuple[str, str] | None = None
    for data, name in buttons:
        if len(name) > 28:
            if pending:
                rows.append(_rich_button_row([pending]))
                pending = None
            rows.append(_rich_button_row([(data, name)]))
            continue
        if pending is None:
            pending = (data, name)
            continue
        rows.append(_rich_button_row([pending, (data, name)]))
        pending = None
    if pending:
        rows.append(_rich_button_row([pending]))
    return rows


def _rich_button_row(buttons: list[tuple[str, str]]) -> str:
    cells = []
    for data, name in buttons:
        cells.append(
            '<tg-button type="callback_data" style="primary" '
            f'data="{data}">{_html_text(name)}</tg-button>'
        )
    return '<tg-button-row align="center">' + ''.join(cells) + '</tg-button-row>'


def _code_service_button_rows(services: list) -> list:
    rows = []
    if services:
        rows.append([_inline_menu_button(_CODES_SECTION_TITLE, 'codes_section', '')])
    for service in services:
        data = f"svc:{service['id']}"
        label = service['name'][:64]
        rows.append([_inline_menu_button(label, data)])
    return rows


def _code_service_rows_html(services: list) -> str:
    if not services:
        return ''
    buttons = [(f"svc:{service['id']}", service['name'][:64]) for service in services]
    chunks = [_rich_title(_CODES_SECTION_TITLE)]
    chunks.extend(_rich_button_rows(buttons))
    return ''.join(chunks)


def _medios_pago_menu_ready() -> bool:
    """True si hay un HTML de medios de pago activo y con datos."""
    data = _load_medios_pago_card()
    return bool(data and (data.get('main_title') or data.get('sections')))


def _inline_menu_markup(include_ad: bool, code_services: list | None = None, user=None) -> dict:
    del code_services
    rows = []
    codes_title_added = False
    for item in _visible_menu_entries(include_ad, user):
        if item['key'].startswith('svc:') and not codes_title_added:
            rows.append([_inline_menu_button(_CODES_SECTION_TITLE, 'codes_section', '')])
            codes_title_added = True
        rows.append([_inline_menu_button(item['label'][:64], item['key'])])
    return {'inline_keyboard': rows}


def _menu_markup_for(chat_id) -> dict:
    include_ad = bool(_working_ad_group_id()) and _chat_belongs_to_store_user(chat_id)
    return _inline_menu_markup(include_ad, user=_enabled_user_for_chat(chat_id))


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


def _centered_menu_html(include_ad: bool, chat_id=None, code_services: list | None = None) -> str:
    del code_services, chat_id
    chunks: list[str] = []
    batch: list[tuple[str, str]] = []
    codes_title_added = False

    def flush() -> None:
        if batch:
            chunks.extend(_rich_button_rows(batch))
            batch.clear()

    for item in _visible_menu_entries(include_ad, _enabled_user_for_chat(chat_id)):
        data = item['key']
        name = item['label'][:64]
        if data.startswith('svc:') and not codes_title_added:
            flush()
            chunks.append(_rich_title(_CODES_SECTION_TITLE))
            codes_title_added = True
        batch.append((data, name))
    flush()
    return ''.join(chunks)


def _send_with_menu(token: str, chat_id, text: str, include_menu: bool = True) -> dict:
    """Mensaje con los botones azules centrados. Si Telegram no acepta el formato, usa el teclado inline."""
    include_ad = bool(include_menu) and bool(_working_ad_group_id()) and _chat_belongs_to_store_user(chat_id)
    menu_user = _enabled_user_for_chat(chat_id) if include_menu else None
    if include_menu and menu_user is not None and getattr(menu_user, 'parent_id', None):
        include_ad = False
    body = _html_text(text).replace('\n', '<br>')
    if text.strip() == 'Elige una opción:':
        body = _rich_title(text.strip(), level=2)
    buttons = _centered_menu_html(include_ad, chat_id) if include_menu else ''
    reply_markup = {'remove_keyboard': True}
    sent = _telegram_call(
        token,
        'sendRichMessage',
        {
            'chat_id': chat_id,
            'rich_message': {'html': body + buttons, 'skip_entity_detection': True},
            'reply_markup': reply_markup,
        },
    )
    if not sent.get('ok'):
        markup = _inline_menu_markup(include_ad, user=_enabled_user_for_chat(chat_id)) if include_menu else None
        sent = _send_text(token, chat_id, text, markup)
    if include_menu:
        _replace_previous_menu(token, chat_id, sent)
    return sent


def _remember_menu_message(chat_id, message_id) -> None:
    if not message_id:
        return
    key = str(chat_id)
    with _menu_message_lock:
        ids = _menu_message_ids.setdefault(key, [])
        if message_id not in ids:
            ids.append(message_id)
        if len(ids) > 20:
            del ids[:-20]
        _last_menu_message[key] = message_id


def _delete_previous_menus(token: str, chat_id, keep=None) -> None:
    """Borra los menús de botones ya enviados. El resultado no se toca."""
    key = str(chat_id)
    with _menu_message_lock:
        ids = list(_menu_message_ids.get(key) or [])
        last = _last_menu_message.get(key)
        if last and last not in ids:
            ids.append(last)
    for message_id in ids:
        if keep and message_id == keep:
            continue
        _telegram_call(token, 'deleteMessage', {'chat_id': chat_id, 'message_id': message_id})
    with _menu_message_lock:
        if keep:
            _menu_message_ids[key] = [keep]
            _last_menu_message[key] = keep
        else:
            _menu_message_ids.pop(key, None)
            _last_menu_message.pop(key, None)


def _replace_previous_menu(token: str, chat_id, sent: dict) -> None:
    """Guarda el menú nuevo y borra los menús de botones anteriores."""
    result = sent.get('result') if isinstance(sent.get('result'), dict) else {}
    new_id = result.get('message_id')
    _delete_previous_menus(token, chat_id, keep=new_id)


def _send_start_menu(token: str, chat_id) -> None:
    _send_with_menu(token, chat_id, 'Elige una opción:')


def _send_centered_notice(token: str, chat_id, text: str, *, error: bool | None = None) -> None:
    """Aviso corto centrado, igual que el título del menú."""
    notice = (text or '').strip() or 'Sin datos.'
    is_error = _notice_is_error(notice) if error is None else bool(error)
    html = _rich_error_title(notice) if is_error else _rich_title(notice)
    sent = _telegram_call(token, 'sendRichMessage', {
        'chat_id': chat_id,
        'rich_message': {'html': html, 'skip_entity_detection': True},
    })
    if not sent.get('ok'):
        prefix = '⛔ ' if is_error else ''
        _send_text(token, chat_id, prefix + notice)


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
    user = _linked_user_for_chat(chat_id)
    if user is None:
        return None
    if user.parent_id and not bool(getattr(user, 'can_use_telegram_bot', False)):
        return None
    if user.parent_id:
        from app.models.user import User

        parent = User.query.get(user.parent_id)
        if parent is None or not user_telegram_chat_active(parent):
            return None
    return user


def _linked_user_for_chat(chat_id):
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
        saved_ids = user_chat_ids(user)
        if wanted in saved_ids:
            return user
    return None


def _menu_allowed_for_user(user, key: str) -> bool:
    """Usuario principal: menú global. Sub-usuario: solo botones que el padre activó."""
    if user is None or not getattr(user, 'parent_id', None):
        return True
    if not bool(getattr(user, 'can_use_telegram_bot', False)):
        return False
    action = str(key or '')
    if action == 'id':
        return True
    if not _subuser_menu_catalog_eligible(action) and action not in ('start', 'codes_section'):
        return False
    return subuser_menu_key_enabled(user, action)


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
    rows = []
    for product in products:
        period = periods.get(product.id) or 'mensual'
        if currency == 'COP':
            amount = _final_price(product.price_cop, getattr(product, 'discount_cop_extra', 0))
        else:
            amount = _final_price(product.price_usd, getattr(product, 'discount_usd_extra', 0))
        name = ' '.join(str(product.name or '').split()) or 'Cuenta'
        rows.append({
            'name': name,
            'period': ' '.join(str(period or 'mensual').split()) or 'mensual',
            'price': f'${_money_amount(amount)} {currency}',
        })
    return (f'Cuentas y precios {currency}', rows)


def _send_price_list(token: str, chat_id) -> None:
    """Tabla de cuentas y precios como imagen, con los productos publicados en ese momento."""
    payload = _price_list_payload(chat_id)
    if isinstance(payload, str):
        _send_long_text(token, chat_id, payload)
        return
    title, rows = payload
    png = render_price_list_png(title, rows)
    sent = _send_photo_bytes(token, chat_id, png, 'cuentas-y-precios.png')
    if not sent.get('ok'):
        plain = title + '\n\n' + '\n\n'.join(
            f"* {row['name']}\n{row['period']}: {row['price']}" for row in rows
        )
        _send_long_text(token, chat_id, plain)
        return
    _send_with_menu(token, chat_id, 'Elige una opción:')


_FA_ICON_MARK = {
    'crown': '👑',
    'credit-card': '💳',
    'wallet': '👛',
    'money-bill-wave': '💵',
    'coins': '🪙',
    'gem': '💎',
    'star': '⭐',
    'university': '🏦',
    'hand-holding-usd': '💰',
    'shield-alt': '🛡️',
}


def _medios_pago_icon_text(icon: str | None) -> str:
    value = (icon or '').strip()
    if not value or value == 'none':
        return ''
    if value.startswith('fa:'):
        return _FA_ICON_MARK.get(value[3:].strip(), '')
    return value


def _font_file(bold: bool) -> str | None:
    import os

    names = (
        ('arialbd.ttf', 'DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf')
        if bold else
        ('arial.ttf', 'DejaVuSans.ttf', 'LiberationSans-Regular.ttf')
    )
    folders = (
        r'C:\Windows\Fonts',
        '/usr/share/fonts/truetype/dejavu',
        '/usr/share/fonts/truetype/liberation',
    )
    for folder in folders:
        for name in names:
            path = os.path.join(folder, name)
            if os.path.isfile(path):
                return path
    return None


def _load_font(size: int, bold: bool = False):
    from PIL import ImageFont

    path = _font_file(bold)
    if path:
        return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _wrap_words(draw, text: str, font, max_width: int) -> list[str]:
    words = ' '.join(str(text or '').split()).split(' ')
    if not words or words == ['']:
        return []
    lines: list[str] = []
    current = ''
    for word in words:
        trial = word if not current else f'{current} {word}'
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
            continue
        if current:
            lines.append(current)
        current = word
    if current:
        lines.append(current)
    return lines


def _hex_rgb(value: str) -> tuple[int, int, int]:
    raw = (value or '').strip().lstrip('#')
    if len(raw) == 3:
        raw = ''.join(ch * 2 for ch in raw)
    if len(raw) != 6:
        return (30, 136, 229)
    try:
        return tuple(int(raw[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return (30, 136, 229)


def _rounded_mask(size: tuple[int, int], radius: int):
    from PIL import Image, ImageDraw

    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def render_medios_pago_png(data: dict) -> bytes:
    """Dibuja la ficha de medios de pago como PNG para enviarla por Telegram."""
    import io

    from PIL import Image, ImageDraw

    width = 760
    pad = 22
    inner = width - pad * 2
    title_font = _load_font(34, True)
    section_font = _load_font(24, True)
    item_font = _load_font(22, True)
    body_font = _load_font(20, False)
    line_gap = 8
    sections = data.get('sections') or []
    main_title = ' '.join(str(data.get('main_title') or 'medios de pago que recibo').split()).upper()
    icon = _medios_pago_icon_text(data.get('main_icon'))

    probe = Image.new('RGB', (width, 40), 'white')
    measure = ImageDraw.Draw(probe)

    def block_height(text: str, font, max_width: int) -> tuple[list[str], int]:
        lines = _wrap_words(measure, text, font, max_width)
        if not lines:
            return [], 0
        sample = measure.textbbox((0, 0), 'Ag', font=font)
        line_h = sample[3] - sample[1]
        return lines, len(lines) * (line_h + line_gap) - line_gap

    title_lines, title_h = block_height(main_title, title_font, inner - 36)
    banner_h = max(88, title_h + 36)
    total = pad + banner_h + 18
    prepared = []
    for section in sections:
        color = _hex_rgb(section.get('color'))
        heading = ' '.join(str(section.get('title') or '').split()).upper()
        head_lines, head_h = block_height(heading, section_font, inner - 28) if heading else ([], 0)
        bar_h = head_h + 22 if heading else 0
        content_h = 16
        items = []
        for line in section.get('subtitles') or []:
            wrapped, height = block_height(line, item_font, inner - 58)
            if wrapped:
                items.append((wrapped, height))
                content_h += height + 8
        desc_lines, desc_h = block_height(section.get('description') or '', body_font, inner - 36)
        if desc_lines:
            content_h += desc_h + 8
        url = ' '.join(str(section.get('url') or '').split())
        url_label = url
        for prefix in ('https://', 'http://'):
            if url_label.lower().startswith(prefix):
                url_label = url_label[len(prefix):]
        url_lines, url_h = block_height(url_label, item_font, inner - 36)
        if url_lines:
            content_h += url_h + 6
        content_h = max(content_h, 18)
        box_h = bar_h + content_h + 12
        prepared.append({
            'color': color,
            'head_lines': head_lines,
            'bar_h': bar_h,
            'items': items,
            'desc_lines': desc_lines,
            'url_lines': url_lines,
            'box_h': box_h,
        })
        total += box_h + 16
    total += pad

    image = Image.new('RGB', (width, total), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    y = pad
    banner = Image.new('RGB', (inner, banner_h), (240, 68, 54))
    gradient = ImageDraw.Draw(banner)
    for row in range(banner_h):
        mix = row / max(banner_h - 1, 1)
        color = (
            int(255 + (240 - 255) * mix),
            int(125 + (68 - 125) * mix),
            int(104 + (54 - 104) * mix),
        )
        gradient.line((0, row, inner, row), fill=color)
    banner.putalpha(_rounded_mask((inner, banner_h), 16))
    image.paste(banner, (pad, y), banner)
    text_y = y + (banner_h - title_h) // 2
    for line in title_lines:
        line_w = draw.textlength(line, font=title_font)
        draw.text(((width - line_w) / 2, text_y), line, font=title_font, fill=(255, 255, 255))
        sample = draw.textbbox((0, 0), line, font=title_font)
        text_y += (sample[3] - sample[1]) + line_gap
    if icon and title_lines:
        icon_font = title_font
        icon_path = r'C:\Windows\Fonts\seguiemj.ttf'
        try:
            import os
            from PIL import ImageFont
            if os.path.isfile(icon_path):
                icon_font = ImageFont.truetype(icon_path, 32)
        except Exception:
            icon_font = title_font
        last = title_lines[-1]
        last_w = draw.textlength(last, font=title_font)
        icon_x = (width + last_w) / 2 + 10
        icon_y = y + 18
        try:
            draw.text((icon_x, icon_y), icon, font=icon_font, embedded_color=True)
        except TypeError:
            draw.text((icon_x, icon_y), icon, font=icon_font, fill=(255, 220, 80))
    y += banner_h + 18

    for section in prepared:
        x0 = pad
        box_h = section['box_h']
        color = section['color']
        draw.rounded_rectangle((x0, y, x0 + inner, y + box_h), radius=14, outline=color, width=3)
        cursor = y
        if section['bar_h']:
            bar = Image.new('RGB', (inner - 6, section['bar_h']), color)
            image.paste(bar, (x0 + 3, y + 3))
            text_y = y + 12
            for line in section['head_lines']:
                line_w = draw.textlength(line, font=section_font)
                draw.text(((width - line_w) / 2, text_y), line, font=section_font, fill=(255, 255, 255))
                sample = draw.textbbox((0, 0), line, font=section_font)
                text_y += (sample[3] - sample[1]) + line_gap
            cursor = y + section['bar_h'] + 8
        else:
            cursor = y + 12
        for wrapped, _height in section['items']:
            dot_y = cursor + 8
            draw.ellipse((x0 + 18, dot_y, x0 + 32, dot_y + 14), fill=color)
            line_y = cursor
            for line in wrapped:
                draw.text((x0 + 42, line_y), line, font=item_font, fill=(36, 48, 64))
                sample = draw.textbbox((0, 0), line, font=item_font)
                line_y += (sample[3] - sample[1]) + line_gap
            cursor = line_y + 4
        for line in section['desc_lines']:
            draw.text((x0 + 18, cursor), line, font=body_font, fill=(44, 62, 80))
            sample = draw.textbbox((0, 0), line, font=body_font)
            cursor += (sample[3] - sample[1]) + line_gap
        if section['desc_lines']:
            cursor += 4
        for line in section['url_lines']:
            draw.text((x0 + 18, cursor), line, font=item_font, fill=(21, 101, 192))
            sample = draw.textbbox((0, 0), line, font=item_font)
            cursor += (sample[3] - sample[1]) + line_gap
        y += box_h + 16

    out = io.BytesIO()
    image.save(out, format='PNG', optimize=True)
    return out.getvalue()


def _font_line_h(font) -> int:
    ascent, descent = font.getmetrics()
    return int(ascent + descent)


def _emoji_font(size: int):
    import os

    from PIL import ImageFont

    path = r'C:\Windows\Fonts\seguiemj.ttf'
    if os.path.isfile(path):
        return ImageFont.truetype(path, size)
    return None


def _is_emoji_char(ch: str) -> bool:
    return ord(ch) >= 0x2190


def _draw_mixed_text(draw, x: int, y: int, text: str, font, fill, emoji_font) -> None:
    if not emoji_font or not any(_is_emoji_char(ch) for ch in text):
        draw.text((x, y), text, font=font, fill=fill)
        return
    cursor = x
    chunk = ''
    emoji_mode = None

    def flush(piece: str, as_emoji: bool) -> None:
        nonlocal cursor
        if not piece:
            return
        if as_emoji:
            try:
                draw.text((cursor, y - 2), piece, font=emoji_font, embedded_color=True)
            except TypeError:
                draw.text((cursor, y - 2), piece, font=emoji_font, fill=fill)
            cursor += int(draw.textlength(piece, font=emoji_font))
            return
        draw.text((cursor, y), piece, font=font, fill=fill)
        cursor += int(draw.textlength(piece, font=font))

    for ch in text:
        mode = _is_emoji_char(ch)
        if emoji_mode is None:
            emoji_mode = mode
        if mode != emoji_mode:
            flush(chunk, bool(emoji_mode))
            chunk = ch
            emoji_mode = mode
        else:
            chunk += ch
    flush(chunk, bool(emoji_mode))


def render_codigos_png(data: dict) -> bytes:
    """Dibuja el resumen de códigos como PNG, con el mismo estilo de la ficha pública."""
    import io

    from PIL import Image, ImageDraw

    width = 980
    pad = 24
    inner = width - pad * 2
    title_font = _load_font(36, True)
    intro_font = _load_font(22, False)
    section_font = _load_font(26, True)
    item_font = _load_font(24, True)
    emoji_font = _emoji_font(22)
    line_gap = 8
    buttons = data.get('buttons') or []
    main_title = ' '.join(str(data.get('main_title') or '').split()).upper()
    intro = ' '.join(str(data.get('intro') or '').split())

    probe = Image.new('RGB', (width, 40), 'white')
    measure = ImageDraw.Draw(probe)

    def block_height(text: str, font, max_width: int) -> tuple[list[str], int]:
        lines = _wrap_words(measure, text, font, max_width)
        if not lines:
            return [], 0
        line_h = _font_line_h(font)
        return lines, len(lines) * (line_h + line_gap) - line_gap

    title_lines, title_h = block_height(main_title, title_font, inner - 40)
    banner_h = max(92, title_h + 40)
    intro_lines, intro_h = block_height(intro, intro_font, inner - 56)
    total = pad + banner_h + 18 + (intro_h + 16 if intro_lines else 0)
    prepared = []
    for button in buttons:
        color = _hex_rgb(button.get('color'))
        heading = ' '.join(str(button.get('title') or '').split()).upper()
        head_lines, head_h = block_height(heading, section_font, inner - 28) if heading else ([], 0)
        bar_h = head_h + 22 if heading else 0
        content_h = 16
        items = []
        for line in button.get('subtitles') or []:
            wrapped, height = block_height(line, item_font, inner - 64)
            if wrapped:
                items.append((wrapped, height))
                content_h += height + 12
        if not items:
            content_h += 8
        content_h = max(content_h, 18)
        box_h = bar_h + content_h + 20
        prepared.append({
            'color': color,
            'head_lines': head_lines,
            'bar_h': bar_h,
            'items': items,
            'box_h': box_h,
        })
        total += box_h + 16
    total += pad

    image = Image.new('RGB', (width, max(total, banner_h + pad * 2)), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    y = pad
    banner = Image.new('RGB', (inner, banner_h), (240, 68, 54))
    gradient = ImageDraw.Draw(banner)
    for row in range(banner_h):
        mix = row / max(banner_h - 1, 1)
        color = (
            int(255 + (240 - 255) * mix),
            int(125 + (68 - 125) * mix),
            int(104 + (54 - 104) * mix),
        )
        gradient.line((0, row, inner, row), fill=color)
    banner.putalpha(_rounded_mask((inner, banner_h), 16))
    image.paste(banner, (pad, y), banner)
    text_y = y + (banner_h - title_h) // 2
    for line in title_lines:
        line_w = draw.textlength(line, font=title_font)
        draw.text(((width - line_w) / 2, text_y), line, font=title_font, fill=(255, 255, 255))
        text_y += _font_line_h(title_font) + line_gap
    y += banner_h + 18
    for line in intro_lines:
        line_w = draw.textlength(line, font=intro_font)
        draw.text(((width - line_w) / 2, y), line, font=intro_font, fill=(52, 73, 94))
        y += _font_line_h(intro_font) + line_gap
    if intro_lines:
        y += 16

    for section in prepared:
        x0 = pad
        box_h = section['box_h']
        color = section['color']
        draw.rounded_rectangle((x0, y, x0 + inner, y + box_h), radius=14, outline=color, width=3)
        if section['bar_h']:
            bar = Image.new('RGB', (inner - 6, section['bar_h']), color)
            image.paste(bar, (x0 + 3, y + 3))
            text_y = y + 12
            for line in section['head_lines']:
                line_w = draw.textlength(line, font=section_font)
                draw.text(((width - line_w) / 2, text_y), line, font=section_font, fill=(255, 255, 255))
                text_y += _font_line_h(section_font) + line_gap
            cursor = y + section['bar_h'] + 10
        else:
            cursor = y + 12
        for wrapped, _height in section['items']:
            dot_y = cursor + 8
            draw.ellipse((x0 + 20, dot_y, x0 + 36, dot_y + 16), fill=color)
            line_y = cursor
            for line in wrapped:
                _draw_mixed_text(draw, x0 + 48, line_y, line, item_font, (36, 48, 64), emoji_font)
                line_y += _font_line_h(item_font) + line_gap
            cursor = line_y + 4
        y += box_h + 16

    out = io.BytesIO()
    image.save(out, format='PNG', optimize=True)
    return out.getvalue()


def render_price_list_png(title: str, rows: list[dict]) -> bytes:
    """Tabla de cuentas y precios, lista para enviarla por Telegram."""
    import io

    from PIL import Image, ImageDraw

    width = 900
    pad = 16
    inner = width - pad * 2
    title_font = _load_font(30, True)
    head_font = _load_font(18, True)
    cell_font = _load_font(20, True)
    line_gap = 3
    name_w = int(inner * 0.52)
    period_w = int(inner * 0.22)
    price_w = inner - name_w - period_w
    cell_pad = 12
    header_h = 36

    probe = Image.new('RGB', (width, 40), 'white')
    measure = ImageDraw.Draw(probe)

    def wrap(text: str, font, max_width: int) -> list[str]:
        return _wrap_words(measure, text, font, max_width) or ['']

    def block_h(lines: list[str], font) -> int:
        if not lines:
            return 0
        line_h = _font_line_h(font)
        return len(lines) * (line_h + line_gap) - line_gap

    title_lines = wrap(str(title or 'Cuentas y precios').upper(), title_font, inner - 40)
    title_h = block_h(title_lines, title_font)
    banner_h = max(64, title_h + 24)
    prepared = []
    table_h = header_h
    for row in rows:
        name_lines = wrap(row.get('name') or 'Cuenta', cell_font, name_w - cell_pad * 2)
        period_lines = wrap(row.get('period') or '', cell_font, period_w - 12)
        price_lines = wrap(row.get('price') or '', cell_font, price_w - cell_pad * 2)
        row_h = max(block_h(name_lines, cell_font), block_h(period_lines, cell_font), block_h(price_lines, cell_font)) + 12
        prepared.append((name_lines, period_lines, price_lines, row_h))
        table_h += row_h
    total = pad + banner_h + 12 + table_h + pad

    image = Image.new('RGB', (width, total), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    y = pad
    banner = Image.new('RGB', (inner, banner_h), (21, 101, 192))
    gradient = ImageDraw.Draw(banner)
    for row_i in range(banner_h):
        mix = row_i / max(banner_h - 1, 1)
        color = (
            int(30 + (21 - 30) * mix),
            int(136 + (101 - 136) * mix),
            int(229 + (192 - 229) * mix),
        )
        gradient.line((0, row_i, inner, row_i), fill=color)
    banner.putalpha(_rounded_mask((inner, banner_h), 16))
    image.paste(banner, (pad, y), banner)
    text_y = y + (banner_h - title_h) // 2
    for line in title_lines:
        line_w = draw.textlength(line, font=title_font)
        draw.text(((width - line_w) / 2, text_y), line, font=title_font, fill=(255, 255, 255))
        text_y += _font_line_h(title_font) + line_gap
    y += banner_h + 12

    x0 = pad
    table_top = y
    draw.rectangle((x0 + 4, y + 4, x0 + inner - 4, y + header_h), fill=(238, 244, 250))
    headers = (('Cuenta', name_w, 'left'), ('Periodo', period_w, 'center'), ('Precio', price_w, 'right'))
    cursor_x = x0
    for label, col_w, align in headers:
        label_w = draw.textlength(label, font=head_font)
        if align == 'center':
            label_x = cursor_x + (col_w - label_w) / 2
        elif align == 'right':
            label_x = cursor_x + col_w - cell_pad - label_w
        else:
            label_x = cursor_x + cell_pad
        draw.text((label_x, y + 8), label, font=head_font, fill=(30, 58, 95))
        cursor_x += col_w
    y += header_h

    for index, (name_lines, period_lines, price_lines, row_h) in enumerate(prepared):
        if index % 2 == 1:
            draw.rectangle((x0 + 4, y + 1, x0 + inner - 4, y + row_h - 1), fill=(248, 250, 252))
        draw.line((x0 + 3, y, x0 + inner - 3, y), fill=(0, 0, 0), width=2)
        columns = (
            (name_lines, name_w, 'left'),
            (period_lines, period_w, 'center'),
            (price_lines, price_w, 'right'),
        )
        cursor_x = x0
        line_h = _font_line_h(cell_font)
        for lines, col_w, align in columns:
            block = block_h(lines, cell_font)
            line_y = y + max(5, (row_h - block) // 2)
            for line in lines:
                line_w = draw.textlength(line, font=cell_font)
                if align == 'center':
                    line_x = cursor_x + (col_w - line_w) / 2
                elif align == 'right':
                    line_x = cursor_x + col_w - cell_pad - line_w
                else:
                    line_x = cursor_x + cell_pad
                draw.text((line_x, line_y), line, font=cell_font, fill=(31, 42, 55))
                line_y += line_h + line_gap
            cursor_x += col_w
        y += row_h
    draw.rounded_rectangle(
        (x0, table_top, x0 + inner, table_top + table_h),
        radius=12,
        outline=(0, 0, 0),
        width=3,
    )

    out = io.BytesIO()
    image.save(out, format='PNG', optimize=True)
    return out.getvalue()


def _load_medios_pago_card() -> dict | None:
    from app.store.html_presets import MEDIOS_DE_PAGO_KEY, parse_medios_pago_payload
    from app.store.models import HtmlInfo

    row = (
        HtmlInfo.query
        .filter(HtmlInfo.preset_key == MEDIOS_DE_PAGO_KEY, HtmlInfo.enabled.is_(True))
        .order_by(HtmlInfo.id.desc())
        .first()
    )
    if not row:
        return None
    return parse_medios_pago_payload(row.text)


def _load_codigos_card() -> dict:
    from app.store.html_presets import RESUMEN_CODIGOS_KEY, _CODIGOS_INTRO, codigos_editor_data
    from app.store.models import HtmlInfo

    row = (
        HtmlInfo.query
        .filter(HtmlInfo.preset_key == RESUMEN_CODIGOS_KEY, HtmlInfo.enabled.is_(True))
        .order_by(HtmlInfo.id.desc())
        .first()
    )
    data = codigos_editor_data(row.text if row else '')
    data['intro'] = _CODIGOS_INTRO
    return data


def _load_pantallas_card() -> dict | None:
    from app.store.html_presets import FOTO_PANTALLAS_KEY, parse_pantallas_payload
    from app.store.models import HtmlInfo

    row = (
        HtmlInfo.query
        .filter(HtmlInfo.preset_key == FOTO_PANTALLAS_KEY, HtmlInfo.enabled.is_(True))
        .order_by(HtmlInfo.id.desc())
        .first()
    )
    if not row:
        return None
    data = parse_pantallas_payload(row.text)
    data['title'] = (row.title or '').strip() or 'Foto de pantallas, perfiles, links de tv'
    if not data.get('rows'):
        return None
    return data


def _pantallas_menu_ready() -> bool:
    return _load_pantallas_card() is not None


def _load_como_trabajo_card(html_id: int | None = None) -> dict | None:
    from app.store.html_presets import (
        COMO_TRABAJO_DEFAULT,
        COMO_TRABAJO_KEY,
        normalize_como_trabajo,
        parse_como_trabajo_payload,
    )
    from app.store.models import HtmlInfo

    query = HtmlInfo.query.filter(
        HtmlInfo.preset_key == COMO_TRABAJO_KEY,
        HtmlInfo.enabled.is_(True),
    )
    if html_id is not None:
        row = query.filter(HtmlInfo.id == int(html_id)).first()
    else:
        row = query.order_by(HtmlInfo.id.desc()).first()
    if not row:
        return None
    data = parse_como_trabajo_payload(row.text)
    if not data:
        data = normalize_como_trabajo(COMO_TRABAJO_DEFAULT)
    data = dict(data)
    data['html_id'] = row.id
    data['title'] = (row.title or '').strip() or data.get('main_title') or _BTN_TRABAJO
    return data


def _como_trabajo_menu_ready() -> bool:
    return _load_como_trabajo_card() is not None


def _load_html_preset_row(html_id: int):
    from app.store.html_presets import COMO_TRABAJO_KEY, FOTO_PANTALLAS_KEY, MEDIOS_DE_PAGO_KEY
    from app.store.models import HtmlInfo

    return (
        HtmlInfo.query
        .filter(
            HtmlInfo.id == int(html_id),
            HtmlInfo.enabled.is_(True),
            HtmlInfo.preset_key.in_((COMO_TRABAJO_KEY, FOTO_PANTALLAS_KEY, MEDIOS_DE_PAGO_KEY)),
        )
        .first()
    )


def _send_html_preset_by_id(token: str, chat_id, html_id: int) -> None:
    """Envía la imagen del HTML de plantilla (pantallas / medios / cómo trabajo)."""
    from app.store.html_presets import COMO_TRABAJO_KEY, FOTO_PANTALLAS_KEY, MEDIOS_DE_PAGO_KEY

    row = _load_html_preset_row(html_id)
    if not row:
        _send_text(token, chat_id, 'Ese contenido ya no está disponible.')
        _send_with_menu(token, chat_id, 'Elige una opción:')
        return
    if row.preset_key == COMO_TRABAJO_KEY:
        data = _load_como_trabajo_card(row.id)
        if not data:
            _send_text(token, chat_id, 'Todavía no hay Cómo trabajo — Guía rápida configurado.')
            _send_with_menu(token, chat_id, 'Elige una opción:')
            return
        png = render_como_trabajo_png(data)
        sent = _send_photo_bytes(token, chat_id, png, 'como-trabajo-guia-rapida.png')
        if not sent.get('ok'):
            _send_text(token, chat_id, 'No se pudo enviar la imagen de Cómo trabajo — Guía rápida.')
        _send_with_menu(token, chat_id, 'Elige una opción:')
        return
    if row.preset_key == FOTO_PANTALLAS_KEY:
        from app.store.html_presets import parse_pantallas_payload

        data = parse_pantallas_payload(row.text)
        data['title'] = (row.title or '').strip() or _BTN_PANTALLAS
        if not data.get('rows'):
            _send_text(token, chat_id, 'Todavía no hay pantallas, perfiles y links de TV configurados.')
            _send_with_menu(token, chat_id, 'Elige una opción:')
            return
        png = render_pantallas_png(data)
        sent = _send_photo_bytes(token, chat_id, png, 'pantallas-perfiles-tv.png')
        if not sent.get('ok'):
            _send_text(token, chat_id, 'No se pudo enviar la imagen de pantallas y perfiles.')
        _send_with_menu(token, chat_id, 'Elige una opción:')
        return
    if row.preset_key == MEDIOS_DE_PAGO_KEY:
        from app.store.html_presets import parse_medios_pago_payload

        data = parse_medios_pago_payload(row.text)
        if not data or not (data.get('main_title') or data.get('sections')):
            _send_text(token, chat_id, 'Todavía no hay Medios De Pago Que Recibo configurado.')
            _send_with_menu(token, chat_id, 'Elige una opción:')
            return
        png = render_medios_pago_png(data)
        sent = _send_photo_bytes(token, chat_id, png)
        if not sent.get('ok'):
            _send_text(token, chat_id, 'No se pudo enviar la imagen de medios de pago.')
        _send_with_menu(token, chat_id, 'Elige una opción:')
        return
    _send_with_menu(token, chat_id, 'Elige una opción:')


def render_como_trabajo_png(data: dict) -> bytes:
    """Ficha de Cómo trabajo como PNG, con flecha en el título y punto negro en los subtítulos."""
    import io

    from PIL import Image, ImageDraw

    width = 820
    pad = 22
    inner = width - pad * 2
    title_font = _load_font(32, True)
    section_font = _load_font(22, True)
    item_font = _load_font(20, True)
    body_font = _load_font(18, False)
    emoji_font = _emoji_font(26)
    section_emoji = _emoji_font(22)
    line_gap = 6
    sections = data.get('sections') or []
    main_title = ' '.join(str(data.get('main_title') or 'Cómo trabajo — Guía rápida').split())
    icon = _medios_pago_icon_text(data.get('main_icon'))

    probe = Image.new('RGB', (width, 40), 'white')
    measure = ImageDraw.Draw(probe)

    def block_height(text: str, font, max_width: int) -> tuple[list[str], int]:
        lines = _wrap_words(measure, text, font, max_width)
        if not lines:
            return [], 0
        sample = measure.textbbox((0, 0), 'Ag', font=font)
        line_h = sample[3] - sample[1]
        return lines, len(lines) * (line_h + line_gap) - line_gap

    title_lines, title_h = block_height(main_title, title_font, inner - 70)
    banner_h = max(84, title_h + 34)
    total = pad + banner_h + 16
    prepared = []
    for section in sections:
        color = _hex_rgb(section.get('color'))
        heading = ' '.join(str(section.get('title') or '').split())
        section_icon = _medios_pago_icon_text(section.get('icon')) if section.get('icon') else ''
        head_lines, head_h = block_height(heading, section_font, inner - 90) if heading else ([], 0)
        bar_h = max(head_h + 20, 46) if heading or section_icon else 0
        content_h = 14
        items = []
        for line in section.get('subtitles') or []:
            wrapped, height = block_height(line, item_font, inner - 64)
            if wrapped:
                items.append((wrapped, height))
                content_h += height + 8
        desc_lines, desc_h = block_height(section.get('description') or '', body_font, inner - 36)
        if desc_lines:
            content_h += desc_h + 8
        content_h = max(content_h, 16)
        box_h = bar_h + content_h + 12
        prepared.append({
            'color': color,
            'icon': section_icon,
            'head_lines': head_lines,
            'bar_h': bar_h,
            'items': items,
            'desc_lines': desc_lines,
            'box_h': box_h,
        })
        total += box_h + 14
    total += pad

    image = Image.new('RGB', (width, max(total, 80)), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    y = pad
    banner = Image.new('RGB', (inner, banner_h), (240, 68, 54))
    gradient = ImageDraw.Draw(banner)
    for row in range(banner_h):
        mix = row / max(banner_h - 1, 1)
        color = (
            int(255 + (240 - 255) * mix),
            int(125 + (68 - 125) * mix),
            int(104 + (54 - 104) * mix),
        )
        gradient.line((0, row, inner, row), fill=color)
    banner.putalpha(_rounded_mask((inner, banner_h), 16))
    image.paste(banner, (pad, y), banner)
    text_y = y + (banner_h - title_h) // 2
    for line in title_lines:
        line_w = draw.textlength(line, font=title_font)
        draw.text(((width - line_w) / 2, text_y), line, font=title_font, fill=(255, 255, 255))
        sample = draw.textbbox((0, 0), line, font=title_font)
        text_y += (sample[3] - sample[1]) + line_gap
    if icon and title_lines and emoji_font:
        last = title_lines[-1]
        last_w = draw.textlength(last, font=title_font)
        icon_x = (width + last_w) / 2 + 12
        try:
            draw.text((icon_x, y + 22), icon, font=emoji_font, embedded_color=True)
        except TypeError:
            draw.text((icon_x, y + 22), icon, font=emoji_font, fill=(255, 255, 255))
    y += banner_h + 16

    for section in prepared:
        x0 = pad
        box_h = section['box_h']
        color = section['color']
        draw.rounded_rectangle((x0, y, x0 + inner, y + box_h), radius=12, outline=color, width=3)
        if section['bar_h']:
            bar = Image.new('RGB', (inner - 6, section['bar_h']), color)
            image.paste(bar, (x0 + 3, y + 3))
            first = section['head_lines'][0] if section['head_lines'] else ''
            first_w = int(draw.textlength(first, font=section_font)) if first else 0
            icon_w = int(draw.textlength(section['icon'], font=section_emoji)) if section['icon'] and section_emoji else 0
            arrow_w = 16
            gap = 8
            pieces = arrow_w
            if icon_w:
                pieces += gap + icon_w
            if first_w:
                pieces += gap + first_w
            start_x = x0 + (inner - pieces) / 2
            arrow_top = y + 14
            draw.polygon(
                [(start_x, arrow_top), (start_x, arrow_top + 16), (start_x + 12, arrow_top + 8)],
                fill=(255, 255, 255),
            )
            cursor_x = start_x + arrow_w + gap
            if section['icon'] and section_emoji:
                try:
                    draw.text((cursor_x, y + 8), section['icon'], font=section_emoji, embedded_color=True)
                except TypeError:
                    draw.text((cursor_x, y + 8), section['icon'], font=section_emoji, fill=(255, 255, 255))
                cursor_x += icon_w + gap
            text_y = y + 10
            for index, line in enumerate(section['head_lines']):
                line_x = cursor_x if index == 0 else x0 + (inner - draw.textlength(line, font=section_font)) / 2
                draw.text((line_x, text_y), line, font=section_font, fill=(255, 255, 255))
                sample = draw.textbbox((0, 0), line, font=section_font)
                text_y += (sample[3] - sample[1]) + line_gap
            cursor = y + section['bar_h'] + 10
        else:
            cursor = y + 12
        for wrapped, _height in section['items']:
            draw.ellipse((x0 + 18, cursor + 6, x0 + 34, cursor + 22), fill=(17, 17, 17))
            line_y = cursor
            for line in wrapped:
                draw.text((x0 + 44, line_y), line, font=item_font, fill=(36, 48, 64))
                sample = draw.textbbox((0, 0), line, font=item_font)
                line_y += (sample[3] - sample[1]) + line_gap
            cursor = line_y + 4
        for line in section['desc_lines']:
            draw.text((x0 + 18, cursor), line, font=body_font, fill=(44, 62, 80))
            sample = draw.textbbox((0, 0), line, font=body_font)
            cursor += (sample[3] - sample[1]) + line_gap
        y += box_h + 14

    out = io.BytesIO()
    image.save(out, format='PNG', optimize=True)
    return out.getvalue()


def _send_como_trabajo_image(token: str, chat_id) -> None:
    data = _load_como_trabajo_card()
    if not data:
        _send_text(token, chat_id, 'Todavía no hay Cómo trabajo — Guía rápida configurado.')
        _send_with_menu(token, chat_id, 'Elige una opción:')
        return
    png = render_como_trabajo_png(data)
    sent = _send_photo_bytes(token, chat_id, png, 'como-trabajo-guia-rapida.png')
    if not sent.get('ok'):
        _send_text(token, chat_id, 'No se pudo enviar la imagen de Cómo trabajo — Guía rápida.')
    _send_with_menu(token, chat_id, 'Elige una opción:')


_TV_PLATE = (0, 0, 0)


def _fetch_favicon_image(page: str):
    import io

    from PIL import Image

    from app.store.html_presets import favicon_url_for

    url = favicon_url_for(page)
    if not url:
        return None
    try:
        response = requests.get(url, timeout=8)
        if response.status_code != 200 or not response.content:
            return None
        return Image.open(io.BytesIO(response.content)).convert('RGBA')
    except Exception:
        return None


def _paste_on_plate(canvas, icon, x: int, y: int, size: int, inset: int) -> None:
    """Placa oscura redondeada con el icono centrado."""
    from PIL import Image, ImageDraw

    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x, y, x + size, y + size), radius=max(8, size // 5), fill=_TV_PLATE)
    if icon is None:
        return
    inner = size - inset * 2
    icon = icon.copy()
    resample = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', Image.LANCZOS)
    icon.thumbnail((inner, inner), resample)
    canvas.paste(icon, (x + (size - icon.width) // 2, y + (size - icon.height) // 2), icon)


def _paste_favicon(canvas, page: str, x: int, y: int, size: int = 60) -> bool:
    icon = _fetch_favicon_image(page)
    if icon is None:
        return False
    _paste_on_plate(canvas, icon, x, y, size, 9)
    return True


def _paste_screen_icon(canvas, name: str, x: int, y: int, size: int = 44) -> None:
    import os

    from flask import current_app

    from app.store.icon_tools import dark_screen_icon

    path = os.path.join(current_app.static_folder, 'images', name or '')
    # Pedir icono más grande que el slot para que al reducir quede nítido.
    icon = dark_screen_icon(path, max(160, size * 3))
    if icon is None:
        return
    _paste_on_plate(canvas, icon, x, y, size, max(6, size // 10))


def render_pantallas_png(data: dict) -> bytes:
    """Tabla de pantallas y perfiles como PNG nítido para Telegram."""
    import io

    from PIL import Image, ImageDraw

    from app.store.html_presets import (
        _tv_perfiles_label,
        favicon_source_page,
        resolve_row_screen_icons,
    )

    # Más resolución + tipografía grande: se ve nítida al abrir a tamaño real.
    width = 1800
    pad = 24
    inner = width - pad * 2
    head_font = _load_font(26, True)
    cell_font = _load_font(24, True)
    line_gap = 4
    icon_w = 200
    rest = inner - icon_w
    col_w = [icon_w, int(rest * 0.28), int(rest * 0.16), int(rest * 0.28)]
    col_w.append(inner - sum(col_w))
    headers = ('PLATAFORMA', 'PANTALLAS', 'PERFILES', 'PAGINA OFICIAL', 'ACTIVACION TELEVISOR')
    keys = ('pantallas', 'perfiles', 'pagina', 'activacion')
    fav_size = 84
    logo_size = 84
    gap = 10

    head_a = (30, 58, 138)
    head_b = (37, 99, 235)
    accent = (30, 58, 138)
    grid = (201, 214, 238)
    row_a = (255, 255, 255)
    row_b = (232, 240, 251)
    text_color = (15, 27, 51)
    link_color = (13, 71, 161)

    probe = Image.new('RGB', (width, 40), 'white')
    measure = ImageDraw.Draw(probe)

    def wrap(text: str, font, max_width: int) -> list[str]:
        return _wrap_words(measure, text, font, max_width) or ['----------']

    def block_h(lines: list[str], font) -> int:
        line_h = _font_line_h(font)
        return len(lines) * (line_h + line_gap) - line_gap

    def cell_text(row: dict, key: str) -> str:
        if key == 'perfiles':
            return _tv_perfiles_label(row.get(key) or '') or '----------'
        return row.get(key) or '----------'

    header_h = 72
    prepared = []
    table_h = header_h
    for row in data.get('rows') or []:
        cells = []
        heights = []
        for index, key in enumerate(keys):
            lines = wrap(cell_text(row, key), cell_font, col_w[index + 1] - 24)
            cells.append(lines)
            heights.append(block_h(lines, cell_font))
        icons = resolve_row_screen_icons(row)[:2]
        fav_page = '' if icons else favicon_source_page(row)
        stack_h = (fav_size if fav_page else 0) + (logo_size if icons else 0) + (gap if fav_page and icons else 0)
        row_h = max(heights + [stack_h, 72]) + 28
        prepared.append((row, cells, row_h, fav_page, icons, stack_h))
        table_h += row_h
    total = pad * 2 + table_h

    image = Image.new('RGB', (width, total), (240, 244, 251))
    draw = ImageDraw.Draw(image)
    y = pad
    table_top = y
    for step in range(inner):
        ratio = step / max(1, inner - 1)
        color = tuple(int(head_a[i] + (head_b[i] - head_a[i]) * ratio) for i in range(3))
        draw.line((pad + step, y, pad + step, y + header_h), fill=color)
    draw.line((pad, y + header_h - 3, pad + inner, y + header_h - 3), fill=accent, width=4)
    cursor_x = pad
    for index, label in enumerate(headers):
        if label:
            label_w = draw.textlength(label, font=head_font)
            draw.text((cursor_x + (col_w[index] - label_w) / 2, y + 22), label, font=head_font, fill=(255, 255, 255))
        cursor_x += col_w[index]
    y += header_h
    for number, (row, cells, row_h, fav_page, icons, stack_h) in enumerate(prepared):
        draw.rectangle((pad, y, pad + inner, y + row_h), fill=row_a if number % 2 == 0 else row_b)
        stack_y = y + (row_h - stack_h) // 2
        if fav_page:
            fav_x = pad + (col_w[0] - fav_size) // 2
            if not _paste_favicon(image, fav_page, fav_x, stack_y, fav_size):
                _paste_on_plate(image, None, fav_x, stack_y, fav_size, 12)
            stack_y += fav_size + (gap if icons else 0)
        if icons:
            span = len(icons) * logo_size + (len(icons) - 1) * gap
            icon_x = pad + (col_w[0] - span) // 2
            for name in icons:
                _paste_screen_icon(image, name, icon_x, stack_y, logo_size)
                icon_x += logo_size + gap
        if not fav_page and not icons:
            dash_w = draw.textlength('----------', font=cell_font)
            draw.text((pad + (col_w[0] - dash_w) / 2, y + (row_h - _font_line_h(cell_font)) / 2), '----------', font=cell_font, fill=(91, 107, 134))
        cursor_x = pad + col_w[0]
        for index, lines in enumerate(cells):
            block = block_h(lines, cell_font)
            line_y = y + max(12, (row_h - block) // 2)
            is_link = keys[index] in ('pagina', 'activacion') and (row.get(keys[index]) or '').strip()
            for line in lines:
                line_w = draw.textlength(line, font=cell_font)
                line_x = cursor_x + (col_w[index + 1] - line_w) / 2
                draw.text((line_x, line_y), line, font=cell_font, fill=link_color if is_link else text_color)
                if is_link:
                    under_y = line_y + _font_line_h(cell_font) - 2
                    draw.line((line_x, under_y, line_x + line_w, under_y), fill=link_color, width=2)
                line_y += _font_line_h(cell_font) + line_gap
            cursor_x += col_w[index + 1]
        y += row_h
    cursor_y = table_top + header_h
    for _row, _cells, row_h, _fav, _icons, _stack in prepared:
        cursor_y += row_h
        if cursor_y < table_top + table_h:
            draw.line((pad, cursor_y, pad + inner, cursor_y), fill=grid, width=1)
    cursor_x = pad
    for col in col_w[:-1]:
        cursor_x += col
        draw.line((cursor_x, table_top, cursor_x, table_top + table_h), fill=grid, width=1)
    draw.rounded_rectangle((pad, table_top, pad + inner, table_top + table_h), radius=18, outline=(185, 199, 226), width=3)
    out = io.BytesIO()
    # PNG sin pérdida; compress_level bajo = más nitidez al abrir el archivo original.
    image.save(out, format='PNG', optimize=False, compress_level=1)
    return out.getvalue()


def _send_pantallas_image(token: str, chat_id) -> None:
    data = _load_pantallas_card()
    if not data:
        _send_text(token, chat_id, 'Todavía no hay pantallas, perfiles y links de TV configurados.')
        _send_with_menu(token, chat_id, 'Elige una opción:')
        return
    png = render_pantallas_png(data)
    sent = _send_photo_bytes(token, chat_id, png, 'pantallas-perfiles-tv.png')
    if not sent.get('ok'):
        _send_text(token, chat_id, 'No se pudo enviar la imagen de pantallas y perfiles.')
    _send_with_menu(token, chat_id, 'Elige una opción:')


def _send_photo_bytes(token: str, chat_id, png: bytes, filename: str = 'medios-de-pago.png') -> dict:
    """Envía PNG como documento para que Telegram no recomprima (máxima calidad)."""
    clean = (token or '').strip()
    if not clean:
        return {'ok': False, 'description': 'sin token'}
    try:
        response = requests.post(
            f'https://api.telegram.org/bot{clean}/sendDocument',
            data={'chat_id': chat_id},
            files={'document': (filename, png, 'image/png')},
            timeout=60,
        )
        data = response.json()
    except Exception:
        return {'ok': False, 'description': 'network'}
    if isinstance(data, dict) and data.get('ok'):
        return {'ok': True, 'result': data.get('result')}
    description = ''
    if isinstance(data, dict):
        description = str(data.get('description') or '')
    return {'ok': False, 'description': description}


def _send_medios_pago_image(token: str, chat_id) -> None:
    data = _load_medios_pago_card()
    if not data or not (data.get('main_title') or data.get('sections')):
        _send_text(token, chat_id, 'Todavía no hay Medios De Pago Que Recibo configurado.')
        _send_with_menu(token, chat_id, 'Elige una opción:')
        return
    png = render_medios_pago_png(data)
    sent = _send_photo_bytes(token, chat_id, png)
    if not sent.get('ok'):
        _send_text(token, chat_id, 'No se pudo enviar la imagen de medios de pago.')
    _send_with_menu(token, chat_id, 'Elige una opción:')


def _send_codigos_image(token: str, chat_id) -> None:
    data = _load_codigos_card()
    buttons = [button for button in (data.get('buttons') or []) if button.get('title')]
    if not buttons:
        _send_text(token, chat_id, 'No hay botones de códigos con descripción.')
        _send_with_menu(token, chat_id, 'Elige una opción:')
        return
    data = {**data, 'buttons': buttons}
    png = render_codigos_png(data)
    sent = _send_photo_bytes(token, chat_id, png, 'resumen-codigos.png')
    if not sent.get('ok'):
        _send_text(token, chat_id, 'No se pudo enviar la imagen del resumen de códigos.')
    _send_with_menu(token, chat_id, 'Elige una opción:')


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


def _button_sent_recently(chat_id, action: str) -> bool:
    """True si ese botón ya se envió a este chat hace menos de 2 minutos."""
    now = time.monotonic()
    key = (str(chat_id), action)
    with _recent_button_lock:
        stale = [item for item, sent_at in _recent_button_sends.items() if now - sent_at >= _REPEAT_SECONDS]
        for item in stale:
            _recent_button_sends.pop(item, None)
        sent_at = _recent_button_sends.get(key)
        if sent_at is not None and now - sent_at < _REPEAT_SECONDS:
            return True
        _recent_button_sends[key] = now
        return False


def _forget_button_send(chat_id, action: str) -> None:
    with _recent_button_lock:
        _recent_button_sends.pop((str(chat_id), action), None)


def _take_pending_code_search(chat_id):
    with _pending_code_lock:
        return _pending_code_search.pop(str(chat_id), None)


def _get_code_email(chat_id) -> str:
    with _code_email_lock:
        return str(_code_email_by_chat.get(str(chat_id), '') or '').strip()


def _save_code_email(chat_id, email: str) -> str:
    clean = re.sub(r'\s+', '', str(email or '').strip())
    with _code_email_lock:
        if clean:
            _code_email_by_chat[str(chat_id)] = clean
        else:
            _code_email_by_chat.pop(str(chat_id), None)
    return clean


def _looks_like_email(text: str) -> bool:
    raw = (text or '').strip()
    if '@' not in raw or ' ' in raw:
        return False
    local, _, domain = raw.partition('@')
    return bool(local) and '.' in domain and len(raw) <= 254


def _drop_pending_code_prompt(token: str, chat_id) -> None:
    entry = _take_pending_code_search(chat_id)
    if isinstance(entry, dict) and entry.get('prompt_id'):
        _telegram_call(token, 'deleteMessage', {
            'chat_id': chat_id,
            'message_id': entry['prompt_id'],
        })


def _unwrap_result_code(raw: str) -> str:
    text = str(raw or '').strip()
    marker = '/admin/redirect_to?url='
    index = text.find(marker)
    if index < 0:
        return text
    from urllib.parse import unquote

    tail = text[index + len(marker):].split('"')[0].split("'")[0]
    return unquote(tail).strip() or text


def _code_item(code: str, date: str = ''):
    clean = _unwrap_result_code(code)
    if not clean:
        return None
    link = ''
    if re.match(r'^https?://', clean, re.I):
        link = clean
    elif clean.lower().startswith('www.'):
        link = 'https://' + clean
    return {
        'code': clean,
        'date': str(date or '').replace('|', ' ').strip(),
        'link': link,
    }


def _plain_from_mail(mail: dict) -> str:
    text = str(mail.get('text') or '').strip()
    if text:
        return text
    html = str(mail.get('html') or '')
    if not html:
        return ''
    cleaned = re.sub(r'(?is)<(script|style).*?>.*?</\1>', ' ', html)
    cleaned = re.sub(r'(?s)<[^>]+>', ' ', cleaned)
    return re.sub(r'\s+', ' ', cleaned).strip()


def _items_from_mail(mail: dict) -> list:
    if not isinstance(mail, dict):
        return []
    if mail.get('is_sms_result'):
        items = []
        for msg in mail.get('sms_messages') or []:
            item = _code_item(msg.get('message_body'), msg.get('created_at'))
            if item:
                items.append(item)
        return items
    date = mail.get('formatted_date') or ''
    if mail.get('filter_matched'):
        code = str(mail.get('filter_code') or '').strip()
        source = code or _plain_from_mail(mail)[:800]
        item = _code_item(source, date) if source else None
        return [item] if item else []
    matches = mail.get('regex_matches') or {}
    if isinstance(matches, dict):
        for values in matches.values():
            if not isinstance(values, list) or not values:
                continue
            first = values[0]
            if isinstance(first, list):
                first = ''.join(str(part) for part in first)
            item = _code_item(first, date)
            return [item] if item else []
    plain = _plain_from_mail(mail)
    item = _code_item(plain[:800], date) if plain else None
    return [item] if item else []


def _json_from_response(resp) -> dict:
    getter = getattr(resp, 'get_json', None)
    if not callable(getter):
        return {}
    data = getter(silent=True)
    return data if isinstance(data, dict) else {}


def _lookup_code(user, service: dict, email: str):
    """Misma búsqueda que la página de códigos para ese usuario y servicio."""
    from flask import session

    from app.api import (
        _email_reserved_for_other_user,
        _is_support_user,
        _user_has_allowed_email,
        get_2fa_code_for_email,
        search_sms_messages,
    )
    from app.services.search_service import search_and_apply_filters, search_linked_projects_only

    email_raw = (email or '').strip()
    if not email_raw:
        return 'Escribe el correo.', []
    email_normalized = email_raw.lower()

    def twofa_items() -> list:
        if not service.get('sms'):
            return []
        try:
            with current_app.test_request_context():
                session['user_id'] = user.id
                session['logged_in'] = True
                resp = get_2fa_code_for_email(email_normalized)
            data = _json_from_response(resp)
            code = str(data.get('code') or '').strip()
            if not code:
                return []
            item = _code_item(code, '2FA')
            if not item:
                return []
            secret = ''
            try:
                from app.store.models import TwoFAConfig

                configs = TwoFAConfig.query.filter(TwoFAConfig.is_enabled == True).all()
                for cfg in configs:
                    emails_list = [str(e or '').strip().lower() for e in (cfg.get_emails_list() or [])]
                    if email_normalized in emails_list:
                        secret = str(cfg.secret_key or '').strip().upper().replace(' ', '').replace('-', '')
                        break
            except Exception:
                logger.exception('telegram 2fa secret')
            if secret:
                item['totp_secret'] = secret
            return [item]
        except Exception:
            logger.exception('telegram 2fa')
            return []

    if service.get('sms'):
        with current_app.test_request_context():
            resp = search_sms_messages(email_raw, user)
        payload = _json_from_response(resp)
        if payload.get('error'):
            return str(payload['error']), []
        results = payload.get('results') or []
        items = _items_from_mail(results[0]) if results else []
        items.extend(twofa_items())
        if not items:
            return 'No se encontraron mensajes.', []
        return '', items

    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    is_admin = user.username == admin_username and user.parent_id is None
    if not is_admin and not user.enabled:
        return 'Tu cuenta está inhabilitada. No puedes realizar búsquedas.', []
    if not is_admin:
        if not _is_support_user(user) and _email_reserved_for_other_user(user, email_normalized):
            return 'No tienes permiso al consultar este correo.', []
        if not user.can_search_any and not _user_has_allowed_email(user, email_normalized):
            linked = search_linked_projects_only(email_raw, user, service_id=service['id'])
            items = _items_from_mail(linked) if linked else []
            if items:
                return '', items
            return 'No tienes permiso al consultar este correo.', []

    mail = search_and_apply_filters(email_raw, service['id'], user=user)
    items = _items_from_mail(mail) if mail else []
    if not items:
        return 'No se encontraron resultados.', []
    return '', items


def _items_rich_html(items: list) -> str:
    """Códigos, fecha y 2FA centrados. El secreto no sale en el mensaje."""
    import pyotp

    now = int(time.time())
    blocks = []
    for item in items:
        code = item['code']
        date = item.get('date') or ''
        secret = item.get('totp_secret') or ''
        if secret:
            code = pyotp.TOTP(secret).at(now)
            remaining = 30 - (now % 30)
            date = f'2FA · {remaining} s'
        shown = code if len(code) <= 50 else code[:47] + '...'
        block = _rich_title(shown)
        buttons = ''
        if len(code) <= 256:
            buttons += f'<tg-button type="copy_text" text="{_html_text(code)}">Copiar</tg-button>'
        link = item.get('link') or ''
        if link and len(link) <= 2000:
            buttons += f'<tg-button type="url" url="{_html_text(link)}">Abrir Enlace</tg-button>'
        if buttons:
            block += f'<tg-button-row align="center">{buttons}</tg-button-row>'
        if date:
            block += _rich_center_html(_html_text(date))
        blocks.append(block)
    return ''.join(blocks)


def _start_twofa_ticker(token: str, chat_id, message_id, items: list) -> None:
    """Actualiza el código 2FA y los segundos que faltan. Se detiene al cabo de un minuto y medio."""
    if not message_id or not any(item.get('totp_secret') for item in items):
        return
    stamp = time.time()
    with _twofa_watch_lock:
        _twofa_watch[str(chat_id)] = stamp

    def run() -> None:
        last = ''
        for _ in range(90):
            time.sleep(1)
            with _twofa_watch_lock:
                if _twofa_watch.get(str(chat_id)) != stamp:
                    return
            html = _items_rich_html(items)
            if html == last:
                continue
            last = html
            result = _telegram_call(token, 'editMessageText', {
                'chat_id': chat_id,
                'message_id': message_id,
                'rich_message': {'html': html, 'skip_entity_detection': True},
            })
            if result.get('ok'):
                continue
            desc = (result.get('description') or '').lower()
            if 'not modified' in desc:
                continue
            return

    threading.Thread(target=run, daemon=True, name='tg-2fa').start()


def _send_code_items(token: str, chat_id, items: list) -> None:
    """Resultados de códigos: valor, Copiar y fecha centrados."""
    html = _items_rich_html(items)
    sent = _telegram_call(token, 'sendRichMessage', {
        'chat_id': chat_id,
        'rich_message': {'html': html, 'skip_entity_detection': True},
    })
    if sent.get('ok'):
        result = sent.get('result') if isinstance(sent.get('result'), dict) else {}
        _start_twofa_ticker(token, chat_id, result.get('message_id'), items)
        return
    for item in items:
        code = item['code']
        text = code
        if item.get('date'):
            text += f"\nFecha: {item['date']}"
        markup = None
        row = []
        if len(code) <= 256:
            row.append({'text': 'Copiar', 'copy_text': {'text': code}})
        link = item.get('link') or ''
        if link and len(link) <= 2000:
            row.append({'text': 'Abrir Enlace', 'url': link})
        if row:
            markup = {'inline_keyboard': [row]}
        _send_text(token, chat_id, text, markup)


def _run_code_search(token: str, chat_id, service_id: int, email: str, prompt_id=None) -> None:
    """Busca códigos con el correo guardado o recién escrito."""
    user = _enabled_user_for_chat(chat_id)
    service = _code_service_by_id(int(service_id))
    if user is None or service is None:
        if prompt_id:
            _telegram_call(token, 'deleteMessage', {'chat_id': chat_id, 'message_id': prompt_id})
        return
    clean = _save_code_email(chat_id, email)
    try:
        message, items = _lookup_code(user, service, clean)
    except Exception:
        db.session.rollback()
        logger.exception('telegram code search')
        message, items = 'No se pudo completar esa opción. Intentalo de nuevo.', []
    if prompt_id:
        _telegram_call(token, 'deleteMessage', {'chat_id': chat_id, 'message_id': prompt_id})
    _delete_previous_menus(token, chat_id)
    if items:
        _send_code_items(token, chat_id, items)
        _send_with_menu(token, chat_id, 'Elige una opción:')
        return
    _send_centered_notice(token, chat_id, message or 'No se encontraron resultados.')
    _send_with_menu(token, chat_id, 'Elige una opción:')


def _begin_code_service_search(token: str, chat_id, service_id: int) -> None:
    """Usa el correo del campo si ya está; si no, pide el correo."""
    button = _menu_button(f'svc:{int(service_id)}')
    if button is None or not button['enabled']:
        return
    if _enabled_user_for_chat(chat_id) is None:
        return
    service = _code_service_by_id(service_id)
    if service is None:
        return
    saved = _get_code_email(chat_id)
    menu_user = _enabled_user_for_chat(chat_id)
    if menu_user is not None and not _menu_allowed_for_user(menu_user, f'svc:{int(service_id)}'):
        _send_centered_notice(token, chat_id, 'No tienes permiso para usar esa opción.')
        return
    if saved:
        _run_code_search(token, chat_id, int(service_id), saved)
        return
    sent = _send_text(token, chat_id, button['label'], reply_markup={
        'force_reply': True,
        'input_field_placeholder': _CODE_FIELD,
        'selective': True,
    })
    if not sent.get('ok'):
        sent = _send_text(token, chat_id, service['name'], reply_markup={'force_reply': True})
    if not sent.get('ok'):
        return
    result = sent.get('result') if isinstance(sent.get('result'), dict) else {}
    prompt_id = result.get('message_id')
    with _pending_code_lock:
        previous = _pending_code_search.get(str(chat_id))
        _pending_code_search[str(chat_id)] = {
            'service_id': int(service_id),
            'prompt_id': prompt_id,
        }
    if isinstance(previous, dict) and previous.get('prompt_id') and previous.get('prompt_id') != prompt_id:
        _telegram_call(token, 'deleteMessage', {
            'chat_id': chat_id,
            'message_id': previous['prompt_id'],
        })


def _finish_code_search(token: str, chat_id, email: str) -> None:
    entry = _take_pending_code_search(chat_id)
    if not isinstance(entry, dict):
        return
    _run_code_search(
        token,
        chat_id,
        int(entry.get('service_id') or 0),
        email,
        prompt_id=entry.get('prompt_id'),
    )


def _handle_menu_callback(token: str, callback: dict) -> None:
    query_id = callback.get('id')

    def answer(text: str | None = None) -> None:
        if not query_id:
            return
        payload = {'callback_query_id': query_id}
        if text:
            payload['text'] = text
        _telegram_call(token, 'answerCallbackQuery', payload)

    action = str(callback.get('data') or '').strip()
    service_match = re.fullmatch(r'svc:(\d+)', action)
    html_match = re.fullmatch(r'html:(\d+)', action)
    known = ('id', 'prices', 'codes', 'pantallas', 'pagos', 'trabajo', 'ad', 'codes_section')
    if service_match is None and html_match is None and action not in known:
        answer()
        return
    sender = callback.get('from') if isinstance(callback.get('from'), dict) else {}
    message = callback.get('message') if isinstance(callback.get('message'), dict) else {}
    chat = message.get('chat') if isinstance(message.get('chat'), dict) else {}
    if sender.get('is_bot') or chat.get('type') != 'private':
        answer()
        return
    chat_id = chat.get('id')
    if chat_id is None:
        answer()
        return
    if action == 'codes_section':
        answer()
        return
    if service_match is not None:
        _begin_code_service_search(token, chat_id, int(service_match.group(1)))
        answer()
        return
    clicked_id = message.get('message_id')
    outcome = _dispatch_private_menu(token, chat_id, action)
    if outcome == 'repeat':
        answer('Ya te lo envié. Espera un par de minutos para pedirlo otra vez.')
        return
    answer()
    if outcome != 'sent':
        return
    current_id = _last_menu_message.get(str(chat_id))
    if clicked_id and clicked_id != current_id:
        _telegram_call(token, 'deleteMessage', {'chat_id': chat_id, 'message_id': clicked_id})


def _dispatch_private_menu(token: str, chat_id, text: str) -> str:
    known = ('start', 'id', 'prices', 'codes', 'pantallas', 'pagos', 'trabajo', 'ad')
    raw = str(text or '')
    action = text if text in known or raw.startswith('svc:') or raw.startswith('html:') else _menu_action(text)
    if not action:
        return 'skip'
    menu_user = _enabled_user_for_chat(chat_id)
    linked = _linked_user_for_chat(chat_id)
    if linked is not None and getattr(linked, 'parent_id', None) and menu_user is None:
        _send_centered_notice(token, chat_id, 'No tienes permiso para usar el bot.')
        return 'sent'
    if menu_user is not None and not _menu_allowed_for_user(menu_user, action):
        _send_centered_notice(token, chat_id, 'No tienes permiso para usar esa opción.')
        return 'sent'
    if not _menu_key_enabled(action):
        return 'skip'
    if str(action).startswith('svc:'):
        try:
            _begin_code_service_search(token, chat_id, int(str(action).split(':', 1)[1]))
        except Exception:
            logger.exception('telegram menu %s', action)
            _telegram_call(
                token,
                'sendMessage',
                {'chat_id': chat_id, 'text': 'No se pudo completar esa opción. Intentalo de nuevo.'},
            )
        return 'sent'
    if str(action).startswith('html:'):
        if _button_sent_recently(chat_id, action):
            return 'repeat'
        try:
            _send_html_preset_by_id(token, chat_id, int(str(action).split(':', 1)[1]))
        except Exception:
            _forget_button_send(chat_id, action)
            logger.exception('telegram menu %s', action)
            _telegram_call(
                token,
                'sendMessage',
                {'chat_id': chat_id, 'text': 'No se pudo completar esa opción. Intentalo de nuevo.'},
            )
        return 'sent'
    if _button_sent_recently(chat_id, action):
        return 'repeat'
    try:
        if action == 'start':
            _send_start_menu(token, chat_id)
        elif action == 'id':
            reply_with_chat_id(token, chat_id)
        elif action == 'prices':
            _send_price_list(token, chat_id)
        elif action == 'codes':
            _send_codigos_image(token, chat_id)
        elif action == 'pantallas':
            if _pantallas_menu_ready():
                _send_pantallas_image(token, chat_id)
            else:
                _send_with_menu(token, chat_id, 'Elige una opción:')
        elif action == 'pagos':
            if _medios_pago_menu_ready():
                _send_medios_pago_image(token, chat_id)
            else:
                _send_with_menu(token, chat_id, 'Elige una opción:')
        elif action == 'trabajo':
            if _como_trabajo_menu_ready():
                _send_como_trabajo_image(token, chat_id)
            else:
                _send_with_menu(token, chat_id, 'Elige una opción:')
        elif action == 'ad':
            _send_ad_invite(token, chat_id)
    except Exception:
        _forget_button_send(chat_id, action)
        logger.exception('telegram menu %s', action)
        _telegram_call(
            token,
            'sendMessage',
            {'chat_id': chat_id, 'text': 'No se pudo completar esa opción. Intentalo de nuevo.'},
        )
    return 'sent'


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
        text = str(msg.get('text') or '')
        chat_id = chat.get('id')
        if chat_id is None:
            continue
        if _menu_action(text):
            _drop_pending_code_prompt(token, chat_id)
            _dispatch_private_menu(token, chat_id, text)
            continue
        pending_text = text.strip()
        if pending_text and not pending_text.startswith('/'):
            with _pending_code_lock:
                waiting = str(chat_id) in _pending_code_search
            if waiting:
                _finish_code_search(token, chat_id, pending_text)
                continue
            if _looks_like_email(pending_text) and _enabled_user_for_chat(chat_id) is not None:
                _save_code_email(chat_id, pending_text)
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
