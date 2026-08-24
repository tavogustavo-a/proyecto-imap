# -*- coding: utf-8 -*-
"""Devoluciones parciales, atómicas y auditables de cuentas de licencia."""
from __future__ import annotations

import json
import logging
from calendar import monthrange
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from flask import current_app
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.user import User
from app.store.models import (
    LicenseAccount,
    LicenseAccountRefund,
    Sale,
    SalePurchaseSnapshot,
    StoreUserNotification,
)

logger = logging.getLogger(__name__)
_CENT = Decimal('0.01')
_UNIT_SCALE = Decimal('0.000001')
_VALID_ACCOUNT_STATUSES = frozenset({'assigned', 'sold'})


class RefundError(Exception):
    def __init__(self, message: str, status_code: int = 400, code: str = 'invalid_request'):
        super().__init__(message)
        self.message = message
        self.status_code = int(status_code)
        self.code = code


def ensure_license_account_refund_schema() -> None:
    """Crea la tabla declarada por SQLAlchemy en SQLite o PostgreSQL."""
    try:
        from app.store.routes_licencias import _ensure_license_account_sold_price_columns

        _ensure_license_account_sold_price_columns()
    except Exception:
        logger.exception('No se pudieron asegurar columnas sold_unit_price/sold_currency')
    try:
        inspector = inspect(db.engine)
        if 'store_license_account_refunds' not in inspector.get_table_names():
            LicenseAccountRefund.__table__.create(db.engine, checkfirst=True)
            return
        existing = {
            str(column.get('name') or '').strip()
            for column in inspector.get_columns('store_license_account_refunds')
        }
        if 'product_name' not in existing:
            db.session.execute(
                text(
                    "ALTER TABLE store_license_account_refunds "
                    "ADD COLUMN product_name VARCHAR(200) NOT NULL DEFAULT 'Licencia'"
                )
            )
        if 'custom_message' not in existing:
            db.session.execute(
                text(
                    'ALTER TABLE store_license_account_refunds '
                    'ADD COLUMN custom_message TEXT'
                )
            )
        if 'debt_applied' not in existing:
            db.session.execute(
                text(
                    'ALTER TABLE store_license_account_refunds '
                    'ADD COLUMN debt_applied NUMERIC(14, 2) NOT NULL DEFAULT 0'
                )
            )
        if 'prepaid_applied' not in existing:
            db.session.execute(
                text(
                    'ALTER TABLE store_license_account_refunds '
                    'ADD COLUMN prepaid_applied NUMERIC(14, 2) NOT NULL DEFAULT 0'
                )
            )
        if 'billing_period_days' not in existing:
            db.session.execute(
                text(
                    'ALTER TABLE store_license_account_refunds '
                    'ADD COLUMN billing_period_days INTEGER NOT NULL DEFAULT 30'
                )
            )
        if 'detected_charged_days' not in existing:
            db.session.execute(
                text(
                    'ALTER TABLE store_license_account_refunds '
                    'ADD COLUMN detected_charged_days INTEGER NOT NULL DEFAULT 0'
                )
            )
        if 'charged_days_overridden' not in existing:
            db.session.execute(
                text(
                    'ALTER TABLE store_license_account_refunds '
                    'ADD COLUMN charged_days_overridden BOOLEAN NOT NULL DEFAULT FALSE'
                )
            )
        db.session.commit()
    except Exception:
        logger.exception('No se pudo asegurar store_license_account_refunds')
        raise


def _strict_charged_days(value: Any, total_days: int = 30) -> int:
    maximum = max(1, int(total_days or 30))
    if isinstance(value, bool):
        raise RefundError(f'charged_days debe ser un entero entre 0 y {maximum}.')
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise RefundError(f'charged_days debe ser un entero entre 0 y {maximum}.')
    if str(value).strip() != str(parsed) or parsed < 0 or parsed > maximum:
        raise RefundError(f'charged_days debe ser un entero entre 0 y {maximum}.')
    return parsed


def _money(value: Any, field_name: str) -> Decimal:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise RefundError(f'{field_name} debe ser un monto válido.')
    if not amount.is_finite() or amount < 0 or amount > Decimal('999999999999'):
        raise RefundError(f'{field_name} debe estar entre 0 y 999999999999.')
    return amount.quantize(_CENT, rounding=ROUND_HALF_UP)


def _clean_custom_message(value: Any) -> str:
    message = str(value or '').replace('\r\n', '\n').replace('\r', '\n').strip()
    if len(message) > 2000:
        raise RefundError('El mensaje al cliente no puede superar 2000 caracteres.')
    return message


def calculate_prorated_refund(
    unit_price: Any,
    charged_days: Any,
    total_days: int = 30,
) -> Decimal:
    """Calcula el importe de los días no usados sobre la vigencia de la licencia."""
    period_days = max(1, int(total_days or 30))
    days = _strict_charged_days(charged_days, period_days)
    try:
        unit = Decimal(str(unit_price))
    except (InvalidOperation, TypeError, ValueError):
        raise RefundError('unit_price debe ser un monto válido.')
    if not unit.is_finite() or unit < 0:
        raise RefundError('unit_price debe ser un monto válido.')
    return (
        unit * Decimal(period_days - days) / Decimal(period_days)
    ).quantize(_CENT, rounding=ROUND_HALF_UP)


def _refund_period(account: LicenseAccount, now_utc: datetime | None = None) -> dict[str, Any]:
    """Duración y días usados del periodo vigente, en fechas calendario de Colombia."""
    from app.store.license_term_utils import license_term_days_public
    from app.utils.timezone import utc_to_colombia

    license_row = getattr(account, 'license', None)
    total_days = max(1, int(license_term_days_public(license_row)))
    assigned_at = getattr(account, 'assigned_at', None)
    expires_at = getattr(account, 'expires_at', None)
    now_value = now_utc or datetime.utcnow()

    def _co_date(value: datetime):
        return utc_to_colombia(value).date()

    def _previous_calendar_month(value: datetime) -> datetime:
        year = value.year
        month = value.month - 1
        if month < 1:
            year -= 1
            month = 12
        return value.replace(
            year=year,
            month=month,
            day=min(value.day, monthrange(year, month)[1]),
        )

    adjusted_assigned_at = assigned_at
    if adjusted_assigned_at is not None and _co_date(adjusted_assigned_at) > _co_date(now_value):
        # Los blocs se organizan por día del mes y el sync puede sellar inicialmente
        # una fecha del mes actual que aún no ocurre; corresponde al mes anterior.
        adjusted_assigned_at = _previous_calendar_month(adjusted_assigned_at)

    period_start = adjusted_assigned_at
    if expires_at is not None:
        inferred_start = expires_at - timedelta(days=total_days)
        for _ in range(122):
            if _co_date(inferred_start) <= _co_date(now_value):
                break
            inferred_start -= timedelta(days=total_days)
        if period_start is None or inferred_start > period_start:
            period_start = inferred_start
    if period_start is None:
        detected_days = 0
    else:
        try:
            detected_days = (
                utc_to_colombia(now_value).date()
                - utc_to_colombia(period_start).date()
            ).days
        except (TypeError, ValueError, OSError, OverflowError):
            detected_days = (now_value.replace(tzinfo=None) - period_start.replace(tzinfo=None)).days
    detected_days = max(0, min(total_days, int(detected_days)))
    return {
        'total_days': total_days,
        'detected_charged_days': detected_days,
        'period_started_at': period_start,
    }


def _billing_user(user: User) -> User:
    if getattr(user, 'parent_id', None):
        parent = User.query.get(user.parent_id)
        if parent is not None:
            return parent
    return user


def _billing_currency(user: User) -> str | None:
    up = user.user_prices if isinstance(getattr(user, 'user_prices', None), dict) else {}
    currency = str(up.get('tipo_precio') or '').strip().upper()
    return currency if currency in ('USD', 'COP') else None


def _snapshot_contains_account(snapshot: SalePurchaseSnapshot, account: LicenseAccount) -> bool:
    try:
        rows = json.loads(snapshot.licencias_json or '[]')
    except (TypeError, json.JSONDecodeError):
        return False
    if not isinstance(rows, list):
        return False
    email = str(account.email or '').strip().lower()
    identifier = str(account.account_identifier or '').strip().lower()
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_email = str(row.get('email') or '').strip().lower()
        row_identifier = str(row.get('identifier') or '').strip().lower()
        if email and row_email == email:
            return True
        if identifier and row_identifier == identifier:
            return True
    return False


def _matching_snapshot(
    account: LicenseAccount,
    *,
    sale: Sale | None,
    billing_user: User,
) -> SalePurchaseSnapshot | None:
    if account.sale_id:
        direct = (
            SalePurchaseSnapshot.query.filter_by(sale_id=int(account.sale_id))
            .order_by(SalePurchaseSnapshot.id.desc())
            .first()
        )
        if direct is not None:
            return direct

    user_ids = {int(account.assigned_to_user_id), int(billing_user.id)}
    base_query = SalePurchaseSnapshot.query.filter(
        SalePurchaseSnapshot.user_id.in_(user_ids),
        SalePurchaseSnapshot.product_id == int(account.license.product_id),
    )
    query = base_query
    if account.assigned_at:
        query = query.filter(SalePurchaseSnapshot.sale_created_at <= account.assigned_at)
    for snapshot in query.order_by(
        SalePurchaseSnapshot.sale_created_at.desc(),
        SalePurchaseSnapshot.id.desc(),
    ).limit(80):
        if _snapshot_contains_account(snapshot, account):
            return snapshot
    # Tras purgar ventas, sale_id queda NULL y assigned_at puede haber cambiado por
    # renovaciones. Segunda pasada por credencial sin el límite temporal.
    for snapshot in base_query.order_by(
        SalePurchaseSnapshot.purged_from_sales.desc(),
        SalePurchaseSnapshot.sale_created_at.desc(),
        SalePurchaseSnapshot.id.desc(),
    ).limit(200):
        if _snapshot_contains_account(snapshot, account):
            return snapshot
    return None


def _manual_delivery_price(
    account: LicenseAccount,
    billing_user: User,
    *,
    persist: bool = False,
) -> dict[str, Any] | None:
    """Precio guardado al entregar manualmente, o catálogo actual si aún no está sellado."""
    try:
        stamped = Decimal(str(getattr(account, 'sold_unit_price', None)))
        stamped_cur = str(getattr(account, 'sold_currency', None) or '').strip().upper()
        if stamped.is_finite() and stamped > 0 and stamped_cur in ('USD', 'COP'):
            unit = stamped.quantize(_UNIT_SCALE, rounding=ROUND_HALF_UP)
            return {
                'available': True,
                'source': 'manual_delivery',
                'sale_id': None,
                'snapshot_id': None,
                'total': unit.quantize(_CENT, rounding=ROUND_HALF_UP),
                'quantity': 1,
                'unit_price': unit,
                'currency': stamped_cur,
            }
    except (InvalidOperation, TypeError, ValueError):
        pass

    try:
        from app.store.routes_licencias import (
            _bulk_license_sale_currency,
            _debt_increment_per_bulk_license_sale,
            _stamp_license_account_sold_price,
        )

        license_row = getattr(account, 'license', None)
        product = getattr(license_row, 'product', None) if license_row is not None else None
        unit_f = float(_debt_increment_per_bulk_license_sale(product, billing_user) or 0)
        currency = _bulk_license_sale_currency(product, billing_user)
        if unit_f <= 0 or currency not in ('USD', 'COP'):
            return None
        if persist:
            _stamp_license_account_sold_price(account, license_row, billing_user)
        unit = Decimal(str(unit_f)).quantize(_UNIT_SCALE, rounding=ROUND_HALF_UP)
        return {
            'available': True,
            'source': 'manual_delivery',
            'sale_id': None,
            'snapshot_id': None,
            'total': unit.quantize(_CENT, rounding=ROUND_HALF_UP),
            'quantity': 1,
            'unit_price': unit,
            'currency': currency,
        }
    except Exception:
        logger.exception('No se pudo resolver precio de entrega manual account_id=%s', account.id)
        return None


def _historical_price(
    account: LicenseAccount,
    billing_user: User,
    *,
    persist_manual: bool = False,
) -> dict[str, Any]:
    sale = Sale.query.get(account.sale_id) if account.sale_id else None
    snapshot = _matching_snapshot(account, sale=sale, billing_user=billing_user)

    total = getattr(sale, 'total_price', None) if sale is not None else None
    quantity = getattr(sale, 'quantity', None) if sale is not None else None
    currency = str(getattr(sale, 'currency', '') or '').strip().upper() if sale else ''
    source = 'sale' if sale is not None else None

    if snapshot is not None:
        if total is None:
            total = snapshot.total_price
        if not quantity:
            quantity = snapshot.quantity
        if currency not in ('USD', 'COP'):
            currency = str(snapshot.currency or '').strip().upper()
        if sale is None:
            source = 'sale_snapshot'

    try:
        total_d = Decimal(str(total))
        quantity_i = int(quantity)
    except (InvalidOperation, TypeError, ValueError):
        total_d = Decimal('0')
        quantity_i = 0
    complete = (
        source is not None
        and total_d.is_finite()
        and total_d >= 0
        and quantity_i > 0
        and currency in ('USD', 'COP')
    )
    unit = (
        (total_d / Decimal(quantity_i)).quantize(_UNIT_SCALE, rounding=ROUND_HALF_UP)
        if complete
        else None
    )
    if complete:
        return {
            'available': True,
            'source': source,
            'sale_id': int(sale.id) if sale is not None else (
                int(snapshot.sale_id) if snapshot is not None and snapshot.sale_id else None
            ),
            'snapshot_id': int(snapshot.id) if snapshot is not None else None,
            'total': total_d.quantize(_CENT, rounding=ROUND_HALF_UP),
            'quantity': quantity_i,
            'unit_price': unit,
            'currency': currency,
        }

    manual = _manual_delivery_price(account, billing_user, persist=persist_manual)
    if manual is not None:
        return manual

    return {
        'available': False,
        'source': None,
        'sale_id': None,
        'snapshot_id': None,
        'total': None,
        'quantity': None,
        'unit_price': None,
        'currency': None,
    }


def _account_credential(account: LicenseAccount) -> str:
    identity = str(account.email or '').strip() or str(account.account_identifier or '').strip()
    password = str(account.password or '').replace('\r', ' ').replace('\n', ' ').strip()
    return f'{identity} {password}'.strip()


def build_refund_preview(account_id: int, charged_days: Any = None) -> dict[str, Any]:
    ensure_license_account_refund_schema()
    account = LicenseAccount.query.get(int(account_id))
    if account is None:
        raise RefundError('Cuenta de licencia no encontrada.', 404, 'not_found')
    if account.assigned_to_user_id is None:
        raise RefundError('La cuenta no tiene un usuario asignado.', 409, 'account_unassigned')
    user = User.query.get(account.assigned_to_user_id)
    if user is None:
        raise RefundError('El usuario asignado ya no existe.', 409, 'user_not_found')
    billing = _billing_user(user)
    existing = LicenseAccountRefund.query.filter_by(license_account_id=account.id).first()
    historical = _historical_price(account, billing)
    period = _refund_period(account)
    total_days = period['total_days']
    detected_days = period['detected_charged_days']
    use_detected = charged_days in (None, '', 'auto')
    days = detected_days if use_detected else _strict_charged_days(charged_days, total_days)
    returned_days = total_days - days
    refund_amount = None
    if historical['available']:
        refund_amount = calculate_prorated_refund(
            historical['unit_price'],
            days,
            total_days,
        )
    manual_currency = _billing_currency(billing)
    status = str(account.status or '').strip().lower()
    return {
        'success': True,
        'account_id': int(account.id),
        'license_id': int(account.license_id),
        'user_id': int(user.id),
        'billing_user_id': int(billing.id),
        'account_status': status,
        'already_refunded': existing is not None,
        'refund_id': int(existing.id) if existing is not None else None,
        'can_execute': existing is None and status in _VALID_ACCOUNT_STATUSES,
        'billing_period_days': total_days,
        'detected_charged_days': detected_days,
        'charged_days_overridden': days != detected_days,
        'personalized_days_available': total_days > 30,
        'period_started_at': (
            period['period_started_at'].isoformat()
            if period['period_started_at'] is not None
            else None
        ),
        'charged_days': days,
        'returned_days': returned_days,
        'pricing_source': historical['source'],
        'historical_price_available': bool(historical['available']),
        'manual_amount_required': not historical['available'],
        'currency': historical['currency'] if historical['available'] else manual_currency,
        'billing_currency_available': manual_currency is not None,
        'historical_total': float(historical['total']) if historical['total'] is not None else None,
        'historical_quantity': historical['quantity'],
        'historical_unit_price': (
            float(historical['unit_price']) if historical['unit_price'] is not None else None
        ),
        'refund_amount': float(refund_amount) if refund_amount is not None else None,
        'sale_id': historical['sale_id'],
        'sale_snapshot_id': historical['snapshot_id'],
    }


def _remove_account_from_day(account: LicenseAccount) -> tuple[int | None, str | None]:
    from app.store.routes_licencias import (
        _BLOC_WS,
        _inventory_tuple_from_license_notes_line,
        _normalize_inventory_fingerprint,
        _product_name_is_netflix,
    )

    license_row = account.license
    try:
        day_map = json.loads(license_row.day_notepads_json or '{}')
    except (TypeError, json.JSONDecodeError):
        day_map = {}
    if not isinstance(day_map, dict):
        return None, None

    product_name = license_row.product.name if license_row.product is not None else ''
    is_netflix = _product_name_is_netflix(product_name)
    wanted = _normalize_inventory_fingerprint(
        account.email, account.password, account.account_identifier
    )
    preferred = []
    if account.assigned_at:
        try:
            from app.utils.timezone import utc_to_colombia

            preferred.append(int(utc_to_colombia(account.assigned_at).day))
        except (TypeError, ValueError, OSError, OverflowError):
            pass
    day_order = preferred + [day for day in range(1, 32) if day not in preferred]
    for day in day_order:
        key = str(day)
        raw = str(day_map.get(key) or '').strip(_BLOC_WS)
        if not raw:
            continue
        lines = [line for line in raw.replace('\r\n', '\n').split('\n') if line.strip()]
        kept = []
        removed = None
        for line in lines:
            if removed is None:
                parsed = _inventory_tuple_from_license_notes_line(
                    line, license_row.id, is_netflix
                )
                if parsed and _normalize_inventory_fingerprint(*parsed) == wanted:
                    removed = line
                    continue
            kept.append(line)
        if removed is None:
            continue
        if kept:
            day_map[key] = '\n'.join(kept).strip(_BLOC_WS)
        else:
            day_map.pop(key, None)
        license_row.day_notepads_json = (
            json.dumps(day_map, ensure_ascii=False) if day_map else None
        )
        return day, removed
    return None, None


def _append_suspended_refund_note(
    account: LicenseAccount,
    *,
    removed_line: str | None,
    charged_days: int,
    returned_days: int,
    amount: Decimal,
    currency: str,
) -> str:
    from app.store.routes_licencias import _append_license_suspended_notes_line
    from app.store.user_license_line_parse import LICENSE_LINE_FIELD_SEP

    username = account.assigned_user.username if account.assigned_user else 'anonimo'
    note = (
        f'devolución parcial: {charged_days} días cobrados, {returned_days} días devueltos, '
        f'{amount:.2f} {currency} acreditados'
    )
    if removed_line:
        parts = str(removed_line).split(LICENSE_LINE_FIELD_SEP)
        while len(parts) < 5:
            parts.append('')
        parts[3] = 'devolución'
        parts[4] = note
        line = LICENSE_LINE_FIELD_SEP.join(parts[:5])
    else:
        line = LICENSE_LINE_FIELD_SEP.join(
            [_account_credential(account), username, '', 'devolución', note]
        )
    _append_license_suspended_notes_line(account.license, line)
    return note


def _add_refund_notification(
    user: User,
    account: LicenseAccount,
    *,
    amount: Decimal,
    currency: str,
    returned_days: int,
    custom_message: str,
) -> None:
    product_name = (
        account.license.product.name
        if account.license is not None and account.license.product is not None
        else 'Producto'
    )
    body = (
        f'Se procesó la devolución de «{product_name}»: '
        f'{amount:.2f} {currency} acreditados por {returned_days} día(s) devuelto(s).'
    )
    if custom_message:
        body = f'{body}\n\n{custom_message}'
    db.session.add(
        StoreUserNotification(
            user_id=int(user.id),
            kind='license_partial_refund',
            title='Devolución de licencia procesada',
            body=body,
            payload_json=json.dumps(
                {
                    'account_id': int(account.id),
                    'license_id': int(account.license_id),
                    'amount': float(amount),
                    'currency': currency,
                    'returned_days': returned_days,
                    'url': '/tienda/licencias',
                },
                ensure_ascii=False,
            ),
        )
    )


def _send_refund_email_best_effort(refund_id: int) -> bool:
    refund = LicenseAccountRefund.query.get(int(refund_id))
    if refund is None:
        return False
    user = User.query.get(refund.user_id)
    if user is None:
        return False
    from app.store.email_notify_prefs import user_receives_email_notifications

    if not user_receives_email_notifications(user):
        return False
    to_email = str(getattr(user, 'email', '') or '').strip()
    if not to_email:
        return False
    from app.services.email_service import (
        email_recipient_display_name,
        render_transactional_email_html,
        send_transactional_email,
    )

    name = email_recipient_display_name(user)
    amount = Decimal(str(refund.refund_amount or 0)).quantize(_CENT)
    paragraphs = [
        (
            f'Procesamos una devolución de licencia por {amount:.2f} {refund.currency}. '
            f'Se devolvieron {refund.returned_days} día(s) y se cobraron '
            f'{refund.charged_days} día(s).'
        ),
        'El crédito se aplicó primero a cualquier deuda pendiente y el remanente quedó como saldo.',
    ]
    if refund.custom_message:
        paragraphs.append(f'Mensaje del equipo: {refund.custom_message}')
    greeting = f'Hola {name},' if name else 'Hola,'
    body_text = '\n\n'.join([greeting, *paragraphs, 'Tu Premium — mensaje automático.'])
    html = None
    try:
        html = render_transactional_email_html(
            'Devolución de licencia',
            name,
            paragraphs,
            include_store_link=False,
        )
    except Exception as exc:
        current_app.logger.warning('Plantilla email devolución licencia: %s', exc)
    return bool(
        send_transactional_email(
            to_email=to_email,
            subject='Devolución de licencia procesada — Tu Premium',
            body_text=body_text,
            body_html=html,
        )
    )


def execute_refund(
    account_id: int,
    *,
    charged_days: Any,
    manual_refund_amount: Any,
    manual_unit_price: Any,
    custom_message: Any,
    actor_admin_user_id: int,
) -> dict[str, Any]:
    ensure_license_account_refund_schema()
    message = _clean_custom_message(custom_message)
    try:
        account = (
            LicenseAccount.query.filter_by(id=int(account_id))
            .with_for_update()
            .first()
        )
        if account is None:
            raise RefundError('Cuenta de licencia no encontrada.', 404, 'not_found')
        existing = LicenseAccountRefund.query.filter_by(
            license_account_id=account.id
        ).first()
        if existing is not None:
            raise RefundError(
                'Esta cuenta ya tiene una devolución registrada.',
                409,
                'already_refunded',
            )
        status = str(account.status or '').strip().lower()
        if status not in _VALID_ACCOUNT_STATUSES:
            raise RefundError(
                'Solo se pueden devolver cuentas vendidas o asignadas.',
                409,
                'invalid_account_status',
            )
        if account.assigned_to_user_id is None:
            raise RefundError('La cuenta no tiene usuario asignado.', 409, 'account_unassigned')
        user = User.query.get(account.assigned_to_user_id)
        if user is None:
            raise RefundError('El usuario asignado ya no existe.', 409, 'user_not_found')
        billing = _billing_user(user)
        period = _refund_period(account)
        total_days = period['total_days']
        detected_days = period['detected_charged_days']
        days = _strict_charged_days(charged_days, total_days)
        returned_days = total_days - days
        days_overridden = days != detected_days
        historical = _historical_price(account, billing, persist_manual=True)
        manual_price_raw = (
            manual_unit_price
            if manual_unit_price not in (None, '')
            else manual_refund_amount
        )
        if manual_price_raw not in (None, ''):
            effective_unit_price = _money(manual_price_raw, 'manual_unit_price')
            if effective_unit_price <= 0:
                raise RefundError('manual_unit_price debe ser mayor que cero.')
            currency = historical['currency'] if historical['available'] else _billing_currency(billing)
            if currency is None:
                raise RefundError(
                    'El usuario no tiene moneda de facturación USD/COP configurada.',
                    409,
                    'billing_currency_missing',
                )
            amount = calculate_prorated_refund(
                effective_unit_price,
                days,
                total_days,
            )
            pricing_source = (
                'manual_override' if historical['available'] else 'manual'
            )
        else:
            if not historical['available']:
                raise RefundError(
                    'manual_unit_price es requerido porque no hay precio histórico.',
                    400,
                    'manual_amount_required',
                )
            effective_unit_price = historical['unit_price']
            amount = calculate_prorated_refund(
                effective_unit_price,
                days,
                total_days,
            )
            currency = historical['currency']
            pricing_source = historical['source']

        refund = LicenseAccountRefund(
            license_account_id=int(account.id),
            license_id=int(account.license_id),
            sale_id=historical['sale_id'],
            sale_snapshot_id=historical['snapshot_id'],
            user_id=int(user.id),
            billing_user_id=int(billing.id),
            actor_admin_user_id=int(actor_admin_user_id),
            billing_period_days=total_days,
            detected_charged_days=detected_days,
            charged_days=days,
            charged_days_overridden=days_overridden,
            returned_days=returned_days,
            historical_quantity=(1 if pricing_source.startswith('manual') else historical['quantity']),
            historical_total=(
                effective_unit_price.quantize(_CENT, rounding=ROUND_HALF_UP)
                if pricing_source.startswith('manual')
                else historical['total']
            ),
            historical_unit_price=effective_unit_price,
            refund_amount=amount,
            debt_applied=Decimal('0'),
            prepaid_applied=Decimal('0'),
            currency=currency,
            pricing_source=pricing_source,
            product_name=(
                str(account.license.product.name or '').strip()
                if account.license is not None and account.license.product is not None
                else 'Licencia'
            ),
            custom_message=message or None,
            audit_note='pendiente',
        )
        db.session.add(refund)
        db.session.flush()

        day_removed, removed_line = _remove_account_from_day(account)
        audit_note = _append_suspended_refund_note(
            account,
            removed_line=removed_line,
            charged_days=days,
            returned_days=returned_days,
            amount=amount,
            currency=currency,
        )
        if days_overridden:
            audit_note = (
                f'{audit_note}; ajuste manual: sistema detectó {detected_days} '
                f'días cobrados y el administrador registró {days}'
            )
        if pricing_source.startswith('manual'):
            account.sold_unit_price = effective_unit_price
            account.sold_currency = currency
        account.status = 'refunded'
        account.renewal_reserved_user_id = None
        account.renewal_reserved_at = None
        account.updated_at = datetime.utcnow()
        refund.day_removed = day_removed
        refund.removed_day_line = removed_line
        refund.audit_note = audit_note

        from app.store.balance_recharge_credit import apply_user_balance_credit

        debt_before = Decimal(str(getattr(billing, 'saldo', 0) or 0))
        prepaid_field = 'saldo_usd' if currency == 'USD' else 'saldo_cop'
        prepaid_before = Decimal(str(getattr(billing, prepaid_field, 0) or 0))
        apply_user_balance_credit(
            billing,
            currency,
            float(amount),
            source='license_refund',
        )
        debt_after = Decimal(str(getattr(billing, 'saldo', 0) or 0))
        prepaid_after = Decimal(str(getattr(billing, prepaid_field, 0) or 0))
        refund.debt_applied = max(Decimal('0'), debt_before - debt_after).quantize(_CENT)
        refund.prepaid_applied = max(
            Decimal('0'),
            prepaid_after - prepaid_before,
        ).quantize(_CENT)
        _add_refund_notification(
            user,
            account,
            amount=amount,
            currency=currency,
            returned_days=returned_days,
            custom_message=message,
        )
        from app.store.user_license_activity import append_portal_license_activity_record

        product_name = (
            account.license.product.name
            if account.license is not None and account.license.product is not None
            else 'Producto'
        )
        append_portal_license_activity_record(
            billing,
            'devolucion_licencia',
            f'{product_name} · devolución de licencia ({amount:.2f} {currency})',
            detail=(
                f'{days} días cobrados; {returned_days} días devueltos de '
                f'{total_days} días. '
                + (
                    f'El sistema detectó {detected_days} días y el administrador '
                    f'los ajustó manualmente a {days}. '
                    if days_overridden
                    else 'Los días cobrados fueron detectados automáticamente. '
                )
                +
                'Crédito aplicado primero a deuda y luego a prepago.'
            ),
            extra={
                'license_id': account.license_id,
                'account_id': account.id,
                'product_name': product_name,
                'billing_period_days': total_days,
                'detected_charged_days': detected_days,
                'charged_days': days,
                'charged_days_overridden': days_overridden,
                'actor_admin_user_id': int(actor_admin_user_id),
            },
        )
        db.session.commit()
    except RefundError:
        db.session.rollback()
        raise
    except IntegrityError:
        db.session.rollback()
        raise RefundError(
            'Esta cuenta ya fue devuelta por otra solicitud concurrente.',
            409,
            'already_refunded',
        )
    except Exception:
        db.session.rollback()
        raise

    try:
        from app.store.balance_recharge_events import notify_balance_recharge_updated

        notify_balance_recharge_updated(
            int(billing.id),
            reason='license_partial_refund',
        )
    except Exception as exc:
        current_app.logger.warning('SSE devolución licencia: %s', exc)
    email_sent = False
    try:
        email_sent = _send_refund_email_best_effort(int(refund.id))
    except Exception as exc:
        current_app.logger.warning('Email devolución licencia: %s', exc)

    return {
        'success': True,
        'refund_id': int(refund.id),
        'account_id': int(account.id),
        'license_id': int(account.license_id),
        'user_id': int(user.id),
        'billing_user_id': int(billing.id),
        'billing_period_days': total_days,
        'detected_charged_days': detected_days,
        'charged_days': days,
        'charged_days_overridden': days_overridden,
        'returned_days': returned_days,
        'refund_amount': float(amount),
        'debt_applied': float(refund.debt_applied or 0),
        'prepaid_applied': float(refund.prepaid_applied or 0),
        'currency': currency,
        'pricing_source': pricing_source,
        'sale_id': historical['sale_id'],
        'sale_snapshot_id': historical['snapshot_id'],
        'day_removed': day_removed,
        'day_notepad': (
            json.loads(account.license.day_notepads_json or '{}').get(str(day_removed), '')
            if day_removed is not None
            else None
        ),
        'license_notes': account.license.license_notes or '',
        'suspended_notes': account.license.suspended_notes or '',
        'account_status': 'refunded',
        'email_sent': bool(email_sent),
    }
