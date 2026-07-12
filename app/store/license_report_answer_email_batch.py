# -*- coding: utf-8 -*-
"""
Email al cliente cuando soporte contesta reportes (buena / garantía / pendiente).

- In-app / push: inmediato (StoreUserNotification en license_report_notify).
- Email: 1 solo correo por usuario y día Colombia, a partir de las 12:00 CO.
- Sin WhatsApp.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import date as date_cls
from datetime import datetime, time, timedelta, timezone
from typing import Any, Optional

from flask import current_app
from sqlalchemy import inspect

from app.extensions import db
from app.utils.timezone import COLOMBIA_TZ, get_colombia_datetime

logger = logging.getLogger(__name__)

REPORT_ANSWER_EMAIL_HOUR_CO = 12
REPORT_ANSWER_EMAIL_DEBOUNCE_SEC = 120

_flush_timer_lock = threading.Lock()
_scheduled_batch_flush_ids: set[int] = set()


def ensure_license_report_answer_email_schema() -> None:
    try:
        from app.store.models import LicenseReportAnswerEmailBatch

        inspector = inspect(db.engine)
        if LicenseReportAnswerEmailBatch.__tablename__ in inspector.get_table_names():
            return
        LicenseReportAnswerEmailBatch.__table__.create(db.engine, checkfirst=True)
        db.session.commit()
    except Exception as ex:
        db.session.rollback()
        current_app.logger.warning(
            'No se pudo asegurar tabla store_license_report_answer_email_batches: %s',
            ex,
        )


def _co_date_str(co_dt=None) -> str:
    if co_dt is None:
        co_dt = get_colombia_datetime()
    return co_dt.date().isoformat()


def _utc_for_co_noon(co_date) -> datetime:
    """12:00 Colombia del día co_date → UTC naive (como el resto del proyecto)."""
    if isinstance(co_date, str):
        d = date_cls.fromisoformat(co_date)
    else:
        d = co_date
    local = COLOMBIA_TZ.localize(datetime.combine(d, time(REPORT_ANSWER_EMAIL_HOUR_CO, 0, 0)))
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def _seconds_until_flush(flush_at_utc: datetime) -> float:
    now = datetime.utcnow()
    return max(0.5, (flush_at_utc - now).total_seconds())


def _outcome_label(outcome: str) -> str:
    oc = str(outcome or '').strip().lower()
    if oc == 'buena':
        return 'Marcada como buena'
    if oc == 'warranty_replaced':
        return 'Garantía entregada (repuesto)'
    if oc == 'warranty_pending':
        return 'Garantía en espera de stock'
    return 'Actualización de reporte'


def _build_email_copy(user, items: list[dict[str, Any]]):
    n = len(items)
    if n == 1:
        it = items[0]
        pname = str(it.get('product_name') or 'Producto').strip() or 'Producto'
        subject = f'Actualización de tu reporte — {pname}'
        email_title = 'Actualización de tu reporte'
    else:
        subject = f'Actualización de tus reportes ({n})'
        email_title = 'Actualización de tus reportes'

    paragraphs: list[str] = []
    if n == 1:
        paragraphs.append('Soporte respondió tu reporte de licencia:')
    else:
        paragraphs.append('Soporte respondió estos reportes de licencia:')

    for it in items:
        pname = str(it.get('product_name') or 'Producto').strip() or 'Producto'
        label = _outcome_label(str(it.get('outcome') or ''))
        day = it.get('day')
        day_bit = ''
        try:
            d = int(day)
            if 1 <= d <= 31:
                day_bit = f' (día {d})'
        except (TypeError, ValueError):
            pass
        block = f'• {pname}{day_bit}: {label}'
        cred_old = str(it.get('credential') or '').strip()
        cred_new = str(it.get('new_credential') or '').strip()
        if cred_new:
            block += f'\nNueva cuenta: {cred_new}'
        elif cred_old:
            block += f'\nCuenta: {cred_old}'
        paragraphs.append(block)

    paragraphs.append('Puedes revisarlo en tu portal de Licencias.')
    return subject, email_title, paragraphs


def _send_report_answer_email(user, *, subject: str, email_title: str, paragraphs: list[str]) -> bool:
    from app.store.customer_account_renewals import _user_platform_email
    from app.store.email_notify_prefs import user_receives_email_notifications
    from app.services.email_service import (
        email_recipient_display_name,
        render_transactional_email_html,
        send_transactional_email,
    )

    if not user_receives_email_notifications(user):
        current_app.logger.info(
            'Email reporte contestado omitido: email notificaciones desactivado user=%s',
            getattr(user, 'username', None) or getattr(user, 'id', '?'),
        )
        return False

    to_email = _user_platform_email(user)
    if not to_email:
        current_app.logger.info(
            'Email reporte contestado omitido: usuario %s sin email.',
            getattr(user, 'username', None) or getattr(user, 'id', '?'),
        )
        return False

    uname = email_recipient_display_name(user)
    body_lines = [f'Hola {uname},'] if uname else ['Hola,']
    body_lines.extend(paragraphs)
    body_lines.extend(['', 'Tu Premium — mensaje automático de la tienda.'])
    body_text = '\n\n'.join(body_lines)

    body_html = None
    try:
        body_html = render_transactional_email_html(
            email_title, uname, paragraphs, include_store_link=False
        )
    except Exception as ex:
        current_app.logger.warning('Plantilla email reporte contestado: %s', ex)

    try:
        return send_transactional_email(
            to_email=to_email,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
        )
    except Exception as ex:
        current_app.logger.warning('email reporte contestado: %s', ex)
        return False


def _schedule_batch_flush(batch_id: int, delay_seconds: float) -> None:
    delay_seconds = max(0.5, float(delay_seconds))
    with _flush_timer_lock:
        if int(batch_id) in _scheduled_batch_flush_ids:
            return
        _scheduled_batch_flush_ids.add(int(batch_id))

    app = current_app._get_current_object()

    def _job():
        with _flush_timer_lock:
            _scheduled_batch_flush_ids.discard(int(batch_id))
        with app.app_context():
            try:
                flush_license_report_answer_email_batch(int(batch_id))
            except Exception as ex:
                app.logger.warning('flush report answer email batch %s: %s', batch_id, ex)

    threading.Timer(delay_seconds, _job).start()


def queue_license_report_answer_email(
    user,
    *,
    outcome: str,
    product_name: str = '',
    credential_hint: str = '',
    new_credential: str = '',
    day: Optional[int] = None,
    license_id: Optional[int] = None,
) -> Optional[Any]:
    """
    Encola el ítem para el correo diario (1 por usuario/día CO, ≥ 12:00).
    El caller hace commit de la sesión principal.
    """
    from app.store.models import LicenseReportAnswerEmailBatch
    from app.store.routes import _billing_user_for_store_debt_limit

    if not user or not getattr(user, 'id', None):
        return None

    ensure_license_report_answer_email_schema()

    billing = _billing_user_for_store_debt_limit(user) or user
    uid = int(billing.id)
    co_now = get_colombia_datetime()
    co_date = _co_date_str(co_now)

    item = {
        'outcome': str(outcome or '').strip().lower(),
        'product_name': (product_name or 'Producto').strip() or 'Producto',
        'credential': (credential_hint or '').strip()[:220],
        'new_credential': (new_credential or '').strip()[:220],
        'day': day,
        'license_id': license_id,
        'ts': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S'),
    }

    batch = (
        LicenseReportAnswerEmailBatch.query.filter_by(user_id=uid, co_date=co_date)
        .first()
    )
    if batch and batch.flushed_at is not None:
        # Ya se envió el correo de hoy: no reenviar (solo 1 vez por día).
        current_app.logger.info(
            'Email reporte contestado omitido: ya enviado hoy user=%s co_date=%s',
            uid,
            co_date,
        )
        return None

    noon_utc = _utc_for_co_noon(co_now.date())
    now_utc = datetime.utcnow()
    if now_utc < noon_utc:
        flush_at = noon_utc
    else:
        flush_at = now_utc + timedelta(seconds=REPORT_ANSWER_EMAIL_DEBOUNCE_SEC)

    if batch is None:
        batch = LicenseReportAnswerEmailBatch(
            user_id=uid,
            co_date=co_date,
            items_json='[]',
            flush_at=flush_at,
            created_at=now_utc,
        )
        db.session.add(batch)
        db.session.flush()

    try:
        items = json.loads(batch.items_json or '[]')
    except (json.JSONDecodeError, TypeError):
        items = []
    if not isinstance(items, list):
        items = []
    items.append(item)
    batch.items_json = json.dumps(items, ensure_ascii=False)
    # Antes de las 12: mantener noon. Después: empujar debounce si aún no se envió.
    if now_utc < noon_utc:
        batch.flush_at = noon_utc
    else:
        batch.flush_at = flush_at
    db.session.add(batch)

    delay = _seconds_until_flush(batch.flush_at)
    try:
        _schedule_batch_flush(int(batch.id), delay)
    except Exception as ex:
        current_app.logger.warning('schedule report answer email: %s', ex)

    return batch


def flush_license_report_answer_email_batch(batch_id: int) -> bool:
    from app.models.user import User
    from app.store.models import LicenseReportAnswerEmailBatch

    ensure_license_report_answer_email_schema()
    batch = LicenseReportAnswerEmailBatch.query.get(int(batch_id))
    if not batch or batch.flushed_at is not None:
        return False

    now_utc = datetime.utcnow()
    if batch.flush_at and now_utc < batch.flush_at:
        _schedule_batch_flush(int(batch.id), _seconds_until_flush(batch.flush_at))
        return False

    co_now = get_colombia_datetime()
    # Solo enviar a partir de las 12:00 Colombia del día del lote (o si el día ya pasó).
    try:
        batch_day = date_cls.fromisoformat(str(batch.co_date))
    except ValueError:
        batch_day = co_now.date()

    if co_now.date() < batch_day:
        _schedule_batch_flush(int(batch.id), _seconds_until_flush(batch.flush_at))
        return False
    if co_now.date() == batch_day and (
        co_now.hour * 60 + co_now.minute < REPORT_ANSWER_EMAIL_HOUR_CO * 60
    ):
        noon_utc = _utc_for_co_noon(batch_day)
        batch.flush_at = noon_utc
        db.session.add(batch)
        db.session.commit()
        _schedule_batch_flush(int(batch.id), _seconds_until_flush(noon_utc))
        return False

    items = []
    try:
        parsed = json.loads(batch.items_json or '[]')
        if isinstance(parsed, list):
            items = [x for x in parsed if isinstance(x, dict)]
    except (json.JSONDecodeError, TypeError):
        items = []

    if not items:
        batch.flushed_at = datetime.utcnow()
        db.session.commit()
        return False

    user = User.query.get(int(batch.user_id))
    if not user:
        batch.flushed_at = datetime.utcnow()
        db.session.commit()
        return False

    subject, email_title, paragraphs = _build_email_copy(user, items)
    email_sent = _send_report_answer_email(
        user,
        subject=subject,
        email_title=email_title,
        paragraphs=paragraphs,
    )
    batch.flushed_at = datetime.utcnow()
    db.session.add(batch)
    db.session.commit()

    current_app.logger.info(
        'Email reportes contestados user=%s items=%s sent=%s co_date=%s',
        user.id,
        len(items),
        email_sent,
        batch.co_date,
    )
    return bool(email_sent)


def flush_due_license_report_answer_emails() -> int:
    """Respaldo del timer: envía lotes pendientes ya listos (≥ 12:00 CO)."""
    from app.store.models import LicenseReportAnswerEmailBatch

    ensure_license_report_answer_email_schema()
    co_now = get_colombia_datetime()
    now_utc = datetime.utcnow()
    q = (
        LicenseReportAnswerEmailBatch.query.filter(
            LicenseReportAnswerEmailBatch.flushed_at.is_(None),
            LicenseReportAnswerEmailBatch.flush_at <= now_utc,
        )
        .order_by(LicenseReportAnswerEmailBatch.id.asc())
        .limit(80)
        .all()
    )
    n = 0
    for batch in q:
        # Respetar ventana 12:00 del día del lote
        try:
            batch_day = date_cls.fromisoformat(str(batch.co_date))
        except ValueError:
            batch_day = co_now.date()
        if co_now.date() == batch_day and (
            co_now.hour * 60 + co_now.minute < REPORT_ANSWER_EMAIL_HOUR_CO * 60
        ):
            continue
        if flush_license_report_answer_email_batch(int(batch.id)):
            n += 1
    return n
