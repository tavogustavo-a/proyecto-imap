# -*- coding: utf-8 -*-
"""
Auto-entrega de garantía pendiente tras ingresar stock.

Si hay filas con ``__warranty_pending:`` y hay cuenta disponible en la reserva
``gar.`` con al menos WARRANTY_AUTO_DELIVER_DELAY_MINUTES de antigüedad, entrega
el repuesto: actualiza el día, mueve la mala a Caídas, historial y notificación.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

WARRANTY_AUTO_DELIVER_DELAY_MINUTES = 5
_BLOC_WS = ' \t\r\n'


def _safe_strip(s: Any) -> str:
    return str(s or '').strip(_BLOC_WS)


def _parse_day_map(raw: Any) -> Dict[str, str]:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return {str(k): str(v or '') for k, v in raw.items()}
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v or '') for k, v in data.items()}


def _dump_day_map(day_map: Dict[str, str]) -> str:
    clean = {str(k): str(v or '') for k, v in day_map.items() if str(v or '').strip(_BLOC_WS)}
    return json.dumps(clean, ensure_ascii=False)


def _account_age_ok(acc, now: datetime, delay: timedelta) -> bool:
    created = getattr(acc, 'created_at', None) or getattr(acc, 'updated_at', None)
    if created is None:
        return True
    try:
        return (now - created) >= delay
    except Exception:
        return True


def _append_suspended_line(license_obj, old_line: str) -> None:
    cur = _safe_strip(getattr(license_obj, 'suspended_notes', None) or '')
    lines = cur.split('\n') if cur else []
    while lines and lines[-1] == '':
        lines.pop()
    lines.append(_safe_strip(old_line))
    license_obj.suspended_notes = '\n'.join(lines)


def _deliver_one_pending_line(
    *,
    license_obj,
    day_key: str,
    line_idx: int,
    old_line: str,
    parts: Dict[str, Any],
    now: datetime,
    delay: timedelta,
) -> bool:
    """Entrega un repuesto para una línea pendiente. True si entregó."""
    from app.store.models import LicenseAccount, User, db
    from app.store.routes_licencias import (
        _claim_license_account_for_delivery,
        _find_sold_assigned_license_account_for_warranty,
        _license_account_term_timedelta,
        _pick_next_warranty_replacement_license_account,
        _warranty_remove_replacement_from_inventory_bloc,
    )
    from app.store.user_license_line_parse import (
        LICENSE_LINE_FIELD_SEP,
        normalize_status_key,
    )

    replacement, werr = _pick_next_warranty_replacement_license_account(license_obj)
    if replacement is None:
        logger.info(
            'auto warranty skip license=%s day=%s idx=%s: sin stock gar. (%s)',
            getattr(license_obj, 'id', None),
            day_key,
            line_idx,
            werr,
        )
        return False
    if not _account_age_ok(replacement, now, delay):
        logger.info(
            'auto warranty skip license=%s: stock gar. aún con < %s min',
            getattr(license_obj, 'id', None),
            int(delay.total_seconds() // 60) or WARRANTY_AUTO_DELIVER_DELAY_MINUTES,
        )
        return False

    cred = _safe_strip(parts.get('cred'))
    bad_acc, conflict = _find_sold_assigned_license_account_for_warranty(
        license_obj.id, cred_hint=cred, bad_account_id=None
    )
    if conflict is not None or bad_acc is None:
        logger.info(
            'auto warranty skip license=%s day=%s idx=%s: cuenta mala no enlazada (cred=%r)',
            getattr(license_obj, 'id', None),
            day_key,
            line_idx,
            cred[:80],
        )
        return False

    uid = bad_acc.assigned_to_user_id
    urow = User.query.get(uid) if uid is not None else None
    reporter = 'anonimo'
    if urow and urow.username:
        reporter = str(urow.username).strip() or 'anonimo'

    replacement_slot_before = getattr(replacement, 'inventory_bloc_ord', None)

    if not _claim_license_account_for_delivery(replacement):
        logger.info(
            'auto warranty skip license=%s day=%s idx=%s: repuesto tomado por otra operación',
            getattr(license_obj, 'id', None),
            day_key,
            line_idx,
        )
        db.session.rollback()
        return False

    old_at = bad_acc.assigned_at
    old_ex = bad_acc.expires_at
    old_cred_plain = '{} {}'.format(
        str(bad_acc.email or '').strip() or str(bad_acc.account_identifier or '').strip(),
        str(bad_acc.password or '').replace('\r\n', ' ').replace('\n', ' ').strip(),
    ).strip()

    db.session.delete(bad_acc)
    db.session.flush()

    replacement.status = 'assigned'
    replacement.assigned_to_user_id = uid
    replacement.assigned_at = old_at or datetime.utcnow()
    replacement.expires_at = old_ex or (datetime.utcnow() + _license_account_term_timedelta(license_obj))
    replacement.updated_at = datetime.utcnow()
    # El repuesto entregado sale del bloc Licencias (como en una venta).
    _warranty_remove_replacement_from_inventory_bloc(
        license_obj, replacement, replacement_slot_before
    )
    replacement.inventory_bloc_ord = None

    new_cred_plain = '{} {}'.format(
        str(replacement.email or '').strip(),
        str(replacement.password or '').replace('\r\n', ' ').replace('\n', ' ').strip(),
    ).strip()

    prev_good = _safe_strip(parts.get('statusGood') or parts.get('prevGoodRestore') or '')
    if normalize_status_key(prev_good) == 'ok':
        prev_good = _safe_strip(parts.get('prevGoodRestore') or '')
    if normalize_status_key(prev_good) == 'ok':
        prev_good = ''
    extra = _safe_strip(parts.get('extra'))
    # Tras entregar: estados en — (neutro). Sin «ok» / badge Buena o Entregada.
    new_line = LICENSE_LINE_FIELD_SEP.join(
        [new_cred_plain, reporter or 'anonimo', prev_good, '', extra]
    )

    day_map = _parse_day_map(getattr(license_obj, 'day_notepads_json', None))
    day_text = day_map.get(str(day_key), '')
    lines = day_text.split('\n') if day_text else []
    if line_idx < 0 or line_idx >= len(lines):
        db.session.rollback()
        return False
    lines[line_idx] = new_line
    day_map[str(day_key)] = '\n'.join(lines)
    license_obj.day_notepads_json = _dump_day_map(day_map)
    _append_suspended_line(license_obj, old_line)

    try:
        from app.store.license_report_notify import notify_license_report_answered

        if urow is not None:
            notify_license_report_answered(
                user=urow,
                license_obj=license_obj,
                outcome='warranty_replaced',
                credential_hint=old_cred_plain,
                new_credential=new_cred_plain,
                commit=False,
            )
    except Exception as nerr:
        logger.warning('auto warranty notify: %s', nerr)

    try:
        from app.store.routes import _billing_user_for_store_debt_limit
        from app.store.user_license_activity import append_portal_license_activity_record

        billing_for_log = (
            _billing_user_for_store_debt_limit(urow) if urow is not None else None
        ) or urow
        if billing_for_log is not None:
            pname = ''
            try:
                if license_obj.product is not None:
                    pname = str(license_obj.product.name or '').strip()
            except Exception:
                pname = ''
            if not pname:
                pname = 'Producto'
            append_portal_license_activity_record(
                billing_for_log,
                'garantia_entrega',
                '%s · garantía entregada' % pname,
                detail='%s\nse dio garantia por esta\n%s' % (old_cred_plain, new_cred_plain),
                extra={
                    'license_id': license_obj.id,
                    'account_id': replacement.id,
                    'product_name': pname,
                    'old_cred': old_cred_plain,
                    'new_cred': new_cred_plain,
                    'cred_hint': old_cred_plain,
                    'auto_deliver': 1,
                    'wa_digest_pending': 1,
                },
            )
    except Exception as log_err:
        logger.warning('auto warranty historial: %s', log_err)

    db.session.commit()
    return True


def run_license_warranty_auto_deliver_pipeline() -> Dict[str, Any]:
    """Revisa pendientes y entrega si el stock de gar. tiene ≥5 min."""
    from app.store.models import License
    from app.store.user_license_line_parse import (
        is_warranty_pending_bad,
        parse_admin_license_line_to_split_parts,
    )

    delay = timedelta(minutes=WARRANTY_AUTO_DELIVER_DELAY_MINUTES)
    now = datetime.utcnow()
    delivered = 0
    scanned = 0
    errors = 0

    licenses = License.query.filter(License.enabled.is_(True)).all()
    for lic in licenses:
        day_map = _parse_day_map(getattr(lic, 'day_notepads_json', None))
        if not day_map:
            continue
        # Re-leer tras cada entrega (day_map puede cambiar)
        changed = True
        while changed:
            changed = False
            day_map = _parse_day_map(getattr(lic, 'day_notepads_json', None))
            for day_key, text in list(day_map.items()):
                lines = text.split('\n') if text else []
                for idx, line in enumerate(lines):
                    raw = _safe_strip(line)
                    if not raw:
                        continue
                    scanned += 1
                    try:
                        parts = parse_admin_license_line_to_split_parts(raw)
                    except Exception:
                        continue
                    sb = _safe_strip(
                        parts.get('warrantyPendingPacked') or parts.get('statusBad') or ''
                    )
                    if not is_warranty_pending_bad(sb):
                        continue
                    try:
                        ok = _deliver_one_pending_line(
                            license_obj=lic,
                            day_key=day_key,
                            line_idx=idx,
                            old_line=raw,
                            parts=parts,
                            now=now,
                            delay=delay,
                        )
                    except Exception:
                        errors += 1
                        logger.exception(
                            'auto warranty deliver license=%s day=%s idx=%s',
                            getattr(lic, 'id', None),
                            day_key,
                            idx,
                        )
                        try:
                            from app.store.models import db

                            db.session.rollback()
                        except Exception:
                            pass
                        continue
                    if ok:
                        delivered += 1
                        changed = True
                        break
                if changed:
                    break

    return {
        'scanned_lines': scanned,
        'delivered': delivered,
        'errors': errors,
        'delay_minutes': WARRANTY_AUTO_DELIVER_DELAY_MINUTES,
    }
