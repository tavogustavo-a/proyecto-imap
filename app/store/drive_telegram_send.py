# -*- coding: utf-8 -*-
"""Envía a Telegram los archivos que Drive ya movió a la carpeta procesada."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile

import requests

logger = logging.getLogger(__name__)

PHOTO_LIMIT = int(9.5 * 1024 * 1024)
VIDEO_LIMIT = 49 * 1024 * 1024
MEDIA_LIMIT = VIDEO_LIMIT
MAX_PROBLEMS = 40


def send_moved_files_to_telegram(drive_service, transfer, moved_files: list) -> dict:
    """Manda cada archivo movido solo al grupo o canal configurado."""
    from app.store.telegram_bot_service import (
        _saved_bot_token,
        probe_telegram_chat,
        telegram_digest_ready,
        validate_chat_id,
    )

    problems: list[dict] = []
    sent = 0
    targets, setup_problems = _targets(transfer, probe_telegram_chat, validate_chat_id, telegram_digest_ready)
    problems.extend(setup_problems)
    if not targets or not moved_files:
        _store_problems(transfer, problems)
        return {'sent': 0, 'problems': problems}

    token = _saved_bot_token()
    if not token:
        problems.append(_problem('', '', 'El bot no está conectado.'))
        _store_problems(transfer, problems)
        return {'sent': 0, 'problems': problems}

    tmp = tempfile.mkdtemp(prefix='drive-tg-')
    try:
        for item in moved_files:
            name = str(item.get('name') or 'archivo')
            mime = str(item.get('mimeType') or '')
            file_id = item.get('id')
            if not file_id:
                continue
            local = os.path.join(tmp, _safe_name(name))
            try:
                drive_service.download_file(file_id, local)
            except Exception:
                problems.append(_problem(name, '', 'No se pudo bajar el archivo desde Drive.'))
                continue
            prepared, note = _fit_telegram_limit(local, mime, tmp)
            if note:
                problems.append(_problem(name, '', note))
            if not prepared:
                continue
            kind = _send_kind(mime)
            for target in targets:
                ok, err = _upload(
                    token,
                    target['chat_id'],
                    prepared,
                    kind,
                    name,
                    target.get('message_thread_id'),
                )
                if ok:
                    sent += 1
                else:
                    problems.append(_problem(name, target['label'], err))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    _store_problems(transfer, problems)
    return {'sent': sent, 'problems': problems[:MAX_PROBLEMS]}


def _targets(transfer, probe_telegram_chat, validate_chat_id, telegram_digest_ready):
    """La publicidad solo sale al grupo o canal. Los ID de la tabla no reciben el archivo."""
    problems = []
    targets = []
    group_raw = (getattr(transfer, 'telegram_group_id', None) or '').strip()
    topic_raw = (getattr(transfer, 'telegram_topic_id', None) or '').strip()
    if not group_raw and not topic_raw:
        return targets, problems
    if topic_raw and not group_raw:
        problems.append(_problem('', 'grupo', 'Para enviar a un tema hace falta también el ID del grupo (-100…).'))
        return targets, problems
    if not group_raw:
        return targets, problems
    # Sin bot, token o interruptor no hay a quién mandar el archivo. Se ignora
    # el envío y no se anota como fallo: Drive ya movió los archivos.
    if not telegram_digest_ready():
        return targets, problems
    chat_id, err = validate_chat_id(group_raw)
    if err:
        problems.append(_problem('', 'grupo', 'El grupo de Telegram no es un ID válido.'))
        return targets, problems
    topic_id = ''
    if topic_raw:
        from app.store.telegram_bot_service import validate_topic_id

        topic_id, topic_err = validate_topic_id(topic_raw)
        if topic_err:
            problems.append(_problem('', 'tema', topic_err))
            return targets, problems
    probe = probe_telegram_chat(chat_id)
    if not probe.get('connected'):
        problems.append(_problem('', 'grupo', probe.get('message') or 'El bot no puede escribir en el grupo.'))
        return targets, problems
    label = 'tema' if topic_id else 'grupo'
    targets.append({
        'chat_id': chat_id,
        'label': label,
        'message_thread_id': topic_id or None,
    })
    return targets, problems


def configured_telegram_group_ids() -> list[str]:
    from app.store.drive_manager import ensure_drive_telegram_columns
    from app.store.models import DriveTransfer
    from app.store.telegram_bot_service import validate_chat_id

    ensure_drive_telegram_columns()
    found = []
    for transfer in DriveTransfer.query.all():
        raw = (getattr(transfer, 'telegram_group_id', None) or '').strip()
        chat_id, err = validate_chat_id(raw) if raw else ('', 'vacio')
        if raw and not err and chat_id not in found:
            found.append(chat_id)
    return found


def ad_group_chat_id(user) -> str:
    """Primer ID válido. El alta en el grupo usa todos los ID del usuario."""
    ids = ad_group_chat_ids(user)
    return ids[0] if ids else ''


def ad_group_chat_ids(user) -> list[str]:
    """ID que pueden estar en el grupo: usuario habilitado y con ID de Telegram válidos."""
    from app.store.telegram_bot_service import user_chat_ids
    from app.store.whatsapp_user_notify_prefs import is_store_subuser

    if user is None or not getattr(user, 'enabled', True) or is_store_subuser(user):
        return []
    return user_chat_ids(user)


def sync_store_user_telegram_groups(user, previous_chat_id: str | None = None) -> None:
    """Mete o saca al usuario de los grupos de publicidad según si está habilitado y tiene ID."""
    from app.store.telegram_bot_service import _saved_bot_token, parse_chat_id_list

    token = _saved_bot_token()
    groups = configured_telegram_group_ids()
    if not token or not groups:
        return
    allowed = set(ad_group_chat_ids(user) if user is not None else [])
    old_ids, _old_err = parse_chat_id_list(previous_chat_id)
    current_ids, _cur_err = parse_chat_id_list(
        (getattr(user, 'telegram_chat_id', None) or '') if user is not None else ''
    )
    for group_id in groups:
        for old in old_ids:
            if old not in allowed:
                _ban_from_group(token, group_id, old)
        for chat_id in allowed:
            _allow_in_group(token, group_id, chat_id)
        if not allowed:
            for current in current_ids:
                _ban_from_group(token, group_id, current)


def remove_chat_from_telegram_groups(chat_id: str | None) -> None:
    from app.store.telegram_bot_service import _saved_bot_token, parse_chat_id_list

    token = _saved_bot_token()
    ids, _err = parse_chat_id_list(chat_id)
    if not token or not ids:
        return
    for group_id in configured_telegram_group_ids():
        for one in ids:
            _ban_from_group(token, group_id, one)


def _member_status(token: str, group_id: str, user_id: str) -> str:
    from app.store.telegram_bot_service import _telegram_call

    result = _telegram_call(token, 'getChatMember', {'chat_id': group_id, 'user_id': user_id})
    if not result.get('ok'):
        return ''
    member = result.get('result') if isinstance(result.get('result'), dict) else {}
    return str(member.get('status') or '')


def _ban_from_group(token: str, group_id: str, user_id: str) -> None:
    from app.store.telegram_bot_service import _telegram_call

    status = _member_status(token, group_id, user_id)
    if status in ('creator', 'administrator'):
        return
    _telegram_call(token, 'banChatMember', {'chat_id': group_id, 'user_id': user_id})


def _allow_in_group(token: str, group_id: str, user_id: str) -> None:
    from app.store.telegram_bot_service import _telegram_call

    _telegram_call(token, 'unbanChatMember', {
        'chat_id': group_id,
        'user_id': user_id,
        'only_if_banned': True,
    })
    status = _member_status(token, group_id, user_id)
    if status in ('creator', 'administrator', 'member', 'restricted'):
        return
    link = _telegram_call(token, 'createChatInviteLink', {
        'chat_id': group_id,
        'member_limit': 1,
    })
    invite = ''
    if link.get('ok') and isinstance(link.get('result'), dict):
        invite = str(link['result'].get('invite_link') or '')
    if not invite:
        return
    _telegram_call(token, 'sendMessage', {
        'chat_id': user_id,
        'text': 'Tu acceso a la publicidad volvió a estar habilitado. Entrá con este enlace:\n' + invite,
    })


def _fit_telegram_limit(path: str, mime: str, tmp: str):
    """Baja calidad si el archivo supera el límite de Telegram. None si no entra."""
    try:
        size = os.path.getsize(path)
    except OSError:
        return None, 'No se pudo leer el archivo descargado.'
    if mime.startswith('image/'):
        if size <= PHOTO_LIMIT:
            return path, ''
        fitted = _compress_image(path, tmp)
        if fitted and os.path.getsize(fitted) <= PHOTO_LIMIT:
            return fitted, 'La foto era muy grande y se bajó la calidad para poder enviarla.'
        return None, 'La foto sigue siendo más grande que 9,5 MB después de bajar la calidad.'
    limit = VIDEO_LIMIT if mime.startswith('video/') else MEDIA_LIMIT
    if size <= limit:
        return path, ''
    if mime.startswith('video/'):
        fitted = _compress_video(path, tmp)
        if fitted and os.path.getsize(fitted) <= limit:
            return fitted, 'El video era muy grande y se bajó la calidad para poder enviarlo.'
        if not shutil.which('ffmpeg'):
            return None, 'El video supera 49 MB y no hay ffmpeg para bajarle la calidad.'
        return None, 'El video sigue siendo más grande que 49 MB después de bajar la calidad.'
    return None, 'El archivo supera 49 MB y Telegram no lo acepta.'


def _compress_image(path: str, tmp: str):
    try:
        from PIL import Image
    except Exception:
        return None
    dest = os.path.join(tmp, 'fit.jpg')
    try:
        img = Image.open(path)
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        else:
            img = img.convert('RGB')
        width, height = img.size
        quality = 80
        while True:
            img.save(dest, 'JPEG', quality=quality, optimize=True)
            if os.path.getsize(dest) <= PHOTO_LIMIT or (quality <= 35 and width <= 1280):
                break
            if quality > 35:
                quality -= 10
            else:
                width = max(640, int(width * 0.8))
                height = max(640, int(height * 0.8))
                resample = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', Image.LANCZOS)
                img = img.resize((width, height), resample)
        if os.path.getsize(dest) <= PHOTO_LIMIT:
            return dest
    except Exception:
        logger.warning('No se pudo comprimir la imagen de Drive')
    return None


def _compress_video(path: str, tmp: str):
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        return None
    dest = os.path.join(tmp, 'fit.mp4')
    for bitrate in ('1200k', '700k', '400k'):
        try:
            subprocess.run(
                [
                    ffmpeg, '-y', '-i', path,
                    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                    '-c:v', 'libx264', '-b:v', bitrate,
                    '-c:a', 'aac', '-b:a', '64k',
                    '-movflags', '+faststart',
                    dest,
                ],
                check=False,
                capture_output=True,
                timeout=180,
            )
        except Exception:
            return None
        if os.path.isfile(dest) and os.path.getsize(dest) <= VIDEO_LIMIT:
            return dest
    return dest if os.path.isfile(dest) else None


def _send_kind(mime: str) -> str:
    if mime.startswith('image/') and mime != 'image/gif':
        return 'photo'
    if mime.startswith('video/'):
        return 'video'
    return 'document'


def _upload(
    token: str,
    chat_id: str,
    path: str,
    kind: str,
    caption: str,
    message_thread_id: str | None = None,
) -> tuple[bool, str]:
    field = {'photo': 'photo', 'video': 'video'}.get(kind, 'document')
    method = {'photo': 'sendPhoto', 'video': 'sendVideo'}.get(kind, 'sendDocument')
    payload = {'chat_id': chat_id, 'caption': caption[:1000]}
    if message_thread_id:
        try:
            payload['message_thread_id'] = int(message_thread_id)
        except (TypeError, ValueError):
            return False, 'El ID del tema no es válido.'
    try:
        with open(path, 'rb') as handle:
            response = requests.post(
                f'https://api.telegram.org/bot{token}/{method}',
                data=payload,
                files={field: handle},
                timeout=180,
            )
        data = response.json()
    except Exception:
        return False, 'No se pudo conectar con Telegram para enviar el archivo.'
    if isinstance(data, dict) and data.get('ok'):
        return True, ''
    description = ''
    if isinstance(data, dict):
        description = str(data.get('description') or '')
    from app.store.telegram_bot_service import humanize_telegram_chat_error

    return False, humanize_telegram_chat_error(description)


def _problem(file_name: str, destino: str, problema: str) -> dict:
    return {'file': file_name, 'destino': destino, 'problema': problema}


def _store_problems(transfer, problems: list) -> None:
    kept = problems[:MAX_PROBLEMS]
    transfer.telegram_send_problems = json.dumps(kept, ensure_ascii=False) if kept else None


def _safe_name(name: str) -> str:
    cleaned = ''.join(ch if ch.isalnum() or ch in '._-' else '_' for ch in name)[:80]
    return cleaned or 'archivo'
