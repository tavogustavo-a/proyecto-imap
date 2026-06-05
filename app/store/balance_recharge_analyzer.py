# app/store/balance_recharge_analyzer.py
"""Análisis automático de comprobantes de recarga (OCR + patrones extensibles)."""

from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from datetime import date, datetime, time
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from app.extensions import db
from app.store.models import BalanceRecharge, StoreSetting

SETTING_KEY = 'balance_recharge_analyzer_patterns'

# Ventana para acreditar automático: comprobante hasta N días antes del envío (pago ayer, carga hoy).
RECHARGE_UPLOAD_DATE_MAX_DAYS_BEFORE = 3
RECHARGE_UPLOAD_DATE_MAX_DAYS_AFTER = 1

_SPANISH_MONTHS = {
    'ene': 1, 'enero': 1,
    'feb': 2, 'febrero': 2,
    'mar': 3, 'marzo': 3,
    'abr': 4, 'abril': 4,
    'may': 5, 'mayo': 5,
    'jun': 6, 'junio': 6,
    'jul': 7, 'julio': 7,
    'ago': 8, 'agosto': 8,
    'sep': 9, 'sept': 9, 'septiembre': 9,
    'oct': 10, 'octubre': 10,
    'nov': 11, 'noviembre': 11,
    'dic': 12, 'diciembre': 12,
}

# Patrones basados en comprobantes reales; el admin puede ampliarlos vía API.
DEFAULT_PATTERNS: list[dict[str, Any]] = [
    {
        'id': 'bancolombia_app_transfer',
        'label': 'App Bancolombia — Transferencia exitosa',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['bancolombia'],
        'text_must_contain': ['transferencia exitosa', 'comprobante'],
        'amount_regexes': [
            r'(?:valor de la transferencia)[^\$]{0,80}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
            r'(?:valor|monto|transferencia)[^\d]{0,25}(\d{4,9})',
        ],
        'receipt_regexes': [
            r'comprobante\s*no\.?\s*(\d{6,12})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
            r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
        ],
        'account_regexes': [
            r'(?:producto\s+destino|cuenta\s+destino|destino|ahorros)[^\d]{0,100}'
            r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
            r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
            r'\b(\d{11})\b',
        ],
    },
    {
        'id': 'bancolombia_email_notify',
        'label': 'Correo Bancolombia — Transferencia recibida',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['bancolombia'],
        'text_must_contain': ['bancolombia', 'recibiste una transferencia'],
        'amount_regexes': [
            r'(?:recibiste\s+una\s+transferencia\s+por)\s+\$\s*([\d][\d,.\s]*)',
            r'\$\s*([\d][\d,.\s]*)',
        ],
        'receipt_regexes': [],
        'date_regexes': [
            r'el\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+a\s+las',
        ],
        'time_regexes': [
            r'a\s+las\s+(\d{1,2}:\d{2})(?!\s*:\d)',
        ],
        'datetime_regexes': [
            r'el\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+a\s+las\s+(\d{1,2}:\d{2})',
        ],
        'account_regexes': [
            r'(?:en\s+tu\s+cuenta|cuenta)\s+\*+(\d{2,4})',
            r'conectada\s+a\s+la\s+llave\s+@?([a-z0-9]{4,32})',
        ],
    },
    {
        'id': 'kamin_breb_comprobante',
        'label': 'Kamin / Bre-B — Comprobante (envío a llave)',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['bre-b', 'breve', 'kamin', 'breb', 'bre_b'],
        'text_must_contain': ['kamin', 'comprobante'],
        'amount_regexes': [
            r'(?:^|\s)monto\s*\n?\s*\$?\s*([\d][\d.\s,]*)',
            r'monto[^\$\d]{0,60}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'(?:referencia)[^\w]{0,40}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
        ],
        'date_regexes': [
            r'(?:fecha\s+de\s+emisi[oó]n|data\s+y\s+hora\s+de\s+la\s+transacci[oó]n)\s*:\s*'
            r'(\d{1,2}/\d{1,2}/\d{4})',
            r'(\d{1,2}/\d{1,2}/\d{4})',
        ],
        'time_regexes': [
            r'(?:fecha\s+de\s+emisi[oó]n|data\s+y\s+hora)[^\d]{0,30}(\d{1,2}:\d{2})',
        ],
        'datetime_regexes': [
            r'(\d{1,2}/\d{1,2}/\d{4})\s+(\d{1,2}:\d{2})',
        ],
        'account_regexes': [
            r'(?:llave\s+bre-?\s*b|llave)\s*[:\s]*@?([a-z0-9]{4,32})',
        ],
    },
    {
        'id': 'nequi_comprobante_pago',
        'label': 'Nequi — Comprobante de pago',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['nequi'],
        'text_must_contain': ['nequi'],
        'amount_regexes': [
            r'(?:cu[aá]nto\??)[^\$\d]{0,50}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'(?:referencia)[\s\S]{0,50}?([Mm]\s*\d{7,10})',
            r'(?:referencia)[^\d]{0,25}(\d{6,14})',
            r'(?:comprobante|transaccion|transacción)\s*(?:no\.?|n[°o]\.?|#)?\s*(\d{6,14})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+\d{4})',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
            r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
            r'(\d{1,2}:\d{2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+\d{4})\s+'
            r'(?:a\s+las|alas)\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})\s+'
            r'(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
        ],
        'account_regexes': [
            r'(?:numero|n[uú]mero)\s+nequi[^\d]{0,50}(\d{3}\s*\d{3}\s*\d{4})',
        ],
    },
    {
        'id': 'nequi_envio_bancolombia',
        'label': 'Nequi — Envío a banco (Bancolombia)',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['bancolombia'],
        'text_must_contain': ['bancolombia', 'envio a banco'],
        'amount_regexes': [
            r'(?:cu[aá]nto\??)[^\$\d]{0,50}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'(?:referencia)[\s\S]{0,50}?([Mm]\s*\d{7,10})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+\d{4})',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+\d{4})\s+'
            r'(?:a\s+las|alas)\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
        ],
        'account_regexes': [
            r'(?:numero\s+de\s+cuenta|n[uú]mero\s+de\s+cuenta)[^\d]{0,60}(\d{10,12})',
            r'(?:banco)[^\d]{0,100}(\d{10,12})',
        ],
    },
    {
        'id': 'daviplata_app_transfer',
        'label': 'App DaviPlata — Transacción exitosa',
        'currencies': ['COP', 'USD'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['daviplata', 'davi plata'],
        'text_must_contain': ['daviplata', 'pasaste plata'],
        'amount_regexes': [
            r'(?:valor)[^\$\d]{0,50}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'(?:numero|ndmero|namero|n[uú]mero)\s+de\s+aprobaci[oó6n\w]{0,8}\s*[:\s]*(\d{4,12})',
            r'aprobaci[oó6n\w]{0,10}[^\d]{0,40}(\d{5,12})',
        ],
        'date_regexes': [
            r'((?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+\d{1,2}\s+(?:de\s+)?\d{4})',
            r'((?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+o[l1]de\s+\d{4})',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'((?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{1,2}\s+de\s+\d{4})\s*[-–—]\s*'
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})\s*[-–—]\s*'
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'account_regexes': [
            r'(?:pasaste\s+plata|otro\s+daviplata|plata\s+a)[^\d]{0,200}(\d{3}\s*\d{3}\s*\d{4})',
            r'(?:a\s+gustavo|patino|sanchez)[^\d]{0,120}(\d{3}\s*\d{3}\s*\d{4})',
        ],
    },
    {
        'id': 'binance_pago_completado_usdt',
        'label': 'Binance Pay — Pago completado / exitoso (USDT)',
        'currencies': ['USD', 'USDT'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['usdt', 'binance', 'binanse'],
        'text_must_contain': ['usdt'],
        'amount_regexes': [
            r'monto\s*:\s*(\d+(?:[.,]\d+)?)\s*usdt',
            r'pagado\s+con[^\d]{0,25}(\d+(?:[.,]\d+)?)\s*usdt',
            r'pago\s+exitoso[^\d]{0,120}(\d+(?:[.,]\d+)?)\s*usdt',
            r'pago\s+completado[^\d]{0,120}(\d+(?:[.,]\d+)?)\s*usdt',
            r'(\d{1,7}(?:[.,]\d+)?)\s*usdt',
        ],
        'receipt_regexes': [
            r'Id\.\s*de\s+la\s+orden\s+(\d{12,22})',
            r'(?:id\.?\s*de\s+(?:la\s+)?orden|order\s+id)[^\d]{0,40}(\d{12,22})',
        ],
        'date_regexes': [
            r'(?:fecha\s+y\s+hora|fecha)\s*:\s*(\d{4}-\d{2}-\d{2})',
        ],
        'time_regexes': [
            r'(?:fecha\s+y\s+hora|fecha)\s*:\s*\d{4}-\d{2}-\d{2}\s+(\d{1,2}:\d{2}(?::\d{2})?)',
        ],
        'datetime_regexes': [],
        'account_regexes': [
            r'(\d{8,12})\s+Id\.\s*de\s+la\s+orden',
            r'pago\s+exitoso[^\d]{0,120}(\d{8,12})\s+Id\.\s*de\s+la\s+orden',
            r'(?:ttavo\)|colombia)[^\d]{0,160}(\d{8,12})',
        ],
    },
]


def get_analyzer_patterns() -> list[dict[str, Any]]:
    """Patrones definidos en código (DEFAULT_PATTERNS). UI admin deshabilitada por ahora."""
    return list(DEFAULT_PATTERNS)


def save_analyzer_patterns(patterns: list[dict]) -> None:
    if not isinstance(patterns, list):
        raise ValueError('patterns debe ser una lista')
    row = StoreSetting.query.filter_by(key=SETTING_KEY).first()
    payload = json.dumps(patterns, ensure_ascii=False)
    if row:
        row.value = payload
    else:
        db.session.add(StoreSetting(key=SETTING_KEY, value=payload))
    db.session.commit()


def proof_image_hash(image_path: str) -> str:
    h = hashlib.sha256()
    with open(image_path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def digits_only(value: str) -> str:
    return re.sub(r'\D', '', str(value or ''))


def account_digits_from_details(details: str) -> str:
    """Extrae dígitos de cuenta esperados desde los datos del medio de pago (legacy)."""
    d = digits_only(details)
    return d if len(d) >= 8 else ''


def account_digits_from_payment_method(method: dict | str) -> str:
    """Dígitos de cuenta del medio: prioriza account_number; fallback a details legacy."""
    if isinstance(method, dict):
        acct = digits_only(str(method.get('account_number') or ''))
        if acct:
            return acct if len(acct) >= 4 else ''
        return account_digits_from_details(method.get('details') or '')
    return account_digits_from_details(str(method or ''))


def find_duplicate_recharge(
    *,
    receipt_number: str | None,
    proof_image_hash: str | None,
    user_id: int,
) -> dict[str, Any] | None:
    """
    Devuelve información del duplicado si la imagen o el comprobante ya existen.
    """
    receipt = (receipt_number or '').strip()
    img_hash = (proof_image_hash or '').strip()

    if img_hash:
        row = BalanceRecharge.query.filter_by(proof_image_hash=img_hash).first()
        if row:
            return _duplicate_payload(row, user_id, 'image')

    if receipt:
        row = BalanceRecharge.query.filter_by(receipt_number=receipt).first()
        if row:
            return _duplicate_payload(row, user_id, 'receipt')

    return None


def _duplicate_payload(row: BalanceRecharge, user_id: int, kind: str) -> dict[str, Any]:
    from app.models.user import User

    same_user = int(row.user_id) == int(user_id)
    other = User.query.get(row.user_id)
    other_name = other.username if other else 'otro usuario'
    if same_user:
        message = 'Esta imagen ya se envió.'
    else:
        message = f'Un usuario diferente ({other_name}) ya envió esta imagen.'
    return {
        'kind': kind,
        'same_user': same_user,
        'message': message,
        'existing_id': row.id,
        'existing_user_id': row.user_id,
        'existing_username': other_name,
        'receipt_number': getattr(row, 'receipt_number', None),
    }


def _normalize_amount(raw: str) -> Decimal | None:
    """Interpreta montos COP/USD con o sin separadores (. , espacio)."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    s = re.sub(r'^[\$\s]+|[\s]+$', '', s)
    s = s.replace(' ', '')
    if not s or not re.search(r'\d', s):
        return None

    if re.fullmatch(r'\d+', s):
        val = Decimal(s)
        return val if val > 0 else None

    if re.fullmatch(r'\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?', s):
        whole = s.split(',')[0].replace('.', '')
        val = Decimal(whole)
        return val if val > 0 else None

    if re.fullmatch(r'\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?', s):
        whole = s.split('.')[0].replace(',', '')
        val = Decimal(whole)
        return val if val > 0 else None

    if re.fullmatch(r'\d+\.\d+', s):
        whole, frac = s.split('.', 1)
        if len(frac) == 3:
            val = Decimal(whole + frac)
            return val if val > 0 else None
        val = Decimal(s)
        return val if val > 0 else None

    if re.fullmatch(r'\d+,\d+', s):
        whole, frac = s.split(',', 1)
        if len(frac) == 3:
            val = Decimal(whole + frac)
            return val if val > 0 else None
        val = Decimal(s.replace(',', '.'))
        return val if val > 0 else None

    digits = digits_only(s)
    if len(digits) >= 3:
        val = Decimal(digits)
        return val if val > 0 else None

    try:
        val = Decimal(s.replace(',', '.'))
    except (InvalidOperation, ValueError):
        return None
    return val if val > 0 else None


def parse_recharge_amount(raw: str | int | float | Decimal | None) -> Decimal | None:
    """Parsea monto declarado por el usuario (539,000 · 539.000 · 539000)."""
    if raw is None:
        return None
    if isinstance(raw, Decimal):
        return raw if raw > 0 else None
    if isinstance(raw, (int, float)):
        val = Decimal(str(raw))
        return val if val > 0 else None
    return _normalize_amount(str(raw))


def _amount_whole_units(value: Decimal | float) -> int:
    return int(round(float(value)))


def _quantize_money(value: Decimal | float, currency: str) -> Decimal:
    """COP: pesos enteros. USD/USDT: exactamente 2 decimales (centavos cuentan)."""
    cur = (currency or 'COP').upper()
    try:
        v = Decimal(str(value))
    except (InvalidOperation, ValueError):
        v = Decimal('0')
    if cur in ('USD', 'USDT'):
        return v.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return Decimal(_amount_whole_units(v))


def _amounts_equivalent(claimed: Decimal | float, detected: Decimal | float, currency: str = 'COP') -> bool:
    """Compara montos: COP con tolerancia mínima en pesos; USD/USDT centavo a centavo."""
    cur = (currency or 'COP').upper()
    if cur in ('USD', 'USDT'):
        return _quantize_money(claimed, cur) == _quantize_money(detected, cur)
    ci = _amount_whole_units(claimed)
    di = _amount_whole_units(detected)
    if ci == di:
        return True
    return abs(ci - di) <= max(1, int(abs(ci) * 0.01))


def _scan_amounts_in_text(text: str) -> list[Decimal]:
    """Busca montos en texto OCR con regex flexibles (con/sin . o ,)."""
    regexes = [
        r'(?:valor de la transferencia|valor|monto|total)[^\$\d]{0,40}\$\s*([\d][\d.\s,]*)',
        r'\$\s*([\d][\d.\s,]*)',
        r'(?:valor|monto|transferencia)[^\d]{0,25}(\d{4,9})\b',
        r'\b(\d{1,3}(?:[.,]\d{3})+)\b',
        r'\b(\d{5,9})\b',
    ]
    found: list[Decimal] = []
    for raw in _find_by_regexes(text, regexes, group=True):
        val = _normalize_amount(raw)
        if val is not None and val not in found:
            found.append(val)
    return found


def _normalize_ocr_text(text: str) -> str:
    """Corrige lecturas OCR frecuentes en comprobantes DaviPlata / Nequi / bancos."""
    if not text:
        return ''
    t = text
    t = re.sub(r'(?im)^IMG\s+\d+\s*x\s*\d+\s*\n?', '', t)
    t = re.sub(r'(?i)\bolde\b', '01 de', t)
    t = re.sub(r'(?i)\bo1\s*de\b', '01 de', t)
    t = re.sub(r'(?i)\bnamero\b', 'numero', t)
    t = re.sub(r'(?i)\bndmero\b', 'numero', t)
    t = re.sub(r'(?i)\balas\b', 'a las', t)
    t = re.sub(r'(?i)(referencia\s*\n?\s*)\d\s+([Mm]\d)', r'\1\2', t)
    t = re.sub(r'(?i)env[ií]o\s+a\s+banco', 'envio a banco', t)
    t = re.sub(r'(?i)\bbinanse\b', 'binance', t)
    t = re.sub(r'(?i)\bpago\s+exitos[o0]\b', 'pago exitoso', t)
    t = re.sub(r'(?i)id\.?\s*de\s+(?:la\s+)?orden', 'Id. de la orden', t)
    t = re.sub(r'(?i)(\d{1,2}:\d{2})(a\.m\.|p\.m\.)', r'\1 \2', t)
    return t


def _normalize_receipt_token(raw: str) -> str:
    """Referencia/comprobante: conserva prefijos alfanuméricos (ej. M20318884)."""
    s = re.sub(r'[^A-Za-z0-9]', '', str(raw or '').strip())
    return s.upper() if len(s) >= 4 else ''


def _normalize_text_for_match(text: str) -> str:
    t = unicodedata.normalize('NFD', (_normalize_ocr_text(text) or '').lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    for src, dst in (
        ('transacci6n', 'transaccion'),
        ('transacci0n', 'transaccion'),
    ):
        t = t.replace(src, dst)
    return re.sub(r'\s+', ' ', t)


def _text_contains_all(text: str, terms: list[str]) -> bool:
    norm = _normalize_text_for_match(text)
    return all(_normalize_text_for_match(term) in norm for term in terms if str(term).strip())


def _text_looks_like_binance_usdt_comprobante(text: str) -> bool:
    """Comprobante Binance Pay / spot USDT (no Nequi, Bancolombia, etc.)."""
    norm = _normalize_text_for_match(text)
    if 'usdt' not in norm:
        return False
    return any(
        tok in norm
        for tok in (
            'pago completado',
            'pago exitoso',
            'binance',
            'binanse',
            'cuenta de spot',
            'id de la orden',
            'pagado con',
            'metodo de pago',
        )
    )


def _digits_embedded_in_long_id(digits: str, text: str, min_run: int = 14) -> bool:
    """Evita tomar fragmentos del Id. de orden Binance (15+ dígitos) como cuenta."""
    d = digits_only(digits)
    if len(d) < 10:
        return False
    norm = digits_only(text)
    if d not in norm:
        return False
    for m in re.finditer(r'\d{%d,}' % min_run, norm):
        if d in m.group(0):
            return True
    return False


_BINANCE_RELATED_BRANDS = frozenset({'binance', 'usdt', 'binance_pay'})


def _configure_tesseract() -> bool:
    """Configura ruta de Tesseract (instalación del sistema)."""
    try:
        import pytesseract
    except ImportError:
        return False

    if not getattr(_configure_tesseract, '_done', False):
        candidates = [
            os.environ.get('TESSERACT_CMD'),
            r'C:\Program Files\Tesseract-OCR\tesseract.exe',
            r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
        ]
        for path in candidates:
            if path and os.path.isfile(path):
                pytesseract.pytesseract.tesseract_cmd = path
                break

        _configure_tesseract._done = True

    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _load_image_rgb(image_path: str):
    from PIL import Image, ImageOps

    with Image.open(image_path) as img:
        return ImageOps.exif_transpose(img).convert('RGB')


def _ocr_variants(img):
    from PIL import Image, ImageEnhance, ImageOps

    w, h = img.size
    gray = ImageOps.grayscale(img)
    gw = max(w // 4, 1)
    gh = max(h // 4, 1)
    small = gray.resize((gw, gh), Image.Resampling.BILINEAR)
    pixels = list(small.getdata())
    mean = sum(pixels) / max(len(pixels), 1)

    variants: list = []
    inverted = ImageOps.invert(img)
    inv_contrast = ImageEnhance.Contrast(inverted).enhance(2.0)
    up_w, up_h = int(w * 1.5), int(h * 1.5)
    variants.append(inv_contrast.resize((up_w, up_h), Image.Resampling.LANCZOS))

    if mean >= 130:
        if max(w, h) < 1600:
            scale = 1600 / max(w, h)
            variants.append(img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS))
    else:
        variants.append(inv_contrast)
        if max(w, h) < 1800:
            scale = 1800 / max(w, h)
            variants.append(inv_contrast.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS))

    return variants


def _ocr_quality_score(text: str) -> float:
    if not text or not str(text).strip():
        return 0.0
    t = _normalize_text_for_match(text)
    score = float(len(re.findall(r'[a-z0-9]', t, re.I)))
    if 'comprobante' in t:
        score += 500.0
    if 'transferencia' in t and 'exitosa' in t:
        score += 400.0
    if re.search(r'\$\s*[\d.,]+', text):
        score += 300.0
    if re.search(r'\d{6,12}', text):
        score += 150.0
    if re.search(r'\d{3}\s*-\s*\d{6}\s*-\s*\d{2}', text):
        score += 120.0
    weird = len(re.findall(r'[^\w\s$.,:/\-áéíóúñ]', text, re.I))
    score -= weird * 3.0
    return score


def _ocr_text_from_image(img) -> str:
    if not _configure_tesseract():
        return ''

    import pytesseract

    configs = ('--psm 6', '--psm 4', '--psm 11')
    langs = ('eng',)
    best_text = ''
    best_score = 0.0

    for variant in _ocr_variants(img):
        for cfg in configs:
            for lang in langs:
                try:
                    text = pytesseract.image_to_string(variant, lang=lang, config=cfg)
                    if not text or not text.strip():
                        continue
                    score = _ocr_quality_score(text)
                    if score > best_score:
                        best_score = score
                        best_text = text.strip()
                    if score >= 800:
                        return best_text
                except Exception:
                    continue

    return best_text


def _extract_text_from_image(image_path: str) -> tuple[str, list[str]]:
    """OCR (varias orientaciones y preprocesado) + QR + metadatos."""
    sources: list[str] = []
    chunks: list[str] = []

    try:
        img = _load_image_rgb(image_path)
        chunks.append(f'IMG {img.size[0]}x{img.size[1]}')
        sources.append('image_meta')

        best_ocr = ''
        best_score = 0.0
        for angle in (0, 90, 180, 270):
            rotated = img.rotate(angle, expand=True) if angle else img
            text = _ocr_text_from_image(rotated)
            score = _ocr_quality_score(text)
            if score > best_score:
                best_score = score
                best_ocr = text
            if score >= 800:
                break
        if best_ocr:
            chunks.append(best_ocr)
            sources.append('ocr')
    except Exception:
        pass

    try:
        from pyzbar.pyzbar import decode as qr_decode

        with open(image_path, 'rb') as fh:
            data = fh.read()
        for item in qr_decode(data):
            if item.data:
                text = item.data.decode('utf-8', errors='ignore').strip()
                if text:
                    chunks.append(text)
                    sources.append('qr')
    except Exception:
        pass

    return _normalize_ocr_text('\n'.join(chunks)), sources


def _pattern_applies(
    pattern: dict,
    currency: str,
    payment_method_id: str,
    payment_method_label: str = '',
) -> bool:
    cur = (currency or '').upper()
    allowed_cur = [c.upper() for c in (pattern.get('currencies') or [])]
    if allowed_cur and cur not in allowed_cur:
        return False

    pm_id = (payment_method_id or '').lower()
    pm_ids = [str(x).lower() for x in (pattern.get('payment_method_ids') or []) if str(x).strip()]
    label_lower = (payment_method_label or '').lower()
    label_keywords = [
        str(x).lower() for x in (pattern.get('payment_method_label_keywords') or []) if str(x).strip()
    ]

    if pm_ids or label_keywords:
        id_ok = pm_id in pm_ids if pm_ids else False
        label_ok = any(kw in label_lower for kw in label_keywords) if label_keywords else False
        id_kw_ok = any(kw in pm_id for kw in label_keywords) if label_keywords and pm_id else False
        if not (id_ok or label_ok or id_kw_ok):
            return False
    return True


def _patterns_for_payment_method(
    patterns: list[dict],
    currency: str,
    payment_method_id: str,
    payment_method_label: str,
) -> list[dict]:
    matched = [
        p for p in patterns
        if _pattern_applies(p, currency, payment_method_id, payment_method_label)
    ]
    if matched:
        return matched
    cur = (currency or '').upper()
    return [
        p for p in patterns
        if not p.get('currencies') or cur in [c.upper() for c in (p.get('currencies') or [])]
    ]


_GLOBAL_TIME_REGEXES = [
    r'(?<![\d:])(\d{1,2}\s*:\s*\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
    r'(?<![\d:])(\d{1,2}\s*:\s*\d{2})(?!\s*:\s*\d)',
    r'(?:a\s+las|hora)\s+(\d{1,2}\s*:\s*\d{2})',
]


def _strip_seconds_from_time_raw(raw: str) -> str:
    """Quita :ss del texto mostrado (solo se usa hora:minuto)."""
    s = re.sub(r'\s+', ' ', str(raw or '').strip())
    return re.sub(r'(\d{1,2}:\d{2}):\d{2}', r'\1', s)


def _find_by_regexes(text: str, regexes: list[str], group: bool = True) -> list[str]:
    found: list[str] = []
    for rx in regexes or []:
        try:
            for m in re.finditer(rx, text, re.IGNORECASE | re.MULTILINE):
                val = m.group(1) if group and m.lastindex else m.group(0)
                val = str(val).strip()
                if val and val not in found:
                    found.append(val)
        except re.error:
            continue
    return found


def _find_amounts_in_text(text: str, regexes: list[str]) -> list[Decimal]:
    found: list[Decimal] = []
    for raw in _find_by_regexes(text, regexes, group=True):
        val = _normalize_amount(raw)
        if val is not None and val not in found:
            found.append(val)
    return found


# Regex globales para cuentas Bancolombia (3-6-2 con guiones/espacios) y números planos.
_GLOBAL_ACCOUNT_REGEXES = [
    r'(?:producto\s+destino|cuenta\s+destino|destino|ahorros)[^\d]{0,100}'
    r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
    r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
    r'\b(\d{11})\b',
]


def _scan_account_numbers_in_text(text: str) -> list[str]:
    """Detecta cuentas destino en texto OCR (Bancolombia, DaviPlata, Binance, etc.)."""
    if _text_looks_like_binance_usdt_comprobante(text):
        return _scan_binance_pay_accounts(text)

    found: list[str] = []
    for raw in _find_by_regexes(text, _GLOBAL_ACCOUNT_REGEXES, group=True):
        norm = digits_only(raw)
        if len(norm) >= 10 and norm not in found:
            if not _digits_embedded_in_long_id(norm, text):
                found.append(norm)
    for phone in _scan_daviplata_destination_phones(text):
        if phone not in found:
            found.append(phone)
    for phone in _scan_nequi_destination_phones(text):
        if phone not in found:
            found.append(phone)
    for acct in _scan_nequi_bancolombia_accounts(text):
        if acct not in found:
            found.append(acct)
    for acct in _scan_binance_pay_accounts(text):
        if acct not in found:
            found.append(acct)
    return found


def _scan_binance_pay_accounts(text: str) -> list[str]:
    """ID de cuenta Binance Pay (8-12 dígitos) en «Pago completado» / «Pago exitoso»."""
    norm = _normalize_text_for_match(text)
    if 'usdt' not in norm and 'pago completado' not in norm and 'pago exitoso' not in norm:
        return []
    found: list[str] = []
    patterns = (
        r'(\d{8,12})\s+id\.\s*de\s+la\s+orden',
        r'pago\s+exitoso[^\d]{0,120}(\d{8,12})\s+id\.\s*de\s+la\s+orden',
        r'pago\s+completado[^\d]{0,120}(\d{8,12})\s+id\.\s*de\s+la\s+orden',
        r'(?:colombia|ttavo\)|brosito)[^\d]{0,160}(\d{8,12})',
        r'(?:^|\s)(\d{8,12})(?:\s+id\.|\s+metodo)',
    )
    for pat in patterns:
        for m in re.finditer(pat, norm, re.IGNORECASE):
            digits = digits_only(m.group(1))
            if 8 <= len(digits) <= 12 and digits not in found:
                if not _digits_embedded_in_long_id(digits, text):
                    found.append(digits)
    return found


def _scan_nequi_bancolombia_accounts(text: str) -> list[str]:
    """Cuenta destino (10-12 dígitos) en comprobante Nequi «Envío a banco» → Bancolombia."""
    norm = (text or '').lower()
    if 'nequi' not in norm or 'bancolombia' not in norm:
        return []
    found: list[str] = []
    for m in re.finditer(
        r'(?:numero\s+de\s+cuenta|n[uú]mero\s+de\s+cuenta)[^\d]{0,70}(\d{10,12})',
        text,
        re.IGNORECASE | re.DOTALL,
    ):
        digits = digits_only(m.group(1))
        if len(digits) >= 10 and digits not in found:
            found.append(digits)
    return found


def _scan_nequi_destination_phones(text: str) -> list[str]:
    """Celular destino Nequi (10 dígitos) bajo «Número Nequi»."""
    if 'nequi' not in (text or '').lower():
        return []
    found: list[str] = []
    for m in re.finditer(
        r'(?:numero|n[uú]mero)\s+nequi[^\d]{0,60}(\d{3}\s*\d{3}\s*\d{4})',
        text,
        re.IGNORECASE | re.DOTALL,
    ):
        norm = digits_only(m.group(1))
        if len(norm) == 10 and norm.startswith('3') and norm not in found:
            found.append(norm)
    return found


def _scan_daviplata_destination_phones(text: str) -> list[str]:
    """Celular destino DaviPlata (10 dígitos); excluye línea «Desde» del comprobante."""
    if 'daviplata' not in (text or '').lower():
        return []
    found: list[str] = []
    prefer = re.search(
        r'(?:pasaste\s+plata|otro\s+daviplata|plata\s+a)[^\d]{0,220}(\d{3}\s*\d{3}\s*\d{4})',
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if prefer:
        norm = digits_only(prefer.group(1))
        if len(norm) == 10 and norm.startswith('3'):
            found.append(norm)
    for m in re.finditer(r'(\d{3}\s*\d{3}\s*\d{4})', text):
        window = text[max(0, m.start() - 50): m.start()].lower()
        if 'desde' in window or re.search(r'daviplata\s*[-–—]\s*$', window):
            continue
        norm = digits_only(m.group(1))
        if len(norm) == 10 and norm.startswith('3') and norm not in found:
            found.append(norm)
    return found


_GLOBAL_ACCOUNT_SUFFIX_REGEXES = [
    r'(?:en\s+tu\s+cuenta|cuenta\s+destino|producto\s+destino|cuenta|ahorros)[^\d*]{0,100}\*{2,}(\d{2,4})\b',
    r'\*{3,}(\d{2,4})\b',
    r'(?:termina\s+en|ultimos\s+digitos|últimos\s+dígitos)[^\d]{0,25}(\d{2,4})\b',
]


def receipt_date_matches_upload_day(
    receipt_date: date | None,
    upload_day: date | None,
    *,
    max_days_before: int = RECHARGE_UPLOAD_DATE_MAX_DAYS_BEFORE,
    max_days_after: int = RECHARGE_UPLOAD_DATE_MAX_DAYS_AFTER,
) -> bool | None:
    """True si la fecha del comprobante es coherente con el día en que se envió la solicitud."""
    if not receipt_date or not upload_day:
        return None
    delta = (upload_day - receipt_date).days
    if -max_days_after <= delta <= max_days_before:
        return True
    return False


def _normalize_breb_llave(raw: str) -> str:
    return re.sub(r'[^A-Za-z0-9]', '', str(raw or '')).upper()


def _text_has_ordenante_sas_noise(text: str) -> bool:
    """S.A.S. del ordenante (Kamin suele leer «GROUPS.AS» sin espacios)."""
    return bool(
        re.search(
            r'(?:\bS\.?\s*A\.?\s*S\.?\b|GROUPS\.A\.?S\b|GROUP\s+S\.A\.S)',
            text or '',
            re.IGNORECASE,
        )
    )


def _sanitize_breb_llave_token(val: str, text: str) -> str:
    """Quita sufijos espurios del OCR (p. ej. «SS» pegado desde S.A.S. del ordenante)."""
    val = _normalize_breb_llave(val)
    if not val:
        return val
    # OCR fusiona llave + «S.A.S»: GUSTAVOP8514S.A.S
    sas_merge = re.match(r'^([A-Z][A-Z0-9]{5,22})S\.A\.S$', val, re.IGNORECASE)
    if sas_merge:
        return sas_merge.group(1).upper()
    if not val.endswith('SS') or len(val) < 8:
        return val
    base = val[:-2]
    if len(base) < 6:
        return val
    ctx = text or ''
    if re.search(
        r'(?:llave\s+bre-?\s*b|llave\s+bre\s*b)\s*[:\s]*@?\s*' + re.escape(base) + r'(?:\b|[^a-z0-9])',
        ctx,
        re.IGNORECASE,
    ):
        return base
    if re.search(
        r'@?\s*' + re.escape(base) + r'(?:\b|[^A-Za-z0-9])',
        ctx,
        re.IGNORECASE,
    ):
        return base
    if _text_has_ordenante_sas_noise(ctx) and re.search(r'llave\s+bre', ctx, re.IGNORECASE):
        return base
    return val


def _scan_breb_llaves_in_text(text: str) -> list[str]:
    """Llaves Bre-B solo en contexto explícito (comprobante Kamin / correo Bancolombia)."""
    found: list[str] = []
    patterns = [
        r'(?:llave\s+bre-?\s*b|llave\s+bre\s*b)\s*[:\s]*@?([a-z][a-z0-9]{3,24})',
        r'(?:^|\n)\s*llave\s*[:\s]*@?([a-z][a-z0-9]{3,24})',
        r'conectada\s+a\s+la\s+llave\s+@?([a-z][a-z0-9]{3,24})',
    ]
    for raw in _find_by_regexes(text, patterns, group=True):
        val = _sanitize_breb_llave_token(raw, text)
        if val and val not in found:
            found.append(val)
    return found


def _scan_account_suffixes_in_text(text: str) -> list[str]:
    """Detecta sufijos enmascarados (****1948) en texto OCR o correo."""
    found: list[str] = []
    for raw in _find_by_regexes(text, _GLOBAL_ACCOUNT_SUFFIX_REGEXES, group=True):
        val = digits_only(raw)
        if val and val not in found:
            found.append(val)
    return found


def _format_account_display(digits: str) -> str:
    d = digits_only(digits)
    if len(d) == 11:
        return f'{d[:3]} - {d[3:9]} - {d[9:]}'
    if len(d) == 10:
        return f'{d[:3]} {d[3:6]} {d[6:]}'
    if len(d) >= 4:
        return '****' + d[-4:]
    return d or '—'


def resolve_account_match(
    expected_digits: str,
    full_accounts: list[str],
    suffixes: list[str] | None = None,
) -> bool | None:
    """
    True: la cuenta del comprobante coincide (número completo o últimos dígitos).
    False: se detectó cuenta en el comprobante y NO coincide con la configurada.
    None: no hay cuenta configurada o no se detectó cuenta en el comprobante.
    """
    exp = digits_only(expected_digits)
    if not exp:
        return None

    full = [digits_only(a) for a in (full_accounts or []) if digits_only(a)]
    sufs = [digits_only(s) for s in (suffixes or []) if digits_only(s)]
    if not full and not sufs:
        return None

    if len(exp) < 4:
        for det in full:
            if len(det) >= 8:
                return False
        return None

    if len(exp) < 8:
        for det in full:
            if len(det) >= 8:
                if det == exp:
                    return True
                if len(exp) >= 4 and det.endswith(exp):
                    return True
                return False
        return None

    for det in full:
        if len(det) >= 8 and det == exp:
            return True
        if len(det) == 10 and len(exp) == 10 and det == exp:
            return True
        if 2 <= len(det) < 8 and exp.endswith(det):
            return True

    for suf in sufs:
        if len(suf) >= 2 and exp.endswith(suf):
            return True

    return False


def _accounts_match_configured(
    expected_digits: str,
    detected_accounts: list[str],
    suffixes: list[str] | None = None,
) -> bool | None:
    """Compat: delega en resolve_account_match (None si no hay evidencia en comprobante)."""
    return resolve_account_match(expected_digits, detected_accounts, suffixes)


def _filter_amount_false_positives(
    amounts: list[Decimal],
    account_numbers: list[str],
    receipt_numbers: list[str] | None = None,
) -> list[Decimal]:
    """Excluye montos que son fragmentos de cuenta o el número de aprobación/comprobante."""
    acct = [digits_only(a) for a in (account_numbers or []) if digits_only(a)]
    receipts = [digits_only(r) for r in (receipt_numbers or []) if digits_only(r)]
    if not acct and not receipts:
        return list(amounts)
    out: list[Decimal] = []
    for amt in amounts:
        amt_str = str(_amount_whole_units(amt))
        if not amt_str:
            continue
        skip = False
        for acc in acct:
            if len(amt_str) >= 5 and amt_str in acc:
                skip = True
                break
        if not skip:
            for rec in receipts:
                rec_digits = digits_only(rec)
                if amt_str == rec or amt_str == rec_digits:
                    skip = True
                    break
                if rec_digits and len(amt_str) >= 5 and amt_str in rec_digits:
                    skip = True
                    break
        if not skip:
            out.append(amt)
    return out


def _parse_receipt_date(raw: str) -> date | None:
    s = str(raw or '').strip().lower()
    if not s:
        return None

    m_iso = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})\b', s)
    if m_iso:
        try:
            return date(int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3)))
        except ValueError:
            pass

    m = re.search(
        r'(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+(\d{4})',
        s,
        re.IGNORECASE,
    )
    if m:
        day = int(m.group(1))
        month = _SPANISH_MONTHS.get(m.group(2).lower()[:4], _SPANISH_MONTHS.get(m.group(2).lower()[:3]))
        year = int(m.group(3))
        if month:
            try:
                return date(year, month, day)
            except ValueError:
                return None

    m_day_de_month = re.search(
        r'(\d{1,2})\s+de\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+(\d{4})',
        s,
        re.IGNORECASE,
    )
    if m_day_de_month:
        day = int(m_day_de_month.group(1))
        month = _SPANISH_MONTHS.get(
            m_day_de_month.group(2).lower()[:4],
            _SPANISH_MONTHS.get(m_day_de_month.group(2).lower()[:3]),
        )
        year = int(m_day_de_month.group(3))
        if month:
            try:
                return date(year, month, day)
            except ValueError:
                return None

    m_month_first = re.search(
        r'(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+(\d{1,2}|o[l1]de)\s+(?:de\s+)?(\d{4})',
        s,
        re.IGNORECASE,
    )
    if m_month_first:
        month = _SPANISH_MONTHS.get(
            m_month_first.group(1).lower()[:4],
            _SPANISH_MONTHS.get(m_month_first.group(1).lower()[:3]),
        )
        day_raw = m_month_first.group(2).lower()
        day = 1 if re.fullmatch(r'o[l1]de', day_raw) else int(day_raw)
        year = int(m_month_first.group(3))
        if month:
            try:
                return date(year, month, day)
            except ValueError:
                return None

    m2 = re.search(r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})', s)
    if m2:
        d, mo, y = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        if y < 100:
            y += 2000
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    return None


def _time_to_minute(t: time | None) -> time | None:
    """Normaliza a hora:minuto (sin segundos) para comparar y mostrar."""
    if t is None:
        return None
    return t.replace(second=0, microsecond=0)


def _parse_receipt_time(raw: str) -> time | None:
    s = str(raw or '').strip().lower()
    if not s:
        return None
    s = re.sub(r'\s+', ' ', s)

    m = re.search(
        r'(\d{1,2})\s*:\s*(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?',
        s,
        re.IGNORECASE,
    )
    if m:
        hour, minute = int(m.group(1)), int(m.group(2))
        ampm = re.sub(r'[\s.]', '', (m.group(3) or '')).lower()
        if ampm:
            if ampm.startswith('p') and hour < 12:
                hour += 12
            elif ampm.startswith('a') and hour == 12:
                hour = 0
        elif hour > 23:
            return None
        try:
            return _time_to_minute(time(hour, minute, 0))
        except ValueError:
            return None
    return None


def _format_receipt_time_display(t: time) -> str:
    t = _time_to_minute(t) or t
    hour12 = t.hour % 12 or 12
    ampm = 'AM' if t.hour < 12 else 'PM'
    return f'{hour12:02d}:{t.minute:02d} {ampm}'


def _select_best_receipt_time(
    raw_times: list[str],
    parsed_times: list[str],
    preferred_parsed_isos: list[str] | None = None,
) -> tuple[time | None, str | None]:
    preferred = {str(x) for x in (preferred_parsed_isos or []) if x}
    best_t: time | None = None
    best_raw: str | None = None
    best_score = -1
    for i, pt_iso in enumerate(parsed_times or []):
        try:
            t = time.fromisoformat(str(pt_iso))
        except ValueError:
            continue
        raw = raw_times[i] if i < len(raw_times) else ''
        t = _time_to_minute(t) or t
        score = 0
        if str(pt_iso) in preferred or t.isoformat() in preferred:
            score += 10
        if re.search(r'[ap]\.?\s*m', str(raw), re.I):
            score += 2
        if score > best_score:
            best_score = score
            best_t = t
            best_raw = raw or None
    if best_t is None and raw_times:
        for raw in raw_times:
            t = _parse_receipt_time(raw)
            if t:
                return t, raw
    return best_t, best_raw


def _split_date_time_blob(blob: str) -> tuple[str, str | None]:
    """Separa fecha y hora si vinieron en la misma captura OCR."""
    s = str(blob or '').strip()
    if not s:
        return s, None
    month = r'(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*'
    patterns = [
        rf'(\d{{1,2}}\s+{month}\s+\d{{4}})\s+(\d{{1,2}}\s*:\s*\d{{2}}(?:\s*:\s*\d{{2}})?\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
        r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
    ]
    for rx in patterns:
        m = re.search(rx, s, re.IGNORECASE)
        if m:
            return m.group(1).strip(), m.group(2).strip()
    return s, None


def _register_receipt_time(
    raw_time: str,
    receipt_times: list[str],
    parsed_times: list[str],
) -> None:
    t = _strip_seconds_from_time_raw(raw_time)
    if not t or t in receipt_times:
        return
    receipt_times.append(t)
    pt = _parse_receipt_time(t)
    if pt and pt.isoformat() not in parsed_times:
        parsed_times.append(pt.isoformat())


def _register_receipt_date(
    raw_date: str,
    receipt_dates: list[str],
    parsed_dates: list[str],
    receipt_times: list[str],
    parsed_times: list[str],
) -> None:
    d_raw, t_raw = _split_date_time_blob(raw_date)
    d = str(d_raw or '').strip()
    if not d:
        return
    if d not in receipt_dates:
        receipt_dates.append(d)
        parsed = _parse_receipt_date(d)
        if parsed and parsed.isoformat() not in parsed_dates:
            parsed_dates.append(parsed.isoformat())
    if t_raw:
        _register_receipt_time(t_raw, receipt_times, parsed_times)


def _find_datetime_pairs(text: str, regexes: list[str]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for rx in regexes or []:
        try:
            for m in re.finditer(rx, text, re.IGNORECASE | re.MULTILINE):
                if not m.lastindex or m.lastindex < 2:
                    continue
                d = str(m.group(1)).strip()
                t = str(m.group(2)).strip()
                if d and t and (d, t) not in pairs:
                    pairs.append((d, t))
        except re.error:
            continue
    return pairs


def _scan_times_near_dates(text: str, date_strs: list[str], time_regexes: list[str]) -> list[str]:
    found: list[str] = []
    rxs = list(dict.fromkeys((time_regexes or []) + _GLOBAL_TIME_REGEXES))
    for d in date_strs:
        needle = str(d).lower()
        start = 0
        while True:
            idx = text.lower().find(needle, start)
            if idx < 0:
                break
            win_start = max(0, idx - 50)
            win_end = min(len(text), idx + len(d) + 260)
            window = text[win_start:win_end]
            for t in _find_by_regexes(window, rxs, group=True):
                if t not in found:
                    found.append(t)
            start = idx + max(len(needle), 1)
    return found


def _extract_fields_from_patterns(text: str, patterns: list[dict]) -> dict[str, Any]:
    receipt_numbers: list[str] = []
    receipt_dates: list[str] = []
    parsed_dates: list[str] = []
    receipt_times: list[str] = []
    parsed_times: list[str] = []
    datetime_pair_parsed_isos: list[str] = []
    account_numbers: list[str] = []

    for pat in patterns:
        for r in _find_by_regexes(text, pat.get('receipt_regexes') or [], group=True):
            tok = _normalize_receipt_token(r)
            if tok and tok not in receipt_numbers:
                receipt_numbers.append(tok)
        for d, t in _find_datetime_pairs(text, pat.get('datetime_regexes') or []):
            _register_receipt_date(d, receipt_dates, parsed_dates, receipt_times, parsed_times)
            _register_receipt_time(t, receipt_times, parsed_times)
            pt = _parse_receipt_time(t)
            if pt:
                iso = pt.isoformat()
                if iso not in datetime_pair_parsed_isos:
                    datetime_pair_parsed_isos.append(iso)
        for d in _find_by_regexes(text, pat.get('date_regexes') or [], group=True):
            _register_receipt_date(d, receipt_dates, parsed_dates, receipt_times, parsed_times)
        for t in _find_by_regexes(text, pat.get('time_regexes') or [], group=True):
            _register_receipt_time(t, receipt_times, parsed_times)
        for t in _scan_times_near_dates(
            text,
            receipt_dates,
            (pat.get('time_regexes') or []) + _GLOBAL_TIME_REGEXES,
        ):
            _register_receipt_time(t, receipt_times, parsed_times)
        for a in _find_by_regexes(text, pat.get('account_regexes') or [], group=True):
            norm = digits_only(a)
            if len(norm) >= 10 and norm not in account_numbers:
                account_numbers.append(norm)

    if receipt_dates and not receipt_times:
        for t in _find_by_regexes(text, _GLOBAL_TIME_REGEXES, group=True):
            _register_receipt_time(t, receipt_times, parsed_times)

    for norm in _scan_account_numbers_in_text(text):
        if norm not in account_numbers:
            account_numbers.append(norm)

    receipt_set = set(receipt_numbers)
    account_numbers = [a for a in account_numbers if a not in receipt_set]

    return {
        'receipt_numbers': receipt_numbers,
        'receipt_dates_raw': receipt_dates,
        'receipt_dates_parsed': parsed_dates,
        'receipt_times_raw': receipt_times,
        'receipt_times_parsed': parsed_times,
        'receipt_times_datetime_pair_parsed': datetime_pair_parsed_isos,
        'account_numbers': account_numbers,
    }


def analyze_recharge_proof(
    image_path: str,
    amount_claimed: Decimal,
    currency: str,
    payment_method_id: str,
    *,
    payment_method_label: str = '',
    payment_method_details: str = '',
    payment_method: dict | None = None,
    upload_date: date | None = None,
) -> dict[str, Any]:
    """Analiza comprobante: OCR, montos, comprobante, fecha, cuenta y patrones."""
    text, sources = _extract_text_from_image(image_path)
    patterns = get_analyzer_patterns()
    applicable = _patterns_for_payment_method(
        patterns, currency, payment_method_id, payment_method_label
    )
    narrowed: list[dict] = []
    for pat in applicable:
        must = [str(x) for x in (pat.get('text_must_contain') or []) if str(x).strip()]
        if not must or _text_contains_all(text, must):
            narrowed.append(pat)
    if narrowed:
        applicable = narrowed
    elif _text_looks_like_binance_usdt_comprobante(text):
        binance_only = [
            p for p in patterns
            if str(p.get('id') or '') == 'binance_pago_completado_usdt'
            or 'binance' in _normalize_text_for_match(str(p.get('label') or ''))
        ]
        if binance_only:
            applicable = binance_only

    extracted = _extract_fields_from_patterns(text, applicable)
    receipt_number = extracted['receipt_numbers'][0] if extracted['receipt_numbers'] else None
    receipt_date_parsed = None
    if extracted['receipt_dates_parsed']:
        try:
            receipt_date_parsed = date.fromisoformat(extracted['receipt_dates_parsed'][0])
        except ValueError:
            receipt_date_parsed = None

    receipt_time_parsed, receipt_time_raw = _select_best_receipt_time(
        extracted['receipt_times_raw'],
        extracted['receipt_times_parsed'],
        extracted.get('receipt_times_datetime_pair_parsed'),
    )
    receipt_time_display = (
        _format_receipt_time_display(receipt_time_parsed) if receipt_time_parsed else receipt_time_raw
    )
    receipt_date_display = (
        extracted['receipt_dates_raw'][0]
        if extracted['receipt_dates_raw']
        else (receipt_date_parsed.isoformat() if receipt_date_parsed else None)
    )
    receipt_datetime_display = None
    receipt_datetime_parsed = None
    if receipt_date_display and receipt_time_display:
        receipt_datetime_display = f'{receipt_date_display} · {receipt_time_display}'
    elif receipt_date_display:
        receipt_datetime_display = receipt_date_display
    elif receipt_time_display:
        receipt_datetime_display = receipt_time_display
    if receipt_time_parsed:
        receipt_time_parsed = _time_to_minute(receipt_time_parsed)
    if receipt_date_parsed and receipt_time_parsed:
        receipt_datetime_parsed = datetime.combine(receipt_date_parsed, receipt_time_parsed).isoformat()

    if payment_method is not None:
        expected_account = account_digits_from_payment_method(payment_method)
    else:
        expected_account = account_digits_from_details(payment_method_details)
    account_suffixes = _scan_account_suffixes_in_text(text)
    # Siempre re-escanear cuentas/celulares en todo el texto (aunque el medio elegido sea otro banco)
    for norm in _scan_account_numbers_in_text(text):
        if norm not in extracted['account_numbers']:
            extracted['account_numbers'].append(norm)
    breb_llave_match = None
    breb_llave_expected = None
    breb_llaves_detected: list[str] = []
    is_breb_payment_method = False
    if payment_method is not None:
        from app.store.balance_recharge_payment import (
            breb_llave_matches_expected,
            payment_method_breb_llave_normalized,
            payment_method_is_breb_bancolombia,
        )

        if payment_method_is_breb_bancolombia(payment_method):
            is_breb_payment_method = True
            breb_llave_expected = payment_method_breb_llave_normalized(payment_method)
            breb_llaves_detected = _scan_breb_llaves_in_text(text)
            if breb_llave_expected:
                breb_llave_match = breb_llave_matches_expected(
                    breb_llave_expected, breb_llaves_detected
                )
            elif breb_llaves_detected:
                breb_llave_match = False

    account_match = None
    if is_breb_payment_method:
        # Los 4 dígitos de cuenta (ej. 1948) no bloquean al usuario; solo la llave Bre-B.
        if breb_llave_match is True:
            account_match = True
        elif breb_llave_match is False:
            account_match = False
    elif expected_account:
        account_match = resolve_account_match(
            expected_account,
            extracted['account_numbers'],
            account_suffixes,
        )

    upload_day = upload_date
    date_matches_upload = receipt_date_matches_upload_day(receipt_date_parsed, upload_day)

    matched: list[dict] = []
    failed: list[dict] = []
    detected_amounts: list[float] = []

    for pat in applicable:
        pid = pat.get('id') or pat.get('label') or 'pattern'
        must = [str(x) for x in (pat.get('text_must_contain') or []) if str(x).strip()]
        if must and not _text_contains_all(text, must):
            failed.append({'id': pid, 'label': pat.get('label'), 'reason': 'texto_clave_ausente'})
            continue
        amounts = _find_amounts_in_text(text, pat.get('amount_regexes') or [])
        for a in amounts:
            fv = float(a)
            if fv not in detected_amounts:
                detected_amounts.append(fv)
        if amounts:
            matched.append({'id': pid, 'label': pat.get('label'), 'amounts': [float(x) for x in amounts]})
        else:
            failed.append({'id': pid, 'label': pat.get('label'), 'reason': 'monto_no_detectado'})

    receipt_nums_for_filter = list(extracted.get('receipt_numbers') or [])
    if receipt_number and digits_only(receipt_number) not in receipt_nums_for_filter:
        receipt_nums_for_filter.append(digits_only(receipt_number))

    for extra in _filter_amount_false_positives(
        _scan_amounts_in_text(text),
        extracted.get('account_numbers') or [],
        receipt_nums_for_filter,
    ):
        fv = float(extra)
        if fv not in detected_amounts:
            detected_amounts.append(fv)

    detected_amounts = [
        float(x)
        for x in _filter_amount_false_positives(
            [Decimal(str(v)) for v in detected_amounts],
            extracted.get('account_numbers') or [],
            receipt_nums_for_filter,
        )
    ]

    claimed = float(amount_claimed)
    amount_match = any(_amounts_equivalent(claimed, a, currency) for a in detected_amounts)
    patterns_ok = len(matched) > 0 and not failed

    ocr_available = _configure_tesseract() and 'ocr' in sources
    notes: list[str] = []
    if not ocr_available:
        notes.append('OCR no disponible en el servidor; revisión manual recomendada.')
    if not detected_amounts:
        notes.append('No se detectó monto en la imagen.')
    elif amount_match:
        notes.append('Monto coincide con lo declarado.')
    else:
        notes.append('El monto detectado no coincide con lo declarado.')
    if receipt_number:
        notes.append(f'Comprobante detectado: {receipt_number}.')
    if receipt_date_parsed:
        if date_matches_upload is True:
            if upload_day and receipt_date_parsed == upload_day:
                notes.append('La fecha del comprobante coincide con el día del envío (Colombia).')
            else:
                notes.append(
                    'La fecha del comprobante está dentro del plazo permitido respecto al envío.'
                )
        elif date_matches_upload is False:
            notes.append(
                'La fecha del comprobante está fuera del plazo permitido respecto al envío. '
                'Se hará una sola consulta automática al correo desde esa fecha (máx. 7 días).'
            )
    if receipt_time_parsed or receipt_time_raw:
        if receipt_time_display:
            notes.append(f'Hora del comprobante detectada: {receipt_time_display}.')
    if breb_llave_expected:
        if breb_llave_match is True:
            notes.append(f'La llave Bre-B coincide (@{breb_llave_expected}).')
        elif breb_llave_match is False:
            det_label = (
                ', '.join(f'@{k}' for k in breb_llaves_detected)
                if breb_llaves_detected
                else 'no detectada en la foto'
            )
            notes.append(
                f'La llave Bre-B del comprobante no coincide (en foto: {det_label}; '
                f'medio elegido: @{breb_llave_expected}).'
            )
    if expected_account and not is_breb_payment_method and not (
        breb_llave_expected and breb_llave_match is False
    ):
        if account_match is True:
            notes.append('La cuenta destino coincide con el medio de pago.')
        elif account_match is False:
            detected = extracted['account_numbers'][0] if extracted['account_numbers'] else None
            if not detected and account_suffixes:
                detected = account_suffixes[0]
            if detected:
                notes.append(
                    f'La cuenta destino no coincide (detectada: {detected}, '
                    f'configurada: {expected_account}).'
                )
            else:
                notes.append(
                    f'No se detectó cuenta en la imagen (esperada: {expected_account}).'
                )

    return {
        'amount_claimed': claimed,
        'amounts_detected': detected_amounts,
        'amount_matches_claimed': amount_match,
        'patterns_matched': matched,
        'patterns_failed': failed,
        'patterns_ok': patterns_ok,
        'sources': sources,
        'ocr_available': ocr_available,
        'receipt_number': receipt_number,
        'receipt_date_raw': extracted['receipt_dates_raw'][0] if extracted['receipt_dates_raw'] else None,
        'receipt_date_parsed': receipt_date_parsed.isoformat() if receipt_date_parsed else None,
        'receipt_time_raw': receipt_time_raw,
        'receipt_time_parsed': receipt_time_parsed.isoformat() if receipt_time_parsed else None,
        'receipt_time_display': receipt_time_display,
        'receipt_datetime_display': receipt_datetime_display,
        'receipt_datetime_parsed': receipt_datetime_parsed,
        'date_matches_upload': date_matches_upload,
        'account_numbers_detected': extracted['account_numbers'],
        'account_suffixes_detected': account_suffixes,
        'account_expected_digits': expected_account or None,
        'account_matches_configured': account_match,
        'is_breb_bancolombia': is_breb_payment_method,
        'bre_b_llave_expected': breb_llave_expected or None,
        'bre_b_llaves_detected': breb_llaves_detected,
        'bre_b_llave_matches_configured': breb_llave_match,
        'payment_method_label': payment_method_label or None,
        'detected_brands': sorted(_brands_in_text(text)),
        'raw_text_preview': (text[:2000] if text else ''),
        'ready_for_auto': bool(
            amount_match
            and patterns_ok
            and (date_matches_upload is not False)
            and (account_match is not False)
            and (
                breb_llave_match is True
                if is_breb_payment_method
                else breb_llave_match is not False
            )
        ),
        'note': ' '.join(notes),
    }


def proof_amount_mismatch_message(analysis: dict[str, Any], currency: str = 'COP') -> str | None:
    """Devuelve mensaje de error si el OCR detectó montos distintos al declarado."""
    detected = analysis.get('amounts_detected') or []
    if not detected:
        return None
    if analysis.get('amount_matches_claimed'):
        return None
    cur = (currency or 'COP').upper()

    def _fmt_amount(value: float) -> str:
        if cur == 'USD':
            return f'${float(value):,.2f} {cur}'
        whole = int(round(float(value)))
        return f'${whole:,}'.replace(',', '.') + f' {cur}'

    primary = max(float(x) for x in detected)
    extra = (
        ' En USDT los centavos deben coincidir exactamente (ej. 333,64, no 333,6).'
        if cur == 'USD'
        else ''
    )
    return (
        'La foto y el monto ingresado son diferentes. '
        f'En el comprobante detectamos {_fmt_amount(primary)}. '
        'Verifica el monto e intenta de nuevo.'
        + extra
    )


_BRAND_KEYWORDS: dict[str, list[str]] = {
    'daviplata': ['daviplata', 'davi plata'],
    'bancolombia': ['bancolombia'],
    'nequi': ['nequi'],
    'breve': ['bre-b', 'breve', 'bre b'],
    'breb_bancolombia': ['bre-b', 'breve', 'bre b', 'bancolombia', 'kamin'],
    'binance_pay': ['binance pay', 'binancepay'],
    'binance': ['binance'],
    'paypal': ['paypal'],
    'usdt': ['usdt', 'tether'],
}

_BRAND_DISPLAY_LABELS: dict[str, str] = {
    'daviplata': 'DaviPlata',
    'bancolombia': 'Bancolombia',
    'nequi': 'Nequi',
    'breve': 'Bre-B',
    'breb_bancolombia': 'Bre-B Bancolombia',
    'binance_pay': 'Binance Pay',
    'binance': 'Binance',
    'paypal': 'PayPal',
    'usdt': 'USDT',
}


def _brands_in_text(text: str) -> set[str]:
    norm = _normalize_text_for_match(text)
    if _text_looks_like_binance_usdt_comprobante(text):
        found: set[str] = {'binance', 'usdt'}
        if 'binance pay' in norm or 'binancepay' in norm.replace(' ', ''):
            found.add('binance_pay')
        return found

    found: set[str] = set()
    for brand, keywords in _BRAND_KEYWORDS.items():
        for kw in keywords:
            if _normalize_text_for_match(kw) in norm:
                found.add(brand)
                break
    return found


def _is_classic_bancolombia_payment(
    payment_method_id: str,
    payment_method_label: str,
    payment_method: dict | None,
) -> bool:
    """Cuenta Bancolombia tradicional (no medio Bre-B Bancolombia)."""
    from app.store.balance_recharge_payment import payment_method_is_breb_bancolombia

    if payment_method_is_breb_bancolombia(payment_method):
        return False
    pb = str((payment_method or {}).get('payment_brand') or '').strip().lower()
    if pb and pb != 'bancolombia':
        return False
    combined = _normalize_text_for_match(f'{payment_method_id} {payment_method_label}')
    if not combined:
        return False
    if any(x in combined for x in ('bre-b', 'bre b', 'breb', 'breve', 'kamin')):
        return False
    return 'bancolombia' in combined


def _text_looks_like_breb_kamin_comprobante(text: str) -> bool:
    """Comprobante Bre-B / Kamin (no app Bancolombia clásica)."""
    norm = _normalize_text_for_match(text)
    if not norm:
        return False
    if 'kamin' in norm and 'comprobante' in norm:
        return True
    if any(m in norm for m in ('bre b', 'bre-b', 'breve')) and 'comprobante' in norm:
        return 'llave' in norm or 'kamin' in norm
    return False


def _brands_for_payment_method(
    payment_method_id: str,
    payment_method_label: str,
    payment_method: dict | None = None,
) -> set[str]:
    combined = _normalize_text_for_match(f'{payment_method_id} {payment_method_label}')
    found: set[str] = set()
    for brand, keywords in _BRAND_KEYWORDS.items():
        for kw in keywords:
            if _normalize_text_for_match(kw) in combined:
                found.add(brand)
                break
    if payment_method:
        from app.store.balance_recharge_payment import (
            PAYMENT_BRAND_SPEC,
            _linked_brands_from_brand,
        )

        pb = str(payment_method.get('payment_brand') or '').strip().lower()
        if pb in PAYMENT_BRAND_SPEC:
            for b in _linked_brands_from_brand(pb):
                if b in _BRAND_KEYWORDS:
                    found.add(b)
        for brand in payment_method.get('linked_brands') or []:
            b = str(brand or '').strip().lower()
            if b in _BRAND_KEYWORDS:
                found.add(b)
    return found


def _is_accumulator_payment_method(payment_method: dict | None) -> bool:
    if not payment_method:
        return False
    if str(payment_method.get('currency') or '').upper() == 'ACCUM':
        return True
    from app.store.balance_recharge_payment import is_accumulator_method_id

    return is_accumulator_method_id(str(payment_method.get('id') or ''))


def proof_payment_brand_mismatch_message(
    analysis: dict[str, Any],
    payment_method_id: str = '',
    payment_method_label: str = '',
    payment_method: dict | None = None,
) -> str | None:
    """Bloquea si el comprobante es de otro medio (ej. DaviPlata en foto, Bancolombia seleccionado)."""
    from app.store.balance_recharge_payment import (
        payment_method_brand_configured,
        payment_method_is_generic,
    )

    if payment_method_is_generic(payment_method, payment_method_id, payment_method_label):
        return None

    if not payment_method_brand_configured(payment_method):
        chosen = (payment_method_label or payment_method_id or 'este medio').strip()
        return (
            f'El medio «{chosen}» no está configurado: en admin debe elegirse un Medio '
            '(Binance, Nequi, Bancolombia, etc.), no dejar «— Medio —».'
        )

    text = str(analysis.get('raw_text_preview') or '')
    detected_brands: set[str] = set()
    for b in analysis.get('detected_brands') or []:
        key = str(b or '').strip().lower()
        if key:
            detected_brands.add(key)
    if text.strip():
        detected_brands |= _brands_in_text(text)

    if not detected_brands and not text.strip():
        return None

    if _is_classic_bancolombia_payment(
        payment_method_id, payment_method_label, payment_method
    ) and _text_looks_like_breb_kamin_comprobante(text):
        chosen = (payment_method_label or payment_method_id or 'Bancolombia').strip()
        return (
            f'El comprobante es de Bre-B / Kamin, pero seleccionaste «{chosen}» '
            '(cuenta Bancolombia tradicional). Elige el medio «Bre-B Bancolombia» e intenta de nuevo.'
        )

    if not detected_brands:
        return None
    expected_brands = _brands_for_payment_method(
        payment_method_id,
        payment_method_label,
        payment_method,
    )
    is_accum = _is_accumulator_payment_method(payment_method)

    if not expected_brands:
        if is_accum and detected_brands:
            shown = ', '.join(
                _BRAND_DISPLAY_LABELS.get(b, b) for b in sorted(detected_brands)
            )
            chosen = (payment_method_label or payment_method_id or 'acumulador').strip()
            return (
                f'El comprobante corresponde a {shown}, pero elegiste el acumulador «{chosen}» '
                'que no está vinculado a ese medio. Usa el acumulador correcto (DaviPlata, Binance, '
                'PayPal, etc.) en Medios de pago.'
            )
        return None

    if detected_brands & expected_brands:
        return None

    if detected_brands & _BINANCE_RELATED_BRANDS and expected_brands & _BINANCE_RELATED_BRANDS:
        return None

    shown = ', '.join(_BRAND_DISPLAY_LABELS.get(b, b) for b in sorted(detected_brands))
    chosen = (payment_method_label or payment_method_id or 'otro medio').strip()
    return (
        f'El comprobante parece ser de {shown}, pero seleccionaste {chosen}. '
        'Elige el medio de pago correcto e intenta de nuevo.'
    )


def proof_breb_llave_mismatch_message(analysis: dict[str, Any]) -> str | None:
    """Bloquea el envío si la llave del comprobante no coincide con el medio Bre-B elegido."""
    is_breb = bool(analysis.get('is_breb_bancolombia'))
    expected = str(analysis.get('bre_b_llave_expected') or '').strip().upper()
    if not is_breb and not expected:
        return None
    if is_breb and not expected:
        return (
            'El medio Bre-B seleccionado no tiene llave configurada. '
            'Contacta al administrador para corregir el medio de pago.'
        )
    if analysis.get('bre_b_llave_matches_configured') is True:
        return None
    detected = [str(x).upper() for x in (analysis.get('bre_b_llaves_detected') or []) if str(x).strip()]
    if detected:
        detected_label = ', '.join(f'@{k}' for k in detected)
        return (
            'La llave Bre-B del comprobante no coincide con el medio que seleccionaste. '
            f'En la foto: {detected_label}; medio elegido: @{expected}. '
            'Verifica el medio de pago e intenta de nuevo.'
        )
    return (
        'No se detectó la llave Bre-B en el comprobante. '
        f'El medio elegido requiere la llave @{expected} visible en la foto (ej. «Llave Bre-B»).'
    )


def proof_account_mismatch_message(analysis: dict[str, Any]) -> str | None:
    """Devuelve mensaje de error si el OCR detectó una cuenta distinta a la seleccionada."""
    if analysis.get('is_breb_bancolombia'):
        return None
    preview = str(analysis.get('raw_text_preview') or '')
    if _text_looks_like_binance_usdt_comprobante(preview):
        detected = [
            digits_only(str(a))
            for a in (analysis.get('account_numbers_detected') or [])
            if digits_only(str(a))
        ]
        if not detected:
            return None
    expected = digits_only(str(analysis.get('account_expected_digits') or ''))
    if not expected:
        return None

    account_match = analysis.get('account_matches_configured')
    if account_match is not False:
        # Sin número detectado no bloqueamos aquí (revisión manual); la marca la valida proof_payment_brand_mismatch
        return None

    detected_parts: list[str] = []
    for acc in analysis.get('account_numbers_detected') or []:
        display = _format_account_display(str(acc))
        if display not in detected_parts:
            detected_parts.append(display)
    for suf in analysis.get('account_suffixes_detected') or []:
        display = _format_account_display(str(suf))
        if display not in detected_parts:
            detected_parts.append(display)

    detected_label = ', '.join(detected_parts) if detected_parts else 'otra cuenta'
    expected_label = _format_account_display(expected)
    return (
        'La cuenta del comprobante no coincide con el medio de pago que seleccionaste. '
        f'En la foto detectamos {detected_label}; el medio elegido es {expected_label}. '
        'Verifica que hayas seleccionado la cuenta correcta e intenta de nuevo.'
    )
