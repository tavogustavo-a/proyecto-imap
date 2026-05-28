# app/store/balance_recharge_analyzer.py
"""Análisis automático de comprobantes de recarga (OCR + patrones extensibles)."""

from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from app.extensions import db
from app.store.models import BalanceRecharge, StoreSetting

SETTING_KEY = 'balance_recharge_analyzer_patterns'

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
        'payment_method_ids': ['bancolombia'],
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
        'account_regexes': [
            r'(?:producto\s+destino|cuenta\s+destino|destino|ahorros)[^\d]{0,100}'
            r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
            r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
            r'\b(\d{11})\b',
        ],
    },
    {
        'id': 'nequi_transfer',
        'label': 'Transferencia Nequi',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['nequi'],
        'text_must_contain': ['nequi'],
        'amount_regexes': [
            r'\$\s*([\d][\d.\s,]*)',
            r'([\d][\d.\s,]*)\s*(?:COP|cops)?',
            r'(?:valor|monto|transferencia)[^\d]{0,25}(\d{4,9})',
        ],
        'receipt_regexes': [
            r'(?:comprobante|referencia|transaccion|transacción)\s*(?:no\.?|n[°o]\.?|#)?\s*(\d{6,14})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
            r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
        ],
        'account_regexes': [],
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
    """Extrae dígitos de cuenta esperados desde los datos del medio de pago."""
    d = digits_only(details)
    return d if len(d) >= 8 else ''


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


def _amount_whole_units(value: Decimal | float) -> int:
    return int(round(float(value)))


def _amounts_equivalent(claimed: Decimal | float, detected: Decimal | float, currency: str = 'COP') -> bool:
    """Compara montos ignorando formato (. ,) — mismo valor numérico en pesos/dólares."""
    cur = (currency or 'COP').upper()
    c = float(claimed)
    d = float(detected)
    if cur == 'COP':
        ci, di = _amount_whole_units(c), _amount_whole_units(d)
        if ci == di:
            return True
        return abs(ci - di) <= max(1, int(abs(ci) * 0.01))
    tol = max(0.01, abs(c) * 0.01)
    return abs(c - d) <= tol


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


def _normalize_text_for_match(text: str) -> str:
    t = unicodedata.normalize('NFD', (text or '').lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', t)


def _text_contains_all(text: str, terms: list[str]) -> bool:
    norm = _normalize_text_for_match(text)
    return all(_normalize_text_for_match(term) in norm for term in terms if str(term).strip())


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

    return '\n'.join(chunks), sources


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
    """Detecta cuentas destino en texto OCR (formato 725 - 776613 - 50 o 72577661350)."""
    found: list[str] = []
    for raw in _find_by_regexes(text, _GLOBAL_ACCOUNT_REGEXES, group=True):
        norm = digits_only(raw)
        if len(norm) >= 10 and norm not in found:
            found.append(norm)
    return found


def _accounts_match_configured(expected_digits: str, detected_accounts: list[str]) -> bool:
    """True si alguna cuenta detectada coincide exactamente con la configurada."""
    exp = digits_only(expected_digits)
    if not exp or len(exp) < 8:
        return False
    for acc in detected_accounts or []:
        det = digits_only(acc)
        if det and det == exp:
            return True
    return False


def _filter_amount_false_positives(
    amounts: list[Decimal],
    account_numbers: list[str],
) -> list[Decimal]:
    """Excluye montos que son fragmentos de números de cuenta (p. ej. 476019)."""
    acct = [digits_only(a) for a in (account_numbers or []) if digits_only(a)]
    if not acct:
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
            out.append(amt)
    return out


def _parse_receipt_date(raw: str) -> date | None:
    s = str(raw or '').strip().lower()
    if not s:
        return None

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


def _extract_fields_from_patterns(text: str, patterns: list[dict]) -> dict[str, Any]:
    receipt_numbers: list[str] = []
    receipt_dates: list[str] = []
    parsed_dates: list[str] = []
    account_numbers: list[str] = []

    for pat in patterns:
        for r in _find_by_regexes(text, pat.get('receipt_regexes') or [], group=True):
            digits = digits_only(r)
            if digits and digits not in receipt_numbers:
                receipt_numbers.append(digits)
        for d in _find_by_regexes(text, pat.get('date_regexes') or [], group=True):
            if d not in receipt_dates:
                receipt_dates.append(d)
                parsed = _parse_receipt_date(d)
                if parsed and parsed.isoformat() not in parsed_dates:
                    parsed_dates.append(parsed.isoformat())
        for a in _find_by_regexes(text, pat.get('account_regexes') or [], group=True):
            norm = digits_only(a)
            if len(norm) >= 10 and norm not in account_numbers:
                account_numbers.append(norm)

    for norm in _scan_account_numbers_in_text(text):
        if norm not in account_numbers:
            account_numbers.append(norm)

    receipt_set = set(receipt_numbers)
    account_numbers = [a for a in account_numbers if a not in receipt_set]

    return {
        'receipt_numbers': receipt_numbers,
        'receipt_dates_raw': receipt_dates,
        'receipt_dates_parsed': parsed_dates,
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
    upload_date: date | None = None,
) -> dict[str, Any]:
    """Analiza comprobante: OCR, montos, comprobante, fecha, cuenta y patrones."""
    text, sources = _extract_text_from_image(image_path)
    patterns = get_analyzer_patterns()
    applicable = _patterns_for_payment_method(
        patterns, currency, payment_method_id, payment_method_label
    )

    extracted = _extract_fields_from_patterns(text, applicable)
    receipt_number = extracted['receipt_numbers'][0] if extracted['receipt_numbers'] else None
    receipt_date_parsed = None
    if extracted['receipt_dates_parsed']:
        try:
            receipt_date_parsed = date.fromisoformat(extracted['receipt_dates_parsed'][0])
        except ValueError:
            receipt_date_parsed = None

    expected_account = account_digits_from_details(payment_method_details)
    account_match = None
    if expected_account:
        account_match = _accounts_match_configured(
            expected_account,
            extracted['account_numbers'],
        )

    upload_day = upload_date
    date_matches_upload = None
    if receipt_date_parsed and upload_day:
        date_matches_upload = receipt_date_parsed == upload_day

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

    for extra in _filter_amount_false_positives(
        _scan_amounts_in_text(text),
        extracted.get('account_numbers') or [],
    ):
        fv = float(extra)
        if fv not in detected_amounts:
            detected_amounts.append(fv)

    detected_amounts = [
        float(x)
        for x in _filter_amount_false_positives(
            [Decimal(str(v)) for v in detected_amounts],
            extracted.get('account_numbers') or [],
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
            notes.append('La fecha del comprobante coincide con hoy (Colombia).')
        elif date_matches_upload is False:
            notes.append('La fecha del comprobante NO es de hoy (Colombia).')
    if expected_account:
        if account_match is True:
            notes.append('La cuenta destino coincide con el medio de pago.')
        elif account_match is False:
            detected = extracted['account_numbers'][0] if extracted['account_numbers'] else None
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
        'date_matches_upload': date_matches_upload,
        'account_numbers_detected': extracted['account_numbers'],
        'account_expected_digits': expected_account or None,
        'account_matches_configured': account_match,
        'payment_method_label': payment_method_label or None,
        'raw_text_preview': (text[:2000] if text else ''),
        'ready_for_auto': bool(
            amount_match
            and patterns_ok
            and (date_matches_upload is not False)
            and (account_match is not False)
        ),
        'note': ' '.join(notes),
    }
