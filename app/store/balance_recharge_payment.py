# Medios de pago para recargas de saldo (COP / USDT-USD) y restricciones por usuario.

import json
import re
from typing import Any, Dict, List, Optional

from app.store.models import StoreSetting

SETTINGS_KEY = 'balance_recharge_payment_methods'

_DEFAULT_METHODS: Dict[str, List[Dict[str, Any]]] = {
    'COP': [
        {
            'id': 'nequi',
            'label': 'Nequi',
            'details': 'Indica tu número Nequi en la nota si lo necesitas el admin.',
            'enabled': True,
        },
        {
            'id': 'bancolombia',
            'label': 'Bancolombia / transferencia',
            'details': 'Cuenta de ahorros (configura los datos en administración).',
            'enabled': True,
        },
    ],
    'USD': [
        {
            'id': 'usdt',
            'label': 'USDT',
            'details': 'Envía comprobante de red TRC20 o la que indique administración.',
            'enabled': True,
        },
    ],
}

_CURRENCY_KEYS = ('COP', 'USD')


def _slug_method_id(label: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '_', (label or '').strip().lower())
    s = s.strip('_')
    return s[:48] or 'medio'


def _normalize_method_entry(raw: Dict[str, Any], currency: str, idx: int) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    label = str(raw.get('label') or '').strip()
    if not label:
        return None
    mid = str(raw.get('id') or '').strip() or _slug_method_id(label)
    mid = re.sub(r'[^a-z0-9_\-]', '', mid.lower())[:48] or f'medio_{idx}'
    return {
        'id': mid,
        'label': label[:80],
        'details': str(raw.get('details') or '').strip()[:500],
        'enabled': bool(raw.get('enabled', True)),
        'currency': currency,
    }


def get_payment_methods_config() -> Dict[str, List[Dict[str, Any]]]:
    row = StoreSetting.query.filter_by(key=SETTINGS_KEY).first()
    out: Dict[str, List[Dict[str, Any]]] = {}
    for cur in _CURRENCY_KEYS:
        out[cur] = [dict(x) for x in _DEFAULT_METHODS.get(cur, [])]
    if not row or not row.value:
        return out
    try:
        data = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return out
    if not isinstance(data, dict):
        return out
    for cur in _CURRENCY_KEYS:
        lst = data.get(cur)
        if not isinstance(lst, list):
            continue
        normalized = []
        for i, item in enumerate(lst):
            ent = _normalize_method_entry(item, cur, i)
            if ent:
                normalized.append(ent)
        if normalized:
            out[cur] = normalized
    return out


def save_payment_methods_config(payload: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    from app.extensions import db

    out: Dict[str, List[Dict[str, Any]]] = {}
    for cur in _CURRENCY_KEYS:
        lst = payload.get(cur) if isinstance(payload, dict) else None
        if not isinstance(lst, list):
            out[cur] = []
            continue
        normalized = []
        for i, item in enumerate(lst):
            ent = _normalize_method_entry(item, cur, i)
            if ent:
                normalized.append(ent)
        out[cur] = normalized
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
    if cur not in _CURRENCY_KEYS:
        cur = 'COP'
    cfg = get_payment_methods_config()
    rows = cfg.get(cur) or []
    if enabled_only:
        rows = [m for m in rows if m.get('enabled')]
    return rows


def methods_for_user(user_row, currency: str) -> List[Dict[str, Any]]:
    """Medios visibles para el usuario según moneda y restricción opcional."""
    all_methods = methods_for_currency(currency, enabled_only=True)
    allowed = _user_payment_method_ids(user_row)
    if allowed is None:
        return all_methods
    allowed_set = set(allowed)
    filtered = [m for m in all_methods if m.get('id') in allowed_set]
    return filtered


def method_label_by_id(currency: str, method_id: str) -> str:
    mid = (method_id or '').strip()
    for m in methods_for_currency(currency, enabled_only=False):
        if m.get('id') == mid:
            return m.get('label') or mid
    return mid or '—'


def currency_display_name(currency: str) -> str:
    c = (currency or '').strip().upper()
    return 'USDT' if c == 'USD' else c
