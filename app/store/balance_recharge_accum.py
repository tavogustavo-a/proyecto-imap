# Acumulador de recargas: saldos pendientes de conversión manual.

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple

from app.extensions import db
from app.store.balance_recharge_payment import (
    accum_conversion_multipliers,
    currency_display_name,
    get_accumulator_method,
    is_accumulator_method_id,
    method_label_by_id_any,
)
from app.store.models import BalanceRecharge, User

ACCUMULATED_STATUS = 'accumulated'
AUTO_ACCUMULATED_STATUS = 'auto_accumulated'
CONVERTED_STATUS = 'accum_converted'
USER_ACCUM_DISPLAY_STATUSES = (ACCUMULATED_STATUS, AUTO_ACCUMULATED_STATUS)

_normalize_unreviewed_accumulations_done = False


def normalize_unreviewed_accumulations(*, force: bool = False) -> int:
    """Repara datos legacy: accumulated sin reviewed_at vuelve a pending.

    Solo debe ejecutarse al arranque (o con force=True). No llamar en listados GET.
    """
    global _normalize_unreviewed_accumulations_done
    if _normalize_unreviewed_accumulations_done and not force:
        return 0

    rows = (
        BalanceRecharge.query.filter_by(status=ACCUMULATED_STATUS)
        .filter(BalanceRecharge.reviewed_at.is_(None))
        .all()
    )
    changed = 0
    for row in rows:
        if not is_accumulator_method_id(row.payment_method_id or ''):
            continue
        row.status = 'pending'
        changed += 1
    if changed:
        db.session.commit()
    _normalize_unreviewed_accumulations_done = True
    return changed


def _fmt_balance_amount(n: float) -> str:
    if abs(n - round(n)) < 1e-9:
        return str(int(round(n)))
    s = f'{n:.2f}'.replace('.00', '').rstrip('0').rstrip('.')
    return s or '0'


def user_accumulated_totals_by_currency(user_id: int) -> Dict[str, float]:
    """Suma acumulado confirmado y provisional (auto_accumulated), por moneda del pago."""
    rows = (
        BalanceRecharge.query.filter(
            BalanceRecharge.user_id == int(user_id),
            BalanceRecharge.status.in_(USER_ACCUM_DISPLAY_STATUSES),
        ).all()
    )
    totals: Dict[str, float] = {}
    for row in rows:
        if not is_accumulator_method_id(row.payment_method_id or ''):
            continue
        cur = (row.currency or 'COP').strip().upper()
        if cur == 'USDT':
            cur = 'USD'
        if cur not in ('COP', 'USD'):
            cur = 'COP'
        amt = float(row.amount_claimed or 0)
        if amt <= 0:
            continue
        totals[cur] = totals.get(cur, 0.0) + amt
    return totals


def build_user_accumulated_display(user_id: int) -> Dict[str, Any]:
    totals = user_accumulated_totals_by_currency(user_id)
    if not totals:
        return {'show': False, 'line': None, 'totals': {}}
    parts: List[str] = []
    for cur in ('USD', 'COP'):
        amt = totals.get(cur) or 0
        if amt > 0:
            parts.append('$%s %s' % (_fmt_balance_amount(amt), currency_display_name(cur)))
    if not parts:
        return {'show': False, 'line': None, 'totals': {}}
    line = 'Acumulado ' + ' · '.join(parts)
    return {'show': True, 'line': line, 'totals': totals}


def _quantize_amount(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _target_currency_for_user(user_row) -> str:
    from app.store.routes import catalog_products_for_store_user

    _, tipo_precio = catalog_products_for_store_user(user_row)
    tp = (tipo_precio or 'COP').strip().upper()
    return tp if tp in ('COP', 'USD') else 'COP'


def compute_conversion_amounts(
    total_source: float,
    source_currency: str,
    target_currency: str,
    mult_usd_to_cop: Optional[float],
    mult_cop_to_usd: Optional[float],
) -> Tuple[float, str, Optional[float]]:
    """Calcula monto a acreditar multiplicando según la dirección de conversión."""
    source = (source_currency or 'COP').strip().upper()
    target = (target_currency or 'COP').strip().upper()
    amount = float(total_source)

    if source == target:
        return round(amount, 2), target, None

    if source == 'USD' and target == 'COP':
        mult = float(mult_usd_to_cop or 0)
        if mult <= 0:
            raise ValueError('Configura el multiplicador USDT→COP (ej. 3650).')
        return round(amount * mult, 2), 'COP', mult

    if source == 'COP' and target == 'USD':
        mult = float(mult_cop_to_usd or 0)
        if mult <= 0:
            raise ValueError('Configura el multiplicador COP→USDT (ej. 0.00026).')
        return round(amount * mult, 2), 'USD', mult

    raise ValueError('Conversión de moneda no soportada para este medio.')


def list_accumulated_summary() -> List[Dict[str, Any]]:
    """Totales acumulados agrupados por usuario y medio de pago."""
    rows = (
        BalanceRecharge.query.filter_by(status=ACCUMULATED_STATUS)
        .order_by(BalanceRecharge.user_id.asc(), BalanceRecharge.payment_method_id.asc())
        .all()
    )
    buckets: Dict[tuple, Dict[str, Any]] = {}
    user_ids = set()

    def _bucket_for(row):
        pm_id = (row.payment_method_id or '').strip()
        if not pm_id or not is_accumulator_method_id(pm_id):
            return None
        key = (int(row.user_id), pm_id)
        user_ids.add(int(row.user_id))
        if key not in buckets:
            buckets[key] = {
                'user_id': int(row.user_id),
                'payment_method_id': pm_id,
                'payment_currency': (row.currency or 'COP').strip().upper(),
                'total': 0.0,
                'count': 0,
                'pending_auto_total': 0.0,
                'pending_auto_count': 0,
            }
        return buckets[key]

    for row in rows:
        bucket = _bucket_for(row)
        if bucket is None:
            continue
        bucket['total'] += float(row.amount_claimed or 0)
        bucket['count'] += 1

    # Provisionales (auto_accumulated sin verificar): el usuario ya los ve en su
    # total «Acumulado»; el admin debe verlos también para no descuadrar cuentas.
    auto_rows = (
        BalanceRecharge.query.filter(
            BalanceRecharge.status == 'auto_accumulated',
            BalanceRecharge.admin_verified.is_(None),
        )
        .order_by(BalanceRecharge.user_id.asc(), BalanceRecharge.payment_method_id.asc())
        .all()
    )
    for row in auto_rows:
        bucket = _bucket_for(row)
        if bucket is None:
            continue
        bucket['pending_auto_total'] += float(row.amount_claimed or 0)
        bucket['pending_auto_count'] += 1

    users_map = {}
    if user_ids:
        for u in User.query.filter(User.id.in_(user_ids)).all():
            users_map[int(u.id)] = u.username

    out: List[Dict[str, Any]] = []
    for item in buckets.values():
        pm_id = item['payment_method_id']
        method = get_accumulator_method(pm_id) or {}
        mults = accum_conversion_multipliers(method)
        user = User.query.get(item['user_id'])
        target = _target_currency_for_user(user) if user else 'COP'
        source = (method.get('payment_currency') or item['payment_currency'] or 'COP').upper()
        preview_credit = None
        preview_error = None
        preview_mult = None
        try:
            preview_credit, preview_currency, preview_mult = compute_conversion_amounts(
                item['total'],
                source,
                target,
                mults.get('mult_usd_to_cop'),
                mults.get('mult_cop_to_usd'),
            )
        except ValueError as exc:
            preview_error = str(exc)
            preview_currency = target

        conversion_label = f'{currency_display_name(source)} → {currency_display_name(target)}'

        out.append(
            {
                'user_id': item['user_id'],
                'username': users_map.get(item['user_id'], '—'),
                'payment_method_id': pm_id,
                'payment_method_label': method.get('label') or method_label_by_id_any(pm_id),
                'payment_currency': source,
                'payment_currency_label': currency_display_name(source),
                'target_currency': target,
                'target_currency_label': currency_display_name(target),
                'conversion_label': conversion_label,
                'total_accumulated': round(item['total'], 2),
                'recharge_count': item['count'],
                'pending_auto_total': round(item.get('pending_auto_total') or 0.0, 2),
                'pending_auto_count': int(item.get('pending_auto_count') or 0),
                'mult_usd_to_cop': mults.get('mult_usd_to_cop'),
                'mult_cop_to_usd': mults.get('mult_cop_to_usd'),
                'preview_credit': preview_credit,
                'preview_credit_currency': preview_currency,
                'preview_multiplier': preview_mult,
                'preview_error': preview_error,
            }
        )

    out.sort(key=lambda x: (x.get('username') or '', x.get('payment_method_label') or ''))
    return out


def convert_accumulation(user_id: int, payment_method_id: str, admin_user_id: Optional[int] = None) -> Dict[str, Any]:
    """Convierte saldo acumulado y acredita al usuario (filas bloqueadas con FOR UPDATE)."""
    from app.store.balance_recharge_credit import apply_user_balance_credit

    pm_id = (payment_method_id or '').strip()
    method = get_accumulator_method(pm_id)
    if not method:
        raise ValueError('Medio acumulador no encontrado.')

    uid = int(user_id)
    target_user = User.query.filter_by(id=uid).with_for_update().first()
    if not target_user:
        raise ValueError('Usuario no encontrado.')

    rows = (
        BalanceRecharge.query.filter(
            BalanceRecharge.user_id == uid,
            BalanceRecharge.payment_method_id == pm_id,
            BalanceRecharge.status == ACCUMULATED_STATUS,
        )
        .order_by(BalanceRecharge.created_at.asc())
        .with_for_update()
        .all()
    )
    if not rows:
        raise ValueError('No hay saldo acumulado para convertir (ya convertido o en proceso).')

    total_source = sum(float(r.amount_claimed or 0) for r in rows)
    if total_source <= 0:
        raise ValueError('El total acumulado debe ser mayor que cero.')

    mults = accum_conversion_multipliers(method)
    source = (method.get('payment_currency') or rows[0].currency or 'COP').strip().upper()
    target = _target_currency_for_user(target_user)
    credit_amount, credit_currency, applied_mult = compute_conversion_amounts(
        total_source,
        source,
        target,
        mults.get('mult_usd_to_cop'),
        mults.get('mult_cop_to_usd'),
    )
    if credit_amount <= 0:
        raise ValueError('El monto convertido resulta en cero.')

    apply_user_balance_credit(target_user, credit_currency, credit_amount)

    now = datetime.utcnow()
    credit_dec = _quantize_amount(credit_amount)
    remaining = credit_dec
    for i, row in enumerate(rows):
        share = Decimal(str(float(row.amount_claimed or 0) / total_source))
        if i == len(rows) - 1:
            row_credit = remaining
        else:
            row_credit = (credit_dec * share).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            remaining -= row_credit
        row.status = CONVERTED_STATUS
        row.amount_credited = row_credit
        row.reviewed_at = now
        row.reviewed_by_user_id = admin_user_id
        row.admin_note = None

    db.session.commit()

    try:
        from app.store.balance_recharge_events import notify_balance_recharge_updated

        notify_balance_recharge_updated(uid, reason='accum_converted')
    except Exception:
        pass

    return {
        'user_id': uid,
        'username': target_user.username,
        'payment_method_id': pm_id,
        'payment_method_label': method.get('label') or pm_id,
        'source_total': round(total_source, 2),
        'source_currency': source,
        'credit_amount': float(credit_dec),
        'credit_currency': credit_currency,
        'applied_multiplier': applied_mult,
        'recharge_count': len(rows),
        'new_saldo_usd': float(target_user.saldo_usd or 0),
        'new_saldo_cop': float(target_user.saldo_cop or 0),
    }
