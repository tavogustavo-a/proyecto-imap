# -*- coding: utf-8 -*-
"""
Avisos in-app (+ push) para compra/renovación tienda, renovación automática,
recargas y fallback cuando el resumen WhatsApp no se entrega.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Any, Optional

from flask import current_app

from app.extensions import db

logger = logging.getLogger(__name__)

KIND_STORE_PURCHASE = 'store_purchase'
KIND_STORE_RENEWAL = 'store_renewal'
KIND_AUTO_RENEWAL = 'license_auto_renewal'
KIND_AUTO_RENEWAL_FAILED = 'license_auto_renewal_failed'
KIND_BALANCE_RECHARGE = 'balance_recharge'
KIND_WA_DIGEST_FALLBACK = 'whatsapp_digest_fallback'
KIND_ADMIN_BALANCE_RECHARGE = 'admin_balance_recharge'
KIND_ADMIN_RESERVATION = 'admin_product_reservation'
KIND_ADMIN_WA_DIGEST_FALLBACK = 'admin_whatsapp_digest_fallback'
KIND_ADMIN_STOCK_UPLOAD = 'admin_stock_upload'

# Motivos SSE de recarga que sí interesan al cliente (crédito / rechazo / confirmación).
_RECHARGE_NOTIFY_REASONS = frozenset(
    {
        'admin_approved',
        'admin_rejected',
        'admin_confirm_auto',
        'admin_reject_auto',
        'admin_confirm_auto_accum',
        'admin_reject_auto_accum',
        'admin_reject_accumulated',
        'admin_accumulated',
        'email_matched',
        'email_matched_accum',
        'email_confirmed_auto',
        'accum_converted',
        'binance_pay',
        'binance_pay_paid',
        'binance_pay_completed',
        'binance_pay_confirmed',
    }
)


def _add_notification(
    *,
    user_id: int,
    kind: str,
    title: str,
    body: str,
    payload: Optional[dict[str, Any]] = None,
) -> Any:
    from app.store.models import StoreUserNotification
    from app.store.product_reservations import ensure_product_reservation_schema

    ensure_product_reservation_schema()
    notif = StoreUserNotification(
        user_id=int(user_id),
        kind=str(kind)[:40],
        title=str(title or 'Aviso')[:200],
        body=str(body or ''),
        payload_json=json.dumps(payload or {}, ensure_ascii=False),
    )
    db.session.add(notif)
    return notif


def notify_admins_app(
    *,
    kind: str,
    title: str,
    body: str,
    payload: Optional[dict[str, Any]] = None,
    exclude_user_id: Optional[int] = None,
    type_key: Optional[str] = None,
) -> int:
    """Toast/web (+ push) a admin principal y soporte_licencias. Sin email."""
    from app.store.email_notify_prefs import (
        KIND_TO_ADMIN_TYPE,
        user_wants_admin_notify_type,
    )
    from app.store.license_report_notify import _iter_admin_and_soporte_licencias_users

    created = 0
    excl = None
    if exclude_user_id is not None:
        try:
            excl = int(exclude_user_id)
        except (TypeError, ValueError):
            excl = None
    tkey = (type_key or KIND_TO_ADMIN_TYPE.get(str(kind or '').strip()) or '').strip()
    try:
        for dest in _iter_admin_and_soporte_licencias_users():
            did = int(getattr(dest, 'id', 0) or 0)
            if not did or (excl is not None and did == excl):
                continue
            if tkey and not user_wants_admin_notify_type(dest, tkey):
                continue
            _add_notification(
                user_id=did,
                kind=kind,
                title=title,
                body=body,
                payload=payload,
            )
            created += 1
    except Exception as ex:
        logger.warning('notify_admins_app (%s): %s', kind, ex)
    return created


def notify_admin_email_alert(subject: str, body: str) -> bool:
    """Correo de alerta al email admin configurado (p. ej. fallback WhatsApp)."""
    try:
        from app.store.whatsapp_web_service import (
            resolve_whatsapp_admin_alert_email,
            send_whatsapp_alert_email,
        )

        to_email = resolve_whatsapp_admin_alert_email()
        if not to_email:
            logger.info('notify_admin_email_alert omitido: sin email admin.')
            return False
        return bool(send_whatsapp_alert_email(to_email, subject, body))
    except Exception as ex:
        logger.warning('notify_admin_email_alert: %s', ex)
        return False


def _cred_lines_from_licencias(licencias: Any) -> list[str]:
    out: list[str] = []
    if not isinstance(licencias, list):
        return out
    for lic in licencias:
        if not isinstance(lic, dict):
            continue
        email = str(lic.get('email') or '').strip()
        password = str(lic.get('password') or '').strip()
        ident = str(lic.get('identifier') or '').strip()
        if email and password:
            line = f'{email} {password}'.strip()
        elif email:
            line = email
        elif password:
            line = password
        else:
            line = ident
        if line:
            out.append(line)
    return out


def notify_store_purchases_for_sale_ids(sale_ids: list[int]) -> int:
    """Opción 5: 1 toast por venta de checkout normal (compra o renovación tienda)."""
    from app.models.user import User
    from app.store.models import Sale, SalePurchaseSnapshot

    created = 0
    for raw_sid in sale_ids or []:
        try:
            sid = int(raw_sid)
        except (TypeError, ValueError):
            continue
        sale = Sale.query.get(sid)
        if not sale or not getattr(sale, 'user_id', None):
            continue
        renewal_kind = str(getattr(sale, 'renewal_kind', None) or '').strip().lower()
        # Ya tiene aviso propio al enviar la cuenta del cliente
        if renewal_kind == 'customer_account':
            continue

        snap = SalePurchaseSnapshot.query.filter_by(sale_id=sid).first()
        pname = ''
        qty = max(1, int(getattr(sale, 'quantity', 1) or 1))
        total = float(getattr(sale, 'total_price', 0) or 0)
        licencias: list = []
        if snap:
            pname = str(getattr(snap, 'product_name', None) or '').strip()
            qty = max(1, int(getattr(snap, 'quantity', qty) or qty))
            try:
                total = float(getattr(snap, 'total_price', total) or total)
            except (TypeError, ValueError):
                pass
            raw_lic = getattr(snap, 'licencias_json', None) or '[]'
            try:
                parsed = json.loads(raw_lic)
                if isinstance(parsed, list):
                    licencias = parsed
            except (json.JSONDecodeError, TypeError):
                licencias = []
        if not pname and getattr(sale, 'product', None):
            pname = str(getattr(sale.product, 'name', None) or '').strip()
        if not pname:
            pname = 'Producto'

        is_renewal = bool(getattr(sale, 'is_renewal', False))
        creds = _cred_lines_from_licencias(licencias)
        if is_renewal:
            kind = KIND_STORE_RENEWAL
            title = f'Renovación lista: {pname}'
            body = f'Se renovó «{pname}» ({qty} cuenta(s)).'
        else:
            kind = KIND_STORE_PURCHASE
            title = f'Compra lista: {pname}'
            body = f'Tu compra de «{pname}» está lista ({qty} cuenta(s)).'
        if total:
            try:
                body += f'\nTotal: ${total:,.0f}'.replace(',', '.')
            except Exception:
                pass
        if creds:
            body += '\n\n' + ('\n'.join(creds[:8]))

        user = User.query.get(int(sale.user_id))
        if not user:
            continue
        _add_notification(
            user_id=int(user.id),
            kind=kind,
            title=title,
            body=body,
            payload={
                'sale_id': sid,
                'product_id': getattr(sale, 'product_id', None),
                'product_name': pname,
                'quantity': qty,
                'total_price': total,
                'is_renewal': is_renewal,
                'credentials': creds[:8],
                'url': '/tienda/licencias',
            },
        )
        created += 1
    return created


def notify_auto_renewal_success(
    *,
    user,
    product_name: str = '',
    credential_hint: str = '',
    license_id: Optional[int] = None,
    account_id: Optional[int] = None,
) -> None:
    """Opción 6: renovación automática del job diaria (éxito)."""
    if not user or not getattr(user, 'id', None):
        return
    pname = (product_name or 'Producto').strip() or 'Producto'
    cred = re.sub(r'\s+', ' ', str(credential_hint or '').strip())
    title = f'Renovación automática: {pname}'
    body = f'Se renovó automáticamente «{pname}».'
    if cred:
        body += f'\n\nCuenta: {cred}'
    _add_notification(
        user_id=int(user.id),
        kind=KIND_AUTO_RENEWAL,
        title=title,
        body=body,
        payload={
            'product_name': pname,
            'credential': cred,
            'license_id': license_id,
            'account_id': account_id,
            'url': '/tienda/licencias',
        },
    )


def notify_auto_renewal_failed(
    *,
    user,
    product_name: str = '',
    credential_hint: str = '',
    reason: str = '',
    license_id: Optional[int] = None,
    account_id: Optional[int] = None,
    message: str = '',
) -> None:
    """Opción 6: renovación automática fallida (p. ej. sin saldo)."""
    if not user or not getattr(user, 'id', None):
        return
    pname = (product_name or 'Producto').strip() or 'Producto'
    cred = re.sub(r'\s+', ' ', str(credential_hint or '').strip())
    detail = (message or '').strip() or 'No se pudo renovar automáticamente.'
    title = f'Renovación no realizada: {pname}'
    body = f'{detail}'
    if cred:
        body += f'\n\nCuenta: {cred}'
    _add_notification(
        user_id=int(user.id),
        kind=KIND_AUTO_RENEWAL_FAILED,
        title=title,
        body=body,
        payload={
            'product_name': pname,
            'credential': cred,
            'reason': reason,
            'license_id': license_id,
            'account_id': account_id,
            'url': '/tienda/licencias',
        },
    )


def notify_balance_recharge_event(row, *, reason: str) -> None:
    """Opción 7: recarga acreditada / rechazada / confirmada → toast app."""
    from app.models.user import User

    rk = str(reason or '').strip()
    if rk not in _RECHARGE_NOTIFY_REASONS:
        # Auto-crédito al enviar también puede llegar como 'submitted' con auto_credited
        if rk == 'submitted' and not bool(getattr(row, 'auto_credited', False)):
            return
        if rk != 'submitted':
            return

    uid = getattr(row, 'user_id', None)
    if uid is None:
        return
    user = User.query.get(int(uid))
    if not user:
        return

    status = str(getattr(row, 'status', '') or '').strip().lower()
    cur = str(getattr(row, 'currency', 'COP') or 'COP').strip().upper()
    amount = getattr(row, 'amount_credited', None)
    if amount is None:
        amount = getattr(row, 'amount_claimed', None)
    try:
        amount_f = float(amount or 0)
    except (TypeError, ValueError):
        amount_f = 0.0
    amount_s = f'{amount_f:,.0f}'.replace(',', '.') if amount_f else '—'

    rejected = (
        'reject' in rk
        or status in ('rejected', 'auto_rejected')
        or rk.endswith('_rejected')
    )
    if rejected:
        title = 'Recarga rechazada'
        body = f'Tu solicitud de recarga por ${amount_s} {cur} fue rechazada.'
        note = str(getattr(row, 'admin_note', '') or '').strip()
        if note:
            body += f'\n\nMotivo: {note[:300]}'
    else:
        title = 'Recarga acreditada'
        body = f'Se acreditaron ${amount_s} {cur} a tu saldo.'

    _add_notification(
        user_id=int(user.id),
        kind=KIND_BALANCE_RECHARGE,
        title=title,
        body=body,
        payload={
            'recharge_id': getattr(row, 'id', None),
            'reason': rk,
            'status': status,
            'currency': cur,
            'amount': amount_f,
            'url': '/tienda/recargas',
        },
    )

    uname = str(getattr(user, 'username', None) or '').strip() or f'user#{user.id}'
    if rejected:
        admin_title = f'Recarga rechazada: {uname}'
        admin_body = f'{uname}: solicitud por ${amount_s} {cur} rechazada.'
        note = str(getattr(row, 'admin_note', '') or '').strip()
        if note:
            admin_body += f'\nMotivo: {note[:300]}'
    else:
        admin_title = f'Recarga acreditada: {uname}'
        admin_body = f'{uname}: se acreditaron ${amount_s} {cur}.'
    notify_admins_app(
        kind=KIND_ADMIN_BALANCE_RECHARGE,
        title=admin_title,
        body=admin_body,
        payload={
            'recharge_id': getattr(row, 'id', None),
            'reason': rk,
            'status': status,
            'currency': cur,
            'amount': amount_f,
            'customer_user_id': int(user.id),
            'customer_username': uname,
            'url': '/tienda/admin/recargas-saldo',
        },
        exclude_user_id=int(user.id),
    )


def _send_digest_fallback_email(user, *, subject: str, paragraphs: list[str]) -> bool:
    from app.store.customer_account_renewals import _user_platform_email
    from app.store.email_notify_prefs import user_receives_email_notifications
    from app.services.email_service import (
        email_recipient_display_name,
        render_transactional_email_html,
        send_transactional_email,
    )

    if not user_receives_email_notifications(user):
        return False
    to_email = _user_platform_email(user)
    if not to_email:
        return False
    uname = email_recipient_display_name(user)
    body_lines = [f'Hola {uname},'] if uname else ['Hola,']
    body_lines.extend(paragraphs)
    body_lines.extend(['', 'Tu Premium — mensaje automático de la tienda.'])
    body_text = '\n\n'.join(body_lines)
    body_html = None
    try:
        body_html = render_transactional_email_html(
            subject.split('—')[0].strip() or 'Resumen de tu día',
            uname,
            paragraphs,
            include_store_link=False,
        )
    except Exception:
        body_html = None
    try:
        return send_transactional_email(
            to_email=to_email,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
        )
    except Exception as ex:
        current_app.logger.warning('email fallback digest WA: %s', ex)
        return False


def notify_whatsapp_digest_undelivered(
    billing_user,
    co_date: date,
    snapshots: list,
    *,
    outcome: str,
    reason: str = '',
    digest_body: Optional[str] = None,
) -> None:
    """
    Opción 8: si el resumen WhatsApp no se entrega (sin teléfono, desactivado o error final),
    avisa al cliente en app y por email (si el checkbox de email está activo),
    y al admin/soporte en app/web + correo de alerta.
    """
    if not billing_user or not getattr(billing_user, 'id', None):
        return

    co_s = co_date.isoformat() if hasattr(co_date, 'isoformat') else str(co_date)
    oc = str(outcome or '').strip().lower()
    why = str(reason or '').strip()
    if oc == 'sin_telefono':
        lead = 'No pudimos enviarte el resumen por WhatsApp (sin teléfono en tu perfil).'
    elif oc == 'deshabilitado':
        lead = 'No pudimos enviarte el resumen por WhatsApp (avisos WhatsApp desactivados).'
    else:
        lead = 'No pudimos enviarte el resumen diario por WhatsApp.'
        if why:
            lead += f' Motivo: {why}'

    body_text = digest_body
    if not body_text:
        try:
            from app.store.whatsapp_daily_sales import build_daily_sales_whatsapp_message

            body_text = build_daily_sales_whatsapp_message(
                customer_name=getattr(billing_user, 'username', '') or '',
                co_date=co_date,
                snapshots=list(snapshots or []),
                billing_user=billing_user,
            )
        except Exception:
            body_text = None

    title = f'Resumen del {co_date.strftime("%d/%m/%Y")}' if hasattr(co_date, 'strftime') else 'Resumen diario'
    app_body = lead
    if body_text:
        app_body += '\n\n' + str(body_text)

    _add_notification(
        user_id=int(billing_user.id),
        kind=KIND_WA_DIGEST_FALLBACK,
        title=title[:200],
        body=app_body[:4000],
        payload={
            'co_date': co_s,
            'outcome': oc,
            'reason': why,
            'url': '/tienda/historial',
            'sale_ids': [
                int(s.sale_id)
                for s in (snapshots or [])
                if getattr(s, 'sale_id', None) is not None
            ][:40],
        },
    )

    uname = str(getattr(billing_user, 'username', None) or '').strip() or f'user#{billing_user.id}'
    admin_title = f'WhatsApp no entregado: {uname}'
    admin_body = f'{lead}\nCliente: {uname} ({co_s}).'
    if body_text:
        admin_body += '\n\n' + str(body_text)[:2500]
    notify_admins_app(
        kind=KIND_ADMIN_WA_DIGEST_FALLBACK,
        title=admin_title[:200],
        body=admin_body[:4000],
        payload={
            'co_date': co_s,
            'outcome': oc,
            'reason': why,
            'customer_user_id': int(billing_user.id),
            'customer_username': uname,
            'url': '/tienda/historial',
        },
        exclude_user_id=int(billing_user.id),
    )
    try:
        from app.models.user import User
        from app.store.email_notify_prefs import user_wants_admin_notify_type

        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        admin_u = User.query.filter_by(username=admin_username, parent_id=None).first()
        if admin_u is None or user_wants_admin_notify_type(admin_u, 'wa_digest'):
            notify_admin_email_alert(
                subject=f'WhatsApp digest no entregado — {uname} — {co_s}',
                body=admin_body[:6000],
            )
    except Exception as ex:
        current_app.logger.warning('notify_whatsapp_digest_undelivered admin email: %s', ex)

    paragraphs = [lead]
    if body_text:
        paragraphs.append(str(body_text))
    paragraphs.append('También puedes verlo en tu historial de compras.')
    try:
        _send_digest_fallback_email(
            billing_user,
            subject=f'{title} — Tu Premium',
            paragraphs=paragraphs,
        )
    except Exception as ex:
        current_app.logger.warning('notify_whatsapp_digest_undelivered email: %s', ex)


def notify_admin_stock_upload(
    *,
    product_name: str,
    created: int,
    license_id: Optional[int] = None,
    product_id: Optional[int] = None,
    actor_user_id: Optional[int] = None,
    commit: bool = False,
) -> int:
    """Avisa a admin/soporte cuando se suben cuentas nuevas al bloc Licencias."""
    n = int(created or 0)
    if n <= 0:
        return 0
    pname = str(product_name or '').strip() or 'Producto'
    if n == 1:
        title = 'Stock: 1 cuenta - %s' % pname
        body = 'Se subió 1 cuenta de «%s».' % pname
    else:
        title = 'Stock: %s cuentas - %s' % (n, pname)
        body = 'Se subieron %s cuentas de «%s».' % (n, pname)
    created_n = notify_admins_app(
        kind=KIND_ADMIN_STOCK_UPLOAD,
        title=title[:200],
        body=body,
        payload={
            'product_name': pname,
            'created': n,
            'license_id': license_id,
            'product_id': product_id,
            'url': '/tienda/admin',
        },
        exclude_user_id=actor_user_id,
        type_key='stock_upload',
    )
    if commit and created_n:
        try:
            db.session.commit()
        except Exception as ex:
            db.session.rollback()
            logger.warning('notify_admin_stock_upload commit: %s', ex)
            return 0
    return created_n
