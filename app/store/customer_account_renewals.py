# -*- coding: utf-8 -*-
"""Renovación con cuenta del cliente (renew_customer_account en License)."""
from __future__ import annotations

from datetime import datetime

from flask import current_app
from sqlalchemy import inspect, text

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

        if CustomerAccountRenewalOrder.__tablename__ not in tables:
            CustomerAccountRenewalOrder.__table__.create(db.engine, checkfirst=True)
    except Exception as ex:
        db.session.rollback()
        current_app.logger.warning('ensure_customer_account_renewal_schema: %s', ex)


def product_allows_customer_account_renewal(product) -> bool:
    from app.store.models import License

    if not product or not getattr(product, 'id', None):
        return False
    row = (
        License.query.filter_by(product_id=int(product.id), enabled=True)
        .order_by(License.position.asc(), License.id.asc())
        .first()
    )
    return bool(row and getattr(row, 'renew_customer_account', False))


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
    from app.store.models import License

    lic = (
        License.query.filter_by(product_id=int(product_id), enabled=True)
        .order_by(License.position.asc(), License.id.asc())
        .first()
    )
    return lic.id if lic else None


def validate_customer_renewal_credentials(email, password):
    em = (email or '').strip()
    pw = (password or '').strip()
    if not em or '@' not in em:
        return None, None, 'Indica un correo válido de la cuenta a renovar.'
    if not pw:
        return None, None, 'Indica la contraseña de la cuenta a renovar.'
    if len(em) > 255:
        return None, None, 'El correo es demasiado largo.'
    if len(pw) > 255:
        return None, None, 'La contraseña es demasiado larga.'
    return em, pw, None


def create_customer_account_renewal_order(user, product, sale, email, password):
    from app.store.models import CustomerAccountRenewalOrder

    ensure_customer_account_renewal_schema()
    row = CustomerAccountRenewalOrder(
        user_id=int(user.id),
        product_id=int(product.id),
        license_id=_primary_license_id_for_product(product.id),
        sale_id=int(sale.id) if sale and sale.id else None,
        customer_email=email,
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
