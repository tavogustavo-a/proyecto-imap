# -*- coding: utf-8 -*-
"""
Actividad de licencias vista cliente: fusiona entregas (assigned_at / created_at en cuentas)
con un registro en JSON en User.portal_license_activity_log (cambios de estado en portal).
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

PORTAL_ACTIVITY_MAX = 380

from app.store.user_license_line_parse import normalize_status_key


def _renew_management_keys_normalized() -> set:
    vals = {'renovar 1 mes mas', 'dejar mes a mes', 'garantia', 'reemplazar'}
    return {normalize_status_key(x) for x in vals}


def portal_bad_label_readable(canon_bad: str) -> str:
    s = str(canon_bad or '').strip()
    if not s:
        return '—'
    k = normalize_status_key(s)
    m = {
        normalize_status_key('caida o suspendida'): 'Caída o suspendida',
        normalize_status_key('no reproduce'): 'No reproduce',
        normalize_status_key('error de contraseña'): 'Error de contraseña',
        normalize_status_key('otro'): 'Otro',
    }
    return m.get(k, s)


def portal_good_label_readable(canon_good: str) -> str:
    s = str(canon_good or '').strip()
    if not s:
        return '—'
    k = normalize_status_key(s)
    m = {
        normalize_status_key('ok'): 'Buena / revisada',
        normalize_status_key('renovar 1 mes mas'): 'Renovar 1 mes más',
        normalize_status_key('dejar mes a mes'): 'Dejar mes a mes',
        normalize_status_key('no renovar'): 'No renovar',
        normalize_status_key('garantia'): 'Garantía (repuesto)',
        normalize_status_key('reemplazar'): 'Reemplazar',
        normalize_status_key('terminado'): 'Terminado',
    }
    return m.get(k, s)


def append_portal_license_activity_record(
    user_row: Any,
    tipo: str,
    summary: str,
    detail: Optional[str] = None,
) -> None:
    """
    Inserta una entrada al inicio del JSON (más reciente primero).
    El caller hace commit.
    """
    raw = getattr(user_row, 'portal_license_activity_log', None) or ''
    items: List[Dict[str, Any]] = []
    if str(raw).strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                items = parsed
        except Exception:
            items = []

    summary_s = str(summary or '').strip()[:500]
    detail_s = str(detail or '').strip()
    if len(detail_s) > 2000:
        detail_s = detail_s[:2000]

    entry = {
        'ts': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S'),
        'tipo': str(tipo or '')[:48],
        'summary': summary_s,
        'detail': detail_s,
    }
    items.insert(0, entry)
    user_row.portal_license_activity_log = json.dumps(items[:PORTAL_ACTIVITY_MAX], ensure_ascii=False)


def _parse_iso_ts_naive(ts: Optional[str]) -> Optional[datetime]:
    if ts is None or str(ts).strip() == '':
        return None
    s = str(ts).strip().replace('Z', '')
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _tipo_visual(tipo_raw: str) -> str:
    t = str(tipo_raw or '').strip().lower()
    if t in ('incidencia', 'reporte_o_incidencia'):
        return 'Reporte / incidencia'
    if t in ('renovacion_estado', 'renovacion_gestion'):
        return 'Renovación / gestión'
    if t == 'incidencia_limpia':
        return 'Actualización estado'
    if t == 'entrega':
        return 'Entrega de licencia'
    return tipo_raw or 'Actividad'


def build_user_license_activity_timeline_rows(
    assignee_ids: List[int],
    viewer_user_row: Any,
    *,
    utc_to_colombia_fn,
) -> List[Dict[str, Any]]:
    """Filas ordenadas descendente por fecha para la plantilla HTML."""
    from sqlalchemy import func as sa_func, or_
    from sqlalchemy.orm import joinedload

    from app.store.models import License, LicenseAccount

    merged: List[Tuple[datetime, Dict[str, Any]]] = []

    if assignee_ids:
        q_accounts = (
            LicenseAccount.query.filter(
                LicenseAccount.assigned_to_user_id.in_(assignee_ids),
                or_(
                    sa_func.lower(sa_func.coalesce(LicenseAccount.status, '')).in_(('assigned', 'sold')),
                    LicenseAccount.status.is_(None),
                ),
            ).all()
        )
        licenses_by_id = {}
        lids = list({a.license_id for a in q_accounts if a.license_id})
        if lids:
            for lic in License.query.options(joinedload(License.product)).filter(License.id.in_(lids)).all():
                licenses_by_id[lic.id] = lic

        for acc in q_accounts:
            lic = licenses_by_id.get(acc.license_id)
            pname = lic.product.name if lic and lic.product else 'Producto'
            dt = getattr(acc, 'assigned_at', None) or getattr(acc, 'created_at', None)
            if not dt:
                continue
            merged.append(
                (
                    dt,
                    {
                        'fecha_col': utc_to_colombia_fn(dt).strftime('%Y-%m-%d %H:%M'),
                        'tipo_label': _tipo_visual('entrega'),
                        'summary': (
                            'Se te entregó acceso en «%(product)s»: %(cred)s'
                            % {
                                'product': pname,
                                'cred': str(getattr(acc, 'account_identifier', '') or '').strip()
                                or '(cuenta registrada)',
                            }
                        ),
                        'detail': '',
                        'sort_ts': dt,
                    },
                )
            )

    raw_log = getattr(viewer_user_row, 'portal_license_activity_log', None) or ''
    if str(raw_log).strip():
        try:
            lst = json.loads(raw_log)
        except Exception:
            lst = []
        if isinstance(lst, list):
            for item in lst:
                if not isinstance(item, dict):
                    continue
                dt = _parse_iso_ts_naive(item.get('ts'))
                if not dt:
                    continue
                tipo_raw = item.get('tipo') or ''
                merged.append(
                    (
                        dt,
                        {
                            'fecha_col': utc_to_colombia_fn(dt).strftime('%Y-%m-%d %H:%M'),
                            'tipo_label': _tipo_visual(str(tipo_raw)),
                            'summary': str(item.get('summary') or '').strip(),
                            'detail': str(item.get('detail') or '').strip(),
                            'sort_ts': dt,
                        },
                    )
                )

    merged.sort(key=lambda x: x[0], reverse=True)

    dedup_seen: set = set()
    out: List[Dict[str, Any]] = []
    for _dt, row in merged:
        key = (
            row.get('fecha_col'),
            row.get('tipo_label'),
            row.get('summary'),
            row.get('detail'),
        )
        if key in dedup_seen:
            continue
        dedup_seen.add(key)
        r = dict(row)
        r.pop('sort_ts', None)
        out.append(r)
    return out


def portal_log_status_changes(
    *,
    viewer_user_row: Any,
    product_name: str,
    calendar_day: int,
    dual_base: Dict[str, Any],
    canon_good: str,
    canon_sb: str,
    otro_use: str,
) -> None:
    """Invocado desde api_user_license_day_row_status antes del commit."""
    renew_nk = _renew_management_keys_normalized()

    old_sb = str(dual_base.get('statusBad') or '').strip()
    old_sg = str(dual_base.get('statusGood') or '').strip()

    nk_new_sb = normalize_status_key(canon_sb)
    nk_old_sb = normalize_status_key(old_sb)
    nk_new_sg = normalize_status_key(canon_good)
    nk_old_sg = normalize_status_key(old_sg)

    pname = product_name or 'Producto'

    # Incidencias / columna roja
    if nk_new_sb != nk_old_sb:
        if canon_sb.strip():
            det = otro_use.strip() if nk_new_sb == normalize_status_key('otro') else ''
            label = portal_bad_label_readable(canon_sb)
            append_portal_license_activity_record(
                viewer_user_row,
                'incidencia',
                '%s · Día %s: estado «%s»' % (pname, calendar_day, label),
                detail=(det if det else None),
            )
        elif old_sb:
            append_portal_license_activity_record(
                viewer_user_row,
                'incidencia_limpia',
                '%s · Día %s: ya no aparece incidencia en portal (antes: «%s»).'
                % (pname, calendar_day, portal_bad_label_readable(old_sb)),
                detail=None,
            )

    # Renovación / gestión — columna verde
    if nk_new_sg != nk_old_sg and canon_good.strip() and nk_new_sg in renew_nk:
        label = portal_good_label_readable(canon_good)
        append_portal_license_activity_record(
            viewer_user_row,
            'renovacion_estado',
            '%s · Día %s: opción favorable «%s»' % (pname, calendar_day, label),
            detail=None,
        )
