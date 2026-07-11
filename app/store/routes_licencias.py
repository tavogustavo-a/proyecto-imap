# -*- coding: utf-8 -*-
"""Rutas portal y admin de licencias (store_bp)."""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import (
    Response,
    current_app,
    flash,
    g,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    session,
    stream_with_context,
    url_for,
)
from sqlalchemy import func as sa_func, or_, inspect, text
from sqlalchemy.orm import joinedload, selectinload

from app import db
from app.admin.decorators import admin_or_soporte_licencias_required, admin_required
from app.models.user import AllowedEmail, User
from app.utils.timezone import get_colombia_datetime, utc_to_colombia

from . import store_bp
from .routes import (
    LICENCIAS_STATIC_VERSION,
    USER_LIC_CADUCIDAD_VIEW_MAX_DAYS,
    _admin_proveedor_sales_stats_payload,
    _proveedor_sales_stats_revision_fingerprint,
    _apply_license_account_auto_renewal_charge,
    _attach_document_no_store_headers,
    _attach_private_no_cache_headers,
    _balance_recharge_viewer_billing_user,
    _billing_user_for_store_debt_limit,
    _eligible_tienda_user_licencias_portal,
    _ensure_license_account_renewal_reserve_columns,
    _license_account_auto_renewal_charge_blocked,
    _proveedor_bump_sales_count_for_license,
    _proveedor_finalize_checkout_license_sales,
    _proveedor_inventory_from_user_prices,
    _proveedor_inventory_payload_for_user,
    _proveedor_products_list_for_user,
    _proveedor_record_license_sale,
    _proveedor_reset_sales_count_on_user,
    _proveedor_sales_stats_services_for_user,
    _proveedor_services_catalog_for_user,
    _record_portal_renewal_blocked_activity,
    _renewal_account_unreserved_for_public_sale,
    _renewal_block_user_message,
    _renewal_clear_reservation,
    _renewal_release_stale_reservations,
    _save_proveedor_inventory_on_user,
    _save_proveedor_service_warranty_on_user,
    _store_dt_iso_utc_z,
    _user_puede_tener_deuda_effective,
    _user_store_proveedor_flag,
    _user_store_soporte_licencias_flag,
    _user_store_view_only,
    _json_licencias_view_only_forbidden,
    catalog_products_for_store_user,
    csrf_exempt_route,
    get_current_user,
    public_store_products_query,
    store_access_required,
)

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
    proveedor_nav = bool(_user_store_proveedor_flag(user))
    licencias_view_only = bool(_user_store_view_only(user))
    resp = make_response(render_template(
        'user_licencias.html',
        title='Licencias',
        tipo_precio=tipo_precio,
        current_user=user,
        username=username,
        saldo_usd=saldo_usd,
        saldo_cop=saldo_cop,
        soporte_licencias_nav=soporte_licencias_nav,
        proveedor_nav=proveedor_nav,
        licencias_view_only=licencias_view_only,
        licencias_static_version=LICENCIAS_STATIC_VERSION,
    ))
    _attach_document_no_store_headers(resp)
    return resp

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
    _ensure_license_term_days_column()


def _ensure_license_term_days_column():
    """Añade license_term_days (duración vigencia, default 30) si la tabla existía sin esa columna."""
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(db.engine)
        cols = {c['name'] for c in inspector.get_columns('store_licenses')}
        if 'license_term_days' not in cols:
            db.session.execute(
                text('ALTER TABLE store_licenses ADD COLUMN license_term_days INTEGER DEFAULT 30 NOT NULL')
            )
            db.session.commit()
    except Exception as e:
        current_app.logger.warning('No se pudo asegurar columna license_term_days: %s', e)


def _ensure_license_expired_notes_and_month_columns():
    """Añade expired_notes, month_to_month, allow_reservation y renew_customer_account si faltan."""
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(db.engine)
        dialect = getattr(db.engine.dialect, 'name', '') or ''
        bool_col_sql = (
            'BOOLEAN NOT NULL DEFAULT FALSE'
            if dialect == 'postgresql'
            else 'INTEGER DEFAULT 0 NOT NULL'
        )

        def _cols():
            return {c['name'].lower() for c in inspector.get_columns('store_licenses')}

        cols = _cols()
        if 'expired_notes' not in cols:
            db.session.execute(text('ALTER TABLE store_licenses ADD COLUMN expired_notes TEXT'))
            db.session.commit()
        cols = _cols()
        if 'customer_renewal_notes' not in cols:
            db.session.execute(text('ALTER TABLE store_licenses ADD COLUMN customer_renewal_notes TEXT'))
            db.session.commit()
        cols = _cols()
        for flag_col in ('month_to_month', 'allow_reservation', 'renew_customer_account'):
            if flag_col not in cols:
                db.session.execute(
                    text(f'ALTER TABLE store_licenses ADD COLUMN {flag_col} {bool_col_sql}')
                )
                db.session.commit()
                cols = _cols()
    except Exception as e:
        db.session.rollback()
        current_app.logger.warning(
            'No se pudo asegurar columnas expired_notes/month_to_month/allow_reservation/renew_customer_account: %s',
            e,
        )


def _ensure_license_changes_notes_column():
    """Añade changes_notes en SQLite si la tabla ya existía sin esa columna."""
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(db.engine)
        cols = {c['name'].lower() for c in inspector.get_columns('store_licenses')}
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
_STORE_LICENSE_FEATURE_COLUMNS_ENSURED = False


@store_bp.before_request
def _store_bp_ensure_license_feature_columns_schema():
    """Evita 500: columnas/tablas de reservas y renovar cuenta del cliente."""
    global _STORE_LICENSE_FEATURE_COLUMNS_ENSURED
    if _STORE_LICENSE_FEATURE_COLUMNS_ENSURED:
        return
    _ensure_license_expired_notes_and_month_columns()
    _ensure_license_changes_notes_column()
    _ensure_license_day_notepads_column()
    _ensure_license_portal_day_row_notes_column()
    _ensure_license_account_client_notes_column()
    _ensure_license_account_renewal_reserve_columns()
    try:
        from app.store.customer_account_renewals import ensure_customer_account_renewal_schema
        from app.store.product_reservations import ensure_product_reservation_schema

        ensure_product_reservation_schema()
        ensure_customer_account_renewal_schema()
    except Exception as ex:
        current_app.logger.warning(
            'No se pudo asegurar esquema reservas/renovar cuenta cliente: %s', ex
        )
    _STORE_LICENSE_FEATURE_COLUMNS_ENSURED = True


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
            lic_row = getattr(account, 'license', None)
            account.expires_at = stamp + _license_account_term_timedelta(lic_row)
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
    try:
        n = int(v)
    except (TypeError, ValueError):
        return 5
    if n < 0:
        return 0
    if n > 3650:
        return 3650
    return n


def _license_term_days_public(license_row):
    from app.store.license_term_utils import license_term_days_public

    return license_term_days_public(license_row)


def _license_account_term_timedelta(license_row):
    from datetime import timedelta

    return timedelta(days=_license_term_days_public(license_row))


def _license_billing_period_label(license_row):
    from app.store.license_term_utils import license_billing_period_label

    return license_billing_period_label(_license_term_days_public(license_row))


def _license_term_ui_label(license_row):
    from app.store.license_term_utils import license_term_ui_label

    return license_term_ui_label(_license_term_days_public(license_row))


def _reject_user_licencias_api(message, code=403):
    resp = jsonify({'success': False, 'error': message})
    _attach_private_no_cache_headers(resp)
    return resp, code


def _portal_expiry_fields_for_account(acc, lic):
    """expires_at / días restantes para portal (incluye fallback assigned_at + term)."""
    from app.store.models import _license_account_expiry_as_utc_aware

    at = getattr(acc, 'assigned_at', None) if acc is not None else None
    exp_at = getattr(acc, 'expires_at', None) if acc is not None else None
    term = _license_term_days_public(lic) if lic is not None else 30

    if exp_at is None and at is not None and term:
        try:
            exp_at = at + _license_account_term_timedelta(lic)
        except Exception:
            pass

    days_left = None
    if exp_at is not None:
        try:
            exp_aware = _license_account_expiry_as_utc_aware(exp_at)
            now_u = datetime.now(timezone.utc)
            delta = exp_aware - now_u
            days_left = max(0, int(delta.days))
        except Exception:
            days_left = None
    if days_left is None and acc is not None:
        try:
            days_left = acc.days_until_expiry
        except Exception:
            days_left = None

    return {
        'assigned_at_iso': at.isoformat() if at is not None else None,
        'expires_at_iso': exp_at.isoformat() if exp_at is not None else None,
        'days_until_expiry': days_left,
        'license_term_days': term,
    }


def _portal_match_account_for_day_lines(lic, user_obj, day_lines):
    """Intenta vincular filas del bloc a una cuenta inventario asignada (para tarjetas virtuales)."""
    from app.store.models import LicenseAccount

    if not lic or not user_obj or not day_lines:
        return None
    uid = getattr(user_obj, 'id', None)
    if not uid:
        return None

    cred_keys = set()
    for d_cal in range(1, 32):
        for row in day_lines.get(str(d_cal)) or []:
            if not isinstance(row, dict):
                continue
            cred = str(row.get('cred') or '').strip()
            if not cred:
                continue
            email_k = _credential_email_normalized_from_plain(cred)
            if email_k:
                cred_keys.add(email_k)
            ident = cred.split()[0].strip().lower() if cred else ''
            if ident:
                cred_keys.add(ident)

    if not cred_keys:
        return None

    accounts = (
        LicenseAccount.query.filter(
            LicenseAccount.license_id == lic.id,
            LicenseAccount.assigned_to_user_id == uid,
            LicenseAccount.status.in_(('assigned', 'sold')),
        )
        .order_by(LicenseAccount.expires_at.desc(), LicenseAccount.id.desc())
        .all()
    )
    for acc in accounts:
        em = (getattr(acc, 'email', None) or '').strip().lower()
        ident = (getattr(acc, 'account_identifier', None) or '').strip().lower()
        if em and em in cred_keys:
            return acc
        if ident and ident in cred_keys:
            return acc
    if len(accounts) == 1:
        return accounts[0]
    return None


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
    """Días hasta vencer: contador desde expires_at (duración configurada del producto)."""
    exp_iso = row_dict.get('expires_at_iso')
    if exp_iso:
        try:
            from app.store.models import _license_account_expiry_as_utc_aware

            exp_raw = str(exp_iso).replace('Z', '+00:00')
            exp_dt = datetime.fromisoformat(exp_raw)
            exp_aware = _license_account_expiry_as_utc_aware(exp_dt)
            now_u = datetime.now(timezone.utc)
            delta = exp_aware - now_u
            row_dict['days_until_expiry'] = max(0, int(delta.days))
        except Exception:
            pass
    elif row_dict.get('assigned_at_iso') and row_dict.get('license_term_days'):
        try:
            at_raw = str(row_dict['assigned_at_iso']).replace('Z', '+00:00')
            at_dt = datetime.fromisoformat(at_raw)
            if at_dt.tzinfo is None:
                at_dt = at_dt.replace(tzinfo=timezone.utc)
            term = int(row_dict['license_term_days'])
            exp_dt = at_dt + timedelta(days=term)
            now_u = datetime.now(timezone.utc)
            row_dict['expires_at_iso'] = exp_dt.isoformat()
            row_dict['days_until_expiry'] = max(0, int((exp_dt - now_u).days))
        except Exception:
            pass

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
    row_dict['days_until_calendar_sale'] = cal_left


def _days_until_calendar_sale_day(calendar_day_int, ref_co=None):
    """
    Días hasta la próxima ocurrencia del día N del mes (Colombia).
    Mismo criterio que la renovación automática «mes a mes» por día de calendario.
    """
    from app.store.license_calendar_days import days_until_calendar_sale_day

    return days_until_calendar_sale_day(calendar_day_int, ref_co)


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


def _portal_accounts_revision_hash(out_list):
    import hashlib
    import json as _json

    payload = _json.dumps(out_list, sort_keys=True, default=str, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:24]


def _license_portal_effective_saldo(billing_user):
    """
    Deuda total mostrada como Pagada/Debe (portal y admin) = suma de las dos fuentes reales:
    - prepago tienda en negativo (``saldo_cop``/``saldo_usd``: compras del checkout), y
    - cuenta licencias (``users.saldo``: ventas admin / asignaciones / renovaciones).
    Si solo se mirara una, los cobros de la otra no subirían la deuda y el reparto por
    cuenta marcaría cuentas como «Pagada» sin haber abonos reales.
    """
    if not billing_user:
        return 0.0
    try:
        base = float(getattr(billing_user, 'saldo', 0) or 0)
    except (TypeError, ValueError):
        base = 0.0
    up = billing_user.user_prices if isinstance(getattr(billing_user, 'user_prices', None), dict) else {}
    tipo = str(up.get('tipo_precio') or 'COP').strip().upper()
    field = 'saldo_usd' if tipo == 'USD' else 'saldo_cop'
    try:
        prepaid = float(getattr(billing_user, field, 0) or 0)
    except (TypeError, ValueError):
        prepaid = 0.0
    prepaid_debt = -prepaid if prepaid < -1e-9 else 0.0
    return base + prepaid_debt


def _dedupe_drift_license_accounts(accts):
    """Drift: doble sync admin (PUT + JS) pudo crear dos cuentas sold iguales el mismo día.
    Mismo criterio en portal y en admin para que el reparto de deuda coincida."""
    seen_acct_keys = set()
    deduped = []
    for acc in accts or []:
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
        deduped.append(acc)
    return deduped


def _license_account_debt_allocation(billing_user, accounts):
    """
    Reparte la deuda efectiva del cliente entre sus cuentas compradas: los pagos se
    aplican de la cuenta más vieja a la más nueva. Devuelve {account_id: pendiente}:
    0 = esa cuenta quedó pagada; >0 = lo que aún se debe de esa cuenta (según su precio
    para el cliente). Ej.: cuenta de 5000 con 3000 abonados → pendiente 2000.
    """
    dues = {}
    if not billing_user:
        return dues
    total_debt = _license_portal_effective_saldo(billing_user)
    if total_debt < 0:
        total_debt = 0.0

    def _sort_key(acc):
        at = getattr(acc, 'assigned_at', None)
        # str() evita comparar datetimes naive/aware entre sí; mismo formato = orden cronológico.
        return (0 if at is not None else 1, str(at or ''), int(getattr(acc, 'id', 0) or 0))

    ordered = sorted(list(accounts or []), key=_sort_key)
    prices = []
    for acc in ordered:
        lic = getattr(acc, 'license', None)
        product = getattr(lic, 'product', None) if lic else None
        try:
            price = float(_debt_increment_per_bulk_license_sale(product, billing_user))
        except Exception:
            price = 0.0
        prices.append(max(0.0, price))

    total_price = sum(prices)
    paid_pool = max(0.0, total_price - total_debt)
    for acc, price in zip(ordered, prices):
        pay = min(price, paid_pool)
        paid_pool -= pay
        due = price - pay
        dues[int(acc.id)] = round(due, 2) if abs(due) > 1e-9 else 0.0
    return dues


def _portal_accounts_revision_fingerprint(user_obj):
    """
    Hash ligero para sondeo del portal: mismos disparadores que la vista completa
    (cuentas, licencias, notas, saldo, día Colombia/UTC) sin parsear blocs día 1–31.
    """
    import hashlib
    import json as _json

    from app.store.models import License, LicenseAccount

    assignee_ids, allowed_names = _user_licencias_viewer_scope(user_obj)
    co = get_colombia_datetime()
    utc_now = datetime.now(timezone.utc)
    if not assignee_ids:
        empty_key = (
            f'v:2|co:{co.date().isoformat()}|utc:{utc_now.date().isoformat()}|empty'
        )
        return hashlib.sha256(empty_key.encode('utf-8')).hexdigest()[:24]

    billing_user = user_obj
    if user_obj.parent_id:
        pu_b = User.query.get(user_obj.parent_id)
        if pu_b:
            billing_user = pu_b
    billing_saldo = _license_portal_effective_saldo(billing_user)

    viewer_id = int(user_obj.id)
    parts = [
        'v:2',
        f'co:{co.date().isoformat()}',
        f'utc:{utc_now.date().isoformat()}',
        f'saldo:{billing_saldo:.4f}',
        'names:' + '|'.join(sorted(allowed_names)),
    ]

    acct_rows = (
        LicenseAccount.query.filter(LicenseAccount.assigned_to_user_id.in_(assignee_ids))
        .filter(
            or_(
                sa_func.lower(sa_func.coalesce(LicenseAccount.status, '')).in_(('assigned', 'sold')),
                LicenseAccount.status.is_(None),
            )
        )
        .order_by(LicenseAccount.id.asc())
        .all()
    )

    license_ids = set()
    for acc in acct_rows:
        license_ids.add(int(acc.license_id))
        parts.append(
            'acc|'
            + '|'.join(
                [
                    str(acc.id),
                    str(acc.license_id),
                    str(acc.updated_at or ''),
                    str(acc.status or ''),
                    str(acc.email or ''),
                    str(acc.account_identifier or ''),
                    str(acc.client_notes or ''),
                    str(acc.assigned_at or ''),
                    str(acc.expires_at or ''),
                    str(acc.inventory_bloc_ord if acc.inventory_bloc_ord is not None else ''),
                ]
            )
        )

    virt_lic_ids = {
        int(row.id)
        for row in License.query.filter(
            License.enabled.is_(True),
            License.day_notepads_json.isnot(None),
        ).with_entities(License.id)
    }
    license_ids |= virt_lic_ids

    if license_ids:
        lic_rows = (
            License.query.options(joinedload(License.product))
            .filter(License.id.in_(license_ids))
            .order_by(License.id.asc())
            .all()
        )
        for lic in lic_rows:
            notes_map = _portal_day_notes_map_for_user(lic, viewer_id)
            notes_sig = _json.dumps(notes_map, sort_keys=True, separators=(',', ':'))
            prod = lic.product
            prod_name = (prod.name if prod else '') or ''
            prod_img = (getattr(prod, 'image_filename', None) or '') if prod else ''
            day_pad = getattr(lic, 'day_notepads_json', None) or ''
            day_pad_sig = hashlib.sha256(str(day_pad).encode('utf-8')).hexdigest()[:16]
            parts.append(
                'lic|'
                + '|'.join(
                    [
                        str(lic.id),
                        str(lic.updated_at or ''),
                        '1' if lic.enabled else '0',
                        str(lic.product_id),
                        str(getattr(lic, 'warranty_days', '') or ''),
                        str(getattr(lic, 'license_term_days', '') or ''),
                        '1' if getattr(lic, 'month_to_month', False) else '0',
                        prod_name,
                        prod_img,
                        notes_sig,
                        day_pad_sig,
                    ]
                )
            )

    digest = hashlib.sha256('\n'.join(parts).encode('utf-8')).hexdigest()
    return digest[:24]


def _text_revision_sig(val):
    import hashlib

    return hashlib.sha256(str(val or '').encode('utf-8')).hexdigest()[:16]


def _admin_licenses_revision_fingerprint(*, archived_only=False):
    """
    Hash ligero para admin licencias: detecta cambios en licencias, cuentas y productos
    sin serializar la respuesta completa de /api/licenses.
    """
    import hashlib

    from app.store.models import License, LicenseAccount, Product

    co = get_colombia_datetime()
    utc_now = datetime.now(timezone.utc)
    parts = [
        'v:1',
        f'mode:{"archived" if archived_only else "all"}',
        f'co:{co.date().isoformat()}',
        f'utc:{utc_now.date().isoformat()}',
    ]

    q = License.query.order_by(License.id.asc())
    if archived_only:
        q = q.filter(License.enabled.is_(False))
    licenses = q.all()

    license_ids = []
    product_ids = set()
    for lic in licenses:
        license_ids.append(int(lic.id))
        product_ids.add(int(lic.product_id))
        parts.append(
            'lic|'
            + '|'.join(
                [
                    str(lic.id),
                    str(lic.updated_at or ''),
                    str(lic.position),
                    '1' if lic.enabled else '0',
                    str(lic.product_id),
                    str(getattr(lic, 'warranty_days', '') or ''),
                    str(getattr(lic, 'license_term_days', '') or ''),
                    '1' if getattr(lic, 'month_to_month', False) else '0',
                    _text_revision_sig(lic.personal_notes),
                    _text_revision_sig(lic.license_notes),
                    _text_revision_sig(getattr(lic, 'suspended_notes', None)),
                    _text_revision_sig(getattr(lic, 'expired_notes', None)),
                    _text_revision_sig(getattr(lic, 'changes_notes', None)),
                    _text_revision_sig(getattr(lic, 'customer_renewal_notes', None)),
                    _text_revision_sig(getattr(lic, 'day_notepads_json', None)),
                    _text_revision_sig(getattr(lic, 'portal_day_row_notes_json', None)),
                ]
            )
        )

    if product_ids:
        for prod in Product.query.filter(Product.id.in_(product_ids)).order_by(Product.id.asc()).all():
            parts.append(
                'prod|'
                + '|'.join(
                    [
                        str(prod.id),
                        str(prod.name or ''),
                        str(prod.image_filename or ''),
                        '1' if prod.enabled else '0',
                    ]
                )
            )

    if license_ids:
        acc_rows = (
            db.session.query(
                LicenseAccount.license_id,
                LicenseAccount.status,
                sa_func.count(LicenseAccount.id),
                sa_func.max(LicenseAccount.updated_at),
                sa_func.max(LicenseAccount.expires_at),
            )
            .filter(LicenseAccount.license_id.in_(license_ids))
            .group_by(LicenseAccount.license_id, LicenseAccount.status)
            .order_by(LicenseAccount.license_id.asc(), LicenseAccount.status.asc())
            .all()
        )
        for lid, status, cnt, max_upd, max_exp in acc_rows:
            parts.append(
                f'acc|{lid}|{status or ""}|{cnt}|{max_upd or ""}|{max_exp or ""}'
            )

    return hashlib.sha256('\n'.join(parts).encode('utf-8')).hexdigest()[:24]


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


def _portal_append_virtual_license_bundle(out, lic, day_lines_uo, billing_saldo, user_obj):
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

    matched_acc = _portal_match_account_for_day_lines(lic, user_obj, day_lines_uo)
    expiry_payload = _portal_expiry_fields_for_account(matched_acc, lic)

    out.append(
        {
            'account_id': getattr(matched_acc, 'id', None) if matched_acc is not None else None,
            'virtual': matched_acc is None,
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
            'assigned_at_iso': expiry_payload.get('assigned_at_iso'),
            'expires_at_iso': expiry_payload.get('expires_at_iso'),
            'days_until_expiry': expiry_payload.get('days_until_expiry'),
            'account_expired': False,
            'warranty_days': warranty_days_v,
            'license_term_days': expiry_payload.get('license_term_days') or _license_term_days_public(lic),
            'billing_period_label': _license_billing_period_label(lic),
            'billing_saldo': billing_saldo,
            'month_to_month': bool(getattr(lic, 'month_to_month', False)),
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
        if primary.get('days_until_expiry') is None or not primary.get('expires_at_iso'):
            matched = _portal_match_account_for_day_lines(lic, user_obj, primary.get('day_lines') or {})
            exp_payload = _portal_expiry_fields_for_account(matched, lic)
            if exp_payload.get('expires_at_iso') or exp_payload.get('days_until_expiry') is not None:
                primary['assigned_at_iso'] = exp_payload.get('assigned_at_iso')
                primary['expires_at_iso'] = exp_payload.get('expires_at_iso')
                primary['days_until_expiry'] = exp_payload.get('days_until_expiry')
                primary['license_term_days'] = exp_payload.get('license_term_days')
                if matched is not None and primary.get('account_id') is None:
                    primary['account_id'] = matched.id
                    primary['virtual'] = False
    else:
        _portal_append_virtual_license_bundle(out, lic, day_lines_uo, billing_saldo, user_obj)


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
            expires_at=assigned_at + _license_account_term_timedelta(license_row),
        )
        db.session.add(acc)
        db.session.flush()
        _apply_portal_assignee_from_line_username(acc, p['assign_username'])


def _portal_merge_customer_renewal_orders_for_user(out, assignee_ids, allowed_names, user_obj, billing_saldo):
    """
    Muestra en el portal del cliente las renovaciones «Renovar tu cuenta»:
    - Pendientes (aún en cola admin).
    - Completadas en el calendario aunque el username guardado no coincida con el comprador.
    """
    from app.models.user import User
    from app.store.customer_account_renewals import (
        customer_account_renewal_status_label,
        extract_email_from_renewal_credential,
    )
    from app.store.models import CustomerAccountRenewalOrder, License
    from app.store.user_license_line_parse import (
        dual_to_portal_readonly_row,
        parse_admin_license_line_to_split_parts,
    )
    from app.utils.timezone import get_colombia_datetime

    if not assignee_ids:
        return

    orders = (
        CustomerAccountRenewalOrder.query.options(
            joinedload(CustomerAccountRenewalOrder.product),
        )
        .filter(CustomerAccountRenewalOrder.user_id.in_(assignee_ids))
        .order_by(CustomerAccountRenewalOrder.id.desc())
        .all()
    )
    if not orders:
        return

    seen_order_ids = set()

    def _portal_row_matches_renewal_email(row, email):
        em = (email or '').strip().lower()
        if not em or not row or not isinstance(row, dict):
            return False
        cred = str(row.get('cred') or '')
        line_em = extract_email_from_renewal_credential(cred) or cred.strip().lower()
        return line_em == em or em in cred.lower()

    def _portal_already_shows_email(license_id, email):
        em = (email or '').strip().lower()
        if not em or not license_id:
            return False
        for acc in out:
            if acc.get('license_id') != license_id:
                continue
            day_lines = acc.get('day_lines') or {}
            for d in range(1, 32):
                for row in day_lines.get(str(d)) or []:
                    if _portal_row_matches_renewal_email(row, em):
                        return True
        return False

    def _portal_annotate_pending_renewal_on_existing_rows(license_id, email):
        """Marca filas ya visibles cuando hay renovación pendiente (evita duplicar la fila)."""
        em = (email or '').strip().lower()
        if not em or not license_id:
            return
        pending_label = customer_account_renewal_status_label('pending')
        for acc in out:
            if acc.get('license_id') != license_id:
                continue
            day_lines = acc.get('day_lines') or {}
            for d in range(1, 32):
                rows = day_lines.get(str(d)) or []
                for row in rows:
                    if not _portal_row_matches_renewal_email(row, em):
                        continue
                    row['label_bad'] = pending_label
                    row['customer_renewal_status'] = 'pending'

    def _inject_day_lines(lic, day_lines_inj):
        if not any(day_lines_inj.get(str(d)) for d in range(1, 32)):
            return
        targets = [r for r in out if r.get('license_id') == lic.id]
        if targets:
            primary = sorted(
                targets,
                key=lambda r: (1 if r.get('virtual') else 0, r.get('account_id') or 0),
            )[0]
            if not isinstance(primary.get('day_lines'), dict):
                primary['day_lines'] = {}
            for d in range(1, 32):
                k = str(d)
                merged = _portal_merge_day_rows_deduped(
                    (primary.get('day_lines') or {}).get(k) or [],
                    day_lines_inj.get(k) or [],
                )
                if merged:
                    primary['day_lines'][k] = merged
            return
        _portal_append_virtual_license_bundle(out, lic, day_lines_inj, billing_saldo, user_obj)

    for order in orders:
        if order.id in seen_order_ids:
            continue
        seen_order_ids.add(order.id)

        lic_id = order.license_id
        if not lic_id:
            continue
        lic = License.query.options(joinedload(License.product)).filter_by(id=int(lic_id)).first()
        if not lic or not lic.enabled:
            continue

        buyer = User.query.get(order.user_id)
        buyer_username = (getattr(buyer, 'username', None) or '').strip()
        if not buyer_username and allowed_names:
            buyer_username = str(allowed_names[0] or '').strip()
        em = (order.customer_email or '').strip().lower()
        if not em:
            continue

        status = (order.status or 'pending').strip().lower()
        if _portal_already_shows_email(lic.id, em):
            if status == 'pending':
                _portal_annotate_pending_renewal_on_existing_rows(lic.id, em)
            continue

        day_lines_inj = {}
        raw_dn = getattr(lic, 'day_notepads_json', None) or ''
        day_map = {}
        if str(raw_dn).strip():
            try:
                import json as _json

                day_map = _json.loads(raw_dn)
                if not isinstance(day_map, dict):
                    day_map = {}
            except Exception:
                day_map = {}

        for d in range(1, 32):
            day_text = day_map.get(str(d)) or ''
            if not str(day_text).strip():
                continue
            rows = []
            for phys_idx, line in enumerate(str(day_text).replace('\r\n', '\n').split('\n')):
                if not line.strip():
                    continue
                dual = parse_admin_license_line_to_split_parts(line)
                cred = str(dual.get('cred') or '')
                line_em = extract_email_from_renewal_credential(cred) or cred.strip().lower()
                if line_em != em and em not in cred.lower():
                    continue
                row = dual_to_portal_readonly_row(
                    dual,
                    line,
                    d,
                    phys_idx,
                    display_user=buyer_username,
                    row_ordinal=len(rows),
                )
                if status == 'pending':
                    row['label_bad'] = customer_account_renewal_status_label('pending')
                    row['customer_renewal_status'] = 'pending'
                rows.append(row)
            if rows:
                day_lines_inj[str(d)] = rows

        if not day_lines_inj and status == 'pending':
            co_day = int(get_colombia_datetime().day)
            dual_pending = {
                'cred': (order.customer_email or '').strip(),
                'user': buyer_username,
                'statusGood': '',
                'statusBad': '',
                'otroDetail': '',
                'extra': '',
            }
            row = dual_to_portal_readonly_row(
                dual_pending,
                dual_pending['cred'],
                co_day,
                0,
                display_user=buyer_username,
                row_ordinal=0,
            )
            row['label_bad'] = customer_account_renewal_status_label('pending')
            row['customer_renewal_status'] = 'pending'
            day_lines_inj[str(co_day)] = [row]

        if day_lines_inj:
            _inject_day_lines(lic, day_lines_inj)


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
    billing_saldo = _license_portal_effective_saldo(billing_user)

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
    accts = _dedupe_drift_license_accounts(accts)

    assigned_license_ids = set()
    for acc in accts:
        lid_a = getattr(acc, 'license_id', None)
        if lid_a is not None:
            assigned_license_ids.add(lid_a)

    account_dues = _license_account_debt_allocation(billing_user, accts)

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
        expiry_payload = _portal_expiry_fields_for_account(acc, lic)
        try:
            days_left = expiry_payload.get('days_until_expiry')
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
            'assigned_at_iso': expiry_payload.get('assigned_at_iso'),
            'expires_at_iso': expiry_payload.get('expires_at_iso'),
            'days_until_expiry': days_left,
            'days_until_calendar_sale': None,
            'account_expired': bool(acc.is_expired),
            'warranty_days': warranty_days_pub,
            'license_term_days': expiry_payload.get('license_term_days') or 30,
            'billing_period_label': _license_billing_period_label(lic) if lic else 'mensual',
            'billing_saldo': billing_saldo,
            # Pendiente de ESTA cuenta (deuda repartida de la más vieja a la más nueva).
            'billing_account_due': account_dues.get(int(acc.id)),
            'month_to_month': bool(getattr(lic, 'month_to_month', False)) if lic else False,
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
    _portal_merge_customer_renewal_orders_for_user(
        out, assignee_ids, allowed_names, user_obj, billing_saldo
    )
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
        proveedor_nav = bool(_user_store_proveedor_flag(user_obj))
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
        portal_rev = _portal_accounts_revision_fingerprint(user_obj)
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
                'proveedor': proveedor_nav,
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


def _user_proveedor_api_guard(user_obj):
    if not session.get('logged_in'):
        return _reject_user_licencias_api('Debes iniciar sesión.', 401)
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
    if not _user_store_proveedor_flag(user_obj):
        return _reject_user_licencias_api('No tienes permiso de proveedor.', 403)
    return None


@store_bp.route('/api/user/proveedor-inventory', methods=['GET'])
@csrf_exempt_route
def api_user_proveedor_inventory_get():
    """Inventario del proveedor: bloc Licencias + días 1–31 (solo usuario con permiso proveedor)."""
    try:
        user_obj = User.query.get(session.get('user_id'))
        guard = _user_proveedor_api_guard(user_obj)
        if guard is not None:
            return guard
        payload = _proveedor_inventory_payload_for_user(user_obj)
        ok = jsonify({'success': True, **payload})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        current_app.logger.exception('api_user_proveedor_inventory_get')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/user/proveedor-inventory', methods=['PUT'])
def api_user_proveedor_inventory_put():
    """Proveedor edita Licencias, Vencidas y Caídas. Los días 1–31 no se modifican desde el portal."""
    try:
        user_obj = User.query.get(session.get('user_id'))
        guard = _user_proveedor_api_guard(user_obj)
        if guard is not None:
            return guard
        if _user_store_view_only(user_obj):
            return _json_licencias_view_only_forbidden()
        data = request.get_json(silent=True) or {}
        _save_proveedor_inventory_on_user(
            user_obj,
            license_lines=data.get('license_lines'),
            license_notes=data.get('license_notes'),
            expired_lines=data.get('expired_lines'),
            expired_notes=data.get('expired_notes'),
            suspended_lines=data.get('suspended_lines'),
            suspended_notes=data.get('suspended_notes'),
        )
        db.session.commit()
        inv = _proveedor_inventory_payload_for_user(user_obj)
        ok = jsonify({'success': True, **inv})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_user_proveedor_inventory_put')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/user/proveedor-products', methods=['GET'])
@csrf_exempt_route
def api_user_proveedor_products_get():
    """Productos del proveedor (solo nombre + gar.) para «Gestionar productos» en portal."""
    try:
        user_obj = User.query.get(session.get('user_id'))
        guard = _user_proveedor_api_guard(user_obj)
        if guard is not None:
            return guard
        products = _proveedor_products_list_for_user(user_obj)
        ok = jsonify({'success': True, 'products': products})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        current_app.logger.exception('api_user_proveedor_products_get')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/user/proveedor-products/<int:license_id>/warranty', methods=['PUT'])
def api_user_proveedor_product_warranty_put(license_id):
    """Actualizar reserva gar. del proveedor para una licencia habilitada."""
    try:
        user_obj = User.query.get(session.get('user_id'))
        guard = _user_proveedor_api_guard(user_obj)
        if guard is not None:
            return guard
        if _user_store_view_only(user_obj):
            return _json_licencias_view_only_forbidden()
        data = request.get_json(silent=True) or {}
        raw = data.get('warranty_days')
        if raw is None:
            return _reject_user_licencias_api('warranty_days requerido', 400)
        try:
            wd = int(raw)
        except (TypeError, ValueError):
            return _reject_user_licencias_api('Valor de garantía inválido', 400)
        if wd < 0 or wd > 3650:
            return _reject_user_licencias_api(
                'La reserva gar. debe estar entre 0 y 3650 cuentas.', 400
            )
        ok_save, err_msg = _save_proveedor_service_warranty_on_user(user_obj, license_id, wd)
        if not ok_save:
            return _reject_user_licencias_api(err_msg or 'No se pudo guardar.', 400)
        db.session.commit()
        ok = jsonify({'success': True, 'license_id': license_id, 'warranty_days': wd})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_user_proveedor_product_warranty_put')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


def _proveedor_enabled_license_ids_from_user_prices(user_prices):
    """IDs de licencias tienda que el proveedor puede vender (claves en proveedor_services)."""
    up = user_prices if isinstance(user_prices, dict) else {}
    raw = up.get('proveedor_services')
    if not isinstance(raw, dict):
        return []
    out = []
    for key in raw.keys():
        try:
            lid = int(key)
        except (TypeError, ValueError):
            continue
        if lid > 0:
            out.append(lid)
    return out


def _admin_proveedor_inventory_providers_list():
    """Inventario de todos los usuarios con permiso proveedor (solo principales)."""
    rows = User.query.filter(User.parent_id.is_(None)).order_by(User.username.asc()).all()
    providers = []
    for user_row in rows:
        up = user_row.user_prices if isinstance(user_row.user_prices, dict) else {}
        if not up.get('proveedor'):
            continue
        inv = _proveedor_inventory_from_user_prices(up)
        providers.append(
            {
                'user_id': user_row.id,
                'username': user_row.username or str(user_row.id),
                'license_notes': inv['license_notes'],
                'license_lines': inv['license_lines'],
                'day_notepads': inv['day_notepads'],
                'day_lines': inv['day_lines'],
                'expired_lines': inv.get('expired_lines') or [],
                'expired_notes': inv.get('expired_notes') or '',
                'suspended_lines': inv.get('suspended_lines') or [],
                'suspended_notes': inv.get('suspended_notes') or '',
                'enabled_license_ids': _proveedor_enabled_license_ids_from_user_prices(up),
                'services_catalog': _proveedor_services_catalog_for_user(user_row),
            }
        )
    return providers


@store_bp.route('/api/admin/proveedor-inventory', methods=['GET'])
@admin_or_soporte_licencias_required
def api_admin_proveedor_inventory_get():
    """Inventario agregado de proveedores para Admin Licencias."""
    try:
        providers = _admin_proveedor_inventory_providers_list()
        ok = jsonify({'success': True, 'providers': providers})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        current_app.logger.exception('api_admin_proveedor_inventory_get')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/admin/proveedor-inventory', methods=['PUT'])
@admin_or_soporte_licencias_required
def api_admin_proveedor_inventory_put():
    """Guardar inventario proveedor (admin). Borrados de stock no van a Caídas/Vencidas."""
    try:
        data = request.get_json(silent=True) or {}
        try:
            uid = int(data.get('user_id'))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'user_id inválido'}), 400
        user_obj = User.query.get(uid)
        if not user_obj or user_obj.parent_id is not None:
            return jsonify({'success': False, 'error': 'Usuario proveedor no encontrado'}), 404
        up = user_obj.user_prices if isinstance(user_obj.user_prices, dict) else {}
        if not up.get('proveedor'):
            return jsonify({'success': False, 'error': 'El usuario no es proveedor'}), 403

        _save_proveedor_inventory_on_user(
            user_obj,
            license_lines=data.get('license_lines'),
            day_lines=data.get('day_lines'),
            expired_lines=data.get('expired_lines'),
            suspended_lines=data.get('suspended_lines'),
            license_notes=data.get('license_notes'),
            day_notepads=data.get('day_notepads'),
            expired_notes=data.get('expired_notes'),
            suspended_notes=data.get('suspended_notes'),
        )
        db.session.commit()
        inv = _proveedor_inventory_from_user_prices(
            user_obj.user_prices if isinstance(user_obj.user_prices, dict) else {}
        )
        ok = jsonify(
            {
                'success': True,
                'user_id': uid,
                'license_notes': inv.get('license_notes') or '',
                'license_lines': inv.get('license_lines') or [],
                'day_notepads': inv.get('day_notepads') or {},
                'day_lines': inv.get('day_lines') or {},
                'expired_notes': inv.get('expired_notes') or '',
                'expired_lines': inv.get('expired_lines') or [],
                'suspended_notes': inv.get('suspended_notes') or '',
                'suspended_lines': inv.get('suspended_lines') or [],
            }
        )
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_admin_proveedor_inventory_put')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/admin/proveedor-sales-stats', methods=['GET'])
@admin_or_soporte_licencias_required
def api_admin_proveedor_sales_stats_get():
    """Ventas por servicio de cada usuario proveedor (contadores en user_prices)."""
    from app.store.proveedor_daily_summaries import PROVEEDOR_METRICS_COHERENCE_NOTE

    try:
        providers = _admin_proveedor_sales_stats_payload()
        ok = jsonify(
            {
                'success': True,
                'providers': providers,
                'stats_rev': _proveedor_sales_stats_revision_fingerprint(providers),
                'counter_coherence_note': PROVEEDOR_METRICS_COHERENCE_NOTE,
            }
        )
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        current_app.logger.exception('api_admin_proveedor_sales_stats_get')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/admin/proveedor-sales-stats/reset', methods=['POST'])
@admin_or_soporte_licencias_required
def api_admin_proveedor_sales_stats_reset():
    """Pone a cero el contador de ventas de un servicio para un proveedor."""
    try:
        data = request.get_json(silent=True) or {}
        user_id = data.get('user_id')
        license_id = data.get('license_id')
        try:
            uid = int(user_id)
            lid = int(license_id)
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Parámetros inválidos.'}), 400
        if uid <= 0 or lid <= 0:
            return jsonify({'success': False, 'error': 'Parámetros inválidos.'}), 400
        user_row = User.query.get(uid)
        if not user_row or user_row.parent_id:
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        ok_save, err_msg = _proveedor_reset_sales_count_on_user(user_row, lid)
        if not ok_save:
            return jsonify({'success': False, 'error': err_msg or 'No se pudo resetear.'}), 400
        db.session.commit()
        services = _proveedor_sales_stats_services_for_user(user_row)
        ok = jsonify(
            {
                'success': True,
                'user_id': uid,
                'license_id': lid,
                'services': services,
            }
        )
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_admin_proveedor_sales_stats_reset')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/admin/proveedor-sales-stats/rev', methods=['GET'])
@admin_or_soporte_licencias_required
def api_admin_proveedor_sales_stats_rev():
    """Hash ligero de contadores proveedor (fallback sin SSE)."""
    try:
        db.session.expire_all()
        stats_rev = _proveedor_sales_stats_revision_fingerprint()
        ok = jsonify({'success': True, 'stats_rev': stats_rev})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        current_app.logger.exception('api_admin_proveedor_sales_stats_rev')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/admin/proveedor-sales-stats/stream')
@admin_or_soporte_licencias_required
def api_admin_proveedor_sales_stats_stream():
    """SSE: avisa cuando cambian ventas por servicio de proveedores."""
    try:

        @stream_with_context
        def generate():
            last_rev = None
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            for _ in range(20):
                try:
                    db.session.expire_all()
                    stats_rev = _proveedor_sales_stats_revision_fingerprint()
                    if stats_rev != last_rev:
                        last_rev = stats_rev
                        payload = json.dumps(
                            {
                                'type': 'proveedor_stats_rev',
                                'success': True,
                                'stats_rev': stats_rev,
                            }
                        )
                        yield f"data: {payload}\n\n"
                    else:
                        yield ": heartbeat\n\n"
                except Exception as e:
                    current_app.logger.error(f'Error en stream proveedor ventas: {e}')
                    yield f"data: {json.dumps({'type': 'error', 'success': False, 'error': str(e)})}\n\n"
                time.sleep(2.0)

        return Response(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        )
    except Exception as e:
        current_app.logger.exception('api_admin_proveedor_sales_stats_stream')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/user/my-license-portal-rev', methods=['GET'])
@csrf_exempt_route
def api_user_my_license_portal_rev():
    """Hash ligero del portal para sondeo sin reconstruir cuentas ni blocs día 1–31."""
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

        portal_rev = _portal_accounts_revision_fingerprint(user_obj)
        ok = jsonify({'success': True, 'portal_rev': portal_rev})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        current_app.logger.exception('api_user_my_license_portal_rev')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/user/my-license-portal-stream')
@csrf_exempt_route
def api_user_my_license_portal_stream():
    """SSE: avisa cuando cambia portal_rev (misma auth que my-license-portal-rev)."""
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

        portal_user_id = int(user_obj.id)

        @stream_with_context
        def generate():
            last_rev = None
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            for _ in range(12):
                try:
                    db.session.expire_all()
                    u = User.query.get(portal_user_id)
                    if not u:
                        yield f"data: {json.dumps({'type': 'error', 'success': False, 'error': 'Usuario no encontrado'})}\n\n"
                        break
                    _ensure_license_day_notepads_column()
                    _ensure_license_portal_day_row_notes_column()
                    _ensure_license_account_client_notes_column()
                    _ensure_license_warranty_days_column()
                    _ensure_license_expired_notes_and_month_columns()
                    _ensure_license_changes_notes_column()
                    portal_rev = _portal_accounts_revision_fingerprint(u)
                    if portal_rev != last_rev:
                        last_rev = portal_rev
                        payload = json.dumps(
                            {
                                'type': 'portal_rev',
                                'success': True,
                                'portal_rev': portal_rev,
                            }
                        )
                        yield f"data: {payload}\n\n"
                    else:
                        yield ": heartbeat\n\n"
                except Exception as e:
                    current_app.logger.error(f'Error en stream portal licencias: {e}')
                    yield f"data: {json.dumps({'type': 'error', 'success': False, 'error': str(e)})}\n\n"
                time.sleep(2.5)

        return Response(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        )
    except Exception as e:
        current_app.logger.exception('api_user_my_license_portal_stream')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/user/license-account/<int:account_id>/client-notes', methods=['PUT'])
def api_user_license_account_client_notes(account_id):
    """Persistir notas privadas del cliente solo para esa cuenta."""
    try:
        from app.store.models import LicenseAccount

        if not session.get('logged_in'):
            return _reject_user_licencias_api('Debes iniciar sesión.', 401)
        user_obj = User.query.get(session.get('user_id'))
        if not user_obj:
            return _reject_user_licencias_api('Usuario no encontrado.', 403)
        if _user_store_view_only(user_obj):
            return _json_licencias_view_only_forbidden()
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
        if _user_store_view_only(user_obj):
            return _json_licencias_view_only_forbidden()
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

        if 'new_password' in data:
            from app.store.user_license_line_parse import (
                cred_plain_has_password_part,
                dual_to_storage_line,
                rebuild_cred_with_new_password,
                rebuild_day_notepad_lines_with_physical_index,
            )

            new_password = str(data.get('new_password') or '').strip()
            if not new_password:
                return jsonify({'success': False, 'error': 'Indica la nueva contraseña.'}), 400

            lic_prod = getattr(license_row, 'product', None)
            is_netflix = _product_name_is_netflix(lic_prod.name if lic_prod else '')
            cred_old = str(dual_base.get('cred') or '').strip()
            if not cred_old:
                return jsonify({'success': False, 'error': 'La fila no tiene credencial.'}), 400
            if not cred_plain_has_password_part(cred_old, is_netflix):
                return jsonify(
                    {
                        'success': False,
                        'error': 'Esta fila solo tiene correo en el bloc; no se puede cambiar la contraseña aquí.',
                    }
                ), 400

            new_cred = rebuild_cred_with_new_password(cred_old, is_netflix, new_password)
            if not new_cred:
                return jsonify(
                    {
                        'success': False,
                        'error': 'No se pudo construir la credencial con la nueva contraseña.',
                    }
                ), 400

            dual_updated = dict(dual_base)
            dual_updated['cred'] = new_cred
            new_line = dual_to_storage_line(dual_updated)
            new_day_text = rebuild_day_notepad_lines_with_physical_index(raw_lines, phys_idx, new_line)

            if str(new_day_text).strip():
                day_map[dk] = new_day_text
            else:
                day_map.pop(dk, None)

            license_row.day_notepads_json = _json.dumps(day_map, ensure_ascii=False)

            if account is not None:
                account.password = new_password[:200]

            sync_allowed_emails_for_license(license_row)

            db.session.commit()
            return jsonify({'success': True, 'new_cred': new_cred})

        m2m = bool(getattr(license_row, 'month_to_month', False))
        revert_buena = bool(data.get('revert_buena_revisada'))
        preserve_buena = bool(data.get('preserve_buena_revisada'))
        if not m2m and 'status_good' in data and not revert_buena and not preserve_buena:
            data = dict(data)
            data.pop('status_good', None)

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

        sync_allowed_emails_for_license(license_row)

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


def _parse_licenses_include_accounts_mode(raw):
    v = (raw or 'all').strip().lower()
    if v in ('all', 'none', 'selected'):
        return v
    return 'all'


def _parse_license_ids_csv(raw):
    if raw is None or not str(raw).strip():
        return []
    out = []
    seen = set()
    for part in str(raw).split(','):
        part = part.strip()
        if not part:
            continue
        try:
            n = int(part)
        except (TypeError, ValueError):
            continue
        if n <= 0 or n in seen:
            continue
        seen.add(n)
        out.append(n)
    return out


def _license_account_counts_map(license_ids):
    """Conteos por licencia sin cargar filas completas de cuentas."""
    from app.store.models import LicenseAccount
    from sqlalchemy import func

    if not license_ids:
        return {}
    ids = [int(x) for x in license_ids]
    rows = (
        db.session.query(
            LicenseAccount.license_id,
            LicenseAccount.status,
            func.count(LicenseAccount.id),
        )
        .filter(LicenseAccount.license_id.in_(ids))
        .group_by(LicenseAccount.license_id, LicenseAccount.status)
        .all()
    )
    out = {}
    for lid, status, cnt in rows:
        lid = int(lid)
        st = (status or '').strip() or 'unknown'
        bucket = out.setdefault(lid, {'total': 0, 'by_status': {}})
        bucket['total'] += int(cnt)
        bucket['by_status'][st] = int(cnt)
    for lid in ids:
        out.setdefault(lid, {'total': 0, 'by_status': {}})
    return out


def _license_day_notepads_dict(license_row):
    import json as _json

    raw = getattr(license_row, 'day_notepads_json', None)
    if not raw or not str(raw).strip():
        return {}
    try:
        day_map = _json.loads(raw)
        return day_map if isinstance(day_map, dict) else {}
    except Exception:
        return {}


def _serialize_license_account_admin(account, assigned_username_map):
    uid = account.assigned_to_user_id
    return {
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
        'days_until_expiry': account.days_until_expiry,
    }


@store_bp.route('/api/licenses')
@admin_or_soporte_licencias_required
def api_get_licenses():
    """Obtener licencias admin.

    Query:
      include_accounts=all|none|selected  (default all, retrocompatible)
      license_ids=1,2,3  — con selected, cuentas completas solo de esos IDs
    """
    try:
        from app.store.models import License, LicenseAccount, Product

        include_accounts = _parse_licenses_include_accounts_mode(
            request.args.get('include_accounts')
        )
        selected_license_ids = (
            set(_parse_license_ids_csv(request.args.get('license_ids')))
            if include_accounts == 'selected'
            else set()
        )

        db.session.expire_all()

        _ensure_license_day_notepads_column()
        _ensure_license_portal_day_row_notes_column()
        _ensure_license_account_client_notes_column()
        _ensure_license_account_renewal_reserve_columns()
        _ensure_license_warranty_days_column()
        _ensure_license_expired_notes_and_month_columns()
        _ensure_license_changes_notes_column()

        from app.store.customer_account_renewals import (
            customer_renewal_notes_for_api,
            reconcile_orphan_pending_customer_renewal_notes,
        )

        license_query_opts = [joinedload(License.product)]
        if include_accounts == 'all':
            license_query_opts.append(selectinload(License.accounts))
        licenses = License.query.options(*license_query_opts).all()

        # Autocura: texto en license_notes pero 0 cuentas available suele venir de drift o guardados
        # que no alcanzaron a sincronizar; al abrir Admin se alinea igual que PUT license_notes.
        heal_commit = False
        try:
            if reconcile_orphan_pending_customer_renewal_notes():
                heal_commit = True
        except Exception as renew_heal_ex:
            current_app.logger.warning(
                'reconcile orphan customer renewal notes: %s', renew_heal_ex
            )
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
            licenses = License.query.options(*license_query_opts).all()
            try:
                from app.store.product_reservations import process_pending_reservations_for_product

                seen_pids = set()
                for lic_row in licenses:
                    pid = int(lic_row.product_id)
                    if pid in seen_pids:
                        continue
                    seen_pids.add(pid)
                    process_pending_reservations_for_product(pid)
            except Exception as res_heal_ex:
                current_app.logger.warning('reservas tras heal inventario: %s', res_heal_ex)

        license_ids = [int(lic.id) for lic in licenses]
        account_counts_map = (
            _license_account_counts_map(license_ids)
            if include_accounts != 'all'
            else {}
        )

        accounts_by_license = {}
        accounts_for_username_lookup = []
        if include_accounts == 'all':
            for lic_row in licenses:
                accs = list(lic_row.accounts or [])
                accounts_by_license[int(lic_row.id)] = accs
                accounts_for_username_lookup.extend(accs)
        elif include_accounts == 'selected' and selected_license_ids:
            valid_selected = [
                lid for lid in selected_license_ids if lid in license_ids
            ]
            if valid_selected:
                acc_rows = LicenseAccount.query.filter(
                    LicenseAccount.license_id.in_(valid_selected)
                ).all()
                for acc in acc_rows:
                    accounts_by_license.setdefault(int(acc.license_id), []).append(acc)
                accounts_for_username_lookup = acc_rows

        assigned_username_map = _assigned_usernames_map_for_accounts(
            accounts_for_username_lookup
        )

        licenses_data = []
        for license in licenses:
            day_map = _license_day_notepads_dict(license)
            license_notes_val = license.license_notes or ''
            suspended_notes_val = getattr(license, 'suspended_notes', None) or ''
            expired_notes_val = getattr(license, 'expired_notes', None) or ''
            changes_notes_val = getattr(license, 'changes_notes', None) or ''
            customer_renewal_notes_val = customer_renewal_notes_for_api(license)
            personal_notes_val = license.personal_notes or ''
            m2m = bool(getattr(license, 'month_to_month', False))
            license_data = {
                'id': license.id,
                'product_id': license.product_id,
                'product_name': license.product.name if license.product else 'Producto eliminado',
                'position': license.position,
                'warranty_days': _license_warranty_days_public(license),
                'license_term_days': _license_term_days_public(license),
                'billing_period_label': _license_billing_period_label(license),
                'term_ui_label': _license_term_ui_label(license),
                'enabled': license.enabled,
                'created_at': _store_dt_iso_utc_z(license.created_at),
                'personal_notes': personal_notes_val,
                'license_notes': license_notes_val,
                'suspended_notes': suspended_notes_val,
                'expired_notes': expired_notes_val,
                'changes_notes': changes_notes_val,
                'customer_renewal_notes': customer_renewal_notes_val,
                'month_to_month': m2m,
                'allow_reservation': bool(getattr(license, 'allow_reservation', False)),
                'allow_next_day_reservation': bool(getattr(license, 'allow_next_day_reservation', False)),
                'renew_customer_account': bool(getattr(license, 'renew_customer_account', False)),
                'day_notepads': day_map,
                'accounts': [],
            }

            if include_accounts == 'all':
                acc_list = accounts_by_license.get(int(license.id), [])
            elif include_accounts == 'selected' and int(license.id) in selected_license_ids:
                acc_list = accounts_by_license.get(int(license.id), [])
            else:
                acc_list = []

            license_data['accounts'] = [
                _serialize_license_account_admin(account, assigned_username_map)
                for account in acc_list
            ]
            if include_accounts != 'all':
                license_data['account_counts'] = account_counts_map.get(
                    int(license.id),
                    {'total': 0, 'by_status': {}},
                )

            licenses_data.append(license_data)

        if include_accounts == 'all':
            total_accounts = sum(len(ld.get('accounts') or []) for ld in licenses_data)
        else:
            total_accounts = sum(
                int((account_counts_map.get(int(ld['id'])) or {}).get('total') or 0)
                for ld in licenses_data
            )
        ok = jsonify({
            'success': True,
            'licenses': licenses_data,
            'licenses_rev': _admin_licenses_revision_fingerprint(archived_only=False),
            'stats': {
                'total_licenses': len(licenses_data),
                'total_accounts': total_accounts,
            },
            'include_accounts': include_accounts,
            'license_ids': sorted(selected_license_ids) if include_accounts == 'selected' else None,
        })
        _attach_private_no_cache_headers(ok)
        return ok

    except Exception as e:
        current_app.logger.exception('api_get_licenses')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/admin/licenses/rev', methods=['GET'])
@admin_or_soporte_licencias_required
def api_admin_licenses_rev():
    """Hash ligero del panel admin licencias (sondeo fallback)."""
    try:
        archived_only = (request.args.get('archived') or '').strip().lower() in ('1', 'true', 'yes')
        db.session.expire_all()
        licenses_rev = _admin_licenses_revision_fingerprint(archived_only=archived_only)
        ok = jsonify({'success': True, 'licenses_rev': licenses_rev})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        current_app.logger.exception('api_admin_licenses_rev')
        err = jsonify({'success': False, 'error': str(e)})
        _attach_private_no_cache_headers(err)
        return err, 500


@store_bp.route('/api/admin/licenses/stream')
@admin_or_soporte_licencias_required
def api_admin_licenses_stream():
    """SSE: avisa cuando cambia el estado admin de licencias."""
    try:
        archived_only = (request.args.get('archived') or '').strip().lower() in ('1', 'true', 'yes')

        @stream_with_context
        def generate():
            last_rev = None
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    db.session.expire_all()
                    licenses_rev = _admin_licenses_revision_fingerprint(archived_only=archived_only)
                    if licenses_rev != last_rev:
                        last_rev = licenses_rev
                        payload = json.dumps(
                            {
                                'type': 'licenses_rev',
                                'success': True,
                                'licenses_rev': licenses_rev,
                            }
                        )
                        yield f"data: {payload}\n\n"
                    else:
                        yield ": heartbeat\n\n"
                except GeneratorExit:
                    break
                except Exception as e:
                    current_app.logger.error(f'Error en stream admin licencias: {e}')
                    yield f"data: {json.dumps({'type': 'error', 'success': False, 'error': str(e)})}\n\n"
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
    except Exception as e:
        current_app.logger.exception('api_admin_licenses_stream')
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


_LICENSE_CRED_FIRST_EMAIL_RE = None  # legacy name; usar normalize_allowed_email


def _iter_license_client_email_pairs(text_blocks):
    """
    Yield (username_lower, email_lower) desde líneas admin
    credencial \\x1f cliente \\x1f … (o legado //). Omite anonimo / sin correo.
    Usa la misma normalización que el alta manual / API (AllowedEmail).
    """
    from app.utils.allowed_email import normalize_allowed_email

    seen = set()
    for block in text_blocks:
        if not block or not str(block).strip():
            continue
        for line in str(block).replace('\r\n', '\n').split('\n'):
            cred, client_part, _status = _split_line_cred_notes_user_admin(line)
            ul = (client_part or '').strip()
            if not ul or ul.lower() == 'anonimo':
                continue
            email = normalize_allowed_email(cred or '')
            if not email:
                continue
            key = (ul.lower(), email)
            if key in seen:
                continue
            seen.add(key)
            yield key[0], key[1]


def _license_day_notepad_texts(license_row):
    """Solo textos de Día 1–31 (consulta IMAP permitida)."""
    out = []
    raw = getattr(license_row, 'day_notepads_json', None)
    if not raw or not str(raw).strip():
        return out
    try:
        dm = json.loads(raw) if not isinstance(raw, dict) else raw
    except Exception:
        return out
    if not isinstance(dm, dict):
        return out
    for day in range(1, 32):
        v = dm.get(str(day), dm.get(day))
        if v and str(v).strip():
            out.append(str(v))
    return out


def _license_universe_notepad_texts(license_row):
    """
    Todos los blocs de la licencia donde puede aparecer un correo ligado a cliente.
    Sirve para saber qué AllowedEmail vienen del panel Licencias (y poder podarlos
    si ya no están en un Día 1–31).
    """
    texts = list(_license_day_notepad_texts(license_row))
    for attr in (
        'license_notes',
        'suspended_notes',
        'expired_notes',
        'changes_notes',
        'customer_renewal_notes',
    ):
        v = getattr(license_row, attr, None)
        if v and str(v).strip():
            texts.append(str(v))
    return texts


def _remove_allowed_email_from_principal_and_subusers(principal, email_lower):
    """Quita el correo del usuario principal y de todos sus sub-usuarios."""
    email_lower = (email_lower or '').strip().lower()
    if not principal or not email_lower:
        return 0
    n = AllowedEmail.query.filter_by(user_id=principal.id, email=email_lower).delete(
        synchronize_session=False
    )
    sub_ids = [sub.id for sub in getattr(principal, 'subusers', []) or []]
    if sub_ids:
        n += AllowedEmail.query.filter(
            AllowedEmail.user_id.in_(sub_ids),
            AllowedEmail.email == email_lower,
        ).delete(synchronize_session=False)
    return n


def _reconcile_allowed_emails_for_usernames(usernames):
    """
    Reconcilia AllowedEmail para usuarios principales (username en usernames):
    - Añade correos que estén en algún Día 1–31 ligados a ese username.
    - Quita correos que aparezcan en el panel Licencias (días u otros blocs) pero
      ya NO estén en ningún Día 1–31 (p. ej. pasaron a Cambios / Caídas / Vencidas).
    - No toca correos solo manuales (nunca vistos en ningún bloc de licencias).
    """
    from collections import defaultdict
    from sqlalchemy import func

    from app.store.models import License

    names = {
        str(u).strip().lower()
        for u in (usernames or [])
        if u and str(u).strip() and str(u).strip().lower() != 'anonimo'
    }
    if not names:
        return {'added': 0, 'removed': 0}

    day_by_user = defaultdict(set)
    universe_by_user = defaultdict(set)

    q = License.query
    for lic in q.all():
        for uname, email in _iter_license_client_email_pairs(_license_day_notepad_texts(lic)):
            if uname in names:
                day_by_user[uname].add(email)
        for uname, email in _iter_license_client_email_pairs(_license_universe_notepad_texts(lic)):
            if uname in names:
                universe_by_user[uname].add(email)

    added = 0
    removed = 0
    for uname in names:
        principal = User.query.filter(
            User.parent_id.is_(None),
            func.lower(User.username) == uname,
        ).first()
        if not principal:
            continue
        desired = day_by_user.get(uname, set())
        universe = universe_by_user.get(uname, set())
        actual = {
            str(ae.email or '').strip().lower()
            for ae in AllowedEmail.query.filter_by(user_id=principal.id).all()
            if ae.email
        }
        for email in desired - actual:
            db.session.add(AllowedEmail(user_id=principal.id, email=email))
            added += 1
        for email in (actual & universe) - desired:
            removed += _remove_allowed_email_from_principal_and_subusers(principal, email)
    return {'added': added, 'removed': removed}


def _usernames_from_license_texts(license_row):
    names = set()
    for uname, _email in _iter_license_client_email_pairs(_license_universe_notepad_texts(license_row)):
        names.add(uname)
    return names


def _sync_allowed_emails_from_license_admin_texts(text_blocks):
    """
    Compatibilidad: interpreta text_blocks como días activos y reconcilia
    los usernames encontrados (añade días / poda si ya no están en días).
    Preferir sync_allowed_emails_for_license(license_row).
    """
    names = {uname for uname, _e in _iter_license_client_email_pairs(text_blocks)}
    if not names:
        return 0
    stats = _reconcile_allowed_emails_for_usernames(names)
    return int(stats.get('added') or 0)


def sync_allowed_emails_for_license(license_row):
    """
    Tras guardar una licencia: solo correos en Día 1–31 ligados al username
    quedan consultables; si pasaron a Cambios/Caídas/Vencidas se quitan
    (también de sub-usuarios). Los correos manuales del admin no se tocan.
    """
    if not license_row:
        return {'added': 0, 'removed': 0}
    names = _usernames_from_license_texts(license_row)
    # También usernames solo en días (por si universe vacío tras borrar laterales)
    for uname, _e in _iter_license_client_email_pairs(_license_day_notepad_texts(license_row)):
        names.add(uname)
    return _reconcile_allowed_emails_for_usernames(names)


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
    expires_at = now + _license_account_term_timedelta(license_row)

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
        existing_lines = [
            str(ln).strip()
            for ln in str(cur_s).replace('\r\n', '\n').split('\n')
            if str(ln).strip()
        ]
        if add in existing_lines:
            return
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


def _extract_line_from_license_day_notepad(license_row, day_int, fp_triple, is_netflix):
    """Quita y devuelve la primera línea del bloc Día N que coincide con la cuenta."""
    import json as _json

    if not fp_triple or fp_triple == ('', '', ''):
        return None
    if license_row is None:
        return None
    try:
        day_i = int(day_int)
    except (TypeError, ValueError):
        return None
    if day_i < 1 or day_i > 31:
        return None

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

    dk = str(day_i)
    cur = dm.get(dk)
    cur_s = str(cur).strip() if cur is not None else ''
    if not cur_s:
        return None

    lid = getattr(license_row, 'id', None)
    if lid is None:
        return None

    lines = [ln for ln in str(cur_s).replace('\r\n', '\n').split('\n') if str(ln).strip()]
    if not lines:
        return None

    removed_line = None
    new_lines = []
    for ln in lines:
        if removed_line is None:
            tup = _inventory_tuple_from_license_notes_line(ln, lid, is_netflix)
            if tup:
                tnorm = _normalize_inventory_fingerprint(tup[0], tup[1], tup[2])
                if tnorm == fp_norm:
                    removed_line = ln
                    continue
        new_lines.append(ln)

    if removed_line is None:
        return None

    if new_lines:
        dm[dk] = '\n'.join(new_lines).strip()
    else:
        dm.pop(dk, None)
    license_row.day_notepads_json = _json.dumps(dm, ensure_ascii=False) if dm else None
    return removed_line


def _account_expiry_utc_naive(account, license_row):
    """expires_at efectivo (naive UTC) a partir de cuenta o assigned_at + plazo."""
    from app.store.models import _license_account_expiry_as_utc_aware

    term = _license_account_term_timedelta(license_row)
    if getattr(account, 'expires_at', None):
        exp = _license_account_expiry_as_utc_aware(account.expires_at)
        return exp.astimezone(timezone.utc).replace(tzinfo=None)
    if getattr(account, 'assigned_at', None):
        at = account.assigned_at
        if at.tzinfo is not None:
            at = at.astimezone(timezone.utc).replace(tzinfo=None)
        return at + term
    return datetime.utcnow() + term


def _adjust_license_account_expiry(
    account,
    license_row,
    *,
    days_remaining=None,
    days_delta=None,
):
    """
    Ajusta vencimiento de una cuenta vendida.
    Presets mensuales (30, 60, 90…): recalcula assigned_at → puede cambiar el día del mes.
    Plazo personalizado: solo mueve expires_at; el día de compra no cambia.
    """
    from app.store.license_term_utils import license_term_days_public, license_term_preset_key

    term_days = license_term_days_public(license_row)
    is_preset = license_term_preset_key(term_days) != 'personalizado'

    if days_remaining is None and days_delta is None:
        raise ValueError('Indica days_remaining o days_delta')

    old_day = None
    if getattr(account, 'assigned_at', None):
        try:
            old_day = int(utc_to_colombia(account.assigned_at).day)
        except Exception:
            old_day = None

    cur_exp = _account_expiry_utc_naive(account, license_row)
    now_u = datetime.now(timezone.utc).replace(tzinfo=None)

    if days_remaining is not None:
        try:
            rem = int(days_remaining)
        except (TypeError, ValueError):
            raise ValueError('days_remaining inválido')
        if rem < 0 or rem > 3650:
            raise ValueError('days_remaining debe estar entre 0 y 3650')
        new_exp = now_u + timedelta(days=rem)
    else:
        try:
            delta = int(days_delta)
        except (TypeError, ValueError):
            raise ValueError('days_delta inválido')
        if abs(delta) > 3650:
            raise ValueError('days_delta fuera de rango')
        new_exp = cur_exp + timedelta(days=delta)
        if new_exp < now_u:
            new_exp = now_u

    account.expires_at = new_exp
    new_day = old_day
    moved_day = False

    if is_preset:
        new_assigned = new_exp - timedelta(days=term_days)
        account.assigned_at = new_assigned
        try:
            new_day = int(utc_to_colombia(new_assigned).day)
        except Exception:
            new_day = old_day
        if old_day and new_day and old_day != new_day:
            moved_day = True
            product = getattr(license_row, 'product', None)
            if product is None and getattr(license_row, 'product_id', None):
                from app.store.models import Product as _Product

                product = _Product.query.get(license_row.product_id)
            is_nf = _product_name_is_netflix(getattr(product, 'name', None) if product else None)
            fp = (
                (account.email or '').strip().lower(),
                (account.password or '').strip(),
                (account.account_identifier or '').strip(),
            )
            line = _extract_line_from_license_day_notepad(
                license_row, old_day, fp, is_nf
            )
            if line:
                _append_line_to_license_day_notepad(license_row, new_day, line)

    delta_days = max(0, int((new_exp - now_u).total_seconds() // 86400))
    return {
        'days_until_expiry': delta_days,
        'calendar_day_before': old_day,
        'calendar_day_after': new_day,
        'moved_day': moved_day,
        'is_preset_term': is_preset,
        'expires_at': _store_dt_iso_utc_z(new_exp),
        'assigned_at': _store_dt_iso_utc_z(getattr(account, 'assigned_at', None)),
    }


@store_bp.route('/api/accounts/<int:account_id>/adjust-expiry', methods=['PUT'])
@admin_or_soporte_licencias_required
def api_adjust_license_account_expiry(account_id):
    """Admin: sumar/restar días al vencimiento; presets mensuales mueven el día del calendario."""
    try:
        from app.store.models import License, LicenseAccount

        account = LicenseAccount.query.get(account_id)
        if not account:
            return jsonify({'success': False, 'error': 'Cuenta no encontrada'}), 404

        status = str(getattr(account, 'status', '') or '').lower()
        if status not in ('sold', 'assigned'):
            return jsonify(
                {'success': False, 'error': 'Solo cuentas vendidas o asignadas.'}
            ), 400

        license_row = License.query.get(account.license_id)
        if not license_row:
            return jsonify({'success': False, 'error': 'Licencia no encontrada'}), 404

        data = request.get_json() or {}
        days_remaining = data.get('days_remaining')
        days_delta = data.get('days_delta')
        if days_remaining is None and days_delta is None:
            return jsonify(
                {'success': False, 'error': 'Indica days_remaining o days_delta'}
            ), 400
        if days_remaining is not None and days_delta is not None:
            return jsonify(
                {'success': False, 'error': 'Usa solo days_remaining o days_delta'}
            ), 400

        result = _adjust_license_account_expiry(
            account,
            license_row,
            days_remaining=days_remaining,
            days_delta=days_delta,
        )
        db.session.commit()
        return jsonify({'success': True, **result})
    except ValueError as ve:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(ve)}), 400
    except Exception as exc:
        db.session.rollback()
        current_app.logger.exception('api_adjust_license_account_expiry: %s', exc)
        return jsonify({'success': False, 'error': str(exc)}), 500


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
            from app.store.purchase_history_stats import _currency_from_user_row

            _proveedor_record_license_sale(
                license_id,
                qty,
                buyer_user_id=int(billing_target.id),
                product_name=(product.name or 'Producto'),
                line_amount=delta,
                is_renewal=False,
                currency=_currency_from_user_row(billing_target),
                sold_at=datetime.utcnow(),
                source='admin_bulk_delivery',
            )
        except Exception as prov_sales_exc:
            current_app.logger.warning(
                'proveedor sales tras bulk delivery license_id=%s: %s',
                license_id,
                prov_sales_exc,
            )
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
        from app.store.models import License, LicenseAccount

        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        rows = User.query.filter(User.parent_id.is_(None)).order_by(User.username.asc()).all()

        # Cuentas vendidas/asignadas agrupadas por cliente principal (sub-usuarios → padre)
        # para repartir la deuda por cuenta (pagos de la más vieja a la más nueva).
        accs_all = (
            LicenseAccount.query.options(
                joinedload(LicenseAccount.license).joinedload(License.product)
            )
            .filter(LicenseAccount.assigned_to_user_id.isnot(None))
            .filter(
                or_(
                    sa_func.lower(sa_func.coalesce(LicenseAccount.status, '')).in_(('assigned', 'sold')),
                    LicenseAccount.status.is_(None),
                )
            )
            .order_by(LicenseAccount.id.asc())
            .all()
        )
        uid_set = {int(a.assigned_to_user_id) for a in accs_all}
        users_by_id = (
            {int(u2.id): u2 for u2 in User.query.filter(User.id.in_(uid_set)).all()}
            if uid_set
            else {}
        )
        accs_by_principal = {}
        for a in accs_all:
            owner = users_by_id.get(int(a.assigned_to_user_id))
            if not owner:
                continue
            pid = int(owner.parent_id) if owner.parent_id else int(owner.id)
            accs_by_principal.setdefault(pid, []).append(a)

        clients = []
        account_dues = {}
        for u in rows:
            if not _is_principal_store_license_saldo_client(u, admin_username):
                continue
            tipo_precio = None
            if u.user_prices and isinstance(u.user_prices, dict):
                tp_raw = u.user_prices.get('tipo_precio')
                if tp_raw in ('USD', 'COP'):
                    tipo_precio = tp_raw.lower()
            dues_u = _license_account_debt_allocation(
                u, _dedupe_drift_license_accounts(accs_by_principal.get(int(u.id)) or [])
            )
            for acc_id, due in dues_u.items():
                account_dues[str(acc_id)] = due
            clients.append({
                'id': u.id,
                'username': u.username,
                'saldo_usd': float(getattr(u, 'saldo_usd', 0) or 0),
                'saldo_cop': float(getattr(u, 'saldo_cop', 0) or 0),
                'tipo_precio': tipo_precio,
                # Deuda efectiva (misma que ve el cliente en su portal): prepago en negativo
                # (compras de tienda) o, si no, la cuenta licencias manual (users.saldo).
                'license_saldo': _license_portal_effective_saldo(u),
            })
        return jsonify({'success': True, 'clients': clients, 'account_dues': account_dues})
    except Exception as e:
        current_app.logger.exception('api_admin_store_clients_license_saldo')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/admin/users/<int:user_id>/store-prepaid-saldo', methods=['GET'])
@admin_required
def api_admin_user_store_prepaid_saldo(user_id):
    """Saldo prepago tienda (USD/COP) de un usuario — para actualizaciones SSE puntuales."""
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
    tipo_precio = None
    if user.user_prices and isinstance(user.user_prices, dict):
        tp_raw = user.user_prices.get('tipo_precio')
        if tp_raw in ('USD', 'COP'):
            tipo_precio = tp_raw.lower()
    return jsonify({
        'success': True,
        'user_id': int(user.id),
        'username': user.username,
        'saldo_usd': float(getattr(user, 'saldo_usd', 0) or 0),
        'saldo_cop': float(getattr(user, 'saldo_cop', 0) or 0),
        'tipo_precio': tipo_precio,
    })


@store_bp.route('/api/admin/users/<int:user_id>/license-account-saldo-adjust', methods=['POST'])
@admin_or_soporte_licencias_required
def api_admin_user_license_account_saldo_adjust(user_id):
    """Sumar o restar cantidad del ``saldo`` de cuenta licencias del cliente (principal).

    Sin tope de límite de deuda: ajuste manual del admin.
    Si ``delta`` es negativo (abono), las cuentas se cuadran FIFO (antigua → nueva)
    y las que quedan Pagada se registran en el historial del cliente.
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
        debt_apply = None
        if delta < 0:
            from app.store.license_debt_credit import reduce_license_account_saldo_with_fifo_log

            debt_apply = reduce_license_account_saldo_with_fifo_log(
                target, -delta, source='admin'
            )
        else:
            target.saldo = prev + delta
        db.session.commit()
        try:
            new_saldo = float(getattr(target, 'saldo', 0) or 0)
        except (TypeError, ValueError):
            new_saldo = 0.0
        try:
            from app.store.balance_recharge_events import notify_balance_recharge_updated

            notify_balance_recharge_updated(int(target.id), reason='admin_license_saldo_adjust')
        except Exception:
            pass
        payload = {
            'success': True,
            'previous_saldo': prev,
            'new_saldo': new_saldo,
            'delta': delta,
        }
        if debt_apply:
            payload['debt_apply'] = debt_apply
        return jsonify(payload)
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('api_admin_user_license_account_saldo_adjust')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/licenses/<int:license_id>/customer-renewal/buyer-label', methods=['POST'])
@admin_or_soporte_licencias_required
def api_customer_account_renewal_buyer_label(license_id):
    """Devuelve el username del comprador para pasar una fila al bloc día."""
    from app.store.customer_account_renewals import customer_renewal_client_username_for_admin

    data = request.get_json(silent=True) or {}
    credential = (
        data.get('credential')
        or data.get('customer_email')
        or data.get('customer_credential')
        or ''
    )
    client_username = data.get('client_username') or data.get('username') or ''
    username = customer_renewal_client_username_for_admin(
        license_id,
        credential,
        client_username,
    )
    return jsonify({'success': True, 'client_username': username or ''})


@store_bp.route('/api/licenses/<int:license_id>/customer-renewal/complete', methods=['POST'])
@admin_or_soporte_licencias_required
def api_complete_customer_account_renewal(license_id):
    """Admin pasó una fila de «Cuentas para renovar» al día: marcar pedido y avisar al cliente."""
    from app.store.customer_account_renewals import complete_customer_account_renewal_from_admin

    data = request.get_json(silent=True) or {}
    credential = (
        data.get('credential')
        or data.get('customer_email')
        or data.get('customer_credential')
        or ''
    )
    client_username = data.get('client_username') or data.get('username') or ''
    day = data.get('day')
    ok, result = complete_customer_account_renewal_from_admin(
        license_id,
        credential,
        client_username,
        day=day,
    )
    if not ok:
        return jsonify({'success': False, 'error': result}), 400
    if isinstance(result, dict):
        return jsonify({'success': True, **result})
    return jsonify({'success': True})


@store_bp.route('/api/admin/licenses/<int:license_id>/customer-renewal/reject', methods=['POST'])
@admin_or_soporte_licencias_required
def api_reject_customer_account_renewal(license_id):
    """Admin rechaza una fila de «Cuentas para renovar» y avisa al cliente con el motivo."""
    from app.store.customer_account_renewals import reject_customer_account_renewal_from_admin

    data = request.get_json(silent=True) or {}
    credential = (
        data.get('credential')
        or data.get('customer_email')
        or data.get('customer_credential')
        or ''
    )
    client_username = data.get('client_username') or data.get('username') or ''
    reason = data.get('reason') or data.get('note') or data.get('message') or ''
    ok, result = reject_customer_account_renewal_from_admin(
        license_id,
        credential,
        client_username,
        reason,
    )
    if not ok:
        return jsonify({'success': False, 'error': result}), 400
    if isinstance(result, dict):
        return jsonify({'success': True, **result})
    return jsonify({'success': True})


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
            allowed_keys = {
                'changes_notes',
                'month_to_month',
                'allow_reservation',
                'renew_customer_account',
                'license_notes',
                'customer_renewal_notes',
            }
            data = {k: v for k, v in data.items() if k in allowed_keys}
        if 'personal_notes' in data:
            license_obj.personal_notes = (
                data['personal_notes'] if data['personal_notes'] is not None else ''
            )
        if 'license_notes' in data:
            incoming = data['license_notes'] if data['license_notes'] is not None else ''
            current = (license_obj.license_notes or '')
            force_empty = bool(data.get('license_notes_force_empty'))
            if not str(incoming).strip() and str(current).strip() and not force_empty:
                pass
            else:
                license_obj.license_notes = incoming
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
        if 'allow_reservation' in data:
            v = data['allow_reservation']
            license_obj.allow_reservation = bool(v) if v is not None else False
        if 'allow_next_day_reservation' in data:
            from app.store.product_reservations import ensure_product_reservation_schema

            ensure_product_reservation_schema()
            v = data['allow_next_day_reservation']
            license_obj.allow_next_day_reservation = bool(v) if v is not None else False
        if 'renew_customer_account' in data:
            v = data['renew_customer_account']
            license_obj.renew_customer_account = bool(v) if v is not None else False
        if 'changes_notes' in data:
            license_obj.changes_notes = (
                data['changes_notes'] if data['changes_notes'] is not None else ''
            )
        if 'customer_renewal_notes' in data:
            license_obj.customer_renewal_notes = (
                data['customer_renewal_notes']
                if data['customer_renewal_notes'] is not None
                else ''
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
            or 'customer_renewal_notes' in data
            or ('day_notepads' in data and isinstance(data.get('day_notepads'), dict))
        ):
            sync_allowed_emails_for_license(license_obj)

        inv_sync_result = None
        if 'license_notes' in data:
            inv_sync_result = _sync_inventory_accounts_from_license_notes(license_obj)

        product_id_for_res = int(license_obj.product_id)
        db.session.commit()
        if inv_sync_result and (
            inv_sync_result.get('created') or inv_sync_result.get('updated')
        ):
            try:
                from app.store.product_reservations import process_pending_reservations_for_product

                process_pending_reservations_for_product(product_id_for_res)
            except Exception as res_ex:
                current_app.logger.warning('process_pending_reservations_for_product: %s', res_ex)
        body = {
            'success': True,
            'licenses_rev': _admin_licenses_revision_fingerprint(archived_only=False),
        }
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
        _ensure_license_expired_notes_and_month_columns()
        from sqlalchemy import text

        dialect = getattr(db.engine.dialect, 'name', '') or ''
        if dialect == 'postgresql':
            count_sql = text(
                'SELECT COUNT(*) FROM store_licenses WHERE enabled IS NOT TRUE'
            )
        else:
            count_sql = text(
                'SELECT COUNT(*) FROM store_licenses WHERE enabled = 0 OR enabled IS NULL'
            )
        count = int(db.session.execute(count_sql).scalar() or 0)
        ok = jsonify({'success': True, 'count': count})
        _attach_private_no_cache_headers(ok)
        return ok
    except Exception as e:
        current_app.logger.exception('api_archived_licenses_count: %s', e)
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

        from app.store.customer_account_renewals import customer_renewal_notes_for_api

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
                'license_term_days': _license_term_days_public(license),
                'billing_period_label': _license_billing_period_label(license),
                'term_ui_label': _license_term_ui_label(license),
                'enabled': license.enabled,
                'created_at': _store_dt_iso_utc_z(license.created_at),
                'updated_at': _store_dt_iso_utc_z(license.updated_at),
                'personal_notes': license.personal_notes or '',
                'license_notes': license.license_notes or '',
                'suspended_notes': getattr(license, 'suspended_notes', None) or '',
                'expired_notes': getattr(license, 'expired_notes', None) or '',
                'changes_notes': getattr(license, 'changes_notes', None) or '',
                'customer_renewal_notes': customer_renewal_notes_for_api(license),
                'month_to_month': bool(getattr(license, 'month_to_month', False)),
                'allow_reservation': bool(getattr(license, 'allow_reservation', False)),
                'allow_next_day_reservation': bool(getattr(license, 'allow_next_day_reservation', False)),
                'renew_customer_account': bool(getattr(license, 'renew_customer_account', False)),
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


@store_bp.route('/api/licenses/<int:license_id>/term', methods=['PUT'])
@admin_required
def api_update_license_term(license_id):
    """Actualizar duración del periodo de licencia (días): «mes», presets o personalizado."""
    from app.store.license_term_utils import (
        license_billing_period_label,
        license_term_ui_label,
        normalize_license_term_days,
    )
    from app.store.models import License

    try:
        _ensure_license_term_days_column()
        data = request.get_json(silent=True) or {}
        raw = data.get('term_days')
        if raw is None:
            return jsonify({'success': False, 'error': 'term_days requerido'}), 400
        try:
            td = normalize_license_term_days(raw)
        except ValueError as ve:
            return jsonify({'success': False, 'error': str(ve)}), 400
        lic = License.query.get_or_404(license_id)
        lic.license_term_days = td
        db.session.commit()
        return jsonify({
            'success': True,
            'license_term_days': td,
            'billing_period_label': license_billing_period_label(td),
            'term_ui_label': license_term_ui_label(td),
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/licenses/term-presets', methods=['GET'])
@admin_required
def api_license_term_presets():
    """Opciones predefinidas para el selector «mes» en Gestionar productos."""
    from app.store.license_term_utils import license_term_preset_options

    return jsonify({'success': True, 'presets': license_term_preset_options()})


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

    Si hay menos disponibles que la reserva gar., no se bloquea toda la venta: se venden las que
    hay (no se puede mantener el colchón completo con tan poco stock).

    Las líneas del bloc ``license_notes`` no sustituyen filas en ``store_license_accounts``:
    hasta que existan cuentas ``available``, el público muestra 0 vendible (evita 409 tras «4 existencias»).
    """
    from app.store.models import LicenseAccount

    _renewal_release_stale_reservations()
    avail_rows = LicenseAccount.query.filter_by(
        license_id=license_row.id, status='available'
    ).all()
    avail = sum(1 for a in avail_rows if _renewal_account_unreserved_for_public_sale(a))
    if avail <= 0:
        return 0
    reserve = _license_warranty_days_public(license_row)
    if reserve <= 0:
        return avail
    if avail <= reserve:
        return avail
    return avail - reserve


def _compute_public_sellable_stock_for_product(product):
    """
    Existencias en tienda y tope de venta por producto: suma, por cada licencia activa, las
    unidades vendibles reales ``max(0, available - gar.)``. Debe igualar lo que puede asignar ``procesar_pago``.
    """
    _ensure_license_expired_notes_and_month_columns()
    from app.store.models import License

    lic_rows = License.query.filter_by(product_id=product.id, enabled=True).all()
    if not lic_rows:
        return 0
    total = 0
    for lic in lic_rows:
        total += _sellable_license_accounts_public(lic)
    return total


def _public_stock_snapshot():
    """Mapa product_id -> existencias vendibles (tienda pública)."""
    products = public_store_products_query().all()
    stock_data = {}
    for product in products:
        stock_data[int(product.id)] = int(_compute_public_sellable_stock_for_product(product))
    return stock_data


def _public_stock_revision_hash(stock_data):
    import hashlib

    if not stock_data:
        return hashlib.sha256(b'empty').hexdigest()[:24]
    parts = [f'{pid}:{stock_data[pid]}' for pid in sorted(stock_data.keys())]
    return hashlib.sha256('|'.join(parts).encode('utf-8')).hexdigest()[:24]


def _product_month_to_month_map(products):
    """
    Mapa product_id -> True si alguna licencia activa tiene month_to_month
    (checkbox «Mes a mes» en Gestionar productos / lógica de Renovar día).
    """
    from app.store.models import License

    if not products:
        return {}
    ids = [p.id for p in products if getattr(p, 'id', None) is not None]
    if not ids:
        return {}
    flags = {pid: False for pid in ids}
    rows = (
        License.query
        .filter(License.product_id.in_(ids), License.enabled.is_(True))
        .all()
    )
    for lic in rows:
        if bool(getattr(lic, 'month_to_month', False)):
            flags[lic.product_id] = True
    return flags


def _product_allow_reservation_map(products):
    from app.store.product_reservations import _product_allow_reservation_map as _map

    return _map(products)


def _product_renew_customer_account_map(products):
    _ensure_license_expired_notes_and_month_columns()
    from app.store.customer_account_renewals import _product_renew_customer_account_map as _map

    return _map(products)


def _product_billing_period_map(products):
    """Mapa product_id -> etiqueta periodo («mensual», «2 meses», «60 días», …)."""
    from app.store.models import License

    if not products:
        return {}
    ids = [p.id for p in products if getattr(p, 'id', None) is not None]
    if not ids:
        return {}
    labels = {pid: 'mensual' for pid in ids}
    rows = (
        License.query
        .filter(License.product_id.in_(ids), License.enabled.is_(True))
        .order_by(License.position.asc(), License.id.asc())
        .all()
    )
    for lic in rows:
        labels[lic.product_id] = _license_billing_period_label(lic)
    return labels


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
        replacement.expires_at = old_ex or (datetime.utcnow() + _license_account_term_timedelta(license_obj))
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
    account.expires_at = assigned_stamp + _license_account_term_timedelta(license_row)
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


@store_bp.route('/api/products/stock/rev', methods=['GET'])
def api_get_products_stock_rev():
    """Hash ligero de existencias; el cliente pide /stock solo si cambió."""
    try:
        db.session.expire_all()
        stock_data = _public_stock_snapshot()
        stock_rev = _public_stock_revision_hash(stock_data)
        resp = jsonify({'success': True, 'stock_rev': stock_rev})
        resp.headers['Cache-Control'] = 'no-store'
        return resp
    except Exception as e:
        current_app.logger.error(f'Error al obtener revisión de stock: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/products/stock', methods=['GET'])
def api_get_all_products_stock():
    """Obtener el conteo de licencias disponibles para todos los productos"""
    try:
        db.session.expire_all()
        stock_data = _public_stock_snapshot()

        resp = jsonify({'success': True, 'stock': stock_data})
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    except Exception as e:
        current_app.logger.error(f'Error al obtener stock de productos: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/api/products/stock/stream')
def api_products_stock_stream():
    """
    SSE: existencias de tienda. Envía snapshot al conectar y luego solo si cambia stock_rev.
    Ciclo ~29 s; EventSource reconecta (evita timeouts en proxies/Gunicorn).
    """
    @stream_with_context
    def generate():
        last_rev = None
        yield f"data: {json.dumps({'type': 'connected'})}\n\n"
        # ~24 * 1.2s ≈ 29s por petición; EventSource vuelve a abrir la conexión.
        for _ in range(24):
            try:
                db.session.expire_all()
                stock_data = _public_stock_snapshot()
                stock_rev = _public_stock_revision_hash(stock_data)
                if stock_rev != last_rev:
                    last_rev = stock_rev
                    payload = json.dumps(
                        {
                            'type': 'stock',
                            'success': True,
                            'stock': stock_data,
                            'stock_rev': stock_rev,
                        }
                    )
                    yield f"data: {payload}\n\n"
                else:
                    yield ": heartbeat\n\n"
            except Exception as e:
                current_app.logger.error(f'Error en stream de stock: {e}')
                yield f"data: {json.dumps({'type': 'error', 'success': False, 'error': str(e)})}\n\n"
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
        expires_at = datetime.utcnow() + _license_account_term_timedelta(license)
        
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

@store_bp.route('/api/licenses/missing-products', methods=['GET'])
@admin_required
def api_licenses_missing_products():
    """Productos habilitados que aún no tienen fila en License."""
    try:
        from app.store.models import License, Product

        products = Product.query.filter_by(enabled=True).order_by(Product.name).all()
        missing = []
        for product in products:
            if not License.query.filter_by(product_id=product.id).first():
                missing.append({
                    'id': product.id,
                    'name': product.name,
                })

        return jsonify({
            'success': True,
            'products': missing,
            'count': len(missing),
        })

    except Exception as e:
        current_app.logger.exception('api_licenses_missing_products')
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
