"""API Partner propia de la tienda.

Montada en /api/partner/v1. Autenticación JWT firmada (itsdangerous) con las
credenciales de usuario de la tienda. Seguridad: interruptor global, lista
blanca de IPs (exactas o CIDR) y límites de uso por usuario.

La documentación (/api/partner/v1/docs/) se genera EN VIVO desde la base de
datos: productos con stock, botones de Códigos (solo nombres), límites y
estado. Cualquier cambio en botones o productos se refleja solo, sin editar
nada a mano.

Envelope de respuestas:
  éxito → {"data": ...}
  error → {"error": {"code": "...", "message": "..."}}
"""

from __future__ import annotations

import threading
import time
from collections import deque
from datetime import datetime
from functools import wraps

from flask import Blueprint, current_app, flash, jsonify, redirect, render_template, request, session, url_for
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

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
    raw_wl = data.get('ip_whitelist') or []
    if not isinstance(raw_wl, list):
        raw_wl = []
    return {'enabled': enabled, 'ip_whitelist': _coerce_ip_bindings(raw_wl)}


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


def upsert_partner_ip_for_user(user, ip_raw):
    """Añade o actualiza una IP vinculada a ese usuario en Documentación API."""
    if not user:
        return None, "Falta el usuario dueño."
    bound = _bind_ip_entry({
        'ip': ip_raw,
        'user_id': user.id,
        'username': user.username,
    })
    if not bound or not bound.get('user_id'):
        return None, "IP o rango CIDR no válido."
    settings = get_partner_settings()
    cleaned = []
    seen = set()
    for entry in settings.get('ip_whitelist') or []:
        existing = _bind_ip_entry(entry)
        if not existing or not existing.get('ip'):
            continue
        if existing['ip'] == bound['ip']:
            continue
        if existing['ip'] in seen:
            continue
        seen.add(existing['ip'])
        cleaned.append(existing)
    cleaned.append(bound)
    save_partner_settings(settings.get('enabled', True), cleaned)
    return bound, None


def partner_ips_for_user(user):
    """IPs de Documentación API vinculadas a este usuario (en orden de lista)."""
    if not user:
        return []
    try:
        uid = int(user.id)
    except (TypeError, ValueError):
        return []
    ips = []
    seen = set()
    for entry in get_partner_settings().get('ip_whitelist') or []:
        bound = _bind_ip_entry(entry)
        if not bound or bound.get('user_id') != uid:
            continue
        ip = bound.get('ip')
        if not ip or ip in seen:
            continue
        seen.add(ip)
        ips.append(ip)
    return ips


def _entry_ip(entry):
    if isinstance(entry, dict):
        return str(entry.get('ip') or '').strip()
    return str(entry or '').strip()


def _coerce_ip_bindings(raw_list):
    """Normaliza la lista guardada a [{ip, user_id, username}, ...]."""
    out = []
    seen = set()
    for raw in raw_list or []:
        if isinstance(raw, dict):
            ip = str(raw.get('ip') or '').strip()
            uid = raw.get('user_id')
            uname = str(raw.get('username') or '').strip()
            try:
                uid = int(uid) if uid not in (None, '', 0, '0') else None
            except (TypeError, ValueError):
                uid = None
        else:
            ip = str(raw or '').strip()
            uid, uname = None, ''
        if not ip or ip in seen:
            continue
        seen.add(ip)
        out.append({'ip': ip, 'user_id': uid, 'username': uname})
    return out


def _bind_ip_entry(raw):
    """Valida IP/CIDR y resuelve el usuario dueño. None si la IP no es válida."""
    if isinstance(raw, dict):
        ip = _normalize_ip_entry(raw.get('ip'))
        uid = raw.get('user_id')
        uname = str(raw.get('username') or '').strip()
    else:
        ip = _normalize_ip_entry(raw)
        uid, uname = None, ''
    if not ip:
        return None
    user = None
    if uid not in (None, '', 0, '0'):
        try:
            user = User.query.get(int(uid))
        except (TypeError, ValueError):
            user = None
    if user is None and uname:
        user = User.query.filter_by(username=uname).first()
    if user is not None and getattr(user, 'parent_id', None):
        parent = User.query.get(user.parent_id)
        if parent:
            user = parent
    if user:
        return {'ip': ip, 'user_id': int(user.id), 'username': user.username}
    return {'ip': ip, 'user_id': None, 'username': uname}


def _partner_ip_bind_users():
    """Usuarios principales habilitados (no sub-usuarios) para vincular una IP."""
    rows = (
        User.query.filter(User.parent_id.is_(None))
        .order_by(User.username.asc())
        .all()
    )
    out = []
    for u in rows:
        if getattr(u, 'enabled', True) is False:
            continue
        out.append({'id': int(u.id), 'username': u.username, 'full_name': getattr(u, 'full_name', None) or ''})
    return out


def _whitelist_owner_is_enabled(entry, enabled_cache=None):
    """False si no hay dueño o el usuario está apagado (Observador / admin)."""
    if not isinstance(entry, dict):
        return False
    uid = entry.get('user_id')
    if uid in (None, '', 0, '0'):
        return False
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        return False
    if enabled_cache is not None and uid in enabled_cache:
        return enabled_cache[uid]
    user = User.query.get(uid)
    ok = bool(user and getattr(user, 'enabled', True))
    if enabled_cache is not None:
        enabled_cache[uid] = ok
    return ok


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
        return False
    try:
        ip = ipaddress.ip_address(str(client_ip).strip())
    except ValueError:
        return False
    enabled_cache = {}
    for entry in whitelist:
        if isinstance(entry, dict) and not entry.get('user_id'):
            continue
        token = _entry_ip(entry)
        if not token:
            continue
        try:
            matched = False
            if '/' in token:
                if ip in ipaddress.ip_network(token, strict=False):
                    matched = True
            elif ip == ipaddress.ip_address(token):
                matched = True
            if matched and _whitelist_owner_is_enabled(entry, enabled_cache):
                return True
        except ValueError:
            continue
    return False


def _ip_allowed_for_user(client_ip, whitelist, user):
    """La IP debe estar en la lista, vinculada a ese usuario y el usuario encendido."""
    if not user:
        return False
    if getattr(user, 'enabled', True) is False:
        return False
    try:
        uid = int(user.id)
    except (TypeError, ValueError):
        return False
    scoped = []
    for entry in whitelist or []:
        if not isinstance(entry, dict):
            continue
        try:
            if int(entry.get('user_id') or 0) == uid:
                scoped.append(entry)
        except (TypeError, ValueError):
            continue
    return _ip_allowed(client_ip, scoped)


def _ip_bound_to_disabled_owner(client_ip, whitelist):
    """True si la IP coincide pero el dueño está apagado."""
    import ipaddress

    try:
        ip = ipaddress.ip_address(str(client_ip).strip())
    except ValueError:
        return False
    cache = {}
    for entry in whitelist or []:
        token = _entry_ip(entry)
        if not token:
            continue
        try:
            matched = False
            if '/' in token:
                matched = ip in ipaddress.ip_network(token, strict=False)
            else:
                matched = ip == ipaddress.ip_address(token)
        except ValueError:
            continue
        if matched and not _whitelist_owner_is_enabled(entry, cache):
            return True
    return False


def partner_external_ip_forbidden(user=None):
    """403 JSON para APIs de códigos/licencias si la IP no está en Documentación API."""
    settings = get_partner_settings()
    wl = settings.get('ip_whitelist') or []
    ip = _client_ip()
    if user is not None and getattr(user, 'enabled', True) is False:
        return (
            jsonify(
                {
                    'error': (
                        'El usuario dueño de esta IP está apagado. '
                        'La IP no funciona en la API hasta que un administrador lo encienda.'
                    ),
                    'code': 'owner_disabled',
                }
            ),
            403,
        )
    ok = _ip_allowed_for_user(ip, wl, user) if user is not None else _ip_allowed(ip, wl)
    if ok:
        return None
    if _ip_bound_to_disabled_owner(ip, wl):
        return (
            jsonify(
                {
                    'error': (
                        'El usuario dueño de esta IP está apagado. '
                        'La IP no funciona en la API hasta que un administrador lo encienda.'
                    ),
                    'code': 'owner_disabled',
                }
            ),
            403,
        )
    return (
        jsonify(
            {
                'error': (
                    'Esta IP no está autorizada para usar la API. '
                    'El administrador debe vincularla a un usuario en Documentación API.'
                ),
                'code': 'ip_not_allowed',
            }
        ),
        403,
    )


def _client_ip():
    from app.api import get_client_ip

    return get_client_ip()


# ---------------------------------------------------------------------------
# Envelope y errores
# ---------------------------------------------------------------------------

def _ok(data, status=200, message=None):
    body = {'success': True, 'data': data}
    if message:
        body['message'] = message
    return jsonify(body), status


def _err(code, message, status, extra=None):
    body = {'success': False, 'error': {'code': code, 'message': message}}
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
    client_ip = _client_ip()
    if _ip_allowed(client_ip, settings['ip_whitelist']):
        return None
    if _ip_bound_to_disabled_owner(client_ip, settings['ip_whitelist']):
        return _err(
            'owner_disabled',
            'El usuario dueño de esta IP está apagado. La IP no funciona en la API hasta que lo enciendan.',
            403,
        )
    return _err('ip_not_allowed', 'Esta IP no está autorizada para usar la API.', 403)


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
        if _is_store_subuser(user):
            return _subuser_api_forbidden()
        settings = get_partner_settings()
        if not _ip_allowed_for_user(_client_ip(), settings['ip_whitelist'], user):
            return _err(
                'ip_not_allowed',
                'Esta IP no está vinculada a tu usuario. El administrador debe añadirla en Documentación API.',
                403,
            )
        if not getattr(user, 'can_access_store', False):
            return _err('forbidden', 'Tu usuario no tiene acceso a la tienda.', 403)
        if not _partner_currency_or_none(user):
            return _partner_no_currency_error()
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


def _is_store_subuser(user):
    """Sub-usuario de tienda (tiene padre). No usa la API ni ve /docs/."""
    if not user:
        return False
    parent_id = getattr(user, 'parent_id', None)
    if parent_id is None:
        return False
    try:
        return int(parent_id) != int(user.id)
    except (TypeError, ValueError):
        return True


def _subuser_api_forbidden():
    return _err(
        'forbidden',
        'Los sub-usuarios no pueden usar la API Partner. Usa el usuario principal.',
        403,
    )


def _partner_currency_or_none(user):
    """COP/USD efectivo del usuario (o del padre). Sin ese cuadrado la API no aplica."""
    from app.store.routes import catalog_products_for_store_user

    _, tipo = catalog_products_for_store_user(user)
    if tipo in ('USD', 'COP'):
        return tipo
    return None


def _partner_no_currency_error():
    return _err(
        'forbidden',
        'Tu usuario no tiene tipo de precio COP o USD; la API Partner no está disponible.',
        403,
    )


def _partner_saldo_payload(user, tipo=None, saldo_cop=None, saldo_usd=None):
    """Saldo solo en la moneda del cuadrado (nunca las dos a la vez)."""
    tipo = tipo or _partner_currency_or_none(user)
    if tipo == 'USD':
        val = float(user.saldo_usd or 0) if saldo_usd is None else float(saldo_usd or 0)
    elif tipo == 'COP':
        val = float(user.saldo_cop or 0) if saldo_cop is None else float(saldo_cop or 0)
    else:
        return None
    return {'currency': tipo, 'saldo': val}


def _session_docs_user():
    uid = session.get('user_id')
    if uid:
        user = User.query.get(uid)
        if user:
            return user
    uname = (session.get('username') or '').strip()
    if uname:
        return User.query.filter_by(username=uname).first()
    return None


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
    if _is_store_subuser(user):
        return _subuser_api_forbidden()
    settings = get_partner_settings()
    if not _ip_allowed_for_user(_client_ip(), settings['ip_whitelist'], user):
        return _err(
            'ip_not_allowed',
            'Esta IP no está vinculada a tu usuario. El administrador debe añadirla en Documentación API.',
            403,
        )
    if not getattr(user, 'can_access_store', False):
        return _err('forbidden', 'Tu usuario no tiene acceso a la tienda.', 403)
    tipo = _partner_currency_or_none(user)
    if not tipo:
        return _partner_no_currency_error()
    access, refresh = _issue_tokens(user)
    return _ok(
        {
            'tokens': {'access': access, 'refresh': refresh},
            'expires_in': ACCESS_TOKEN_MAX_AGE,
            'refresh_expires_in': REFRESH_TOKEN_MAX_AGE,
            'user': {'id': user.id, 'username': user.username, 'currency': tipo},
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
    if _is_store_subuser(user):
        return _subuser_api_forbidden()
    settings = get_partner_settings()
    if not _ip_allowed_for_user(_client_ip(), settings['ip_whitelist'], user):
        return _err(
            'ip_not_allowed',
            'Esta IP no está vinculada a tu usuario. El administrador debe añadirla en Documentación API.',
            403,
        )
    access, new_refresh = _issue_tokens(user)
    return _ok({'access': access, 'refresh': new_refresh, 'expires_in': ACCESS_TOKEN_MAX_AGE})


@partner_api_bp.route('/auth/token/verify/', methods=['POST'])
@_csrf_exempt
def partner_auth_token_verify():
    """Comprueba si un access o refresh sigue válido."""
    gate = _gate_error()
    if gate is not None:
        return gate
    data = request.get_json(silent=True) or {}
    token = str(data.get('token') or data.get('access') or '').strip()
    if not token:
        return _err('bad_request', 'Envía token.', 400)
    user, terr = _user_from_token(token, _SALT_ACCESS, ACCESS_TOKEN_MAX_AGE)
    if user and not terr:
        return _ok({'valid': True, 'kind': 'access', 'user': {'id': user.id, 'username': user.username}})
    user, terr = _user_from_token(token, _SALT_REFRESH, REFRESH_TOKEN_MAX_AGE)
    if user and not terr:
        return _ok({'valid': True, 'kind': 'refresh', 'user': {'id': user.id, 'username': user.username}})
    return _err(terr or 'token_invalid', 'Token inválido o expirado.', 401)


@partner_api_bp.route('/me/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_me(user):
    tipo = _partner_currency_or_none(user)
    saldo = _partner_saldo_payload(user, tipo=tipo)
    balance = saldo['saldo'] if saldo else 0.0
    return _ok(
        {
            'user': {
                'id': user.id,
                'username': user.username,
                'email': getattr(user, 'email', None) or None,
                'currency': tipo,
                'currency_prefix': tipo,
                'saldo': balance,
                'balance': balance,
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
        'term_days': getattr(lic, 'license_term_days', None) if lic else None,
        'month_to_month': bool(getattr(lic, 'month_to_month', False)) if lic else False,
        'renewal': {
            'customer_account': bool(getattr(lic, 'renew_customer_account', False)) if lic else False,
            'inventory_search': True,
        },
    }
    if tipo in ('USD', 'COP'):
        item['currency'] = tipo
        item['price'] = round(price_usd if tipo == 'USD' else price_cop, 2)
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
        pid = it.get('product_id', it.get('plan_id', it.get('id')))
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


def _execute_partner_purchase(user, raw_items):
    from app.store.routes import _acquire_checkout_lock, _procesar_pago_core, _user_can_purchase_in_store

    if not _user_can_purchase_in_store(user):
        return _err(
            'forbidden',
            'Tu cuenta solo puede visualizar la tienda. No puedes comprar ni reservar.',
            403,
        )
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
    if total_accounts > LIMIT_PURCHASES_PER_MIN:
        return _err(
            'cart_limit',
            f'Máximo {LIMIT_PURCHASES_PER_MIN} cuentas por pedido.',
            400,
        )
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
        request._cached_json = ({'productos': items}, {'productos': items})
        with _session_as_user(user):
            resp = _procesar_pago_core()
    finally:
        lock.release()

    payload, status = _flask_response_payload(resp)
    if payload.get('success'):
        tipo = _partner_currency_or_none(user)
        saldo = _partner_saldo_payload(
            user,
            tipo=tipo,
            saldo_cop=payload.get('new_saldo_cop'),
            saldo_usd=payload.get('new_saldo_usd'),
        )
        assigned = payload.get('cuentas_asignadas') or []
        return _ok(
            {
                'cuentas_asignadas': assigned,
                'purchases': assigned,
                'saldo': saldo or {'currency': tipo, 'saldo': 0.0},
                'balance': (saldo or {}).get('saldo'),
                'currency': tipo,
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


def _parse_cart_items_from_mp(data):
    """Acepta items de carrito MP ({plan_id, quantity}) o de tienda ({product_id})."""
    raw = data.get('items') or data.get('productos')
    if isinstance(raw, list) and raw:
        return raw
    plan_id = data.get('plan_id') or data.get('product_id')
    if plan_id is None:
        return None
    customers = data.get('customers')
    if isinstance(customers, list) and customers:
        return [{'product_id': plan_id, 'quantity': len(customers)}]
    qty = data.get('quantity') or data.get('cantidad') or 1
    return [{'product_id': plan_id, 'quantity': qty}]


def _partner_cart_preview(user, raw_items):
    from app.store.routes import catalog_products_for_store_user, _user_can_purchase_in_store

    if not isinstance(raw_items, list) or not raw_items:
        return _err('bad_request', 'Envía items: [{plan_id, quantity}].', 400)
    if len(raw_items) > LIMIT_CART_LINES:
        return _err('cart_limit', f'Máximo {LIMIT_CART_LINES} líneas por pedido.', 400)
    items, total_accounts, verr = _normalize_purchase_items(raw_items)
    if verr:
        return _err('bad_request', verr, 400)
    if total_accounts > LIMIT_PURCHASES_PER_MIN:
        return _err('cart_limit', f'Máximo {LIMIT_PURCHASES_PER_MIN} cuentas por pedido.', 400)

    products, tipo = catalog_products_for_store_user(user)
    by_id = {int(p.id): p for p in products}
    saldo = _partner_saldo_payload(user, tipo=tipo) or {'saldo': 0.0, 'currency': tipo}
    balance = float(saldo.get('saldo') or 0)
    lines = []
    total_price = 0.0
    stock_ok = True
    for row in items:
        pid = int(row['id'])
        qty = int(row.get('cantidad') or 1)
        product = by_id.get(pid)
        if product is None:
            return _err('not_found', f'El producto {pid} no está en tu catálogo.', 404)
        payload = _product_payload(product, tipo)
        unit = float(payload.get('price') or 0)
        stock = int(payload.get('stock') or 0)
        line_ok = stock >= qty
        if not line_ok:
            stock_ok = False
        line_total = round(unit * qty, 2)
        total_price += line_total
        lines.append(
            {
                'plan_id': pid,
                'product_id': pid,
                'plan_name': product.name,
                'platform_name': product.name,
                'quantity': qty,
                'unit_price': unit,
                'line_total': line_total,
                'stock': stock,
                'stock_sufficient': line_ok,
                'currency': tipo,
            }
        )
    total_price = round(total_price, 2)
    balance_ok = balance + 1e-9 >= total_price
    can_buy = bool(_user_can_purchase_in_store(user) and stock_ok and balance_ok)
    return _ok(
        {
            'lines': lines,
            'summary': {
                'line_count': len(lines),
                'total_accounts': total_accounts,
                'total_price': total_price,
                'balance': balance,
                'balance_after': round(balance - total_price, 2) if balance_ok else balance,
                'stock_sufficient': stock_ok,
                'balance_sufficient': balance_ok,
                'can_checkout': can_buy,
                'can_confirm': can_buy,
                'currency': tipo,
            },
        }
    )


@partner_api_bp.route('/store/purchases/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_store_purchases(user):
    data = request.get_json(silent=True) or {}
    raw_items = data.get('items') or data.get('productos') or []
    return _execute_partner_purchase(user, raw_items)


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
    issues = []
    for p in rows:
        item = photo_to_dict(p)
        item['platform'] = 'store'
        issues.append(item)
    return _ok({'issues': issues})


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
    account_id = form.get('account_id') or form.get('count_id')
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
# Alias de rutas (mismas operaciones, otras URLs)
# ---------------------------------------------------------------------------

def _page_args():
    try:
        page = max(1, int(request.args.get('page') or 1))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(request.args.get('page_size') or 20)
    except (TypeError, ValueError):
        page_size = 20
    return page, max(1, min(100, page_size))


@partner_api_bp.route('/me/password/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_me_password(user):
    data = request.get_json(silent=True) or {}
    old_pw = str(data.get('old_password') or '')
    new_pw = str(data.get('new_password') or '')
    confirm = str(data.get('new_password_confirm') or new_pw)
    if not old_pw or not new_pw:
        return _err('bad_request', 'Envía old_password y new_password.', 400)
    if new_pw != confirm:
        return _err('bad_request', 'La confirmación no coincide.', 400)
    if len(new_pw) < 6:
        return _err('bad_request', 'La nueva contraseña debe tener al menos 6 caracteres.', 400)
    if not check_password_hash(user.password, old_pw):
        return _err('invalid_credentials', 'La contraseña actual no es correcta.', 401)
    user.password = generate_password_hash(new_pw)
    db.session.commit()
    return _ok({'changed': True}, message='Contraseña actualizada. Vuelve a iniciar sesión.')


@partner_api_bp.route('/multiplatform/platforms/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_mp_platforms(user):
    from app.store.routes import catalog_products_for_store_user

    products, tipo = catalog_products_for_store_user(user)
    q = (request.args.get('q') or '').strip().lower()
    platforms = []
    for p in products:
        if q and q not in (p.name or '').lower():
            continue
        platforms.append({'id': p.id, 'name': p.name, 'platform_id': p.id})
    return _ok({'platforms': platforms, 'currency': tipo})


@partner_api_bp.route('/multiplatform/platforms/<int:platform_id>/market/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_mp_market(user, platform_id):
    from app.store.routes import catalog_products_for_store_user

    products, tipo = catalog_products_for_store_user(user)
    product = next((p for p in products if int(p.id) == int(platform_id)), None)
    if product is None:
        return _err('not_found', 'Esa plataforma no está en tu catálogo.', 404)
    payload = _product_payload(product, tipo)
    plan = {
        'plan_id': product.id,
        'product_id': product.id,
        'name': product.name,
        'price': payload.get('price'),
        'currency': tipo,
        'stock': payload.get('stock'),
        'term_days': payload.get('term_days'),
        'month_to_month': payload.get('month_to_month'),
        'renewal': payload.get('renewal'),
    }
    return _ok(
        {
            'platform_id': product.id,
            'platform_name': product.name,
            'currency': tipo,
            'plans': [plan],
        }
    )


@partner_api_bp.route('/multiplatform/sales/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_mp_sales(user):
    data = request.get_json(silent=True) or {}
    items = _parse_cart_items_from_mp(data)
    if not items:
        return _err('bad_request', 'Envía plan_id (o items).', 400)
    return _execute_partner_purchase(user, items)


@partner_api_bp.route('/multiplatform/sales/bulk/preview/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_mp_bulk_preview(user):
    data = request.get_json(silent=True) or {}
    customers = data.get('customers')
    if not isinstance(customers, list) or not (2 <= len(customers) <= 10):
        return _err('bad_request', 'Envía customers: lista de 2 a 10 nombres.', 400)
    items = _parse_cart_items_from_mp(data)
    return _partner_cart_preview(user, items)


@partner_api_bp.route('/multiplatform/sales/bulk/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_mp_bulk(user):
    data = request.get_json(silent=True) or {}
    customers = data.get('customers')
    if not isinstance(customers, list) or not (2 <= len(customers) <= 10):
        return _err('bad_request', 'Envía customers: lista de 2 a 10 nombres.', 400)
    items = _parse_cart_items_from_mp(data)
    return _execute_partner_purchase(user, items)


@partner_api_bp.route('/multiplatform/cart/preview/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_mp_cart_preview(user):
    data = request.get_json(silent=True) or {}
    items = _parse_cart_items_from_mp(data)
    return _partner_cart_preview(user, items)


@partner_api_bp.route('/multiplatform/cart/checkout/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_mp_cart_checkout(user):
    data = request.get_json(silent=True) or {}
    items = _parse_cart_items_from_mp(data)
    return _execute_partner_purchase(user, items)


@partner_api_bp.route('/multiplatform/renewals/search/', methods=['GET', 'POST'])
@_csrf_exempt
@partner_auth_required
def partner_mp_renewals_search(user):
    from app.store.routes import _lookup_store_renewal_accounts, _parse_renewal_email_tokens

    if request.method == 'GET':
        raw = str(request.args.get('q') or request.args.get('email') or '').strip()
    else:
        data = request.get_json(silent=True) or {}
        raw = str(data.get('q') or data.get('emails') or data.get('email') or '').strip()
    if not raw:
        return _err('bad_request', 'Envía q con el correo a renovar.', 400)
    emails = _parse_renewal_email_tokens(raw)
    if not emails:
        return _err('bad_request', 'No se encontraron correos en el texto.', 400)
    with _session_as_user(user):
        renewable, rejected = _lookup_store_renewal_accounts(emails)
    return _ok({'renewable': renewable, 'rejected': rejected})


@partner_api_bp.route('/multiplatform/renewals/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_mp_renewals_create(user):
    data = request.get_json(silent=True) or {}
    ids = data.get('renovacion_account_ids') or data.get('account_ids') or []
    if data.get('account_id') is not None:
        ids = list(ids) + [data.get('account_id')]
    clean = []
    for x in ids:
        try:
            clean.append(int(x))
        except (TypeError, ValueError):
            continue
    product_id = data.get('product_id') or data.get('plan_id')
    if not clean:
        return _err('bad_request', 'Envía account_id o renovacion_account_ids.', 400)
    if not product_id:
        acc = _find_partner_account(user, account_id=clean[0])
        if acc:
            from app.store.models import License

            lic = License.query.get(acc.license_id)
            product_id = getattr(lic, 'product_id', None) if lic else None
    if not product_id:
        return _err('bad_request', 'No se pudo determinar el product_id / plan_id.', 400)
    return _execute_partner_purchase(
        user,
        [{'product_id': product_id, 'renovacion_account_ids': clean}],
    )


@partner_api_bp.route('/multiplatform/accounts/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_mp_accounts(user):
    from app.store.models import License, LicenseAccount, Product

    page, page_size = _page_args()
    q = (request.args.get('q') or request.args.get('search') or '').strip().lower()
    qry = LicenseAccount.query.filter(
        LicenseAccount.assigned_to_user_id == int(user.id),
        LicenseAccount.status.in_(('assigned', 'sold')),
    )
    if q:
        qry = qry.filter(
            db.or_(
                LicenseAccount.email.ilike('%' + q + '%'),
                LicenseAccount.account_identifier.ilike('%' + q + '%'),
            )
        )
    total = qry.count()
    rows = (
        qry.order_by(LicenseAccount.assigned_at.desc().nullslast())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    out = []
    for acc in rows:
        lic = License.query.get(acc.license_id) if acc.license_id else None
        prod = Product.query.get(lic.product_id) if lic and lic.product_id else None
        out.append(
            {
                'count_id': acc.id,
                'account_id': acc.id,
                'sale_id': acc.sale_id,
                'email': acc.email or acc.account_identifier,
                'password': acc.password,
                'plan': prod.name if prod else None,
                'product_id': lic.product_id if lic else None,
                'date_start': acc.assigned_at.isoformat() + 'Z' if acc.assigned_at else None,
                'date_end': acc.expires_at.isoformat() + 'Z' if acc.expires_at else None,
            }
        )
    return _ok({'accounts': out, 'page': page, 'page_size': page_size, 'total': total})


@partner_api_bp.route('/seller/account-issues/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_mp_issues_list(user):
    return partner_store_issues_list.__wrapped__(user)


@partner_api_bp.route('/seller/account-issues/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_mp_issues_create(user):
    return partner_store_issues_create.__wrapped__(user)


@partner_api_bp.route('/seller/account-issues/search/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_mp_issues_search(user):
    from app.store.models import License, LicenseAccount, Product

    q = str(request.args.get('q') or request.args.get('email') or '').strip().lower()
    if not q:
        return _err('bad_request', 'Envía q con el correo o parte de la cuenta.', 400)
    rows = (
        LicenseAccount.query.filter(
            LicenseAccount.assigned_to_user_id == int(user.id),
            LicenseAccount.status.in_(('assigned', 'sold')),
        )
        .filter(
            db.or_(
                LicenseAccount.email.ilike('%' + q + '%'),
                LicenseAccount.account_identifier.ilike('%' + q + '%'),
            )
        )
        .order_by(LicenseAccount.assigned_at.desc().nullslast())
        .limit(30)
        .all()
    )
    accounts = []
    for acc in rows:
        lic = License.query.get(acc.license_id) if acc.license_id else None
        prod = Product.query.get(lic.product_id) if lic and lic.product_id else None
        accounts.append(
            {
                'count_id': acc.id,
                'account_id': acc.id,
                'email': acc.email or acc.account_identifier,
                'plan': prod.name if prod else None,
            }
        )
    return _ok({'accounts': accounts})


@partner_api_bp.route('/seller/account-issues/<platform>/<int:issue_id>/', methods=['DELETE'])
@_csrf_exempt
@partner_auth_required
def partner_mp_issues_delete(user, platform, issue_id):
    from app.store.license_report_photos import LicenseReportPhoto, ensure_report_photos_schema

    ensure_report_photos_schema()
    row = LicenseReportPhoto.query.filter_by(id=int(issue_id), reporter_user_id=int(user.id)).first()
    if not row:
        return _err('not_found', 'No se encontró ese reporte.', 404)
    db.session.delete(row)
    db.session.commit()
    return _ok({'deleted': True, 'id': issue_id, 'platform': platform})


@partner_api_bp.route('/streaming-codes/services/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_mp_codes_services(user):
    return partner_codes_services.__wrapped__(user)


@partner_api_bp.route('/streaming-codes/query/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_mp_codes_query(user):
    resp = partner_codes_search.__wrapped__(user)
    body, status = _flask_response_payload(resp)
    if not body.get('success') and body.get('error'):
        return jsonify(body), status
    payload = body.get('data') or {}
    result = payload.get('result') or {}
    results = []
    if payload.get('found') and result:
        link = None
        for m in result.get('matches') or []:
            if str(m).lower().startswith('http'):
                link = m
                break
        results.append(
            {
                'subject': result.get('subject'),
                'date': result.get('date'),
                'code': result.get('code'),
                'link': link,
                'extra': result.get('matches') or [],
            }
        )
    return _ok(
        {
            'service': payload.get('service'),
            'email': payload.get('email'),
            'found': payload.get('found'),
            'results': results,
            'result': result,
        }
    )


@partner_api_bp.route('/seller/sales/', methods=['GET'])
@partner_api_bp.route('/seller/sales/<platform>/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_mp_sales_history(user, platform=None):
    from app.store.models import Product, Sale

    page, page_size = _page_args()
    qry = Sale.query.filter_by(user_id=int(user.id))
    total = qry.count()
    rows = qry.order_by(Sale.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    sales = []
    for sale in rows:
        prod = Product.query.get(sale.product_id)
        sales.append(
            {
                'sale_id': sale.id,
                'product_id': sale.product_id,
                'plan': prod.name if prod else None,
                'quantity': sale.quantity,
                'total_price': float(sale.total_price or 0),
                'currency': sale.currency,
                'is_renewal': bool(sale.is_renewal),
                'created_at': sale.created_at.isoformat() + 'Z' if sale.created_at else None,
            }
        )
    return _ok({'sales': sales, 'page': page, 'page_size': page_size, 'total': total, 'platform': platform or 'store'})


@partner_api_bp.route('/seller/dashboard/', methods=['GET'])
@_csrf_exempt
@partner_auth_required
def partner_mp_dashboard(user):
    from datetime import timedelta

    from app.store.license_report_photos import LicenseReportPhoto, ensure_report_photos_schema
    from app.store.models import Sale

    tipo = _partner_currency_or_none(user)
    saldo = _partner_saldo_payload(user, tipo=tipo) or {'saldo': 0.0}
    since = datetime.utcnow() - timedelta(days=30)
    sales_30 = Sale.query.filter(Sale.user_id == int(user.id), Sale.created_at >= since).count()
    open_issues = 0
    try:
        ensure_report_photos_schema()
        open_issues = LicenseReportPhoto.query.filter(
            LicenseReportPhoto.reporter_user_id == int(user.id),
            LicenseReportPhoto.status.in_(('open', 'awaiting')),
        ).count()
    except Exception:
        open_issues = 0
    return _ok(
        {
            'balance': saldo.get('saldo'),
            'currency': tipo,
            'sales_last_30_days': sales_30,
            'open_issues': open_issues,
        }
    )


@partner_api_bp.route('/store/purchases/preview/', methods=['POST'])
@_csrf_exempt
@partner_auth_required
def partner_store_purchases_preview(user):
    data = request.get_json(silent=True) or {}
    items = _parse_cart_items_from_mp(data)
    return _partner_cart_preview(user, items)


# ---------------------------------------------------------------------------
# Administración (sesión admin, con CSRF): interruptor + IPs
# ---------------------------------------------------------------------------

def _annotate_whitelist_owner_status(wl):
    cache = {}
    out = []
    for entry in wl or []:
        if not isinstance(entry, dict):
            out.append(entry)
            continue
        item = dict(entry)
        item['owner_enabled'] = _whitelist_owner_is_enabled(item, cache)
        out.append(item)
    return out


@partner_api_bp.route('/admin/settings/', methods=['GET'])
def partner_admin_settings_get():
    if not _is_admin_session():
        return _err('forbidden', 'Solo el administrador puede ver esta configuración.', 403)
    settings = get_partner_settings()
    settings['client_ip'] = _client_ip()
    settings['users'] = _partner_ip_bind_users()
    settings['ip_whitelist'] = _annotate_whitelist_owner_status(settings.get('ip_whitelist') or [])
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
    seen = set()
    invalid = []
    for entry in raw_list:
        bound = _bind_ip_entry(entry)
        if bound is None:
            label = entry.get('ip') if isinstance(entry, dict) else entry
            invalid.append(str(label))
            continue
        if bound['ip'] in seen:
            cleaned = [c for c in cleaned if c['ip'] != bound['ip']]
        seen.add(bound['ip'])
        cleaned.append(bound)
    if invalid:
        return _err(
            'bad_request',
            'IPs no válidas: ' + ', '.join(invalid[:5]) + '. Usa IPs exactas o rangos CIDR.',
            400,
        )
    unbound = [c['ip'] for c in cleaned if not c.get('user_id')]
    if unbound:
        return _err(
            'bad_request',
            'Cada IP debe estar vinculada a un usuario. Falta dueño en: ' + ', '.join(unbound[:5]) + '.',
            400,
        )
    if not cleaned:
        return _err(
            'bad_request',
            'La lista no puede quedar vacía. Añade al menos una IP vinculada a un usuario.',
            400,
        )
    save_partner_settings(enabled, cleaned)
    settings = get_partner_settings()
    settings['client_ip'] = _client_ip()
    settings['users'] = _partner_ip_bind_users()
    return _ok(settings)


# ---------------------------------------------------------------------------
# Documentación en vivo
# ---------------------------------------------------------------------------

@partner_api_bp.route('/docs/', methods=['GET'])
def partner_api_docs():
    """Documentación generada desde la BD: solo con sesión de la web (admin o usuario)."""
    from app.models.service import ServiceModel  # noqa: F401 (aseguramos import temprano)
    from app.store.routes import catalog_products_for_store_user

    if not session.get('logged_in'):
        flash('Debes iniciar sesión para ver la documentación de la API.', 'warning')
        return redirect(url_for('user_auth_bp.login'))

    docs_user = _session_docs_user()
    if not _is_admin_session() and _is_store_subuser(docs_user):
        flash('La documentación de la API es solo para el usuario principal y el administrador.', 'warning')
        return redirect(url_for('store_bp.store_front'))
    viewer_currency = _partner_currency_or_none(docs_user) if docs_user else None
    can_see_prices = viewer_currency in ('USD', 'COP')
    admin_docs = _is_admin_session()

    products_docs = []
    try:
        if can_see_prices:
            products, tipo = catalog_products_for_store_user(docs_user)
            products_docs = [_product_payload(p, tipo) for p in products]
        elif admin_docs:
            from app.store.models import Product
            from app.store.routes import public_store_products_query

            try:
                products = public_store_products_query().order_by(Product.name.asc()).all()
            except Exception:
                products = Product.query.filter_by(enabled=True).order_by(Product.name.asc()).all()
            products_docs = [_product_payload(p, None) for p in products]
    except Exception:
        current_app.logger.exception('partner docs: productos')

    services_docs = []
    try:
        services_docs = [{'id': s.id, 'name': s.name} for s in _partner_visible_services()]
    except Exception:
        current_app.logger.exception('partner docs: servicios')

    settings = get_partner_settings()
    base_url = request.url_root.rstrip('/') + '/api/partner/v1'
    example_currency = viewer_currency or 'COP'
    example_product = products_docs[0] if products_docs else {
        'id': 1,
        'name': 'Producto ejemplo',
        'renewal': {'customer_account': True, 'inventory_search': True},
    }
    if can_see_prices:
        example_price = example_product.get('price', 12000.0 if example_currency == 'COP' else 3.5)
    else:
        example_price = 12000.0 if example_currency == 'COP' else 3.5
    example_service = services_docs[0] if services_docs else {'id': 1, 'name': 'Boton ejemplo'}

    return render_template(
        'partner_api_docs.html',
        current_user=docs_user,
        viewer_currency=viewer_currency,
        can_see_prices=can_see_prices,
        can_see_product_list=can_see_prices or admin_docs,
        example_currency=example_currency,
        example_price=example_price,
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
