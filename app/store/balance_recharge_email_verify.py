# Verificación de recargas contra correos bancarios (buzón BD + IMAP configurado).

from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import or_

from app.models import ReceivedEmail
from app.models.imap import IMAPServer
from app.store.balance_recharge_analyzer import (
    _amounts_equivalent,
    _extract_fields_from_patterns,
    _find_amounts_in_text,
    digits_only,
    get_analyzer_patterns,
)
from app.store.balance_recharge_email_review import (
    get_email_review_settings,
    list_email_regex_entries,
)

_EMAIL_SCAN_DAYS = 7
_MAX_BUZON_ROWS = 300


def _mail_body_text(mail: dict[str, Any]) -> str:
    text = str(mail.get('text') or '').strip()
    if text:
        return text
    raw = str(mail.get('html') or mail.get('body_raw') or '')
    if not raw:
        return ''
    cleaned = re.sub(r'<[^>]+>', ' ', raw)
    return html.unescape(re.sub(r'\s+', ' ', cleaned)).strip()


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


def _fetch_buzon_emails(limit_days: int, sender_filters: set[str]) -> list[dict[str, Any]]:
    q = ReceivedEmail.query.filter(ReceivedEmail.deleted.is_(False))
    if limit_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=int(limit_days))
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
            }
        )
    return out


def _fetch_imap_emails(
    server_ids: list[int],
    limit_days: int,
    sender_filters: set[str],
) -> list[dict[str, Any]]:
    if not server_ids:
        return []
    servers = (
        IMAPServer.query.filter(
            IMAPServer.id.in_(server_ids),
            IMAPServer.enabled.is_(True),
        ).all()
    )
    if not servers:
        return []

    since_date = datetime.now(timezone.utc) - timedelta(days=max(1, int(limit_days)))
    from app.imap.advanced_imap import search_emails_for_observer

    found: list[dict[str, Any]] = []
    sender_list = sorted(sender_filters) if sender_filters else [None]
    for sender in sender_list:
        imap_sender = sender if sender and '@' in sender else None
        try:
            batch = search_emails_for_observer(servers, since_date, optional_sender_from_rule=imap_sender)
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
                }
            )
    return found


def collect_review_emails(
    *,
    use_buzon: bool,
    imap_server_ids: list[int],
    regex_entries: list[dict[str, Any]],
    limit_days: int = _EMAIL_SCAN_DAYS,
) -> list[dict[str, Any]]:
    sender_filters = _collect_sender_filters(regex_entries)
    emails: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add(mail: dict[str, Any]) -> None:
        key = (mail.get('message_id') or '') + '|' + (mail.get('from') or '') + '|' + (mail.get('subject') or '')
        if key in seen:
            return
        seen.add(key)
        emails.append(mail)

    if use_buzon:
        for mail in _fetch_buzon_emails(limit_days, sender_filters):
            _add(mail)

    for mail in _fetch_imap_emails(imap_server_ids, limit_days, sender_filters):
        _add(mail)

    return emails


def _regex_entries_for_payment_method(payment_method_id: str) -> list[dict[str, Any]]:
    pm = (payment_method_id or '').strip().lower()
    entries = [
        e for e in list_email_regex_entries()
        if e.get('enabled', True)
    ]
    if not pm:
        return entries
    applicable: list[dict[str, Any]] = []
    for entry in entries:
        pm_ids = entry.get('payment_method_ids') or []
        if not pm_ids or pm in [str(x).lower() for x in pm_ids]:
            applicable.append(entry)
    return applicable


def _extract_payment_fields(body_text: str, payment_method_id: str) -> dict[str, Any]:
    patterns = get_analyzer_patterns()
    pm = (payment_method_id or '').strip().lower()
    applicable = [
        p for p in patterns
        if pm in [str(x).lower() for x in (p.get('payment_method_ids') or [])]
    ]
    if not applicable and pm == 'bancolombia':
        applicable = [p for p in patterns if 'bancolombia' in str(p.get('id') or '').lower()]

    extracted = _extract_fields_from_patterns(body_text, applicable)
    amounts: list[float] = []
    for pat in applicable:
        for amt in _find_amounts_in_text(body_text, pat.get('amount_regexes') or []):
            fv = float(amt)
            if fv not in amounts:
                amounts.append(fv)

    return {
        'amounts': amounts,
        'receipt_numbers': extracted.get('receipt_numbers') or [],
        'account_numbers': extracted.get('account_numbers') or [],
    }


def _entry_matches_mail(entry: dict[str, Any], mail: dict[str, Any], body_text: str) -> bool:
    sender = str(entry.get('sender') or '').strip().lower()
    if sender and sender not in (mail.get('from') or '').lower():
        return False
    pattern = str(entry.get('pattern') or '').strip()
    if not pattern:
        return True
    try:
        return bool(re.search(pattern, body_text, re.IGNORECASE | re.DOTALL))
    except re.error:
        return False


def verify_recharge_by_email(recharge_row) -> dict[str, Any]:
    """Busca correo bancario que respalde una recarga auto-acreditada."""
    settings = get_email_review_settings()
    pm_id = str(getattr(recharge_row, 'payment_method_id', '') or '').strip().lower()
    regex_entries = _regex_entries_for_payment_method(pm_id)

    if not regex_entries:
        return {
            'status': 'no_regex',
            'message': 'No hay regex configurados para este medio de pago.',
            'checked': False,
        }

    use_buzon = bool(settings.get('buzon_enabled'))
    imap_ids = list(settings.get('imap_server_ids') or [])
    if not use_buzon and not imap_ids:
        return {
            'status': 'no_source',
            'message': 'Activa Buzón o selecciona servidores IMAP para consultar correos.',
            'checked': False,
        }

    emails = collect_review_emails(
        use_buzon=use_buzon,
        imap_server_ids=imap_ids,
        regex_entries=regex_entries,
    )

    currency = (recharge_row.currency or 'COP').strip().upper()
    claimed = recharge_row.amount_credited
    if claimed is None:
        claimed = recharge_row.amount_claimed
    claimed_f = float(claimed) if claimed is not None else 0.0
    receipt_expected = digits_only(getattr(recharge_row, 'receipt_number', None) or '')

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

        extracted = _extract_payment_fields(body_text, pm_id)
        amount_match = any(
            _amounts_equivalent(claimed_f, Decimal(str(a)), currency)
            for a in extracted['amounts']
        )

        receipt_match = True
        receipt_found = ''
        if receipt_expected:
            receipt_digits = [digits_only(r) for r in extracted['receipt_numbers']]
            receipt_match = receipt_expected in receipt_digits
            if receipt_digits:
                receipt_found = receipt_digits[0]

        email_summary = {
            'source': mail.get('source'),
            'from': mail.get('from') or '',
            'subject': mail.get('subject') or '',
            'date': mail.get('date') or '',
            'amounts_detected': extracted['amounts'],
            'receipt_numbers': extracted['receipt_numbers'],
            'account_numbers': extracted['account_numbers'],
            'regex_matched': [e.get('description') for e in matched_entries],
        }

        if amount_match and receipt_match:
            return {
                'status': 'matched',
                'message': 'Correo bancario encontrado y coincide con la recarga.',
                'checked': True,
                'amount_match': True,
                'receipt_match': receipt_match,
                'email': email_summary,
            }

        partial = {
            'status': 'partial',
            'message': 'Correo bancario encontrado pero no coincide del todo.',
            'checked': True,
            'amount_match': amount_match,
            'receipt_match': receipt_match,
            'email': email_summary,
        }
        if amount_match and (best_partial is None or not best_partial.get('amount_match')):
            best_partial = partial
        elif best_partial is None:
            best_partial = partial

    if best_partial:
        if not best_partial.get('amount_match'):
            best_partial['message'] = 'Hay correo del banco pero el monto no coincide.'
        elif receipt_expected and not best_partial.get('receipt_match'):
            best_partial['message'] = 'Hay correo del banco pero el comprobante no coincide.'
        return best_partial

    return {
        'status': 'not_found',
        'message': 'No se encontró correo del banco en el buzón/IMAP configurado.',
        'checked': True,
        'emails_scanned': len(emails),
    }
