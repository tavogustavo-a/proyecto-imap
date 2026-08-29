# -*- coding: utf-8 -*-
"""Fotos adjuntas a reportes de incidencia del bloc Días (Licencias).

- El cliente (o el admin) sube UNA foto por línea reportada; se guarda en
  ``instance/uploads/license_reports/`` (fuera de static: se sirve con permisos).
- Si la cuenta reportada fue comprada al proveedor Multiplataforma
  (``LicenseAccount.mp_sale_id``), el reporte + imagen se envían también a su
  API (la imagen es obligatoria allí).
- Al resolverse el reporte (buena / solucionada / garantía entregada) la foto
  se borra del disco; si el proveedor aún no había respondido, el reporte se
  elimina también en su panel para no hacerles perder tiempo.
- Si el proveedor responde primero, se avisa a los admins con la respuesta,
  se borra la foto y el seguimiento queda cerrado.
- Un job de limpieza borra archivos huérfanos y poda filas cerradas viejas.
"""

from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timedelta

from flask import current_app
from sqlalchemy import inspect

from app import db
from app.store.models import LicenseReportPhoto

# Alineado con lo que acepta la API Multiplataforma (JPG, PNG, WEBP, HEIC, GIF, BMP; 15 MB)
ALLOWED_IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic'}
MAX_IMAGE_BYTES = 15 * 1024 * 1024

_MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.heic': 'image/heic',
}

# Poda de filas cerradas (auditoría corta) y cierre forzoso de abiertas olvidadas.
_CLOSED_ROW_RETENTION_DAYS = 30
_OPEN_PHOTO_MAX_AGE_DAYS = 60

_schema_ready = False


# ---------------------------------------------------------------------------
# Esquema y almacenamiento
# ---------------------------------------------------------------------------

def ensure_report_photos_schema():
    """Crea store_license_report_photos si falta y añade columnas nuevas (sin db.create_all)."""
    global _schema_ready
    if _schema_ready:
        return True
    try:
        from sqlalchemy import text as sa_text

        insp = inspect(db.engine)
        if 'store_license_report_photos' not in set(insp.get_table_names()):
            LicenseReportPhoto.__table__.create(bind=db.engine, checkfirst=True)
            _schema_ready = True
            return True
        existing = {c['name'] for c in insp.get_columns('store_license_report_photos')}
        to_add = {
            'reporter_user_id': 'INTEGER',
            'remind_count': 'INTEGER NOT NULL DEFAULT 0',
            'last_reminded_at': 'DATETIME',
        }
        with db.engine.begin() as conn:
            for col, ddl in to_add.items():
                if col not in existing:
                    conn.execute(sa_text(
                        'ALTER TABLE store_license_report_photos ADD COLUMN %s %s' % (col, ddl)
                    ))
        _schema_ready = True
        return True
    except Exception as ex:
        try:
            db.session.rollback()
        except Exception:
            pass
        current_app.logger.warning('ensure_report_photos_schema: %s', ex)
        return False


def report_photo_upload_dir():
    upload_dir = os.path.join(current_app.instance_path, 'uploads', 'license_reports')
    os.makedirs(upload_dir, exist_ok=True)
    return upload_dir


def _photo_path(photo):
    if not photo or not photo.stored_name:
        return None
    return os.path.join(report_photo_upload_dir(), photo.stored_name)


def photo_file_exists(photo):
    p = _photo_path(photo)
    return bool(p and os.path.isfile(p))


def delete_photo_file(photo):
    """Borra el archivo del disco (si existe) y limpia stored_name. No hace commit."""
    p = _photo_path(photo)
    if p:
        try:
            if os.path.isfile(p):
                os.remove(p)
        except OSError as ex:
            current_app.logger.warning('No se pudo borrar foto de reporte %s: %s', p, ex)
    photo.stored_name = None


def validate_image_upload(file_storage):
    """(ok, error, ext). Valida extensión y tamaño (≤15 MB)."""
    filename = str(getattr(file_storage, 'filename', '') or '').strip()
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        return False, 'Formato no permitido. Usa JPG, PNG, WEBP, GIF, BMP o HEIC.', None
    try:
        file_storage.stream.seek(0, os.SEEK_END)
        size = file_storage.stream.tell()
        file_storage.stream.seek(0)
    except Exception:
        size = None
    if size is not None and size > MAX_IMAGE_BYTES:
        return False, 'La imagen supera el máximo de 15 MB.', None
    if size == 0:
        return False, 'El archivo está vacío.', None
    return True, None, ext


def _sanitize_original_name(filename):
    base = os.path.basename(str(filename or ''))
    base = re.sub(r'[^\w.\- ]+', '_', base, flags=re.UNICODE)
    return base[:180] or 'imagen'


# ---------------------------------------------------------------------------
# Alta de foto (crea/reemplaza la foto abierta de la línea)
# ---------------------------------------------------------------------------

def create_report_photo(
    *,
    license_id,
    calendar_day,
    row_ordinal=None,
    account_id=None,
    cred_hint='',
    status_label='',
    uploader_user=None,
    reporter_user_id=None,
    file_storage,
):
    """Guarda la imagen y crea la fila. Reemplaza la foto abierta previa de la
    misma línea (borrando su archivo). Devuelve (photo, error). No hace commit.
    """
    ensure_report_photos_schema()
    ok, err, ext = validate_image_upload(file_storage)
    if not ok:
        return None, err

    stored_name = '%s_%s%s' % (
        datetime.utcnow().strftime('%Y%m%d%H%M%S'), uuid.uuid4().hex[:12], ext
    )
    dest = os.path.join(report_photo_upload_dir(), stored_name)
    file_storage.stream.seek(0)
    file_storage.save(dest)

    # Reemplazo: cierra la anterior de la misma línea sin tocar su reporte MP
    # (el reporte remoto sigue siendo el mismo problema; se conserva el
    # seguimiento moviéndolo a la foto nueva). Incluye filas «awaiting»
    # (reporte MP a la espera de foto): al subirla dejan de recordar.
    prev = (
        LicenseReportPhoto.query.filter_by(
            license_id=int(license_id),
            calendar_day=int(calendar_day),
        )
        .filter(LicenseReportPhoto.status.in_(('open', 'awaiting')))
        .all()
    )
    photo = LicenseReportPhoto(
        license_id=int(license_id),
        calendar_day=int(calendar_day),
        row_ordinal=int(row_ordinal) if row_ordinal is not None else None,
        account_id=int(account_id) if account_id else None,
        cred_hint=(cred_hint or '')[:300],
        status_label=(status_label or '')[:120],
        reporter_user_id=int(reporter_user_id) if reporter_user_id else None,
        uploader_user_id=getattr(uploader_user, 'id', None),
        uploader_username=(getattr(uploader_user, 'username', '') or '')[:80],
        original_name=_sanitize_original_name(getattr(file_storage, 'filename', '')),
        stored_name=stored_name,
        status='open',
        created_at=datetime.utcnow(),
    )
    for old in prev:
        same_row = (
            row_ordinal is None
            or old.row_ordinal is None
            or int(old.row_ordinal) == int(row_ordinal)
        )
        same_line = same_row and (
            not cred_hint
            or not old.cred_hint
            or old.cred_hint.strip().lower() == str(cred_hint).strip().lower()
        )
        if not same_line:
            continue
        # Hereda datos de la fila previa: quién reportó (para avisarle al
        # completarse) y la cuenta (para poder enviar el reporte MP aunque
        # quien sube la foto no la indique).
        if old.reporter_user_id and not photo.reporter_user_id:
            photo.reporter_user_id = old.reporter_user_id
        if old.account_id and not photo.account_id:
            photo.account_id = old.account_id
        if old.status_label and not photo.status_label:
            photo.status_label = old.status_label
        # La imagen cambia: si ya había un reporte pendiente en el proveedor,
        # se borra allí para reenviar con la foto nueva (no heredar issue_id).
        if old.mp_issue_id and old.mp_status == 'sent':
            _mp_delete_remote_report(old)
        delete_photo_file(old)
        old.status = 'closed'
        old.closed_reason = 'replaced'
        old.closed_at = datetime.utcnow()
    db.session.add(photo)
    return photo, None


# ---------------------------------------------------------------------------
# Envío del reporte a la API Multiplataforma
# ---------------------------------------------------------------------------

def _mp_find_count_id(account):
    """count_id de la cuenta en Multiplataforma (vía preview de renovación o búsqueda)."""
    from app.store import multiplataforma_api as mp

    sale_id = getattr(account, 'mp_sale_id', None)
    if sale_id:
        try:
            opts = mp.get_renewal_options(int(sale_id)) or {}
            cid = opts.get('count_id')
            if cid:
                return int(cid), 'multiplatform'
        except Exception:
            pass
    email = str(getattr(account, 'email', '') or '').strip()
    if email:
        try:
            data = mp.search_issue_account('multiplatform', email) or {}
            results = data.get('results') or data.get('accounts') or []
            if isinstance(results, list):
                for item in results:
                    if not isinstance(item, dict):
                        continue
                    cid = item.get('count_id') or item.get('id')
                    if cid:
                        return int(cid), str(item.get('platform') or 'multiplatform')
        except Exception:
            pass
    return None, None


def send_report_to_multiplataforma(photo, account, issue_text=''):
    """Envía el reporte con imagen a la API si la cuenta es del proveedor.

    Actualiza el seguimiento en ``photo`` (mp_status sent/failed). No hace
    commit. Devuelve (ok, error_message).
    """
    from app.store import multiplataforma_api as mp

    if not account or not getattr(account, 'mp_sale_id', None):
        return False, None  # cuenta propia: nada que enviar
    if photo.mp_issue_id and photo.mp_status == 'sent':
        return True, None  # ya hay un reporte pendiente para esta línea

    path = _photo_path(photo)
    if not path or not os.path.isfile(path):
        return False, 'No hay imagen guardada para enviar.'

    count_id, platform = _mp_find_count_id(account)
    if not count_id:
        photo.mp_status = 'failed'
        photo.mp_error = 'No se encontró la cuenta en el panel del proveedor.'
        return False, photo.mp_error

    text_parts = []
    if photo.status_label:
        text_parts.append(photo.status_label)
    if issue_text:
        text_parts.append(str(issue_text))
    email = str(getattr(account, 'email', '') or '').strip()
    if email:
        text_parts.append('Cuenta: %s' % email)
    issue = ' — '.join(text_parts) or 'Fallo reportado por el cliente.'

    ext = os.path.splitext(photo.stored_name or '')[1].lower()
    mime = _MIME_BY_EXT.get(ext, 'image/jpeg')
    try:
        with open(path, 'rb') as fh:
            data = mp.create_account_issue(
                platform, count_id, issue, photo.original_name or photo.stored_name,
                fh.read(), mime,
            )
    except mp.MultiplataformaApiError as ex:
        photo.mp_status = 'failed'
        photo.mp_error = str(ex)[:1000]
        return False, str(ex)
    except Exception as ex:  # red, disco…
        photo.mp_status = 'failed'
        photo.mp_error = str(ex)[:1000]
        return False, str(ex)

    issue_id = None
    if isinstance(data, dict):
        raw = data.get('issue') if isinstance(data.get('issue'), dict) else data
        for key in ('id', 'issue_id'):
            if raw.get(key):
                try:
                    issue_id = int(raw.get(key))
                    break
                except (TypeError, ValueError):
                    pass
    photo.mp_platform = platform
    photo.mp_issue_id = issue_id
    photo.mp_status = 'sent'
    photo.mp_error = None
    photo.mp_sent_at = datetime.utcnow()

    # Reporte completo enviado al proveedor → avisar al cliente que reportó
    # (haya subido la foto él mismo o la haya completado el admin).
    try:
        from app.store.store_event_notify import _add_notification

        reporter_id = photo.reporter_user_id or photo.uploader_user_id
        if reporter_id:
            hint = photo.cred_hint or 'tu cuenta'
            _add_notification(
                user_id=int(reporter_id),
                kind='store_report_sent',
                title='Reporte completo',
                body=(
                    'Tu reporte «%s» de %s ya quedó completo con la foto.'
                    % (photo.status_label or 'incidencia', hint)
                ),
            )
    except Exception:
        current_app.logger.exception('MP reportes: no se pudo avisar al cliente')
    return True, None


def _mp_delete_remote_report(photo):
    """Borra el reporte en el proveedor si sigue pendiente (mejor esfuerzo)."""
    from app.store import multiplataforma_api as mp

    if not photo.mp_issue_id or photo.mp_status != 'sent':
        return
    try:
        mp.delete_account_issue(photo.mp_platform or 'multiplatform', photo.mp_issue_id)
        photo.mp_status = 'deleted'
    except Exception as ex:
        current_app.logger.warning(
            'MP: no se pudo eliminar reporte %s en el proveedor: %s',
            photo.mp_issue_id, ex,
        )


# ---------------------------------------------------------------------------
# Cierre (resolución del reporte → borrar foto)
# ---------------------------------------------------------------------------

def _norm(s):
    return str(s or '').strip().lower()


def close_report_photos_for_row(
    license_id,
    calendar_day=None,
    row_ordinal=None,
    account_id=None,
    cred_hint='',
    reason='resolved',
    delete_remote=True,
):
    """Cierra las fotos abiertas que coincidan y borra sus archivos.

    Si el reporte sigue pendiente en Multiplataforma y ``delete_remote``,
    lo elimina también allí. No hace commit. Devuelve nº de fotos cerradas.
    """
    if not ensure_report_photos_schema():
        return 0
    q = LicenseReportPhoto.query.filter_by(license_id=int(license_id)).filter(
        LicenseReportPhoto.status.in_(('open', 'awaiting'))
    )
    if calendar_day is not None:
        q = q.filter_by(calendar_day=int(calendar_day))
    if account_id:
        q = q.filter_by(account_id=int(account_id))
    rows = q.all()
    hint_n = _norm(cred_hint)
    closed = 0
    for photo in rows:
        if row_ordinal is not None and photo.row_ordinal is not None:
            if int(photo.row_ordinal) != int(row_ordinal):
                continue
        if hint_n and _norm(photo.cred_hint):
            a, b = hint_n, _norm(photo.cred_hint)
            if a not in b and b not in a:
                continue
        if delete_remote:
            _mp_delete_remote_report(photo)
        delete_photo_file(photo)
        photo.status = 'closed'
        photo.closed_reason = (reason or 'resolved')[:60]
        photo.closed_at = datetime.utcnow()
        closed += 1
    return closed


# ---------------------------------------------------------------------------
# Serialización para el frontend
# ---------------------------------------------------------------------------

def photo_to_dict(photo):
    return {
        'id': photo.id,
        'license_id': photo.license_id,
        'calendar_day': photo.calendar_day,
        'row_ordinal': photo.row_ordinal,
        'account_id': photo.account_id,
        'cred_hint': photo.cred_hint or '',
        'status_label': photo.status_label or '',
        'status': photo.status or '',
        'needs_photo': photo.status == 'awaiting',
        'uploader_username': photo.uploader_username or '',
        'original_name': photo.original_name or '',
        'has_file': photo_file_exists(photo),
        'created_at': photo.created_at.strftime('%Y-%m-%d %H:%M') if photo.created_at else '',
        'mp_sent': bool(photo.mp_issue_id or photo.mp_status in ('sent', 'answered', 'failed')),
        'mp_status': photo.mp_status or '',
        'mp_answer': photo.mp_answer or '',
        'mp_error': photo.mp_error or '',
    }


def open_photos_for_license(license_id, calendar_day=None):
    if not ensure_report_photos_schema():
        return []
    q = LicenseReportPhoto.query.filter_by(license_id=int(license_id)).filter(
        LicenseReportPhoto.status.in_(('open', 'awaiting'))
    )
    if calendar_day is not None:
        q = q.filter_by(calendar_day=int(calendar_day))
    return q.order_by(LicenseReportPhoto.id.asc()).all()


def remove_photo_file_keep_report(photo):
    """Elimina solo la imagen: el reporte local sigue abierto (awaiting).

    Si ya se había enviado a Multiplataforma y aún no respondieron, se borra
    también allí para poder reenviar con otra foto. No hace commit.
    """
    if photo.mp_issue_id and photo.mp_status == 'sent':
        _mp_delete_remote_report(photo)
        photo.mp_issue_id = None
        photo.mp_status = None
        photo.mp_sent_at = None
    delete_photo_file(photo)
    photo.original_name = None
    photo.status = 'awaiting'
    photo.closed_reason = None
    photo.closed_at = None


# ---------------------------------------------------------------------------
# Reportes MP sin foto: pedirla al cliente (insistente) hasta que se suba
# ---------------------------------------------------------------------------

_REMIND_EVERY_MINUTES = 20
_REMIND_MAX_AGE_HOURS = 48
_PHOTO_REQUEST_KIND = 'store_report_photo'


def _reminder_body(photo):
    label = photo.status_label or 'incidencia'
    hint = photo.cred_hint or 'tu cuenta'
    return (
        'Sube la foto del reporte «%s» de %s. Entra a Licencias y usa el botón '
        'de la cámara junto a ese reporte.'
        % (label, hint)
    )


def request_photo_if_mp_account(
    *,
    license_id,
    calendar_day,
    row_ordinal=None,
    account_id=None,
    cred_hint='',
    status_label='',
    reporter_user=None,
):
    """Si la cuenta es del proveedor Multiplataforma y aún no hay foto, crea
    la fila «awaiting» y avisa de inmediato al cliente. No hace commit.
    """
    if not account_id:
        return None
    from app.store.models import LicenseAccount

    account = LicenseAccount.query.get(int(account_id))
    if account is None or not getattr(account, 'mp_sale_id', None):
        return None
    if not ensure_report_photos_schema():
        return None

    existing = (
        LicenseReportPhoto.query.filter_by(
            license_id=int(license_id), calendar_day=int(calendar_day)
        )
        .filter(LicenseReportPhoto.status.in_(('open', 'awaiting')))
        .all()
    )
    hint_n = _norm(cred_hint)
    for row in existing:
        same_account = row.account_id and int(row.account_id) == int(account_id)
        same_hint = False
        if hint_n and _norm(row.cred_hint):
            a, b = hint_n, _norm(row.cred_hint)
            same_hint = a in b or b in a
        if same_account or same_hint:
            return None

    photo = LicenseReportPhoto(
        license_id=int(license_id),
        calendar_day=int(calendar_day),
        row_ordinal=int(row_ordinal) if row_ordinal is not None else None,
        account_id=int(account_id),
        cred_hint=(cred_hint or '')[:300],
        status_label=(status_label or '')[:120],
        reporter_user_id=getattr(reporter_user, 'id', None),
        status='awaiting',
        remind_count=1,
        last_reminded_at=datetime.utcnow(),
        created_at=datetime.utcnow(),
    )
    db.session.add(photo)

    try:
        from app.store.store_event_notify import _add_notification, notify_admins_app

        if photo.reporter_user_id:
            _add_notification(
                user_id=int(photo.reporter_user_id),
                kind=_PHOTO_REQUEST_KIND,
                title='Falta la foto del reporte',
                body=_reminder_body(photo),
            )
        notify_admins_app(
            kind='admin_mp_report_needs_photo',
            title='Falta la foto de un reporte',
            body=(
                '%s — «%s»: el cliente debe subir la foto del reporte. '
                'También puedes subirla tú desde el bloc Días.'
                % (photo.cred_hint or 'cuenta', photo.status_label or 'incidencia')
            ),
            payload={'url': '/tienda/admin/licencias'},
        )
    except Exception:
        current_app.logger.exception('MP reportes: no se pudo pedir la foto')
    return photo


def process_photo_reminders():
    """Re-envía el recordatorio de foto cada ~20 min durante 48 h. Commit propio."""
    if not ensure_report_photos_schema():
        return {'reminded': 0}
    now = datetime.utcnow()
    rows = LicenseReportPhoto.query.filter_by(status='awaiting').all()
    if not rows:
        return {'reminded': 0}

    from app.store.store_event_notify import _add_notification

    reminded = 0
    expired = 0
    for photo in rows:
        created = photo.created_at or now
        if (now - created) > timedelta(hours=_REMIND_MAX_AGE_HOURS):
            photo.status = 'closed'
            photo.closed_reason = 'photo_never_uploaded'
            photo.closed_at = now
            expired += 1
            continue
        last = photo.last_reminded_at or created
        if (now - last) < timedelta(minutes=_REMIND_EVERY_MINUTES):
            continue
        if not photo.reporter_user_id:
            continue
        try:
            _add_notification(
                user_id=int(photo.reporter_user_id),
                kind=_PHOTO_REQUEST_KIND,
                title='Falta la foto del reporte',
                body=_reminder_body(photo),
            )
            photo.remind_count = int(photo.remind_count or 0) + 1
            photo.last_reminded_at = now
            reminded += 1
        except Exception:
            current_app.logger.exception('MP reportes: recordatorio de foto falló')

    if reminded or expired:
        db.session.commit()
    return {'reminded': reminded, 'expired': expired}


# ---------------------------------------------------------------------------
# Jobs: respuestas del proveedor y limpieza de huérfanas
# ---------------------------------------------------------------------------

def process_mp_report_answers():
    """Revisa reportes enviados a Multiplataforma; al responder: avisa a los
    admins con la respuesta, borra la foto y cierra el seguimiento.
    Silencioso si no hay reportes pendientes (no llama a la API).
    """
    if not ensure_report_photos_schema():
        return {'processed': 0}
    pending = (
        LicenseReportPhoto.query.filter_by(status='open', mp_status='sent')
        .filter(LicenseReportPhoto.mp_issue_id.isnot(None))
        .all()
    )
    if not pending:
        return {'processed': 0}

    from app.store import multiplataforma_api as mp

    _LIST_PAGE_SIZE = 200
    try:
        data = mp.list_account_issues(status='all', page_size=_LIST_PAGE_SIZE) or {}
    except Exception as ex:
        current_app.logger.warning('MP reportes: no se pudo listar incidencias: %s', ex)
        return {'processed': 0, 'error': str(ex)}

    issues = data.get('issues') or []
    # Si el listado viene lleno puede haber más páginas: en ese caso un id
    # ausente NO implica que el proveedor lo cerró (podría estar en otra página).
    listing_complete = len(issues) < _LIST_PAGE_SIZE
    by_id = {}
    for item in issues:
        if isinstance(item, dict) and item.get('id') is not None:
            try:
                by_id[int(item['id'])] = item
            except (TypeError, ValueError):
                continue

    processed = 0
    for photo in pending:
        item = by_id.get(int(photo.mp_issue_id))
        answered = False
        answer_text = ''
        if item is not None:
            status = _norm(item.get('status'))
            answer_text = str(
                item.get('answer') or item.get('response') or item.get('reply') or ''
            ).strip()
            answered = bool(answer_text) or status in (
                'answered', 'resolved', 'closed', 'respondido', 'resuelto'
            )
        elif listing_complete:
            # Ya no aparece en el listado (completo): lo cerraron/eliminaron allí.
            answered = True
            answer_text = 'El proveedor cerró el reporte (ya no aparece en su panel).'
        if not answered:
            continue

        photo.mp_status = 'answered'
        photo.mp_answer = answer_text[:2000] or 'Respondido por el proveedor.'
        photo.mp_answered_at = datetime.utcnow()
        delete_photo_file(photo)
        photo.status = 'closed'
        photo.closed_reason = 'mp_answered'
        photo.closed_at = datetime.utcnow()
        processed += 1

        try:
            from app.store.store_event_notify import notify_admins_app

            hint = photo.cred_hint or ('cuenta #%s' % (photo.account_id or '?'))
            notify_admins_app(
                kind='admin_mp_report_answered',
                title='Multiplataforma respondió un reporte',
                body='%s — %s' % (hint, photo.mp_answer),
                payload={'url': '/tienda/admin/licencias'},
            )
        except Exception:
            current_app.logger.exception('MP reportes: no se pudo avisar al admin')

    if processed:
        db.session.commit()
    return {'processed': processed, 'pending': len(pending) - processed}


def cleanup_report_photos():
    """Limpieza: archivos huérfanos en disco, fotos abiertas olvidadas y
    poda de filas cerradas viejas. Hace commit propio.
    """
    if not ensure_report_photos_schema():
        return {'orphan_files': 0}
    now = datetime.utcnow()
    result = {'orphan_files': 0, 'stale_closed': 0, 'force_closed': 0}

    # 1) Fotos abiertas demasiado viejas → cerrar y borrar archivo
    stale_open = (
        LicenseReportPhoto.query.filter_by(status='open')
        .filter(LicenseReportPhoto.created_at < now - timedelta(days=_OPEN_PHOTO_MAX_AGE_DAYS))
        .all()
    )
    for photo in stale_open:
        _mp_delete_remote_report(photo)
        delete_photo_file(photo)
        photo.status = 'closed'
        photo.closed_reason = 'stale'
        photo.closed_at = now
        result['force_closed'] += 1

    # 2) Podar filas cerradas viejas (por si quedara archivo, se borra)
    old_closed = (
        LicenseReportPhoto.query.filter_by(status='closed')
        .filter(LicenseReportPhoto.closed_at < now - timedelta(days=_CLOSED_ROW_RETENTION_DAYS))
        .all()
    )
    for photo in old_closed:
        delete_photo_file(photo)
        db.session.delete(photo)
        result['stale_closed'] += 1

    db.session.commit()

    # 3) Archivos en disco sin fila abierta que los referencie
    try:
        upload_dir = report_photo_upload_dir()
        referenced = {
            name for (name,) in db.session.query(LicenseReportPhoto.stored_name)
            .filter(LicenseReportPhoto.stored_name.isnot(None))
            .all()
        }
        for name in os.listdir(upload_dir):
            path = os.path.join(upload_dir, name)
            if not os.path.isfile(path) or name in referenced:
                continue
            # margen de 1 hora por subidas en curso
            try:
                if (now.timestamp() - os.path.getmtime(path)) < 3600:
                    continue
                os.remove(path)
                result['orphan_files'] += 1
            except OSError:
                continue
    except Exception as ex:
        current_app.logger.warning('Limpieza fotos reporte (huérfanas): %s', ex)

    return result
