"""API Partner propia de la tienda (mismo estilo que la API de Multiplataforma).

Montada en /api/partner/v1. Autenticación JWT firmada (itsdangerous) con las
credenciales de usuario de la tienda. Seguridad: interruptor global, lista
blanca de IPs (exactas o CIDR) y límites de uso por usuario.

La documentación (/api/partner/v1/docs/) se genera EN VIVO desde la base de
datos: productos con stock, botones de Códigos (solo nombres), límites y
estado. Cualquier cambio en botones o productos se refleja solo, sin editar
nada a mano.

Envelope de respuestas (igual que Multiplataforma):
  éxito → {"data": ...}
  error → {"error": {"code": "...", "message": "..."}}
"""

from __future__ import annotations

import threading
import time
from collections import deque
from datetime import datetime
from functools import wraps

from flask import Blueprint, current_app, jsonify, render_template, request, session
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash

from app.extensions import db
from app.models.user import User
from app.store.models import StoreSetting

partner_api_bp = Blueprint('partner_api_bp', __name__)

# ---------------------------------------------------------------------------
# Configuración y límites (documentados en /docs/)
# ---------------------------------------------------------------------------

PARTNER_SETTING_KEY = 'partner_api_settings'

ACCESS_TOKEN_MAX_AGE = 30 * 60          # 30 minutos
REFRESH_TOKEN_MAX_AGE = 7 * 24 * 3600   # 7 días

LIMIT_PURCHASES_PER_MIN = 30   # cuentas compradas por minuto (igual que MP)
LIMIT_CART_LINES = 20          # líneas por pedido (igual que MP)
LIMIT_CODES_PER_MIN = 60       # consultas de códigos por minuto
LIMIT_GENERAL_PER_MIN = 120    # peticiones generales por minuto
LIMIT_AUTH_PER_MIN = 10        # intentos de login por IP y minuto

_SALT_ACCESS = 'partner-api-access'
_SALT_REFRESH = 'partner-api-refresh'


def _csrf_exempt(func):
    """API externa con Bearer: sin CSRF de sesión."""
    func._csrf_exempt = True
    return func


# ---------------------------------------------------------------------------
# Ajustes (interruptor + lista blanca de IPs) en StoreSetting
# ---------------------------------------------------------------------------

def get_partner_settings():
    import json

    row = StoreSetting.query.filter_by(key=PARTNER_SETTING_KEY).first()
    data = {}
    if row and row.value:
        try:
            data = json.loads(row.value)
        except (ValueError, TypeError):
            data = {}
    enabled = bool(data.get('enabled', True))
    wl = data.get('ip_whitelist') or []
    if not isinstance(wl, list):
        wl = []
    wl = [str(x).strip() for x in wl if str(x).strip()]
    return {'enabled': enabled, 'ip_whitelist': wl}


def save_partner_settings(enabled, ip_whitelist):
    import json

    payload = json.dumps(
        {'enabled': bool(enabled), 'ip_whitelist': list(ip_whitelist)},
        ensure_ascii=False,
    )
    row = StoreSetting.query.filter_by(key=PARTNER_SETTING_KEY).first()
    if row is None:
        row = StoreSetting(key=PARTNER_SETTING_KEY, value=payload)
        db.session.add(row)
    else:
        row.value = payload
    db.session.commit()


def _normalize_ip_entry(raw):
    """IP exacta o rango CIDR válido; None si no es válido."""
    import ipaddress

    s = str(raw or '').strip()
    if not s:
        return None
    try:
        if '/' in s:
            return str(ipaddress.ip_network(s, strict=False))
        return str(ipaddress.ip_address(s))
    except ValueError:
        return None


def _ip_allowed(client_ip, whitelist):
    import ipaddress

    if not whitelist:
        return True
    try:
        ip = ipaddress.ip_address(str(client_ip).strip())
    except ValueError:
        return False
    for entry in whitelist:
        try:
            if '/' in entry:
                if ip in ipaddress.ip_network(entry, strict=False):
                    return True
            elif ip == ipaddress.ip_address(entry):
                return True
        except ValueError:
            continue
    return False


def _client_ip():
    from app.api import get_client_ip

    return get_client_ip()


# ---------------------------------------------------------------------------
# Envelope y errores
# ---------------------------------------------------------------------------

def _ok(data, status=200):
    return jsonify({'data': data}), status


def _err(code, message, status, extra=None):
    body = {'error': {'code': code, 'message': message}}
    if extra:
        body['error'].update(extra)
    return jsonify(body), status


# ---------------------------------------------------------------------------
# Límites de uso (memoria del proceso)
# ---------------------------------------------------------------------------

_rl_lock = threading.Lock()
_rl_buckets = {}


def _rate_limit(bucket, limit, weight=1, window=60):
    """True si la petición cabe en la ventana; False si excede el límite."""
    now = time.time()
    with _rl_lock:
        dq = _rl_buckets.setdefault(bucket, deque())
        while dq and dq[0][0] <= now - window:
            dq.popleft()
        used = sum(w for _, w in dq)
        if used + weight > limit:
            return False
        dq.append((now, weight))
    return True


# ---------------------------------------------------------------------------
# Tokens (itsdangerous, firmados con SECRET_KEY)
# ---------------------------------------------------------------------------

def _serializer(salt):
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt=salt)


def _pw_fingerprint(user):
    import hashlib

    return hashlib.sha256((user.password or '').encode('utf-8')).hexdigest()[:16]


def _issue_tokens(user):
    payload = {'uid': int(user.id), 'pw': _pw_fingerprint(user)}
    return (
        _serializer(_SALT_ACCESS).dumps(payload),
        _serializer(_SALT_REFRESH).dumps(payload),
    )


def _user_from_token(token, salt, max_age):
    """(user, None) o (None, 'token_expired'|'token_invalid')."""
    try:
        payload = _serializer(salt).loads(token, max_age=max_age)
    except SignatureExpired:
        return None, 'token_expired'
    except BadSignature:
        return None, 'token_invalid'
    try:
        uid = int(payload.get('uid') or 0)
    except (TypeError, ValueError):
        uid = 0
    user = User.query.get(uid) if uid else None
    if not user or not user.enabled:
        return None, 'token_invalid'
    if _pw_fingerprint(user) != payload.get('pw'):
        # Cambió la contraseña: los tokens anteriores dejan de valer.
        return None, 'token_invalid'
    return user, None


# ---------------------------------------------------------------------------
# Guardia común (interruptor + IP + Bearer + límites)
# ---------------------------------------------------------------------------

def _gate_error():
    """Interruptor global + lista blanca de IPs. None si todo bien."""
    settings = get_partner_settings()
    if not settings['enabled']:
        return _err('api_disabled', 'La API está desactivada por el administrador.', 503)
    if not _ip_allowed(_client_ip(), settings['ip_whitelist']):
        return _err('ip_not_allowed', 'Esta IP no está autorizada para usar la API.', 403)
    return None


def partner_auth_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        gate = _gate_error()
        if gate is not None:
            return gate
        auth = request.headers.get('Authorization') or ''
        token = auth[7:].strip() if auth.lower().startswith('bearer ') else ''
        if not token:
            return _err('auth_required', 'Falta el token Bearer (Authorization).', 401)
        user, terr = _user_from_token(token, _SALT_ACCESS, ACCESS_TOKEN_MAX_AGE)
        if terr:
            msg = (
                'El token de acceso expiró; usa /auth/token/refresh/.'
                if terr == 'token_expired'
                else 'Token inválido.'
            )
            return _err(terr, msg, 401)
        if not getattr(user, 'can_access_store', False):
            return _err('forbidden', 'Tu usuario no tiene acceso a la tienda.', 403)
        if not _rate_limit(f'gen:{user.id}', LIMIT_GENERAL_PER_MIN):
            return _err('rate_limited', 'Demasiadas peticiones; espera un momento.', 429)
        request.partner_user = user
        return f(user, *args, **kwargs)

    return wrapper


def _is_admin_session():
    if not session.get('logged_in') or session.get('is_user'):
        return False
    admin_name = (current_app.config.get('ADMIN_USER') or 'admin').strip()
    return (session.get('username') or '').strip() == admin_name


# ---------------------------------------------------------------------------
# Sombras de sesión: reutilizar el checkout interno tal cual
# ---------------------------------------------------------------------------

class _session_as_user:
    """Presta la sesión al usuario del token y la restaura al salir."""

    def __init__(self, user):
        self.user = user
        self.snapshot = None

    def __enter__(self):
        self.snapshot = dict(session)
        session['username'] = self.user.username
        session['user_id'] = self.user.id
        session['logged_in'] = True

    def __exit__(self, exc_type, exc, tb):
        session.clear()
        session.update(self.snapshot or {})
        if not self.snapshot:
            session.modified = False
        return False


def _flask_response_payload(resp):
    """(json, status) de una respuesta Flask o tupla (resp, status)."""
    status = 200
    body = resp
    if isinstance(resp, tuple):
        body = resp[0]
        if len(resp) > 1:
            try:
                status = int(resp[1])
            except (TypeError, ValueError):
                status = 200
    else:
        status = getattr(resp, 'status_code', 200)
    data = body.get_json(silent=True) if hasattr(body, 'get_json') else None
    return (data or {}), status


# ---------------------------------------------------------------------------
# Autenticación
# ---------------------------------------------------------------------------

@partner_api_bp.route('/auth/token/', methods=['POST'])
@_csrf_exempt
def partner_auth_token():
    gate = _gate_error()
    if gate is not None:
        return gate
    if not _rate_limit(f'auth:{_client_ip()}', LIMIT_AUTH_PER_MIN):
        return _err('rate_limited', 'Demasiados intentos de login; espera un minuto.', 429)
    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip()
    password = str(data.get('password') or '')
    if not username or not password:
        return _err('bad_request', 'Envía username y password.', 400)
    user = User.query.filter_by(username=username).first()
    if not user or not user.enabled or not check_password_hash(user.password, password):
        return _err('invalid_credentials', 'Usuario o contraseña incorrectos.', 401)
    if not getattr(user, 'can_access_store', False):
        return _err('forbidden', 'Tu usuario no tiene acceso a la tienda.', 403)
    access, refresh = _issue_tokens(user)
    return _ok(
        {
            'tokens': {'access': access, 'refresh': refresh},
            'expires_in': ACCESS_TOKEN_MAX_AGE,
            'refresh_expires_in': REFRESH_TOKEN_MAX_AGE,
            'user': {'id': user.id, 'username': user.username},
        }
    )


@partner_api_bp.route('/auth/token/refresh/', methods=['POST'])
@_csrf_exempt
def partner_auth_token_refresh():
    gate = _gate_error()
    if gate is not None:
        return gate
    data = request.get_json(silent=True) or {}
    refresh = str(data.get('refresh') or '').strip()
    if not refresh:
        return _err('bad_request', 'Envía el token refresh.', 400)
    user, terr = _user_from_token(refresh, _SALT_REFRESH, REFRESH_TOKEN_MAX_AGE)
    if terr:
        msg = (
            'El refresh expiró; vuelve a iniciar sesión en /auth/token/.'
            if terr == 'token_expired'
            else 'Refresh inválido.'
        )
        return _err(terr, msg, 401)
    access, new_refresh = _issue_tokens(user)
    return _ok({'access': access, 'refresh': new_refresh, 'expires_in': ACCESS_TOKEN_MAX_AGE})


@partner_api_bp.route('/me/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_me(user):
    from app.store.routes import catalog_products_for_store_user

    _, tipo = catalog_products_for_store_user(user)
    return _ok(
        {
            'user': {
                'id': user.id,
                'username': user.username,
                'currency': tipo or 'COP',
                'saldo_cop': float(user.saldo_cop or 0),
                'saldo_usd': float(user.saldo_usd or 0),
            }
        }
    )


# ---------------------------------------------------------------------------
# Tienda: productos con stock (en vivo)
# ---------------------------------------------------------------------------

def _license_row_for_product(product_id):
    from app.store.models import License

    return License.query.filter_by(product_id=int(product_id), enabled=True).first()


def _product_payload(product, tipo, with_stock=True):
    from app.store.routes_licencias import _compute_public_sellable_stock_for_product

    lic = _license_row_for_product(product.id)
    price_cop = max(
        0.0,
        float(product.price_cop or 0) - float(getattr(product, 'discount_cop_extra', 0) or 0),
    )
    price_usd = max(
        0.0,
        float(product.price_usd or 0) - float(getattr(product, 'discount_usd_extra', 0) or 0),
    )
    item = {
        'id': product.id,
        'name': product.name,
        'description': (product.description or '')[:500],
        'price_cop': round(price_cop, 2),
        'price_usd': round(price_usd, 2),
        'currency': tipo or None,
        'term_days': getattr(lic, 'license_term_days', None) if lic else None,
        'month_to_month': bool(getattr(lic, 'month_to_month', False)) if lic else False,
        'renewal': {
            'customer_account': bool(getattr(lic, 'renew_customer_account', False)) if lic else False,
            'inventory_search': True,
        },
    }
    if with_stock:
        try:
            item['stock'] = int(_compute_public_sellable_stock_for_product(product) or 0)
        except Exception:
            item['stock'] = 0
    return item


@partner_api_bp.route('/store/products/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_store_products(user):
    from app.store.routes import catalog_products_for_store_user

    products, tipo = catalog_products_for_store_user(user)
    q = (request.args.get('q') or '').strip().lower()
    out = []
    for p in products:
        if q and q not in (p.name or '').lower():
            continue
        out.append(_product_payload(p, tipo))
    return _ok({'currency': tipo or None, 'products': out})


# ---------------------------------------------------------------------------
# Tienda: compras (reutiliza el checkout interno completo)
# ---------------------------------------------------------------------------

def _normalize_purchase_items(raw_items):
    """Convierte items del partner al formato interno del checkout."""
    items = []
    total_accounts = 0
    for it in raw_items:
        if not isinstance(it, dict):
            return None, 0, 'Cada ítem debe ser un objeto JSON.'
        pid = it.get('product_id', it.get('id'))
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            return None, 0, 'Ítem sin product_id válido.'
        row = {'id': pid}
        if it.get('es_renovar_cuenta_cliente') or it.get('renew_customer_account'):
            row['es_renovar_cuenta_cliente'] = True
            row['cantidad'] = 1
            for src, dst in (
                ('customer_email', 'customer_email'),
                ('customer_password', 'customer_password'),
                ('customer_credential', 'customer_credential'),
            ):
                if it.get(src) is not None:
                    row[dst] = it.get(src)
            total_accounts += 1
        else:
            ren_ids = it.get('renovacion_account_ids') or it.get('renewal_account_ids') or []
            if isinstance(ren_ids, list) and ren_ids:
                clean = []
                for x in ren_ids:
                    try:
                        clean.append(int(x))
                    except (TypeError, ValueError):
                        continue
                if clean:
                    row['renovacion_account_ids'] = clean
                    row['cantidad'] = len(clean)
                    total_accounts += len(clean)
                    items.append(row)
                    continue
            try:
                qty = int(it.get('quantity', it.get('cantidad', 1)) or 1)
            except (TypeError, ValueError):
                qty = 1
            qty = max(1, qty)
            row['cantidad'] = qty
            total_accounts += qty
        items.append(row)
    return items, total_accounts, None


@partner_api_bp.route('/store/purchases/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_store_purchases(user):
    from app.store.routes import _acquire_checkout_lock, _procesar_pago_core

    data = request.get_json(silent=True) or {}
    raw_items = data.get('items') or data.get('productos') or []
    if not isinstance(raw_items, list) or not raw_items:
        return _err('bad_request', 'Envía items: [{product_id, quantity, ...}].', 400)
    if len(raw_items) > LIMIT_CART_LINES:
        return _err(
            'cart_limit',
            f'Máximo {LIMIT_CART_LINES} líneas por pedido.',
            400,
        )
    items, total_accounts, verr = _normalize_purchase_items(raw_items)
    if verr:
        return _err('bad_request', verr, 400)
    if not _rate_limit(f'buy:{user.id}', LIMIT_PURCHASES_PER_MIN, weight=total_accounts):
        return _err(
            'rate_limited',
            f'Límite de {LIMIT_PURCHASES_PER_MIN} cuentas por minuto alcanzado; espera e inténtalo de nuevo.',
            429,
        )

    lock = _acquire_checkout_lock(user.id)
    if lock is None:
        return _err('checkout_busy', 'Ya hay un pago en proceso; espera a que termine.', 429)
    try:
        # El checkout interno lee request.get_json(): le presentamos el pedido
        # con la misma forma que usa la tienda web.
        request._cached_json = ({'productos': items}, {'productos': items})
        with _session_as_user(user):
            resp = _procesar_pago_core()
    finally:
        lock.release()

    payload, status = _flask_response_payload(resp)
    if payload.get('success'):
        return _ok(
            {
                'cuentas_asignadas': payload.get('cuentas_asignadas') or [],
                'saldo': {
                    'saldo_cop': payload.get('new_saldo_cop'),
                    'saldo_usd': payload.get('new_saldo_usd'),
                },
            }
        )
    extra = {}
    for k in ('renovacion_perdidas',):
        if payload.get(k):
            extra['detail'] = {k: payload.get(k)}
    return _err(
        'purchase_failed',
        payload.get('error') or 'No se pudo procesar la compra.',
        status if status >= 400 else 400,
        extra=extra or None,
    )


# ---------------------------------------------------------------------------
# Tienda: renovaciones
# ---------------------------------------------------------------------------

@partner_api_bp.route('/store/renewals/search/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_store_renewals_search(user):
    from app.store.routes import _lookup_store_renewal_accounts, _parse_renewal_email_tokens

    data = request.get_json(silent=True) or {}
    raw = str(data.get('q') or data.get('emails') or data.get('cuentas') or '').strip()
    if not raw:
        return _err('bad_request', 'Envía q con uno o más correos a renovar.', 400)
    emails = _parse_renewal_email_tokens(raw)
    if not emails:
        return _err('bad_request', 'No se encontraron correos en el texto.', 400)
    with _session_as_user(user):
        renewable, rejected = _lookup_store_renewal_accounts(emails)
    return _ok({'renewable': renewable, 'rejected': rejected})


# ---------------------------------------------------------------------------
# Tienda: reportes de cuentas (issues)
# ---------------------------------------------------------------------------

def _find_partner_account(user, account_id=None, email=None):
    from app.store.models import LicenseAccount

    qry = LicenseAccount.query.filter(
        LicenseAccount.assigned_to_user_id == int(user.id),
        LicenseAccount.status.in_(('assigned', 'sold')),
    )
    if account_id:
        try:
            qry = qry.filter(LicenseAccount.id == int(account_id))
        except (TypeError, ValueError):
            return None
    elif email:
        em = str(email).strip().lower()
        qry = qry.filter(db.func.lower(LicenseAccount.email) == em)
    else:
        return None
    return qry.order_by(LicenseAccount.assigned_at.desc().nullslast()).first()


@partner_api_bp.route('/store/issues/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_store_issues_list(user):
    from app.store.license_report_photos import (
        LicenseReportPhoto,
        ensure_report_photos_schema,
        photo_to_dict,
    )

    ensure_report_photos_schema()
    rows = (
        LicenseReportPhoto.query.filter_by(reporter_user_id=int(user.id))
        .order_by(LicenseReportPhoto.id.desc())
        .limit(100)
        .all()
    )
    return _ok({'issues': [photo_to_dict(p) for p in rows]})


@partner_api_bp.route('/store/issues/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_store_issues_create(user):
    """Reporta una cuenta comprada. multipart/form-data con imagen opcional."""
    from app.store.license_report_photos import create_report_photo
    from app.store.store_event_notify import notify_admins_app
    from app.utils.timezone import utc_to_colombia

    if request.content_type and 'multipart' in (request.content_type or ''):
        form = request.form
        image = request.files.get('image')
    else:
        form = request.get_json(silent=True) or {}
        image = None

    issue_text = str(form.get('issue') or form.get('detalle') or '').strip()
    account_id = form.get('account_id')
    email = form.get('email') or form.get('credential')
    status_label = str(form.get('status_label') or 'reportada').strip()[:120]
    if not issue_text:
        return _err('bad_request', 'Describe el problema en issue.', 400)
    if not account_id and not email:
        return _err('bad_request', 'Envía account_id (de la compra) o email de la cuenta.', 400)

    acc = _find_partner_account(user, account_id=account_id, email=email)
    if not acc:
        return _err('not_found', 'No se encontró esa cuenta entre tus compras.', 404)

    day = None
    if acc.assigned_at:
        try:
            day = int(utc_to_colombia(acc.assigned_at).day)
        except Exception:
            day = None
    if not day:
        day = int(utc_to_colombia(datetime.utcnow()).day)

    photo_info = None
    if image is not None and getattr(image, 'filename', ''):
        photo, perr = create_report_photo(
            license_id=acc.license_id,
            calendar_day=day,
            row_ordinal=None,
            account_id=acc.id,
            cred_hint=(acc.email or acc.account_identifier or '')[:300],
            status_label=status_label,
            uploader_user=user,
            reporter_user_id=user.id,
            file_storage=image,
        )
        if perr:
            return _err('bad_request', perr, 400)
        db.session.flush()
        photo_info = {'photo_id': photo.id, 'status': photo.status}

    cred_show = acc.email or acc.account_identifier or f'cuenta #{acc.id}'
    notify_admins_app(
        kind='store_report',
        title=f'Reporte por API: {cred_show}',
        body=f'{user.username}: {issue_text[:400]}',
        payload={
            'source': 'partner_api',
            'account_id': acc.id,
            'license_id': acc.license_id,
            'calendar_day': day,
            'status_label': status_label,
            'issue': issue_text[:1000],
        },
    )
    db.session.commit()

    return _ok(
        {
            'reported': True,
            'account_id': acc.id,
            'credential': cred_show,
            'status_label': status_label,
            'photo': photo_info,
            'note': 'El reporte quedó registrado y el administrador fue notificado.',
        },
        status=201,
    )


# ---------------------------------------------------------------------------
# Códigos: botones (solo nombres) + consulta que entrega lo extraído
# ---------------------------------------------------------------------------

def _partner_visible_services():
    from app.api import _codigos_service_visible
    from app.models.service import ServiceModel

    out = []
    for s in ServiceModel.query.all():
        try:
            if _codigos_service_visible(s, logged_in=True, is_admin=False):
                out.append(s)
        except Exception:
            continue
    out.sort(key=lambda s: (abs(s.position or 0) * 2 + (1 if (s.position or 0) > 0 else 0)))
    return out


@partner_api_bp.route('/codes/services/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_codes_services(user):
    """Solo id y nombre: los filtros y regex internos no se exponen."""
    services = [{'id': s.id, 'name': s.name} for s in _partner_visible_services()]
    return _ok({'services': services})


def _mail_delivery_payload(mail):
    if not mail:
        return None
    if mail.get('is_sms_result'):
        msgs = []
        for m in mail.get('sms_messages') or []:
            body = (m or {}).get('message_body')
            if body:
                msgs.append(str(body))
        return {
            'type': 'sms',
            'code': msgs[0] if msgs else None,
            'messages': msgs,
        }
    matches = []
    for arr in (mail.get('regex_matches') or {}).values():
        for v in arr or []:
            if v and v not in matches:
                matches.append(v)
    code = mail.get('filter_code') or (matches[0] if matches else None)
    return {
        'type': 'mail',
        'subject': mail.get('subject'),
        'from': mail.get('from'),
        'date': mail.get('formatted_date') or mail.get('date'),
        'code': code,
        'matches': matches,
        'text': mail.get('text'),
        'html': mail.get('html'),
    }


@partner_api_bp.route('/codes/search/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_codes_search(user):
    from app.api import EMAIL_REGEX, _email_reserved_for_other_user, _is_support_user, _user_has_allowed_email
    from app.services.search_service import search_and_apply_filters

    if not _rate_limit(f'codes:{user.id}', LIMIT_CODES_PER_MIN):
        return _err(
            'rate_limited',
            f'Límite de {LIMIT_CODES_PER_MIN} consultas por minuto alcanzado.',
            429,
        )

    data = request.get_json(silent=True) or {}
    email = str(data.get('email') or '').strip().lower()
    if not email or not EMAIL_REGEX.match(email):
        return _err('bad_request', 'Envía un email válido a consultar.', 400)

    services = _partner_visible_services()
    service = None
    sid = data.get('service_id')
    sname = str(data.get('service') or data.get('service_name') or '').strip().lower()
    if sid is not None:
        try:
            sid = int(sid)
        except (TypeError, ValueError):
            return _err('bad_request', 'service_id inválido.', 400)
        service = next((s for s in services if s.id == sid), None)
    elif sname:
        service = next((s for s in services if (s.name or '').strip().lower() == sname), None)
    else:
        return _err('bad_request', 'Envía service_id o service (nombre del botón).', 400)
    if service is None:
        return _err('not_found', 'Ese botón no existe o no está disponible.', 404)

    # Mismos permisos de correo que la página de Códigos.
    if not _is_support_user(user) and _email_reserved_for_other_user(user, email):
        return _err('forbidden', 'No tienes permiso para consultar este correo.', 403)
    if not getattr(user, 'can_search_any', False) and not _user_has_allowed_email(user, email):
        return _err('forbidden', 'No tienes permiso para consultar este correo.', 403)

    try:
        mail = search_and_apply_filters(email, service_id=service.id, user=user)
    except Exception:
        current_app.logger.exception('partner codes search %s/%s', service.id, email)
        return _err('search_failed', 'No se pudo completar la búsqueda; inténtalo de nuevo.', 502)

    return _ok(
        {
            'service': {'id': service.id, 'name': service.name},
            'email': email,
            'found': bool(mail),
            'result': _mail_delivery_payload(mail),
        }
    )


# ---------------------------------------------------------------------------
# Administración (sesión admin, con CSRF): interruptor + IPs
# ---------------------------------------------------------------------------

@partner_api_bp.route('/admin/settings/', methods=['GET'])
def partner_admin_settings_get():
    if not _is_admin_session():
        return _err('forbidden', 'Solo el administrador puede ver esta configuración.', 403)
    settings = get_partner_settings()
    settings['client_ip'] = _client_ip()
    return _ok(settings)


@partner_api_bp.route('/admin/settings/', methods=['POST'])
def partner_admin_settings_post():
    if not _is_admin_session():
        return _err('forbidden', 'Solo el administrador puede cambiar esta configuración.', 403)
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get('enabled', True))
    raw_list = data.get('ip_whitelist')
    if raw_list is None:
        raw_list = []
    if not isinstance(raw_list, list):
        return _err('bad_request', 'ip_whitelist debe ser una lista.', 400)
    cleaned = []
    invalid = []
    for entry in raw_list:
        norm = _normalize_ip_entry(entry)
        if norm is None:
            invalid.append(str(entry))
        elif norm not in cleaned:
            cleaned.append(norm)
    if invalid:
        return _err(
            'bad_request',
            'IPs no válidas: ' + ', '.join(invalid[:5]) + '. Usa IPs exactas o rangos CIDR.',
            400,
        )
    save_partner_settings(enabled, cleaned)
    settings = get_partner_settings()
    settings['client_ip'] = _client_ip()
    return _ok(settings)


# ---------------------------------------------------------------------------
# Documentación en vivo
# ---------------------------------------------------------------------------

@partner_api_bp.route('/docs/', methods=['GET'])
def partner_api_docs():
    """Documentación generada desde la BD: siempre al día sin editar nada."""
    from app.models.service import ServiceModel  # noqa: F401 (aseguramos import temprano)

    is_admin = _is_admin_session()

    products_docs = []
    try:
        from app.store.models import Product
        from app.store.routes import public_store_products_query

        try:
            products = public_store_products_query().all()
        except Exception:
            products = Product.query.filter_by(enabled=True).order_by(Product.name.asc()).all()
        for p in products:
            products_docs.append(_product_payload(p, None))
    except Exception:
        current_app.logger.exception('partner docs: productos')

    services_docs = []
    try:
        services_docs = [{'id': s.id, 'name': s.name} for s in _partner_visible_services()]
    except Exception:
        current_app.logger.exception('partner docs: servicios')

    settings = get_partner_settings()
    base_url = request.url_root.rstrip('/') + '/api/partner/v1'
    example_product = products_docs[0] if products_docs else {'id': 1, 'name': 'Producto ejemplo'}
    example_service = services_docs[0] if services_docs else {'id': 1, 'name': 'Boton ejemplo'}

    return render_template(
        'partner_api_docs.html',
        is_admin=is_admin,
        base_url=base_url,
        products=products_docs,
        services=services_docs,
        api_enabled=settings['enabled'],
        ip_whitelist=settings['ip_whitelist'],
        example_product=example_product,
        example_service=example_service,
        limits={
            'purchases_per_min': LIMIT_PURCHASES_PER_MIN,
            'cart_lines': LIMIT_CART_LINES,
            'codes_per_min': LIMIT_CODES_PER_MIN,
            'general_per_min': LIMIT_GENERAL_PER_MIN,
            'access_minutes': ACCESS_TOKEN_MAX_AGE // 60,
            'refresh_days': REFRESH_TOKEN_MAX_AGE // 86400,
        },
        generated_at=datetime.utcnow(),
    )
