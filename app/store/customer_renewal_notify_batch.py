# -*- coding: utf-8 -*-
"""Avisos agrupados de renovación cuenta cliente: 1 notificación + 1 correo por lote (30 s)."""
from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta

from flask import current_app
from sqlalchemy import inspect, text

from app.extensions import db

RENEWAL_NOTIFY_BATCH_SECONDS = 30

_flush_timer_lock = threading.Lock()
_scheduled_batch_flush_ids: set[int] = set()


def ensure_customer_renewal_notify_batch_schema():
    try:
        from app.store.models import CustomerRenewalNotifyBatch

        inspector = inspect(db.engine)
        if CustomerRenewalNotifyBatch.__tablename__ in inspector.get_table_names():
            return
        CustomerRenewalNotifyBatch.__table__.create(db.engine, checkfirst=True)
        db.session.commit()
    except Exception as ex:
        db.session.rollback()
        current_app.logger.warning(
            'No se pudo asegurar tabla store_customer_renewal_notify_batches: %s', ex
        )


def _flush_overdue_batches_for_user(user_id: int) -> None:
    from app.store.models import CustomerRenewalNotifyBatch

    now = datetime.utcnow()
    overdue = (
        CustomerRenewalNotifyBatch.query.filter(
            CustomerRenewalNotifyBatch.user_id == int(user_id),
            CustomerRenewalNotifyBatch.flushed_at.is_(None),
            CustomerRenewalNotifyBatch.flush_at <= now,
        )
        .order_by(CustomerRenewalNotifyBatch.id.asc())
        .all()
    )
    for batch in overdue:
        flush_customer_renewal_notify_batch(int(batch.id))


def _get_or_create_open_batch(user_id: int):
    from app.store.models import CustomerRenewalNotifyBatch

    now = datetime.utcnow()
    batch = (
        CustomerRenewalNotifyBatch.query.filter(
            CustomerRenewalNotifyBatch.user_id == int(user_id),
            CustomerRenewalNotifyBatch.flushed_at.is_(None),
            CustomerRenewalNotifyBatch.flush_at > now,
        )
        .order_by(CustomerRenewalNotifyBatch.id.desc())
        .first()
    )
    if batch:
        return batch
    batch = CustomerRenewalNotifyBatch(
        user_id=int(user_id),
        items_json='[]',
        flush_at=now + timedelta(seconds=RENEWAL_NOTIFY_BATCH_SECONDS),
        created_at=now,
    )
    db.session.add(batch)
    db.session.flush()
    return batch


def _schedule_batch_flush(batch_id: int, delay_seconds: float) -> None:
    delay_seconds = max(0.5, float(delay_seconds))
    with _flush_timer_lock:
        if batch_id in _scheduled_batch_flush_ids:
            return
        _scheduled_batch_flush_ids.add(batch_id)

    app = current_app._get_current_object()

    def _run():
        try:
            with app.app_context():
                flush_customer_renewal_notify_batch(batch_id)
        finally:
            with _flush_timer_lock:
                _scheduled_batch_flush_ids.discard(batch_id)

    timer = threading.Timer(delay_seconds, _run)
    timer.daemon = True
    timer.start()


def queue_customer_renewal_notify(
    user,
    kind: str,
    product,
    account_email: str,
    *,
    reason: str | None = None,
    day=None,
) -> None:
    """
    Encola aviso al cliente (completed/rejected). Tras 30 s desde el primero del lote
    se envía una sola notificación in-app y un solo correo con todas las cuentas.
    """
    if not user or not getattr(user, 'id', None):
        return

    ensure_customer_renewal_notify_batch_schema()
    uid = int(user.id)
    kind_norm = (kind or '').strip().lower()
    if kind_norm not in ('completed', 'rejected'):
        return

    _flush_overdue_batches_for_user(uid)

    pname = getattr(product, 'name', None) or 'Producto'
    em = (account_email or '').strip()
    item = {
        'kind': kind_norm,
        'product_name': pname,
        'account_email': em,
    }
    if kind_norm == 'rejected':
        item['reason'] = (reason or '').strip()
    if day is not None and kind_norm == 'completed':
        try:
            item['day'] = int(day)
        except (TypeError, ValueError):
            pass

    batch = _get_or_create_open_batch(uid)
    items = json.loads(batch.items_json or '[]')
    if not isinstance(items, list):
        items = []
    items.append(item)
    batch.items_json = json.dumps(items, ensure_ascii=False)

    delay = (batch.flush_at - datetime.utcnow()).total_seconds()
    db.session.flush()
    _schedule_batch_flush(int(batch.id), delay)


def _build_batch_copy(user, items: list[dict]):
    """Título, cuerpo notificación y párrafos email para un lote."""
    n = len(items)
    completed = [i for i in items if i.get('kind') == 'completed']
    rejected = [i for i in items if i.get('kind') == 'rejected']

    if n == 1:
        only = items[0]
        pname = only.get('product_name') or 'Producto'
        em = only.get('account_email') or ''
        if only.get('kind') == 'completed':
            title = f'Renovación completada — {pname}'
            email_title = 'Renovación completada'
            subject = f'Tu Premium — Renovación completada ({pname})'
        else:
            title = f'Renovación no procesada — {pname}'
            email_title = 'Renovación no procesada'
            subject = f'Tu Premium — Renovación no procesada ({pname})'
    else:
        title = f'Actualización de tus renovaciones ({n} cuentas)'
        email_title = 'Actualización de tus renovaciones'
        subject = f'Tu Premium — Estado de tus renovaciones ({n} cuentas)'

    body_lines: list[str] = []
    paragraphs: list[str] = []

    if completed:
        body_lines.append(
            f'Renovaciones completadas ({len(completed)}):'
            if len(completed) > 1
            else 'Renovación completada:'
        )
        for i in completed:
            line = f'• {i.get("account_email") or "—"} — {i.get("product_name") or "Producto"}'
            body_lines.append(line)
            paragraphs.append(
                f'Cuenta {i.get("account_email") or "—"} ({i.get("product_name") or "Producto"}): renovación completada.'
            )

    if rejected:
        if body_lines:
            body_lines.append('')
        body_lines.append(
            f'Renovaciones no procesadas ({len(rejected)}):'
            if len(rejected) > 1
            else 'Renovación no procesada:'
        )
        for i in rejected:
            reason = (i.get('reason') or '').strip()
            line = f'• {i.get("account_email") or "—"} — {i.get("product_name") or "Producto"}'
            if reason:
                line += f'. Motivo: {reason}'
            body_lines.append(line)
            p = f'Cuenta {i.get("account_email") or "—"} ({i.get("product_name") or "Producto"}): no se pudo renovar.'
            if reason:
                p += f' Motivo: {reason}'
            paragraphs.append(p)

    if len(rejected) and len(completed):
        paragraphs.append(
            'Si correspondía devolución de saldo, ya debería reflejarse en tu cuenta de la tienda.'
        )
    elif len(rejected):
        paragraphs.append(
            'Si correspondía devolución de saldo, ya debería reflejarse en tu cuenta de la tienda.'
        )

    body = '\n'.join(body_lines)
    return title, subject, email_title, body, paragraphs


def flush_customer_renewal_notify_batch(batch_id: int) -> bool:
    from app.models.user import User
    from app.store.customer_account_renewals import _send_customer_renewal_transactional_email
    from app.store.models import CustomerRenewalNotifyBatch, StoreUserNotification

    ensure_customer_renewal_notify_batch_schema()
    batch = CustomerRenewalNotifyBatch.query.get(int(batch_id))
    if not batch or batch.flushed_at is not None:
        return False

    items = json.loads(batch.items_json or '[]')
    if not isinstance(items, list) or not items:
        batch.flushed_at = datetime.utcnow()
        db.session.commit()
        return False

    user = User.query.get(int(batch.user_id))
    if not user:
        batch.flushed_at = datetime.utcnow()
        db.session.commit()
        return False

    title, subject, email_title, body, paragraphs = _build_batch_copy(user, items)
    payload = {'batch_id': int(batch.id), 'items': items, 'count': len(items)}

    notif = StoreUserNotification(
        user_id=int(user.id),
        kind='customer_account_renewal_batch',
        title=title,
        body=body,
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.session.add(notif)
    batch.flushed_at = datetime.utcnow()
    db.session.commit()

    email_sent = _send_customer_renewal_transactional_email(
        user,
        subject=subject,
        email_title=email_title,
        paragraphs=paragraphs,
    )

    current_app.logger.info(
        'Lote renovación cliente user=%s items=%s email_sent=%s',
        user.id,
        len(items),
        email_sent,
    )
    return True
