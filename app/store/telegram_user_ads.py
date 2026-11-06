# -*- coding: utf-8 -*-
"""Lee publicidad nueva desde grupos de una cuenta personal de Telegram."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
from datetime import datetime

from sqlalchemy import text

from app.extensions import db
from app.services.imap_crypto import decrypt_password, encrypt_password

logger = logging.getLogger(__name__)

_MAX_PER_CHAT = 15
_URL_RE = re.compile(r'(https?://\S+|www\.\S+|t\.me/\S+)', re.I)
_HASH_RE = re.compile(r'#\w+')
_SPACE_RE = re.compile(r'[ \t]{2,}')
_BLANK_RE = re.compile(r'\n{3,}')


def ensure_telegram_personal_schema() -> None:
    from app.store.drive_manager import ensure_drive_telegram_columns

    ensure_drive_telegram_columns()
    dialect = getattr(db.engine.dialect, 'name', '') or ''
    if dialect == 'postgresql':
        ddl = """
            CREATE TABLE IF NOT EXISTS telegram_personal_accounts (
                id SERIAL PRIMARY KEY,
                api_id INTEGER,
                api_hash_enc TEXT,
                phone VARCHAR(32),
                session_enc TEXT,
                phone_code_hash TEXT,
                updated_at TIMESTAMP WITHOUT TIME ZONE
            )
        """
    else:
        ddl = """
            CREATE TABLE IF NOT EXISTS telegram_personal_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                api_id INTEGER,
                api_hash_enc TEXT,
                phone VARCHAR(32),
                session_enc TEXT,
                phone_code_hash TEXT,
                updated_at DATETIME
            )
        """
    with db.engine.begin() as conn:
        conn.execute(text(ddl))
    _ensure_source_chats_column()


def _ensure_source_chats_column() -> None:
    from sqlalchemy import inspect

    inspector = inspect(db.engine)
    if 'telegram_personal_accounts' not in inspector.get_table_names():
        return
    cols = {column['name'] for column in inspector.get_columns('telegram_personal_accounts')}
    if 'source_chats' in cols:
        return
    with db.engine.begin() as conn:
        conn.execute(text('ALTER TABLE telegram_personal_accounts ADD COLUMN source_chats TEXT'))


def _row():
    ensure_telegram_personal_schema()
    result = db.session.execute(text(
        'SELECT id, api_id, api_hash_enc, phone, session_enc, phone_code_hash, source_chats '
        'FROM telegram_personal_accounts ORDER BY id ASC LIMIT 1'
    )).mappings().first()
    return dict(result) if result else None


def account_status() -> dict:
    row = _row()
    empty = {'connected': False, 'waiting_code': False, 'phone': '', 'api_id': '', 'api_hash': '', 'source_chats': ''}
    if not row:
        return empty
    api_hash = ''
    if row.get('api_hash_enc'):
        try:
            api_hash = decrypt_password(row['api_hash_enc'])
        except Exception:
            api_hash = ''
    connected = bool(row.get('session_enc')) and not row.get('phone_code_hash')
    return {
        'connected': connected,
        'waiting_code': bool(row.get('phone_code_hash')),
        'phone': row.get('phone') or '',
        'api_id': '' if row.get('api_id') is None else str(row.get('api_id')),
        'api_hash': api_hash,
        'source_chats': row.get('source_chats') or '',
    }


def _save_row(api_id, api_hash_enc, phone, session_enc, phone_code_hash) -> None:
    ensure_telegram_personal_schema()
    current = _row()
    now = datetime.utcnow().isoformat(sep=' ', timespec='seconds')
    if current:
        db.session.execute(text(
            'UPDATE telegram_personal_accounts SET api_id=:api_id, api_hash_enc=:api_hash_enc, '
            'phone=:phone, session_enc=:session_enc, phone_code_hash=:phone_code_hash, updated_at=:updated_at '
            'WHERE id=:id'
        ), {
            'id': current['id'],
            'api_id': api_id,
            'api_hash_enc': api_hash_enc,
            'phone': phone,
            'session_enc': session_enc,
            'phone_code_hash': phone_code_hash,
            'updated_at': now,
        })
    else:
        db.session.execute(text(
            'INSERT INTO telegram_personal_accounts '
            '(api_id, api_hash_enc, phone, session_enc, phone_code_hash, updated_at) '
            'VALUES (:api_id, :api_hash_enc, :phone, :session_enc, :phone_code_hash, :updated_at)'
        ), {
            'api_id': api_id,
            'api_hash_enc': api_hash_enc,
            'phone': phone,
            'session_enc': session_enc,
            'phone_code_hash': phone_code_hash,
            'updated_at': now,
        })
    db.session.commit()


def _run(coro):
    import threading

    box = {}

    def _target():
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            box['result'] = loop.run_until_complete(coro)
        except Exception as exc:
            box['error'] = exc
        finally:
            loop.close()

    thread = threading.Thread(target=_target, daemon=True)
    thread.start()
    thread.join()
    if box.get('error') is not None:
        raise box['error']
    return box.get('result')


def _login_error_message(exc: Exception) -> str:
    name = type(exc).__name__
    text = str(exc).lower()
    if 'apiidinvalid' in name.lower() or 'api_id_invalid' in text:
        return 'El api_id o el api_hash no coinciden. Cópialos de nuevo en my.telegram.org.'
    if 'phonenumberinvalid' in name.lower():
        return 'El teléfono no es válido. Escríbelo con + y el código del país, sin espacios.'
    if 'flood' in name.lower() or 'flood' in text:
        return 'Telegram pidió esperar un momento antes de enviar otro código.'
    if 'phone' in name.lower() and 'banned' in name.lower():
        return 'Telegram no puede enviar el código a ese número.'
    if 'connection' in name.lower() or 'timeout' in name.lower() or 'network' in text:
        return 'No hubo conexión con Telegram. Revisa internet y vuelve a intentar.'
    logger.warning('Pedido de código Telegram falló: %s', name)
    return 'Telegram no envió el código. Revisa el api_id, el api_hash y el teléfono.'


def start_login(api_id: str, api_hash: str, phone: str) -> dict:
    api_id = (api_id or '').strip()
    api_hash = (api_hash or '').strip()
    phone = (phone or '').strip()
    if not api_id.isdigit() or not api_hash or not phone.startswith('+'):
        return {'ok': False, 'message': 'Hace falta el api_id, el api_hash y el teléfono con +.'}
    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
    except Exception:
        return {'ok': False, 'message': 'Falta instalar Telethon en el servidor.'}

    async def _send():
        client = TelegramClient(StringSession(), int(api_id), api_hash)
        await client.connect()
        try:
            sent = await client.send_code_request(phone)
            return client.session.save(), sent.phone_code_hash
        finally:
            await client.disconnect()

    try:
        session, code_hash = _run(_send())
    except Exception as exc:
        return {'ok': False, 'message': _login_error_message(exc)}
    _save_row(int(api_id), encrypt_password(api_hash), phone, encrypt_password(session), code_hash)
    return {'ok': True, 'message': 'Código enviado.'}


def confirm_login(code: str, password: str | None = None) -> dict:
    row = _row()
    if not row or not row.get('phone_code_hash') or not row.get('session_enc'):
        return {'ok': False, 'message': 'Primero pide el código.'}
    code = (code or '').strip()
    password = (password or '').strip()
    if not code and not password:
        return {'ok': False, 'message': 'Escribe el código que llegó a Telegram.'}
    try:
        from telethon import TelegramClient
        from telethon.errors import SessionPasswordNeededError
        from telethon.sessions import StringSession
    except Exception:
        return {'ok': False, 'message': 'Falta instalar Telethon en el servidor.'}
    api_hash = decrypt_password(row['api_hash_enc'])
    session = decrypt_password(row['session_enc'])

    async def _sign():
        client = TelegramClient(StringSession(session), int(row['api_id']), api_hash)
        await client.connect()
        try:
            if password:
                try:
                    await client.sign_in(password=password)
                    return 'ok', client.session.save()
                except Exception:
                    pass
            try:
                await client.sign_in(row['phone'], code, phone_code_hash=row['phone_code_hash'])
            except SessionPasswordNeededError:
                if not password:
                    return 'need_password', client.session.save()
                await client.sign_in(password=password)
            return 'ok', client.session.save()
        finally:
            await client.disconnect()

    try:
        status, new_session = _run(_sign())
    except Exception:
        logger.warning('No se pudo confirmar la cuenta de Telegram')
        return {'ok': False, 'message': 'El código no sirvió. Pide uno nuevo.'}
    if status == 'need_password':
        _save_row(row['api_id'], row['api_hash_enc'], row['phone'], encrypt_password(new_session), row['phone_code_hash'])
        return {'ok': False, 'need_password': True, 'message': 'Esa cuenta tiene contraseña de Telegram. Escríbela y conecta de nuevo.'}
    _save_row(row['api_id'], row['api_hash_enc'], row['phone'], encrypt_password(new_session), None)
    return {'ok': True, 'message': 'Cuenta conectada.'}


def save_source_chats(raw: str | None) -> dict:
    """Guarda los grupos que se leen. Van separados por comas."""
    ensure_telegram_personal_schema()
    groups = _parse_sources(raw)
    stored = ', '.join(groups)
    current = _row()
    now = datetime.utcnow().isoformat(sep=' ', timespec='seconds')
    if current:
        db.session.execute(text(
            'UPDATE telegram_personal_accounts SET source_chats=:source_chats, updated_at=:updated_at WHERE id=:id'
        ), {'id': current['id'], 'source_chats': stored or None, 'updated_at': now})
    else:
        db.session.execute(text(
            'INSERT INTO telegram_personal_accounts (source_chats, updated_at) VALUES (:source_chats, :updated_at)'
        ), {'source_chats': stored or None, 'updated_at': now})
    db.session.commit()
    return {'ok': True, 'groups': groups}


def forget_account() -> dict:
    """Borra la cuenta guardada. No deja sesión ni teléfono en la base."""
    ensure_telegram_personal_schema()
    db.session.execute(text('DELETE FROM telegram_personal_accounts'))
    db.session.commit()
    return {'ok': True, 'message': 'Cuenta borrada.'}


def clean_ad_text(raw: str | None) -> str:
    text_value = raw or ''
    text_value = _URL_RE.sub(' ', text_value)
    text_value = _HASH_RE.sub(' ', text_value)
    lines = []
    for line in text_value.splitlines():
        cleaned = _SPACE_RE.sub(' ', line).strip(' -•|')
        if cleaned:
            lines.append(cleaned)
    return _BLANK_RE.sub('\n\n', '\n'.join(lines)).strip()


def _normalize_chat(item: str) -> str:
    """El número de web.telegram.org (#-2248…) pasa al ID de canal -1002248…."""
    if re.fullmatch(r'-\d+', item) and not item.startswith('-100'):
        digits = item[1:]
        if len(digits) >= 10:
            return '-100' + digits
    return item


def _parse_sources(raw: str | None) -> list[str]:
    found = []
    for piece in re.split(r'[\s,;]+', raw or ''):
        item = piece.strip()
        if not item:
            continue
        item = re.sub(r'^https?://t\.me/', '', item, flags=re.I)
        item = item.strip('/')
        if item.startswith('+'):
            continue
        item = _normalize_chat(item)
        if item not in found:
            found.append(item)
    return found[:20]


_PHOTO_MIMES = {'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'}
_SKIP_EXT = ('.psd', '.psb', '.ai', '.zip', '.rar', '.7z', '.pdf')


def _ad_media(msg):
    """Solo foto o video. Un .psd u otro archivo se ignora."""
    name = ''
    document = msg.document
    if document is not None:
        for attr in getattr(document, 'attributes', []) or []:
            file_name = getattr(attr, 'file_name', None)
            if file_name:
                name = str(file_name).lower()
                break
        if name.endswith(_SKIP_EXT) or 'photoshop' in str(getattr(document, 'mime_type', '') or '').lower():
            return None
        mime = str(getattr(document, 'mime_type', '') or '').lower()
        if mime.startswith('video/'):
            return 'video/mp4', '.mp4'
        if mime in _PHOTO_MIMES:
            return 'image/jpeg', '.jpg'
        return None
    if msg.video:
        return 'video/mp4', '.mp4'
    if msg.photo:
        return 'image/jpeg', '.jpg'
    return None


def _caption_key(raw: str | None) -> tuple[str, str]:
    """Texto visible y la clave para no repetir. Links y hashtags no cuentan."""
    cleaned = clean_ad_text(raw)
    key = ' '.join(cleaned.casefold().split())
    return cleaned, key


def _saved_captions(state: dict) -> list[str]:
    raw = state.get('_captions')
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if str(item).strip()][-300:]


def _load_state(raw: str | None) -> dict:
    try:
        parsed = json.loads(raw or '{}')
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _drive_upload_problem(exc: Exception) -> str:
    """Motivo corto cuando Drive no acepta la foto. No incluye la respuesta completa."""
    text = str(exc).lower()
    status = getattr(getattr(exc, 'resp', None), 'status', None)
    if status == 403 or 'permission' in text or 'insufficient' in text:
        return 'La cuenta de Drive no puede escribir en la carpeta procesada.'
    if status == 404 or 'not found' in text:
        return 'No se encontró la carpeta de Drive procesado.'
    if status == 413 or 'too large' in text or 'entity too large' in text:
        return 'La foto pesa demasiado para subirla de una sola vez.'
    if 'quota' in text or 'storage' in text:
        return 'El Drive se quedó sin espacio.'
    if 'vacía' in text:
        return 'La foto bajada de Telegram llegó vacía.'
    if 'timed out' in text or 'timeout' in text or 'connection' in text or 'reset' in text or 'ssl' in text:
        return 'Se cortó la conexión con Drive al subir la publicidad.'
    return 'No se pudo subir la publicidad al Drive procesado (' + type(exc).__name__ + ').'


def _ads_error_text(exc: Exception) -> str:
    """Motivo corto para la pantalla. No incluye datos de la sesión."""
    name = type(exc).__name__
    low = name.lower()
    if 'token' in low:
        return 'No se pudo leer la sesión guardada. Vuelve a conectar la cuenta.'
    if 'flood' in low:
        return 'Telegram pidió esperar antes de leer los grupos.'
    if 'auth' in low or 'unauthorized' in low:
        return 'La sesión de la cuenta venció. Vuelve a conectarla en Datos BotFather.'
    if name in ('ModuleNotFoundError', 'ImportError'):
        return 'Falta instalar Telethon en el servidor.'
    return 'No se pudo leer los grupos de la cuenta personal (' + name + ').'


def import_source_ads(transfer, drive_service, sender) -> list[dict]:
    """Después del pase de Drive, copia la publicidad nueva. La primera vez trae las últimas de cada grupo."""
    row = _row()
    sources = _parse_sources((row or {}).get('source_chats')) or _parse_sources(
        getattr(transfer, 'source_telegram_chats', None)
    )
    if not sources:
        return [{'file': '', 'destino': '', 'problema': 'No hay grupos para leer. Escríbelos en Cuenta que lee grupos.'}]
    problems = []
    if not row or not row.get('session_enc') or row.get('phone_code_hash'):
        problems.append({'file': '', 'destino': '', 'problema': 'La cuenta de Telegram para leer grupos no está conectada.'})
        return problems
    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
    except Exception:
        problems.append({'file': '', 'destino': '', 'problema': 'Falta instalar Telethon en el servidor.'})
        return problems
    try:
        api_hash = decrypt_password(str(row['api_hash_enc']).strip())
        session = decrypt_password(str(row['session_enc']).strip())
    except Exception:
        problems.append({'file': '', 'destino': '', 'problema': 'No se pudo leer la sesión guardada. Vuelve a conectar la cuenta.'})
        return problems
    state = _load_state(getattr(transfer, 'source_telegram_state', None))
    processed_id = (getattr(transfer, 'drive_processed_id', None) or '').strip()

    tmp = tempfile.mkdtemp(prefix='tg-ad-')

    async def _pull():
        client = TelegramClient(StringSession(session), int(row['api_id']), api_hash)
        await client.connect()
        found = []
        new_state = dict(state)
        seen = set(_saved_captions(state))
        try:
            if not await client.is_user_authorized():
                return 'auth', found, new_state
            from telethon import utils

            known = {}
            async for dialog in client.iter_dialogs():
                entity = dialog.entity
                if entity is None:
                    continue
                known[str(dialog.id)] = entity
                try:
                    known[str(utils.get_peer_id(entity))] = entity
                except Exception:
                    pass
                username = getattr(entity, 'username', None)
                if username:
                    known['@' + str(username).lower()] = entity
                    known[str(username).lower()] = entity
            for source in sources:
                entity = known.get(source) or known.get(source.lower())
                if entity is None:
                    try:
                        target = int(source) if source.lstrip('-').isdigit() else source
                        entity = await client.get_entity(target)
                    except Exception as exc:
                        name = type(exc).__name__.lower()
                        if 'flood' in name:
                            problems.append({'file': source, 'destino': '', 'problema': 'Telegram pidió esperar antes de leer ese grupo.'})
                        elif 'private' in name or 'channelprivate' in name:
                            problems.append({'file': source, 'destino': '', 'problema': 'Ese grupo es privado y la cuenta no entra.'})
                        else:
                            problems.append({'file': source, 'destino': '', 'problema': 'La cuenta no puede abrir ese grupo. Revisa el @ o el ID.'})
                        continue
                key = str(getattr(entity, 'id', source))
                try:
                    cursor = int(new_state.get(key) or 0)
                except (TypeError, ValueError):
                    cursor = 0
                latest = await client.get_messages(entity, limit=1)
                newest = int(latest[0].id) if latest else 0
                # La pasada que solo marcó el punto no dejó _loaded, así que esa sí trae lo reciente.
                catchup = cursor <= 0 or not new_state.get('_loaded')
                batch = []
                if catchup:
                    async for msg in client.iter_messages(entity, limit=80):
                        raw_text = msg.message or msg.text or ''
                        if 'gestor streaming' in raw_text.casefold():
                            continue
                        if _ad_media(msg) is None:
                            continue
                        batch.append(msg)
                        if len(batch) >= _MAX_PER_CHAT:
                            break
                    batch.reverse()
                else:
                    async for msg in client.iter_messages(entity, min_id=cursor, reverse=True, limit=_MAX_PER_CHAT):
                        batch.append(msg)
                top = newest if catchup else cursor
                for msg in batch:
                    top = max(top, int(msg.id))
                    raw_text = msg.message or msg.text or ''
                    if 'gestor streaming' in raw_text.casefold():
                        continue
                    caption, caption_key = _caption_key(raw_text)
                    if caption_key and caption_key in seen:
                        continue
                    media = _ad_media(msg)
                    if media is None:
                        continue
                    from app.store.telegram_bot_service import wait_for_host_room
                    wait_for_host_room()
                    mime, suffix = media
                    dest = os.path.join(tmp, f'ad_{key}_{msg.id}{suffix}')
                    saved = await client.download_media(msg, file=dest)
                    if not saved or not os.path.isfile(saved):
                        problems.append({'file': f'{key}:{msg.id}', 'destino': '', 'problema': 'No se pudo bajar la publicidad.'})
                        continue
                    found.append({
                        'path': saved,
                        'mime': mime,
                        'caption': caption,
                        'caption_key': caption_key,
                        'chat_key': key,
                        'msg_id': int(msg.id),
                        'file_name': os.path.basename(saved),
                    })
                new_state[key] = top
            new_state['_loaded'] = 1
            new_state['_captions'] = list(seen)[-300:]
            return 'ok', found, new_state
        finally:
            await client.disconnect()

    try:
        pulled = _run(_pull())
        status, ads, new_state = pulled
    except Exception as exc:
        logger.exception('No se pudo leer la publicidad de Telegram')
        problems.append({'file': '', 'destino': '', 'problema': _ads_error_text(exc)})
        shutil.rmtree(tmp, ignore_errors=True)
        return problems
    try:
        transfer.source_telegram_state = json.dumps(new_state, ensure_ascii=False)
        if status == 'auth':
            problems.append({'file': '', 'destino': '', 'problema': 'La sesión de la cuenta venció. Vuelve a conectarla en Datos BotFather.'})
            return problems

        if ads and not processed_id and (sender is None or not sender.active):
            problems.append({'file': '', 'destino': '', 'problema': 'Hay publicidad nueva, pero no hay Drive procesado ni grupo de Telegram para guardarla.'})
            failed = ads[0]
            new_state[failed['chat_key']] = max(0, int(failed['msg_id']) - 1)
            transfer.source_telegram_state = json.dumps(new_state, ensure_ascii=False)
            return problems

        from app.store.telegram_bot_service import wait_for_host_room

        known = set(_saved_captions(new_state))
        published = []
        for ad in ads:
            caption_key = ad.get('caption_key') or ''
            if caption_key and caption_key in known:
                published.append(ad)
                continue
            wait_for_host_room()
            saved = ad['path']
            caption = ad['caption']
            label = caption[:80] if caption else ad['file_name']
            file_id = ''
            drive_ok = True
            if processed_id and drive_service is not None:
                try:
                    file_id = drive_service.upload_to_folder(processed_id, saved, ad['file_name'], ad['mime'])
                    drive_ok = bool(file_id)
                except Exception as exc:
                    drive_ok = False
                    logger.exception('No se pudo subir la publicidad al Drive procesado')
                    problems.append({'file': ad['file_name'], 'destino': 'drive', 'problema': _drive_upload_problem(exc)})
            telegram_ok = True
            if sender is not None and sender.active and not sender.skipped:
                item = {'name': label, 'mimeType': ad['mime'], 'local_path': saved}
                if file_id:
                    item = {'id': file_id, 'name': label, 'mimeType': ad['mime']}
                try:
                    before = sender.sent
                    sender.send_one(item)
                    telegram_ok = sender.sent > before and not sender.skipped
                except Exception:
                    telegram_ok = False
                    problems.append({'file': label, 'destino': 'telegram', 'problema': 'No se pudo enviar la publicidad al grupo.'})
            if not drive_ok or not telegram_ok:
                break
            if caption_key:
                known.add(caption_key)
                new_state['_captions'] = list(known)[-300:]
            published.append(ad)
        if len(published) < len(ads):
            failed = ads[len(published)]
            new_state[failed['chat_key']] = max(0, int(failed['msg_id']) - 1)
        transfer.source_telegram_state = json.dumps(new_state, ensure_ascii=False)
    except Exception as exc:
        logger.exception('No se pudo guardar la publicidad leída')
        problems.append({'file': '', 'destino': '', 'problema': _ads_error_text(exc)})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return problems
