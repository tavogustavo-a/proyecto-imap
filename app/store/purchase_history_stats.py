# Estadísticas de historial de compras (admin y usuario propio).

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone

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
    """
    start, end = _parse_period(date_from, date_to, days)
    user_ids = _resolve_user_ids(scope, user_id)
    if scope == 'user' and not user_ids:
        return {'success': False, 'error': 'Usuario no encontrado.'}

    sales_count = 0
    renewals_count = 0
    by_currency = defaultdict(lambda: {'ventas': 0, 'renovaciones': 0, 'total': 0.0})
    by_product_sales = defaultdict(lambda: {'ventas': 0, 'renovaciones': 0, 'total': 0.0})

    def _record_sale(user_id, amount, is_ren, pname):
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

    sale_q = Sale.query.filter(Sale.created_at >= start, Sale.created_at <= end)
    if user_ids:
        sale_q = sale_q.filter(Sale.user_id.in_(user_ids))
    sales_list = sale_q.all()
    snap_q = SalePurchaseSnapshot.query.filter(
        SalePurchaseSnapshot.purged_from_sales.is_(True),
        SalePurchaseSnapshot.sale_created_at >= start,
        SalePurchaseSnapshot.sale_created_at <= end,
    )
    if user_ids:
        snap_q = snap_q.filter(SalePurchaseSnapshot.user_id.in_(user_ids))
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
        )

    for snap in snaps_list:
        if snap.sale_id and snap.sale_id in active_sale_ids:
            continue
        _record_sale(
            snap.user_id,
            snap.total_price,
            bool(getattr(snap, 'is_renewal', False)),
            snap.product_name or '—',
        )

    activity_totals = defaultdict(int)

    users_q = User.query
    if user_ids:
        users_q = users_q.filter(User.id.in_(user_ids))
    for u in users_q.all():
        for item in _iter_portal_activity(u, start, end):
            bucket = _activity_bucket(item.get('tipo'))
            activity_totals[bucket] += 1

    return {
        'success': True,
        'period': {
            'from': start.isoformat(),
            'to': end.isoformat(),
            'days': days,
        },
        'scope': scope,
        'user_id': int(user_id) if user_id else None,
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
        },
        'actividad_por_tipo': {
            'caidas': activity_totals.get('caidas', 0),
            'renovaciones_actividad': activity_totals.get('renovaciones_actividad', 0),
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
                'total': round(v['total'], 2),
            }
            for k, v in sorted(by_product_sales.items(), key=lambda x: -x[1]['total'])
        ],
    }
