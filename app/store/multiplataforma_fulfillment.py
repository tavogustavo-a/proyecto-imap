# -*- coding: utf-8 -*-
"""Entrega y renovación de cuentas del proveedor Multiplataforma en la tienda.

Reglas del admin:
- La API solo se usa como respaldo cuando el stock interno vendible está en
  ceros (cuentas propias de todas las licencias del producto + proveedores
  internos; la reserva de garantía no cuenta como vendible).
- Las compras a la API se ejecutan AL FINAL del checkout, cuando todo lo demás
  ya quedó validado y asignado, y en UNA sola llamada atómica (todo o nada):
  así un fallo de otro producto no deja pagos hechos al proveedor.
- Línea del bloc: «correo contraseña» y, solo si trae PIN,
  «correo contraseña perfil pin». Nota Perfil/PIN solo si existe PIN.
- Caducidad 30/60 días según las fechas reales de la compra.
- Renovaciones: la API las procesa como SOLICITUDES con revisión manual. Al
  pagar se envía la solicitud (si falla, el pago se aborta); un job revisa
  periódicamente y al aprobarse extiende la cuenta y avisa; si no se aprueba,
  avisa a los admins.
- Saldo bajo: tras cada compra se compara el saldo del vendedor contra el
  umbral configurado y se notifica a los admins (con antirebote de 6 h).
"""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta

from flask import current_app

from app import db

from .multiplataforma_api import (
    MultiplataformaApiError,
    _get_setting,
    _set_setting,
    buy_cart_checkout_items,
    format_license_line,
    format_license_note,
    get_link_for_license,
    get_market,
    get_profile,
    get_renewal_options,
    has_credentials,
    purchase_days,
    request_renewal,
)

_LINE_SEP = '\x1f'

# Límites de /cart/checkout/ según la API.
_MAX_PER_LINE = 10
_MAX_LINES_PER_ORDER = 20
_MAX_ACCOUNTS_PER_ORDER = 30

MP_SETTING_PENDING_RENEWALS = 'multiplataforma_pending_renewals'
MP_SETTING_LOW_BALANCE_THRESHOLD = 'multiplataforma_low_balance_threshold'
MP_SETTING_LOW_BALANCE_LAST_NOTIFY = 'multiplataforma_low_balance_last_notify'

_DEFAULT_LOW_BALANCE_THRESHOLD = 20000.0
_LOW_BALANCE_NOTIFY_EVERY_SECONDS = 6 * 3600

# Si una solicitud de renovación deja de aparecer «en revisión» sin cambio de
# fecha antes de este margen, se asume que la API aún no la registró.
_RENEWAL_MIN_AGE_FOR_REJECT_SECONDS = 15 * 60
# Solicitudes sin resolución tras este plazo: se avisa al admin y se descartan
# (regla del admin: máximo 2 días de espera al proveedor, no más).
_RENEWAL_MAX_AGE_SECONDS = 2 * 24 * 3600

# Caché de stock del mercado por plataforma (evita llamar a la API en cada
# consulta de stock de la tienda).
_STOCK_TTL_SECONDS = 60
_STOCK_FAIL_TTL_SECONDS = 180
_stock_cache_lock = threading.Lock()
_stock_cache = {}  # platform_id -> {'ts': float, 'plans': {plan_id: stock}, 'failed': bool}


class MpPurchaseClientError(Exception):
    """Error de compra/renovación con mensaje apto para el cliente de la tienda."""


def _no_stock_message(product_name):
    return (
        f'Sin stock del proveedor para «{product_name}» en este momento. '
        'Avísale al admin que suba stock e inténtalo de nuevo.'
    )


def _delivery_failed_message(product_name):
    return (
        f'La compra de «{product_name}» con el proveedor no se completó. '
        'Avísale al admin para revisar la entrega.'
    )


def _parse_api_datetime(value):
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Stock virtual (mercado con caché)
# ---------------------------------------------------------------------------

def _extract_market_plan_stocks(market_data):
    """{plan_id: stock} a partir de la respuesta del mercado."""
    plans = []
    if isinstance(market_data, list):
        plans = market_data
    elif isinstance(market_data, dict):
        for key in ('plans', 'market', 'results'):
            if isinstance(market_data.get(key), list):
                plans = market_data[key]
                break
        else:
            for value in market_data.values():
                if isinstance(value, list):
                    plans = value
                    break
    out = {}
    for plan in plans:
        if not isinstance(plan, dict):
            continue
        pid = plan.get('id', plan.get('plan_id'))
        stock = plan.get('stock', plan.get('stock_available'))
        try:
            out[int(pid)] = max(0, int(stock))
        except (TypeError, ValueError):
            continue
    return out


def _market_plan_stocks_cached(platform_id):
    try:
        platform_id = int(platform_id)
    except (TypeError, ValueError):
        return {}
    now = time.time()
    with _stock_cache_lock:
        entry = _stock_cache.get(platform_id)
        if entry:
            ttl = _STOCK_FAIL_TTL_SECONDS if entry.get('failed') else _STOCK_TTL_SECONDS
            if (now - entry['ts']) < ttl:
                return entry['plans']
    try:
        plans = _extract_market_plan_stocks(get_market(platform_id))
        failed = False
    except MultiplataformaApiError:
        plans = {}
        failed = True
    except Exception:
        current_app.logger.exception('MP: error consultando mercado %s', platform_id)
        plans = {}
        failed = True
    with _stock_cache_lock:
        _stock_cache[platform_id] = {'ts': now, 'plans': plans, 'failed': failed}
    return plans


def invalidate_stock_cache():
    with _stock_cache_lock:
        _stock_cache.clear()


def mp_public_stock_for_license(license_row):
    """Stock del plan Multiplataforma vinculado a esta licencia (0 si no aplica)."""
    try:
        if not has_credentials():
            return 0
        plan_id, info = get_link_for_license(license_row.id)
        if not plan_id:
            return 0
        platform_id = (info or {}).get('platform_id')
        if not platform_id:
            return 0
        stocks = _market_plan_stocks_cached(platform_id)
        return int(stocks.get(int(plan_id), 0))
    except Exception:
        current_app.logger.debug(
            'MP: stock virtual falló license_id=%s',
            getattr(license_row, 'id', None),
            exc_info=True,
        )
        return 0


# ---------------------------------------------------------------------------
# Compras en checkout (dos fases: preparar → ejecutar al final)
# ---------------------------------------------------------------------------

def mp_prepare_shortfall(license_row, producto, venta, quantity):
    """Fase 1: valida y arma el ítem de compra pendiente para una licencia.

    Devuelve el dict del ítem o None si esta licencia no puede cubrir nada
    (sin vínculo o sin credenciales). No llama a la API ni gasta saldo.
    """
    try:
        quantity = int(quantity)
    except (TypeError, ValueError):
        return None
    if quantity <= 0 or not has_credentials():
        return None
    plan_id, link_info = get_link_for_license(license_row.id)
    if not plan_id:
        return None
    if quantity > _MAX_PER_LINE:
        raise MpPurchaseClientError(
            f'Solo se pueden comprar hasta {_MAX_PER_LINE} cuentas de '
            f'«{producto.name}» por pedido en este momento. Reduce la cantidad.'
        )
    default_days = 30
    try:
        if int((link_info or {}).get('days') or 0) > 0:
            default_days = int(link_info['days'])
    except (TypeError, ValueError):
        pass
    return {
        'plan_id': int(plan_id),
        'quantity': quantity,
        'license': license_row,
        'producto': producto,
        'venta': venta,
        'default_days': default_days,
    }


def _purchases_by_plan(order_data):
    """{plan_id: [purchases]} de la respuesta de /cart/checkout/."""
    out = {}
    if not isinstance(order_data, dict):
        return out
    lines = order_data.get('lines') or []
    for line in lines:
        if not isinstance(line, dict):
            continue
        try:
            pid = int(line.get('plan_id'))
        except (TypeError, ValueError):
            continue
        for p in line.get('purchases') or []:
            if isinstance(p, dict):
                out.setdefault(pid, []).append(p)
    if not out:
        # Respaldo: purchases a nivel raíz (sin plan por línea). Solo sirve
        # cuando el pedido tiene un único plan.
        root = [p for p in (order_data.get('purchases') or []) if isinstance(p, dict)]
        if root:
            out[None] = root
    return out


def _set_day_line_note(storage_line, note):
    """Escribe la nota en el campo «extra» (índice 4) de la línea del Día N."""
    if not note:
        return storage_line
    parts = str(storage_line or '').split(_LINE_SEP)
    while len(parts) < 5:
        parts.append('')
    parts[4] = (parts[4] + ' | ' + note) if parts[4].strip() else note
    return _LINE_SEP.join(parts)


def _assign_purchase_to_client(item, purchase, user, sold_bloc_moves, cuentas_asignadas):
    """Crea la LicenseAccount de una cuenta comprada y la asigna al cliente."""
    from app.store.routes_licencias import (
        _create_license_account_available_from_cred,
        _public_checkout_assign_license_account,
    )

    license_row = item['license']
    producto = item['producto']

    cred_line = format_license_line(purchase)
    account = _create_license_account_available_from_cred(license_row, cred_line)
    if account is None:
        current_app.logger.error(
            'MP: cuenta comprada ilegible (sale_id=%s): %r',
            purchase.get('sale_id'), cred_line,
        )
        raise MpPurchaseClientError(_delivery_failed_message(producto.name))
    if not _public_checkout_assign_license_account(
        account,
        license_row,
        user,
        item['venta'],
        producto,
        sold_bloc_moves,
        cuentas_asignadas,
    ):
        raise MpPurchaseClientError(_delivery_failed_message(producto.name))

    days = purchase_days(purchase, default_days=item.get('default_days') or 30)
    account.expires_at = datetime.utcnow() + timedelta(days=days)
    try:
        account.mp_sale_id = int(purchase.get('sale_id') or 0) or None
    except (TypeError, ValueError):
        account.mp_sale_id = None

    # Nota Perfil/PIN en la línea del Día N (solo si la cuenta trae PIN).
    note = format_license_note(purchase)
    if note and sold_bloc_moves:
        move = sold_bloc_moves[-1]
        move['storage_line_for_day'] = _set_day_line_note(
            move.get('storage_line_for_day'), note
        )


def mp_execute_pending_purchases(pending, user, sold_bloc_moves, cuentas_asignadas):
    """Fase 2: compra TODO el faltante del pedido en una sola llamada atómica.

    Si la API rechaza (saldo/stock), no se cobra nada al vendedor y se lanza
    ``MpPurchaseClientError`` para abortar el checkout completo.
    """
    from app.store.routes_licencias import _ensure_license_account_mp_sale_id_column

    if not pending:
        return 0

    total_accounts = sum(int(it['quantity']) for it in pending)
    if total_accounts > _MAX_ACCOUNTS_PER_ORDER:
        raise MpPurchaseClientError(
            f'El pedido pide {total_accounts} cuentas del proveedor y el máximo '
            f'por compra es {_MAX_ACCOUNTS_PER_ORDER}. Reduce la cantidad.'
        )
    if len(pending) > _MAX_LINES_PER_ORDER:
        raise MpPurchaseClientError(
            f'El pedido incluye {len(pending)} productos del proveedor y el '
            f'máximo por compra es {_MAX_LINES_PER_ORDER}. Divide el pedido.'
        )

    _ensure_license_account_mp_sale_id_column()
    customer = (getattr(user, 'username', '') or 'Cliente').strip() or 'Cliente'
    items = [
        {'plan_id': it['plan_id'], 'quantity': it['quantity'], 'customer': customer}
        for it in pending
    ]

    try:
        order = buy_cart_checkout_items(items)
    except MultiplataformaApiError as exc:
        current_app.logger.warning('MP: compra atómica falló items=%r: %s', items, exc)
        invalidate_stock_cache()
        product_name = pending[0]['producto'].name
        if exc.code in ('rate_limited', 'local_rate_limit'):
            raise MpPurchaseClientError(
                'El proveedor está recibiendo muchas compras en este momento. '
                'Espera un minuto e inténtalo de nuevo (no se hizo ningún cobro).'
            )
        if 'saldo' in str(exc).lower():
            # Saldo del vendedor insuficiente: no es culpa del cliente ni falta
            # de stock. Avisar a los admins para recargar. El checkout se va a
            # abortar (rollback en el llamador), así que se descarta la sesión
            # primero y se persiste SOLO el aviso.
            try:
                from app.store.store_event_notify import notify_admins_app

                db.session.rollback()
                notify_admins_app(
                    kind='admin_mp_low_balance',
                    title='Compra rechazada por saldo (Multiplataforma)',
                    body=(
                        'Una compra de «%s» falló por saldo insuficiente del '
                        'vendedor. Recarga en multiplataforma.co.' % product_name
                    ),
                    payload={'url': '/tienda/admin/proveedores-para-anadir-fuera'},
                )
                db.session.commit()
            except Exception:
                db.session.rollback()
                current_app.logger.exception('MP: no se pudo avisar saldo insuficiente')
            raise MpPurchaseClientError(
                f'La compra de «{product_name}» no está disponible en este '
                'momento. Avísale al admin e inténtalo más tarde.'
            )
        raise MpPurchaseClientError(_no_stock_message(product_name))

    by_plan = _purchases_by_plan(order)
    generic = list(by_plan.get(None) or [])

    assigned = 0
    for item in pending:
        plan_purchases = by_plan.get(int(item['plan_id']))
        if plan_purchases is None and generic:
            plan_purchases = generic
        plan_purchases = plan_purchases or []
        if len(plan_purchases) < int(item['quantity']):
            current_app.logger.error(
                'MP: faltaron cuentas del plan %s (esperadas %s, llegaron %s). '
                'Respuesta: %r',
                item['plan_id'], item['quantity'], len(plan_purchases), order,
            )
            raise MpPurchaseClientError(
                _delivery_failed_message(item['producto'].name)
            )
        for _ in range(int(item['quantity'])):
            purchase = plan_purchases.pop(0)
            _assign_purchase_to_client(
                item, purchase, user, sold_bloc_moves, cuentas_asignadas
            )
            assigned += 1

    db.session.flush()
    invalidate_stock_cache()
    return assigned


# ---------------------------------------------------------------------------
# Renovaciones vía API (solicitud al pagar + job que espera la aprobación)
#
# Regla del admin: SOLO se renuevan Plex, Emby y Jellyfin (todos los planes)
# e IPTV únicamente el plan «cuenta completa» (3 dispositivos). El resto de
# plataformas del proveedor no se renuevan (la revisión manual crea
# conflictos): esas cuentas vencen y el cliente compra una nueva.
# ---------------------------------------------------------------------------

_RENEWABLE_PLATFORM_KEYWORDS = ('plex', 'emby', 'jellyfin')


def mp_renewal_supported_names(platform_name, plan_name):
    """True si la plataforma/plan admite renovación según la regla del admin."""
    p = str(platform_name or '').strip().lower()
    pl = str(plan_name or '').strip().lower()
    if any(k in p for k in _RENEWABLE_PLATFORM_KEYWORDS):
        return True
    if 'iptv' in p:
        return ('completa' in pl) or ('3 dispositivo' in pl) or ('3 disp' in pl)
    return False


def mp_account_renewal_supported(account):
    """True si esta cuenta comprada al proveedor se puede renovar vía API.

    Usa los nombres de plataforma/plan guardados en el vínculo del producto
    (tal como los devuelve la API). Sin vínculo o sin nombres → no renovable.
    """
    if not getattr(account, 'mp_sale_id', None):
        return False
    try:
        _plan_id, info = get_link_for_license(account.license_id)
    except Exception:
        return False
    if not info:
        return False
    return mp_renewal_supported_names(
        info.get('platform_name'), info.get('plan_name')
    )


def mp_account_has_pending_renewal(account_id):
    """True si la cuenta tiene una solicitud de renovación en revisión."""
    try:
        return str(int(account_id)) in _get_pending_renewals()
    except (TypeError, ValueError):
        return False

def _get_pending_renewals():
    raw = _get_setting(MP_SETTING_PENDING_RENEWALS)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_pending_renewals(pending):
    """Guarda el registro SIN commit: dentro del checkout lo persiste el commit
    final del pago; en el job lo persiste su propio commit."""
    from app.store.models import StoreSetting

    value = json.dumps(pending, ensure_ascii=False)
    row = StoreSetting.query.filter_by(key=MP_SETTING_PENDING_RENEWALS).first()
    if row is None:
        db.session.add(StoreSetting(key=MP_SETTING_PENDING_RENEWALS, value=value))
    else:
        row.value = value


def mp_validate_renewal(account, producto):
    """Valida en la API que la venta se puede renovar (no crea la solicitud).

    Devuelve el dict de opciones. Lanza ``MpPurchaseClientError`` si no se
    puede solicitar ahora (el checkout debe abortar sin cobrar).
    """
    sale_id = getattr(account, 'mp_sale_id', None)
    if not sale_id:
        raise MpPurchaseClientError(
            f'La cuenta de «{producto.name}» no se puede renovar por este medio.'
        )
    if not mp_account_renewal_supported(account):
        raise MpPurchaseClientError(
            f'Esta cuenta de «{producto.name}» no admite renovación. '
            'Cuando venza, compra una cuenta nueva.'
        )
    if not has_credentials():
        raise MpPurchaseClientError(
            f'La renovación de «{producto.name}» no está disponible ahora. '
            'Avísale al admin.'
        )
    try:
        options = get_renewal_options(sale_id) or {}
    except MultiplataformaApiError as exc:
        current_app.logger.warning('MP: opciones de renovación %s: %s', sale_id, exc)
        raise MpPurchaseClientError(
            f'La renovación de «{producto.name}» no está disponible ahora. '
            'Avísale al admin e inténtalo más tarde.'
        )
    if options.get('pending_renovation'):
        raise MpPurchaseClientError(
            f'Ya hay una renovación en proceso para esta cuenta de '
            f'«{producto.name}». Espera a que se complete.'
        )
    if not options.get('can_request'):
        reason = str(options.get('reason') or '').strip()
        current_app.logger.warning(
            'MP: renovación no permitida sale_id=%s reason=%r', sale_id, reason
        )
        raise MpPurchaseClientError(
            f'El proveedor no permite renovar esta cuenta de «{producto.name}» '
            'en este momento. Avísale al admin.'
        )
    return options


def mp_execute_pending_renewals(pending_renewals, user, cuentas_asignadas):
    """Envía las solicitudes de renovación a la API y las registra como pendientes.

    Si alguna falla, lanza ``MpPurchaseClientError`` (el checkout aborta y el
    cliente no paga). La extensión de la cuenta ocurre cuando el job confirma
    que la API completó la renovación.
    """
    if not pending_renewals:
        return 0

    registry = _get_pending_renewals()
    sent = 0
    for item in pending_renewals:
        account = item['account']
        producto = item['producto']
        options = item.get('options') or {}
        sale_id = int(getattr(account, 'mp_sale_id', 0) or 0)
        try:
            request_renewal(
                sale_id,
                message='Renovación solicitada por el cliente %s'
                % ((getattr(user, 'username', '') or '').strip() or 'de la tienda'),
            )
        except MultiplataformaApiError as exc:
            current_app.logger.warning(
                'MP: solicitud de renovación falló sale_id=%s: %s', sale_id, exc
            )
            raise MpPurchaseClientError(
                f'No se pudo enviar la renovación de «{producto.name}» al '
                'proveedor. No se hizo el cobro; inténtalo de nuevo.'
            )

        days = 30
        _plan_id, link_info = get_link_for_license(account.license_id)
        try:
            if int((link_info or {}).get('days') or 0) > 0:
                days = int(link_info['days'])
        except (TypeError, ValueError):
            pass

        registry[str(account.id)] = {
            'account_id': int(account.id),
            'mp_sale_id': sale_id,
            'user_id': int(getattr(user, 'id', 0) or 0),
            'license_id': int(account.license_id),
            'product_name': producto.name,
            'email': (account.email or '').strip(),
            'requested_at': time.time(),
            'old_date_limit': str(options.get('date_limit') or ''),
            'days': days,
        }
        cuentas_asignadas.append({
            'producto': producto.name,
            'email': account.email,
            'password': account.password,
            'identifier': account.account_identifier,
            'renovacion_en_proceso': True,
        })
        sent += 1

    _save_pending_renewals(registry)
    return sent


def mp_send_renewal_request_for_account(account, product_name='', user_id=0):
    """Envía a la API la solicitud de renovación de una cuenta ya cobrada
    (renovación automática del verde en el bloc del día).

    Devuelve (ok, motivo). Sin commit: lo persiste el commit del llamador.
    Si ya hay una solicitud en revisión para esa venta, no envía otra.
    """
    sale_id = int(getattr(account, 'mp_sale_id', 0) or 0)
    if not sale_id or not has_credentials():
        return False, 'sin_credenciales'
    if mp_account_has_pending_renewal(account.id):
        return True, 'ya_pendiente'
    try:
        options = get_renewal_options(sale_id) or {}
        if options.get('pending_renovation'):
            return True, 'ya_pendiente'
        if not options.get('can_request'):
            return False, str(options.get('reason') or 'no_permitida')
        request_renewal(sale_id, message='Renovación automática de la tienda')
    except MultiplataformaApiError as exc:
        current_app.logger.warning(
            'MP: solicitud automática de renovación falló sale_id=%s: %s',
            sale_id, exc,
        )
        return False, str(exc)

    days = 30
    _plan_id, link_info = get_link_for_license(account.license_id)
    try:
        if int((link_info or {}).get('days') or 0) > 0:
            days = int(link_info['days'])
    except (TypeError, ValueError):
        pass

    registry = _get_pending_renewals()
    registry[str(account.id)] = {
        'account_id': int(account.id),
        'mp_sale_id': sale_id,
        'user_id': int(user_id or 0),
        'license_id': int(account.license_id),
        'product_name': str(product_name or ''),
        'email': (account.email or '').strip(),
        'requested_at': time.time(),
        'old_date_limit': str(options.get('date_limit') or ''),
        'days': days,
    }
    _save_pending_renewals(registry)
    return True, ''


def _notify_renewal_result(entry, approved, detail=''):
    try:
        from app.store.store_event_notify import _add_notification, notify_admins_app

        pname = entry.get('product_name') or 'Producto'
        email = entry.get('email') or 'cuenta'
        if approved:
            title = 'Renovación completada'
            body = f'{pname} · {email}: el proveedor aprobó la renovación.'
        else:
            title = 'Renovación NO aprobada'
            body = (
                f'{pname} · {email}: el proveedor no aprobó la renovación. '
                'Revisa y reembolsa al cliente si aplica.'
            )
        if detail:
            body += ' ' + detail
        notify_admins_app(
            kind='admin_mp_renewal_result',
            title=title + ' (Multiplataforma)',
            body=body,
            payload={'url': '/tienda/admin'},
        )
        uid = int(entry.get('user_id') or 0)
        if uid:
            _add_notification(
                user_id=uid,
                kind='store_renewal',
                title=title,
                body=(
                    f'Tu renovación de {pname} ({email}) fue completada.'
                    if approved
                    else f'Tu renovación de {pname} ({email}) no fue aprobada. '
                         'Contacta al admin.'
                ),
            )
    except Exception:
        current_app.logger.exception('MP: no se pudo notificar renovación')


def process_pending_mp_renewals():
    """Job periódico: revisa las solicitudes de renovación enviadas a la API.

    - Sigue «en revisión» → esperar.
    - date_limit cambió → aprobada: extiende expires_at y notifica.
    - Dejó de estar en revisión sin cambio de fecha (con margen) → rechazada:
      notifica a los admins para reembolsar.
    """
    registry = _get_pending_renewals()
    if not registry:
        return {'processed': 0, 'pending': 0}
    if not has_credentials():
        return {'processed': 0, 'pending': len(registry)}

    from app.store.models import LicenseAccount

    now = time.time()
    processed = 0
    changed = False

    for key in list(registry.keys()):
        entry = registry.get(key) or {}
        sale_id = int(entry.get('mp_sale_id') or 0)
        if not sale_id:
            registry.pop(key, None)
            changed = True
            continue
        age = now - float(entry.get('requested_at') or now)
        try:
            options = get_renewal_options(sale_id) or {}
        except MultiplataformaApiError as exc:
            current_app.logger.warning(
                'MP: job renovaciones no pudo consultar sale_id=%s: %s', sale_id, exc
            )
            if age > _RENEWAL_MAX_AGE_SECONDS:
                _notify_renewal_result(
                    entry, approved=False,
                    detail='(sin respuesta del proveedor tras 2 días)',
                )
                registry.pop(key, None)
                processed += 1
                changed = True
            continue

        new_limit = str(options.get('date_limit') or '')
        old_limit = str(entry.get('old_date_limit') or '')
        limit_changed = bool(new_limit) and new_limit != old_limit
        if limit_changed:
            old_dt = _parse_api_datetime(old_limit)
            new_dt = _parse_api_datetime(new_limit)
            if old_dt and new_dt and new_dt <= old_dt:
                limit_changed = False

        if limit_changed:
            # Aprobada: extender la cuenta local.
            account = LicenseAccount.query.get(int(entry.get('account_id') or 0))
            if account is not None:
                new_dt = _parse_api_datetime(new_limit)
                if new_dt is not None:
                    account.expires_at = new_dt.replace(tzinfo=None)
                else:
                    base = account.expires_at or datetime.utcnow()
                    if base < datetime.utcnow():
                        base = datetime.utcnow()
                    account.expires_at = base + timedelta(
                        days=int(entry.get('days') or 30)
                    )
                account.updated_at = datetime.utcnow()
            _notify_renewal_result(entry, approved=True)
            registry.pop(key, None)
            processed += 1
            changed = True
            continue

        if options.get('pending_renovation'):
            if age > _RENEWAL_MAX_AGE_SECONDS:
                _notify_renewal_result(
                    entry, approved=False,
                    detail='(sigue en revisión tras 2 días; revisa y reembolsa '
                           'al cliente si aplica)',
                )
                registry.pop(key, None)
                processed += 1
                changed = True
            continue

        # Ya no está en revisión y la fecha no cambió → rechazada
        # (con margen para que la API alcance a registrar la solicitud).
        if age > _RENEWAL_MIN_AGE_FOR_REJECT_SECONDS:
            _notify_renewal_result(entry, approved=False)
            registry.pop(key, None)
            processed += 1
            changed = True

    if changed:
        _save_pending_renewals(registry)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            current_app.logger.exception('MP: commit del job de renovaciones falló')

    return {'processed': processed, 'pending': len(registry)}


# ---------------------------------------------------------------------------
# Aviso proactivo de saldo bajo
# ---------------------------------------------------------------------------

def get_low_balance_threshold():
    raw = _get_setting(MP_SETTING_LOW_BALANCE_THRESHOLD)
    if raw is None or str(raw).strip() == '':
        return _DEFAULT_LOW_BALANCE_THRESHOLD
    try:
        return max(0.0, float(raw))
    except (TypeError, ValueError):
        return _DEFAULT_LOW_BALANCE_THRESHOLD


def set_low_balance_threshold(value):
    try:
        value = max(0.0, float(value))
    except (TypeError, ValueError):
        value = _DEFAULT_LOW_BALANCE_THRESHOLD
    _set_setting(MP_SETTING_LOW_BALANCE_THRESHOLD, repr(value))
    return value


def check_low_balance_and_notify(balance=None):
    """Notifica a los admins si el saldo del vendedor está bajo el umbral.

    Con antirebote: máximo un aviso cada 6 horas; el marcador se limpia cuando
    el saldo vuelve a estar por encima del umbral. Seguro de llamar tras el
    commit del checkout (hace su propio commit).
    """
    threshold = get_low_balance_threshold()
    if threshold <= 0:
        return False
    try:
        if balance is None:
            profile = get_profile() or {}
            balance = profile.get('balance')
        balance = float(balance)
    except (MultiplataformaApiError, TypeError, ValueError):
        return False

    if balance >= threshold:
        if _get_setting(MP_SETTING_LOW_BALANCE_LAST_NOTIFY):
            _set_setting(MP_SETTING_LOW_BALANCE_LAST_NOTIFY, '')
        return False

    last_raw = _get_setting(MP_SETTING_LOW_BALANCE_LAST_NOTIFY)
    try:
        last = float(last_raw) if last_raw else 0.0
    except (TypeError, ValueError):
        last = 0.0
    now = time.time()
    if (now - last) < _LOW_BALANCE_NOTIFY_EVERY_SECONDS:
        return False

    try:
        from app.store.store_event_notify import notify_admins_app

        notify_admins_app(
            kind='admin_mp_low_balance',
            title='Saldo bajo en Multiplataforma',
            body=(
                'El saldo del vendedor en multiplataforma.co es %s y el umbral '
                'de aviso es %s. Recarga para no perder ventas.'
                % (f'{balance:,.0f}'.replace(',', '.'),
                   f'{threshold:,.0f}'.replace(',', '.'))
            ),
            payload={'url': '/tienda/admin/proveedores-para-anadir-fuera'},
        )
        _set_setting(MP_SETTING_LOW_BALANCE_LAST_NOTIFY, repr(now))
        db.session.commit()
        return True
    except Exception:
        db.session.rollback()
        current_app.logger.exception('MP: no se pudo notificar saldo bajo')
        return False
