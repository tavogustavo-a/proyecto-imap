# -*- coding: utf-8 -*-
"""Notificaciones in-app (y push vía after_insert) al contestar reportes / garantías."""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from flask import current_app
from sqlalchemy import func as sa_func

from app import db


KIND_BUENA = 'license_report_buena'
KIND_WARRANTY_REPLACED = 'license_warranty_replaced'
KIND_WARRANTY_PENDING = 'license_warranty_pending'
KIND_SOLUCIONADA = 'license_report_solucionada'
KIND_ADMIN_REPORT_NEW = 'admin_license_report_new'

_VALID_OUTCOMES = frozenset({'buena', 'warranty_replaced', 'warranty_pending', 'solucionada'})
_ADMIN_REPORT_KINDS = frozenset({'caida', 'garantia', 'incidencia'})


def _norm_user_key(s: Any) -> str:
    return re.sub(r'\s+', ' ', str(s or '').strip().lower())


def resolve_store_user_for_report_notify(
    *,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
):
    """Resuelve el usuario de tienda a notificar (asignado o nombre en el bloc)."""
    from app.models.user import User

    if user_id is not None:
        try:
            uid = int(user_id)
        except (TypeError, ValueError):
            uid = None
        if uid:
            u = User.query.get(uid)
            if u:
                return u

    name = str(username or '').strip()
    if not name or _norm_user_key(name) in ('anonimo', 'anónimo', '—', '-'):
        return None

    needle = _norm_user_key(name)
    u = User.query.filter(sa_func.lower(User.username) == needle).first()
    if u:
        return u
    # Email completo o parte local
    candidates = User.query.filter(User.email.isnot(None)).all()
    for cand in candidates:
        em = str(cand.email or '').strip()
        local = em.split('@', 1)[0] if em else ''
        if _norm_user_key(em) == needle or _norm_user_key(local) == needle:
            return cand
    return None


def _product_name_for_license(license_obj) -> str:
    try:
        prod = getattr(license_obj, 'product', None)
        if prod and getattr(prod, 'name', None):
            return str(prod.name).strip() or 'Producto'
    except Exception:
        pass
    return 'Producto'


def _iter_admin_and_soporte_licencias_users():
    """Admin principal + usuarios con permiso soporte_licencias."""
    from app.models.user import User

    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    seen: set[int] = set()
    admin = User.query.filter_by(username=admin_username, parent_id=None).first()
    if admin and getattr(admin, 'id', None):
        seen.add(int(admin.id))
        yield admin

    for u in User.query.filter(User.enabled.is_(True)).all():
        uid = int(getattr(u, 'id', 0) or 0)
        if not uid or uid in seen:
            continue
        up = u.user_prices if isinstance(u.user_prices, dict) else {}
        if not bool(up.get('soporte_licencias')):
            # Subusuario: hereda del padre
            if getattr(u, 'parent_id', None):
                parent = User.query.get(u.parent_id)
                pup = (
                    parent.user_prices
                    if parent and isinstance(parent.user_prices, dict)
                    else {}
                )
                if not bool(pup.get('soporte_licencias')):
                    continue
            else:
                continue
        seen.add(uid)
        yield u


def _report_kind_label(report_kind: str) -> str:
    k = str(report_kind or '').strip().lower()
    if k == 'caida':
        return 'Caída / suspendida'
    if k == 'garantia':
        return 'Garantía'
    if k == 'incidencia':
        return 'Incidencia'
    return 'Reporte'


def notify_admin_license_report_from_user(
    *,
    reporter_user,
    product_name: str = '',
    report_kind: str = 'caida',
    credential_hint: str = '',
    license_id: Optional[int] = None,
    calendar_day: Optional[int] = None,
    detail: str = '',
    commit: bool = False,
) -> dict[str, Any]:
    """
    Avisa a admin/soporte cuando un cliente reporta caída, garantía u otra incidencia.
    Canal: StoreUserNotification (toast/push). Sin email.
    """
    from app.store.models import StoreUserNotification
    from app.store.product_reservations import ensure_product_reservation_schema

    result: dict[str, Any] = {'notifications': 0}
    rk = str(report_kind or '').strip().lower()
    if rk not in _ADMIN_REPORT_KINDS:
        rk = 'incidencia'

    pname = (product_name or '').strip() or 'Producto'
    uname = (
        str(getattr(reporter_user, 'username', None) or '').strip()
        or str(getattr(reporter_user, 'email', None) or '').strip()
        or 'cliente'
    )
    cred = re.sub(r'\s+', ' ', str(credential_hint or '').strip())
    day_bit = ''
    if calendar_day is not None:
        try:
            d = int(calendar_day)
            if 1 <= d <= 31:
                day_bit = f' (día {d})'
        except (TypeError, ValueError):
            pass
    kind_label = _report_kind_label(rk)
    detail_s = str(detail or '').strip()

    try:
        ensure_product_reservation_schema()
        title = f'Reporte: {pname}'
        body = f'{uname} reportó «{kind_label}» en {pname}{day_bit}.'
        if cred:
            body += f'\n\nCuenta: {cred}'
        if detail_s:
            body += f'\n{detail_s}'
        payload = {
            'report_kind': rk,
            'license_id': license_id,
            'product_name': pname,
            'credential': cred,
            'day': calendar_day,
            'reporter_username': uname,
            'reporter_user_id': getattr(reporter_user, 'id', None),
            'url': '/tienda/admin',
        }
        for dest in _iter_admin_and_soporte_licencias_users():
            # No notificar al mismo usuario que reportó (caso soporte probando portal)
            if (
                reporter_user is not None
                and getattr(reporter_user, 'id', None)
                and int(dest.id) == int(reporter_user.id)
            ):
                continue
            try:
                from app.store.email_notify_prefs import user_wants_admin_notify_type

                if not user_wants_admin_notify_type(dest, 'license_report'):
                    continue
            except Exception:
                pass
            notif = StoreUserNotification(
                user_id=int(dest.id),
                kind=KIND_ADMIN_REPORT_NEW,
                title=title[:200],
                body=body,
                payload_json=json.dumps(payload, ensure_ascii=False),
            )
            db.session.add(notif)
            result['notifications'] += 1
        if commit and result['notifications']:
            db.session.commit()
    except Exception as ex:
        current_app.logger.warning('notify_admin_license_report notif: %s', ex)
        if commit:
            try:
                db.session.rollback()
            except Exception:
                pass

    return result


def notify_license_report_answered(
    *,
    user,
    license_obj=None,
    outcome: str,
    credential_hint: str = '',
    new_credential: str = '',
    day: Optional[int] = None,
    product_name: Optional[str] = None,
    commit: bool = False,
) -> Optional[Any]:
    """
    Crea StoreUserNotification para el cliente.
    outcome: buena | warranty_replaced | warranty_pending
    """
    from app.store.models import StoreUserNotification
    from app.store.product_reservations import ensure_product_reservation_schema

    if not user or not getattr(user, 'id', None):
        return None
    oc = str(outcome or '').strip().lower()
    if oc not in _VALID_OUTCOMES:
        return None

    ensure_product_reservation_schema()

    pname = (product_name or '').strip() or _product_name_for_license(license_obj)
    cred_old = re.sub(r'\s+', ' ', str(credential_hint or '').strip())
    cred_new = re.sub(r'\s+', ' ', str(new_credential or '').strip())
    day_bit = ''
    if day is not None:
        try:
            d = int(day)
            if 1 <= d <= 31:
                day_bit = f' (día {d})'
        except (TypeError, ValueError):
            pass

    if oc == 'buena':
        kind = KIND_BUENA
        title = f'Reporte revisado: {pname}'
        body = (
            f'Soporte marcó tu reporte de «{pname}» como buena{day_bit}. '
            f'La cuenta quedó confirmada.'
        )
        if cred_old:
            body += f'\n\nCuenta: {cred_old}'
    elif oc == 'solucionada':
        kind = KIND_SOLUCIONADA
        title = f'Cuenta solucionada: {pname}'
        body = (
            f'Soporte marcó tu cuenta de «{pname}» como solucionada{day_bit}. '
            f'El estado queda así hasta el próximo día (salvo que lo cambien).'
        )
        if cred_old:
            body += f'\n\nCuenta: {cred_old}'
    elif oc == 'warranty_replaced':
        kind = KIND_WARRANTY_REPLACED
        title = f'Garantía entregada: {pname}'
        body = f'Te enviamos un reemplazo por garantía de «{pname}»{day_bit}.'
        if cred_new:
            body += f'\n\nNueva cuenta:\n{cred_new}'
        elif cred_old:
            body += f'\n\nReemplazo de: {cred_old}'
    else:
        kind = KIND_WARRANTY_PENDING
        title = f'Garantía en espera: {pname}'
        body = (
            f'Tu reporte de «{pname}» quedó en garantía{day_bit}. '
            f'Apenas haya stock te entregamos el repuesto.'
        )
        if cred_old:
            body += f'\n\nCuenta: {cred_old}'

    payload = {
        'outcome': oc,
        'license_id': getattr(license_obj, 'id', None),
        'product_id': getattr(getattr(license_obj, 'product', None), 'id', None),
        'product_name': pname,
        'credential': cred_old,
        'new_credential': cred_new,
        'day': day,
        'url': '/tienda/licencias',
    }

    notif = StoreUserNotification(
        user_id=int(user.id),
        kind=kind,
        title=title[:200],
        body=body,
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.session.add(notif)

    if oc == 'solucionada':
        try:
            from app.store.routes import _billing_user_for_store_debt_limit
            from app.store.user_license_activity import append_portal_license_activity_record

            billing_for_log = (_billing_user_for_store_debt_limit(user) or user)
            if billing_for_log is not None:
                append_portal_license_activity_record(
                    billing_for_log,
                    'solucionada',
                    '%s · solucionada' % pname,
                    detail=cred_old or None,
                    extra={
                        'license_id': getattr(license_obj, 'id', None),
                        'product_name': pname,
                        'cred_hint': cred_old,
                        'day': day,
                    },
                )
        except Exception as log_err:
            current_app.logger.warning('log solucionada historial: %s', log_err)

    try:
        from app.store.license_report_answer_email_batch import (
            queue_license_report_answer_email,
        )

        queue_license_report_answer_email(
            user,
            outcome=oc,
            product_name=pname,
            credential_hint=cred_old,
            new_credential=cred_new,
            day=day,
            license_id=getattr(license_obj, 'id', None),
        )
    except Exception as mail_err:
        current_app.logger.warning('queue license report answer email: %s', mail_err)

    if commit:
        try:
            db.session.commit()
        except Exception as ex:
            db.session.rollback()
            current_app.logger.warning('notify_license_report_answered commit: %s', ex)
            return None
    return notif
