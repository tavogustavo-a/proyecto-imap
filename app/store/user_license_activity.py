# -*- coding: utf-8 -*-
"""
Actividad de licencias vista cliente: fusiona entregas (assigned_at / created_at en cuentas)
con un registro en JSON en User.portal_license_activity_log (cambios de estado en portal).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

_CRED_EMAIL_RE = re.compile(r'\S+@\S+\.\S+')

PORTAL_ACTIVITY_MAX = 380
PORTAL_ACTIVITY_RETENTION_DAYS = 180
_PORTAL_ACTIVITY_EXTRA_KEYS = frozenset(
    {'license_id', 'calendar_day', 'row_ordinal', 'account_id', 'cred_hint'}
)


def _sanitize_portal_activity_extra(extra: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(extra, dict):
        return {}
    out: Dict[str, Any] = {}
    for k in _PORTAL_ACTIVITY_EXTRA_KEYS:
        if k not in extra:
            continue
        v = extra[k]
        if k == 'cred_hint':
            s = str(v or '').strip()[:140]
            if s:
                out[k] = s
            continue
        if k == 'account_id':
            if v is None or v == '':
                continue
            try:
                out[k] = int(v)
            except (TypeError, ValueError):
                continue
            continue
        try:
            out[k] = int(v)
        except (TypeError, ValueError):
            continue
    return out


def _prune_activity_items_by_age(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cutoff = datetime.utcnow() - timedelta(days=PORTAL_ACTIVITY_RETENTION_DAYS)
    kept: List[Dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        dt = _parse_iso_ts_naive(it.get('ts'))
        if dt is None or dt >= cutoff:
            kept.append(it)
    return kept

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


def _email_from_cred_hint(cred: str) -> str:
    m = _CRED_EMAIL_RE.search((cred or '').strip())
    return m.group(0).strip().lower() if m else ''


def _is_valid_account_email(email: str) -> bool:
    em = (email or '').strip().lower()
    if not em or '@' not in em:
        return False
    local, _, domain = em.partition('@')
    return bool(local and domain and '.' in domain)


def _account_display_email(account: Any) -> str:
    """Correo para resumen: columna email primero; si no, extraer de account_identifier."""
    em = str(getattr(account, 'email', '') or '').strip().lower()
    if _is_valid_account_email(em):
        return em
    ident = str(getattr(account, 'account_identifier', '') or '').strip()
    from_ident = _email_from_cred_hint(ident)
    if from_ident:
        return from_ident
    if em and '@' in em:
        return em
    return ''


def _resolve_activity_contact_email(
    extra: Optional[Dict[str, Any]], summary: str = ''
) -> str:
    """Correo para resumen en log portal: cred_hint, account_id o texto guardado."""
    ex = extra if isinstance(extra, dict) else {}
    cred = str(ex.get('cred_hint') or '').strip()
    if _is_valid_account_email(cred):
        return cred.lower()
    found = _email_from_cred_hint(cred)
    if found:
        return found
    aid = ex.get('account_id')
    if aid is not None:
        try:
            from app.store.models import LicenseAccount

            acc = LicenseAccount.query.get(int(aid))
            if acc:
                em = _account_display_email(acc)
                if em:
                    return em
        except (TypeError, ValueError):
            pass
    return _email_from_cred_hint(summary) or ''


def _sale_row_is_renewal(sale_row: Any) -> bool:
    if sale_row is None:
        return False
    val = getattr(sale_row, 'is_renewal', False)
    if val in (True, 1):
        return True
    if isinstance(val, str) and val.strip().lower() in ('1', 'true', 'yes'):
        return True
    return False


def _renewal_activity_summary(product_name: str, cred_hint: str, account_email: str = '') -> str:
    """Resumen historial renovación: producto + correo de la cuenta."""
    pname = (product_name or 'Producto').strip()
    email = (account_email or '').strip().lower() or _email_from_cred_hint(cred_hint)
    if email:
        return '%s · %s' % (pname, email)
    cred_s = str(cred_hint or '').strip().replace('\n', ' ')
    if cred_s:
        return '%s · %s' % (pname, cred_s[:120])
    return pname


def _entrega_activity_summary(
    product_name: str, cred: str, account_email: str = ''
) -> str:
    """Resumen entrega: producto · correo (columna email o @ en credencial)."""
    pname = (product_name or 'Producto').strip()
    email = (account_email or '').strip().lower() or _email_from_cred_hint(cred)
    if email:
        return '%s · %s' % (pname, email)
    cred_s = str(cred or '').strip() or '(cuenta registrada)'
    return '%s · %s' % (pname, cred_s[:120])


def _activity_summary_strip_guillemets(summary: str) -> str:
    """Quita « » del resumen; normaliza formato antiguo «producto»: cuenta."""
    s = str(summary or '').strip()
    if not s:
        return s
    s2 = re.sub(r'^«([^»]+)»\s*:\s*', r'\1 · ', s)
    s2 = re.sub(r'antes:\s*«([^»]+)»', r'antes: \1', s2, flags=re.IGNORECASE)
    if '«' in s2 or '»' in s2:
        s2 = re.sub(r'[«»]', '', s2)
        s2 = re.sub(r'^([^:]+):\s+', r'\1 · ', s2, count=1)
    return s2.strip()


def _activity_summary_strip_opcion_favorable(summary: str) -> str:
    """Quita «opción favorable «…»» del resumen (entradas antiguas de renovación)."""
    s = str(summary or '').strip()
    if 'favorable' not in s.lower():
        return s
    s2 = re.sub(
        r':?\s*opci[oó]n\s+favorable\s*«[^»]*»\s*',
        '',
        s,
        flags=re.IGNORECASE,
    )
    s2 = re.sub(r':\s*$', '', s2)
    s2 = re.sub(r'\s*·\s*$', '', s2)
    return s2.strip()


def _activity_summary_strip_day_refs(summary: str) -> str:
    """Quita «Día N» / «Fila M» del resumen; la fecha ya va en la columna Fecha."""
    s = str(summary or '').strip()
    if not s:
        return s
    s2 = re.sub(
        r'\s*·\s*Día\s+\d+(?:\s*·\s*Fila\s+\d+)?',
        '',
        s,
        flags=re.IGNORECASE,
    )
    if s2 == s:
        return s
    s2 = re.sub(r'\s*·\s*:\s*', ': ', s2)
    return s2.strip()


def _caida_garantia_summary_display_from_stored(
    tipo_raw: str, summary: str, extra: Optional[Dict[str, Any]] = None
) -> str:
    """Quita texto repetido del tipo (caída / garantía); deja producto + cuenta."""
    t = str(tipo_raw or '').strip().lower()
    s = str(summary or '').strip()
    if not s:
        return s
    ex = extra if isinstance(extra, dict) else {}
    cred = str(ex.get('cred_hint') or '').strip()
    email = _resolve_activity_contact_email(ex, s) or _email_from_cred_hint(cred) or _email_from_cred_hint(s)

    if t == 'portal_caida':
        s = re.sub(
            r':?\s*cuenta\s+(reportada\s+)?en\s+ca[ií]da\s+o\s+suspendida\s*[—–-]\s*',
            ' · ',
            s,
            flags=re.IGNORECASE,
        )
        pname = s.split(' · ', 1)[0].strip() if ' · ' in s else s.split(':', 1)[0].strip()
        tail = ''
        if ' · ' in s:
            tail = s.split(' · ', 1)[1].strip()
        elif ':' in s:
            tail = s.split(':', 1)[1].strip()
        hint = email or tail or cred[:120]
        return '%s · %s' % (pname, hint) if hint else pname

    if t == 'portal_garantia':
        s = re.sub(
            r':?\s*garant[ií]a\s*\(repuesto\)\s*registrada\s+para\s*',
            ' · ',
            s,
            flags=re.IGNORECASE,
        )
        pname = s.split(' · ', 1)[0].strip() if ' · ' in s else s.split(':', 1)[0].strip()
        tail = s.split(' · ', 1)[1].strip() if ' · ' in s else ''
        hint = email or tail or cred[:120]
        return '%s · %s' % (pname, hint) if hint else pname

    return s


def _incidencia_summary_display_from_stored(
    tipo_raw: str, summary: str, extra: Optional[Dict[str, Any]] = None
) -> str:
    """Quita «estado «…»» del resumen si el tipo ya es Reporte / incidencia."""
    t = str(tipo_raw or '').strip().lower()
    if t not in ('incidencia', 'reporte_o_incidencia'):
        return summary
    s = str(summary or '').strip()
    m = re.match(r'^(.+?)\s*·\s*([^:]+):\s*estado\s*«([^»]+)»\s*$', s, re.I)
    if m:
        return '%s · %s' % (m.group(1).strip(), m.group(2).strip())
    m2 = re.match(r'^(.+?):\s*estado\s*«([^»]+)»\s*$', s, re.I)
    if m2:
        ex = extra if isinstance(extra, dict) else {}
        cred = str(ex.get('cred_hint') or '').strip()
        email = _email_from_cred_hint(cred)
        if email:
            return '%s · %s' % (m2.group(1).strip(), email)
    return s


def _portal_activity_summary_display(
    tipo_raw: str, summary: str, extra: Optional[Dict[str, Any]] = None
) -> str:
    s = _renewal_summary_display_from_stored(tipo_raw, summary, extra)
    s = _activity_summary_strip_day_refs(s)
    s = _activity_summary_strip_opcion_favorable(s)
    s = _caida_garantia_summary_display_from_stored(tipo_raw, s, extra)
    s = _incidencia_summary_display_from_stored(tipo_raw, s, extra)
    return _activity_summary_strip_guillemets(s)


def _renewal_summary_display_from_stored(
    tipo_raw: str, summary: str, extra: Optional[Dict[str, Any]] = None
) -> str:
    """Reescribe entradas antiguas de renovación a producto + correo."""
    t = str(tipo_raw or '').strip().lower()
    if t not in (
        'renovacion_estado',
        'renovacion_gestion',
        'renovacion_saldo',
        'renovacion_tienda',
    ):
        return summary
    s = str(summary or '').strip()
    low = s.lower()
    ex = extra if isinstance(extra, dict) else {}
    cred = str(ex.get('cred_hint') or '').strip()
    contact = _resolve_activity_contact_email(ex, s)
    pname = s
    if ' · ' in pname and not _email_from_cred_hint(pname):
        pname = pname.split(' · ', 1)[0].strip() or pname
    if ' · día ' in low:
        pname = s[: low.index(' · día ')].strip() or pname
    elif ' · Día ' in s:
        pname = s.split(' · Día ', 1)[0].strip() or pname
    elif ': opción favorable' in low or ': opcion favorable' in low:
        pname = re.split(r':\s*opci[oó]n\s+favorable', s, maxsplit=1, flags=re.I)[0].strip()
    if contact or cred or _email_from_cred_hint(s):
        return _renewal_activity_summary(pname, cred, contact)
    if 'favorable' in low:
        return pname
    return s


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


def log_store_renewal_activity(user_row: Any, product_name: str, account: Any) -> None:
    """Registra renovación pagada en tienda (checkout) en el historial del usuario."""
    cred_hint = str(getattr(account, 'account_identifier', '') or '').strip()
    acc_email = _account_display_email(account)
    extra_hint = acc_email or cred_hint
    extra = _sanitize_portal_activity_extra(
        {
            'account_id': getattr(account, 'id', None),
            'cred_hint': extra_hint[:140] if extra_hint else '',
        }
    )
    append_portal_license_activity_record(
        user_row,
        'renovacion_tienda',
        _renewal_activity_summary(product_name, cred_hint, acc_email or ''),
        detail=None,
        extra=extra or None,
    )


def append_portal_license_activity_record(
    user_row: Any,
    tipo: str,
    summary: str,
    detail: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Inserta una entrada al inicio del JSON (más reciente primero).
    Descarta registros más viejos que PORTAL_ACTIVITY_RETENTION_DAYS.
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

    items = _prune_activity_items_by_age(items)

    summary_s = str(summary or '').strip()[:500]
    detail_s = str(detail or '').strip()
    if len(detail_s) > 2000:
        detail_s = detail_s[:2000]

    entry: Dict[str, Any] = {
        'ts': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S'),
        'tipo': str(tipo or '')[:48],
        'summary': summary_s,
        'detail': detail_s,
    }
    ex = _sanitize_portal_activity_extra(extra)
    if ex:
        entry['extra'] = ex
    items.insert(0, entry)
    items = _prune_activity_items_by_age(items)
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
    if t == 'portal_caida':
        return 'Caída / cuenta suspendida'
    if t == 'portal_garantia':
        return 'Garantía (repuesto)'
    if t in ('incidencia', 'reporte_o_incidencia'):
        return 'Reporte / incidencia'
    if t in (
        'renovacion_estado',
        'renovacion_gestion',
        'renovacion_saldo',
        'renovacion_tienda',
    ):
        return 'Renovación'
    if t in ('abono_admin', 'abono_recarga', 'pago_cuenta'):
        return 'Pago / abono'
    if t == 'incidencia_limpia':
        return 'Actualización estado'
    if t == 'entrega':
        return 'Entrega'
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

    from app.store.models import License, LicenseAccount, Sale

    merged: List[Tuple[datetime, Dict[str, Any]]] = []
    sale_renewal_cache: Dict[int, bool] = {}

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
            is_store_renewal = False
            sid = getattr(acc, 'sale_id', None)
            if sid:
                try:
                    sid_int = int(sid)
                except (TypeError, ValueError):
                    sid_int = None
                if sid_int is not None:
                    if sid_int not in sale_renewal_cache:
                        sale_row = Sale.query.get(sid_int)
                        sale_renewal_cache[sid_int] = _sale_row_is_renewal(sale_row)
                    is_store_renewal = sale_renewal_cache[sid_int]
            cred_hint = str(getattr(acc, 'account_identifier', '') or '').strip()
            acc_email = _account_display_email(acc)
            if is_store_renewal:
                tipo_key = 'renovacion_tienda'
                summary = _renewal_activity_summary(pname, cred_hint, acc_email)
            else:
                tipo_key = 'entrega'
                summary = _entrega_activity_summary(pname, cred_hint, acc_email)
            merged.append(
                (
                    dt,
                    {
                        'fecha_col': utc_to_colombia_fn(dt).strftime('%Y-%m-%d %H:%M'),
                        'tipo_label': _tipo_visual(tipo_key),
                        'summary': summary,
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
        act_cutoff = datetime.utcnow() - timedelta(days=PORTAL_ACTIVITY_RETENTION_DAYS)
        if isinstance(lst, list):
            for item in lst:
                if not isinstance(item, dict):
                    continue
                dt = _parse_iso_ts_naive(item.get('ts'))
                if not dt:
                    continue
                if dt < act_cutoff:
                    continue
                tipo_raw = item.get('tipo') or ''
                raw_summary = str(item.get('summary') or '').strip()
                merged.append(
                    (
                        dt,
                        {
                            'fecha_col': utc_to_colombia_fn(dt).strftime('%Y-%m-%d %H:%M'),
                            'tipo_label': _tipo_visual(str(tipo_raw)),
                            'summary': _portal_activity_summary_display(
                                str(tipo_raw), raw_summary, item.get('extra')
                            ),
                            'detail': str(item.get('detail') or '').strip(),
                            'sort_ts': dt,
                        },
                    )
                )

    merged.sort(key=lambda x: x[0], reverse=True)

    dedup_by_moment: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    dedup_order: List[Tuple[str, str, str]] = []
    for _dt, row in merged:
        base_key = (
            str(row.get('fecha_col') or ''),
            str(row.get('summary') or ''),
            str(row.get('detail') or ''),
        )
        prev = dedup_by_moment.get(base_key)
        if prev is None:
            dedup_by_moment[base_key] = dict(row)
            dedup_order.append(base_key)
            continue
        if (
            row.get('tipo_label') == 'Renovación'
            and prev.get('tipo_label') != 'Renovación'
        ):
            dedup_by_moment[base_key] = dict(row)

    out: List[Dict[str, Any]] = []
    for base_key in dedup_order:
        r = dict(dedup_by_moment[base_key])
        r.pop('sort_ts', None)
        out.append(r)
    return out


def build_admin_store_license_activity_timeline_rows(
    *,
    utc_to_colombia_fn,
    max_events: int = 2500,
) -> List[Dict[str, Any]]:
    """Vista admin: todas las entregas (cuentas asignadas) + actividades del portal por usuario."""
    from sqlalchemy import func as sa_func, or_
    from sqlalchemy.orm import joinedload

    from app.models.user import User
    from app.store.models import License, LicenseAccount, Sale

    merged: List[Tuple[datetime, Dict[str, Any]]] = []
    act_cutoff = datetime.utcnow() - timedelta(days=PORTAL_ACTIVITY_RETENTION_DAYS)
    sale_renewal_cache: Dict[int, bool] = {}

    q_accounts = (
        LicenseAccount.query.filter(
            LicenseAccount.assigned_to_user_id.isnot(None),
            or_(
                sa_func.lower(sa_func.coalesce(LicenseAccount.status, '')).in_(('assigned', 'sold')),
                LicenseAccount.status.is_(None),
            ),
        ).all()
    )

    licenses_by_id: Dict[int, Any] = {}
    lids = list({a.license_id for a in q_accounts if a.license_id})
    if lids:
        for lic in License.query.options(joinedload(License.product)).filter(License.id.in_(lids)).all():
            licenses_by_id[lic.id] = lic

    uids = {int(a.assigned_to_user_id) for a in q_accounts if a.assigned_to_user_id}
    user_names: Dict[int, str] = {}
    if uids:
        for u_row in User.query.filter(User.id.in_(uids)).all():
            user_names[u_row.id] = str(u_row.username or '').strip() or '(sin nombre)'

    for acc in q_accounts:
        uid = acc.assigned_to_user_id
        if uid is None:
            continue
        lic = licenses_by_id.get(acc.license_id)
        pname = lic.product.name if lic and lic.product else 'Producto'
        dt = getattr(acc, 'assigned_at', None) or getattr(acc, 'created_at', None)
        if not dt:
            continue
        uname = user_names.get(int(uid), '?')
        cred_hint = str(getattr(acc, 'account_identifier', '') or '').strip()
        acc_email = _account_display_email(acc)
        is_store_renewal = False
        sid = getattr(acc, 'sale_id', None)
        if sid:
            try:
                sid_int = int(sid)
            except (TypeError, ValueError):
                sid_int = None
            if sid_int is not None:
                if sid_int not in sale_renewal_cache:
                    sale_row = Sale.query.get(sid_int)
                    sale_renewal_cache[sid_int] = _sale_row_is_renewal(sale_row)
                is_store_renewal = sale_renewal_cache[sid_int]
        if is_store_renewal:
            tipo_key = 'renovacion_tienda'
            summary = _renewal_activity_summary(pname, cred_hint, acc_email)
        else:
            tipo_key = 'entrega'
            summary = _entrega_activity_summary(pname, cred_hint, acc_email)
        merged.append(
            (
                dt,
                {
                    'fecha_col': utc_to_colombia_fn(dt).strftime('%Y-%m-%d %H:%M'),
                    'usuario': uname,
                    'tipo_label': _tipo_visual(tipo_key),
                    'summary': summary,
                    'sort_ts': dt,
                },
            )
        )

    users_with_logs = User.query.filter(User.portal_license_activity_log.isnot(None)).all()
    for u in users_with_logs:
        raw = getattr(u, 'portal_license_activity_log', None) or ''
        raw_s = str(raw).strip()
        if not raw_s:
            continue
        uname_display = str(u.username or '').strip() or '(sin nombre)'
        try:
            lst = json.loads(raw_s)
        except Exception:
            continue
        if not isinstance(lst, list):
            continue
        for item in lst:
            if not isinstance(item, dict):
                continue
            dt = _parse_iso_ts_naive(item.get('ts'))
            if not dt or dt < act_cutoff:
                continue
            tipo_it = str(item.get('tipo') or '')
            sum_s = _portal_activity_summary_display(
                tipo_it,
                str(item.get('summary') or '').strip(),
                item.get('extra'),
            )
            det_s = str(item.get('detail') or '').strip()
            if det_s and det_s != '.':
                merged_s = sum_s + (' · ' + det_s)
            else:
                merged_s = sum_s
            row_dict: Dict[str, Any] = {
                'fecha_col': utc_to_colombia_fn(dt).strftime('%Y-%m-%d %H:%M'),
                'usuario': uname_display,
                'tipo_label': _tipo_visual(tipo_it),
                'summary': merged_s,
                'sort_ts': dt,
            }
            extra_in = item.get('extra')
            if isinstance(extra_in, dict):
                ex = _sanitize_portal_activity_extra(extra_in)
                if {'license_id', 'calendar_day', 'row_ordinal'} <= set(ex.keys()):
                    try:
                        lid_i = int(ex['license_id'])
                        cd_i = int(ex['calendar_day'])
                        ord_i = int(ex['row_ordinal'])
                        wh: Dict[str, Any] = {
                            'license_id': lid_i,
                            'calendar_day': cd_i,
                            'row_ordinal': ord_i,
                        }
                        if ex.get('account_id') is not None:
                            wh['account_id'] = int(ex['account_id'])
                        lu = uname_display.lower()
                        if lu != 'anonimo' and lu != '(sin nombre)':
                            wh['client_username'] = uname_display
                        row_dict['meta'] = {'warranty_history': wh}
                    except (TypeError, ValueError, KeyError):
                        pass
            merged.append((dt, row_dict))

    merged.sort(key=lambda x: x[0], reverse=True)

    dedup_seen: set = set()
    out: List[Dict[str, Any]] = []
    for _dt, row in merged:
        key = (
            row.get('fecha_col'),
            row.get('usuario'),
            row.get('tipo_label'),
            row.get('summary'),
        )
        if key in dedup_seen:
            continue
        dedup_seen.add(key)
        rw = dict(row)
        rw.pop('sort_ts', None)
        out.append(rw)
        if len(out) >= max_events:
            break
    return out


def _extra_row_ctx(
    license_id: int,
    calendar_day: int,
    row_ordinal: int,
    account_id: Optional[int],
    cred_hint: str,
) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        'license_id': int(license_id),
        'calendar_day': int(calendar_day),
        'row_ordinal': int(row_ordinal),
    }
    ch = str(cred_hint or '').strip()[:140]
    if ch:
        d['cred_hint'] = ch
    if account_id is not None:
        d['account_id'] = int(account_id)
    return d


def _extras_match_row(
    ex: Dict[str, Any],
    license_id: int,
    calendar_day: int,
    row_ordinal: int,
    account_id: Optional[int],
) -> bool:
    try:
        if int(ex.get('license_id') or 0) != int(license_id):
            return False
        if int(ex.get('calendar_day') or -1) != int(calendar_day):
            return False
        if int(ex.get('row_ordinal') or -1) != int(row_ordinal):
            return False
        ex_acc = ex.get('account_id')
        if account_id is None:
            return ex_acc in (None, '', 0)
        return int(ex_acc or 0) == int(account_id)
    except (TypeError, ValueError):
        return False


def list_warranty_related_incidents(
    viewer_user_row: Any,
    license_id: int,
    calendar_day: int,
    row_ordinal: int,
    account_id: Optional[int],
    *,
    utc_to_colombia_fn,
) -> List[Dict[str, Any]]:
    """Eventos portal_caida / portal_garantia de esta fila, últimos 6 meses (para modal)."""
    raw = getattr(viewer_user_row, 'portal_license_activity_log', None) or ''
    cutoff = datetime.utcnow() - timedelta(days=PORTAL_ACTIVITY_RETENTION_DAYS)
    out: List[Dict[str, Any]] = []
    if not str(raw).strip():
        return []
    try:
        lst = json.loads(raw)
    except Exception:
        return []
    if not isinstance(lst, list):
        return []
    for item in lst:
        if not isinstance(item, dict):
            continue
        tipo = str(item.get('tipo') or '').strip()
        if tipo not in ('portal_caida', 'portal_garantia'):
            continue
        dt = _parse_iso_ts_naive(item.get('ts'))
        if not dt or dt < cutoff:
            continue
        ex = item.get('extra')
        if not isinstance(ex, dict) or not _extras_match_row(
            ex,
            license_id,
            calendar_day,
            row_ordinal,
            account_id,
        ):
            continue
        out.append(
            {
                'fecha_col': utc_to_colombia_fn(dt).strftime('%Y-%m-%d %H:%M'),
                'tipo_key': tipo,
                'tipo_label': _tipo_visual(tipo),
                'summary': _portal_activity_summary_display(
                    tipo, str(item.get('summary') or '').strip(), ex
                ),
                'detail': str(item.get('detail') or '').strip(),
                '_sort': dt,
            }
        )
    out.sort(key=lambda x: x['_sort'], reverse=True)
    for row in out:
        row.pop('_sort', None)
    return out


def merged_portal_warranty_incidents_for_users(
    user_rows: Optional[List[Any]],
    license_id: int,
    calendar_day: int,
    row_ordinal: int,
    account_id: Optional[int],
    *,
    utc_to_colombia_fn,
) -> List[Dict[str, Any]]:
    """Fusiona portal_caida / portal_garantia de varios User (titular + subusuarios)."""
    if not user_rows:
        return []
    acc: List[Dict[str, Any]] = []
    for urow in user_rows:
        try:
            chunk = list_warranty_related_incidents(
                urow,
                int(license_id),
                int(calendar_day),
                int(row_ordinal),
                account_id,
                utc_to_colombia_fn=utc_to_colombia_fn,
            )
        except Exception:
            chunk = []
        if chunk:
            acc.extend(chunk)

    dedup_seen: set = set()
    out_sorted: List[Dict[str, Any]] = []

    def _score_row(r: Dict[str, Any]) -> Any:
        return str(r.get('fecha_col') or '')

    for row in sorted(acc, key=_score_row, reverse=True):
        if not isinstance(row, dict):
            continue
        key = (
            str(row.get('fecha_col') or ''),
            str(row.get('tipo_key') or ''),
            str(row.get('summary') or ''),
            str(row.get('detail') or ''),
        )
        if key in dedup_seen:
            continue
        dedup_seen.add(key)
        nr = dict(row)
        nr.pop('_sort', None)
        out_sorted.append(nr)

    return out_sorted


def portal_log_status_changes(
    *,
    viewer_user_row: Any,
    product_name: str,
    calendar_day: int,
    dual_base: Dict[str, Any],
    canon_good: str,
    canon_sb: str,
    otro_use: str,
    license_id: int,
    row_ordinal: int,
    account_id: Optional[int] = None,
    cred_hint: str = '',
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
    nk_caida = normalize_status_key('caida o suspendida')
    nk_garantia = normalize_status_key('garantia')
    cred_s = str(cred_hint or dual_base.get('cred') or '').strip().replace('\n', ' ')
    cred_short = cred_s[:120]

    ctx = _extra_row_ctx(license_id, calendar_day, row_ordinal, account_id, cred_short)

    # Incidencias / columna roja
    if nk_new_sb != nk_old_sb:
        if nk_new_sb == nk_caida and canon_sb.strip():
            hint = _email_from_cred_hint(cred_short) or cred_short or 'cuenta'
            append_portal_license_activity_record(
                viewer_user_row,
                'portal_caida',
                '%s · %s' % (pname, hint),
                detail=otro_use.strip() if otro_use else None,
                extra=ctx,
            )
        elif canon_sb.strip():
            det = otro_use.strip() if nk_new_sb == normalize_status_key('otro') else ''
            label = portal_bad_label_readable(canon_sb)
            email = _email_from_cred_hint(cred_short)
            if email:
                sum_inc = '%s · %s' % (pname, email)
            else:
                sum_inc = '%s · %s' % (pname, label)
            append_portal_license_activity_record(
                viewer_user_row,
                'incidencia',
                sum_inc,
                detail=(det if det else None),
                extra=ctx,
            )
        elif old_sb:
            append_portal_license_activity_record(
                viewer_user_row,
                'incidencia_limpia',
                '%s: sin incidencia en portal (antes: %s).'
                % (pname, portal_bad_label_readable(old_sb)),
                detail=None,
                extra=ctx,
            )

    # Renovación — columna verde (garantía lleva tipo aparte para historial / modal)
    if nk_new_sg != nk_old_sg and canon_good.strip():
        if nk_new_sg == nk_garantia:
            hint = _email_from_cred_hint(cred_short) or cred_short or 'cuenta'
            append_portal_license_activity_record(
                viewer_user_row,
                'portal_garantia',
                '%s · %s' % (pname, hint),
                detail=None,
                extra=ctx,
            )
        elif nk_new_sg in renew_nk:
            append_portal_license_activity_record(
                viewer_user_row,
                'renovacion_estado',
                _renewal_activity_summary(pname, cred_short),
                detail=None,
                extra=ctx,
            )
