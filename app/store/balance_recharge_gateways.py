# Pasarelas de pago con aprobación automática (Stripe, Mercado Pago, Wompi).
#
# Patrón (igual que Binance Pay):
#   1. El usuario elige el medio y pulsa «Pagar ahora» → se crea una fila
#      BalanceRecharge en estado ``pending_gateway`` y una orden/checkout en la
#      pasarela; el usuario es redirigido al checkout externo.
#   2. La pasarela notifica por webhook (o el cliente vuelve con ?gw_ref=…) y el
#      servidor SIEMPRE re-verifica consultando la API de la pasarela con las
#      credenciales privadas antes de acreditar (nunca se confía en el payload).
#   3. ``try_gateway_payment_finalize`` acredita el saldo de forma idempotente.
#
# Marcas:
#   - stripe       → bucket USD (tarjetas internacionales, checkout Stripe)
#   - mercadopago  → bucket COP (PSE, tarjetas, dinero en cuenta MP)
#   - wompi        → bucket COP (QR Bancolombia dinámico, Nequi, PSE, tarjetas)

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
from decimal import Decimal
from typing import Any

import requests

logger = logging.getLogger(__name__)

_SECRET_MASK = '********'

GATEWAY_BRANDS: dict[str, dict[str, Any]] = {
    'stripe': {
        'label': 'Stripe',
        'bucket': 'USD',
        'linked_brands': ['stripe'],
    },
    'mercadopago': {
        'label': 'Mercado Pago',
        'bucket': 'COP',
        'linked_brands': ['mercadopago', 'mercado pago'],
    },
    'wompi': {
        'label': 'Wompi (QR Bancolombia)',
        'bucket': 'COP',
        'linked_brands': ['wompi', 'bancolombia'],
    },
}

GATEWAY_BRAND_KEYS = tuple(GATEWAY_BRANDS.keys())

# Campos secretos por marca (se enmascaran hacia el admin y se conservan al guardar).
_GATEWAY_SECRET_FIELDS = ('gateway_secret', 'gateway_secret2')
_GATEWAY_PLAIN_FIELDS = ('gateway_public_key',)

STRIPE_API_BASE = 'https://api.stripe.com'
MP_API_BASE = 'https://api.mercadopago.com'
WOMPI_PROD_API_BASE = 'https://production.wompi.co'
WOMPI_SANDBOX_API_BASE = 'https://sandbox.wompi.co'
WOMPI_CHECKOUT_URL = 'https://checkout.wompi.co/p/'

_HTTP_TIMEOUT = 45


def payment_method_gateway_brand(method: dict | None) -> str:
    if not method:
        return ''
    brand = str(method.get('payment_brand') or '').strip().lower()
    return brand if brand in GATEWAY_BRANDS else ''


def payment_method_is_gateway(method: dict | None) -> bool:
    return bool(payment_method_gateway_brand(method))


def gateway_bucket_for_brand(brand: str) -> str:
    spec = GATEWAY_BRANDS.get(str(brand or '').strip().lower()) or {}
    return str(spec.get('bucket') or 'COP')


def gateway_label_for_brand(brand: str) -> str:
    spec = GATEWAY_BRANDS.get(str(brand or '').strip().lower()) or {}
    return str(spec.get('label') or brand)


def _method_secret(method: dict | None, field: str) -> str:
    if not method:
        return ''
    return str(method.get(field) or '').strip()


def gateway_credentials_configured(method: dict | None) -> bool:
    brand = payment_method_gateway_brand(method)
    if not brand:
        return False
    secret = _method_secret(method, 'gateway_secret')
    if brand == 'stripe':
        return bool(secret)
    if brand == 'mercadopago':
        return bool(secret)
    if brand == 'wompi':
        return bool(
            secret
            and _method_secret(method, 'gateway_public_key')
            and _method_secret(method, 'gateway_secret2')
        )
    return False


def mask_gateway_secrets_for_admin(method: dict[str, Any]) -> dict[str, Any]:
    out = dict(method)
    if not payment_method_is_gateway(out):
        return out
    for field in _GATEWAY_SECRET_FIELDS:
        val = str(out.pop(field, '') or '').strip()
        out[f'{field}_configured'] = bool(val)
        out[field] = ''
    return out


def merge_gateway_secrets_on_save(
    ent: dict[str, Any],
    item: dict[str, Any],
    prev: dict[str, Any],
) -> None:
    """Conserva secretos previos si el admin dejó el campo vacío o enmascarado."""
    if not payment_method_is_gateway(ent):
        for field in _GATEWAY_SECRET_FIELDS + _GATEWAY_PLAIN_FIELDS:
            ent.pop(field, None)
        return
    pub = str(item.get('gateway_public_key') or ent.get('gateway_public_key') or '').strip()
    if pub:
        ent['gateway_public_key'] = pub[:128]
    elif prev.get('gateway_public_key'):
        ent['gateway_public_key'] = prev['gateway_public_key']
    for field in _GATEWAY_SECRET_FIELDS:
        new_val = str(item.get(field) or '').strip()
        if new_val and new_val != _SECRET_MASK:
            ent[field] = new_val[:256]
        elif prev.get(field):
            ent[field] = prev[field]


def make_gateway_reference(recharge_id: int) -> str:
    suffix = secrets.token_hex(4).upper()
    raw = f'GW{int(recharge_id)}{suffix}'
    return re.sub(r'[^A-Za-z0-9]', '', raw)[:32]


def proof_hash_for_gateway_order(reference: str) -> str:
    return hashlib.sha256(f'gateway:{reference}'.encode('utf-8')).hexdigest()


def amounts_match_claimed(claimed, paid, currency: str) -> bool:
    """Misma tolerancia que Binance Pay (0.01 USD / 1 COP)."""
    from app.store.balance_recharge_binance_pay import amounts_match_claimed as _match

    return _match(claimed, paid, currency)


# ---------------------------------------------------------------------------
# Crear checkout
# ---------------------------------------------------------------------------

def create_gateway_checkout(
    method: dict[str, Any],
    *,
    reference: str,
    amount: Decimal,
    currency: str,
    description: str,
    return_url: str,
    webhook_url: str,
) -> dict[str, Any]:
    """Crea la orden en la pasarela. Devuelve:

    ``{'ok': bool, 'checkout_url': str, 'provider_ref': str, 'error': str}``
    """
    brand = payment_method_gateway_brand(method)
    try:
        if brand == 'stripe':
            return _stripe_create_checkout(
                method,
                reference=reference,
                amount=amount,
                description=description,
                return_url=return_url,
            )
        if brand == 'mercadopago':
            return _mp_create_preference(
                method,
                reference=reference,
                amount=amount,
                description=description,
                return_url=return_url,
                webhook_url=webhook_url,
            )
        if brand == 'wompi':
            return _wompi_build_checkout(
                method,
                reference=reference,
                amount=amount,
                return_url=return_url,
            )
    except requests.RequestException as exc:
        logger.warning('Gateway %s: error de red al crear orden %s: %s', brand, reference, exc)
        return {'ok': False, 'checkout_url': '', 'provider_ref': '', 'error': 'network'}
    except Exception as exc:  # noqa: BLE001
        logger.exception('Gateway %s: fallo creando orden %s: %s', brand, reference, exc)
        return {'ok': False, 'checkout_url': '', 'provider_ref': '', 'error': 'internal'}
    return {'ok': False, 'checkout_url': '', 'provider_ref': '', 'error': 'unsupported'}


def _stripe_create_checkout(
    method: dict[str, Any],
    *,
    reference: str,
    amount: Decimal,
    description: str,
    return_url: str,
) -> dict[str, Any]:
    secret_key = _method_secret(method, 'gateway_secret')
    cents = int((Decimal(str(amount)) * 100).to_integral_value())
    if cents < 50:
        return {'ok': False, 'checkout_url': '', 'provider_ref': '', 'error': 'El monto mínimo con Stripe es 0.50 USD.'}
    sep = '&' if '?' in return_url else '?'
    success_url = f'{return_url}{sep}gw_ref={reference}'
    cancel_url = f'{return_url}{sep}gw_cancel={reference}'
    data = {
        'mode': 'payment',
        'client_reference_id': reference,
        'success_url': success_url,
        'cancel_url': cancel_url,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': str(cents),
        'line_items[0][price_data][product_data][name]': (description or 'Recarga de saldo')[:120],
        'metadata[reference]': reference,
    }
    resp = requests.post(
        f'{STRIPE_API_BASE}/v1/checkout/sessions',
        auth=(secret_key, ''),
        data=data,
        timeout=_HTTP_TIMEOUT,
    )
    payload = _safe_json(resp)
    if resp.status_code >= 400 or not payload.get('url'):
        err = ((payload.get('error') or {}).get('message') or '')[:200]
        logger.warning('Stripe checkout falló (%s): %s', resp.status_code, err)
        return {'ok': False, 'checkout_url': '', 'provider_ref': '', 'error': 'rejected'}
    return {
        'ok': True,
        'checkout_url': str(payload.get('url') or ''),
        'provider_ref': str(payload.get('id') or ''),
        'error': '',
    }


def _mp_create_preference(
    method: dict[str, Any],
    *,
    reference: str,
    amount: Decimal,
    description: str,
    return_url: str,
    webhook_url: str,
) -> dict[str, Any]:
    access_token = _method_secret(method, 'gateway_secret')
    sep = '&' if '?' in return_url else '?'
    back_url = f'{return_url}{sep}gw_ref={reference}'
    body = {
        'items': [
            {
                'title': (description or 'Recarga de saldo')[:120],
                'quantity': 1,
                'currency_id': 'COP',
                'unit_price': float(Decimal(str(amount))),
            }
        ],
        'external_reference': reference,
        'auto_return': 'approved',
        'back_urls': {'success': back_url, 'failure': back_url, 'pending': back_url},
        'statement_descriptor': 'Recarga saldo',
    }
    if webhook_url:
        body['notification_url'] = webhook_url[:500]
    resp = requests.post(
        f'{MP_API_BASE}/checkout/preferences',
        headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        },
        data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
        timeout=_HTTP_TIMEOUT,
    )
    payload = _safe_json(resp)
    init_point = str(payload.get('init_point') or payload.get('sandbox_init_point') or '')
    if resp.status_code >= 400 or not init_point:
        logger.warning(
            'Mercado Pago preferencia falló (%s): %s',
            resp.status_code,
            str(payload.get('message') or '')[:200],
        )
        return {'ok': False, 'checkout_url': '', 'provider_ref': '', 'error': 'rejected'}
    return {
        'ok': True,
        'checkout_url': init_point,
        'provider_ref': str(payload.get('id') or ''),
        'error': '',
    }


def _wompi_api_base(method: dict[str, Any]) -> str:
    pub = _method_secret(method, 'gateway_public_key')
    if pub.startswith('pub_test'):
        return WOMPI_SANDBOX_API_BASE
    return WOMPI_PROD_API_BASE


def _wompi_build_checkout(
    method: dict[str, Any],
    *,
    reference: str,
    amount: Decimal,
    return_url: str,
) -> dict[str, Any]:
    """Wompi usa Web Checkout: URL firmada, sin llamada previa a la API."""
    from urllib.parse import urlencode

    pub = _method_secret(method, 'gateway_public_key')
    integrity = _method_secret(method, 'gateway_secret2')
    cents = int((Decimal(str(amount)) * 100).to_integral_value())
    if cents < 150000:  # 1.500 COP: mínimo práctico de Wompi
        return {'ok': False, 'checkout_url': '', 'provider_ref': '', 'error': 'El monto mínimo con Wompi es 1.500 COP.'}
    signature = hashlib.sha256(
        f'{reference}{cents}COP{integrity}'.encode('utf-8')
    ).hexdigest()
    sep = '&' if '?' in return_url else '?'
    redirect_url = f'{return_url}{sep}gw_ref={reference}'
    params = {
        'public-key': pub,
        'currency': 'COP',
        'amount-in-cents': str(cents),
        'reference': reference,
        'signature:integrity': signature,
        'redirect-url': redirect_url,
    }
    return {
        'ok': True,
        'checkout_url': f'{WOMPI_CHECKOUT_URL}?{urlencode(params)}',
        'provider_ref': '',
        'error': '',
    }


# ---------------------------------------------------------------------------
# Verificación server-side (webhook y polling): SIEMPRE consulta la API.
# ---------------------------------------------------------------------------

def fetch_gateway_payment(
    method: dict[str, Any],
    *,
    reference: str,
    provider_ref: str = '',
) -> dict[str, Any]:
    """Consulta el estado real del pago en la pasarela.

    Devuelve ``{'found': bool, 'paid': bool, 'amount': float|None,
    'currency': str, 'transaction_id': str}``.
    """
    brand = payment_method_gateway_brand(method)
    out = {'found': False, 'paid': False, 'amount': None, 'currency': '', 'transaction_id': ''}
    try:
        if brand == 'stripe':
            return _stripe_fetch_session(method, provider_ref=provider_ref)
        if brand == 'mercadopago':
            return _mp_fetch_by_reference(method, reference=reference)
        if brand == 'wompi':
            return _wompi_fetch_by_reference(method, reference=reference)
    except requests.RequestException as exc:
        logger.warning('Gateway %s: error de red consultando %s: %s', brand, reference, exc)
    except Exception as exc:  # noqa: BLE001
        logger.exception('Gateway %s: fallo consultando %s: %s', brand, reference, exc)
    return out


def _stripe_fetch_session(method: dict[str, Any], *, provider_ref: str) -> dict[str, Any]:
    out = {'found': False, 'paid': False, 'amount': None, 'currency': 'USD', 'transaction_id': ''}
    session_id = str(provider_ref or '').strip()
    if not session_id:
        return out
    secret_key = _method_secret(method, 'gateway_secret')
    resp = requests.get(
        f'{STRIPE_API_BASE}/v1/checkout/sessions/{session_id}',
        auth=(secret_key, ''),
        timeout=_HTTP_TIMEOUT,
    )
    payload = _safe_json(resp)
    if resp.status_code >= 400 or not payload.get('id'):
        return out
    out['found'] = True
    out['paid'] = str(payload.get('payment_status') or '').lower() == 'paid'
    amount_total = payload.get('amount_total')
    if amount_total is not None:
        out['amount'] = float(amount_total) / 100.0
    out['currency'] = str(payload.get('currency') or 'usd').upper()
    out['transaction_id'] = str(payload.get('payment_intent') or payload.get('id') or '')
    return out


def mp_fetch_payment_by_id(access_token: str, payment_id: str) -> dict[str, Any]:
    """Consulta un pago MP por id (para resolver external_reference en el webhook)."""
    pid = re.sub(r'[^0-9]', '', str(payment_id or ''))
    if not pid or not access_token:
        return {}
    resp = requests.get(
        f'{MP_API_BASE}/v1/payments/{pid}',
        headers={'Authorization': f'Bearer {access_token}'},
        timeout=_HTTP_TIMEOUT,
    )
    payload = _safe_json(resp)
    if resp.status_code >= 400 or not payload.get('id'):
        return {}
    return payload


def _mp_fetch_by_reference(method: dict[str, Any], *, reference: str) -> dict[str, Any]:
    out = {'found': False, 'paid': False, 'amount': None, 'currency': 'COP', 'transaction_id': ''}
    access_token = _method_secret(method, 'gateway_secret')
    resp = requests.get(
        f'{MP_API_BASE}/v1/payments/search',
        params={'external_reference': reference, 'sort': 'date_created', 'criteria': 'desc'},
        headers={'Authorization': f'Bearer {access_token}'},
        timeout=_HTTP_TIMEOUT,
    )
    payload = _safe_json(resp)
    results = payload.get('results') if isinstance(payload.get('results'), list) else []
    if resp.status_code >= 400:
        return out
    for pay in results:
        if not isinstance(pay, dict):
            continue
        out['found'] = True
        status = str(pay.get('status') or '').lower()
        if status == 'approved':
            out['paid'] = True
            amt = pay.get('transaction_amount')
            if amt is not None:
                out['amount'] = float(amt)
            out['currency'] = str(pay.get('currency_id') or 'COP').upper()
            out['transaction_id'] = str(pay.get('id') or '')
            return out
    return out


def _wompi_fetch_by_reference(method: dict[str, Any], *, reference: str) -> dict[str, Any]:
    out = {'found': False, 'paid': False, 'amount': None, 'currency': 'COP', 'transaction_id': ''}
    private_key = _method_secret(method, 'gateway_secret')
    base = _wompi_api_base(method)
    resp = requests.get(
        f'{base}/v1/transactions',
        params={'reference': reference},
        headers={'Authorization': f'Bearer {private_key}'},
        timeout=_HTTP_TIMEOUT,
    )
    payload = _safe_json(resp)
    data = payload.get('data')
    if resp.status_code >= 400 or not isinstance(data, list):
        return out
    for tx in data:
        if not isinstance(tx, dict):
            continue
        out['found'] = True
        status = str(tx.get('status') or '').upper()
        if status == 'APPROVED':
            out['paid'] = True
            cents = tx.get('amount_in_cents')
            if cents is not None:
                out['amount'] = float(cents) / 100.0
            out['currency'] = str(tx.get('currency') or 'COP').upper()
            out['transaction_id'] = str(tx.get('id') or '')
            return out
    return out


# ---------------------------------------------------------------------------
# Helpers webhook (extraer referencias del payload; la verificación real es
# siempre re-consultar la API con fetch_gateway_payment).
# ---------------------------------------------------------------------------

def stripe_reference_from_webhook(raw_body: str) -> tuple[str, str]:
    """Devuelve (reference, session_id) de un evento checkout.session.*."""
    try:
        event = json.loads(raw_body)
    except (TypeError, ValueError):
        return '', ''
    if not isinstance(event, dict):
        return '', ''
    etype = str(event.get('type') or '')
    if not etype.startswith('checkout.session.'):
        return '', ''
    obj = ((event.get('data') or {}).get('object')) or {}
    if not isinstance(obj, dict):
        return '', ''
    return (
        str(obj.get('client_reference_id') or '').strip(),
        str(obj.get('id') or '').strip(),
    )


def mp_payment_id_from_webhook(args: dict[str, Any], raw_body: str) -> str:
    pid = str(args.get('data.id') or args.get('id') or '').strip()
    topic = str(args.get('topic') or args.get('type') or '').strip().lower()
    if pid and topic in ('payment', ''):
        return pid
    try:
        body = json.loads(raw_body) if raw_body else {}
    except (TypeError, ValueError):
        body = {}
    if isinstance(body, dict):
        btype = str(body.get('type') or body.get('topic') or '').lower()
        data = body.get('data') or {}
        if btype == 'payment' and isinstance(data, dict):
            return str(data.get('id') or '').strip()
    return pid


def wompi_reference_from_webhook(raw_body: str) -> str:
    try:
        event = json.loads(raw_body)
    except (TypeError, ValueError):
        return ''
    if not isinstance(event, dict):
        return ''
    tx = ((event.get('data') or {}).get('transaction')) or {}
    if not isinstance(tx, dict):
        return ''
    return str(tx.get('reference') or '').strip()


def build_gateway_order_snapshot(
    *,
    reference: str,
    brand: str,
    payment_method_id: str,
    payment_method_label: str,
    amount: float,
    currency: str,
    checkout_url: str,
    provider_ref: str,
) -> dict[str, Any]:
    return {
        'gateway_order': True,
        'gateway_brand': brand,
        'reference': reference,
        'payment_method_id': payment_method_id,
        'payment_method_label': payment_method_label,
        'amount_claimed': amount,
        'currency': currency,
        'checkout_url': checkout_url,
        'provider_ref': provider_ref,
    }


def gateway_snapshot_from_row(row) -> dict[str, Any]:
    try:
        data = json.loads(getattr(row, 'analyzer_json', None) or '{}')
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _safe_json(resp: requests.Response) -> dict[str, Any]:
    try:
        payload = resp.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}
