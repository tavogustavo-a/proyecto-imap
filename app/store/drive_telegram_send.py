# -*- coding: utf-8 -*-
"""Envía a Telegram los archivos que Drive ya movió a la carpeta procesada."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
import time

import requests

logger = logging.getLogger(__name__)

PHOTO_LIMIT = int(9.5 * 1024 * 1024)
VIDEO_LIMIT = 49 * 1024 * 1024
MEDIA_LIMIT = VIDEO_LIMIT
MAX_PROBLEMS = 40


class DriveTelegramSender:
    """Prepara el grupo una vez y manda de a un archivo, borrando el temporal al terminar cada uno."""

    def __init__(self, drive_service):
        self.drive_service = drive_service
        self.prepared = False
        self.active = False
        self.finished = False
        self.skipped = False
        self.problems: list[dict] = []
        self.sent = 0
        self.targets: list[dict] = []
        self.token = ''
        self.tmp = ''
        self._seq = 0

    def prepare(self, transfer) -> None:
        from app.store.telegram_bot_service import (
            _saved_bot_token,
            probe_telegram_chat,
            validate_chat_id,
        )

        self.prepared = True
        self.skipped = False
        targets, setup_problems, gone = _targets(transfer, probe_telegram_chat, validate_chat_id)
        if gone:
            self.skipped = True
            self.targets = []
            self.active = False
            return
        self.problems.extend(setup_problems)
        self.targets = targets
        self.token = _saved_bot_token() or ''
        self.active = bool(self.targets and self.token)
        if self.targets and not self.token:
            self.problems.append(_problem('', '', 'El bot no está conectado.'))
        if self.active:
            self.tmp = tempfile.mkdtemp(prefix='drive-tg-')

    def _stopped_because_gone(self, ok: bool, err: str) -> bool:
        if ok or not destination_gone(err):
            return False
        self._halt_missing_telegram()
        return True

    def _halt_missing_telegram(self) -> None:
        """El grupo o el tema ya no existe. Se deja de enviar y no se anota como problema."""
        self.active = False
        self.skipped = True
        self.problems.clear()

    def send_one(self, item: dict) -> None:
        if not self.active or self.skipped or not item:
            return
        from app.store.telegram_bot_service import wait_for_host_room

        room = wait_for_host_room()
        name = str(item.get('name') or 'archivo')
        mime = str(item.get('mimeType') or '')
        file_id = str(item.get('id') or '')
        if not file_id:
            return
        self._seq += 1
        local = os.path.join(self.tmp, f'{self._seq}_{_safe_name(name)}')
        prepared = ''
        extra = ''
        sent_now = False
        try:
            try:
                self.drive_service.download_file(file_id, local)
            except Exception as exc:
                from app.store.drive_manager import DriveFolderMissing, _drive_folder_missing
                if isinstance(exc, DriveFolderMissing) or _drive_folder_missing(exc):
                    return
                self.problems.append(_problem(name, '', 'No se pudo bajar el archivo desde Drive.'))
                return
            prepared, kind, error, converted = _prepare_telegram_file(
                local, mime, self.tmp, self._seq
            )
            if error or not prepared:
                self.problems.append(_problem(name, '', error or 'No se pudo preparar el archivo.'))
                return
            for target in self.targets:
                current = prepared
                current_kind = kind
                ok, err = _upload(
                    self.token,
                    target['chat_id'],
                    current,
                    current_kind,
                    name,
                    target.get('message_thread_id'),
                )
                if self._stopped_because_gone(ok, err):
                    return
                if not ok and current_kind == 'video' and not converted:
                    fitted = _compress_video(local, self.tmp, self._seq)
                    if fitted:
                        extra = fitted
                        current = fitted
                        ok, err = _upload(
                            self.token,
                            target['chat_id'],
                            current,
                            'video',
                            name,
                            target.get('message_thread_id'),
                        )
                        if self._stopped_because_gone(ok, err):
                            return
                if not ok and current_kind == 'animation':
                    still = _to_telegram_jpeg(local, self.tmp, self._seq)
                    if still:
                        extra = still
                        current = still
                        ok, err = _upload(
                            self.token,
                            target['chat_id'],
                            current,
                            'photo',
                            name,
                            target.get('message_thread_id'),
                        )
                        if self._stopped_because_gone(ok, err):
                            return
                if not ok:
                    try:
                        fallback_size = os.path.getsize(current)
                    except OSError:
                        fallback_size = VIDEO_LIMIT + 1
                    if fallback_size <= VIDEO_LIMIT:
                        ok, err = _upload(
                            self.token,
                            target['chat_id'],
                            current,
                            'document',
                            name,
                            target.get('message_thread_id'),
                        )
                        if self._stopped_because_gone(ok, err):
                            return
                if ok:
                    self.sent += 1
                    sent_now = True
                else:
                    self.problems.append(_problem(name, target['label'], err))
        finally:
            for path in (local, prepared, extra):
                if path and path != self.tmp and os.path.isfile(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass
        if sent_now:
            time.sleep(1.0)
        elif room == 'cargado':
            time.sleep(0.45)
        elif room == 'medio':
            time.sleep(0.15)

    def finish(self, transfer) -> dict:
        self.finished = True
        if self.tmp:
            shutil.rmtree(self.tmp, ignore_errors=True)
            self.tmp = ''
        if self.prepared:
            _store_problems(transfer, [] if self.skipped else self.problems)
        return {'sent': self.sent, 'problems': [] if self.skipped else self.problems[:MAX_PROBLEMS]}


def send_moved_files_to_telegram(drive_service, transfer, moved_files: list) -> dict:
    """Manda cada archivo movido solo al grupo o canal configurado."""
    sender = DriveTelegramSender(drive_service)
    sender.prepare(transfer)
    if sender.active:
        for item in moved_files:
            if not sender.active or sender.skipped:
                break
            sender.send_one(item)
    return sender.finish(transfer)


def destination_gone(text: str | None) -> bool:
    """El grupo o el tema ya no está. No es un fallo de un archivo."""
    low = (text or '').strip().lower()
    markers = (
        'chat not found',
        'peer_id_invalid',
        'deactivated',
        'upgraded to a supergroup',
        'message thread not found',
        'thread not found',
        'ya no existe',
        'no existe',
        'fue convertido',
    )
    return any(marker in low for marker in markers)


def _targets(transfer, probe_telegram_chat, validate_chat_id):
    """La publicidad solo sale al grupo o canal. Los ID de la tabla no reciben el archivo."""
    problems = []
    targets = []
    group_raw = (getattr(transfer, 'telegram_group_id', None) or '').strip()
    topic_raw = (getattr(transfer, 'telegram_topic_id', None) or '').strip()
    if not group_raw and not topic_raw:
        return targets, problems, False
    if topic_raw and not group_raw:
        problems.append(_problem('', 'grupo', 'Para enviar a un tema hace falta también el ID del grupo (-100…).'))
        return targets, problems, False
    if not group_raw:
        return targets, problems, False
    from app.store.telegram_bot_service import _saved_bot_token
    if not _saved_bot_token():
        problems.append(_problem('', '', 'El bot no está conectado. Guardá el token en Datos BotFather.'))
        return targets, problems, False
    chat_id, err = validate_chat_id(group_raw)
    if err:
        problems.append(_problem('', 'grupo', 'El grupo de Telegram no es un ID válido.'))
        return targets, problems, False
    topic_id = ''
    if topic_raw:
        from app.store.telegram_bot_service import validate_topic_id

        topic_id, topic_err = validate_topic_id(topic_raw)
        if topic_err:
            problems.append(_problem('', 'tema', topic_err))
            return targets, problems, False
    probe = probe_telegram_chat(chat_id)
    if not probe.get('connected'):
        message = probe.get('message') or ''
        if destination_gone(message):
            return targets, [], True
        problems.append(_problem('', 'grupo', message or 'El bot no puede escribir en el grupo.'))
        return targets, problems, False
    if topic_id:
        from app.store.telegram_bot_service import verify_telegram_group_and_topic
        topic_err = verify_telegram_group_and_topic(chat_id, topic_id)
        if topic_err:
            if destination_gone(topic_err):
                return targets, [], True
            problems.append(_problem('', 'tema', topic_err))
            return targets, problems, False
    label = 'tema' if topic_id else 'grupo'
    targets.append({
        'chat_id': chat_id,
        'label': label,
        'message_thread_id': topic_id or None,
    })
    return targets, problems, False


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


def _encode_budget() -> tuple[str, int, str, tuple[str, ...], int]:
    """Hilos, lado máximo, preset, bitrates y tope de segundos según la carga del servidor."""
    from app.store.telegram_bot_service import host_room, wait_for_host_room

    room = wait_for_host_room(max_wait=8)
    cores = max(os.cpu_count() or 2, 1)
    if room == 'cargado':
        return '1', 1280, 'veryfast', ('700k', '400k'), 120
    if room == 'medio':
        return str(max(1, cores // 2)), 1920, 'veryfast', ('1200k', '700k'), 150
    return str(max(1, cores - 1)), 2560, 'fast', ('2000k', '1200k', '700k'), 180


def _prepare_telegram_file(path: str, mime: str, tmp: str, seq: int):
    """Deja el archivo en un formato que Telegram acepta. (ruta, tipo, error, convertido)."""
    try:
        size = os.path.getsize(path)
    except OSError:
        return None, '', 'No se pudo leer el archivo descargado.', False
    kind_mime = (mime or '').lower()
    if kind_mime == 'image/gif':
        if size <= VIDEO_LIMIT:
            return path, 'animation', '', False
        still = _to_telegram_jpeg(path, tmp, seq)
        if still:
            return still, 'photo', '', True
        return None, '', 'El GIF es demasiado grande y no se pudo convertir.', False
    if kind_mime.startswith('video/'):
        if kind_mime == 'video/mp4' and size <= VIDEO_LIMIT:
            return path, 'video', '', False
        fitted = _compress_video(path, tmp, seq)
        if fitted:
            return fitted, 'video', '', True
        if size <= VIDEO_LIMIT:
            return path, 'document', '', False
        if not shutil.which('ffmpeg'):
            return None, '', 'El video no entra en Telegram y no hay ffmpeg para convertirlo.', False
        return None, '', 'No se pudo convertir el video a un formato que Telegram acepte.', False
    if kind_mime.startswith('image/'):
        still = _to_telegram_jpeg(path, tmp, seq)
        if still:
            return still, 'photo', '', True
        return None, '', 'No se pudo convertir la imagen a un formato que Telegram acepte.', False
    if size <= VIDEO_LIMIT:
        return path, 'document', '', False
    return None, '', 'El archivo supera 49 MB y Telegram no lo acepta.', False


def _to_telegram_jpeg(path: str, tmp: str, seq: int):
    """Pasa cualquier imagen a JPG dentro de los límites de una foto de Telegram."""
    try:
        from PIL import Image, ImageOps
    except Exception:
        return _ffmpeg_still(path, tmp, seq)
    dest = os.path.join(tmp, f'photo-{seq}.jpg')
    source = path
    still = ''
    previous_limit = getattr(Image, 'MAX_IMAGE_PIXELS', None)
    img = None
    try:
        Image.MAX_IMAGE_PIXELS = 25_000_000
        try:
            img = Image.open(path)
            img.load()
        except Exception:
            still = _ffmpeg_still(path, tmp, seq) or ''
            if not still:
                return None
            source = still
            img = Image.open(still)
            img.load()
        turned = ImageOps.exif_transpose(img)
        if turned is not img:
            img.close()
            img = turned
        if getattr(img, 'is_animated', False):
            img.seek(0)
        if img.mode != 'RGB':
            converted = img.convert('RGB')
            img.close()
            img = converted
        _threads, max_edge, _preset, _rates, _timeout = _encode_budget()
        img = _fit_photo_box(img, max_edge)
        resample = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', Image.LANCZOS)
        quality = 85
        for _step in range(10):
            img.save(dest, 'JPEG', quality=quality, optimize=True)
            if os.path.getsize(dest) <= PHOTO_LIMIT:
                return dest
            width, height = img.size
            if quality > 40:
                quality -= 10
                continue
            if width <= 640 and height <= 640:
                break
            resized = img.resize((max(640, int(width * 0.8)), max(640, int(height * 0.8))), resample)
            img.close()
            img = _fit_photo_box(resized, max(width, height))
        if os.path.isfile(dest) and os.path.getsize(dest) <= PHOTO_LIMIT:
            return dest
    except Exception:
        logger.warning('No se pudo convertir la imagen de Drive')
        if source == path:
            return _ffmpeg_still(path, tmp, seq)
    finally:
        if img is not None:
            try:
                img.close()
            except Exception:
                pass
        Image.MAX_IMAGE_PIXELS = previous_limit
        if still and still != dest and os.path.isfile(still):
            try:
                os.remove(still)
            except OSError:
                pass
    return None


def _fit_photo_box(img, max_edge: int):
    """Escala y, si hace falta, agrega borde para cumplir ancho, alto y proporción de Telegram."""
    from PIL import Image

    resample = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', Image.LANCZOS)
    width, height = img.size
    long_side = max(width, height)
    if long_side > max_edge and long_side > 0:
        scale = max_edge / float(long_side)
        width = max(1, int(width * scale))
        height = max(1, int(height * scale))
        resized = img.resize((width, height), resample)
        img.close()
        img = resized
    short_side = min(width, height) or 1
    if max(width, height) / float(short_side) > 20:
        if width >= height:
            height = max(height, int((width + 19) / 20))
        else:
            width = max(width, int((height + 19) / 20))
        canvas = Image.new('RGB', (width, height), (0, 0, 0))
        canvas.paste(img, ((width - img.size[0]) // 2, (height - img.size[1]) // 2))
        img.close()
        img = canvas
    if width + height > 10000 and width + height > 0:
        scale = 10000 / float(width + height)
        width = max(1, int(width * scale))
        height = max(1, int(height * scale))
        resized = img.resize((width, height), resample)
        img.close()
        img = resized
    return img


def _ffmpeg_still(path: str, tmp: str, seq: int):
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        return None
    dest = os.path.join(tmp, f'still-{seq}.jpg')
    try:
        subprocess.run(
            [ffmpeg, '-y', '-threads', '1', '-i', path, '-frames:v', '1', dest],
            check=False,
            capture_output=True,
            timeout=60,
        )
    except Exception:
        return None
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        return dest
    return None


def _compress_video(path: str, tmp: str, seq: int):
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        return None
    threads, max_edge, preset, rates, timeout = _encode_budget()
    dest = os.path.join(tmp, f'video-{seq}.mp4')
    scale = f"scale='min({max_edge},iw)':-2"
    for bitrate in rates:
        try:
            subprocess.run(
                [
                    ffmpeg, '-y', '-i', path,
                    '-vf', scale,
                    '-c:v', 'libx264', '-preset', preset, '-threads', threads, '-b:v', bitrate,
                    '-c:a', 'aac', '-b:a', '96k',
                    '-movflags', '+faststart',
                    dest,
                ],
                check=False,
                capture_output=True,
                timeout=timeout,
            )
        except Exception:
            return None
        if os.path.isfile(dest) and 0 < os.path.getsize(dest) <= VIDEO_LIMIT:
            return dest
    return None


def _post_file(token: str, method: str, payload: dict, field: str, path: str) -> dict | None:
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
        return None
    return data if isinstance(data, dict) else None


def _upload_as(
    token: str,
    chat_id: str,
    path: str,
    kind: str,
    caption: str,
    message_thread_id: str | None,
) -> tuple[bool, str]:
    field = {'photo': 'photo', 'video': 'video', 'animation': 'animation'}.get(kind, 'document')
    method = {'photo': 'sendPhoto', 'video': 'sendVideo', 'animation': 'sendAnimation'}.get(kind, 'sendDocument')
    payload = {'chat_id': chat_id, 'caption': caption[:1000]}
    if message_thread_id:
        try:
            payload['message_thread_id'] = int(message_thread_id)
        except (TypeError, ValueError):
            return False, 'El ID del tema no es válido.'
    from app.store.telegram_bot_service import humanize_telegram_chat_error

    last_error = 'No se pudo conectar con Telegram para enviar el archivo.'
    for _attempt in range(4):
        data = _post_file(token, method, payload, field, path)
        if data is None:
            time.sleep(1.5)
            continue
        if data.get('ok'):
            return True, ''
        if data.get('error_code') == 429:
            parameters = data.get('parameters') if isinstance(data.get('parameters'), dict) else {}
            try:
                retry_after = min(max(int(parameters.get('retry_after') or 2), 1), 30)
            except (TypeError, ValueError):
                retry_after = 2
            time.sleep(retry_after)
            last_error = 'Telegram pidió esperar y el archivo no salió.'
            continue
        description = str(data.get('description') or '')
        return False, humanize_telegram_chat_error(description)
    return False, last_error


def _upload(
    token: str,
    chat_id: str,
    path: str,
    kind: str,
    caption: str,
    message_thread_id: str | None = None,
) -> tuple[bool, str]:
    return _upload_as(token, chat_id, path, kind, caption, message_thread_id)


def _problem(file_name: str, destino: str, problema: str) -> dict:
    return {'file': file_name, 'destino': destino, 'problema': problema}


def _store_problems(transfer, problems: list) -> None:
    kept = problems[:MAX_PROBLEMS]
    transfer.telegram_send_problems = json.dumps(kept, ensure_ascii=False) if kept else None


def _safe_name(name: str) -> str:
    cleaned = ''.join(ch if ch.isalnum() or ch in '._-' else '_' for ch in name)[:80]
    cleaned = cleaned.lstrip('.')
    if not cleaned or cleaned in ('.', '..'):
        return 'archivo'
    return cleaned
