# Medios de pago para recargas de saldo (COP / USDT-USD) y restricciones por usuario.

import base64
import json
import logging
import os
import re
import uuid
from typing import Any, Dict, List, Optional

from app.store.models import StoreSetting

logger = logging.getLogger(__name__)

SETTINGS_KEY = 'balance_recharge_payment_methods'
QR_UPLOAD_SUBDIR = ('uploads', 'payment_method_qr')
_MAX_QR_BYTES = 4 * 1024 * 1024

_METHOD_BUCKETS = ('COP', 'USD', 'ACCUM')
_USER_CURRENCIES = ('COP', 'USD')

# Medios reconocibles en comprobantes (admin: selector «Medio»).
PAYMENT_BRAND_SPEC: Dict[str, Dict[str, Any]] = {
    'nequi': {'label': 'Nequi', 'linked_brands': ['nequi']},
    'bancolombia': {'label': 'Bancolombia', 'linked_brands': ['bancolombia']},
    'daviplata': {'label': 'DaviPlata', 'linked_brands': ['daviplata']},
    'breve': {'label': 'Bre-B', 'linked_brands': ['breve']},
    'breb_bancolombia': {
        'label': 'Bre-B Bancolombia',
        'linked_brands': ['bre-b', 'breve', 'bancolombia', 'kamin'],
    },
    'breb_nequi': {
        'label': 'Bre-B Nequi',
        'linked_brands': ['bre-b', 'breve', 'nequi'],
    },
    'paypal': {'label': 'PayPal', 'linked_brands': ['paypal']},
    'usdt': {'label': 'USDT', 'linked_brands': ['usdt']},
    'usdt_erc20': {
        'label': 'USDT ERC20',
        'linked_brands': ['usdt', 'erc20', 'ethereum'],
    },
    'usdt_trc20': {
        'label': 'USDT TRC20',
        'linked_brands': ['usdt', 'trc20', 'tron', 'trx'],
    },
    'binance_pay': {
        'label': 'Binance Pay',
        'linked_brands': ['binance_pay', 'binance pay'],
    },
    'binance': {'label': 'Binance', 'linked_brands': ['binance']},
    'criptomoneda': {'label': 'Criptomoneda', 'linked_brands': []},
    'generico': {
        'label': 'Genérico',
        'linked_brands': [],
        'accept_any_transfer': True,
    },
}


def is_generic_payment_brand(brand: str) -> bool:
    return (brand or '').strip().lower() == 'generico'


def payment_method_is_binance_pay(method: Dict[str, Any] | None) -> bool:
    if not method:
        return False
    return str(method.get('payment_brand') or '').strip().lower() == 'binance_pay'


def payment_method_is_usdt_wallet(method: Dict[str, Any] | None) -> bool:
    if not method:
        return False
    return str(method.get('payment_brand') or '').strip().lower() in ('usdt_erc20', 'usdt_trc20')


def _normalize_crypto_wallet(value: str, brand: str = '') -> str:
    raw = str(value or '').strip()
    brand_key = str(brand or '').strip().lower()
    if brand_key == 'usdt_erc20':
        return raw.lower()[:64]
    if brand_key == 'usdt_trc20':
        return raw[:64]
    if raw.lower().startswith('0x'):
        return raw.lower()[:64]
    if raw.startswith('T'):
        return raw[:64]
    return raw[:64]


def _erc20_wallet_is_valid(value: str) -> bool:
    wallet = str(value or '').strip().lower()
    return bool(re.fullmatch(r'0x[a-f0-9]{40}', wallet))


def _trc20_wallet_is_valid(value: str) -> bool:
    wallet = str(value or '').strip()
    return bool(re.fullmatch(r'T[1-9A-HJ-NP-Za-km-z]{33}', wallet))


def _crypto_wallet_is_valid(value: str, brand: str) -> bool:
    brand_key = str(brand or '').strip().lower()
    if brand_key == 'usdt_erc20':
        return _erc20_wallet_is_valid(value)
    if brand_key == 'usdt_trc20':
        return _trc20_wallet_is_valid(value)
    return False


def _infer_crypto_brand_from_wallet(wallet: str) -> str:
    """Detecta ERC20/TRC20 por formato de dirección (0x… / T…)."""
    raw = str(wallet or '').strip()
    if not raw:
        return ''
    if _erc20_wallet_is_valid(_normalize_crypto_wallet(raw, 'usdt_erc20')):
        return 'usdt_erc20'
    if _trc20_wallet_is_valid(_normalize_crypto_wallet(raw, 'usdt_trc20')):
        return 'usdt_trc20'
    low = raw.lower()
    if low.startswith('0x') and len(low) >= 10:
        return 'usdt_erc20'
    if raw.startswith('T') and len(raw) >= 10:
        return 'usdt_trc20'
    return ''


def _resolve_crypto_payment_brand(
    raw: Dict[str, Any],
    label: str,
    method_id: str,
) -> str:
    """Marca USDT ERC20/TRC20 aunque el admin aún tenga «usdt»/«binance» legacy."""
    brand = _resolve_payment_brand(raw, label, method_id)
    if brand in ('usdt_erc20', 'usdt_trc20'):
        return brand
    wallet = str(raw.get('account_number') or '').strip()
    inferred = _infer_crypto_brand_from_wallet(wallet)
    if not inferred:
        return brand
    if brand in ('', 'usdt', 'binance', 'criptomoneda', 'binance_pay'):
        return inferred
    if brand == 'usdt_erc20' and inferred == 'usdt_trc20':
        return inferred
    if brand == 'usdt_trc20' and inferred == 'usdt_erc20':
        return inferred
    return brand


def _crypto_wallet_tail(ent: Dict[str, Any]) -> str:
    brand = str(ent.get('payment_brand') or '').strip().lower()
    wallet = _normalize_crypto_wallet(str(ent.get('account_number') or ''), brand)
    if not wallet:
        return ''
    slug = re.sub(r'[^a-z0-9]', '', wallet.lower())
    if len(slug) < 6:
        return slug
    return slug[-10:]


def payment_method_is_generic(
    payment_method: dict | None = None,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> bool:
    """Medio genérico: no exige coincidencia de banco/app en el comprobante."""
    if payment_method and is_generic_payment_brand(str(payment_method.get('payment_brand') or '')):
        return True
    combined = _normalize_text_for_brand_match(f'{payment_method_id} {payment_method_label}')
    if not combined:
        return False
    return 'generico' in combined.split() or 'generica' in combined.split()


def payment_method_brand_configured(method: dict | None) -> bool:
    """True si el admin eligió un Medio (Binance, Nequi, …) o marcó explícitamente Genérico."""
    if not method:
        return False
    if str(method.get('currency') or '').upper() == 'ACCUM':
        pb = str(method.get('payment_brand') or '').strip().lower()
        if pb:
            return True
        linked = method.get('linked_brands') or []
        return bool(linked)
    pb = str(method.get('payment_brand') or '').strip().lower()
    if pb:
        return True
    return payment_method_is_generic(method)


def payment_brand_choices() -> List[Dict[str, str]]:
    return [
        {'value': key, 'label': str(spec.get('label') or key)}
        for key, spec in PAYMENT_BRAND_SPEC.items()
    ]


def _default_label_for_brand(brand: str, currency: str) -> str:
    spec = PAYMENT_BRAND_SPEC.get(brand) or {}
    base = str(spec.get('label') or brand).strip()
    if not base:
        return ''
    if (currency or '').upper() == 'ACCUM':
        low = base.lower()
        if low.startswith('acumulador '):
            return base[:80]
        return f'Acumulador {base}'[:80]
    return base[:80]


def _linked_brands_from_brand(brand: str) -> List[str]:
    spec = PAYMENT_BRAND_SPEC.get(brand) or {}
    out: List[str] = []
    for item in spec.get('linked_brands') or []:
        b = str(item or '').strip().lower()
        if b and b not in out:
            out.append(b)
    return out


def _infer_payment_brand(label: str, method_id: str, linked: Optional[List[str]] = None) -> str:
    if linked:
        for b in linked:
            bl = str(b or '').strip().lower()
            if bl in PAYMENT_BRAND_SPEC:
                return bl
    combined = _normalize_text_for_brand_match(f'{method_id} {label}')
    if not combined:
        return ''
    if 'generico' in combined or 'generica' in combined:
        return 'generico'
    if ('bre-b' in combined or 'bre b' in combined) and 'bancolombia' in combined:
        return 'breb_bancolombia'
    if ('bre-b' in combined or 'bre b' in combined) and 'nequi' in combined:
        return 'breb_nequi'
    if 'binance pay' in combined or 'binancepay' in combined.replace(' ', ''):
        return 'binance_pay'
    if 'erc20' in combined or ('usdt' in combined and 'ethereum' in combined):
        return 'usdt_erc20'
    if 'trc20' in combined or ('usdt' in combined and 'tron' in combined):
        return 'usdt_trc20'
    for key, spec in PAYMENT_BRAND_SPEC.items():
        if key in ('criptomoneda', 'generico'):
            if key == 'criptomoneda' and (
                'criptomoneda' in combined or 'crypto' in combined
            ):
                return key
            continue
        name = str(spec.get('label') or key).lower()
        if key == 'binance' and (
            'binance pay' in combined or 'binancepay' in combined.replace(' ', '')
        ):
            continue
        if key in combined or _normalize_text_for_brand_match(name) in combined:
            return key
        if key == 'breb_bancolombia' and (
            ('bre-b' in combined or 'bre b' in combined) and 'bancolombia' in combined
        ):
            return key
        if key == 'breb_nequi' and (
            ('bre-b' in combined or 'bre b' in combined) and 'nequi' in combined
        ):
            return key
        if key == 'breve' and ('bre-b' in combined or 'bre b' in combined):
            return key
    return ''


def payment_method_is_breb_nequi(method: Dict[str, Any] | None) -> bool:
    if not method:
        return False
    brand = str(method.get('payment_brand') or '').strip().lower()
    if brand == 'breb_nequi':
        return True
    combined = _normalize_text_for_brand_match(
        f"{method.get('id') or ''} {method.get('label') or ''}"
    )
    if ('bre-b' in combined or 'bre b' in combined) and 'nequi' in combined:
        return True
    if brand == 'breve':
        linked = [str(x).lower() for x in (method.get('linked_brands') or [])]
        label = _normalize_text_for_brand_match(str(method.get('label') or ''))
        mid = str(method.get('id') or '').lower()
        return 'nequi' in linked or 'nequi' in label or 'nequi' in mid
    return False


def payment_method_is_breb_bancolombia(method: Dict[str, Any] | None) -> bool:
    if not method:
        return False
    if payment_method_is_breb_nequi(method):
        return False
    brand = str(method.get('payment_brand') or '').strip().lower()
    if brand == 'breb_bancolombia':
        return True
    combined = _normalize_text_for_brand_match(
        f"{method.get('id') or ''} {method.get('label') or ''}"
    )
    if ('bre-b' in combined or 'bre b' in combined) and 'bancolombia' in combined:
        return True
    if brand == 'breve':
        linked = [str(x).lower() for x in (method.get('linked_brands') or [])]
        mid = str(method.get('id') or '').lower()
        label = _normalize_text_for_brand_match(str(method.get('label') or ''))
        return 'bancolombia' in linked or 'bancolombia' in label or 'bancolombia' in mid
    return False


def payment_method_uses_breb_llave(method: Dict[str, Any] | None) -> bool:
    return payment_method_is_breb_bancolombia(method) or payment_method_is_breb_nequi(method)


def payment_method_breb_llave_stored(method: Dict[str, Any] | None) -> str:
    """Llave Bre-B tal como la configuró el admin (puede llevar @, ser numérica, etc.)."""
    if not method:
        return ''
    return str(method.get('bre_b_llave') or '').strip()[:32]


def payment_method_breb_llave_normalized(method: Dict[str, Any] | None) -> str:
    """Llave Bre-B para comparar con OCR (solo letras/números, mayúsculas)."""
    if not method:
        return ''
    raw = payment_method_breb_llave_stored(method)
    if not raw:
        acct = str(method.get('account_number') or '').strip()
        if acct:
            raw = acct
    if not raw:
        skip_tokens = {'nequi', 'bancolombia', 'daviplata', 'breb', 'breve', 'bogota'}
        for field in ('description', 'label'):
            for m in re.finditer(r'@?([A-Za-z0-9]{4,32})', str(method.get(field) or '')):
                token = re.sub(r'[^A-Za-z0-9]', '', m.group(1)).lower()
                if token and token not in skip_tokens:
                    raw = m.group(1)
                    break
            if raw:
                break
    if not raw:
        return ''
    return re.sub(r'[^A-Za-z0-9]', '', raw).upper()


def payment_method_breb_llave_display(method: Dict[str, Any] | None) -> str:
    """Texto visible al usuario; no se antepone @ si no estaba en la configuración."""
    return payment_method_breb_llave_stored(method)


def breb_llave_matches_expected(expected: str, detected: list[str]) -> bool:
    """
    True solo si la llave del comprobante coincide exactamente con la del medio.
    Variantes por prefijo (ej. GUSTAVOP8514 vs GUSTAVOP8514SS) se tratan como distintas.
    """
    exp = re.sub(r'[^A-Za-z0-9]', '', str(expected or '')).upper()
    if not exp:
        return False
    dets: list[str] = []
    for raw in detected or []:
        d = re.sub(r'[^A-Za-z0-9]', '', str(raw or '')).upper()
        if d and d not in dets:
            dets.append(d)
    if not dets:
        return False
    if exp in dets:
        return True
    for det in dets:
        if det.startswith(exp) or exp.startswith(det):
            return False
    return False


def payment_method_breb_account_suffix(method: Dict[str, Any] | None) -> str:
    """Últimos 4 dígitos de la cuenta Bancolombia asociada a la llave (ej. 1948 en *1948)."""
    if not method:
        return ''
    suffix = _digits_only(str(method.get('bre_b_account_suffix') or ''))
    if len(suffix) >= 4:
        return suffix[-4:]
    acct = _digits_only(str(method.get('account_number') or ''))
    if len(acct) == 4:
        return acct
    if len(acct) > 4:
        return acct[-4:]
    return ''


def _normalize_text_for_brand_match(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()


def _resolve_payment_brand(raw: Dict[str, Any], label: str, method_id: str) -> str:
    pb = str(raw.get('payment_brand') or '').strip().lower()
    if pb in PAYMENT_BRAND_SPEC:
        return pb
    linked_raw = raw.get('linked_brands') or raw.get('detect_brands')
    linked: List[str] = []
    if isinstance(linked_raw, list):
        for item in linked_raw:
            b = str(item or '').strip().lower()
            if b:
                linked.append(b)
    elif isinstance(linked_raw, str) and linked_raw.strip():
        linked.append(linked_raw.strip().lower())
    return _infer_payment_brand(label, method_id, linked or None)


def _empty_methods_buckets() -> Dict[str, List[Dict[str, Any]]]:
    return {cur: [] for cur in _METHOD_BUCKETS}


def payment_method_qr_upload_dir(app) -> str:
    upload_dir = os.path.join(app.instance_path, *QR_UPLOAD_SUBDIR)
    os.makedirs(upload_dir, exist_ok=True)
    return upload_dir


def _slug_method_id(label: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '_', (label or '').strip().lower())
    s = s.strip('_')
    return s[:48] or 'medio'


_GENERIC_BREB_METHOD_IDS = frozenset({
    'bre_b_bancolombia',
    'breb_bancolombia',
    'breve_bancolombia',
})

# IDs que solo repiten el nombre de la marca (varios medios iguales colisionaban).
_BRAND_ONLY_METHOD_IDS = frozenset(PAYMENT_BRAND_SPEC.keys()) | _GENERIC_BREB_METHOD_IDS


def breb_method_id_from_llave(llave: str) -> str:
    """ID estable por llave Bre-B (evita duplicar bre_b_bancolombia en varios medios)."""
    slug = re.sub(r'[^a-z0-9]', '', str(llave or '').lower())[:32]
    if not slug:
        return 'bre_b_sin_llave'
    return f'bre_b_{slug}'[:48]


def breb_nequi_method_id_from_config(llave: str, phone: str = '') -> str:
    """ID estable Bre-B Nequi a partir de la llave (número, @clave, etc.)."""
    lslug = re.sub(r'[^a-z0-9]', '', str(llave or '').lower())[:32]
    if not lslug:
        lslug = 'sin_llave'
    return f'bre_b_nequi_{lslug}'[:48]


def _differentiate_breb_method_labels(lst: List[Dict[str, Any]]) -> None:
    """Nombre corto en lista; la llave @… se muestra aparte en recargas."""
    for ent in lst:
        if payment_method_is_breb_bancolombia(ent) and str(ent.get('bre_b_llave') or '').strip():
            ent['label'] = 'Bre-B Bancolombia'
        elif payment_method_is_breb_nequi(ent) and str(ent.get('bre_b_llave') or '').strip():
            ent['label'] = 'Bre-B Nequi'


def _method_account_tail_for_id(ent: Dict[str, Any]) -> str:
    """Sufijo numérico que distingue dos medios del mismo banco (cuenta, celular, etc.)."""
    if payment_method_is_binance_pay(ent):
        key = re.sub(r'[^a-zA-Z0-9]', '', str(ent.get('binance_pay_api_key') or ''))
        if len(key) >= 4:
            return key[-8:].lower()
        return ''
    if payment_method_is_usdt_wallet(ent):
        return _crypto_wallet_tail(ent)
    if payment_method_is_breb_bancolombia(ent):
        suffix = _digits_only(str(ent.get('bre_b_account_suffix') or ''))
        if len(suffix) >= 4:
            return suffix[-4:]
    brand = str(ent.get('payment_brand') or '').strip().lower()
    if brand == 'paypal':
        return _paypal_account_tail(ent)
    acct = _digits_only(str(ent.get('account_number') or ''))
    if len(acct) >= 4:
        return acct[-8:] if len(acct) > 8 else acct
    if acct:
        return acct
    return ''


def payment_method_account_hint(method: Dict[str, Any]) -> str:
    """Fragmento corto de cuenta/llave para distinguir medios con el mismo nombre."""
    if payment_method_is_breb_nequi(method):
        llave = _digits_only(payment_method_breb_llave_stored(method))
        if len(llave) >= 4:
            return f'*{llave[-4:]}'
    if payment_method_is_breb_bancolombia(method):
        llave = str(method.get('bre_b_llave') or '').strip()
        if llave:
            slug = re.sub(r'[^a-zA-Z0-9]', '', llave.lower())
            return f'@{slug[:12]}' if slug else ''
        suffix = _digits_only(str(method.get('bre_b_account_suffix') or ''))
        if len(suffix) >= 4:
            return f'*{suffix[-4:]}'
    tail = _method_account_tail_for_id(method)
    if not tail:
        return ''
    brand = str(method.get('payment_brand') or '').strip().lower()
    if brand in ('usdt_erc20', 'usdt_trc20'):
        return f'…{tail[-6:]}'
    if payment_method_is_binance_pay(method):
        return f'…{tail[-6:]}'
    if brand == 'paypal':
        email = _normalize_paypal_account(str(method.get('account_number') or ''))
        local = email.split('@', 1)[0] if email and '@' in email else email
        return (local[-10:] if local and len(local) > 10 else local) or ''
    digits = _digits_only(tail)
    if len(digits) >= 4:
        return f'*{digits[-4:]}'
    return tail[:12]


def payment_method_option_display_label(method: Dict[str, Any]) -> str:
    """Nombre del medio + pista de cuenta para selectores admin."""
    label = str(method.get('label') or '').strip()
    hint = payment_method_account_hint(method)
    if label and hint:
        return f'{label} · {hint}'
    return label


def _apply_currency_method_id_prefix(method_id: str, currency: str) -> str:
    """Acumulador usa prefijo accum_ para no colisionar con COP/USD del mismo banco/cuenta."""
    mid = re.sub(r'[^a-z0-9_\-]', '', str(method_id or '').strip().lower())[:48]
    if not mid:
        return mid
    cur = (currency or '').strip().upper()
    if cur == 'ACCUM' and not mid.startswith('accum_'):
        return f'accum_{mid}'[:48]
    return mid


def canonical_method_id(ent: Dict[str, Any], idx: int = 0, *, currency: str = '') -> str:
    """
    ID único y estable por medio: marca + cuenta/llave, nunca solo «bancolombia» o «bre_b_bancolombia».
    """
    cur = (currency or str(ent.get('currency') or '')).strip().upper()
    label = str(ent.get('label') or '').strip()
    raw_id = re.sub(r'[^a-z0-9_\-]', '', str(ent.get('id') or '').strip().lower())[:48]
    brand = str(ent.get('payment_brand') or '').strip().lower()
    if not brand:
        brand = _resolve_payment_brand(ent, label, raw_id)

    if payment_method_is_breb_bancolombia(ent):
        llave = str(ent.get('bre_b_llave') or '').strip()
        if llave:
            return _apply_currency_method_id_prefix(breb_method_id_from_llave(llave), cur)
    if payment_method_is_breb_nequi(ent):
        llave = payment_method_breb_llave_stored(ent)
        if llave:
            return _apply_currency_method_id_prefix(
                breb_nequi_method_id_from_config(llave), cur
            )

    tail = _method_account_tail_for_id(ent)
    if brand and tail:
        return _apply_currency_method_id_prefix(f'{brand}_{tail}'[:48], cur)

    if raw_id and raw_id not in _BRAND_ONLY_METHOD_IDS and (
        '_' in raw_id or raw_id not in PAYMENT_BRAND_SPEC
    ):
        return _apply_currency_method_id_prefix(raw_id, cur)

    slug = _slug_method_id(label)
    if brand in ('generico', 'criptomoneda'):
        base = slug or brand or 'medio'
        mid = f'{base}_{tail}'[:48] if tail else f'{base}_{idx}'[:48]
        return _apply_currency_method_id_prefix(mid, cur)

    if brand:
        if tail:
            return _apply_currency_method_id_prefix(f'{brand}_{tail}'[:48], cur)
        return _apply_currency_method_id_prefix(f'{brand}_{idx}'[:48], cur)

    if slug and tail:
        return _apply_currency_method_id_prefix(f'{slug}_{tail}'[:48], cur)
    return _apply_currency_method_id_prefix(slug or f'medio_{idx}', cur)


def _ensure_unique_method_ids(cfg: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    seen: set[str] = set()
    for bucket in _METHOD_BUCKETS:
        lst = cfg.get(bucket) or []
        new_lst: List[Dict[str, Any]] = []
        for i, item in enumerate(lst):
            if not isinstance(item, dict):
                continue
            ent = dict(item)
            ent['currency'] = bucket
            if not ent.get('payment_brand'):
                ent['payment_brand'] = _resolve_payment_brand(
                    ent,
                    str(ent.get('label') or ''),
                    str(ent.get('id') or ''),
                )
            mid = canonical_method_id(ent, i, currency=bucket)
            base_mid = mid
            suffix_n = 0
            while mid in seen:
                suffix_n += 1
                mid = f'{base_mid}_{i}_{suffix_n}'[:48]
            seen.add(mid)
            ent['id'] = mid
            new_lst.append(ent)
        _differentiate_breb_method_labels(new_lst)
        out[bucket] = new_lst
    return out


def validate_payment_methods_payload(
    payload: Dict[str, Any],
    *,
    previous: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> Optional[str]:
    """Errores de validación antes de guardar medios (Bre-B, IDs duplicados)."""
    breb_err = validate_breb_methods_in_payload(payload)
    if breb_err:
        return breb_err
    if not isinstance(payload, dict):
        return None
    prev_by_id: Dict[str, Dict[str, Any]] = {}
    if previous:
        for lst in previous.values():
            for item in lst or []:
                mid = str(item.get('id') or '')
                if mid:
                    prev_by_id[mid] = item
    seen: Dict[str, str] = {}
    for cur in _METHOD_BUCKETS:
        lst = payload.get(cur)
        if not isinstance(lst, list):
            continue
        for i, raw in enumerate(lst):
            if not isinstance(raw, dict) or raw.get('enabled') is False:
                continue
            ent = _normalize_method_entry(raw, cur, i)
            if not ent:
                continue
            mid = str(ent.get('id') or '').strip()
            label = str(ent.get('label') or mid or f'fila {i + 1}')
            if mid in seen:
                return (
                    f'Dos medios comparten el mismo identificador «{mid}» '
                    f'({seen[mid]} y {label}). Revisa cuenta, llave Bre-B o nombre.'
                )
            seen[mid] = label
            brand = str(ent.get('payment_brand') or '').strip().lower()
            wallet_brand = _infer_crypto_brand_from_wallet(
                str(raw.get('account_number') or ent.get('account_number') or '')
            )
            if wallet_brand and brand in ('', 'usdt', 'binance', 'criptomoneda'):
                brand = wallet_brand
            if brand == 'binance_pay':
                api_key = str(
                    raw.get('binance_pay_api_key') or ent.get('binance_pay_api_key') or ''
                ).strip()
                if not api_key:
                    return f'«{label}»: indica la API Key de Binance Pay.'
                secret = str(raw.get('binance_pay_secret') or '').strip()
                prev_secret = str((prev_by_id.get(mid) or {}).get('binance_pay_secret') or '').strip()
                has_secret = bool(secret and secret != '********') or bool(prev_secret)
                if not has_secret:
                    return f'«{label}»: indica el API Secret de Binance Pay.'
                continue
            if brand == 'paypal':
                email = _normalize_paypal_account(
                    str(raw.get('account_number') or ent.get('account_number') or '')
                )
                if not _paypal_account_is_valid(email):
                    return (
                        f'PayPal ({_method_bucket_label(cur)}, fila {i + 1}): '
                        'indica el correo electrónico de PayPal.'
                    )
                continue
            if brand == 'usdt_erc20':
                wallet = _normalize_crypto_wallet(
                    str(raw.get('account_number') or ent.get('account_number') or ''),
                    'usdt_erc20',
                )
                if not _erc20_wallet_is_valid(wallet):
                    return (
                        f'USDT ERC20 ({_method_bucket_label(cur)}, fila {i + 1}): '
                        'indica una dirección wallet válida (0x + 40 caracteres hex).'
                    )
                continue
            if brand == 'usdt_trc20':
                wallet = _normalize_crypto_wallet(
                    str(raw.get('account_number') or ent.get('account_number') or ''),
                    'usdt_trc20',
                )
                if not _trc20_wallet_is_valid(wallet):
                    return (
                        f'USDT TRC20 ({_method_bucket_label(cur)}, fila {i + 1}): '
                        'indica una dirección wallet Tron válida (empieza con T, 34 caracteres).'
                    )
                continue
            if brand and brand not in (
                'generico', 'criptomoneda', 'breb_bancolombia', 'breb_nequi', 'breve',
            ):
                if not _method_account_tail_for_id(ent):
                    return (
                        f'«{label}»: indica el número de cuenta (o celular) para generar '
                        f'un ID único y no mezclarlo con otro medio {brand}.'
                    )
    return None


def _persist_payment_methods_if_ids_changed(before: Dict[str, List[Dict[str, Any]]], after: Dict[str, List[Dict[str, Any]]]) -> None:
    """Guarda en BD si la migración de IDs cambió la configuración."""
    from app.extensions import db

    def _ids_map(cfg: Dict[str, List[Dict[str, Any]]]) -> list[tuple[str, str, str]]:
        rows: list[tuple[str, str, str]] = []
        for bucket in _METHOD_BUCKETS:
            for ent in cfg.get(bucket) or []:
                rows.append((
                    bucket,
                    str(ent.get('id') or ''),
                    str(ent.get('bre_b_llave') or ''),
                ))
        return rows

    if _ids_map(before) == _ids_map(after):
        return
    row = StoreSetting.query.filter_by(key=SETTINGS_KEY).first()
    body = json.dumps(after, ensure_ascii=False)
    if row:
        row.value = body
    else:
        db.session.add(StoreSetting(key=SETTINGS_KEY, value=body))
    db.session.commit()


def _digits_only(value: str) -> str:
    return re.sub(r'\D', '', str(value or ''))


def _normalize_paypal_account(value: str) -> str:
    return str(value or '').strip().lower()[:64]


def _paypal_account_is_valid(value: str) -> bool:
    email = _normalize_paypal_account(value)
    return bool(email and '@' in email and email.index('@') >= 1)


def _sanitize_paypal_method_for_admin(row: Dict[str, Any]) -> Dict[str, Any]:
    """Limpia valores legacy (ej. «2») que no son correo; el admin debe reingresar el email."""
    if str(row.get('payment_brand') or '').strip().lower() != 'paypal':
        return row
    acct = str(row.get('account_number') or '').strip()
    if acct and not _paypal_account_is_valid(acct):
        out = dict(row)
        out['account_number'] = ''
        return out
    return row


def _method_bucket_label(cur: str) -> str:
    bucket = (cur or '').strip().upper()
    if bucket == 'ACCUM':
        return 'Acumulador'
    if bucket == 'USD':
        return 'USDT'
    return bucket or 'COP'


def _paypal_account_tail(ent: Dict[str, Any]) -> str:
    email = _normalize_paypal_account(str(ent.get('account_number') or ''))
    if not email:
        return ''
    local = email.split('@', 1)[0] if '@' in email else email
    slug = re.sub(r'[^a-z0-9]', '', local.lower())
    if not slug:
        return ''
    return slug[-12:] if len(slug) > 12 else slug


def _migrate_legacy_method_fields(raw: Dict[str, Any]) -> tuple[str, str]:
    """Convierte el campo legacy `details` a número de cuenta y descripción."""
    account_number = str(raw.get('account_number') or '').strip()
    description = str(raw.get('description') or '').strip()
    legacy = str(raw.get('details') or '').strip()
    if account_number or description or not legacy:
        return account_number, description
    legacy_digits = _digits_only(legacy)
    legacy_compact = re.sub(r'\s+', '', legacy)
    if legacy_digits and (
        legacy_digits == legacy_compact
        or len(legacy_digits) >= max(4, int(len(legacy_compact) * 0.5))
    ):
        return legacy_digits[:32], ''
    return '', legacy[:500]


def payment_method_account_digits(method: Dict[str, Any]) -> str:
    """Dígitos de cuenta configurados en el medio (mín. 4 si es explícito, 8 si viene de legacy)."""
    if payment_method_is_breb_nequi(method):
        llave_digits = _digits_only(payment_method_breb_llave_stored(method))
        if len(llave_digits) == 10:
            return llave_digits
        acct = _digits_only(str(method.get('account_number') or ''))
        return acct if len(acct) == 10 else ''
    if payment_method_is_breb_bancolombia(method):
        suffix = payment_method_breb_account_suffix(method)
        return suffix if suffix else ''
    brand = str(method.get('payment_brand') or '').strip().lower()
    if brand == 'paypal':
        email = _normalize_paypal_account(str(method.get('account_number') or ''))
        return email if email else ''
    if brand in ('usdt_erc20', 'usdt_trc20'):
        wallet = _normalize_crypto_wallet(str(method.get('account_number') or ''), brand)
        return wallet if wallet else ''
    acct = _digits_only(str(method.get('account_number') or ''))
    if acct:
        return acct if len(acct) >= 4 else ''
    legacy = str(method.get('details') or '').strip()
    legacy_digits = _digits_only(legacy)
    return legacy_digits if len(legacy_digits) >= 8 else ''


def payment_method_user_display(method: Dict[str, Any]) -> Dict[str, Any]:
    """Texto visible al usuario en recargas (número, llave Bre-B, descripción).

    Los 4 dígitos de cuenta Bre-B (bre_b_account_suffix) son solo para verificación
    interna (OCR/correo); no se exponen al cliente.
    """
    account_number, description = _migrate_legacy_method_fields(method)
    out: Dict[str, Any] = {
        'account_number': (account_number or '')[:32],
        'description': (description or '')[:500],
        'is_breb_bancolombia': False,
        'is_breb_nequi': False,
        'bre_b_llave': '',
    }
    llave_display = payment_method_breb_llave_display(method)
    if payment_method_is_breb_nequi(method):
        out['is_breb_nequi'] = True
        out['bre_b_llave'] = llave_display
        out['account_number'] = llave_display
        return out
    if payment_method_is_binance_pay(method):
        out['is_binance_pay'] = True
        out['account_number'] = ''
        return out
    brand = str(method.get('payment_brand') or '').strip().lower()
    if brand == 'paypal':
        out['account_number'] = _normalize_paypal_account(account_number)
        return out
    if brand in ('usdt_erc20', 'usdt_trc20'):
        out['is_crypto_wallet'] = True
        out['crypto_network'] = 'ERC20' if brand == 'usdt_erc20' else 'TRC20'
        out['account_number'] = _normalize_crypto_wallet(account_number, brand)
        return out
    if not payment_method_is_breb_bancolombia(method):
        return out
    out['is_breb_bancolombia'] = True
    out['bre_b_llave'] = llave_display
    out['account_number'] = llave_display
    return out


def validate_breb_methods_in_payload(payload: Dict[str, Any]) -> Optional[str]:
    """Devuelve mensaje de error si un Bre-B activo no tiene llave/cuenta configurada."""
    if not isinstance(payload, dict):
        return None
    for cur in _METHOD_BUCKETS:
        lst = payload.get(cur)
        if not isinstance(lst, list):
            continue
        for i, raw in enumerate(lst):
            if not isinstance(raw, dict):
                continue
            label = str(raw.get('label') or '').strip()
            mid = str(raw.get('id') or '').strip()
            brand = str(raw.get('payment_brand') or '').strip().lower()
            probe = {'payment_brand': brand, 'label': label, 'id': mid, **raw}
            if raw.get('enabled') is False:
                continue
            nombre = label or mid or f'fila {i + 1}'
            llave = re.sub(r'[^@A-Za-z0-9]', '', str(raw.get('bre_b_llave') or '')).lstrip('@')
            if payment_method_is_breb_bancolombia(probe):
                suffix = _digits_only(str(raw.get('bre_b_account_suffix') or ''))
                if len(suffix) > 4:
                    suffix = suffix[-4:]
                if not llave:
                    return (
                        f'Bre-B Bancolombia («{nombre}»): indica la llave Bre-B '
                        f'(número, @clave u otro identificador) antes de guardar.'
                    )
                if len(suffix) < 4:
                    return (
                        f'Bre-B Bancolombia («{nombre}»): indica los 4 dígitos de cuenta '
                        f'(ej. 1948) antes de guardar.'
                    )
            if payment_method_is_breb_nequi(probe):
                if not llave:
                    return (
                        f'Bre-B Nequi («{nombre}»): indica la llave Bre-B '
                        f'(número, @clave u otro identificador) antes de guardar.'
                    )
    return None


def _normalize_payment_currency(raw: Dict[str, Any], currency: str) -> Optional[str]:
    if currency != 'ACCUM':
        return None
    pc = str(raw.get('payment_currency') or 'COP').strip().upper()
    if pc in ('USD', 'USDT'):
        return 'USD'
    return 'COP'


def _normalize_positive_multiplier(raw: Dict[str, Any], key: str) -> Optional[float]:
    val = raw.get(key)
    if val is None or str(val).strip() == '':
        return None
    try:
        mult = float(str(val).replace(',', '.').strip())
    except (TypeError, ValueError):
        return None
    if mult <= 0:
        return None
    return round(mult, 8)


def _accum_multipliers_from_raw(raw: Dict[str, Any]) -> Dict[str, Optional[float]]:
    """Multiplicadores de conversión (no porcentajes)."""
    mult_usd_to_cop = _normalize_positive_multiplier(raw, 'mult_usd_to_cop')
    mult_cop_to_usd = _normalize_positive_multiplier(raw, 'mult_cop_to_usd')

    legacy_rate = _normalize_positive_multiplier(raw, 'exchange_rate')
    if mult_usd_to_cop is None and legacy_rate is not None:
        mult_usd_to_cop = legacy_rate

    if mult_cop_to_usd is None and legacy_rate is not None:
        legacy_pct = raw.get('conversion_percent')
        factor = 1.0
        if legacy_pct is not None and str(legacy_pct).strip() != '':
            try:
                factor = float(str(legacy_pct).replace(',', '.').strip().rstrip('%')) / 100.0
            except (TypeError, ValueError):
                factor = 1.0
            if factor <= 0:
                factor = 1.0
        mult_cop_to_usd = round(factor / legacy_rate, 8)

    return {
        'mult_usd_to_cop': mult_usd_to_cop,
        'mult_cop_to_usd': mult_cop_to_usd,
    }


def _accum_payment_currency_key(method: Dict[str, Any]) -> str:
    pc = (method.get('payment_currency') or 'COP').strip().upper()
    return 'USD' if pc in ('USD', 'USDT') else 'COP'


def _accum_multipliers_fallback(
    method: Dict[str, Any],
    *,
    pool: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Optional[float]]:
    """Hereda multiplicadores de otro acumulador con la misma moneda acumulada."""
    want = _accum_payment_currency_key(method)
    my_id = str(method.get('id') or '').strip()
    sources = pool if pool is not None else (get_payment_methods_config().get('ACCUM') or [])
    for m in sources:
        if str(m.get('id') or '').strip() == my_id:
            continue
        if _accum_payment_currency_key(m) != want:
            continue
        mults = _accum_multipliers_from_raw(m)
        if mults['mult_usd_to_cop'] is not None or mults['mult_cop_to_usd'] is not None:
            return mults
    return {'mult_usd_to_cop': None, 'mult_cop_to_usd': None}


def accum_conversion_multipliers(method: Dict[str, Any]) -> Dict[str, Optional[float]]:
    mults = dict(_accum_multipliers_from_raw(method or {}))
    if mults['mult_usd_to_cop'] is not None and mults['mult_cop_to_usd'] is not None:
        return mults
    fallback = _accum_multipliers_fallback(method or {})
    if mults['mult_usd_to_cop'] is None and fallback.get('mult_usd_to_cop') is not None:
        mults['mult_usd_to_cop'] = fallback['mult_usd_to_cop']
    if mults['mult_cop_to_usd'] is None and fallback.get('mult_cop_to_usd') is not None:
        mults['mult_cop_to_usd'] = fallback['mult_cop_to_usd']
    return mults


def _apply_accum_multiplier_inheritance(entries: List[Dict[str, Any]]) -> None:
    """Al guardar, copia multiplicadores entre acumuladores USDT/COP del mismo tipo."""
    for ent in entries:
        mults = _accum_multipliers_from_raw(ent)
        if mults['mult_usd_to_cop'] is not None and mults['mult_cop_to_usd'] is not None:
            continue
        fallback = _accum_multipliers_fallback(ent, pool=entries)
        if mults['mult_usd_to_cop'] is None and fallback.get('mult_usd_to_cop') is not None:
            ent['mult_usd_to_cop'] = fallback['mult_usd_to_cop']
        if mults['mult_cop_to_usd'] is None and fallback.get('mult_cop_to_usd') is not None:
            ent['mult_cop_to_usd'] = fallback['mult_cop_to_usd']


def _normalize_method_entry(raw: Dict[str, Any], currency: str, idx: int) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    label = str(raw.get('label') or '').strip()
    mid = str(raw.get('id') or '').strip()
    payment_brand = _resolve_crypto_payment_brand(raw, label, mid)
    if not label and payment_brand:
        label = _default_label_for_brand(payment_brand, currency)
    if not label:
        return None
    qr_filename = str(raw.get('qr_filename') or '').strip()
    if qr_filename:
        qr_filename = os.path.basename(qr_filename)[:120]
    else:
        qr_filename = ''
    account_number, description = _migrate_legacy_method_fields(raw)
    if payment_brand == 'paypal':
        account_number = _normalize_paypal_account(
            account_number or str(raw.get('account_number') or '')
        )
    elif payment_brand in ('usdt_erc20', 'usdt_trc20'):
        account_number = _normalize_crypto_wallet(
            account_number or str(raw.get('account_number') or ''),
            payment_brand,
        )
    else:
        account_number = _digits_only(account_number)[:32]
    bre_b_llave = payment_method_breb_llave_stored({'bre_b_llave': raw.get('bre_b_llave')})
    bre_b_suffix = _digits_only(str(raw.get('bre_b_account_suffix') or ''))[:4]
    if len(bre_b_suffix) > 4:
        bre_b_suffix = bre_b_suffix[-4:]
    draft: Dict[str, Any] = {
        'id': mid,
        'label': label[:80],
        'payment_brand': payment_brand,
        'account_number': account_number,
        'bre_b_llave': bre_b_llave,
        'bre_b_account_suffix': bre_b_suffix,
    }
    if payment_brand == 'binance_pay':
        api_key_draft = str(raw.get('binance_pay_api_key') or '').strip()[:128]
        if api_key_draft:
            draft['binance_pay_api_key'] = api_key_draft
    ent = {
        'id': canonical_method_id(draft, idx, currency=currency),
        'label': label[:80],
        'account_number': account_number,
        'description': description[:500],
        'enabled': bool(raw.get('enabled', True)),
        'currency': currency,
        'allowed_user_ids': _normalize_allowed_user_ids(raw.get('allowed_user_ids')),
    }
    if currency == 'ACCUM':
        ent['payment_currency'] = _normalize_payment_currency(raw, currency) or 'COP'
        mults = _accum_multipliers_from_raw(raw)
        if mults['mult_usd_to_cop'] is not None:
            ent['mult_usd_to_cop'] = mults['mult_usd_to_cop']
        if mults['mult_cop_to_usd'] is not None:
            ent['mult_cop_to_usd'] = mults['mult_cop_to_usd']
    if bre_b_llave:
        ent['bre_b_llave'] = bre_b_llave
    if bre_b_suffix:
        ent['bre_b_account_suffix'] = bre_b_suffix
    if payment_brand:
        ent['payment_brand'] = payment_brand
        if payment_brand == 'breb_bancolombia' and bre_b_suffix:
            ent['account_number'] = bre_b_suffix
        elif payment_brand == 'breb_nequi':
            ent['account_number'] = ''
        brands = _linked_brands_from_brand(payment_brand)
        if not brands:
            linked = raw.get('linked_brands') or raw.get('detect_brands')
            if isinstance(linked, list):
                for item in linked:
                    b = str(item or '').strip().lower()
                    if b and b not in brands:
                        brands.append(b)
            elif isinstance(linked, str) and linked.strip():
                brands.append(linked.strip().lower())
        if brands:
            ent['linked_brands'] = brands
    elif currency == 'ACCUM':
        linked = raw.get('linked_brands') or raw.get('detect_brands')
        brands: List[str] = []
        if isinstance(linked, list):
            for item in linked:
                b = str(item or '').strip().lower()
                if b and b not in brands:
                    brands.append(b)
        elif isinstance(linked, str) and linked.strip():
            brands.append(linked.strip().lower())
        if brands:
            ent['linked_brands'] = brands
    if qr_filename:
        ent['qr_filename'] = qr_filename
    if payment_brand == 'binance_pay':
        api_key = str(raw.get('binance_pay_api_key') or '').strip()[:128]
        secret = str(raw.get('binance_pay_secret') or '').strip()[:256]
        if api_key:
            ent['binance_pay_api_key'] = api_key
        if secret and secret != '********':
            ent['binance_pay_secret'] = secret
    return ent


def _normalize_allowed_user_ids(raw) -> Optional[List[int]]:
    if raw is None:
        return None
    if not isinstance(raw, list):
        return None
    out: List[int] = []
    for x in raw:
        try:
            uid = int(x)
        except (TypeError, ValueError):
            continue
        if uid > 0 and uid not in out:
            out.append(uid)
    # Lista vacía = ningún cliente; None = visible para todos (legacy / explícito «todos»).
    return out


def _decode_qr_base64(data_url: str) -> Optional[bytes]:
    s = str(data_url or '').strip()
    if not s:
        return None
    if s.startswith('data:'):
        comma = s.find(',')
        if comma < 0:
            return None
        s = s[comma + 1 :]
    try:
        raw = base64.b64decode(s, validate=True)
    except Exception:
        return None
    if not raw or len(raw) > _MAX_QR_BYTES:
        return None
    return raw


def _guess_qr_ext(raw: bytes) -> str:
    if raw[:8] == b'\x89PNG\r\n\x1a\n':
        return '.png'
    if raw[:3] == b'GIF':
        return '.gif'
    if raw[:4] == b'RIFF' and len(raw) > 12 and raw[8:12] == b'WEBP':
        return '.webp'
    if raw[:2] == b'\xff\xd8':
        return '.jpg'
    return '.png'


def save_payment_method_qr_file(app, method_id: str, data_url: str) -> Optional[str]:
    raw = _decode_qr_base64(data_url)
    if not raw:
        return None
    safe_id = re.sub(r'[^a-z0-9_\-]', '', str(method_id or '').lower())[:48] or 'medio'
    filename = f'{safe_id}_{uuid.uuid4().hex[:12]}{_guess_qr_ext(raw)}'
    path = os.path.join(payment_method_qr_upload_dir(app), filename)
    with open(path, 'wb') as fh:
        fh.write(raw)
    return filename


def delete_payment_method_qr_file(app, filename: str) -> None:
    fn = os.path.basename(str(filename or '').strip())
    if not fn:
        return
    path = os.path.join(payment_method_qr_upload_dir(app), fn)
    if os.path.isfile(path):
        try:
            os.remove(path)
        except OSError:
            pass


def payment_method_qr_public_filename(filename: str) -> str:
    return os.path.basename(str(filename or '').strip())


def get_payment_methods_config() -> Dict[str, List[Dict[str, Any]]]:
    row = StoreSetting.query.filter_by(key=SETTINGS_KEY).first()
    out = _empty_methods_buckets()
    if not row or not row.value:
        return out
    try:
        data = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return out
    if not isinstance(data, dict):
        return out
    for cur in _METHOD_BUCKETS:
        lst = data.get(cur)
        if not isinstance(lst, list):
            continue
        normalized = []
        for i, item in enumerate(lst):
            ent = _normalize_method_entry(item, cur, i)
            if ent:
                normalized.append(ent)
        out[cur] = normalized
    accum_uids: List[int] = []
    for ent in out.get('ACCUM') or []:
        for x in ent.get('allowed_user_ids') or []:
            try:
                uid = int(x)
            except (TypeError, ValueError):
                continue
            if uid > 0:
                accum_uids.append(uid)
    if accum_uids:
        price_map = _user_tipo_precio_map(list(set(accum_uids)))
        for ent in out.get('ACCUM') or []:
            _prune_accum_allowed_user_ids(ent, price_map)
    snapshot = {k: [dict(x) for x in v] for k, v in out.items()}
    fixed = _ensure_unique_method_ids(out)
    if fixed != snapshot:
        _persist_payment_methods_if_ids_changed(snapshot, fixed)
    return fixed


def _accum_opposite_user_price_type(payment_currency: str) -> str:
    pc = (payment_currency or 'COP').strip().upper()
    return 'COP' if pc in ('USD', 'USDT') else 'USD'


def _user_tipo_precio_map(user_ids: List[int]) -> Dict[int, str]:
    from app.store.models import User

    if not user_ids:
        return {}
    out: Dict[int, str] = {}
    for u in User.query.filter(User.id.in_(user_ids)).all():
        tp = None
        if u.user_prices and isinstance(u.user_prices, dict):
            tp = (u.user_prices.get('tipo_precio') or '').strip().upper()
        if tp in ('USD', 'USDT'):
            out[int(u.id)] = 'USD'
        elif tp == 'COP':
            out[int(u.id)] = 'COP'
    return out


def _prune_accum_allowed_user_ids(
    ent: Dict[str, Any], price_map: Optional[Dict[int, str]] = None
) -> None:
    ids = ent.get('allowed_user_ids')
    if ids is None:
        return
    if not isinstance(ids, list):
        ent['allowed_user_ids'] = []
        return
    if not ids:
        ent['allowed_user_ids'] = []
        return
    expected = _accum_opposite_user_price_type(ent.get('payment_currency') or 'COP')
    if price_map is None:
        uid_list: List[int] = []
        for x in ids:
            try:
                uid = int(x)
            except (TypeError, ValueError):
                continue
            if uid > 0:
                uid_list.append(uid)
        price_map = _user_tipo_precio_map(uid_list)
    valid: List[int] = []
    for x in ids:
        try:
            uid = int(x)
        except (TypeError, ValueError):
            continue
        if uid > 0 and price_map.get(uid) == expected and uid not in valid:
            valid.append(uid)
    ent['allowed_user_ids'] = valid


def _prune_all_accum_methods(methods: Dict[str, List[Dict[str, Any]]]) -> None:
    accum = methods.get('ACCUM') or []
    if not accum:
        return
    uid_set: List[int] = []
    for ent in accum:
        for x in ent.get('allowed_user_ids') or []:
            try:
                uid = int(x)
            except (TypeError, ValueError):
                continue
            if uid > 0:
                uid_set.append(uid)
    price_map = _user_tipo_precio_map(list(set(uid_set)))
    for ent in accum:
        _prune_accum_allowed_user_ids(ent, price_map)


def save_payment_methods_config(payload: Dict[str, Any], app=None, previous: Optional[Dict[str, List[Dict[str, Any]]]] = None) -> Dict[str, List[Dict[str, Any]]]:
    from app.extensions import db

    prev_by_id: Dict[str, Dict[str, Any]] = {}
    if previous:
        for lst in previous.values():
            for item in lst or []:
                mid = str(item.get('id') or '')
                if mid:
                    prev_by_id[mid] = item

    out: Dict[str, List[Dict[str, Any]]] = {}
    for cur in _METHOD_BUCKETS:
        lst = payload.get(cur) if isinstance(payload, dict) else None
        if not isinstance(lst, list):
            out[cur] = []
            continue
        prev_list = (previous or {}).get(cur) or []
        normalized = []
        for i, item in enumerate(lst):
            if not isinstance(item, dict):
                continue
            ent = _normalize_method_entry(item, cur, i)
            if not ent:
                continue
            mid = ent['id']
            prev = prev_by_id.get(mid) or {}
            if not prev.get('qr_filename') and i < len(prev_list):
                prev = {**prev, **{k: v for k, v in (prev_list[i] or {}).items() if v}}
            legacy_mid = re.sub(r'[^a-z0-9_\-]', '', str(item.get('id') or '').lower())[:48]
            if not prev.get('qr_filename') and legacy_mid and legacy_mid != mid:
                prev = {**prev, **(prev_by_id.get(legacy_mid) or {})}
            if cur == 'ACCUM' and not prev.get('qr_filename'):
                for alt in (
                    _apply_currency_method_id_prefix(legacy_mid, 'ACCUM'),
                    legacy_mid[6:] if legacy_mid.startswith('accum_') else '',
                ):
                    if alt and alt != mid:
                        prev = {**prev, **(prev_by_id.get(alt) or {})}
                        if prev.get('qr_filename'):
                            break
            if payment_method_is_breb_bancolombia(ent):
                llave_raw = str(item.get('bre_b_llave') if item.get('bre_b_llave') is not None else '').strip()
                suffix_raw = str(
                    item.get('bre_b_account_suffix')
                    if item.get('bre_b_account_suffix') is not None
                    else ''
                ).strip()
                if llave_raw:
                    llave = re.sub(r'[^@A-Za-z0-9]', '', llave_raw)[:32].lstrip('@').upper()
                    if llave:
                        ent['bre_b_llave'] = llave
                elif prev.get('bre_b_llave'):
                    ent['bre_b_llave'] = prev['bre_b_llave']
                if suffix_raw:
                    suffix = _digits_only(suffix_raw)[:4]
                    if len(suffix) > 4:
                        suffix = suffix[-4:]
                    if suffix:
                        ent['bre_b_account_suffix'] = suffix
                        ent['account_number'] = suffix
                elif prev.get('bre_b_account_suffix'):
                    ent['bre_b_account_suffix'] = prev['bre_b_account_suffix']
                    ent['account_number'] = prev['bre_b_account_suffix']
            qr_remove = bool(item.get('qr_remove'))
            qr_base64 = str(item.get('qr_base64') or '').strip()
            if app and qr_base64:
                old_fn = prev.get('qr_filename') or ent.get('qr_filename')
                if old_fn:
                    delete_payment_method_qr_file(app, old_fn)
                new_fn = save_payment_method_qr_file(app, mid, qr_base64)
                if new_fn:
                    ent['qr_filename'] = new_fn
            elif qr_remove and app:
                old_fn = prev.get('qr_filename') or ent.get('qr_filename')
                if old_fn:
                    delete_payment_method_qr_file(app, old_fn)
                ent.pop('qr_filename', None)
            elif prev.get('qr_filename') and not ent.get('qr_filename'):
                ent['qr_filename'] = prev['qr_filename']
            from app.store.balance_recharge_binance_pay import merge_binance_pay_secret_on_save

            merge_binance_pay_secret_on_save(ent, item, prev)
            normalized.append(ent)
        if cur == 'ACCUM' and normalized:
            _apply_accum_multiplier_inheritance(normalized)
        out[cur] = normalized

    _prune_all_accum_methods(out)
    out = _ensure_unique_method_ids(out)

    removed_ids = set(prev_by_id.keys()) - {
        ent['id'] for lst in out.values() for ent in lst
    }
    if app:
        for mid in removed_ids:
            old_fn = prev_by_id.get(mid, {}).get('qr_filename')
            if old_fn:
                delete_payment_method_qr_file(app, old_fn)

    row = StoreSetting.query.filter_by(key=SETTINGS_KEY).first()
    body = json.dumps(out, ensure_ascii=False)
    if row:
        row.value = body
    else:
        db.session.add(StoreSetting(key=SETTINGS_KEY, value=body))
    db.session.commit()
    return out


def _user_payment_method_ids(user_row) -> Optional[List[str]]:
    up = getattr(user_row, 'user_prices', None) or {}
    if not isinstance(up, dict):
        return None
    raw = up.get('payment_method_ids')
    if raw is None:
        return None
    if not isinstance(raw, list):
        return None
    ids = []
    for x in raw:
        s = str(x or '').strip()
        if s and s not in ids:
            ids.append(s)
    return ids


def set_user_payment_method_ids(user_row, method_ids: Optional[List[str]]) -> None:
    from app.extensions import db

    up = dict(getattr(user_row, 'user_prices', None) or {})
    if method_ids is None:
        up.pop('payment_method_ids', None)
    else:
        up['payment_method_ids'] = [str(x).strip() for x in method_ids if str(x).strip()]
    user_row.user_prices = up
    db.session.commit()


def methods_for_currency(currency: str, enabled_only: bool = True) -> List[Dict[str, Any]]:
    cur = (currency or 'COP').strip().upper()
    if cur not in _USER_CURRENCIES:
        cur = 'COP'
    cfg = get_payment_methods_config()
    rows = cfg.get(cur) or []
    if enabled_only:
        rows = [
            m
            for m in rows
            if m.get('enabled') and payment_method_brand_configured(m)
        ]
    return rows


def _filter_methods_by_allowed_users(
    methods: List[Dict[str, Any]], user_row, viewer=None
) -> List[Dict[str, Any]]:
    billing_uid = int(getattr(user_row, 'id', 0) or 0)
    viewer_uid = int(getattr(viewer, 'id', 0) or 0) if viewer is not None else billing_uid
    visible_uids = {uid for uid in (billing_uid, viewer_uid) if uid > 0}
    filtered: List[Dict[str, Any]] = []
    for m in methods:
        method_users = m.get('allowed_user_ids')
        if method_users is None:
            filtered.append(m)
            continue
        if not isinstance(method_users, list) or len(method_users) == 0:
            continue
        allowed_ids = set()
        for x in method_users:
            try:
                uid = int(x)
            except (TypeError, ValueError):
                continue
            if uid > 0:
                allowed_ids.add(uid)
        if allowed_ids and visible_uids.intersection(allowed_ids):
            filtered.append(m)
    return filtered


def _is_nequi_classic(method: Dict[str, Any]) -> bool:
    """Nequi clásico (no Bre-B Nequi)."""
    if payment_method_is_breb_nequi(method):
        return False
    brand = str(method.get('payment_brand') or '').strip().lower()
    if brand == 'nequi':
        return True
    combined = _normalize_text_for_brand_match(
        f"{method.get('id') or ''} {method.get('label') or ''}"
    )
    if 'nequi' not in combined:
        return False
    return not any(tok in combined for tok in ('bre-b', 'bre b', 'breb', 'breve'))


def _is_bancolombia_classic(method: Dict[str, Any]) -> bool:
    if payment_method_is_breb_bancolombia(method) or payment_method_is_breb_nequi(method):
        return False
    brand = str(method.get('payment_brand') or '').strip().lower()
    if brand == 'bancolombia':
        return True
    combined = _normalize_text_for_brand_match(
        f"{method.get('id') or ''} {method.get('label') or ''}"
    )
    return 'bancolombia' in combined and not any(
        tok in combined for tok in ('bre-b', 'bre b', 'breb', 'breve')
    )


def _payment_method_user_display_sort_key(method: Dict[str, Any]) -> tuple:
    """
    Orden estable en recargas del usuario: agrupa por familia (Nequi, Bancolombia, etc.)
    y dentro de cada una deja clásico antes que Bre-B.
    """
    label = str(method.get('label') or '').strip().lower()
    mid = str(method.get('id') or '').strip().lower()
    brand = str(method.get('payment_brand') or '').strip().lower()
    if not brand:
        brand = _resolve_payment_brand(method, label, mid)

    if method.get('currency') == 'ACCUM':
        family, sub = 90, 0
    elif payment_method_is_breb_nequi(method):
        family, sub = 10, 2
    elif _is_nequi_classic(method):
        family, sub = 10, 1
    elif payment_method_is_breb_bancolombia(method):
        family, sub = 20, 2
    elif _is_bancolombia_classic(method):
        family, sub = 20, 1
    elif brand == 'daviplata' or 'daviplata' in label:
        family, sub = 30, 0
    elif brand in ('binance', 'usdt', 'usdt_erc20', 'usdt_trc20', 'binance_pay', 'criptomoneda'):
        family, sub = 40, 0
    elif brand == 'paypal' or 'paypal' in label:
        family, sub = 50, 0
    else:
        family, sub = 80, 0

    return (family, sub, label, mid)


def sort_payment_methods_for_user_display(
    methods: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    if not methods:
        return methods
    return sorted(methods, key=_payment_method_user_display_sort_key)


def methods_for_user(user_row, currency: str, viewer=None) -> List[Dict[str, Any]]:
    """Medios visibles por moneda. Si el medio tiene allowed_user_ids con IDs, solo esos usuarios."""
    all_methods = methods_for_currency(currency, enabled_only=True)
    filtered = _filter_methods_by_allowed_users(all_methods, user_row, viewer)
    return sort_payment_methods_for_user_display(filtered)


def methods_accum_for_user(user_row, user_tipo_precio: str, viewer=None) -> List[Dict[str, Any]]:
    """Medios acumulador: visibles si el usuario está asignado o la moneda de pago difiere del cliente."""
    user_tp = (user_tipo_precio or 'COP').strip().upper()
    if user_tp not in _USER_CURRENCIES:
        user_tp = 'COP'
    all_accum = methods_accumulator_bucket(enabled_only=True)
    filtered = _filter_methods_by_allowed_users(all_accum, user_row, viewer)
    out: List[Dict[str, Any]] = []
    for m in filtered:
        pc = (m.get('payment_currency') or 'COP').strip().upper()
        if pc not in _USER_CURRENCIES:
            pc = 'COP'
        method_users = m.get('allowed_user_ids')
        has_user_restriction = isinstance(method_users, list)
        if method_users is None and pc == user_tp:
            continue
        ent = dict(m)
        ent['payment_currency'] = pc
        ent['currency'] = 'ACCUM'
        out.append(ent)
    return out


def methods_for_user_with_accum(user_row, user_tipo_precio: str, viewer=None) -> List[Dict[str, Any]]:
    """Medios COP/USD del cliente más acumuladores aplicables."""
    tp = (user_tipo_precio or 'COP').strip().upper()
    regular = methods_for_user(user_row, tp, viewer=viewer)
    accum = sort_payment_methods_for_user_display(
        methods_accum_for_user(user_row, tp, viewer=viewer)
    )
    return regular + accum


def _collect_methods_by_id(method_id: str) -> List[Dict[str, Any]]:
    mid = (method_id or '').strip()
    if not mid:
        return []
    cfg = get_payment_methods_config()
    matches: List[Dict[str, Any]] = []
    mid_low = mid.lower()
    for bucket in _METHOD_BUCKETS:
        for m in cfg.get(bucket) or []:
            if m.get('id') == mid:
                ent = dict(m)
                ent.setdefault('currency', bucket)
                matches.append(ent)
            elif mid_low in _BRAND_ONLY_METHOD_IDS and str(m.get('payment_brand') or '').lower() == mid_low:
                ent = dict(m)
                ent.setdefault('currency', bucket)
                matches.append(ent)
    return matches


def _disambiguate_method_matches(
    matches: List[Dict[str, Any]],
    *,
    bre_b_llave: str = '',
    account_digits: str = '',
    currency: str = '',
) -> Optional[Dict[str, Any]]:
    """Elige un único medio cuando hay varias coincidencias (legacy id de marca)."""
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]

    pool = list(matches)
    cur = (currency or '').strip().upper()
    if cur:
        by_cur = [m for m in pool if (m.get('currency') or '').strip().upper() == cur]
        if len(by_cur) == 1:
            return by_cur[0]
        if by_cur:
            pool = by_cur

    hint = re.sub(r'[^A-Za-z0-9]', '', str(bre_b_llave or '')).upper()
    if hint:
        breb_hits = [
            m for m in pool
            if payment_method_breb_llave_normalized(m) == hint
        ]
        if len(breb_hits) == 1:
            return breb_hits[0]
        if breb_hits:
            pool = breb_hits

    acct_hint = _digits_only(account_digits)
    if acct_hint:
        acct_hits: List[Dict[str, Any]] = []
        for m in pool:
            configured = payment_method_account_digits(m)
            if configured and (
                acct_hint == configured
                or configured.endswith(acct_hint)
                or acct_hint.endswith(configured)
            ):
                acct_hits.append(m)
                continue
            tail = _method_account_tail_for_id(m)
            if tail and (acct_hint.endswith(tail) or acct_hint == tail):
                acct_hits.append(m)
        if len(acct_hits) == 1:
            return acct_hits[0]
        if acct_hits:
            pool = acct_hits

    if len(pool) == 1:
        return pool[0]
    return None


def _find_method_by_id(
    method_id: str,
    *,
    bre_b_llave: str = '',
    account_digits: str = '',
    currency: str = '',
) -> Optional[Dict[str, Any]]:
    mid = (method_id or '').strip()
    if not mid:
        return None
    matches = _collect_methods_by_id(mid)
    if not matches:
        return None
    resolved = _disambiguate_method_matches(
        matches,
        bre_b_llave=bre_b_llave,
        account_digits=account_digits,
        currency=currency,
    )
    if resolved:
        return resolved
    if len(matches) > 1:
        logger.warning(
            'Medio de pago ambiguo para id=%r (%d coincidencias); use id canónico o revise cuenta/llave.',
            mid,
            len(matches),
        )
    return None


def _parse_recharge_analyzer(
    recharge_row,
    analyzer: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    if isinstance(analyzer, dict):
        return analyzer
    raw = getattr(recharge_row, 'analyzer_json', None)
    if not raw:
        return None
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def build_payment_method_snapshot(
    *,
    payment_method_id: str,
    payment_method_label: str,
    payment_method: Optional[Dict[str, Any]],
    currency: str,
    expected_account: str,
    breb_llave_expected: str,
    is_breb_bancolombia: bool,
    is_breb_nequi: bool = False,
) -> Dict[str, Any]:
    """Congela cuenta/llave/marca del medio al enviar la solicitud (paso 7)."""
    pm_id = str(payment_method_id or '').strip()
    label = str(payment_method_label or '').strip()
    brand = str((payment_method or {}).get('payment_brand') or '').strip().lower()
    if not brand:
        brand = _resolve_payment_brand(payment_method or {}, label, pm_id)
    return {
        'frozen_at_submit': True,
        'payment_method_id': pm_id or None,
        'label': label or None,
        'payment_brand': brand or None,
        'currency': (currency or 'COP').strip().upper(),
        'account_expected_digits': _digits_only(expected_account) or None,
        'bre_b_llave_expected': str(breb_llave_expected or '').strip() or None,
        'is_breb_bancolombia': bool(is_breb_bancolombia),
        'is_breb_nequi': bool(is_breb_nequi),
        'is_generic': payment_method_is_generic(payment_method, pm_id, label),
    }


def recharge_frozen_payment_context(
    recharge_row,
    analyzer: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Contexto del medio al enviar; no usa la configuración admin actual si hay snapshot."""
    data = _parse_recharge_analyzer(recharge_row, analyzer)
    pm_id = str(getattr(recharge_row, 'payment_method_id', '') or '').strip()
    currency = str(getattr(recharge_row, 'currency', '') or 'COP').strip().upper()

    if isinstance(data, dict):
        snap = data.get('payment_method_snapshot')
        if isinstance(snap, dict) and snap.get('payment_method_id'):
            return dict(snap)
        if data.get('account_expected_digits') is not None or data.get('payment_method_label'):
            label = str(data.get('payment_method_label') or '').strip()
            brand = str(data.get('payment_brand') or '').strip().lower()
            if not brand:
                brand = _resolve_payment_brand({}, label, pm_id)
            return {
                'frozen_at_submit': True,
                'payment_method_id': pm_id or None,
                'label': label or None,
                'payment_brand': brand or None,
                'currency': currency,
                'account_expected_digits': _digits_only(
                    str(data.get('account_expected_digits') or '')
                )
                or None,
                'bre_b_llave_expected': str(data.get('bre_b_llave_expected') or '').strip() or None,
                'is_breb_bancolombia': bool(data.get('is_breb_bancolombia')),
                'is_breb_nequi': bool(data.get('is_breb_nequi')),
                'is_generic': bool(data.get('payment_method_is_generic')),
            }

    method = find_payment_method_for_recharge(recharge_row, data)
    if method:
        return build_payment_method_snapshot(
            payment_method_id=pm_id,
            payment_method_label=str(method.get('label') or ''),
            payment_method=method,
            currency=currency,
            expected_account=payment_method_account_digits(method),
            breb_llave_expected=payment_method_breb_llave_normalized(method),
            is_breb_bancolombia=payment_method_is_breb_bancolombia(method),
            is_breb_nequi=payment_method_is_breb_nequi(method),
        )
    return {
        'frozen_at_submit': False,
        'payment_method_id': pm_id or None,
        'label': None,
        'payment_brand': None,
        'currency': currency,
        'account_expected_digits': None,
        'bre_b_llave_expected': None,
        'is_breb_bancolombia': False,
        'is_breb_nequi': False,
        'is_generic': False,
    }


def frozen_payment_method_dict(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Dict compatible con helpers de medio a partir del snapshot congelado."""
    acct = _digits_only(str(ctx.get('account_expected_digits') or ''))
    llave = str(ctx.get('bre_b_llave_expected') or '').strip()
    out: Dict[str, Any] = {
        'id': str(ctx.get('payment_method_id') or ''),
        'label': str(ctx.get('label') or ''),
        'payment_brand': str(ctx.get('payment_brand') or ''),
        'currency': str(ctx.get('currency') or ''),
        'account_number': acct,
        'bre_b_llave': llave,
    }
    if ctx.get('is_breb_nequi'):
        out['payment_brand'] = out.get('payment_brand') or 'breb_nequi'
    elif ctx.get('is_breb_bancolombia'):
        out['payment_brand'] = out.get('payment_brand') or 'breb_bancolombia'
        if len(acct) >= 4:
            out['bre_b_account_suffix'] = acct[-4:]
    return out


def expected_account_digits_for_recharge(
    recharge_row,
    analyzer: Optional[Dict[str, Any]] = None,
) -> str:
    ctx = recharge_frozen_payment_context(recharge_row, analyzer)
    return _digits_only(str(ctx.get('account_expected_digits') or ''))


def payment_context_is_binance(ctx: Dict[str, Any]) -> bool:
    brand = str(ctx.get('payment_brand') or '').strip().lower()
    if brand in ('usdt_erc20', 'usdt_trc20'):
        return False
    if brand in ('binance', 'usdt', 'binance_pay'):
        return True
    pm_id = str(ctx.get('payment_method_id') or '').strip().lower()
    if 'erc20' in pm_id or 'trc20' in pm_id:
        return False
    return any(token in pm_id for token in ('binance', 'binanse', 'usdt'))


def payment_context_uses_relaxed_email_rules(ctx: Dict[str, Any]) -> bool:
    """
    Solo Binance: Pay y wallets USDT on-chain (ERC20/TRC20, incl. acumulador).
    El resto de medios (Nequi, Bre-B, bancos, PayPal…) mantiene verificación estricta por correo.
    """
    if payment_context_is_binance(ctx):
        return True
    brand = str(ctx.get('payment_brand') or '').strip().lower()
    if brand in ('usdt_erc20', 'usdt_trc20'):
        return True
    pm_id = str(ctx.get('payment_method_id') or '').strip().lower()
    if 'erc20' in pm_id or 'trc20' in pm_id:
        return True
    return False


def payment_method_for_recharge_validation(
    recharge_row,
    analyzer: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Medio para validar correo/OCR: prioriza snapshot del envío."""
    ctx = recharge_frozen_payment_context(recharge_row, analyzer)
    if ctx.get('frozen_at_submit'):
        return frozen_payment_method_dict(ctx)
    return find_payment_method_for_recharge(recharge_row, analyzer)


def find_payment_method_for_recharge(
    recharge_row,
    analyzer: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Resuelve el medio Bre-B correcto aunque el id guardado sea genérico (legacy)."""
    pm_id = str(getattr(recharge_row, 'payment_method_id', '') or '').strip()
    if not pm_id:
        return None
    llave_hint = ''
    if analyzer is None:
        raw = getattr(recharge_row, 'analyzer_json', None)
        if raw:
            try:
                analyzer = json.loads(raw) if isinstance(raw, str) else raw
            except (json.JSONDecodeError, TypeError):
                analyzer = None
    acct_hint = ''
    if isinstance(analyzer, dict):
        llave_hint = str(analyzer.get('bre_b_llave_expected') or '').strip()
        if not llave_hint:
            detected = analyzer.get('bre_b_llaves_detected') or []
            if detected:
                llave_hint = str(detected[0] or '')
        acct_hint = str(analyzer.get('account_expected_digits') or '').strip()
    else:
        llave_hint = ''
    currency_hint = str(getattr(recharge_row, 'currency', '') or '').strip()
    method = _find_method_by_id(
        pm_id,
        bre_b_llave=llave_hint,
        account_digits=acct_hint,
        currency=currency_hint,
    )
    if method:
        return method
    hint = re.sub(r'[^A-Za-z0-9]', '', llave_hint).upper()
    if hint:
        cfg = get_payment_methods_config()
        for bucket in _METHOD_BUCKETS:
            for m in cfg.get(bucket) or []:
                if payment_method_breb_llave_normalized(m) == hint:
                    return dict(m)
    if pm_id in _GENERIC_BREB_METHOD_IDS:
        return _find_method_by_id(breb_method_id_from_llave(hint), bre_b_llave=llave_hint) if hint else None
    return None


def is_accumulator_method_id(method_id: str) -> bool:
    return get_accumulator_method(method_id) is not None


def accumulator_method_ids() -> List[str]:
    ids: List[str] = []
    for m in get_payment_methods_config().get('ACCUM') or []:
        mid = str(m.get('id') or '').strip()
        if mid and mid not in ids:
            ids.append(mid)
    return ids


def get_accumulator_method(method_id: str) -> Optional[Dict[str, Any]]:
    mid = (method_id or '').strip()
    if not mid:
        return None
    candidates = [mid]
    if not mid.startswith('accum_'):
        candidates.append(_apply_currency_method_id_prefix(mid, 'ACCUM'))
    seen_cand: set[str] = set()
    for cand in candidates:
        if not cand or cand in seen_cand:
            continue
        seen_cand.add(cand)
        for m in get_payment_methods_config().get('ACCUM') or []:
            if m.get('id') == cand:
                ent = dict(m)
                pc = (ent.get('payment_currency') or 'COP').strip().upper()
                ent['payment_currency'] = 'USD' if pc in ('USD', 'USDT') else 'COP'
                return ent
    return None


def method_label_by_id(currency: str, method_id: str) -> str:
    mid = (method_id or '').strip()
    for m in methods_for_currency(currency, enabled_only=False):
        if m.get('id') == mid:
            return m.get('label') or mid
    accum = get_accumulator_method(mid)
    if accum:
        return accum.get('label') or mid
    return mid or '—'


def method_label_by_id_any(method_id: str) -> str:
    m = _find_method_by_id(method_id)
    if m:
        return m.get('label') or (method_id or '—')
    return (method_id or '').strip() or '—'


def methods_accumulator_bucket(enabled_only: bool = True) -> List[Dict[str, Any]]:
    """Medios del contenedor acumulador (pagos en moneda distinta a la del cliente)."""
    cfg = get_payment_methods_config()
    rows = cfg.get('ACCUM') or []
    if enabled_only:
        rows = [
            m
            for m in rows
            if m.get('enabled') and payment_method_brand_configured(m)
        ]
    return rows


def method_bucket_display_name(bucket: str) -> str:
    key = (bucket or '').strip().upper()
    if key == 'USD':
        return 'USDT (USD)'
    if key == 'ACCUM':
        return 'Acumulador — conversión manual'
    return key or 'COP'


def currency_display_name(currency: str) -> str:
    c = (currency or '').strip().upper()
    return 'USDT' if c == 'USD' else c
