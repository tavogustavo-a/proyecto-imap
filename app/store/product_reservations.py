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
            dialect = getattr(db.engine.dialect, 'name', '') or ''
            bool_col_sql = (
                'BOOLEAN NOT NULL DEFAULT FALSE'
                if dialect == 'postgresql'
                else 'INTEGER DEFAULT 0 NOT NULL'
            )
            if 'allow_reservation' not in cols:
                db.session.execute(
                    text(
                        f'ALTER TABLE store_licenses ADD COLUMN allow_reservation {bool_col_sql}'
                    )
                )
                db.session.commit()
            if 'allow_next_day_reservation' not in cols:
                db.session.execute(
                    text(
                        f'ALTER TABLE store_licenses ADD COLUMN allow_next_day_reservation {bool_col_sql}'
                    )
                )
                db.session.commit()

        for model in (ProductReservation, StoreUserNotification):
            if model.__tablename__ not in tables:
                model.__table__.create(db.engine, checkfirst=True)

        if ProductReservation.__tablename__ in tables:
            rcols = {c['name'].lower() for c in insp.get_columns(ProductReservation.__tablename__)}
            res_new_cols = (
                ("kind", "VARCHAR(16) DEFAULT 'stock' NOT NULL"),
                ('quantity', 'INTEGER DEFAULT 1 NOT NULL'),
                ('offered_quantity', 'INTEGER'),
                ('fulfilled_quantity', 'INTEGER'),
                ('target_co_date', 'VARCHAR(10)'),
            )
            added = False
            for cname, csql in res_new_cols:
                if cname not in rcols:
                    db.session.execute(
                        text(
                            f'ALTER TABLE {ProductReservation.__tablename__} ADD COLUMN {cname} {csql}'
                        )
                    )
                    added = True
            if added:
                db.session.commit()
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


def _user_next_day_reservation_config(user):
    """
    Permiso por usuario (Gestión de permisos): flag ``reserva_otro_dia`` y mapa
    ``reserva_otro_dia_services`` {license_id: {'limit': int|None}} en ``user_prices``.
    """
    up = user.user_prices if user is not None and isinstance(getattr(user, 'user_prices', None), dict) else {}
    enabled = bool(up.get('reserva_otro_dia'))
    raw = up.get('reserva_otro_dia_services')
    services = {}
    if isinstance(raw, dict):
        for lid, val in raw.items():
            try:
                key = str(int(lid))
            except (TypeError, ValueError):
                continue
            limit = None
            if isinstance(val, dict):
                lim_raw = val.get('limit')
                if lim_raw is not None and lim_raw != '':
                    try:
                        limit = max(0, int(float(lim_raw)))
                    except (TypeError, ValueError):
                        limit = None
            services[key] = limit
    return enabled, services


def user_next_day_allowed_for_product(user, product):
    """(permitido, límite_unidades|None) para reservar este producto para otro día."""
    from app.store.models import License

    enabled, services = _user_next_day_reservation_config(user)
    if not enabled or not services or not product or not getattr(product, 'id', None):
        return False, None
    rows = (
        License.query.filter_by(product_id=int(product.id), enabled=True)
        .order_by(License.position.asc(), License.id.asc())
        .all()
    )
    for lic in rows:
        key = str(lic.id)
        if key in services:
            return True, services[key]
    return False, None


def user_next_day_products_map(user, products):
    """{product_id: bool} para pintar el botón «Reservar otro día» en la tienda."""
    from app.store.models import License

    enabled, services = _user_next_day_reservation_config(user)
    ids = [p.id for p in (products or []) if getattr(p, 'id', None) is not None]
    flags = {pid: False for pid in ids}
    if not enabled or not services or not ids:
        return flags
    rows = License.query.filter(License.product_id.in_(ids), License.enabled.is_(True)).all()
    for lic in rows:
        if str(lic.id) in services:
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


def _reservation_kind_label(kind):
    k = (kind or 'stock').strip().lower()
    return 'otro día' if k == 'next_day' else 'agotado'


def _reservation_conflict_message(user, product_id, for_kind='stock'):
    """Solo bloquea si el mismo producto ya tiene otro tipo de reserva activa."""
    from app.store.models import ProductReservation

    pid = int(product_id)
    if (for_kind or 'stock') == 'stock':
        same_nd = (
            ProductReservation.query.filter_by(
                user_id=int(user.id), product_id=pid, kind='next_day'
            )
            .filter(ProductReservation.status.in_(('pending', 'awaiting_accept')))
            .first()
        )
        if same_nd:
            return (
                'Ya tienes una reserva «para otro día» de este mismo producto. '
                'Cancélala en «Reservas pendientes» antes de usar la cola por agotado.'
            )
    if (for_kind or 'stock') == 'next_day':
        same_st = (
            ProductReservation.query.filter_by(
                user_id=int(user.id), product_id=pid, kind='stock'
            )
            .filter(ProductReservation.status.in_(('pending', 'awaiting_accept')))
            .first()
        )
        if same_st:
            return (
                'Ya tienes una reserva por agotado de este mismo producto. '
                'Cancélala en «Reservas pendientes» antes de programar otro día.'
            )
    return None


def user_can_pay_checkout_with_holds(user, total_cop, total_usd):
    """
    Valida pago del carrito descontando saldo ya anclado en reservas activas.
    Respeta límite de deuda (None = ilimitado).
    """
    from app.store.routes import (
        _store_prepaid_debt_limit_error,
        _user_puede_tener_deuda_effective,
    )

    holds = _pending_reservation_holds(user.id)
    tc = Decimal(str(total_cop or 0))
    tu = Decimal(str(total_usd or 0))
    if not _user_puede_tener_deuda_effective(user):
        saldo_cop = Decimal(str(getattr(user, 'saldo_cop', 0) or 0))
        saldo_usd = Decimal(str(getattr(user, 'saldo_usd', 0) or 0))
        avail_cop = saldo_cop - holds['COP']
        avail_usd = saldo_usd - holds['USD']
        if tc > avail_cop:
            if holds['COP'] > 0 or holds['USD'] > 0:
                return (
                    'Saldo COP insuficiente: parte está anclada a reservas pendientes. '
                    'Cancela reservas o reduce el carrito.'
                )
            return 'Saldo COP insuficiente'
        if tu > avail_usd:
            if holds['COP'] > 0 or holds['USD'] > 0:
                return (
                    'Saldo USD insuficiente: parte está anclada a reservas pendientes. '
                    'Cancela reservas o reduce el carrito.'
                )
            return 'Saldo USD insuficiente'
        return None
    return _store_prepaid_debt_limit_error(user, holds['COP'] + tc, holds['USD'] + tu)


def create_product_reservation(user, product, quantity=1):
    """
    Crea reserva pending (kind=stock) si producto agotado y allow_reservation activo.
    Valida cantidad vs saldo disponible (descontando reservas que anclan saldo).
    Devuelve (reservation_dict|None, error_message|None).
    """
    from app.store.models import License, Product, ProductReservation
    from app.store.routes import _compute_public_sellable_stock_for_product

    ensure_product_reservation_schema()

    if not user or not product:
        return None, 'Datos inválidos.'
    if getattr(user, 'parent_id', None):
        return None, 'Solo el usuario principal puede reservar productos.'

    try:
        qty = int(quantity)
    except (TypeError, ValueError):
        qty = 0
    if qty < 1 or qty > 500:
        return None, 'Cantidad inválida.'

    prod = product if isinstance(product, Product) else Product.query.get(int(product))
    if not prod or not prod.enabled:
        return None, 'Producto no disponible.'

    sellable = _compute_public_sellable_stock_for_product(prod)
    if sellable > 0:
        return None, 'Hay existencias disponibles; usa «Añadir» para comprar.'
    if not product_allows_reservation(prod):
        return None, 'Este producto no admite reservas.'

    conflict = _reservation_conflict_message(user, prod.id, for_kind='stock')
    if conflict:
        return None, conflict

    existing = (
        ProductReservation.query.filter_by(
            user_id=int(user.id),
            product_id=int(prod.id),
            kind='stock',
        )
        .filter(ProductReservation.status.in_(('pending', 'awaiting_accept')))
        .first()
    )
    if existing:
        return update_reservation_quantity(user, existing.id, qty)

    from app.store.routes import catalog_products_for_store_user

    products, _tipo = catalog_products_for_store_user(user)
    cat_prod = prod
    for p in products or []:
        if int(p.id) == int(prod.id):
            cat_prod = p
            break
    price_cop, price_usd, currency, unit = _store_user_unit_price(user, cat_prod)

    max_qty, _cur, _unit_f = _max_reservable_quantity(user, cat_prod)
    if max_qty <= 0:
        return None, (
            'No tienes saldo disponible para reservar. '
            'Cancela reservas pendientes o recarga saldo.'
        )
    if qty > max_qty:
        return None, (
            f'Con tu saldo disponible solo puedes reservar hasta {max_qty} '
            f'cuenta(s) de este producto.'
        )

    amount = Decimal(str(unit or 0)) * qty
    ok_pay, pay_err = _user_can_pay_reservation(user, currency, amount)
    if not ok_pay:
        return None, pay_err or 'Saldo insuficiente para esta reserva.'

    lic = (
        License.query.filter_by(product_id=prod.id, enabled=True)
        .order_by(License.position.asc(), License.id.asc())
        .first()
    )

    row = ProductReservation(
        user_id=int(user.id),
        product_id=int(prod.id),
        license_id=lic.id if lic else None,
        status='pending',
        price_cop=price_cop,
        price_usd=price_usd,
        currency=currency,
        kind='stock',
        quantity=qty,
    )
    db.session.add(row)
    db.session.commit()
    return _reservation_to_dict(row), None


def _reservation_to_dict(row):
    return {
        'id': row.id,
        'product_id': row.product_id,
        'status': row.status,
        'kind': getattr(row, 'kind', 'stock') or 'stock',
        'quantity': int(getattr(row, 'quantity', 1) or 1),
        'offered_quantity': getattr(row, 'offered_quantity', None),
        'fulfilled_quantity': getattr(row, 'fulfilled_quantity', None),
        'target_co_date': getattr(row, 'target_co_date', None),
        'created_at': row.created_at.isoformat() if row.created_at else None,
        'fulfilled_at': row.fulfilled_at.isoformat() if row.fulfilled_at else None,
    }


def _reservation_line_total(row):
    """Importe total anclado por una reserva activa (cantidad × precio unitario)."""
    qty = int(getattr(row, 'quantity', 1) or 1)
    currency = (row.currency or 'USD').upper()
    unit = row.price_cop if currency == 'COP' else row.price_usd
    return currency, Decimal(str(unit or 0)) * qty


def _pending_reservation_holds(user_id, exclude_reservation_id=None):
    """Saldo ya comprometido en reservas pending/awaiting_accept (stock + otro día)."""
    from app.store.models import ProductReservation

    holds = {'COP': Decimal(0), 'USD': Decimal(0)}
    q = ProductReservation.query.filter_by(user_id=int(user_id)).filter(
        ProductReservation.status.in_(('pending', 'awaiting_accept'))
    )
    if exclude_reservation_id:
        q = q.filter(ProductReservation.id != int(exclude_reservation_id))
    for row in q.all():
        cur, amt = _reservation_line_total(row)
        holds[cur] += amt
    return holds


def user_pending_reservation_blocks_checkout(user_id):
    """True si hay reservas activas que anclan saldo (aviso al intentar comprar más)."""
    from app.store.models import ProductReservation

    return (
        ProductReservation.query.filter_by(user_id=int(user_id))
        .filter(ProductReservation.status.in_(('pending', 'awaiting_accept')))
        .first()
        is not None
    )


def _user_can_pay_reservation(user, currency, amount, exclude_reservation_id=None):
    from app.store.routes import (
        _store_prepaid_debt_limit_error,
        _user_debt_limit_effective,
        _user_puede_tener_deuda_effective,
    )

    amount = Decimal(str(amount or 0))
    if amount <= 0:
        return True, None
    holds = _pending_reservation_holds(user.id, exclude_reservation_id)
    saldo_cop = Decimal(str(getattr(user, 'saldo_cop', 0) or 0))
    saldo_usd = Decimal(str(getattr(user, 'saldo_usd', 0) or 0))
    permite_deuda = _user_puede_tener_deuda_effective(user)
    cur = (currency or 'USD').upper()
    if not permite_deuda:
        available = saldo_cop - holds['COP'] if cur == 'COP' else saldo_usd - holds['USD']
        if amount > available:
            if holds['COP'] > 0 or holds['USD'] > 0:
                return (
                    False,
                    'Saldo insuficiente: parte está anclada a reservas pendientes. '
                    'Cancela reservas en «Reservas pendientes» para liberar saldo.',
                )
            if cur == 'COP':
                return False, 'Saldo COP insuficiente para completar la reserva.'
            return False, 'Saldo USD insuficiente para completar la reserva.'
        return True, None
    total_cop = holds['COP'] + (amount if cur == 'COP' else Decimal(0))
    total_usd = holds['USD'] + (amount if cur != 'COP' else Decimal(0))
    err = _store_prepaid_debt_limit_error(user, total_cop, total_usd)
    if err:
        return False, err
    return True, None


def _max_reservable_quantity(user, product, exclude_reservation_id=None):
    """Máximo de unidades reservables según saldo disponible (descontando anclajes)."""
    from app.store.routes import (
        _user_debt_limit_effective,
        _user_puede_tener_deuda_effective,
        catalog_products_for_store_user,
    )

    products, _tipo = catalog_products_for_store_user(user)
    cat_prod = product
    for p in products or []:
        if int(p.id) == int(product.id):
            cat_prod = p
            break
    _pc, _pu, currency, unit_raw = _store_user_unit_price(user, cat_prod)
    unit = Decimal(str(unit_raw or 0))
    if unit <= 0:
        return 0, (currency or 'USD').upper(), float(unit)
    cur = (currency or 'USD').upper()
    holds = _pending_reservation_holds(user.id, exclude_reservation_id)
    held = holds['COP'] if cur == 'COP' else holds['USD']
    saldo = Decimal(str(getattr(user, 'saldo_cop' if cur == 'COP' else 'saldo_usd', 0) or 0))
    if _user_puede_tener_deuda_effective(user):
        lim = _user_debt_limit_effective(user, 'cop' if cur == 'COP' else 'usd')
        ceiling = saldo + (Decimal(str(lim)) if lim is not None else Decimal('999999999'))
    else:
        ceiling = saldo
    spendable = ceiling - held
    if spendable <= 0:
        return 0, cur, float(unit)
    max_qty = min(500, int(spendable // unit))
    while max_qty > 0:
        ok, _err = _user_can_pay_reservation(
            user, cur, unit * max_qty, exclude_reservation_id=exclude_reservation_id
        )
        if ok:
            break
        max_qty -= 1
    return max_qty, cur, float(unit)


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
        if email.lower() == pwd.lower():
            return email
        return f'{email} {pwd}'
    if ident and pwd:
        if ident == pwd:
            return ident
        return f'{ident} {pwd}'
    return ident or email or pwd or 'Cuenta asignada'


def _dedupe_cred_display_line(line):
    """Una credencial por línea (corrige 'token token' en avisos viejos)."""
    import re

    s = str(line or '').strip()
    if not s:
        return ''
    parts = s.split()
    if len(parts) >= 2 and all(p == parts[0] for p in parts):
        return parts[0]
    seen = set()
    unique = []
    for p in parts:
        norm = re.sub(r'\s+', '', p.lower())
        if not norm or norm in seen:
            continue
        seen.add(norm)
        unique.append(p)
    if len(unique) == 1:
        return unique[0]
    return s


def _unique_cred_lines(creds):
    seen = set()
    out = []
    for c in creds or []:
        s = _dedupe_cred_display_line(str(c or '').strip())
        if not s:
            continue
        norm = ''.join(s.split()).lower()
        if norm in seen:
            continue
        seen.add(norm)
        out.append(s)
    return out


def _account_cred_fingerprint(account):
    email = (getattr(account, 'email', None) or '').strip().lower()
    pwd = (getattr(account, 'password', None) or '').strip()
    ident = (getattr(account, 'account_identifier', None) or '').strip()
    return email, pwd, ident


def _creds_from_license_accounts(accounts):
    """Una línea por cuenta real (evita duplicados por doble asignación o email/ident iguales)."""
    seen_fp = set()
    seen_line = set()
    out = []
    for acc in accounts or []:
        fp = _account_cred_fingerprint(acc)
        line = _format_cred_for_user(acc).strip()
        line_norm = ''.join(line.split()).lower()
        fp_key = fp if fp != ('', '', '') else None
        if fp_key and fp_key in seen_fp:
            continue
        if line_norm and line_norm in seen_line:
            continue
        if fp_key:
            seen_fp.add(fp_key)
        if line_norm:
            seen_line.add(line_norm)
        if line:
            out.append(line)
    return out


def _reservation_fulfilled_creds(reservation, creds_fallback=None):
    from app.store.models import LicenseAccount

    sale_id = getattr(reservation, 'sale_id', None)
    if sale_id:
        accounts = (
            LicenseAccount.query.filter_by(sale_id=int(sale_id))
            .order_by(LicenseAccount.id.asc())
            .all()
        )
        from_sale = _creds_from_license_accounts(accounts)
        if from_sale:
            return from_sale
    return _unique_cred_lines(creds_fallback or [])


def _reservation_result_notify_body(pname, requested, fulfilled, cred_lines):
    """Texto corto para el toast: sin encabezado «Cuentas:» si es una sola."""
    cred_lines = _unique_cred_lines(cred_lines)
    pname = pname or 'Producto'
    if fulfilled >= requested:
        summary = f'«{pname}»: {fulfilled} cuenta(s) lista(s).'
    else:
        summary = f'«{pname}»: {fulfilled} de {requested} cuenta(s).'
    if not cred_lines:
        return summary
    if len(cred_lines) == 1:
        return f'{summary}\n{cred_lines[0]}'
    return f'{summary}\n\n' + '\n'.join(cred_lines[:10])


_RESERVATION_RESULT_KINDS = frozenset(
    {
        'product_reservation_fulfilled',
        'product_reservation_next_day_result',
    }
)


def _sanitize_reservation_notification_body(body):
    """Quita «Cuentas:» y líneas repetidas (avisos viejos en BD)."""
    import re

    lines = []
    for ln in str(body or '').replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        s = ln.strip()
        if s:
            lines.append(s)
    if not lines:
        return ''
    summary = []
    creds = []
    seen_cred = set()
    for ln in lines:
        if re.fullmatch(r'cuentas:?', ln, re.I):
            continue
        norm = re.sub(r'\s+', '', ln.lower())
        is_summary = (
            ln.startswith('Se ')
            or ln.startswith('Solo ')
            or ('«' in ln and ('lista(s)' in ln or 'cuenta(s)' in ln))
        )
        if is_summary:
            if ln not in summary:
                summary.append(ln)
            continue
        if not norm or norm in seen_cred:
            continue
        seen_cred.add(norm)
        creds.append(_dedupe_cred_display_line(ln))
    parts = []
    if summary:
        parts.append(summary[0])
    parts.extend(creds[:10])
    return '\n'.join(parts)


def _extract_cred_lines_from_notification_body(body):
    """Extrae credenciales únicas del cuerpo de avisos antiguos."""
    import re

    lines = []
    for ln in str(body or '').replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        s = ln.strip()
        if s:
            lines.append(s)
    creds = []
    seen = set()
    for ln in lines:
        if re.fullmatch(r'cuentas:?', ln, re.I):
            continue
        if ln.startswith('Se ') or ln.startswith('Solo '):
            continue
        if '«' in ln and ('lista(s)' in ln or 'cuenta(s)' in ln) and 'Credencial' not in ln:
            continue
        cleaned = _dedupe_cred_display_line(ln)
        norm = re.sub(r'\s+', '', cleaned.lower())
        if not norm or norm in seen:
            continue
        seen.add(norm)
        creds.append(cleaned)
    return creds


def _reservation_result_payload(reservation_id, product, requested, fulfilled, cred_lines):
    cred_lines = _unique_cred_lines(cred_lines)
    pname = getattr(product, 'name', None) or 'Producto'
    payload = {
        'reservation_id': reservation_id,
        'product_id': getattr(product, 'id', None),
        'product_name': pname,
        'requested': requested,
        'fulfilled': fulfilled,
        'credentials': cred_lines[:10],
    }
    if len(cred_lines) == 1:
        payload['credential'] = cred_lines[0]
    return payload


def _notification_to_client_dict(notif_row):
    payload = {}
    if notif_row.payload_json:
        try:
            payload = json.loads(notif_row.payload_json)
            if not isinstance(payload, dict):
                payload = {}
        except Exception:
            payload = {}

    kind = notif_row.kind or ''
    title = notif_row.title or ''
    body = notif_row.body or ''

    if kind in _RESERVATION_RESULT_KINDS:
        cred_lines = payload.get('credentials') or []
        if not cred_lines and payload.get('credential'):
            cred_lines = [payload.get('credential')]
        pname = payload.get('product_name') or 'Producto'
        try:
            requested = int(payload.get('requested') or 1)
        except (TypeError, ValueError):
            requested = 1
        try:
            fulfilled = int(payload.get('fulfilled') or requested)
        except (TypeError, ValueError):
            fulfilled = requested
        if not cred_lines:
            cred_lines = _extract_cred_lines_from_notification_body(notif_row.body)
        body = _reservation_result_notify_body(pname, requested, fulfilled, cred_lines)
        if kind == 'product_reservation_next_day_result':
            title = (
                f'Compra programada lista: {pname}'
                if fulfilled >= requested
                else f'Compra programada parcial: {pname}'
            )
        else:
            title = (
                f'Reserva completada: {pname}'
                if fulfilled >= requested
                else f'Reserva parcial: {pname}'
            )

    return {
        'id': notif_row.id,
        'kind': kind,
        'title': title,
        'body': body,
        'payload': payload,
        'created_at': notif_row.created_at.isoformat() if notif_row.created_at else None,
    }


def _collapse_duplicate_reservation_notifications(rows):
    """Marca como leídas duplicadas (misma reserva + tipo); conserva la más reciente."""
    from app.store.models import StoreUserNotification

    keep_ids = set()
    seen_keys = set()
    changed = False
    for n in rows:
        payload = {}
        if n.payload_json:
            try:
                payload = json.loads(n.payload_json)
            except Exception:
                payload = {}
        rid = payload.get('reservation_id')
        kind = n.kind or ''
        if rid is None or kind not in _RESERVATION_RESULT_KINDS:
            keep_ids.add(n.id)
            continue
        key = (int(rid), kind)
        if key not in seen_keys:
            seen_keys.add(key)
            keep_ids.add(n.id)
            continue
        if not n.read_at:
            n.read_at = datetime.utcnow()
            changed = True
    if changed:
        db.session.commit()
    return [n for n in rows if n.id in keep_ids]


def _lock_product_reservation(reservation_id):
    """Bloqueo de fila para evitar doble cumplimiento concurrente (p. ej. dos workers)."""
    from app.store.models import ProductReservation

    if not reservation_id:
        return None
    try:
        return (
            db.session.query(ProductReservation)
            .filter_by(id=int(reservation_id))
            .with_for_update()
            .first()
        )
    except Exception:
        db.session.rollback()
        return ProductReservation.query.get(int(reservation_id))


def _reservation_notify_already_sent(user_id, reservation_id, kind):
    from app.store.models import StoreUserNotification

    rid = int(reservation_id)
    rows = (
        StoreUserNotification.query.filter_by(user_id=int(user_id), kind=kind)
        .order_by(StoreUserNotification.id.desc())
        .limit(80)
        .all()
    )
    for n in rows:
        if not n.payload_json:
            continue
        try:
            payload = json.loads(n.payload_json)
            if int(payload.get('reservation_id') or 0) == rid:
                return True
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
    return False


def _user_platform_email(user):
    return (getattr(user, 'email', None) or '').strip()


def _send_reservation_result_transactional_email(
    user,
    product,
    reservation,
    requested,
    fulfilled,
    cred_lines,
    *,
    flow_kind,
):
    """
    Correo al email del perfil (User.email), mismo contenido que el aviso en tienda.
    flow_kind: 'stock' | 'next_day'
    """
    from app.store.email_notify_prefs import user_receives_email_notifications

    if not user_receives_email_notifications(user):
        current_app.logger.info(
            'Email reserva omitido: email notificaciones desactivado user=%s',
            getattr(user, 'username', None) or getattr(user, 'id', '?'),
        )
        return False

    to_email = _user_platform_email(user)
    pname = getattr(product, 'name', None) or 'Producto'
    cred_lines = _unique_cred_lines(_reservation_fulfilled_creds(reservation, cred_lines))

    if not to_email:
        current_app.logger.info(
            'Email reserva omitido: usuario %s sin email en perfil.',
            getattr(user, 'username', None) or getattr(user, 'id', '?'),
        )
        return False

    if flow_kind == 'next_day':
        if fulfilled >= requested:
            subject = f'Compra programada lista — {pname}'
            email_title = f'Compra programada lista: {pname}'
            lead = f'Tu compra programada de «{pname}» ya está lista ({fulfilled} cuenta(s)).'
        else:
            subject = f'Compra programada parcial — {pname}'
            email_title = f'Compra programada parcial: {pname}'
            lead = f'Se procesaron {fulfilled} de {requested} cuenta(s) de «{pname}».'
    else:
        if fulfilled >= requested:
            subject = f'Reserva completada — {pname}'
            email_title = f'Reserva completada: {pname}'
            lead = f'Tu reserva de «{pname}» ya está lista ({fulfilled} cuenta(s)).'
        else:
            subject = f'Reserva parcial — {pname}'
            email_title = f'Reserva parcial: {pname}'
            lead = f'Se asignaron {fulfilled} de {requested} cuenta(s) de «{pname}».'

    paragraphs = [lead]
    if cred_lines:
        if len(cred_lines) == 1:
            paragraphs.append(f'Tu cuenta:\n{cred_lines[0]}')
        else:
            paragraphs.append('Cuentas:\n' + '\n'.join(cred_lines[:10]))
    paragraphs.append('También puedes verla en Licencias de la tienda.')

    from app.services.email_service import (
        email_recipient_display_name,
        render_transactional_email_html,
        send_transactional_email,
    )

    uname = email_recipient_display_name(user)
    body_lines = [f'Hola {uname},'] if uname else ['Hola,']
    body_lines.extend(paragraphs)
    body_lines.extend(['', 'Tu Premium — mensaje automático de la tienda.'])
    body_text = '\n\n'.join(body_lines)

    body_html = None
    try:
        body_html = render_transactional_email_html(email_title, uname, paragraphs)
    except Exception as ex:
        current_app.logger.warning('Plantilla email reserva: %s', ex)

    try:
        ok = send_transactional_email(
            to_email=to_email,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
        )
        if ok:
            current_app.logger.info(
                'Email reserva enviado a %s (reservation_id=%s, kind=%s)',
                to_email,
                getattr(reservation, 'id', None),
                flow_kind,
            )
        return ok
    except Exception as ex:
        current_app.logger.warning('email reserva resultado: %s', ex)
        return False


def _notify_admins_reservation_app(user, product, title, body, *, reservation_id=None, extra_payload=None):
    """Aviso app/web al admin+soporte (sin email)."""
    try:
        from app.store.store_event_notify import (
            KIND_ADMIN_RESERVATION,
            notify_admins_app,
        )

        uname = str(getattr(user, 'username', None) or '').strip() or f'user#{getattr(user, "id", "")}'
        pname = getattr(product, 'name', None) or 'Producto'
        admin_title = str(title or f'Reserva: {pname}')[:200]
        if uname and uname not in admin_title:
            admin_title = f'{admin_title} — {uname}'[:200]
        admin_body = f'Cliente: {uname}\n{body or ""}'.strip()
        payload = {
            'reservation_id': reservation_id,
            'product_id': getattr(product, 'id', None),
            'product_name': pname,
            'customer_user_id': getattr(user, 'id', None),
            'customer_username': uname,
            'url': '/tienda/admin',
        }
        if isinstance(extra_payload, dict):
            payload.update(extra_payload)
        notify_admins_app(
            kind=KIND_ADMIN_RESERVATION,
            title=admin_title,
            body=admin_body[:4000],
            payload=payload,
            exclude_user_id=getattr(user, 'id', None),
        )
    except Exception as ex:
        current_app.logger.warning('_notify_admins_reservation_app: %s', ex)


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
    _notify_admins_reservation_app(
        user,
        product,
        title,
        f'Reserva lista.\nCredencial:\n{cred}',
        reservation_id=reservation_id,
    )
    return notif


def _email_reservation_fulfilled(user, product, account):
    from app.store.email_notify_prefs import user_receives_email_notifications

    if not user_receives_email_notifications(user):
        return False
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


def _notify_stock_result(user, product, reservation, requested, fulfilled, creds):
    from app.store.models import StoreUserNotification

    kind = 'product_reservation_fulfilled'
    if _reservation_notify_already_sent(user.id, reservation.id, kind):
        return

    pname = getattr(product, 'name', None) or 'Producto'
    cred_lines = _reservation_fulfilled_creds(reservation, creds)
    title = f'Reserva completada: {pname}' if fulfilled >= requested else f'Reserva parcial: {pname}'
    body = _reservation_result_notify_body(pname, requested, fulfilled, cred_lines)
    payload = _reservation_result_payload(reservation.id, product, requested, fulfilled, cred_lines)
    db.session.add(
        StoreUserNotification(
            user_id=int(user.id),
            kind=kind,
            title=title,
            body=body,
            payload_json=json.dumps(payload, ensure_ascii=False),
        )
    )
    _send_reservation_result_transactional_email(
        user,
        product,
        reservation,
        requested,
        fulfilled,
        cred_lines,
        flow_kind='stock',
    )
    _notify_admins_reservation_app(
        user,
        product,
        title,
        body,
        reservation_id=getattr(reservation, 'id', None),
        extra_payload={'requested': requested, 'fulfilled': fulfilled},
    )


def _notify_stock_issue(user, product, reservation, title, body, kind):
    from app.store.models import StoreUserNotification

    payload = {
        'reservation_id': reservation.id,
        'product_id': getattr(product, 'id', None),
        'product_name': getattr(product, 'name', None) or 'Producto',
    }
    db.session.add(
        StoreUserNotification(
            user_id=int(user.id),
            kind=kind,
            title=title,
            body=body,
            payload_json=json.dumps(payload, ensure_ascii=False),
        )
    )
    _notify_admins_reservation_app(
        user,
        product,
        title,
        body,
        reservation_id=getattr(reservation, 'id', None),
    )


def _email_stock_reservation(user, subject, text_body):
    from app.store.email_notify_prefs import user_receives_email_notifications

    if not user_receives_email_notifications(user):
        return False
    to_email = (getattr(user, 'email', None) or '').strip()
    if not to_email:
        return False
    from_email = current_app.config.get('SMTP_FROM', 'noreply@tusitio.com')
    html = '<p>' + text_body.replace('\n', '<br>') + '</p>'
    try:
        from app.services.smtp_client import send_email_via_smtp

        return bool(
            send_email_via_smtp(
                from_email=from_email,
                to_email=to_email,
                subject=subject,
                text_content=text_body,
                html_content=html,
            )
        )
    except Exception as ex:
        current_app.logger.warning('email reserva stock: %s', ex)
        return False


def _process_one_stock_reservation(reservation):
    """
    Procesa reserva por agotado cuando hay stock.
    Devuelve 'fulfilled', 'partial', 'skip' o 'stop'.
    """
    from app.models.user import User
    from app.store.models import Product
    from app.store.routes import _compute_public_sellable_stock_for_product

    rid = getattr(reservation, 'id', None)
    if not rid:
        return 'stop'
    reservation = _lock_product_reservation(rid)
    if not reservation or reservation.status != 'pending':
        return 'skip' if reservation else 'stop'

    user = User.query.get(reservation.user_id)
    product = Product.query.get(reservation.product_id)
    if not user or not product or not product.enabled:
        reservation.status = 'cancelled'
        reservation.cancelled_at = datetime.utcnow()
        reservation.last_error = 'Usuario o producto no disponible.'
        db.session.commit()
        return 'skip'

    if not product_allows_reservation(product):
        reservation.status = 'cancelled'
        reservation.cancelled_at = datetime.utcnow()
        reservation.last_error = 'Reservas desactivadas para este producto.'
        db.session.commit()
        return 'skip'

    qty = int(reservation.quantity or 1)
    currency = (reservation.currency or 'USD').upper()
    unit = reservation.price_cop if currency == 'COP' else reservation.price_usd
    amount = Decimal(str(unit or 0)) * qty

    sellable = _compute_public_sellable_stock_for_product(product)
    if sellable <= 0:
        return 'stop'

    ok_pay, pay_err = _user_can_pay_reservation(user, currency, amount, exclude_reservation_id=reservation.id)
    if not ok_pay:
        prev = reservation.last_error or ''
        reservation.last_error = pay_err or 'Saldo insuficiente.'
        db.session.commit()
        if prev != reservation.last_error:
            pname = getattr(product, 'name', None) or 'Producto'
            _notify_stock_issue(
                user,
                product,
                reservation,
                f'Reserva sin procesar: {pname}',
                f'Tu reserva de «{pname}» (x{qty}) no se procesó: {reservation.last_error} '
                'Recarga saldo o cancela otras reservas.',
                'product_reservation_error',
            )
            db.session.commit()
            _email_stock_reservation(
                user,
                f'Reserva sin procesar — {pname}',
                f'Hola {getattr(user, "username", "") or ""},\n\n'
                f'Tu reserva de «{pname}» (x{qty}) no se procesó: {reservation.last_error}',
            )
        return 'skip'

    if sellable < qty:
        if reservation.status != 'awaiting_accept' or int(reservation.offered_quantity or 0) != int(sellable):
            reservation.status = 'awaiting_accept'
            reservation.offered_quantity = int(sellable)
            reservation.last_error = None
            db.session.commit()
            pname = getattr(product, 'name', None) or 'Producto'
            _notify_stock_issue(
                user,
                product,
                reservation,
                f'Reserva parcial: {pname}',
                f'Solo hay {sellable} de {qty} cuenta(s) de «{pname}» que reservaste. '
                'Entra a la tienda y pulsa «Aceptar» para procesar el cambio.',
                'product_reservation_partial',
            )
            db.session.commit()
            _email_stock_reservation(
                user,
                f'Reserva parcial — {pname}',
                f'Hola {getattr(user, "username", "") or ""},\n\n'
                f'De tu reserva de «{pname}» (x{qty}) solo hay {sellable} disponible(s).\n'
                'Entra a la tienda y acepta el cambio para procesar esa cantidad.',
            )
        return 'partial'

    fulfilled, creds = _fulfill_next_day_units(reservation, user, product, qty)
    if fulfilled <= 0:
        return 'stop'
    pname = getattr(product, 'name', None) or 'Producto'
    _notify_stock_result(user, product, reservation, qty, fulfilled, creds)
    db.session.commit()
    return 'fulfilled'


def _fulfill_one_reservation(reservation):
    """Compat: delega en el procesador multi-unidad."""
    result = _process_one_stock_reservation(reservation)
    return result == 'fulfilled'


def process_pending_reservations_for_product(product_id):
    """Intenta cumplir reservas FIFO cuando hay stock vendible."""
    from app.store.models import ProductReservation

    ensure_product_reservation_schema()
    if not product_id:
        return 0
    fulfilled = 0
    while True:
        row = (
            ProductReservation.query.filter_by(
                product_id=int(product_id), status='pending', kind='stock'
            )
            .order_by(ProductReservation.created_at.asc(), ProductReservation.id.asc())
            .first()
        )
        if not row:
            break
        result = _process_one_stock_reservation(row)
        if result == 'fulfilled':
            fulfilled += 1
        elif result == 'stop':
            break
        # partial / skip: continuar con la siguiente reserva pending
    return fulfilled


def list_user_pending_reservation_product_ids(user_id):
    """Productos con reserva activa (pending o awaiting_accept) para pintar «Reservado»."""
    from app.store.models import ProductReservation

    ensure_product_reservation_schema()
    rows = (
        ProductReservation.query.filter_by(user_id=int(user_id), kind='stock')
        .filter(ProductReservation.status.in_(('pending', 'awaiting_accept')))
        .all()
    )
    return {int(r.product_id) for r in rows}


def _clear_legacy_next_day_result_toasts(user_id):
    """Compra programada ya no usa toast en tienda; archiva avisos viejos no leídos."""
    from app.store.models import StoreUserNotification

    rows = (
        StoreUserNotification.query.filter_by(user_id=int(user_id))
        .filter(
            StoreUserNotification.kind == 'product_reservation_next_day_result',
            StoreUserNotification.read_at.is_(None),
        )
        .all()
    )
    if not rows:
        return
    now = datetime.utcnow()
    for n in rows:
        n.read_at = now
    db.session.commit()


def list_unread_notifications(user_id, limit=20):
    from app.store.models import StoreUserNotification

    ensure_product_reservation_schema()
    _clear_legacy_next_day_result_toasts(user_id)
    rows = (
        StoreUserNotification.query.filter_by(user_id=int(user_id))
        .filter(StoreUserNotification.read_at.is_(None))
        .order_by(StoreUserNotification.created_at.desc())
        .limit(max(int(limit or 20), 20) * 2)
        .all()
    )
    rows = _collapse_duplicate_reservation_notifications(rows)
    out = []
    for n in rows[: int(limit or 20)]:
        out.append(_notification_to_client_dict(n))
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


# ==================== Reservas para otro día (kind='next_day') ====================


def _co_today_iso():
    from app.utils.timezone import get_colombia_datetime

    return get_colombia_datetime().date().isoformat()


def _co_next_day_iso():
    from datetime import timedelta

    from app.utils.timezone import get_colombia_datetime

    return (get_colombia_datetime().date() + timedelta(days=1)).isoformat()


def create_next_day_reservation(user, product, quantity):
    """
    Programa una compra para el día siguiente (Colombia): se procesa al cerrar el día actual.
    Valida el saldo con la misma regla del checkout; sin saldo suficiente no se crea.
    Devuelve (reservation_dict|None, error|None).
    """
    from app.store.models import License, Product, ProductReservation

    ensure_product_reservation_schema()

    if not user or not product:
        return None, 'Datos inválidos.'
    if getattr(user, 'parent_id', None):
        return None, 'Solo el usuario principal puede reservar productos.'

    prod = product if isinstance(product, Product) else Product.query.get(int(product))
    if not prod or not prod.enabled:
        return None, 'Producto no disponible.'
    allowed, unit_limit = user_next_day_allowed_for_product(user, prod)
    if not allowed:
        return None, 'No tienes permiso para reservar este producto para otro día.'

    try:
        qty = int(quantity)
    except (TypeError, ValueError):
        qty = 0
    if qty < 1 or qty > 500:
        return None, 'Cantidad inválida.'
    if unit_limit is not None and qty > unit_limit:
        return None, f'Supera el límite permitido para este producto ({unit_limit}).'

    from app.store.routes import catalog_products_for_store_user

    products, _tipo = catalog_products_for_store_user(user)
    cat_prod = prod
    for p in products or []:
        if int(p.id) == int(prod.id):
            cat_prod = p
            break
    price_cop, price_usd, currency, unit = _store_user_unit_price(user, cat_prod)

    amount = Decimal(str(unit or 0)) * qty
    ok_pay, pay_err = _user_can_pay_reservation(user, currency, amount)
    if not ok_pay:
        return None, 'La reserva no se puede hacer: no tienes suficiente saldo. ' + (pay_err or '')

    conflict = _reservation_conflict_message(user, prod.id, for_kind='next_day')
    if conflict:
        return None, conflict

    existing = (
        ProductReservation.query.filter_by(
            user_id=int(user.id),
            product_id=int(prod.id),
            kind='next_day',
        )
        .filter(ProductReservation.status.in_(('pending', 'awaiting_accept')))
        .first()
    )
    if existing:
        return update_reservation_quantity(user, existing.id, qty)

    lic = (
        License.query.filter_by(product_id=prod.id, enabled=True)
        .order_by(License.position.asc(), License.id.asc())
        .first()
    )

    row = ProductReservation(
        user_id=int(user.id),
        product_id=int(prod.id),
        license_id=lic.id if lic else None,
        status='pending',
        price_cop=price_cop,
        price_usd=price_usd,
        currency=currency,
        kind='next_day',
        quantity=qty,
        target_co_date=_co_next_day_iso(),
    )
    db.session.add(row)
    db.session.commit()
    return _reservation_to_dict(row), None


def list_user_reservations_detailed(user_id):
    """Reservas activas (pending / awaiting_accept) de ambos tipos, con datos para la tienda."""
    from app.store.models import Product, ProductReservation

    ensure_product_reservation_schema()
    rows = (
        ProductReservation.query.filter_by(user_id=int(user_id))
        .filter(ProductReservation.status.in_(('pending', 'awaiting_accept')))
        .order_by(ProductReservation.created_at.asc(), ProductReservation.id.asc())
        .all()
    )
    out = []
    for r in rows:
        prod = Product.query.get(r.product_id)
        d = _reservation_to_dict(r)
        d['product_name'] = getattr(prod, 'name', None) or f'Producto {r.product_id}'
        d['currency'] = (r.currency or 'USD').upper()
        unit = r.price_cop if d['currency'] == 'COP' else r.price_usd
        d['unit_price'] = float(unit or 0)
        d['last_error'] = r.last_error or ''
        out.append(d)
    return out


def cancel_product_reservation(user, reservation_id):
    """Cancela una reserva propia (pending o awaiting_accept, cualquier tipo)."""
    from app.store.models import ProductReservation

    ensure_product_reservation_schema()
    row = ProductReservation.query.filter_by(id=int(reservation_id), user_id=int(user.id)).first()
    if not row:
        return False, 'Reserva no encontrada.'
    if row.status not in ('pending', 'awaiting_accept'):
        return False, 'La reserva ya fue procesada o cancelada.'
    row.status = 'cancelled'
    row.cancelled_at = datetime.utcnow()
    db.session.commit()
    return True, None


def update_next_day_reservation_quantity(user, reservation_id, quantity):
    """Cambia la cantidad de una reserva para otro día (revalida saldo y límite)."""
    from app.store.models import Product, ProductReservation

    ensure_product_reservation_schema()
    row = ProductReservation.query.filter_by(id=int(reservation_id), user_id=int(user.id)).first()
    if not row or (getattr(row, 'kind', 'stock') or 'stock') != 'next_day':
        return None, 'Reserva no encontrada.'
    if row.status not in ('pending', 'awaiting_accept'):
        return None, 'La reserva ya fue procesada o cancelada.'
    try:
        qty = int(quantity)
    except (TypeError, ValueError):
        qty = 0
    if qty < 1 or qty > 500:
        return None, 'Cantidad inválida.'
    prod_row = Product.query.get(row.product_id)
    _allowed, unit_limit = user_next_day_allowed_for_product(user, prod_row)
    if unit_limit is not None and qty > unit_limit:
        return None, f'Supera el límite permitido para este producto ({unit_limit}).'

    currency = (row.currency or 'USD').upper()
    unit = row.price_cop if currency == 'COP' else row.price_usd
    amount = Decimal(str(unit or 0)) * qty
    ok_pay, pay_err = _user_can_pay_reservation(user, currency, amount, exclude_reservation_id=row.id)
    if not ok_pay:
        return None, 'No se puede cambiar: no tienes suficiente saldo. ' + (pay_err or '')

    row.quantity = qty
    row.status = 'pending'
    row.offered_quantity = None
    row.last_error = None
    db.session.commit()
    return _reservation_to_dict(row), None


def update_reservation_quantity(user, reservation_id, quantity):
    """Cambia cantidad de reserva stock u otro día (revalida saldo y límites)."""
    from app.store.models import Product, ProductReservation

    ensure_product_reservation_schema()
    row = ProductReservation.query.filter_by(id=int(reservation_id), user_id=int(user.id)).first()
    if not row:
        return None, 'Reserva no encontrada.'
    kind = (getattr(row, 'kind', 'stock') or 'stock')
    if kind == 'next_day':
        return update_next_day_reservation_quantity(user, reservation_id, quantity)
    if kind != 'stock':
        return None, 'Reserva no encontrada.'
    if row.status not in ('pending', 'awaiting_accept'):
        return None, 'La reserva ya fue procesada o cancelada.'
    try:
        qty = int(quantity)
    except (TypeError, ValueError):
        qty = 0
    if qty < 1 or qty > 500:
        return None, 'Cantidad inválida.'

    prod_row = Product.query.get(row.product_id)
    if not prod_row:
        return None, 'Producto no disponible.'

    max_qty, _cur, _unit = _max_reservable_quantity(user, prod_row, exclude_reservation_id=row.id)
    if max_qty <= 0:
        return None, 'No tienes saldo disponible para esta reserva.'
    if qty > max_qty:
        return None, (
            f'Con tu saldo disponible solo puedes reservar hasta {max_qty} '
            f'cuenta(s) de este producto.'
        )

    currency = (row.currency or 'USD').upper()
    unit = row.price_cop if currency == 'COP' else row.price_usd
    amount = Decimal(str(unit or 0)) * qty
    ok_pay, pay_err = _user_can_pay_reservation(user, currency, amount, exclude_reservation_id=row.id)
    if not ok_pay:
        return None, 'No se puede cambiar: no tienes suficiente saldo. ' + (pay_err or '')

    row.quantity = qty
    row.status = 'pending'
    row.offered_quantity = None
    row.last_error = None
    db.session.commit()
    return _reservation_to_dict(row), None


def _notify_next_day_result(user, product, reservation, requested, fulfilled, creds):
    """Compra programada: correo + resumen diario; sin toast en tienda."""
    from app.store.models import StoreUserNotification

    kind = 'product_reservation_next_day_result'
    if _reservation_notify_already_sent(user.id, reservation.id, kind):
        return

    pname = getattr(product, 'name', None) or 'Producto'
    cred_lines = _reservation_fulfilled_creds(reservation, creds)
    title = (
        f'Compra programada lista: {pname}'
        if fulfilled >= requested
        else f'Compra programada parcial: {pname}'
    )
    body = _reservation_result_notify_body(pname, requested, fulfilled, cred_lines)
    payload = _reservation_result_payload(reservation.id, product, requested, fulfilled, cred_lines)
    now = datetime.utcnow()
    db.session.add(
        StoreUserNotification(
            user_id=int(user.id),
            kind=kind,
            title=title,
            body=body,
            payload_json=json.dumps(payload, ensure_ascii=False),
            read_at=now,
        )
    )
    _send_reservation_result_transactional_email(
        user,
        product,
        reservation,
        requested,
        fulfilled,
        cred_lines,
        flow_kind='next_day',
    )
    _notify_admins_reservation_app(
        user,
        product,
        title,
        body,
        reservation_id=getattr(reservation, 'id', None),
        extra_payload={'requested': requested, 'fulfilled': fulfilled, 'flow': 'next_day'},
    )


def _notify_next_day_issue(user, product, reservation, title, body, kind):
    from app.store.models import StoreUserNotification

    payload = {
        'reservation_id': reservation.id,
        'product_id': getattr(product, 'id', None),
        'product_name': getattr(product, 'name', None) or 'Producto',
    }
    db.session.add(
        StoreUserNotification(
            user_id=int(user.id),
            kind=kind,
            title=title,
            body=body,
            payload_json=json.dumps(payload, ensure_ascii=False),
        )
    )
    _notify_admins_reservation_app(
        user,
        product,
        title,
        body,
        reservation_id=getattr(reservation, 'id', None),
        extra_payload={'flow': 'next_day'},
    )


def _email_next_day(user, subject, text_body):
    from app.store.email_notify_prefs import user_receives_email_notifications

    if not user_receives_email_notifications(user):
        return False
    to_email = (getattr(user, 'email', None) or '').strip()
    if not to_email:
        return False
    from_email = current_app.config.get('SMTP_FROM', 'noreply@tusitio.com')
    html = '<p>' + text_body.replace('\n', '<br>') + '</p>'
    try:
        from app.services.smtp_client import send_email_via_smtp

        return bool(
            send_email_via_smtp(
                from_email=from_email,
                to_email=to_email,
                subject=subject,
                text_content=text_body,
                html_content=html,
            )
        )
    except Exception as ex:
        current_app.logger.warning('email reserva otro día: %s', ex)
        return False


def _fulfill_next_day_units(reservation, user, product, qty):
    """Cobra y asigna qty unidades (una venta). Devuelve (fulfilled, creds)."""
    from app.store.models import LicenseAccount, Sale
    from app.store.routes import _apply_public_checkout_bloc_moves_to_licenses

    if getattr(reservation, 'sale_id', None) and str(getattr(reservation, 'status', '') or '') == 'fulfilled':
        accounts = (
            LicenseAccount.query.filter_by(sale_id=int(reservation.sale_id))
            .order_by(LicenseAccount.id.asc())
            .all()
        )
        creds = _creds_from_license_accounts(accounts)
        return int(reservation.fulfilled_quantity or len(creds)), creds

    currency = (reservation.currency or 'USD').upper()
    unit = reservation.price_cop if currency == 'COP' else reservation.price_usd
    amount = Decimal(str(unit or 0)) * qty

    venta = Sale(
        user_id=user.id,
        product_id=product.id,
        quantity=qty,
        total_price=amount,
        is_renewal=False,
    )
    db.session.add(venta)
    db.session.flush()

    sold_bloc_moves = []
    cuentas_asignadas = []
    creds = []
    fulfilled = 0
    last_account = None
    last_license = None
    for _i in range(qty):
        account, license_row = _assign_one_unit_for_product(
            product, user, venta, sold_bloc_moves, cuentas_asignadas
        )
        if not account:
            break
        fulfilled += 1
        last_account = account
        last_license = license_row
        db.session.flush()

    if fulfilled <= 0:
        db.session.rollback()
        return 0, []

    assigned_accounts = (
        LicenseAccount.query.filter_by(sale_id=int(venta.id))
        .order_by(LicenseAccount.id.asc())
        .all()
    )
    creds = _creds_from_license_accounts(assigned_accounts)

    if fulfilled < qty:
        venta.quantity = fulfilled
        venta.total_price = Decimal(str(unit or 0)) * fulfilled
        amount = venta.total_price

    _apply_public_checkout_bloc_moves_to_licenses(sold_bloc_moves)

    if currency == 'COP':
        user.saldo_cop = Decimal(str(user.saldo_cop or 0)) - amount
    else:
        user.saldo_usd = Decimal(str(user.saldo_usd or 0)) - amount

    reservation.status = 'fulfilled'
    reservation.fulfilled_at = datetime.utcnow()
    reservation.sale_id = venta.id
    reservation.fulfilled_quantity = fulfilled
    reservation.license_account_id = last_account.id if last_account else None
    reservation.license_id = last_license.id if last_license else reservation.license_id
    reservation.last_error = None
    db.session.commit()

    try:
        from app.store.sale_purchase_snapshot import ensure_sale_schema, sync_snapshots_for_sale_ids

        ensure_sale_schema()
        sync_snapshots_for_sale_ids([venta.id])
    except Exception as snap_ex:
        current_app.logger.warning('snapshot reserva otro día: %s', snap_ex)

    try:
        from app.store.balance_recharge_events import notify_balance_recharge_updated

        notify_balance_recharge_updated(int(user.id), reason='store_next_day_reservation')
    except Exception:
        pass

    return fulfilled, creds


def _process_one_next_day_reservation(reservation):
    """Procesa una reserva programada llegada su fecha; parcial requiere aceptación del cliente."""
    from app.models.user import User
    from app.store.models import Product
    from app.store.routes import _compute_public_sellable_stock_for_product

    rid = getattr(reservation, 'id', None)
    if not rid:
        return False
    reservation = _lock_product_reservation(rid)
    if not reservation or reservation.status != 'pending':
        return False

    user = User.query.get(reservation.user_id)
    product = Product.query.get(reservation.product_id)
    if not user or not product or not product.enabled:
        reservation.status = 'cancelled'
        reservation.cancelled_at = datetime.utcnow()
        reservation.last_error = 'Usuario o producto no disponible.'
        db.session.commit()
        return False

    qty = int(reservation.quantity or 1)
    currency = (reservation.currency or 'USD').upper()
    unit = reservation.price_cop if currency == 'COP' else reservation.price_usd
    amount = Decimal(str(unit or 0)) * qty

    sellable = _compute_public_sellable_stock_for_product(product)
    if sellable <= 0:
        prev = reservation.last_error or ''
        reservation.last_error = 'Sin stock disponible; se reintentará.'
        db.session.commit()
        if prev != reservation.last_error:
            pname = getattr(product, 'name', None) or 'Producto'
            _notify_next_day_issue(
                user,
                product,
                reservation,
                f'Reserva sin stock: {pname}',
                f'Tu compra programada de «{pname}» (x{qty}) no se pudo procesar: sin stock. '
                'Se reintentará cuando haya cuentas.',
                'product_reservation_next_day_error',
            )
            db.session.commit()
            _email_next_day(
                user,
                f'Reserva sin stock — {pname}',
                f'Hola {getattr(user, "username", "") or ""},\n\n'
                f'Tu compra programada de «{pname}» (x{qty}) no se pudo procesar por falta de stock. '
                'Se reintentará automáticamente cuando haya cuentas disponibles.',
            )
        return False

    ok_pay, pay_err = _user_can_pay_reservation(user, currency, amount, exclude_reservation_id=reservation.id)
    if not ok_pay:
        prev = reservation.last_error or ''
        reservation.last_error = pay_err or 'Saldo insuficiente.'
        db.session.commit()
        if prev != reservation.last_error:
            pname = getattr(product, 'name', None) or 'Producto'
            _notify_next_day_issue(
                user,
                product,
                reservation,
                f'Reserva sin procesar: {pname}',
                f'Tu compra programada de «{pname}» (x{qty}) no se procesó: {reservation.last_error} '
                'Recarga saldo; se reintentará.',
                'product_reservation_next_day_error',
            )
            db.session.commit()
            _email_next_day(
                user,
                f'Reserva sin procesar — {pname}',
                f'Hola {getattr(user, "username", "") or ""},\n\n'
                f'Tu compra programada de «{pname}» (x{qty}) no se procesó: {reservation.last_error}\n'
                'Recarga saldo para que se procese automáticamente.',
            )
        return False

    if sellable < qty:
        # Parcial: requiere que el cliente acepte el cambio en la tienda antes de procesar.
        if reservation.status != 'awaiting_accept' or int(reservation.offered_quantity or 0) != int(sellable):
            reservation.status = 'awaiting_accept'
            reservation.offered_quantity = int(sellable)
            reservation.last_error = None
            db.session.commit()
            pname = getattr(product, 'name', None) or 'Producto'
            _notify_next_day_issue(
                user,
                product,
                reservation,
                f'Reserva parcial: {pname}',
                f'Solo hay {sellable} de {qty} cuenta(s) de «{pname}» que reservaste. '
                'Entra a la tienda y pulsa «Aceptar» en tu reserva para procesar el cambio.',
                'product_reservation_next_day_partial',
            )
            db.session.commit()
            _email_next_day(
                user,
                f'Reserva parcial — {pname}',
                f'Hola {getattr(user, "username", "") or ""},\n\n'
                f'De tu compra programada de «{pname}» (x{qty}) solo hay {sellable} disponible(s).\n'
                'Entra a la tienda y acepta el cambio para procesar esa cantidad.',
            )
        return False

    fulfilled, creds = _fulfill_next_day_units(reservation, user, product, qty)
    if fulfilled <= 0:
        return False
    pname = getattr(product, 'name', None) or 'Producto'
    _notify_next_day_result(user, product, reservation, qty, fulfilled, creds)
    db.session.commit()
    return True


def accept_reservation_offer(user, reservation_id):
    """El cliente acepta el cambio (cantidad parcial ofrecida): stock u otro día."""
    from app.store.models import Product
    from app.store.routes import _compute_public_sellable_stock_for_product

    ensure_product_reservation_schema()
    row = _lock_product_reservation(reservation_id)
    if not row or int(row.user_id) != int(user.id):
        return None, 'Reserva no encontrada.'
    if row.status == 'fulfilled' and row.sale_id:
        return _reservation_to_dict(row), None
    if row.status != 'awaiting_accept':
        return None, 'Esta reserva no tiene cambios pendientes de aceptar.'

    kind = (getattr(row, 'kind', 'stock') or 'stock')
    product = Product.query.get(row.product_id)
    if not product or not product.enabled:
        return None, 'Producto no disponible.'

    offered = int(row.offered_quantity or 0)
    sellable = _compute_public_sellable_stock_for_product(product)
    qty = min(offered, sellable) if offered > 0 else min(int(row.quantity or 1), sellable)
    if qty <= 0:
        row.status = 'pending'
        row.offered_quantity = None
        row.last_error = 'Sin stock disponible; se reintentará.'
        db.session.commit()
        return None, 'Ya no hay stock disponible; la reserva queda pendiente de nuevo.'

    currency = (row.currency or 'USD').upper()
    unit = row.price_cop if currency == 'COP' else row.price_usd
    amount = Decimal(str(unit or 0)) * qty
    ok_pay, pay_err = _user_can_pay_reservation(user, currency, amount, exclude_reservation_id=row.id)
    if not ok_pay:
        return None, 'No tienes suficiente saldo: ' + (pay_err or '')

    requested = int(row.quantity or 1)
    fulfilled, creds = _fulfill_next_day_units(row, user, product, qty)
    if fulfilled <= 0:
        return None, 'No se pudo asignar ninguna cuenta; intenta de nuevo.'

    if kind == 'next_day':
        _notify_next_day_result(user, product, row, requested, fulfilled, creds)
    else:
        _notify_stock_result(user, product, row, requested, fulfilled, creds)
    db.session.commit()
    return _reservation_to_dict(row), None


def accept_next_day_reservation_offer(user, reservation_id):
    """Compat: delega en accept_reservation_offer."""
    return accept_reservation_offer(user, reservation_id)


def process_due_next_day_reservations():
    """Procesa las reservas programadas cuya fecha (día Colombia) ya llegó."""
    from app.store.models import ProductReservation

    ensure_product_reservation_schema()
    today = _co_today_iso()
    rows = (
        ProductReservation.query.filter_by(kind='next_day', status='pending')
        .filter(ProductReservation.target_co_date.isnot(None))
        .filter(ProductReservation.target_co_date <= today)
        .order_by(ProductReservation.created_at.asc(), ProductReservation.id.asc())
        .all()
    )
    done = 0
    for row in rows:
        try:
            if _process_one_next_day_reservation(row):
                done += 1
        except Exception as ex:
            db.session.rollback()
            current_app.logger.exception('reserva otro día %s: %s', row.id, ex)
    return done


def fulfilled_reservation_historial_suffix(kind):
    """Etiqueta en historial para ventas originadas en una reserva cumplida."""
    k = (kind or 'stock').strip().lower()
    if k == 'next_day':
        return 'Compra programada'
    return 'Compra reservada'


def fulfilled_reservation_map_for_sale_ids(sale_ids):
    """Mapa sale_id → {kind, suffix} según store_product_reservations.sale_id."""
    from app.store.models import ProductReservation

    ensure_product_reservation_schema()
    ids = [int(x) for x in (sale_ids or []) if x is not None]
    if not ids:
        return {}
    rows = (
        ProductReservation.query.filter(
            ProductReservation.sale_id.in_(ids),
            ProductReservation.status == 'fulfilled',
        )
        .with_entities(ProductReservation.sale_id, ProductReservation.kind)
        .all()
    )
    out = {}
    for sale_id, kind in rows:
        if sale_id is None:
            continue
        sid = int(sale_id)
        k = (kind or 'stock').strip().lower()
        out[sid] = {
            'kind': k,
            'suffix': fulfilled_reservation_historial_suffix(k),
        }
    return out


def historial_product_label_with_reservation(product_name, sale_id, reservation_map):
    label = (product_name or 'Producto').strip() or 'Producto'
    try:
        sid = int(sale_id) if sale_id is not None else None
    except (TypeError, ValueError):
        sid = None
    if sid is not None and sid in (reservation_map or {}):
        label = f'{label} ({reservation_map[sid]["suffix"]})'
    return label


def build_reservation_historial_items(user_id=None, all_users=False, utc_to_colombia_fn=None):
    """
    Entradas de historial para reservas canceladas (no generan Sale).
    Las reservas cumplidas generan Sale: la etiqueta se aplica vía sale_id
    («Compra programada» / «Compra reservada»).
    """
    from app.store.models import Product, ProductReservation

    ensure_product_reservation_schema()
    q = ProductReservation.query.filter(ProductReservation.status == 'cancelled')
    if not all_users and user_id is not None:
        q = q.filter(ProductReservation.user_id == int(user_id))
    rows = q.order_by(ProductReservation.cancelled_at.desc(), ProductReservation.id.desc()).limit(500).all()
    out = []
    for r in rows:
        prod = Product.query.get(r.product_id)
        pname = getattr(prod, 'name', None) or f'Producto {r.product_id}'
        kind = (getattr(r, 'kind', 'stock') or 'stock')
        qty = int(getattr(r, 'quantity', 1) or 1)
        cur = (r.currency or 'USD').upper()
        unit = r.price_cop if cur == 'COP' else r.price_usd
        total = float(Decimal(str(unit or 0)) * qty)
        ts = r.cancelled_at or r.created_at
        sort_ts = ts.timestamp() if ts else 0.0
        fecha_str = 'Fecha no disponible'
        if ts and utc_to_colombia_fn:
            try:
                fecha_str = utc_to_colombia_fn(ts).strftime('%y/%m/%d %I:%M:%S %p')
            except Exception:
                pass
        tipo_label = 'Reserva otro día cancelada' if kind == 'next_day' else 'Reserva cancelada'
        err = (r.last_error or '').strip()
        producto = f'{pname} ({tipo_label})'
        if err:
            producto += f' — {err}'
        out.append(
            {
                'id': f'res-cancel-{r.id}',
                'fecha': fecha_str,
                'producto': producto,
                'cantidad': qty,
                'total': total,
                'licencias': [],
                'is_reservation_event': True,
                'reservation_status': 'cancelled',
                'reservation_kind': kind,
                'has_licencias': False,
                'sort_ts': sort_ts,
            }
        )
    return out
