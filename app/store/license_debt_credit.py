# -*- coding: utf-8 -*-
"""Abonos a deuda de licencias: primero ``users.saldo``, luego prepago negativo (FIFO por cuenta)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy import func as sa_func
from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from app.extensions import db


def _prepaid_field_for_user(user) -> str:
    up = user.user_prices if isinstance(getattr(user, 'user_prices', None), dict) else {}
    tipo = str(up.get('tipo_precio') or 'COP').strip().upper()
    return 'saldo_usd' if tipo == 'USD' else 'saldo_cop'


def _currency_for_user(user) -> str:
    return 'USD' if _prepaid_field_for_user(user) == 'saldo_usd' else 'COP'


def _billing_accounts_for_user(billing_user) -> List[Any]:
    from app.models.user import User
    from app.store.models import License, LicenseAccount
    from app.store.routes_licencias import _dedupe_drift_license_accounts

    if not billing_user or not getattr(billing_user, 'id', None):
        return []
    principal_id = int(billing_user.id)
    child_ids = [
        int(u.id)
        for u in User.query.filter_by(parent_id=principal_id).all()
        if getattr(u, 'id', None) is not None
    ]
    assignee_ids = [principal_id] + child_ids
    accts = (
        LicenseAccount.query.options(
            joinedload(LicenseAccount.license).joinedload(License.product),
        )
        .filter(LicenseAccount.assigned_to_user_id.in_(assignee_ids))
        .filter(
            or_(
                sa_func.lower(sa_func.coalesce(LicenseAccount.status, '')).in_(
                    ('assigned', 'sold')
                ),
                LicenseAccount.status.is_(None),
            )
        )
        .order_by(LicenseAccount.id.asc())
        .all()
    )
    return _dedupe_drift_license_accounts(accts)


def _dues_snapshot(billing_user) -> Dict[int, float]:
    from app.store.routes_licencias import _license_account_debt_allocation

    return _license_account_debt_allocation(billing_user, _billing_accounts_for_user(billing_user))


def _log_accounts_newly_paid(
    billing_user,
    before: Dict[int, float],
    after: Dict[int, float],
    *,
    source: str,
    amount_applied: float,
    currency: str,
) -> None:
    from app.store.models import LicenseAccount
    from app.store.user_license_activity import (
        _account_display_email,
        append_portal_license_activity_record,
    )

    newly_paid_ids = []
    for acc_id, due_before in (before or {}).items():
        try:
            db_id = int(acc_id)
        except (TypeError, ValueError):
            continue
        try:
            due_b = float(due_before or 0)
        except (TypeError, ValueError):
            due_b = 0.0
        if due_b <= 1e-9:
            continue
        due_a = float((after or {}).get(db_id, due_b) or 0)
        if due_a > 1e-9:
            continue
        newly_paid_ids.append(db_id)

    if not newly_paid_ids:
        return

    tipo = 'abono_admin' if source == 'admin' else 'abono_recarga'
    source_label = (
        'abono del admin' if source == 'admin' else 'recarga / abono de saldo'
    )
    amt_txt = (
        str(int(round(amount_applied)))
        if abs(amount_applied - round(amount_applied)) < 1e-9
        else str(round(amount_applied, 2))
    )
    cur = (currency or 'COP').strip().upper() or 'COP'

    from app.store.models import License

    rows = (
        LicenseAccount.query.options(
            joinedload(LicenseAccount.license).joinedload(License.product)
        )
        .filter(LicenseAccount.id.in_(newly_paid_ids))
        .all()
    )
    by_id = {int(a.id): a for a in rows}
    for acc_id in newly_paid_ids:
        acc = by_id.get(acc_id)
        if not acc:
            continue
        lic = getattr(acc, 'license', None)
        pname = (
            lic.product.name
            if lic and getattr(lic, 'product', None)
            else 'Producto'
        )
        email = _account_display_email(acc) or str(
            getattr(acc, 'account_identifier', '') or ''
        ).strip()
        contact = email or 'cuenta'
        summary = f'{pname} · {contact} — Pagada por {source_label} ({amt_txt} {cur})'
        append_portal_license_activity_record(
            billing_user,
            tipo,
            summary,
            detail=None,
            extra={
                'account_id': acc_id,
                'license_id': getattr(acc, 'license_id', None),
                'cred_hint': contact[:140],
            },
        )


def apply_positive_credit_against_license_debts(
    user,
    amount: float,
    *,
    source: str = 'admin',
    currency: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Aplica un abono positivo al cliente principal:

    1. Reduce ``users.saldo`` (deuda de licencias).
    2. Si el prepago está en negativo, lo acerca a 0.
    3. El remanente se acredita al prepago (``saldo_cop`` / ``saldo_usd``).

    Las cuentas que pasan de «Debe» a «Pagada» (FIFO, más antigua primero) se
    registran en el historial del portal. El caller hace ``commit``.
    """
    from app.models.user import User

    result = {
        'applied_to_license_saldo': 0.0,
        'applied_to_prepaid_debt': 0.0,
        'credited_to_prepaid': 0.0,
        'currency': 'COP',
        'new_license_saldo': 0.0,
        'new_prepaid': 0.0,
    }
    try:
        amt = float(amount)
    except (TypeError, ValueError):
        return result
    if not user or amt <= 1e-12:
        return result

    billing = user
    if getattr(user, 'parent_id', None):
        parent = User.query.get(user.parent_id)
        if parent:
            billing = parent

    cur = (currency or _currency_for_user(billing)).strip().upper()
    if cur not in ('USD', 'COP'):
        cur = _currency_for_user(billing)
    field = 'saldo_usd' if cur == 'USD' else 'saldo_cop'
    result['currency'] = cur

    before_dues = _dues_snapshot(billing)
    remaining = amt

    try:
        lic_debt = float(getattr(billing, 'saldo', 0) or 0)
    except (TypeError, ValueError):
        lic_debt = 0.0
    if lic_debt > 1e-9 and remaining > 1e-12:
        pay = min(lic_debt, remaining)
        billing.saldo = lic_debt - pay
        remaining -= pay
        result['applied_to_license_saldo'] = round(pay, 2)

    try:
        prepaid = float(getattr(billing, field, 0) or 0)
    except (TypeError, ValueError):
        prepaid = 0.0
    if prepaid < -1e-9 and remaining > 1e-12:
        debt = -prepaid
        pay = min(debt, remaining)
        prepaid = prepaid + pay
        remaining -= pay
        result['applied_to_prepaid_debt'] = round(pay, 2)

    if remaining > 1e-12:
        prepaid = prepaid + remaining
        result['credited_to_prepaid'] = round(remaining, 2)
        remaining = 0.0

    setattr(billing, field, prepaid)
    try:
        result['new_license_saldo'] = float(getattr(billing, 'saldo', 0) or 0)
    except (TypeError, ValueError):
        result['new_license_saldo'] = 0.0
    result['new_prepaid'] = float(prepaid)

    # Flush para que el reparto FIFO lea el saldo ya actualizado en la misma sesión.
    db.session.flush()
    after_dues = _dues_snapshot(billing)
    applied_for_log = (
        float(result['applied_to_license_saldo'])
        + float(result['applied_to_prepaid_debt'])
        + float(result['credited_to_prepaid'])
    )
    try:
        _log_accounts_newly_paid(
            billing,
            before_dues,
            after_dues,
            source=source,
            amount_applied=applied_for_log,
            currency=cur,
        )
    except Exception:
        # No bloquear el abono si falla el historial.
        pass
    return result


def reduce_license_account_saldo_with_fifo_log(
    user,
    reduce_by: float,
    *,
    source: str = 'admin',
) -> Dict[str, Any]:
    """
    Baja ``users.saldo`` (sin tocar prepago) y registra cuentas que quedan Pagada.
    ``reduce_by`` debe ser > 0 (importe a restar de la deuda).
    """
    result = {
        'reduced': 0.0,
        'previous_saldo': 0.0,
        'new_saldo': 0.0,
    }
    try:
        amt = float(reduce_by)
    except (TypeError, ValueError):
        return result
    if not user or amt <= 1e-12:
        return result

    from app.models.user import User

    billing = user
    if getattr(user, 'parent_id', None):
        parent = User.query.get(user.parent_id)
        if parent:
            billing = parent

    try:
        prev = float(getattr(billing, 'saldo', 0) or 0)
    except (TypeError, ValueError):
        prev = 0.0
    result['previous_saldo'] = prev
    if prev <= 1e-9:
        result['new_saldo'] = prev
        return result

    pay = min(prev, amt)
    before_dues = _dues_snapshot(billing)
    billing.saldo = prev - pay
    result['reduced'] = round(pay, 2)
    result['new_saldo'] = float(billing.saldo or 0)
    db.session.flush()
    after_dues = _dues_snapshot(billing)
    try:
        _log_accounts_newly_paid(
            billing,
            before_dues,
            after_dues,
            source=source,
            amount_applied=pay,
            currency=_currency_for_user(billing),
        )
    except Exception:
        pass
    return result
