# Medios de pago para recargas de saldo (COP / USDT-USD) y restricciones por usuario.

import base64
import json
import os
import re
import uuid
from typing import Any, Dict, List, Optional

from app.store.models import StoreSetting

SETTINGS_KEY = 'balance_recharge_payment_methods'
QR_UPLOAD_SUBDIR = ('uploads', 'payment_method_qr')
_MAX_QR_BYTES = 4 * 1024 * 1024

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


def payment_method_qr_upload_dir(app) -> str:
    upload_dir = os.path.join(app.instance_path, *QR_UPLOAD_SUBDIR)
    os.makedirs(upload_dir, exist_ok=True)
    return upload_dir


def _slug_method_id(label: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '_', (label or '').strip().lower())
    s = s.strip('_')
    return s[:48] or 'medio'


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
    return out


def _normalize_method_entry(raw: Dict[str, Any], currency: str, idx: int) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    label = str(raw.get('label') or '').strip()
    if not label:
        return None
    mid = str(raw.get('id') or '').strip() or _slug_method_id(label)
    mid = re.sub(r'[^a-z0-9_\-]', '', mid.lower())[:48] or f'medio_{idx}'
    qr_filename = str(raw.get('qr_filename') or '').strip()
    if qr_filename:
        qr_filename = os.path.basename(qr_filename)[:120]
    else:
        qr_filename = ''
    ent = {
        'id': mid,
        'label': label[:80],
        'details': str(raw.get('details') or '').strip()[:500],
        'enabled': bool(raw.get('enabled', True)),
        'currency': currency,
        'allowed_user_ids': _normalize_allowed_user_ids(raw.get('allowed_user_ids')),
    }
    if qr_filename:
        ent['qr_filename'] = qr_filename
    return ent


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
    for cur in _CURRENCY_KEYS:
        lst = payload.get(cur) if isinstance(payload, dict) else None
        if not isinstance(lst, list):
            out[cur] = []
            continue
        normalized = []
        for i, item in enumerate(lst):
            if not isinstance(item, dict):
                continue
            ent = _normalize_method_entry(item, cur, i)
            if not ent:
                continue
            mid = ent['id']
            prev = prev_by_id.get(mid) or {}
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
            normalized.append(ent)
        out[cur] = normalized

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
    if cur not in _CURRENCY_KEYS:
        cur = 'COP'
    cfg = get_payment_methods_config()
    rows = cfg.get(cur) or []
    if enabled_only:
        rows = [m for m in rows if m.get('enabled')]
    return rows


def methods_for_user(user_row, currency: str, viewer=None) -> List[Dict[str, Any]]:
    """Medios visibles por moneda. Si el medio tiene allowed_user_ids con IDs, solo esos usuarios."""
    all_methods = methods_for_currency(currency, enabled_only=True)
    billing_uid = int(getattr(user_row, 'id', 0) or 0)
    viewer_uid = int(getattr(viewer, 'id', 0) or 0) if viewer is not None else billing_uid
    visible_uids = {uid for uid in (billing_uid, viewer_uid) if uid > 0}
    filtered: List[Dict[str, Any]] = []
    for m in all_methods:
        method_users = m.get('allowed_user_ids')
        if isinstance(method_users, list) and len(method_users) > 0:
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
            continue
        filtered.append(m)
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
