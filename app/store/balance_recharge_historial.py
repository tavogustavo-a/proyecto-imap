# Entradas de recargas de saldo para el historial de compras.

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from app.store.balance_recharge_payment import (
    currency_display_name,
    is_accumulator_method_id,
    method_label_by_id_any,
)
from app.store.models import BalanceRecharge, User

HISTORIAL_STATUSES = (
    'approved',
    'auto_credited',
    'accumulated',
    'accum_converted',
    'rejected',
)


def _is_recharge_reverted(row) -> bool:
    if (row.status or '').lower() != 'rejected':
        return False
    if not getattr(row, 'auto_credited', False):
        return False
    return getattr(row, 'admin_verified', None) is False


def _fmt_amount(n: float) -> str:
    if abs(n - round(n)) < 1e-9:
        return str(int(round(n)))
    s = f'{n:.2f}'.replace('.00', '').rstrip('0').rstrip('.')
    return s or '0'


def _fmt_money_display(amount: float, currency: str) -> str:
    cur = currency_display_name(currency)
    return f'${_fmt_amount(float(amount))} {cur}'


def _recharge_product_label(row, pm_label: str) -> str:
    st = (row.status or '').lower()
    is_accum = is_accumulator_method_id(row.payment_method_id or '')
    if st == 'rejected':
        if _is_recharge_reverted(row):
            return f'Recarga revertida — {pm_label}'
        if is_accum:
            return f'Acumulación rechazada — {pm_label}'
        return f'Recarga rechazada — {pm_label}'
    if st == 'accum_converted':
        return f'Conversión acumulador — {pm_label}'
    if st == 'accumulated' or (is_accum and st in ('approved', 'auto_credited')):
        return f'Acumulado — {pm_label}'
    if st == 'auto_credited':
        return f'Recarga automática — {pm_label}'
    return f'Recarga de saldo — {pm_label}'


def _recharge_amount_display(row) -> str:
    st = (row.status or '').lower()
    cur = (row.currency or 'COP').strip().upper()
    if st == 'accum_converted':
        credited = row.amount_credited if row.amount_credited is not None else row.amount_claimed
        credit_cur = cur
        if row.admin_note and '→' in str(row.admin_note):
            tail = str(row.admin_note).split('→')[-1].strip()
            parts = tail.split()
            if parts:
                maybe = parts[-1].strip('.').upper()
                if maybe in ('COP', 'USD', 'USDT'):
                    credit_cur = 'USD' if maybe == 'USDT' else maybe
        if credited is not None:
            return _fmt_money_display(float(credited), credit_cur)
    amt = row.amount_credited if row.amount_credited is not None else row.amount_claimed
    if amt is None:
        return '—'
    return _fmt_money_display(float(amt), cur)


def _event_dt(row) -> Any:
    return getattr(row, 'event_at', None) or getattr(row, 'reviewed_at', None) or getattr(row, 'created_at', None)


def _row_sort_ts(row) -> float:
    dt = _event_dt(row)
    if not dt:
        return 0.0
    try:
        return dt.timestamp()
    except (ValueError, TypeError, OSError):
        return 0.0


def _row_fecha_str(row, utc_to_colombia_fn: Callable) -> str:
    dt = _event_dt(row)
    if not dt:
        return 'Fecha no disponible'
    try:
        local = utc_to_colombia_fn(dt)
        return local.strftime('%y/%m/%d %I:%M:%S %p')
    except Exception:
        return 'Fecha no disponible'


def historial_item_from_row(
    row,
    *,
    row_id_prefix: str = 'recharge',
    row_id_value: int | None = None,
    utc_to_colombia_fn: Callable,
    users_map: Dict[int, str] | None = None,
) -> Dict[str, Any]:
    pm_id = row.payment_method_id or ''
    pm_label = method_label_by_id_any(pm_id) if pm_id else '—'
    st = (row.status or '').lower()
    reverted = _is_recharge_reverted(row)
    rejected = st == 'rejected'
    amt_raw = row.amount_credited if row.amount_credited is not None else row.amount_claimed
    try:
        total_num = float(amt_raw) if amt_raw is not None else 0.0
    except (TypeError, ValueError):
        total_num = 0.0

    rid = row_id_value if row_id_value is not None else getattr(row, 'id', 0)
    item: Dict[str, Any] = {
        'id': f'{row_id_prefix}-{rid}',
        'fecha': _row_fecha_str(row, utc_to_colombia_fn),
        'producto': _recharge_product_label(row, pm_label),
        'cantidad': '—',
        'total': total_num,
        'total_display': _recharge_amount_display(row),
        'licencias': [],
        'has_licencias': False,
        'is_recharge_event': True,
        'is_recharge_conversion': st == 'accum_converted',
        'is_recharge_accumulated': st == 'accumulated',
        'is_recharge_reverted': reverted,
        'is_recharge_rejected': rejected and not reverted,
        'sort_ts': _row_sort_ts(row),
    }
    if users_map is not None:
        uid = int(row.user_id) if row.user_id else 0
        item['user_id'] = uid
        item['usuario'] = users_map.get(uid, str(uid) if uid else '—')
    return item


def build_recharge_historial_items(
    *,
    user_id: Optional[int] = None,
    all_users: bool = False,
    utc_to_colombia_fn: Callable,
) -> List[Dict[str, Any]]:
    """Filas compatibles con historial_compras (producto / total / fecha)."""
    q = BalanceRecharge.query.filter(
        BalanceRecharge.status.in_(HISTORIAL_STATUSES)
    ).order_by(BalanceRecharge.created_at.desc())
    if not all_users:
        if not user_id:
            return []
        q = q.filter(BalanceRecharge.user_id == int(user_id))

    rows = q.limit(500).all()
    live_recharge_ids = {int(r.id) for r in rows if r.id}

    user_ids = {int(r.user_id) for r in rows if r.user_id}
    users_map: Dict[int, str] = {}
    if user_ids and all_users:
        for u in User.query.filter(User.id.in_(user_ids)).all():
            users_map[int(u.id)] = u.username or str(u.id)

    out: List[Dict[str, Any]] = []
    for row in rows:
        out.append(
            historial_item_from_row(
                row,
                utc_to_colombia_fn=utc_to_colombia_fn,
                users_map=users_map if all_users else None,
            )
        )

    from app.store.balance_recharge_historial_snapshot import build_archived_recharge_historial_items

    out.extend(
        build_archived_recharge_historial_items(
            user_id=user_id,
            all_users=all_users,
            utc_to_colombia_fn=utc_to_colombia_fn,
            exclude_recharge_ids=live_recharge_ids,
        )
    )
    return out
