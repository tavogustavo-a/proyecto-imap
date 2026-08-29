# -*- coding: utf-8 -*-
"""Cliente de la API Partner v1 de Multiplataforma (multiplataforma.co).

Guarda las credenciales del vendedor en StoreSetting (la contraseña va
cifrada con Fernet, la misma clave que las cuentas IMAP) y gestiona los
tokens JWT con renovación automática.

Documentación: https://multiplataforma.co/api/partner/v1/docs/
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque

import requests

from app import db
from app.services.imap_crypto import decrypt_password, encrypt_password
from app.store.models import StoreSetting

MP_API_BASE = 'https://multiplataforma.co/api/partner/v1'

MP_SETTING_USERNAME = 'multiplataforma_api_username'
MP_SETTING_PASSWORD_ENC = 'multiplataforma_api_password_enc'
MP_SETTING_PLAN_LINKS = 'multiplataforma_plan_links'

_HTTP_TIMEOUT = 25

# Los access token de la API expiran; renovamos por adelantado.
_ACCESS_TOKEN_TTL_SECONDS = 240

_token_lock = threading.Lock()
_token_cache = {'access': None, 'refresh': None, 'obtained_at': 0.0}

# Rate limit de compras de la API (partner_purchase: 30/min). Limitamos por
# debajo del tope y con espera corta para no chocar nunca con el 429.
_PURCHASE_WINDOW_SECONDS = 60
_PURCHASE_MAX_PER_WINDOW = 25
_PURCHASE_MAX_WAIT_SECONDS = 12
_purchase_lock = threading.Lock()
_purchase_times = deque()


class MultiplataformaApiError(Exception):
    """Error de la API Partner con mensaje apto para mostrar al admin."""

    def __init__(self, message, code=None, http_status=None):
        super().__init__(message)
        self.code = code
        self.http_status = http_status


# ---------------------------------------------------------------------------
# Credenciales (StoreSetting)
# ---------------------------------------------------------------------------

def _get_setting(key):
    row = StoreSetting.query.filter_by(key=key).first()
    return row.value if row else None


def _set_setting(key, value):
    row = StoreSetting.query.filter_by(key=key).first()
    if row is None:
        row = StoreSetting(key=key, value=value)
        db.session.add(row)
    else:
        row.value = value
    db.session.commit()


def _delete_setting(key):
    row = StoreSetting.query.filter_by(key=key).first()
    if row is not None:
        db.session.delete(row)
        db.session.commit()


def get_saved_username():
    return (_get_setting(MP_SETTING_USERNAME) or '').strip() or None


def has_credentials():
    return bool(get_saved_username() and _get_setting(MP_SETTING_PASSWORD_ENC))


def save_credentials(username, password):
    _set_setting(MP_SETTING_USERNAME, username.strip())
    _set_setting(MP_SETTING_PASSWORD_ENC, encrypt_password(password))
    invalidate_tokens()


def clear_credentials():
    _delete_setting(MP_SETTING_USERNAME)
    _delete_setting(MP_SETTING_PASSWORD_ENC)
    invalidate_tokens()


def _get_password_plain():
    enc = _get_setting(MP_SETTING_PASSWORD_ENC)
    if not enc:
        return None
    return decrypt_password(enc)


# ---------------------------------------------------------------------------
# Tokens JWT
# ---------------------------------------------------------------------------

def invalidate_tokens():
    with _token_lock:
        _token_cache['access'] = None
        _token_cache['refresh'] = None
        _token_cache['obtained_at'] = 0.0


def _parse_error(resp):
    """Extrae (code, message) del cuerpo de error de la API."""
    code = None
    message = None
    try:
        body = resp.json()
        err = body.get('error') or {}
        code = err.get('code')
        message = err.get('message') or body.get('message')
    except Exception:
        pass
    msg_l = (message or '').lower()
    looks_like_ip_block = (
        code == 'ip_not_allowed'
        or 'ip_not_allowed' in msg_l
        or 'whatsapp' in msg_l
        or '+57' in msg_l
        or '320 943' in msg_l
        or '320943' in msg_l
        or (resp.status_code == 403 and ('ip' in msg_l or not message))
    )
    if looks_like_ip_block:
        message = 'Este servidor no está dado de alta para usar la API.'
        code = code or 'ip_not_allowed'
    if not message:
        message = 'Error HTTP %s de la API Multiplataforma.' % resp.status_code
    return code, message


def _login():
    username = get_saved_username()
    password = _get_password_plain()
    if not username or not password:
        raise MultiplataformaApiError(
            'No hay credenciales guardadas. Configura usuario y contraseña '
            'del vendedor Multiplataforma.',
            code='no_credentials',
        )
    try:
        resp = requests.post(
            MP_API_BASE + '/auth/token/',
            json={'username': username, 'password': password},
            timeout=_HTTP_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise MultiplataformaApiError(
            'No se pudo conectar con multiplataforma.co: %s' % exc,
            code='network_error',
        )
    if resp.status_code != 200:
        code, message = _parse_error(resp)
        raise MultiplataformaApiError(message, code=code, http_status=resp.status_code)
    tokens = ((resp.json().get('data') or {}).get('tokens')) or {}
    access = tokens.get('access')
    refresh = tokens.get('refresh')
    if not access:
        raise MultiplataformaApiError(
            'La API no devolvió tokens de acceso.', code='bad_response'
        )
    return access, refresh


def _refresh_access(refresh_token):
    try:
        resp = requests.post(
            MP_API_BASE + '/auth/token/refresh/',
            json={'refresh': refresh_token},
            timeout=_HTTP_TIMEOUT,
        )
    except requests.RequestException:
        return None, None
    if resp.status_code != 200:
        return None, None
    data = (resp.json().get('data')) or {}
    return data.get('access'), data.get('refresh')


def _get_access_token(force_new=False):
    with _token_lock:
        now = time.time()
        if (
            not force_new
            and _token_cache['access']
            and (now - _token_cache['obtained_at']) < _ACCESS_TOKEN_TTL_SECONDS
        ):
            return _token_cache['access']

        # Intentar refresh antes de un login completo
        if not force_new and _token_cache['refresh']:
            access, refresh = _refresh_access(_token_cache['refresh'])
            if access:
                _token_cache['access'] = access
                if refresh:
                    _token_cache['refresh'] = refresh
                _token_cache['obtained_at'] = now
                return access

        access, refresh = _login()
        _token_cache['access'] = access
        _token_cache['refresh'] = refresh
        _token_cache['obtained_at'] = now
        return access


# ---------------------------------------------------------------------------
# Peticiones autenticadas
# ---------------------------------------------------------------------------

def api_request(method, path, json_body=None, params=None, form_data=None, files=None):
    """Petición autenticada. Devuelve el dict `data` de la respuesta.

    Con ``files``/``form_data`` envía multipart/form-data (reportes con imagen).
    Reintenta una vez con login nuevo si el access token fue rechazado.
    """
    url = MP_API_BASE + path
    for attempt in (1, 2):
        token = _get_access_token(force_new=(attempt == 2))
        try:
            resp = requests.request(
                method,
                url,
                json=json_body if not (files or form_data) else None,
                data=form_data,
                files=files,
                params=params,
                headers={'Authorization': 'Bearer %s' % token},
                timeout=_HTTP_TIMEOUT if not files else max(_HTTP_TIMEOUT, 60),
            )
        except requests.RequestException as exc:
            raise MultiplataformaApiError(
                'No se pudo conectar con multiplataforma.co: %s' % exc,
                code='network_error',
            )
        if resp.status_code == 401 and attempt == 1:
            invalidate_tokens()
            continue
        if resp.status_code == 429:
            raise MultiplataformaApiError(
                'El proveedor está recibiendo demasiadas solicitudes. '
                'Espera un minuto e inténtalo de nuevo.',
                code='rate_limited',
                http_status=429,
            )
        if resp.status_code >= 400:
            code, message = _parse_error(resp)
            raise MultiplataformaApiError(
                message, code=code, http_status=resp.status_code
            )
        try:
            body = resp.json()
        except ValueError:
            body = {}  # respuestas sin cuerpo (p. ej. DELETE 204)
        return body.get('data') if isinstance(body, dict) else body
    raise MultiplataformaApiError('Token rechazado por la API.', code='auth_failed')


# ---------------------------------------------------------------------------
# Limitador local de compras (evita el 429 de partner_purchase)
# ---------------------------------------------------------------------------

def _reserve_purchase_slot():
    """Reserva un cupo en la ventana de compras (25/min con margen).

    Si la ventana está llena espera hasta ~12 s a que se libere un cupo;
    si no alcanza, lanza error claro (mejor que un 429 del proveedor).
    """
    deadline = time.time() + _PURCHASE_MAX_WAIT_SECONDS
    while True:
        with _purchase_lock:
            now = time.time()
            while _purchase_times and (now - _purchase_times[0]) > _PURCHASE_WINDOW_SECONDS:
                _purchase_times.popleft()
            if len(_purchase_times) < _PURCHASE_MAX_PER_WINDOW:
                _purchase_times.append(now)
                return
            wait = _PURCHASE_WINDOW_SECONDS - (now - _purchase_times[0]) + 0.05
        if time.time() + wait > deadline:
            raise MultiplataformaApiError(
                'Hay muchas compras con el proveedor en este momento. '
                'Espera un minuto e inténtalo de nuevo.',
                code='local_rate_limit',
            )
        time.sleep(min(wait, 1.5))


# ---------------------------------------------------------------------------
# Operaciones usadas por el panel
# ---------------------------------------------------------------------------

def get_profile():
    """GET /me/ — perfil, saldo y moneda del vendedor."""
    data = api_request('GET', '/me/') or {}
    return data.get('user') or {}


def get_platforms():
    """GET /multiplatform/platforms/ — plataformas habilitadas."""
    return api_request('GET', '/multiplatform/platforms/') or {}


def get_market(platform_id):
    """GET /multiplatform/platforms/{id}/market/ — planes, precio y stock."""
    return api_request(
        'GET', '/multiplatform/platforms/%s/market/' % int(platform_id)
    ) or {}


def buy_account(plan_id, customer):
    """POST /multiplatform/sales/ — compra 1 cuenta del stock del plan.

    Devuelve el dict `data` con credenciales (email, password, profile, pin),
    vigencia (date_start, date_end) e instructions.
    """
    _reserve_purchase_slot()
    return api_request(
        'POST',
        '/multiplatform/sales/',
        json_body={'plan_id': int(plan_id), 'customer': (customer or 'Cliente')[:80]},
    ) or {}


def buy_cart_checkout_items(items):
    """POST /multiplatform/cart/checkout/ — pedido atómico multi-plan.

    ``items``: lista de {'plan_id', 'quantity' (1-10), 'customer'}.
    Todo o nada: si falla stock o saldo del vendedor, no se cobra nada.
    Devuelve el dict `data` con `lines` y `purchases` (todas las cuentas).
    """
    payload = []
    for it in items:
        payload.append({
            'plan_id': int(it['plan_id']),
            'quantity': int(it['quantity']),
            'customer': (it.get('customer') or 'Cliente')[:80],
        })
    _reserve_purchase_slot()
    return api_request(
        'POST', '/multiplatform/cart/checkout/', json_body={'items': payload}
    ) or {}


def buy_cart_checkout(plan_id, quantity, customer):
    """Compra atómica de N cuentas de un solo plan (atajo de cart/checkout)."""
    return buy_cart_checkout_items(
        [{'plan_id': plan_id, 'quantity': quantity, 'customer': customer}]
    )


def get_renewal_options(sale_id):
    """GET /multiplatform/renewals/options/ — preview de renovación de una venta.

    Devuelve dict con can_request, pending_renovation, date_limit, price, reason…
    """
    return api_request(
        'GET', '/multiplatform/renewals/options/', params={'sale_id': int(sale_id)}
    ) or {}


def request_renewal(sale_id, message=''):
    """POST /multiplatform/renewals/ — crea la solicitud de renovación.

    Las renovaciones multi son solicitudes que la administración de
    Multiplataforma revisa manualmente (no se completan al instante).
    """
    body = {'sale_id': int(sale_id)}
    if message:
        body['message'] = str(message)[:200]
    return api_request('POST', '/multiplatform/renewals/', json_body=body) or {}


# ---------------------------------------------------------------------------
# Incidencias de cuentas (reportes de fallos con imagen)
# ---------------------------------------------------------------------------

def list_account_issues(status='all', platform='all', page_size=100, q=None):
    """GET /seller/account-issues/ — reportes de fallos enviados al proveedor.

    ``status``: all | pending | answered. Devuelve el dict `data` (issues[]).
    """
    params = {'status': status, 'platform': platform, 'page_size': int(page_size)}
    if q:
        params['q'] = str(q)[:120]
    return api_request('GET', '/seller/account-issues/', params=params) or {}


def create_account_issue(platform, count_id, issue_text, image_name, image_bytes, image_mime):
    """POST /seller/account-issues/ — reporta un fallo de cuenta al proveedor.

    La imagen es obligatoria para la API (captura del error, máx. 15 MB).
    Devuelve el dict `data` de la respuesta (puede incluir el id del reporte).
    """
    return api_request(
        'POST',
        '/seller/account-issues/',
        form_data={
            'platform': str(platform or 'multiplatform'),
            'count_id': str(int(count_id)),
            'issue': str(issue_text or '')[:1000],
        },
        files={'image': (image_name or 'reporte.jpg', image_bytes, image_mime or 'image/jpeg')},
    ) or {}


def delete_account_issue(platform, issue_id):
    """DELETE /seller/account-issues/{platform}/{issue_id}/ — elimina un reporte propio."""
    return api_request(
        'DELETE',
        '/seller/account-issues/%s/%s/' % (str(platform or 'multiplatform'), int(issue_id)),
    ) or {}


def search_issue_account(platform, q):
    """GET /seller/account-issues/search/ — busca cuentas reportables (para hallar count_id)."""
    return api_request(
        'GET',
        '/seller/account-issues/search/',
        params={'platform': str(platform or 'multiplatform'), 'q': str(q or '')[:120]},
    ) or {}


# ---------------------------------------------------------------------------
# Vínculos plan Multiplataforma → producto de licencias (License.id)
# ---------------------------------------------------------------------------

def get_plan_links():
    """Dict {plan_id(str): {license_id, platform_id, platform_name, plan_name, days}}."""
    raw = _get_setting(MP_SETTING_PLAN_LINKS)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_plan_links(links):
    _set_setting(MP_SETTING_PLAN_LINKS, json.dumps(links, ensure_ascii=False))


def set_plan_link(plan_id, license_id, meta=None):
    """Vincula un plan a un producto (License). license_id=None desvincula.

    Regla: un producto solo puede estar vinculado a UN plan (sin duplicados).
    Devuelve (ok, error_message).
    """
    links = get_plan_links()
    key = str(int(plan_id))

    if not license_id:
        links.pop(key, None)
        _save_plan_links(links)
        return True, None

    license_id = int(license_id)
    for other_key, info in links.items():
        if other_key == key:
            continue
        if int(info.get('license_id') or 0) == license_id:
            return False, (
                'Ese producto ya está vinculado al plan «%s». '
                'Desvincúlalo primero para evitar duplicados.'
                % (info.get('plan_name') or other_key)
            )

    entry = {'license_id': license_id}
    for field in ('platform_id', 'platform_name', 'plan_name', 'days'):
        if meta and meta.get(field) is not None:
            entry[field] = meta[field]
    links[key] = entry
    _save_plan_links(links)
    return True, None


def get_link_for_license(license_id):
    """(plan_id, info) del vínculo cuyo producto es license_id, o (None, None)."""
    for plan_id, info in get_plan_links().items():
        if int(info.get('license_id') or 0) == int(license_id):
            return int(plan_id), info
    return None, None


# ---------------------------------------------------------------------------
# Formato de entrega hacia el bloc de Licencias
# ---------------------------------------------------------------------------

def format_license_line(purchase):
    """Línea para el bloc de Licencias según las reglas del admin.

    - Sin PIN: «correo contraseña»
    - Con PIN: «correo contraseña perfil pin»
    """
    email = (purchase.get('email') or '').strip()
    password = (purchase.get('password') or '').strip()
    profile = (purchase.get('profile') or '').strip()
    pin = (purchase.get('pin') or '').strip()
    if pin:
        return ' '.join(x for x in (email, password, profile, pin) if x)
    return ('%s %s' % (email, password)).strip()


def format_license_note(purchase):
    """Nota (perfil y pin) solo si existe PIN; si no, sin nota."""
    profile = (purchase.get('profile') or '').strip()
    pin = (purchase.get('pin') or '').strip()
    if not pin:
        return ''
    if profile:
        return 'Perfil: %s | PIN: %s' % (profile, pin)
    return 'PIN: %s' % pin


def purchase_days(purchase, default_days=30):
    """Días de vigencia según fechas de la compra (30 o 60 según el plan)."""
    from datetime import datetime

    start = purchase.get('date_start')
    end = purchase.get('date_end')
    try:
        fmt = lambda s: datetime.fromisoformat(str(s).replace('Z', '+00:00'))
        delta = (fmt(end) - fmt(start)).days
        if delta >= 45:
            return 60
        if delta > 0:
            return 30
    except Exception:
        pass
    return default_days
