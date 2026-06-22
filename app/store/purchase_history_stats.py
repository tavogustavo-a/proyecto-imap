# Estadísticas de historial de compras (admin y usuario propio).

import json
from collections import defaultdict
from datetime import datetime, timedelta, time, timezone

from sqlalchemy import func

from app.extensions import db
from app.models.user import User
from app.store.models import Product, Sale, SalePurchaseSnapshot


def _utc_now_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_period(date_from_s=None, date_to_s=None, days=None):
    now = _utc_now_naive()
    if date_from_s and date_to_s:
        try:
            start = datetime.strptime(str(date_from_s).strip()[:10], '%Y-%m-%d')
            end = datetime.strptime(str(date_to_s).strip()[:10], '%Y-%m-%d')
            end = end.replace(hour=23, minute=59, second=59)
            if end < start:
                start, end = end, start
            return start, end
        except ValueError:
            pass
    if days is not None:
        try:
            d = int(days)
            if d > 0:
                return now - timedelta(days=d), now
        except (TypeError, ValueError):
            pass
    return now - timedelta(days=30), now


def _resolve_user_ids(scope, user_id=None):
    from flask import current_app

    admin_name = (current_app.config.get('ADMIN_USER') or 'admin').lower()
    if scope == 'user' and user_id:
        u = User.query.get(int(user_id))
        return [u.id] if u else []
    q = User.query.filter(User.parent_id.is_(None))
    q = q.filter(func.lower(User.username) != admin_name)
    return [row.id for row in q.with_entities(User.id).all()]


def _proveedor_user_rows(specific_user_id=None):
    """Usuarios principales con permiso proveedor (opcionalmente uno solo)."""
    rows = User.query.filter(User.parent_id.is_(None)).order_by(User.username.asc()).all()
    out = []
    want_id = int(specific_user_id) if specific_user_id else None
    for user_row in rows:
        up = user_row.user_prices if isinstance(user_row.user_prices, dict) else {}
        if not up.get('proveedor'):
            continue
        if want_id is not None and user_row.id != want_id:
            continue
        out.append(user_row)
    return out


def _product_ids_for_proveedor_users(proveedor_users):
    """Productos tienda vinculados a licencias habilitadas en proveedor_services."""
    from app.store.models import License

    product_ids = set()
    for user_row in proveedor_users or []:
        up = user_row.user_prices if isinstance(user_row.user_prices, dict) else {}
        raw = up.get('proveedor_services')
        if not isinstance(raw, dict):
            continue
        for key in raw.keys():
            try:
                lid = int(key)
            except (TypeError, ValueError):
                continue
            if lid <= 0:
                continue
            lic = License.query.filter(License.id == lid, License.enabled.is_(True)).first()
            if lic and lic.product_id:
                product_ids.add(int(lic.product_id))
    return product_ids


def _user_is_proveedor(user_row):
    if not user_row:
        return False
    up = user_row.user_prices if isinstance(user_row.user_prices, dict) else {}
    return bool(up.get('proveedor'))


def _count_proveedor_sales_in_period(start, end, proveedor_user_id=None):
    """Ventas en tienda de servicios habilitados para proveedor(es) en el período."""
    rows = _proveedor_user_rows(proveedor_user_id)
    product_ids = _product_ids_for_proveedor_users(rows)
    if not product_ids:
        return 0
    pid_list = list(product_ids)
    total = Sale.query.filter(
        Sale.created_at >= start,
        Sale.created_at <= end,
        Sale.product_id.in_(pid_list),
    ).count()
    active_sale_ids = {s.id for s in Sale.query.with_entities(Sale.id).all()}
    snaps = SalePurchaseSnapshot.query.filter(
        SalePurchaseSnapshot.purged_from_sales.is_(True),
        SalePurchaseSnapshot.sale_created_at >= start,
        SalePurchaseSnapshot.sale_created_at <= end,
        SalePurchaseSnapshot.product_id.in_(pid_list),
    ).all()
    for snap in snaps:
        if snap.sale_id and snap.sale_id in active_sale_ids:
            continue
        total += 1
    return total


def _iter_portal_activity(user_row, start, end):
    raw = getattr(user_row, 'portal_license_activity_log', None) or ''
    if not str(raw).strip():
        return
    try:
        items = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return
    if not isinstance(items, list):
        return
    for item in items:
        if not isinstance(item, dict):
            continue
        ts_raw = item.get('ts')
        if not ts_raw:
            continue
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace('Z', '')[:26])
        except ValueError:
            continue
        if ts < start or ts > end:
            continue
        yield item


def _currency_from_user_row(user_row, parents_by_id=None):
    """Moneda de facturación del comprador (sub-usuario usa la del padre)."""
    if not user_row:
        return 'COP'
    if user_row.parent_id and parents_by_id:
        parent = parents_by_id.get(user_row.parent_id)
        if parent and isinstance(getattr(parent, 'user_prices', None), dict):
            tp = parent.user_prices.get('tipo_precio')
            if tp in ('USD', 'COP'):
                return str(tp).upper()
    up = getattr(user_row, 'user_prices', None)
    if isinstance(up, dict):
        tp = up.get('tipo_precio')
        if tp in ('USD', 'COP'):
            return str(tp).upper()
    return 'COP'


def _build_user_currency_cache(user_ids):
    ids = {int(x) for x in user_ids if x}
    if not ids:
        return {}
    users = User.query.filter(User.id.in_(ids)).all()
    parent_ids = {u.parent_id for u in users if u.parent_id}
    parents_by_id = {}
    if parent_ids:
        parents_by_id = {
            p.id: p for p in User.query.filter(User.id.in_(parent_ids)).all()
        }
    return {u.id: _currency_from_user_row(u, parents_by_id) for u in users}


def _activity_bucket(tipo_raw):
    t = str(tipo_raw or '').strip().lower()
    if t == 'portal_caida':
        return 'caidas'
    if t == 'portal_garantia':
        return 'garantias'
    if t == 'reporte_o_incidencia':
        return 'reportes'
    if t == 'incidencia':
        return 'incidencias'
    if t in ('renovacion_estado', 'renovacion_gestion', 'renovacion_tienda'):
        return 'renovaciones_actividad'
    if t == 'entrega':
        return 'entregas'
    return 'otros'


def compute_purchase_history_stats(scope='all', user_id=None, date_from=None, date_to=None, days=30):
    """
    Métricas agregadas para el panel de estadísticas del historial de compras.
    scope: all | user | proveedor
    """
    start, end = _parse_period(date_from, date_to, days)
    scope = str(scope or 'all').strip().lower()
    product_ids_filter = None
    activity_user_ids = None
    proveedor_user_id = None

    if scope == 'proveedor':
        proveedor_user_id = int(user_id) if user_id else None
        proveedor_rows = _proveedor_user_rows(proveedor_user_id)
        if proveedor_user_id and not proveedor_rows:
            return {'success': False, 'error': 'Proveedor no encontrado.'}
        if not proveedor_rows:
            return {'success': False, 'error': 'No hay usuarios con permiso de proveedor.'}
        product_ids_filter = _product_ids_for_proveedor_users(proveedor_rows)
        activity_user_ids = [u.id for u in proveedor_rows]
        user_ids = None
    else:
        user_ids = _resolve_user_ids(scope, user_id)
        if scope == 'user' and not user_ids:
            return {'success': False, 'error': 'Usuario no encontrado.'}

    sales_count = 0
    renewals_count = 0
    global_proveedor_product_ids = _product_ids_for_proveedor_users(_proveedor_user_rows())
    by_currency = defaultdict(lambda: {'ventas': 0, 'renovaciones': 0, 'total': 0.0})
    by_product_sales = defaultdict(lambda: {'ventas': 0, 'renovaciones': 0, 'proveedores': 0, 'total': 0.0})

    def _record_sale(user_id, amount, is_ren, pname, product_id=None):
        nonlocal sales_count, renewals_count
        sales_count += 1
        if is_ren:
            renewals_count += 1
        cur = currency_cache.get(user_id, 'COP')
        amt = float(amount or 0)
        cur_bucket = by_currency[cur]
        cur_bucket['ventas'] += 1
        if is_ren:
            cur_bucket['renovaciones'] += 1
        cur_bucket['total'] += amt
        prod_key = (pname, cur)
        bucket = by_product_sales[prod_key]
        bucket['ventas'] += 1
        if is_ren:
            bucket['renovaciones'] += 1
        bucket['total'] += amt
        is_proveedor_sale = product_ids_filter is not None
        if not is_proveedor_sale and product_id:
            try:
                is_proveedor_sale = int(product_id) in global_proveedor_product_ids
            except (TypeError, ValueError):
                is_proveedor_sale = False
        if is_proveedor_sale:
            bucket['proveedores'] += 1

    sale_q = Sale.query.filter(Sale.created_at >= start, Sale.created_at <= end)
    if user_ids:
        sale_q = sale_q.filter(Sale.user_id.in_(user_ids))
    if product_ids_filter is not None:
        if not product_ids_filter:
            sales_list = []
        else:
            sale_q = sale_q.filter(Sale.product_id.in_(product_ids_filter))
            sales_list = sale_q.all()
    else:
        sales_list = sale_q.all()
    snap_q = SalePurchaseSnapshot.query.filter(
        SalePurchaseSnapshot.purged_from_sales.is_(True),
        SalePurchaseSnapshot.sale_created_at >= start,
        SalePurchaseSnapshot.sale_created_at <= end,
    )
    if user_ids:
        snap_q = snap_q.filter(SalePurchaseSnapshot.user_id.in_(user_ids))
    if product_ids_filter is not None:
        if not product_ids_filter:
            snaps_list = []
        else:
            snap_q = snap_q.filter(SalePurchaseSnapshot.product_id.in_(product_ids_filter))
            snaps_list = snap_q.all()
    else:
        snaps_list = snap_q.all()
    active_sale_ids = {s.id for s in Sale.query.with_entities(Sale.id).all()}

    buyer_ids = {s.user_id for s in sales_list}
    buyer_ids.update(s.user_id for s in snaps_list if s.user_id)
    currency_cache = _build_user_currency_cache(buyer_ids)

    for sale in sales_list:
        pname = '—'
        if sale.product_id:
            prod = Product.query.get(sale.product_id)
            pname = prod.name if prod else f'Producto #{sale.product_id}'
        _record_sale(
            sale.user_id,
            sale.total_price,
            bool(getattr(sale, 'is_renewal', False)),
            pname,
            sale.product_id,
        )

    for snap in snaps_list:
        if snap.sale_id and snap.sale_id in active_sale_ids:
            continue
        _record_sale(
            snap.user_id,
            snap.total_price,
            bool(getattr(snap, 'is_renewal', False)),
            snap.product_name or '—',
            snap.product_id,
        )

    activity_totals = defaultdict(int)

    users_q = User.query
    if activity_user_ids:
        users_q = users_q.filter(User.id.in_(activity_user_ids))
    elif user_ids:
        users_q = users_q.filter(User.id.in_(user_ids))
    for u in users_q.all():
        for item in _iter_portal_activity(u, start, end):
            bucket = _activity_bucket(item.get('tipo'))
            activity_totals[bucket] += 1

    if scope == 'proveedor':
        proveedores_actividad = sales_count
    elif scope == 'user' and user_id:
        user_row = User.query.get(int(user_id))
        proveedores_actividad = (
            _count_proveedor_sales_in_period(start, end, int(user_id))
            if user_row and _user_is_proveedor(user_row)
            else 0
        )
    else:
        proveedores_actividad = _count_proveedor_sales_in_period(start, end, None)

    return {
        'success': True,
        'period': {
            'from': start.isoformat(),
            'to': end.isoformat(),
            'days': days,
        },
        'scope': scope,
        'user_id': int(user_id) if user_id else None,
        'proveedor_user_id': proveedor_user_id,
        'summary': {
            'ventas_total': sales_count,
            'renovaciones_tienda': renewals_count,
            'ingresos_cop': round(by_currency['COP']['total'], 2),
            'ingresos_usd': round(by_currency['USD']['total'], 2),
            'ventas_cop': by_currency['COP']['ventas'],
            'ventas_usd': by_currency['USD']['ventas'],
            'caidas_reportadas': activity_totals.get('caidas', 0),
            'garantias': activity_totals.get('garantias', 0),
            'renovaciones_portal': activity_totals.get('renovaciones_actividad', 0),
            'proveedores_ventas': proveedores_actividad,
        },
        'actividad_por_tipo': {
            'caidas': activity_totals.get('caidas', 0),
            'renovaciones_actividad': activity_totals.get('renovaciones_actividad', 0),
            'proveedores': proveedores_actividad,
        },
        'ingresos_por_moneda': [
            {
                'moneda': cur,
                'ventas': data['ventas'],
                'renovaciones': data['renovaciones'],
                'total': round(data['total'], 2),
            }
            for cur, data in sorted(
                by_currency.items(),
                key=lambda x: (0 if x[0] == 'COP' else 1, -x[1]['total']),
            )
            if data['ventas'] > 0
        ],
        'ventas_por_producto': [
            {
                'producto': k[0],
                'moneda': k[1],
                'ventas': v['ventas'],
                'renovaciones': v['renovaciones'],
                'proveedores': v['proveedores'],
                'total': round(v['total'], 2),
            }
            for k, v in sorted(by_product_sales.items(), key=lambda x: -x[1]['total'])
        ],
    }


def build_proveedor_sales_daily_summary_items(billing_user, *, utc_to_colombia_fn=None):
    """Delegado al módulo de resúmenes persistidos del proveedor."""
    from app.store.proveedor_daily_summaries import build_proveedor_sales_daily_summary_items as _build

    return _build(billing_user, utc_to_colombia_fn=utc_to_colombia_fn)
