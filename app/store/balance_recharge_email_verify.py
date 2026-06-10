# Verificación de recargas contra correos bancarios (buzón BD + IMAP configurado).

from __future__ import annotations

import html
import json
import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import or_

from app.models import ReceivedEmail
from app.store.balance_recharge_analyzer import (
    _amounts_equivalent,
    _extract_fields_from_patterns,
    _find_amounts_in_text,
    _normalize_amount,
    _parse_receipt_date,
    _parse_receipt_time,
    _patterns_for_payment_method,
    _scan_account_numbers_in_text,
    _scan_breb_llaves_in_text,
    _text_contains_all,
    _time_to_minute,
    digits_only,
    get_analyzer_patterns,
)
from app.store.balance_recharge_email_review import (
    get_email_review_settings,
    list_email_regex_entries,
)
from app.store.balance_recharge_imap import get_reachable_recarga_imap_adapters
from app.utils.timezone import COLOMBIA_TZ, get_colombia_now, utc_to_colombia

_BANCOLOMBIA_EMAIL_DT_RX = re.compile(
    r'el\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+a\s+las\s+(\d{1,2}:\d{2})',
    re.IGNORECASE,
)

logger = logging.getLogger(__name__)


def sanitize_for_json(obj: Any) -> Any:
    """Convierte date/datetime/Decimal para guardar o devolver JSON sin TypeError."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, time):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {str(k): sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize_for_json(v) for v in obj]
    return str(obj)


def dumps_email_verify_result(result: dict[str, Any] | None) -> str:
    return json.dumps(sanitize_for_json(result or {}), ensure_ascii=False)


def _scan_plan_since_date(scan_plan: dict[str, Any]) -> date | None:
    raw = scan_plan.get('since_date')
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None

_EMAIL_SCAN_DAYS = 2
_EMAIL_SCAN_DAYS_NO_RECEIPT = 7
_MAX_BUZON_ROWS = 300
MAX_RECEIPT_AGE_DAYS = 7


def _normalize_email_body_text(text: str) -> str:
    t = str(text or '')
    t = html.unescape(t)
    t = t.replace('\u00a0', ' ')
    t = re.sub(r'[\uFF1A：]', ':', t)
    t = re.sub(r'(?i)\balas\b', 'a las', t)
    return re.sub(r'\s+', ' ', t).strip()


def _mail_body_text(mail: dict[str, Any]) -> str:
    """Texto plano del correo; si solo viene HTML (Gmail/Binance), lo convierte a texto."""
    text = str(mail.get('text') or '').strip()
    raw = str(mail.get('html') or mail.get('body_raw') or '')
    html_plain = ''
    if raw:
        cleaned = re.sub(r'<[^>]+>', ' ', raw)
        html_plain = html.unescape(re.sub(r'\s+', ' ', cleaned)).strip()
    if text and html_plain:
        body = text if len(text) >= len(html_plain) * 0.6 else html_plain
    else:
        body = text or html_plain
    return _normalize_email_body_text(body)


def _mail_datetime_colombia(raw: str | None) -> datetime | None:
    """Interpreta fecha del correo en hora Colombia (naive = local CO, aware = UTC→CO)."""
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        return COLOMBIA_TZ.localize(dt)
    return utc_to_colombia(dt.astimezone(timezone.utc))


def _parse_bancolombia_email_datetimes(body_text: str) -> tuple[list[date], list[time]]:
    """Fecha/hora de la transacción en avisos «el DD/MM/YY a las HH:MM»."""
    dates: list[date] = []
    times: list[time] = []
    norm = _normalize_email_body_text(body_text)
    for m in _BANCOLOMBIA_EMAIL_DT_RX.finditer(norm):
        d = _parse_receipt_date(m.group(1))
        t = _parse_receipt_time(m.group(2))
        if d and d not in dates:
            dates.append(d)
        if t and t not in times:
            times.append(t)
    return dates, times


def _sender_matches(from_addr: str, sender_filters: set[str]) -> bool:
    if not sender_filters:
        return True
    from_lower = (from_addr or '').lower()
    return any(s in from_lower for s in sender_filters if s)


def _collect_sender_filters(regex_entries: list[dict[str, Any]]) -> set[str]:
    out: set[str] = set()
    for entry in regex_entries:
        sender = str(entry.get('sender') or '').strip().lower()
        if sender:
            out.add(sender)
    return out


def _analyzer_payload(recharge_row) -> dict[str, Any] | None:
    raw = getattr(recharge_row, 'analyzer_json', None)
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, TypeError):
        return None


def _receipt_date_from_row(recharge_row) -> date | None:
    analyzer = _analyzer_payload(recharge_row)
    if not analyzer:
        return None
    raw = analyzer.get('receipt_date_parsed')
    if raw:
        try:
            return date.fromisoformat(str(raw))
        except ValueError:
            pass
    raw_display = analyzer.get('receipt_date_raw')
    if raw_display:
        return _parse_receipt_date(str(raw_display))
    return None


def _receipt_time_from_row(recharge_row) -> time | None:
    analyzer = _analyzer_payload(recharge_row)
    if not analyzer:
        return None
    for iso in analyzer.get('receipt_times_datetime_pair_parsed') or []:
        try:
            return _time_to_minute(time.fromisoformat(str(iso)))
        except ValueError:
            continue
    dt_raw = analyzer.get('receipt_datetime_parsed')
    if dt_raw:
        try:
            return _time_to_minute(datetime.fromisoformat(str(dt_raw)).time())
        except ValueError:
            pass
    for candidate in (
        analyzer.get('receipt_time_raw'),
        analyzer.get('receipt_time_display'),
        analyzer.get('receipt_datetime_display'),
    ):
        if not candidate:
            continue
        s = str(candidate)
        if not re.search(r'[ap]\.?\s*m', s, re.IGNORECASE):
            continue
        t = _parse_receipt_time(s)
        if t:
            return t
    raw = analyzer.get('receipt_time_parsed')
    if raw:
        try:
            return _time_to_minute(time.fromisoformat(str(raw)))
        except ValueError:
            pass
    for candidate in (
        analyzer.get('receipt_time_raw'),
        analyzer.get('receipt_time_display'),
        analyzer.get('receipt_datetime_display'),
    ):
        if not candidate:
            continue
        t = _parse_receipt_time(str(candidate))
        if t:
            return t
    return None


def _parse_email_times(extracted: dict[str, Any]) -> list[time]:
    out: list[time] = []
    for iso in extracted.get('receipt_times_parsed') or []:
        try:
            t = _time_to_minute(time.fromisoformat(str(iso)))
            if t and t not in out:
                out.append(t)
        except ValueError:
            continue
    for raw in extracted.get('receipt_times_raw') or []:
        t = _parse_receipt_time(str(raw))
        if t and t not in out:
            out.append(t)
    return out


def _mail_colombia_date(mail: dict[str, Any] | None) -> date | None:
    if not mail:
        return None
    dt = _mail_datetime_colombia(mail.get('date') or mail.get('internal_date'))
    return dt.date() if dt else None


def _times_equivalent(expected: time, candidates: list[time]) -> bool:
    expected = _time_to_minute(expected) or expected
    for t in candidates:
        t = _time_to_minute(t) or t
        if t.hour == expected.hour and t.minute == expected.minute:
            return True
    return False


def _mail_colombia_time(mail: dict[str, Any] | None) -> time | None:
    """Hora de recepción del correo en Colombia (respaldo si el cuerpo no trae «a las HH:MM»)."""
    if not mail:
        return None
    dt = _mail_datetime_colombia(mail.get('date') or mail.get('internal_date'))
    if not dt:
        return None
    return _time_to_minute(dt.time())


def _is_binance_style_payment_method(payment_method_id: str) -> bool:
    """
    Binance Pay / USDT: el pantallazo no trae fecha fiable; la verificación por correo
    usa ventana de 2 días y no exige hora (ni fecha del OCR) frente al aviso por email.
    """
    pm = (payment_method_id or '').strip().lower()
    if not pm:
        return False
    if any(token in pm for token in ('binance', 'binanse', 'usdt')):
        return True
    from app.store.balance_recharge_payment import _find_method_by_id

    method = _find_method_by_id(pm)
    if not method:
        return False
    brand = str(method.get('payment_brand') or '').strip().lower()
    if brand in ('binance', 'usdt'):
        return True
    for item in method.get('linked_brands') or []:
        if str(item or '').strip().lower() in ('binance', 'binanse', 'usdt'):
            return True
    return False


def _is_binance_style_recharge(recharge_row, payment_method_id: str = '') -> bool:
    """Binance según snapshot del envío; evita que un cambio en admin altere la regla."""
    from app.store.balance_recharge_payment import (
        payment_context_is_binance,
        recharge_frozen_payment_context,
    )

    ctx = recharge_frozen_payment_context(recharge_row)
    if ctx.get('frozen_at_submit'):
        return payment_context_is_binance(ctx)
    pm_id = payment_method_id or str(getattr(recharge_row, 'payment_method_id', '') or '')
    return _is_binance_style_payment_method(pm_id)


def _email_uses_relaxed_correo_rules(recharge_row, payment_method_id: str = '') -> bool:
    """
    Solo Binance Pay y wallets USDT on-chain (ERC20/TRC20).
    Nequi, Bre-B, bancos, PayPal, etc. siguen exigiendo comprobante y cuenta en el correo.
    """
    from app.store.balance_recharge_payment import (
        payment_context_uses_relaxed_email_rules,
        recharge_frozen_payment_context,
    )

    ctx = recharge_frozen_payment_context(recharge_row)
    return payment_context_uses_relaxed_email_rules(ctx)


def _is_bancolombia_classic_email_verify(
    recharge_row,
    payment_method_id: str = '',
) -> bool:
    """Cuenta Bancolombia tradicional: el correo no trae el Comprobante No. de la app."""
    from app.store.balance_recharge_analyzer import payment_method_brand_token
    from app.store.balance_recharge_payment import (
        payment_method_is_breb_bancolombia,
        payment_method_is_breb_nequi,
    )

    pm_id = (
        payment_method_id
        or str(getattr(recharge_row, 'payment_method_id', '') or '')
    ).strip()
    method = _payment_method_for_recharge_row(recharge_row) if recharge_row is not None else None
    if payment_method_is_breb_bancolombia(method) or payment_method_is_breb_nequi(method):
        return False
    brand = payment_method_brand_token(
        method,
        payment_method_id=pm_id,
        payment_method_label=str((method or {}).get('label') or ''),
    )
    return brand == 'bancolombia'


def _email_skips_receipt_crosscheck(recharge_row, payment_method_id: str = '') -> bool:
    """Correo sin el mismo comprobante que el pantallazo (Binance, app Bancolombia, etc.)."""
    if recharge_row is not None and _email_uses_relaxed_correo_rules(recharge_row, payment_method_id):
        return True
    analyzer = _analyzer_payload(recharge_row) if recharge_row is not None else None
    if isinstance(analyzer, dict) and analyzer.get('is_bancolombia_app_transfer_exitosa_receipt'):
        return True
    if recharge_row is not None and _is_bancolombia_classic_email_verify(recharge_row, payment_method_id):
        return True
    return False


def _email_receipt_matches(
    receipt_expected: str,
    extracted_receipts: list[str],
    *,
    payment_method_id: str = '',
    recharge_row=None,
) -> bool:
    """Cruza el comprobante OCR con IDs extraídos del correo bancario."""
    if recharge_row is not None and _email_skips_receipt_crosscheck(recharge_row, payment_method_id):
        return True
    if not receipt_expected:
        return True
    found = [digits_only(r) for r in (extracted_receipts or []) if digits_only(r)]
    if not found:
        if recharge_row is not None:
            if _is_binance_style_recharge(recharge_row, payment_method_id):
                return True
        elif _is_binance_style_payment_method(payment_method_id):
            return True
        return False
    return receipt_expected in found


def _parse_email_dates(extracted: dict[str, Any]) -> list[date]:
    out: list[date] = []
    for raw in extracted.get('receipt_dates_raw') or []:
        s = str(raw).strip()
        if re.match(r'^\d{4}-\d{1,2}-\d{1,2}', s):
            try:
                d = date.fromisoformat(s[:10])
                if d not in out:
                    out.append(d)
                continue
            except ValueError:
                pass
        d = _parse_receipt_date(s)
        if d and d not in out:
            out.append(d)
    for iso in extracted.get('receipt_dates_parsed') or []:
        try:
            d = date.fromisoformat(str(iso))
        except ValueError:
            continue
        if d not in out:
            out.append(d)
    return out


def _email_datetime_matches_receipt(
    extracted: dict[str, Any],
    expected_date: date | None,
    expected_time: time | None,
    mail: dict[str, Any] | None = None,
    body_text: str | None = None,
) -> tuple[bool, bool]:
    """Compara fecha/hora del correo con las del comprobante OCR (si existen)."""
    email_dates = _parse_email_dates(extracted)
    email_times = _parse_email_times(extracted)
    if body_text:
        body_dates, body_times = _parse_bancolombia_email_datetimes(body_text)
        for d in body_dates:
            if d not in email_dates:
                email_dates.append(d)
        for t in body_times:
            if t not in email_times:
                email_times.insert(0, t)
    if mail:
        mail_day = _mail_colombia_date(mail)
        if mail_day and mail_day not in email_dates:
            email_dates.append(mail_day)
    date_match = True
    time_match = True
    if expected_date:
        date_match = expected_date in email_dates
    if expected_time:
        time_match = _times_equivalent(expected_time, email_times)
        if not time_match:
            col_time = _mail_colombia_time(mail)
            if col_time and _times_equivalent(expected_time, [col_time]):
                time_match = True
    return date_match, time_match


def _email_verification_full_match(
    *,
    amount_match: bool,
    receipt_match: bool,
    date_match: bool,
    time_match: bool,
    account_match: bool,
    expected_date: date | None,
    expected_time: time | None,
) -> bool:
    if not amount_match or not account_match or not receipt_match:
        return False
    if expected_date and not date_match:
        return False
    if expected_time and not time_match:
        return False
    return True


def _colombia_date_start_utc(d: date) -> datetime:
    dt_col = COLOMBIA_TZ.localize(datetime.combine(d, time.min))
    return dt_col.astimezone(timezone.utc)


def _upload_date_colombia(recharge_row) -> date | None:
    created = getattr(recharge_row, 'created_at', None)
    if not created:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return utc_to_colombia(created).date()


def _uses_email_window_scan(recharge_row, payment_method_id: str = '') -> bool:
    """Binance Pay y wallets USDT: ventana de 2 días, sin filtrar por un solo día del comprobante."""
    return _is_binance_style_recharge(recharge_row, payment_method_id) or _email_uses_relaxed_correo_rules(
        recharge_row, payment_method_id
    )


def _email_window_since_date(today: date, limit_days: int = _EMAIL_SCAN_DAYS) -> date:
    """Primer día incluido en la ventana (hoy + hasta limit_days-1 días hacia atrás)."""
    return today - timedelta(days=max(0, int(limit_days) - 1))


def _scan_receipt_date_for_row(recharge_row, *, binance_style: bool = False) -> date | None:
    """Fecha del comprobante para acotar el buzón (solo medios bancarios estrictos)."""
    if binance_style or _email_uses_relaxed_correo_rules(recharge_row):
        return None
    return _receipt_date_from_row(recharge_row)


def _receipt_match_reference_datetime(recharge_row) -> datetime | None:
    """Instante de referencia para emparejar correos del mismo día (no el más reciente del buzón)."""
    pm_id = str(getattr(recharge_row, 'payment_method_id', '') or '').strip()
    if _uses_email_window_scan(recharge_row, pm_id):
        created = getattr(recharge_row, 'created_at', None)
        if created is None:
            return None
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return utc_to_colombia(created)
    receipt_day = _receipt_date_from_row(recharge_row)
    receipt_time = _receipt_time_from_row(recharge_row)
    if receipt_day and receipt_time:
        return COLOMBIA_TZ.localize(datetime.combine(receipt_day, receipt_time))
    created = getattr(recharge_row, 'created_at', None)
    if created is None:
        if receipt_day:
            return COLOMBIA_TZ.localize(datetime.combine(receipt_day, time(12, 0)))
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    created_co = utc_to_colombia(created)
    if receipt_day:
        return COLOMBIA_TZ.localize(datetime.combine(receipt_day, created_co.time()))
    return created_co


def _mail_time_distance_seconds(mail: dict[str, Any], reference: datetime | None) -> float:
    mail_dt = _mail_datetime_colombia(mail.get('date') or mail.get('internal_date'))
    if mail_dt is None:
        return float('inf')
    if reference is None:
        return mail_dt.timestamp()
    ref = reference
    if ref.tzinfo is None:
        ref = COLOMBIA_TZ.localize(ref)
    else:
        ref = utc_to_colombia(ref.astimezone(timezone.utc))
    return abs((mail_dt - ref).total_seconds())


def _sort_emails_for_recharge_match(
    emails: list[dict[str, Any]],
    reference: datetime | None,
) -> list[dict[str, Any]]:
    """Ordena por cercanía al comprobante/envío, no por el correo más nuevo del buzón."""
    return sorted(
        emails,
        key=lambda mail: (
            _mail_time_distance_seconds(mail, reference),
            str(mail.get('message_id') or ''),
        ),
    )


def _mail_matches_receipt_day(mail: dict[str, Any], receipt_day: date | None) -> bool:
    if not receipt_day:
        return True
    mail_day = _mail_colombia_date(mail)
    if mail_day is None:
        return True
    return mail_day == receipt_day


def _needs_single_email_check(
    receipt_date: date | None,
    upload_day: date | None,
    today: date,
    date_matches_upload: bool | None,
) -> bool:
    """Una sola consulta: comprobante fuera de ventana o de días anteriores."""
    if not receipt_date:
        return False
    if date_matches_upload is False:
        return True
    if upload_day:
        from app.store.balance_recharge_analyzer import receipt_date_matches_upload_day

        if receipt_date_matches_upload_day(receipt_date, upload_day) is False:
            return True
    if receipt_date < today:
        return True
    return False


def resolve_email_scan_plan(recharge_row) -> dict[str, Any]:
    """Ventana de búsqueda y si basta una sola consulta automática."""
    today = get_colombia_now().date()
    analyzer = _analyzer_payload(recharge_row) or {}
    pm_id = str(getattr(recharge_row, 'payment_method_id', '') or '').strip()
    email_window_mode = _uses_email_window_scan(recharge_row, pm_id)
    binance_style = email_window_mode
    upload_day = _upload_date_colombia(recharge_row)
    date_matches_upload = analyzer.get('date_matches_upload')

    if email_window_mode:
        limit_days = _EMAIL_SCAN_DAYS
        window_since = _email_window_since_date(today, limit_days)
        return {
            'skip': False,
            'single_check_only': False,
            'limit_days': limit_days,
            'since_date': window_since.isoformat(),
            'receipt_date': None,
            'upload_date': upload_day.isoformat() if upload_day else None,
            'date_matches_upload': date_matches_upload,
            'email_window_mode': True,
            'binance_style': True,
            'message': None,
        }

    receipt_date = _scan_receipt_date_for_row(recharge_row, binance_style=False)
    if receipt_date and upload_day and date_matches_upload is None:
        from app.store.balance_recharge_analyzer import receipt_date_matches_upload_day

        date_matches_upload = receipt_date_matches_upload_day(receipt_date, upload_day)

    if receipt_date:
        age_days = (today - receipt_date).days
        if age_days > MAX_RECEIPT_AGE_DAYS:
            return {
                'skip': True,
                'single_check_only': True,
                'limit_days': 0,
                'since_date': None,
                'receipt_date': receipt_date.isoformat(),
                'upload_date': upload_day.isoformat() if upload_day else None,
                'date_matches_upload': date_matches_upload,
                'message': (
                    f'El comprobante es del {receipt_date.strftime("%d/%m/%Y")} '
                    f'(más de {MAX_RECEIPT_AGE_DAYS} días). Solo revisión manual.'
                ),
            }

        if _needs_single_email_check(receipt_date, upload_day, today, date_matches_upload):
            limit_days = min(max(age_days + 1, 1), MAX_RECEIPT_AGE_DAYS + 1)
            return {
                'skip': False,
                'single_check_only': True,
                'limit_days': limit_days,
                'since_date': receipt_date.isoformat(),
                'receipt_date': receipt_date.isoformat(),
                'upload_date': upload_day.isoformat() if upload_day else None,
                'date_matches_upload': date_matches_upload,
                'message': None,
            }

    # Sin fecha en comprobante: 7 días solo medios genéricos; Binance usa 2 días como el resto.
    if not receipt_date:
        limit_days = _EMAIL_SCAN_DAYS if binance_style else _EMAIL_SCAN_DAYS_NO_RECEIPT
    else:
        limit_days = _EMAIL_SCAN_DAYS
    return {
        'skip': False,
        'single_check_only': False,
        'limit_days': limit_days,
        'since_date': None,
        'receipt_date': receipt_date.isoformat() if receipt_date else None,
        'upload_date': upload_day.isoformat() if upload_day else None,
        'date_matches_upload': date_matches_upload,
        'binance_style': binance_style,
        'message': None,
    }


def email_verify_single_check_only(recharge_row) -> bool:
    return bool(resolve_email_scan_plan(recharge_row).get('single_check_only'))


def _mail_date_colombia(mail: dict[str, Any]) -> date | None:
    return _mail_colombia_date(mail)


def _mail_on_or_after_receipt(mail: dict[str, Any], receipt_date: date | None) -> bool:
    if not receipt_date:
        return True
    mail_day = _mail_date_colombia(mail)
    if mail_day is None:
        return True
    return mail_day >= receipt_date


def _fetch_buzon_emails(
    limit_days: int,
    sender_filters: set[str],
    *,
    since_date: date | None = None,
) -> list[dict[str, Any]]:
    q = ReceivedEmail.query.filter(ReceivedEmail.deleted.is_(False))
    cutoffs: list[datetime] = []
    if limit_days > 0:
        cutoffs.append(datetime.now(timezone.utc) - timedelta(days=int(limit_days)))
    if since_date:
        cutoffs.append(_colombia_date_start_utc(since_date))
    if cutoffs:
        cutoff = max(cutoffs)
        q = q.filter(
            or_(
                ReceivedEmail.received_at >= cutoff,
                ReceivedEmail.received_at.is_(None),
            )
        )
    if sender_filters:
        conds = [ReceivedEmail.from_email.ilike(f'%{s}%') for s in sender_filters]
        q = q.filter(or_(*conds))
    rows = q.order_by(ReceivedEmail.received_at.desc()).limit(_MAX_BUZON_ROWS).all()
    out: list[dict[str, Any]] = []
    for email in rows:
        rdt = email.received_at
        if rdt is None:
            rdt = datetime.now(timezone.utc)
        elif rdt.tzinfo is None:
            rdt = rdt.replace(tzinfo=timezone.utc)
        out.append(
            {
                'source': 'buzon',
                'from': email.from_email or '',
                'to': email.original_to_email or email.to_email or '',
                'subject': email.subject or '',
                'text': email.content_text or '',
                'html': email.content_html or '',
                'date': rdt.isoformat(),
                'message_id': email.message_id or f'buzon-db-{email.id}',
                'buzon_email_id': email.id,
            }
        )
    return out


def _format_mail_datetime_display(mail: dict[str, Any]) -> str:
    dt = _mail_datetime_colombia(mail.get('date') or mail.get('internal_date'))
    if not dt:
        return str(mail.get('date') or mail.get('internal_date') or '')
    return dt.strftime('%d/%m/%Y %I:%M %p')


def _fetch_imap_emails(
    limit_days: int,
    sender_filters: set[str],
    *,
    since_date: date | None = None,
) -> list[dict[str, Any]]:
    servers = get_reachable_recarga_imap_adapters()
    if not servers:
        return []

    if since_date:
        since_dt = _colombia_date_start_utc(since_date)
    else:
        since_dt = datetime.now(timezone.utc) - timedelta(days=max(1, int(limit_days)))
    from app.imap.advanced_imap import search_emails_for_observer

    found: list[dict[str, Any]] = []
    sender_list = sorted(sender_filters) if sender_filters else [None]
    for server in servers:
        for sender in sender_list:
            imap_sender = sender if sender and '@' in sender else None
            try:
                batch = search_emails_for_observer(
                    [server],
                    since_dt,
                    optional_sender_from_rule=imap_sender,
                )
            except Exception:
                batch = []
            for mail in batch or []:
                from_addr = str(mail.get('from') or '')
                if not _sender_matches(from_addr, sender_filters):
                    continue
                found.append(
                    {
                        'source': 'imap',
                        'from': from_addr,
                        'to': ', '.join(mail.get('to') or []),
                        'subject': mail.get('subject') or '',
                        'body_raw': mail.get('body_raw') or '',
                        'message_id': mail.get('message_id') or '',
                        'date': mail.get('internal_date') or mail.get('date') or '',
                        'imap_server_id': server.id,
                    }
                )
    return found


def _matched_mail_ref(mail: dict[str, Any]) -> dict[str, Any]:
    return {
        'source': mail.get('source'),
        'message_id': mail.get('message_id'),
        'buzon_email_id': mail.get('buzon_email_id'),
        'imap_server_id': mail.get('imap_server_id'),
    }


def dispose_matched_review_email(mail_ref: dict[str, Any] | None) -> bool:
    """Elimina o mueve a papelera el correo usado para verificar una recarga (evita reutilización)."""
    if not mail_ref:
        return False
    source = str(mail_ref.get('source') or '').lower()
    try:
        if source == 'buzon':
            bid = mail_ref.get('buzon_email_id')
            if not bid:
                mid = str(mail_ref.get('message_id') or '').strip()
                if mid.startswith('buzon-db-'):
                    try:
                        bid = int(mid.rsplit('-', 1)[-1])
                    except (TypeError, ValueError):
                        bid = None
            if bid:
                from app.services.email_buzon_service import move_email_to_trash

                move_email_to_trash(int(bid))
                return True
            return False

        if source == 'imap':
            mid = str(mail_ref.get('message_id') or '').strip()
            if not mid:
                return False
            from app.imap.advanced_imap import delete_emails_by_message_id
            from app.store.balance_recharge_imap import (
                get_enabled_recarga_imap_adapters,
                get_recarga_imap_adapters,
            )

            server_id = mail_ref.get('imap_server_id')
            if server_id:
                servers = get_recarga_imap_adapters([int(server_id)])
            else:
                servers = get_enabled_recarga_imap_adapters()
            if not servers:
                return False
            delete_emails_by_message_id(servers, mid)
            return True
    except Exception as exc:
        logger.warning('No se pudo eliminar correo verificado: %s', exc)
        return False
    return False


def collect_review_emails(
    *,
    use_buzon: bool,
    regex_entries: list[dict[str, Any]],
    limit_days: int = _EMAIL_SCAN_DAYS,
    since_date: date | None = None,
    receipt_date: date | None = None,
    match_reference_dt: datetime | None = None,
) -> list[dict[str, Any]]:
    sender_filters = _collect_sender_filters(regex_entries)
    emails: list[dict[str, Any]] = []
    seen: set[str] = set()
    filter_from = since_date if since_date and not receipt_date else None

    def _add(mail: dict[str, Any]) -> None:
        if receipt_date:
            if not _mail_matches_receipt_day(mail, receipt_date):
                return
        elif filter_from and not _mail_on_or_after_receipt(mail, filter_from):
            return
        key = (mail.get('message_id') or '') + '|' + (mail.get('from') or '') + '|' + (mail.get('subject') or '')
        if key in seen:
            return
        seen.add(key)
        emails.append(mail)

    if use_buzon:
        for mail in _fetch_buzon_emails(limit_days, sender_filters, since_date=since_date):
            _add(mail)

    for mail in _fetch_imap_emails(limit_days, sender_filters, since_date=since_date):
        _add(mail)

    return _sort_emails_for_recharge_match(emails, match_reference_dt)


_MASKED_ACCOUNT_SUFFIX_RX = re.compile(
    r'(?:en\s+tu\s+cuenta|cuenta)\s+\*+(\d{2,4})\b',
    re.IGNORECASE,
)


def _extract_masked_account_suffixes(body_text: str) -> list[str]:
    found: list[str] = []
    for m in _MASKED_ACCOUNT_SUFFIX_RX.finditer(body_text or ''):
        val = digits_only(m.group(1))
        if val and val not in found:
            found.append(val)
    return found


def _payment_method_for_recharge_row(recharge_row):
    from app.store.balance_recharge_payment import payment_method_for_recharge_validation

    return payment_method_for_recharge_validation(recharge_row)


def _expected_account_digits_for_recharge(recharge_row) -> str:
    from app.store.balance_recharge_payment import expected_account_digits_for_recharge

    return expected_account_digits_for_recharge(recharge_row)


def _frozen_payment_context_for_recharge(recharge_row):
    from app.store.balance_recharge_payment import recharge_frozen_payment_context

    return recharge_frozen_payment_context(recharge_row)


def _receipt_account_ok_from_analyzer(recharge_row) -> bool | None:
    analyzer = _analyzer_payload(recharge_row)
    if not analyzer:
        return None
    if 'account_matches_configured' not in analyzer:
        return None
    return analyzer.get('account_matches_configured')


def _receipt_amount_ok_from_analyzer(recharge_row) -> bool | None:
    """True solo si el OCR del comprobante confirmó el monto declarado."""
    analyzer = _analyzer_payload(recharge_row)
    if not analyzer:
        return None
    if 'amount_matches_claimed' not in analyzer:
        return None
    return analyzer.get('amount_matches_claimed')


def _receipt_breb_llaves_from_row(recharge_row) -> list[str]:
    from app.store.balance_recharge_analyzer import _sanitize_breb_llave_token

    analyzer = _analyzer_payload(recharge_row)
    if not analyzer:
        return []
    ocr_ctx = str(analyzer.get('raw_text_preview') or '')
    out: list[str] = []
    for raw in analyzer.get('bre_b_llaves_detected') or []:
        key = _sanitize_breb_llave_token(str(raw), ocr_ctx)
        if key and key not in out:
            out.append(key)
    return out


def _email_breb_llave_matches(recharge_row, body_text: str, extracted: dict[str, Any]) -> bool:
    """La llave del comprobante (OCR) debe coincidir exactamente con la del medio Bre-B."""
    from app.store.balance_recharge_payment import (
        payment_method_breb_llave_normalized,
        payment_method_uses_breb_llave,
    )

    ctx = _frozen_payment_context_for_recharge(recharge_row)
    if ctx.get('frozen_at_submit'):
        if not ctx.get('is_breb_bancolombia') and not ctx.get('is_breb_nequi'):
            return True
        expected = str(ctx.get('bre_b_llave_expected') or '').strip()
    else:
        method = _payment_method_for_recharge_row(recharge_row)
        if not payment_method_uses_breb_llave(method):
            return True
        expected = payment_method_breb_llave_normalized(method)
    if not expected:
        return True

    from app.store.balance_recharge_payment import breb_llave_matches_expected

    receipt_llaves = _receipt_breb_llaves_from_row(recharge_row)
    if receipt_llaves:
        return breb_llave_matches_expected(expected, receipt_llaves)

    email_llaves = _scan_breb_llaves_in_text(body_text)
    if email_llaves:
        return breb_llave_matches_expected(expected, email_llaves)

    return False


def _resolve_account_match(
    recharge_row,
    extracted: dict[str, Any],
) -> tuple[bool, bool]:
    """(coincide, revisión requerida). Si no coincide, queda aprobación manual."""
    from app.store.balance_recharge_payment import (
        payment_method_breb_llave_normalized,
        payment_method_is_breb_bancolombia,
        payment_method_is_breb_nequi,
        payment_method_is_generic,
    )

    ctx = _frozen_payment_context_for_recharge(recharge_row)
    pm_id = str(ctx.get('payment_method_id') or getattr(recharge_row, 'payment_method_id', '') or '').strip()
    method = _payment_method_for_recharge_row(recharge_row)
    pm_label = str(ctx.get('label') or (method or {}).get('label') or '')
    expected = _expected_account_digits_for_recharge(recharge_row)
    frozen = bool(ctx.get('frozen_at_submit'))
    is_breb_nequi = bool(ctx.get('is_breb_nequi')) if frozen else payment_method_is_breb_nequi(method)
    is_breb = bool(ctx.get('is_breb_bancolombia')) if frozen else payment_method_is_breb_bancolombia(method)
    is_generic = bool(ctx.get('is_generic')) if frozen else payment_method_is_generic(method, pm_id, pm_label)
    breb_llave = (
        str(ctx.get('bre_b_llave_expected') or '').strip()
        if frozen
        else payment_method_breb_llave_normalized(method)
    )

    if not expected:
        if is_breb and not is_breb_nequi:
            if not breb_llave:
                return False, True
            ocr_ok = _receipt_account_ok_from_analyzer(recharge_row)
            if ocr_ok is False:
                return False, True
            return True, False
        if is_generic:
            ocr_ok = _receipt_account_ok_from_analyzer(recharge_row)
            if ocr_ok is False:
                return False, True
            return True, False
        return False, True

    # Binance Pay / depósito USDT: el correo no trae wallet; no cruzar cuenta del email.
    if _email_uses_relaxed_correo_rules(recharge_row, pm_id):
        ocr_ok = _receipt_account_ok_from_analyzer(recharge_row)
        if ocr_ok is False:
            return False, True
        return True, False

    full_accounts = list(extracted.get('account_numbers') or [])
    suffixes = list(extracted.get('account_suffixes') or [])
    has_email_account = bool(full_accounts or suffixes)

    # Nequi / bancos: el correo debe mencionar la cuenta o los últimos dígitos configurados.
    if not has_email_account:
        ocr_ok = _receipt_account_ok_from_analyzer(recharge_row)
        if ocr_ok is True:
            return True, True
        return False, True

    ocr_ok = _receipt_account_ok_from_analyzer(recharge_row)
    if ocr_ok is False:
        return False, True

    if has_email_account:
        from app.store.balance_recharge_analyzer import resolve_account_match

        # Misma regla que OCR del comprobante (paso 12).
        email_match = resolve_account_match(expected, full_accounts, suffixes)
        if email_match is not True:
            return False, True
        if ocr_ok is True:
            return True, True
        return False, True

    if ocr_ok is True:
        return True, True

    return False, True


def _regex_entry_matches_payment_method(entry: dict[str, Any], pm: str) -> bool:
    """Solo el regex del mismo medio de pago (id exacto); sin mezclar Nequi con Binance."""
    entry_pm_id = str(entry.get('payment_method_id') or '').strip().lower()
    pm = (pm or '').strip().lower()
    if not entry_pm_id or not pm:
        return False
    return entry_pm_id == pm


def _regex_entries_for_payment_method(payment_method_id: str) -> list[dict[str, Any]]:
    pm = (payment_method_id or '').strip().lower()
    entries = [
        e for e in list_email_regex_entries()
        if e.get('enabled', True) and str(e.get('pattern') or '').strip()
    ]
    if not pm:
        return entries
    return [e for e in entries if _regex_entry_matches_payment_method(e, pm)]


def _extract_payment_fields(
    body_text: str,
    payment_method_id: str,
    *,
    payment_method_label: str = '',
    currency: str = 'COP',
) -> dict[str, Any]:
    from app.store.balance_recharge_payment import _find_method_by_id

    pm = (payment_method_id or '').strip().lower()
    label = (payment_method_label or '').strip()
    method = _find_method_by_id(pm) if pm else None
    if method and not label:
        label = str(method.get('label') or '')

    patterns = get_analyzer_patterns()
    applicable = _patterns_for_payment_method(patterns, currency, pm, label)
    narrowed = [
        pat for pat in applicable
        if not [str(x) for x in (pat.get('text_must_contain') or []) if str(x).strip()]
        or _text_contains_all(
            body_text,
            [str(x) for x in (pat.get('text_must_contain') or []) if str(x).strip()],
        )
    ]
    if narrowed:
        applicable = narrowed

    extracted = _extract_fields_from_patterns(body_text, applicable)
    for llave in _scan_breb_llaves_in_text(body_text):
        if llave not in extracted['account_numbers']:
            extracted['account_numbers'].append(llave)
    for norm in _scan_account_numbers_in_text(
        body_text,
        payment_method=method,
        payment_method_id=pm,
        payment_method_label=label,
    ):
        if norm not in extracted['account_numbers']:
            extracted['account_numbers'].append(norm)

    amounts: list[float] = []
    for pat in applicable:
        for amt in _find_amounts_in_text(body_text, pat.get('amount_regexes') or []):
            fv = float(amt)
            if fv not in amounts:
                amounts.append(fv)

    suffixes = _extract_masked_account_suffixes(body_text)
    for acct in extracted.get('account_numbers') or []:
        d = digits_only(str(acct))
        if len(d) >= 2 and len(d) <= 4 and d not in suffixes:
            suffixes.append(d)

    return {
        'amounts': amounts,
        'receipt_numbers': extracted.get('receipt_numbers') or [],
        'account_numbers': extracted.get('account_numbers') or [],
        'account_suffixes': suffixes,
        'receipt_dates_raw': extracted.get('receipt_dates_raw') or [],
        'receipt_dates_parsed': extracted.get('receipt_dates_parsed') or [],
        'receipt_times_raw': extracted.get('receipt_times_raw') or [],
        'receipt_times_parsed': extracted.get('receipt_times_parsed') or [],
    }


def _sender_matches_entry(from_addr: str, sender_filter: str) -> bool:
    """
    Filtro de remitente: fragmento en el From (ej. binance, mail.binance.com).
    Varios valores separados por coma.
    """
    spec = (sender_filter or '').strip().lower()
    if not spec:
        return True
    from_lower = (from_addr or '').lower()
    for part in re.split(r'[,;]+', spec):
        token = part.strip()
        if token and token in from_lower:
            return True
    return False


def _capture_from_regex_pattern(
    body_text: str,
    subject: str,
    pattern: str,
) -> tuple[list[float], list[str], list[str], list[str]]:
    """Grupos admin: 1 monto, 2 sufijo *XXXX, 3 fecha dd/mm/yyyy, 4 hora HH:MM."""
    pattern = (pattern or '').strip()
    if not pattern:
        return [], [], [], []
    haystack = f'{subject}\n{body_text}' if subject else body_text
    try:
        match = re.search(pattern, haystack, re.IGNORECASE | re.DOTALL)
    except re.error:
        return [], [], [], []
    if not match or not match.lastindex:
        return [], [], [], []

    amounts: list[float] = []
    suffixes: list[str] = []
    dates_raw: list[str] = []
    times_raw: list[str] = []

    raw_amt = match.group(1)
    if raw_amt is not None:
        val = _normalize_amount(str(raw_amt).strip())
        if val is not None:
            amounts.append(float(val))

    if match.lastindex and match.lastindex >= 2:
        raw_acct = match.group(2)
        if raw_acct is not None:
            suf = digits_only(str(raw_acct).strip())
            if len(suf) > 4:
                suf = suf[-4:]
            if len(suf) >= 2 and suf not in suffixes:
                suffixes.append(suf)

    if match.lastindex and match.lastindex >= 3:
        raw_date = match.group(3)
        if raw_date is not None:
            d = str(raw_date).strip()
            if d and d not in dates_raw:
                dates_raw.append(d)

    if match.lastindex and match.lastindex >= 4:
        raw_time = match.group(4)
        if raw_time is not None:
            t = str(raw_time).strip()
            if t and t not in times_raw:
                times_raw.append(t)

    return amounts, suffixes, dates_raw, times_raw


def _amounts_from_regex_pattern(
    body_text: str,
    subject: str,
    pattern: str,
) -> list[float]:
    amounts, _, _, _ = _capture_from_regex_pattern(body_text, subject, pattern)
    return amounts


def _merge_amounts_from_matched_regex(
    extracted: dict[str, Any],
    *,
    body_text: str,
    mail: dict[str, Any],
    matched_entries: list[dict[str, Any]],
) -> dict[str, Any]:
    subject = str(mail.get('subject') or '').strip()
    amounts = list(extracted.get('amounts') or [])
    suffixes = list(extracted.get('account_suffixes') or [])
    dates_raw = list(extracted.get('receipt_dates_raw') or [])
    times_raw = list(extracted.get('receipt_times_raw') or [])
    for entry in matched_entries:
        pattern = str(entry.get('pattern') or '').strip()
        cap_amounts, cap_suffixes, cap_dates, cap_times = _capture_from_regex_pattern(
            body_text, subject, pattern
        )
        for amt in cap_amounts:
            if amt not in amounts:
                amounts.append(amt)
        for suf in cap_suffixes:
            if suf not in suffixes:
                suffixes.append(suf)
        for d in cap_dates:
            if d not in dates_raw:
                dates_raw.append(d)
        for t in cap_times:
            if t not in times_raw:
                times_raw.append(t)
    extracted['amounts'] = amounts
    extracted['account_suffixes'] = suffixes
    extracted['receipt_dates_raw'] = dates_raw
    extracted['receipt_times_raw'] = times_raw
    return extracted


def _entry_matches_mail(entry: dict[str, Any], mail: dict[str, Any], body_text: str) -> bool:
    sender = str(entry.get('sender') or '').strip()
    if not _sender_matches_entry(mail.get('from') or '', sender):
        return False
    pattern = str(entry.get('pattern') or '').strip()
    if not pattern:
        return False
    subject = str(mail.get('subject') or '').strip()
    haystack = f'{subject}\n{body_text}' if subject else body_text
    try:
        return bool(re.search(pattern, haystack, re.IGNORECASE | re.DOTALL))
    except re.error:
        return False


def verify_recharge_by_email(recharge_row) -> dict[str, Any]:
    """Busca correo bancario que respalde una recarga auto-acreditada."""
    scan_plan = resolve_email_scan_plan(recharge_row)
    if scan_plan.get('skip'):
        return {
            'status': 'skipped',
            'message': scan_plan.get('message') or 'Comprobante demasiado antiguo para revisión automática.',
            'checked': False,
            'scan_plan': scan_plan,
        }

    settings = get_email_review_settings()
    pm_id = str(getattr(recharge_row, 'payment_method_id', '') or '').strip().lower()
    regex_entries = _regex_entries_for_payment_method(pm_id)

    if not regex_entries:
        all_for_pm = [
            e for e in list_email_regex_entries()
            if e.get('enabled', True)
            and str(e.get('payment_method_id') or '').strip().lower() == pm_id
        ]
        if all_for_pm and not any(str(e.get('pattern') or '').strip() for e in all_for_pm):
            return {
                'status': 'no_regex',
                'message': 'Hay regex para este medio pero falta configurar el patrón.',
                'checked': False,
            }
        return {
            'status': 'no_regex',
            'message': 'No hay regex con patrón configurado para este medio de pago.',
            'checked': False,
        }

    use_buzon = bool(settings.get('buzon_enabled'))
    has_imap = bool(get_reachable_recarga_imap_adapters())
    if not use_buzon and not has_imap:
        return {
            'status': 'no_source',
            'message': 'Sin buzón activo ni IMAP operativo; queda revisión manual.',
            'checked': False,
        }

    since_date = _scan_plan_since_date(scan_plan)
    receipt_date = None
    if scan_plan.get('receipt_date'):
        try:
            receipt_date = date.fromisoformat(str(scan_plan['receipt_date']))
        except ValueError:
            receipt_date = None

    match_reference_dt = _receipt_match_reference_datetime(recharge_row)

    emails = collect_review_emails(
        use_buzon=use_buzon,
        regex_entries=regex_entries,
        limit_days=int(scan_plan.get('limit_days') or _EMAIL_SCAN_DAYS),
        since_date=since_date,
        receipt_date=receipt_date,
        match_reference_dt=match_reference_dt,
    )

    currency = (recharge_row.currency or 'COP').strip().upper()
    claimed = recharge_row.amount_credited
    if claimed is None:
        claimed = recharge_row.amount_claimed
    claimed_f = float(claimed) if claimed is not None else 0.0
    receipt_expected = digits_only(getattr(recharge_row, 'receipt_number', None) or '')
    if _email_uses_relaxed_correo_rules(recharge_row, pm_id):
        receipt_date_expected = None
        receipt_time_expected = None
    else:
        receipt_date_expected = _receipt_date_from_row(recharge_row)
        receipt_time_expected = _receipt_time_from_row(recharge_row)

    pm_method = _payment_method_for_recharge_row(recharge_row)
    pm_label = str((pm_method or {}).get('label') or '')

    best_partial: dict[str, Any] | None = None

    for mail in emails:
        body_text = _mail_body_text(mail)
        if not body_text:
            continue

        matched_entries = [
            e for e in regex_entries if _entry_matches_mail(e, mail, body_text)
        ]
        if not matched_entries:
            continue

        extracted = _extract_payment_fields(
            body_text,
            pm_id,
            payment_method_label=pm_label,
            currency=currency,
        )
        extracted = _merge_amounts_from_matched_regex(
            extracted,
            body_text=body_text,
            mail=mail,
            matched_entries=matched_entries,
        )
        amount_match = any(
            _amounts_equivalent(claimed_f, Decimal(str(a)), currency)
            for a in extracted['amounts']
        )
        ocr_amount_ok = _receipt_amount_ok_from_analyzer(recharge_row)
        if ocr_amount_ok is not True:
            amount_match = False

        receipt_digits = [digits_only(r) for r in extracted['receipt_numbers']]
        receipt_match = _email_receipt_matches(
            receipt_expected,
            receipt_digits,
            payment_method_id=pm_id,
            recharge_row=recharge_row,
        )
        receipt_found = receipt_digits[0] if receipt_digits else ''

        date_match, time_match = _email_datetime_matches_receipt(
            extracted,
            receipt_date_expected,
            receipt_time_expected,
            mail=mail,
            body_text=body_text,
        )
        account_match, _account_check = _resolve_account_match(recharge_row, extracted)
        if not _email_uses_relaxed_correo_rules(recharge_row, pm_id):
            if not _email_breb_llave_matches(recharge_row, body_text, extracted):
                account_match = False
        expected_account = _expected_account_digits_for_recharge(recharge_row)

        email_summary = {
            'source': mail.get('source'),
            'from': mail.get('from') or '',
            'subject': mail.get('subject') or '',
            'date': mail.get('date') or '',
            'date_display': _format_mail_datetime_display(mail),
            'amounts_detected': extracted['amounts'],
            'receipt_numbers': extracted['receipt_numbers'],
            'account_numbers': extracted['account_numbers'],
            'account_suffixes': extracted.get('account_suffixes') or [],
            'account_expected_suffix': expected_account[-4:] if len(expected_account) >= 4 else expected_account,
            'dates_detected': extracted.get('receipt_dates_raw') or [],
            'times_detected': extracted.get('receipt_times_raw') or [],
            'regex_matched': [e.get('description') for e in matched_entries],
        }

        if _email_verification_full_match(
            amount_match=amount_match,
            receipt_match=receipt_match,
            date_match=date_match,
            time_match=time_match,
            account_match=account_match,
            expected_date=receipt_date_expected,
            expected_time=receipt_time_expected,
        ):
            match_msg = 'Correo bancario encontrado y coincide con la recarga.'
            if _is_bancolombia_classic_email_verify(recharge_row, pm_id):
                match_msg = (
                    'Correo Bancolombia coincide (monto, cuenta *XXXX, fecha y hora).'
                )
            return {
                'status': 'matched',
                'message': match_msg,
                'checked': True,
                'amount_match': True,
                'receipt_match': receipt_match,
                'date_match': date_match,
                'time_match': time_match,
                'account_match': account_match,
                'email': email_summary,
                'matched_mail_ref': _matched_mail_ref(mail),
                'scan_plan': scan_plan,
            }

        partial = {
            'status': 'partial',
            'message': 'Correo bancario encontrado pero no coincide del todo.',
            'checked': True,
            'amount_match': amount_match,
            'receipt_match': receipt_match,
            'date_match': date_match,
            'time_match': time_match,
            'account_match': account_match,
            'email': email_summary,
        }
        score = sum([amount_match, receipt_match, date_match, time_match, account_match])
        best_score = 0
        if best_partial:
            best_score = sum([
                bool(best_partial.get('amount_match')),
                bool(best_partial.get('receipt_match')),
                bool(best_partial.get('date_match')),
                bool(best_partial.get('time_match')),
                bool(best_partial.get('account_match')),
            ])
        if score > best_score:
            best_partial = partial
        elif best_partial is None:
            best_partial = partial

    if best_partial:
        if not best_partial.get('amount_match'):
            ocr_amount_ok = _receipt_amount_ok_from_analyzer(recharge_row)
            if ocr_amount_ok is False:
                best_partial['message'] = (
                    'El monto de la foto del comprobante no coincide con lo declarado; '
                    'queda aprobación manual.'
                )
            elif ocr_amount_ok is None:
                best_partial['message'] = (
                    'No se confirmó el monto en la foto del comprobante; '
                    'queda aprobación manual.'
                )
            else:
                best_partial['message'] = 'Hay correo del banco pero el monto no coincide.'
        elif receipt_expected and not best_partial.get('receipt_match'):
            if not _email_skips_receipt_crosscheck(recharge_row, pm_id):
                best_partial['message'] = 'Hay correo del banco pero el comprobante no coincide.'
        elif receipt_date_expected and not best_partial.get('date_match'):
            best_partial['message'] = (
                'Hay correo del banco pero la fecha no coincide con el comprobante.'
            )
        elif receipt_time_expected and not best_partial.get('time_match'):
            best_partial['message'] = (
                'Hay correo del banco pero la hora no coincide con el comprobante.'
            )
        elif not best_partial.get('account_match'):
            analyzer = _analyzer_payload(recharge_row) or {}
            if analyzer.get('bre_b_llave_matches_configured') is False:
                from app.store.balance_recharge_analyzer import (
                    _breb_llave_expected_display_from_analysis,
                    _breb_llaves_detected_labels,
                )

                expected = _breb_llave_expected_display_from_analysis(analyzer)
                detected = _breb_llaves_detected_labels(
                    analyzer.get('bre_b_llaves_detected')
                )
                det_label = ', '.join(detected) if detected else 'no detectada en la foto'
                best_partial['message'] = (
                    'La llave Bre-B del comprobante no coincide con el medio elegido '
                    f'(en foto: {det_label}; medio: {expected}); aprobación manual.'
                )
            else:
                ocr_ok = _receipt_account_ok_from_analyzer(recharge_row)
                if ocr_ok is False:
                    best_partial['message'] = (
                        'La cuenta del comprobante no coincide con el medio de pago; '
                        'queda aprobación manual.'
                    )
                else:
                    best_partial['message'] = (
                        'Hay correo del banco pero la cuenta no coincide con la configurada; '
                        'queda aprobación manual.'
                    )
        best_partial['scan_plan'] = scan_plan
        return best_partial

    not_found_msg = 'No se encontró correo del banco en el buzón/IMAP configurado.'
    if scan_plan.get('email_window_mode'):
        days = int(scan_plan.get('limit_days') or _EMAIL_SCAN_DAYS)
        not_found_msg = (
            f'No se encontró aviso en los últimos {days} días del buzón/IMAP configurado. '
            'Queda revisión manual.'
        )
    elif scan_plan.get('single_check_only') and receipt_date:
        not_found_msg = (
            f'No se encontró aviso bancario desde el {receipt_date.strftime("%d/%m/%Y")}. '
            'Se hizo una sola consulta automática; queda revisión manual.'
        )

    return {
        'status': 'not_found',
        'message': not_found_msg,
        'checked': True,
        'emails_scanned': len(emails),
        'scan_plan': scan_plan,
    }
