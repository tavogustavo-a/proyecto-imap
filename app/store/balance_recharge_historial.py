# Entradas de recargas de saldo para el historial de compras.

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional

from app.extensions import db
from app.store.balance_recharge_payment import (
    PAYMENT_BRAND_SPEC,
    currency_display_name,
    get_accumulator_method,
    is_accumulator_method_id,
    method_label_by_id_any,
)
from app.store.models import BalanceRecharge, User

logger = logging.getLogger(__name__)

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


def _accum_brand_tail(brand: str) -> str:
    """Nombre corto del medio (PayPal, Nequi, TRC20, …)."""
    key = (brand or '').strip().lower()
    if key == 'usdt_trc20':
        return 'TRC20'
    if key == 'usdt_erc20':
        return 'ERC20'
    spec = PAYMENT_BRAND_SPEC.get(key) or {}
    label = str(spec.get('label') or '').strip()
    if label.upper().startswith('USDT '):
        return label.split(' ', 1)[1].strip()
    return label


def _accum_pm_tail(pm_label: str) -> str:
    """Respaldo desde la etiqueta configurada (sin «Acumulador » ni cuenta larga)."""
    label = (pm_label or '').strip()
    low = label.lower()
    if low.startswith('acumulador '):
        label = label[len('Acumulador '):].strip()
    elif low == 'acumulador':
        label = ''
    for sep in (' / ', '/', ' — ', '—', ' · ', '·'):
        if sep in label:
            label = label.split(sep, 1)[0].strip()
            break
    parts = label.split()
    if not parts:
        return ''
    if parts[0].upper() in ('USDT', 'USD') and len(parts) >= 2:
        if parts[1].upper() in ('TRC20', 'ERC20'):
            return parts[1].upper()
        return ' '.join(parts[1:]).strip()
    if parts[0].upper() == 'COP' and len(parts) >= 2:
        return ' '.join(parts[1:]).strip()
    return label


def _accum_amount_currency(row, accum_method: dict | None) -> tuple[float, str]:
    raw_cur = (row.currency or 'COP').strip().upper()
    if accum_method:
        raw_cur = (accum_method.get('payment_currency') or raw_cur).strip().upper()
    cur = currency_display_name(raw_cur)
    amt = row.amount_claimed
    if amt is None:
        amt = row.amount_credited
    try:
        return float(amt or 0), cur
    except (TypeError, ValueError):
        return 0.0, cur


def _accum_product_short_label(row, pm_label: str) -> str:
    """
    Etiqueta corta para cualquier acumulador (sin «Conversión acumulador —»).
    Ej.: Acumulador 10USDT TRC20 · Acumulador 15USDT PayPal · Acumulador 50000COP Nequi
    """
    pm_id = str(getattr(row, 'payment_method_id', '') or '').strip()
    accum = get_accumulator_method(pm_id)
    amount, cur = _accum_amount_currency(row, accum)
    tail = ''
    if accum:
        tail = _accum_brand_tail(str(accum.get('payment_brand') or ''))
    if not tail:
        tail = _accum_pm_tail(pm_label)
    core = f'Acumulador {_fmt_amount(amount)}{cur}'
    if tail:
        return f'{core} {tail}'
    return core


def compute_historial_producto(row) -> str:
    pm_id = str(getattr(row, 'payment_method_id', '') or '').strip()
    pm_label = method_label_by_id_any(pm_id) if pm_id else '—'
    return _recharge_product_label(row, pm_label)


def historial_producto_for_row(row) -> str:
    """Usa historial_producto guardado en BD (editable por SQL); si está vacío, calcula."""
    stored = getattr(row, 'historial_producto', None)
    if stored and str(stored).strip():
        return str(stored).strip()
    return compute_historial_producto(row)


def ensure_historial_producto_schema() -> None:
    from sqlalchemy import inspect, text

    from app.store.models import BalanceRechargeHistorialSnapshot

    try:
        insp = inspect(db.engine)
        if 'store_balance_recharge_historial_snapshots' not in insp.get_table_names():
            BalanceRechargeHistorialSnapshot.__table__.create(db.engine, checkfirst=True)
        else:
            cols = {c['name'].lower() for c in insp.get_columns('store_balance_recharge_historial_snapshots')}
            if 'historial_producto' not in cols:
                db.session.execute(
                    text(
                        'ALTER TABLE store_balance_recharge_historial_snapshots '
                        'ADD COLUMN historial_producto VARCHAR(200)'
                    )
                )
                db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.warning('No se pudo asegurar historial_producto en snapshots: %s', exc)


def backfill_historial_producto(*, commit: bool = True, only_missing: bool = True) -> int:
    """Rellena historial_producto vacío (no pisa valores editados por SQL)."""
    ensure_historial_producto_schema()
    updated = 0
    rows = BalanceRecharge.query.filter(BalanceRecharge.status.in_(HISTORIAL_STATUSES)).all()
    for row in rows:
        if only_missing and str(getattr(row, 'historial_producto', None) or '').strip():
            continue
        row.historial_producto = compute_historial_producto(row)
        updated += 1

    from app.store.models import BalanceRechargeHistorialSnapshot

    snaps = BalanceRechargeHistorialSnapshot.query.filter(
        BalanceRechargeHistorialSnapshot.status.in_(HISTORIAL_STATUSES)
    ).all()
    for snap in snaps:
        if only_missing and str(getattr(snap, 'historial_producto', None) or '').strip():
            continue
        snap.historial_producto = compute_historial_producto(snap)
        updated += 1

    if commit and updated:
        db.session.commit()
    return updated


def _recharge_product_label(row, pm_label: str) -> str:
    st = (row.status or '').lower()
    is_accum = is_accumulator_method_id(row.payment_method_id or '')
    if is_accum or st in ('accum_converted', 'accumulated'):
        return _accum_product_short_label(row, pm_label)
    if st == 'rejected':
        if _is_recharge_reverted(row):
            return f'Revertida — {pm_label}'
        return f'Rechazada — {pm_label}'
    if st == 'auto_credited':
        return f'Recarga — {pm_label}'
    return f'Recarga — {pm_label}'


def _accum_converted_credit_currency(row) -> str:
    from app.store.balance_recharge_accum import _target_currency_for_user

    cur = (row.currency or 'COP').strip().upper()
    if row.user_id:
        user = User.query.get(int(row.user_id))
        if user:
            return _target_currency_for_user(user)
    return 'COP' if cur in ('USD', 'USDT') else cur


def _recharge_amount_display(row) -> str:
    st = (row.status or '').lower()
    cur = (row.currency or 'COP').strip().upper()
    if st == 'accum_converted':
        credited = row.amount_credited if row.amount_credited is not None else row.amount_claimed
        credit_cur = _accum_converted_credit_currency(row)
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

    claimed_raw = row.amount_claimed
    try:
        amount_claimed_num = float(claimed_raw) if claimed_raw is not None else None
    except (TypeError, ValueError):
        amount_claimed_num = None

    rid = row_id_value if row_id_value is not None else getattr(row, 'id', 0)
    item: Dict[str, Any] = {
        'id': f'{row_id_prefix}-{rid}',
        'fecha': _row_fecha_str(row, utc_to_colombia_fn),
        'producto': historial_producto_for_row(row),
        'cantidad': '—',
        'total': total_num,
        'total_display': _recharge_amount_display(row),
        'amount_claimed': amount_claimed_num,
        'currency': currency_display_name((row.currency or 'COP').strip().upper()),
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
    backfill_producto: bool = True,
) -> List[Dict[str, Any]]:
    """Filas compatibles con historial_compras (producto / total / fecha)."""
    ensure_historial_producto_schema()
    if backfill_producto:
        try:
            backfill_historial_producto(commit=True, only_missing=True)
        except Exception as exc:
            logger.warning('No se pudo rellenar historial_producto: %s', exc)
            db.session.rollback()
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
