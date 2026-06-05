from flask import render_template, request, redirect, url_for, flash, jsonify, current_app, session, Response, stream_template, send_file, send_from_directory, stream_with_context, g, abort, make_response
from app.utils.timezone import get_colombia_now, colombia_strftime, utc_to_colombia, get_colombia_datetime, timesince
# Importa tus modelos y db. Asumo nombres comunes, ajústalos si es necesario.
from .models import Product, Sale, Coupon, coupon_products, ProductionLink, ApiInfo, WorksheetTemplate, WorksheetData, WorksheetPermission, DriveTransfer, WhatsAppConfig, GSheetsLink, SMSConfig, SMSMessage, AllowedSMSNumber, SMSRegex, TwoFAConfig

# Identificadores internos del módulo store
_STORE_MODULE_IDENTIFIER = 0x7C8D
_STORE_MODULE_CHECKSUM = 0x9E0F
from app import db
from . import store_bp  # Importa el blueprint ya creado en __init__.py

# Importar CSRF para excluir APIs compartidas
def csrf_exempt_route(func):
    """Decorator para excluir rutas del CSRF"""
    # Marcar la función para exención de CSRF
    func._csrf_exempt = True
    return func
from app.models.user import User, AllowedEmail
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy import func as sa_func, or_
from app.store.models import ToolInfo, HtmlInfo, YouTubeListing, StoreSetting
import requests
import time
import secrets
import os
import re

import json
from datetime import datetime, timedelta, timezone
try:
    from app.store.socketio_events import emit_chat_deleted_event
except ImportError:
    # Si no se puede importar, definir función dummy
    def emit_chat_deleted_event(*args, **kwargs):
        return False


def _attach_private_no_cache_headers(resp):
    """
    JSON autenticado de la tienda: sin esto algunos navegadores cachean GET /tienda/api/...
    y se ven datos viejos hasta borrar cookies o forzar recarga dura (304 «Not Modified»).
    """
    if resp is None or not getattr(resp, 'headers', None):
        return resp
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    resp.headers['Vary'] = 'Cookie'
    return resp


def user_has_worksheet_access(user):
    """
    Verifica si un usuario tiene acceso a hojas de cálculo.
    Solo usuarios normales (no sub-usuarios) pueden tener acceso.
    """
    if not user or user.parent_id is not None:
        return False
    
    # Verificar si el usuario tiene permisos de worksheet
    try:
        from app.store.models import WorksheetPermission
        worksheet_permissions = WorksheetPermission.query.filter_by(access_type='users').all()
        for permission in worksheet_permissions:
            if user in permission.users.all():
                return True
        return False
    except Exception as e:
        return False

def get_current_user():
    """
    Obtiene el usuario actual de la sesión de forma robusta
    """
    username = session.get('username')
    user_id = session.get('user_id')
    
    if username:
        return User.query.filter_by(username=username).first()
    elif user_id:
        return User.query.get(user_id)
    
    return None


def _product_ids_with_archived_license():
    """
    IDs de producto con licencia archivada (store_licenses.enabled = False).
    Esos productos no deben mostrarse en la tienda pública ni cobrarse en el carrito.
    """
    from app.store.models import License
    rows = (
        db.session.query(License.product_id)
        .filter(License.enabled.is_(False))
        .distinct()
        .all()
    )
    return {rid for (rid,) in rows if rid is not None}


def public_store_products_query():
    """Productos del catálogo público: enabled en producto y licencia no archivada."""
    q = Product.query.filter(Product.enabled.is_(True))
    archived_ids = _product_ids_with_archived_license()
    if archived_ids:
        q = q.filter(~Product.id.in_(list(archived_ids)))
    return q


def _store_dt_iso_utc_z(dt):
    """Serializa datetime del ORM como ISO UTC acabado en Z (instante bien interpretado por JS).

    Flask/SQLAlchemy suelen usar naive UTC; sin sufijo «Z» el motor JS trata la hora como *local*,
    corrigiendo mal el día al agrupar por America/Bogota.
    """
    if dt is None:
        return None
    try:
        if getattr(dt, 'tzinfo', None) is None:
            aware = dt.replace(tzinfo=timezone.utc)
        else:
            aware = dt.astimezone(timezone.utc)
        return aware.isoformat().replace('+00:00', 'Z')
    except Exception:
        return None


# Importar admin_required desde decorators para evitar duplicación
from app.admin.decorators import admin_required, admin_or_soporte_licencias_required
from functools import wraps

# Decorador para controlar acceso a la tienda
# ✅ PERMISOS CORREGIDOS:
# - Admin: Acceso completo sin restricciones
# - Usuarios de Soporte: Acceso completo SOLO si NO están en lista bloqueados
# - Usuarios bloqueados: "soporte", "soporte1", "soporte2", "soporte3" (NO acceso)
# - Usuarios normales: Requieren rol o permisos específicos
# - Subusuarios: Requieren can_access_store
def store_access_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get("user_id")
        user_obj = User.query.get(user_id) if user_id else None
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if not session.get("logged_in"):
            flash("Debes iniciar sesión para acceder a la tienda.", "warning")
            return redirect(url_for("user_auth_bp.login"))
        if user_obj and user_obj.username == admin_username:
            # El admin nunca debe ser bloqueado ni redirigido
            return f(*args, **kwargs)
        blocked_users = ["soporte", "soporte1", "soporte2", "soporte3"]
        if user_obj and user_obj.username.lower() in blocked_users:
            flash("No tienes permiso para acceder a la tienda.", "danger")
            return redirect(url_for("main_bp.home"))
        # Permitir subusuarios con can_access_store
        if user_obj and user_obj.parent_id is not None:
            if not user_obj.can_access_store:
                flash("No tienes permiso para acceder a la tienda. Solicita acceso a tu usuario principal.", "danger")
                return redirect(url_for("main_bp.home"))
            # Validar tipo_precio del padre (ahora se usa user_prices en lugar de roles)
            parent = User.query.get(user_obj.parent_id)
            if parent:
                parent_tipo_precio = None
                if parent.user_prices and isinstance(parent.user_prices, dict):
                    parent_tipo_precio = parent.user_prices.get('tipo_precio')
                if not parent_tipo_precio or parent_tipo_precio not in ['USD', 'COP']:
                    flash("Tu usuario principal no tiene tipo de precio configurado. Solicita acceso a un administrador.", "danger")
                    return redirect(url_for("main_bp.home"))
            return f(*args, **kwargs)
        # Solo usuarios principales requieren tipo_precio O permisos específicos
        if user_obj and user_obj.username != admin_username:
            # Verificar si tiene permisos de hojas de cálculo
            has_worksheet_access = user_has_worksheet_access(user_obj)
            
            # Si no tiene tipo_precio pero tiene permisos de hojas de cálculo, permitir acceso
            if has_worksheet_access:
                return f(*args, **kwargs)
            
            # Verificar si tiene tipo_precio configurado en user_prices
            tipo_precio = None
            if user_obj.user_prices and isinstance(user_obj.user_prices, dict):
                tipo_precio = user_obj.user_prices.get('tipo_precio')
            
            # Si no tiene tipo_precio configurado, denegar acceso
            if not tipo_precio or tipo_precio not in ['USD', 'COP']:
                flash("Debes tener un tipo de precio configurado (USD o COP) para acceder a la tienda. Solicita a un administrador que te configure un tipo de precio.", "danger")
                return redirect(url_for("main_bp.home"))
        return f(*args, **kwargs)
    return decorated_function


def _user_store_soporte_licencias_flag(user_obj):
    """True si el perfil efectivo de tienda tiene ``user_prices.soporte_licencias`` (principal o padre)."""
    if not user_obj:
        return False
    if user_obj.parent_id:
        pu = User.query.get(user_obj.parent_id)
        if not pu:
            return False
        up = pu.user_prices if isinstance(pu.user_prices, dict) else {}
        return bool(up.get("soporte_licencias"))
    up = user_obj.user_prices if isinstance(user_obj.user_prices, dict) else {}
    return bool(up.get("soporte_licencias"))


def _user_puede_tener_deuda_effective(user_obj):
    """Puede comprar con saldo negativo: mismo usuario o padre del subusuario (cualquiera marca el flag)."""
    if not user_obj:
        return False
    up_self = user_obj.user_prices if isinstance(user_obj.user_prices, dict) else {}
    self_ok = bool(up_self.get('puede_tener_deuda'))
    if getattr(user_obj, 'parent_id', None):
        parent = User.query.get(user_obj.parent_id)
        if parent:
            up_p = parent.user_prices if isinstance(parent.user_prices, dict) else {}
            if bool(up_p.get('puede_tener_deuda')):
                return True
        return self_ok
    return self_ok


def _user_debt_limit_effective(user_obj, currency):
    """
    Monto máximo de deuda (saldo negativo) en USD o COP.
    None = sin tope configurado (comportamiento anterior).
    """
    if not user_obj or not _user_puede_tener_deuda_effective(user_obj):
        return None
    cur = str(currency or '').strip().lower()
    key = 'limite_deuda_usd' if cur == 'usd' else 'limite_deuda_cop'

    def _limit_from_prices(up):
        if not isinstance(up, dict) or not up.get('puede_tener_deuda'):
            return None
        raw = up.get(key)
        if raw is None or raw == '':
            return None
        try:
            return max(0.0, float(raw))
        except (TypeError, ValueError):
            return None

    up_self = user_obj.user_prices if isinstance(user_obj.user_prices, dict) else {}
    lim = _limit_from_prices(up_self)
    if lim is not None:
        return lim
    if getattr(user_obj, 'parent_id', None):
        parent = User.query.get(user_obj.parent_id)
        if parent:
            up_p = parent.user_prices if isinstance(parent.user_prices, dict) else {}
            return _limit_from_prices(up_p)
    return None


def _store_prepaid_debt_limit_error(user_obj, total_cop, total_usd):
    """
    Comprueba límite de deuda en saldo prepago tienda (saldo_cop / saldo_usd).
    Solo aplica al checkout del cliente; el admin en licencias/tienda no usa esto.
    """
    if not user_obj or not _user_puede_tener_deuda_effective(user_obj):
        return None
    try:
        tc = float(total_cop or 0)
    except (TypeError, ValueError):
        tc = 0.0
    try:
        tu = float(total_usd or 0)
    except (TypeError, ValueError):
        tu = 0.0
    if tc > 0:
        lim_cop = _user_debt_limit_effective(user_obj, 'cop')
        if lim_cop is not None:
            saldo_cop = float(getattr(user_obj, 'saldo_cop', 0) or 0)
            if (saldo_cop - tc) < -lim_cop:
                return (
                    f'Supera el límite de deuda COP ({int(lim_cop)}). '
                    'Ajusta el pedido o el saldo.'
                )
    if tu > 0:
        lim_usd = _user_debt_limit_effective(user_obj, 'usd')
        if lim_usd is not None:
            saldo_usd = float(getattr(user_obj, 'saldo_usd', 0) or 0)
            if (saldo_usd - tu) < -lim_usd:
                return (
                    f'Supera el límite de deuda USD ({lim_usd:g}). '
                    'Ajusta el pedido o el saldo.'
                )
    return None


def _license_account_auto_renewal_charge_blocked(billing_user, lic):
    """
    True si la renovación automática no puede cobrar (prepago insuficiente o supera
    límite de deuda en cuenta «Licencias» ``users.saldo``). No aplica a ventas manuales admin.
    """
    if not billing_user or not lic:
        return True, 'sin_usuario'
    product = getattr(lic, 'product', None)
    unit = float(_debt_increment_per_bulk_license_sale(product, billing_user))
    if unit <= 0:
        return True, 'precio_cero'
    up = billing_user.user_prices if isinstance(billing_user.user_prices, dict) else {}
    tipo = (up.get('tipo_precio') or 'COP').strip().upper()
    if not _user_puede_tener_deuda_effective(billing_user):
        if tipo == 'USD':
            prepaid = float(getattr(billing_user, 'saldo_usd', 0) or 0)
        else:
            prepaid = float(getattr(billing_user, 'saldo_cop', 0) or 0)
        if prepaid < unit - 1e-9:
            return True, 'saldo_insuficiente'
        return False, ''
    prev = float(getattr(billing_user, 'saldo', 0) or 0)
    lim = _user_debt_limit_effective(
        billing_user, 'usd' if tipo == 'USD' else 'cop'
    )
    if lim is not None and (prev + unit) > lim + 1e-9:
        return True, 'supera_limite_deuda'
    return False, ''


def _apply_license_account_auto_renewal_charge(billing_user, lic):
    """Cobra un mes: prepago (sin deuda) o suma a ``users.saldo`` (con deuda y dentro del límite)."""
    blocked, reason = _license_account_auto_renewal_charge_blocked(billing_user, lic)
    if blocked:
        return False, reason or 'cobro_fallido'
    product = getattr(lic, 'product', None)
    unit = float(_debt_increment_per_bulk_license_sale(product, billing_user))
    up = billing_user.user_prices if isinstance(billing_user.user_prices, dict) else {}
    tipo = (up.get('tipo_precio') or 'COP').strip().upper()
    if not _user_puede_tener_deuda_effective(billing_user):
        if tipo == 'USD':
            billing_user.saldo_usd = float(getattr(billing_user, 'saldo_usd', 0) or 0) - unit
        else:
            billing_user.saldo_cop = float(getattr(billing_user, 'saldo_cop', 0) or 0) - unit
        return True, 'prepaid'
    prev = float(getattr(billing_user, 'saldo', 0) or 0)
    billing_user.saldo = prev + unit
    return True, 'debt'


def _renewal_block_user_message(reason: str, currency: str = 'COP') -> str:
    cur = (currency or 'COP').strip().upper()
    if reason == 'supera_limite_deuda':
        return (
            'No tienes saldo suficiente para la renovación (supera el límite de deuda '
            'en cuenta Licencias). La cuenta no se renovará y pasará a Cambios o Vencidas.'
        )
    if reason == 'saldo_insuficiente':
        return (
            f'No tienes saldo suficiente en {cur} para la renovación. '
            'La cuenta no se renovará y pasará a vencidas si no recargas.'
        )
    return (
        'No se pudo renovar por saldo insuficiente. '
        'La cuenta no se renovará y pasará a vencidas.'
    )


def _record_portal_renewal_blocked_activity(
    billing_user,
    *,
    license_id=None,
    account_id=None,
    cred_hint='',
    reason='',
    calendar_day=None,
):
    """Registro en historial portal + aviso en próxima carga de licencias."""
    if not billing_user:
        return
    try:
        from app.store.user_license_activity import append_portal_license_activity_record

        up = billing_user.user_prices if isinstance(billing_user.user_prices, dict) else {}
        tipo = (up.get('tipo_precio') or 'COP').strip().upper()
        msg = _renewal_block_user_message(reason, tipo)
        hint = str(cred_hint or '').strip()[:140]
        summary = 'Renovación automática no realizada'
        detail = msg
        if hint:
            detail = f'{hint} — {msg}'
        append_portal_license_activity_record(
            billing_user,
            'renovacion_saldo',
            summary,
            detail,
            extra={
                'license_id': license_id,
                'account_id': account_id,
                'cred_hint': hint,
                'calendar_day': calendar_day,
            },
        )
    except Exception as ex:
        current_app.logger.warning('record portal renewal blocked: %s', ex)


# Misma ventana que caducidad en portal (user_licencias.js)
USER_LIC_CADUCIDAD_VIEW_MAX_DAYS = 5


def _portal_renewal_balance_warnings_for_accounts(billing_user, accounts_list):
    """
    Avisos proactivos (misma ventana que caducidad): renovación en ≤5 días con saldo insuficiente.
    """
    from app.store.models import License
    from app.store.user_license_line_parse import normalize_status_key

    if not billing_user or not accounts_list:
        return []
    nk_renovar = normalize_status_key('renovar 1 mes mas')
    nk_mes = normalize_status_key('dejar mes a mes')
    co = get_colombia_datetime()
    warnings = []
    seen = set()
    lic_cache = {}

    for acc in accounts_list:
        if not isinstance(acc, dict):
            continue
        day_lines = acc.get('day_lines') or {}
        lic_id = acc.get('license_id')
        if not lic_id:
            continue
        lid = int(lic_id)
        if lid not in lic_cache:
            lic_cache[lid] = (
                License.query.options(joinedload(License.product))
                .filter_by(id=lid)
                .first()
            )
        lic = lic_cache[lid]
        if not lic:
            continue
        label = (
            str(acc.get('credential_preview') or acc.get('product_name') or 'Cuenta')
            .strip()
        )
        account_id = acc.get('account_id')

        for d in range(1, 32):
            rows = day_lines.get(str(d)) or []
            if not rows:
                continue
            days_left = _days_until_calendar_sale_day(d, co)
            if days_left is None or days_left < 0 or days_left > USER_LIC_CADUCIDAD_VIEW_MAX_DAYS:
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                sg = normalize_status_key(str(row.get('status_good') or ''))
                if sg not in (nk_renovar, nk_mes):
                    continue
                dedupe = (lid, account_id, d, sg)
                if dedupe in seen:
                    continue
                blocked, reason = _license_account_auto_renewal_charge_blocked(
                    billing_user, lic
                )
                if not blocked:
                    continue
                seen.add(dedupe)
                up = (
                    billing_user.user_prices
                    if isinstance(billing_user.user_prices, dict)
                    else {}
                )
                tipo = (up.get('tipo_precio') or 'COP').strip().upper()
                warnings.append(
                    {
                        'key': f'{lid}:{account_id or "v"}:{d}:{sg}',
                        'account_id': account_id,
                        'license_id': lid,
                        'calendar_day': d,
                        'days_left': days_left,
                        'credential_preview': label,
                        'reason': reason or 'saldo_insuficiente',
                        'message': _renewal_block_user_message(reason, tipo),
                        'urgent': days_left <= 1,
                    }
                )
    return warnings


def _billing_user_for_store_debt_limit(user_obj):
    """Usuario cuyo user_prices define el límite (padre si es subusuario)."""
    if not user_obj:
        return None
    if getattr(user_obj, 'parent_id', None):
        parent = User.query.get(user_obj.parent_id)
        if parent:
            return parent
    return user_obj


def _eligible_tienda_user_licencias_portal(user_obj):
    """Misma regla para /licencias y la API my-license-accounts: USD/COP como cliente o soporte licencias."""
    blocked_users = ("soporte", "soporte1", "soporte2", "soporte3")
    if user_obj.username.lower() in blocked_users:
        return False
    if user_obj.parent_id is not None:
        if not user_obj.can_access_store:
            return False
        pu = User.query.get(user_obj.parent_id)
        if not pu:
            return False
        up = pu.user_prices if isinstance(pu.user_prices, dict) else {}
        tipo = up.get("tipo_precio")
        tipo_ok = tipo in ("USD", "COP")
        soporte = bool(up.get("soporte_licencias"))
        return tipo_ok or soporte
    up = user_obj.user_prices if isinstance(user_obj.user_prices, dict) else {}
    tipo_ok = up.get("tipo_precio") in ("USD", "COP")
    soporte = bool(up.get("soporte_licencias"))
    return tipo_ok or soporte


def user_licencias_precio_required(f):
    """
    Usuarios con tipo de precio USD o COP como cliente; o soporte licencias (user_prices);
    subusuario con mismo criterio vía usuario principal.
    Sin bypass por hojas de cálculo. El admin se redirige al panel Admin Licencias.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        _ensure_user_portal_license_activity_log_column()
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if not session.get("logged_in"):
            flash("Debes iniciar sesión.", "warning")
            return redirect(url_for("user_auth_bp.login"))
        user_id = session.get("user_id")
        user_obj = User.query.get(user_id) if user_id else None
        if not user_obj:
            flash("No se encontró tu usuario. Inicia sesión de nuevo.", "warning")
            return redirect(url_for("user_auth_bp.login"))
        if user_obj.username == admin_username:
            return redirect(url_for("store_bp.admin_store"))
        blocked_users = ["soporte", "soporte1", "soporte2", "soporte3"]
        if user_obj and user_obj.username.lower() in blocked_users:
            flash("No tienes permiso para ver esta página.", "danger")
            return redirect(url_for("main_bp.home"))
        if user_obj and user_obj.parent_id is not None:
            if not user_obj.can_access_store:
                flash("No tienes permiso para acceder. Solicita acceso a tu usuario principal.", "danger")
                return redirect(url_for("main_bp.home"))
            pu = User.query.get(user_obj.parent_id)
            if not pu:
                flash("No se encontró el usuario principal asociado.", "danger")
                return redirect(url_for("main_bp.home"))
        if user_obj.username != admin_username and not _eligible_tienda_user_licencias_portal(user_obj):
            flash(
                "Necesitas tipo de precio USD o COP configurado como cliente, "
                "o permiso de soporte licencias, para usar esta página.",
                "danger",
            )
            return redirect(url_for("main_bp.home"))
        return f(*args, **kwargs)

    return decorated_function


# Decorador para chat de soporte: NO requiere tipo_precio (permite acceso al chat sin configurar USD/COP)
def chat_access_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get("user_id")
        user_obj = User.query.get(user_id) if user_id else None
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if not session.get("logged_in"):
            flash("Debes iniciar sesión para acceder al chat de soporte.", "warning")
            return redirect(url_for("user_auth_bp.login"))
        if user_obj and user_obj.username == admin_username:
            return f(*args, **kwargs)
        blocked_users = ["soporte", "soporte1", "soporte2", "soporte3"]
        if user_obj and user_obj.username.lower() in blocked_users:
            flash("No tienes permiso para acceder al chat de soporte.", "danger")
            return redirect(url_for("main_bp.home"))
        if user_obj and user_obj.parent_id is not None:
            if not user_obj.can_chat:
                flash("No tienes permiso para acceder al chat de soporte.", "danger")
                return redirect(url_for("main_bp.home"))
            return f(*args, **kwargs)
        return f(*args, **kwargs)
    return decorated_function

# Decorador para APIs de limpieza del chat: permite admin O usuarios con is_support
def admin_or_support_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get("user_id")
        user_obj = User.query.get(user_id) if user_id else None
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if not session.get("logged_in"):
            return jsonify({'status': 'error', 'message': 'Debes iniciar sesión'}), 401
        if not user_obj:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 403
        if user_obj.username == admin_username:
            return f(*args, **kwargs)
        if user_obj.is_support:
            return f(*args, **kwargs)
        return jsonify({'status': 'error', 'message': 'Solo admin o usuarios de soporte pueden realizar esta acción'}), 403
    return decorated_function

# Decorador específico para hojas de cálculo (más restrictivo)
def worksheet_access_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get("user_id")
        user_obj = User.query.get(user_id) if user_id else None
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        
        if not session.get("logged_in"):
            flash("Debes iniciar sesión para acceder a las hojas de cálculo.", "warning")
            return redirect(url_for("user_auth_bp.login"))
        
        # Solo admin puede acceder sin restricciones
        if user_obj and user_obj.username == admin_username:
            return f(*args, **kwargs)
        
        # Sub-usuarios no pueden acceder
        if user_obj and user_obj.parent_id is not None:
            flash("Los sub-usuarios no tienen acceso a las hojas de cálculo.", "warning")
            return redirect(url_for("main_bp.home"))
        
        # Usuarios normales deben tener permisos específicos
        if user_obj and user_obj.username != admin_username:
            if not user_has_worksheet_access(user_obj):
                flash("No tienes acceso a ninguna hoja de cálculo. Contacta al administrador.", "warning")
                return redirect(url_for("main_bp.home"))
        
        return f(*args, **kwargs)
    return decorated_function

def _attach_document_no_store_headers(resp):
    """HTML login/admin: algunos navegadores cacheaban la vista y cargaban JS viejo o sesión inconsistente hasta borrar datos del sitio."""
    if resp is None or not getattr(resp, 'headers', None):
        return resp
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    resp.headers['Vary'] = 'Cookie'
    return resp


def _sanitize_admin_licencias_ui_prefs(raw):
    """Acota y valida JSON para `User.admin_licencias_ui_prefs` (solo plegados UI admin)."""
    if raw is None or not isinstance(raw, dict):
        return {}
    try:
        if len(json.dumps(raw, separators=(',', ':'))) > 120000:
            return {}
    except Exception:
        return {}
    out = {}
    mg = raw.get('main_grid_collapsed')
    if mg is True or mg is False:
        out['main_grid_collapsed'] = mg
    ad = raw.get('admin_days')
    if isinstance(ad, dict):
        clean_ad = {}
        for lid, days in list(ad.items())[:120]:
            sk = str(lid)[:24]
            if not isinstance(days, dict):
                continue
            inner = {}
            for dy, val in list(days.items())[:40]:
                dk = str(dy)
                if not dk.isdigit():
                    continue
                di = int(dk)
                if di < 1 or di > 31 or not isinstance(val, bool):
                    continue
                inner[dk] = val
            if inner:
                clean_ad[sk] = inner
        if clean_ad:
            out['admin_days'] = clean_ad
    for bloc in ('personal_collapsed', 'suspended_collapsed', 'expired_collapsed'):
        m = raw.get(bloc)
        if isinstance(m, dict):
            cm = {}
            for k, val in list(m.items())[:220]:
                if not isinstance(val, bool):
                    continue
                cm[str(k)[:24]] = val
            if cm:
                out[bloc] = cm
    return out


@store_bp.route('/admin', endpoint='admin_store')
@admin_or_soporte_licencias_required
def admin_store():
    products = Product.query.order_by(Product.id.desc()).all()
    restricted = getattr(g, 'license_support_restricted_mode', False)
    admin_ui_prefs = {}
    uid = session.get('user_id')
    if uid:
        _urow = User.query.get(uid)
        ap = getattr(_urow, 'admin_licencias_ui_prefs', None) if _urow else None
        if isinstance(ap, dict):
            admin_ui_prefs = ap
    current_user = User.query.get(uid) if uid else None
    resp = make_response(
        render_template(
            'admin_store.html',
            products=products,
            title='Admin Licencias',
            license_support_restricted_mode=restricted,
            admin_licencias_ui_prefs=admin_ui_prefs,
            current_user=current_user,
        )
    )
    _attach_document_no_store_headers(resp)
    return resp


@store_bp.route('/api/admin-licencias-ui-prefs', methods=['GET', 'PUT'])
@admin_or_soporte_licencias_required
def api_admin_licencias_ui_prefs():
    """Guardar / leer plegados del panel Admin Licencias en BD (por usuario de sesión)."""
    uid = session.get('user_id')
    user = User.query.get(uid) if uid else None
    if not user:
        r = jsonify(success=False, error='Sesión inválida.')
        return _attach_private_no_cache_headers(r), 401
    if request.method == 'GET':
        prefs = user.admin_licencias_ui_prefs
        if not isinstance(prefs, dict):
            prefs = {}
        r = jsonify(success=True, prefs=prefs)
        return _attach_private_no_cache_headers(r)
    data = request.get_json(silent=True) or {}
    prefs_in = data.get('prefs')
    if not isinstance(prefs_in, dict):
        r = jsonify(success=False, error='prefs debe ser un objeto JSON.')
        return _attach_private_no_cache_headers(r), 400
    user.admin_licencias_ui_prefs = _sanitize_admin_licencias_ui_prefs(prefs_in)
    try:
        db.session.commit()
    except Exception as ex:
        db.session.rollback()
        current_app.logger.exception('api_admin_licencias_ui_prefs commit')
        r = jsonify(success=False, error=str(ex))
        return _attach_private_no_cache_headers(r), 500
    r = jsonify(success=True)
    return _attach_private_no_cache_headers(r)


@store_bp.route('/api/admin/license-activity-timeline', methods=['GET'])
@admin_or_soporte_licencias_required
def api_admin_license_activity_timeline():
    """JSON: línea temporal global (entregas + portal) para el panel Historial de licencias en admin."""
    from app.store.user_license_activity import build_admin_store_license_activity_timeline_rows

    try:
        _ensure_user_portal_license_activity_log_column()
    except Exception:
        current_app.logger.debug('ensure portal_license_activity_log skip', exc_info=True)
    rows = build_admin_store_license_activity_timeline_rows(utc_to_colombia_fn=utc_to_colombia)
    r = jsonify(success=True, rows=rows)
    return _attach_private_no_cache_headers(r)


@store_bp.route('/admin/archivados')
@admin_required
def admin_archivados():
    """Página de licencias archivadas"""
    resp = make_response(render_template('admin_archivados.html'))
    _attach_document_no_store_headers(resp)
    return resp

@store_bp.route('/admin/productos', methods=['GET', 'POST'])
@admin_required
def admin_productos():
    if request.method == 'POST':
        try:
            name = request.form.get('name')
            price_cop = float(request.form.get('price_cop'))
            price_usd = float(request.form.get('price_usd'))
            stock = int(request.form.get('stock'))
            image_url = request.form.get('image_url')
            description = request.form.get('description')
            category = request.form.get('category')
            is_active = request.form.get('is_active') == 'on'

            product = Product(
                name=name,
                price_cop=price_cop,
                price_usd=price_usd,
                stock=stock,
                image_url=image_url,
                description=description,
                category=category,
                is_active=is_active
            )
            db.session.add(product)
            db.session.commit()
            return jsonify({'success': True})
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'error': str(e)})

    products = Product.query.order_by(Product.id.desc()).all()
    return render_template('productos.html', products=products)

@store_bp.route('/admin/productos/new', methods=['GET', 'POST'])
@admin_required
def create_product():
    if request.method == 'POST':
        name = request.form.get('name')
        price_cop_str = request.form.get('price_cop', '0')
        price_usd_str = request.form.get('price_usd', '0')
        image_filename = request.form.get('image_filename')
        if not name:
            flash('El nombre es obligatorio.', 'danger')
            return redirect(url_for('store_bp.admin_productos'))
        if not image_filename or image_filename == 'none':
            flash('Debes seleccionar una imagen para el producto.', 'danger')
            return redirect(url_for('store_bp.admin_productos'))
        try:
            price_cop = float(price_cop_str) if price_cop_str else 0.0
            price_usd = float(price_usd_str) if price_usd_str else 0.0
        except ValueError:
            flash('Los precios deben ser números válidos.', 'danger')
            return redirect(url_for('store_bp.admin_productos'))
        new_product = Product(name=name, price_cop=price_cop, price_usd=price_usd, image_filename=image_filename, enabled=True, description=request.form.get('description'))
        db.session.add(new_product)
        try:
            db.session.commit()
            flash('Producto creado exitosamente.', 'success')
        except Exception as e:
            db.session.rollback()
            if 'NOT NULL constraint failed: store_products.image_filename' in str(e):
                flash('Debes seleccionar una imagen para el producto.', 'danger')
            else:
                flash('Ocurrió un error inesperado al crear el producto. Intenta de nuevo o contacta al administrador.', 'danger')
        return redirect(url_for('store_bp.admin_productos'))
    return redirect(url_for('store_bp.admin_productos'))

@store_bp.route('/admin/productos/<int:prod_id>/edit', methods=['GET', 'POST'])
@admin_required
def edit_product(prod_id):
    product = Product.query.get_or_404(prod_id)
    if request.method == 'POST':
        if not product.is_preset:
            product.name = request.form.get('name')
        price_cop_str = request.form.get('price_cop', '0')
        price_usd_str = request.form.get('price_usd', '0')
        product.image_filename = request.form.get('image_filename')
        product.enabled = 'enabled' in request.form
        product.description = request.form.get('description')
        if not product.name:
            flash('El nombre es obligatorio.', 'danger')
        else:
            try:
                product.price_cop = float(price_cop_str) if price_cop_str else 0.0
                product.price_usd = float(price_usd_str) if price_usd_str else 0.0
            except ValueError:
                flash('Los precios deben ser números válidos.', 'danger')
                return render_template('edit_product.html', product=product, title="Editar Producto")
            if product.image_filename == 'none':
                product.image_filename = None
            try:
                db.session.commit()
                flash('Producto actualizado.', 'success')
                return redirect(url_for('store_bp.admin_productos'))
            except Exception as e:
                db.session.rollback()
                current_app.logger.error(f"Error al actualizar producto: {str(e)}")
                flash(f'Error al actualizar producto: {str(e)}', 'danger')
    return render_template('edit_product.html', product=product, title="Editar Producto")

@store_bp.route('/admin/productos/<int:prod_id>/toggle', methods=['POST'])
@admin_required
def toggle_product(prod_id):
    product = Product.query.get_or_404(prod_id)
    product.enabled = not product.enabled
    try:
        db.session.commit()
        flash(f'Producto {product.name} ahora {"visible" if product.enabled else "oculto"}.', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error al cambiar visibilidad: {str(e)}', 'danger')
    return redirect(url_for('store_bp.admin_productos'))

@store_bp.route('/admin/productos/<int:prod_id>/delete', methods=['POST'])
@admin_required
def delete_product(prod_id):
    product = Product.query.get_or_404(prod_id)
    try:
        db.session.delete(product)
        db.session.commit()
        flash(f'Producto {product.name} eliminado.', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error al eliminar producto: {str(e)}', 'danger')
    return redirect(url_for('store_bp.admin_productos'))

@store_bp.route('/toggle-product/<int:product_id>', methods=['POST'])
@admin_required
def toggle_product_ajax(product_id):
    product = Product.query.get_or_404(product_id)
    product.enabled = not product.enabled
    db.session.commit()
    return jsonify({
        'success': True,
        'new_state': 'OFF' if product.enabled else 'ON',
        'new_class': 'action-red' if product.enabled else 'action-green',
        'message': f'Producto ahora {'visible' if product.enabled else 'oculto'}.'
    })

@store_bp.route('/admin/productos/<int:prod_id>/delete_ajax', methods=['POST'], endpoint='delete_product_ajax')
@admin_required
def delete_product_ajax(prod_id):
    product = Product.query.get_or_404(prod_id)
    if not product:
        return jsonify({'success': False, 'error': 'Producto no encontrado.'}), 404
    try:
        db.session.delete(product)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Producto eliminado exitosamente.'})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error en delete_product_ajax para prod_id {prod_id}: {str(e)}")
        return jsonify({'success': False, 'error': 'Error interno al eliminar el producto.'}), 500


def catalog_products_for_store_user(user):
    """
    Misma lista y descuentos que en store_front para un usuario tienda no administrador.
    Devuelve (products, tipo_precio) donde tipo_precio es 'USD', 'COP' o None.
    """
    products = []
    tipo_precio_effective = None
    if not user:
        return products, tipo_precio_effective
    if user.parent_id:
        parent = User.query.get(user.parent_id)
        if not parent:
            return [], None
        parent_tipo_precio = None
        parent_descuentos_productos = {}
        if parent.user_prices and isinstance(parent.user_prices, dict):
            parent_tipo_precio = parent.user_prices.get('tipo_precio')
            parent_descuentos_productos = parent.user_prices.get('descuentos_productos', {})
        if parent_tipo_precio and parent_tipo_precio in ['USD', 'COP']:
            tipo_precio_effective = parent_tipo_precio
            productos_permitidos_ids = None
            if parent.user_prices and isinstance(parent.user_prices, dict):
                if 'productos_permitidos' in parent.user_prices:
                    productos_permitidos_ids = parent.user_prices.get('productos_permitidos', [])
            if productos_permitidos_ids is not None:
                if productos_permitidos_ids:
                    products = (
                        public_store_products_query()
                        .filter(Product.id.in_(productos_permitidos_ids))
                        .order_by(Product.name)
                        .all()
                    )
                else:
                    products = []
            else:
                products = public_store_products_query().order_by(Product.name).all()
            for p in products:
                d = parent_descuentos_productos.get(str(p.id)) or parent_descuentos_productos.get(int(p.id)) or {}
                p.discount_cop_extra = d.get('cop', 0)
                p.discount_usd_extra = d.get('usd', 0)
        return products, tipo_precio_effective

    tipo_precio = None
    descuentos_productos = {}
    if user.user_prices and isinstance(user.user_prices, dict):
        tipo_precio = user.user_prices.get('tipo_precio')
        descuentos_productos = user.user_prices.get('descuentos_productos', {})
    if tipo_precio and tipo_precio in ['USD', 'COP']:
        tipo_precio_effective = tipo_precio
        productos_permitidos_ids = None
        if user.user_prices and isinstance(user.user_prices, dict):
            if 'productos_permitidos' in user.user_prices:
                productos_permitidos_ids = user.user_prices.get('productos_permitidos', [])
        if productos_permitidos_ids is not None:
            if productos_permitidos_ids:
                products = (
                    public_store_products_query()
                    .filter(Product.id.in_(productos_permitidos_ids))
                    .order_by(Product.name)
                    .all()
                )
            else:
                products = []
        else:
            products = public_store_products_query().order_by(Product.name).all()
        for p in products:
            d = descuentos_productos.get(str(p.id)) or descuentos_productos.get(int(p.id)) or {}
            p.discount_cop_extra = d.get('cop', 0)
            p.discount_usd_extra = d.get('usd', 0)
    return products, tipo_precio_effective


def build_store_menu_saldo_display(user):
    """
    Texto «Saldo $… COP/USD» del pie del menú lateral (misma regla que inject_store_menu_balance).
    Devuelve {'show': bool, 'line': str|None}.
    """
    from flask import current_app

    defaults = {"show": False, "line": None}
    if not user:
        return defaults
    admin_username = current_app.config.get("ADMIN_USER", "admin")
    if user.username == admin_username:
        return defaults
    blocked = {"soporte", "soporte1", "soporte2", "soporte3"}
    if user.username and user.username.lower() in blocked:
        return defaults
    if not _eligible_tienda_user_licencias_portal(user):
        return defaults
    _, tipo_precio = catalog_products_for_store_user(user)
    tp = (tipo_precio or "").upper()

    def _fmt_num(n):
        try:
            x = float(n)
        except (TypeError, ValueError):
            x = 0.0
        if abs(x - round(x)) < 1e-9:
            return str(int(round(x)))
        s = ("%.2f" % x).replace(".00", "").rstrip("0").rstrip(".")
        return s

    cop = float(user.saldo_cop or 0)
    usd = float(user.saldo_usd or 0)
    rev = 0
    if isinstance(user.user_prices, dict):
        try:
            rev = int(user.user_prices.get('tipo_precio_revision') or 0)
        except (TypeError, ValueError):
            rev = 0
    if tp == "COP":
        line = "Saldo $%s COP" % _fmt_num(cop)
    elif tp == "USD":
        line = "Saldo $%s USD" % _fmt_num(usd)
    else:
        return defaults
    return {
        "show": True,
        "line": line,
        "tipo_precio": tp,
        "saldo_cop": cop,
        "saldo_usd": usd,
        "tipo_precio_revision": rev,
    }


def build_recharge_page_balance_display(user):
    """Saldo principal + línea de acumulado pendiente de conversión (recargas de saldo)."""
    saldo = build_store_menu_saldo_display(user)
    if not user:
        return saldo
    from app.store.balance_recharge_accum import build_user_accumulated_display

    accum = build_user_accumulated_display(int(user.id))
    saldo["accum_show"] = bool(accum.get("show"))
    saldo["accum_line"] = accum.get("line")
    saldo["accum_totals"] = accum.get("totals") or {}
    return saldo


# Ruta para la tienda de cara al público (ejemplo)
@store_bp.route('/')
@store_access_required
def store_front():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username
    admin_user = current_app.config.get("ADMIN_USER", "admin")

    # Filtrar productos según el tipo_precio del usuario o del padre si es sub-usuario
    tipo_precio_store = 'usd'
    if username == admin_user:
        products = public_store_products_query().order_by(Product.name).all()
    elif user:
        products, tipo_precio_store = catalog_products_for_store_user(user)
        tipo_precio_store = (tipo_precio_store or 'USD').lower()
    else:
        products = []

    coupons = Coupon.query.filter_by(enabled=True, show_public=True).order_by(Coupon.id.desc()).all()
    saldo_usd = user.saldo_usd if user else 0
    saldo_cop = user.saldo_cop if user else 0
    puede_tener_deuda = _user_puede_tener_deuda_effective(user) if user else False
    billing_for_limit = _billing_user_for_store_debt_limit(user) if user else None
    limite_deuda_usd = (
        _user_debt_limit_effective(billing_for_limit, 'usd') if billing_for_limit else None
    )
    limite_deuda_cop = (
        _user_debt_limit_effective(billing_for_limit, 'cop') if billing_for_limit else None
    )
    tipo_precio_revision = 0
    if user and isinstance(user.user_prices, dict):
        try:
            tipo_precio_revision = int(user.user_prices.get('tipo_precio_revision') or 0)
        except (TypeError, ValueError):
            tipo_precio_revision = 0
    product_stock_initial = (
        {p.id: _compute_public_sellable_stock_for_product(p) for p in products}
        if products
        else {}
    )
    resp = make_response(render_template(
        'store_front.html',
        products=products,
        product_stock_initial=product_stock_initial,
        coupons=coupons,
        ADMIN_USER=admin_user,
        current_user=user,
        username=username,
        saldo_usd=saldo_usd,
        saldo_cop=saldo_cop,
        tipo_precio_store=tipo_precio_store,
        tipo_precio_revision=tipo_precio_revision,
        puede_tener_deuda=puede_tener_deuda,
        limite_deuda_usd=limite_deuda_usd,
        limite_deuda_cop=limite_deuda_cop,
    ))
    _attach_document_no_store_headers(resp)
    return resp


@store_bp.route('/licencias')
@user_licencias_precio_required
def user_licencias():
    """
    Vista usuarios de tienda: cuentas asignadas si las hay (solo lectura + notas cliente).
    Acceso también con permiso ``soporte_licencias`` (gestión cambios desde /tienda/admin).
    """
    username = session.get('username')
    user_id = session.get('user_id')
    user = None
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username
    # Catálogo y precios: la tabla se rellena vía GET /api/user/my-license-accounts
    _, tipo_precio = catalog_products_for_store_user(user)
    saldo_usd = user.saldo_usd if user else 0
    saldo_cop = user.saldo_cop if user else 0
    soporte_licencias_nav = bool(_user_store_soporte_licencias_flag(user))
    resp = make_response(render_template(
        'user_licencias.html',
        title='Licencias',
        tipo_precio=tipo_precio,
        current_user=user,
        username=username,
        saldo_usd=saldo_usd,
        saldo_cop=saldo_cop,
        soporte_licencias_nav=soporte_licencias_nav,
    ))
    _attach_document_no_store_headers(resp)
    return resp



@store_bp.route('/users')
@store_access_required
def users():
    """Ruta legacy: la plantilla store_users.html no existe; listado en panel admin."""
    return redirect(url_for('admin_bp.usuarios_page'))

@store_bp.route('/admin/coupons/list', methods=['GET'])
@admin_required
def list_coupons():
    coupons = Coupon.query.options(joinedload(Coupon.products)).order_by(Coupon.id.desc()).all()
    data = []
    for c in coupons:
        data.append({
            'id': c.id,
            'name': c.name,
            'discount_cop': float(c.discount_cop),
            'discount_usd': float(c.discount_usd),
            'products': [{'id': p.id, 'name': p.name} for p in c.products],
            'duration_days': c.duration_days,
            'max_uses_per_user': c.max_uses_per_user,
            'enabled': c.enabled
        })
    return jsonify({'coupons': data})

@store_bp.route('/admin/coupons/create', methods=['POST'])
@admin_required
def create_coupon():
    data = request.json
    name = data.get('coupon_name', '').strip()
    discount_cop = data.get('discount_cop', 0)
    discount_usd = data.get('discount_usd', 0)
    product_ids = data.get('products', [])
    duration_days = data.get('duration_days', 1)
    max_uses_per_user = data.get('max_uses_per_user')
    if max_uses_per_user in (None, '', 'null'):
        max_uses_per_user = None
    description = data.get('description', '')
    min_amount = data.get('min_amount', None)
    if min_amount in (None, '', 'null'):
        min_amount = None
    if not name or not product_ids:
        return jsonify({'success': False, 'error': 'Nombre y productos requeridos.'}), 400
    if Coupon.query.filter_by(name=name).first():
        return jsonify({'success': False, 'error': 'Ya existe un cupón con ese nombre.'}), 400
    # Obtener la fecha actual en zona horaria de Colombia
    # Usar módulo centralizado de timezone
    colombia_now = get_colombia_datetime()
    
    coupon = Coupon(
        name=name,
        discount_cop=discount_cop,
        discount_usd=discount_usd,
        duration_days=duration_days,
        max_uses_per_user=max_uses_per_user,
        description=description,
        min_amount=min_amount,
        enabled=True,
        created_at=colombia_now,
        updated_at=colombia_now
    )
    coupon.products = Product.query.filter(Product.id.in_(product_ids)).all()
    db.session.add(coupon)
    db.session.commit()
    return jsonify({'success': True})

@store_bp.route('/admin/coupons/toggle/<int:coupon_id>', methods=['POST'])
@admin_required
def toggle_coupon(coupon_id):
    coupon = Coupon.query.get_or_404(coupon_id)
    coupon.enabled = not coupon.enabled
    db.session.commit()
    return jsonify({
        'success': True,
        'new_state': 'OFF' if coupon.enabled else 'ON',
        'new_class': 'action-red' if coupon.enabled else 'action-green',
        'message': f'Cupón ahora {"habilitado" if coupon.enabled else "deshabilitado"}.'
    })

@store_bp.route('/admin/coupons/delete/<int:coupon_id>', methods=['POST'])
@admin_required
def delete_coupon(coupon_id):
    coupon = Coupon.query.get_or_404(coupon_id)
    db.session.delete(coupon)
    db.session.commit()
    return jsonify({'success': True})

@store_bp.route('/admin/coupons/edit/<int:coupon_id>', methods=['POST'])
@admin_required
def edit_coupon(coupon_id):
    # Estructura base para editar (puedes expandir luego)
    return jsonify({'success': True, 'message': 'Edición no implementada aún.'})


@store_bp.route('/admin/cupones', endpoint='admin_coupons')
@admin_required
def admin_coupons():
    # Redirigir a productos donde ahora está la gestión de cupones
    return redirect(url_for('store_bp.admin_productos'))

@store_bp.route('/admin/cupones/<int:coupon_id>/editar', methods=['GET', 'POST'])
@admin_required
def editar_cupon(coupon_id):
    from .models import Coupon, Product
    coupon = Coupon.query.get_or_404(coupon_id)
    products = Product.query.order_by(Product.id.desc()).all()
    coupon_product_ids = [p.id for p in coupon.products]
    # Convertir la fecha de creación a zona horaria de Colombia
    created_at_col = None
    if coupon.created_at:
        # Usar módulo centralizado de timezone
        created_at_col = utc_to_colombia(coupon.created_at)
    if request.method == 'POST':
        coupon.name = request.form.get('coupon_name', '').strip()
        coupon.discount_cop = request.form.get('discount_cop', 0)
        coupon.discount_usd = request.form.get('discount_usd', 0)
        coupon.duration_days = request.form.get('duration_days', 1)
        coupon.max_uses_per_user = request.form.get('max_uses_per_user', 1)
        coupon.description = request.form.get('description', '')
        coupon.min_amount = request.form.get('min_amount') or None
        selected_products = request.form.getlist('products')
        coupon.products = Product.query.filter(Product.id.in_(selected_products)).all() if selected_products else []
        try:
            db.session.commit()
            flash('Cupón actualizado correctamente.', 'success')
            return redirect(url_for('store_bp.admin_productos'))
        except Exception as e:
            db.session.rollback()
            flash('Error al actualizar cupón: ' + str(e), 'danger')
    return render_template('editar_cupon.html', coupon=coupon, products=products, coupon_product_ids=coupon_product_ids, created_at_col=created_at_col)

@store_bp.route('/admin/coupons/update', methods=['POST'])
def update_coupon():
    data = request.get_json()
    coupon_id = data.get('coupon_id')
    coupon = Coupon.query.get_or_404(coupon_id)
    coupon.name = data.get('coupon_name', coupon.name)
    coupon.discount_cop = data.get('discount_cop', coupon.discount_cop)
    coupon.discount_usd = data.get('discount_usd', coupon.discount_usd)
    coupon.duration_days = data.get('duration_days', coupon.duration_days)
    coupon.max_uses_per_user = data.get('max_uses_per_user', coupon.max_uses_per_user)
    coupon.description = data.get('description', coupon.description)
    coupon.min_amount = data.get('min_amount', coupon.min_amount)
    coupon.show_public = bool(data.get('show_public', False))
    # Actualizar productos asociados si es necesario
    product_ids = data.get('products', [])
    if product_ids:
        coupon.products = Product.query.filter(Product.id.in_(product_ids)).all()
    try:
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)})


@store_bp.route('/admin/roles', endpoint='admin_roles')
@admin_required
def admin_roles():
    # Redirigir a gestión de permisos donde ahora se gestionan los productos asociados
    return redirect(url_for('admin_bp.manage_permissions_page'))

@store_bp.route('/admin/roles/get_or_create_for_user/<int:user_id>', methods=['GET'])
@admin_required
def get_or_create_role_for_user(user_id):
    """
    Redirige a la página de edición de productos del usuario.
    Los roles ya no se usan, ahora se gestionan productos directamente por usuario.
    """
    return redirect(url_for('admin_bp.edit_user_products', user_id=user_id))


@store_bp.route('/admin/herramientas')
@admin_required
def admin_tools():
    tools = ToolInfo.query.order_by(ToolInfo.id.desc()).all()
    htmls = HtmlInfo.query.order_by(HtmlInfo.id.desc()).all()
    youtube_listings = YouTubeListing.query.order_by(YouTubeListing.id.desc()).all()
    apis = ApiInfo.query.order_by(ApiInfo.id.desc()).all()
    
    # Limpiar valores "None" string en youtube_listings
    for listing in youtube_listings:
        if listing.content and str(listing.content).strip().lower() == 'none':
            listing.content = None
    try:
        db.session.commit()
    except:
        db.session.rollback()
    
    return render_template('herramientas.html', 
                           tools=tools, 
                           htmls=htmls, 
                           youtube_listings=youtube_listings,
                           apis=apis)

# --- Rutas para Importar/Exportar Configuración de Herramientas ---

def allowed_file(filename):
    """Verifica si el archivo tiene una extensión permitida."""
    ALLOWED_EXTENSIONS = {'json'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@store_bp.route('/admin/herramientas/export_config')
@admin_required
def export_tools_config():
    """Exporta la configuración de herramientas admin a un archivo JSON."""
    submitted_code = request.args.get('security_code')
    actual_security_code = current_app.config.get('ADMIN_CONFIG_SECURITY_CODE', 'tu_codigo_secreto_aqui')
    
    if not submitted_code or submitted_code != actual_security_code:
        return jsonify({"error": "Código de seguridad incorrecto"}), 401
    
    try:
        # Obtener todos los datos de herramientas
        # No usar selectinload porque las relaciones están definidas con lazy='dynamic'
        tools = ToolInfo.query.all()
        htmls = HtmlInfo.query.all()
        youtube_listings = YouTubeListing.query.all()
        apis = ApiInfo.query.all()
        
        # Convertir a formato serializable
        config_data = {
            "tools": [],
            "htmls": [],
            "youtube_listings": [],
            "apis": []
        }
        
        # Exportar ToolInfo
        for tool in tools:
            # Cargar usuarios usando la relación lazy='dynamic'
            user_usernames = [u.username for u in tool.usuarios_vinculados.all()]
            tool_dict = {
                "title": tool.title,
                "text": tool.text,
                "percent": tool.percent,
                "enabled": tool.enabled,
                "user_usernames": user_usernames
            }
            config_data["tools"].append(tool_dict)
        
        # Exportar HtmlInfo
        for html in htmls:
            # Cargar usuarios usando la relación lazy='dynamic'
            user_usernames = [u.username for u in html.users.all()]
            html_dict = {
                "title": html.title,
                "text": html.text,
                "enabled": html.enabled,
                "user_usernames": user_usernames
            }
            config_data["htmls"].append(html_dict)
        
        # Exportar YouTubeListing
        for listing in youtube_listings:
            # Cargar usuarios usando la relación lazy='dynamic'
            user_usernames = [u.username for u in listing.users.all()]
            # Cargar production_links usando la relación lazy='dynamic'
            production_links = [
                {
                    "url": link.url,
                    "title": link.title
                }
                for link in listing.production_links.all()
            ]
            listing_dict = {
                "title": listing.title,
                "content": listing.content if listing.content else None,
                "enabled": listing.enabled,
                "user_usernames": user_usernames,
                "production_links": production_links
            }
            config_data["youtube_listings"].append(listing_dict)
        
        # Exportar ApiInfo
        for api in apis:
            # Cargar usuarios usando la relación lazy='dynamic'
            user_usernames = [u.username for u in api.users.all()]
            api_dict = {
                "title": api.title,
                "api_key": api.api_key,
                "api_type": api.api_type,
                "api_url": api.api_url,
                "enabled": api.enabled,
                "drive_subtitle_photos": api.drive_subtitle_photos,
                "drive_subtitle_videos": api.drive_subtitle_videos,
                "user_usernames": user_usernames
            }
            config_data["apis"].append(api_dict)
        
        # Convertir a JSON
        def default_serializer(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            raise TypeError(f"Object of type {obj.__class__.__name__} is not JSON serializable")
        
        json_data = json.dumps(config_data, indent=2, ensure_ascii=False, default=default_serializer)
        
        # Crear la respuesta Flask
        response = Response(json_data, mimetype='application/json')
        response.headers['Content-Disposition'] = 'attachment; filename=herramientas_configuracion_exportada.json'
        return response
        
    except Exception as e:
        current_app.logger.error(f"Error al exportar configuración de herramientas: {e}")
        flash('Error al generar el archivo de configuración.', 'danger')
        return jsonify({"error": "Error interno al generar el archivo"}), 500

@store_bp.route('/admin/herramientas/import_config', methods=['POST'])
@admin_required
def import_tools_config():
    """Importa configuración de herramientas desde un archivo JSON."""
    # 1. Verificar código de seguridad
    submitted_code = request.form.get('security_code', '').strip()
    actual_security_code = current_app.config.get('ADMIN_CONFIG_SECURITY_CODE')
    
    if not actual_security_code or actual_security_code == 'tu_codigo_secreto_aqui':
        current_app.logger.error("¡El código de seguridad ADMIN_CONFIG_SECURITY_CODE no está configurado correctamente en config.py!")
        flash('Error de configuración interna del servidor (código de seguridad).', 'danger')
        return redirect(url_for('store_bp.admin_tools'))
    
    if submitted_code != str(actual_security_code):
        flash('Código de seguridad incorrecto.', 'danger')
        return redirect(url_for('store_bp.admin_tools'))
    
    # 2. Verificar archivo
    if 'config_file' not in request.files:
        flash('No se seleccionó ningún archivo.', 'warning')
        return redirect(url_for('store_bp.admin_tools'))
    file = request.files['config_file']
    if file.filename == '' or not allowed_file(file.filename):
        flash('Archivo no válido o tipo incorrecto (solo .json).', 'warning')
        return redirect(url_for('store_bp.admin_tools'))
    
    try:
        file_content = file.read().decode('utf-8')
        config_data = json.loads(file_content)
        
        # --- BORRAR DATOS EXISTENTES ANTES DE IMPORTAR ---
        # Importar tablas de asociación
        from app.store.models import toolinfo_users, htmlinfo_users, youtube_listing_users, apiinfo_users, ProductionLink
        
        # Borrar tablas de asociación primero
        db.session.execute(toolinfo_users.delete())
        db.session.execute(htmlinfo_users.delete())
        db.session.execute(youtube_listing_users.delete())
        db.session.execute(apiinfo_users.delete())
        
        # Borrar ProductionLink (tiene FK a YouTubeListing)
        ProductionLink.query.delete()
        
        # Borrar registros principales
        from app.store.models import ToolInfo, HtmlInfo, YouTubeListing, ApiInfo
        ToolInfo.query.delete()
        HtmlInfo.query.delete()
        YouTubeListing.query.delete()
        ApiInfo.query.delete()
        
        db.session.flush()  # Aplicar borrados antes de crear nuevos
        
        # Obtener todos los usuarios existentes por username para mapeo
        existing_users = {u.username: u for u in User.query.all()}
        
        # 3. Importar ToolInfo (siempre procesar, incluso si está vacío)
        tools_data = config_data.get('tools', [])
        if tools_data:
            for tool_data in tools_data:
                new_tool = ToolInfo(
                    title=tool_data.get('title'),
                    text=tool_data.get('text'),
                    percent=tool_data.get('percent', 0),
                    enabled=tool_data.get('enabled', True)
                )
                db.session.add(new_tool)
                db.session.flush()
                
                # Vincular usuarios solo si existen y son los mismos
                user_usernames = tool_data.get('user_usernames', [])
                for username in user_usernames:
                    if username in existing_users:
                        new_tool.usuarios_vinculados.append(existing_users[username])
        
        # 4. Importar HtmlInfo (siempre procesar, incluso si está vacío)
        htmls_data = config_data.get('htmls', [])
        if htmls_data:
            for html_data in htmls_data:
                new_html = HtmlInfo(
                    title=html_data.get('title'),
                    text=html_data.get('text'),
                    enabled=html_data.get('enabled', True)
                )
                db.session.add(new_html)
                db.session.flush()
                
                # Vincular usuarios solo si existen y son los mismos
                user_usernames = html_data.get('user_usernames', [])
                for username in user_usernames:
                    if username in existing_users:
                        new_html.users.append(existing_users[username])
        
        # 5. Importar YouTubeListing (siempre procesar, incluso si está vacío)
        youtube_listings_data = config_data.get('youtube_listings', [])
        if youtube_listings_data:
            for listing_data in youtube_listings_data:
                new_listing = YouTubeListing(
                    title=listing_data.get('title'),
                    content=listing_data.get('content'),
                    enabled=listing_data.get('enabled', True)
                )
                db.session.add(new_listing)
                db.session.flush()
                
                # Vincular usuarios solo si existen y son los mismos
                user_usernames = listing_data.get('user_usernames', [])
                for username in user_usernames:
                    if username in existing_users:
                        new_listing.users.append(existing_users[username])
                
                # Importar production_links
                production_links = listing_data.get('production_links', [])
                for link_data in production_links:
                    new_link = ProductionLink(
                        url=link_data.get('url'),
                        title=link_data.get('title'),
                        youtube_listing_id=new_listing.id
                    )
                    db.session.add(new_link)
        
        # 6. Importar ApiInfo (siempre procesar, incluso si está vacío)
        apis_data = config_data.get('apis', [])
        if apis_data:
            for api_data in apis_data:
                new_api = ApiInfo(
                    title=api_data.get('title'),
                    api_key=api_data.get('api_key'),
                    api_type=api_data.get('api_type'),
                    api_url=api_data.get('api_url'),
                    enabled=api_data.get('enabled', True),
                    drive_subtitle_photos=api_data.get('drive_subtitle_photos'),
                    drive_subtitle_videos=api_data.get('drive_subtitle_videos')
                )
                db.session.add(new_api)
                db.session.flush()
                
                # Vincular usuarios solo si existen y son los mismos
                user_usernames = api_data.get('user_usernames', [])
                for username in user_usernames:
                    if username in existing_users:
                        new_api.users.append(existing_users[username])
        
        db.session.commit()
        flash('Configuración de herramientas importada correctamente.', 'success')
        
    except json.JSONDecodeError:
        db.session.rollback()
        flash('Error: El archivo no es un JSON válido.', 'danger')
    except KeyError as e:
        db.session.rollback()
        flash(f'Error: Falta la clave "{e}" en el archivo JSON.', 'danger')
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al importar configuración de herramientas: {e}", exc_info=True)
        flash(f'Error al importar configuración: {e}', 'danger')
    
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/herramientas', methods=['POST'], endpoint='create_tool')
@admin_required
def create_tool():
    title = request.form.get('title')
    text = request.form.get('text')
    try:
        percent = float(request.form.get('percent', 0))
    except Exception:
        percent = 0
    if not title or not text:
        flash('Todos los campos son requeridos.', 'error')
        return redirect(url_for('store_bp.admin_tools'))
    tool = ToolInfo(title=title, text=text, percent=percent, enabled=True)
    db.session.add(tool)
    try:
        db.session.commit()
        flash('Herramienta creada correctamente.', 'success')
    except Exception as e:
        db.session.rollback()
        flash('Error al crear la herramienta: ' + str(e), 'error')
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/api/create', methods=['POST'])
@admin_required
def create_api():
    title = request.form.get('title')
    api_key = request.form.get('api_key')
    api_type = request.form.get('api_type')

    if not title or not api_key:
        flash('El título y la clave de API son obligatorios.', 'danger')
        return redirect(url_for('store_bp.admin_tools'))

    # Guardar el ID de carpeta y subtítulos solo si es Drive
    api_url = None
    drive_subtitle_photos = None
    drive_subtitle_videos = None
    if api_type == 'Drive':
        api_url = request.form.get('api_url', '').strip()
        drive_subtitle_photos = request.form.get('drive_subtitle_photos', '').strip()
        drive_subtitle_videos = request.form.get('drive_subtitle_videos', '').strip()

    new_api = ApiInfo(
        title=title,
        api_key=api_key,
        api_type=api_type,
        api_url=api_url,
        drive_subtitle_photos=drive_subtitle_photos,
        drive_subtitle_videos=drive_subtitle_videos
    )
    db.session.add(new_api)
    db.session.commit()

    flash('API creada correctamente.', 'success')
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/api/<int:api_id>/edit', methods=['GET'])
@admin_required
def edit_api(api_id):
    api = ApiInfo.query.get_or_404(api_id)
    return render_template('edit_api.html', api=api)

@store_bp.route('/admin/api/<int:api_id>/edit', methods=['POST'])
@admin_required
def update_api(api_id):
    api = ApiInfo.query.get_or_404(api_id)
    title = request.form.get('title')
    api_key = request.form.get('api_key')
    api_type = request.form.get('api_type')  # Obtener el nuevo campo

    if not title or not api_key:
        flash('El título y la clave de API son obligatorios.', 'danger')
        return render_template('edit_api.html', api=api)

    api.title = title
    api.api_key = api_key
    api.api_type = api_type  # Guardar el nuevo campo
    
    # Guardar el ID de carpeta y subtítulos solo si es Drive
    if api_type == 'Drive':
        api.api_url = request.form.get('api_url', '').strip()
        api.drive_subtitle_photos = request.form.get('drive_subtitle_photos', '').strip()
        api.drive_subtitle_videos = request.form.get('drive_subtitle_videos', '').strip()
    else:
        api.api_url = None
        api.drive_subtitle_photos = None
        api.drive_subtitle_videos = None
    
    # Vincular usuarios
    user_ids = request.form.getlist('user_ids')
    if user_ids:
        users_to_link = User.query.filter(User.id.in_(user_ids)).all()
        api.users = users_to_link
    else:
        api.users = []

    db.session.commit()

    flash('API actualizada correctamente.', 'success')
    return redirect(url_for('store_bp.edit_api', api_id=api.id))

@store_bp.route('/admin/api/<int:api_id>/users', methods=['GET'])
@admin_required
def get_api_users(api_id):
    api = ApiInfo.query.get_or_404(api_id)
    admin_username = current_app.config.get('ADMIN_USER')

    page = request.args.get('page', 1, type=int)
    per_page_str = request.args.get('per_page', '5')
    per_page = None if per_page_str == 'all' else int(per_page_str)
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    if per_page:
        pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
        users_for_page = pagination.items
        total_pages = pagination.pages
        has_next = pagination.has_next
        has_prev = pagination.has_prev
    else:
        users_for_page = users_query.all()
        total_pages = 1
        has_next = False
        has_prev = False

    users_data = [{
            'id': user.id,
            'username': user.username,
        'name': user.full_name or '',
    } for user in users_for_page]
    
    linked_user_ids = {user.id for user in api.users}

    return jsonify({
        'users': users_data,
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': len(users_data),
            'pages': total_pages,
            'has_prev': has_prev,
            'has_next': has_next,
        },
        'linked_user_ids': list(linked_user_ids)
    })

@store_bp.route('/admin/api/<int:api_id>/toggle', methods=['POST'])
@admin_required
def toggle_api(api_id):
    api = ApiInfo.query.get_or_404(api_id)
    api.enabled = not api.enabled
    db.session.commit()
    return jsonify({
        'success': True,
        'new_state': 'OFF' if api.enabled else 'ON',
        'new_class': 'action-red' if api.enabled else 'action-green'
    })

@store_bp.route('/admin/api/<int:api_id>/delete', methods=['POST'])
@admin_required
def delete_api(api_id):
    api = ApiInfo.query.get_or_404(api_id)
    db.session.delete(api)
    db.session.commit()
    return jsonify({'success': True})

@store_bp.route('/admin/youtube_listing', methods=['POST'])
@admin_required
def create_youtube_listing():
    title = request.form.get('title')
    content = request.form.get('youtube_content', '').strip() or None
    if not title:
        flash('El título es requerido.', 'error')
        return redirect(url_for('store_bp.admin_tools'))
    
    new_listing = YouTubeListing(title=title, content=content, enabled=True)
    db.session.add(new_listing)
    try:
        db.session.commit()
        flash('Listado de YouTube creado correctamente.', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error al crear el listado de YouTube: {e}', 'error')
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/youtube_listing/<int:listing_id>/toggle', methods=['POST'])
@admin_required
def toggle_youtube_listing(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    listing.enabled = not listing.enabled
    db.session.commit()
    return jsonify({
        'success': True,
        'new_state': 'OFF' if listing.enabled else 'ON',
        'new_class': 'action-red' if listing.enabled else 'action-green'
    })

@store_bp.route('/admin/youtube_listing/<int:listing_id>/delete', methods=['POST'])
@admin_required
def delete_youtube_listing(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    db.session.delete(listing)
    db.session.commit()
    return jsonify({'success': True})

@store_bp.route('/admin/youtube_listing/<int:listing_id>/edit', methods=['GET', 'POST'])
@admin_required
def edit_youtube_listing(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    if request.method == 'POST':
        listing.title = request.form.get('title', listing.title)
        # Si el campo content viene en el formulario, actualizarlo (incluso si está vacío)
        if 'content' in request.form:
            content = request.form.get('content', '').strip()
            # Limpiar cualquier valor "None" como string y convertir a None si está vacío
            if content.lower() == 'none' or not content:
                listing.content = None
            else:
                listing.content = content
        # Preservar el estado enabled: si viene en el formulario, usar ese valor; si no, mantener el actual
        enabled_value = request.form.get('enabled')
        if enabled_value is not None:
            # Si viene 'on', 'true', '1' o 'yes', es True; cualquier otra cosa es False
            listing.enabled = enabled_value.lower() in ('on', 'true', '1', 'yes')
        # Si no viene el campo, mantener el estado actual (no cambiar nada)
        
        user_ids_str = request.form.getlist('user_ids')
        user_ids = [int(uid) for uid in user_ids_str if uid.isdigit()]
        
        listing.users = User.query.filter(User.id.in_(user_ids)).all() if user_ids else []

        try:
            db.session.commit()
            flash('Listado de YouTube actualizado correctamente.', 'success')
            return redirect(url_for('store_bp.admin_tools'))
        except Exception as e:
            db.session.rollback()
            flash(f'Error al actualizar el listado: {str(e)}', 'danger')
    
    return render_template('edit_youtube_listing.html', listing=listing, title="Editar Listado de YouTube")

@store_bp.route('/admin/youtube_listing/<int:listing_id>/links', methods=['GET'])
@admin_required
def get_youtube_listing_links(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    links = [{'id': link.id, 'url': link.url, 'title': link.title} for link in listing.production_links]
    return jsonify(links)

@store_bp.route('/admin/youtube_listing/<int:listing_id>/add_link', methods=['POST'])
@admin_required
def add_youtube_listing_link(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    url = request.json.get('url')
    title = request.json.get('title') # Puede ser None
    if not url:
        return jsonify({'success': False, 'error': 'URL requerida'}), 400
    
    # Simplemente guardamos el link, con o sin título.
    link = ProductionLink(url=url, title=title, youtube_listing_id=listing.id)
    db.session.add(link)
    db.session.commit()
    
    return jsonify({'success': True, 'link_id': link.id})

@store_bp.route('/admin/youtube_listing/link/<int:link_id>', methods=['DELETE', 'PUT'])
@admin_required
def manage_youtube_listing_link(link_id):
    link = ProductionLink.query.get_or_404(link_id)

    if request.method == 'DELETE':
        db.session.delete(link)
        db.session.commit()
        return jsonify({'success': True})

    if request.method == 'PUT':
        new_url = request.json.get('url')
        new_title = request.json.get('title') # Puede ser None
        if not new_url:
            return jsonify({'success': False, 'error': 'URL requerida'}), 400
        link.url = new_url
        link.title = new_title
        db.session.commit()
        return jsonify({'success': True})

@store_bp.route('/admin/youtube_listing/<int:listing_id>/users', methods=['GET'])
@admin_required
def get_youtube_listing_users(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    admin_username = current_app.config.get('ADMIN_USER')

    page = request.args.get('page', 1, type=int)
    per_page_param = request.args.get('per_page', '5')
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    # Manejar el caso especial de "all"
    if per_page_param == 'all':
        users = users_query.all()
        users_data = [{
            'id': user.id,
            'username': user.username,
            'full_name': user.full_name or ''
        } for user in users]
        
        linked_user_ids = [user.id for user in listing.users]

        return jsonify({
            'users': users_data,
            'pagination': {
                'page': 1,
                'per_page': len(users),
                'total': len(users),
                'pages': 1,
                'has_prev': False,
                'has_next': False,
            },
            'linked_user_ids': linked_user_ids
        })
    else:
        per_page = int(per_page_param)
        pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    
    users_data = [{
        'id': user.id,
        'username': user.username,
        'full_name': user.full_name or ''
    } for user in pagination.items]
    
    linked_user_ids = [user.id for user in listing.users]

    return jsonify({
        'users': users_data,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_prev': pagination.has_prev,
            'has_next': pagination.has_next,
        },
        'linked_user_ids': linked_user_ids
    })


def _github_blob_to_raw(url):
    """Convierte URL GitHub blob (vista web) a URL raw (archivo binario)."""
    import re
    # github.com/user/repo/blob/branch/path/to/file -> raw.githubusercontent.com/user/repo/branch/path/to/file
    m = re.match(r'https?://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)', url)
    if m:
        user, repo, branch, path = m.groups()
        return f'https://raw.githubusercontent.com/{user}/{repo}/{branch}/{path}'
    return url


@store_bp.route('/proxy-image')
@csrf_exempt_route
def proxy_image():
    """Proxy de imágenes externas para evitar CORB/CORS en contenido HTML (GitHub raw, etc.)."""
    url = request.args.get('url')
    if not url or not url.startswith(('http://', 'https://')):
        return Response('URL inválida', status=400)
    # Convertir GitHub blob a raw para obtener el archivo binario, no HTML
    if 'github.com' in url and '/blob/' in url:
        url = _github_blob_to_raw(url)
    try:
        resp = requests.get(url, timeout=10, stream=True)
        resp.raise_for_status()
        content_type = resp.headers.get('Content-Type', 'application/octet-stream')
        if not any(ct in content_type for ct in ('image/', 'octet-stream')):
            return Response('Solo se permiten imágenes', status=403)
        return Response(resp.iter_content(chunk_size=8192), content_type=content_type)
    except Exception as e:
        current_app.logger.warning(f"Proxy imagen falló para {url[:80]}: {e}")
        return Response('Error al cargar imagen', status=502)


@store_bp.route('/herramientas-public', endpoint='tools_public')
def tools_public():
    user = None
    username = session.get("username") # Para admin
    user_id = session.get("user_id") # Para usuarios normales

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username

    if not user:
        flash("Debes iniciar sesión para ver esta página.", "warning")
        return redirect(url_for("user_auth_bp.login"))

    admin_user = current_app.config.get("ADMIN_USER", "admin")
    if username == admin_user:
        tools = ToolInfo.query.filter_by(enabled=True).order_by(ToolInfo.id.desc()).all()
    else:
        tools = ToolInfo.query.join(ToolInfo.usuarios_vinculados).filter(
            User.id == user.id, 
            ToolInfo.enabled == True
        ).order_by(ToolInfo.id.desc()).all()

    # Cargar contenidos HTML según los permisos del usuario
    if username == admin_user:
        html_contents = HtmlInfo.query.filter_by(enabled=True).order_by(HtmlInfo.id.desc()).all()
    else:
        html_contents = HtmlInfo.query.join(HtmlInfo.users).filter(
            User.id == user.id,
            HtmlInfo.enabled == True
        ).order_by(HtmlInfo.id.desc()).all()

    # Cargar APIs según los permisos del usuario
    if username == admin_user:
        apis = ApiInfo.query.filter_by(enabled=True).order_by(ApiInfo.id.desc()).all()
        drive_apis = ApiInfo.query.filter_by(api_type="Drive", enabled=True).order_by(ApiInfo.id.desc()).all()
    else:
        apis = ApiInfo.query.join(ApiInfo.users).filter(
            User.id == user.id,
            ApiInfo.enabled == True
        ).order_by(ApiInfo.id.desc()).all()
        drive_apis = ApiInfo.query.join(ApiInfo.users).filter(
            User.id == user.id,
            ApiInfo.api_type == "Drive",
            ApiInfo.enabled == True
        ).order_by(ApiInfo.id.desc()).all()

    # Cargar videos de producción según los permisos del usuario
    if username == admin_user:
        youtube_listings = YouTubeListing.query.filter_by(enabled=True).order_by(YouTubeListing.id.desc()).all()
    else:
        youtube_listings = YouTubeListing.query.join(YouTubeListing.users).filter(
            User.id == user.id,
            YouTubeListing.enabled == True
        ).order_by(YouTubeListing.id.desc()).all()

    return render_template('herramientas_public.html',
                           tools=tools,
                           html_contents=html_contents,
                           apis=apis,
                           youtube_listings=youtube_listings,
                           drive_apis=drive_apis,
                           title="Consulta de Códigos",
                           ADMIN_USER=admin_user,
                           current_user=user,
                           username=username)

@store_bp.route('/admin/herramientas/toggle/<int:tool_id>', methods=['POST'], endpoint='toggle_tool')
@admin_required
def toggle_tool(tool_id):
    tool = ToolInfo.query.get_or_404(tool_id)
    if not hasattr(tool, 'enabled'):
        tool.enabled = True
    tool.enabled = not tool.enabled
    db.session.commit()
    flash(f"Estado de '{tool.title}' cambiado.", "success")
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/herramientas/delete/<int:tool_id>', methods=['POST'], endpoint='delete_tool')
@admin_required
def delete_tool(tool_id):
    tool = ToolInfo.query.get_or_404(tool_id)
    db.session.delete(tool)
    db.session.commit()
    flash(f"'{tool.title}' eliminado.", "success")
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/herramientas/editar/<int:tool_id>', methods=['GET', 'POST'], endpoint='edit_tool')
@admin_required
def edit_tool(tool_id):
    tool = ToolInfo.query.get_or_404(tool_id)
    admin_username = current_app.config.get('ADMIN_USER')

    if request.method == 'POST':
        tool.title = request.form.get('title', tool.title)
        tool.text = request.form.get('text', tool.text)
        try:
            tool.percent = float(request.form.get('percent', tool.percent))
        except Exception:
            pass
        user_ids_str = request.form.getlist('user_ids')
        user_ids = [int(uid) for uid in user_ids_str]

        # Desvincular usuarios que ya no están seleccionados
        current_linked_users = tool.usuarios_vinculados.all()
        for user in current_linked_users:
            if user.id not in user_ids and user.username != admin_username:
                tool.usuarios_vinculados.remove(user)

        # Vincular nuevos usuarios
        for user_id in user_ids:
            user = User.query.get(user_id)
            if user and user not in current_linked_users and user.username != admin_username:
                tool.usuarios_vinculados.append(user)
        
        db.session.commit()
        flash('Herramienta actualizada y usuarios vinculados.', 'success')
        return redirect(url_for('store_bp.admin_tools'))

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 5, type=int)
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    users = pagination.items

    return render_template('editar_herramienta.html',
                           tool=tool,
                           users=users,
                           pagination=pagination,
                           search_query=search_query,
                           per_page=per_page)

@store_bp.route('/admin/herramientas/<int:tool_id>/usuarios', methods=['GET'], endpoint='get_tool_users')
@admin_required
def get_tool_users(tool_id):
    tool = ToolInfo.query.get_or_404(tool_id)
    admin_username = current_app.config.get('ADMIN_USER')

    page = request.args.get('page', 1, type=int)
    per_page_param = request.args.get('per_page', '5')
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    # Manejar el caso cuando per_page es "all"
    if per_page_param == 'all':
        users = users_query.all()
        users_data = [{
            'id': user.id,
            'username': user.username,
            'full_name': user.full_name or ''
        } for user in users]
        
        linked_user_ids = [user.id for user in tool.usuarios_vinculados.all()]
        
        return jsonify({
            'users': users_data,
            'pagination': {
                'page': 1,
                'per_page': len(users),
                'total': len(users),
                'pages': 1,
                'has_prev': False,
                'has_next': False,
                'prev_num': None,
                'next_num': None
            },
            'linked_user_ids': linked_user_ids
        })
    
    # Caso normal con paginación
    per_page = int(per_page_param)
    pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    
    users_data = [{
        'id': user.id,
        'username': user.username,
        'full_name': user.full_name or ''
    } for user in pagination.items]
    
    linked_user_ids = [user.id for user in tool.usuarios_vinculados.all()]

    return jsonify({
        'users': users_data,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_prev': pagination.has_prev,
            'has_next': pagination.has_next,
            'prev_num': pagination.prev_num,
            'next_num': pagination.next_num
        },
        'linked_user_ids': linked_user_ids
    })

@store_bp.route('/admin/html', methods=['POST'])
@admin_required
def add_html():
    if not request.form.get('title') or not request.form.get('text'):
        flash('Todos los campos son requeridos.', 'error')
        return redirect(url_for('store_bp.admin_tools'))
    
    html = HtmlInfo(
        title=request.form.get('title'),
        text=request.form.get('text')
    )
    db.session.add(html)
    try:
        db.session.commit()
        flash('HTML agregado correctamente.', 'success')
    except:
        db.session.rollback()
        flash('Error al agregar el HTML.', 'error')
    
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/html/<int:html_id>/toggle', methods=['POST'])
@admin_required
def toggle_html(html_id):
    html = HtmlInfo.query.get_or_404(html_id)
    html.enabled = not html.enabled
    try:
        db.session.commit()
        return jsonify({
            'success': True,
            'new_state': 'OFF' if html.enabled else 'ON',
            'new_class': 'action-red' if html.enabled else 'action-green',
            'message': 'Estado actualizado correctamente.'
        })
    except:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'Error al actualizar el estado.'})

@store_bp.route('/admin/html/<int:html_id>/delete', methods=['POST'])
@admin_required
def delete_html(html_id):
    html = HtmlInfo.query.get_or_404(html_id)
    try:
        db.session.delete(html)
        db.session.commit()
        return jsonify({'success': True, 'message': 'HTML eliminado correctamente.'})
    except:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'Error al eliminar el HTML.'})

@store_bp.route('/admin/html/<int:html_id>/edit', methods=['GET', 'POST'])
@admin_required
def edit_html(html_id):
    html = HtmlInfo.query.get_or_404(html_id)
    admin_username = current_app.config.get('ADMIN_USER')

    if request.method == 'POST':
        html.title = request.form.get('title', html.title)
        html.text = request.form.get('text', html.text)
        
        user_ids_str = request.form.getlist('user_ids')
        user_ids = [int(uid) for uid in user_ids_str]

        # Desvincular y vincular usuarios
        if user_ids:
            new_users = User.query.filter(User.id.in_(user_ids)).all()
            html.users = new_users
        else:
            html.users = [] # Desvincula a todos si no se selecciona ninguno
        
        db.session.commit()
        flash('HTML actualizado y usuarios vinculados.', 'success')
        return redirect(url_for('store_bp.admin_tools'))

    # Lógica para GET
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 5, type=int)
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    users = pagination.items

    return render_template('edit_html.html',
                           html=html,
                           users=users,
                           pagination=pagination,
                           search_query=search_query,
                           per_page=per_page)

@store_bp.route('/admin/html/<int:html_id>/update', methods=['POST'])
@admin_required
def update_html(html_id):
    html = HtmlInfo.query.get_or_404(html_id)
    if not request.form.get('title') or not request.form.get('text'):
        flash('Todos los campos son requeridos.', 'error')
        return redirect(url_for('store_bp.edit_html', html_id=html_id))
    
    html.title = request.form.get('title')
    html.text = request.form.get('text')
    try:
        db.session.commit()
        flash('HTML actualizado correctamente.', 'success')
    except:
        db.session.rollback()
        flash('Error al actualizar el HTML.', 'error')
    
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/html/<int:html_id>/users', methods=['GET'])
@admin_required
def get_html_users(html_id):
    html = HtmlInfo.query.get_or_404(html_id)
    admin_username = current_app.config.get('ADMIN_USER')

    page = request.args.get('page', 1, type=int)
    per_page_param = request.args.get('per_page', '5')
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    # Manejar el caso cuando per_page es "all"
    if per_page_param == 'all':
        users = users_query.all()
        users_data = [{
            'id': user.id,
            'username': user.username,
            'full_name': user.full_name or ''
        } for user in users]
        
        linked_user_ids = [user.id for user in html.users]
        
        return jsonify({
            'users': users_data,
            'pagination': {
                'page': 1,
                'per_page': len(users),
                'total': len(users),
                'pages': 1,
                'has_prev': False,
                'has_next': False,
                'prev_num': None,
                'next_num': None
            },
            'linked_user_ids': linked_user_ids
        })
    
    # Caso normal con paginación
    per_page = int(per_page_param)
    pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    
    users_data = [{
        'id': user.id,
        'username': user.username,
        'full_name': user.full_name or ''
    } for user in pagination.items]
    
    linked_user_ids = [user.id for user in html.users]

    return jsonify({
        'users': users_data,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_prev': pagination.has_prev,
            'has_next': pagination.has_next,
            'prev_num': pagination.prev_num,
            'next_num': pagination.next_num
        },
        'linked_user_ids': linked_user_ids
    }) 

@store_bp.route('/tools/find-media', methods=['POST'])
def find_media():
    try:
        user = None
        username = session.get("username")
        user_id = session.get("user_id")

        if username:
            user = User.query.filter_by(username=username).first()
        elif user_id:
            user = User.query.get(user_id)

        if not user:
            return jsonify({'error': 'No autorizado'}), 401

        api = ApiInfo.query.filter_by(api_type="Búsqueda de Medios", enabled=True).first()
        if not api:
            return jsonify({'error': 'No hay ninguna API de "Búsqueda de Medios" configurada o habilitada.'}), 500

        query = request.json.get('query')
        country = request.json.get('country', 'CO')
        if not query:
            return jsonify({'error': 'Se requiere una consulta de búsqueda.'}), 400

        claves = {}
        for parte in api.api_key.split(','):
            if ':' in parte:
                k, v = parte.split(':', 1)
                claves[k.strip().lower()] = v.strip()

        # Definir qué APIs soportan qué países
        tmdb_supported_countries = {
            'CO', 'US', 'ES', 'MX', 'AR', 'BR', 'FR', 'DE', 'IT', 'GB', 'CA', 'AU', 'NZ', 
            'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'HU', 'RO', 'BG', 
            'HR', 'SI', 'SK', 'EE', 'LV', 'LT', 'PT', 'IE', 'GR', 'CY', 'MT', 'LU', 'IS',
            'CL', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'GT', 'SV', 'HN', 'NI',
            'DO', 'PR', 'CU', 'JM', 'TT', 'GY', 'SR', 'GF', 'FK', 'ZA', 'EG', 'MA', 'TN',
            'DZ', 'LY', 'SD', 'ET', 'KE', 'NG', 'GH', 'CI', 'SN', 'ML', 'BF', 'NE', 'TD',
            'CM', 'CF', 'CG', 'CD', 'GA', 'GQ', 'ST', 'AO', 'ZM', 'ZW', 'BW', 'NA', 'LS',
            'SZ', 'MG', 'MU', 'SC', 'KM', 'DJ', 'SO', 'ER', 'SS', 'UG', 'RW', 'BI', 'TZ',
            'MZ', 'MW'
        }

        results = []
        errors = []
        apis_consultadas = []

        # TMDb - Solo si el país está soportado
        if 'tmdb' in claves and claves['tmdb'] and country in tmdb_supported_countries:
            try:
                api_key = claves['tmdb']
                # Mapeo de países a idiomas para TMDb
                language_map = {
                    'CO': 'es-CO', 'ES': 'es-ES', 'MX': 'es-MX', 'AR': 'es-AR', 'VE': 'es-VE',
                    'PE': 'es-PE', 'CL': 'es-CL', 'EC': 'es-EC', 'BO': 'es-BO', 'PY': 'es-PY',
                    'UY': 'es-UY', 'CR': 'es-CR', 'PA': 'es-PA', 'GT': 'es-GT', 'SV': 'es-SV',
                    'HN': 'es-HN', 'NI': 'es-NI', 'DO': 'es-DO', 'PR': 'es-PR', 'CU': 'es-CU',
                    'US': 'en-US', 'GB': 'en-GB', 'CA': 'en-CA', 'AU': 'en-AU', 'NZ': 'en-NZ',
                    'IE': 'en-IE', 'FR': 'fr-FR', 'BE': 'fr-BE', 'CH': 'fr-CH', 'LU': 'fr-LU',
                    'DE': 'de-DE', 'AT': 'de-AT', 'IT': 'it-IT', 'PT': 'pt-PT', 'BR': 'pt-BR',
                    'NL': 'nl-NL', 'SE': 'sv-SE', 'NO': 'no-NO', 'DK': 'da-DK', 'FI': 'fi-FI',
                    'PL': 'pl-PL', 'CZ': 'cs-CZ', 'HU': 'hu-HU', 'RO': 'ro-RO', 'BG': 'bg-BG',
                    'HR': 'hr-HR', 'SI': 'sl-SI', 'SK': 'sk-SK', 'EE': 'et-EE', 'LV': 'lv-LV',
                    'LT': 'lt-LT', 'GR': 'el-GR', 'CY': 'el-CY', 'MT': 'mt-MT', 'IS': 'is-IS'
                }
                language = language_map.get(country, 'en-US')
                
                search_url = f"https://api.themoviedb.org/3/search/multi?api_key={api_key}&language={language}&query={query}"
                search_response = requests.get(search_url)
                search_response.raise_for_status()
                search_results = search_response.json().get('results', [])
                
                if search_results:
                    media = search_results[0]
                    media_id = media.get('id')
                    media_type = media.get('media_type')
                    if media_id and media_type in ['movie', 'tv']:
                        details_url = f"https://api.themoviedb.org/3/{media_type}/{media_id}?api_key={api_key}&language={language}&append_to_response=watch/providers"
                        details_response = requests.get(details_url)
                        details_response.raise_for_status()
                        details = details_response.json()
                        providers = details.get('watch/providers', {}).get('results', {}).get(country, {}).get('flatrate', [])
                        results.append({
                            'title': details.get('title') or details.get('name'),
                            'overview': details.get('overview'),
                            'poster_path': f"https://image.tmdb.org/t/p/w500{details.get('poster_path')}" if details.get('poster_path') else None,
                            'providers': [{'name': p['provider_name'], 'logo_path': f"https://image.tmdb.org/t/p/w92{p['logo_path']}"} for p in providers],
                            'source': 'TMDb'
                        })
                        apis_consultadas.append('TMDb')
            except Exception as e:
                errors.append(f"TMDb: {str(e)}")

        # Si no hay resultados, devolver mensaje simple (200 en lugar de 404 para que el JS lo maneje correctamente)
        if not results:
            return jsonify({
                'error': 'No se encontraron resultados o esta mal escrito el nombre.',
                'results': [],
                'errors': errors,
                'apis_consultadas': apis_consultadas,
                'pais_seleccionado': country
            }), 200

        return jsonify({
            'results': results, 
            'errors': errors, 
            'apis_consultadas': apis_consultadas,
            'pais_seleccionado': country
        })
    except Exception as e:
        import traceback
        return jsonify({'error': f'Error interno: {str(e)}'}), 500

@store_bp.route('/tools/http-request', methods=['POST'])
def http_request():
    import requests
    from flask import request, jsonify, session
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    data = request.get_json()
    url = data.get('url')
    if not url:
        return jsonify({'error': 'Se requiere una URL.'}), 400

    try:
        response = requests.get(url, timeout=7)
        result = {
            'status_code': response.status_code,
            'headers': dict(response.headers),
            'body': response.text[:2000]  # Limitar tamaño de respuesta
        }
        return jsonify({'result': result})
    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la URL: {str(e)}'}), 500 

@store_bp.route('/tools/db-query', methods=['POST'])
def db_query():
    from flask import request, jsonify, session, current_app
    from sqlalchemy import text
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    admin_username = current_app.config.get("ADMIN_USER", "admin")
    data = request.get_json()
    sql = data.get('sql')
    api_id = data.get('api_id')
    if not sql or not sql.strip().lower().startswith('select'):
        return jsonify({'error': 'Solo se permiten consultas SELECT.'}), 400

    # Permitir solo admin o usuarios principales vinculados a la API
    if not user:
        return jsonify({'error': 'No autorizado'}), 401
    if user.username == admin_username:
        pass  # admin siempre puede
    else:
        # Sub-usuarios no pueden
        if getattr(user, 'parent_id', None):
            return jsonify({'error': 'No autorizado para sub-usuarios.'}), 403
        # Debe estar vinculado a la API
        from app.store.models import ApiInfo
        api = ApiInfo.query.get(api_id)
        if not api or api.api_type != 'APIs de Base de Datos' or user not in api.users:
            return jsonify({'error': 'No autorizado para esta API.'}), 403

    try:
        result = db.session.execute(text(sql))
        columns = result.keys()
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
        return jsonify({'columns': list(columns), 'rows': rows})
    except Exception as e:
        return jsonify({'error': f'Error al ejecutar la consulta: {str(e)}'}), 500

@store_bp.route('/tools/weather', methods=['POST'])
def get_weather():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de OpenWeatherMap de la base de datos
    weather_api_info = ApiInfo.query.filter_by(api_type="Clima", enabled=True).first()
    if not weather_api_info:
        return jsonify({'error': 'No hay una API de "Clima" configurada o habilitada.'}), 500
    
    api_key = weather_api_info.api_key
    
    data = request.get_json()
    city = data.get('city')
    if not city:
        return jsonify({'error': 'Se requiere una ciudad.'}), 400

    try:
        # Consultar la API de OpenWeatherMap
        url = f"http://api.openweathermap.org/data/2.5/weather"
        params = {
            'q': city,
            'appid': api_key,
            'units': 'metric',  # Para obtener temperatura en Celsius
            'lang': 'es'  # Para obtener descripción en español
        }
        
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        weather_data = response.json()

        # Extraer información relevante
        result = {
            'city': weather_data.get('name'),
            'country': weather_data.get('sys', {}).get('country'),
            'temperature': round(weather_data.get('main', {}).get('temp', 0)),
            'feels_like': round(weather_data.get('main', {}).get('feels_like', 0)),
            'humidity': weather_data.get('main', {}).get('humidity', 0),
            'pressure': weather_data.get('main', {}).get('pressure', 0),
            'description': weather_data.get('weather', [{}])[0].get('description', ''),
            'icon': weather_data.get('weather', [{}])[0].get('icon', ''),
            'wind_speed': round(weather_data.get('wind', {}).get('speed', 0) * 3.6, 1),  # Convertir m/s a km/h
            'visibility': weather_data.get('visibility', 0) / 1000 if weather_data.get('visibility') else 0  # Convertir metros a km
        }

        return jsonify({'result': result})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la API del clima: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/currency', methods=['POST'])
def convert_currency():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de ExchangeRate-API de la base de datos
    currency_api_info = ApiInfo.query.filter_by(api_type="Moneda", enabled=True).first()
    if not currency_api_info:
        return jsonify({'error': 'No hay una API de "Moneda" configurada o habilitada.'}), 500
    
    api_key = currency_api_info.api_key
    
    data = request.get_json()
    amount = data.get('amount')
    from_currency = data.get('from_currency')
    to_currency = data.get('to_currency')
    
    if not amount or not from_currency or not to_currency:
        return jsonify({'error': 'Se requiere cantidad, moneda origen y moneda destino.'}), 400

    try:
        # Consultar la API de ExchangeRate-API
        url = f"https://v6.exchangerate-api.com/v6/{api_key}/pair/{from_currency.upper()}/{to_currency.upper()}"
        
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        currency_data = response.json()

        if currency_data.get('result') != 'success':
            return jsonify({'error': 'Error en la conversión de moneda.'}), 500

        # Calcular la conversión
        conversion_rate = currency_data.get('conversion_rate', 0)
        converted_amount = float(amount) * conversion_rate

        result = {
            'from_currency': from_currency.upper(),
            'to_currency': to_currency.upper(),
            'amount': float(amount),
            'conversion_rate': conversion_rate,
            'converted_amount': round(converted_amount, 2),
            'last_update': currency_data.get('time_last_update_utc', '')
        }

        return jsonify({'result': result})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la API de monedas: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/translate', methods=['POST'])
def translate_text():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de LibreTranslate de la base de datos
    translate_api_info = ApiInfo.query.filter_by(api_type="Traducción", enabled=True).first()
    if not translate_api_info:
        return jsonify({'error': 'No hay una API de "Traducción" configurada o habilitada.'}), 500
    
    api_key = translate_api_info.api_key
    
    data = request.get_json()
    text = data.get('text')
    target_lang = data.get('target_lang')
    
    if not text or not target_lang:
        return jsonify({'error': 'Se requiere texto y idioma destino.'}), 400

    try:
        # Detectar idioma automáticamente
        detect_url = "https://libretranslate.de/detect"
        detect_data = {
            'q': text[:100]  # Solo los primeros 100 caracteres para detección
        }
        
        detect_response = requests.post(detect_url, json=detect_data, timeout=10)
        detect_response.raise_for_status()
        detect_result = detect_response.json()
        
        if not detect_result or 'confidence' not in detect_result[0]:
            return jsonify({'error': 'No se pudo detectar el idioma del texto.'}), 500
            
        source_lang = detect_result[0]['language']
        
        # Traducir el texto
        translate_url = "https://libretranslate.de/translate"
        translate_data = {
            'q': text,
            'source': source_lang,
            'target': target_lang,
            'api_key': api_key
        }
        
        translate_response = requests.post(translate_url, json=translate_data, timeout=15)
        translate_response.raise_for_status()
        translate_result = translate_response.json()

        if 'translatedText' not in translate_result:
            return jsonify({'error': 'Error en la traducción.'}), 500

        result = {
            'original_text': text,
            'translated_text': translate_result['translatedText'],
            'source_language': source_lang,
            'target_language': target_lang,
            'confidence': round(detect_result[0]['confidence'] * 100, 1)
        }

        return jsonify({'result': result})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la API de traducción: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/geolocation', methods=['POST'])
def get_geolocation():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de OpenCage de la base de datos
    geo_api_info = ApiInfo.query.filter_by(api_type="Geolocalización", enabled=True).first()
    if not geo_api_info:
        return jsonify({'error': 'No hay una API de "Geolocalización" configurada o habilitada.'}), 500
    
    api_key = geo_api_info.api_key
    
    data = request.get_json()
    address = data.get('address')
    
    if not address:
        return jsonify({'error': 'Se requiere una dirección.'}), 400

    try:
        # Consultar la API de OpenCage Geocoder
        url = "https://api.opencagedata.com/geocode/v1/json"
        params = {
            'q': address,
            'key': api_key,
            'language': 'es',
            'limit': 1,
            'no_annotations': 1
        }
        
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        geo_data = response.json()

        if not geo_data.get('results'):
            return jsonify({'error': 'No se encontró la ubicación especificada.'}), 404

        result_data = geo_data['results'][0]
        geometry = result_data.get('geometry', {})
        components = result_data.get('components', {})
        
        # Extraer información relevante
        result = {
            'formatted_address': result_data.get('formatted', ''),
            'latitude': geometry.get('lat', 0),
            'longitude': geometry.get('lng', 0),
            'country': components.get('country', ''),
            'state': components.get('state', ''),
            'city': components.get('city', '') or components.get('town', '') or components.get('village', ''),
            'postcode': components.get('postcode', ''),
            'road': components.get('road', ''),
            'house_number': components.get('house_number', ''),
            'confidence': result_data.get('confidence', 0),
            'timezone': result_data.get('annotations', {}).get('timezone', {}).get('name', ''),
            'currency': result_data.get('annotations', {}).get('currency', {}).get('name', ''),
            'flag': result_data.get('annotations', {}).get('flag', '')
        }

        return jsonify({'result': result})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la API de geolocalización: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/news', methods=['POST'])
def get_news():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de NewsAPI de la base de datos
    news_api_info = ApiInfo.query.filter_by(api_type="Noticias", enabled=True).first()
    if not news_api_info:
        return jsonify({'error': 'No hay una API de "Noticias" configurada o habilitada.'}), 500
    
    api_key = news_api_info.api_key
    
    data = request.get_json()
    category = data.get('category', 'general')
    
    # Mapear categorías a códigos de NewsAPI
    category_mapping = {
        'general': 'general',
        'tecnologia': 'technology',
        'negocios': 'business',
        'entretenimiento': 'entertainment',
        'salud': 'health',
        'ciencia': 'science',
        'deportes': 'sports'
    }
    
    news_category = category_mapping.get(category.lower(), 'general')

    try:
        # Consultar la API de NewsAPI
        url = "https://newsapi.org/v2/top-headlines"
        params = {
            'country': 'co',  # Colombia por defecto
            'category': news_category,
            'apiKey': api_key,
            'pageSize': 10,
            'language': 'es'
        }
        
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        news_data = response.json()

        if news_data.get('status') != 'ok':
            return jsonify({'error': 'Error al obtener noticias.'}), 500

        articles = news_data.get('articles', [])
        
        # Procesar artículos
        processed_articles = []
        for article in articles[:8]:  # Limitar a 8 artículos
            processed_articles.append({
                'title': article.get('title', 'Sin título'),
                'description': article.get('description', 'Sin descripción'),
                'url': article.get('url', ''),
                'image_url': article.get('urlToImage', ''),
                'source': article.get('source', {}).get('name', 'Fuente desconocida'),
                'published_at': article.get('publishedAt', ''),
                'content': article.get('content', '')[:200] + '...' if article.get('content') else ''
            })

        result = {
            'category': category,
            'total_results': news_data.get('totalResults', 0),
            'articles': processed_articles
        }

        return jsonify({'result': result})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la API de noticias: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/email', methods=['POST'])
def send_email():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de SendGrid de la base de datos
    email_api_info = ApiInfo.query.filter_by(api_type="Correo", enabled=True).first()
    if not email_api_info:
        return jsonify({'error': 'No hay una API de "Correo" configurada o habilitada.'}), 500
    
    api_key = email_api_info.api_key
    
    data = request.get_json()
    to_email = data.get('to_email')
    subject = data.get('subject')
    message = data.get('message')
    
    if not to_email or not subject or not message:
        return jsonify({'error': 'Se requiere destinatario, asunto y mensaje.'}), 400

    try:
        # Validar formato de email
        import re
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, to_email):
            return jsonify({'error': 'Formato de email inválido.'}), 400

        # Para demostración, simulamos el envío (en producción usarías SendGrid real)
        # En un entorno real, aquí iría la integración con SendGrid
        
        # Simular respuesta exitosa
        result = {
            'to_email': to_email,
            'subject': subject,
            'message_preview': message[:100] + '...' if len(message) > 100 else message,
            'status': 'sent',
            'message_id': f'msg_{int(get_colombia_now().timestamp())}_{len(to_email)}',
            'sent_at': colombia_strftime('%Y-%m-%d %H:%M:%S'),
            'from_email': 'noreply@tusitio.com'
        }

        return jsonify({'result': result})

    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/social-media', methods=['POST'])
def post_social_media():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de Twitter de la base de datos
    social_api_info = ApiInfo.query.filter_by(api_type="Redes Sociales", enabled=True).first()
    if not social_api_info:
        return jsonify({'error': 'No hay una API de "Redes Sociales" configurada o habilitada.'}), 500
    
    api_key = social_api_info.api_key
    
    data = request.get_json()
    platform = data.get('platform')
    content = data.get('content')
    
    if not platform or not content:
        return jsonify({'error': 'Se requiere plataforma y contenido.'}), 400

    try:
        # Para demostración, simulamos la publicación
        # En un entorno real, aquí iría la integración con las APIs de redes sociales
        
        # Simular respuesta exitosa
        result = {
            'platform': platform,
            'content': content,
            'status': 'posted',
            'post_id': f'post_{int(time.time())}_{len(content)}',
            'posted_at': colombia_strftime('%Y-%m-%d %H:%M:%S'),
            'views': 0,
            'likes': 0,
            'shares': 0,
            'url': f'https://{platform.lower()}.com/post/{int(time.time())}'
        }

        return jsonify({'result': result})

    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/image-recognition', methods=['POST'])
def analyze_image():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de Google Cloud Vision de la base de datos
    vision_api_info = ApiInfo.query.filter_by(api_type="Reconocimiento de Imágenes", enabled=True).first()
    if not vision_api_info:
        return jsonify({'error': 'No hay una API de "Reconocimiento de Imágenes" configurada o habilitada.'}), 500
    
    api_key = vision_api_info.api_key
    
    data = request.get_json()
    image_url = data.get('image_url')
    
    if not image_url:
        return jsonify({'error': 'Se requiere una URL de imagen.'}), 400

    try:
        # Validar que sea una URL válida
        if not image_url.startswith(('http://', 'https://')):
            return jsonify({'error': 'La URL debe comenzar con http:// o https://'}), 400

        # Para demostración, simulamos el análisis de imagen
        # En un entorno real, aquí iría la integración con Google Cloud Vision
        
        # Simular respuesta exitosa con datos realistas
        import random
        
        # Listas de objetos, emociones y colores para simular detección
        objetos = ['persona', 'gato', 'perro', 'coche', 'árbol', 'edificio', 'flor', 'libro', 'teléfono', 'computadora', 'mesa', 'silla', 'ventana', 'puerta', 'coche', 'bicicleta', 'árbol', 'césped', 'cielo', 'nube']
        emociones = ['feliz', 'sorprendido', 'pensativo', 'contento', 'emocionado', 'triste', 'enojado', 'neutral', 'confundido', 'asustado']
        colores = ['rojo', 'azul', 'verde', 'amarillo', 'naranja', 'morado', 'rosa', 'negro', 'blanco', 'gris', 'marrón']
        
        # Simular detección de objetos (3-5 objetos aleatorios)
        objetos_detectados = random.sample(objetos, random.randint(3, 5))
        
        # Simular análisis facial
        emocion_detectada = random.choice(emociones)
        confianza_emocion = random.randint(70, 95)
        
        # Simular colores principales
        colores_principales = random.sample(colores, random.randint(2, 4))
        
        # Simular texto detectado (OCR)
        textos_detectados = [
            "Hola mundo",
            "Bienvenido",
            "123456",
            "OpenAI",
            "Google",
            "Microsoft"
        ]
        texto_detectado = random.choice(textos_detectados) if random.random() > 0.5 else ""
        
        result = {
            'image_url': image_url,
            'objects_detected': objetos_detectados,
            'emotion_analysis': {
                'emotion': emocion_detectada,
                'confidence': confianza_emocion
            },
            'color_analysis': {
                'primary_colors': colores_principales,
                'dominant_color': colores_principales[0]
            },
            'text_detection': {
                'detected_text': texto_detectado,
                'has_text': bool(texto_detectado)
            },
            'image_properties': {
                'width': random.randint(800, 1920),
                'height': random.randint(600, 1080),
                'format': random.choice(['JPEG', 'PNG', 'GIF']),
                'size_kb': random.randint(50, 500)
            },
            'analysis_confidence': random.randint(85, 98),
            'processed_at': colombia_strftime('%Y-%m-%d %H:%M:%S')
        }

        return jsonify({'result': result})

    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/chatbot', methods=['POST'])
def chat_with_ai():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de OpenAI de la base de datos
    chatbot_api_info = ApiInfo.query.filter_by(api_type="Chatbot/IA", enabled=True).first()
    if not chatbot_api_info:
        return jsonify({'error': 'No hay una API de "Chatbot/IA" configurada o habilitada.'}), 500
    
    api_key = chatbot_api_info.api_key
    
    data = request.get_json()
    message = data.get('message')
    
    if not message:
        return jsonify({'error': 'Se requiere un mensaje.'}), 400

    try:
        # Para demostración, simulamos la respuesta de IA
        # En un entorno real, aquí iría la integración con OpenAI
        
        # Simular respuesta inteligente basada en el mensaje
        import random
        
        # Respuestas contextuales basadas en palabras clave
        responses = {
            'hola': [
                "¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte hoy? 😊",
                "¡Saludos! Estoy aquí para asistirte con cualquier consulta que tengas. 🤖",
                "¡Hola! ¿Cómo puedo ser útil para ti en este momento? ✨"
            ],
            'ayuda': [
                "¡Por supuesto! Estoy aquí para ayudarte. ¿Qué necesitas saber? 🤝",
                "Te ayudo con gusto. ¿En qué tema específico necesitas asistencia? 💡",
                "¡Claro! Soy tu asistente personal. ¿Qué te gustaría consultar? 🎯"
            ],
            'gracias': [
                "¡De nada! Es un placer poder ayudarte. 😊",
                "¡No hay de qué! Estoy aquí para eso. ¿Hay algo más en lo que pueda asistirte? 🤖",
                "¡Encantado de ayudar! Si necesitas algo más, no dudes en preguntar. ✨"
            ],
            'default': [
                "¡Excelente pregunta! Como IA, puedo ayudarte con eso. 🤖",
                "Interesante consulta. Déjame procesar esa información... ⚡",
                "¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte hoy? 😊",
                "Procesando tu solicitud... ¡Aquí tienes la respuesta que necesitas! 💡",
                "Como inteligencia artificial, puedo analizar y responder a tu consulta. 🧠",
                "¡Buena pregunta! Déjame pensar en la mejor respuesta para ti. 🤔",
                "Interesante punto. Como IA, puedo ofrecerte diferentes perspectivas. 🌟"
            ]
        }
        
        # Detectar tipo de mensaje
        message_lower = message.lower()
        if 'hola' in message_lower or 'buenos' in message_lower:
            response_type = 'hola'
        elif 'ayuda' in message_lower or 'ayudar' in message_lower:
            response_type = 'ayuda'
        elif 'gracias' in message_lower or 'gracia' in message_lower:
            response_type = 'gracias'
        else:
            response_type = 'default'
        
        # Seleccionar respuesta aleatoria del tipo correspondiente
        possible_responses = responses.get(response_type, responses['default'])
        ai_response = random.choice(possible_responses)
        
        # Simular tiempo de procesamiento
        processing_time = random.randint(100, 800)
        accuracy = random.randint(80, 95)
        
        result = {
            'user_message': message,
            'ai_response': ai_response,
            'processing_time_ms': processing_time,
            'accuracy_percentage': accuracy,
            'model_used': 'GPT-3.5-turbo',
            'tokens_used': random.randint(50, 200),
            'response_timestamp': colombia_strftime('%Y-%m-%d %H:%M:%S'),
            'conversation_id': f'conv_{int(get_colombia_now().timestamp())}_{len(message)}'
        }

        return jsonify({'result': result})

    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500

from flask import jsonify, stream_with_context, request as flask_request
import json
import io
from google.oauth2 import service_account
from googleapiclient.discovery import build
import mimetypes

@store_bp.route('/api/drive-files')
def api_drive_files():
    api_id = request.args.get('id')
    if api_id:
        api = ApiInfo.query.get(api_id)
        if not api or api.api_type != "Drive" or not api.enabled:
            return jsonify({'error': 'API de Drive no encontrada o no habilitada.'}), 404
    else:
        api = ApiInfo.query.filter_by(api_type="Drive", enabled=True).first()
        if not api:
            return jsonify({'error': 'No hay API de Drive configurada.'}), 500

    cred_json_str = api.api_key  # JSON de credenciales pegado en el campo de API
    folder_id = api.api_url      # ID de la carpeta pegado en el campo URL de la API
    if not cred_json_str or not folder_id:
        return jsonify({'error': 'Faltan credenciales o ID de carpeta.'}), 400

    try:
        cred_dict = json.loads(cred_json_str)
        SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
        creds = service_account.Credentials.from_service_account_info(
            cred_dict, scopes=SCOPES
        )
        service = build('drive', 'v3', credentials=creds)
        results = service.files().list(
            q=f"'{folder_id}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false",
            fields="files(id, name, mimeType)",
            pageSize=1000
        ).execute()
        files = results.get('files', [])
        return jsonify(files)
    except Exception as e:
        import traceback
        return jsonify({'error': f'Error al consultar Drive: {str(e)}'}), 500

@store_bp.route('/drive/proxy', methods=['GET', 'HEAD', 'OPTIONS'])
def api_drive_media():
    """Proxy mejorado para servir imágenes y videos de Google Drive con streaming y compatibilidad móvil/SSL"""
    # Manejar CORS preflight (OPTIONS)
    if flask_request.method == 'OPTIONS':
        response = Response()
        origin = flask_request.headers.get('Origin')
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Range, Content-Type, Accept, Authorization'
            response.headers['Access-Control-Max-Age'] = '3600'
        return response
    
    file_id = flask_request.args.get('file_id')
    api_id = flask_request.args.get('api_id')
    media_type = flask_request.args.get('type', 'image')  # 'image' o 'video'
    
    if not file_id:
        return jsonify({'error': 'Falta file_id'}), 400
    
    if api_id:
        api = ApiInfo.query.get(api_id)
        if not api or api.api_type != "Drive" or not api.enabled:
            return jsonify({'error': 'API no encontrada'}), 404
    else:
        api = ApiInfo.query.filter_by(api_type="Drive", enabled=True).first()
        if not api:
            return jsonify({'error': 'API no configurada'}), 500
    
    try:
        import google.auth.transport.requests
        import requests
        
        cred_json_str = api.api_key
        cred_dict = json.loads(cred_json_str)
        SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
        creds = service_account.Credentials.from_service_account_info(
            cred_dict, scopes=SCOPES
        )
        
        # Refrescar token de acceso
        auth_req = google.auth.transport.requests.Request()
        creds.refresh(auth_req)
        access_token = creds.token
        
        # URL directa a la API de Drive
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        headers = {"Authorization": f"Bearer {access_token}"}
        
        # Soporte para Range requests (necesario para streaming de video en móviles)
        range_header = flask_request.headers.get('Range')
        if range_header:
            headers['Range'] = range_header
        
        # Request con streaming habilitado y timeout aumentado para móviles
        req = requests.get(url, headers=headers, stream=True, timeout=(10, 300))
        
        if req.status_code not in [200, 206]:  # 206 = Partial Content (Range request)
            return jsonify({'error': f'Drive error: {req.status_code}'}), req.status_code
        
        # Detectar Content-Type si no viene en headers
        content_type = req.headers.get('Content-Type')
        if not content_type:
            # Intentar detectar por tipo de media
            if media_type == 'video':
                content_type = 'video/mp4'  # Default para videos
            else:
                content_type = 'image/jpeg'  # Default para imágenes
        
        # Asegurar Content-Type correcto para compatibilidad móvil
        if media_type == 'video' and 'video' not in content_type:
            content_type = 'video/mp4'
        elif media_type == 'image' and 'image' not in content_type:
            content_type = 'image/jpeg'
        
        def generate():
            try:
                for chunk in req.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            except Exception as e:
                current_app.logger.error(f'Error streaming chunk: {str(e)}')
                raise
        
        # Crear respuesta streaming
        response = Response(
            stream_with_context(generate()),
            status=req.status_code,
            content_type=content_type,
            direct_passthrough=False
        )
        
        # Headers esenciales para SSL estricto y compatibilidad móvil
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        
        # Headers para CORS (necesario para algunos móviles)
        origin = flask_request.headers.get('Origin')
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Range, Content-Type, Accept'
            response.headers['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges'
        
        # Headers para streaming y cache
        headers_to_copy = ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag']
        for header in headers_to_copy:
            if header in req.headers:
                response.headers[header] = req.headers[header]
        
        # Cache control optimizado para móviles
        if 'Cache-Control' not in response.headers:
            if media_type == 'video':
                # Videos: cache más largo pero permitir revalidación
                response.headers['Cache-Control'] = 'public, max-age=7200, must-revalidate'
            else:
                # Imágenes: cache largo
                response.headers['Cache-Control'] = 'public, max-age=86400'
        
        # Headers adicionales para compatibilidad móvil
        response.headers['Accept-Ranges'] = 'bytes'
        response.headers['Content-Disposition'] = 'inline'  # Mostrar en lugar de descargar
        
        # Para SSL estricto: asegurar que no haya contenido mixto
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        
        return response
        
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Timeout al conectar con Google Drive'}), 504
    except requests.exceptions.RequestException as e:
        current_app.logger.error(f'Error en request a Drive: {str(e)}')
        return jsonify({'error': f'Error de conexión: {str(e)}'}), 502
    except Exception as e:
        current_app.logger.error(f'Error inesperado en proxy: {str(e)}')
        return jsonify({'error': str(e)}), 500

@store_bp.route('/admin/html-tools')
@admin_required
def html_tools():
    """Herramienta para crear párrafos y HTML con facilidad: editor visual + vista/copia del código"""
    return render_template('html_tools.html')

@store_bp.route('/admin/work_sheets')
@admin_required
def admin_work_sheets():
    from flask import current_app, session
    from app.models.user import User
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    username = session.get("username")
    user = User.query.filter_by(username=username).first() if username else None
    return render_template(
        'work_sheets.html',
        title="Hojas de Trabajo",
        ADMIN_USER=admin_user,
        current_user=user,
        username=username
    )

@store_bp.route('/work_sheets')
@worksheet_access_required
def user_work_sheets():
    """Ruta para usuarios con permisos específicos de hojas de cálculo"""
    from flask import current_app, session
    from app.models.user import User
    
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    user = get_current_user()
    username = user.username
    
    return render_template(
        'work_sheets.html',
        title="Hojas de Trabajo",
        ADMIN_USER=admin_user,
        current_user=user,
        username=username
    )

@store_bp.route('/api/user/worksheets')
@worksheet_access_required
def get_user_worksheets():
    """API para obtener solo las hojas de cálculo permitidas para el usuario"""
    from flask import current_app, session, jsonify
    from app.models.user import User
    from app.store.models import WorksheetTemplate, WorksheetPermission
    
    user = get_current_user()
    
    # Obtener solo las hojas de cálculo a las que el usuario tiene acceso específico
    user_worksheets = []
    
    # Buscar permisos donde el usuario está incluido
    permissions = WorksheetPermission.query.filter_by(access_type='users').all()
    for permission in permissions:
        if user in permission.users.all():
            # Obtener la plantilla asociada al permiso
            worksheet = WorksheetTemplate.query.get(permission.worksheet_id)
            if worksheet:
                user_worksheets.append({
                    'id': worksheet.id,
                    'title': worksheet.title,
                    'fields': worksheet.fields,
                    'order': worksheet.order,
                    'created_at': worksheet.created_at.isoformat() if worksheet.created_at else None
                })
    
    # Ordenar por el campo 'order'
    user_worksheets.sort(key=lambda w: w['order'])
    
    return jsonify(user_worksheets)

@store_bp.route('/admin/configurations')
@admin_required
def admin_configurations():
    return render_template('configurations.html', title="Configuraciones")

@store_bp.route('/admin/sms')
@admin_required
def admin_sms():
    """Página para consultar mensajes SMS recibidos"""
    return render_template('sms.html', title="Consulta de Códigos SMS")


def _backup_mtime_colombia_12h(mtime_unix: float) -> str:
    """mtime UTC del fichero → fecha/hora en Colombia, formato 12 h."""
    utc_dt = datetime.fromtimestamp(mtime_unix, tz=timezone.utc)
    co = utc_to_colombia(utc_dt)
    h12 = co.hour % 12 or 12
    am_pm = 'p. m.' if co.hour >= 12 else 'a. m.'
    return f'{co.year:04d}-{co.month:02d}-{co.day:02d} {h12}:{co.strftime("%M")} {am_pm}'


def _backup_filename_display(fname: str) -> str:
    """Quita _HHMMSS antes de .db para la tabla (solo visual; el fichero real sigue completo)."""
    if not fname:
        return fname
    return re.sub(r'_\d{6}(\.db)$', r'\1', fname, flags=re.IGNORECASE)


def _human_size(n):
    for u in ('B', 'KB', 'MB', 'GB'):
        if n < 1024.0:
            return f'{n:.1f} {u}'
        n /= 1024.0
    return f'{n:.1f} TB'


@store_bp.route('/admin/backup', methods=['GET'], endpoint='admin_backup')
@admin_required
def admin_backup():
    """Listado de copias SQLite + acciones."""
    from app.services import db_backup_service as bk
    rows = bk.list_backup_files()
    backups = []
    bd = bk.backups_directory()
    for r in rows:
        backups.append({
            **r,
            'name_display': _backup_filename_display(r['name']),
            'size_h': _human_size(r['size']),
            'mtime_h': _backup_mtime_colombia_12h(r['mtime']),
            'kind': 'auto' if r['name'].startswith('auto_') else 'manual',
        })
    sqlite_path = bk.get_resolved_sqlite_database_path(current_app)
    uri = (current_app.config.get('SQLALCHEMY_DATABASE_URI') or '')
    is_sqlite = sqlite_path is not None and uri.lower().startswith('sqlite')
    return render_template(
        'backup.html',
        title='Copias de seguridad',
        backups=backups,
        backups_dir=str(bd.resolve()),
        db_path_preview=sqlite_path or '—',
        is_sqlite=is_sqlite,
    )


@store_bp.route('/admin/backup/manual', methods=['POST'])
@admin_required
def admin_backup_manual():
    """Crea una copia manual inmediata (no cuenta para la rotación de 100 autos)."""
    from app.services import db_backup_service as bk
    path = bk.create_manual_backup_now()
    if path:
        flash('Copia manual creada: ' + os.path.basename(path), 'success')
    else:
        flash('No se pudo crear la copia. Comprueba que la BD sea SQLite y exista el archivo.', 'danger')
    return redirect(url_for('store_bp.admin_backup'))


@store_bp.route('/admin/backup/restore', methods=['POST'])
@admin_required
def admin_backup_restore():
    from app.services import db_backup_service as bk
    fn = (request.form.get('filename') or '').strip()
    if not fn:
        flash('No se indicó el archivo.', 'danger')
        return redirect(url_for('store_bp.admin_backup'))
    ok, msg = bk.restore_from_backup_file(fn)
    flash(msg, 'success' if ok else 'danger')
    return redirect(url_for('store_bp.admin_backup'))


@store_bp.route('/admin/backup/delete', methods=['POST'])
@admin_required
def admin_backup_delete():
    from app.services import db_backup_service as bk

    fn = (request.form.get('filename') or '').strip()
    if not fn:
        flash('No se indicó el archivo.', 'danger')
        return redirect(url_for('store_bp.admin_backup'))
    ok, msg = bk.delete_backup_file(fn)
    flash(msg, 'success' if ok else 'danger')
    return redirect(url_for('store_bp.admin_backup'))


@store_bp.route('/admin/backup/delete-all', methods=['POST'])
@admin_required
def admin_backup_delete_all():
    """Elimina todas las copias excepto la más reciente."""
    from app.services import db_backup_service as bk

    ok, msg = bk.delete_all_backups_except_latest()
    flash(msg, 'success' if ok else 'danger')
    return redirect(url_for('store_bp.admin_backup'))


@store_bp.route('/admin/backup/download/<path:filename>')
@admin_required
def admin_backup_download(filename):
    from app.services import db_backup_service as bk
    from werkzeug.utils import secure_filename as _sec
    if _sec(filename) != filename:
        abort(404)
    bd = bk.backups_directory()
    fp = (bd / filename).resolve()
    try:
        bd_r = bd.resolve()
        if not str(fp).startswith(str(bd_r) + os.sep):
            abort(404)
    except OSError:
        abort(404)
    if not fp.is_file():
        abort(404)
    return send_file(fp, as_attachment=True, download_name=filename, mimetype='application/octet-stream')


@store_bp.route('/admin/support')
@admin_required
def admin_support():
    # Solo usuarios normales (no admin, no sub-usuarios) para la tabla de gestión
    current_user = get_current_user()
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    users = User.query.filter(
        User.username != admin_user,
        User.parent_id.is_(None)
    ).order_by(User.username).all()
    return render_template('chatsoporte.html', title="Chat Soporte", users=users, current_user=current_user, user_has_worksheet_access=user_has_worksheet_access, ADMIN_USER=admin_user, User=User, is_support_user=False)

@store_bp.route('/support/dashboard')
@chat_access_required
def support_dashboard():
    """Dashboard de chat de soporte para usuarios con is_support=True"""
    current_user = get_current_user()
    
    if not current_user or not current_user.is_support:
        flash("No tienes permisos de soporte.", "danger")
        return redirect(url_for('main_bp.home'))
    
    # Solo usuarios normales (no admin, no sub-usuarios) para la tabla de gestión
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    users = User.query.filter(
        User.username != admin_user,
        User.parent_id.is_(None)
    ).order_by(User.username).all()
    return render_template('chatsoporte.html', title="Dashboard de Chat de Soporte", users=users, is_support_user=True, current_user=current_user, user_has_worksheet_access=user_has_worksheet_access, ADMIN_USER=admin_user, User=User)

@store_bp.route('/admin/update_chat_permission', methods=['POST'])
@admin_required
def update_chat_permission():
    """Actualiza el permiso de chat de un usuario"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        can_chat = data.get('can_chat')
        
        if not user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario requerido'}), 400
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        
        # Actualizar el permiso de chat
        # Si se activa chat, desactivar soporte
        if can_chat:
            user.is_support = False
        
        user.can_chat = can_chat
        db.session.commit()
        
        return jsonify({'status': 'success', 'message': 'Permiso de chat actualizado correctamente'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': f'Error al actualizar permiso: {str(e)}'}), 500

@store_bp.route('/admin/update_subusers_permission', methods=['POST'])
@admin_required
def update_subusers_permission():
    """Actualiza el permiso de gestión de sub-usuarios de un usuario"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        can_manage_subusers = data.get('can_manage_subusers')
        
        if not user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario requerido'}), 400
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        
        # Si se activa gestión de sub-usuarios, desactivar soporte
        if can_manage_subusers:
            user.is_support = False
        
        # Actualizar el permiso de gestión de sub-usuarios
        user.can_manage_subusers = can_manage_subusers
        db.session.commit()
        
        return jsonify({'status': 'success', 'message': 'Permiso de gestión de sub-usuarios actualizado correctamente'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': f'Error al actualizar permiso: {str(e)}'}), 500

@store_bp.route('/admin/deactivate_chat_for_subusers', methods=['POST'])
@admin_required
def deactivate_chat_for_subusers():
    """Desactiva el chat para todos los sub-usuarios de un usuario padre"""
    try:
        data = request.get_json()
        parent_user_id = data.get('parent_user_id')
        
        if not parent_user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario padre requerido'}), 400
        
        # Buscar todos los sub-usuarios del usuario padre
        subusers = User.query.filter_by(parent_id=parent_user_id).all()
        updated_subusers = []
        
        for subuser in subusers:
            if subuser.can_chat:  # Solo actualizar si actualmente tiene chat activado
                subuser.can_chat = False
                updated_subusers.append(subuser.id)
        
        if updated_subusers:
            db.session.commit()
            return jsonify({
                'status': 'success', 
                'message': f'Chat desactivado para {len(updated_subusers)} sub-usuarios',
                'updated_subusers': updated_subusers
            })
        else:
            return jsonify({
                'status': 'success', 
                'message': 'No hay sub-usuarios con chat activado para desactivar',
                'updated_subusers': []
            })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': f'Error al desactivar chat: {str(e)}'}), 500

@store_bp.route('/admin/update_soporte_permission', methods=['POST'])
@admin_required
def update_soporte_permission():
    """Actualiza el permiso de soporte de un usuario"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        is_support = data.get('is_support')
        
        if not user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario requerido'}), 400
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        
        # Si se activa soporte, desactivar chat y sub-usuarios
        if is_support:
            user.can_chat = False
            user.can_manage_subusers = False
            
            # Eliminar todo el chat del usuario en cascada
            try:
                # Importar modelos
                from app.models.chat import ChatMessage, ChatSession
                
                # Eliminar archivos físicos del chat antes de borrar mensajes
                ChatMessage.delete_attachment_files_for_user(user_id)
                # Verificar cuántos mensajes existen antes de eliminar
                messages_before = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == user_id,
                        ChatMessage.recipient_id == user_id
                    )
                ).count()
                
                # Verificar cuántas sesiones existen antes de eliminar
                sessions_before = ChatSession.query.filter_by(user_id=user_id).count()
                
                # Eliminar mensajes del usuario
                deleted_messages = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == user_id,
                        ChatMessage.recipient_id == user_id
                    )
                ).delete()
                
                # Eliminar sesiones de chat del usuario
                deleted_sessions = ChatSession.query.filter_by(user_id=user_id).delete()
                
                # Verificar que realmente se eliminaron
                messages_after = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == user_id,
                        ChatMessage.recipient_id == user_id
                    )
                ).count()
                
                sessions_after = ChatSession.query.filter_by(user_id=user_id).count()
                
                # Si no se eliminaron todos, forzar commit y reintentar
                if messages_after > 0 or sessions_after > 0:
                    db.session.commit()
                    db.session.rollback()
                    
                    # Reintentar eliminación
                    ChatMessage.query.filter(
                        db.or_(
                            ChatMessage.sender_id == user_id,
                            ChatMessage.recipient_id == user_id
                        )
                    ).delete()
                    
                    ChatSession.query.filter_by(user_id=user_id).delete()
                
            except Exception as e:
                # Continuar con la actualización del permiso aunque falle la eliminación del chat
                pass
        
        user.is_support = is_support
        db.session.commit()
        
        return jsonify({'status': 'success', 'message': 'Permiso de soporte actualizado correctamente'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': f'Error al actualizar permiso: {str(e)}'}), 500

@store_bp.route('/chat_soporte')
@chat_access_required
def user_chat_soporte():
    """Página de chat de soporte para usuarios"""
    current_user = get_current_user()
    
    if not current_user:
        flash("No tienes permiso para acceder al chat de soporte.", "danger")
        return redirect(url_for('main_bp.home'))
    
    # Obtener admin_user para la plantilla
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    
    # Si el usuario es soporte, mostrar el dashboard de soporte
    if current_user.is_support:
        return render_template('chatsoporte.html', title="Dashboard de Chat de Soporte", users=[], is_support_user=True, current_user=current_user, user_has_worksheet_access=user_has_worksheet_access, ADMIN_USER=admin_user, User=User)
    
    # Si no es soporte, verificar que tenga permiso de chat
    if not current_user.can_chat:
        flash("No tienes permiso para acceder al chat de soporte.", "danger")
        return redirect(url_for('main_bp.home'))
    
    return render_template('user_chat_soporte.html', title="Chat de Soporte", current_user=current_user, ADMIN_USER=admin_user)

@store_bp.route('/admin/purchase_history')
@admin_required
def admin_purchase_history():
    """Ruta legacy: la vista unificada es historial_compras_usuario."""
    return redirect(url_for('store_bp.historial_compras_usuario'))

@store_bp.route('/admin/pagos/add_balance', methods=['POST'])
@admin_required
def add_balance():
    data = request.get_json() or {}
    username = data.get('username')
    amount_usd = data.get('amount_usd')
    amount_cop = data.get('amount_cop')
    subtract = bool(data.get('subtract'))
    if not username or (not amount_usd and not amount_cop):
        return jsonify({'success': False, 'error': 'Faltan datos'}), 400
    try:
        amount_usd = float(amount_usd) if amount_usd else 0.0
        amount_cop = float(amount_cop) if amount_cop else 0.0
    except Exception:
        return jsonify({'success': False, 'error': 'Monto inválido'}), 400
    if subtract and amount_usd <= 0 and amount_cop <= 0:
        return jsonify({'success': False, 'error': 'El monto a descontar debe ser mayor que cero'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado'}), 404
    # Solo permitir añadir saldo en la moneda correspondiente al tipo_precio del usuario
    tipo_precio = None
    # Verificar user_prices
    if user.user_prices and isinstance(user.user_prices, dict):
        tipo_precio_raw = user.user_prices.get('tipo_precio')
        if tipo_precio_raw and tipo_precio_raw in ['USD', 'COP']:
            tipo_precio = tipo_precio_raw.lower()
    if tipo_precio == 'usd':
        cur = user.saldo_usd or 0
        if subtract:
            user.saldo_usd = max(0.0, cur - amount_usd)
        else:
            user.saldo_usd = cur + amount_usd
    elif tipo_precio == 'cop':
        cur = user.saldo_cop or 0
        if subtract:
            user.saldo_cop = max(0.0, cur - amount_cop)
        else:
            user.saldo_cop = cur + amount_cop
    else:
        return jsonify({'success': False, 'error': 'El usuario no tiene tipo de precio configurado (USD o COP).'}), 400
    from app import db
    db.session.commit()
    return jsonify({'success': True, 'new_saldo_usd': user.saldo_usd, 'new_saldo_cop': user.saldo_cop})


@store_bp.route('/api/user/store-menu-balance', methods=['GET'])
@csrf_exempt_route
def api_user_store_menu_balance():
    """Saldo mostrado en el pie del menú móvil (actualización sin recargar, p. ej. tras abonar desde admin)."""
    if not session.get('logged_in'):
        return jsonify({'show': False, 'line': None})
    uid = session.get('user_id')
    if not uid:
        return jsonify({'show': False, 'line': None})
    user = User.query.get(uid)
    if not user:
        return jsonify({'show': False, 'line': None})
    return jsonify(build_store_menu_saldo_display(user))


# Validación de cupones
@store_bp.route('/validate_coupon', methods=['POST'])
def validate_coupon():
    """Validar un cupón para la tienda pública"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Datos no válidos'})
            
        coupon_code = data.get('coupon_code', '').strip().upper()
        products = data.get('products', [])  # Lista de IDs de productos en el carrito
        
        if not coupon_code:
            return jsonify({'success': False, 'error': 'Código de cupón requerido'})
        
        # Buscar el cupón (buscar por name que es el código del cupón)
        coupon = Coupon.query.filter_by(name=coupon_code, enabled=True).first()
        
        if not coupon:
            return jsonify({'success': False, 'error': 'Cupón no válido o expirado'})
        
        # Verificar si el cupón ha expirado usando zona horaria de Colombia
        if coupon.duration_days and coupon.created_at:
            from datetime import datetime, timedelta
            # Usar módulo centralizado de timezone
            colombia_now = get_colombia_datetime()
            
            # Convertir created_at a zona horaria de Colombia usando módulo centralizado
            created_at_col = utc_to_colombia(coupon.created_at)
            
            expiration_date = created_at_col + timedelta(days=coupon.duration_days)
            if colombia_now > expiration_date:
                return jsonify({'success': False, 'error': 'Cupón expirado'})
        
        # Verificar si hay productos en el carrito
        if not products:
            return jsonify({'success': False, 'error': 'No hay productos en el carrito'})
        
        # Verificar si el cupón aplica a los productos del carrito
        if coupon.products:
            coupon_product_ids = [p.id for p in coupon.products]
            if not any(int(pid) in coupon_product_ids for pid in products):
                return jsonify({'success': False, 'error': 'Este cupón no aplica a los productos seleccionados'})
        
        # Verificar monto mínimo si está configurado
        if coupon.min_amount and coupon.min_amount > 0:
            # Calcular total del carrito (esto debería venir del frontend)
            total_amount = data.get('total_amount', 0)
            if total_amount < float(coupon.min_amount):
                return jsonify({'success': False, 'error': f'El cupón requiere un monto mínimo de ${coupon.min_amount} COP'})
        
        # Obtener productos elegibles para el descuento
        eligible_products = []
        if coupon.products:
            coupon_product_ids = [p.id for p in coupon.products]
            for pid in products:
                if int(pid) in coupon_product_ids:
                    # Buscar el producto para obtener su información
                    product = Product.query.get(int(pid))
                    if product:
                        eligible_products.append({
                            'id': product.id,
                            'name': product.name,
                            'discount_cop': float(coupon.discount_cop) if coupon.discount_cop else 0,
                            'discount_usd': float(coupon.discount_usd) if coupon.discount_usd else 0
                        })
        else:
            # Si no hay productos específicos, el cupón aplica a todos
            for pid in products:
                product = Product.query.get(int(pid))
                if product:
                    eligible_products.append({
                        'id': product.id,
                        'name': product.name,
                        'discount_cop': float(coupon.discount_cop) if coupon.discount_cop else 0,
                        'discount_usd': float(coupon.discount_usd) if coupon.discount_usd else 0
                    })
        
        # Retornar información del cupón válido con productos elegibles
        return jsonify({
            'success': True,
            'coupon': {
                'id': coupon.id,
                'name': coupon.name,
                'discount_cop': coupon.discount_cop,
                'discount_usd': coupon.discount_usd,
                'description': coupon.description,
                'min_amount': coupon.min_amount
            },
            'eligible_products': eligible_products
        })
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error interno: {str(e)}'})

@store_bp.route('/')
@store_access_required
def tienda_alias():
    products = public_store_products_query().order_by(Product.name).all()
    coupons = Coupon.query.filter_by(enabled=True, show_public=True).order_by(Coupon.id.desc()).all()
    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    saldo_usd = user.saldo_usd if user else 0
    saldo_cop = user.saldo_cop if user else 0
    puede_tener_deuda = _user_puede_tener_deuda_effective(user) if user else False
    product_stock_initial = (
        {p.id: _compute_public_sellable_stock_for_product(p) for p in products}
        if products
        else {}
    )
    return render_template(
        'store_front.html',
        products=products,
        product_stock_initial=product_stock_initial,
        coupons=coupons,
        ADMIN_USER=admin_user,
        current_user=user,
        username=username,
        saldo_usd=saldo_usd,
        saldo_cop=saldo_cop,
        puede_tener_deuda=puede_tener_deuda,
    )

@store_bp.route('/store_front')
@store_access_required
def store_front_alias():
    products = public_store_products_query().order_by(Product.name).all()
    coupons = Coupon.query.filter_by(enabled=True, show_public=True).order_by(Coupon.id.desc()).all()
    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    saldo_usd = user.saldo_usd if user else 0
    saldo_cop = user.saldo_cop if user else 0
    puede_tener_deuda = _user_puede_tener_deuda_effective(user) if user else False
    product_stock_initial = (
        {p.id: _compute_public_sellable_stock_for_product(p) for p in products}
        if products
        else {}
    )
    return render_template(
        'store_front.html',
        products=products,
        product_stock_initial=product_stock_initial,
        coupons=coupons,
        ADMIN_USER=admin_user,
        current_user=user,
        username=username,
        saldo_usd=saldo_usd,
        saldo_cop=saldo_cop,
        puede_tener_deuda=puede_tener_deuda,
    )

# --- Al dar acceso a la tienda a un subusuario, solo actualizar can_access_store, sin roles ---
from app.models.user import User
@store_bp.route('/subusers/update_access', methods=['POST'])
def update_subuser_access():
    data = request.get_json()
    subuser_id = data.get('subuser_id')
    can_access_store = data.get('can_access_store', False)
    subuser = User.query.get(subuser_id)
    if not subuser:
        return jsonify({'success': False, 'error': 'Subusuario no encontrado.'}), 404
    subuser.can_access_store = bool(can_access_store)
    db.session.commit()
    return jsonify({'success': True, 'can_access_store': subuser.can_access_store})


@store_bp.route('/procesar_pago', methods=['POST'])
@store_access_required
def procesar_pago():
    from collections import defaultdict
    from datetime import datetime, timedelta
    from app.store.models import Product, Sale, License, LicenseAccount

    _ensure_license_account_sale_id_column()
    _ensure_license_day_notepads_column()
    _ensure_license_account_renewal_reserve_columns()

    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no autenticado'}), 401
    data = request.get_json()
    productos = data.get('productos', [])
    if not productos:
        return jsonify({'success': False, 'error': 'No hay productos'}), 400

    archived_pids = _product_ids_with_archived_license()
    for _p in productos:
        try:
            _pid = int(_p.get('id'))
        except (TypeError, ValueError):
            continue
        if _pid in archived_pids:
            return jsonify(
                {
                    'success': False,
                    'error': 'Hay productos archivados o no disponibles. Recarga la tienda y quítalos del carrito.',
                }
            ), 400

    cantidad_por_producto = defaultdict(int)
    renewal_ids_por_producto = {}
    for _p in productos:
        try:
            _pid = int(_p.get('id'))
        except (TypeError, ValueError):
            continue
        raw_ren = _p.get('renovacion_account_ids') or []
        if raw_ren and isinstance(raw_ren, list):
            ren_ids = []
            for x in raw_ren:
                try:
                    ren_ids.append(int(x))
                except (TypeError, ValueError):
                    pass
            if ren_ids:
                renewal_ids_por_producto[_pid] = ren_ids
                cantidad_por_producto[_pid] += len(ren_ids)
                continue
        try:
            _q = int(_p.get('cantidad', 1) or 1)
        except (TypeError, ValueError):
            _q = 1
        cantidad_por_producto[_pid] += max(1, _q)

    for _pid, _qty in cantidad_por_producto.items():
        _prod = Product.query.get(_pid)
        if not _prod:
            return jsonify({'success': False, 'error': 'Producto no válido en el pedido'}), 400
        if _pid in renewal_ids_por_producto:
            continue
        _sellable = _compute_public_sellable_stock_for_product(_prod)
        _reserve = _warranty_reserve_for_product(_prod)
        if _qty > _sellable:
            return jsonify(
                {
                    'success': False,
                    'error': (
                        f'No hay suficientes existencias para «{_prod.name}». '
                        f'Máximo vendible ahora: {_sellable} (reserva de garantía: {_reserve}).'
                    ),
                }
            ), 400

    renovacion_perdidas = []
    if renewal_ids_por_producto:
        _renewal_release_stale_reservations()
        seen_ren_val = set()
        for _pid, id_list in renewal_ids_por_producto.items():
            for aid in id_list:
                if aid in seen_ren_val:
                    continue
                seen_ren_val.add(aid)
                acc = LicenseAccount.query.get(aid)
                em = (getattr(acc, 'email', None) or '').strip() if acc else ''
                if not acc or not _renewal_account_available_for_user(acc, user.id):
                    renovacion_perdidas.append(
                        {
                            'account_id': aid,
                            'email': em or str(aid),
                            'message': 'La cuenta ya fue vendida o ya no está disponible.',
                        }
                    )
        if renovacion_perdidas:
            return jsonify(
                {
                    'success': False,
                    'error': (
                        'Una o más cuentas de renovación ya no están disponibles '
                        '(fueron vendidas). Se quitarán del carrito.'
                    ),
                    'renovacion_perdidas': renovacion_perdidas,
                }
            ), 409

    total_cop = 0
    total_usd = 0
    for p in productos:
        if p.get('moneda') == 'COP':
            total_cop += p.get('cantidad', 1) * p.get('precio_unitario', 0)
        elif p.get('moneda') == 'USD':
            total_usd += p.get('cantidad', 1) * p.get('precio_unitario', 0)
    if user.saldo_cop is None:
        user.saldo_cop = 0
    if user.saldo_usd is None:
        user.saldo_usd = 0
    permite_deuda = _user_puede_tener_deuda_effective(user)
    if not permite_deuda:
        if total_cop > user.saldo_cop:
            return jsonify({'success': False, 'error': 'Saldo COP insuficiente'}), 400
        if total_usd > user.saldo_usd:
            return jsonify({'success': False, 'error': 'Saldo USD insuficiente'}), 400
    else:
        debt_err = _store_prepaid_debt_limit_error(user, total_cop, total_usd)
        if debt_err:
            return jsonify({'success': False, 'error': debt_err}), 400

    cuentas_asignadas = []
    asignadas_por_producto = defaultdict(int)
    sold_bloc_moves = []
    checkout_sale_ids = []

    try:
        for p in productos:
            producto = Product.query.get(p.get('id'))
            if not producto:
                continue

            raw_renewal_ids = p.get('renovacion_account_ids') or []
            renewal_account_ids = []
            if raw_renewal_ids and isinstance(raw_renewal_ids, list):
                for x in raw_renewal_ids:
                    try:
                        renewal_account_ids.append(int(x))
                    except (TypeError, ValueError):
                        pass

            if renewal_account_ids:
                cantidad = len(renewal_account_ids)
            else:
                try:
                    cantidad = int(p.get('cantidad', 1) or 1)
                except (TypeError, ValueError):
                    cantidad = 1
                cantidad = max(1, cantidad)

            venta = Sale(
                user_id=user.id,
                product_id=producto.id,
                quantity=cantidad,
                total_price=cantidad * p.get('precio_unitario', 0),
                is_renewal=bool(renewal_account_ids),
            )
            db.session.add(venta)
            db.session.flush()
            checkout_sale_ids.append(venta.id)

            cuentas_necesarias = cantidad
            cuentas_asignadas_producto = 0

            if renewal_account_ids:
                seen_ren = set()
                for aid in renewal_account_ids:
                    if aid in seen_ren:
                        db.session.rollback()
                        return jsonify(
                            {
                                'success': False,
                                'error': 'Hay cuentas de renovación duplicadas en el pedido.',
                            }
                        ), 400
                    seen_ren.add(aid)
                    account = LicenseAccount.query.get(aid)
                    if not account:
                        db.session.rollback()
                        return jsonify(
                            {'success': False, 'error': 'Cuenta de renovación no válida.'},
                        ), 400
                    lic_row = License.query.get(account.license_id)
                    if (
                        not lic_row
                        or not lic_row.enabled
                        or lic_row.product_id != producto.id
                    ):
                        db.session.rollback()
                        return jsonify(
                            {
                                'success': False,
                                'error': (
                                    f'La cuenta de renovación no corresponde a «{producto.name}».'
                                ),
                            }
                        ), 400
                    if not _renewal_account_available_for_user(account, user.id):
                        db.session.rollback()
                        em = (account.email or '').strip() or 'cuenta'
                        return jsonify(
                            {
                                'success': False,
                                'error': (
                                    'Una o más cuentas de renovación ya no están disponibles '
                                    '(fueron vendidas). Se quitarán del carrito.'
                                ),
                                'renovacion_perdidas': [
                                    {
                                        'account_id': account.id,
                                        'email': em,
                                        'message': 'La cuenta ya fue vendida o ya no está disponible.',
                                    }
                                ],
                            }
                        ), 409
                    _public_checkout_assign_license_account(
                        account,
                        lic_row,
                        user,
                        venta,
                        producto,
                        sold_bloc_moves,
                        cuentas_asignadas,
                    )
                    cuentas_asignadas_producto += 1
                asignadas_por_producto[producto.id] += cuentas_asignadas_producto
                continue

            licenses = (
                License.query.filter_by(product_id=producto.id, enabled=True)
                .order_by(License.id.asc())
                .all()
            )

            for license in licenses:
                if cuentas_asignadas_producto >= cuentas_necesarias:
                    break

                reserve = _license_warranty_days_public(license)
                cuentas_faltantes = cuentas_necesarias - cuentas_asignadas_producto

                avail_candidates = [
                    a
                    for a in LicenseAccount.query.filter_by(
                        license_id=license.id,
                        status='available',
                    ).all()
                    if _renewal_account_unreserved_for_public_sale(a)
                ]
                avail_ordered = sorted(
                    avail_candidates,
                    key=lambda row: (
                        row.inventory_bloc_ord is None,
                        int(row.inventory_bloc_ord)
                        if row.inventory_bloc_ord is not None
                        and str(row.inventory_bloc_ord).strip().isdigit()
                        else 10**9,
                        row.id,
                    ),
                )
                n_avail = len(avail_ordered)
                max_take = max(0, n_avail - reserve)
                if max_take <= 0:
                    continue

                take = min(cuentas_faltantes, max_take)
                accounts = avail_ordered[:take]

                for account in accounts:
                    _public_checkout_assign_license_account(
                        account,
                        license,
                        user,
                        venta,
                        producto,
                        sold_bloc_moves,
                        cuentas_asignadas,
                    )
                    cuentas_asignadas_producto += 1

            asignadas_por_producto[producto.id] += cuentas_asignadas_producto

        for _pid, _need in cantidad_por_producto.items():
            if asignadas_por_producto.get(_pid, 0) < _need:
                db.session.rollback()
                _pn = Product.query.get(_pid)
                _name = _pn.name if _pn else str(_pid)
                return jsonify(
                    {
                        'success': False,
                        'error': (
                            f'No se pudieron asignar todas las cuentas para «{_name}». '
                            'Recarga la tienda e inténtalo de nuevo.'
                        ),
                    }
                ), 409

        _apply_public_checkout_bloc_moves_to_licenses(sold_bloc_moves)

        user.saldo_cop -= total_cop
        user.saldo_usd -= total_usd
        db.session.commit()
        if checkout_sale_ids:
            from app.store.sale_purchase_snapshot import (
                ensure_sale_schema,
                sync_snapshots_for_sale_ids,
            )

            try:
                ensure_sale_schema()
                sync_snapshots_for_sale_ids(checkout_sale_ids)
            except Exception as snap_exc:
                current_app.logger.warning(
                    'Snapshot historial compras tras checkout: %s', snap_exc
                )
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('procesar_pago: %s', e)
        return jsonify({'success': False, 'error': 'Error al procesar el pago'}), 500

    return jsonify(
        {
            'success': True,
            'new_saldo_cop': user.saldo_cop,
            'new_saldo_usd': user.saldo_usd,
            'cuentas_asignadas': cuentas_asignadas,
        }
    )


_RENEWAL_EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', re.ASCII)


def _parse_renewal_email_tokens(raw_text):
    """Correos para renovación: separados por espacio, coma o salto de línea."""
    if not raw_text:
        return []
    seen = set()
    out = []
    for chunk in re.split(r'[\s,;]+', str(raw_text).strip()):
        em = chunk.strip().lower()
        if not em or em in seen:
            continue
        seen.add(em)
        out.append(em)
    return out


def _renewal_email_is_valid(email):
    em = (email or '').strip().lower()
    if '@' not in em or '.' not in em.split('@')[-1]:
        return False
    return bool(_RENEWAL_EMAIL_RE.match(em))


# Tiempo que la cuenta queda bloqueada para otros en carrito de renovación.
# Tras vencer, otros pueden reservar/comprar; quien la tenía en carrito puede pagar si sigue available.
RENEWAL_RESERVE_TTL_MINUTES = 5


def _ensure_license_account_renewal_reserve_columns():
    """Reserva de cuenta en carrito de renovación hasta procesar pago."""
    try:
        from sqlalchemy import inspect, text

        inspector = inspect(db.engine)
        if 'store_license_accounts' not in inspector.get_table_names():
            return
        cols = {c['name'].lower() for c in inspector.get_columns('store_license_accounts')}
        dialect = getattr(db.engine.dialect, 'name', '') or ''
        reserved_at_type = 'TIMESTAMP' if dialect == 'postgresql' else 'DATETIME'

        if 'renewal_reserved_user_id' not in cols:
            if dialect == 'postgresql':
                db.session.execute(
                    text(
                        'ALTER TABLE store_license_accounts ADD COLUMN renewal_reserved_user_id INTEGER '
                        'REFERENCES users(id) ON DELETE SET NULL'
                    )
                )
            else:
                db.session.execute(
                    text(
                        'ALTER TABLE store_license_accounts ADD COLUMN renewal_reserved_user_id INTEGER'
                    )
                )
        if 'renewal_reserved_at' not in cols:
            db.session.execute(
                text(
                    f'ALTER TABLE store_license_accounts ADD COLUMN renewal_reserved_at {reserved_at_type}'
                )
            )
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.warning(
            'No se pudo asegurar columnas renewal_reserved en cuentas: %s', e
        )


def _renewal_release_stale_reservations():
    from app.store.models import LicenseAccount

    _ensure_license_account_renewal_reserve_columns()
    cutoff = datetime.utcnow() - timedelta(minutes=RENEWAL_RESERVE_TTL_MINUTES)
    stale = LicenseAccount.query.filter(
        LicenseAccount.renewal_reserved_user_id.isnot(None),
        LicenseAccount.renewal_reserved_at.isnot(None),
        LicenseAccount.renewal_reserved_at < cutoff,
        LicenseAccount.status == 'available',
    ).all()
    if not stale:
        return
    for acc in stale:
        acc.renewal_reserved_user_id = None
        acc.renewal_reserved_at = None
    db.session.commit()


def _renewal_account_available_for_user(account, user_id):
    """Disponible para renovación del usuario (available y sin reserva ajena)."""
    from app.store.models import LicenseAccount

    _renewal_release_stale_reservations()
    if not account or (account.status or '').lower() != 'available':
        return False
    rid = account.renewal_reserved_user_id
    if rid is None:
        return True
    if user_id and int(rid) == int(user_id):
        return True
    return False


def _renewal_account_unreserved_for_public_sale(account):
    """No contar ni vender en checkout normal si está reservada en carrito de renovación."""
    if not account or (account.status or '').lower() != 'available':
        return False
    rid = account.renewal_reserved_user_id
    if rid is None:
        return True
    rat = account.renewal_reserved_at
    if rat:
        cutoff = datetime.utcnow() - timedelta(minutes=RENEWAL_RESERVE_TTL_MINUTES)
        if rat < cutoff:
            return True
    return False


def _renewal_reserve_accounts(user_id, account_ids):
    from app.store.models import LicenseAccount

    _ensure_license_account_renewal_reserve_columns()
    _renewal_release_stale_reservations()
    reserved = []
    failed = []
    now = datetime.utcnow()
    seen = set()
    for raw_id in account_ids or []:
        try:
            aid = int(raw_id)
        except (TypeError, ValueError):
            continue
        if aid in seen:
            continue
        seen.add(aid)
        acc = LicenseAccount.query.get(aid)
        em = (getattr(acc, 'email', None) or '').strip() if acc else ''
        if not acc or not _renewal_account_available_for_user(acc, user_id):
            failed.append(
                {
                    'account_id': aid,
                    'email': em or str(aid),
                    'message': 'Ya no está disponible para renovación.',
                }
            )
            continue
        acc.renewal_reserved_user_id = user_id
        acc.renewal_reserved_at = now
        reserved.append(aid)
    if reserved or failed:
        db.session.commit()
    return reserved, failed


def _renewal_release_all_reservations_for_user(user_id):
    """Libera todas las reservas de renovación del usuario (p. ej. al cambiar USD↔COP)."""
    from app.store.models import LicenseAccount

    if not user_id:
        return 0
    _ensure_license_account_renewal_reserve_columns()
    rows = LicenseAccount.query.filter(
        LicenseAccount.renewal_reserved_user_id == int(user_id),
        LicenseAccount.status == 'available',
    ).all()
    for acc in rows:
        acc.renewal_reserved_user_id = None
        acc.renewal_reserved_at = None
    if rows:
        db.session.commit()
    return len(rows)


def _renewal_release_accounts(user_id, account_ids):
    from app.store.models import LicenseAccount

    if not account_ids:
        return
    _ensure_license_account_renewal_reserve_columns()
    ids = []
    for raw_id in account_ids:
        try:
            ids.append(int(raw_id))
        except (TypeError, ValueError):
            pass
    if not ids:
        return
    rows = LicenseAccount.query.filter(
        LicenseAccount.id.in_(ids),
        LicenseAccount.renewal_reserved_user_id == user_id,
        LicenseAccount.status == 'available',
    ).all()
    for acc in rows:
        acc.renewal_reserved_user_id = None
        acc.renewal_reserved_at = None
    if rows:
        db.session.commit()


def _renewal_clear_reservation(account):
    if account is None:
        return
    account.renewal_reserved_user_id = None
    account.renewal_reserved_at = None


def _lookup_store_renewal_accounts(emails):
    """
    Busca cuentas por correo en inventario «para venta» (status available).
    Devuelve renovables y rechazadas con mensaje legible.
    """
    from app.store.models import License, LicenseAccount

    _ensure_license_account_renewal_reserve_columns()
    viewer_uid = session.get('user_id')
    archived_pids = _product_ids_with_archived_license()
    public_pids = {p.id for p in public_store_products_query().all()}
    renewable = []
    rejected = []

    for raw in emails:
        email = (raw or '').strip().lower()
        if not _renewal_email_is_valid(email):
            rejected.append(
                {
                    'email': raw or email,
                    'reason': 'invalid',
                    'message': 'Correo incompleto',
                }
            )
            continue

        rows = (
            LicenseAccount.query.join(License)
            .filter(sa_func.lower(LicenseAccount.email) == email)
            .filter(License.enabled.is_(True))
            .order_by(LicenseAccount.id.asc())
            .all()
        )
        rows = [
            r
            for r in rows
            if r.license
            and r.license.product_id in public_pids
            and r.license.product_id not in archived_pids
        ]

        if not rows:
            rejected.append(
                {
                    'email': email,
                    'reason': 'not_found',
                    'message': 'No se encontró para venta.',
                }
            )
            continue

        available = [
            r
            for r in rows
            if (r.status or '').lower() == 'available'
            and _renewal_account_available_for_user(r, viewer_uid)
        ]
        if available:
            for acc in available:
                prod = acc.license.product
                renewable.append(
                    {
                        'email': email,
                        'account_id': acc.id,
                        'product_id': prod.id,
                        'product_name': prod.name,
                        'license_id': acc.license_id,
                    }
                )
            continue

        soldish = [r for r in rows if (r.status or '').lower() in ('assigned', 'sold')]
        if soldish:
            rejected.append(
                {
                    'email': email,
                    'reason': 'sold',
                    'message': 'Esta cuenta ya fue vendida',
                }
            )
        else:
            rejected.append(
                {
                    'email': email,
                    'reason': 'unavailable',
                    'message': 'La cuenta no está disponible para renovación en este momento.',
                }
            )

    return renewable, rejected


@store_bp.route('/api/renovacion/buscar', methods=['POST'])
@csrf_exempt_route
@store_access_required
def api_store_renovacion_buscar():
    """Buscar cuentas renovables por correo (inventario available / licencias para venta)."""
    data = request.get_json(silent=True) or {}
    raw = (data.get('cuentas') or data.get('emails') or data.get('q') or '').strip()
    if not raw:
        return jsonify({'success': False, 'error': 'Escribe al menos un correo para buscar.'}), 400

    emails = _parse_renewal_email_tokens(raw)
    if not emails:
        return jsonify({'success': False, 'error': 'No se encontraron correos en el texto.'}), 400

    renewable, rejected = _lookup_store_renewal_accounts(emails)
    return jsonify(
        {
            'success': True,
            'renewable': renewable,
            'rejected': rejected,
        }
    )


@store_bp.route('/api/renovacion/reservar', methods=['POST'])
@csrf_exempt_route
@store_access_required
def api_store_renovacion_reservar():
    """Vincular cuentas al carrito del usuario hasta procesar pago."""
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'error': 'Usuario no autenticado'}), 401
    data = request.get_json(silent=True) or {}
    raw_ids = data.get('account_ids') or data.get('cuentas') or []
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({'success': False, 'error': 'No hay cuentas para reservar.'}), 400
    reserved, failed = _renewal_reserve_accounts(user_id, raw_ids)
    return jsonify({'success': True, 'reserved': reserved, 'failed': failed})


@store_bp.route('/api/renovacion/liberar', methods=['POST'])
@csrf_exempt_route
@store_access_required
def api_store_renovacion_liberar():
    """Quitar reserva al sacar cuentas del carrito."""
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'error': 'Usuario no autenticado'}), 401
    data = request.get_json(silent=True) or {}
    raw_ids = data.get('account_ids') or []
    if isinstance(raw_ids, list) and raw_ids:
        _renewal_release_accounts(user_id, raw_ids)
    return jsonify({'success': True})


@store_bp.route('/historial_compras')
@store_access_required
def historial_compras_usuario():
    """Mostrar el historial de compras del usuario"""
    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username
    
    if not user:
        flash('Debes iniciar sesión para ver tu historial de compras', 'warning')
        return redirect(url_for('user_auth_bp.login'))

    _ensure_license_account_sale_id_column()

    from app.store.models import Sale, Product, LicenseAccount, SalePurchaseSnapshot
    from app.store.sale_purchase_snapshot import (
        ensure_sale_schema,
        ensure_snapshot_table,
        get_licencias_for_sale_row,
        renewal_kind_display_label,
        resolve_renewal_kind_for_sale,
        snapshot_to_historial_item,
    )

    ensure_sale_schema()
    ensure_snapshot_table()

    # Obtener todas las compras del usuario, ordenadas por fecha más reciente

    admin_username = current_app.config.get("ADMIN_USER", "admin")
    mostrar_usuario_comprador = username == admin_username

    # Admin del sistema ve todas las ventas con el comprador; el resto solo las propias.
    if mostrar_usuario_comprador:
        compras = (
            db.session.query(Sale, Product, User)
            .join(Product, Sale.product_id == Product.id)
            .join(User, Sale.user_id == User.id)
            .order_by(Sale.created_at.desc())
            .all()
        )
    else:
        compras = (
            db.session.query(Sale, Product)
            .join(Product, Sale.product_id == Product.id)
            .filter(Sale.user_id == user.id)
            .order_by(Sale.created_at.desc())
            .all()
        )

    compras_info = []
    for row in compras:
        if mostrar_usuario_comprador:
            sale, product, comprador = row
        else:
            sale, product = row
            comprador = None
        # Formatear fecha en zona horaria de Colombia
        fecha_colombia = sale.created_at
        if fecha_colombia:
            # Convertir a zona horaria de Colombia usando módulo centralizado
            fecha_colombia = utc_to_colombia(fecha_colombia)
            fecha_str = fecha_colombia.strftime('%y/%m/%d %I:%M:%S %p')
        else:
            fecha_str = 'Fecha no disponible'

        licencias, is_reversed, is_renewal, snap_id = get_licencias_for_sale_row(sale)
        snap_row = SalePurchaseSnapshot.query.get(snap_id) if snap_id else None
        renewal_kind = resolve_renewal_kind_for_sale(sale, snap_row) if is_renewal else None
        producto_label = product.name
        if is_reversed:
            producto_label = producto_label + ' (compra revertida)'

        sort_ts = sale.created_at.timestamp() if sale.created_at else 0.0
        item = {
            'id': sale.id,
            'fecha': fecha_str,
            'producto': producto_label,
            'cantidad': sale.quantity,
            'total': float(sale.total_price),
            'product_id': product.id,
            'licencias': licencias,
            'is_renewal': is_renewal,
            'renewal_kind': renewal_kind,
            'renewal_kind_label': renewal_kind_display_label(renewal_kind),
            'is_reversed': is_reversed,
            'has_licencias': len(licencias) > 0,
            'sort_ts': sort_ts,
        }
        if mostrar_usuario_comprador and comprador is not None:
            item['user_id'] = comprador.id
            item['usuario'] = comprador.username
        compras_info.append(item)

    archived_q = SalePurchaseSnapshot.query.filter_by(purged_from_sales=True)
    if not mostrar_usuario_comprador:
        archived_q = archived_q.filter_by(user_id=user.id)
    for snap in archived_q.order_by(SalePurchaseSnapshot.sale_created_at.desc()).all():
        compras_info.append(snapshot_to_historial_item(snap))

    _ensure_balance_recharges_table()
    from app.store.balance_recharge_historial_snapshot import ensure_snapshot_table

    ensure_snapshot_table()
    from app.store.balance_recharge_historial import build_recharge_historial_items

    if mostrar_usuario_comprador:
        compras_info.extend(
            build_recharge_historial_items(all_users=True, utc_to_colombia_fn=utc_to_colombia)
        )
    else:
        billing = _balance_recharge_viewer_billing_user(user)
        uid = int(billing.id) if billing else int(user.id)
        compras_info.extend(
            build_recharge_historial_items(user_id=uid, utc_to_colombia_fn=utc_to_colombia)
        )

    if mostrar_usuario_comprador:
        from app.store.purchase_history_cleanup import (
            cleanup_log_product_label,
            get_cleanup_logs,
        )

        for log in get_cleanup_logs():
            at_raw = log.get('at')
            sort_ts = 0.0
            fecha_str = 'Fecha no disponible'
            if at_raw:
                try:
                    at_dt = datetime.fromisoformat(str(at_raw).replace('Z', ''))
                    sort_ts = at_dt.timestamp()
                    fecha_col = utc_to_colombia(at_dt)
                    fecha_str = fecha_col.strftime('%y/%m/%d %I:%M:%S %p')
                except (ValueError, TypeError):
                    pass
            kind = (log.get('kind') or 'manual').strip().lower()
            producto = cleanup_log_product_label(kind, log.get('retention_days'))
            compras_info.append({
                'id': 'cleanup-' + str(log.get('id', '')),
                'fecha': fecha_str,
                'producto': producto,
                'cantidad': log.get('deleted_count', 0),
                'total': 0,
                'licencias': [],
                'is_cleanup_log': True,
                'usuario': 'Sistema' if kind == 'automatica' else username,
                'sort_ts': sort_ts,
            })

    compras_info.sort(key=lambda x: x.get('sort_ts', 0), reverse=True)

    for row in compras_info:
        row.pop('sort_ts', None)

    mostrar_historial_licencias = False
    historial_licencias_es_admin = False
    license_timeline_rows = []
    _ensure_user_portal_license_activity_log_column()
    if mostrar_usuario_comprador:
        from app.store.user_license_activity import (
            build_admin_store_license_activity_timeline_rows,
        )

        license_timeline_rows = build_admin_store_license_activity_timeline_rows(
            utc_to_colombia_fn=utc_to_colombia
        )
        mostrar_historial_licencias = True
        historial_licencias_es_admin = True
    elif _eligible_tienda_user_licencias_portal(user):
        from app.store.user_license_activity import build_user_license_activity_timeline_rows

        assignee_ids, _ = _user_licencias_viewer_scope(user)
        license_timeline_rows = build_user_license_activity_timeline_rows(
            assignee_ids, user, utc_to_colombia_fn=utc_to_colombia
        )
        mostrar_historial_licencias = True

    admin_user = current_app.config.get("ADMIN_USER", "admin")
    cleanup_settings = None
    cleanup_selected_user = None
    lic_cleanup_settings = None
    lic_cleanup_selected_user = None
    if mostrar_usuario_comprador:
        from app.store.purchase_history_cleanup import get_cleanup_settings
        cleanup_settings = get_cleanup_settings()
        if (
            cleanup_settings
            and cleanup_settings.get('scope') == 'user'
            and cleanup_settings.get('user_id')
        ):
            selected = User.query.get(int(cleanup_settings['user_id']))
            if selected:
                cleanup_selected_user = {
                    'id': selected.id,
                    'username': selected.username,
                    'label': selected.username,
                }
        if mostrar_historial_licencias and historial_licencias_es_admin:
            from app.store.license_history_cleanup import get_cleanup_settings as get_lic_cleanup_settings
            lic_cleanup_settings = get_lic_cleanup_settings()
            if (
                lic_cleanup_settings
                and lic_cleanup_settings.get('scope') == 'user'
                and lic_cleanup_settings.get('user_id')
            ):
                lic_selected = User.query.get(int(lic_cleanup_settings['user_id']))
                if lic_selected:
                    lic_cleanup_selected_user = {
                        'id': lic_selected.id,
                        'username': lic_selected.username,
                        'label': lic_selected.username,
                    }
    return render_template(
        'purchase_history_user.html',
        compras=compras_info,
        current_user=user,
        username=username,
        ADMIN_USER=admin_user,
        mostrar_usuario_comprador=mostrar_usuario_comprador,
        mostrar_historial_licencias=mostrar_historial_licencias,
        historial_licencias_es_admin=historial_licencias_es_admin,
        license_timeline_rows=license_timeline_rows,
        cleanup_settings=cleanup_settings,
        cleanup_selected_user=cleanup_selected_user,
        lic_cleanup_settings=lic_cleanup_settings,
        lic_cleanup_selected_user=lic_cleanup_selected_user,
    )


@store_bp.route('/api/purchase-history/cleanup-settings', methods=['GET', 'POST'])
@csrf_exempt_route
@admin_required
def api_purchase_history_cleanup_settings():
    from app.store.purchase_history_cleanup import (
        get_cleanup_settings,
        save_cleanup_settings,
        count_sales_to_purge,
    )

    if request.method == 'GET':
        settings = get_cleanup_settings()
        user_id = settings.get('user_id') if settings.get('scope') == 'user' else None
        preview = count_sales_to_purge(
            settings.get('retention_days', 90),
            user_id=user_id,
        )
        return _attach_private_no_cache_headers(jsonify({
            'success': True,
            'settings': settings,
            'preview_count': preview,
        }))

    data = request.get_json(silent=True) or {}
    try:
        retention_days = max(0, min(3650, int(data.get('retention_days', 90))))
        run_interval_hours = max(1, min(8760, int(data.get('run_interval_hours', 24))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Días o intervalo inválidos.'}), 400

    scope = (data.get('scope') or 'all').strip().lower()
    if scope not in ('all', 'user'):
        scope = 'all'

    user_id = data.get('user_id')
    if scope == 'user':
        if not user_id:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(user_id)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(user_id)
    else:
        user_id = None

    auto_enabled = bool(data.get('auto_enabled'))
    if auto_enabled and retention_days <= 0:
        return jsonify({
            'success': False,
            'error': 'La limpieza automática requiere al menos 1 día de antigüedad.',
        }), 400

    settings = save_cleanup_settings({
        'auto_enabled': auto_enabled,
        'retention_days': retention_days,
        'run_interval_hours': run_interval_hours,
        'scope': scope,
        'user_id': user_id,
    })
    preview = count_sales_to_purge(retention_days, user_id=user_id)
    return jsonify({
        'success': True,
        'message': 'Configuración de limpieza guardada.',
        'settings': settings,
        'preview_count': preview,
    })


@store_bp.route('/api/purchase-history/purge', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_purchase_history_purge():
    from app.store.purchase_history_cleanup import (
        count_sales_to_purge,
        enqueue_purge_background,
        is_purge_running,
    )

    data = request.get_json(silent=True) or {}
    try:
        retention_days = max(0, min(3650, int(data.get('retention_days', 90))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Antigüedad en días inválida.'}), 400

    scope = (data.get('scope') or 'all').strip().lower()
    user_id = None
    if scope == 'user':
        uid = data.get('user_id')
        if not uid:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(uid)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(uid)

    dry_run = bool(data.get('dry_run'))
    if dry_run:
        count = count_sales_to_purge(retention_days, user_id=user_id)
        return jsonify({'success': True, 'dry_run': True, 'count': count})

    if not data.get('confirm'):
        count = count_sales_to_purge(retention_days, user_id=user_id)
        return jsonify({
            'success': False,
            'error': 'Confirma la eliminación.',
            'requires_confirm': True,
            'count': count,
        }), 400

    pending_count = count_sales_to_purge(retention_days, user_id=user_id)

    if is_purge_running():
        return jsonify({
            'success': False,
            'error': 'Ya hay una limpieza del historial en curso. Espera a que termine.',
        }), 409

    started = enqueue_purge_background(
        current_app._get_current_object(),
        retention_days,
        user_id=user_id,
        kind='manual',
        scope=scope,
        mark_auto_run=False,
    )
    if not started:
        return jsonify({
            'success': False,
            'error': 'No se pudo iniciar la limpieza en segundo plano.',
        }), 500

    return jsonify({
        'success': True,
        'background': True,
        'message': (
            f'Limpieza iniciada en segundo plano ({pending_count} registro(s) aprox.). '
            'Solo se borra el historial de compras; las licencias quedan en inventario '
            'sin vínculo a la venta. Recarga la página en unos momentos para ver el resultado.'
        ),
    })


@store_bp.route('/api/purchase-history/purge-preview', methods=['GET'])
@csrf_exempt_route
@admin_required
def api_purchase_history_purge_preview():
    from app.store.purchase_history_cleanup import count_sales_to_purge

    try:
        retention_days = max(0, min(3650, int(request.args.get('retention_days', 90))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Antigüedad inválida.'}), 400

    scope = (request.args.get('scope') or 'all').strip().lower()
    user_id = None
    if scope == 'user':
        uid = request.args.get('user_id')
        if uid:
            user_id = int(uid)

    count = count_sales_to_purge(retention_days, user_id=user_id)
    return jsonify({'success': True, 'count': count})


@store_bp.route('/api/license-history/cleanup-settings', methods=['GET', 'POST'])
@csrf_exempt_route
@admin_required
def api_license_history_cleanup_settings():
    from app.store.license_history_cleanup import (
        count_portal_entries_to_purge,
        get_cleanup_settings,
        save_cleanup_settings,
    )

    _ensure_user_portal_license_activity_log_column()

    if request.method == 'GET':
        settings = get_cleanup_settings()
        user_id = settings.get('user_id') if settings.get('scope') == 'user' else None
        preview = count_portal_entries_to_purge(
            settings.get('retention_days', 90),
            user_id=user_id,
        )
        return _attach_private_no_cache_headers(jsonify({
            'success': True,
            'settings': settings,
            'preview_count': preview,
        }))

    data = request.get_json(silent=True) or {}
    try:
        retention_days = max(0, min(3650, int(data.get('retention_days', 90))))
        run_interval_hours = max(1, min(8760, int(data.get('run_interval_hours', 24))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Días o intervalo inválidos.'}), 400

    scope = (data.get('scope') or 'all').strip().lower()
    if scope not in ('all', 'user'):
        scope = 'all'

    user_id = data.get('user_id')
    if scope == 'user':
        if not user_id:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(user_id)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(user_id)
    else:
        user_id = None

    auto_enabled = bool(data.get('auto_enabled'))
    if auto_enabled and retention_days <= 0:
        return jsonify({
            'success': False,
            'error': 'La limpieza automática requiere al menos 1 día de antigüedad.',
        }), 400

    settings = save_cleanup_settings({
        'auto_enabled': auto_enabled,
        'retention_days': retention_days,
        'run_interval_hours': run_interval_hours,
        'scope': scope,
        'user_id': user_id,
    })
    preview = count_portal_entries_to_purge(retention_days, user_id=user_id)
    return jsonify({
        'success': True,
        'message': 'Configuración de limpieza del historial · Licencias guardada.',
        'settings': settings,
        'preview_count': preview,
    })


@store_bp.route('/api/license-history/purge', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_license_history_purge():
    from app.store.license_history_cleanup import (
        count_portal_entries_to_purge,
        enqueue_purge_background,
        is_purge_running,
    )

    _ensure_user_portal_license_activity_log_column()

    data = request.get_json(silent=True) or {}
    try:
        retention_days = max(0, min(3650, int(data.get('retention_days', 90))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Antigüedad en días inválida.'}), 400

    scope = (data.get('scope') or 'all').strip().lower()
    user_id = None
    if scope == 'user':
        uid = data.get('user_id')
        if not uid:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(uid)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(uid)

    dry_run = bool(data.get('dry_run'))
    if dry_run:
        count = count_portal_entries_to_purge(retention_days, user_id=user_id)
        return jsonify({'success': True, 'dry_run': True, 'count': count})

    if not data.get('confirm'):
        count = count_portal_entries_to_purge(retention_days, user_id=user_id)
        return jsonify({
            'success': False,
            'error': 'Confirma la eliminación.',
            'requires_confirm': True,
            'count': count,
        }), 400

    pending_count = count_portal_entries_to_purge(retention_days, user_id=user_id)

    if is_purge_running():
        return jsonify({
            'success': False,
            'error': 'Ya hay una limpieza del historial · Licencias en curso. Espera a que termine.',
        }), 409

    started = enqueue_purge_background(
        current_app._get_current_object(),
        retention_days,
        user_id=user_id,
        kind='manual',
        scope=scope,
        mark_auto_run=False,
    )
    if not started:
        return jsonify({
            'success': False,
            'error': 'No se pudo iniciar la limpieza en segundo plano.',
        }), 500

    return jsonify({
        'success': True,
        'background': True,
        'message': (
            f'Limpieza del historial · Licencias iniciada ({pending_count} registro(s) aprox.). '
            'Solo se borran entradas antiguas del registro portal; las licencias en inventario no se eliminan. '
            'Recarga la página en unos momentos.'
        ),
    })


@store_bp.route('/api/license-history/purge-preview', methods=['GET'])
@csrf_exempt_route
@admin_required
def api_license_history_purge_preview():
    from app.store.license_history_cleanup import count_portal_entries_to_purge

    _ensure_user_portal_license_activity_log_column()

    try:
        retention_days = max(0, min(3650, int(request.args.get('retention_days', 90))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Antigüedad inválida.'}), 400

    scope = (request.args.get('scope') or 'all').strip().lower()
    user_id = None
    if scope == 'user':
        uid = request.args.get('user_id')
        if uid:
            user_id = int(uid)

    count = count_portal_entries_to_purge(retention_days, user_id=user_id)
    return jsonify({'success': True, 'count': count})


def _purchase_history_stats_period_from_request():
    date_from = (request.args.get('date_from') or '').strip() or None
    date_to = (request.args.get('date_to') or '').strip() or None
    days_int = None
    if not date_from or not date_to:
        days = request.args.get('days', '30')
        try:
            days_int = int(days) if str(days).strip().lower() != 'all' else 3650
        except (TypeError, ValueError):
            days_int = 30
    return date_from, date_to, days_int


@store_bp.route('/api/purchase-history/stats', methods=['GET'])
@csrf_exempt_route
@admin_required
def api_purchase_history_stats():
    from app.store.purchase_history_stats import compute_purchase_history_stats

    scope = (request.args.get('scope') or 'all').strip().lower()
    if scope not in ('all', 'user'):
        scope = 'all'
    user_id = None
    if scope == 'user':
        uid = request.args.get('user_id')
        if not uid:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(uid)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(uid)

    date_from, date_to, days_int = _purchase_history_stats_period_from_request()
    data = compute_purchase_history_stats(
        scope=scope,
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
        days=days_int,
    )
    return _attach_private_no_cache_headers(jsonify(data))


@store_bp.route('/api/purchase-history/my-stats', methods=['GET'])
@csrf_exempt_route
@store_access_required
def api_purchase_history_my_stats():
    """Estadísticas del historial solo para el usuario en sesión."""
    from app.store.purchase_history_stats import compute_purchase_history_stats

    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'error': 'Debes iniciar sesión.'}), 401
    user = User.query.get(int(user_id))
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404

    date_from, date_to, days_int = _purchase_history_stats_period_from_request()
    data = compute_purchase_history_stats(
        scope='user',
        user_id=user.id,
        date_from=date_from,
        date_to=date_to,
        days=days_int,
    )
    return _attach_private_no_cache_headers(jsonify(data))


# ================== RECARGAS DE SALDO ==================

_BALANCE_RECHARGE_ALLOWED_MIME = frozenset({
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
})
_BALANCE_RECHARGE_MAX_FILES = 1
_BALANCE_RECHARGE_MAX_MB = 30
_BALANCE_RECHARGE_MAX_BYTES = _BALANCE_RECHARGE_MAX_MB * 1024 * 1024


def _store_db_dialect():
    return getattr(db.engine.dialect, 'name', '') or ''


def _ensure_balance_recharges_table():
    try:
        from sqlalchemy import inspect, text
        from app.store.models import BalanceRecharge

        dialect = _store_db_dialect()
        dt_type = 'TIMESTAMP' if dialect == 'postgresql' else 'DATETIME'
        bool_false = 'FALSE' if dialect == 'postgresql' else '0'

        insp = inspect(db.engine)
        if 'store_balance_recharges' not in insp.get_table_names():
            BalanceRecharge.__table__.create(db.engine)
        else:
            cols = {c['name'].lower() for c in insp.get_columns('store_balance_recharges')}
            migrations = [
                ('submitted_by_user_id', 'ALTER TABLE store_balance_recharges ADD COLUMN submitted_by_user_id INTEGER'),
                ('payment_method_id', 'ALTER TABLE store_balance_recharges ADD COLUMN payment_method_id VARCHAR(48)'),
                (
                    'auto_credited',
                    f'ALTER TABLE store_balance_recharges ADD COLUMN auto_credited BOOLEAN DEFAULT {bool_false}',
                ),
                ('amount_credited', 'ALTER TABLE store_balance_recharges ADD COLUMN amount_credited NUMERIC(12, 2)'),
                ('analyzer_json', 'ALTER TABLE store_balance_recharges ADD COLUMN analyzer_json TEXT'),
                ('admin_verified', 'ALTER TABLE store_balance_recharges ADD COLUMN admin_verified BOOLEAN'),
                ('receipt_number', 'ALTER TABLE store_balance_recharges ADD COLUMN receipt_number VARCHAR(32)'),
                ('proof_image_hash', 'ALTER TABLE store_balance_recharges ADD COLUMN proof_image_hash VARCHAR(64)'),
                ('email_verify_status', 'ALTER TABLE store_balance_recharges ADD COLUMN email_verify_status VARCHAR(32)'),
                ('email_verify_attempts', 'ALTER TABLE store_balance_recharges ADD COLUMN email_verify_attempts INTEGER DEFAULT 0'),
                (
                    'email_verify_next_at',
                    f'ALTER TABLE store_balance_recharges ADD COLUMN email_verify_next_at {dt_type}',
                ),
                ('email_verify_json', 'ALTER TABLE store_balance_recharges ADD COLUMN email_verify_json TEXT'),
            ]
            for col_name, ddl in migrations:
                if col_name not in cols:
                    try:
                        db.session.execute(text(ddl))
                        db.session.commit()
                        cols.add(col_name)
                    except Exception as col_exc:
                        db.session.rollback()
                        current_app.logger.warning(
                            'No se pudo añadir store_balance_recharges.%s (%s): %s',
                            col_name,
                            dialect,
                            col_exc,
                        )

        from app.store.balance_recharge_historial_snapshot import ensure_snapshot_table as _ensure_br_hist_snap

        _ensure_br_hist_snap()
    except Exception as e:
        current_app.logger.warning('No se pudo asegurar tabla store_balance_recharges: %s', e)
        try:
            db.session.rollback()
        except Exception:
            pass


def _user_has_recarga_automatica(user):
    if not user:
        return False
    billing = _balance_recharge_viewer_billing_user(user)
    target = billing or user
    up = target.user_prices if isinstance(getattr(target, 'user_prices', None), dict) else {}
    return bool(up and up.get('recarga_automatica'))


def _apply_balance_credit(target_user, currency, amount):
    cur = (currency or 'COP').strip().upper()
    amt = float(amount)
    if cur == 'USD':
        target_user.saldo_usd = float(getattr(target_user, 'saldo_usd', 0) or 0) + amt
    else:
        target_user.saldo_cop = float(getattr(target_user, 'saldo_cop', 0) or 0) + amt


def _apply_balance_debit(target_user, currency, amount):
    cur = (currency or 'COP').strip().upper()
    amt = float(amount)
    if cur == 'USD':
        target_user.saldo_usd = float(getattr(target_user, 'saldo_usd', 0) or 0) - amt
    else:
        target_user.saldo_cop = float(getattr(target_user, 'saldo_cop', 0) or 0) - amt


def _balance_recharge_upload_dir():
    import os
    upload_dir = os.path.join(current_app.instance_path, 'uploads', 'balance_recharges')
    os.makedirs(upload_dir, exist_ok=True)
    return upload_dir


def _balance_recharge_files_list(recharge_row):
    import json as _json
    raw = getattr(recharge_row, 'proof_files_json', None) or '[]'
    try:
        data = _json.loads(raw)
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _balance_recharge_proof_payload(recharge_row):
    """URLs de comprobantes existentes en disco; marca si había referencia pero falta el archivo."""
    import os

    files = _balance_recharge_files_list(recharge_row)
    upload_dir = _balance_recharge_upload_dir()
    proof_urls = []
    referenced = 0
    for idx, entry in enumerate(files):
        stored = entry.get('stored') if isinstance(entry, dict) else None
        if not stored:
            continue
        referenced += 1
        path = os.path.join(upload_dir, stored)
        if os.path.isfile(path):
            proof_urls.append(
                url_for(
                    'store_bp.api_user_balance_recharge_proof',
                    recharge_id=recharge_row.id,
                    file_index=idx,
                )
            )
    return {
        'proof_count': len(files),
        'proof_urls': proof_urls,
        'proof_missing': referenced > 0 and not proof_urls,
    }


def _balance_recharge_viewer_billing_user(viewer):
    return _billing_user_for_store_debt_limit(viewer) or viewer


def _recharge_payment_methods_payload(viewer):
    from app.store.balance_recharge_payment import (
        currency_display_name,
        is_accumulator_method_id,
        methods_for_user_with_accum,
        payment_method_qr_public_filename,
        payment_method_user_display,
    )

    billing = _balance_recharge_viewer_billing_user(viewer)
    _, tipo_precio = catalog_products_for_store_user(billing or viewer)
    tp = (tipo_precio or 'COP').upper()
    payment_methods = methods_for_user_with_accum(billing or viewer, tp, viewer=viewer)
    pm_rows = []
    for m in payment_methods:
        display = payment_method_user_display(m)
        mid = m.get('id') or ''
        is_accum = m.get('currency') == 'ACCUM' or is_accumulator_method_id(mid)
        pay_cur = (m.get('payment_currency') or tp).strip().upper() if is_accum else tp
        row = {
            'id': m.get('id'),
            'label': m.get('label') or '',
            'account_number': display.get('account_number') or '',
            'description': display.get('description') or '',
            'is_breb_bancolombia': bool(display.get('is_breb_bancolombia')),
            'bre_b_llave': display.get('bre_b_llave') or '',
            'enabled': bool(m.get('enabled', True)),
            'is_accumulator': is_accum,
            'payment_currency': pay_cur,
            'payment_currency_label': currency_display_name(pay_cur),
        }
        fn = m.get('qr_filename')
        if fn:
            row['qr_url'] = url_for(
                'store_bp.api_payment_method_qr_image',
                filename=payment_method_qr_public_filename(fn),
            )
        pm_rows.append(row)
    return tp, currency_display_name(tp), pm_rows


def _balance_recharge_row_accessible(recharge_row, viewer):
    if not recharge_row or not viewer:
        return False
    billing = _balance_recharge_viewer_billing_user(viewer)
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    if viewer.username == admin_username:
        return True
    if billing and recharge_row.user_id == billing.id:
        return True
    if recharge_row.submitted_by_user_id and viewer.id == recharge_row.submitted_by_user_id:
        return True
    return False


def _user_balance_recharge_filter_counts(user_id):
    """Conteos por estado para el filtro Mis solicitudes (portal usuario)."""
    from app.store.models import BalanceRecharge

    base = BalanceRecharge.query.filter_by(user_id=user_id)
    return {
        'all': base.count(),
        'pending': base.filter(BalanceRecharge.status == 'pending').count(),
        'accumulated': base.filter(BalanceRecharge.status == 'accumulated').count(),
        'approved': base.filter(BalanceRecharge.status == 'approved').count(),
        'rejected': base.filter(BalanceRecharge.status == 'rejected').count(),
    }


def _balance_recharge_accum_filter_counts(accum_ids):
    """Conteos por estado para el filtro del panel Revisión acumulador."""
    from app.store.models import BalanceRecharge

    empty = {'pending': 0, 'accumulated': 0, 'rejected': 0, 'all': 0}
    if not accum_ids:
        return empty
    base = BalanceRecharge.query.filter(BalanceRecharge.payment_method_id.in_(accum_ids))
    return {
        'pending': base.filter(BalanceRecharge.status == 'pending').count(),
        'accumulated': base.filter(BalanceRecharge.status == 'accumulated').count(),
        'rejected': base.filter(BalanceRecharge.status == 'rejected').count(),
        'all': base.count(),
    }


def _balance_recharge_status_label(status, recharge_row=None):
    st = (status or '').lower()
    if st == 'auto_credited' and recharge_row and getattr(recharge_row, 'admin_verified', None) is None:
        return 'Pendiente verificación'
    if st == 'approved' and recharge_row and getattr(recharge_row, 'auto_credited', False):
        return 'Aprobado/acreditado'
    labels = {
        'pending': 'Pendiente',
        'approved': 'Aprobada',
        'rejected': 'Rechazada',
        'auto_credited': '',
        'accumulated': 'Acumulado',
        'accum_converted': 'Convertido',
    }
    return labels.get(st, status or '—')


def _balance_recharge_analyzer_payload(recharge_row):
    import json as _json
    raw = getattr(recharge_row, 'analyzer_json', None)
    if not raw:
        return None
    try:
        data = _json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _recharge_account_suffix_masked(recharge_row) -> str:
    """****1948 para Bre-B: correo guardado, OCR o configuración del medio."""
    import json as _json

    from app.store.balance_recharge_analyzer import digits_only
    from app.store.balance_recharge_payment import (
        _find_method_by_id,
        payment_method_breb_account_suffix,
        payment_method_is_breb_bancolombia,
    )

    def _mask(raw_suffix: str) -> str:
        d = digits_only(str(raw_suffix or ''))
        if len(d) < 2:
            return ''
        return '****' + (d[-4:] if len(d) >= 4 else d)

    ev_raw = getattr(recharge_row, 'email_verify_json', None)
    if ev_raw:
        try:
            data = _json.loads(ev_raw)
            if isinstance(data, dict):
                email = data.get('email') or {}
                for suf in email.get('account_suffixes') or []:
                    masked = _mask(suf)
                    if masked:
                        return masked
        except (_json.JSONDecodeError, TypeError):
            pass

    analyzer = _balance_recharge_analyzer_payload(recharge_row)
    if analyzer:
        for suf in analyzer.get('account_suffixes_detected') or []:
            masked = _mask(suf)
            if masked:
                return masked
        masked = _mask(analyzer.get('account_expected_digits'))
        if masked:
            return masked

    pm_id = getattr(recharge_row, 'payment_method_id', None) or ''
    from app.store.balance_recharge_payment import find_payment_method_for_recharge

    method = find_payment_method_for_recharge(recharge_row) or _find_method_by_id(pm_id)
    if payment_method_is_breb_bancolombia(method):
        suf = payment_method_breb_account_suffix(method)
        if suf:
            return '****' + suf
    return ''


def _serialize_balance_recharge_row(recharge_row, viewer, *, include_username=False):
    from app.store.balance_recharge_email_scheduler import admin_note_for_end_user
    from app.store.balance_recharge_payment import (
        currency_display_name,
        find_payment_method_for_recharge,
        is_accumulator_method_id,
        method_label_by_id_any,
    )

    created = recharge_row.created_at
    if created:
        created = utc_to_colombia(created)
        fecha_str = created.strftime('%y/%m/%d %I:%M %p')
    else:
        fecha_str = ''
    proof_payload = _balance_recharge_proof_payload(recharge_row)
    cur = (recharge_row.currency or 'COP').strip().upper()
    pm_id = getattr(recharge_row, 'payment_method_id', None) or ''
    pm_resolved = find_payment_method_for_recharge(recharge_row) if pm_id else None
    pm_label = (
        (pm_resolved.get('label') or '').strip()
        if pm_resolved
        else (method_label_by_id_any(pm_id) if pm_id else '—')
    )
    row = {
        'id': recharge_row.id,
        'user_id': recharge_row.user_id,
        'currency': cur,
        'currency_label': currency_display_name(cur),
        'payment_method_id': pm_id,
        'payment_method_label': pm_label or '—',
        'amount_claimed': float(recharge_row.amount_claimed) if recharge_row.amount_claimed is not None else None,
        'note': recharge_row.note or '',
        'status': recharge_row.status,
        'status_label': _balance_recharge_status_label(recharge_row.status, recharge_row),
        'auto_credited': bool(getattr(recharge_row, 'auto_credited', False)),
        'is_accumulator': is_accumulator_method_id(pm_id),
        'amount_credited': float(recharge_row.amount_credited) if getattr(recharge_row, 'amount_credited', None) is not None else None,
        'admin_verified': getattr(recharge_row, 'admin_verified', None),
        'receipt_number': getattr(recharge_row, 'receipt_number', None),
        'analyzer': _balance_recharge_analyzer_payload(recharge_row),
        'created_at': fecha_str,
        'admin_note': (
            (recharge_row.admin_note or '')
            if viewer is None
            else admin_note_for_end_user(recharge_row.admin_note)
        ),
        'proof_count': proof_payload['proof_count'],
        'proof_urls': proof_payload['proof_urls'],
        'proof_missing': proof_payload['proof_missing'],
    }
    suffix_masked = _recharge_account_suffix_masked(recharge_row)
    if suffix_masked:
        row['account_suffix_masked'] = suffix_masked
    if include_username:
        u = User.query.get(recharge_row.user_id)
        row['username'] = (u.username if u else '—')
        sub = User.query.get(recharge_row.submitted_by_user_id) if recharge_row.submitted_by_user_id else None
        if sub and sub.id != recharge_row.user_id:
            row['submitted_by'] = sub.username
    from app.store.balance_recharge_email_scheduler import email_verify_display_for_row

    row['email_verify'] = email_verify_display_for_row(recharge_row)
    row['email_verify_status'] = getattr(recharge_row, 'email_verify_status', None)
    return row


@store_bp.route('/recargas-saldo')
@store_access_required
def recargas_saldo():
    """Portal para solicitar recarga de saldo con comprobante de pago."""
    username = session.get('username')
    user_id = session.get('user_id')
    user = None
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
    if not user:
        flash('Debes iniciar sesión.', 'warning')
        return redirect(url_for('user_auth_bp.login'))

    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    if user.username != admin_username and not _eligible_tienda_user_licencias_portal(user):
        flash('No tienes acceso a recargas de saldo.', 'warning')
        return redirect(url_for('main_bp.home'))

    _ensure_balance_recharges_table()

    billing = _balance_recharge_viewer_billing_user(user)
    tp, currency_label, pm_rows = _recharge_payment_methods_payload(user)
    saldo_info = build_recharge_page_balance_display(billing or user)

    return render_template(
        'recargas_saldo.html',
        current_user=user,
        tipo_precio=tp,
        currency_label=currency_label,
        saldo_line=saldo_info.get('line'),
        accum_line=saldo_info.get('accum_line'),
        payment_methods=pm_rows,
    )


@store_bp.route('/api/user/balance-recharge/saldo', methods=['GET'])
@store_access_required
def api_user_balance_recharge_saldo():
    """Saldo en tiempo real para recargas (cuenta de facturación, p. ej. padre de subusuario)."""
    user_id = session.get('user_id')
    user = User.query.get(user_id) if user_id else None
    if not user:
        return jsonify({'show': False, 'line': None}), 401
    if user.username != current_app.config.get('ADMIN_USER', 'admin') and not _eligible_tienda_user_licencias_portal(user):
        return jsonify({'show': False, 'line': None}), 403
    billing = _balance_recharge_viewer_billing_user(user)
    return jsonify(build_recharge_page_balance_display(billing or user))


@store_bp.route('/api/user/balance-recharges')
@store_access_required
def api_user_balance_recharges():
    user_id = session.get('user_id')
    user = User.query.get(user_id) if user_id else None
    if not user:
        return jsonify({'success': False, 'message': 'No autenticado'}), 401
    if user.username != current_app.config.get('ADMIN_USER', 'admin') and not _eligible_tienda_user_licencias_portal(user):
        return jsonify({'success': False, 'message': 'Sin acceso'}), 403

    _ensure_balance_recharges_table()
    from app.store.models import BalanceRecharge

    billing = _balance_recharge_viewer_billing_user(user)
    status = (request.args.get('status') or 'all').strip().lower()
    q = BalanceRecharge.query.filter_by(user_id=billing.id).order_by(
        BalanceRecharge.created_at.desc()
    )
    if status != 'all':
        q = q.filter(BalanceRecharge.status == status)
    rows = q.limit(100).all()
    return jsonify({
        'success': True,
        'filter_counts': _user_balance_recharge_filter_counts(billing.id),
        'items': [_serialize_balance_recharge_row(r, user) for r in rows],
    })


@store_bp.route('/api/user/balance-recharge', methods=['POST'])
@store_access_required
@csrf_exempt_route
def api_user_balance_recharge_submit():
    import json as _json
    import os
    from decimal import Decimal, InvalidOperation
    from werkzeug.utils import secure_filename

    user_id = session.get('user_id')
    user = User.query.get(user_id) if user_id else None
    if not user:
        return jsonify({'success': False, 'message': 'No autenticado'}), 401
    if user.username != current_app.config.get('ADMIN_USER', 'admin') and not _eligible_tienda_user_licencias_portal(user):
        return jsonify({'success': False, 'message': 'Sin acceso'}), 403

    _ensure_balance_recharges_table()
    from app.store.models import BalanceRecharge

    billing = _balance_recharge_viewer_billing_user(user)
    _, tipo_precio = catalog_products_for_store_user(billing or user)
    tp = (tipo_precio or 'COP').upper()

    payment_method_id = (request.form.get('payment_method_id') or '').strip()
    from app.store.balance_recharge_analyzer import parse_recharge_amount
    from app.store.balance_recharge_payment import (
        get_accumulator_method,
        is_accumulator_method_id,
        methods_for_user_with_accum,
    )

    allowed = methods_for_user_with_accum(billing or user, tp, viewer=user)
    if not allowed:
        return jsonify({
            'success': False,
            'message': 'No hay medios de pago disponibles para tu cuenta. Contacta al administrador.',
        }), 400
    allowed_ids = {m.get('id') for m in allowed}
    if payment_method_id not in allowed_ids:
        return jsonify({'success': False, 'message': 'Selecciona un medio de pago válido'}), 400

    is_accum = is_accumulator_method_id(payment_method_id)
    if is_accum:
        accum_method = get_accumulator_method(payment_method_id) or {}
        currency = (accum_method.get('payment_currency') or 'COP').strip().upper()
    else:
        currency = (request.form.get('currency') or tp).strip().upper()
        if currency not in ('COP', 'USD'):
            return jsonify({'success': False, 'message': 'Moneda no válida'}), 400
        if currency != tp:
            return jsonify({'success': False, 'message': 'La moneda no coincide con tu tipo de precio'}), 400

    amount_raw = (request.form.get('amount') or '').strip()
    amount_val = parse_recharge_amount(amount_raw)
    if amount_val is None:
        return jsonify({'success': False, 'message': 'Indica un monto válido'}), 400
    if amount_val <= 0:
        return jsonify({'success': False, 'message': 'El monto debe ser mayor que cero'}), 400

    files = request.files.getlist('proofs') or []
    files = [f for f in files if f and f.filename]
    if not files:
        return jsonify({'success': False, 'message': 'Adjunta al menos una imagen del comprobante'}), 400
    if len(files) > _BALANCE_RECHARGE_MAX_FILES:
        return jsonify({'success': False, 'message': 'Solo se permite una imagen por solicitud'}), 400

    upload_dir = _balance_recharge_upload_dir()
    saved_files = []
    timestamp = get_colombia_now().strftime('%Y%m%d_%H%M%S')

    for file in files:
        file.seek(0, 2)
        size = file.tell()
        file.seek(0)
        if size == 0:
            continue
        if size > _BALANCE_RECHARGE_MAX_BYTES:
            return jsonify({'success': False, 'message': f'Cada imagen debe pesar menos de {_BALANCE_RECHARGE_MAX_MB} MB'}), 400
        mime = (file.content_type or '').lower()
        if mime not in _BALANCE_RECHARGE_ALLOWED_MIME:
            return jsonify({'success': False, 'message': 'Solo se permiten imágenes (JPG, PNG, WebP, GIF)'}), 400

        base = secure_filename(file.filename) or 'comprobante.jpg'
        import uuid as _uuid
        stored = f"{billing.id}_{timestamp}_{_uuid.uuid4().hex[:10]}_{base}"
        path = os.path.join(upload_dir, stored)
        file.save(path)
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            return jsonify({'success': False, 'message': 'Error al guardar una imagen'}), 500
        saved_files.append({'stored': stored, 'original': file.filename})

    if not saved_files:
        return jsonify({'success': False, 'message': 'No se pudo guardar ningún comprobante'}), 400

    from app.store.balance_recharge_payment import _find_method_by_id

    selected_method = next((m for m in allowed if m.get('id') == payment_method_id), {})
    stored_method = _find_method_by_id(payment_method_id) or {}
    if stored_method:
        selected_method = {**stored_method, **(selected_method or {})}
    if not selected_method and stored_method:
        selected_method = stored_method
    pm_label = selected_method.get('label') or ''

    from app.store.balance_recharge_payment import payment_method_brand_configured

    if not is_accum and not payment_method_brand_configured(selected_method):
        return jsonify({
            'success': False,
            'message': (
                f'El medio «{pm_label or payment_method_id}» no está listo para recargas: '
                'en admin debe elegirse un Medio (Binance, Nequi, etc.), no «— Medio —».'
            ),
        }), 400

    auto_recharge = _user_has_recarga_automatica(user) and not is_accum
    proof_path = os.path.join(upload_dir, saved_files[0]['stored'])

    from app.store.balance_recharge_analyzer import (
        analyze_recharge_proof,
        find_duplicate_recharge,
        proof_account_mismatch_message,
        proof_amount_mismatch_message,
        proof_breb_llave_mismatch_message,
        proof_payment_brand_mismatch_message,
        proof_image_hash as compute_proof_hash,
    )

    img_hash = compute_proof_hash(proof_path)
    upload_day = get_colombia_now().date()
    analysis = analyze_recharge_proof(
        proof_path,
        amount_val,
        currency,
        payment_method_id,
        payment_method_label=pm_label,
        payment_method=selected_method,
        upload_date=upload_day,
    )

    mismatch_msg = proof_amount_mismatch_message(analysis, currency)
    if mismatch_msg:
        try:
            os.remove(proof_path)
        except OSError:
            pass
        return jsonify({'success': False, 'message': mismatch_msg}), 400

    breb_llave_mismatch_msg = proof_breb_llave_mismatch_message(analysis)
    if breb_llave_mismatch_msg:
        try:
            os.remove(proof_path)
        except OSError:
            pass
        return jsonify({'success': False, 'message': breb_llave_mismatch_msg}), 400

    brand_mismatch_msg = proof_payment_brand_mismatch_message(
        analysis,
        payment_method_id,
        pm_label,
        selected_method,
    )
    if brand_mismatch_msg:
        try:
            os.remove(proof_path)
        except OSError:
            pass
        return jsonify({'success': False, 'message': brand_mismatch_msg}), 400

    account_mismatch_msg = proof_account_mismatch_message(analysis)
    if account_mismatch_msg:
        try:
            os.remove(proof_path)
        except OSError:
            pass
        return jsonify({'success': False, 'message': account_mismatch_msg}), 400

    receipt_no = analysis.get('receipt_number')

    duplicate = find_duplicate_recharge(
        receipt_number=receipt_no,
        proof_image_hash=img_hash,
        user_id=billing.id,
    )
    if duplicate:
        existing_stored = None
        ex_id = duplicate.get('existing_id')
        ex_row = None
        ex_analyzer: dict = {}
        ex_pm_label_saved = ''
        if ex_id:
            ex_row = BalanceRecharge.query.get(int(ex_id))
            if ex_row:
                ex_files = _balance_recharge_files_list(ex_row)
                if ex_files and isinstance(ex_files[0], dict):
                    existing_stored = ex_files[0].get('stored')
                raw_json = getattr(ex_row, 'analyzer_json', None) or ''
                if raw_json:
                    try:
                        ex_analyzer = json.loads(raw_json) if isinstance(raw_json, str) else dict(raw_json)
                    except (TypeError, ValueError):
                        ex_analyzer = {}
                if not ex_analyzer:
                    ex_analyzer = analysis
                from app.store.balance_recharge_payment import find_payment_method_for_recharge

                ex_method = find_payment_method_for_recharge(ex_row) or {}
                ex_pm_label_saved = (
                    ex_method.get('label')
                    or getattr(ex_row, 'payment_method_id', None)
                    or ''
                )
                dup_brand_msg = proof_payment_brand_mismatch_message(
                    ex_analyzer,
                    payment_method_id,
                    pm_label,
                    selected_method,
                )
                if dup_brand_msg:
                    try:
                        os.remove(proof_path)
                    except OSError:
                        pass
                    return jsonify({'success': False, 'message': dup_brand_msg}), 400
        new_stored = saved_files[0].get('stored')
        if new_stored and new_stored != existing_stored:
            try:
                os.remove(proof_path)
            except OSError:
                pass
        dup_message = duplicate['message']
        if (
            ex_row
            and ex_pm_label_saved
            and str(getattr(ex_row, 'payment_method_id', '') or '').strip()
            != str(payment_method_id or '').strip()
        ):
            dup_message = (
                f'Esta imagen ya se envió con el medio «{ex_pm_label_saved}». '
                f'No puedes reutilizarla eligiendo «{pm_label or payment_method_id}».'
            )
        return jsonify({'success': False, 'message': dup_message}), 409

    row = BalanceRecharge(
        user_id=billing.id,
        submitted_by_user_id=user.id,
        currency=currency,
        payment_method_id=payment_method_id,
        amount_claimed=amount_val,
        note=None,
        status='pending',
        proof_files_json=_json.dumps(saved_files),
        auto_credited=False,
        receipt_number=receipt_no,
        proof_image_hash=img_hash,
    )

    if is_accum:
        row.analyzer_json = _json.dumps(analysis, ensure_ascii=False)
        message = (
            'Solicitud enviada. Un administrador revisará el comprobante y, '
            'si es correcto, lo acumulará para convertirlo a tu saldo cuando corresponda.'
        )
    elif auto_recharge and analysis.get('ready_for_auto'):
        row.analyzer_json = _json.dumps(analysis, ensure_ascii=False)
        row.auto_credited = True
        row.amount_credited = amount_val
        row.status = 'auto_credited'
        row.admin_verified = None
        _apply_balance_credit(billing, currency, float(amount_val))
        message = 'Saldo acreditado automáticamente. Un administrador verificará el comprobante.'
    else:
        row.analyzer_json = _json.dumps(analysis, ensure_ascii=False)
        if auto_recharge and not analysis.get('ready_for_auto'):
            message = (
                'Solicitud enviada. El comprobante no cumple todas las validaciones '
                'automáticas; un administrador lo revisará.'
            )
        else:
            message = 'Solicitud enviada. Te avisaremos cuando se revise.'

    db.session.add(row)
    db.session.commit()

    try:
        from app.store.balance_recharge_email_scheduler import ensure_email_verification_scheduled

        ensure_email_verification_scheduled(row)
        db.session.commit()
    except Exception as exc:
        current_app.logger.warning('No se pudo programar verificación por correo recarga %s: %s', row.id, exc)
        db.session.rollback()

    return jsonify({
        'success': True,
        'message': message,
        'item': _serialize_balance_recharge_row(row, user),
        'auto_credited': auto_recharge,
        'accumulated': is_accum,
    })


@store_bp.route('/api/user/balance-recharge/<int:recharge_id>/proof/<int:file_index>')
@store_access_required
def api_user_balance_recharge_proof(recharge_id, file_index):
    import os
    from flask import send_file

    user_id = session.get('user_id')
    user = User.query.get(user_id) if user_id else None
    if not user:
        return jsonify({'success': False, 'message': 'No autenticado'}), 401

    _ensure_balance_recharges_table()
    from app.store.models import BalanceRecharge

    row = BalanceRecharge.query.get(recharge_id)
    if not row or not _balance_recharge_row_accessible(row, user):
        return jsonify({'success': False, 'message': 'No encontrado'}), 404

    files = _balance_recharge_files_list(row)
    if file_index < 0 or file_index >= len(files):
        return jsonify({'success': False, 'message': 'Archivo no encontrado'}), 404

    entry = files[file_index]
    stored = entry.get('stored') if isinstance(entry, dict) else None
    if not stored:
        return jsonify({'success': False, 'message': 'Archivo no válido'}), 404

    path = os.path.join(_balance_recharge_upload_dir(), stored)
    if not os.path.isfile(path):
        wants_json = 'application/json' in (request.accept_mimetypes.best_match(['application/json', 'image/*']) or '')
        if wants_json == 'application/json':
            return jsonify({'success': False, 'message': 'Archivo no disponible'}), 404
        return ('', 404)

    ext = os.path.splitext(stored)[1].lower()
    mimetypes = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif'}
    mimetype = mimetypes.get(ext, 'application/octet-stream')
    return send_file(path, mimetype=mimetype, download_name=entry.get('original') or stored, conditional=True, as_attachment=False)


@store_bp.route('/api/user/balance-recharge/payment-methods')
@store_access_required
def api_user_balance_recharge_payment_methods():
    user_id = session.get('user_id')
    user = User.query.get(user_id) if user_id else None
    if not user:
        return jsonify({'success': False, 'message': 'No autenticado'}), 401
    if user.username != current_app.config.get('ADMIN_USER', 'admin') and not _eligible_tienda_user_licencias_portal(user):
        return jsonify({'success': False, 'message': 'Sin acceso'}), 403

    tp, currency_label, pm_rows = _recharge_payment_methods_payload(user)
    return jsonify({
        'success': True,
        'currency': tp,
        'currency_label': currency_label,
        'methods': pm_rows,
    })


@store_bp.route('/admin/recargas-saldo')
@admin_required
def admin_recargas_saldo():
    """Revisión de consignaciones y configuración de medios de pago."""
    _ensure_balance_recharges_table()
    from app.store.balance_recharge_cleanup import get_cleanup_settings

    user = get_current_user()
    cleanup_settings = get_cleanup_settings()
    cleanup_selected_user = None
    if (
        cleanup_settings
        and cleanup_settings.get('scope') == 'user'
        and cleanup_settings.get('user_id')
    ):
        u = User.query.get(int(cleanup_settings['user_id']))
        if u:
            cleanup_selected_user = {
                'id': u.id,
                'label': u.username,
            }
    return render_template(
        'admin_recargas_saldo.html',
        current_user=user,
        title='Recargas y pagos',
        cleanup_settings=cleanup_settings,
        cleanup_selected_user=cleanup_selected_user,
    )


@store_bp.route('/api/admin/balance-recharges/cleanup-settings', methods=['GET', 'POST'])
@csrf_exempt_route
@admin_required
def api_balance_recharge_cleanup_settings():
    from app.store.balance_recharge_cleanup import (
        count_recharges_to_purge,
        get_cleanup_settings,
        save_cleanup_settings,
    )

    _ensure_balance_recharges_table()

    if request.method == 'GET':
        settings = get_cleanup_settings()
        user_id = settings.get('user_id') if settings.get('scope') == 'user' else None
        preview = count_recharges_to_purge(
            settings.get('retention_days', 90),
            user_id=user_id,
        )
        return jsonify({
            'success': True,
            'settings': settings,
            'preview_count': preview,
        })

    data = request.get_json(silent=True) or {}
    try:
        retention_days = max(0, min(3650, int(data.get('retention_days', 90))))
        run_interval_hours = max(1, min(8760, int(data.get('run_interval_hours', 24))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Días o intervalo inválidos.'}), 400

    scope = (data.get('scope') or 'all').strip().lower()
    if scope not in ('all', 'user'):
        scope = 'all'

    user_id = data.get('user_id')
    if scope == 'user':
        if not user_id:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(user_id)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(user_id)
    else:
        user_id = None

    auto_enabled = bool(data.get('auto_enabled'))
    if auto_enabled and retention_days <= 0:
        return jsonify({
            'success': False,
            'error': 'La limpieza automática requiere al menos 1 día de antigüedad.',
        }), 400

    settings = save_cleanup_settings({
        'auto_enabled': auto_enabled,
        'retention_days': retention_days,
        'run_interval_hours': run_interval_hours,
        'scope': scope,
        'user_id': user_id,
    })
    preview = count_recharges_to_purge(retention_days, user_id=user_id)
    return jsonify({
        'success': True,
        'message': 'Configuración de limpieza guardada.',
        'settings': settings,
        'preview_count': preview,
    })


@store_bp.route('/api/admin/balance-recharges/purge', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_balance_recharge_purge():
    from app.store.balance_recharge_cleanup import (
        count_recharges_to_purge,
        enqueue_purge_background,
        is_purge_running,
    )

    _ensure_balance_recharges_table()

    data = request.get_json(silent=True) or {}
    try:
        retention_days = max(0, min(3650, int(data.get('retention_days', 90))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Antigüedad en días inválida.'}), 400

    scope = (data.get('scope') or 'all').strip().lower()
    user_id = None
    if scope == 'user':
        uid = data.get('user_id')
        if not uid:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(uid)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(uid)

    if is_purge_running():
        return jsonify({
            'success': False,
            'error': 'Ya hay una limpieza en curso. Espera a que termine.',
        }), 409

    count = count_recharges_to_purge(retention_days, user_id=user_id)
    if count == 0:
        return jsonify({
            'success': False,
            'error': 'No hay solicitudes que coincidan con esos criterios.',
        }), 400

    if not data.get('confirm'):
        return jsonify({'success': False, 'error': 'Confirmación requerida.'}), 400

    from app.store.balance_recharge_cleanup import cleanup_orphan_proof_files

    app_obj = current_app._get_current_object()
    started = enqueue_purge_background(app_obj, retention_days, user_id=user_id)
    if not started:
        return jsonify({
            'success': False,
            'error': 'No se pudo iniciar la limpieza (ya hay otra en curso).',
        }), 409

    orphan_files = cleanup_orphan_proof_files(app_obj)
    msg = f'Se eliminarán {count} solicitud(es) en segundo plano.'
    if orphan_files:
        msg += f' También se quitaron {orphan_files} comprobante(s) huérfano(s) en disco.'

    return jsonify({
        'success': True,
        'message': msg,
        'background': True,
        'count': count,
        'orphan_files_deleted': orphan_files,
    })


@store_bp.route('/api/admin/balance-recharges/purge-preview', methods=['GET'])
@csrf_exempt_route
@admin_required
def api_balance_recharge_purge_preview():
    from app.store.balance_recharge_cleanup import count_recharges_to_purge

    _ensure_balance_recharges_table()

    try:
        retention_days = max(0, min(3650, int(request.args.get('retention_days', 90))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Antigüedad inválida.'}), 400

    scope = (request.args.get('scope') or 'all').strip().lower()
    user_id = None
    if scope == 'user':
        uid = request.args.get('user_id')
        if uid:
            user_id = int(uid)

    count = count_recharges_to_purge(retention_days, user_id=user_id)
    return jsonify({'success': True, 'count': count})


@store_bp.route('/api/admin/balance-recharges')
@csrf_exempt_route
@admin_required
def api_admin_balance_recharges():
    from app.store.models import BalanceRecharge
    from app.store.balance_recharge_accum import normalize_unreviewed_accumulations

    _ensure_balance_recharges_table()
    normalize_unreviewed_accumulations()
    from app.store.balance_recharge_payment import accumulator_method_ids

    status = (request.args.get('status') or 'pending').strip().lower()
    accum_filter = (request.args.get('accumulator') or 'all').strip().lower()
    accum_ids = accumulator_method_ids()
    q = BalanceRecharge.query.order_by(BalanceRecharge.created_at.desc())
    if status == 'auto_pending':
        q = q.filter(
            BalanceRecharge.status == 'auto_credited',
            BalanceRecharge.admin_verified.is_(None),
        )
    elif status == 'pending' and accum_filter == 'exclude':
        from sqlalchemy import and_

        q = q.filter(
            or_(
                BalanceRecharge.status == 'pending',
                and_(
                    BalanceRecharge.status == 'auto_credited',
                    BalanceRecharge.admin_verified.is_(None),
                ),
            )
        )
    elif status != 'all':
        q = q.filter(BalanceRecharge.status == status)
    if accum_filter == 'only':
        if accum_ids:
            q = q.filter(BalanceRecharge.payment_method_id.in_(accum_ids))
        else:
            q = q.filter(BalanceRecharge.id < 0)
    elif accum_filter == 'exclude':
        if accum_ids:
            q = q.filter(~BalanceRecharge.payment_method_id.in_(accum_ids))
    rows = q.limit(200).all()
    pending_q = BalanceRecharge.query.filter_by(status='pending')
    if accum_ids:
        pending_count = pending_q.filter(~BalanceRecharge.payment_method_id.in_(accum_ids)).count()
        accum_pending_count = pending_q.filter(BalanceRecharge.payment_method_id.in_(accum_ids)).count()
    else:
        pending_count = pending_q.count()
        accum_pending_count = 0
    auto_pending_count = BalanceRecharge.query.filter(
        BalanceRecharge.status == 'auto_credited',
        BalanceRecharge.admin_verified.is_(None),
    ).count()
    if accum_ids:
        auto_pending_non_accum = BalanceRecharge.query.filter(
            BalanceRecharge.status == 'auto_credited',
            BalanceRecharge.admin_verified.is_(None),
            ~BalanceRecharge.payment_method_id.in_(accum_ids),
        ).count()
        review_pending_count = pending_count + auto_pending_non_accum
    else:
        review_pending_count = pending_count + auto_pending_count
    payload = {
        'success': True,
        'pending_count': pending_count,
        'review_pending_count': review_pending_count,
        'accum_pending_count': accum_pending_count,
        'auto_pending_count': auto_pending_count,
        'items': [_serialize_balance_recharge_row(r, None, include_username=True) for r in rows],
    }
    if accum_filter == 'only':
        payload['accum_filter_counts'] = _balance_recharge_accum_filter_counts(accum_ids)
    return jsonify(payload)


@store_bp.route('/api/admin/balance-recharge/<int:recharge_id>/review', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_review(recharge_id):
    from decimal import Decimal, InvalidOperation
    from app.store.models import BalanceRecharge

    _ensure_balance_recharges_table()
    admin_user = get_current_user()
    row = BalanceRecharge.query.get(recharge_id)
    if not row:
        return jsonify({'success': False, 'message': 'Solicitud no encontrada'}), 404

    data = request.get_json(silent=True) or {}
    action = (data.get('action') or '').strip().lower()
    admin_note = (data.get('admin_note') or '').strip()[:2000]
    row_status = (row.status or '').lower()

    if row_status == 'auto_credited' and row.admin_verified is None:
        target = User.query.get(row.user_id)
        if not target:
            return jsonify({'success': False, 'message': 'Usuario no encontrado'}), 404
        cur = (row.currency or 'COP').strip().upper()
        credited = row.amount_credited if row.amount_credited is not None else row.amount_claimed
        amt = float(credited) if credited is not None else 0.0

        if action == 'confirm_auto':
            import json as _json

            from app.store.balance_recharge_analyzer import proof_breb_llave_mismatch_message
            from app.store.balance_recharge_payment import (
                _find_method_by_id,
                payment_method_breb_llave_normalized,
                payment_method_is_breb_bancolombia,
            )

            try:
                analysis_auto = _json.loads(row.analyzer_json or '{}')
            except (_json.JSONDecodeError, TypeError):
                analysis_auto = {}
            if not isinstance(analysis_auto, dict):
                analysis_auto = {}
            pm_auto = _find_method_by_id(row.payment_method_id or '')
            if payment_method_is_breb_bancolombia(pm_auto):
                analysis_auto.setdefault('is_breb_bancolombia', True)
                if not analysis_auto.get('bre_b_llave_expected'):
                    analysis_auto['bre_b_llave_expected'] = payment_method_breb_llave_normalized(
                        pm_auto
                    )
            breb_block_auto = proof_breb_llave_mismatch_message(analysis_auto)
            if breb_block_auto:
                return jsonify({'success': False, 'message': breb_block_auto}), 400

            row.status = 'approved'
            row.admin_verified = True
            row.admin_note = admin_note
            row.reviewed_at = datetime.utcnow()
            row.reviewed_by_user_id = admin_user.id if admin_user else None
            db.session.commit()
            return jsonify({
                'success': True,
                'message': 'Recarga automática confirmada.',
                'item': _serialize_balance_recharge_row(row, None, include_username=True),
            })

        if action == 'reject_auto':
            if amt > 0:
                _apply_balance_debit(target, cur, amt)
            row.status = 'rejected'
            row.admin_verified = False
            row.admin_note = admin_note
            row.reviewed_at = datetime.utcnow()
            row.reviewed_by_user_id = admin_user.id if admin_user else None
            db.session.commit()
            return jsonify({
                'success': True,
                'message': 'Recarga revertida y saldo descontado.',
                'item': _serialize_balance_recharge_row(row, None, include_username=True),
                'new_saldo_usd': float(target.saldo_usd or 0),
                'new_saldo_cop': float(target.saldo_cop or 0),
            })

        return jsonify({'success': False, 'message': 'Acción no válida para recarga automática'}), 400

    if row_status != 'pending':
        if row_status == 'accumulated' and action == 'reject':
            row.status = 'rejected'
            row.admin_note = admin_note
            row.reviewed_at = datetime.utcnow()
            row.reviewed_by_user_id = admin_user.id if admin_user else None
            db.session.commit()
            return jsonify({
                'success': True,
                'message': 'Acumulación rechazada.',
                'item': _serialize_balance_recharge_row(row, None, include_username=True),
            })
        return jsonify({'success': False, 'message': 'La solicitud ya fue revisada'}), 400

    from app.store.balance_recharge_payment import is_accumulator_method_id

    if action == 'reject':
        row.status = 'rejected'
        row.admin_note = admin_note
        row.reviewed_at = datetime.utcnow()
        row.reviewed_by_user_id = admin_user.id if admin_user else None
        db.session.commit()
        return jsonify({
            'success': True,
            'message': 'Solicitud rechazada.',
            'item': _serialize_balance_recharge_row(row, None, include_username=True),
        })

    if action != 'approve':
        return jsonify({'success': False, 'message': 'Acción no válida'}), 400

    import json as _json

    from app.store.balance_recharge_analyzer import proof_breb_llave_mismatch_message
    from app.store.balance_recharge_payment import (
        find_payment_method_for_recharge,
        payment_method_breb_llave_normalized,
        payment_method_is_breb_bancolombia,
    )

    try:
        analysis = _json.loads(row.analyzer_json or '{}')
    except (_json.JSONDecodeError, TypeError):
        analysis = {}
    if not isinstance(analysis, dict):
        analysis = {}
    pm_review = find_payment_method_for_recharge(row, analysis) or {}
    if payment_method_is_breb_bancolombia(pm_review):
        analysis.setdefault('is_breb_bancolombia', True)
        if not analysis.get('bre_b_llave_expected'):
            analysis['bre_b_llave_expected'] = payment_method_breb_llave_normalized(pm_review)
    breb_block = proof_breb_llave_mismatch_message(analysis)
    if breb_block:
        return jsonify({'success': False, 'message': breb_block}), 400

    amount_raw = data.get('amount_approved')
    if amount_raw is not None and str(amount_raw).strip() != '':
        try:
            amount_val = Decimal(str(amount_raw))
        except (InvalidOperation, TypeError, ValueError):
            return jsonify({'success': False, 'message': 'Monto a acreditar inválido'}), 400
    else:
        amount_val = row.amount_claimed
    if amount_val is None or amount_val <= 0:
        return jsonify({'success': False, 'message': 'Indica un monto válido para acreditar'}), 400

    target = User.query.get(row.user_id)
    if not target:
        return jsonify({'success': False, 'message': 'Usuario no encontrado'}), 404

    if is_accumulator_method_id(row.payment_method_id or ''):
        row.status = 'accumulated'
        row.amount_claimed = amount_val
        row.admin_note = admin_note
        row.reviewed_at = datetime.utcnow()
        row.reviewed_by_user_id = admin_user.id if admin_user else None
        db.session.commit()
        return jsonify({
            'success': True,
            'message': 'Pago acumulado. Conviértelo desde el panel Acumulador cuando corresponda.',
            'item': _serialize_balance_recharge_row(row, None, include_username=True),
        })

    cur = (row.currency or 'COP').strip().upper()
    amt = float(amount_val)
    _apply_balance_credit(target, cur, amt)

    row.status = 'approved'
    row.amount_claimed = amount_val
    row.admin_note = admin_note
    row.reviewed_at = datetime.utcnow()
    row.reviewed_by_user_id = admin_user.id if admin_user else None
    db.session.commit()

    return jsonify({
        'success': True,
        'message': f'Saldo acreditado ({amt:g} {cur}).',
        'item': _serialize_balance_recharge_row(row, None, include_username=True),
        'new_saldo_usd': float(target.saldo_usd or 0),
        'new_saldo_cop': float(target.saldo_cop or 0),
    })


@store_bp.route('/api/admin/balance-recharge/analyzer-patterns', methods=['GET', 'POST'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_analyzer_patterns():
    from app.store.balance_recharge_analyzer import (
        get_analyzer_patterns,
        save_analyzer_patterns,
        DEFAULT_PATTERNS,
    )

    if request.method == 'GET':
        return jsonify({
            'success': True,
            'patterns': get_analyzer_patterns(),
            'defaults': DEFAULT_PATTERNS,
        })

    data = request.get_json(silent=True) or {}
    patterns = data.get('patterns')
    if not isinstance(patterns, list):
        return jsonify({'success': False, 'message': 'Se esperaba una lista de patrones'}), 400
    try:
        save_analyzer_patterns(patterns)
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        current_app.logger.error('Error guardando patrones analizador: %s', exc, exc_info=True)
        return jsonify({'success': False, 'message': 'No se pudieron guardar los patrones'}), 500
    return jsonify({'success': True, 'message': 'Patrones guardados.', 'patterns': get_analyzer_patterns()})


@store_bp.route('/api/admin/balance-recharge/email-review/settings', methods=['GET'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_email_review_settings():
    from app.store.balance_recharge_email_review import (
        get_email_review_settings,
        list_email_regex_entries,
        list_imap_server_options,
        list_payment_method_options,
        buzon_enabled,
    )

    settings = get_email_review_settings()
    return jsonify({
        'success': True,
        'settings': settings,
        'buzon_enabled': buzon_enabled(),
        'regex_entries': list_email_regex_entries(),
        'imap_options': list_imap_server_options(),
        'payment_method_options': list_payment_method_options(),
    })


@store_bp.route('/api/admin/balance-recharge/email-review/regex', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_email_review_regex_create():
    from app.store.balance_recharge_email_review import (
        create_email_regex_entry,
        list_email_regex_entries,
    )

    data = request.get_json(silent=True) or {}
    try:
        entry = create_email_regex_entry(
            data.get('payment_method_label') or data.get('description', ''),
            data.get('sender', ''),
            data.get('pattern', ''),
            data.get('note', ''),
        )
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        current_app.logger.error('Error creando regex recarga: %s', exc, exc_info=True)
        return jsonify({'success': False, 'message': 'No se pudo crear el regex.'}), 500
    return jsonify({
        'success': True,
        'message': 'Regex creado.',
        'regex': entry,
        'regex_entries': list_email_regex_entries(),
    })


@store_bp.route('/api/admin/balance-recharge/email-review/regex/<entry_id>', methods=['PUT', 'DELETE'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_email_review_regex_item(entry_id):
    from app.store.balance_recharge_email_review import (
        update_email_regex_entry,
        delete_email_regex_entry,
        list_email_regex_entries,
    )

    try:
        entry_id_int = int(str(entry_id).strip())
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'ID de regex inválido.'}), 400
    if entry_id_int <= 0:
        return jsonify({'success': False, 'message': 'ID de regex inválido.'}), 400

    if request.method == 'DELETE':
        try:
            deleted = delete_email_regex_entry(entry_id_int)
        except Exception as exc:
            current_app.logger.error('Error eliminando regex recarga: %s', exc, exc_info=True)
            return jsonify({'success': False, 'message': 'No se pudo eliminar el regex.'}), 500
        if not deleted:
            return jsonify({'success': False, 'message': 'Regex no encontrado.'}), 404
        return jsonify({
            'success': True,
            'message': 'Regex eliminado.',
            'regex_entries': list_email_regex_entries(),
        })

    data = request.get_json(silent=True) or {}
    try:
        entry = update_email_regex_entry(
            entry_id_int,
            data.get('payment_method_label') or data.get('description', ''),
            data.get('sender', ''),
            data.get('pattern', ''),
            data.get('note', ''),
        )
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        current_app.logger.error('Error actualizando regex recarga: %s', exc, exc_info=True)
        return jsonify({'success': False, 'message': 'No se pudo actualizar el regex.'}), 500
    return jsonify({
        'success': True,
        'message': 'Regex actualizado.',
        'regex': entry,
        'regex_entries': list_email_regex_entries(),
    })


@store_bp.route('/api/admin/balance-recharge/email-review/buzon', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_email_review_buzon():
    from app.store.balance_recharge_email_review import set_buzon_enabled, buzon_enabled

    data = request.get_json(silent=True) or {}
    if 'enabled' not in data:
        return jsonify({'success': False, 'message': 'Indica enabled true/false.'}), 400
    enabled = bool(data.get('enabled'))
    set_buzon_enabled(enabled)
    return jsonify({
        'success': True,
        'buzon_enabled': buzon_enabled(),
        'message': 'Consulta al buzón IMAP ' + ('activada' if enabled else 'desactivada') + '.',
    })


@store_bp.route('/api/admin/balance-recharge/email-review/imap', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_email_review_imap_create():
    from app.store.balance_recharge_imap import (
        create_recarga_imap_server,
        list_recarga_imap_servers,
    )

    data = request.get_json(silent=True) or {}
    try:
        server = create_recarga_imap_server(
            host=data.get('host', ''),
            username=data.get('username', ''),
            password=data.get('password', ''),
            port=data.get('port', 993),
            folders=data.get('folders', 'INBOX'),
            description=data.get('description', ''),
        )
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        current_app.logger.error('Error creando IMAP recarga: %s', exc, exc_info=True)
        return jsonify({'success': False, 'message': 'No se pudo crear el servidor IMAP.'}), 500
    return jsonify({
        'success': True,
        'message': 'Servidor IMAP agregado.',
        'server': server,
        'imap_options': list_recarga_imap_servers(),
    })


@store_bp.route('/api/admin/balance-recharge/email-review/imap/<int:server_id>', methods=['PUT', 'DELETE'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_email_review_imap_item(server_id):
    from app.store.balance_recharge_imap import (
        update_recarga_imap_server,
        delete_recarga_imap_server,
        list_recarga_imap_servers,
    )

    if request.method == 'DELETE':
        try:
            deleted = delete_recarga_imap_server(server_id)
        except Exception as exc:
            current_app.logger.error('Error eliminando IMAP recarga: %s', exc, exc_info=True)
            return jsonify({'success': False, 'message': 'No se pudo eliminar.'}), 500
        if not deleted:
            return jsonify({'success': False, 'message': 'Servidor no encontrado.'}), 404
        return jsonify({
            'success': True,
            'message': 'Servidor IMAP eliminado.',
            'imap_options': list_recarga_imap_servers(),
        })

    data = request.get_json(silent=True) or {}
    try:
        server = update_recarga_imap_server(
            server_id,
            host=data.get('host', ''),
            username=data.get('username', ''),
            password=data.get('password', ''),
            port=data.get('port', 993),
            folders=data.get('folders', 'INBOX'),
            description=data.get('description', ''),
        )
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        current_app.logger.error('Error actualizando IMAP recarga: %s', exc, exc_info=True)
        return jsonify({'success': False, 'message': 'No se pudo actualizar.'}), 500
    return jsonify({
        'success': True,
        'message': 'Servidor IMAP actualizado.',
        'server': server,
        'imap_options': list_recarga_imap_servers(),
    })


@store_bp.route('/api/admin/balance-recharge/email-review/imap/<int:server_id>/test', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_email_review_imap_test(server_id):
    from app.store.balance_recharge_imap import test_recarga_imap_server

    ok, message = test_recarga_imap_server(server_id)
    return jsonify({
        'success': ok,
        'message': message,
    }), (200 if ok else 400)


@store_bp.route('/api/admin/balance-recharge/email-review/imap/<int:server_id>/toggle', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_email_review_imap_toggle(server_id):
    from app.store.balance_recharge_imap import (
        set_recarga_imap_enabled,
        list_recarga_imap_servers,
    )

    data = request.get_json(silent=True) or {}
    if 'enabled' not in data:
        return jsonify({'success': False, 'message': 'Indica enabled true/false.'}), 400
    try:
        server = set_recarga_imap_enabled(server_id, bool(data.get('enabled')))
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 404
    except Exception as exc:
        current_app.logger.error('Error toggle IMAP recarga: %s', exc, exc_info=True)
        return jsonify({'success': False, 'message': 'No se pudo cambiar el estado.'}), 500
    enabled = bool(server.get('enabled'))
    return jsonify({
        'success': True,
        'message': 'Servidor IMAP ' + ('activado' if enabled else 'apagado') + '.',
        'server': server,
        'imap_options': list_recarga_imap_servers(),
    })


@store_bp.route('/api/admin/balance-recharge/<int:recharge_id>/email-verify', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_email_verify(recharge_id):
    from app.store.models import BalanceRecharge
    from app.store.balance_recharge_email_scheduler import run_email_verification_serialized
    from app.store.balance_recharge_email_verify import sanitize_for_json

    _ensure_balance_recharges_table()
    row = BalanceRecharge.query.get(recharge_id)
    if not row:
        return jsonify({'success': False, 'message': 'Solicitud no encontrada.'}), 404
    row_status = (row.status or '').lower()
    if row_status not in ('pending', 'auto_credited'):
        return jsonify({'success': False, 'message': 'La solicitud ya fue revisada.'}), 400
    if row_status == 'auto_credited' and row.admin_verified is not None:
        return jsonify({'success': False, 'message': 'La recarga automática ya fue verificada.'}), 400

    try:
        result = run_email_verification_serialized(
            row,
            apply_match=True,
            update_schedule=False,
            blocking=True,
        )
        if result is None:
            return jsonify({
                'success': False,
                'message': 'Hay otra verificación de correo en curso. Intenta en un momento.',
            }), 409
    except Exception as exc:
        current_app.logger.error('Error verificando recarga por correo %s: %s', recharge_id, exc, exc_info=True)
        return jsonify({'success': False, 'message': 'Error al consultar correos.'}), 500

    applied = result.get('status') == 'matched' and (row_status == 'approved' or row.admin_verified is True)
    return jsonify({
        'success': True,
        'recharge_id': recharge_id,
        'email_verify': sanitize_for_json(result),
        'auto_applied': applied,
        'item': _serialize_balance_recharge_row(row, None, include_username=True),
    })


@store_bp.route('/api/admin/balance-recharge/email-verify-batch', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_email_verify_batch():
    from app.store.models import BalanceRecharge
    from app.store.balance_recharge_email_scheduler import run_email_verification_serialized

    _ensure_balance_recharges_table()
    data = request.get_json(silent=True) or {}
    ids_raw = data.get('recharge_ids') or []
    recharge_ids: list[int] = []
    if isinstance(ids_raw, list):
        for x in ids_raw:
            try:
                rid = int(x)
            except (TypeError, ValueError):
                continue
            if rid > 0 and rid not in recharge_ids:
                recharge_ids.append(rid)

    if not recharge_ids:
        from sqlalchemy import and_

        rows = BalanceRecharge.query.filter(
            or_(
                BalanceRecharge.status == 'pending',
                and_(
                    BalanceRecharge.status == 'auto_credited',
                    BalanceRecharge.admin_verified.is_(None),
                ),
            )
        ).order_by(BalanceRecharge.created_at.desc()).limit(50).all()
        recharge_ids = [r.id for r in rows]

    results: dict[str, dict] = {}
    processed = 0
    for rid in recharge_ids:
        row = BalanceRecharge.query.get(rid)
        if not row:
            continue
        row_status = (row.status or '').lower()
        if row_status not in ('pending', 'auto_credited'):
            continue
        if row_status == 'auto_credited' and row.admin_verified is not None:
            continue
        if processed >= 1:
            break
        try:
            result = run_email_verification_serialized(
                row,
                apply_match=True,
                update_schedule=False,
                blocking=(processed == 0),
            )
            if result is None:
                results[str(rid)] = {
                    'status': 'busy',
                    'message': 'Hay otra verificación de correo en curso.',
                    'checked': False,
                }
                break
            results[str(rid)] = result
            processed += 1
        except Exception as exc:
            current_app.logger.warning('Email verify falló recarga %s: %s', rid, exc)
            results[str(rid)] = {
                'status': 'error',
                'message': 'Error al consultar correos.',
                'checked': False,
            }

    return jsonify({'success': True, 'results': results})


@store_bp.route('/api/admin/balance-recharge/accum-summary', methods=['GET'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_accum_summary():
    from app.store.balance_recharge_accum import list_accumulated_summary

    _ensure_balance_recharges_table()
    items = list_accumulated_summary()
    return jsonify({'success': True, 'items': items})


@store_bp.route('/api/admin/balance-recharge/accum-convert', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_admin_balance_recharge_accum_convert():
    from app.store.balance_recharge_accum import convert_accumulation

    _ensure_balance_recharges_table()
    admin_user = get_current_user()
    data = request.get_json(silent=True) or {}
    try:
        user_id = int(data.get('user_id'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'Usuario inválido'}), 400
    payment_method_id = (data.get('payment_method_id') or '').strip()
    if not payment_method_id:
        return jsonify({'success': False, 'message': 'Medio de pago requerido'}), 400

    try:
        result = convert_accumulation(
            user_id,
            payment_method_id,
            admin_user_id=admin_user.id if admin_user else None,
        )
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        current_app.logger.exception('Error al convertir acumulador: %s', exc)
        db.session.rollback()
        return jsonify({'success': False, 'message': 'No se pudo completar la conversión'}), 500

    return jsonify({
        'success': True,
        'message': (
            f'Saldo acreditado: {result["credit_amount"]:g} '
            f'{result["credit_currency"]} a {result["username"]}.'
        ),
        'result': result,
    })


def _enrich_payment_methods_for_admin_api(cfg):
    from app.store.balance_recharge_payment import (
        _infer_payment_brand,
        payment_brand_choices,
        payment_method_qr_public_filename,
    )

    user_ids = set()
    for lst in cfg.values():
        for m in lst:
            for uid in m.get('allowed_user_ids') or []:
                try:
                    user_ids.add(int(uid))
                except (TypeError, ValueError):
                    pass
    users_map = {}
    if user_ids:
        for u in User.query.filter(User.id.in_(user_ids)).all():
            users_map[int(u.id)] = u.username
    enriched = {}
    for cur, lst in cfg.items():
        enriched[cur] = []
        for m in lst:
            row = dict(m)
            fn = row.get('qr_filename')
            if fn:
                row['qr_url'] = url_for(
                    'store_bp.api_payment_method_qr_image',
                    filename=payment_method_qr_public_filename(fn),
                )
            ids = row.get('allowed_user_ids') or []
            row['allowed_users'] = [
                {'id': int(uid), 'username': users_map.get(int(uid), str(uid))}
                for uid in ids
            ]
            if not row.get('payment_brand'):
                inferred = _infer_payment_brand(
                    row.get('label') or '',
                    row.get('id') or '',
                    row.get('linked_brands'),
                )
                if inferred:
                    row['payment_brand'] = inferred
            enriched[cur].append(row)
    return enriched, payment_brand_choices()


@store_bp.route('/api/admin/payment-methods/settings', methods=['GET', 'POST'])
@csrf_exempt_route
@admin_required
def api_admin_payment_methods_settings():
    from app.store.balance_recharge_payment import (
        get_payment_methods_config,
        save_payment_methods_config,
    )

    if request.method == 'GET':
        cfg = get_payment_methods_config()
        enriched, brand_choices = _enrich_payment_methods_for_admin_api(cfg)
        return jsonify({
            'success': True,
            'methods': enriched,
            'payment_brand_choices': brand_choices,
        })

    data = request.get_json(silent=True) or {}
    payload = data.get('methods') or data
    from app.store.balance_recharge_payment import validate_payment_methods_payload

    pm_err = validate_payment_methods_payload(payload)
    if pm_err:
        return jsonify({'success': False, 'message': pm_err}), 400
    previous = get_payment_methods_config()
    methods = save_payment_methods_config(
        payload,
        app=current_app._get_current_object(),
        previous=previous,
    )
    enriched, brand_choices = _enrich_payment_methods_for_admin_api(methods)
    return jsonify({
        'success': True,
        'message': 'Medios de pago guardados.',
        'methods': enriched,
        'payment_brand_choices': brand_choices,
    })


@store_bp.route('/api/payment-methods/qr/<path:filename>')
def api_payment_method_qr_image(filename):
    """Imagen QR de un medio de pago (portal cliente o admin autenticado)."""
    from app.store.balance_recharge_payment import (
        payment_method_qr_public_filename,
        payment_method_qr_upload_dir,
    )

    if not session.get('logged_in'):
        return jsonify({'success': False, 'message': 'No autorizado'}), 403
    fn = payment_method_qr_public_filename(filename)
    if not fn:
        return jsonify({'success': False, 'message': 'Archivo inválido'}), 400
    path = os.path.join(payment_method_qr_upload_dir(current_app), fn)
    if not os.path.isfile(path):
        return jsonify({'success': False, 'message': 'No encontrado'}), 404
    return send_from_directory(os.path.dirname(path), os.path.basename(path))


@store_bp.route('/api/admin/users/payment-methods', methods=['GET', 'POST'])
@csrf_exempt_route
@admin_required
def api_admin_user_payment_methods():
    from app.store.balance_recharge_payment import (
        get_payment_methods_config,
        methods_for_currency,
        set_user_payment_method_ids,
    )

    if request.method == 'GET':
        username = (request.args.get('username') or '').strip()
        if not username:
            return jsonify({'success': False, 'message': 'Indica un usuario'}), 400
        u = User.query.filter_by(username=username).first()
        if not u:
            return jsonify({'success': False, 'message': 'Usuario no encontrado'}), 404
        tp = None
        if u.user_prices and isinstance(u.user_prices, dict):
            tp = u.user_prices.get('tipo_precio')
        tp = (tp or 'COP').strip().upper()
        if tp not in ('USD', 'COP'):
            tp = 'COP'
        cfg = get_payment_methods_config()
        all_ids = [m['id'] for m in methods_for_currency(tp, enabled_only=False)]
        allowed = None
        if u.user_prices and isinstance(u.user_prices, dict):
            raw = u.user_prices.get('payment_method_ids')
            if isinstance(raw, list):
                allowed = [str(x) for x in raw if str(x) in all_ids]
        return jsonify({
            'success': True,
            'user_id': u.id,
            'username': u.username,
            'tipo_precio': tp,
            'payment_method_ids': allowed,
            'all_methods': cfg.get(tp) or [],
        })

    data = request.get_json(silent=True) or {}
    user_id = data.get('user_id')
    username = (data.get('username') or '').strip()
    u = None
    if user_id:
        u = User.query.get(int(user_id))
    elif username:
        u = User.query.filter_by(username=username).first()
    if not u:
        return jsonify({'success': False, 'message': 'Usuario no encontrado'}), 404

    ids = data.get('payment_method_ids')
    if ids is not None and not isinstance(ids, list):
        return jsonify({'success': False, 'message': 'payment_method_ids debe ser una lista'}), 400
    set_user_payment_method_ids(u, ids if isinstance(ids, list) else None)
    return jsonify({
        'success': True,
        'message': 'Restricción de medios de pago guardada para el usuario.',
    })


# ================== CHATBOT RESPUESTAS-PREGUNTAS ==================

_CHATBOT_BLOCKED = frozenset({'soporte', 'soporte1', 'soporte2', 'soporte3'})


def _chatbot_respuestas_user_allowed(user_obj):
    if not user_obj:
        return False
    un = (user_obj.username or '').lower()
    return un not in _CHATBOT_BLOCKED


@store_bp.route('/chatbot-respuestas')
def chatbot_respuestas_page():
    """Asistente para agentes: dudas sobre tienda, licencias, códigos (voz + texto)."""
    if not session.get('logged_in'):
        flash('Debes iniciar sesión.', 'warning')
        return redirect(url_for('user_auth_bp.login'))
    user = User.query.get(session.get('user_id'))
    if not user or not _chatbot_respuestas_user_allowed(user):
        flash('No tienes acceso a esta herramienta.', 'warning')
        return redirect(url_for('main_bp.home'))

    from app.store.chatbot_knowledge import ensure_default_knowledge, list_sources

    ensure_default_knowledge(current_app)
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    is_admin_user = user.username == admin_username
    has_gemini = bool(os.getenv('GEMINI_API_KEY') or current_app.config.get('GEMINI_API_KEY'))
    has_groq = bool(os.getenv('GROQ_API_KEY') or current_app.config.get('GROQ_API_KEY'))

    return render_template(
        'chatbot_respuestas.html',
        current_user=user,
        user_object=user,
        is_admin=is_admin_user,
        knowledge_sources=list_sources(current_app),
        llm_gemini=has_gemini,
        llm_groq=has_groq,
    )


@store_bp.route('/api/chatbot-respuestas/ask', methods=['POST'])
@csrf_exempt_route
def api_chatbot_respuestas_ask():
    if not session.get('logged_in'):
        return jsonify({'success': False, 'message': 'No autenticado'}), 401
    user = User.query.get(session.get('user_id'))
    if not user or not _chatbot_respuestas_user_allowed(user):
        return jsonify({'success': False, 'message': 'Sin acceso'}), 403

    data = request.get_json(silent=True) or {}
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({'success': False, 'message': 'Escribe una pregunta'}), 400
    history = data.get('history') if isinstance(data.get('history'), list) else []

    from app.store.chatbot_knowledge import generate_answer

    try:
        result = generate_answer(current_app, message, history=history)
        return jsonify({'success': True, **result})
    except Exception as e:
        current_app.logger.exception('api_chatbot_respuestas_ask')
        return jsonify({'success': False, 'message': str(e)}), 500


@store_bp.route('/api/chatbot-respuestas/knowledge', methods=['GET', 'POST'])
@csrf_exempt_route
def api_chatbot_respuestas_knowledge():
    if not session.get('logged_in'):
        return jsonify({'success': False, 'message': 'No autenticado'}), 401
    user = User.query.get(session.get('user_id'))
    if not user or not _chatbot_respuestas_user_allowed(user):
        return jsonify({'success': False, 'message': 'Sin acceso'}), 403

    from app.store.chatbot_knowledge import add_source, ensure_default_knowledge, list_sources

    ensure_default_knowledge(current_app)

    if request.method == 'GET':
        return jsonify({'success': True, 'sources': list_sources(current_app)})

    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    if user.username != admin_username:
        return jsonify({'success': False, 'message': 'Solo administradores pueden añadir conocimiento'}), 403

    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    content = (data.get('content') or '').strip()
    youtube_url = (data.get('youtube_url') or '').strip()
    try:
        entry = add_source(
            current_app,
            title or ('Video YouTube' if youtube_url else 'Nota'),
            content,
            source_type='youtube' if youtube_url else 'note',
            meta={'youtube_url': youtube_url} if youtube_url else None,
        )
        return jsonify({'success': True, 'source': entry})
    except ValueError as ve:
        return jsonify({'success': False, 'message': str(ve)}), 400
    except Exception as e:
        current_app.logger.exception('api_chatbot_respuestas_knowledge')
        return jsonify({'success': False, 'message': str(e)}), 500


@store_bp.route('/licencias/actividad')
@user_licencias_precio_required
def user_licencias_actividad_portal():
    """Redirige al historial de licencias integrado en Historial de Compra."""
    return redirect(
        url_for('store_bp.historial_compras_usuario') + '#purchaseHistoryLicenciasSection'
    )


# ================== RUTAS PARA LICENCIAS ==================

def _ensure_license_day_notepads_column():
    """Añade day_notepads_json en SQLite si la tabla ya existía sin esa columna."""
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(db.engine)
        cols = {c['name'] for c in inspector.get_columns('store_licenses')}
        if 'day_notepads_json' not in cols:
            db.session.execute(text('ALTER TABLE store_licenses ADD COLUMN day_notepads_json TEXT'))
            db.session.commit()
    except Exception as e:
        current_app.logger.warning('No se pudo asegurar columna day_notepads_json: %s', e)


def _ensure_license_portal_day_row_notes_column():
    """JSON de notas portal por usuario y línea física del bloc día (no mezcladas con notas admin)."""
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(db.engine)
        cols = {c['name'] for c in inspector.get_columns('store_licenses')}
        if 'portal_day_row_notes_json' not in cols:
            db.session.execute(
                text('ALTER TABLE store_licenses ADD COLUMN portal_day_row_notes_json TEXT')
            )
            db.session.commit()
    except Exception as e:
        current_app.logger.warning('No se pudo asegurar columna portal_day_row_notes_json: %s', e)


def _portal_day_notes_map_for_user(license_row, viewer_user_id):
    import json as _json
    raw = getattr(license_row, 'portal_day_row_notes_json', None) if license_row else None
    raw = raw or ''
    if not str(raw).strip():
        return {}
    try:
        blob = _json.loads(raw)
    except Exception:
        return {}
    if not isinstance(blob, dict):
        return {}
    uid_s = str(int(viewer_user_id))
    inner = blob.get(uid_s)
    if not isinstance(inner, dict):
        return {}
    return {str(k): (v if isinstance(v, str) else (str(v) if v is not None else '')) for k, v in inner.items()}


def _apply_notes_client_to_user_day_rows(rows, license_row, viewer_user_id, calendar_day_int):
    """Añade notes_client a cada fila devuelta por matched_rows_*."""
    if not rows or license_row is None or viewer_user_id is None:
        return
    notes_map = _portal_day_notes_map_for_user(license_row, viewer_user_id)
    cds = str(int(calendar_day_int))
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            pi = int(r.get('phys_line_index', -1))
        except (TypeError, ValueError):
            continue
        key = cds + '_' + str(pi)
        r['notes_client'] = str(notes_map.get(key) or '')


def _persist_user_portal_day_row_note(license_row, viewer_user_id, calendar_day_int, phys_idx, note_text):
    """Guarda una nota cliente para la línea física del día en la licencia (no toca el texto admin)."""
    import json as _json
    if license_row is None or viewer_user_id is None:
        return
    nt = str(note_text or '').strip()
    if len(nt) > 4000:
        nt = nt[:4000]
    uid_s = str(int(viewer_user_id))
    dk = str(int(calendar_day_int)) + '_' + str(int(phys_idx))
    raw = getattr(license_row, 'portal_day_row_notes_json', None) or ''
    blob = {}
    if str(raw).strip():
        try:
            blob = _json.loads(raw)
            if not isinstance(blob, dict):
                blob = {}
        except Exception:
            blob = {}
    if uid_s not in blob or not isinstance(blob.get(uid_s), dict):
        blob[uid_s] = {}
    if nt:
        blob[uid_s][dk] = nt
    else:
        blob[uid_s].pop(dk, None)
        if not blob[uid_s]:
            del blob[uid_s]
    license_row.portal_day_row_notes_json = _json.dumps(blob, ensure_ascii=False) if blob else None


def _ensure_license_warranty_days_column():
    """Añade warranty_days (reserva gar. en cuentas, default 5) si la tabla existía sin esa columna."""
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(db.engine)
        cols = {c['name'] for c in inspector.get_columns('store_licenses')}
        if 'warranty_days' not in cols:
            db.session.execute(
                text('ALTER TABLE store_licenses ADD COLUMN warranty_days INTEGER DEFAULT 5')
            )
            db.session.commit()
    except Exception as e:
        current_app.logger.warning('No se pudo asegurar columna warranty_days: %s', e)


def _ensure_license_expired_notes_and_month_columns():
    """Añade expired_notes y month_to_month en SQLite si la tabla ya existía sin ellas."""
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(db.engine)
        cols = {c['name'] for c in inspector.get_columns('store_licenses')}
        if 'expired_notes' not in cols:
            db.session.execute(text('ALTER TABLE store_licenses ADD COLUMN expired_notes TEXT'))
            db.session.commit()
        cols = {c['name'] for c in inspector.get_columns('store_licenses')}
        if 'month_to_month' not in cols:
            db.session.execute(
                text('ALTER TABLE store_licenses ADD COLUMN month_to_month INTEGER DEFAULT 0 NOT NULL')
            )
            db.session.commit()
    except Exception as e:
        current_app.logger.warning('No se pudo asegurar columnas expired_notes/month_to_month: %s', e)


def _ensure_license_changes_notes_column():
    """Añade changes_notes en SQLite si la tabla ya existía sin esa columna."""
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(db.engine)
        cols = {c['name'] for c in inspector.get_columns('store_licenses')}
        if 'changes_notes' not in cols:
            db.session.execute(text('ALTER TABLE store_licenses ADD COLUMN changes_notes TEXT'))
            db.session.commit()
    except Exception as e:
        current_app.logger.warning('No se pudo asegurar columna changes_notes: %s', e)


def _ensure_license_account_client_notes_column():
    """Añade client_notes en store_license_accounts si la tabla ya existía sin esa columna."""
    try:
        from sqlalchemy import inspect, text

        inspector = inspect(db.engine)
        if 'store_license_accounts' not in inspector.get_table_names():
            return
        cols = {c['name'] for c in inspector.get_columns('store_license_accounts')}
        if 'client_notes' not in cols:
            db.session.execute(text('ALTER TABLE store_license_accounts ADD COLUMN client_notes TEXT'))
            db.session.commit()
    except Exception as e:
        current_app.logger.warning('No se pudo asegurar columna client_notes en cuentas: %s', e)


def _ensure_license_account_sale_id_column():
    """Vincula cuentas entregadas con la fila store_sales (historial + modal de credenciales)."""
    try:
        from sqlalchemy import inspect, text

        inspector = inspect(db.engine)
        if 'store_license_accounts' not in inspector.get_table_names():
            return
        cols = {c['name'] for c in inspector.get_columns('store_license_accounts')}
        if 'sale_id' not in cols:
            dialect = getattr(db.engine.dialect, 'name', '') or ''
            if dialect == 'postgresql':
                db.session.execute(
                    text(
                        'ALTER TABLE store_license_accounts ADD COLUMN sale_id INTEGER '
                        'REFERENCES store_sales(id) ON DELETE SET NULL'
                    )
                )
            else:
                db.session.execute(
                    text('ALTER TABLE store_license_accounts ADD COLUMN sale_id INTEGER')
                )
            db.session.commit()
    except Exception as e:
        current_app.logger.warning('No se pudo asegurar columna sale_id en cuentas: %s', e)


def _ensure_license_account_inventory_bloc_ord_column():
    """Posición de línea en bloc Licencias (inventory_bloc_ord); una unidad por línea física."""
    try:
        from sqlalchemy import inspect, text

        inspector = inspect(db.engine)
        if 'store_license_accounts' not in inspector.get_table_names():
            return
        cols = {c['name'] for c in inspector.get_columns('store_license_accounts')}
        if 'inventory_bloc_ord' not in cols:
            db.session.execute(
                text('ALTER TABLE store_license_accounts ADD COLUMN inventory_bloc_ord INTEGER')
            )
            db.session.commit()
    except Exception as e:
        current_app.logger.warning(
            'No se pudo asegurar columna inventory_bloc_ord en cuentas: %s', e
        )

def _ensure_user_portal_license_activity_log_column():
    """Historial vista Licencias cliente: lista JSON portal_license_activity_log en users."""
    try:
        from sqlalchemy import inspect, text

        inspector = inspect(db.engine)
        dialect = getattr(db.engine.dialect, "name", "") or ""

        tbls = inspector.get_table_names()
        if "users" not in tbls:
            return True
        cols_lower = {c["name"].lower() for c in inspector.get_columns("users")}
        if "portal_license_activity_log" not in cols_lower:
            db.session.execute(
                text("ALTER TABLE users ADD COLUMN portal_license_activity_log TEXT")
            )
            db.session.commit()
        return True
    except Exception as e:
        dialect = getattr(db.engine.dialect, "name", "") or ""
        current_app.logger.warning(
            'No se pudo asegurar columna portal_license_activity_log (%s): %s',
            dialect,
            e,
        )
        return False


_STORE_USER_PORTAL_ACTIVITY_SCHEMA_ENSURED = False
_STORE_LICENSE_ACCOUNT_SALE_ID_SCHEMA_ENSURED = False


@store_bp.before_request
def _store_bp_ensure_portal_license_activity_schema():
    """Asegura columna en PostgreSQL/SQLite antes del primer SELECT a users en rutas tienda."""
    global _STORE_USER_PORTAL_ACTIVITY_SCHEMA_ENSURED
    if _STORE_USER_PORTAL_ACTIVITY_SCHEMA_ENSURED:
        return
    if _ensure_user_portal_license_activity_log_column():
        _STORE_USER_PORTAL_ACTIVITY_SCHEMA_ENSURED = True


@store_bp.before_request
def _store_bp_ensure_license_account_sale_id_schema():
    """Evita 500 en stock/pagos: el modelo ORM incluye sale_id; SQLite debe tener la columna."""
    global _STORE_LICENSE_ACCOUNT_SALE_ID_SCHEMA_ENSURED
    if _STORE_LICENSE_ACCOUNT_SALE_ID_SCHEMA_ENSURED:
        return
    _ensure_license_account_sale_id_column()
    _ensure_license_account_inventory_bloc_ord_column()
    _STORE_LICENSE_ACCOUNT_SALE_ID_SCHEMA_ENSURED = True


def _user_licencias_viewer_scope(user_obj):
    """
    IDs de usuario cuyas cuentas asignadas pueden ver en «Licencias» (principal + padre si aplica).
    Lista de usernames para cruzar con el campo «cliente» en líneas mes a mes.
    """
    ids = [user_obj.id]
    names = [(user_obj.username or '').strip()]
    if getattr(user_obj, 'parent_id', None) and getattr(user_obj, 'can_access_store', False):
        parent = User.query.get(user_obj.parent_id)
        if parent:
            ids.append(parent.id)
            pu = (parent.username or '').strip()
            if pu and pu not in names:
                names.append(pu)
    # únicos preservando orden
    seen = set()
    uids = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            uids.append(i)
    return uids, [n for n in names if n]


def _resolve_portal_assignee_user_id_from_line_username(username_raw):
    """
    Usuario del bloc «Día N» (columna cliente) → id para ``assigned_to_user_id``.
    «anonimo» u otro comodín no asigna (el portal puede cruzar por credencial + anonimo).
    """
    from app.store.user_license_line_parse import normalize_status_key

    un = (username_raw or '').strip()
    if not un or normalize_status_key(un) == 'anonimo':
        return None
    u = User.query.filter(sa_func.lower(User.username) == un.lower()).first()
    if not u:
        u = User.query.filter_by(username=un).first()
    return u.id if u else None


def _apply_portal_assignee_from_line_username(account, username_raw):
    """
    Vincula cuenta inventario al cliente del bloc día (portal/caducidad).
    «anonimo» o desconocido: quita asignación en ventas manuales (sin sale_id de tienda).
    """
    uid = _resolve_portal_assignee_user_id_from_line_username(username_raw)
    if uid:
        account.assigned_to_user_id = uid
        stamp = account.assigned_at or datetime.utcnow()
        if account.expires_at is None:
            account.expires_at = stamp + timedelta(days=30)
        return True
    if getattr(account, 'sale_id', None) is None:
        account.assigned_to_user_id = None
    return False


def _mask_license_cred_preview(identifier: str, email_val: str) -> str:
    ident = str(identifier or '').strip()
    if ident:
        return ident
    em = str(email_val or '').strip()
    if not em or '@' not in em:
        return '—'
    local, _, domain = em.partition('@')
    if len(local) <= 2:
        return f'{local[0]}…@{domain}' if local else f'@{domain}'
    return f'{local[:3]}…@{domain}'


def _license_warranty_days_public(license_row):
    """Reserva «gar.» (# cuentas no vendibles) para API/UI; por defecto 5 si falta o es inválido."""
    v = getattr(license_row, 'warranty_days', None)
    if v is None:
        return 5
    try:
        iv = int(v)
        return iv if iv >= 0 else 5
    except (TypeError, ValueError):
        return 5


def _reject_user_licencias_api(message, code=403):
    resp = jsonify({'success': False, 'error': message})
    _attach_private_no_cache_headers(resp)
    return resp, code


def _portal_colombia_clock_payload():
    """Reloj Colombia para caducidad por día de calendario (1–31) en el portal."""
    import calendar as pycalendar

    co = get_colombia_datetime()
    return {
        'day': int(co.day),
        'days_in_month': pycalendar.monthrange(co.year, co.month)[1],
        'year': int(co.year),
        'month': int(co.month),
    }


def _portal_apply_caducidad_days_on_row(row_dict):
    """Días hasta vencer por día de calendario (mes a mes); sustituye expires_at en el portal."""
    cal_left = None
    linked = row_dict.get('linked_sale_day')
    if linked is not None:
        cal_left = _days_until_calendar_sale_day(linked)
    min_cal = None
    day_lines = row_dict.get('day_lines') or {}
    for d_cal in range(1, 32):
        if day_lines.get(str(d_cal)):
            cleft_row = _days_until_calendar_sale_day(d_cal)
            if cleft_row is not None:
                if min_cal is None or cleft_row < min_cal:
                    min_cal = cleft_row
    if min_cal is not None:
        if cal_left is None or min_cal < cal_left:
            cal_left = min_cal
    if cal_left is not None:
        row_dict['days_until_calendar_sale'] = cal_left
        row_dict['days_until_expiry'] = cal_left
    else:
        row_dict['days_until_calendar_sale'] = None


def _days_until_calendar_sale_day(calendar_day_int, ref_co=None):
    """
    Días hasta la próxima ocurrencia del día N del mes (Colombia).
    Mismo criterio que la renovación automática «mes a mes» por día de calendario.
    """
    import calendar as pycalendar

    co = ref_co or get_colombia_datetime()
    try:
        cal = int(calendar_day_int)
    except (TypeError, ValueError):
        return None
    if cal < 1 or cal > 31:
        return None
    today = int(co.day)
    dim = pycalendar.monthrange(co.year, co.month)[1]
    if cal >= today:
        return cal - today
    return (dim - today) + cal


def _portal_accounts_revision_hash(out_list):
    import hashlib
    import json as _json

    payload = _json.dumps(out_list, sort_keys=True, default=str, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:24]


def _portal_day_row_merge_key(row):
    from app.store.user_license_line_parse import normalize_status_key

    if not isinstance(row, dict):
        return None
    return (
        int(row.get('vinculo_dia') or 0),
        int(row.get('phys_line_index') if row.get('phys_line_index') is not None else -1),
        normalize_status_key(str(row.get('cred') or '')),
    )


def _portal_merge_day_rows_deduped(existing_rows, extra_rows):
    """Evita duplicar la misma línea física del bloc al fusionar filas mes-a-mes."""
    seen = set()
    out = []
    for row in list(existing_rows or []) + list(extra_rows or []):
        k = _portal_day_row_merge_key(row)
        if k is not None:
            if k in seen:
                continue
            seen.add(k)
        out.append(row)
    return out


def _portal_append_virtual_license_bundle(out, lic, day_lines_uo, billing_saldo):
    """Tarjeta virtual cuando no hay cuenta inventario pero sí líneas con nombre de cliente."""
    if not any(day_lines_uo.get(str(dv)) for dv in range(1, 32)):
        return

    pname_v = lic.product.name if lic.product else '—'
    warranty_days_v = _license_warranty_days_public(lic)
    cred_preview_seed = ''
    for d_scan in range(1, 32):
        for row_v in day_lines_uo.get(str(d_scan)) or []:
            cs = str((row_v.get('cred') if isinstance(row_v, dict) else '') or '').strip()
            if cs:
                cred_preview_seed = cs
                break
        if cred_preview_seed:
            break

    img_fn_v = None
    if lic.product:
        try:
            img_fn_v = (lic.product.image_filename or '').strip()
            if img_fn_v.lower() == 'none' or img_fn_v == '':
                img_fn_v = None
        except Exception:
            img_fn_v = None
    if not img_fn_v:
        img_fn_v = 'stream1.png'

    product_image_url_v = ''
    try:
        product_image_url_v = url_for('static', filename='images/' + img_fn_v)
    except Exception:
        product_image_url_v = ''

    out.append(
        {
            'account_id': None,
            'virtual': True,
            'license_id': lic.id,
            'product_id': getattr(lic, 'product_id', None),
            'product_name': pname_v,
            'product_image_filename': img_fn_v,
            'product_image_url': product_image_url_v,
            'credential_preview': _mask_license_cred_preview(cred_preview_seed, '')
            if cred_preview_seed
            else '(mes a mes)',
            'client_notes': '',
            'day_lines': day_lines_uo,
            'linked_sale_day': None,
            'assigned_at_iso': None,
            'expires_at_iso': None,
            'days_until_expiry': None,
            'account_expired': False,
            'warranty_days': warranty_days_v,
            'billing_saldo': billing_saldo,
        }
    )


def _portal_merge_username_only_lines_for_license(out, lic, allowed_names, user_obj, billing_saldo):
    """
    Filas del bloc día con cliente explícito (p. ej. juan41) deben verse en el portal aunque
    ya exista otra cuenta inventario en la misma licencia (antes solo entraban sin cuenta).
    """
    import json as _json
    from app.store.user_license_line_parse import matched_rows_for_username_only_day

    raw_dn = getattr(lic, 'day_notepads_json', None) or ''
    if not str(raw_dn).strip():
        return
    try:
        day_map = _json.loads(raw_dn)
        if not isinstance(day_map, dict):
            day_map = {}
    except Exception:
        day_map = {}

    day_lines_uo = {}
    for d_v in range(1, 32):
        k_v = str(d_v)
        day_text_v = day_map.get(k_v) or ''
        day_lines_uo[k_v] = matched_rows_for_username_only_day(
            day_text_v,
            allowed_names,
            calendar_day=d_v,
        )
        _apply_notes_client_to_user_day_rows(day_lines_uo[k_v], lic, user_obj.id, d_v)

    if not any(day_lines_uo.get(str(dv)) for dv in range(1, 32)):
        return

    targets = [r for r in out if r.get('license_id') == lic.id]
    if targets:
        primary = sorted(
            targets,
            key=lambda r: (1 if r.get('virtual') else 0, r.get('account_id') or 0),
        )[0]
        if not isinstance(primary.get('day_lines'), dict):
            primary['day_lines'] = {}
        claimed_keys = set()
        for r in targets:
            dl = r.get('day_lines') or {}
            for d_v in range(1, 32):
                for row in dl.get(str(d_v)) or []:
                    mk = _portal_day_row_merge_key(row)
                    if mk is not None:
                        claimed_keys.add(mk)
        for d_v in range(1, 32):
            k_v = str(d_v)
            existing = list((primary.get('day_lines') or {}).get(k_v) or [])
            extras = [
                row
                for row in (day_lines_uo.get(k_v) or [])
                if _portal_day_row_merge_key(row) not in claimed_keys
            ]
            primary['day_lines'][k_v] = _portal_merge_day_rows_deduped(existing, extras)
    else:
        _portal_append_virtual_license_bundle(out, lic, day_lines_uo, billing_saldo)


def _day_account_inventory_sync_key(email, identifier):
    em = (email or '').strip().lower()
    if em:
        return f'e:{em}'
    ident = (identifier or '').strip().lower()
    if ident:
        return f'i:{ident}'
    return ''


def _sold_accounts_for_license_month_day(license_id, day_num):
    from app.store.models import LicenseAccount

    out = []
    for acc in LicenseAccount.query.filter_by(license_id=license_id).all():
        st = str(acc.status or '').lower()
        if st not in ('sold', 'assigned'):
            continue
        at = acc.assigned_at
        if at is None:
            continue
        try:
            d = int(utc_to_colombia(at).day)
        except Exception:
            d = int(at.day)
        if d == int(day_num):
            out.append(acc)
    return out


def _sync_license_day_notepad_accounts(license_row, day_num, day_text):
    """Alinea cuentas sold del día con el texto guardado (misma lógica que syncDayNotepad en JS)."""
    from app.store.models import LicenseAccount
    from app.store.user_license_line_parse import parse_admin_license_line_to_split_parts

    try:
        day_i = int(day_num)
    except (TypeError, ValueError):
        return
    if day_i < 1 or day_i > 31:
        return

    product = getattr(license_row, 'product', None)
    if product is None and getattr(license_row, 'product_id', None):
        from app.store.models import Product as _Product

        product = _Product.query.get(license_row.product_id)
    is_nf = _product_name_is_netflix(getattr(product, 'name', None) if product else None)

    parsed_map = {}
    for line in str(day_text or '').replace('\r\n', '\n').split('\n'):
        s = line.strip()
        if not s:
            continue
        dual = parse_admin_license_line_to_split_parts(s)
        tup = _inventory_tuple_from_license_notes_line(s, license_row.id, is_nf)
        if not tup:
            continue
        email, password, identifier = tup
        email = (email or '').strip().lower()[:120]
        password = (password or '')[:200]
        identifier = (identifier or '')[:200]
        if not password or not identifier:
            continue
        sync_key = _day_account_inventory_sync_key(email, identifier)
        if not sync_key:
            continue
        parsed_map[sync_key] = {
            'email': email,
            'password': password,
            'identifier': identifier,
            'assign_username': str(dual.get('user') or '').strip(),
        }

    existing = _sold_accounts_for_license_month_day(license_row.id, day_i)
    by_key = {_day_account_inventory_sync_key(a.email, a.account_identifier): a for a in existing}

    if not str(day_text or '').strip():
        for acc in existing:
            if getattr(acc, 'sale_id', None) is None:
                db.session.delete(acc)
        return

    for acc in existing:
        k = _day_account_inventory_sync_key(acc.email, acc.account_identifier)
        if k not in parsed_map and getattr(acc, 'sale_id', None) is None:
            db.session.delete(acc)

    col_now = get_colombia_datetime()
    sale_local = col_now.replace(day=day_i, hour=12, minute=0, second=0, microsecond=0)
    if sale_local.tzinfo is not None:
        assigned_at = sale_local.astimezone(timezone.utc).replace(tzinfo=None)
    else:
        assigned_at = sale_local

    for sync_key, p in parsed_map.items():
        match = by_key.get(sync_key)
        if match:
            if (match.email or '').lower() != p['email']:
                match.email = p['email']
            if match.password != p['password']:
                match.password = p['password']
            if match.account_identifier != p['identifier']:
                match.account_identifier = p['identifier']
            if match.assigned_at is None:
                match.assigned_at = assigned_at
            if str(match.status or '').lower() not in ('sold', 'assigned'):
                match.status = 'sold'
            _apply_portal_assignee_from_line_username(match, p['assign_username'])
            continue

        acc = LicenseAccount(
            license_id=license_row.id,
            account_identifier=p['identifier'],
            email=p['email'],
            password=p['password'],
            status='sold',
            assigned_at=assigned_at,
            expires_at=assigned_at + timedelta(days=30),
        )
        db.session.add(acc)
        db.session.flush()
        _apply_portal_assignee_from_line_username(acc, p['assign_username'])


def _user_my_license_accounts_list_for_portal(user_obj):
    """Misma lista que expone GET my-license-accounts (cuentas + virtuales)."""
    from app.store.models import License, LicenseAccount
    import json as _json
    from app.store.user_license_line_parse import matched_rows_for_account_day, matched_rows_for_username_only_day

    assignee_ids, allowed_names = _user_licencias_viewer_scope(user_obj)
    if not assignee_ids:
        return []

    billing_user = user_obj
    if user_obj.parent_id:
        pu_b = User.query.get(user_obj.parent_id)
        if pu_b:
            billing_user = pu_b
    try:
        billing_saldo = float(getattr(billing_user, 'saldo', 0) or 0)
    except (TypeError, ValueError):
        billing_saldo = 0.0

    accts = (
        LicenseAccount.query.options(
            joinedload(LicenseAccount.license).joinedload(License.product),
        )
        .filter(LicenseAccount.assigned_to_user_id.in_(assignee_ids))
        .filter(
            or_(
                sa_func.lower(sa_func.coalesce(LicenseAccount.status, '')).in_(('assigned', 'sold')),
                LicenseAccount.status.is_(None),
            )
        )
        .order_by(LicenseAccount.id.asc())
        .all()
    )

    # Drift: doble sync admin (PUT + JS) pudo crear dos cuentas sold iguales el mismo día.
    seen_acct_keys = set()
    accts_deduped = []
    for acc in accts:
        at = acc.assigned_at
        sale_day = 0
        if at is not None:
            try:
                sale_day = int(utc_to_colombia(at).day)
            except Exception:
                sale_day = int(at.day)
        ak = (
            acc.license_id,
            _day_account_inventory_sync_key(acc.email, acc.account_identifier),
            sale_day,
        )
        if ak in seen_acct_keys:
            continue
        seen_acct_keys.add(ak)
        accts_deduped.append(acc)
    accts = accts_deduped

    assigned_license_ids = set()
    for acc in accts:
        lid_a = getattr(acc, 'license_id', None)
        if lid_a is not None:
            assigned_license_ids.add(lid_a)

    out = []
    consumed_day_lines = set()
    for acc in accts:
        lic = acc.license
        cn = getattr(acc, 'client_notes', None) or ''
        at = getattr(acc, 'assigned_at', None)
        linked_sale_day = None
        if at is not None:
            try:
                linked_sale_day = int(utc_to_colombia(at).day)
            except Exception:
                linked_sale_day = int(at.day)
        exp_at = getattr(acc, 'expires_at', None)
        try:
            days_left = acc.days_until_expiry
        except Exception:
            days_left = None
        lic_id_eff = getattr(acc, 'license_id', None)
        prod_id_eff = None
        raw_dn = ''
        pname = 'Cuenta sin licencia vinculada'
        warranty_days_pub = _license_warranty_days_public(None)

        if lic:
            warranty_days_pub = _license_warranty_days_public(lic)
            lic_id_eff = lic.id
            prod_id_eff = getattr(lic, 'product_id', None)
            raw_dn = getattr(lic, 'day_notepads_json', None) or ''
            pname = lic.product.name if lic.product else '—'

        day_map = {}
        if str(raw_dn).strip():
            try:
                day_map = _json.loads(raw_dn)
                if not isinstance(day_map, dict):
                    day_map = {}
            except Exception:
                day_map = {}
        day_lines = {}
        for d in range(1, 32):
            k = str(d)
            day_text = day_map.get(k) or ''
            day_lines[k] = matched_rows_for_account_day(
                day_text,
                allowed_names,
                acc.email or '',
                acc.account_identifier or '',
                calendar_day=d,
                license_id=lic_id_eff,
                consumed_lines=consumed_day_lines,
            )
            _apply_notes_client_to_user_day_rows(day_lines[k], lic, user_obj.id, d)

        img_fn = None
        if lic and lic.product:
            try:
                img_fn = (lic.product.image_filename or '').strip()
                if img_fn.lower() == 'none' or img_fn == '':
                    img_fn = None
            except Exception:
                img_fn = None
        if not img_fn:
            img_fn = 'stream1.png'

        product_image_url = ''
        try:
            product_image_url = url_for('static', filename='images/' + img_fn)
        except Exception:
            product_image_url = ''

        out.append({
            'account_id': acc.id,
            'license_id': lic_id_eff,
            'product_id': prod_id_eff,
            'product_name': pname,
            'product_image_filename': img_fn,
            'product_image_url': product_image_url,
            'credential_preview': _mask_license_cred_preview(acc.account_identifier, acc.email),
            'client_notes': cn,
            'day_lines': day_lines,
            'linked_sale_day': linked_sale_day,
            'assigned_at_iso': at.isoformat() if at is not None else None,
            'expires_at_iso': exp_at.isoformat() if exp_at is not None else None,
            'days_until_expiry': days_left,
            'days_until_calendar_sale': None,
            'account_expired': bool(acc.is_expired),
            'warranty_days': warranty_days_pub,
            'billing_saldo': billing_saldo,
        })

    cand_lics = (
        License.query.options(joinedload(License.product))
        .filter(License.enabled == True)
        .filter(License.day_notepads_json.isnot(None))
        .all()
    )
    for lic in cand_lics:
        _portal_merge_username_only_lines_for_license(
            out, lic, allowed_names, user_obj, billing_saldo
        )

    out.sort(
        key=lambda r: (
            str(r['product_name']).lower(),
            r['license_id'] or 0,
            (0, int(r['account_id'])) if r.get('account_id') is not None else (1, 0),
        )
    )
    for row_cad in out:
        _portal_apply_caducidad_days_on_row(row_cad)
    return out


@store_bp.route('/api/user/my-license-accounts', methods=['GET'])
@csrf_exempt_route
def api_user_my_license_accounts():
    """Cuentas inventario asignadas + filas «mes a mes» donde el nombre cliente coincide (sin venta tienda)."""
    try:

        if not session.get('logged_in'):
            return _reject_user_licencias_api('Debes iniciar sesión.', 401)
        user_obj = User.query.get(session.get('user_id'))
        if not user_obj:
            return _reject_user_licencias_api('Usuario no encontrado.', 403)
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        if user_obj.username == admin_username:
            return _reject_user_licencias_api('Los administradores usan Admin Licencias.', 403)

        blocked_users = ['soporte', 'soporte1', 'soporte2', 'soporte3']
        if user_obj.username.lower() in blocked_users:
            return _reject_user_licencias_api('No tienes permiso.', 403)
        soporte_nav = bool(_user_store_soporte_licencias_flag(user_obj))
        # Misma política que la página user_licencias
        if user_obj.parent_id is not None:
            if not user_obj.can_access_store:
                return _reject_user_licencias_api('Sin acceso.', 403)
            pu = User.query.get(user_obj.parent_id)
            if not pu:
                return _reject_user_licencias_api('Usuario principal no encontrado.', 403)
        if not _eligible_tienda_user_licencias_portal(user_obj):
            return _reject_user_licencias_api(
                'Necesitas tipo de precio USD o COP o permiso de soporte licencias.',
                403,
            )

        _ensure_license_day_notepads_column()
        _ensure_license_portal_day_row_notes_column()
        _ensure_license_account_client_notes_column()
        _ensure_license_warranty_days_column()
        _ensure_license_expired_notes_and_month_columns()
        _ensure_license_changes_notes_column()

        db.session.expire_all()

        out = _user_my_license_accounts_list_for_portal(user_obj)
        portal_rev = _portal_accounts_revision_hash(out)
        billing_for_warnings = user_obj
        if user_obj.parent_id:
            pu_w = User.query.get(user_obj.parent_id)
            if pu_w:
                billing_for_warnings = pu_w
        renewal_warnings = _portal_renewal_balance_warnings_for_accounts(
            billing_for_warnings, out
        )
        ok = jsonify(
            {
                'success': True,
                'accounts': out,
                'soporte_licencias': soporte_nav,
                'portal_rev': portal_rev,
                'portal_colombia_clock': _portal_colombia_clock_payload(),
                'renewal_balance_warnings': renewal_warnings,
            }
        )
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        current_app.logger.exception('api_user_my_license_accounts')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/user/my-license-portal-rev', methods=['GET'])
@csrf_exempt_route
def api_user_my_license_portal_rev():
    """Hash de la misma vista que my-license-accounts para sondeo sin descargar todo el JSON."""
    try:
        if not session.get('logged_in'):
            return _reject_user_licencias_api('Debes iniciar sesión.', 401)
        user_obj = User.query.get(session.get('user_id'))
        if not user_obj:
            return _reject_user_licencias_api('Usuario no encontrado.', 403)
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        if user_obj.username == admin_username:
            return _reject_user_licencias_api('Los administradores usan Admin Licencias.', 403)

        blocked_users = ['soporte', 'soporte1', 'soporte2', 'soporte3']
        if user_obj.username.lower() in blocked_users:
            return _reject_user_licencias_api('No tienes permiso.', 403)
        if user_obj.parent_id is not None:
            if not user_obj.can_access_store:
                return _reject_user_licencias_api('Sin acceso.', 403)
            pu = User.query.get(user_obj.parent_id)
            if not pu:
                return _reject_user_licencias_api('Usuario principal no encontrado.', 403)
        if not _eligible_tienda_user_licencias_portal(user_obj):
            return _reject_user_licencias_api(
                'Necesitas tipo de precio USD o COP o permiso de soporte licencias.',
                403,
            )

        _ensure_license_day_notepads_column()
        _ensure_license_portal_day_row_notes_column()
        _ensure_license_account_client_notes_column()
        _ensure_license_warranty_days_column()
        _ensure_license_expired_notes_and_month_columns()
        _ensure_license_changes_notes_column()

        db.session.expire_all()

        out = _user_my_license_accounts_list_for_portal(user_obj)
        portal_rev = _portal_accounts_revision_hash(out)
        ok = jsonify({'success': True, 'portal_rev': portal_rev})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        current_app.logger.exception('api_user_my_license_portal_rev')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/user/license-account/<int:account_id>/client-notes', methods=['PUT'])
@csrf_exempt_route
def api_user_license_account_client_notes(account_id):
    """Persistir notas privadas del cliente solo para esa cuenta."""
    try:
        from app.store.models import LicenseAccount

        if not session.get('logged_in'):
            return _reject_user_licencias_api('Debes iniciar sesión.', 401)
        user_obj = User.query.get(session.get('user_id'))
        if not user_obj:
            return _reject_user_licencias_api('Usuario no encontrado.', 403)
        assignee_ids, _ = _user_licencias_viewer_scope(user_obj)

        account = LicenseAccount.query.get(account_id)
        if not account or account.assigned_to_user_id not in assignee_ids:
            return _reject_user_licencias_api('Cuenta no encontrada o no disponible.', 404)

        _ensure_license_account_client_notes_column()

        data = request.get_json(silent=True) or {}
        notes_raw = data.get('client_notes', '')
        if notes_raw is None:
            notes_raw = ''
        notes = str(notes_raw).strip()
        if len(notes) > 8000:
            notes = notes[:8000]
        account.client_notes = notes if notes else None
        db.session.commit()
        return jsonify({'success': True, 'client_notes': account.client_notes or ''})
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_user_license_account_client_notes')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/user/license-day-row-status', methods=['PUT'])
@csrf_exempt_route
def api_user_license_day_row_status():
    """
    Persistir estados favorable (columna verde) e incidencia (columna roja) para una línea del bloc
    «Días» que el cliente ya puede ver por cuenta inventario o nombre vinculado.
    """
    try:
        from app.store.models import License, LicenseAccount
        import json as _json
        from sqlalchemy import or_
        from sqlalchemy.sql import func as sa_sql_func
        from app.store.user_license_line_parse import (
            collect_visible_day_line_targets_assigned,
            collect_visible_day_line_targets_username_only,
            dual_to_storage_line,
            rebuild_day_notepad_lines_with_physical_index,
            apply_portal_user_status_update,
            normalize_status_key,
        )

        if not session.get('logged_in'):
            return _reject_user_licencias_api('Debes iniciar sesión.', 401)
        user_obj = User.query.get(session.get('user_id'))
        if not user_obj:
            return _reject_user_licencias_api('Usuario no encontrado.', 403)
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        if user_obj.username == admin_username:
            return _reject_user_licencias_api('Los administradores usan Admin Licencias.', 403)
        blocked_users = ['soporte', 'soporte1', 'soporte2', 'soporte3']
        if user_obj.username.lower() in blocked_users:
            return _reject_user_licencias_api('No tienes permiso.', 403)
        if user_obj.parent_id is not None:
            if not user_obj.can_access_store:
                return _reject_user_licencias_api('Sin acceso.', 403)
            pu = User.query.get(user_obj.parent_id)
            if not pu:
                return _reject_user_licencias_api('Usuario principal no encontrado.', 403)
        if not _eligible_tienda_user_licencias_portal(user_obj):
            return _reject_user_licencias_api(
                'Necesitas tipo de precio USD o COP o permiso de soporte licencias.',
                403,
            )

        assignee_ids, allowed_names = _user_licencias_viewer_scope(user_obj)
        if not assignee_ids:
            return _reject_user_licencias_api('Sin acceso.', 403)

        data = request.get_json(silent=True) or {}

        account_id_sel = None
        ap_raw = data.get('account_id')
        if ap_raw is not None and str(ap_raw).strip() != '':
            try:
                account_id_sel = int(ap_raw)
            except (TypeError, ValueError):
                return jsonify({'success': False, 'error': 'Cuenta inválida.'}), 400

        try:
            license_id_int = int(data.get('license_id'))
            calendar_day_int = int(data.get('calendar_day'))
            row_ordinal = int(data.get('row_ordinal'))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Parámetros incompletos o inválidos.'}), 400

        if calendar_day_int < 1 or calendar_day_int > 31:
            return jsonify({'success': False, 'error': 'Día del calendario inválido.'}), 400

        _ensure_license_day_notepads_column()
        _ensure_license_portal_day_row_notes_column()

        license_row = License.query.get(license_id_int)
        if not license_row:
            return jsonify({'success': False, 'error': 'Licencia no encontrada.'}), 404

        day_map = {}
        raw_dn = getattr(license_row, 'day_notepads_json', None)
        if raw_dn and str(raw_dn).strip():
            try:
                day_map = _json.loads(raw_dn)
                if not isinstance(day_map, dict):
                    day_map = {}
            except Exception:
                day_map = {}

        dk = str(calendar_day_int)
        day_text = day_map.get(dk)
        day_text_s = '' if day_text is None else str(day_text)

        assigned_any_here = (
            LicenseAccount.query.filter(
                LicenseAccount.license_id == license_row.id,
                LicenseAccount.assigned_to_user_id.in_(assignee_ids),
                or_(
                    sa_sql_func.lower(sa_sql_func.coalesce(LicenseAccount.status, '')).in_(('assigned', 'sold')),
                    LicenseAccount.status.is_(None),
                ),
            ).first()
            is not None
        )

        account = None
        if account_id_sel is not None:
            account = LicenseAccount.query.get(account_id_sel)
            if not account or account.assigned_to_user_id not in assignee_ids:
                return _reject_user_licencias_api('Cuenta no encontrada o no disponible.', 404)
            if account.license_id != license_row.id:
                return jsonify({'success': False, 'error': 'La cuenta no coincide con la licencia.'}), 400
            raw_lines, visible = collect_visible_day_line_targets_assigned(
                day_text_s,
                allowed_names,
                str(account.email or ''),
                str(account.account_identifier or ''),
            )
        else:
            if assigned_any_here:
                return jsonify(
                    {
                        'success': False,
                        'error': 'Debes usar la ficha de la cuenta inventario para cambiar estos estados.',
                    },
                    403,
                )
            raw_lines, visible = collect_visible_day_line_targets_username_only(day_text_s, allowed_names)

        if row_ordinal < 0 or row_ordinal >= len(visible):
            return jsonify({'success': False, 'error': 'No se encontró la fila (actualiza la página).'}), 409

        phys_idx, _orig_ln, dual_base = visible[row_ordinal]

        revert_buena = bool(data.get('revert_buena_revisada'))
        preserve_buena = bool(data.get('preserve_buena_revisada'))
        try:
            if preserve_buena and normalize_status_key(
                str(dual_base.get('statusGood') or '')
            ) == 'ok':
                from app.store.user_license_line_parse import _prev_good_restore_from_dual

                canon_good = 'ok'
                canon_sb = ''
                otro_use = ''
                dual_base = dict(dual_base)
                dual_base['prevGoodRestore'] = _prev_good_restore_from_dual(dual_base)
            else:
                status_good_in = data.get('status_good') if 'status_good' in data else None
                canon_good, canon_sb, otro_use = apply_portal_user_status_update(
                    dual_base,
                    status_good_in,
                    data.get('status_bad'),
                    data.get('otro_detail'),
                    revert_buena_revisada=revert_buena,
                    status_good_omitted='status_good' not in data,
                )
        except ValueError as verr:
            return jsonify({'success': False, 'error': str(verr)}), 400

        if 'client_note' in data:
            _persist_user_portal_day_row_note(
                license_row,
                user_obj.id,
                calendar_day_int,
                int(phys_idx),
                data.get('client_note'),
            )

        merged_dual = dict(dual_base)
        merged_dual['statusGood'] = canon_good
        merged_dual['statusBad'] = canon_sb
        merged_dual['otroDetail'] = otro_use
        from app.store.user_license_line_parse import (
            _prev_good_restore_from_dual,
            portal_green_embed_in_extra,
            portal_strip_bad_from_extra,
            resolve_portal_green_select_value,
        )

        if normalize_status_key(str(canon_good or '')) == 'ok':
            merged_dual['prevGoodRestore'] = _prev_good_restore_from_dual(merged_dual)
            green_emb = resolve_portal_green_select_value(merged_dual) or merged_dual.get(
                'prevGoodRestore'
            )
            merged_dual['extra'] = portal_green_embed_in_extra(
                merged_dual.get('extra'), green_emb
            )
        elif canon_good:
            from app.store.user_license_line_parse import user_visible_notes_from_extra

            extra_clean = portal_strip_bad_from_extra(str(merged_dual.get('extra') or ''))
            merged_dual['extra'] = user_visible_notes_from_extra(extra_clean)
        if revert_buena and normalize_status_key(str(canon_good or '')) != 'ok':
            from app.store.user_license_line_parse import portal_strip_bad_from_extra as _strip_bad_ex

            merged_dual['extra'] = _strip_bad_ex(str(merged_dual.get('extra') or ''))

        new_line = dual_to_storage_line(merged_dual)
        new_day_text = rebuild_day_notepad_lines_with_physical_index(raw_lines, phys_idx, new_line)

        if str(new_day_text).strip():
            day_map[dk] = new_day_text
        else:
            day_map.pop(dk, None)

        license_row.day_notepads_json = _json.dumps(day_map, ensure_ascii=False)

        texts_for_sync = [
            license_row.license_notes or '',
            getattr(license_row, 'suspended_notes', None) or '',
            getattr(license_row, 'expired_notes', None) or '',
            getattr(license_row, 'changes_notes', None) or '',
        ]
        raw_day_sy = getattr(license_row, 'day_notepads_json', None)
        if raw_day_sy and str(raw_day_sy).strip():
            try:
                dm_sy = _json.loads(raw_day_sy)
                if isinstance(dm_sy, dict):
                    for v_sy in dm_sy.values():
                        if v_sy:
                            texts_for_sync.append(str(v_sy))
            except Exception:
                pass
        _sync_allowed_emails_from_license_admin_texts(texts_for_sync)

        try:
            _ensure_user_portal_license_activity_log_column()
            from app.store.user_license_activity import portal_log_status_changes

            lic_prod = getattr(license_row, 'product', None)
            pname_ctx = lic_prod.name if lic_prod else 'Producto'
            cred_hint_val = ''
            if account is not None:
                cred_hint_val = _mask_license_cred_preview(
                    getattr(account, 'account_identifier', None),
                    getattr(account, 'email', None),
                )
            else:
                cred_hint_val = str(dual_base.get('cred') or '').strip().replace('\n', ' ')[:140]

            portal_log_status_changes(
                viewer_user_row=user_obj,
                product_name=pname_ctx or 'Producto',
                calendar_day=calendar_day_int,
                dual_base=dual_base,
                canon_good=canon_good or '',
                canon_sb=canon_sb or '',
                otro_use=otro_use or '',
                license_id=int(license_row.id),
                row_ordinal=int(row_ordinal),
                account_id=int(account_id_sel) if account_id_sel is not None else None,
                cred_hint=cred_hint_val or '',
            )
        except Exception as act_err:
            current_app.logger.warning('portal_log_status_changes omitido: %s', act_err)

        db.session.commit()
        from app.store.user_license_line_parse import _prev_good_restore_from_dual as _prev_good_restore_resp

        from app.store.user_license_line_parse import resolve_portal_green_select_value as _green_sel_resp

        prev_for_resp = ''
        green_sel_resp = ''
        if normalize_status_key(str(canon_good or '')) == 'ok':
            prev_for_resp = _prev_good_restore_resp(merged_dual)
            green_sel_resp = _green_sel_resp(merged_dual) or prev_for_resp
        elif canon_good:
            green_sel_resp = _green_sel_resp(merged_dual) or str(canon_good or '')
        return jsonify(
            {
                'success': True,
                'status_good': canon_good or '',
                'status_bad': canon_sb or '',
                'otro_detail': otro_use or '',
                'prev_good_restore': prev_for_resp,
                'green_select_value': green_sel_resp,
            }
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_user_license_day_row_status')
        return jsonify({'success': False, 'error': str(e)}), 500


_PORTAL_BLOCKED_USERNAMES_F = frozenset({'soporte', 'soporte1', 'soporte2', 'soporte3'})


def _portal_activity_users_for_client_username(username_raw):
    ul = str(username_raw or '').strip()
    if not ul:
        return []
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    ul_l = ul.lower()
    if ul_l == 'anonimo':
        return []
    if ul_l in _PORTAL_BLOCKED_USERNAMES_F:
        return []

    cand = (
        User.query.filter(User.username != admin_username, sa_func.lower(User.username) == ul_l)
        .first()
    )
    if not cand:
        return []
    principal = cand
    if cand.parent_id is not None:
        pu = User.query.get(cand.parent_id)
        if pu is not None:
            principal = pu

    ids = {principal.id}
    for su in User.query.filter(User.parent_id == principal.id).all():
        ids.add(su.id)
    return User.query.filter(User.id.in_(list(ids))).order_by(User.id.asc()).all()


@store_bp.route('/api/user/license-warranty-incidents', methods=['GET'])
@csrf_exempt_route
def api_user_license_warranty_incidents():
    """Historial (6 meses) de caída + garantía para una fila del portal (modal)."""
    try:
        from app.store.user_license_activity import list_warranty_related_incidents

        if not session.get('logged_in'):
            return _reject_user_licencias_api('Debes iniciar sesión.', 401)
        user_obj = User.query.get(session.get('user_id'))
        if not user_obj:
            return _reject_user_licencias_api('Usuario no encontrado.', 403)
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        if user_obj.username == admin_username:
            return _reject_user_licencias_api('Los administradores usan Admin Licencias.', 403)
        blocked_users = ['soporte', 'soporte1', 'soporte2', 'soporte3']
        if user_obj.username.lower() in blocked_users:
            return _reject_user_licencias_api('No tienes permiso.', 403)
        if user_obj.parent_id is not None:
            if not user_obj.can_access_store:
                return _reject_user_licencias_api('Sin acceso.', 403)
            pu = User.query.get(user_obj.parent_id)
            if not pu:
                return _reject_user_licencias_api('Usuario principal no encontrado.', 403)
        if not _eligible_tienda_user_licencias_portal(user_obj):
            return _reject_user_licencias_api(
                'Necesitas tipo de precio USD o COP o permiso de soporte licencias.',
                403,
            )

        assignee_ids, _ = _user_licencias_viewer_scope(user_obj)
        if not assignee_ids:
            return _reject_user_licencias_api('Sin acceso.', 403)

        try:
            license_id_q = int(request.args.get('license_id'))
            calendar_day_q = int(request.args.get('calendar_day'))
            row_ordinal_q = int(request.args.get('row_ordinal'))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Parámetros incompletos.'}), 400

        account_raw = request.args.get('account_id')
        account_id_q = None
        if account_raw is not None and str(account_raw).strip() != '':
            try:
                account_id_q = int(account_raw)
            except (TypeError, ValueError):
                account_id_q = None

        _ensure_user_portal_license_activity_log_column()
        incidents = list_warranty_related_incidents(
            user_obj,
            license_id_q,
            calendar_day_q,
            row_ordinal_q,
            account_id_q,
            utc_to_colombia_fn=utc_to_colombia,
        )
        return jsonify({'success': True, 'incidents': incidents})
    except Exception as e:
        current_app.logger.exception('api_user_license_warranty_incidents')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/admin/license-warranty-incidents', methods=['GET'])
@admin_or_soporte_licencias_required
def api_admin_license_warranty_incidents():
    """Historial caídas/garantías para una fila (admin): une logs del titular y subusuarios."""
    try:
        from app.store.user_license_activity import merged_portal_warranty_incidents_for_users

        try:
            license_id_q = int(request.args.get('license_id'))
            calendar_day_q = int(request.args.get('calendar_day'))
            row_ordinal_q = int(request.args.get('row_ordinal'))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Parámetros incompletos.'}), 400

        account_raw = request.args.get('account_id')
        account_id_q = None
        if account_raw is not None and str(account_raw).strip() != '':
            try:
                account_id_q = int(account_raw)
            except (TypeError, ValueError):
                account_id_q = None

        client_username = (request.args.get('client_username') or '').strip()
        users = _portal_activity_users_for_client_username(client_username)
        if not users:
            return jsonify({'success': True, 'incidents': []})

        _ensure_user_portal_license_activity_log_column()
        incidents = merged_portal_warranty_incidents_for_users(
            users,
            license_id_q,
            calendar_day_q,
            row_ordinal_q,
            account_id_q,
            utc_to_colombia_fn=utc_to_colombia,
        )
        return jsonify({'success': True, 'incidents': incidents})
    except Exception as e:
        current_app.logger.exception('api_admin_license_warranty_incidents')
        return jsonify({'success': False, 'error': str(e)}), 500


def _assigned_usernames_map_for_accounts(accounts_iter):
    """Mapa id de usuario → username para serializar cuentas de licencias."""
    from app.models.user import User

    uids = {
        int(a.assigned_to_user_id)
        for a in accounts_iter
        if getattr(a, 'assigned_to_user_id', None)
    }
    if not uids:
        return {}
    rows = User.query.filter(User.id.in_(uids)).all()
    return {
        int(u.id): (u.username or '').strip()
        for u in rows
        if u and (u.username or '').strip()
    }


@store_bp.route('/api/licenses')
@admin_or_soporte_licencias_required
def api_get_licenses():
    """Obtener todas las licencias con sus cuentas"""
    try:
        from app.store.models import License, LicenseAccount, Product
        import json as _json

        db.session.expire_all()

        _ensure_license_day_notepads_column()
        _ensure_license_portal_day_row_notes_column()
        _ensure_license_account_client_notes_column()
        _ensure_license_account_renewal_reserve_columns()
        _ensure_license_warranty_days_column()
        _ensure_license_expired_notes_and_month_columns()
        _ensure_license_changes_notes_column()

        # Todas las licencias (incluso si el producto fue eliminado). Antes: .join(Product) excluía filas huérfanas.
        licenses = License.query.options(
            joinedload(License.product), selectinload(License.accounts)
        ).all()

        # Autocura: texto en license_notes pero 0 cuentas available suele venir de drift o guardados
        # que no alcanzaron a sincronizar; al abrir Admin se alinea igual que PUT license_notes.
        heal_commit = False
        for lic_row in licenses:
            if not getattr(lic_row, 'enabled', True):
                continue
            note_raw = getattr(lic_row, 'license_notes', None) or ''
            lc = _count_inventory_lines_from_license_notes(note_raw)
            if lc <= 0:
                continue
            if (
                LicenseAccount.query.filter_by(license_id=lic_row.id, status='available').count()
                != 0
            ):
                continue
            inv_res = _sync_inventory_accounts_from_license_notes(lic_row)
            if (
                inv_res['created']
                or inv_res['updated']
                or inv_res['removed']
            ):
                heal_commit = True
        if heal_commit:
            db.session.commit()
            licenses = License.query.options(
                joinedload(License.product), selectinload(License.accounts)
            ).all()
        
        all_license_accounts = []
        for license in licenses:
            all_license_accounts.extend(license.accounts or [])
        assigned_username_map = _assigned_usernames_map_for_accounts(all_license_accounts)

        licenses_data = []
        for license in licenses:
            day_map = {}
            raw = getattr(license, 'day_notepads_json', None)
            if raw and str(raw).strip():
                try:
                    day_map = _json.loads(raw)
                    if not isinstance(day_map, dict):
                        day_map = {}
                except Exception:
                    day_map = {}
            license_notes_val = license.license_notes or ''
            suspended_notes_val = getattr(license, 'suspended_notes', None) or ''
            expired_notes_val = getattr(license, 'expired_notes', None) or ''
            changes_notes_val = getattr(license, 'changes_notes', None) or ''
            personal_notes_val = license.personal_notes or ''
            m2m = bool(getattr(license, 'month_to_month', False))
            license_data = {
                'id': license.id,
                'product_id': license.product_id,
                'product_name': license.product.name if license.product else 'Producto eliminado',
                'position': license.position,
                'warranty_days': _license_warranty_days_public(license),
                'enabled': license.enabled,
                'created_at': _store_dt_iso_utc_z(license.created_at),
                'personal_notes': personal_notes_val,
                'license_notes': license_notes_val,
                'suspended_notes': suspended_notes_val,
                'expired_notes': expired_notes_val,
                'changes_notes': changes_notes_val,
                'month_to_month': m2m,
                'day_notepads': day_map,
                'accounts': []
            }
            
            # Agregar cuentas de la licencia
            for account in license.accounts:
                uid = account.assigned_to_user_id
                account_data = {
                    'id': account.id,
                    'account_identifier': account.account_identifier,
                    'email': account.email,
                    'password': account.password,
                    'status': account.status,
                    'assigned_to_user_id': uid,
                    'assigned_username': assigned_username_map.get(int(uid)) if uid else None,
                    'assigned_at': _store_dt_iso_utc_z(account.assigned_at),
                    'expires_at': _store_dt_iso_utc_z(account.expires_at),
                    'is_expired': account.is_expired,
                    'days_until_expiry': account.days_until_expiry
                }
                license_data['accounts'].append(account_data)
            
            licenses_data.append(license_data)
        ok = jsonify({'success': True, 'licenses': licenses_data})
        _attach_private_no_cache_headers(ok)
        return ok

    except Exception as e:
        current_app.logger.exception('api_get_licenses')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/users/usernames')
@admin_or_soporte_licencias_required
def api_store_user_usernames():
    """Lista parcial de usuarios (principal) para autocompletado en bloc Licencias."""
    try:
        q = (request.args.get('q') or '').strip()
        try:
            limit = int(request.args.get('limit', 30))
        except (TypeError, ValueError):
            limit = 30
        limit = max(1, min(limit, 100))
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        users_query = User.query.filter(User.username != admin_username, User.parent_id.is_(None))
        if q:
            users_query = users_query.filter(User.username.ilike(f'%{q}%'))
        users_query = users_query.order_by(User.username.asc()).limit(limit)
        names = [u.username for u in users_query.all()]
        return jsonify({'success': True, 'usernames': names})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/users/exists')
@admin_or_soporte_licencias_required
def api_store_user_exists():
    """Comprueba si el texto del campo cliente coincide con un usuario. «anonimo» y vacío son válidos."""
    try:
        from sqlalchemy import func

        raw = (request.args.get('username') or '').strip()
        if not raw:
            return jsonify({'success': True, 'exists': True})
        if raw.lower() == 'anonimo':
            return jsonify({'success': True, 'exists': True})
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        found = User.query.filter(
            User.username != admin_username,
            User.parent_id.is_(None),
            func.lower(User.username) == raw.lower(),
        ).first()
        return jsonify({'success': True, 'exists': found is not None})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def _index_of_legacy_double_slash(s, start=0):
    """Primer '//' que no forma parte de :// (p. ej. https://), alineado con licencias.js."""
    t = s or ''
    pos = start or 0
    while pos < len(t):
        i = t.find('//', pos)
        if i == -1:
            return -1
        if i == 0 or t[i - 1] != ':':
            return i
        pos = i + 2
    return -1


def _split_line_cred_notes_user_admin(line):
    """Credencial, cliente y resto: separador \\x1f (nuevo) o legado // como en splitLineCredNotesUser (JS)."""
    t = (line or '').strip()
    if not t:
        return '', '', ''
    sep = '\x1f'
    if sep in t:
        parts = t.split(sep)
        cred = (parts[0] or '').strip()
        client = (parts[1] or '').strip() if len(parts) > 1 else ''
        status = (parts[2] or '').strip() if len(parts) > 2 else ''
        return cred, client, status
    i1 = _index_of_legacy_double_slash(t, 0)
    if i1 == -1:
        return t, '', ''
    cred = t[:i1].strip()
    after1 = t[i1 + 2 :]
    i2 = _index_of_legacy_double_slash(after1, 0)
    if i2 == -1:
        return cred, after1.strip(), ''
    return cred, after1[:i2].strip(), after1[i2 + 2 :].strip()


_LICENSE_CRED_FIRST_EMAIL_RE = re.compile(r'\S+@\S+\.\S+')


def _sync_allowed_emails_from_license_admin_texts(text_blocks):
    """
    Por cada línea con credencial y cliente (separadores \\x1f o legado //), toma el primer correo de la credencial
    y lo añade a AllowedEmail del usuario principal cuyo username coincide con <cliente>.
    Omite cliente vacío o 'anonimo'; no duplica filas existentes.
    """
    from sqlalchemy import func

    seen = set()
    added = 0
    for block in text_blocks:
        if not block or not str(block).strip():
            continue
        for line in str(block).replace('\r\n', '\n').split('\n'):
            cred, client_part, _status = _split_line_cred_notes_user_admin(line)
            ul = (client_part or '').strip()
            if not ul or ul.lower() == 'anonimo':
                continue
            m = _LICENSE_CRED_FIRST_EMAIL_RE.search((cred or '').strip())
            if not m:
                continue
            email = m.group(0).strip().lower()
            if '@' not in email or '.' not in email:
                continue
            principal = User.query.filter(
                User.parent_id.is_(None),
                func.lower(User.username) == ul.lower(),
            ).first()
            if not principal:
                continue
            key = (principal.id, email)
            if key in seen:
                continue
            seen.add(key)
            exists = AllowedEmail.query.filter_by(user_id=principal.id, email=email).first()
            if exists:
                continue
            db.session.add(AllowedEmail(user_id=principal.id, email=email))
            added += 1
    return added


_LICENSE_LINE_FIELD_SEP = '\x1f'
_NETFLIX_INVENTORY_LINE_RE = re.compile(
    r'^(\S+@\S+\.\S+)\s+\((\d+)\)\s+(\S+)(?:\s+(.*))?$'
)


def _product_name_is_netflix(name):
    return bool(name and re.search(r'netflix', str(name).strip(), re.I))


def _parse_cred_part_for_inventory_email_style(work, is_netflix):
    """
    Réplica mínima de parseLineAccountFields (licencias.js) para la parte credencial
    (sin segmentos \\x1f; el caller ya separó cred/cliente).
    """
    w = (work or '').strip()
    if not w:
        return None
    if is_netflix:
        m = _NETFLIX_INVENTORY_LINE_RE.match(w)
        if m:
            base = m.group(1).strip().lower()
            slot = m.group(2)
            password = m.group(3).strip()
            email = f'{base} ({slot})'
            return {
                'email': email,
                'password': password,
                'identifier': base.split('@')[0],
            }
    colon = re.match(r'^([^\s:]+@[^\s:]+\.\S+):(\S+)(?:\s+(.*))?$', w)
    if colon:
        return {
            'email': colon.group(1).strip().lower(),
            'password': colon.group(2).strip(),
            'identifier': colon.group(1).strip().lower().split('@')[0],
        }
    space = re.match(r'^([^\s]+@[^\s]+\.\S+)\s+(\S+)(?:\s+(.*))?$', w)
    if space:
        return {
            'email': space.group(1).strip().lower(),
            'password': space.group(2).strip(),
            'identifier': space.group(1).strip().lower().split('@')[0],
        }
    em_match = re.search(r'(\S+@\S+\.\S+)', w)
    if em_match:
        em = em_match.group(1).strip().lower()
        rest = w[w.index(em_match.group(1)) + len(em_match.group(1)) :].strip()
        rest = re.sub(r'^[:;\s]+', '', rest)
        rm = re.match(r'^(\S+)(?:\s+(.*))?$', rest)
        if rm:
            password = (rm.group(1) or '').strip()
            tail = (rm.group(2) or '').strip()
        else:
            password = rest.strip()
            tail = ''
        if not password:
            password = tail or '.'
        return {
            'email': em,
            'password': password,
            'identifier': em.split('@')[0],
        }
    return None


def _inventory_tuple_from_license_notes_line(line, license_id, is_netflix):
    """
    Devuelve (email, password, identifier) para crear/actualizar ``LicenseAccount``,
    o None si la línea no aporta inventario vendible.

    ``email`` puede ser cadena vacía si la credencial no tiene formato de correo.
    """
    raw = (line or '').strip()
    if not raw:
        return None

    has_sep = _LICENSE_LINE_FIELD_SEP in raw
    cred, _client, _st = _split_line_cred_notes_user_admin(raw)
    cred = (cred or '').strip()
    if not cred:
        return None

    parsed = _parse_cred_part_for_inventory_email_style(cred, is_netflix)
    if parsed:
        return parsed['email'], parsed['password'], parsed['identifier']

    tokens = cred.split()
    if not tokens:
        return None
    # No exigimos correo con @; basta credencial no vacía algo estructurada o ≥2 caracteres.
    struct_ok = has_sep or len(tokens) >= 2 or len(cred.strip()) >= 2
    if not struct_ok:
        return None

    cred_norm = re.sub(r'\s+', ' ', cred.strip())
    ident = tokens[0][:200]
    if len(tokens) >= 2:
        password = cred[len(tokens[0]) :].strip()[:500]
    else:
        password = cred[:500]
    if not password:
        password = '.'

    # Sin correo en la línea: email vacío (no placeholders @store.internal).
    return '', password, ident


def _sync_inventory_accounts_from_license_notes(license_row):
    """
    Asegura ``LicenseAccount`` en ``available`` **solo desde el bloc «Licencias»** (``license_notes``).

    Los blocs **«Día 1…31»** no entran en esta sincronización (son historial vendido / por día).

    **Una línea no vacía = una unidad vendible** (`inventory_bloc_ord` 1-based = posición en el bloc),
    aunque la credencial sea exactamente la misma en dos líneas.

    Líneas ilegibles: borra la ``available`` en ese número de ranura si existía.

    Tras aplicar cada ranura 1…N: elimina ``available`` con ``inventory_bloc_ord`` fuera de rango u
    operadas sin orden (mezcla vieja/API). No toca ``sold`` ni ``assigned``.

    Si el bloc queda vacío, borra todas las ``available`` de esa licencia.
    """
    from app.store.models import LicenseAccount

    _ensure_license_account_inventory_bloc_ord_column()

    product = getattr(license_row, 'product', None)
    if product is None:
        from app.store.models import Product as _Product

        product = _Product.query.get(license_row.product_id)
    is_nf = _product_name_is_netflix(getattr(product, 'name', None) if product else None)

    created = updated = skipped = lines_seen = removed = 0
    now = datetime.utcnow()
    expires_at = now + timedelta(days=30)

    notes = getattr(license_row, 'license_notes', None) or ''
    lines_list = []
    for line in str(notes).replace('\r\n', '\n').split('\n'):
        s = str(line).strip()
        if s:
            lines_list.append(s)

    if not lines_list:
        for acc in LicenseAccount.query.filter_by(
            license_id=license_row.id,
            status='available',
        ).all():
            db.session.delete(acc)
            removed += 1
        return {
            'created': 0,
            'updated': 0,
            'skipped': 0,
            'lines': 0,
            'removed': removed,
        }

    max_slot = len(lines_list)

    for slot_ord, line in enumerate(lines_list, start=1):
        lines_seen += 1
        rows_at_slot = sorted(
            LicenseAccount.query.filter_by(
                license_id=license_row.id,
                inventory_bloc_ord=slot_ord,
            ).all(),
            key=lambda a: a.id,
        )
        delivered_here = [
            r
            for r in rows_at_slot
            if str(r.status or '').lower() in ('sold', 'assigned')
        ]
        available_here = [
            r
            for r in rows_at_slot
            if str(r.status or '').lower() == 'available'
        ]
        for dup in available_here[1:]:
            db.session.delete(dup)
            removed += 1
        acc = available_here[0] if available_here else None

        tup = _inventory_tuple_from_license_notes_line(line, license_row.id, is_nf)
        if not tup:
            if acc is not None:
                db.session.delete(acc)
                removed += 1
            skipped += 1
            continue

        email, password, identifier = tup
        email = (email or '').strip().lower()[:120]
        password = (password or '')[:200]
        identifier = (identifier or '')[:200]
        if not password or not identifier:
            if acc is not None:
                db.session.delete(acc)
                removed += 1
            skipped += 1
            continue

        # Ranura ya usada por una venta/asignación: no otra «available» aquí.
        if delivered_here:
            if acc is not None:
                db.session.delete(acc)
                removed += 1
            skipped += 1
            continue

        if acc is not None:
            ch = False
            if (acc.email or '').lower() != email:
                acc.email = email
                ch = True
            if acc.password != password:
                acc.password = password
                ch = True
            if acc.account_identifier != identifier:
                acc.account_identifier = identifier
                ch = True
            if acc.inventory_bloc_ord != slot_ord:
                acc.inventory_bloc_ord = slot_ord
                ch = True
            if ch:
                updated += 1
            else:
                skipped += 1
            continue

        db.session.add(
            LicenseAccount(
                license_id=license_row.id,
                account_identifier=identifier,
                email=email,
                password=password,
                status='available',
                expires_at=expires_at,
                inventory_bloc_ord=slot_ord,
            )
        )
        created += 1

    for acc in (
        LicenseAccount.query.filter_by(
            license_id=license_row.id,
            status='available',
        )
        .filter(
            or_(
                LicenseAccount.inventory_bloc_ord.is_(None),
                LicenseAccount.inventory_bloc_ord > max_slot,
            )
        )
        .all()
    ):
        db.session.delete(acc)
        removed += 1

    return {
        'created': created,
        'updated': updated,
        'skipped': skipped,
        'lines': lines_seen,
        'removed': removed,
    }


def _license_notes_inventory_lines_list(note_text):
    """Líneas no vacías del bloc «Licencias» (misma semántica que _sync_inventory_accounts_from_license_notes)."""
    out = []
    for line in str(note_text or '').replace('\r\n', '\n').split('\n'):
        s = str(line).strip()
        if s:
            out.append(s)
    return out


def _license_notes_inventory_raw_line_at_slot_1based(license_row, slot_1based):
    if slot_1based is None or int(slot_1based) < 1:
        return None
    lines = _license_notes_inventory_lines_list(getattr(license_row, 'license_notes', None))
    idx = int(slot_1based) - 1
    if idx < len(lines):
        return lines[idx]
    return None


def _remove_license_inventory_lines_at_ordinals(license_row, ordinal_1based_list):
    """
    Quita líneas del bloc Licencias por posición 1-based (orden del inventario sincronizado).
    Borra desde el ordinal mayor para que no corran los índices entre eliminaciones.
    """
    ords = sorted(
        {int(o) for o in ordinal_1based_list if o is not None and int(o) >= 1},
        reverse=True,
    )
    if not ords:
        return False
    lines = _license_notes_inventory_lines_list(getattr(license_row, 'license_notes', None))
    changed = False
    for o in ords:
        if o <= len(lines):
            del lines[o - 1]
            changed = True
    if changed:
        license_row.license_notes = '\n'.join(lines) if lines else ''
    return changed


def _normalize_inventory_fingerprint(email, password, identifier):
    """Igualdad de inventario bloc ↔ cuenta (checkout / sync)."""
    return (
        (email or '').strip().lower(),
        (password or '').strip(),
        (identifier or '').strip().lower(),
    )


def _remove_first_license_inventory_line_matching_fingerprint(license_row, fp_triple, is_netflix):
    """
    Quita la primera línea del bloc Licencias cuyo (email/pass/identificador)
    coincide con la cuenta vendida. Usado si no hay ordinal fiable (`inventory_bloc_ord`).
    """
    if not fp_triple or fp_triple == ('', '', ''):
        return False
    lines = _license_notes_inventory_lines_list(getattr(license_row, 'license_notes', None))
    for i, line in enumerate(lines):
        tup = _inventory_tuple_from_license_notes_line(line, license_row.id, is_netflix)
        if not tup:
            continue
        le, lp, lid = tup
        if _normalize_inventory_fingerprint(le, lp, lid) == fp_triple:
            del lines[i]
            license_row.license_notes = '\n'.join(lines) if lines else ''
            return True
    return False


def _append_line_to_license_day_notepad(license_row, calendar_day_int, line_text):
    """Añade una línea al bloc «Día N» (N = día del mes en curso, Colombia)."""
    from app.store.models import License as _LicenseModel

    if not line_text or not str(line_text).strip():
        return
    if not isinstance(license_row, _LicenseModel):
        return
    day_key = str(int(calendar_day_int))
    dm = {}
    raw = getattr(license_row, 'day_notepads_json', None) or ''
    if raw and str(raw).strip():
        try:
            dm = json.loads(raw)
            if not isinstance(dm, dict):
                dm = {}
        except Exception:
            dm = {}
    cur = dm.get(day_key)
    cur_s = str(cur).rstrip() if cur is not None else ''
    add = str(line_text).strip()
    if cur_s:
        dm[day_key] = (cur_s + '\n' + add).strip()
    else:
        dm[day_key] = add
    license_row.day_notepads_json = json.dumps(dm, ensure_ascii=False)


def _remove_first_matching_line_from_license_day_notepads(license_row, fp_triple, is_netflix):
    """
    Tras checkout: quitó la cuenta del bloc «Licencias» pero la misma credencial suele estar
    duplicada en «Día N». Elimina la primera ocurrencia (días 1–31) por huella de inventario,
    igual que `_remove_first_license_inventory_line_matching_fingerprint` en Licencias.
    """
    import json as _json

    if not fp_triple or fp_triple == ('', '', ''):
        return False
    if license_row is None:
        return False
    fp_norm = _normalize_inventory_fingerprint(fp_triple[0], fp_triple[1], fp_triple[2])
    raw = getattr(license_row, 'day_notepads_json', None)
    dm = {}
    if raw and str(raw).strip():
        try:
            dm = _json.loads(raw)
            if not isinstance(dm, dict):
                dm = {}
        except Exception:
            dm = {}

    lid = getattr(license_row, 'id', None)
    if lid is None:
        return False

    for d_int in range(1, 32):
        dk = str(d_int)
        if dk not in dm:
            continue
        cur = dm.get(dk)
        cur_s = str(cur).strip() if cur is not None else ''
        if not cur_s:
            continue
        lines = [ln for ln in str(cur_s).replace('\r\n', '\n').split('\n') if str(ln).strip()]
        if not lines:
            continue
        new_lines = []
        removed_here = False
        for ln in lines:
            if not removed_here:
                tup = _inventory_tuple_from_license_notes_line(ln, lid, is_netflix)
                if tup:
                    tnorm = _normalize_inventory_fingerprint(tup[0], tup[1], tup[2])
                    if tnorm == fp_norm:
                        removed_here = True
                        continue
            new_lines.append(ln)
        if removed_here:
            if new_lines:
                dm[dk] = '\n'.join(new_lines).strip()
            else:
                dm.pop(dk, None)
            license_row.day_notepads_json = (
                _json.dumps(dm, ensure_ascii=False) if dm else None
            )
            return True
    return False


def _dual_storage_line_public_checkout_sale(buyer_username, raw_inventory_line, account_fallback):
    """
    Línea de almacenamiento (admin) para el día de venta tras un checkout público.
    Si había línea en el bloc Licencias, se conserva la credencial y se asigna el comprador.
    La credencial debe poder enlazarse con la cuenta en el portal (credential_matches_account).
    """
    from app.store.user_license_line_parse import (
        credential_matches_account,
        dual_to_storage_line,
        parse_admin_license_line_to_split_parts,
    )

    buyer = (buyer_username or '').strip() or 'anonimo'
    acc = account_fallback
    em_acc = (getattr(acc, 'email', None) or '').strip()
    pw_acc = (getattr(acc, 'password', None) or '').strip()
    aid_acc = (getattr(acc, 'account_identifier', None) or '').strip()

    if raw_inventory_line and str(raw_inventory_line).strip():
        dual = parse_admin_license_line_to_split_parts(str(raw_inventory_line).strip())
    else:
        em = em_acc
        pw = pw_acc
        aid = aid_acc
        if em:
            cred = (f'{em} {pw}').strip()
        elif aid:
            cred = (f'{aid} {pw}').strip()
        else:
            cred = pw or aid or '.'
        dual = {
            'cred': cred,
            'user': '',
            'statusGood': '',
            'statusBad': '',
            'otroDetail': '',
            'extra': '',
        }
    dual['user'] = buyer
    # No marcar «Buena y revisada» al vender: solo aplica tras reporte revisado y cuenta entregada.
    dual['statusBad'] = ''
    dual['otroDetail'] = ''

    cred_chk = str(dual.get('cred') or '').strip()
    if not credential_matches_account(cred_chk, em_acc, aid_acc):
        if em_acc:
            dual['cred'] = (f'{em_acc} {pw_acc}').strip()
        elif aid_acc:
            dual['cred'] = (f'{aid_acc} {pw_acc}').strip()
        else:
            dual['cred'] = (pw_acc or aid_acc or '.').strip()

    return dual_to_storage_line(dual)


def _apply_public_checkout_bloc_moves_to_licenses(moves):
    """
    Tras un pago exitoso: quita del bloc Licencias las filas vendidas (solo si tenían ranura en el bloc),
    re-sincroniza cuentas ``available`` con el texto restante y añade cada venta al «Día N»
    (día calendario Colombia en el momento de la venta; respaldo: día Colombia «ahora»).
    """
    if not moves:
        return
    from collections import defaultdict

    co_day = int(get_colombia_datetime().day)
    if co_day < 1:
        co_day = 1
    if co_day > 31:
        co_day = 31

    by_lic = defaultdict(list)
    for m in moves:
        lo = m.get('license_obj')
        if lo is not None:
            by_lic[lo.id].append(m)

    for _lid, group in by_lic.items():
        lic = group[0]['license_obj']
        product = getattr(lic, 'product', None)
        if product is None:
            from app.store.models import Product as _ProductForInv

            product = _ProductForInv.query.get(lic.product_id)
        is_nf = _product_name_is_netflix(getattr(product, 'name', None) if product else None)

        lines_snapshot = _license_notes_inventory_lines_list(getattr(lic, 'license_notes', None))
        initial_line_count = len(lines_snapshot)

        slots_eligible = []
        fp_fallback_ordered = []
        for m in group:
            sb = m.get('inventory_slot')
            fp = m.get('sold_account_fp')
            slot_covers_sale = False
            if sb is not None:
                try:
                    sb_i = int(sb)
                except (TypeError, ValueError):
                    sb_i = None
                if sb_i is not None and sb_i >= 1:
                    if sb_i <= initial_line_count:
                        slot_covers_sale = True
                        slots_eligible.append(sb_i)
            if (not slot_covers_sale) and fp and fp != ('', '', ''):
                fp_fallback_ordered.append(fp)

        if slots_eligible:
            _remove_license_inventory_lines_at_ordinals(lic, slots_eligible)
            _sync_inventory_accounts_from_license_notes(lic)

        fp_removed_any = False
        for fp in fp_fallback_ordered:
            if _remove_first_license_inventory_line_matching_fingerprint(lic, fp, is_nf):
                fp_removed_any = True
        if fp_removed_any:
            _sync_inventory_accounts_from_license_notes(lic)

        for m in group:
            line_day = m.get('storage_line_for_day') or ''
            day_append = m.get('sale_calendar_day')
            try:
                day_append_i = int(day_append)
            except (TypeError, ValueError):
                day_append_i = None
            if day_append_i is None or day_append_i < 1 or day_append_i > 31:
                day_append_i = co_day
            if line_day.strip():
                _append_line_to_license_day_notepad(lic, day_append_i, line_day)


def _billing_row_for_bulk_license_client(username_raw):
    """
    Fila usuario cuyo ``saldo`` (deuda cuenta licencias) debe actualizarse tras entrega desde admin:
    mismo criterio que el portal («Licencias»: facturación sobre el usuario principal si es subusuario).
    """
    ul = (username_raw or '').strip()
    if not ul:
        return None
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    cand = User.query.filter(
        User.username != admin_username,
        sa_func.lower(User.username) == ul.lower(),
    ).first()
    if not cand:
        return None
    if getattr(cand, 'parent_id', None):
        pu = User.query.get(cand.parent_id)
        if pu:
            return pu
    return cand


def _debt_increment_per_bulk_license_sale(product, billing_user):
    """
    Importe a sumar a ``User.saldo`` por cada licencia entregada (edición masiva admin).
    Alineado con precio público efectivo por moneda ``user_prices.tipo_precio`` y descuentos por producto.
    """
    if not product or not billing_user:
        return 0.0
    up = getattr(billing_user, 'user_prices', None)
    cfg = up if isinstance(up, dict) else {}
    tipo = (cfg.get('tipo_precio') or '').strip().upper()
    dm = cfg.get('descuentos_productos') or {}
    pid = getattr(product, 'id', None)
    dent_raw = None
    if pid is not None:
        dent_raw = dm.get(str(pid))
        if dent_raw is None:
            dent_raw = dm.get(pid)
    dent = dent_raw if isinstance(dent_raw, dict) else {}
    pc = float(getattr(product, 'price_cop', 0) or 0)
    pusd = float(getattr(product, 'price_usd', 0) or 0)
    dc = float(dent.get('cop') or 0)
    du = float(dent.get('usd') or 0)
    if tipo == 'USD':
        return max(0.0, pusd - du)
    if tipo == 'COP':
        return max(0.0, pc - dc)
    if pusd > 0 and pc <= 0:
        return max(0.0, pusd - du)
    if pc > 0 and pusd <= 0:
        return max(0.0, pc - dc)
    if pc >= pusd:
        return max(0.0, pc - dc)
    return max(0.0, pusd - du)


@store_bp.route('/api/admin/licenses/run-day-renewal', methods=['POST'])
@admin_or_soporte_licencias_required
def api_admin_run_license_day_renewal():
    """
    Ejecutar manualmente la tubería de renovación del día (Colombia):
    cobrar «renovar / dejar mes a mes» y enrutar vencidas (no renovar / —).
    """
    try:
        from app.store.license_day_renewal_job import run_license_day_renewal_pipeline

        co = get_colombia_datetime()
        result = run_license_day_renewal_pipeline()
        ren = dict(result.get('renewals') or {})
        ck = ren.get('charged_keys')
        if isinstance(ck, set):
            ren['charged_keys'] = [list(k) for k in ck]
        routed = result.get('routed_day_lines') or {}
        exp = result.get('expired') or {}
        lines_moved = (
            int(exp.get('lines_moved') or 0)
            + int(routed.get('lines_moved') or 0)
            + int(ren.get('routed_charge_failed') or 0)
        )
        return jsonify(
            {
                'success': True,
                'calendar_day': result.get('calendar_day'),
                'colombia_date': co.strftime('%Y-%m-%d'),
                'charged': int(ren.get('charged') or 0),
                'renewal_errors': int(ren.get('errors') or 0),
                'skipped_mes_a_mes': int(ren.get('skipped_mes_a_mes_idempotent') or 0),
                'lines_moved': lines_moved,
                'lines_routed_charge_failed': int(ren.get('routed_charge_failed') or 0),
                'lines_routed_from_day': int(routed.get('lines_moved') or 0),
                'renewals': ren,
                'routed_day_lines': routed,
                'expired': exp,
            }
        )
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_admin_run_license_day_renewal')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/licenses/<int:license_id>/admin-bulk-delivery-debt', methods=['POST'])
@admin_or_soporte_licencias_required
def api_license_admin_bulk_delivery_debt(license_id):
    """
    Registrar deuda tras edición masiva (entrega a cliente): aumenta ``User.saldo``.
    Sin tope de ``limite_deuda_*``: el admin puede cobrar aunque supere el máximo configurado en permisos.
    El límite solo aplica al checkout público (``procesar_pago`` / saldo prepago tienda).
    """
    try:
        from app.store.models import License

        data = request.get_json(silent=True) or {}
        raw_qty = data.get('quantity')
        billing_username_raw = data.get('billing_username')
        try:
            qty = int(raw_qty)
        except (TypeError, ValueError):
            qty = 0
        if qty < 1:
            return jsonify({'success': False, 'error': 'Cantidad inválida.'}), 400

        lic_row = (
            License.query.options(joinedload(License.product))
            .filter_by(id=license_id)
            .first()
        )
        if not lic_row:
            return jsonify({'success': False, 'error': 'Licencia no encontrada.'}), 404
        product = getattr(lic_row, 'product', None)
        if not product:
            return jsonify({'success': False, 'error': 'Sin producto vinculado.'}), 400

        billing_target = _billing_row_for_bulk_license_client(billing_username_raw or '')
        if not billing_target:
            return jsonify(
                {
                    'success': True,
                    'charged': False,
                    'reason': 'usuario_no_encontrado',
                    'hint': str(billing_username_raw or '').strip() or '(vacío)',
                }
            )

        unit = float(_debt_increment_per_bulk_license_sale(product, billing_target))
        if unit <= 0:
            return jsonify(
                {
                    'success': True,
                    'charged': False,
                    'reason': 'precio_unitario_cero',
                    'quantity': qty,
                }
            )

        delta = unit * qty
        prev = float(getattr(billing_target, 'saldo', 0) or 0)
        billing_target.saldo = prev + delta
        db.session.commit()
        try:
            new_saldo = float(billing_target.saldo or 0)
        except (TypeError, ValueError):
            new_saldo = 0.0
        return jsonify(
            {
                'success': True,
                'charged': True,
                'quantity': qty,
                'unit_amount': unit,
                'delta': delta,
                'billing_username': billing_target.username,
                'billing_user_id': billing_target.id,
                'previous_saldo': prev,
                'new_saldo': new_saldo,
            }
        )
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_license_admin_bulk_delivery_debt')
        return jsonify({'success': False, 'error': str(e)}), 500


_BLOCKED_TIENDA_SOPORTE_USERNAMES = frozenset({'soporte', 'soporte1', 'soporte2', 'soporte3'})


def _is_principal_store_license_saldo_client(user_row, admin_username):
    """Usuarios principales listados en «Saldo clientes»: no admin, no soporte ficticio."""
    if not user_row or getattr(user_row, 'parent_id', None) is not None:
        return False
    un = str(getattr(user_row, 'username', '') or '')
    if un == admin_username:
        return False
    if un.lower() in _BLOCKED_TIENDA_SOPORTE_USERNAMES:
        return False
    return True


@store_bp.route('/api/admin/store-clients-license-saldo', methods=['GET'])
@admin_or_soporte_licencias_required
def api_admin_store_clients_license_saldo():
    """Lista clientes principales con saldo prepago tienda (``saldo_usd`` / ``saldo_cop``)."""
    try:
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        rows = User.query.filter(User.parent_id.is_(None)).order_by(User.username.asc()).all()
        clients = []
        for u in rows:
            if not _is_principal_store_license_saldo_client(u, admin_username):
                continue
            tipo_precio = None
            if u.user_prices and isinstance(u.user_prices, dict):
                tp_raw = u.user_prices.get('tipo_precio')
                if tp_raw in ('USD', 'COP'):
                    tipo_precio = tp_raw.lower()
            clients.append({
                'id': u.id,
                'username': u.username,
                'saldo_usd': float(getattr(u, 'saldo_usd', 0) or 0),
                'saldo_cop': float(getattr(u, 'saldo_cop', 0) or 0),
                'tipo_precio': tipo_precio,
            })
        return jsonify({'success': True, 'clients': clients})
    except Exception as e:
        current_app.logger.exception('api_admin_store_clients_license_saldo')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/admin/users/<int:user_id>/license-account-saldo-adjust', methods=['POST'])
@admin_or_soporte_licencias_required
def api_admin_user_license_account_saldo_adjust(user_id):
    """Sumar o restar cantidad del ``saldo`` de cuenta licencias del cliente (principal).

    Sin tope de límite de deuda: ajuste manual del admin.
    """
    try:
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        target = User.query.get(user_id)
        if not target:
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        if not _is_principal_store_license_saldo_client(target, admin_username):
            return jsonify(
                {'success': False, 'error': 'Solo se puede ajustar saldo en cuentas cliente principales.'}
            ), 403

        data = request.get_json(silent=True) or {}
        try:
            delta = float(data.get('delta', 0))
        except (TypeError, ValueError):
            delta = float('nan')
        if delta != delta or not abs(delta) < 1e15:
            return jsonify({'success': False, 'error': 'Importe inválido.'}), 400
        if abs(delta) < 1e-12:
            return jsonify({'success': False, 'error': 'El importe no puede ser cero.'}), 400
        prev = float(getattr(target, 'saldo', 0) or 0)
        target.saldo = prev + delta
        db.session.commit()
        try:
            new_saldo = float(getattr(target, 'saldo', 0) or 0)
        except (TypeError, ValueError):
            new_saldo = 0.0
        return jsonify(
            {'success': True, 'previous_saldo': prev, 'new_saldo': new_saldo, 'delta': delta}
        )
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_admin_user_license_account_saldo_adjust')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/licenses/<int:license_id>/notes', methods=['PUT'])
@admin_or_soporte_licencias_required
def api_put_license_notes(license_id):
    """Guardar notas personales y de licencias (bloc admin) en base de datos.

    Cuerpo parcial: solo se actualizan las claves enviadas. En particular, enviar solo
    ``month_to_month`` no modifica ``expired_notes`` ni el resto de blocs (siguen en BD).
    """
    from app.store.models import License
    import json as _json
    try:
        _ensure_license_day_notepads_column()
        _ensure_license_expired_notes_and_month_columns()
        _ensure_license_changes_notes_column()
        license_obj = License.query.get_or_404(license_id)
        data = request.get_json(silent=True) or {}
        if getattr(g, 'license_support_restricted_mode', False):
            allowed_keys = {'changes_notes', 'month_to_month', 'license_notes'}
            data = {k: v for k, v in data.items() if k in allowed_keys}
        if 'personal_notes' in data:
            license_obj.personal_notes = (
                data['personal_notes'] if data['personal_notes'] is not None else ''
            )
        if 'license_notes' in data:
            license_obj.license_notes = (
                data['license_notes'] if data['license_notes'] is not None else ''
            )
        if 'suspended_notes' in data:
            license_obj.suspended_notes = (
                data['suspended_notes'] if data['suspended_notes'] is not None else ''
            )
        if 'expired_notes' in data:
            license_obj.expired_notes = (
                data['expired_notes'] if data['expired_notes'] is not None else ''
            )
        if 'month_to_month' in data:
            v = data['month_to_month']
            license_obj.month_to_month = bool(v) if v is not None else False
        if 'changes_notes' in data:
            license_obj.changes_notes = (
                data['changes_notes'] if data['changes_notes'] is not None else ''
            )
        if 'day_notepads' in data and isinstance(data['day_notepads'], dict):
            current = {}
            raw = getattr(license_obj, 'day_notepads_json', None)
            if raw and str(raw).strip():
                try:
                    current = _json.loads(raw)
                    if not isinstance(current, dict):
                        current = {}
                except Exception:
                    current = {}
            for k, v in data['day_notepads'].items():
                sk = str(k)
                if v is None or (isinstance(v, str) and v.strip() == ''):
                    current.pop(sk, None)
                else:
                    from app.store.license_day_renewal_job import filter_day_text_excluding_side_blocs

                    cleaned = filter_day_text_excluding_side_blocs(
                        license_obj, v if isinstance(v, str) else str(v)
                    )
                    if cleaned:
                        current[sk] = cleaned
                    else:
                        current.pop(sk, None)
            license_obj.day_notepads_json = _json.dumps(current, ensure_ascii=False)

        if (
            'license_notes' in data
            or 'suspended_notes' in data
            or 'expired_notes' in data
            or 'changes_notes' in data
            or ('day_notepads' in data and isinstance(data.get('day_notepads'), dict))
        ):
            texts_for_sync = [
                license_obj.license_notes or '',
                license_obj.suspended_notes or '',
                getattr(license_obj, 'expired_notes', None) or '',
                getattr(license_obj, 'changes_notes', None) or '',
            ]
            raw_day = getattr(license_obj, 'day_notepads_json', None)
            if raw_day and str(raw_day).strip():
                try:
                    dm = _json.loads(raw_day)
                    if isinstance(dm, dict):
                        for v in dm.values():
                            if v:
                                texts_for_sync.append(str(v))
                except Exception:
                    pass
            _sync_allowed_emails_from_license_admin_texts(texts_for_sync)

        inv_sync_result = None
        if 'license_notes' in data:
            inv_sync_result = _sync_inventory_accounts_from_license_notes(license_obj)

        db.session.commit()
        body = {'success': True}
        if inv_sync_result is not None:
            body['inventory_sync'] = inv_sync_result
        return jsonify(body)
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/licenses/archived/count', methods=['GET'])
@admin_required
def api_archived_licenses_count():
    """Contador de licencias archivadas para el menú admin (Menú2)."""
    try:
        from app.store.models import License

        count = License.query.filter_by(enabled=False).count()
        ok = jsonify({'success': True, 'count': count})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        err = jsonify({'success': False, 'error': str(e), 'count': 0})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/licenses/archived', methods=['GET'])
@admin_required
def api_get_archived_licenses():
    """Obtener solo las licencias archivadas"""
    try:
        from app.store.models import License, LicenseAccount, Product
        from app import db

        db.session.expire_all()

        _ensure_license_warranty_days_column()
        _ensure_license_expired_notes_and_month_columns()
        _ensure_license_changes_notes_column()

        licenses = License.query.filter_by(enabled=False).options(joinedload(License.accounts)).all()
        
        all_archived_accounts = []
        for license in licenses:
            all_archived_accounts.extend(license.accounts or [])
        archived_username_map = _assigned_usernames_map_for_accounts(all_archived_accounts)

        licenses_data = []
        for license in licenses:
            day_map = {}
            raw = getattr(license, 'day_notepads_json', None)
            if raw and str(raw).strip():
                try:
                    import json as _json
                    day_map = _json.loads(raw)
                    if not isinstance(day_map, dict):
                        day_map = {}
                except Exception:
                    day_map = {}
            
            accounts_data = []
            for account in license.accounts:
                uid = account.assigned_to_user_id
                accounts_data.append({
                    'id': account.id,
                    'account_identifier': account.account_identifier,
                    'email': account.email,
                    'password': account.password,
                    'status': account.status,
                    'assigned_to_user_id': uid,
                    'assigned_username': archived_username_map.get(int(uid)) if uid else None,
                    'assigned_at': _store_dt_iso_utc_z(account.assigned_at),
                    'expires_at': _store_dt_iso_utc_z(account.expires_at),
                    'created_at': _store_dt_iso_utc_z(account.created_at),
                    'is_expired': account.is_expired,
                    'days_until_expiry': account.days_until_expiry
                })
            
            licenses_data.append({
                'id': license.id,
                'product_id': license.product_id,
                'product_name': license.product.name if license.product else 'Producto eliminado',
                'position': license.position,
                'warranty_days': _license_warranty_days_public(license),
                'enabled': license.enabled,
                'created_at': _store_dt_iso_utc_z(license.created_at),
                'updated_at': _store_dt_iso_utc_z(license.updated_at),
                'personal_notes': license.personal_notes or '',
                'license_notes': license.license_notes or '',
                'suspended_notes': getattr(license, 'suspended_notes', None) or '',
                'expired_notes': getattr(license, 'expired_notes', None) or '',
                'changes_notes': getattr(license, 'changes_notes', None) or '',
                'month_to_month': bool(getattr(license, 'month_to_month', False)),
                'day_notepads': day_map,
                'accounts': accounts_data
            })
        
        ok = jsonify({'success': True, 'licenses': licenses_data})
        _attach_private_no_cache_headers(ok)
        return ok
        
    except Exception as e:
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/licenses/<int:license_id>/archive', methods=['PUT'])
@admin_required
def api_archive_license(license_id):
    """Archivar una licencia (deshabilitarla)"""
    from app.store.models import License
    try:
        license = License.query.get_or_404(license_id)
        license.enabled = False
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Licencia archivada correctamente'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@store_bp.route('/api/licenses/<int:license_id>/restore', methods=['PUT'])
@admin_required
def api_restore_license(license_id):
    """Restaurar una licencia archivada (habilitarla)"""
    from app.store.models import License
    try:
        license = License.query.get_or_404(license_id)
        license.enabled = True
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Licencia restaurada correctamente'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@store_bp.route('/api/licenses/<int:license_id>/warranty', methods=['PUT'])
@admin_required
def api_update_license_warranty(license_id):
    """Actualizar reserva gar. (campo warranty_days): n.º de cuentas disponibles apartadas como garantía."""
    from app.store.models import License
    try:
        _ensure_license_warranty_days_column()
        data = request.get_json(silent=True) or {}
        raw = data.get('warranty_days')
        if raw is None:
            return jsonify({'success': False, 'error': 'warranty_days requerido'}), 400
        try:
            wd = int(raw)
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Valor de garantía inválido'}), 400
        if wd < 0 or wd > 3650:
            return jsonify({'success': False, 'error': 'La reserva gar. debe estar entre 0 y 3650 cuentas.'}), 400
        lic = License.query.get_or_404(license_id)
        lic.warranty_days = wd
        db.session.commit()
        return jsonify({'success': True, 'warranty_days': wd})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/licenses/<int:license_id>', methods=['DELETE'])
@admin_required
def api_delete_license(license_id):
    """Eliminar permanentemente una licencia"""
    from app.store.models import License
    try:
        license = License.query.get_or_404(license_id)
        db.session.delete(license)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Licencia eliminada correctamente'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@store_bp.route('/api/licenses/<int:license_id>/position', methods=['PUT'])
@admin_required
def api_update_license_position(license_id):
    """Actualizar posición de una licencia con reorganización automática"""
    try:
        from app.store.models import License
        from app import db
        
        data = request.get_json()
        new_position = data.get('position')
        reorganize = data.get('reorganize', False)
        
        if not new_position or new_position < 1:
            return jsonify({'success': False, 'error': 'Posición inválida'}), 400
        
        license = License.query.get(license_id)
        if not license:
            return jsonify({'success': False, 'error': 'Licencia no encontrada'}), 404
        
        old_position = license.position
        
        if reorganize:
            # Siempre reorganizar todo para evitar duplicados
            # Primero, mover temporalmente la licencia actual a una posición muy alta
            license.position = 9999
            db.session.add(license)
            db.session.flush()  # Asegurar que se guarde el cambio temporal
            
            # Obtener todas las licencias habilitadas (excluyendo la que estamos moviendo)
            other_licenses = License.query.filter(
                License.enabled == True,
                License.id != license_id
            ).order_by(License.position.asc()).all()
            
            # Reorganizar todas las posiciones secuencialmente
            current_pos = 1
            for lic in other_licenses:
                if current_pos == new_position:
                    current_pos += 1  # Saltar la posición que queremos para nuestra licencia
                lic.position = current_pos
                db.session.add(lic)
                current_pos += 1
            
            # Ahora asignar la posición deseada a nuestra licencia
            license.position = new_position
            db.session.add(license)
        else:
            # Si no se solicita reorganización, solo actualizar
            license.position = new_position
            db.session.add(license)
        
        db.session.commit()
        
        return jsonify({
            'success': True, 
            'position': license.position,
            'reorganized': reorganize
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/licenses/reorganize-all', methods=['POST'])
@admin_required
def api_reorganize_all_licenses():
    """Reorganizar todas las licencias para eliminar duplicados y huecos"""
    try:
        from app.store.models import License
        from app import db
        
        # Obtener todas las licencias habilitadas ordenadas por posición actual
        all_licenses = License.query.filter(
            License.enabled == True
        ).order_by(License.position.asc()).all()
        
        # Reorganizar todas las posiciones secuencialmente
        for index, license in enumerate(all_licenses, 1):
            license.position = index
            db.session.add(license)
        
        db.session.commit()
        
        return jsonify({
            'success': True, 
            'message': f'Se reorganizaron {len(all_licenses)} licencias',
            'count': len(all_licenses)
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


def _count_inventory_lines_from_license_notes(license_notes):
    """
    Líneas con contenido en el bloc Licencias (mismo criterio que el badge del admin:
    countNonEmptyLinesInText en licencias.js). Antes solo contaban líneas que pasaban
    un regex estricto, y había desfase con lo que el usuario ve (p. ej. 11 vs 15).
    """
    if not license_notes or not str(license_notes).strip():
        return 0
    n = 0
    for ln in str(license_notes).splitlines():
        if str(ln).strip():
            n += 1
    return n


def _stock_for_single_license(license_obj):
    """
    Inventario por licencia: filas en LicenseAccount (available/assigned) o líneas
    en license_notes, lo que sea mayor (el admin suele usar solo el bloc de texto).
    """
    from app.store.models import LicenseAccount
    acc_count = LicenseAccount.query.filter(
        LicenseAccount.license_id == license_obj.id,
        LicenseAccount.status.in_(['available', 'assigned'])
    ).count()
    note_count = _count_inventory_lines_from_license_notes(license_obj.license_notes)
    return max(acc_count, note_count)


def _compute_stock_for_product(product):
    """Suma el stock de todas las licencias activas del producto."""
    from app.store.models import License
    licenses = License.query.filter_by(product_id=product.id, enabled=True).all()
    if not licenses:
        return 0
    total = 0
    for lic in licenses:
        total += _stock_for_single_license(lic)
    return total


def _warranty_reserve_for_product(product):
    """Unidades reservadas como garantía (suma de gar. por licencia activa del producto)."""
    from app.store.models import License

    _ensure_license_warranty_days_column()
    lic_rows = License.query.filter_by(product_id=product.id, enabled=True).all()
    total = 0
    for lic in lic_rows:
        total += _license_warranty_days_public(lic)
    return total


def _sellable_license_accounts_public(license_row):
    """
    Unidades vendibles en tienda/checkout para una licencia: solo cuentas con status ``available``
    menos la reserva ``gar.`` (``warranty_days``). Coincide con la lógica de ``procesar_pago``.

    Las líneas del bloc ``license_notes`` no sustituyen filas en ``store_license_accounts``:
    hasta que existan cuentas ``available``, el público muestra 0 vendible (evita 409 tras «4 existencias»).
    """
    from app.store.models import LicenseAccount

    _renewal_release_stale_reservations()
    avail_rows = LicenseAccount.query.filter_by(
        license_id=license_row.id, status='available'
    ).all()
    avail = sum(1 for a in avail_rows if _renewal_account_unreserved_for_public_sale(a))
    reserve = _license_warranty_days_public(license_row)
    return max(0, avail - reserve)


def _compute_public_sellable_stock_for_product(product):
    """
    Existencias en tienda y tope de venta por producto: suma, por cada licencia activa, las
    unidades vendibles reales ``max(0, available - gar.)``. Debe igualar lo que puede asignar ``procesar_pago``.
    """
    from app.store.models import License

    lic_rows = License.query.filter_by(product_id=product.id, enabled=True).all()
    if not lic_rows:
        return 0
    total = 0
    for lic in lic_rows:
        total += _sellable_license_accounts_public(lic)
    return total


def _credential_email_normalized_from_plain(cred_plain):
    """Extrae un correo de una línea de credencial típica (email + contraseña o email:clave)."""
    if not cred_plain:
        return None
    s = str(cred_plain).strip()
    if not s:
        return None
    em = _EMAIL_IN_CRED_CRE.search(s)
    if not em:
        return None
    return em.group(1).strip().lower()


_EMAIL_IN_CRED_CRE = re.compile(r'([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})', re.ASCII)


def _pick_next_warranty_replacement_license_account(license_row):
    """
    Misma política que el checkout: disponibles ordenados por id asc; las últimas `gar.`
    (warranty_days) filas son colchón y no salen en venta — la primera cuenta de ese bloque es
    la disponible más antigua dentro de la reserva (listo para entregar garantía).
    Devuelve (LicenseAccount|None, error_code_str|None).
    """
    from app.store.models import LicenseAccount

    if not license_row:
        return None, 'no_license'
    reserve = _license_warranty_days_public(license_row)
    if reserve <= 0:
        return None, 'no_reserve'
    _renewal_release_stale_reservations()
    avail = [
        a
        for a in LicenseAccount.query.filter_by(license_id=license_row.id, status='available')
        .order_by(LicenseAccount.id.asc())
        .all()
        if _renewal_account_unreserved_for_public_sale(a)
    ]
    n = len(avail)
    if n <= reserve:
        return None, 'empty_warranty_pool'
    pick_idx = n - reserve
    return avail[pick_idx], None


@store_bp.route('/api/licenses/<int:license_id>/deliver-warranty-replacement', methods=['POST'])
@admin_or_soporte_licencias_required
def api_deliver_warranty_replacement(license_id):
    """
    Panel Reportes: «caida» en un día consume un repuesto desde el colchón gar. (cuentas
    disponibles no vendibles), borra la cuenta defectuosa asignada y entrega esa reserva al
    mismo usuario asignado (quien tiene la cuenta mala — se ignora el nombre mostrado en el bloc).
    """
    try:
        from app.store.models import License, LicenseAccount

        license_obj = License.query.get(license_id)
        if not license_obj or not license_obj.enabled:
            return jsonify({'success': False, 'error': 'Licencia no encontrada.'}), 404

        data = request.get_json(silent=True) or {}
        raw_bad_id = data.get('bad_account_id')
        cred_hint = (data.get('credential_hint') or data.get('bad_credential_plain') or '').strip()

        bad_acc = None
        try:
            if raw_bad_id is not None and str(raw_bad_id).strip() != '':
                bid = int(raw_bad_id)
                bad_acc = LicenseAccount.query.filter_by(id=bid, license_id=license_id).first()
        except (TypeError, ValueError):
            bad_acc = None

        email_key = None
        if bad_acc is None and cred_hint:
            email_key = _credential_email_normalized_from_plain(cred_hint)
            if email_key:
                lk = email_key.lower()
                candidates = (
                    LicenseAccount.query.filter(
                        LicenseAccount.license_id == license_id,
                        LicenseAccount.email.isnot(None),
                    )
                    .filter(sa_func.lower(LicenseAccount.email) == lk)
                    .all()
                )
                ok_st = {'assigned', 'sold'}
                matches = [
                    ca
                    for ca in candidates
                    if (ca.status or '').lower() in ok_st and ca.assigned_to_user_id is not None
                ]
                if len(matches) == 1:
                    bad_acc = matches[0]
                elif len(matches) > 1:
                    return jsonify(
                        {
                            'success': False,
                            'error': (
                                'Hay varias cuentas vendidas con el mismo correo en esta licencia. '
                                'Indica «bad_account_id» (id interno en inventario) desde la API.'
                            ),
                        }
                    ), 409

        if bad_acc is None:
            return jsonify(
                {
                    'success': False,
                    'error': 'No se encontró la cuenta marcada como mala para esta licencia.',
                }
            ), 400

        st_bad = (bad_acc.status or '').lower()
        if st_bad not in {'assigned', 'sold'}:
            return jsonify({'success': False, 'error': 'La cuenta mala debe estar vendida/asignada.'}), 400
        uid = bad_acc.assigned_to_user_id
        if uid is None:
            return jsonify({'success': False, 'error': 'La cuenta mala no tiene usuario asignado.'}), 400

        reporter_name = ''
        urow = User.query.get(uid)
        if urow and urow.username:
            reporter_name = str(urow.username).strip()
        elif urow:
            reporter_name = str(getattr(urow, 'email', '') or '').strip() or 'anonimo'
        else:
            reporter_name = 'anonimo'

        replacement, werr = _pick_next_warranty_replacement_license_account(license_obj)
        if replacement is None:
            msgs = {
                'no_reserve': 'Esta licencia tiene gar. = 0: no hay reserva de garantía.',
                'no_license': 'Error interno (licencia).',
                'empty_warranty_pool': (
                    'No hay cuentas disponibles dentro de la reserva de garantía (gar.). '
                    'Añade existencias disponibles primero.'
                ),
            }
            return jsonify(
                {'success': False, 'error': msgs.get(werr or '', 'Sin stock para garantía.')}
            ), 409

        old_at = bad_acc.assigned_at
        old_ex = bad_acc.expires_at

        db.session.delete(bad_acc)
        db.session.flush()

        replacement.status = 'assigned'
        replacement.assigned_to_user_id = uid
        replacement.assigned_at = old_at or datetime.utcnow()
        replacement.expires_at = old_ex or (datetime.utcnow() + timedelta(days=30))
        replacement.updated_at = datetime.utcnow()
        db.session.commit()

        new_cred_plain = '{} {}'.format(
            str(replacement.email or '').strip(),
            str(replacement.password or '').replace('\r\n', ' ').replace('\n', ' ').strip(),
        ).strip()

        return jsonify(
            {
                'success': True,
                'reporter_username': reporter_name,
                'new_cred_plain': new_cred_plain,
                'new_account_identifier': str(replacement.account_identifier or '').strip(),
                'replacement_account_id': replacement.id,
            }
        )
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_deliver_warranty_replacement')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/products/<int:product_id>/stock', methods=['GET'])
def api_get_product_stock(product_id):
    """Obtener el conteo de licencias disponibles para un producto"""
    try:
        from app.store.models import Product

        db.session.expire_all()
        product = Product.query.get(product_id)
        if not product:
            return jsonify({'success': True, 'stock': 0})

        total_stock = _compute_public_sellable_stock_for_product(product)
        resp = jsonify({'success': True, 'stock': total_stock})
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    except Exception as e:
        current_app.logger.error(f'Error al obtener stock del producto {product_id}: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500

def _public_checkout_assign_license_account(
    account,
    license_row,
    user,
    venta,
    producto,
    sold_bloc_moves,
    cuentas_asignadas,
):
    """Asigna una cuenta de inventario tras venta/renovación en tienda pública."""
    from app.store.models import LicenseAccount

    slot_before = account.inventory_bloc_ord
    raw_ln = None
    try:
        sb = int(slot_before) if slot_before is not None else None
    except (TypeError, ValueError):
        sb = None
    if sb is not None and sb >= 1:
        raw_ln = _license_notes_inventory_raw_line_at_slot_1based(license_row, sb)

    if getattr(venta, 'is_renewal', False):
        try:
            from app.store.sale_purchase_snapshot import (
                detect_renewal_kind_for_account,
                merge_sale_renewal_kind,
            )

            _assignee_ids, allowed_names = _user_licencias_viewer_scope(user)
            prefer_day = None
            try:
                prefer_day = str(int(get_colombia_datetime().day))
            except (TypeError, ValueError):
                prefer_day = None
            kind = detect_renewal_kind_for_account(
                user,
                license_row,
                account,
                allowed_names,
                raw_inventory_line=raw_ln,
                prefer_day_key=prefer_day,
            )
            if kind:
                merge_sale_renewal_kind(venta, kind)
        except Exception:
            current_app.logger.debug(
                'detect renewal_kind skip account_id=%s',
                getattr(account, 'id', None),
                exc_info=True,
            )

    _renewal_clear_reservation(account)
    account.status = 'assigned'
    account.assigned_to_user_id = user.id
    account.sale_id = venta.id
    assigned_stamp = datetime.utcnow()
    account.assigned_at = assigned_stamp
    account.expires_at = assigned_stamp + timedelta(days=30)
    account.inventory_bloc_ord = None

    try:
        sale_cal_day = int(utc_to_colombia(assigned_stamp).day)
    except Exception:
        sale_cal_day = int(get_colombia_datetime().day)
    if sale_cal_day < 1:
        sale_cal_day = 1
    if sale_cal_day > 31:
        sale_cal_day = 31

    day_line = _dual_storage_line_public_checkout_sale(
        getattr(user, 'username', '') or '',
        raw_ln,
        account,
    )
    sold_bloc_moves.append(
        {
            'license_obj': license_row,
            'inventory_slot': sb,
            'storage_line_for_day': day_line,
            'sold_account_fp': _normalize_inventory_fingerprint(
                getattr(account, 'email', None),
                getattr(account, 'password', None),
                getattr(account, 'account_identifier', None),
            ),
            'sale_calendar_day': sale_cal_day,
        }
    )

    cuentas_asignadas.append(
        {
            'producto': producto.name,
            'email': account.email,
            'password': account.password,
            'identifier': account.account_identifier,
        }
    )

    if getattr(venta, 'is_renewal', False):
        try:
            from app.store.user_license_activity import log_store_renewal_activity

            log_store_renewal_activity(user, producto.name, account)
        except Exception:
            current_app.logger.debug(
                'log_store_renewal_activity skip account_id=%s',
                getattr(account, 'id', None),
                exc_info=True,
            )


@store_bp.route('/api/products/stock', methods=['GET'])
def api_get_all_products_stock():
    """Obtener el conteo de licencias disponibles para todos los productos"""
    try:
        from app.store.models import Product

        db.session.expire_all()
        products = public_store_products_query().all()
        stock_data = {}
        for product in products:
            stock_data[product.id] = _compute_public_sellable_stock_for_product(product)

        resp = jsonify({'success': True, 'stock': stock_data})
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    except Exception as e:
        current_app.logger.error(f'Error al obtener stock de productos: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/products/stock/stream')
def api_products_stock_stream():
    """
    Server-Sent Events: envía existencias cada ~1,2 s.
    El ciclo termina a los ~29 s y el navegador reconecta solo (evita timeouts en proxies/Gunicorn).
    """
    @stream_with_context
    def generate():
        # ~24 * 1.2s ≈ 29s por petición; EventSource vuelve a abrir la conexión.
        for _ in range(24):
            try:
                db.session.expire_all()
                products = public_store_products_query().all()
                stock_data = {}
                for product in products:
                    stock_data[product.id] = _compute_public_sellable_stock_for_product(product)
                payload = json.dumps({'success': True, 'stock': stock_data})
                yield f"data: {payload}\n\n"
            except Exception as e:
                current_app.logger.error(f'Error en stream de stock: {e}')
                yield f"data: {json.dumps({'success': False, 'error': str(e)})}\n\n"
            time.sleep(1.2)

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


@store_bp.route('/api/licenses/<int:license_id>/toggle', methods=['PUT'])
@admin_required
def api_toggle_license(license_id):
    """Activar/desactivar licencia"""
    try:
        from app.store.models import License
        from app import db
        
        license = License.query.get(license_id)
        if not license:
            return jsonify({'success': False, 'error': 'Licencia no encontrada'}), 404
        
        license.enabled = not license.enabled
        db.session.commit()
        
        return jsonify({'success': True, 'enabled': license.enabled})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/licenses/<int:license_id>/accounts', methods=['POST'])
@admin_or_soporte_licencias_required
def api_add_license_account(license_id):
    """Agregar cuenta a una licencia"""
    try:
        from app.store.models import License, LicenseAccount
        from app import db
        from datetime import datetime, timedelta
        
        data = request.get_json()
        account_identifier = (data.get('account_identifier') or '').strip()
        email = ((data.get('email') if data.get('email') is not None else '') or '').strip().lower()[:120]
        password = (data.get('password') or '').strip()

        if not account_identifier or not password:
            return jsonify({'success': False, 'error': 'Faltan datos requeridos (identificador y contraseña)'}), 400
        
        license = License.query.get(license_id)
        if not license:
            return jsonify({'success': False, 'error': 'Licencia no encontrada'}), 404
        
        # Crear nueva cuenta con expiración de 1 mes
        expires_at = datetime.utcnow() + timedelta(days=30)
        
        new_account = LicenseAccount(
            license_id=license_id,
            account_identifier=account_identifier,
            email=email,
            password=password,
            status='available',
            expires_at=expires_at
        )
        
        db.session.add(new_account)
        db.session.commit()
        
        return jsonify({'success': True, 'account_id': new_account.id})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/accounts/<int:account_id>', methods=['DELETE', 'PUT', 'OPTIONS'])
@admin_or_soporte_licencias_required
def api_update_license_account(account_id):
    """Actualizar o eliminar cuenta de licencia"""
    # Manejar preflight requests
    if request.method == 'OPTIONS':
        response = jsonify({'success': True})
        response.headers.add('Access-Control-Allow-Methods', 'PUT, DELETE, OPTIONS')
        return response
    
    try:
        from app.store.models import LicenseAccount
        from app import db
        
        account = LicenseAccount.query.get(account_id)
        if not account:
            return jsonify({'success': False, 'error': 'Cuenta no encontrada'}), 404
        
        if request.method == 'DELETE':
            db.session.delete(account)
            db.session.commit()
            return jsonify({'success': True})
        
        elif request.method == 'PUT':
            # Verificar que hay datos JSON
            if not request.is_json:
                return jsonify({'success': False, 'error': 'Content-Type debe ser application/json'}), 400
            
            data = request.get_json()
            if not data:
                return jsonify({'success': False, 'error': 'No se recibieron datos'}), 400
            
            email = data.get('email')
            password = data.get('password')
            account_identifier = data.get('account_identifier')
            has_assign = 'assign_username' in data

            if not email and not password and not account_identifier and not has_assign:
                return jsonify({'success': False, 'error': 'Debe proporcionar al menos un campo para actualizar'}), 400

            if email is not None:
                account.email = email
            if password:
                account.password = password
            if account_identifier:
                account.account_identifier = account_identifier
            if has_assign:
                _apply_portal_assignee_from_line_username(account, data.get('assign_username'))

            db.session.commit()
            return jsonify({'success': True})
        
        else:
            return jsonify({'success': False, 'error': 'Método no permitido'}), 405
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Error en api_update_license_account: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/accounts/<int:account_id>/mark-sold', methods=['PUT'])
@admin_or_soporte_licencias_required
def api_mark_account_sold(account_id):
    """Marcar cuenta como vendida con fecha"""
    try:
        from app.store.models import LicenseAccount
        from app import db
        from datetime import datetime
        
        account = LicenseAccount.query.get(account_id)
        if not account:
            return jsonify({'success': False, 'error': 'Cuenta no encontrada'}), 404
        
        data = request.get_json() or {}
        sold_date_str = data.get('sold_date')

        if sold_date_str:
            sold_date = datetime.fromisoformat(sold_date_str.replace('Z', '+00:00'))
            account.assigned_at = sold_date
        else:
            account.assigned_at = datetime.utcnow()

        account.status = 'sold'
        if 'assign_username' in data:
            _apply_portal_assignee_from_line_username(account, data.get('assign_username'))

        db.session.commit()
        
        return jsonify({'success': True})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/licenses/initialize', methods=['POST'])
@admin_required
def api_initialize_licenses():
    """Inicializar licencias basadas en productos existentes"""
    try:
        from app.store.models import License, Product
        from app import db

        _ensure_license_day_notepads_column()
        _ensure_license_portal_day_row_notes_column()
        _ensure_license_account_client_notes_column()
        _ensure_license_warranty_days_column()
        _ensure_license_expired_notes_and_month_columns()
        _ensure_license_changes_notes_column()

        # Obtener todos los productos habilitados
        products = Product.query.filter_by(enabled=True).all()
        
        created_licenses = []
        for i, product in enumerate(products, 1):
            # Verificar si ya existe una licencia para este producto
            existing_license = License.query.filter_by(product_id=product.id).first()
            
            if not existing_license:
                new_license = License(
                    product_id=product.id,
                    position=i,
                    enabled=True,
                    warranty_days=5,
                )
                db.session.add(new_license)
                created_licenses.append({
                    'id': new_license.id,
                    'product_name': product.name,
                    'position': i
                })
        
        db.session.commit()
        
        return jsonify({
            'success': True, 
            'message': f'Se crearon {len(created_licenses)} licencias',
            'licenses': created_licenses
        })
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_initialize_licenses')
        return jsonify({'success': False, 'error': str(e)}), 500

from app.store.models import StoreSetting
import json
from flask import request, jsonify
import gspread
from google.oauth2.service_account import Credentials

@store_bp.route('/admin/gsheets_config', methods=['POST'])
@admin_required
def save_gsheets_config():
    credentials_json = request.form.get('gsheets_credentials_json')
    sheet_id = request.form.get('gsheets_sheet_id')
    tab_name = request.form.get('gsheets_tab_name')
    if not credentials_json or not sheet_id or not tab_name:
        return jsonify({'success': False, 'error': 'Faltan datos'}), 400
    # Guardar o actualizar en la base de datos
    for key, value in [
        ('gsheets_credentials_json', credentials_json),
        ('gsheets_sheet_id', sheet_id),
        ('gsheets_tab_name', tab_name)
    ]:
        setting = StoreSetting.query.filter_by(key=key).first()
        if setting:
            setting.value = value
        else:
            setting = StoreSetting(key=key, value=value)
            db.session.add(setting)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Configuración guardada correctamente.'})

@store_bp.route('/admin/gsheets_test', methods=['POST'])
@admin_required
def test_gsheets_connection():
    # Leer de la base de datos
    cred_setting = StoreSetting.query.filter_by(key='gsheets_credentials_json').first()
    id_setting = StoreSetting.query.filter_by(key='gsheets_sheet_id').first()
    tab_setting = StoreSetting.query.filter_by(key='gsheets_tab_name').first()
    if not cred_setting or not id_setting or not tab_setting:
        return jsonify({'success': False, 'error': 'Faltan credenciales, ID de hoja o nombre de tab.'}), 400
    try:
        credentials_dict = json.loads(cred_setting.value)
        scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        credentials = Credentials.from_service_account_info(credentials_dict, scopes=scope)
        gc = gspread.authorize(credentials)
        sh = gc.open_by_key(id_setting.value)
        worksheet = sh.worksheet(tab_setting.value)
        # Leer la primera celda como prueba
        value = worksheet.cell(1, 1).value
        return jsonify({'success': True, 'message': f'Conexión exitosa. Primera celda de "{tab_setting.value}": {value}'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/admin/gsheets_test_direct', methods=['POST'])
@admin_required
def test_gsheets_connection_direct():
    """Prueba la conexión directamente con los datos del formulario"""
    try:
        data = request.json
        
        if not data:
            return jsonify({'success': False, 'error': 'No se recibieron datos JSON'}), 400
            
        credentials_json = data.get('gsheets_credentials_json')
        sheet_id = data.get('gsheets_sheet_id')
        tab_name = data.get('gsheets_tab_name')
        
        if not credentials_json or not sheet_id or not tab_name:
            return jsonify({'success': False, 'error': 'Faltan credenciales, ID de hoja o nombre de tab.'}), 400
        
        # Validar que el JSON sea válido
        try:
            credentials_dict = json.loads(credentials_json)
        except json.JSONDecodeError as e:
            return jsonify({'success': False, 'error': f'JSON de credenciales inválido: {str(e)}'}), 400
        
        # Probar conexión
        scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        credentials = Credentials.from_service_account_info(credentials_dict, scopes=scope)
        gc = gspread.authorize(credentials)
        sh = gc.open_by_key(sheet_id)
        worksheet = sh.worksheet(tab_name)
        
        # Leer la primera celda como prueba
        value = worksheet.cell(1, 1).value
        return jsonify({'success': True, 'message': f'Conexión exitosa. Primera celda de "{tab_name}": {value or "(vacía)"}'})
        
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error interno: {str(e)}'}), 500

# ... existing code ...


@store_bp.route('/admin/gsheets_links', methods=['GET'])
@admin_required
def list_gsheets_links():
    links = GSheetsLink.query.order_by(GSheetsLink.updated_at.desc()).all()
    return jsonify({
        'success': True,
        'links': [
            {
                'id': l.id,
                'template_type': l.plantilla,  # para que coincida con el JS
                'credentials_json': l.credentials_json,
                'sheet_id': l.sheet_id,
                'tab_name': l.tab_name,
                'updated_at': l.updated_at.strftime('%Y-%m-%d %H:%M')
            } for l in links
        ]
    })

@store_bp.route('/admin/gsheets_links', methods=['POST'])
@admin_required
def create_gsheets_link():
    data = request.form if request.form else request.json
    plantilla = data.get('gsheets_template')
    credentials_json = data.get('gsheets_credentials_json')
    sheet_id = data.get('gsheets_sheet_id')
    tab_name = data.get('gsheets_tab_name')
    if not plantilla or not credentials_json or not sheet_id or not tab_name:
        return jsonify({'success': False, 'error': 'Faltan datos'}), 400
    # Si ya existe una vinculación para esa plantilla, actualiza
    link = GSheetsLink.query.filter_by(plantilla=plantilla).first()
    if link:
        link.credentials_json = credentials_json
        link.sheet_id = sheet_id
        link.tab_name = tab_name
    else:
        link = GSheetsLink(
            plantilla=plantilla,
            credentials_json=credentials_json,
            sheet_id=sheet_id,
            tab_name=tab_name
        )
        db.session.add(link)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Vinculación guardada correctamente.'})

@store_bp.route('/admin/gsheets_links/<int:link_id>', methods=['PUT', 'PATCH'])
@admin_required
def edit_gsheets_link(link_id):
    data = request.form if request.form else request.json
    link = GSheetsLink.query.get_or_404(link_id)
    link.plantilla = data.get('gsheets_template', link.plantilla)
    link.credentials_json = data.get('gsheets_credentials_json', link.credentials_json)
    link.sheet_id = data.get('gsheets_sheet_id', link.sheet_id)
    link.tab_name = data.get('gsheets_tab_name', link.tab_name)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Vinculación actualizada.'})

@store_bp.route('/admin/gsheets_links/<int:link_id>', methods=['DELETE'])
@admin_required
def delete_gsheets_link(link_id):
    link = GSheetsLink.query.get_or_404(link_id)
    db.session.delete(link)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Vinculación eliminada.'})

@store_bp.route('/admin/gsheets_links/<int:link_id>/test', methods=['POST'])
@admin_required
def test_gsheets_link(link_id):
    link = GSheetsLink.query.get_or_404(link_id)
    try:
        credentials_dict = json.loads(link.credentials_json)
        scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        credentials = Credentials.from_service_account_info(credentials_dict, scopes=scope)
        gc = gspread.authorize(credentials)
        sh = gc.open_by_key(link.sheet_id)
        try:
            worksheet = sh.worksheet(link.tab_name)
        except Exception as e:
            return jsonify({'success': False, 'error': f'No se encontró la hoja/tab "{link.tab_name}": {str(e)}'}), 400
        value = worksheet.cell(1, 1).value
        return jsonify({'success': True, 'message': f'Conexión exitosa. Primera celda de "{link.tab_name}": {value or "(vacía)"}'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error general: {str(e)}'}), 500

@store_bp.route('/admin/gsheets_links/<int:link_id>', methods=['GET'])
@admin_required
def get_gsheets_link(link_id):
    link = GSheetsLink.query.get_or_404(link_id)
    return jsonify({
        'success': True,
        'link': {
            'id': link.id,
            'template_type': link.plantilla,
            'credentials_json': link.credentials_json,
            'sheet_id': link.sheet_id,
            'tab_name': link.tab_name,
            'updated_at': link.updated_at.strftime('%Y-%m-%d %H:%M')
        }
    })

@store_bp.route('/share/worksheet/<int:worksheet_id>')
def shared_worksheet_access(worksheet_id):
    """Acceso compartido a worksheets con token"""
    try:
        # Obtener parámetros de la URL
        access_type = request.args.get('access', 'readonly')
        token = request.args.get('token')
        
        if not token:
            return "Enlace inválido - Token requerido", 400
        
        if len(token) < 10:
            return "Enlace inválido - Token malformado", 400
        
        # Buscar la plantilla
        worksheet = WorksheetTemplate.query.get(worksheet_id)
        if not worksheet:
            return "Worksheet no encontrada", 404
        
        # Buscar el permiso correspondiente
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return "Enlace no válido - Token no encontrado", 400
        
        
        # Verificar que el permiso esté activo
        if permission.access_type == 'users':
            try:
                user_count = permission.users.count() if hasattr(permission, 'users') and permission.users else 0
                # Los tokens de 'users' pueden funcionar sin usuarios específicos asignados
                # El token en sí es válido para acceso compartido, independientemente de usuarios específicos
            except Exception as e:
                # Continuar - el token público sigue siendo válido
                pass
        
        
        # ⭐ CORREGIDO: Verificar que el tipo de acceso coincida correctamente
        # Para access_type 'readonly' acepta permisos 'view' y 'users'
        # Para access_type 'edit' acepta permisos 'edit' y 'users'
        if access_type == 'readonly' and permission.access_type not in ['view', 'users']:
            return "Tipo de acceso no válido", 400
        elif access_type == 'edit' and permission.access_type not in ['edit', 'users']:
            return "Tipo de acceso no válido", 400
        
        # Obtener datos de la worksheet (expire_all evita caché de SQLAlchemy entre vistas)
        db.session.expire_all()
        worksheet_data = WorksheetData.query.filter_by(template_id=worksheet_id).first()
        raw_data = worksheet_data.data if worksheet_data else []
        raw_formato = worksheet_data.formato if worksheet_data else {}
        last_edit_time = worksheet_data.last_edit_time.isoformat() if (worksheet_data and worksheet_data.last_edit_time) else None
        
        # Normalizar a tipos JSON-serializables (evita 500 en tojson del template)
        def _to_json_safe(obj):
            if obj is None: return None
            if isinstance(obj, (str, int, float, bool)): return obj
            if isinstance(obj, (datetime,)):
                return obj.isoformat() if hasattr(obj, 'isoformat') else str(obj)
            if hasattr(obj, '__float__') and callable(getattr(obj, '__float__', None)):
                try: return float(obj)
                except (TypeError, ValueError): return str(obj)
            if hasattr(obj, '__iter__') and not isinstance(obj, (str, dict)):
                return [_to_json_safe(x) for x in obj]
            if isinstance(obj, dict):
                return {str(k): _to_json_safe(v) for k, v in obj.items()}
            return str(obj)
        data = _to_json_safe(raw_data) if raw_data else []
        formato = _to_json_safe(raw_formato) if raw_formato else {}
        
        # Determinar si es solo lectura
        is_readonly = access_type == 'readonly'
        
        # ⭐ NUEVO: Obtener IP del usuario para el historial
        user_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'IP desconocida'))
        if ',' in user_ip:
            user_ip = user_ip.split(',')[0].strip()  # Tomar la primera IP si hay múltiples
        
        # ⭐ NUEVO: Obtener información del usuario logueado
        current_username = session.get('username')
        admin_user_config = current_app.config.get("ADMIN_USER", "admin")
        is_admin = current_username == admin_user_config
        is_logged_in = session.get('logged_in', False)
        
        
        try:
            result = render_template(
                'shared_worksheet.html',
                worksheet=worksheet,
                data=data,
                formato=formato,
                last_edit_time=last_edit_time,
                is_readonly=is_readonly,
                access_type=access_type,
                token=token,
                user_ip=user_ip,
                current_username=current_username,
                is_admin=is_admin,
                is_logged_in=is_logged_in,
                admin_user=admin_user_config
            )
            return result
        except Exception as template_error:
            import traceback
            current_app.logger.error(f"shared_worksheet template error: {traceback.format_exc()}")
            return f"Error renderizando: {str(template_error)}", 500
        
    except Exception as e:
        import traceback
        current_app.logger.error(f"shared_worksheet_access error: {traceback.format_exc()}")
        return f"Error: {str(e)}", 500

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/data', methods=['GET'])
def get_shared_worksheet_data(worksheet_id):
    """API para obtener datos de worksheet compartida (exenta de CSRF)"""
    try:
        token = request.args.get('token')
        access_type = request.args.get('access', 'readonly')
        
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
        
        # Verificar que el permiso esté activo (API datos)
        if permission.access_type == 'users':
            try:
                user_count = permission.users.count() if hasattr(permission, 'users') and permission.users else 0
                # Los tokens de 'users' pueden funcionar sin usuarios específicos asignados
            except Exception as e:
                # Continuar - el token público sigue siendo válido
                pass
        
        # ⭐ CORREGIDO: Verificar tipo de acceso correctamente
        # Para access_type 'readonly' acepta permisos 'view' y 'users'
        # Para access_type 'edit' acepta permisos 'edit' y 'users'
        if access_type == 'readonly' and permission.access_type not in ['view', 'users']:
            return jsonify({'error': 'Acceso no autorizado'}), 403
        elif access_type == 'edit' and permission.access_type not in ['edit', 'users']:
            return jsonify({'error': 'Acceso no autorizado'}), 403
        
        # Evitar caché de SQLAlchemy para devolver datos actuales
        db.session.expire_all()
        worksheet_data = WorksheetData.query.filter_by(template_id=worksheet_id).first()
        if not worksheet_data:
            return jsonify({'data': [], 'formato': {}, 'last_edit_time': None})
        
        current_time = worksheet_data.last_edit_time
        current_timestamp = current_time.isoformat() if current_time else None
        return jsonify({
            'data': worksheet_data.data,
            'formato': worksheet_data.formato or {},
            'last_edit_time': current_timestamp
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def _apply_worksheet_changes_for_shared(current_data, changes, num_cols):
    """Aplica cambios [[row, col, value], ...] sobre current_data (mismo formato que api.py)"""
    if not changes:
        return current_data
    result = list(current_data) if current_data else []
    for item in changes:
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            continue
        r, c, val = int(item[0]), int(item[1]), item[2]
        if r < 0 or c < 0 or (num_cols > 0 and c >= num_cols):
            continue
        while len(result) <= r:
            result.append([''] * max(num_cols, 1))
        row = result[r]
        if not isinstance(row, list):
            row = [str(row)] if row else []
        while len(row) <= c:
            row.append('')
        row[c] = val
        result[r] = row
    return result


@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/save', methods=['POST'])
def save_shared_worksheet_data(worksheet_id):
    """API para guardar datos de worksheet compartida (solo si es editable)"""
    try:
        token = request.args.get('token')
        access_type = request.args.get('access', 'edit')  # ⭐ CORREGIDO: Obtener access_type del request
        
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        # ⭐ CORREGIDO: Simplificar validación de permisos de edición
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
            
        # Solo permitir edición si el permiso lo permite
        if permission.access_type not in ['edit', 'users']:
            return jsonify({'error': 'No tienes permisos de edición'}), 403
        
        # Verificar que el permiso esté activo (API guardado)
        if permission.access_type == 'users':
            try:
                user_count = permission.users.count() if hasattr(permission, 'users') and permission.users else 0
                # Los tokens de 'users' pueden funcionar sin usuarios específicos asignados
            except Exception as e:
                # Continuar - el token público sigue siendo válido
                pass
        
        # Obtener datos del request (soporta data completo o changes para merge)
        data = request.get_json()
        rows = data.get('data')
        changes = data.get('changes')
        db.session.expire_all()  # Leer datos actuales desde BD para merge correcto
        formato = data.get('formato', {})
        template = WorksheetTemplate.query.get(worksheet_id)
        template_cols = max(len(template.fields), 1) if (template and template.fields) else 1

        if changes is not None and isinstance(changes, list):
            worksheet_data_obj = WorksheetData.query.filter_by(template_id=worksheet_id).first()
            current = (worksheet_data_obj.data if worksheet_data_obj and worksheet_data_obj.data else []) or []
            rows = _apply_worksheet_changes_for_shared(current, changes, template_cols)
        elif not isinstance(rows, list):
            return jsonify({'error': 'Datos inválidos'}), 400
        
        # ⭐ NUEVO: Registrar información del editor para el historial
        current_username = session.get('username')
        admin_user_config = current_app.config.get("ADMIN_USER", "admin")
        is_admin = current_username == admin_user_config
        
        if current_username and session.get('logged_in'):
            if is_admin:
                editor_info = f"admin ({current_username})"
            else:
                editor_info = current_username
        else:
            # Usuario anónimo
            user_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'IP desconocida'))
            if ',' in user_ip:
                user_ip = user_ip.split(',')[0].strip()
            editor_info = f'Anónimo [{user_ip}]'
        

        
        # Guardar datos
        worksheet_data = WorksheetData.query.filter_by(template_id=worksheet_id).first()
        new_timestamp = datetime.utcnow()
        
        if worksheet_data:
            worksheet_data.data = rows
            worksheet_data.formato = formato
            worksheet_data.last_editor = editor_info
            worksheet_data.last_edit_time = new_timestamp
        else:
            worksheet_data = WorksheetData(
                template_id=worksheet_id, 
                data=rows, 
                formato=formato,
                last_editor=editor_info,
                last_edit_time=new_timestamp
            )
            db.session.add(worksheet_data)
        
        db.session.commit()
        return jsonify({
            'success': True,
            'editor_info': editor_info,
            'timestamp': new_timestamp.isoformat()  # ⭐ NUEVO: Incluir timestamp en respuesta
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ============================================
# ⭐ NUEVO: SISTEMA DE SINCRONIZACIÓN EN TIEMPO REAL
# ============================================

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/changes', methods=['GET'])
def check_shared_worksheet_changes(worksheet_id):
    """API para verificar si hay cambios en worksheet compartida"""
    try:
        token = request.args.get('token')
        last_known_time = request.args.get('last_time')
        

        
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 403
        
        # Evitar caché de SQLAlchemy para devolver datos actuales
        db.session.expire_all()
        # Obtener datos actuales
        worksheet_data = WorksheetData.query.filter_by(template_id=worksheet_id).first()
        
        if not worksheet_data:
            return jsonify({
                'has_changes': False,
                'last_edit_time': None,
                'last_editor': None
            })
        
        current_time = worksheet_data.last_edit_time
        
        # Convertir timestamps para comparación
        if current_time:
            current_timestamp = current_time.isoformat()
        else:
            current_timestamp = None
        
        # ⭐ MEJORADO: Verificación más robusta de cambios
        has_changes = False
        change_reason = "sin_cambios"
        
        if not last_known_time:
            if current_timestamp:
                has_changes = True
                change_reason = "primera_carga"
        elif not current_timestamp:
            pass
        else:
            # Comparación de timestamps
            if current_timestamp != last_known_time:
                has_changes = True
                change_reason = "timestamp_diferente"
        
        result = {
            'has_changes': has_changes,
            'last_edit_time': current_timestamp,
            'last_editor': worksheet_data.last_editor,
            'data': worksheet_data.data if has_changes else None,
            'formato': worksheet_data.formato if has_changes else None,
        }
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================
# ⭐ NUEVO: SISTEMA DE PRESENCIA EN TIEMPO REAL
# ============================================

# ELIMINADO: Imports de viewers (código muerto)
# from app.store.presence import add_viewer, remove_viewer, get_active_viewers, cleanup_inactive_viewers

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/presence', methods=['POST'])
def update_presence(worksheet_id):
    """Actualizar presencia de usuario en worksheet"""
    try:
        token = request.args.get('token')
        data = request.get_json()
        
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
        
        # Obtener información del usuario/IP
        user_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'IP desconocida'))
        if ',' in user_ip:
            user_ip = user_ip.split(',')[0].strip()
        
        session_id = data.get('session_id') or f"anon_{user_ip}_{int(time.time())}"
        action = data.get('action', 'viewing')  # 'viewing' o 'left'
        
        # ⭐ NUEVO: Verificar si el usuario está logueado
        current_username = session.get('username')
        admin_user_config = current_app.config.get("ADMIN_USER", "admin")
        is_admin = current_username == admin_user_config
        

        
        if action == 'viewing':
            # ⭐ NUEVO: Determinar el nombre del usuario
            if current_username and session.get('logged_in'):
                if is_admin:
                    user_display_name = f"admin ({current_username})"
                else:
                    user_display_name = current_username
            else:
                # Usuario anónimo
                user_display_name = f'Anónimo [{user_ip}]'
            
            user_info = {
                'user': user_display_name,
                'ip': user_ip,
                'access_type': permission.access_type,
                'is_logged_user': session.get('logged_in', False)
            }
        # ELIMINADO: Llamadas a funciones de viewers (código muerto)
        # if action == 'viewing':
        #     add_viewer(worksheet_id, session_id, user_info)
        # elif action == 'left':
        #     remove_viewer(worksheet_id, session_id, is_real_disconnect=True)
        # 
        # cleanup_inactive_viewers(worksheet_id, timeout=600)
        
        return jsonify({'success': True, 'session_id': session_id})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ELIMINADO: Ruta de viewers compartidos (código muerto)
# @store_bp.route('/api/shared/worksheet/<int:worksheet_id>/viewers', methods=['GET'])

# ⭐ NUEVO: Endpoint para registrar actividad específica del usuario en modo compartido
@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/activity', methods=['POST'])
def register_shared_user_activity(worksheet_id):
    """API para registrar actividad específica del usuario compartido"""
    try:
        token = request.args.get('token')
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 403
        
        data = request.get_json()
        activity_type = data.get('activity_type', 'interaction')
        
        # Importar función de presencia
        from app.store.presence import update_user_activity
        
        # ⭐ NUEVO: Verificar si el usuario está logueado
        current_username = session.get('username')
        admin_user_config = current_app.config.get("ADMIN_USER", "admin")
        is_admin = current_username == admin_user_config
        
        if current_username and session.get('logged_in'):
            if is_admin:
                user_identifier = f"admin ({current_username})"
            else:
                user_identifier = current_username
        else:
            # Usuario anónimo
            user_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', '127.0.0.1'))
            if ',' in user_ip:
                user_ip = user_ip.split(',')[0].strip()
            user_identifier = f"Anónimo [{user_ip}]"
        
        # Registrar actividad
        update_user_activity(worksheet_id, user_identifier)
        
        return jsonify({
            'success': True,
            'activity_type': activity_type,
            'user': user_identifier
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================
# ⭐ NUEVO: ENDPOINTS PARA HISTORIAL DE CAMBIOS (SISTEMA UNIFICADO)
# ============================================

# ⭐ NUEVO: Importar el sistema unificado de historial
from app.store.history_manager import (
    add_change_to_history, 
    get_worksheet_history, 
    clear_worksheet_history,
    merge_histories,
    validate_change
)

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/history', methods=['POST'])
def save_shared_worksheet_history(worksheet_id):
    """API para guardar historial de cambios de un worksheet (modo compartido) - SISTEMA UNIFICADO"""
    try:
        token = request.args.get('token')
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
        
        data = request.get_json()
        change = data.get('change')
        full_history = data.get('full_history', [])
        
        if not change:
            return jsonify({'error': 'Datos de cambio requeridos'}), 400
        
        # Validar el cambio
        if not validate_change(change):
            return jsonify({'error': 'Datos de cambio inválidos'}), 400
        
        # Agregar el cambio al historial unificado
        success = add_change_to_history(worksheet_id, change)
        
        if success:
            # Obtener el historial actualizado
            current_history = get_worksheet_history(worksheet_id)
            

            
            return jsonify({
                'success': True,
                'message': 'Historial guardado correctamente',
                'total_changes': len(current_history),
                'history': current_history  # Devolver historial actualizado
            })
        else:
            return jsonify({'error': 'Error guardando el cambio'}), 500
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/history', methods=['GET'])
def get_shared_worksheet_history(worksheet_id):
    """API para obtener historial de cambios de un worksheet (modo compartido) - SISTEMA UNIFICADO"""
    try:
        token = request.args.get('token')
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
        
        # Obtener historial del sistema unificado
        history = get_worksheet_history(worksheet_id)
        

        
        return jsonify({
            'success': True,
            'history': history,
            'total_changes': len(history)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/history', methods=['DELETE'])
def clear_shared_worksheet_history(worksheet_id):
    """API para limpiar historial de cambios de un worksheet (modo compartido) - ACCESO DENEGADO"""
    # ⭐ SEGURIDAD: Denegar acceso para limpiar historial en modo compartido
    
    return jsonify({
        'error': 'Acceso denegado',
        'message': 'Solo el administrador puede limpiar el historial de cambios'
    }), 403


# ============================================================================
# RUTAS PARA EL SISTEMA DE CHAT DE SOPORTE
# ============================================================================

from app.models.chat import ChatMessage, ChatSession
from app.models.user import User

@store_bp.route('/api/chat/send_message', methods=['POST'])
@chat_access_required
def send_chat_message():
    """Enviar mensaje de chat con soporte para archivos"""
    
    
    # Procesar mensaje de chat
    try:
        # Importar modelos
        from app.models.chat import ChatMessage, ChatSession
        
        # Verificar el Content-Type para determinar cómo procesar la petición
        content_type = request.headers.get('Content-Type', '')
        
        # Verificar si la request excede el límite
        if 'Content-Length' in request.headers:
            content_length = int(request.headers['Content-Length'])
            max_content_length = current_app.config.get('MAX_CONTENT_LENGTH', 16 * 1024 * 1024)  # 16MB por defecto
            
            if content_length > max_content_length:
                # Request excede MAX_CONTENT_LENGTH
                return jsonify({
                    'status': 'error',
                    'message': f'El archivo es demasiado grande. Máximo permitido: {max_content_length // (1024*1024)}MB'
                }), 413

        
        if 'multipart/form-data' in content_type:
            # Es FormData (con o sin archivos)
            message = request.form.get('message', '').strip()
            recipient_id = request.form.get('recipient_id')
            

            
            # Obtener todos los archivos (file_0, file_1, file_2, etc.)
            files = []
            index = 0
            while f'file_{index}' in request.files:
                file = request.files[f'file_{index}']
                if file and file.filename:
                    # Verificar que el archivo tenga contenido real
                    # Flask puede reportar content_length = 0, pero el archivo puede tener contenido
                    file.seek(0, 2)  # Ir al final del archivo
                    actual_size = file.tell()
                    file.seek(0)  # Volver al inicio
                    
                    # Solo agregar archivos con contenido real
                    if actual_size > 0:

                        files.append(file)
                    else:
                        pass
                else:
                    pass
                index += 1
            
            # Verificar que haya archivos válidos si se enviaron
            if 'file_0' in request.files and len(files) == 0:
                return jsonify({
                    'status': 'error', 
                    'message': 'Error: Los archivos se corrompieron durante la transmisión. Intenta de nuevo.'
                }), 500
            
            # Permitir mensajes vacíos si hay archivos
            if not files and not message:
                return jsonify({'status': 'error', 'message': 'El mensaje o archivo no puede estar vacío'}), 400
            
            # Si hay archivos, el mensaje puede estar vacío
            if files and not message:
                message = ""  # Asegurar que el mensaje esté vacío, no None
        else:
            # Es JSON
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'Datos JSON requeridos'}), 400
            message = data.get('message', '').strip()
            recipient_id = data.get('recipient_id')
            files = []
            
            if not message:
                return jsonify({'status': 'error', 'message': 'El mensaje no puede estar vacío'}), 400
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Determinar el tipo de mensaje
        message_type = 'user'
        if current_user.username == current_app.config.get('ADMIN_USER', 'admin'):
            message_type = 'admin'
        elif current_user.is_support:
            message_type = 'support'
        
        # Si es admin o soporte, el recipient_id es obligatorio
        if message_type in ['admin', 'support'] and not recipient_id:
            return jsonify({'status': 'error', 'message': 'ID de destinatario requerido'}), 400
        
        # Si es usuario normal, usar el recipient_id enviado por el frontend
        if message_type == 'user':
            # Si el frontend NO envió recipient_id, usar el admin por defecto
            if not recipient_id:
                admin_user = User.query.filter_by(username=current_app.config.get('ADMIN_USER', 'admin')).first()
                if not admin_user:
                    return jsonify({'status': 'error', 'message': 'Admin no disponible'}), 503
                recipient_id = admin_user.id
                pass
            else:
                pass
        elif not recipient_id:
            return jsonify({'status': 'error', 'message': 'ID de destinatario requerido'}), 400
        
        # Solo crear chat_message si hay mensaje de texto O si no hay archivos
        chat_message = None
        if message or not files:
            chat_message = ChatMessage(
                sender_id=current_user.id,
                recipient_id=recipient_id,
                message=message or "Mensaje sin texto",
                message_type=message_type
            )
            db.session.add(chat_message)
        else:
            pass
        
        # Procesar archivos si existen
        if files:
            import os
            from werkzeug.utils import secure_filename
            
            # Crear directorio de uploads si no existe
            upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')


            
            # Verificar si el directorio existe y tiene permisos
            if os.path.exists(upload_dir):

                # Verificar permisos
                try:
                    test_file = os.path.join(upload_dir, 'test_permissions.tmp')
                    with open(test_file, 'w') as f:
                        f.write('test')
                    os.remove(test_file)

                except Exception as perm_error:
                    # Error de permisos en directorio
                    return jsonify({
                        'status': 'error',
                        'message': f'Error de permisos en el directorio de uploads: {str(perm_error)}'
                    }), 500
            else:

                try:
                    os.makedirs(upload_dir, exist_ok=True)
                except Exception as dir_error:
                    # Error al crear directorio
                    return jsonify({
                        'status': 'error',
                        'message': f'Error al crear directorio de uploads: {str(dir_error)}'
                    }), 500
            
            # Procesar cada archivo
            for file in files:
                if file and file.filename:
                    # Verificar que el archivo tenga contenido REAL (no confiar en content_length)
                    file.seek(0, 2)  # Ir al final del archivo
                    file_size = file.tell()
                    file.seek(0)  # Volver al inicio
                    
                    # Solo verificar el tamaño real, no content_length
                    if file_size == 0:
                        continue
                    
                    # Generar nombre seguro
                    filename = secure_filename(file.filename)
                    timestamp = get_colombia_now().strftime('%Y%m%d_%H%M%S')
                    unique_filename = f"{timestamp}_{filename}"
                    
                    # Determinar tipo de archivo
                    if file.content_type.startswith('image/'):
                        file_type = 'image'
                    elif file.content_type.startswith('video/'):
                        file_type = 'video'
                    elif file.content_type.startswith('audio/'):
                        file_type = 'audio'
                    elif file.content_type == 'application/pdf':
                        file_type = 'application/pdf'
                    else:
                        file_type = 'unknown'
                    
                    # Verificar que el directorio existe antes de guardar
                    if not os.path.exists(upload_dir):
                        os.makedirs(upload_dir, exist_ok=True)
                    
                    # Guardar archivo
                    file_path = os.path.join(upload_dir, unique_filename)
                    
                    try:
                        # ✅ NUEVO: Verificar que el archivo tenga contenido antes de guardar
                        file.seek(0, 2)  # Ir al final
                        file_size_before = file.tell()
                        file.seek(0)  # Volver al inicio
                        
                        if file_size_before == 0:
                            continue
                        
                        # Guardar archivo
                        file.save(file_path)
                        
                        # Verificar inmediatamente después de guardar
                        if os.path.exists(file_path):
                            saved_size = os.path.getsize(file_path)
                            
                            # Verificar que el tamaño coincida
                            if saved_size != file_size_before:
                                # Intentar eliminar el archivo corrupto
                                try:
                                    os.remove(file_path)
                                except Exception as del_error:
                                    pass
                                continue
                        else:
                            continue
                            
                    except Exception as save_error:
                        # Error al guardar archivo
                        continue
                    
                    # Verificar que el archivo se guardó y tiene contenido
                    if os.path.exists(file_path):
                        saved_size = os.path.getsize(file_path)
                        
                        # Verificar que el archivo guardado no esté vacío
                        if saved_size == 0:
                            # Intentar eliminar el archivo vacío
                            try:
                                os.remove(file_path)
                            except Exception as del_error:
                                pass
                            continue
                    else:
                        continue
                    
                    # Crear mensaje para el archivo
                    file_message = ChatMessage(
                        sender_id=current_user.id,
                        recipient_id=recipient_id,
                        message=f"Archivo: {filename}",
                        message_type=message_type,
                        has_attachment=True,
                        attachment_type=file_type,
                        attachment_filename=filename,
                        attachment_path=unique_filename,
                        attachment_size=saved_size
                    )
                    
                    db.session.add(file_message)
                    
                    # Emitir evento SocketIO para archivos en tiempo real
                    try:
                        # Llamar al endpoint interno para emitir SocketIO
                        import requests
                        file_message_data = file_message.to_dict()
                        socketio_data = {
                            'message_data': file_message_data,
                            'sender_id': current_user.id,
                            'recipient_id': recipient_id
                        }
                        
                        # Llamada interna al endpoint SocketIO
                        response = requests.post(
                            'http://127.0.0.1:5001/api/chat/socketio_emit',
                            json=socketio_data,
                            headers={'Content-Type': 'application/json'}
                        )
                        
                        if response.status_code != 200:
                            pass
                        
                    except Exception as socket_error:
                        # No fallar si falla SocketIO
                        pass
        
        # Solo hacer commit si hay mensajes para guardar
        if chat_message or files:
            db.session.commit()
        else:
            pass
        
        # Actualizar sesión de chat solo si recipient_id es válido
        if recipient_id:
            try:
                session = ChatSession.get_or_create_session(recipient_id)
                session.update_activity()
            except Exception as e:
                # Si hay error con la sesión, continuar sin fallar
                pass
        
        # Solo almacenar en historial local si hay chat_message
        if chat_message:
            try:
                message_data = chat_message.to_dict()
                
                # Almacenar mensaje en historial local para ambos usuarios
                if message_type == 'user':
                    # Usuario normal enviando al soporte
                    # store_message no existe, saltamos esta parte por ahora
                    pass
                    
                elif message_type in ['admin', 'support']:
                    # Admin/soporte enviando a un usuario
                    # store_message no existe, saltamos esta parte por ahora
                    pass
                
                # Emitir evento SocketIO para actualización en tiempo real
                try:
                    # Llamar al endpoint interno para emitir SocketIO
                    import requests
                    socketio_data = {
                        'message_data': message_data,
                        'sender_id': current_user.id,
                        'recipient_id': recipient_id
                    }
                    
                    # Llamada interna al endpoint SocketIO
                    socketio_port = current_app.config.get('SOCKETIO_PORT', 5001)
                    response = requests.post(
                        f'http://127.0.0.1:{socketio_port}/api/chat/socketio_emit',
                        json=socketio_data,
                        headers={'Content-Type': 'application/json'}
                    )
                    
                    if response.status_code != 200:
                        pass
                    
                except Exception as socket_error:
                    # No fallar si falla SocketIO
                    pass
            
            except Exception as e:
                # No fallar si falla el historial local
                pass
        else:
            pass
        
        # Verificar que todos los archivos se guardaron correctamente
        if files:
    
            corrupted_files = []
            
            for i, file in enumerate(files):
                if f'file_{i}' in request.files:
                    file_obj = request.files[f'file_{i}']
                    if file_obj and file_obj.filename:
                        filename = secure_filename(file_obj.filename)
                        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
                        unique_filename = f"{timestamp}_{filename}"
                        file_path = os.path.join(upload_dir, unique_filename)
                        
                        if os.path.exists(file_path):
                            final_size = os.path.getsize(file_path)
            
                            
                            # Verificar que el archivo no esté corrupto
                            if final_size == 0:
                                corrupted_files.append(unique_filename)
                        else:
                            corrupted_files.append(unique_filename)
            
            # Si hay archivos corruptos, no enviar el mensaje
            if corrupted_files:
                # Intentar limpiar archivos corruptos
                for corrupted_file in corrupted_files:
                    try:
                        corrupted_path = os.path.join(upload_dir, corrupted_file)
                        if os.path.exists(corrupted_path):
                            os.remove(corrupted_path)
                    except Exception as e:
                        pass
                
                return jsonify({
                    'status': 'error',
                    'message': 'Error: Los archivos se corrompieron durante el envío. Intenta de nuevo.'
                }), 500
        
        # Respuesta exitosa que maneja tanto mensajes como archivos
        if chat_message and files:
            # Hay tanto mensaje como archivos
            response_data = chat_message.to_dict()
            response_data['has_attachment'] = True
            response_data['attachment_count'] = len(files)
            response_message = 'Mensaje con archivos enviado correctamente'
        elif chat_message and not files:
            # Solo mensaje de texto
            response_data = chat_message.to_dict()
            response_message = 'Mensaje enviado correctamente'
        elif not chat_message and files:
            # Solo archivos (sin mensaje de texto) - incluir TODOS los archivos enviados
            # Obtener información de TODOS los archivos procesados exitosamente
            all_file_messages = []
            if files and len(files) > 0:
                # Buscar TODOS los archivos procesados en esta sesión
                recent_messages = db.session.query(ChatMessage).filter_by(
                    sender_id=current_user.id,
                    recipient_id=recipient_id,
                    has_attachment=True
                ).order_by(ChatMessage.created_at.desc()).limit(len(files)).all()
                
                # Invertir para mantener el orden original
                recent_messages.reverse()
                
                for file_message in recent_messages:
                    file_info = file_message.to_dict()
                    all_file_messages.append(file_info)
                
                if all_file_messages:
                    # Devolver ARRAY con todos los archivos
                    response_data = all_file_messages
                    response_message = f'{len(all_file_messages)} archivos enviados correctamente'
                else:
                    # Fallback si no se encuentran los archivos
                    response_data = {
                        'id': 'files_only',
                        'message': 'Archivos enviados',
                        'has_attachment': True,
                        'attachment_count': len(files),
                        'sender_id': current_user.id,
                        'recipient_id': recipient_id,
                        'message_type': message_type,
                        'created_at': get_colombia_now().isoformat(),
                        'attachment_type': 'unknown',
                        'attachment_filename': 'Archivo enviado',
                        'attachment_path': 'unknown'
                    }
                    response_message = 'Archivos enviados correctamente'
            else:
                # No hay archivos
                response_data = {'error': 'No hay archivos para enviar'}
                response_message = 'Error: No hay archivos para enviar'
        else:
            # No debería llegar aquí, pero por seguridad
            response_data = {'error': 'No hay mensaje ni archivos'}
            response_message = 'Error: No hay contenido para enviar'
        
        return jsonify({
            'status': 'success',
            'message': response_message,
            'data': response_data
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Error interno del servidor. Intenta de nuevo.'}), 500

# Limpiar archivos corruptos
@store_bp.route('/api/chat/cleanup_corrupted_files', methods=['POST'])
@chat_access_required
def cleanup_corrupted_files():
    """Limpiar archivos corruptos o vacíos del chat"""
    try:
        import os
        
        # Directorio de uploads
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        
        if not os.path.exists(upload_dir):
            return jsonify({'status': 'error', 'message': 'Directorio de uploads no encontrado'}), 404
        
        # Buscar archivos corruptos
        corrupted_files = []
        total_files = 0
        
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            if os.path.isfile(file_path):
                total_files += 1
                file_size = os.path.getsize(file_path)
                
                if file_size == 0:
                    corrupted_files.append(filename)
        
        # Eliminar archivos corruptos
        deleted_count = 0
        for filename in corrupted_files:
            try:
                file_path = os.path.join(upload_dir, filename)
                os.remove(file_path)
                deleted_count += 1
            except Exception as e:
                pass
        
        return jsonify({
            'status': 'success',
            'message': f'Limpieza completada. {deleted_count} archivos corruptos eliminados de {total_files} total.',
            'deleted_count': deleted_count,
            'total_files': total_files
        })
        
    except Exception as e:
        # Error en limpieza de archivos
        return jsonify({'status': 'error', 'message': 'Error al limpiar archivos corruptos'}), 500


# Regenerar lista de archivos
@store_bp.route('/api/chat/regenerate_files', methods=['POST'])
@chat_access_required
def regenerate_files():
    """Regenerar lista de archivos disponibles"""
    try:
        import os
        
        # Directorio de uploads
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        
        if not os.path.exists(upload_dir):
            return jsonify({'status': 'error', 'message': 'Directorio de uploads no encontrado'}), 404
        
        # Listar todos los archivos válidos
        valid_files = []
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            if os.path.isfile(file_path):
                file_size = os.path.getsize(file_path)
                if file_size > 0:
                    valid_files.append({
                        'filename': filename,
                        'size': file_size,
                        'path': file_path
                    })
        
        return jsonify({
            'status': 'success',
            'message': f'Lista regenerada. {len(valid_files)} archivos válidos encontrados.',
            'files': valid_files
        })
        
    except Exception as e:
        # Error al regenerar lista de archivos
        return jsonify({'status': 'error', 'message': 'Error al regenerar lista de archivos'}), 500

# Verificar archivo específico
@store_bp.route('/api/chat/check_file/<filename>', methods=['GET'])
@chat_access_required
def check_file(filename):
    """Verificar si un archivo específico existe y es accesible"""
    try:
        import os
        
        # Directorio de uploads
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        file_path = os.path.join(upload_dir, filename)
        
        if not os.path.exists(upload_dir):
            return jsonify({
                'status': 'error',
                'message': 'Directorio de uploads no encontrado',
                'exists': False
            }), 404
        
        if not os.path.exists(file_path):
            return jsonify({
                'status': 'error',
                'message': 'Archivo no encontrado',
                'exists': False,
                'filename': filename,
                'upload_dir': upload_dir
            }), 404
        
        if not os.path.isfile(file_path):
            return jsonify({
                'status': 'error',
                'message': 'No es un archivo válido',
                'exists': False
            }), 400
        
        file_size = os.path.getsize(file_path)
        
        return jsonify({
            'status': 'success',
            'message': 'Archivo encontrado',
            'exists': True,
            'filename': filename,
            'size': file_size,
            'path': file_path
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al verificar archivo: {str(e)}'}), 500

# Forzar estado finished para testing
@store_bp.route('/api/chat/force_finished_status', methods=['POST'])
@chat_access_required
def force_finished_status():
    """Forzar estado finished para testing (solo admin)"""
    try:
        # Procesar petición para forzar estado finished
        
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'Datos JSON requeridos'}), 400
        
        user_id = data.get('user_id')
        if not user_id:
            return jsonify({'status': 'error', 'message': 'user_id es requerido'}), 400
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Solo admin puede forzar estados
        if current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            return jsonify({'status': 'error', 'message': 'Solo el administrador puede forzar estados'}), 403
        
        # Forzar estado finished
        try:
            from app.models.chat import ChatSession
            
            chat_session = ChatSession.query.filter_by(user_id=user_id).first()
            if not chat_session:
                # Crear nueva sesión si no existe
                chat_session = ChatSession(user_id=user_id)
                db.session.add(chat_session)
            
            # Forzar estado finished
            chat_session.update_chat_status('finished')
            
            # Estado forzado a finished
            
            return jsonify({
                'status': 'success',
                'message': 'Estado forced a finished correctamente',
                'data': {
                    'user_id': user_id,
                    'status': 'finished',
                    'forced_by': current_user.username
                }
            })
            
        except Exception as e:
            # Error al forzar estado finished
            db.session.rollback()
            return jsonify({'status': 'error', 'message': 'Error al forzar estado'}), 500
        
    except Exception as e:
        # Error al forzar estado finished
        return jsonify({'status': 'error', 'message': 'Error interno del servidor'}), 500

# Enviar mensaje del sistema (para chat finalizado)
@store_bp.route('/api/chat/send_system_message', methods=['POST'])
@chat_access_required
def send_system_message():
    """Enviar mensaje del sistema (para chat finalizado)"""
    try:
        # Procesar petición para enviar mensaje del sistema
        
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'Datos JSON requeridos'}), 400
        
        user_id = data.get('user_id')
        message = data.get('message')
        message_type = data.get('message_type', 'system')
        
        if not user_id or not message:
            return jsonify({'status': 'error', 'message': 'user_id y message son requeridos'}), 400
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Solo admin y usuarios de soporte pueden enviar mensajes del sistema
        if not current_user.is_support and current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            return jsonify({'status': 'error', 'message': 'No tienes permisos para enviar mensajes del sistema'}), 403
        
        # Crear y guardar el mensaje del sistema en la base de datos
        try:
            from app.models.chat import ChatMessage
            from app.models.user import User
            
            # Crear el mensaje del sistema
            system_message = ChatMessage(
                sender_id=current_user.id,  # El admin/soporte es el "remitente"
                recipient_id=user_id,
                message=message,
                message_type='system'  # Usar message_type='system' en lugar de is_system
            )
            
            db.session.add(system_message)
            db.session.commit()
            
            # Mensaje del sistema guardado correctamente
            
            return jsonify({
                'status': 'success',
                'message': 'Mensaje del sistema enviado correctamente',
                'data': {
                    'message_id': system_message.id,
                    'user_id': user_id,
                    'message': message,
                    'message_type': 'system',  # Siempre 'system'
                    'created_at': system_message.created_at.isoformat() if system_message.created_at else None
                }
            })
            
        except Exception as e:
            # Error al guardar mensaje del sistema
            db.session.rollback()
            return jsonify({'status': 'error', 'message': 'Error al guardar mensaje del sistema'}), 500
        
    except Exception as e:
        # Error al enviar mensaje del sistema
        return jsonify({'status': 'error', 'message': 'Error interno del servidor'}), 500

# Limpiar estados obsoletos del chat
@store_bp.route('/api/chat/cleanup_obsolete_statuses', methods=['POST'])
@chat_access_required
def cleanup_obsolete_chat_statuses():
    """Limpiar estados obsoletos del chat (finished cuando hay mensajes nuevos)"""
    try:
        # Iniciar limpieza de estados obsoletos
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Solo admin y usuarios de soporte pueden limpiar estados
        if not current_user.is_support and current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            return jsonify({'status': 'error', 'message': 'No tienes permisos para limpiar estados'}), 403
        
        from app.models.chat import ChatSession, ChatMessage
        
        # Buscar sesiones con estado 'finished' que tengan mensajes nuevos
        finished_sessions = ChatSession.query.filter_by(status='finished').all()
        cleaned_count = 0
        
        for session in finished_sessions:
            if session.last_activity:
                # Verificar si hay mensajes más recientes
                newer_messages = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == session.user_id,
                        ChatMessage.recipient_id == session.user_id
                    ),
                    ChatMessage.created_at > session.last_activity
                ).count()
                
                if newer_messages > 0:
                    # Hay mensajes nuevos, recalcular estado
                    last_message = ChatMessage.query.filter(
                        db.or_(
                            ChatMessage.sender_id == session.user_id,
                            ChatMessage.recipient_id == session.user_id
                        )
                    ).order_by(ChatMessage.created_at.desc()).first()
                    
                    if last_message:
                        # Determinar nuevo estado basándose en el último mensaje
                        admin_username = current_app.config.get('ADMIN_USER', 'admin')
                        admin_user = User.query.filter_by(username=admin_username).first()
                        support_users = User.query.filter_by(is_support=True).all()
                        support_user_ids = [u.id for u in support_users]
                        
                        if last_message.sender_id == session.user_id:
                            new_status = 'new_message'  # 🟢 Verde
                        elif last_message.sender_id != session.user_id and (last_message.sender_id == admin_user.id or last_message.sender_id in support_user_ids):
                            new_status = 'responded'  # 🔵 Azul
                        else:
                            new_status = 'pending'  # ⚪ Gris
                        
                        # Actualizar estado
                        session.update_chat_status(new_status)
                        cleaned_count += 1
                        # Sesión limpiada correctamente
        
        # Limpieza completada
        
        return jsonify({
            'status': 'success',
            'message': f'Limpieza completada. {cleaned_count} estados obsoletos actualizados',
            'data': {
                'cleaned_count': cleaned_count,
                'updated_by': current_user.username
            }
        })
        
    except Exception as e:
        # Error al limpiar estados obsoletos
        return jsonify({'status': 'error', 'message': 'Error interno del servidor'}), 500

# Actualizar estado del chat (finalizado, respondido, etc.)
@store_bp.route('/api/chat/update_chat_status', methods=['POST'])
@chat_access_required
def update_chat_status():
    """Actualizar estado del chat (finalizado, respondido, etc.)"""
    try:
        # Procesar petición para actualizar estado del chat
        
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'Datos JSON requeridos'}), 400
        
        user_id = data.get('user_id')
        new_status = data.get('status')
        
        if not user_id or not new_status:
            return jsonify({'status': 'error', 'message': 'user_id y status son requeridos'}), 400
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Solo admin y usuarios de soporte pueden actualizar estados
        if not current_user.is_support and current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            return jsonify({'status': 'error', 'message': 'No tienes permisos para actualizar estados'}), 403
        
        # Almacenar el estado del chat en la base de datos
        try:
            from app.models.chat import ChatSession
            chat_session = ChatSession.get_or_create_session(user_id)
            chat_session.update_chat_status(new_status)
            # Estado del chat actualizado correctamente
        except Exception as e:
            # Error al actualizar sesión de chat
            # Si falla, continuar sin afectar la respuesta
            pass
        
        return jsonify({
            'status': 'success',
            'message': 'Estado del chat actualizado correctamente',
            'data': {
                'user_id': user_id,
                'status': new_status,
                'updated_by': current_user.username
            }
        })
        
    except Exception as e:
        # Error al actualizar estado del chat
        return jsonify({'status': 'error', 'message': 'Error interno del servidor'}), 500



@store_bp.route('/api/chat/get_messages', methods=['GET'])
@chat_access_required
def get_chat_messages():
    """Obtener mensajes de chat"""
    try:
        # Importar modelo
        from app.models.chat import ChatMessage
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Para usuarios normales, obtener conversación con soporte
        if not current_user.is_support and current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            # Obtener TODOS los mensajes donde el usuario esté involucrado
            messages = ChatMessage.query.filter(
                db.or_(
                    ChatMessage.sender_id == current_user.id,
                    ChatMessage.recipient_id == current_user.id
                )
            ).order_by(ChatMessage.created_at.asc()).limit(100).all()
        else:
            # Para admin/soporte, obtener conversación normal
            messages = ChatMessage.get_conversation(current_user.id, limit=100)
        
        # Marcar mensajes como leídos
        ChatMessage.mark_as_read(current_user.id)
        
        # Convertir a formato JSON
        messages_data = [msg.to_dict() for msg in messages]
        
        return jsonify({
            'status': 'success',
            'data': messages_data
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al obtener mensajes: {str(e)}'}), 500

@store_bp.route('/api/chat/get_user_messages', methods=['GET'])
@chat_access_required
def get_user_chat_messages():
    """Obtener mensajes de chat para usuarios normales (con restricciones de tienda)"""
    try:
        # Importar modelo
        from app.models.chat import ChatMessage
        
        # El decorador @chat_access_required ya verifica la autenticación
        # Usar get_current_user() que es más robusto
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        

        
        # Obtener TODOS los mensajes donde el usuario esté involucrado
        # Esto incluye mensajes enviados POR el usuario y mensajes enviados AL usuario
        messages = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == current_user.id,
                ChatMessage.recipient_id == current_user.id
            )
        ).order_by(ChatMessage.created_at.asc()).limit(100).all()
        
        # Marcar mensajes como leídos
        ChatMessage.mark_as_read(current_user.id)
        
        # Convertir a formato JSON
        messages_data = [msg.to_dict() for msg in messages]
        
        return jsonify({
            'status': 'success',
            'data': messages_data
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al obtener mensajes: {str(e)}'}), 500

@store_bp.route('/api/chat/get_all_conversations', methods=['GET'])
@chat_access_required
def get_all_chat_conversations():
    """Obtener todas las conversaciones y estadísticas (solo admin/soporte)"""
    try:
        # Importar modelos
        from app.models.chat import ChatMessage, ChatSession
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Verificar que solo admin o soporte puedan acceder
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        if not current_user.is_support and current_user.username != admin_username:
            return jsonify({'status': 'error', 'message': 'No tienes permisos para acceder a esta información'}), 403
        
        # Obtener TODOS los usuarios (excluyendo al admin) para mostrar en la lista
        admin_user = current_app.config.get("ADMIN_USER", "admin")
        users_with_chat = User.query.filter(
            User.username != admin_user
        ).all()
        
        # Obtener sesiones activas
        active_sessions = ChatSession.get_active_sessions()
        
        # Obtener estadísticas
        total_messages = ChatMessage.query.count()
        unread_messages = ChatMessage.query.filter_by(is_read=False).count()
        
        # Preparar lista de usuarios con información de mensajes no leídos y último mensaje
        users_list = []
        for user in users_with_chat:
            # Excluir usuarios de soporte de la lista de chats
            if user.is_support:
                continue
                
            # Verificar si el usuario realmente tiene mensajes en la base de datos
            message_count = ChatMessage.query.filter(
                db.or_(
                    ChatMessage.sender_id == user.id,
                    ChatMessage.recipient_id == user.id
                )
            ).count()
            
            # Solo incluir usuarios que tengan mensajes (conversaciones activas)
            if message_count > 0:
                # Para el admin, usar la lógica correcta de unread_count
                unread_count = ChatMessage.get_unread_count_for_admin(user.id)
                
                # Obtener último mensaje del usuario
                last_message = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == user.id,
                        ChatMessage.recipient_id == user.id
                    )
                ).order_by(ChatMessage.created_at.desc()).first()
                
                if last_message:
                    # Formatear mensaje para mostrar solo extensión si es archivo
                    message_text = last_message.message
                    if last_message.has_attachment and last_message.attachment_filename:
                        # Extraer extensión del archivo
                        import os
                        file_extension = os.path.splitext(last_message.attachment_filename)[1]
                        if file_extension:
                            message_text = f"[Archivo{file_extension}]"
                        else:
                            message_text = "[Archivo]"
                    elif len(last_message.message) > 50:
                        message_text = last_message.message[:50] + '...'
                    
                    last_message_data = {
                        'message': message_text,
                        'time': last_message.created_at.isoformat() if last_message.created_at else None
                    }
                    
                    # Para sub-usuarios: mostrar "padre / subusuario" para chat independiente
                    display_name = user.username
                    if user.parent_id:
                        parent = User.query.get(user.parent_id)
                        if parent:
                            display_name = f"{parent.username} / {user.username}"
                    
                    users_list.append({
                        'id': user.id,
                        'username': user.username,
                        'display_name': display_name,
                        'parent_id': user.parent_id,
                        'can_chat': user.can_chat,
                        'unread_count': unread_count,
                        'last_message': last_message_data['message'],
                        'last_message_time': last_message_data['time']
                    })
        
        # Ordenar usuarios por último mensaje (más reciente primero)
        users_list.sort(key=lambda x: x['last_message_time'] or '', reverse=True)
        
        # Obtener todas las conversaciones
        messages = ChatMessage.get_all_conversations_for_support(limit=200)
        
        # Devolver TODOS los mensajes en orden cronológico, NO agrupados por usuario
        all_messages = []
        for msg in messages:
            all_messages.append(msg.to_dict())
        
        # Ordenar por fecha (más antiguo primero para el frontend)
        all_messages.sort(key=lambda x: x.get('created_at', ''))
        
        return jsonify({
            'status': 'success',
            'data': all_messages,  # Lista plana de mensajes
            'users_with_chat': users_list,
            'stats': {
                'total_messages': total_messages,
                'unread_messages': unread_messages,
                'users_with_chat': len(users_with_chat),
                'active_sessions': len(active_sessions)
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al obtener conversaciones: {str(e)}'}), 500

@store_bp.route('/api/chat/get_users_with_chat', methods=['GET'])
@chat_access_required
def get_users_with_chat():
    """Obtener lista de usuarios con chat activo (solo admin/soporte)"""
    try:
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Verificar que solo admin o soporte puedan acceder
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        if not current_user.is_support and current_user.username != admin_username:
            return jsonify({'status': 'error', 'message': 'No tienes permisos para acceder a esta información'}), 403
        
        # Obtener usuarios que tengan mensajes de chat (excluyendo admin y soporte)
        admin_user = current_app.config.get("ADMIN_USER", "admin")
        users_with_chat = User.query.filter(
            User.username != admin_user,
            User.is_support == False
        ).all()
        
        
        
        # Preparar lista de usuarios con información de chat
        users_list = []
        for user in users_with_chat:
            try:
                # Verificar si el usuario tiene mensajes
                from app.models.chat import ChatMessage
                message_count = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == user.id,
                        ChatMessage.recipient_id == user.id
                    )
                ).count()
                
                # Solo incluir usuarios que tengan mensajes
                if message_count > 0:
                    # Obtener mensajes no leídos para el admin
                    unread_count = ChatMessage.get_unread_count_for_admin(user.id)
                    
                    # Obtener último mensaje
                    last_message = ChatMessage.query.filter(
                        db.or_(
                            ChatMessage.sender_id == user.id,
                            ChatMessage.recipient_id == user.id
                        )
                    ).order_by(ChatMessage.created_at.desc()).first()
                    
                    if last_message:
                        # Formatear mensaje para mostrar solo extensión si es archivo
                        message_text = last_message.message
                        if last_message.has_attachment and last_message.attachment_filename:
                            # Extraer extensión del archivo
                            import os
                            file_extension = os.path.splitext(last_message.attachment_filename)[1]
                            if file_extension:
                                message_text = f"[Archivo{file_extension}]"
                            else:
                                message_text = "[Archivo]"
                        elif len(last_message.message) > 50:
                            message_text = last_message.message[:50] + '...'
                        
                        last_message_data = {
                            'message': message_text,
                            'time': last_message.created_at.isoformat() if last_message.created_at else None
                        }
                        
                        # REGLA: Morado solo si último mensaje es "Chat finalizado..."
                        # Si no: azul (admin/soporte) o verde (usuario) según message_type
                        chat_status = 'pending'
                        
                        try:
                            msg_text = last_message.message or ''
                            msg_type = (last_message.message_type or '').strip().lower()
                            # Fallback: si message_type vacío, inferir por sender (admin/soporte = responded)
                            if not msg_type and last_message.sender_id:
                                sender_user = User.query.get(last_message.sender_id)
                                if sender_user:
                                    if sender_user.username == admin_user:
                                        msg_type = 'admin'
                                    elif getattr(sender_user, 'is_support', False):
                                        msg_type = 'support'
                            if 'Chat finalizado, gracias por contactarnos' in msg_text:
                                chat_status = 'finished'  # Morado
                            elif msg_type in ('admin', 'support'):
                                chat_status = 'responded'  # Azul
                            else:
                                chat_status = 'new_message'  # Verde (usuario)
                        except Exception as e:
                            chat_status = 'pending'
                        
                        # Para sub-usuarios: mostrar "padre / subusuario" para identificar el chat independiente
                        display_name = user.username
                        if user.parent_id:
                            parent = User.query.get(user.parent_id)
                            if parent:
                                display_name = f"{parent.username} / {user.username}"
                        
                        users_list.append({
                            'id': user.id,
                            'username': user.username,
                            'display_name': display_name,
                            'parent_id': user.parent_id,
                            'can_chat': getattr(user, 'can_chat', True),
                            'unread_count': unread_count,
                            'last_message': last_message_data['message'],
                            'last_message_time': last_message_data['time'],
                            'chat_status': chat_status
                        })
            except Exception as user_error:
                # Si hay error procesando un usuario específico, continuar con el siguiente
                continue
        
        # Ordenar por último mensaje (más reciente primero)
        users_list.sort(key=lambda x: x['last_message_time'] or '', reverse=True)
        
        # Usuarios con chat activo
        
        # Si no hay usuarios con chat, devolver lista vacía pero exitosa
        if not users_list:
            # No hay usuarios con chat activo
            return jsonify({
                'status': 'success',
                'data': [],
                'message': 'No hay usuarios con chat activo'
            })
        
        return jsonify({
            'status': 'success',
            'data': users_list
        })
        
    except Exception as e:
        # Error en get_users_with_chat
        # Error en get_users_with_chat
        return jsonify({'status': 'error', 'message': f'Error al obtener usuarios: {str(e)}'}), 500



@store_bp.route('/api/chat/get_user_conversation/<int:user_id>', methods=['GET'])
@chat_access_required
def get_user_chat_conversation(user_id):
    """Obtener conversación específica de un usuario (solo admin/soporte)"""
    try:
        # Importar modelo
        from app.models.chat import ChatMessage
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Verificar que solo admin o soporte puedan acceder
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        if not current_user.is_support and current_user.username != admin_username:
            return jsonify({'status': 'error', 'message': 'No tienes permisos para acceder a esta conversación'}), 403
        
        # Verificar que el usuario existe
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        

        messages = ChatMessage.get_conversation(user_id, limit=100)
        messages_data = [msg.to_dict() for msg in messages]
        
        # Marcar mensajes como leídos desde la perspectiva del admin
        ChatMessage.mark_as_read_for_admin(user_id)
        
        # Para sub-usuarios: display_name = "padre / subusuario" (chat independiente)
        display_name = user.username
        if user.parent_id:
            parent = User.query.get(user.parent_id)
            if parent:
                display_name = f"{parent.username} / {user.username}"
        
        return jsonify({
            'status': 'success',
            'data': messages_data,
            'user_info': {
                'id': user.id,
                'username': user.username,
                'display_name': display_name,
                'is_support': user.is_support
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al obtener conversación: {str(e)}'}), 500

@store_bp.route('/api/chat/get_unread_count', methods=['GET'])
@chat_access_required
def get_unread_chat_count():
    """Obtener cantidad de mensajes no leídos"""
    try:
        # Importar modelo
        from app.models.chat import ChatMessage
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        unread_count = ChatMessage.get_unread_count(current_user.id)
        
        return jsonify({
            'status': 'success',
            'data': {'unread_count': unread_count}
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al obtener conteo: {str(e)}'}), 500

@store_bp.route('/api/chat/cleanup_old_messages', methods=['POST'])
@admin_or_support_required
def cleanup_old_chat_messages():
    """Limpiar mensajes antiguos con días personalizables"""
    try:
        from app.models.chat import ChatMessage
        
        # Obtener días desde el request
        data = request.get_json()
        days = 7  # Valor por defecto
        
        if data and 'days' in data:
            try:
                days = int(data['days'])
                # Validar rango de días (1-365)
                if days < 1 or days > 365:
                    return jsonify({'status': 'error', 'message': 'Días deben estar entre 1 y 365'}), 400
            except (ValueError, TypeError) as e:
                return jsonify({'status': 'error', 'message': 'Días debe ser un número válido'}), 400
        else:
            pass
        
        # Ejecutar limpieza con días personalizados
        result = ChatMessage.cleanup_old_messages(days=days)
        
        return jsonify({
            'status': 'success',
            'message': f'Se eliminaron {result["messages_deleted"]} mensajes antiguos (más de {days} días), {result["sessions_deleted"]} sesiones, {result["files_deleted"]} archivos y {result["orphaned_files_deleted"]} archivos huérfanos. También se limpiaron chats de {result["support_users_cleaned"]} usuarios de soporte.',
            'data': {
                'deleted_count': result["messages_deleted"],
                'sessions_deleted': result["sessions_deleted"],
                'files_deleted': result["files_deleted"],
                'orphaned_files_deleted': result["orphaned_files_deleted"],
                'support_users_cleaned': result["support_users_cleaned"],
                'days_used': days
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al limpiar mensajes: {str(e)}'}), 500

@store_bp.route('/api/chat/cleanup_all_messages', methods=['POST'])
@admin_or_support_required
def cleanup_all_chat_messages():
    """Limpiar TODOS los mensajes del chat (función agresiva)"""
    try:
        from app.models.chat import ChatMessage
        
        # Ejecutar limpieza completa
        result = ChatMessage.cleanup_all_messages()
        
        return jsonify({
            'status': 'success',
            'message': f'✅ LIMPIEZA COMPLETA FINALIZADA!\n\nSe eliminaron:\n• {result["messages_deleted"]} mensajes\n• {result["sessions_deleted"]} sesiones\n• {result["files_deleted"]} archivos\n• {result["orphaned_files_deleted"]} archivos huérfanos\n\nTotal: {result["total_cleaned"]} elementos eliminados',
            'data': {
                'messages_deleted': result['messages_deleted'],
                'sessions_deleted': result['sessions_deleted'],
                'files_deleted': result['files_deleted'],
                'orphaned_files_deleted': result['orphaned_files_deleted'],
                'total_cleaned': result['total_cleaned']
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al limpiar todos los mensajes: {str(e)}'}), 500

@store_bp.route('/api/chat/cleanup_orphaned_files', methods=['POST'])
@admin_or_support_required
def cleanup_orphaned_files():
    """Limpiar solo archivos huérfanos (archivos sin mensaje asociado)"""
    try:
        from app.models.chat import ChatMessage
        
        # Ejecutar limpieza de archivos huérfanos
        result = ChatMessage.cleanup_orphaned_files()
        
        return jsonify({
            'status': 'success',
            'message': f'✅ LIMPIEZA DE ARCHIVOS HUÉRFANOS COMPLETADA!\n\nSe eliminaron {result["orphaned_files_deleted"]} archivos huérfanos.',
            'data': {
                'orphaned_files_deleted': result['orphaned_files_deleted']
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al limpiar archivos huérfanos: {str(e)}'}), 500




    """API para obtener historial unificado (modo compartido)"""
    try:
        token = request.args.get('token')
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
        
        # Obtener estadísticas del historial
        from app.store.history_manager import get_history_stats
        stats = get_history_stats()
        
        # Obtener estadísticas
        from app.store.history_manager import get_history_stats
        stats = get_history_stats()
        
        # Obtener historial actual
        history = get_worksheet_history(worksheet_id)
        
        return jsonify({
            'success': True,
            'worksheet_id': worksheet_id,
            'history_count': len(history),
            'history': history,
            'stats': stats,
            'message': f'Historial obtenido para worksheet {worksheet_id}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500




@store_bp.route('/store/static/uploads/chat/<filename>')
def serve_chat_file(filename):
    """Servir archivos de chat (imágenes, videos, audio)"""
    try:
        # Verificar que el archivo existe
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        file_path = os.path.join(upload_dir, filename)
        
        # Verificar que el directorio existe
        if not os.path.exists(upload_dir):
            return jsonify({'error': 'Directorio de archivos no encontrado'}), 404
        
        # Verificar que el archivo existe
        if not os.path.exists(file_path):
            return jsonify({'error': 'Archivo no encontrado'}), 404
        
        # Verificar que es un archivo válido
        if not os.path.isfile(file_path):
            return jsonify({'error': 'No es un archivo válido'}), 400
        
        # Determinar el tipo MIME basado en la extensión
        import mimetypes
        mime_type, _ = mimetypes.guess_type(file_path)
        if mime_type is None:
            mime_type = 'application/octet-stream'
        
        # Usar send_file con parámetros correctos para streaming
        if mime_type and mime_type.startswith('audio/'):
            # Para audio, usar send_file con as_attachment=False para streaming
            return send_file(
                file_path, 
                mimetype=mime_type,
                as_attachment=False,
                conditional=True  # Soporte para range requests
            )
        else:
            # Para archivos que no son audio, usar send_file normal
            return send_file(file_path, mimetype=mime_type)
            
    except Exception as e:
        return jsonify({'error': f'Error al servir archivo: {str(e)}'}), 500

@store_bp.route('/api/chat/sync_messages', methods=['GET'])
@chat_access_required
def sync_messages():
    """Sincronizar mensajes perdidos desde una fecha específica"""
    try:
        from app.models.chat import ChatMessage
        from datetime import datetime, timedelta
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Obtener parámetros
        since_id = request.args.get('since')
        since_time = request.args.get('since_time')
        limit = int(request.args.get('limit', 50))
        
        # Construir consulta base
        query = ChatMessage.query
        
        # Filtrar por usuario
        if not current_user.is_support and current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            # Usuario normal: obtener mensajes donde esté involucrado
            query = query.filter(
                db.or_(
                    ChatMessage.sender_id == current_user.id,
                    ChatMessage.recipient_id == current_user.id
                )
            )
        else:
            # Admin/soporte: obtener todos los mensajes
            pass
        
        # Aplicar filtros de tiempo
        if since_id:
            # Filtrar por ID de mensaje
            since_message = ChatMessage.query.get(since_id)
            if since_message:
                query = query.filter(ChatMessage.created_at > since_message.created_at)
        elif since_time:
            # Filtrar por timestamp
            try:
                since_datetime = datetime.fromisoformat(since_time.replace('Z', '+00:00'))
                query = query.filter(ChatMessage.created_at > since_datetime)
            except ValueError:
                return jsonify({'status': 'error', 'message': 'Formato de fecha inválido'}), 400
        else:
            # Si no se especifica, obtener mensajes de las últimas 24 horas
            since_datetime = datetime.utcnow() - timedelta(hours=24)
            query = query.filter(ChatMessage.created_at > since_datetime)
        
        # Ordenar y limitar
        messages = query.order_by(ChatMessage.created_at.asc()).limit(limit).all()
        
        # Convertir a formato JSON
        messages_data = [msg.to_dict() for msg in messages]
        
        return jsonify({
            'status': 'success',
            'data': messages_data,
            'count': len(messages_data),
            'sync_time': get_colombia_now().isoformat()
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al sincronizar mensajes: {str(e)}'}), 500

@store_bp.route('/api/chat/send_audio', methods=['POST'])
@chat_access_required
def send_audio_message():
    """Enviar mensaje de audio grabado"""
    try:
        # Importar modelos
        from app.models.chat import ChatMessage, ChatSession
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Verificar que se haya enviado un archivo de audio
        if 'audio' not in request.files:
            return jsonify({'status': 'error', 'message': 'No se envió archivo de audio'}), 400
        
        audio_file = request.files['audio']
        recipient_id = request.form.get('recipient_id')
        
        if not audio_file or not audio_file.filename:
            return jsonify({'status': 'error', 'message': 'Archivo de audio inválido'}), 400
        
        if not recipient_id:
            return jsonify({'status': 'error', 'message': 'ID de destinatario requerido'}), 400
        
        # Determinar tipo de mensaje
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if current_user.username == admin_username:
            message_type = 'admin'
        elif current_user.username in ['soporte', 'soporte1', 'soporte2', 'soporte3']:
            message_type = 'support'
        else:
            message_type = 'user'
        
        # Procesar archivo de audio
        import os
        from werkzeug.utils import secure_filename
        
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        os.makedirs(upload_dir, exist_ok=True)
        
        # Crear nombre único para el archivo con extensión correcta
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        
        # Determinar extensión basada en el tipo MIME del archivo
        content_type = audio_file.content_type
        if content_type:
            if 'webm' in content_type:
                extension = '.webm'
            elif 'mp4' in content_type:
                extension = '.mp4'
            elif 'ogg' in content_type:
                extension = '.ogg'
            else:
                extension = '.wav'
        else:
            # Fallback: usar extensión del nombre original
            original_name = audio_file.filename
            if '.' in original_name:
                extension = '.' + original_name.split('.')[-1]
            else:
                extension = '.wav'
        
        filename = f"audio_{timestamp}_{current_user.username}{extension}"
        file_path = os.path.join(upload_dir, filename)
        
        # Guardar archivo de audio
        audio_file.save(file_path)
        
        # Crear mensaje de chat
        chat_message = ChatMessage(
            sender_id=current_user.id,
            recipient_id=recipient_id,
            message="",  # Sin texto para audios
            message_type=message_type,
            has_attachment=True,
            attachment_type='audio',
            attachment_filename=filename,
            attachment_path=filename,
            attachment_size=os.path.getsize(file_path)
        )
        
        db.session.add(chat_message)
        db.session.commit()
        
        # Actualizar sesión de chat
        session = ChatSession.get_or_create_session(recipient_id)
        session.update_activity()
        
        # Forzar commit para asegurar que el audio esté disponible inmediatamente
        db.session.commit()
        
        # Emitir mensaje de audio por SocketIO en tiempo real
        try:
            # Preparar datos para SocketIO
            message_dict = chat_message.to_dict()
            
            socketio_data = {
                'message_data': message_dict,
                'sender_id': current_user.id,
                'recipient_id': str(recipient_id)
            }
            
            # Llamar al servidor SocketIO para emitir en tiempo real
            socketio_port = current_app.config.get('SOCKETIO_PORT', 5001)
            socketio_response = requests.post(
                f'http://127.0.0.1:{socketio_port}/api/chat/socketio_emit',
                json=socketio_data,
                timeout=5
            )
            
            if socketio_response.status_code != 200:
                pass
                
        except Exception as socketio_error:
            pass
        
        return jsonify({
            'status': 'success',
            'message': 'Audio enviado correctamente',
            'data': chat_message.to_dict()
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': f'Error al enviar audio: {str(e)}'}), 500


@store_bp.route('/api/chat/audio/<int:message_id>')
@chat_access_required
def get_audio_file(message_id):
    """Servir archivo de audio por ID de mensaje"""
    try:
        from app.models.chat import ChatMessage
        
        # Buscar el mensaje
        chat_message = ChatMessage.query.get(message_id)
        if not chat_message:
            return jsonify({'status': 'error', 'message': 'Mensaje no encontrado'}), 404
        
        # Verificar que sea un mensaje de audio
        if not chat_message.has_attachment or chat_message.attachment_type != 'audio':
            return jsonify({'status': 'error', 'message': 'No es un mensaje de audio'}), 400
        
        # Construir ruta del archivo
        import os
        # Usar attachment_path en lugar de attachment_filename
        file_path = os.path.join(
            current_app.root_path, 
            'store', 
            'static', 
            'uploads', 
            'chat', 
            chat_message.attachment_path or chat_message.attachment_filename
        )
        
        # Verificar que el archivo existe
        if not os.path.exists(file_path):
            return jsonify({'status': 'error', 'message': 'Archivo de audio no encontrado'}), 404
        
        # Usar send_file directamente sin manejo complejo de rangos
        filename = chat_message.attachment_path or chat_message.attachment_filename
        
        # Determinar MIME type basado en la extensión del archivo
        if filename.endswith('.webm'):
            mimetype = 'audio/webm'
        elif filename.endswith('.mp4'):
            mimetype = 'audio/mp4'
        elif filename.endswith('.ogg'):
            mimetype = 'audio/ogg'
        else:
            mimetype = 'audio/wav'
        
        # Usar send_file con soporte para rangos automático
        return send_file(
            file_path,
            mimetype=mimetype,
            as_attachment=False,
            conditional=True  # Soporte automático para range requests
        )
        
    except Exception as e:
        # Error general
        return jsonify({'status': 'error', 'message': f'Error al servir audio: {str(e)}'}), 500



@store_bp.route('/api/chat/typing_status', methods=['POST'])
@admin_required
def update_typing_status():
    """Actualizar estado de escritura de un usuario"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        typing = data.get('typing', False)
        
        if not user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario requerido'}), 400
        
        # Aquí podrías almacenar el estado de escritura en la base de datos
        # Por ahora, solo retornamos éxito
        return jsonify({
            'status': 'success',
            'typing': typing,
            'user_id': user_id
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al actualizar estado de escritura: {str(e)}'}), 500



@store_bp.route('/api/chat/delete_user_chat', methods=['DELETE'])
@admin_required
def delete_user_chat():
    """Eliminar todo el chat de un usuario específico (solo admin)"""
    # Inicializar todas las variables por defecto para evitar errores
    deleted_count = 0
    deleted_sessions = 0
    files_deleted = 0
    files_errors = 0
    orphaned_files = 0
    messages_before = 0
    sessions_before = 0
    messages_after = 0
    sessions_after = 0
    user = None
    
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        
        if not user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario requerido'}), 400
        
        # Verificar que el usuario existe
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        
        # Importar modelos
        from app.models.chat import ChatMessage, ChatSession
        import os
        
        # Definir directorio de uploads ANTES de usarlo
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        
        # Verificar que el directorio existe
        if not os.path.exists(upload_dir):
            try:
                os.makedirs(upload_dir, exist_ok=True)
            except Exception as e:
                pass  # Continuar sin el directorio, solo eliminar de la base de datos
        
        # Obtener mensajes con archivos antes de eliminarlos
        messages_with_files = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            ),
            ChatMessage.has_attachment == True
        ).all()
        
        # Eliminar archivos físicos del servidor
        files_deleted = 0
        files_errors = 0
        
        # Solo intentar eliminar archivos si el directorio existe
        if os.path.exists(upload_dir) and os.path.isdir(upload_dir):
            for message in messages_with_files:
                if message.attachment_path:
                    file_path = os.path.join(upload_dir, message.attachment_path)
                    
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            files_deleted += 1
                        else:
                            pass  # Archivo no encontrado, continuar
                    except Exception as e:
                        files_errors += 1
        else:
            pass  # Directorio no existe, continuar solo con eliminación de base de datos
        
        # Verificar cuántos mensajes existen antes de eliminar
        messages_before = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).count()
        
        # Verificar cuántas sesiones existen antes de eliminar
        sessions_before = ChatSession.query.filter_by(user_id=user_id).count()
        
        # Eliminar mensajes de la base de datos
        deleted_count = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).delete()
        
        # Eliminar sesiones de chat del usuario
        deleted_sessions = ChatSession.query.filter_by(user_id=user_id).delete()
        
        # Verificar que realmente se eliminaron
        messages_after = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).count()
        
        sessions_after = ChatSession.query.filter_by(user_id=user_id).count()
        
        db.session.commit()
        
        # ✅ NUEVO: Emitir evento SocketIO para actualizar en tiempo real
        try:
            
            # Emitir evento de chat eliminado a todos los usuarios conectados
            success = emit_chat_deleted_event(
                user_id=user_id,
                username=user.username,
                messages_deleted=deleted_count,
                sessions_deleted=deleted_sessions,
                files_deleted=files_deleted
            )
            
        except Exception as socketio_error:
            import traceback
            traceback.print_exc()
        
        # Verificar que no queden archivos huérfanos
        orphaned_files = 0
        try:
            if os.path.exists(upload_dir) and os.path.isdir(upload_dir):
                for filename in os.listdir(upload_dir):
                    file_path = os.path.join(upload_dir, filename)
                    
                    # Verificar si el archivo es válido
                    if not os.path.isfile(file_path):
                        continue
                    
                    # Verificar si el archivo pertenece a algún mensaje existente
                    existing_message = ChatMessage.query.filter_by(attachment_path=filename).first()
                    if not existing_message:
                        try:
                            os.remove(file_path)
                            orphaned_files += 1
                        except Exception as e:
                            pass
                
                # Limpieza adicional: eliminar archivos temporales y caché
                temp_files = 0
                if os.path.exists(upload_dir) and os.path.isdir(upload_dir):
                    for filename in os.listdir(upload_dir):
                        if filename.startswith('temp_') or filename.startswith('cache_') or filename.endswith('.tmp'):
                            file_path = os.path.join(upload_dir, filename)
                            try:
                                if os.path.isfile(file_path):
                                    os.remove(file_path)
                                    temp_files += 1
                            except Exception as e:
                                pass
                
                orphaned_files += temp_files  # Incluir archivos temporales en el total
                    
        except Exception as e:
            pass
        return jsonify({
            'status': 'success',
            'message': f'Chat del usuario {user.username} eliminado exitosamente. {deleted_count} mensajes eliminados, {deleted_sessions} sesiones eliminadas, {files_deleted} archivos eliminados, {orphaned_files} archivos huérfanos y temporales eliminados.',
            'data': {
                'user_id': user_id,
                'username': user.username,
                'messages_deleted': deleted_count,
                'sessions_deleted': deleted_sessions,
                'files_deleted': files_deleted,
                'files_errors': files_errors,
                'orphaned_files_deleted': orphaned_files,
                'verification': {
                    'messages_before': messages_before,
                    'messages_after': messages_after,
                    'sessions_before': sessions_before,
                    'sessions_after': sessions_after,
                    'deletion_successful': messages_after == 0 and sessions_after == 0
                }
            }
        })
        
    except Exception as e:
        db.session.rollback()
        # Error interno
        
        # Las variables ya están inicializadas, solo verificar si se eliminó algo
        if deleted_count > 0:
            # La eliminación fue parcialmente exitosa
            return jsonify({
                'status': 'partial_success',
                'message': f'Chat del usuario {user.username if user else "desconocido"} eliminado parcialmente. {deleted_count} mensajes eliminados, pero hubo algunos errores menores.',
                'data': {
                    'user_id': user_id if 'user_id' in locals() else None,
                    'username': user.username if user else 'desconocido',
                    'messages_deleted': deleted_count,
                    'error_details': str(e)
                }
            })
        else:
            # Error real en la eliminación
            return jsonify({'status': 'error', 'message': f'Error al eliminar chat del usuario: {str(e)}'}), 500


@store_bp.route('/api/chat/auto_cleanup_inactive_users', methods=['POST'])
@admin_or_support_required
def auto_cleanup_inactive_users():
    """Limpieza automática: eliminar chats de usuarios inactivos por días personalizables"""
    try:
        from app.models.user import User
        from app.models.chat import ChatMessage, ChatSession
        import os
        from datetime import datetime, timedelta
        
        # Obtener días desde el request
        data = request.get_json()
        INACTIVITY_DAYS = 5  # Valor por defecto
        
        if data and 'days' in data:
            try:
                INACTIVITY_DAYS = int(data['days'])
                # Validar rango de días (1-365)
                if INACTIVITY_DAYS < 1 or INACTIVITY_DAYS > 365:
                    return jsonify({'status': 'error', 'message': 'Días deben estar entre 1 y 365'}), 400
            except (ValueError, TypeError) as e:
                return jsonify({'status': 'error', 'message': 'Días debe ser un número válido'}), 400
        else:
            pass
        
        # Configuración de inactividad personalizada
        cutoff_date = datetime.utcnow() - timedelta(days=INACTIVITY_DAYS)
        
        # Buscar usuarios inactivos (sin actividad de chat reciente)
        inactive_users = []
        total_cleanup_stats = {
            'users_processed': 0,
            'users_cleaned': 0,
            'total_messages_deleted': 0,
            'total_sessions_deleted': 0,
            'total_files_deleted': 0,
            'total_orphaned_files_deleted': 0,
            'errors': []
        }
        
        # Obtener todos los usuarios
        all_users = User.query.all()
        
        for user in all_users:
            # Verificar si el usuario es inactivo
            last_activity = get_user_last_chat_activity(user.id)
            
            if last_activity and last_activity < cutoff_date:
                inactive_users.append({
                    'user': user,
                    'last_activity': last_activity,
                    'days_inactive': (datetime.utcnow() - last_activity).days
                })
        
        # Ordenar por días de inactividad (más inactivos primero)
        inactive_users.sort(key=lambda x: x['days_inactive'], reverse=True)
        
        # Procesar cada usuario inactivo
        for user_info in inactive_users:
            user = user_info['user']
            days_inactive = user_info['days_inactive']
            
            try:
                # Limpiar chat del usuario inactivo
                cleanup_result = cleanup_inactive_user_chat(user.id)
                
                # VERIFICAR que la limpieza fue completa
                verification = verify_cleanup_completeness(user.id)
                
                total_cleanup_stats['users_processed'] += 1
                total_cleanup_stats['users_cleaned'] += 1
                total_cleanup_stats['total_messages_deleted'] += cleanup_result['messages_deleted']
                total_cleanup_stats['total_sessions_deleted'] += cleanup_result['sessions_deleted']
                total_cleanup_stats['total_files_deleted'] += cleanup_result['files_deleted']
                total_cleanup_stats['total_orphaned_files_deleted'] += cleanup_result['orphaned_files_deleted']
                
                if verification['cleanup_complete']:
                    pass
                else:
                    pass
                
            except Exception as e:
                error_msg = f"Error limpiando usuario {user.username}: {str(e)}"
                total_cleanup_stats['errors'].append(error_msg)
        
        # Limpieza final de archivos huérfanos
        final_cleanup = cleanup_orphaned_files()
        total_cleanup_stats['total_orphaned_files_deleted'] += final_cleanup
        
        # Log del resultado
        
        return jsonify({
            'status': 'success',
            'message': f'Limpieza automática completada: {total_cleanup_stats["users_cleaned"]} usuarios inactivos por {INACTIVITY_DAYS}+ días limpiados',
            'data': {
                **total_cleanup_stats,
                'days_used': INACTIVITY_DAYS
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error en limpieza automática: {str(e)}'}), 500

@store_bp.route('/api/chat/schedule_weekly_cleanup', methods=['POST'])
@admin_required
def schedule_weekly_cleanup():
    """Programar limpieza automática semanal (para ser llamada por cron job)"""
    try:
        from app.models.user import User
        from app.models.chat import ChatMessage, ChatSession
        import os
        from datetime import datetime, timedelta
        
        # Usar días por defecto para limpieza semanal
        INACTIVITY_DAYS = 5
        
        # Configuración de inactividad
        cutoff_date = datetime.utcnow() - timedelta(days=INACTIVITY_DAYS)
        
        # Buscar usuarios inactivos
        inactive_users = []
        total_cleanup_stats = {
            'users_processed': 0,
            'users_cleaned': 0,
            'total_messages_deleted': 0,
            'total_sessions_deleted': 0,
            'total_files_deleted': 0,
            'total_orphaned_files_deleted': 0,
            'errors': []
        }
        
        # Obtener todos los usuarios
        all_users = User.query.all()
        
        for user in all_users:
            # Verificar si el usuario es inactivo
            last_activity = get_user_last_chat_activity(user.id)
            
            if last_activity and last_activity < cutoff_date:
                inactive_users.append({
                    'user': user,
                    'last_activity': last_activity,
                    'days_inactive': (datetime.utcnow() - last_activity).days
                })
        
        # Ordenar por días de inactividad
        inactive_users.sort(key=lambda x: x['days_inactive'], reverse=True)
        
        # Procesar cada usuario inactivo
        for user_info in inactive_users:
            user = user_info['user']
            
            try:
                # Limpiar chat del usuario inactivo
                cleanup_result = cleanup_inactive_user_chat(user.id)
                
                # Verificar que la limpieza fue completa
                verification = verify_cleanup_completeness(user.id)
                
                total_cleanup_stats['users_processed'] += 1
                total_cleanup_stats['users_cleaned'] += 1
                total_cleanup_stats['total_messages_deleted'] += cleanup_result['messages_deleted']
                total_cleanup_stats['total_sessions_deleted'] += cleanup_result['sessions_deleted']
                total_cleanup_stats['total_files_deleted'] += cleanup_result['files_deleted']
                total_cleanup_stats['total_orphaned_files_deleted'] += cleanup_result['orphaned_files_deleted']
                
            except Exception as e:
                error_msg = f"Error limpiando usuario {user.username}: {str(e)}"
                total_cleanup_stats['errors'].append(error_msg)
        
        # Limpieza final de archivos huérfanos
        final_cleanup = cleanup_orphaned_files()
        total_cleanup_stats['total_orphaned_files_deleted'] += final_cleanup
        
        return jsonify({
            'status': 'success',
            'message': f'Limpieza semanal completada: {total_cleanup_stats["users_cleaned"]} usuarios inactivos por {INACTIVITY_DAYS}+ días limpiados',
            'data': {
                **total_cleanup_stats,
                'days_used': INACTIVITY_DAYS
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error en limpieza semanal: {str(e)}'}), 500

@store_bp.route('/api/chat/cleanup_status', methods=['GET'])
@admin_required
def get_cleanup_status():
    """Obtener estado de la limpieza automática y estadísticas"""
    try:
        from app.models.user import User
        from app.models.chat import ChatMessage, ChatSession
        from datetime import datetime, timedelta
        
        # Configuración
        INACTIVITY_DAYS = 5
        cutoff_date = datetime.utcnow() - timedelta(days=INACTIVITY_DAYS)
        
        # Estadísticas generales
        total_users = User.query.count()
        total_messages = ChatMessage.query.count()
        total_sessions = ChatSession.query.count()
        
        # Usuarios inactivos
        inactive_users = []
        all_users = User.query.all()
        
        for user in all_users:
            last_activity = get_user_last_chat_activity(user.id)
            if last_activity and last_activity < cutoff_date:
                days_inactive = (datetime.utcnow() - last_activity).days
                inactive_users.append({
                    'username': user.username,
                    'days_inactive': days_inactive,
                    'last_activity': last_activity.isoformat()
                })
        
        # Ordenar por días de inactividad
        inactive_users.sort(key=lambda x: x['days_inactive'], reverse=True)
        
        # Próxima limpieza automática
        next_cleanup = datetime.utcnow() + timedelta(days=7)
        
        return jsonify({
            'status': 'success',
            'data': {
                'total_users': total_users,
                'total_messages': total_messages,
                'total_sessions': total_sessions,
                'inactive_users_count': len(inactive_users),
                'inactive_users': inactive_users[:10],  # Top 10 más inactivos
                'next_cleanup': next_cleanup.isoformat(),
                'cleanup_config': {
                    'inactivity_days': INACTIVITY_DAYS,
                    'frequency': 'weekly',
                    'auto_execution': True
                }
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error: {str(e)}'}), 500

def get_user_last_chat_activity(user_id):
    """Obtener la última actividad de chat de un usuario"""
    try:
        from app.models.chat import ChatMessage, ChatSession
        
        # Último mensaje enviado
        last_message_sent = ChatMessage.query.filter_by(sender_id=user_id).order_by(ChatMessage.created_at.desc()).first()
        
        # Último mensaje recibido
        last_message_received = ChatMessage.query.filter_by(recipient_id=user_id).order_by(ChatMessage.created_at.desc()).first()
        
        # Última sesión de chat
        last_session = ChatSession.query.filter_by(user_id=user_id).order_by(ChatSession.last_activity.desc()).first()
        
        # Encontrar la fecha más reciente
        dates = []
        if last_message_sent:
            dates.append(last_message_sent.created_at)
        if last_message_received:
            dates.append(last_message_received.created_at)
        if last_session:
            dates.append(last_session.last_activity)
        
        if dates:
            return max(dates)
        return None
        
    except Exception as e:
        return None

def cleanup_inactive_user_chat(user_id):
    """Limpiar chat de un usuario inactivo específico - ELIMINACIÓN COMPLETA"""
    try:
        from app.models.chat import ChatMessage, ChatSession
        import os
        
        # Definir directorio de uploads
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        
        # Obtener TODOS los mensajes del usuario (con y sin archivos)
        all_user_messages = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).all()
        
        # Eliminar TODOS los archivos físicos del servidor
        files_deleted = 0
        if all_user_messages and os.path.exists(upload_dir):
            for message in all_user_messages:
                # Verificar attachment_path
                if message.attachment_path:
                    file_path = os.path.join(upload_dir, message.attachment_path)
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            files_deleted += 1
            
                    except Exception as e:
                        pass
                
                # Verificar attachment_filename (por si acaso)
                if message.attachment_filename and message.attachment_filename != message.attachment_path:
                    file_path = os.path.join(upload_dir, message.attachment_filename)
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            files_deleted += 1
            
                    except Exception as e:
                        pass
        
        # Eliminar mensajes de la base de datos
        messages_deleted = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).delete()
        
        # Eliminar sesiones de chat
        sessions_deleted = ChatSession.query.filter_by(user_id=user_id).delete()
        
        # Commit de cambios
        db.session.commit()
        

        
        return {
            'messages_deleted': messages_deleted,
            'sessions_deleted': sessions_deleted,
            'files_deleted': files_deleted,
            'orphaned_files_deleted': 0
        }
        
    except Exception as e:
        db.session.rollback()
        raise e

def cleanup_orphaned_files():
    """Limpiar archivos huérfanos después de la limpieza - ELIMINACIÓN AGRESIVA"""
    try:
        import os
        from app.models.chat import ChatMessage
        
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        if not os.path.exists(upload_dir):
            return 0
        
        orphaned_files_deleted = 0
        
        # Verificar archivos huérfanos por attachment_path
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            
            if not os.path.isfile(file_path):
                continue
            
            # Verificar si el archivo pertenece a algún mensaje existente
            existing_message_path = ChatMessage.query.filter_by(attachment_path=filename).first()
            existing_message_filename = ChatMessage.query.filter_by(attachment_filename=filename).first()
            
            if not existing_message_path and not existing_message_filename:
                try:
                    os.remove(file_path)
                    orphaned_files_deleted += 1
    
                except Exception as e:
                    pass
        
        # Limpiar archivos temporales y caché
        temp_files = 0
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            
            # Patrones de archivos temporales
            is_temp = (
                filename.startswith('temp_') or 
                filename.startswith('cache_') or 
                filename.startswith('tmp_') or
                filename.endswith('.tmp') or
                filename.endswith('.cache') or
                filename.endswith('.temp') or
                '~' in filename or
                filename.startswith('.DS_Store') or
                filename.startswith('Thumbs.db')
            )
            
            if is_temp and os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                    temp_files += 1
    
                except Exception as e:
                    pass
        
        orphaned_files_deleted += temp_files
        
        # Limpiar archivos con nombres sospechosos
        suspicious_files = 0
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            
            # Archivos con nombres sospechosos
            is_suspicious = (
                len(filename) > 100 or  # Nombres muy largos
                filename.count('.') > 5 or  # Muchos puntos
                any(char in filename for char in ['<', '>', ':', '"', '|', '?', '*']) or  # Caracteres inválidos
                filename.startswith('._') or  # Archivos del sistema
                filename.endswith('.part') or  # Archivos parciales
                filename.endswith('.crdownload')  # Descargas incompletas
            )
            
            if is_suspicious and os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                    suspicious_files += 1
    
                except Exception as e:
                    pass
        
        orphaned_files_deleted += suspicious_files
        

        
        return orphaned_files_deleted
        
    except Exception as e:
        return 0

def verify_cleanup_completeness(user_id):
    """Verificar que la limpieza fue completa para un usuario"""
    try:
        from app.models.chat import ChatMessage, ChatSession
        import os
        
        # Verificar que no queden mensajes
        remaining_messages = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).count()
        
        # Verificar que no queden sesiones
        remaining_sessions = ChatSession.query.filter_by(user_id=user_id).count()
        
        # Verificar que no queden archivos físicos
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        remaining_files = 0
        
        if os.path.exists(upload_dir):
            for filename in os.listdir(upload_dir):
                file_path = os.path.join(upload_dir, filename)
                
                if os.path.isfile(file_path):
                    # Verificar si el archivo pertenece a algún mensaje del usuario
                    message_with_file = ChatMessage.query.filter(
                        db.or_(
                            ChatMessage.sender_id == user_id,
                            ChatMessage.recipient_id == user_id
                        ),
                        db.or_(
                            ChatMessage.attachment_path == filename,
                            ChatMessage.attachment_filename == filename
                        )
                    ).first()
                    
                    if message_with_file:
                        remaining_files += 1
        
        verification_result = {
            'messages_remaining': remaining_messages,
            'sessions_remaining': remaining_sessions,
            'files_remaining': remaining_files,
            'cleanup_complete': remaining_messages == 0 and remaining_sessions == 0 and remaining_files == 0
        }
        
        if verification_result['cleanup_complete']:
            pass
        else:
            pass
        
        return verification_result
        
    except Exception as e:
        return {'error': str(e), 'cleanup_complete': False}

@store_bp.route('/api/chat/get_current_user')
def get_current_user_api():
    """Endpoint para obtener información del usuario actual del chat"""
    try:
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        user_data = {
            'id': current_user.id,
            'username': current_user.username,
            'is_admin': current_user.is_admin,
            'is_support': current_user.is_support
        }
        
        return jsonify({'status': 'success', 'data': user_data})
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

# Endpoint para SocketIO emitir mensajes
@store_bp.route('/api/chat/socketio_emit', methods=['POST'])
@chat_access_required
def socketio_emit_message():
    """Endpoint para que SocketIO emita mensajes en tiempo real"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'Datos requeridos'}), 400
        
        message_data = data.get('message_data')
        recipient_id = data.get('recipient_id')
        sender_id = data.get('sender_id')
        
        if not message_data or not recipient_id or not sender_id:
            return jsonify({'status': 'error', 'message': 'Datos incompletos'}), 400
        
        # Llamar al servidor SocketIO para emitir el evento
        try:
            import requests
            
            # Llamar al endpoint del servidor SocketIO
            socketio_data = {
                'message_data': message_data,
                'sender_id': sender_id,
                'recipient_id': recipient_id
            }
            
            socketio_port = current_app.config.get('SOCKETIO_PORT', 5001)
            response = requests.post(
                f'http://127.0.0.1:{socketio_port}/api/chat/socketio_emit',
                json=socketio_data,
                headers={'Content-Type': 'application/json'}
            )
            
            if response.status_code != 200:
                pass
                
        except Exception as socket_error:
            # No fallar si falla SocketIO
            pass
        
        return jsonify({'status': 'success', 'message': 'Mensaje emitido por SocketIO'})
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

# Ruta para favicon.ico para evitar error 404
@store_bp.route('/favicon.ico')
def favicon():
    """Servir favicon.svg directamente con tipo MIME correcto"""
    from flask import send_from_directory
    import os
    favicon_path = os.path.join(current_app.static_folder, 'images', 'favicon.svg')
    if os.path.exists(favicon_path):
        return send_from_directory(
            os.path.join(current_app.static_folder, 'images'),
            'favicon.svg',
            mimetype='image/svg+xml'
        )
    return '', 404

@store_bp.route('/api/chat/push-subscription', methods=['POST'])
def save_push_subscription():
    """Guardar suscripción push del usuario"""
    try:
        data = request.get_json()
        subscription = data.get('subscription')
        user_id = data.get('user_id')
        
        if not subscription or not user_id:
            return jsonify({
                'status': 'error',
                'message': 'Datos de suscripción incompletos'
            }), 400
        
        # Aquí podrías guardar la suscripción en la base de datos
        # Por ahora solo retornamos éxito

        
        return jsonify({
            'status': 'success',
            'message': 'Suscripción push guardada correctamente'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Error guardando suscripción push: {str(e)}'
        }), 500

# ✅ RUTAS EXISTENTES: Usar las rutas ya implementadas para actualizar permisos de usuario

# ==================== RUTAS PARA DRIVE TRANSFER ====================

@store_bp.route('/admin/drive_transfers', methods=['GET'])
@admin_required
def list_drive_transfers():
    from app.utils.timezone import get_colombia_datetime
    server_time = get_colombia_datetime()
    
    transfers = DriveTransfer.query.all()
    return jsonify({
            'server_time_colombia': server_time.strftime('%I:%M %p'),
            'transfers': [
                {
                    'id': t.id,
                    'credentials_json': t.credentials_json,
                    'drive_original_id': t.drive_original_id,
                    'drive_processed_id': t.drive_processed_id,
                    'drive_deleted_id': t.drive_deleted_id,  # Campo opcional
                    'processing_time': t.processing_time if isinstance(t.processing_time, str) else (t.processing_time.strftime('%I:%M %p') if t.processing_time else None),  # Soporta ambos formatos (legacy y nuevo)
                    'is_active': t.is_active,
                    'last_processed': t.last_processed.isoformat() if t.last_processed else None,
                    'activated_at': t.activated_at.isoformat() if t.activated_at else None,
                    'created_at': t.created_at.isoformat()
                } for t in transfers
            ]
        })

@store_bp.route('/admin/drive_transfers', methods=['POST'])
@admin_required
def create_drive_transfer():
    data = request.form if request.form else request.json
    credentials_json = data.get('drive_credentials_json')
    drive_original_id = data.get('drive_original_id')
    drive_processed_id = data.get('drive_destination')  # Corregido: el campo se llama 'drive_destination'
    drive_deleted_id = data.get('drive_deleted')  # Campo opcional
    processing_time_str = data.get('drive_processing_time')
    
    if not all([credentials_json, drive_original_id, drive_processed_id, processing_time_str]):
        return jsonify({'success': False, 'error': 'Faltan datos requeridos'}), 400
    
    # Validar formato de IDs de Drive (deben ser strings alfanuméricos)
    if not drive_original_id.replace('-', '').replace('_', '').isalnum():
        return jsonify({'success': False, 'error': 'ID de carpeta original inválido'}), 400
    
    if not drive_processed_id.replace('-', '').replace('_', '').isalnum():
        return jsonify({'success': False, 'error': 'ID de carpeta procesada inválido'}), 400
    
    # Validar JSON de credenciales
    try:
        creds = json.loads(credentials_json)
        # Validar campos obligatorios en las credenciales
        required_fields = ['type', 'project_id', 'private_key', 'client_email']
        for field in required_fields:
            if field not in creds:
                return jsonify({'success': False, 'error': f'Campo obligatorio faltante en credenciales: {field}'}), 400
    except json.JSONDecodeError:
        return jsonify({'success': False, 'error': 'Credenciales JSON inválidas'}), 400
    
    try:
        # Validar formato de intervalo (5h, 10m, 5H, 10M, etc.)
        from app.store.drive_manager import parse_interval
        interval = parse_interval(processing_time_str)
        if not interval:
            return jsonify({'success': False, 'error': 'Formato de intervalo inválido. Use formato "5h" (horas) o "10m" (minutos). Ejemplos: 1h, 2h, 30m, 60m'}), 400
        
        # Crear nueva configuración (Drive Transfer permite múltiples configuraciones)
        transfer = DriveTransfer(
            credentials_json=credentials_json,
            drive_original_id=drive_original_id,
            drive_processed_id=drive_processed_id,
            drive_deleted_id=drive_deleted_id,  # Campo opcional
            processing_time=processing_time_str.upper(),  # Guardar como string (ej: "5H", "10M")
            activated_at=datetime.utcnow(),  # Establecer activated_at al crear
            consecutive_errors=0,  # Valor por defecto para el campo NOT NULL
            last_error=None  # Valor por defecto para el campo nullable
        )
        db.session.add(transfer)
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Configuración de Drive guardada correctamente.'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al guardar: {str(e)}'}), 500

@store_bp.route('/admin/drive_transfers/<int:transfer_id>', methods=['DELETE'])
@admin_required
def delete_drive_transfer(transfer_id):
    transfer = DriveTransfer.query.get_or_404(transfer_id)
    db.session.delete(transfer)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Configuración de Drive eliminada correctamente.'})

@store_bp.route('/admin/drive_transfers/<int:transfer_id>', methods=['PUT'])
@admin_required
def update_drive_transfer(transfer_id):
    data = request.form if request.form else request.json
    transfer = DriveTransfer.query.get_or_404(transfer_id)
    
    try:
        # Actualizar campos
        if 'drive_credentials_json' in data:
            transfer.credentials_json = data['drive_credentials_json']
        if 'drive_original_id' in data:
            transfer.drive_original_id = data['drive_original_id']
        if 'drive_destination' in data:
            transfer.drive_processed_id = data['drive_destination']
        if 'drive_deleted' in data:
            transfer.drive_deleted_id = data['drive_deleted']  # Campo opcional
        if 'drive_processing_time' in data:
            from app.store.drive_manager import parse_interval
            processing_time_str = data['drive_processing_time']
            # Validar formato de intervalo (5h, 10m, 5H, 10M, etc.)
            interval = parse_interval(processing_time_str)
            if not interval:
                return jsonify({'success': False, 'error': 'Formato de intervalo inválido. Use formato "5h" (horas) o "10m" (minutos). Ejemplos: 1h, 2h, 30m, 60m'}), 400
            
            transfer.processing_time = processing_time_str.upper()  # Guardar como string (ej: "5H", "10M")
            
            # Si se cambia el intervalo y está activo, resetear activated_at para que empiece desde ahora
            if transfer.is_active:
                transfer.activated_at = datetime.utcnow()
        
        transfer.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Configuración de Drive actualizada correctamente.'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar: {str(e)}'}), 500

@store_bp.route('/admin/drive_transfers/<int:transfer_id>/execute_now', methods=['POST'])
@admin_required
def execute_drive_transfer_now(transfer_id):
    """Ejecuta una transferencia de Drive manualmente (para pruebas)"""
    try:
        transfer = DriveTransfer.query.get_or_404(transfer_id)
        
        if not transfer.is_active:
            return jsonify({'success': False, 'error': 'La transferencia no está activa'}), 400
        
        from .drive_manager import execute_transfer_simple
        from .api import format_colombia_time
        from flask import current_app

        app = current_app._get_current_object()
        
        # Ejecutar transferencia (ahora maneja errores internamente y no lanza excepciones)
        result = execute_transfer_simple(transfer, app)
        
        # Recargar el objeto desde la base de datos para obtener los valores actualizados
        db.session.refresh(transfer)
        
        # Verificar si la ejecución fue exitosa
        if result and isinstance(result, dict):
            success = result.get('success', False)
            files_moved = result.get('files_moved', 0)
            files_failed = result.get('files_failed', 0)
            files_processed = result.get('files_processed', 0)
            result_message = result.get('message', 'Sin mensaje')
            
            if success:
                message = f'✅ Transferencia ejecutada exitosamente. '
            else:
                message = f'⚠️ Transferencia ejecutada con errores. '
            
            message += f'Archivos procesados: {files_processed}, Movidos: {files_moved}, Fallidos: {files_failed}. '
            
            if files_failed > 0:
                message += f'Detalles: {result_message}'
        else:
            # Si no hay resultado válido, usar información del objeto transfer
            success = False
            message = '⚠️ Transferencia ejecutada pero no se obtuvo resultado válido. '
            files_moved = 0
            files_failed = 0
        
        # Formatear hora en formato 12 horas (AM/PM) en hora de Colombia
        last_execution_formatted = format_colombia_time(transfer.last_processed) if transfer.last_processed else "N/A"
        message += f' Última ejecución: {last_execution_formatted}'
        
        # Si hay errores consecutivos, agregar advertencia
        if transfer.consecutive_errors and transfer.consecutive_errors > 0:
            message += f' (Errores consecutivos: {transfer.consecutive_errors})'
        
        # Si fue desactivada por errores, informar
        if not transfer.is_active and transfer.consecutive_errors and transfer.consecutive_errors >= 5:
            message += ' ⚠️ Transferencia desactivada automáticamente por múltiples errores.'
        
        return jsonify({
            'success': success, 
            'message': message,
            'last_processed': transfer.last_processed.isoformat() if transfer.last_processed else None,
            'result': result if result and isinstance(result, dict) else None,
            'consecutive_errors': transfer.consecutive_errors or 0,
            'is_active': transfer.is_active
        })
        
    except Exception as e:
        # Capturar cualquier error inesperado y devolver información útil
        error_msg = str(e)[:500]
        return jsonify({
            'success': False, 
            'error': f'Error al ejecutar transferencia: {error_msg}',
            'error_type': type(e).__name__
        }), 500

@store_bp.route('/admin/drive_transfers/<int:transfer_id>/toggle', methods=['POST'])
@admin_required
def toggle_drive_transfer(transfer_id):
    transfer = DriveTransfer.query.get_or_404(transfer_id)
    transfer.is_active = not transfer.is_active
    db.session.commit()
    
    status = 'activada' if transfer.is_active else 'desactivada'
    return jsonify({'success': True, 'message': f'Configuración de Drive {status}.', 'is_active': transfer.is_active})

@store_bp.route('/admin/drive_transfers/test', methods=['POST'])
@admin_required
def test_drive_connection():
    data = request.form if request.form else request.json
    credentials_json = data.get('drive_credentials_json')
    
    if not credentials_json:
        return jsonify({'success': False, 'error': 'Faltan credenciales'}), 400
    
    # Validar JSON de credenciales
    try:
        json.loads(credentials_json)
    except json.JSONDecodeError as e:
        return jsonify({'success': False, 'error': f'JSON de credenciales inválido: {str(e)}'}), 400
    
    try:
        from .drive_manager import DriveTransferService
        
        service = DriveTransferService(credentials_json)
        result = service.test_connection()
        
        if result['success']:
            return jsonify({'success': True, 'message': result['message']})
        else:
            return jsonify({'success': False, 'error': result['message']}), 500
        
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error de conexión: {str(e)}'}), 500

@store_bp.route('/admin/drive_transfers/<int:transfer_id>/cleanup', methods=['POST'])
@admin_required
def cleanup_drive_files(transfer_id):
    """Ejecuta limpieza de archivos antiguos en el Drive procesado"""
    data = request.form if request.form else request.json
    days_old = data.get('cleanup_days')
    schedule_time = data.get('cleanup_schedule_time')
    
    if not days_old:
        return jsonify({'success': False, 'error': 'Faltan días especificados'}), 400
    
    try:
        days_old = int(days_old)
        transfer = DriveTransfer.query.get_or_404(transfer_id)
        
        from .drive_manager import DriveTransferService
        
        service = DriveTransferService(transfer.credentials_json)
        
        if schedule_time:
            # Programar limpieza para hora específica
            from datetime import datetime, time as dt_time
            from .drive_manager import schedule_cleanup_task
            
            # Parsear hora
            time_parts = schedule_time.split(':')
            hour = int(time_parts[0])
            minute = int(time_parts[1])
            scheduled_time = dt_time(hour, minute)
            
            # Programar limpieza usando el scheduler
            task_id = schedule_cleanup_task(transfer.id, days_old, scheduled_time)
            
            if task_id:
                return jsonify({
                    'success': True, 
                    'message': f'✅ Limpieza programada para {schedule_time}. Se ejecutará automáticamente.',
                    'task_id': task_id,
                    'scheduled_time': schedule_time
                })
            else:
                return jsonify({'success': False, 'error': 'Error al programar la limpieza'}), 500
        else:
            # Ejecutar limpieza inmediata
            result = service.cleanup_old_files(transfer.drive_processed_id, days_old, transfer.drive_deleted_id)
            
            if result['success']:
                return jsonify({
                    'success': True, 
                    'message': result['message'],
                    'files_deleted': result['files_deleted'],
                    'files_failed': result['files_failed'],
                    'files_processed': result.get('files_processed', result['files_deleted'] + result['files_failed'])
                })
            else:
                return jsonify({'success': False, 'error': result['message']}), 500
        
    except ValueError:
        return jsonify({'success': False, 'error': 'Días inválidos'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error en limpieza: {str(e)}'}), 500

# ==================== RUTAS PARA WHATSAPP ====================

@store_bp.route('/admin/whatsapp_configs', methods=['GET'])
@admin_required
def list_whatsapp_configs():
    configs = WhatsAppConfig.query.all()
    return jsonify({
        'configs': [
            {
                'id': c.id,
                'api_key': c.api_key,
                'phone_number': c.phone_number,
                'webhook_verify_token': c.webhook_verify_token,
                'template_message': c.template_message,
                'notification_time': c.notification_time.strftime('%H:%M') if c.notification_time else None,
                'is_enabled': c.is_enabled,
                'last_sent': c.last_sent.isoformat() if c.last_sent else None,
                'created_at': c.created_at.isoformat()
            } for c in configs
        ]
    })

@store_bp.route('/admin/whatsapp_configs', methods=['POST'])
@admin_required
def create_whatsapp_config():
    data = request.form if request.form else request.json
    api_key = data.get('whatsapp_api_key')
    phone_number = data.get('whatsapp_phone_number')
    webhook_verify_token = data.get('whatsapp_webhook_verify_token')
    template_message = data.get('whatsapp_template_message')
    notification_time_str = data.get('whatsapp_notification_time')
    is_enabled = data.get('whatsapp_enabled', 'on') == 'on'
    
    if not all([api_key, phone_number, webhook_verify_token, template_message, notification_time_str]):
        return jsonify({'success': False, 'error': 'Faltan datos requeridos'}), 400
    
    try:
        # Convertir string de tiempo a objeto Time
        from datetime import time
        if ':' in notification_time_str:
            time_parts = notification_time_str.split(':')
            if len(time_parts) >= 2:
                hour = int(time_parts[0])
                minute = int(time_parts[1])
                notification_time = time(hour, minute)
            else:
                raise ValueError("Formato de tiempo inválido")
        else:
            raise ValueError("Formato de tiempo inválido")
        
        config = WhatsAppConfig(
            api_key=api_key,
            phone_number=phone_number,
            webhook_verify_token=webhook_verify_token,
            template_message=template_message,
            notification_time=notification_time,
            is_enabled=is_enabled
        )
        db.session.add(config)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Configuración de WhatsApp guardada correctamente.'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al guardar: {str(e)}'}), 500

@store_bp.route('/admin/whatsapp_configs/<int:config_id>', methods=['DELETE'])
@admin_required
def delete_whatsapp_config(config_id):
    config = WhatsAppConfig.query.get_or_404(config_id)
    db.session.delete(config)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Configuración de WhatsApp eliminada.'})

@store_bp.route('/admin/whatsapp_configs/<int:config_id>', methods=['PUT'])
@admin_required
def update_whatsapp_config(config_id):
    data = request.form if request.form else request.json
    config = WhatsAppConfig.query.get_or_404(config_id)
    
    try:
        # Actualizar campos
        if 'whatsapp_api_key' in data:
            config.api_key = data['whatsapp_api_key']
        if 'whatsapp_phone_number' in data:
            config.phone_number = data['whatsapp_phone_number']
        if 'whatsapp_webhook_verify_token' in data:
            config.webhook_verify_token = data['whatsapp_webhook_verify_token']
        if 'whatsapp_template_message' in data:
            config.template_message = data['whatsapp_template_message']
        if 'whatsapp_notification_time' in data:
            from datetime import time
            notification_time_str = data['whatsapp_notification_time']
            if ':' in notification_time_str:
                time_parts = notification_time_str.split(':')
                if len(time_parts) >= 2:
                    hour = int(time_parts[0])
                    minute = int(time_parts[1])
                    config.notification_time = time(hour, minute)
                else:
                    raise ValueError("Formato de tiempo inválido")
            else:
                raise ValueError("Formato de tiempo inválido")
        if 'whatsapp_enabled' in data:
            config.is_enabled = data['whatsapp_enabled'] == 'on'
        
        config.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Configuración de WhatsApp actualizada correctamente.'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar: {str(e)}'}), 500

@store_bp.route('/admin/whatsapp_configs/<int:config_id>/toggle', methods=['POST'])
@admin_required
def toggle_whatsapp_config(config_id):
    config = WhatsAppConfig.query.get_or_404(config_id)
    config.is_enabled = not config.is_enabled
    db.session.commit()
    
    status = 'activada' if config.is_enabled else 'desactivada'
    return jsonify({'success': True, 'message': f'Configuración de WhatsApp {status}.', 'is_enabled': config.is_enabled})

@store_bp.route('/admin/whatsapp_configs/test', methods=['POST'])
@admin_required
def test_whatsapp_connection():
    data = request.form if request.form else request.json
    api_key = data.get('whatsapp_api_key')
    phone_number = data.get('whatsapp_phone_number')
    
    if not api_key or not phone_number:
        return jsonify({'success': False, 'error': 'Faltan API Key o número de teléfono'}), 400
    
    try:
        # Simular prueba de conexión (en el futuro se implementará la conexión real)
        # Por ahora solo validamos el formato
        if len(api_key) < 10:
            return jsonify({'success': False, 'error': 'API Key muy corta'}), 400
        
        if not phone_number.isdigit() or len(phone_number) < 10:
            return jsonify({'success': False, 'error': 'Número de teléfono inválido'}), 400
        
        return jsonify({
            'success': True, 
            'message': f'Conexión de prueba exitosa. API Key válida para número {phone_number}'
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error de conexión: {str(e)}'}), 500


# ==================== RUTAS PARA SMS (TWILIO) ====================

def check_twilio_number_type(phone_number, account_sid, auth_token):
    """Consulta la API de Twilio para determinar si un número es temporal o comprado"""
    try:
        from twilio.rest import Client
        from twilio.base.exceptions import TwilioRestException
        
        if not account_sid or not auth_token:
            return 'desconocido'
        
        client = Client(account_sid, auth_token)
        
        # Buscar el número en la lista de números activos de Twilio
        incoming_phone_numbers = client.incoming_phone_numbers.list(phone_number=phone_number)
        
        if incoming_phone_numbers and len(incoming_phone_numbers) > 0:
            return 'comprado'
        else:
            # Intentar buscar sin el + si tiene
            if phone_number.startswith('+'):
                alt_phone = phone_number[1:]
                incoming_phone_numbers = client.incoming_phone_numbers.list(phone_number=alt_phone)
                if incoming_phone_numbers and len(incoming_phone_numbers) > 0:
                    return 'comprado'
            
            return 'temporal'
            
    except Exception as e:
        # Solo loguear si es un error crítico, para evitar ruido en la consola por errores de conexión ocasionales
        # current_app.logger.error(f"Error consultando tipo de número Twilio: {e}")
        return 'desconocido'

@store_bp.route('/admin/sms_configs', methods=['GET'])
@admin_required
def list_sms_configs():
    """
    Lista todas las configuraciones SMS. Asegura que todos los números estén habilitados.
    También devuelve el último número seleccionado por el usuario desde la base de datos.
    """
    configs = SMSConfig.query.order_by(SMSConfig.created_at.desc()).all()
    
    # Asegurar que todos los números estén habilitados (siempre deben estar habilitados)
    needs_commit = False
    for config in configs:
        if not config.is_enabled:
            config.is_enabled = True
            needs_commit = True
    
    # Guardar cambios si hubo alguno
    if needs_commit:
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
    
    # Optimizar: obtener conteos de mensajes en una sola consulta
    from sqlalchemy import func
    messages_counts = db.session.query(
        SMSMessage.sms_config_id,
        func.count(SMSMessage.id).label('count')
    ).group_by(SMSMessage.sms_config_id).all()
    
    messages_dict = {config_id: count for config_id, count in messages_counts}
    
    configs_data = []
    for config in configs:
        # Usar conteo optimizado en lugar de config.messages.count()
        messages_count = messages_dict.get(config.id, 0)
        
        # Usar el tipo de número guardado en la base de datos
        number_type = getattr(config, 'number_type', 'desconocido') or 'desconocido'
        
        configs_data.append({
            'id': config.id,
            'name': config.name,
            'phone_number': config.phone_number,
            'twilio_account_sid': config.twilio_account_sid,
            'is_enabled': True,  # Siempre True
            'description': config.description,
            'created_at': colombia_strftime('%Y-%m-%d %H:%M:%S') if config.created_at else None,
            'messages_count': messages_count,
            'number_type': number_type
        })
    
    # Obtener el último número seleccionado por el usuario desde la base de datos
    current_user = get_current_user()
    last_selected_id = None
    if current_user and current_user.last_selected_sms_config_id:
        # Verificar que el número seleccionado aún existe
        selected_config = SMSConfig.query.get(current_user.last_selected_sms_config_id)
        if selected_config:
            last_selected_id = current_user.last_selected_sms_config_id
        else:
            # Si el número ya no existe, limpiar la referencia
            current_user.last_selected_sms_config_id = None
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
    
    # También verificar si hay uno guardado en la sesión (prioridad más alta)
    session_selected_id = session.get('selected_sms_config_id')
    if session_selected_id:
        # Validar que existe
        if SMSConfig.query.get(session_selected_id):
            last_selected_id = session_selected_id
            # Sincronizar con la base de datos
            if current_user and current_user.last_selected_sms_config_id != session_selected_id:
                current_user.last_selected_sms_config_id = session_selected_id
                try:
                    db.session.commit()
                except Exception:
                    db.session.rollback()
        
    return jsonify({
        'success': True, 
        'configs': configs_data,
        'last_selected_id': last_selected_id  # ID del último número seleccionado
    })

@store_bp.route('/admin/android-sms-config', methods=['GET'])
@admin_required
def get_android_sms_config():
    """Obtiene todas las configuraciones SMS Android (múltiples números)"""
    from flask import url_for
    import socket
    
    # Obtener todas las configuraciones Android
    android_configs = SMSConfig.query.filter_by(number_type='android').order_by(SMSConfig.created_at.desc()).all()
    
    # Obtener URL del webhook base
    try:
        base_url = request.url_root.rstrip('/')
        
        # ✅ DETECCIÓN AUTOMÁTICA DE IP LOCAL PARA PRUEBAS
        if current_app.config.get('FLASK_ENV') == 'development' and ('127.0.0.1' in base_url or 'localhost' in base_url):
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                local_ip = s.getsockname()[0]
                s.close()
                if '127.0.0.1' in base_url:
                    base_url = base_url.replace('127.0.0.1', local_ip)
                elif 'localhost' in base_url:
                    base_url = base_url.replace('localhost', local_ip)
            except Exception:
                pass
        
        webhook_url = base_url + url_for('api_bp.receive_sms_from_android')
    except:
        try:
            base_url = request.url_root.rstrip('/')
            if current_app.config.get('FLASK_ENV') == 'development' and ('127.0.0.1' in base_url or 'localhost' in base_url):
                try:
                    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    s.connect(("8.8.8.8", 80))
                    local_ip = s.getsockname()[0]
                    s.close()
                    if '127.0.0.1' in base_url:
                        base_url = base_url.replace('127.0.0.1', local_ip)
                    elif 'localhost' in base_url:
                        base_url = base_url.replace('localhost', local_ip)
                except Exception:
                    pass
            webhook_url = base_url + '/api/sms/android-receive'
        except:
            webhook_url = request.url_root.rstrip('/') + '/api/sms/android-receive'
    
    # Obtener API key global (si existe) o de cada configuración
    from app.admin.site_settings import get_site_setting
    global_api_key = get_site_setting("android_sms_api_key", "")
    
    configs_data = []
    for config in android_configs:
        # Obtener API key específica de la descripción o usar la global
        api_key = global_api_key  # Por defecto usar la global
        
        # Intentar extraer API key de la descripción si está guardada ahí
        if config.description and 'api_key:' in config.description:
            try:
                api_key = config.description.split('api_key:')[1].strip().split('\n')[0]
            except:
                pass
        
        configs_data.append({
            'id': config.id,
            'phone_number': config.phone_number,
            'name': config.name,
            'api_key': api_key,
            'webhook_url': webhook_url,
            'is_enabled': config.is_enabled
        })
    
    return jsonify({
        'success': True,
        'configs': configs_data,
        'webhook_url': webhook_url,
        'global_api_key': global_api_key  # Mantener compatibilidad
    })


@store_bp.route('/admin/android-sms-config', methods=['POST'])
@csrf_exempt_route  # ✅ Exentar del CSRF para evitar errores al guardar
@admin_required
def save_android_sms_config():
    """Guarda una nueva configuración de SMS Android (permite múltiples números)"""
    from app.admin.site_settings import get_site_setting, set_site_setting
    
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        phone_number = data.get('phone_number', '').strip()
        api_key = data.get('api_key', '').strip()
        config_id = data.get('config_id')  # Para editar existente
        
        if not name:
            return jsonify({'success': False, 'message': 'El nombre es obligatorio'}), 400
        
        if not phone_number:
            return jsonify({'success': False, 'message': 'El número de teléfono es obligatorio'}), 400
        
        # Validar formato del número
        import re
        if not re.match(r'^\+[1-9]\d{1,14}$', phone_number):
            return jsonify({
                'success': False,
                'message': 'Formato inválido. Debe ser: +573001234567 (con código de país)'
            }), 400
        
        # Verificar si el número ya existe en otra configuración Android
        existing_config = SMSConfig.query.filter_by(
            phone_number=phone_number,
            number_type='android'
        ).first()
        
        if existing_config and (not config_id or existing_config.id != int(config_id)):
            return jsonify({
                'success': False,
                'message': f'Este número Android ya está configurado: {existing_config.name}'
            }), 400
        
        # ✅ API KEY OPCIONAL: Guardar solo si se proporciona, permitir vacío
        if api_key:
            set_site_setting("android_sms_api_key", api_key)
        else:
            # Si no se proporciona API key, guardar como vacío (eliminar si existía)
            set_site_setting("android_sms_api_key", "")
            api_key = ""
        
        # Guardar descripción de la configuración
        description = "Configuración automática para SMS desde Android"
        if api_key:
            description += f"\napi_key: {api_key}"
        
        if config_id:
            # Editar configuración existente
            config = SMSConfig.query.get(config_id)
            if not config or config.number_type != 'android':
                return jsonify({'success': False, 'message': 'Configuración no encontrada'}), 404
            
            config.name = name
            config.phone_number = phone_number
            config.description = description
            if not config.twilio_account_sid:
                config.twilio_account_sid = "android_dummy"
            if not config.twilio_auth_token:
                config.twilio_auth_token = "android_dummy"
            config.is_enabled = True
            db.session.commit()
        else:
            # Crear nueva configuración Android
            config = SMSConfig(
                name=name,
                phone_number=phone_number,
                twilio_account_sid="android_dummy",
                twilio_auth_token="android_dummy",
                is_enabled=True,
                number_type="android",
                description=description
            )
            db.session.add(config)
            db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Configuración Android guardada correctamente',
            'sms_config_id': config.id,
            'api_key': api_key
        })
    
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al guardar configuración Android: {e}", exc_info=True)
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500


@store_bp.route('/admin/sms_configs', methods=['POST'])
@admin_required
def create_sms_config():
    """Crea una nueva configuración SMS"""
    data = request.form if request.form else request.json
    
    name = data.get('name')
    twilio_account_sid = data.get('twilio_account_sid')
    twilio_auth_token = data.get('twilio_auth_token')
    phone_number = data.get('phone_number')
    description = data.get('description', '')
    # Los números SMS siempre deben estar habilitados
    is_enabled = True
    
    if not all([name, twilio_account_sid, twilio_auth_token, phone_number]):
        return jsonify({'success': False, 'error': 'Faltan campos requeridos'}), 400
    
    try:
        if not phone_number.startswith('+'):
            return jsonify({'success': False, 'error': 'El número debe incluir código de país (ej: +12672441170)'}), 400
        
        config = SMSConfig(
            name=name,
            twilio_account_sid=twilio_account_sid,
            twilio_auth_token=twilio_auth_token,
            phone_number=phone_number,
            description=description,
            is_enabled=is_enabled
        )
        
        db.session.add(config)
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Configuración SMS creada correctamente.', 'config_id': config.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al crear: {str(e)}'}), 500

@store_bp.route('/admin/sms_configs/<int:config_id>', methods=['PUT'])
@admin_required
def update_sms_config(config_id):
    """Actualiza una configuración SMS existente"""
    config = SMSConfig.query.get_or_404(config_id)
    data = request.form if request.form else request.json
    
    name = data.get('name')
    twilio_account_sid = data.get('twilio_account_sid')
    twilio_auth_token = data.get('twilio_auth_token')
    phone_number = data.get('phone_number')
    description = data.get('description', '')
    # Los números SMS siempre deben estar habilitados
    is_enabled = True
    
    if not all([name, twilio_account_sid, phone_number]):
        return jsonify({'success': False, 'error': 'Faltan campos requeridos'}), 400
    
    try:
        if not phone_number.startswith('+'):
            return jsonify({'success': False, 'error': 'El número debe incluir código de país (ej: +12672441170)'}), 400
        
        # Verificar si el número ya existe en otra configuración
        existing = SMSConfig.query.filter(
            SMSConfig.phone_number == phone_number,
            SMSConfig.id != config_id
        ).first()
        if existing:
            return jsonify({'success': False, 'error': 'Este número ya está configurado en otra cuenta'}), 400
        
        config.name = name
        config.twilio_account_sid = twilio_account_sid
        # Solo actualizar el token si se proporciona uno nuevo
        if twilio_auth_token:
            config.twilio_auth_token = twilio_auth_token
        config.phone_number = phone_number
        config.description = description
        config.is_enabled = is_enabled
        
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Configuración SMS actualizada correctamente.'})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar: {str(e)}'}), 500

@store_bp.route('/admin/sms_configs/<int:config_id>', methods=['DELETE'])
@admin_required
def delete_sms_config(config_id):
    """Elimina una configuración SMS. Los correos permitidos, mensajes y regex se eliminan automáticamente en cascada."""
    config = SMSConfig.query.get_or_404(config_id)
    
    try:
        # Contar elementos que se eliminarán en cascada
        allowed_count = AllowedSMSNumber.query.filter_by(sms_config_id=config_id).count()
        messages_count = SMSMessage.query.filter_by(sms_config_id=config_id).count()
        regex_count = SMSRegex.query.filter_by(sms_config_id=config_id).count()
        
        # Eliminar explícitamente todos los elementos relacionados para asegurar eliminación completa
        # Esto garantiza que todo se elimine incluso si hay problemas con las relaciones SQLAlchemy
        
        # 1. Eliminar regex asociados
        SMSRegex.query.filter_by(sms_config_id=config_id).delete()
        
        # 2. Eliminar correos permitidos asociados
        AllowedSMSNumber.query.filter_by(sms_config_id=config_id).delete()
        
        # 3. Eliminar mensajes SMS asociados
        SMSMessage.query.filter_by(sms_config_id=config_id).delete()
        
        # 4. Eliminar la configuración SMS
        db.session.delete(config)
        
        # Commit todas las eliminaciones a la base de datos
        db.session.commit()
        
        message = 'Configuración SMS eliminada correctamente.'
        details = []
        if allowed_count > 0:
            details.append(f'{allowed_count} correo(s) permitido(s)')
        if messages_count > 0:
            details.append(f'{messages_count} mensaje(s)')
        if regex_count > 0:
            details.append(f'{regex_count} regex asociado(s)')
        if details:
            message += f' También se eliminaron: {", ".join(details)}.'
        
        return jsonify({'success': True, 'message': message})
    
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar SMSConfig {config_id}: {e}", exc_info=True)
        return jsonify({'success': False, 'error': f'Error al eliminar: {str(e)}'}), 500

@store_bp.route('/admin/sms/regex', methods=['GET'])
@admin_required
def list_sms_regex():
    """Lista todos los regex específicos de SMS de un número específico"""
    try:
        config_id = request.args.get('config_id', type=int)
        if config_id:
            # Listar solo los regexes del número SMS especificado
            regexes = SMSRegex.query.filter_by(sms_config_id=config_id).order_by(SMSRegex.name.asc()).all()
        else:
            # Si no se especifica config_id, devolver lista vacía
            regexes = []
        regex_data = [{
            'id': regex.id,
            'name': regex.name or '',
            'pattern': regex.pattern or '',
            'enabled': regex.enabled,
            'sms_config_id': regex.sms_config_id
        } for regex in regexes]
        return jsonify({'success': True, 'regexes': regex_data})
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error al listar regex: {str(e)}'}), 500

@store_bp.route('/admin/sms/regex', methods=['POST'])
@admin_required
def create_sms_regex():
    """Crea un nuevo regex específico para SMS - Cada regex pertenece a un solo SMSConfig"""
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        pattern = data.get('pattern', '').strip()
        sms_config_id = data.get('sms_config_id')  # ID del SMSConfig al que pertenece el regex
        
        if not name or not pattern:
            return jsonify({'success': False, 'error': 'Nombre y patrón son requeridos'}), 400
        
        if not sms_config_id:
            return jsonify({'success': False, 'error': 'sms_config_id es requerido'}), 400
        
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            return jsonify({'success': False, 'error': 'sms_config_id debe ser un número válido'}), 400
        
        # Verificar que el SMSConfig existe
        config = SMSConfig.query.get(sms_config_id)
        if not config:
            return jsonify({'success': False, 'error': 'SMSConfig no encontrado'}), 404
        
        # Crear el regex asociado directamente al SMSConfig
        new_regex = SMSRegex(
            name=name,
            pattern=pattern,
            enabled=True,
            sms_config_id=sms_config_id
        )
        db.session.add(new_regex)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Regex creado correctamente',
            'regex': {
                'id': new_regex.id,
                'name': new_regex.name,
                'pattern': new_regex.pattern,
                'enabled': new_regex.enabled,
                'sms_config_id': new_regex.sms_config_id
            }
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al crear regex: {str(e)}'}), 500

@store_bp.route('/admin/sms/regex/<int:regex_id>', methods=['PUT'])
@admin_required
def update_sms_regex(regex_id):
    """Actualiza un regex específico de SMS"""
    try:
        regex = SMSRegex.query.get_or_404(regex_id)
        data = request.get_json()
        
        name = data.get('name', '').strip()
        pattern = data.get('pattern', '').strip()
        
        if not name or not pattern:
            return jsonify({'success': False, 'error': 'Nombre y patrón son requeridos'}), 400
        
        regex.name = name
        regex.pattern = pattern
        regex.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Regex actualizado correctamente',
            'regex': {
                'id': regex.id,
                'name': regex.name,
                'pattern': regex.pattern,
                'enabled': regex.enabled
            }
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar regex: {str(e)}'}), 500

@store_bp.route('/admin/sms/regex/<int:regex_id>', methods=['DELETE'])
@admin_required
def delete_sms_regex(regex_id):
    """Elimina un regex específico de SMS (uno-a-muchos: cada regex pertenece a un solo SMSConfig)"""
    try:
        regex = SMSRegex.query.get_or_404(regex_id)
        
        # Con la nueva relación uno-a-muchos, el regex pertenece a un solo SMSConfig
        # Se elimina directamente sin necesidad de manejar asociaciones
        db.session.delete(regex)
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Regex eliminado correctamente.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al eliminar regex: {str(e)}'}), 500

@store_bp.route('/admin/sms_configs/<int:config_id>/regex', methods=['GET'])
@admin_required
def get_sms_config_regex(config_id):
    """Obtiene los IDs de los regex asociados a un SMS config"""
    try:
        config = SMSConfig.query.get_or_404(config_id)
        # Intentar obtener regex asociados, si la tabla no existe aún devolver lista vacía
        try:
            regex_ids = [regex.id for regex in config.regexes]
        except Exception:
            # Si la tabla no existe aún, devolver lista vacía
            regex_ids = []
        return jsonify({'success': True, 'regex_ids': regex_ids})
    except Exception as e:
        # Si hay error, devolver lista vacía en lugar de error 500
        return jsonify({'success': True, 'regex_ids': []})

@store_bp.route('/admin/sms_configs/<int:config_id>/regex', methods=['POST'])
@admin_required
def add_sms_config_regex(config_id):
    """Agrega un regex SMS a un SMS config"""
    data = request.get_json()
    regex_id = data.get('regex_id')
    
    if not regex_id:
        return jsonify({'success': False, 'error': 'regex_id es requerido'}), 400
    
    config = SMSConfig.query.get_or_404(config_id)
    regex = SMSRegex.query.get(regex_id)
    
    if not regex:
        return jsonify({'success': False, 'error': 'Regex no encontrado'}), 404
    
    # Verificar si ya está asociado usando la relación
    existing_regexes = [r.id for r in config.regexes]
    if regex_id not in existing_regexes:
        config.regexes.append(regex)
        try:
            db.session.commit()
            return jsonify({'success': True, 'message': 'Regex agregado correctamente'})
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'error': f'Error al agregar regex: {str(e)}'}), 500
    
    return jsonify({'success': True, 'message': 'Regex ya estaba asociado'})

@store_bp.route('/admin/sms_configs/<int:config_id>/regex', methods=['DELETE'])
@admin_required
def remove_sms_config_regex(config_id):
    """Elimina un regex SMS de un SMS config"""
    data = request.get_json()
    regex_id = data.get('regex_id')
    
    if not regex_id:
        return jsonify({'success': False, 'error': 'regex_id es requerido'}), 400
    
    config = SMSConfig.query.get_or_404(config_id)
    regex = SMSRegex.query.get(regex_id)
    
    if not regex:
        return jsonify({'success': False, 'error': 'Regex no encontrado'}), 404
    
    # Verificar si está asociado usando la relación
    existing_regexes = [r.id for r in config.regexes]
    if regex_id in existing_regexes:
        config.regexes.remove(regex)
        try:
            db.session.commit()
            return jsonify({'success': True, 'message': 'Regex eliminado correctamente'})
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'error': f'Error al eliminar regex: {str(e)}'}), 500
    
    return jsonify({'success': True, 'message': 'Regex no estaba asociado'})

@store_bp.route('/admin/sms_configs/<int:config_id>/toggle', methods=['POST'])
@admin_required
def toggle_sms_config(config_id):
    """Los números SMS siempre deben estar habilitados. Esta ruta mantiene el estado habilitado."""
    config = SMSConfig.query.get_or_404(config_id)
    
    try:
        # Siempre mantener habilitado
        config.is_enabled = True
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Los números SMS siempre están habilitados.', 'is_enabled': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar estado: {str(e)}'}), 500

@store_bp.route('/admin/sms_configs/test-number-states', methods=['POST'])
@admin_required
def test_sms_number_states():
    """Prueba y actualiza el estado (comprado/temporal) de todos los números SMS"""
    try:
        # Obtener todos los SMSConfig
        configs = SMSConfig.query.all()
        
        if not configs:
            return jsonify({'success': True, 'message': 'No hay números SMS configurados', 'updated': 0}), 200
        
        updated_count = 0
        results = []
        
        for config in configs:
            try:
                # Consultar Twilio para obtener el tipo de número
                number_type = check_twilio_number_type(
                    config.phone_number,
                    config.twilio_account_sid,
                    config.twilio_auth_token
                )
                
                # Actualizar en la base de datos
                config.number_type = number_type
                updated_count += 1
                
                type_labels = {
                    'comprado': 'Comprado',
                    'temporal': 'Temporal',
                    'desconocido': 'Desconocido'
                }
                
                results.append({
                    'phone_number': config.phone_number,
                    'name': config.name,
                    'number_type': number_type,
                    'label': type_labels.get(number_type, 'Desconocido')
                })
                
            except Exception as e:
                results.append({
                    'phone_number': config.phone_number,
                    'name': config.name,
                    'number_type': 'desconocido',
                    'label': 'Error al verificar',
                    'error': str(e)
                })
        
        # Guardar todos los cambios
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Estados actualizados correctamente. {updated_count} número(s) verificados.',
            'updated': updated_count,
            'results': results
        })
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al probar estados: {str(e)}'}), 500

@store_bp.route('/admin/sms_configs/<int:config_id>/messages', methods=['GET'])
@admin_required
def list_sms_messages(config_id):
    """Lista los mensajes recibidos para una configuración SMS (sin filtrar por regex - los regex solo se aplican en la plantilla de búsqueda)"""
    try:
        config = SMSConfig.query.get_or_404(config_id)
        
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 50, type=int)
        
        # Obtener todos los mensajes del config (sin filtrar por regex en admin)
        query = SMSMessage.query.filter_by(sms_config_id=config_id)
        
        # Devolver todos los mensajes normalmente (los regex solo se aplican en la plantilla de búsqueda para usuarios)
        messages = query.order_by(SMSMessage.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
        
        messages_data = [{
            'id': msg.id,
            'from_number': msg.from_number,
            'to_number': msg.to_number,
            'message_body': msg.message_body,
            'twilio_status': msg.twilio_status,
            'processed': msg.processed,
            'created_at': utc_to_colombia(msg.created_at).strftime('%d/%m/%Y|%I:%M %p') if msg.created_at else None,
        } for msg in messages.items]
        
        return jsonify({
            'success': True,
            'messages': messages_data,
            'total': messages.total,
            'pages': messages.pages,
            'current_page': page
        })
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error al listar mensajes: {str(e)}'}), 500

@store_bp.route('/admin/sms/all-messages', methods=['GET'])
@admin_required
def get_all_sms_messages():
    """Obtiene todos los mensajes SMS de todos los números configurados (ordenados del más reciente al más antiguo)"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 100, type=int)
    
    # Siempre ordenar del más reciente al más antiguo
    messages = SMSMessage.query.order_by(SMSMessage.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    messages_data = [{
        'id': msg.id,
        'sms_config_id': msg.sms_config_id,
        'from_number': msg.from_number,
        'to_number': msg.to_number,
        'message_body': msg.message_body,
        'twilio_status': msg.twilio_status,
        'processed': msg.processed,
        'created_at': utc_to_colombia(msg.created_at).strftime('%m/%d %I:%M %p') if msg.created_at else None,
    } for msg in messages.items]
    
    return jsonify({
        'success': True,
        'messages': messages_data,
        'total': messages.total,
        'pages': messages.pages,
        'current_page': page
    })

@store_bp.route('/admin/sms/message/<int:message_id>', methods=['GET'])
@admin_required
def get_sms_message_by_id(message_id):
    """Obtiene un mensaje SMS por su ID (sin necesidad de config_id)"""
    message = SMSMessage.query.get_or_404(message_id)
    
    return jsonify({
        'success': True,
        'message': {
            'id': message.id,
            'sms_config_id': message.sms_config_id,
            'from_number': message.from_number,
            'to_number': message.to_number,
            'message_body': message.message_body,
            'twilio_message_sid': message.twilio_message_sid,
            'twilio_status': message.twilio_status,
            'processed': message.processed,
            'raw_data': message.raw_data,
            'created_at': utc_to_colombia(message.created_at).strftime('%d/%m/%Y|%I:%M %p') if message.created_at else None,
            'processed_at': utc_to_colombia(message.processed_at).strftime('%d/%m/%Y|%I:%M %p') if message.processed_at else None
        }
    })

@store_bp.route('/admin/sms/set-selected-number', methods=['POST'])
@admin_required
def set_selected_sms_number():
    """Guarda el número SMS seleccionado en la sesión y en la base de datos del usuario"""
    data = request.get_json()
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if sms_config_id:
        # Validar que el sms_config_id existe
        sms_config = SMSConfig.query.get(sms_config_id)
        if not sms_config:
            return jsonify({'success': False, 'message': 'Número SMS no encontrado.'}), 404
        
        # Guardar en sesión (para uso inmediato)
        session['selected_sms_config_id'] = sms_config_id
        
        # Guardar en base de datos (para persistencia entre sesiones)
        current_user = get_current_user()
        if current_user:
            try:
                current_user.last_selected_sms_config_id = sms_config_id
                db.session.commit()
            except Exception as e:
                db.session.rollback()
    else:
        # Limpiar selección
        session.pop('selected_sms_config_id', None)
        
        # Limpiar también en base de datos
        current_user = get_current_user()
        if current_user:
            try:
                current_user.last_selected_sms_config_id = None
                db.session.commit()
            except Exception as e:
                db.session.rollback()
    
    return jsonify({'success': True, 'message': 'Número seleccionado guardado.'})

@store_bp.route('/admin/sms/allowed-numbers/paginated', methods=['GET'])
@admin_required
def list_allowed_sms_numbers_paginated():
    """Devuelve una lista paginada de números permitidos para SMS filtrados por sms_config_id"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    sms_config_id = request.args.get('sms_config_id', type=int)
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    # Validar que el sms_config_id existe
    sms_config = SMSConfig.query.get(sms_config_id)
    if not sms_config:
        return jsonify({'success': False, 'message': 'Número SMS no encontrado.'}), 404
    
    # Validar per_page, si se pide "Todos", usar un número muy grande
    query = AllowedSMSNumber.query.filter_by(sms_config_id=sms_config_id)
    if per_page == -1:
        total_count = query.count()
        per_page = total_count + 1 if total_count > 0 else 10
    
    # Consulta paginada filtrada por sms_config_id
    pagination = query.order_by(AllowedSMSNumber.phone_number.asc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    numbers_data = [num.phone_number for num in pagination.items]
    
    return jsonify({
        'success': True,
        'numbers': numbers_data,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page if per_page > 0 else -1,
            'total_pages': pagination.pages,
            'total_items': pagination.total,
            'has_prev': pagination.has_prev,
            'has_next': pagination.has_next
        }
    })

@store_bp.route('/admin/sms/allowed-numbers/search', methods=['POST'])
@admin_required
def search_allowed_sms_numbers():
    """Busca correos/números dentro de AllowedSMSNumber filtrados por sms_config_id, aceptando múltiples términos"""
    import re
    from sqlalchemy import or_, func
    
    data = request.get_json()
    search_text = data.get('search_text', '').strip()
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    # Validar que el sms_config_id existe
    sms_config = SMSConfig.query.get(sms_config_id)
    if not sms_config:
        return jsonify({'success': False, 'message': 'Número SMS no encontrado.'}), 404
    
    # Procesar el texto de búsqueda para obtener una lista de términos no vacíos
    search_terms = [t.strip().lower() for t in re.split(r'[,\n\r\s]+', search_text) if t.strip()]
    
    # Base query filtrada por sms_config_id
    base_query = AllowedSMSNumber.query.filter_by(sms_config_id=sms_config_id)
    
    if not search_terms:
        numbers_query = base_query.filter(db.false()).order_by(AllowedSMSNumber.phone_number.asc())
    else:
        # Construir una condición OR con ILIKE para cada término (normalizado a minúsculas)
        # Usar LOWER() para comparar en minúsculas ya que los correos se guardan en minúsculas
        conditions = []
        for term in search_terms:
            conditions.append(func.lower(AllowedSMSNumber.phone_number).like(f'%{term}%'))
        # Aplicar el filtro OR a la consulta
        numbers_query = base_query.filter(or_(*conditions)).order_by(AllowedSMSNumber.phone_number.asc())
    
    found_numbers = [num.phone_number for num in numbers_query.all()]
    
    return jsonify({'success': True, 'numbers': found_numbers})

@store_bp.route('/admin/sms/allowed-numbers/delete', methods=['POST'])
@admin_required
def delete_allowed_sms_number():
    """Elimina un correo/número específico de AllowedSMSNumber filtrado por sms_config_id"""
    import re
    data = request.get_json()
    phone_number = data.get('phone_number', '').strip()
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if not phone_number:
        return jsonify({'success': False, 'message': 'Falta el correo o número.'}), 400
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    # Normalizar: si es correo, convertir a minúsculas; si es número, agregar +
    phone_number_normalized = phone_number.lower()
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, phone_number_normalized):
        # No es correo, tratar como número
        if not phone_number_normalized.startswith('+'):
            phone_number_normalized = '+' + phone_number_normalized
    
    # Buscar tanto con el valor original como con el normalizado, filtrado por sms_config_id
    deleted_count = AllowedSMSNumber.query.filter(
        AllowedSMSNumber.sms_config_id == sms_config_id,
        db.or_(
            AllowedSMSNumber.phone_number == phone_number,
            AllowedSMSNumber.phone_number == phone_number_normalized
        )
    ).delete()
    
    try:
        db.session.commit()
        if deleted_count > 0:
            return jsonify({'success': True, 'message': 'Correo eliminado correctamente.'})
        else:
            return jsonify({'success': False, 'message': 'Correo no encontrado.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Error al eliminar el correo.'}), 500

@store_bp.route('/admin/sms/allowed-numbers/delete-many', methods=['POST'])
@admin_required
def delete_many_allowed_sms_numbers():
    """Elimina varios correos/números a la vez de AllowedSMSNumber filtrados por sms_config_id"""
    import re
    data = request.get_json()
    phone_numbers = data.get('phone_numbers', [])
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if not phone_numbers:
        return jsonify({'success': False, 'message': 'No se proporcionaron correos o números.'}), 400
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    # Normalizar: correos a minúsculas, números con +
    normalized_numbers = []
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    
    for num in phone_numbers:
        if isinstance(num, str) and num.strip():
            normalized = num.strip().lower()
            # Si no es correo, tratar como número
            if not re.match(email_pattern, normalized):
                if not normalized.startswith('+'):
                    normalized = '+' + normalized
            normalized_numbers.append(normalized)
    
    # También incluir los valores originales por si acaso
    all_numbers = list(set(normalized_numbers + [n.strip() for n in phone_numbers if isinstance(n, str) and n.strip()]))
    
    if not all_numbers:
        return jsonify({'success': False, 'message': 'No hay correos o números válidos para eliminar.'}), 400
    
    deleted_count = AllowedSMSNumber.query.filter(
        AllowedSMSNumber.sms_config_id == sms_config_id,
        AllowedSMSNumber.phone_number.in_(all_numbers)
    ).delete(synchronize_session=False)
    
    try:
        db.session.commit()
        return jsonify({'success': True, 'message': f'{deleted_count} correo(s) eliminado(s).'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Error al eliminar los correos.'}), 500

@store_bp.route('/admin/sms/allowed-numbers/delete-all', methods=['POST'])
@admin_required
def delete_all_allowed_sms_numbers():
    """Elimina TODOS los números permitidos de un sms_config_id específico"""
    data = request.get_json()
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    try:
        deleted_count = AllowedSMSNumber.query.filter_by(sms_config_id=sms_config_id).delete()
        db.session.commit()
        return jsonify({'success': True, 'message': f'{deleted_count} número(s) eliminado(s).'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Error interno al eliminar todos los números.'}), 500

@store_bp.route('/admin/sms/allowed-numbers/add', methods=['POST'])
@admin_required
def add_allowed_sms_numbers():
    """Añade una lista de nuevos números permitidos vinculados a un sms_config_id específico. Evita añadir duplicados."""
    import re
    
    data = request.get_json()
    phone_numbers = data.get('phone_numbers', [])
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    # Validar que el sms_config_id existe
    sms_config = SMSConfig.query.get(sms_config_id)
    if not sms_config:
        return jsonify({'success': False, 'message': 'Número SMS no encontrado.'}), 404
    
    if not phone_numbers:
        return jsonify({'success': False, 'message': 'No se proporcionaron números.'}), 400
    
    # Normalizar y asegurar unicidad en la lista de entrada
    # Aceptar tanto números de teléfono como correos electrónicos
    normalized_new_numbers = []
    
    for num in phone_numbers:
        if isinstance(num, str) and num.strip():
            normalized = num.strip().lower()  # Normalizar a minúsculas para correos
            
            # Verificar si es un correo electrónico
            email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
            if re.match(email_pattern, normalized):
                normalized_new_numbers.append(normalized)
            else:
                # Si no es correo, tratar como número de teléfono
                # Agregar + si no lo tiene
                if not normalized.startswith('+'):
                    normalized = '+' + normalized
                # Validar formato básico (al menos 10 caracteres después del +)
                if len(normalized) >= 11 and normalized[1:].replace(' ', '').isdigit():
                    normalized_new_numbers.append(normalized)
    
    # Eliminar duplicados de la lista de entrada
    normalized_new_numbers = list(set(normalized_new_numbers))
    
    if not normalized_new_numbers:
        return jsonify({'success': False, 'message': 'No hay correos o números válidos para añadir.'}), 400
    
    # 1. Verificar si alguno de los correos YA existe en ESTE MISMO número (solo verificar duplicados dentro del mismo número)
    existing_records = AllowedSMSNumber.query.filter(
        AllowedSMSNumber.phone_number.in_(normalized_new_numbers),
        AllowedSMSNumber.sms_config_id == sms_config_id  # ✅ Solo verificar en el mismo número SMS
    ).all()
    
    existing_emails = {record.phone_number for record in existing_records}
    
    # 2. Filtrar los que NO existen en este número para agregarlos
    to_add = [num for num in normalized_new_numbers if num not in existing_emails]
    
    # 3. Si no hay ninguno para agregar (todos ya existen en este número)
    if not to_add:
        error_messages = []
        processed_emails = []  # Correos que ya están en este número
        
        for record in existing_records:
            # Ya existe en ESTE mismo número
            error_messages.append(f'<span class="text-info">• {record.phone_number} (ya agregado a este número)</span>')
            processed_emails.append(record.phone_number)
            
        msg_html = '<div class="mb-1">Detalle de los correos no agregados:<br>' + '<br>'.join(error_messages) + '</div>'
        return jsonify({
            'success': False, 
            'message': msg_html,
            'is_html': True,
            'added_count': 0,
            'processed_emails': processed_emails,  # Correos que se procesaron y deben eliminarse del input
            'remaining_emails': []  # Ya no hay correos pendientes de otros números
        }), 200

    # 4. Agregar los nuevos
    new_number_objects = []
    for number in to_add:
        new_number_objects.append(AllowedSMSNumber(phone_number=number, sms_config_id=sms_config_id))
    
    db.session.bulk_save_objects(new_number_objects)
    actually_added_count = len(new_number_objects)
    
    try:
        db.session.commit()
        
        # Construir mensaje de respuesta
        if existing_records:
            # Éxito parcial
            error_messages = []
            processed_emails = []  # Correos que se procesaron (agregados o ya en este número)
            remaining_emails = []  # Correos que quedan pendientes (en otros números)
            
            for record in existing_records:
                if record.sms_config_id == sms_config_id:
                    # Ya existe en ESTE mismo número (azul) - se procesó
                    error_messages.append(f'<span class="text-info">• {record.phone_number} (ya agregado a este número)</span>')
                    processed_emails.append(record.phone_number)
                else:
                    # Existe en OTRO número (rojo) - queda pendiente
                    config = SMSConfig.query.get(record.sms_config_id)
                    config_info = f"{config.name} ({config.phone_number})" if config else f"ID {record.sms_config_id}"
                    error_messages.append(f'<span class="text-danger">• {record.phone_number} (ya está en {config_info})</span>')
                    remaining_emails.append(record.phone_number)
            
            # Agregar los correos que se agregaron exitosamente a la lista de procesados
            processed_emails.extend(to_add)
            
            # Construir mensaje HTML
            msg_html = ""
            if actually_added_count > 0:
                msg_html += f'<div class="text-success mb-2">✔ Se agregaron {actually_added_count} correos correctamente.</div>'
            
            msg_html += '<div class="mb-1">Detalle de los no agregados:<br>' + '<br>'.join(error_messages) + '</div>'
            
            return jsonify({
                'success': False, # Para no limpiar el input automáticamente
                'message': msg_html,
                'added_count': actually_added_count,
                'is_html': True,
                'processed_emails': processed_emails,  # Correos que se procesaron y deben eliminarse del input
                'remaining_emails': remaining_emails  # Correos que quedan pendientes
            }), 200
        else:
            # Éxito total - todos los correos se agregaron
            return jsonify({
                'success': True, 
                'added_count': actually_added_count, 
                'message': f'Se agregaron {actually_added_count} correos correctamente.',
                'processed_emails': to_add,  # Todos los correos se procesaron
                'remaining_emails': []
            })
            
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Error al guardar los nuevos números.'}), 500

@csrf_exempt_route
@store_bp.route('/sms/webhook', methods=['POST'])
def sms_webhook():
    """Webhook público para recibir SMS de Twilio"""
    from app.services.sms_service import receive_sms_webhook
    
    try:
        twiml_response = receive_sms_webhook()
        return twiml_response, 200, {'Content-Type': 'text/xml'}
    
    except Exception as e:
        from twilio.twiml.messaging_response import MessagingResponse
        response = MessagingResponse()
        return str(response), 200, {'Content-Type': 'text/xml'}

@store_bp.route('/admin/sms/cleanup', methods=['POST'])
@admin_required
def cleanup_sms_messages():
    """Elimina mensajes SMS antiguos (más de 15 minutos) y huérfanos manualmente"""
    try:
        from datetime import datetime, timedelta
        
        # Calcular la fecha límite: mensajes mayores a 15 minutos
        time_limit = datetime.utcnow() - timedelta(minutes=15)
        
        # Buscar mensajes antiguos
        old_messages = SMSMessage.query.filter(
            SMSMessage.created_at < time_limit
        ).all()
        
        # Buscar mensajes huérfanos (sin sms_config asociado)
        # Usar LEFT JOIN para encontrar mensajes cuyo sms_config_id no existe en sms_configs
        from sqlalchemy import and_
        orphan_messages = db.session.query(SMSMessage).outerjoin(
            SMSConfig, SMSMessage.sms_config_id == SMSConfig.id
        ).filter(
            SMSConfig.id.is_(None)
        ).all()
        
        # Combinar ambos tipos de mensajes a eliminar (sin duplicados)
        messages_to_delete = list(set(old_messages + orphan_messages))
        
        deleted_count = 0
        orphan_count = 0
        
        if messages_to_delete:
            for msg in messages_to_delete:
                # Verificar si es huérfano
                if msg not in old_messages:
                    orphan_count += 1
                db.session.delete(msg)
                deleted_count += 1
            
            db.session.commit()
            
            return jsonify({
                'success': True,
                'message': f'Se eliminaron {deleted_count} mensajes SMS ({len(old_messages)} antiguos, {orphan_count} huérfanos).',
                'deleted_count': deleted_count,
                'old_count': len(old_messages),
                'orphan_count': orphan_count
            }), 200
        else:
            return jsonify({
                'success': True,
                'message': 'No hay mensajes SMS antiguos o huérfanos para eliminar.',
                'deleted_count': 0,
                'old_count': 0,
                'orphan_count': 0
            }), 200
            
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Error al limpiar mensajes SMS: {str(e)}'
        }), 500

# ============================================================================
# ✅ NUEVO: RUTAS PARA GESTIÓN DE 2FA POR CORREO
# ============================================================================

@store_bp.route('/admin/twofa-configs', methods=['GET'])
@admin_required
def list_twofa_configs():
    """Lista todas las configuraciones 2FA"""
    try:
        configs = TwoFAConfig.query.order_by(TwoFAConfig.created_at.desc()).all()
        configs_data = []
        for config in configs:
            configs_data.append({
                'id': config.id,
                'secret_key': config.secret_key,
                'emails': config.emails,
                'emails_list': config.get_emails_list(),
                'is_enabled': config.is_enabled,
                'created_at': config.created_at.isoformat() if config.created_at else None,
                'updated_at': config.updated_at.isoformat() if config.updated_at else None
            })
        return jsonify({'success': True, 'configs': configs_data}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/admin/twofa-configs', methods=['POST'])
@admin_required
@csrf_exempt_route
def create_twofa_config():
    """Crea una nueva configuración 2FA"""
    try:
        import re
        
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No se recibieron datos'}), 400
        
        secret_key = data.get('secret_key', '').strip().upper().replace(' ', '').replace('-', '')
        emails_input = data.get('emails', '').strip()
        
        if not secret_key:
            return jsonify({'success': False, 'error': 'El secreto TOTP es obligatorio'}), 400
        
        # Validar formato (aceptar A-Z, 0-9 para compatibilidad con Microsoft y otras apps)
        # Bajamos el mínimo a 8 caracteres porque Microsoft a veces usa secretos cortos (ej: 15 chars)
        if not re.match(r'^[A-Z0-9]{8,}$', secret_key):
            return jsonify({'success': False, 'error': 'El secreto TOTP debe tener al menos 8 caracteres alfanuméricos'}), 400
        
        if not emails_input:
            return jsonify({'success': False, 'error': 'Debes agregar al menos un correo'}), 400
        
        # Normalizar correos: separar por coma o espacio, limpiar y validar
        emails_list = []
        for email in re.split(r'[,\s]+', emails_input):
            email = email.strip().lower()
            if email:
                # Validar formato básico de email
                if re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
                    emails_list.append(email)
                else:
                    return jsonify({'success': False, 'error': f'Correo inválido: {email}'}), 400
        
        if not emails_list:
            return jsonify({'success': False, 'error': 'No se encontraron correos válidos'}), 400
        
        # Verificar si algún correo ya está asociado a otra configuración
        existing_configs = TwoFAConfig.query.filter_by(is_enabled=True).all()
        for existing_config in existing_configs:
            existing_emails = existing_config.get_emails_list()
            duplicates = set(emails_list) & set(existing_emails)
            if duplicates:
                return jsonify({
                    'success': False, 
                    'error': f'Los correos {", ".join(duplicates)} ya están asociados a otra configuración 2FA'
                }), 400
        
        # Crear nueva configuración
        new_config = TwoFAConfig(
            secret_key=secret_key,
            emails=','.join(emails_list),
            is_enabled=True
        )
        db.session.add(new_config)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Configuración 2FA creada correctamente',
            'config': {
                'id': new_config.id,
                'secret_key': new_config.secret_key,
                'emails': new_config.emails,
                'emails_list': new_config.get_emails_list()
            }
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/admin/twofa-configs/<int:config_id>', methods=['PUT'])
@admin_required
@csrf_exempt_route
def update_twofa_config(config_id):
    """Actualiza una configuración 2FA"""
    try:
        import re
        
        config = TwoFAConfig.query.get_or_404(config_id)
        data = request.get_json()
        
        if not data:
            return jsonify({'success': False, 'error': 'No se recibieron datos'}), 400
        
        # Actualizar secreto si se proporciona
        if 'secret_key' in data:
            secret_key = data.get('secret_key', '').strip().upper().replace(' ', '').replace('-', '')
            if secret_key:
                # Validar formato (aceptar A-Z, 0-9 para compatibilidad)
                if not re.match(r'^[A-Z0-9]{8,}$', secret_key):
                    return jsonify({'success': False, 'error': 'El secreto TOTP debe tener al menos 8 caracteres alfanuméricos'}), 400
                config.secret_key = secret_key
        
        # Actualizar correos si se proporcionan
        if 'emails' in data:
            emails_input = data.get('emails', '').strip()
            if emails_input:
                emails_list = []
                for email in re.split(r'[,\s]+', emails_input):
                    email = email.strip().lower()
                    if email:
                        if re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
                            emails_list.append(email)
                        else:
                            return jsonify({'success': False, 'error': f'Correo inválido: {email}'}), 400
                
                if emails_list:
                    # Verificar duplicados en otras configuraciones (excluyendo la actual)
                    existing_configs = TwoFAConfig.query.filter(
                        TwoFAConfig.id != config_id,
                        TwoFAConfig.is_enabled == True
                    ).all()
                    for existing_config in existing_configs:
                        existing_emails = existing_config.get_emails_list()
                        duplicates = set(emails_list) & set(existing_emails)
                        if duplicates:
                            return jsonify({
                                'success': False,
                                'error': f'Los correos {", ".join(duplicates)} ya están asociados a otra configuración 2FA'
                            }), 400
                    
                    config.emails = ','.join(emails_list)
        
        # Actualizar estado si se proporciona
        if 'is_enabled' in data:
            config.is_enabled = bool(data.get('is_enabled'))
        
        config.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Configuración 2FA actualizada correctamente',
            'config': {
                'id': config.id,
                'secret_key': config.secret_key,
                'emails': config.emails,
                'emails_list': config.get_emails_list(),
                'is_enabled': config.is_enabled
            }
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/admin/twofa-configs/<int:config_id>', methods=['DELETE'])
@admin_required
def delete_twofa_config(config_id):
    """Elimina una configuración 2FA"""
    try:
        config = TwoFAConfig.query.get_or_404(config_id)
        emails = config.emails
        db.session.delete(config)
        db.session.commit()
        return jsonify({
            'success': True,
            'message': f'Configuración 2FA eliminada correctamente (correos: {emails})'
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/admin/twofa-configs/read-qr', methods=['POST'])
@admin_required
@csrf_exempt_route
def read_qr_code():
    """Lee un código QR y extrae el secreto TOTP"""
    try:
        from PIL import Image
        import io
        import re
        
        if 'qr_file' not in request.files:
            return jsonify({'success': False, 'error': 'No se recibió archivo QR'}), 400
        
        qr_file = request.files['qr_file']
        if qr_file.filename == '':
            return jsonify({'success': False, 'error': 'No se seleccionó ningún archivo'}), 400
        
        # Leer la imagen
        image_data = qr_file.read()
        image = Image.open(io.BytesIO(image_data))
        
        # Intentar leer el QR code
        try:
            try:
                from pyzbar import pyzbar
                decoded_objects = pyzbar.decode(image)
            except ImportError:
                # Intentar import alternativo
                from pyzbar.pyzbar import decode as pyzbar_decode
                decoded_objects = pyzbar_decode(image)
            
            if not decoded_objects:
                return jsonify({'success': False, 'error': 'No se pudo leer el código QR'}), 400
            
            qr_data = decoded_objects[0].data.decode('utf-8')
            
            # Buscar el secreto de forma más robusta (capturar todo hasta el final o hasta el siguiente parámetro)
            secret_match = re.search(r'secret=([A-Z0-9=]+)', qr_data, re.IGNORECASE)
            if secret_match:
                secret_key = secret_match.group(1).upper().strip().replace(' ', '').replace('-', '')
                return jsonify({
                    'success': True,
                    'secret_key': secret_key,
                    'qr_data': qr_data
                }), 200
            else:
                # Buscar cualquier cadena alfanumérica larga (secreto puro)
                potential_secret = re.search(r'([A-Z0-9]{8,})', qr_data, re.IGNORECASE)
                if potential_secret:
                    secret_key = potential_secret.group(1).upper().strip().replace(' ', '').replace('-', '')
                    return jsonify({
                        'success': True,
                        'secret_key': secret_key,
                        'qr_data': qr_data
                    }), 200
                else:
                    return jsonify({'success': False, 'error': 'El código QR no contiene un secreto TOTP válido'}), 400
                    
        except ImportError:
            # Si pyzbar no está instalado, intentar con qrcode (solo lectura básica)
            return jsonify({
                'success': False,
                'error': 'Librería pyzbar no instalada. Instala con: pip install pyzbar Pillow'
            }), 500
            
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error al leer QR: {str(e)}'}), 500

@store_bp.route('/sms/my-messages', methods=['GET'])
def get_my_sms_messages():
    """
    Obtiene los últimos 15 mensajes SMS permitidos para el usuario logueado.
    Verifica si el correo del usuario está en AllowedSMSNumber.
    Filtra por regex si están configurados para cada SMS config.
    """
    import re
    current_user = get_current_user()
    if not current_user:
        return jsonify({'success': False, 'error': 'Usuario no autenticado'}), 401
    
    # Normalizar correo del usuario
    user_email = current_user.username.lower() if '@' in current_user.username else None
    
    if not user_email:
        # Si el username no es un email, intentar buscar el email asociado si existe un campo email
        user_email = current_user.username.lower()

    # Buscar configuraciones SMS permitidas para este correo
    # Buscar en AllowedSMSNumber
    from sqlalchemy import func
    allowed_configs = db.session.query(AllowedSMSNumber.sms_config_id).filter(
        func.lower(AllowedSMSNumber.phone_number) == user_email
    ).all()
    
    if not allowed_configs:
        return jsonify({'success': True, 'messages': [], 'message': 'No tienes acceso a ningún número SMS.'})
    
    allowed_config_ids = [r[0] for r in allowed_configs]
    
    # Obtener todos los mensajes de los números permitidos
    all_messages = SMSMessage.query.filter(
        SMSMessage.sms_config_id.in_(allowed_config_ids)
    ).order_by(
        SMSMessage.created_at.desc()
    ).all()
    
    # Filtrar por regex SMS si están configurados
    filtered_messages = []
    for msg in all_messages:
        config = SMSConfig.query.get(msg.sms_config_id)
        if config:
            try:
                regex_count = config.regexes.count()
            except Exception:
                regex_count = 0
            
            if regex_count > 0:
                # Si hay regex SMS configurados, filtrar
                try:
                    regexes = list(config.regexes.filter_by(enabled=True).all())
                except Exception:
                    regexes = []
                
                matches_regex = False
                for regex_obj in regexes:
                    try:
                        # Buscar en el cuerpo del mensaje y en el número de origen
                        if regex_obj.pattern:
                            if re.search(regex_obj.pattern, msg.message_body, re.IGNORECASE) or \
                               re.search(regex_obj.pattern, msg.from_number, re.IGNORECASE):
                                matches_regex = True
                                break
                    except re.error:
                        continue
                if matches_regex:
                    filtered_messages.append(msg)
            else:
                # Si no hay regex configurados, incluir todos los mensajes
                filtered_messages.append(msg)
        else:
            # Si no hay config, incluir el mensaje
            filtered_messages.append(msg)
    
    # Ordenar por fecha descendente y limitar a 15
    filtered_messages.sort(key=lambda x: x.created_at, reverse=True)
    filtered_messages = filtered_messages[:15]
    
    messages_data = [{
        'id': msg.id,
        'from_number': msg.from_number,
        'message_body': msg.message_body,
        'created_at': utc_to_colombia(msg.created_at).strftime('%m/%d %I:%M %p') if msg.created_at else None,
        'ago': timesince(msg.created_at) if msg.created_at else ''
    } for msg in filtered_messages]
    
    return jsonify({
        'success': True, 
        'messages': messages_data,
        'count': len(messages_data)
    })

