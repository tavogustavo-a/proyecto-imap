# -*- coding: utf-8 -*-
"""Reservas de producto agotado en tienda pública (allow_reservation en License)."""
from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal

from flask import current_app
from sqlalchemy import inspect, text

from app.extensions import db


def ensure_product_reservation_schema():
    """Crea tablas/columnas de reservas si faltan (SQLite / arranque)."""
    try:
        from app.store.models import License, ProductReservation, StoreUserNotification

        insp = inspect(db.engine)
        tables = set(insp.get_table_names())

        if 'store_licenses' in tables:
            cols = {c['name'].lower() for c in insp.get_columns('store_licenses')}
            if 'allow_reservation' not in cols:
                db.session.execute(
                    text(
                        'ALTER TABLE store_licenses ADD COLUMN allow_reservation INTEGER DEFAULT 0 NOT NULL'
                    )
                )
                db.session.commit()

        for model in (ProductReservation, StoreUserNotification):
            if model.__tablename__ not in tables:
                model.__table__.create(db.engine, checkfirst=True)
    except Exception as ex:
        db.session.rollback()
        current_app.logger.warning('ensure_product_reservation_schema: %s', ex)


def product_allows_reservation(product) -> bool:
    from app.store.models import License

    if not product or not getattr(product, 'id', None):
        return False
    row = (
        License.query.filter_by(product_id=int(product.id), enabled=True)
        .order_by(License.position.asc(), License.id.asc())
        .first()
    )
    return bool(row and getattr(row, 'allow_reservation', False))


def _product_allow_reservation_map(products):
    from app.store.models import License

    if not products:
        return {}
    ids = [p.id for p in products if getattr(p, 'id', None) is not None]
    if not ids:
        return {}
    flags = {pid: False for pid in ids}
    rows = License.query.filter(License.product_id.in_(ids), License.enabled.is_(True)).all()
    for lic in rows:
        if bool(getattr(lic, 'allow_reservation', False)):
            flags[lic.product_id] = True
    return flags


def _store_user_unit_price(user, product):
    """Precio unitario según moneda del usuario (con descuentos de catálogo)."""
    from app.store.routes import catalog_products_for_store_user

    _, tipo = catalog_products_for_store_user(user)
    tipo_l = (tipo or 'USD').upper()
    cop = Decimal(str(getattr(product, 'price_cop', 0) or 0))
    usd = Decimal(str(getattr(product, 'price_usd', 0) or 0))
    disc_cop = Decimal(str(getattr(product, 'discount_cop_extra', 0) or 0))
    disc_usd = Decimal(str(getattr(product, 'discount_usd_extra', 0) or 0))
    final_cop = max(Decimal(0), cop - disc_cop)
    final_usd = max(Decimal(0), usd - disc_usd)
    if tipo_l == 'COP':
        return final_cop, final_usd, 'COP', final_cop
    return final_cop, final_usd, 'USD', final_usd


def create_product_reservation(user, product):
    """
    Crea reserva pending si producto agotado y allow_reservation activo.
    Devuelve (reservation_dict|None, error_message|None).
    """
    from app.store.models import Product, ProductReservation
    from app.store.routes import _compute_public_sellable_stock_for_product

    ensure_product_reservation_schema()

    if not user or not product:
        return None, 'Datos inválidos.'
    if getattr(user, 'parent_id', None):
        return None, 'Solo el usuario principal puede reservar productos.'

    prod = product if isinstance(product, Product) else Product.query.get(int(product))
    if not prod or not prod.enabled:
        return None, 'Producto no disponible.'

    sellable = _compute_public_sellable_stock_for_product(prod)
    if sellable > 0:
        return None, 'Hay existencias disponibles; usa «Añadir» para comprar.'
    if not product_allows_reservation(prod):
        return None, 'Este producto no admite reservas.'

    pending = (
        ProductReservation.query.filter_by(
            user_id=int(user.id),
            product_id=int(prod.id),
            status='pending',
        ).first()
    )
    if pending:
        return _reservation_to_dict(pending), None

    from app.store.routes import catalog_products_for_store_user

    products, _tipo = catalog_products_for_store_user(user)
    cat_prod = prod
    for p in products or []:
        if int(p.id) == int(prod.id):
            cat_prod = p
            break
    price_cop, price_usd, currency, _unit = _store_user_unit_price(user, cat_prod)
    lic_id = None
    from app.store.models import License

    lic = (
        License.query.filter_by(product_id=prod.id, enabled=True)
        .order_by(License.position.asc(), License.id.asc())
        .first()
    )
    if lic:
        lic_id = lic.id

    row = ProductReservation(
        user_id=int(user.id),
        product_id=int(prod.id),
        license_id=lic_id,
        status='pending',
        price_cop=price_cop,
        price_usd=price_usd,
        currency=currency,
    )
    db.session.add(row)
    db.session.commit()
    return _reservation_to_dict(row), None


def _reservation_to_dict(row):
    return {
        'id': row.id,
        'product_id': row.product_id,
        'status': row.status,
        'created_at': row.created_at.isoformat() if row.created_at else None,
        'fulfilled_at': row.fulfilled_at.isoformat() if row.fulfilled_at else None,
    }


def _user_can_pay_reservation(user, currency, amount):
    from app.store.routes import _store_prepaid_debt_limit_error, _user_puede_tener_deuda_effective

    amount = Decimal(str(amount or 0))
    if amount <= 0:
        return True, None
    saldo_cop = Decimal(str(getattr(user, 'saldo_cop', 0) or 0))
    saldo_usd = Decimal(str(getattr(user, 'saldo_usd', 0) or 0))
    permite_deuda = _user_puede_tener_deuda_effective(user)
    cur = (currency or 'USD').upper()
    if not permite_deuda:
        if cur == 'COP' and amount > saldo_cop:
            return False, 'Saldo COP insuficiente para completar la reserva.'
        if cur != 'COP' and amount > saldo_usd:
            return False, 'Saldo USD insuficiente para completar la reserva.'
        return True, None
    total_cop = amount if cur == 'COP' else Decimal(0)
    total_usd = amount if cur != 'COP' else Decimal(0)
    err = _store_prepaid_debt_limit_error(user, total_cop, total_usd)
    if err:
        return False, err
    return True, None


def _assign_one_unit_for_product(product, user, venta, sold_bloc_moves, cuentas_asignadas):
    from app.store.models import License, LicenseAccount
    from app.store.routes import (
        _license_warranty_days_public,
        _public_checkout_assign_license_account,
        _renewal_account_unreserved_for_public_sale,
        _renewal_release_stale_reservations,
    )

    _renewal_release_stale_reservations()
    licenses = (
        License.query.filter_by(product_id=product.id, enabled=True)
        .order_by(License.id.asc())
        .all()
    )
    for license_row in licenses:
        reserve = _license_warranty_days_public(license_row)
        avail_candidates = [
            a
            for a in LicenseAccount.query.filter_by(
                license_id=license_row.id,
                status='available',
            ).all()
            if _renewal_account_unreserved_for_public_sale(a)
        ]
        avail_ordered = sorted(
            avail_candidates,
            key=lambda row: (
                row.inventory_bloc_ord is None,
                int(row.inventory_bloc_ord)
                if row.inventory_bloc_ord is not None
                and str(row.inventory_bloc_ord).strip().isdigit()
                else 10**9,
                row.id,
            ),
        )
        n_avail = len(avail_ordered)
        max_take = max(0, n_avail - reserve)
        if max_take <= 0:
            continue
        account = avail_ordered[0]
        _public_checkout_assign_license_account(
            account,
            license_row,
            user,
            venta,
            product,
            sold_bloc_moves,
            cuentas_asignadas,
        )
        return account, license_row
    return None, None


def _format_cred_for_user(account):
    email = (getattr(account, 'email', None) or '').strip()
    pwd = (getattr(account, 'password', None) or '').strip()
    ident = (getattr(account, 'account_identifier', None) or '').strip()
    if email and pwd:
        return f'{email} {pwd}'
    if ident and pwd:
        return f'{ident} {pwd}'
    return ident or email or 'Cuenta asignada'


def _notify_reservation_fulfilled(user, product, account, reservation_id):
    from app.store.models import StoreUserNotification

    cred = _format_cred_for_user(account)
    pname = getattr(product, 'name', None) or 'Producto'
    title = f'Reserva lista: {pname}'
    body = f'Tu reserva de «{pname}» ya tiene cuenta disponible.\n\nCredencial:\n{cred}'
    payload = {
        'reservation_id': reservation_id,
        'product_id': getattr(product, 'id', None),
        'product_name': pname,
        'credential': cred,
        'email': (getattr(account, 'email', None) or '').strip(),
        'password': (getattr(account, 'password', None) or '').strip(),
        'identifier': (getattr(account, 'account_identifier', None) or '').strip(),
    }
    notif = StoreUserNotification(
        user_id=int(user.id),
        kind='product_reservation_fulfilled',
        title=title,
        body=body,
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.session.add(notif)
    return notif


def _email_reservation_fulfilled(user, product, account):
    to_email = (getattr(user, 'email', None) or '').strip()
    if not to_email:
        return False
    pname = getattr(product, 'name', None) or 'Producto'
    cred = _format_cred_for_user(account)
    subject = f'Reserva completada — {pname}'
    text = (
        f'Hola {getattr(user, "username", "") or ""},\n\n'
        f'Tu reserva de «{pname}» ya está lista. Esta es tu cuenta:\n\n'
        f'{cred}\n\n'
        f'También puedes verla en Licencias de la plataforma.\n'
    )
    html = (
        f'<p>Hola <strong>{getattr(user, "username", "") or ""}</strong>,</p>'
        f'<p>Tu reserva de <strong>{pname}</strong> ya está lista.</p>'
        f'<p><strong>Cuenta:</strong><br><code>{cred}</code></p>'
        f'<p>También puedes verla en Licencias de la plataforma.</p>'
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
        current_app.logger.warning('email reserva producto: %s', ex)
        return False


def _fulfill_one_reservation(reservation):
    from app.models.user import User
    from app.store.models import Product, ProductReservation, Sale
    from app.store.routes import (
        _apply_public_checkout_bloc_moves_to_licenses,
        _compute_public_sellable_stock_for_product,
    )

    if not reservation or reservation.status != 'pending':
        return False

    user = User.query.get(reservation.user_id)
    product = Product.query.get(reservation.product_id)
    if not user or not product or not product.enabled:
        reservation.status = 'cancelled'
        reservation.cancelled_at = datetime.utcnow()
        reservation.last_error = 'Usuario o producto no disponible.'
        return False

    if not product_allows_reservation(product):
        reservation.status = 'cancelled'
        reservation.cancelled_at = datetime.utcnow()
        reservation.last_error = 'Reservas desactivadas para este producto.'
        return False

    sellable = _compute_public_sellable_stock_for_product(product)
    if sellable <= 0:
        return False

    currency = (reservation.currency or 'USD').upper()
    amount = reservation.price_cop if currency == 'COP' else reservation.price_usd
    ok_pay, pay_err = _user_can_pay_reservation(user, currency, amount)
    if not ok_pay:
        reservation.last_error = pay_err
        db.session.commit()
        return False

    venta = Sale(
        user_id=user.id,
        product_id=product.id,
        quantity=1,
        total_price=amount,
        is_renewal=False,
    )
    db.session.add(venta)
    db.session.flush()

    sold_bloc_moves = []
    cuentas_asignadas = []
    account, license_row = _assign_one_unit_for_product(
        product, user, venta, sold_bloc_moves, cuentas_asignadas
    )
    if not account:
        db.session.rollback()
        res_reload = ProductReservation.query.get(reservation.id)
        if res_reload:
            res_reload.last_error = 'Sin cuenta disponible en inventario.'
            db.session.commit()
        return False

    _apply_public_checkout_bloc_moves_to_licenses(sold_bloc_moves)

    if currency == 'COP':
        user.saldo_cop = Decimal(str(user.saldo_cop or 0)) - Decimal(str(amount or 0))
    else:
        user.saldo_usd = Decimal(str(user.saldo_usd or 0)) - Decimal(str(amount or 0))

    reservation.status = 'fulfilled'
    reservation.fulfilled_at = datetime.utcnow()
    reservation.sale_id = venta.id
    reservation.license_account_id = account.id
    reservation.license_id = license_row.id if license_row else reservation.license_id
    reservation.last_error = None

    _notify_reservation_fulfilled(user, product, account, reservation.id)
    db.session.commit()

    try:
        from app.store.sale_purchase_snapshot import ensure_sale_schema, sync_snapshots_for_sale_ids

        ensure_sale_schema()
        sync_snapshots_for_sale_ids([venta.id])
    except Exception as snap_ex:
        current_app.logger.warning('snapshot reserva producto: %s', snap_ex)

    try:
        from app.store.balance_recharge_events import notify_balance_recharge_updated

        notify_balance_recharge_updated(int(user.id), reason='store_reservation_fulfilled')
    except Exception:
        pass

    _email_reservation_fulfilled(user, product, account)
    return True


def process_pending_reservations_for_product(product_id):
    """Intenta cumplir reservas FIFO cuando hay stock vendible."""
    from app.store.models import ProductReservation

    ensure_product_reservation_schema()
    if not product_id:
        return 0
    fulfilled = 0
    while True:
        row = (
            ProductReservation.query.filter_by(product_id=int(product_id), status='pending')
            .order_by(ProductReservation.created_at.asc(), ProductReservation.id.asc())
            .first()
        )
        if not row:
            break
        if _fulfill_one_reservation(row):
            fulfilled += 1
        else:
            break
    return fulfilled


def list_user_pending_reservation_product_ids(user_id):
    from app.store.models import ProductReservation

    ensure_product_reservation_schema()
    rows = ProductReservation.query.filter_by(user_id=int(user_id), status='pending').all()
    return {int(r.product_id) for r in rows}


def list_unread_notifications(user_id, limit=20):
    from app.store.models import StoreUserNotification

    ensure_product_reservation_schema()
    rows = (
        StoreUserNotification.query.filter_by(user_id=int(user_id))
        .filter(StoreUserNotification.read_at.is_(None))
        .order_by(StoreUserNotification.created_at.desc())
        .limit(limit)
        .all()
    )
    out = []
    for n in rows:
        payload = {}
        if n.payload_json:
            try:
                payload = json.loads(n.payload_json)
            except Exception:
                payload = {}
        out.append(
            {
                'id': n.id,
                'kind': n.kind,
                'title': n.title,
                'body': n.body,
                'payload': payload,
                'created_at': n.created_at.isoformat() if n.created_at else None,
            }
        )
    return out


def mark_notification_read(user_id, notification_id):
    from app.store.models import StoreUserNotification

    row = StoreUserNotification.query.filter_by(id=int(notification_id), user_id=int(user_id)).first()
    if not row:
        return False
    if not row.read_at:
        row.read_at = datetime.utcnow()
        db.session.commit()
    return True
