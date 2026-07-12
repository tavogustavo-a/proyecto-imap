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

        from app.store.customer_renewal_notify_batch import ensure_customer_renewal_notify_batch_schema

        ensure_customer_renewal_notify_batch_schema()
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


CUSTOMER_RENEWAL_CHECKOUT_BLOCKED_MSG = (
    'El correo está pendiente para cuentas a renovar.'
)

CUSTOMER_RENEWAL_ALREADY_COMPLETED_MSG = 'Esta cuenta ya fue renovada.'


def extract_first_customer_renewal_email(text):
    """Primer correo válido en el texto; ignora basura antes/después."""
    m = re.search(
        r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
        str(text or ''),
        re.I,
    )
    if not m:
        return ''
    return m.group(0).strip().lower()


def customer_renewal_email_in_product_queue(product_id, email) -> bool:
    """True si el correo ya está en el bloc admin «Cuentas para renovar» del producto."""
    em = (email or '').strip().lower()
    if not em or not product_id:
        return False
    for lic in _licenses_for_customer_renewal(product_id):
        notes = getattr(lic, 'customer_renewal_notes', None) or ''
        for line in notes.replace('\r\n', '\n').split('\n'):
            if not line.strip():
                continue
            line_em = extract_email_from_renewal_credential(line)
            if line_em and line_em.lower() == em:
                return True
    return False


def customer_renewal_email_has_pending_order(product_id, email) -> bool:
    from app.store.models import CustomerAccountRenewalOrder

    em = (email or '').strip().lower()
    if not em or not product_id:
        return False
    return (
        CustomerAccountRenewalOrder.query.filter(
            CustomerAccountRenewalOrder.product_id == int(product_id),
            func.lower(CustomerAccountRenewalOrder.customer_email) == em,
            CustomerAccountRenewalOrder.status == 'pending',
        ).first()
        is not None
    )


def get_latest_customer_renewal_order(product_id, email, user_id=None):
    from app.store.models import CustomerAccountRenewalOrder

    em = (email or '').strip().lower()
    if not em or not product_id:
        return None
    q = CustomerAccountRenewalOrder.query.filter(
        CustomerAccountRenewalOrder.product_id == int(product_id),
        func.lower(CustomerAccountRenewalOrder.customer_email) == em,
    )
    if user_id is not None:
        try:
            q = q.filter(CustomerAccountRenewalOrder.user_id == int(user_id))
        except (TypeError, ValueError):
            pass
    return q.order_by(CustomerAccountRenewalOrder.created_at.desc()).first()


def customer_renewal_email_recently_completed(product_id, email, user_id=None) -> bool:
    """
    True si el cliente ya renovó esta cuenta en el ciclo actual (mes calendario Colombia).
    """
    em = (email or '').strip().lower()
    if not em or not product_id:
        return False
    latest = get_latest_customer_renewal_order(int(product_id), em, user_id=user_id)
    if not latest:
        return False
    if (latest.status or '').strip().lower() != 'completed':
        return False
    ref = latest.processed_at or latest.created_at
    if not ref:
        return True
    from app.utils.timezone import get_colombia_datetime, utc_to_colombia

    now_co = get_colombia_datetime()
    ref_co = utc_to_colombia(ref)
    return (ref_co.year, ref_co.month) == (now_co.year, now_co.month)


def customer_renewal_checkout_block_reason(product_id, email, user_id=None):
    """
    (reason_code, message) si el checkout debe bloquearse; None si puede continuar.
    reason_code: 'already_renewed' | 'pending'
    """
    em = (email or '').strip().lower()
    if not em or not product_id:
        return None
    if customer_renewal_email_recently_completed(int(product_id), em, user_id=user_id):
        return 'already_renewed', CUSTOMER_RENEWAL_ALREADY_COMPLETED_MSG
    if customer_renewal_email_blocks_checkout(int(product_id), em, user_id=user_id):
        return 'pending', CUSTOMER_RENEWAL_CHECKOUT_BLOCKED_MSG
    return None


def customer_renewal_email_blocks_checkout(product_id, email, user_id=None) -> bool:
    """
    Bloquea solo renovaciones realmente pendientes.
    Tras un rechazo (aunque quede línea obsoleta en el bloc admin) se permite reintentar.
    """
    em = (email or '').strip().lower()
    if not em or not product_id:
        return False
    if customer_renewal_email_has_pending_order(int(product_id), em):
        return True
    if not customer_renewal_email_in_product_queue(int(product_id), em):
        return False
    latest = get_latest_customer_renewal_order(int(product_id), em, user_id=user_id)
    if not latest:
        return True
    return (latest.status or 'pending').strip().lower() == 'pending'


CUSTOMER_RENEWAL_RECENT_REJECT_WARNING = (
    'Recuerda que este correo ya fue rechazado anteriormente esta semana.'
)


def _same_calendar_week_colombia(dt_a, dt_b) -> bool:
    from app.utils.timezone import utc_to_colombia

    if not dt_a or not dt_b:
        return False
    try:
        a = utc_to_colombia(dt_a)
        b = utc_to_colombia(dt_b)
        return a.isocalendar()[:2] == b.isocalendar()[:2]
    except (ValueError, TypeError, OSError, OverflowError):
        return False


def customer_renewal_recent_rejection_warning(product_id, email, user_id=None):
    """Aviso informativo si el mismo correo fue rechazado en la semana calendario actual (CO)."""
    from datetime import datetime

    from app.store.models import CustomerAccountRenewalOrder

    em = (email or '').strip().lower()
    if not em or not product_id:
        return None
    q = CustomerAccountRenewalOrder.query.filter(
        CustomerAccountRenewalOrder.product_id == int(product_id),
        func.lower(CustomerAccountRenewalOrder.customer_email) == em,
        CustomerAccountRenewalOrder.status == 'rejected',
    )
    if user_id is not None:
        try:
            q = q.filter(CustomerAccountRenewalOrder.user_id == int(user_id))
        except (TypeError, ValueError):
            pass
    row = q.order_by(
        CustomerAccountRenewalOrder.processed_at.desc(),
        CustomerAccountRenewalOrder.created_at.desc(),
    ).first()
    if not row:
        return None
    ref_dt = row.processed_at or row.created_at
    if not ref_dt or not _same_calendar_week_colombia(ref_dt, datetime.utcnow()):
        return None
    return CUSTOMER_RENEWAL_RECENT_REJECT_WARNING


def remove_customer_renewal_email_from_product_notes(product_id, email) -> bool:
    """Quita el correo del bloc admin «Cuentas para renovar» (p. ej. tras rechazo)."""
    from app.store.user_license_line_parse import LICENSE_LINE_FIELD_SEP

    em = (email or '').strip().lower()
    if not em or not product_id:
        return False
    changed = False
    sep = LICENSE_LINE_FIELD_SEP
    for license_obj in _licenses_for_customer_renewal(product_id):
        existing = getattr(license_obj, 'customer_renewal_notes', None) or ''
        kept = []
        for ln in existing.replace('\r\n', '\n').split('\n'):
            if not ln.strip():
                continue
            cred_part = ln.split(sep)[0] if sep in ln else ln
            line_em = extract_email_from_renewal_credential(cred_part)
            if line_em and line_em.lower() == em:
                changed = True
                continue
            kept.append(ln)
        if changed:
            license_obj.customer_renewal_notes = '\n'.join(kept)
    return changed


def assert_customer_renewal_email_allowed_for_checkout(product, email, user_id=None):
    em = (email or '').strip().lower()
    pid = getattr(product, 'id', None)
    if not pid or not em:
        return 'Indica un correo válido de la cuenta a renovar (con @ y punto).'
    block = customer_renewal_checkout_block_reason(pid, em, user_id=user_id)
    if block:
        return block[1]
    return None


def customer_renewal_checkout_warning(product, email, user_id=None):
    pid = getattr(product, 'id', None)
    em = (email or '').strip().lower()
    if not pid or not em:
        return None
    return customer_renewal_recent_rejection_warning(pid, em, user_id=user_id)


def _parse_customer_renewal_credential_input(cred_raw, *, is_netflix=False):
    """
    Extrae correo (y contraseña solo con formato correo:contraseña).
    Texto extra tras el correo se descarta (p. ej. «mail@gmail.com basura» → solo el correo).
    """
    from app.store.user_license_line_parse import parse_cred_part_plain

    raw = (cred_raw or '').strip()
    if not raw:
        return None, None, None, 'Indica el correo de la cuenta a renovar.'

    colon_m = re.match(r'^([^\s:]+@[^\s:]+\.[^\s:]+):(\S+)', raw)
    if colon_m:
        em = colon_m.group(1).strip().lower()
        pw = colon_m.group(2).strip()
        if pw == '.':
            pw = ''
        if not _is_valid_customer_renewal_email(em):
            return (
                None,
                None,
                None,
                'Indica un correo válido (con @ y punto). Opcional: correo:contraseña.',
            )
        if is_netflix and not pw:
            return None, None, None, 'Indica la contraseña de la cuenta Netflix (correo:contraseña).'
        if len(pw) > 255:
            return None, None, None, 'La contraseña es demasiado larga.'
        cred_line = f'{em}:{pw}' if pw else em
        if len(cred_line) > 500:
            return None, None, None, 'La línea de cuenta es demasiado larga.'
        return em, pw, cred_line, None

    parsed = parse_cred_part_plain(raw, is_netflix)
    if parsed and parsed.get('email'):
        em = str(parsed.get('email') or '').strip().lower()
        pw = str(parsed.get('password') or '').strip()
        if pw == '.':
            pw = ''
        if not _is_valid_customer_renewal_email(em):
            return (
                None,
                None,
                None,
                'Indica un correo válido (con @ y punto).',
            )
        if parsed.get('netflix_slot') is not None and not pw:
            return None, None, None, 'Indica la contraseña Netflix con formato correo:contraseña.'
        cred_line = f'{em}:{pw}' if pw else em
        return em, pw, cred_line, None

    em = extract_first_customer_renewal_email(raw)
    if not _is_valid_customer_renewal_email(em):
        return (
            None,
            None,
            None,
            'Indica un correo válido (con @ y punto).',
        )
    return em, '', em, None


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


def validate_customer_renewal_from_cart_item(product, email=None, password=None, customer_credential=None, user_id=None):
    """
    Valida renovación con cuenta del cliente.
    Preferir ``customer_credential`` (correo; contraseña opcional solo como correo:contraseña).
    """
    is_nf = _product_name_is_netflix(getattr(product, 'name', None) if product else None)
    cred_raw = (customer_credential or '').strip()
    if cred_raw:
        em, pw, cred_line, err = _parse_customer_renewal_credential_input(cred_raw, is_netflix=is_nf)
        if err:
            return None, None, None, err
    else:
        em_in = extract_first_customer_renewal_email(email) or (email or '').strip().lower()
        em, pw, err = validate_customer_renewal_credentials(em_in, password)
        if err:
            return None, None, None, err
        cred_line = f'{em}:{pw}' if pw else em

    block = assert_customer_renewal_email_allowed_for_checkout(product, em, user_id=user_id)
    if block:
        return None, None, None, block
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


def reconcile_orphan_pending_customer_renewal_notes() -> int:
    """
    Restaura en el bloc admin «Cuentas para renovar» los pedidos ``pending``
    cuya línea se perdió (huérfanos: el portal del cliente los sigue mostrando).
    Devuelve cuántas líneas se reinsertaron.
    """
    from app.models.user import User
    from app.store.models import CustomerAccountRenewalOrder

    ensure_customer_account_renewal_schema()
    pending = (
        CustomerAccountRenewalOrder.query.filter(
            CustomerAccountRenewalOrder.status == 'pending',
        )
        .order_by(CustomerAccountRenewalOrder.id.asc())
        .all()
    )
    restored = 0
    for order in pending:
        em = (order.customer_email or '').strip().lower()
        pid = getattr(order, 'product_id', None)
        if not em or not pid:
            continue
        if customer_renewal_email_in_product_queue(int(pid), em):
            continue
        lic_rows = _licenses_for_customer_renewal(int(pid))
        if not lic_rows:
            continue
        buyer = User.query.get(order.user_id)
        buyer_label = customer_renewal_buyer_label(buyer)
        pw = getattr(order, 'customer_password', None) or ''
        line = build_customer_renewal_storage_line(em, pw, buyer_label)
        for license_obj in lic_rows:
            existing = getattr(license_obj, 'customer_renewal_notes', None) or ''
            lines = [ln for ln in existing.replace('\r\n', '\n').split('\n') if ln.strip()]
            already = False
            for ln in lines:
                line_em = extract_email_from_renewal_credential(ln)
                if line_em and line_em.lower() == em:
                    already = True
                    break
            if already:
                continue
            lines.append(line)
            license_obj.customer_renewal_notes = '\n'.join(lines)
            restored += 1
    return restored


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


def notify_admin_customer_account_renewal_pending(user, product, email):
    """Correo al admin cuando un cliente envía una cuenta para renovar."""
    from app.store.whatsapp_web_service import (
        resolve_whatsapp_admin_alert_email,
        send_whatsapp_alert_email,
    )

    admin_email = resolve_whatsapp_admin_alert_email()
    if not admin_email:
        current_app.logger.info(
            'Aviso admin renovación omitido: sin email de admin configurado.',
        )
        return False

    pname = getattr(product, 'name', None) or 'Producto'
    uname = getattr(user, 'username', None) or 'cliente'
    em = (email or '').strip()
    subject = f'Cuenta para renovar — {pname}'
    body = (
        f'Nueva solicitud de renovación con cuenta del cliente.\n\n'
        f'Producto: {pname}\n'
        f'Cliente: {uname}\n'
        f'Cuenta: {em}\n\n'
        f'Revisa el bloc «Cuentas para renovar» en Admin → Licencias.'
    )
    return send_whatsapp_alert_email(admin_email, subject, body)


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


def customer_renewal_client_username_for_admin(license_id, credential, client_username_hint=None):
    """
    Usuario de login del comprador para pasar una fila al bloc día (portal del cliente).
    Prioriza el pedido pagado sobre lo escrito a mano en admin.
    """
    from app.models.user import User
    from app.store.models import CustomerAccountRenewalOrder, License

    account_email = extract_email_from_renewal_credential(credential)
    hint = (client_username_hint or '').strip()
    if not account_email:
        return hint

    lic = License.query.get(int(license_id)) if license_id else None
    if not lic:
        return hint

    q = CustomerAccountRenewalOrder.query.filter(
        func.lower(CustomerAccountRenewalOrder.customer_email) == account_email.strip().lower(),
    )
    if getattr(lic, 'product_id', None):
        q = q.filter(CustomerAccountRenewalOrder.product_id == int(lic.product_id))
    else:
        q = q.filter(CustomerAccountRenewalOrder.license_id == int(license_id))

    rows = q.order_by(CustomerAccountRenewalOrder.created_at.desc()).all()
    if not rows:
        return hint

    uname = _normalize_client_username(client_username_hint)
    chosen = rows[0]
    if uname:
        for row in rows:
            buyer = User.query.get(row.user_id)
            if _buyer_matches_renewal_label(buyer, client_username_hint):
                chosen = row
                break

    buyer = User.query.get(chosen.user_id)
    un = (getattr(buyer, 'username', None) or '').strip()
    if un:
        return un
    return hint


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
    notify_queued=False,
    refund_ok=False,
    refund_info=None,
    no_order=False,
    already_rejected=False,
):
    payload = {
        'order_id': int(order.id) if order else None,
        'notified': bool(notified),
        'email_sent': bool(email_sent) if not notify_queued else False,
        'notify_queued': bool(notify_queued),
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


def _user_platform_email(user):
    return (getattr(user, 'email', None) or '').strip()


def _send_customer_renewal_transactional_email(user, *, subject, email_title, paragraphs):
    """Envía al email registrado del usuario en la plataforma (campo User.email)."""
    from app.store.email_notify_prefs import user_receives_email_notifications

    if not user_receives_email_notifications(user):
        current_app.logger.info(
            'Email renovación omitido: email notificaciones desactivado user=%s',
            getattr(user, 'username', None) or getattr(user, 'id', '?'),
        )
        return False

    to_email = _user_platform_email(user)
    if not to_email:
        current_app.logger.info(
            'Email renovación omitido: usuario %s sin email en perfil.',
            getattr(user, 'username', None) or getattr(user, 'id', '?'),
        )
        return False

    from app.services.email_service import email_recipient_display_name, render_transactional_email_html, send_transactional_email

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
        current_app.logger.warning('Plantilla email renovación: %s', ex)

    try:
        return send_transactional_email(
            to_email=to_email,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
        )
    except Exception as ex:
        current_app.logger.warning('email renovación cuenta cliente: %s', ex)
        return False


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
    pname = getattr(product, 'name', None) or 'Producto'
    em = (account_email or '').strip()
    subject = f'Actualización de tu renovación — {pname}'
    paragraphs = [
        f'Tu solicitud de renovación para {pname} ya fue procesada.',
        f'La cuenta {em} quedó renovada correctamente.',
    ]
    return _send_customer_renewal_transactional_email(
        user,
        subject=subject,
        email_title='Renovación completada',
        paragraphs=paragraphs,
    )


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

    from app.store.customer_renewal_notify_batch import queue_customer_renewal_notify

    queue_customer_renewal_notify(
        user, 'completed', product, account_email, day=day
    )
    db.session.commit()
    return True, {
        'order_id': int(order.id),
        'notified': True,
        'notify_queued': True,
        'email_sent': False,
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
    pname = getattr(product, 'name', None) or 'Producto'
    em = (account_email or '').strip()
    reason_txt = (reason or '').strip()
    subject = f'Actualización de tu renovación — {pname}'
    paragraphs = [
        f'No pudimos completar la renovación de tu cuenta {em} para {pname}.',
        f'Motivo indicado por el administrador: {reason_txt}',
        'Si correspondía devolución de saldo, ya debería reflejarse en tu cuenta de la tienda.',
    ]
    return _send_customer_renewal_transactional_email(
        user,
        subject=subject,
        email_title='Renovación no procesada',
        paragraphs=paragraphs,
    )


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
        # Fila del bloc admin sin correo identificable: permitir quitarla sin pedido asociado.
        return True, _reject_result_payload(None, no_order=True)

    from app.store.models import License

    lic = License.query.get(int(license_id))
    product_id_for_notes = int(lic.product_id) if lic and getattr(lic, 'product_id', None) else None

    order = find_pending_customer_renewal_order(license_id, account_email, client_username)
    if not order:
        if product_id_for_notes:
            remove_customer_renewal_email_from_product_notes(product_id_for_notes, account_email)
            db.session.commit()
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
        if product_id_for_notes:
            remove_customer_renewal_email_from_product_notes(product_id_for_notes, account_email)
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

    from app.store.customer_renewal_notify_batch import queue_customer_renewal_notify

    queue_customer_renewal_notify(
        user, 'rejected', product, account_email, reason=reason_txt
    )
    if product_id_for_notes:
        remove_customer_renewal_email_from_product_notes(product_id_for_notes, account_email)
    db.session.commit()
    try:
        from app.store.balance_recharge_events import notify_balance_recharge_updated

        notify_balance_recharge_updated(int(user.id), reason='customer_renewal_rejected')
    except Exception:
        pass
    return True, _reject_result_payload(
        order,
        notified=True,
        notify_queued=True,
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
