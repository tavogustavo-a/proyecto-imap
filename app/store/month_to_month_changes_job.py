# -*- coding: utf-8 -*-
"""
Cada medianoche (America/Bogota): añade al bloc «Cambios» (changes_notes) las cuentas
vendidas/asignadas con expires_at vencido, solo para licencias con month_to_month=True.

Formato de línea: igual que license_notes (campos separados por \\x1f).
"""
from __future__ import annotations

import json as _json
import logging
import re
from datetime import datetime

from app.extensions import db

logger = logging.getLogger(__name__)

LICENSE_LINE_SEP = '\x1f'
_CRED_EMAIL_RE = re.compile(r'\S+@\S+\.\S+')


def _split_admin_line_cred_client_rest(line: str) -> tuple[str, str, str]:
    t = (line or '').strip()
    if not t:
        return '', '', ''
    if LICENSE_LINE_SEP in t:
        parts = t.split(LICENSE_LINE_SEP)
        cred = (parts[0] or '').strip()
        client = (parts[1] or '').strip() if len(parts) > 1 else ''
        rest = LICENSE_LINE_SEP.join(parts[2:]).strip() if len(parts) > 2 else ''
        return cred, client, rest
    return t, '', ''


def _build_storage_line(
    cred: str,
    user: str = 'anonimo',
    status_good: str = '',
    status_bad: str = '',
    extra: str = '',
) -> str:
    c = (cred or '').strip()
    u = (user or '').strip() or 'anonimo'
    sg = (status_good or '').strip()
    sb = (status_bad or '').strip()
    e = (extra or '').strip()
    if not c and not sg and not sb and not e and (not u or u.lower() == 'anonimo'):
        return ''
    return LICENSE_LINE_SEP.join([c, u, sg, sb, e])


def _email_key_from_cred(cred: str) -> str:
    m = _CRED_EMAIL_RE.search((cred or '').strip())
    return m.group(0).strip().lower() if m else ''


def _emails_already_in_changes(changes_notes: str) -> set[str]:
    seen: set[str] = set()
    for line in str(changes_notes or '').replace('\r\n', '\n').split('\n'):
        line = line.strip()
        if not line:
            continue
        cred, _, _ = _split_admin_line_cred_client_rest(line)
        k = _email_key_from_cred(cred)
        if k:
            seen.add(k)
    return seen


def sync_month_to_month_expired_accounts_to_changes() -> dict:
    """
    Para cada License con month_to_month y enabled, agrega a changes_notes
    las LicenseAccount en estado assigned/sold con expires_at <= ahora (UTC naive).
    No duplica por correo (clave = primer email de la credencial).
    """
    from app.store.models import License, LicenseAccount
    from app.models.user import User

    _ensure_columns()

    now = datetime.utcnow()
    licenses = License.query.filter(
        License.month_to_month.is_(True),
        License.enabled.is_(True),
    ).all()

    total_added = 0
    touched = 0
    updated_ids: list[int] = []

    for lic in licenses:
        accounts = (
            LicenseAccount.query.filter(
                LicenseAccount.license_id == lic.id,
                LicenseAccount.status.in_(('assigned', 'sold')),
                LicenseAccount.expires_at.isnot(None),
                LicenseAccount.expires_at <= now,
            )
            .all()
        )

        cur = (getattr(lic, 'changes_notes', None) or '').replace('\r\n', '\n')
        seen_emails = _emails_already_in_changes(cur)
        from_expired: list[str] = []
        exp_raw = (getattr(lic, 'expired_notes', None) or '').replace('\r\n', '\n')
        for line in exp_raw.split('\n'):
            line = line.strip()
            if not line:
                continue
            cred_ex, _, _ = _split_admin_line_cred_client_rest(line)
            kex = _email_key_from_cred(cred_ex)
            if not kex or kex in seen_emails:
                continue
            from_expired.append(line)
            seen_emails.add(kex)

        new_lines: list[str] = []

        for acc in accounts:
            cred = f'{acc.email} {acc.password}'.strip()
            k = _email_key_from_cred(cred)
            if not k or k in seen_emails:
                continue
            uname = 'anonimo'
            if acc.assigned_to_user_id:
                u = db.session.get(User, acc.assigned_to_user_id)
                if u and (u.username or '').strip():
                    uname = u.username.strip()
            ln = _build_storage_line(cred, uname, '', '', '')
            if not ln:
                continue
            new_lines.append(ln)
            seen_emails.add(k)

        all_new = from_expired + new_lines
        if not all_new:
            continue

        cur_stripped = cur.strip()
        block = (cur_stripped + '\n' if cur_stripped else '') + '\n'.join(all_new)
        lic.changes_notes = block.strip()
        total_added += len(all_new)
        touched += 1
        updated_ids.append(lic.id)

    if total_added:
        db.session.commit()
        try:
            from app.store.routes import _sync_allowed_emails_from_license_admin_texts

            for lid in updated_ids:
                lic2 = db.session.get(License, lid)
                if not lic2:
                    continue
                texts = [
                    lic2.license_notes or '',
                    lic2.suspended_notes or '',
                    getattr(lic2, 'expired_notes', None) or '',
                    getattr(lic2, 'changes_notes', None) or '',
                ]
                raw_day = getattr(lic2, 'day_notepads_json', None)
                if raw_day and str(raw_day).strip():
                    try:
                        dm = _json.loads(raw_day)
                        if isinstance(dm, dict):
                            for v in dm.values():
                                if v:
                                    texts.append(str(v))
                    except Exception:
                        pass
                _sync_allowed_emails_from_license_admin_texts(texts)
            db.session.commit()
        except Exception as ex:
            db.session.rollback()
            logger.warning('Cambios mes a mes: sync allowed emails: %s', ex)

    return {'licenses_touched': touched, 'lines_added': total_added}


def _ensure_columns() -> None:
    try:
        from app.store.routes import (
            _ensure_license_changes_notes_column,
            _ensure_license_expired_notes_and_month_columns,
        )

        _ensure_license_expired_notes_and_month_columns()
        _ensure_license_changes_notes_column()
    except Exception:
        pass

