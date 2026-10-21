# Catálogo y precios de tienda para sub-usuarios.
#
# Se guarda en ``User.user_prices['subuser_catalog']`` del sub-usuario:
#   {
#     "configured": true,          # tras el primer guardado / alta de tienda
#     "markup": 1000.0,            # suma general (COP) o 1.0 (USD)
#     "products": {
#       "12": {"enabled": true, "manual_price": null},
#       "15": {"enabled": true, "manual_price": 18000.0}
#     }
#   }
# Las plataformas no listadas (p. ej. nuevas) no se muestran hasta que el padre
# las active en el modal. Disney no está disponible para sub-usuarios.

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple

from app.extensions import db
from app.models.user import User

CATALOG_KEY = 'subuser_catalog'
# Plantilla global del padre: misma estructura que CATALOG_KEY, guardada en el
# user_prices del usuario principal. Al guardarla se copia a todos sus
# sub-usuarios (viejos) y se hereda al dar acceso a tienda a los nuevos.
GLOBAL_CATALOG_KEY = 'subuser_catalog_global'


def is_disney_product(product) -> bool:
    name = str(getattr(product, 'name', '') or '').strip().lower()
    return 'disney' in name


def default_markup_for_tipo(tipo: str) -> float:
    return 1.0 if (tipo or '').strip().upper() == 'USD' else 1000.0


def _as_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _money(value) -> float:
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        d = Decimal('0')
    if d < 0:
        d = Decimal('0')
    quantized = d.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    as_float = float(quantized)
    if abs(as_float - round(as_float)) < 1e-9:
        return float(int(round(as_float)))
    return as_float


def parent_unit_price(parent: User | None, product, tipo: str) -> float:
    """Precio real del padre (lista menos descuentos)."""
    if not product:
        return 0.0
    tipo_u = (tipo or '').strip().upper()
    disc_map: Dict[str, Any] = {}
    up = getattr(parent, 'user_prices', None) if parent else None
    if isinstance(up, dict):
        disc_map = up.get('descuentos_productos') or {}
    try:
        pid = int(product.id)
    except (TypeError, ValueError, AttributeError):
        pid = None
    d: Dict[str, Any] = {}
    if pid is not None:
        d = disc_map.get(str(pid)) or disc_map.get(pid) or {}
    if not isinstance(d, dict):
        d = {}
    if tipo_u == 'USD':
        raw = _as_float(getattr(product, 'price_usd', 0)) - _as_float(d.get('usd', 0))
    else:
        raw = _as_float(getattr(product, 'price_cop', 0)) - _as_float(d.get('cop', 0))
    return _money(max(0.0, raw))


def _parse_catalog_raw(raw) -> Dict[str, Any]:
    """Normaliza un catálogo guardado (del sub-usuario o global del padre)."""
    if not isinstance(raw, dict):
        return {'configured': False, 'markup': None, 'products': {}}
    products: Dict[str, Any] = {}
    src = raw.get('products')
    if isinstance(src, dict):
        for key, val in src.items():
            pid = str(key or '').strip()
            if not pid:
                continue
            if isinstance(val, dict):
                manual = val.get('manual_price')
                try:
                    manual_f = None if manual is None or manual == '' else _money(manual)
                except (TypeError, ValueError):
                    manual_f = None
                products[pid] = {
                    'enabled': bool(val.get('enabled')),
                    'manual_price': manual_f,
                }
            elif val:
                products[pid] = {'enabled': True, 'manual_price': None}
    markup_raw = raw.get('markup')
    markup = None if markup_raw is None or markup_raw == '' else _money(markup_raw)
    return {
        'configured': bool(raw.get('configured')),
        'markup': markup,
        'products': products,
    }


def get_subuser_catalog(sub_user: User | None) -> Dict[str, Any]:
    if not sub_user:
        return {'configured': False, 'markup': None, 'products': {}}
    up = sub_user.user_prices if isinstance(sub_user.user_prices, dict) else {}
    return _parse_catalog_raw(up.get(CATALOG_KEY))


def get_global_subuser_catalog(parent: User | None) -> Dict[str, Any]:
    """Plantilla global del padre (catálogo que se aplica a todos sus sub-usuarios)."""
    if not parent:
        return {'configured': False, 'markup': None, 'products': {}}
    up = parent.user_prices if isinstance(parent.user_prices, dict) else {}
    return _parse_catalog_raw(up.get(GLOBAL_CATALOG_KEY))


def sale_price_for_entry(
    parent_price: float,
    markup: float,
    manual_price: Optional[float],
) -> Tuple[float, bool]:
    """Devuelve (precio_venta, es_manual). Nunca menor que el precio del padre."""
    floor = _money(max(0.0, parent_price))
    if manual_price is not None:
        sale = _money(max(floor, _money(manual_price)))
        return sale, True
    sale = _money(floor + max(0.0, markup))
    if sale < floor:
        sale = floor
    return sale, False


def compute_sale_price(sub_user: User, product, tipo: str, parent: User | None = None) -> Optional[float]:
    """Precio de venta del sub o None si el producto no está habilitado / es Disney."""
    if not sub_user or not product or is_disney_product(product):
        return None
    if parent is None and getattr(sub_user, 'parent_id', None):
        parent = User.query.get(sub_user.parent_id)
    tipo_u = (tipo or '').strip().upper() or 'COP'
    cfg = get_subuser_catalog(sub_user)
    markup = cfg.get('markup')
    if markup is None:
        markup = default_markup_for_tipo(tipo_u)
    pid = str(getattr(product, 'id', '') or '')
    entry = (cfg.get('products') or {}).get(pid)
    if cfg.get('configured'):
        if not entry or not entry.get('enabled'):
            return None
        manual = entry.get('manual_price')
    else:
        # Sin configurar: todas las no-Disney con markup por defecto.
        manual = entry.get('manual_price') if entry else None
    parent_price = parent_unit_price(parent, product, tipo_u)
    sale, _manual = sale_price_for_entry(parent_price, float(markup), manual)
    return sale


def apply_subuser_sale_to_product(sub_user: User, product, tipo: str, parent: User | None = None) -> None:
    """Ajusta discount_*_extra para que precio_lista - descuento = precio de venta del sub."""
    sale = compute_sale_price(sub_user, product, tipo, parent)
    if sale is None or not product:
        return
    tipo_u = (tipo or '').strip().upper()
    if tipo_u == 'USD':
        list_price = _as_float(getattr(product, 'price_usd', 0))
        product.discount_usd_extra = list_price - sale
        product.discount_cop_extra = _as_float(getattr(product, 'discount_cop_extra', 0))
    else:
        list_price = _as_float(getattr(product, 'price_cop', 0))
        product.discount_cop_extra = list_price - sale
        product.discount_usd_extra = _as_float(getattr(product, 'discount_usd_extra', 0))


def filter_and_price_catalog_for_subuser(
    sub_user: User,
    products: List,
    tipo: str,
    parent: User | None = None,
) -> List:
    """Quita Disney y plataformas no habilitadas; aplica precio de venta."""
    if not sub_user:
        return []
    if parent is None and getattr(sub_user, 'parent_id', None):
        parent = User.query.get(sub_user.parent_id)
    tipo_u = (tipo or '').strip().upper() or 'COP'
    cfg = get_subuser_catalog(sub_user)
    configured = bool(cfg.get('configured'))
    saved = cfg.get('products') or {}
    out = []
    for product in products or []:
        if is_disney_product(product):
            continue
        pid = str(getattr(product, 'id', '') or '')
        if configured:
            entry = saved.get(pid)
            if not entry or not entry.get('enabled'):
                continue
        apply_subuser_sale_to_product(sub_user, product, tipo_u, parent)
        out.append(product)
    return out


def _set_user_prices_key(user: User, key: str, value: Dict[str, Any]) -> None:
    up = dict(user.user_prices) if isinstance(user.user_prices, dict) else {}
    up[key] = value
    user.user_prices = up


def _set_user_prices_catalog(sub_user: User, catalog: Dict[str, Any]) -> None:
    _set_user_prices_key(sub_user, CATALOG_KEY, catalog)


def _copy_catalog(catalog: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'configured': True,
        'markup': catalog.get('markup'),
        'products': {
            pid: {
                'enabled': bool(entry.get('enabled')),
                'manual_price': entry.get('manual_price'),
            }
            for pid, entry in (catalog.get('products') or {}).items()
            if isinstance(entry, dict)
        },
    }


def seed_subuser_catalog_if_needed(
    sub_user: User,
    parent: User,
    products: List,
    tipo: str,
) -> Dict[str, Any]:
    """Si aún no está configurado, hereda la plantilla global del padre; si no
    existe, habilita todas las no-Disney con el markup por defecto."""
    cfg = get_subuser_catalog(sub_user)
    if cfg.get('configured'):
        return cfg
    tipo_u = (tipo or '').strip().upper() or 'COP'

    global_cfg = get_global_subuser_catalog(parent)
    if global_cfg.get('configured'):
        saved = _copy_catalog(global_cfg)
        if saved.get('markup') is None:
            saved['markup'] = default_markup_for_tipo(tipo_u)
        _set_user_prices_catalog(sub_user, saved)
        db.session.add(sub_user)
        return saved

    markup = cfg.get('markup')
    if markup is None:
        markup = default_markup_for_tipo(tipo_u)
    products_map: Dict[str, Any] = {}
    for product in products or []:
        if is_disney_product(product):
            continue
        pid = str(getattr(product, 'id', '') or '')
        if not pid:
            continue
        products_map[pid] = {'enabled': True, 'manual_price': None}
    saved = {
        'configured': True,
        'markup': _money(markup),
        'products': products_map,
    }
    _set_user_prices_catalog(sub_user, saved)
    db.session.add(sub_user)
    return saved


def _validated_catalog_from_payload(
    parent: User,
    payload: Dict[str, Any],
    products: List,
    tipo: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Valida el payload del modal (precio manual nunca menor que el precio real)."""
    tipo_u = (tipo or '').strip().upper() or 'COP'
    default_markup = default_markup_for_tipo(tipo_u)
    markup = payload.get('markup')
    if markup is None or markup == '':
        markup_f = default_markup
    else:
        markup_f = _money(markup)
        if markup_f < 0:
            return None, 'El recargo no puede ser negativo.'

    allowed_ids = {
        str(getattr(p, 'id', ''))
        for p in (products or [])
        if not is_disney_product(p)
    }
    incoming = payload.get('products')
    if not isinstance(incoming, list):
        incoming = []
    products_map: Dict[str, Any] = {}
    for item in incoming:
        if not isinstance(item, dict):
            continue
        pid = str(item.get('id') or '').strip()
        if pid not in allowed_ids:
            continue
        product = next((p for p in products if str(p.id) == pid), None)
        if not product:
            continue
        parent_price = parent_unit_price(parent, product, tipo_u)
        enabled = bool(item.get('enabled'))
        manual_raw = item.get('manual_price')
        manual = None
        if item.get('manual') or (manual_raw is not None and manual_raw != ''):
            try:
                manual = _money(manual_raw)
            except (TypeError, ValueError):
                return None, f'Precio inválido en {getattr(product, "name", pid)}.'
            if manual < parent_price:
                return None, (
                    f'El precio de «{getattr(product, "name", pid)}» no puede ser menor '
                    f'que el precio real ({parent_price}).'
                )
        products_map[pid] = {'enabled': enabled, 'manual_price': manual}

    return {
        'configured': True,
        'markup': markup_f,
        'products': products_map,
    }, None


def save_subuser_catalog(
    sub_user: User,
    parent: User,
    payload: Dict[str, Any],
    products: List,
    tipo: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Valida y guarda el catálogo. Devuelve (catalog, error)."""
    saved, error = _validated_catalog_from_payload(parent, payload, products, tipo)
    if error:
        return None, error
    _set_user_prices_catalog(sub_user, saved)
    db.session.add(sub_user)
    return saved, None


def save_global_subuser_catalog(
    parent: User,
    payload: Dict[str, Any],
    products: List,
    tipo: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[str], int]:
    """Guarda la plantilla global del padre y la copia a TODOS sus sub-usuarios
    (nuevos y viejos). Devuelve (catalog, error, sub_usuarios_actualizados)."""
    saved, error = _validated_catalog_from_payload(parent, payload, products, tipo)
    if error:
        return None, error, 0
    _set_user_prices_key(parent, GLOBAL_CATALOG_KEY, saved)
    db.session.add(parent)

    applied = 0
    subs = User.query.filter(User.parent_id == parent.id).all()
    for sub in subs:
        _set_user_prices_catalog(sub, _copy_catalog(saved))
        db.session.add(sub)
        applied += 1
    return saved, None, applied


def apply_price_delta_to_subuser_catalogs(product_id, delta_cop, delta_usd) -> int:
    """Cuando el admin SUBE el precio base de un producto, suma ese mismo aumento
    a los precios manuales de los sub-usuarios y a las plantillas globales,
    según la moneda (tipo_precio) de cada padre. Nunca baja precios.
    Devuelve cuántos catálogos se actualizaron."""
    try:
        d_cop = max(0.0, float(delta_cop or 0))
    except (TypeError, ValueError):
        d_cop = 0.0
    try:
        d_usd = max(0.0, float(delta_usd or 0))
    except (TypeError, ValueError):
        d_usd = 0.0
    if d_cop <= 0 and d_usd <= 0:
        return 0

    pid = str(product_id)
    changed = 0

    def _bump_manual(user: User, key: str, delta: float) -> None:
        nonlocal changed
        up = user.user_prices if isinstance(user.user_prices, dict) else None
        if not up:
            return
        cat = up.get(key)
        if not isinstance(cat, dict):
            return
        prods = cat.get('products')
        if not isinstance(prods, dict):
            return
        entry = prods.get(pid)
        if not isinstance(entry, dict):
            return
        manual = entry.get('manual_price')
        if manual is None or manual == '':
            return
        new_entry = dict(entry)
        new_entry['manual_price'] = _money(_as_float(manual) + delta)
        new_prods = dict(prods)
        new_prods[pid] = new_entry
        new_cat = dict(cat)
        new_cat['products'] = new_prods
        new_up = dict(up)
        new_up[key] = new_cat
        user.user_prices = new_up
        db.session.add(user)
        changed += 1

    def _tipo_of(user: User | None) -> str:
        if not user or not isinstance(user.user_prices, dict):
            return ''
        return str(user.user_prices.get('tipo_precio') or '').strip().upper()

    tipo_by_parent: Dict[int, str] = {}
    parents = User.query.filter(User.parent_id.is_(None)).all()
    for parent in parents:
        tipo_u = _tipo_of(parent)
        tipo_by_parent[parent.id] = tipo_u
        if tipo_u not in ('USD', 'COP'):
            continue
        delta = d_usd if tipo_u == 'USD' else d_cop
        if delta > 0:
            _bump_manual(parent, GLOBAL_CATALOG_KEY, delta)

    subs = User.query.filter(User.parent_id.isnot(None)).all()
    for sub in subs:
        tipo_u = tipo_by_parent.get(sub.parent_id)
        if tipo_u is None:
            tipo_u = _tipo_of(User.query.get(sub.parent_id))
            tipo_by_parent[sub.parent_id] = tipo_u
        if tipo_u not in ('USD', 'COP'):
            continue
        delta = d_usd if tipo_u == 'USD' else d_cop
        if delta > 0:
            _bump_manual(sub, CATALOG_KEY, delta)
    return changed


def catalog_editor_payload(
    sub_user: User,
    parent: User,
    products: List,
    tipo: str,
) -> Dict[str, Any]:
    """JSON para el modal de edición: plataformas del padre, sin Disney."""
    return _editor_payload_from_cfg(get_subuser_catalog(sub_user), parent, products, tipo)


def global_catalog_editor_payload(
    parent: User,
    products: List,
    tipo: str,
) -> Dict[str, Any]:
    """JSON para el modal global (plantilla del padre aplicable a todos los subs)."""
    return _editor_payload_from_cfg(get_global_subuser_catalog(parent), parent, products, tipo)


def _editor_payload_from_cfg(
    cfg: Dict[str, Any],
    parent: User,
    products: List,
    tipo: str,
) -> Dict[str, Any]:
    tipo_u = (tipo or '').strip().upper() or 'COP'
    configured = bool(cfg.get('configured'))
    markup = cfg.get('markup')
    if markup is None:
        markup = default_markup_for_tipo(tipo_u)
    saved = cfg.get('products') or {}
    rows = []
    for product in products or []:
        if is_disney_product(product):
            continue
        pid = str(product.id)
        parent_price = parent_unit_price(parent, product, tipo_u)
        entry = saved.get(pid)
        if configured:
            enabled = bool(entry and entry.get('enabled'))
            manual = entry.get('manual_price') if entry else None
        else:
            enabled = True if not entry else bool(entry.get('enabled'))
            manual = entry.get('manual_price') if entry else None
        sale, is_manual = sale_price_for_entry(parent_price, float(markup), manual)
        rows.append({
            'id': int(product.id),
            'name': product.name,
            'parent_price': parent_price,
            'sale_price': sale,
            'enabled': enabled,
            'manual': is_manual and manual is not None,
            'manual_price': manual,
        })
    return {
        'tipo_precio': tipo_u,
        'currency_label': 'USD' if tipo_u == 'USD' else 'COP',
        'default_markup': default_markup_for_tipo(tipo_u),
        'markup': markup,
        'configured': configured,
        'products': rows,
    }
