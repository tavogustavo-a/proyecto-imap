# -*- coding: utf-8 -*-
"""Renovación con cuenta del cliente (renew_customer_account en License)."""
from __future__ import annotations

import json
import re
from datetime import datetime

from flask import current_app
from sqlalchemy import func, inspect, text

from app.extensions import db


def ensure_customer_account_renewal_schema():
    """Crea columna/tabla de renovación cuenta cliente si faltan."""
    try:
        from app.store.models import CustomerAccountRenewalOrder, License

        insp = inspect(db.engine)
        tables = set(insp.get_table_names())

        if 'store_licenses' in tables:
            cols = {c['name'].lower() for c in insp.get_columns('store_licenses')}
            dialect = getattr(db.engine.dialect, 'name', '') or ''
            bool_col_sql = (
                'BOOLEAN NOT NULL DEFAULT FALSE'
                if dialect == 'postgresql'
                else 'INTEGER DEFAULT 0 NOT NULL'
            )
            if 'renew_customer_account' not in cols:
                db.session.execute(
                    text(
                        f'ALTER TABLE store_licenses ADD COLUMN renew_customer_account {bool_col_sql}'
                    )
                )
                db.session.commit()
            cols = {c['name'].lower() for c in insp.get_columns('store_licenses')}
            if 'customer_renewal_notes' not in cols:
                db.session.execute(
                    text('ALTER TABLE store_licenses ADD COLUMN customer_renewal_notes TEXT')
                )
                db.session.commit()

        if CustomerAccountRenewalOrder.__tablename__ not in tables:
            CustomerAccountRenewalOrder.__table__.create(db.engine, checkfirst=True)
    except Exception as ex:
        db.session.rollback()
        current_app.logger.warning('ensure_customer_account_renewal_schema: %s', ex)


def _licenses_for_customer_renewal(product_id):
    """Licencias habilitadas del producto con «Renovar tu cuenta» activo."""
    from app.store.models import License

    rows = (
        License.query.filter_by(product_id=int(product_id), enabled=True)
        .order_by(License.position.asc(), License.id.asc())
        .all()
    )
    flagged = [r for r in rows if bool(getattr(r, 'renew_customer_account', False))]
    return flagged


def product_allows_customer_account_renewal(product) -> bool:
    if not product or not getattr(product, 'id', None):
        return False
    return bool(_licenses_for_customer_renewal(product.id))


def _product_renew_customer_account_map(products):
    from app.store.models import License

    if not products:
        return {}
    ids = [p.id for p in products if getattr(p, 'id', None) is not None]
    if not ids:
        return {}
    flags = {pid: False for pid in ids}
    rows = License.query.filter(License.product_id.in_(ids), License.enabled.is_(True)).all()
    for lic in rows:
        if bool(getattr(lic, 'renew_customer_account', False)):
            flags[lic.product_id] = True
    return flags


def _primary_license_id_for_product(product_id):
    lic_rows = _licenses_for_customer_renewal(product_id)
    return lic_rows[0].id if lic_rows else None


def _is_valid_customer_renewal_email(email) -> bool:
    em = (email or '').strip()
    if not em or len(em) > 255 or '@' not in em:
        return False
    _local, _sep, domain = em.partition('@')
    if not _local or not domain or '.' not in domain:
        return False
    return True


def validate_customer_renewal_credentials(email, password):
    em = (email or '').strip()
    pw = (password or '').strip()
    if not _is_valid_customer_renewal_email(em):
        return None, None, 'Indica un correo válido de la cuenta a renovar (con @ y punto).'
    if len(pw) > 255:
        return None, None, 'La contraseña es demasiado larga.'
    return em, pw, None


def _product_name_is_netflix(name):
    import re

    return bool(name and re.search(r'netflix', str(name).strip(), re.I))


def validate_customer_renewal_from_cart_item(product, email=None, password=None, customer_credential=None):
    """
    Valida renovación con cuenta del cliente.
    Preferir ``customer_credential`` (correo y contraseña en una línea).
    """
    from app.store.user_license_line_parse import parse_cred_part_plain

    cred_raw = (customer_credential or '').strip()
    if cred_raw:
        is_nf = _product_name_is_netflix(getattr(product, 'name', None) if product else None)
        parsed = parse_cred_part_plain(cred_raw, is_nf)
        if parsed and parsed.get('email'):
            em = str(parsed.get('email') or '').strip()
            pw = str(parsed.get('password') or '').strip()
            if pw == '.':
                pw = ''
            if parsed.get('netflix_slot') is not None and not pw:
                return None, None, None, 'Indica la contraseña de la cuenta Netflix en la misma línea.'
            if not _is_valid_customer_renewal_email(em):
                return (
                    None,
                    None,
                    None,
                    'Indica un correo válido (con @ y punto). Opcional: añade la contraseña en la misma línea.',
                )
            if len(pw) > 255:
                return None, None, None, 'La contraseña es demasiado larga.'
            if len(cred_raw) > 500:
                return None, None, None, 'La línea de cuenta es demasiado larga.'
            return em, pw, cred_raw, None
        if _is_valid_customer_renewal_email(cred_raw) and ' ' not in cred_raw and ':' not in cred_raw:
            if len(cred_raw) > 500:
                return None, None, None, 'La línea de cuenta es demasiado larga.'
            return cred_raw.strip(), '', cred_raw, None
        return (
            None,
            None,
            None,
            'Indica un correo válido (con @ y punto). Opcional: añade la contraseña en la misma línea.',
        )

    em, pw, err = validate_customer_renewal_credentials(email, password)
    if err:
        return None, None, None, err
    cred_line = f'{em} {pw}'.strip()
    return em, pw, cred_line, None


def build_customer_renewal_storage_line(email, password, username, credential_line=None):
    from app.store.user_license_line_parse import LICENSE_LINE_FIELD_SEP

    cred = (credential_line or '').strip()
    if not cred:
        em = (email or '').strip()
        pw = (password or '').strip()
        cred = (em + ' ' + pw).strip() if pw else em
    user = (username or 'anonimo').strip() or 'anonimo'
    return LICENSE_LINE_FIELD_SEP.join([cred, user, '', '', ''])


def customer_renewal_buyer_label(user):
    """Nombre visible en admin: nombre completo del cliente o, si no hay, usuario de login."""
    if not user:
        return 'anonimo'
    full = (getattr(user, 'full_name', None) or '').strip()
    if full:
        return full
    un = (getattr(user, 'username', None) or '').strip()
    return un or 'anonimo'


def _buyer_matches_renewal_label(buyer, label):
    if not buyer:
        return False
    lab = (label or '').strip().lower()
    if not lab or lab in ('anonimo', 'genérico', 'generico'):
        return False
    if (getattr(buyer, 'username', None) or '').strip().lower() == lab:
        return True
    if (getattr(buyer, 'full_name', None) or '').strip().lower() == lab:
        return True
    return False


def enrich_customer_renewal_notes_for_display(notes_text, license_id):
    """
    Alinea la columna usuario con el cliente del pedido pagado (nombre completo o login).
    Corrige filas antiguas que guardaron username de prueba distinto al comprador real.
    """
    from app.models.user import User
    from app.store.models import CustomerAccountRenewalOrder, License
    from app.store.user_license_line_parse import LICENSE_LINE_FIELD_SEP

    raw = notes_text if notes_text is not None else ''
    lic = License.query.get(int(license_id)) if license_id else None
    if not lic or not getattr(lic, 'product_id', None):
        return raw
    product_id = int(lic.product_id)
    sep = LICENSE_LINE_FIELD_SEP
    out = []
    for ln in raw.replace('\r\n', '\n').split('\n'):
        if not str(ln).strip():
            out.append(ln)
            continue
        if sep not in ln:
            out.append(ln)
            continue
        parts = ln.split(sep)
        cred = parts[0] if parts else ''
        email = extract_email_from_renewal_credential(cred)
        if not email:
            out.append(ln)
            continue
        order = (
            CustomerAccountRenewalOrder.query.filter(
                CustomerAccountRenewalOrder.product_id == product_id,
                func.lower(CustomerAccountRenewalOrder.customer_email) == email,
            )
            .order_by(CustomerAccountRenewalOrder.created_at.desc())
            .first()
        )
        if not order:
            out.append(ln)
            continue
        buyer = User.query.get(order.user_id)
        label = customer_renewal_buyer_label(buyer)
        while len(parts) < 5:
            parts.append('')
        parts[1] = label
        out.append(sep.join(parts))
    return '\n'.join(out)


def customer_renewal_notes_for_api(license_row):
    """Texto del bloc «Cuentas para renovar» con nombres de cliente alineados al pedido."""
    if not license_row:
        return ''
    raw = getattr(license_row, 'customer_renewal_notes', None) or ''
    return enrich_customer_renewal_notes_for_display(raw, getattr(license_row, 'id', None))


def append_customer_renewal_notes_for_checkout(product, user, email, password, credential_line=None):
    """Añade la cuenta comprada al bloc admin «Cuentas para renovar» (sin inventario)."""
    if not product or not getattr(product, 'id', None):
        return
    buyer_label = customer_renewal_buyer_label(user)
    line = build_customer_renewal_storage_line(
        email, password, buyer_label, credential_line=credential_line
    )
    for license_obj in _licenses_for_customer_renewal(product.id):
        existing = getattr(license_obj, 'customer_renewal_notes', None) or ''
        lines = [ln for ln in existing.replace('\r\n', '\n').split('\n') if ln.strip()]
        if line not in lines:
            lines.append(line)
        license_obj.customer_renewal_notes = '\n'.join(lines)


def create_customer_account_renewal_order(user, product, sale, email, password):
    from app.store.models import CustomerAccountRenewalOrder

    ensure_customer_account_renewal_schema()
    row = CustomerAccountRenewalOrder(
        user_id=int(user.id),
        product_id=int(product.id),
        license_id=_primary_license_id_for_product(product.id),
        sale_id=int(sale.id) if sale and sale.id else None,
        customer_email=(email or '').strip().lower(),
        customer_password=password,
        status='pending',
    )
    db.session.add(row)
    return row


def notify_customer_account_renewal_received(user, product, email):
    from app.store.models import StoreUserNotification

    pname = getattr(product, 'name', None) or 'Producto'
    em = (email or '').strip()
    title = f'Renovación recibida: {pname}'
    body = (
        f'Recibimos tu solicitud de renovación para «{pname}» con la cuenta {em}. '
        f'La procesaremos y te avisaremos cuando esté lista.'
    )
    notif = StoreUserNotification(
        user_id=int(user.id),
        kind='customer_account_renewal_received',
        title=title,
        body=body,
        payload_json=None,
    )
    db.session.add(notif)
    return notif


def extract_email_from_renewal_credential(credential):
    c = (credential or '').strip()
    if not c:
        return ''
    m = re.search(r'\S+@\S+\.\S+', c)
    return m.group(0).strip().lower() if m else ''


def _normalize_client_username(value):
    u = (value or '').strip().lower()
    if not u or u in ('anonimo', 'genérico', 'generico'):
        return ''
    return u


def find_pending_customer_renewal_order(license_id, customer_email, client_username=None):
    """Busca pedido pendiente por producto de la licencia + correo de la cuenta enviada."""
    from app.models.user import User
    from app.store.models import CustomerAccountRenewalOrder, License

    em = (customer_email or '').strip().lower()
    if not em:
        return None
    lic = License.query.get(int(license_id))
    if not lic:
        return None

    q = CustomerAccountRenewalOrder.query.filter(
        CustomerAccountRenewalOrder.status == 'pending',
        func.lower(CustomerAccountRenewalOrder.customer_email) == em,
    )
    if getattr(lic, 'product_id', None):
        q = q.filter(CustomerAccountRenewalOrder.product_id == int(lic.product_id))
    else:
        q = q.filter(CustomerAccountRenewalOrder.license_id == int(license_id))

    rows = q.order_by(CustomerAccountRenewalOrder.created_at.desc()).all()
    if not rows:
        return None

    uname = _normalize_client_username(client_username)
    if uname:
        for row in rows:
            buyer = User.query.get(row.user_id)
            if _buyer_matches_renewal_label(buyer, client_username):
                return row
    return rows[0]


def _user_store_currency(user):
    up = getattr(user, 'user_prices', None) or {}
    if isinstance(up, dict):
        tp = (up.get('tipo_precio') or 'COP').strip().upper()
        if tp in ('USD', 'COP'):
            return tp
    return 'COP'


def refund_customer_account_renewal_sale(user, _product, sale_id):
    """Devuelve el saldo de la compra y marca el snapshot como revertido."""
    from app.store.balance_recharge_credit import apply_user_balance_credit
    from app.store.models import Sale
    from app.store.sale_purchase_snapshot import ensure_sale_schema, mark_sale_reversed_in_session

    ensure_sale_schema()
    if not sale_id:
        return False, 'no_sale', None
    sale = Sale.query.get(int(sale_id))
    if not sale:
        return False, 'sale_not_found', None

    snap, newly_reversed = mark_sale_reversed_in_session(sale.id)
    if not newly_reversed:
        if snap and bool(getattr(snap, 'is_reversed', False)):
            return False, 'already_refunded', None
        return False, 'snapshot_missing', None

    amount = float(sale.total_price or 0)
    if amount <= 0:
        return False, 'zero_amount', None

    currency = _user_store_currency(user)
    if user.saldo_cop is None:
        user.saldo_cop = 0
    if user.saldo_usd is None:
        user.saldo_usd = 0
    apply_user_balance_credit(user, currency, amount)
    return True, 'refunded', {'currency': currency, 'amount': amount}


def _reject_result_payload(
    order,
    *,
    notified=False,
    email_sent=False,
    refund_ok=False,
    refund_info=None,
    no_order=False,
    already_rejected=False,
):
    payload = {
        'order_id': int(order.id) if order else None,
        'notified': bool(notified),
        'email_sent': bool(email_sent),
        'refunded': bool(refund_ok),
        'no_order': bool(no_order),
        'already_rejected': bool(already_rejected),
    }
    if refund_info:
        payload['refund_currency'] = refund_info.get('currency')
        payload['refund_amount'] = refund_info.get('amount')
    if order and getattr(order, 'user_id', None):
        from app.models.user import User

        buyer = User.query.get(order.user_id)
        if buyer:
            payload['client_username'] = getattr(buyer, 'username', None) or ''
    return payload


def notify_customer_account_renewal_completed(user, product, account_email, day=None):
    from app.store.models import StoreUserNotification

    pname = getattr(product, 'name', None) or 'Producto'
    em = (account_email or '').strip()
    title = f'Renovación lista: {pname}'
    body = f'Tu cuenta {em} para «{pname}» ya fue renovada.'
    if day is not None:
        try:
            d = int(day)
            if 1 <= d <= 31:
                body += f' (día {d} del calendario admin).'
        except (TypeError, ValueError):
            pass
    payload = {
        'product_id': getattr(product, 'id', None),
        'product_name': pname,
        'account_email': em,
        'day': day,
    }
    notif = StoreUserNotification(
        user_id=int(user.id),
        kind='customer_account_renewal_completed',
        title=title,
        body=body,
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.session.add(notif)
    return notif


def email_customer_account_renewal_completed(user, product, account_email):
    """Correo al email registrado del usuario en la plataforma (no al correo de la cuenta Netflix/etc.)."""
    to_email = (getattr(user, 'email', None) or '').strip()
    if not to_email:
        return False
    pname = getattr(product, 'name', None) or 'Producto'
    em = (account_email or '').strip()
    uname = getattr(user, 'username', None) or ''
    subject = f'Cuenta renovada — {pname}'
    text = (
        f'Hola {uname},\n\n'
        f'Tu solicitud de renovación para «{pname}» ya está lista.\n'
        f'La cuenta {em} fue renovada correctamente.\n\n'
        f'También puedes ver el aviso en la tienda de la plataforma.\n'
    )
    html = (
        f'<p>Hola <strong>{uname}</strong>,</p>'
        f'<p>Tu solicitud de renovación para <strong>{pname}</strong> ya está lista.</p>'
        f'<p>La cuenta <strong>{em}</strong> fue renovada correctamente.</p>'
        f'<p>También puedes ver el aviso en la tienda de la plataforma.</p>'
    )
    from_email = current_app.config.get('SMTP_FROM', 'noreply@tusitio.com')
    try:
        from app.services.smtp_client import send_email_via_smtp

        return bool(
            send_email_via_smtp(
                from_email=from_email,
                to_email=to_email,
                subject=subject,
                text_content=text,
                html_content=html,
            )
        )
    except Exception as ex:
        current_app.logger.warning('email renovación cuenta cliente: %s', ex)
        return False


def complete_customer_account_renewal_from_admin(license_id, credential, client_username, day=None):
    """
    Marca el pedido pagado como completado y avisa al cliente (in-app + correo registrado).
    Devuelve (ok: bool, payload_or_error).
    """
    from app.models.user import User
    from app.store.models import Product

    ensure_customer_account_renewal_schema()
    account_email = extract_email_from_renewal_credential(credential)
    if not account_email:
        return False, 'No se pudo identificar el correo de la cuenta renovada.'

    order = find_pending_customer_renewal_order(license_id, account_email, client_username)
    if not order:
        return False, 'No hay solicitud pendiente de renovación para esa cuenta.'

    if (order.status or '').lower() == 'completed':
        return True, {
            'order_id': int(order.id),
            'already_completed': True,
            'notified': False,
            'email_sent': False,
        }

    user = User.query.get(order.user_id)
    product = Product.query.get(order.product_id)
    if not user or not product:
        return False, 'Usuario o producto del pedido no encontrado.'

    order.status = 'completed'
    order.processed_at = datetime.utcnow()
    note_bits = []
    if day is not None:
        try:
            note_bits.append(f'día {int(day)}')
        except (TypeError, ValueError):
            pass
    if note_bits:
        order.admin_notes = ', '.join(note_bits)

    notify_customer_account_renewal_completed(user, product, account_email, day=day)
    email_sent = email_customer_account_renewal_completed(user, product, account_email)
    db.session.commit()
    return True, {
        'order_id': int(order.id),
        'notified': True,
        'email_sent': bool(email_sent),
        'client_username': getattr(user, 'username', None) or '',
    }


def notify_customer_account_renewal_rejected(user, product, account_email, reason):
    from app.store.models import StoreUserNotification

    pname = getattr(product, 'name', None) or 'Producto'
    em = (account_email or '').strip()
    reason_txt = (reason or '').strip()
    title = f'No se pudo renovar: {pname}'
    body = (
        f'No pudimos renovar tu cuenta {em} para «{pname}».'
        f' Motivo: {reason_txt}'
    )
    payload = {
        'product_id': getattr(product, 'id', None),
        'product_name': pname,
        'account_email': em,
        'reason': reason_txt,
    }
    notif = StoreUserNotification(
        user_id=int(user.id),
        kind='customer_account_renewal_rejected',
        title=title,
        body=body,
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.session.add(notif)
    return notif


def email_customer_account_renewal_rejected(user, product, account_email, reason):
    to_email = (getattr(user, 'email', None) or '').strip()
    if not to_email:
        return False
    pname = getattr(product, 'name', None) or 'Producto'
    em = (account_email or '').strip()
    reason_txt = (reason or '').strip()
    uname = getattr(user, 'username', None) or ''
    subject = f'Renovación no procesada — {pname}'
    text = (
        f'Hola {uname},\n\n'
        f'No pudimos renovar tu cuenta {em} para «{pname}».\n'
        f'Motivo: {reason_txt}\n\n'
        f'También puedes ver el aviso en la tienda de la plataforma.\n'
    )
    html = (
        f'<p>Hola <strong>{uname}</strong>,</p>'
        f'<p>No pudimos renovar tu cuenta <strong>{em}</strong> para <strong>{pname}</strong>.</p>'
        f'<p><strong>Motivo:</strong> {reason_txt}</p>'
        f'<p>También puedes ver el aviso en la tienda de la plataforma.</p>'
    )
    from_email = current_app.config.get('SMTP_FROM', 'noreply@tusitio.com')
    try:
        from app.services.smtp_client import send_email_via_smtp

        return bool(
            send_email_via_smtp(
                from_email=from_email,
                to_email=to_email,
                subject=subject,
                text_content=text,
                html_content=html,
            )
        )
    except Exception as ex:
        current_app.logger.warning('email rechazo renovación cuenta cliente: %s', ex)
        return False


def reject_customer_account_renewal_from_admin(license_id, credential, client_username, reason):
    """
    Rechaza una solicitud pendiente, devuelve el saldo, avisa al cliente y marca la compra revertida.
    Si no hay pedido pendiente, devuelve éxito para permitir quitar la fila del admin.
    """
    from app.models.user import User
    from app.store.models import Product

    ensure_customer_account_renewal_schema()
    reason_txt = (reason or '').strip()
    if not reason_txt:
        return False, 'Indica el motivo por el que no se puede renovar.'
    if len(reason_txt) > 2000:
        return False, 'El motivo es demasiado largo.'

    account_email = extract_email_from_renewal_credential(credential)
    if not account_email:
        return False, 'No se pudo identificar el correo de la cuenta.'

    order = find_pending_customer_renewal_order(license_id, account_email, client_username)
    if not order:
        return True, _reject_result_payload(None, no_order=True)

    status = (order.status or '').lower()
    user = User.query.get(order.user_id)
    product = Product.query.get(order.product_id)
    if not user or not product:
        return False, 'Usuario o producto del pedido no encontrado.'

    if status == 'completed':
        return False, 'Esa renovación ya fue completada.'

    refund_ok, refund_reason, refund_info = refund_customer_account_renewal_sale(
        user, product, order.sale_id
    )
    if not refund_ok and refund_reason not in ('already_refunded',):
        db.session.rollback()
        if refund_reason == 'sale_not_found':
            return False, 'No se encontró la venta asociada para devolver el saldo.'
        if refund_reason == 'snapshot_missing':
            return False, 'No se pudo registrar la reversión de la compra.'
        if refund_reason == 'zero_amount':
            return False, 'La venta no tiene monto válido para devolver.'
        return False, 'No se pudo devolver el saldo al cliente.'

    if status == 'rejected':
        db.session.commit()
        try:
            from app.store.balance_recharge_events import notify_balance_recharge_updated

            notify_balance_recharge_updated(int(user.id), reason='customer_renewal_rejected')
        except Exception:
            pass
        return True, _reject_result_payload(
            order,
            refund_ok=refund_ok or refund_reason == 'already_refunded',
            refund_info=refund_info,
            already_rejected=True,
        )

    order.status = 'rejected'
    order.processed_at = datetime.utcnow()
    order.admin_notes = reason_txt

    notify_customer_account_renewal_rejected(user, product, account_email, reason_txt)
    email_sent = email_customer_account_renewal_rejected(user, product, account_email, reason_txt)
    db.session.commit()
    try:
        from app.store.balance_recharge_events import notify_balance_recharge_updated

        notify_balance_recharge_updated(int(user.id), reason='customer_renewal_rejected')
    except Exception:
        pass
    return True, _reject_result_payload(
        order,
        notified=True,
        email_sent=bool(email_sent),
        refund_ok=True,
        refund_info=refund_info,
    )


def customer_account_renewal_status_label(status):
    s = (status or '').strip().lower()
    if s == 'completed':
        return 'Renovación completada'
    if s == 'rejected':
        return 'Renovación rechazada'
    return 'Renovación en proceso'


def customer_account_renewal_historial_payload(sale_id):
    """Datos del pedido «renovar tu cuenta» para una fila del historial de compras."""
    from app.store.models import CustomerAccountRenewalOrder

    if not sale_id:
        return None
    try:
        sid = int(sale_id)
    except (TypeError, ValueError):
        return None
    order = (
        CustomerAccountRenewalOrder.query.filter_by(sale_id=sid)
        .order_by(CustomerAccountRenewalOrder.id.desc())
        .first()
    )
    if not order:
        return None
    status = (order.status or 'pending').strip().lower()
    reason = ''
    if status == 'rejected':
        reason = (order.admin_notes or '').strip()
    return {
        'is_customer_account_renewal': True,
        'has_customer_renewal_detail': True,
        'customer_renewal_email': (order.customer_email or '').strip(),
        'customer_renewal_password': (order.customer_password or '').strip(),
        'customer_renewal_status': status,
        'customer_renewal_status_label': customer_account_renewal_status_label(status),
        'customer_renewal_reason': reason,
    }


def enrich_historial_item_customer_renewal(item, sale_id=None):
    """Añade campos de renovación cuenta cliente a un ítem del historial de compras."""
    if not item:
        return item
    kind = str(item.get('renewal_kind') or '').strip()
    payload = customer_account_renewal_historial_payload(sale_id)
    if payload:
        item.update(payload)
        if not item.get('renewal_kind_label'):
            from app.store.sale_purchase_snapshot import renewal_kind_display_label

            item['renewal_kind_label'] = renewal_kind_display_label('customer_account')
        return item
    if kind == 'customer_account':
        from app.store.sale_purchase_snapshot import renewal_kind_display_label

        item['is_customer_account_renewal'] = True
        item['has_customer_renewal_detail'] = False
        item['customer_renewal_status'] = 'pending'
        item['customer_renewal_status_label'] = customer_account_renewal_status_label(
            'pending'
        )
        item['renewal_kind_label'] = renewal_kind_display_label('customer_account')
    return item
