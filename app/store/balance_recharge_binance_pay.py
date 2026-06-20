# Integración Binance Pay Merchant (crear orden + webhook PAY_SUCCESS).

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import string
import time
from decimal import Decimal, InvalidOperation
from typing import Any

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

logger = logging.getLogger(__name__)

BINANCE_PAY_API_BASE = 'https://bpay.binanceapi.com'
CREATE_ORDER_PATH = '/binancepay/openapi/v3/order'
QUERY_ORDER_PATH = '/binancepay/openapi/v2/order/query'
CERTIFICATES_PATH = '/binancepay/openapi/certificates'

_CERT_CACHE: dict[str, tuple[float, dict[str, str]]] = {}
_CERT_CACHE_TTL_SEC = 3600

_SECRET_MASK = '********'


def _random_nonce(length: int = 32) -> str:
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def payment_method_is_binance_pay(method: dict | None) -> bool:
    if not method:
        return False
    return str(method.get('payment_brand') or '').strip().lower() == 'binance_pay'


def payment_method_binance_pay_api_key(method: dict | None) -> str:
    if not method:
        return ''
    return str(method.get('binance_pay_api_key') or '').strip()


def payment_method_binance_pay_secret(method: dict | None) -> str:
    if not method:
        return ''
    return str(method.get('binance_pay_secret') or '').strip()


def binance_pay_credentials_configured(method: dict | None) -> bool:
    return bool(
        payment_method_binance_pay_api_key(method)
        and payment_method_binance_pay_secret(method)
    )


def mask_binance_pay_secret_for_admin(method: dict[str, Any]) -> dict[str, Any]:
    out = dict(method)
    secret = str(out.pop('binance_pay_secret', '') or '').strip()
    out['binance_pay_secret_configured'] = bool(secret)
    out['binance_pay_secret'] = ''
    return out


def merge_binance_pay_secret_on_save(
    ent: dict[str, Any],
    item: dict[str, Any],
    prev: dict[str, Any],
) -> None:
    if not payment_method_is_binance_pay(ent):
        ent.pop('binance_pay_api_key', None)
        ent.pop('binance_pay_secret', None)
        return
    key = str(item.get('binance_pay_api_key') or ent.get('binance_pay_api_key') or '').strip()
    if key:
        ent['binance_pay_api_key'] = key[:128]
    elif prev.get('binance_pay_api_key'):
        ent['binance_pay_api_key'] = prev['binance_pay_api_key']
    new_secret = str(item.get('binance_pay_secret') or '').strip()
    if new_secret and new_secret != _SECRET_MASK:
        ent['binance_pay_secret'] = new_secret[:256]
    elif prev.get('binance_pay_secret'):
        ent['binance_pay_secret'] = prev['binance_pay_secret']


def make_merchant_trade_no(recharge_id: int) -> str:
    suffix = secrets.token_hex(4).upper()
    raw = f'BR{int(recharge_id)}{suffix}'
    return re.sub(r'[^A-Za-z0-9]', '', raw)[:32]


def proof_hash_for_binance_pay_order(merchant_trade_no: str) -> str:
    return hashlib.sha256(f'binance_pay:{merchant_trade_no}'.encode('utf-8')).hexdigest()


def friendly_binance_pay_error_message(raw: str) -> str:
    """Mensaje breve para el cliente; sin detalle técnico de Binance."""
    return 'Binance Pay no disponible'


def _hmac_sha512_hex_upper(payload: str, secret: str) -> str:
    digest = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha512,
    ).hexdigest()
    return digest.upper()


def _build_signed_headers(api_key: str, secret: str, body: str) -> dict[str, str]:
    timestamp = str(int(time.time() * 1000))
    nonce = _random_nonce(32)
    payload = f'{timestamp}\n{nonce}\n{body}\n'
    signature = _hmac_sha512_hex_upper(payload, secret)
    return {
        'content-type': 'application/json',
        'BinancePay-Timestamp': timestamp,
        'BinancePay-Nonce': nonce,
        'BinancePay-Certificate-SN': api_key,
        'BinancePay-Signature': signature,
    }


def _normalize_public_key_pem(cert_public: str) -> str:
    raw = str(cert_public or '').strip()
    if not raw:
        return ''
    if 'BEGIN PUBLIC KEY' in raw:
        return raw
    compact = re.sub(r'\s+', '', raw)
    lines = [compact[i:i + 64] for i in range(0, len(compact), 64)]
    return '-----BEGIN PUBLIC KEY-----\n' + '\n'.join(lines) + '\n-----END PUBLIC KEY-----\n'


def _fetch_certificates(api_key: str, secret: str) -> dict[str, str]:
    cache_key = api_key
    now = time.time()
    cached = _CERT_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _CERT_CACHE_TTL_SEC:
        return cached[1]

    body = '{}'
    headers = _build_signed_headers(api_key, secret, body)
    url = f'{BINANCE_PAY_API_BASE}{CERTIFICATES_PATH}'
    resp = requests.post(url, data=body, headers=headers, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    certs: dict[str, str] = {}
    for item in payload.get('data') or []:
        serial = str(item.get('certSerial') or '').strip()
        pub = str(item.get('certPublic') or '').strip()
        if serial and pub:
            certs[serial] = pub
    _CERT_CACHE[cache_key] = (now, certs)
    return certs


def verify_webhook_signature(
    *,
    api_key: str,
    secret: str,
    timestamp: str,
    nonce: str,
    signature_b64: str,
    raw_body: str,
) -> bool:
    if not all((api_key, secret, timestamp, nonce, signature_b64, raw_body)):
        return False
    payload = f'{timestamp}\n{nonce}\n{raw_body}\n'
    try:
        cert_sn = ''
        # Header BinancePay-Certificate-SN on webhook is cert hash; fetch all certs.
        certs = _fetch_certificates(api_key, secret)
        if not certs:
            return False
        sig_bytes = base64.b64decode(signature_b64)
        for pub in certs.values():
            pem = _normalize_public_key_pem(pub)
            if not pem:
                continue
            try:
                key = serialization.load_pem_public_key(pem.encode('utf-8'))
                key.verify(
                    sig_bytes,
                    payload.encode('utf-8'),
                    padding.PKCS1v15(),
                    hashes.SHA256(),
                )
                return True
            except Exception:
                continue
    except Exception as exc:
        logger.warning('Binance Pay webhook signature verify failed: %s', exc)
    return False


def query_binance_pay_order(
    *,
    api_key: str,
    secret: str,
    merchant_trade_no: str,
) -> dict[str, Any]:
    trade_no = re.sub(r'[^A-Za-z0-9]', '', str(merchant_trade_no or ''))[:32]
    if not trade_no:
        raise ValueError('Orden inválida')
    body_obj: dict[str, Any] = {'merchantTradeNo': trade_no}
    body = json.dumps(body_obj, separators=(',', ':'), ensure_ascii=False)
    headers = _build_signed_headers(api_key, secret, body)
    url = f'{BINANCE_PAY_API_BASE}{QUERY_ORDER_PATH}'
    resp = requests.post(url, data=body.encode('utf-8'), headers=headers, timeout=45)
    try:
        payload = resp.json()
    except ValueError:
        payload = {'status': 'FAIL', 'errorMessage': resp.text[:500]}
    if resp.status_code >= 400:
        payload.setdefault('status', 'FAIL')
        payload.setdefault('http_status', resp.status_code)
    return payload


def binance_pay_order_status_from_query(payload: dict[str, Any]) -> str:
    if not isinstance(payload, dict):
        return ''
    data = payload.get('data')
    if isinstance(data, dict):
        return str(data.get('status') or '').strip().upper()
    return ''


def create_binance_pay_order(
    *,
    api_key: str,
    secret: str,
    merchant_trade_no: str,
    amount: Decimal,
    currency: str,
    description: str,
    webhook_url: str,
) -> dict[str, Any]:
    cur = (currency or 'USDT').strip().upper()
    if cur == 'USD':
        cur = 'USDT'
    amt = Decimal(str(amount)).quantize(Decimal('0.00000001'))
    if amt <= 0:
        raise ValueError('Monto inválido')

    body_obj: dict[str, Any] = {
        'env': {'terminalType': 'WEB'},
        'merchantTradeNo': merchant_trade_no,
        'orderAmount': float(amt),
        'currency': cur,
        'description': (description or 'Recarga de saldo')[:256],
        'goodsDetails': [
            {
                'goodsType': '02',
                'goodsCategory': 'Z000',
                'referenceGoodsId': merchant_trade_no[:32],
                'goodsName': 'Recarga saldo',
                'goodsDetail': (description or 'Recarga de saldo')[:256],
            }
        ],
    }
    if webhook_url:
        body_obj['webhookUrl'] = webhook_url[:256]

    body = json.dumps(body_obj, separators=(',', ':'), ensure_ascii=False)
    headers = _build_signed_headers(api_key, secret, body)
    url = f'{BINANCE_PAY_API_BASE}{CREATE_ORDER_PATH}'
    resp = requests.post(url, data=body.encode('utf-8'), headers=headers, timeout=45)
    try:
        payload = resp.json()
    except ValueError:
        payload = {'status': 'FAIL', 'errorMessage': resp.text[:500]}
    if resp.status_code >= 400:
        payload.setdefault('status', 'FAIL')
        payload.setdefault('http_status', resp.status_code)
    return payload


def parse_webhook_notification(raw_body: str) -> dict[str, Any] | None:
    try:
        outer = json.loads(raw_body)
    except (TypeError, ValueError):
        return None
    if not isinstance(outer, dict):
        return None
    data_raw = outer.get('data')
    inner: dict[str, Any] = {}
    if isinstance(data_raw, str) and data_raw.strip():
        try:
            inner = json.loads(data_raw)
        except ValueError:
            inner = {}
    elif isinstance(data_raw, dict):
        inner = data_raw
    return {
        'biz_type': str(outer.get('bizType') or ''),
        'biz_status': str(outer.get('bizStatus') or ''),
        'biz_id': str(outer.get('bizIdStr') or outer.get('bizId') or ''),
        'merchant_trade_no': str(inner.get('merchantTradeNo') or '').strip(),
        'total_fee': inner.get('totalFee'),
        'currency': str(inner.get('currency') or '').strip().upper(),
        'transaction_id': str(inner.get('transactionId') or '').strip(),
        'raw_inner': inner,
        'raw_outer': outer,
    }


def amounts_match_claimed(claimed: Decimal | float, paid: Any, currency: str) -> bool:
    try:
        paid_dec = Decimal(str(paid))
        claimed_dec = Decimal(str(claimed))
    except (InvalidOperation, TypeError, ValueError):
        return False
    if paid_dec <= 0 or claimed_dec <= 0:
        return False
    if abs(paid_dec - claimed_dec) <= Decimal('0.00000001'):
        return True
    if (currency or '').upper() in ('USD', 'USDT'):
        return abs(paid_dec - claimed_dec) <= Decimal('0.01')
    return abs(paid_dec - claimed_dec) <= Decimal('1')


def build_order_analyzer_snapshot(
    *,
    merchant_trade_no: str,
    payment_method_id: str,
    payment_method_label: str,
    amount: float,
    currency: str,
    order_response: dict[str, Any],
) -> dict[str, Any]:
    data = order_response.get('data') if isinstance(order_response.get('data'), dict) else {}
    return {
        'binance_pay_order': True,
        'merchant_trade_no': merchant_trade_no,
        'payment_method_id': payment_method_id,
        'payment_method_label': payment_method_label,
        'amount_claimed': amount,
        'currency': currency,
        'prepay_id': str(data.get('prepayId') or ''),
        'checkout_url': str(data.get('checkoutUrl') or ''),
        'qrcode_link': str(data.get('qrcodeLink') or ''),
        'qr_content': str(data.get('qrContent') or ''),
        'deeplink': str(data.get('deeplink') or ''),
        'universal_url': str(data.get('universalUrl') or ''),
        'expire_time': data.get('expireTime'),
        'payment_brand': 'binance_pay',
    }
