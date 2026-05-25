# -*- coding: utf-8 -*-
"""
Renovación automática por día de calendario (Colombia) y enrutado al vencer.

- «renovar 1 mes mas»: cobra 1 mes (User.saldo), extiende expires_at 30 días, limpia estado verde (—).
- «dejar mes a mes»: cobra cada mes el día vinculado; mantiene el modo hasta cambio manual.
- «no renovar» o verde vacío (—): al cerrar el día N → Cambios si month_to_month; si no → Vencidas.
  Las cobradas como «renovar 1 mes más» quedan en — pero siguen en el día N.
- «renovar» / «mes a mes» sin saldo o superando límite de deuda → Cambios (mes a mes) o Vencidas.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func as sa_func

from app.extensions import db
from app.utils.timezone import get_colombia_datetime, utc_to_colombia

logger = logging.getLogger(__name__)

LICENSE_LINE_SEP = '\x1f'
_CRED_EMAIL_RE = re.compile(r'\S+@\S+\.\S+')
_AUTO_MES_RE = re.compile(r'_auto_mes:(\d{4}-\d{2})')
RENEWAL_DAYS = 30

GREEN_RENOVAR = 'renovar 1 mes mas'
GREEN_MES_A_MES = 'dejar mes a mes'
GREEN_NO_RENOVAR = 'no renovar'

CHARGE_FAIL_ROUTE_TO_BLOC_REASONS = frozenset({
    'saldo_insuficiente',
    'supera_limite_deuda',
})


def _green_nk(green: Any) -> str:
    from app.store.user_license_line_parse import normalize_status_key

    return normalize_status_key(str(green or '').strip())


def _green_stays_in_day_bloc(nk: str) -> bool:
    """Solo «renovar» y «mes a mes» permanecen en el día N."""
    return nk in (
        _green_nk(GREEN_RENOVAR),
        _green_nk(GREEN_MES_A_MES),
    )


def _green_exits_day_bloc_on_renewal_close(green: Any) -> bool:
    """
    «—» (vacío) y «no renovar» se comportan igual: salen del día N hacia Cambios o Vencidas.
    Cualquier otro estado que no sea renovar/mes a mes también sale al cerrar el día.
    """
    return not _green_stays_in_day_bloc(_green_nk(green))


def _charge_fail_should_route_to_bloc(reason: str) -> bool:
    """True si el cobro falló por saldo prepago o límite de deuda."""
    return str(reason or '').strip() in CHARGE_FAIL_ROUTE_TO_BLOC_REASONS


def _route_dual_line_to_changes_or_expired(
    lic,
    dual: Dict[str, Any],
    changes_cur: str,
    expired_cur: str,
    seen_changes: set,
    seen_expired: set,
) -> Tuple[str, str, bool]:
    """Quita la fila del día y la añade a Cambios (mes a mes) o Vencidas."""
    m2m = bool(getattr(lic, 'month_to_month', False))
    cred = str(dual.get('cred') or '').strip()
    cred_k = _line_cred_key(cred)
    if not cred_k:
        return changes_cur, expired_cur, False
    uname = str(dual.get('user') or '').strip() or 'anonimo'
    ln = _build_storage_line(cred, uname, '', '', '')
    if not ln:
        return changes_cur, expired_cur, False
    if m2m:
        if cred_k not in seen_changes:
            changes_cur = _append_bloc_line(changes_cur, ln)
            seen_changes.add(cred_k)
    else:
        if cred_k not in seen_expired:
            expired_cur = _append_bloc_line(expired_cur, ln)
            seen_expired.add(cred_k)
    return changes_cur, expired_cur, True


def run_license_day_renewal_pipeline() -> Dict[str, Any]:
    """Ejecutar renovaciones del día y luego enrutar vencidas (medianoche Colombia)."""
    _ensure_schema_columns()
    co_now = get_colombia_datetime()
    calendar_day = int(co_now.day)
    if calendar_day < 1 or calendar_day > 31:
        calendar_day = 1
    renew_stats = process_day_renewals_for_calendar_day(calendar_day, co_now)
    charged_keys = renew_stats.get('charged_keys') or set()
    route_stats = route_unrenewed_day_lines_on_renewal_day(calendar_day, charged_keys)
    expired_stats = sync_expired_accounts_by_renewal_policy()
    touched_license_ids = (
        renew_stats.get('license_ids', [])
        + route_stats.get('license_ids', [])
        + expired_stats.get('license_ids', [])
    )
    if (
        renew_stats.get('charged')
        or renew_stats.get('routed_charge_failed')
        or route_stats.get('lines_moved')
        or expired_stats.get('lines_moved')
        or renew_stats.get('license_ids')
        or route_stats.get('license_ids')
        or expired_stats.get('license_ids')
    ):
        try:
            db.session.commit()
        except Exception as ex:
            db.session.rollback()
            logger.exception('license_day_renewal_pipeline commit: %s', ex)
            raise
        _sync_allowed_emails_for_touched_licenses(touched_license_ids)
    return {
        'calendar_day': calendar_day,
        'renewals': renew_stats,
        'routed_day_lines': route_stats,
        'expired': expired_stats,
    }


def process_day_renewals_for_calendar_day(calendar_day: int, co_now: datetime) -> Dict[str, Any]:
    from sqlalchemy.orm import joinedload

    from app.store.models import License, LicenseAccount
    from app.store.user_license_line_parse import (
        dual_to_storage_line,
        normalize_status_key,
        parse_admin_license_line_to_split_parts,
    )

    day_key = str(int(calendar_day))
    ym_tag = co_now.strftime('%Y-%m')
    now_utc = datetime.utcnow()
    charged = 0
    skipped = 0
    errors = 0
    routed_charge_failed = 0
    any_changed = False
    license_ids: List[int] = []
    charged_keys: set = set()

    licenses = (
        License.query.options(joinedload(License.product))
        .filter(License.enabled.is_(True))
        .all()
    )
    for lic in licenses:
        day_map = _load_day_map(lic)
        raw_day = day_map.get(day_key)
        if not raw_day or not str(raw_day).strip():
            continue
        lines = [ln for ln in str(raw_day).replace('\r\n', '\n').split('\n') if str(ln).strip()]
        if not lines:
            continue
        lic_changed = False
        new_lines: List[str] = []
        changes_cur = (getattr(lic, 'changes_notes', None) or '').replace('\r\n', '\n')
        expired_cur = (getattr(lic, 'expired_notes', None) or '').replace('\r\n', '\n')
        seen_changes = _cred_keys_in_bloc(changes_cur)
        seen_expired = _cred_keys_in_bloc(expired_cur)

        for line in lines:
            dual = parse_admin_license_line_to_split_parts(line)
            green = _effective_green_for_automation(dual, line)
            nk = _green_nk(green)

            if nk == _green_nk(GREEN_RENOVAR):
                ok, msg = _try_renew_line(lic, dual, line, now_utc, co_now, ym_tag, renew_once=True)
                if ok:
                    dual_out = _dual_after_renovar_once_charged(dual)
                    new_lines.append(dual_to_storage_line(dual_out))
                    charged += 1
                    lic_changed = True
                    ck = _line_cred_key(str(dual.get('cred') or ''))
                    if ck:
                        charged_keys.add((int(lic.id), ck))
                elif _charge_fail_should_route_to_bloc(msg):
                    changes_cur, expired_cur, moved = _route_dual_line_to_changes_or_expired(
                        lic, dual, changes_cur, expired_cur, seen_changes, seen_expired
                    )
                    if moved:
                        routed_charge_failed += 1
                        lic_changed = True
                    else:
                        new_lines.append(line)
                    errors += 1
                    logger.info(
                        'Renovación día %s lic %s sin saldo → Cambios/Vencidas: %s',
                        day_key,
                        lic.id,
                        msg,
                    )
                else:
                    new_lines.append(line)
                    if msg:
                        errors += 1
                        logger.info(
                            'Renovación día %s lic %s no cobrada: %s',
                            day_key,
                            lic.id,
                            msg,
                        )
                continue

            if nk == _green_nk(GREEN_MES_A_MES):
                extra_s = str(dual.get('extra') or '')
                if _auto_mes_already(extra_s, ym_tag):
                    new_lines.append(line)
                    skipped += 1
                    continue
                ok, msg = _try_renew_line(lic, dual, line, now_utc, co_now, ym_tag, renew_once=False)
                if ok:
                    dual_out = dict(dual)
                    dual_out['statusGood'] = GREEN_MES_A_MES
                    from app.store.user_license_line_parse import user_visible_notes_from_extra

                    notes_only = user_visible_notes_from_extra(extra_s)
                    dual_out['extra'] = _append_auto_mes_tag(notes_only, ym_tag)
                    new_lines.append(dual_to_storage_line(dual_out))
                    charged += 1
                    lic_changed = True
                    ck = _line_cred_key(str(dual.get('cred') or ''))
                    if ck:
                        charged_keys.add((int(lic.id), ck))
                elif _charge_fail_should_route_to_bloc(msg):
                    changes_cur, expired_cur, moved = _route_dual_line_to_changes_or_expired(
                        lic, dual, changes_cur, expired_cur, seen_changes, seen_expired
                    )
                    if moved:
                        routed_charge_failed += 1
                        lic_changed = True
                    else:
                        new_lines.append(line)
                    errors += 1
                    logger.info(
                        'Mes a mes día %s lic %s sin saldo → Cambios/Vencidas: %s',
                        day_key,
                        lic.id,
                        msg,
                    )
                else:
                    new_lines.append(line)
                    if msg:
                        errors += 1
                continue

            new_lines.append(line)

        if lic_changed:
            if new_lines:
                day_map[day_key] = '\n'.join(new_lines).strip()
            else:
                day_map.pop(day_key, None)
            m2m = bool(getattr(lic, 'month_to_month', False))
            if m2m:
                lic.changes_notes = changes_cur.strip()
            else:
                lic.expired_notes = expired_cur.strip()
            lic.day_notepads_json = json.dumps(day_map, ensure_ascii=False) if day_map else None
            lic.updated_at = now_utc
            license_ids.append(int(lic.id))
            any_changed = True

    if charged or any_changed:
        try:
            db.session.flush()
        except Exception:
            pass

    return {
        'charged': charged,
        'skipped_mes_a_mes_idempotent': skipped,
        'errors': errors,
        'routed_charge_failed': routed_charge_failed,
        'license_ids': list(set(license_ids)),
        'charged_keys': [list(k) for k in charged_keys],
    }


def route_unrenewed_day_lines_on_renewal_day(
    calendar_day: int, charged_keys: set
) -> Dict[str, Any]:
    """
    Tras cobrar renovar/mes a mes el día N, las filas que siguen en el bloc del día N
    con verde «—», «no renovar» u otro (no renovar/mes a mes) pasan a Cambios o Vencidas.
    Las filas cobradas como «renovar 1 mes más» quedan en «—» pero no se mueven.
    """
    from app.store.models import License
    from app.store.user_license_line_parse import parse_admin_license_line_to_split_parts

    day_key = str(int(calendar_day))
    now_utc = datetime.utcnow()
    lines_moved = 0
    license_ids: List[int] = []

    licenses = License.query.filter(License.enabled.is_(True)).all()
    for lic in licenses:
        day_map = _load_day_map(lic)
        raw_day = day_map.get(day_key)
        if not raw_day or not str(raw_day).strip():
            continue

        lines = [ln for ln in str(raw_day).replace('\r\n', '\n').split('\n') if str(ln).strip()]
        if not lines:
            continue

        m2m = bool(getattr(lic, 'month_to_month', False))
        changes_cur = (getattr(lic, 'changes_notes', None) or '').replace('\r\n', '\n')
        expired_cur = (getattr(lic, 'expired_notes', None) or '').replace('\r\n', '\n')
        seen_changes = _cred_keys_in_bloc(changes_cur)
        seen_expired = _cred_keys_in_bloc(expired_cur)
        new_day_lines: List[str] = []
        lic_changed = False

        for line in lines:
            dual = parse_admin_license_line_to_split_parts(line)
            green = _effective_green_for_automation(dual, line)

            if not _green_exits_day_bloc_on_renewal_close(green):
                new_day_lines.append(line)
                continue

            cred = str(dual.get('cred') or '').strip()
            cred_k = _line_cred_key(cred)
            if cred_k and (int(lic.id), cred_k) in charged_keys:
                new_day_lines.append(line)
                continue

            changes_cur, expired_cur, moved = _route_dual_line_to_changes_or_expired(
                lic, dual, changes_cur, expired_cur, seen_changes, seen_expired
            )
            if not moved:
                new_day_lines.append(line)
                continue

            lines_moved += 1
            lic_changed = True

        if lic_changed:
            if new_day_lines:
                day_map[day_key] = '\n'.join(new_day_lines).strip()
            else:
                day_map.pop(day_key, None)
            if m2m:
                lic.changes_notes = changes_cur.strip()
            else:
                lic.expired_notes = expired_cur.strip()
            lic.day_notepads_json = json.dumps(day_map, ensure_ascii=False) if day_map else None
            lic.updated_at = now_utc
            license_ids.append(int(lic.id))

    return {'lines_moved': lines_moved, 'license_ids': list(set(license_ids))}


def sync_expired_accounts_by_renewal_policy() -> Dict[str, Any]:
    """
    Cuentas assigned/sold con expires_at vencido:
    - verde renovar / dejar mes a mes → no mover (deben renovarse el día del bloc).
    - vacío o no renovar → Cambios (month_to_month) o Vencidas.
    """
    from app.store.models import License, LicenseAccount

    now_utc = datetime.utcnow()
    lines_moved = 0
    license_ids: List[int] = []

    licenses = License.query.filter(License.enabled.is_(True)).all()
    for lic in licenses:
        accounts = (
            LicenseAccount.query.filter(
                LicenseAccount.license_id == lic.id,
                LicenseAccount.status.in_(('assigned', 'sold')),
                LicenseAccount.expires_at.isnot(None),
                LicenseAccount.expires_at <= now_utc,
            )
            .all()
        )
        if not accounts:
            continue

        m2m = bool(getattr(lic, 'month_to_month', False))
        changes_cur = (getattr(lic, 'changes_notes', None) or '').replace('\r\n', '\n')
        expired_cur = (getattr(lic, 'expired_notes', None) or '').replace('\r\n', '\n')
        seen_changes = _cred_keys_in_bloc(changes_cur)
        seen_expired = _cred_keys_in_bloc(expired_cur)
        day_map = _load_day_map(lic)
        lic_touched = False

        if m2m:
            from_expired: List[str] = []
            for line in expired_cur.split('\n'):
                line = line.strip()
                if not line:
                    continue
                cred_part = line.split(LICENSE_LINE_SEP)[0] if LICENSE_LINE_SEP in line else line
                kex = _line_cred_key(cred_part)
                if not kex or kex in seen_changes:
                    continue
                from_expired.append(line)
                seen_changes.add(kex)
            if from_expired:
                for fl in from_expired:
                    changes_cur = _append_bloc_line(changes_cur, fl)
                lic_touched = True

        for acc in accounts:
            cred = f'{acc.email} {acc.password}'.strip()
            if not cred:
                ident = str(getattr(acc, 'account_identifier', '') or '').strip()
                pwd = str(getattr(acc, 'password', '') or '').strip()
                cred = f'{ident} {pwd}'.strip() if ident else pwd
            cred_k = _line_cred_key(cred)
            if not cred_k:
                continue

            green, day_key_hit, _line_hit, _dual_hit = _find_green_for_account(lic, acc, day_map)
            if not _green_exits_day_bloc_on_renewal_close(green):
                continue

            uname = _username_for_account(acc)
            ln = _build_storage_line(cred, uname, '', '', '')
            if not ln:
                continue

            if m2m:
                if cred_k in seen_changes:
                    continue
                changes_cur = _append_bloc_line(changes_cur, ln)
                seen_changes.add(cred_k)
            else:
                if cred_k in seen_expired:
                    continue
                expired_cur = _append_bloc_line(expired_cur, ln)
                seen_expired.add(cred_k)

            if day_key_hit and _remove_line_from_day_map(day_map, cred_k, day_key_hit):
                lic_touched = True
            lines_moved += 1
            lic_touched = True

        if lic_touched:
            if m2m:
                lic.changes_notes = changes_cur.strip()
            else:
                lic.expired_notes = expired_cur.strip()
            lic.day_notepads_json = json.dumps(day_map, ensure_ascii=False) if day_map else None
            lic.updated_at = now_utc
            license_ids.append(int(lic.id))

    return {'lines_moved': lines_moved, 'license_ids': list(set(license_ids))}


# --- Cobro y extensión ---


def _dual_after_renovar_once_charged(dual: Dict[str, Any]) -> Dict[str, Any]:
    """Tras cobrar «renovar 1 mes más», dejar el verde en — (vacío) en admin y portal."""
    from app.store.user_license_line_parse import user_visible_notes_from_extra

    dual_out = dict(dual)
    dual_out['statusGood'] = ''
    dual_out['prevGoodRestore'] = ''
    dual_out['extra'] = user_visible_notes_from_extra(str(dual_out.get('extra') or ''))
    return dual_out


def _find_license_account_for_renewal(lic, cred: str, dual: Dict[str, Any]):
    """Localiza la cuenta asignada/vendida para cobrar la renovación del día."""
    from app.store.models import LicenseAccount
    from app.store.user_license_line_parse import credential_matches_account

    cred_clean = str(cred or '').strip()
    if not cred_clean:
        return None

    email_k = _email_key_from_cred(cred_clean)
    if email_k:
        acc = (
            LicenseAccount.query.filter(
                LicenseAccount.license_id == lic.id,
                LicenseAccount.status.in_(('assigned', 'sold')),
                sa_func.lower(LicenseAccount.email) == email_k,
            )
            .order_by(LicenseAccount.expires_at.desc())
            .first()
        )
        if acc:
            return acc

    candidates = (
        LicenseAccount.query.filter(
            LicenseAccount.license_id == lic.id,
            LicenseAccount.status.in_(('assigned', 'sold')),
        )
        .order_by(LicenseAccount.expires_at.desc())
        .all()
    )
    for acc in candidates:
        ident = str(getattr(acc, 'account_identifier', '') or '').strip()
        em = str(getattr(acc, 'email', '') or '').strip()
        pwd = str(getattr(acc, 'password', '') or '').strip()
        full_cred = f'{em} {pwd}'.strip() if em else pwd
        if cred_clean == ident or (full_cred and cred_clean == full_cred):
            return acc
        if credential_matches_account(cred_clean, em, ident):
            return acc

    uname = str(dual.get('user') or '').strip()
    if uname and uname.lower() != 'anonimo':
        by_user = [
            a
            for a in candidates
            if _username_for_account(a).lower() == uname.lower()
        ]
        if len(by_user) == 1:
            return by_user[0]
    return None


def _try_renew_line(
    lic,
    dual: Dict[str, Any],
    raw_line: str,
    now_utc: datetime,
    co_now: datetime,
    ym_tag: str,
    *,
    renew_once: bool,
) -> Tuple[bool, str]:
    cred = str(dual.get('cred') or '').strip()
    if not cred:
        return False, 'sin_credencial'

    acc = _find_license_account_for_renewal(lic, cred, dual)
    if not acc:
        return False, 'cuenta_no_encontrada'

    username = str(dual.get('user') or '').strip() or 'anonimo'
    charged, charge_msg = _charge_one_month_debt(lic, username, acc=acc)
    if not charged:
        return False, charge_msg or 'cobro_fallido'

    _extend_account_one_month(acc, now_utc)
    _log_auto_renewal_activity(acc, lic, dual)
    _ = (renew_once, ym_tag, co_now, raw_line)
    return True, ''


def _log_auto_renewal_activity(acc, lic, dual: Dict[str, Any]) -> None:
    """Historial portal: correo de la cuenta renovada automáticamente."""
    try:
        from app.models.user import User
        from app.store.user_license_activity import (
            _renewal_activity_summary,
            append_portal_license_activity_record,
        )
    except Exception:
        return

    viewer = None
    if getattr(acc, 'assigned_to_user_id', None):
        viewer = db.session.get(User, acc.assigned_to_user_id)
    if not viewer:
        un = str(dual.get('user') or '').strip()
        if un and un.lower() != 'anonimo':
            viewer = User.query.filter(
                sa_func.lower(User.username) == un.lower()
            ).first()
    if not viewer:
        return

    pname = getattr(getattr(lic, 'product', None), 'name', None) or 'Producto'
    cred = str(dual.get('cred') or '').strip()
    acc_email = (getattr(acc, 'email', None) or '').strip()
    append_portal_license_activity_record(
        viewer,
        'renovacion_estado',
        _renewal_activity_summary(pname, cred, acc_email),
        detail=None,
        extra={
            'license_id': int(getattr(lic, 'id', 0) or 0),
            'account_id': int(getattr(acc, 'id', 0) or 0),
            'cred_hint': cred[:140] if cred else (acc_email[:140] if acc_email else ''),
        },
    )


def _charge_one_month_debt(lic, username: str, acc=None) -> Tuple[bool, str]:
    try:
        from app.store.routes import (
            _apply_license_account_auto_renewal_charge,
            _billing_row_for_bulk_license_client,
            _record_portal_renewal_blocked_activity,
        )
    except Exception as ex:
        return False, f'import_cobro:{ex}'

    billing = _billing_row_for_bulk_license_client(username)
    if not billing:
        return False, 'usuario_facturacion_no_encontrado'

    ok, msg = _apply_license_account_auto_renewal_charge(billing, lic)
    if not ok:
        cred_hint = ''
        if acc is not None:
            cred_hint = f'{getattr(acc, "email", "") or ""}'.strip()
        cal_day = None
        if acc is not None and getattr(acc, 'assigned_at', None):
            try:
                cal_day = int(utc_to_colombia(acc.assigned_at).day)
            except Exception:
                cal_day = None
        _record_portal_renewal_blocked_activity(
            billing,
            license_id=getattr(lic, 'id', None),
            account_id=getattr(acc, 'id', None) if acc is not None else None,
            cred_hint=cred_hint,
            reason=msg or 'cobro_fallido',
            calendar_day=cal_day,
        )
        return False, msg or 'cobro_fallido'
    return True, ''


def _extend_account_one_month(acc, now_utc: datetime) -> None:
    base = acc.expires_at if acc.expires_at and acc.expires_at > now_utc else now_utc
    acc.expires_at = base + timedelta(days=RENEWAL_DAYS)
    acc.updated_at = now_utc


# --- Búsqueda línea / estado verde ---


def _effective_green_for_automation(dual: Dict[str, Any], raw_line: str) -> str:
    from app.store.user_license_line_parse import (
        normalize_status_key,
        resolve_portal_green_select_value,
    )

    sg = str(dual.get('statusGood') or '').strip()
    if normalize_status_key(sg) == 'ok':
        return resolve_portal_green_select_value(dual, raw_line) or ''
    if sg:
        return resolve_portal_green_select_value(dual, raw_line) or sg
    return resolve_portal_green_select_value(dual, raw_line) or ''


def _find_green_for_account(lic, acc, day_map: Dict[str, str]) -> Tuple[str, str, str, Dict[str, Any]]:
    from app.store.user_license_line_parse import parse_admin_license_line_to_split_parts

    email_k = _email_key_from_cred(f'{acc.email} {acc.password}')
    if not email_k:
        return '', '', '', {}

    linked_day = ''
    if acc.assigned_at:
        try:
            linked_day = str(int(utc_to_colombia(acc.assigned_at).day))
        except Exception:
            linked_day = ''

    search_keys: List[str] = []
    if linked_day and linked_day in day_map:
        search_keys.append(linked_day)
    for dk in sorted(day_map.keys(), key=lambda x: int(x) if str(x).isdigit() else 99):
        if dk not in search_keys:
            search_keys.append(dk)

    for dk in search_keys:
        raw = day_map.get(dk) or ''
        for line in str(raw).replace('\r\n', '\n').split('\n'):
            line = line.strip()
            if not line:
                continue
            cred_k = _email_key_from_cred(line.split(LICENSE_LINE_SEP)[0] if LICENSE_LINE_SEP in line else line)
            if cred_k != email_k:
                continue
            dual = parse_admin_license_line_to_split_parts(line)
            green = _effective_green_for_automation(dual, line)
            return green, dk, line, dual
    return '', '', '', {}


# --- Utilidades bloc / día ---


def _load_day_map(lic) -> Dict[str, str]:
    raw = getattr(lic, 'day_notepads_json', None) or ''
    if not raw or not str(raw).strip():
        return {}
    try:
        dm = json.loads(raw)
        return dm if isinstance(dm, dict) else {}
    except Exception:
        return {}


def _email_key_from_cred(cred: str) -> str:
    m = _CRED_EMAIL_RE.search((cred or '').strip())
    return m.group(0).strip().lower() if m else ''


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


def _line_cred_key(cred: str) -> str:
    """Clave estable para deduplicar líneas (email si hay; si no, credencial en bruto)."""
    email_k = _email_key_from_cred(cred)
    if email_k:
        return email_k
    c = str(cred or '').strip().lower()
    return c


def _cred_keys_in_bloc(text: str) -> set:
    seen: set = set()
    for line in str(text or '').replace('\r\n', '\n').split('\n'):
        line = line.strip()
        if not line:
            continue
        cred = line.split(LICENSE_LINE_SEP)[0] if LICENSE_LINE_SEP in line else line
        k = _line_cred_key(cred)
        if k:
            seen.add(k)
    return seen


def _emails_in_bloc(text: str) -> set:
    return _cred_keys_in_bloc(text)


def _append_bloc_line(cur: str, line: str) -> str:
    cur_s = (cur or '').strip()
    add = (line or '').strip()
    if not add:
        return cur_s
    return (cur_s + '\n' + add).strip() if cur_s else add


def _remove_line_from_day_map(day_map: Dict[str, str], cred_key: str, day_key: str) -> bool:
    raw = day_map.get(day_key) or ''
    lines = [ln for ln in str(raw).replace('\r\n', '\n').split('\n') if str(ln).strip()]
    if not lines:
        return False
    kept: List[str] = []
    removed = False
    for ln in lines:
        cred_part = ln.split(LICENSE_LINE_SEP)[0] if LICENSE_LINE_SEP in ln else ln
        if not removed and _line_cred_key(cred_part) == cred_key:
            removed = True
            continue
        kept.append(ln)
    if not removed:
        return False
    if kept:
        day_map[day_key] = '\n'.join(kept).strip()
    else:
        day_map.pop(day_key, None)
    return True


def _remove_email_from_day_map(day_map: Dict[str, str], email_k: str, day_key: str) -> bool:
    return _remove_line_from_day_map(day_map, email_k, day_key)


def _username_for_account(acc) -> str:
    from app.models.user import User

    if acc.assigned_to_user_id:
        u = db.session.get(User, acc.assigned_to_user_id)
        if u and (u.username or '').strip():
            return u.username.strip()
    return 'anonimo'


def _auto_mes_already(extra: str, ym_tag: str) -> bool:
    m = _AUTO_MES_RE.search(str(extra or ''))
    return bool(m and m.group(1) == ym_tag)


def _append_auto_mes_tag(extra: str, ym_tag: str) -> str:
    e = _strip_auto_mes_tag(extra)
    tag = f'_auto_mes:{ym_tag}'
    return (e + ' · ' + tag).strip() if e else tag


def _strip_auto_mes_tag(extra: str) -> str:
    return re.sub(r'(?:\s*·\s*)?_auto_mes:\d{4}-\d{2}', '', str(extra or '').strip()).strip()


def _ensure_schema_columns() -> None:
    try:
        from app.store.routes import (
            _ensure_license_changes_notes_column,
            _ensure_license_day_notepads_column,
            _ensure_license_expired_notes_and_month_columns,
        )

        _ensure_license_day_notepads_column()
        _ensure_license_expired_notes_and_month_columns()
        _ensure_license_changes_notes_column()
    except Exception:
        pass


def _sync_allowed_emails_for_touched_licenses(license_ids: List[int]) -> None:
    if not license_ids:
        return
    try:
        from app.store.models import License
        from app.store.routes import _sync_allowed_emails_from_license_admin_texts

        for lid in set(license_ids):
            lic = db.session.get(License, int(lid))
            if not lic:
                continue
            texts = [
                lic.license_notes or '',
                lic.suspended_notes or '',
                getattr(lic, 'expired_notes', None) or '',
                getattr(lic, 'changes_notes', None) or '',
            ]
            raw_day = getattr(lic, 'day_notepads_json', None)
            if raw_day and str(raw_day).strip():
                try:
                    dm = json.loads(raw_day)
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
        logger.warning('license_day_renewal sync emails: %s', ex)


# Compatibilidad: job anterior de medianoche sigue llamando esta envoltura.
def sync_month_to_month_expired_accounts_to_changes() -> dict:
    """Delegado: enrutado completo (Cambios / Vencidas) según política de renovación."""
    stats = sync_expired_accounts_by_renewal_policy()
    if stats.get('lines_moved'):
        try:
            db.session.commit()
        except Exception as ex:
            db.session.rollback()
            logger.exception('sync_month_to_month delegate commit: %s', ex)
        _sync_allowed_emails_for_touched_licenses(stats.get('license_ids', []))
    return {
        'licenses_touched': len(stats.get('license_ids', [])),
        'lines_added': stats.get('lines_moved', 0),
    }
