"""Resúmenes diarios de ventas proveedor (persistidos en user_prices hasta borrarlos)."""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, time
from typing import Any

from sqlalchemy.orm.attributes import flag_modified

from app.extensions import db
from app.models.user import User
from app.utils.timezone import utc_to_colombia

logger = logging.getLogger(__name__)

_STORAGE_KEY = 'proveedor_daily_summaries'

PROVEEDOR_METRICS_COHERENCE_NOTE = (
    'Ventas del período: se calculan desde la base de datos (solo ventas a terceros). '
    'Resúmenes diarios: registro persistido por día al registrar una venta. '
    'Contador Admin → Proveedores: acumulado operativo desde el último reset; '
    'puede no coincidir si hubo ventas antes del resumen, reset manual o limpieza masiva.'
)


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


def make_proveedor_daily_sale_event(
    *,
    license_id: int,
    product_name: str = 'Producto',
    quantity: int = 1,
    line_amount: float = 0.0,
    is_renewal: bool = False,
    currency: str = 'COP',
    sold_at=None,
    buyer_user_id=None,
    sort_ts=None,
) -> dict[str, Any]:
    """Evento normalizado para ``record_proveedor_daily_events``."""
    qty = max(1, int(quantity or 1))
    sold_at = sold_at or datetime.utcnow()
    if sort_ts is None and isinstance(sold_at, datetime) and hasattr(sold_at, 'timestamp'):
        sort_ts = sold_at.timestamp()
    buyer_uid = None
    if buyer_user_id is not None:
        try:
            buyer_uid = int(buyer_user_id)
        except (TypeError, ValueError):
            buyer_uid = None
    return {
        'license_id': int(license_id),
        'product_name': str(product_name or 'Producto').strip() or 'Producto',
        'quantity': qty,
        'line_amount': float(line_amount or 0),
        'is_renewal': bool(is_renewal),
        'currency': str(currency or 'COP').strip().upper() or 'COP',
        'sold_at': sold_at,
        'sort_ts': sort_ts,
        'buyer_user_id': buyer_uid,
    }


def record_proveedor_daily_events(events: list[dict[str, Any]] | None) -> None:
    """
    Registra ventas en el resumen diario de cada proveedor afectado.
    Origen: checkout tienda, entrega admin (bulk delivery) u otros flujos que
    llamen ``make_proveedor_daily_sale_event`` / ``_proveedor_record_license_sale``.
    Cada evento: license_id, product_name, quantity, line_amount, is_renewal,
    currency, sold_at?, buyer_user_id?
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
            from app.store.purchase_history_stats import _proveedor_self_buyer_ids

            buyer_uid = event.get('buyer_user_id')
            if buyer_uid is not None:
                try:
                    if int(buyer_uid) in _proveedor_self_buyer_ids(user_row.id):
                        continue
                except (TypeError, ValueError):
                    pass
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


def delete_proveedor_daily_summary_day(billing_user, co_date: date) -> tuple[bool, str | None]:
    """Elimina un día concreto del resumen persistido del proveedor."""
    if not billing_user:
        return False, 'Usuario no encontrado.'
    try:
        target = co_date if isinstance(co_date, date) else date.fromisoformat(str(co_date)[:10])
    except ValueError:
        return False, 'Fecha inválida.'
    up = billing_user.user_prices if isinstance(billing_user.user_prices, dict) else {}
    if not up.get('proveedor'):
        return False, 'El usuario no es proveedor.'
    summaries = _summaries_map(billing_user)
    date_key = target.isoformat()
    if date_key not in summaries:
        return False, 'No hay resumen guardado para esa fecha.'
    keep = dict(summaries)
    del keep[date_key]
    if keep:
        _save_summaries_map(billing_user, keep)
    else:
        new_up = dict(up)
        new_up.pop(_STORAGE_KEY, None)
        billing_user.user_prices = new_up
        flag_modified(billing_user, 'user_prices')
        db.session.add(billing_user)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.warning('delete_proveedor_daily_summary_day: %s', exc)
        return False, 'No se pudo borrar el resumen.'
    return True, None


def list_proveedor_daily_summaries_in_period(
    billing_user=None,
    date_from: date | None = None,
    date_to: date | None = None,
    *,
    all_proveedores: bool = False,
) -> list[dict[str, Any]]:
    """Resúmenes persistidos del proveedor dentro del rango calendario (inclusive)."""
    if not date_from or not date_to:
        return []
    if date_from > date_to:
        date_from, date_to = date_to, date_from

    if all_proveedores:
        from app.store.purchase_history_stats import _proveedor_user_rows

        items_out: list[dict[str, Any]] = []
        for user_row in _proveedor_user_rows():
            username = (user_row.username or '—').strip() or '—'
            for item in _list_proveedor_daily_summaries_for_user(
                user_row, date_from, date_to
            ):
                out = dict(item)
                out['user_id'] = int(user_row.id)
                out['usuario'] = username
                out['producto'] = f'{username} — {item["producto"]}'
                items_out.append(out)
        items_out.sort(
            key=lambda x: (str(x.get('co_date') or ''), str(x.get('usuario') or '').lower()),
            reverse=True,
        )
        return items_out

    if not billing_user:
        return []
    return _list_proveedor_daily_summaries_for_user(billing_user, date_from, date_to)


def _list_proveedor_daily_summaries_for_user(
    billing_user,
    date_from: date,
    date_to: date,
) -> list[dict[str, Any]]:
    summaries = _summaries_map(billing_user)
    if not summaries:
        return []

    items_out: list[dict[str, Any]] = []
    for date_key in sorted(summaries.keys(), reverse=True):
        day = summaries.get(date_key)
        if not isinstance(day, dict):
            continue
        try:
            co_date = date.fromisoformat(str(date_key)[:10])
        except ValueError:
            continue
        if co_date < date_from or co_date > date_to:
            continue
        qty = int(day.get('qty') or 0)
        if qty <= 0:
            continue
        text = str(day.get('summary_text') or '').strip()
        if not text:
            text = _rebuild_summary_text(day)
        items_out.append(
            {
                'co_date': co_date.isoformat(),
                'producto': f'Venta diaria proveedor — {co_date.strftime("%d/%m/%Y")}',
                'daily_summary_text': text,
                'cantidad': qty,
                'total': float(day.get('total') or 0),
            }
        )
    return items_out


def _co_date_utc_bounds(co_date: date) -> tuple[datetime, datetime]:
    """Inicio/fin UTC (naive) del día calendario Colombia."""
    from app.utils.timezone import colombia_to_utc

    start = colombia_to_utc(datetime.combine(co_date, time.min)).replace(tzinfo=None)
    end = colombia_to_utc(datetime.combine(co_date, time(23, 59, 59))).replace(tzinfo=None)
    return start, end


def _proveedor_license_ids(user_row: User) -> set[int]:
    saved = _normalize_services_map(
        (user_row.user_prices if isinstance(user_row.user_prices, dict) else {}).get(
            'proveedor_services'
        )
    )
    out: set[int] = set()
    for key in saved:
        try:
            lid = int(key)
        except (TypeError, ValueError):
            continue
        if lid > 0:
            out.add(lid)
    return out


def _license_product_names(license_ids: set[int]) -> dict[int, str]:
    from app.store.models import License
    from sqlalchemy.orm import joinedload

    if not license_ids:
        return {}
    names: dict[int, str] = {}
    rows = (
        License.query.options(joinedload(License.product))
        .filter(License.id.in_(list(license_ids)))
        .all()
    )
    for lic in rows:
        prod = getattr(lic, 'product', None)
        names[int(lic.id)] = (prod.name if prod else None) or ('Licencia #%s' % lic.id)
    return names


def _parse_activity_items(raw) -> list[dict]:
    if not str(raw or '').strip():
        return []
    try:
        lst = json.loads(raw) if not isinstance(raw, list) else raw
    except Exception:
        return []
    return [x for x in lst if isinstance(x, dict)] if isinstance(lst, list) else []


def _cred_hint_from_refund(row) -> str:
    line = str(getattr(row, 'removed_day_line', None) or '').strip()
    if line:
        first = line.split('\n', 1)[0].strip()
        first = first.split('\x1f', 1)[0].strip()
        return first[:180]
    return ''


def build_proveedor_day_review(user_row: User, co_date: date) -> dict[str, Any]:
    """Resumen rápido de un proveedor interno en un día Colombia (historial).

    Ventas: resumen diario persistido (si existe) o recuento de ventas a terceros.
    Garantías: entregas ``garantia_entrega`` de servicios de ese proveedor.
    Reembolsos: devoluciones de cuentas de esos mismos servicios.
    """
    from app.store.models import LicenseAccountRefund, Product, Sale, SalePurchaseSnapshot
    from app.store.purchase_history_stats import (
        _currency_from_user_row,
        _product_ids_for_proveedor_users,
        _sale_counts_as_proveedor_sale,
    )

    license_ids = _proveedor_license_ids(user_row)
    names = _license_product_names(license_ids)
    date_key = co_date.isoformat()
    start_utc, end_utc = _co_date_utc_bounds(co_date)

    ventas = 0
    renovaciones = 0
    totals = {'COP': 0.0, 'USD': 0.0}
    products: list[dict[str, Any]] = []

    summaries = _summaries_map(user_row)
    day = summaries.get(date_key) if isinstance(summaries.get(date_key), dict) else None
    from_summary = False
    if day and int(day.get('qty') or 0) > 0:
        from_summary = True
        ventas = int(day.get('qty') or 0)
        day_totals = day.get('totals') if isinstance(day.get('totals'), dict) else {}
        for cur in ('COP', 'USD'):
            try:
                totals[cur] = float(day_totals.get(cur) or 0)
            except (TypeError, ValueError):
                totals[cur] = 0.0
        raw_products = day.get('products') if isinstance(day.get('products'), dict) else {}
        for key, pdata in sorted(
            raw_products.items(),
            key=lambda x: (-float((x[1] or {}).get('total') or 0), x[0].lower()),
        ):
            if not isinstance(pdata, dict):
                continue
            parts = str(key).rsplit('|', 1)
            pname = parts[0] if parts else 'Producto'
            cur = parts[1] if len(parts) > 1 else 'COP'
            qty = int(pdata.get('ventas') or 0)
            ren = int(pdata.get('renovaciones') or 0)
            renovaciones += ren
            products.append(
                {
                    'producto': pname,
                    'moneda': cur,
                    'ventas': qty,
                    'renovaciones': ren,
                    'total': round(float(pdata.get('total') or 0), 2),
                }
            )

    if not from_summary and license_ids:
        product_ids = _product_ids_for_proveedor_users([user_row])
        by_product: dict[tuple[str, str], dict] = {}
        if product_ids:
            sales_list = Sale.query.filter(
                Sale.created_at >= start_utc,
                Sale.created_at <= end_utc,
                Sale.product_id.in_(list(product_ids)),
            ).all()
            snaps_list = SalePurchaseSnapshot.query.filter(
                SalePurchaseSnapshot.purged_from_sales.is_(True),
                SalePurchaseSnapshot.sale_created_at >= start_utc,
                SalePurchaseSnapshot.sale_created_at <= end_utc,
                SalePurchaseSnapshot.product_id.in_(list(product_ids)),
            ).all()
            active_sale_ids = {s.id for s in Sale.query.with_entities(Sale.id).all()}
            product_names = {
                int(p.id): p.name
                for p in Product.query.filter(Product.id.in_(list(product_ids))).all()
            }

            def _add_sale(buyer_id, product_id, amount, is_ren, pname, currency):
                nonlocal ventas, renovaciones
                if not _sale_counts_as_proveedor_sale(buyer_id, product_id, user_row.id):
                    return
                cur = str(currency or '').strip().upper()
                if cur not in ('COP', 'USD'):
                    buyer = User.query.get(int(buyer_id)) if buyer_id else None
                    cur = _currency_from_user_row(buyer)
                amt = float(amount or 0)
                ventas += 1
                if is_ren:
                    renovaciones += 1
                totals[cur] = totals.get(cur, 0.0) + amt
                bucket = by_product.setdefault(
                    (pname, cur),
                    {'ventas': 0, 'renovaciones': 0, 'total': 0.0},
                )
                bucket['ventas'] += 1
                if is_ren:
                    bucket['renovaciones'] += 1
                bucket['total'] += amt

            for sale in sales_list:
                pname = product_names.get(int(sale.product_id or 0)) or (
                    'Producto #%s' % sale.product_id
                )
                _add_sale(
                    sale.user_id,
                    sale.product_id,
                    sale.total_price,
                    bool(getattr(sale, 'is_renewal', False)),
                    pname,
                    getattr(sale, 'currency', None),
                )
            for snap in snaps_list:
                if snap.sale_id and snap.sale_id in active_sale_ids:
                    continue
                _add_sale(
                    snap.user_id,
                    snap.product_id,
                    snap.total_price,
                    bool(getattr(snap, 'is_renewal', False)),
                    snap.product_name or '—',
                    getattr(snap, 'currency', None),
                )
            products = [
                {
                    'producto': k[0],
                    'moneda': k[1],
                    'ventas': v['ventas'],
                    'renovaciones': v['renovaciones'],
                    'total': round(v['total'], 2),
                }
                for k, v in sorted(by_product.items(), key=lambda x: -x[1]['total'])
            ]

    garantias: list[dict[str, Any]] = []
    if license_ids:
        users = User.query.filter(
            User.portal_license_activity_log.like('%garantia_entrega%')
        ).all()
        seen: set[tuple] = set()
        for urow in users:
            for item in _parse_activity_items(
                getattr(urow, 'portal_license_activity_log', None)
            ):
                if str(item.get('tipo') or '').strip().lower() != 'garantia_entrega':
                    continue
                ts_raw = item.get('ts')
                if not ts_raw:
                    continue
                try:
                    ts = datetime.fromisoformat(str(ts_raw).replace('Z', '')[:26])
                    item_co = utc_to_colombia(ts).date()
                except Exception:
                    continue
                if item_co != co_date:
                    continue
                extra = item.get('extra') if isinstance(item.get('extra'), dict) else {}
                try:
                    lid = int(extra.get('license_id') or 0)
                except (TypeError, ValueError):
                    lid = 0
                if lid not in license_ids:
                    continue
                old_cred = str(extra.get('old_cred') or '').strip()
                new_cred = str(extra.get('new_cred') or '').strip()
                if (not old_cred or not new_cred) and item.get('detail'):
                    parts = [
                        p.strip()
                        for p in str(item.get('detail') or '').split(
                            '\nse dio garantia por esta\n'
                        )
                    ]
                    if len(parts) == 2:
                        old_cred = old_cred or parts[0]
                        new_cred = new_cred or parts[1]
                pname = (
                    str(extra.get('product_name') or '').strip()
                    or names.get(lid)
                    or 'Producto'
                )
                key = (lid, old_cred, new_cred)
                if key in seen:
                    continue
                seen.add(key)
                garantias.append(
                    {
                        'producto': pname,
                        'cuenta': old_cred[:180],
                        'repuesto': new_cred[:180],
                    }
                )

    reembolsos: list[dict[str, Any]] = []
    refund_totals = {'COP': 0.0, 'USD': 0.0}
    if license_ids:
        try:
            refund_rows = (
                LicenseAccountRefund.query.filter(
                    LicenseAccountRefund.license_id.in_(list(license_ids)),
                    LicenseAccountRefund.created_at >= start_utc,
                    LicenseAccountRefund.created_at <= end_utc,
                )
                .order_by(LicenseAccountRefund.created_at.asc())
                .all()
            )
        except Exception:
            refund_rows = []
        for row in refund_rows:
            try:
                amount = float(row.refund_amount or 0)
            except (TypeError, ValueError):
                amount = 0.0
            cur = str(row.currency or 'COP').strip().upper() or 'COP'
            if cur not in refund_totals:
                refund_totals[cur] = 0.0
            refund_totals[cur] += amount
            days = max(
                0,
                int(
                    getattr(row, 'returned_days', None)
                    or getattr(row, 'refunded_days', None)
                    or 0
                ),
            )
            lid = int(row.license_id or 0)
            reembolsos.append(
                {
                    'producto': str(row.product_name or names.get(lid) or 'Licencia'),
                    'cuenta': _cred_hint_from_refund(row),
                    'dias': days,
                    'moneda': cur,
                    'total': round(amount, 2),
                }
            )

    return {
        'date': date_key,
        'user_id': int(user_row.id),
        'username': (user_row.username or '').strip() or str(user_row.id),
        'from_summary': from_summary,
        'ventas': ventas,
        'renovaciones': renovaciones,
        'garantias': len(garantias),
        'reembolsos': len(reembolsos),
        'ingresos': {
            'COP': round(totals.get('COP') or 0, 2),
            'USD': round(totals.get('USD') or 0, 2),
        },
        'reembolsos_monto': {
            'COP': round(refund_totals.get('COP') or 0, 2),
            'USD': round(refund_totals.get('USD') or 0, 2),
        },
        'productos': products,
        'garantias_detalle': garantias,
        'reembolsos_detalle': reembolsos,
        'summary_text': str((day or {}).get('summary_text') or '').strip() if day else '',
    }


def build_proveedor_sales_daily_summary_items(
    billing_user=None,
    *,
    all_users: bool = False,
    utc_to_colombia_fn=None,
):
    """Filas de historial desde resúmenes persistidos del proveedor."""
    col_fn = utc_to_colombia_fn or utc_to_colombia
    if all_users:
        from app.store.purchase_history_stats import _proveedor_user_rows

        items_out: list[dict[str, Any]] = []
        for user_row in _proveedor_user_rows():
            for item in _proveedor_daily_items_for_user(user_row, col_fn=col_fn):
                item['user_id'] = int(user_row.id)
                item['usuario'] = user_row.username or '—'
                items_out.append(item)
        return items_out
    if not billing_user:
        return []
    return _proveedor_daily_items_for_user(billing_user, col_fn=col_fn)


def _proveedor_daily_items_for_user(billing_user, *, col_fn):
    """Filas de historial para un proveedor (billing user)."""
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
        from app.store.purchase_history_stats import (
            _currency_from_user_row,
            _sale_counts_as_proveedor_sale,
        )

        if not _sale_counts_as_proveedor_sale(user_id, pid, billing_user.id):
            return

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
            make_proveedor_daily_sale_event(
                license_id=int(lic.id),
                product_name=pname,
                quantity=qty,
                line_amount=amt,
                is_renewal=bool(is_ren),
                currency=cur,
                sold_at=created_at,
                buyer_user_id=int(user_id) if user_id else None,
                sort_ts=created_at.timestamp() if hasattr(created_at, 'timestamp') else None,
            )
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
