"""Resúmenes diarios de ventas proveedor (persistidos en user_prices hasta borrarlos)."""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, time
from typing import Any

from sqlalchemy.orm.attributes import flag_modified

from app.extensions import db
from app.models.user import User
from app.utils.timezone import utc_to_colombia

logger = logging.getLogger(__name__)

_STORAGE_KEY = 'proveedor_daily_summaries'


def _format_money_plain(n) -> str:
    try:
        x = float(n or 0)
    except (TypeError, ValueError):
        x = 0.0
    if abs(x - round(x)) < 0.005:
        return f'{int(round(x)):,}'.replace(',', '.')
    return f'{x:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


def _normalize_services_map(raw) -> dict[str, dict]:
    from app.store.routes import _proveedor_normalize_services_map

    return _proveedor_normalize_services_map(raw)


def _summaries_map(user_row: User | None) -> dict[str, dict]:
    if not user_row:
        return {}
    up = user_row.user_prices if isinstance(user_row.user_prices, dict) else {}
    raw = up.get(_STORAGE_KEY)
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict] = {}
    for key, val in raw.items():
        if isinstance(val, dict):
            out[str(key)] = val
    return out


def _save_summaries_map(user_row: User, summaries: dict[str, dict]) -> None:
    up = user_row.user_prices if isinstance(user_row.user_prices, dict) else {}
    new_up = dict(up)
    new_up[_STORAGE_KEY] = summaries
    user_row.user_prices = new_up
    flag_modified(user_row, 'user_prices')
    db.session.add(user_row)


def _product_bucket_key(product_name: str, currency: str) -> str:
    return f'{(product_name or "Producto").strip()}|{(currency or "COP").strip().upper()}'


def _rebuild_summary_text(day: dict[str, Any]) -> str:
    products = day.get('products') if isinstance(day.get('products'), dict) else {}
    lines: list[str] = []
    ordered = sorted(
        products.items(),
        key=lambda x: (-float((x[1] or {}).get('total') or 0), x[0].lower()),
    )
    for key, pdata in ordered:
        if not isinstance(pdata, dict):
            continue
        parts = key.rsplit('|', 1)
        pname = parts[0] if parts else 'Producto'
        cur = parts[1] if len(parts) > 1 else 'COP'
        ventas = int(pdata.get('ventas') or 0)
        renovaciones = int(pdata.get('renovaciones') or 0)
        total_cur = float(pdata.get('total') or 0)
        ren_part = f', {renovaciones} renov.' if renovaciones else ''
        lines.append(
            f'{pname}: {ventas} venta(s){ren_part} · '
            f'${_format_money_plain(total_cur)} {cur}'
        )
    totals = day.get('totals') if isinstance(day.get('totals'), dict) else {}
    total_parts = []
    for cur in ('COP', 'USD'):
        if totals.get(cur):
            total_parts.append(f'${_format_money_plain(totals[cur])} {cur}')
    if total_parts:
        lines.append('Total día: ' + ' · '.join(total_parts))
    return '\n'.join(lines)


def _co_date_from_event(event: dict[str, Any]) -> date | None:
    raw = event.get('sold_at')
    if raw is None:
        return utc_to_colombia(datetime.utcnow()).date()
    if isinstance(raw, datetime):
        return utc_to_colombia(raw).date()
    if isinstance(raw, date):
        return raw
    return utc_to_colombia(datetime.utcnow()).date()


def record_proveedor_daily_events(events: list[dict[str, Any]] | None) -> None:
    """
    Registra ventas del checkout en el resumen diario de cada proveedor afectado.
    Cada evento: license_id, product_name, quantity, line_amount, is_renewal, currency, sold_at?
    """
    if not events:
        return

    proveedor_users: list[tuple[User, set[str]]] = []
    for user_row in User.query.filter(User.parent_id.is_(None)).all():
        up = user_row.user_prices if isinstance(user_row.user_prices, dict) else {}
        if not up.get('proveedor'):
            continue
        saved = _normalize_services_map(up.get('proveedor_services'))
        proveedor_users.append((user_row, set(saved.keys())))

    if not proveedor_users:
        return

    touched: set[int] = set()
    for event in events:
        if not isinstance(event, dict):
            continue
        try:
            lid = int(event.get('license_id') or 0)
        except (TypeError, ValueError):
            continue
        if lid <= 0:
            continue
        lid_key = str(lid)
        qty = max(1, int(event.get('quantity') or 1))
        try:
            line_amount = float(event.get('line_amount') or 0)
        except (TypeError, ValueError):
            line_amount = 0.0
        product_name = str(event.get('product_name') or 'Producto').strip() or 'Producto'
        currency = str(event.get('currency') or 'COP').strip().upper() or 'COP'
        is_ren = bool(event.get('is_renewal'))
        co_date = _co_date_from_event(event)
        if not co_date:
            continue
        date_key = co_date.isoformat()
        sort_ts = event.get('sort_ts')
        try:
            sort_ts_f = float(sort_ts) if sort_ts is not None else None
        except (TypeError, ValueError):
            sort_ts_f = None
        if sort_ts_f is None:
            sold_at = event.get('sold_at')
            if isinstance(sold_at, datetime) and hasattr(sold_at, 'timestamp'):
                sort_ts_f = sold_at.timestamp()
            else:
                sort_ts_f = datetime.combine(co_date, time(23, 59, 59)).timestamp()

        for user_row, license_keys in proveedor_users:
            if lid_key not in license_keys:
                continue
            summaries = _summaries_map(user_row)
            day = dict(summaries.get(date_key) or {})
            products = dict(day.get('products') or {})
            totals = dict(day.get('totals') or {})
            pkey = _product_bucket_key(product_name, currency)
            bucket = dict(products.get(pkey) or {})
            bucket['ventas'] = int(bucket.get('ventas') or 0) + qty
            if is_ren:
                bucket['renovaciones'] = int(bucket.get('renovaciones') or 0) + qty
            else:
                bucket['renovaciones'] = int(bucket.get('renovaciones') or 0)
            bucket['total'] = float(bucket.get('total') or 0) + line_amount
            products[pkey] = bucket
            totals[currency] = float(totals.get(currency) or 0) + line_amount
            day_qty = int(day.get('qty') or 0) + qty
            day['products'] = products
            day['totals'] = totals
            day['qty'] = day_qty
            day['total'] = sum(float(totals.get(c) or 0) for c in totals)
            day['sort_ts'] = max(float(day.get('sort_ts') or 0), sort_ts_f)
            day['updated_at'] = datetime.utcnow().isoformat()
            day['summary_text'] = _rebuild_summary_text(day)
            summaries[date_key] = day
            _save_summaries_map(user_row, summaries)
            touched.add(int(user_row.id))

    if touched:
        try:
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            logger.warning('record_proveedor_daily_events commit: %s', exc)


def purge_proveedor_daily_summaries_before(
    cutoff_date: date,
    *,
    user_id: int | None = None,
) -> int:
    """Elimina resúmenes con fecha estrictamente anterior a cutoff_date."""
    removed = 0
    q = User.query.filter(User.parent_id.is_(None))
    if user_id:
        q = q.filter(User.id == int(user_id))
    for user_row in q.all():
        up = user_row.user_prices if isinstance(user_row.user_prices, dict) else {}
        if not up.get('proveedor'):
            continue
        summaries = _summaries_map(user_row)
        if not summaries:
            continue
        keep: dict[str, dict] = {}
        for date_key, day in summaries.items():
            try:
                d = date.fromisoformat(str(date_key)[:10])
            except ValueError:
                keep[date_key] = day
                continue
            if d >= cutoff_date:
                keep[date_key] = day
            else:
                removed += 1
        if len(keep) != len(summaries):
            _save_summaries_map(user_row, keep)
    if removed:
        try:
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            logger.warning('purge_proveedor_daily_summaries_before: %s', exc)
            return 0
    return removed


def build_proveedor_sales_daily_summary_items(billing_user, *, utc_to_colombia_fn=None):
    """Filas de historial desde resúmenes persistidos del proveedor."""
    del utc_to_colombia_fn
    col_fn = utc_to_colombia
    if not billing_user:
        return []

    summaries = _summaries_map(billing_user)
    if not summaries:
        return _legacy_build_from_sales(billing_user, col_fn=col_fn)

    items_out = []
    billing_id = int(billing_user.id)
    for date_key in sorted(summaries.keys(), reverse=True):
        day = summaries.get(date_key)
        if not isinstance(day, dict):
            continue
        try:
            co_date = date.fromisoformat(str(date_key)[:10])
        except ValueError:
            continue
        qty = int(day.get('qty') or 0)
        if qty <= 0:
            continue
        text = str(day.get('summary_text') or '').strip()
        if not text:
            text = _rebuild_summary_text(day)
        sort_ts = float(day.get('sort_ts') or 0)
        if sort_ts <= 0:
            sort_ts = datetime.combine(co_date, time(23, 59, 59)).timestamp()
        try:
            fecha_col = col_fn(datetime.utcfromtimestamp(sort_ts))
            fecha_str = fecha_col.strftime('%y/%m/%d %I:%M:%S %p')
        except (ValueError, TypeError, OSError):
            fecha_str = co_date.strftime('%y/%m/%d') + ' 11:59:59 PM'
        day_total = float(day.get('total') or 0)
        items_out.append(
            {
                'id': f'proveedor-daily-{billing_id}-{co_date.isoformat()}',
                'fecha': fecha_str,
                'producto': f'Venta diaria proveedor — {co_date.strftime("%d/%m/%Y")}',
                'cantidad': qty,
                'total': day_total,
                'licencias': [],
                'has_licencias': False,
                'is_daily_summary': True,
                'is_proveedor_daily_summary': True,
                'daily_summary_text': text,
                'proveedor_summary_date': co_date.isoformat(),
                'sort_ts': sort_ts,
            }
        )
    return items_out


def _legacy_build_from_sales(billing_user, *, col_fn):
    """Una sola pasada de backfill desde ventas si aún no hay resúmenes guardados."""
    from app.store.purchase_history_stats import (
        _product_ids_for_proveedor_users,
        _proveedor_user_rows,
    )
    from app.store.models import Product, Sale, SalePurchaseSnapshot

    proveedor_rows = _proveedor_user_rows(billing_user.id)
    if not proveedor_rows:
        return []
    product_ids = _product_ids_for_proveedor_users(proveedor_rows)
    if not product_ids:
        return []

    product_names = {
        int(p.id): p.name
        for p in Product.query.filter(Product.id.in_(list(product_ids))).all()
    }
    active_sale_ids = {s.id for s in Sale.query.with_entities(Sale.id).all()}
    events: list[dict[str, Any]] = []

    def _queue_sale(created_at, product_id, quantity, total_price, user_id, is_ren):
        if not created_at or not product_id:
            return
        try:
            pid = int(product_id)
        except (TypeError, ValueError):
            return
        if pid not in product_ids:
            return
        from app.store.purchase_history_stats import _currency_from_user_row

        buyer = User.query.get(int(user_id)) if user_id else None
        cur = _currency_from_user_row(buyer)
        pname = product_names.get(pid) or f'Producto #{pid}'
        qty = max(1, int(quantity or 1))
        amt = float(total_price or 0)
        unit = amt / qty if qty else amt
        from app.store.models import License

        lic = License.query.filter(License.product_id == pid, License.enabled.is_(True)).first()
        if not lic:
            return
        events.append(
            {
                'license_id': int(lic.id),
                'product_name': pname,
                'quantity': qty,
                'line_amount': amt,
                'is_renewal': bool(is_ren),
                'currency': cur,
                'sold_at': created_at,
                'sort_ts': created_at.timestamp() if hasattr(created_at, 'timestamp') else None,
            }
        )

    for sale in Sale.query.filter(Sale.product_id.in_(list(product_ids))).all():
        _queue_sale(
            sale.created_at,
            sale.product_id,
            sale.quantity,
            sale.total_price,
            sale.user_id,
            bool(getattr(sale, 'is_renewal', False)),
        )

    for snap in SalePurchaseSnapshot.query.filter(
        SalePurchaseSnapshot.purged_from_sales.is_(True),
        SalePurchaseSnapshot.product_id.in_(list(product_ids)),
    ).all():
        if snap.sale_id and snap.sale_id in active_sale_ids:
            continue
        _queue_sale(
            snap.sale_created_at,
            snap.product_id,
            snap.quantity,
            snap.total_price,
            snap.user_id,
            bool(getattr(snap, 'is_renewal', False)),
        )

    if events:
        record_proveedor_daily_events(events)
        billing_user = User.query.get(int(billing_user.id)) or billing_user
        return build_proveedor_sales_daily_summary_items(billing_user)

    return []
