# -*- coding: utf-8 -*-
"""
Parsing de líneas del bloc «mes a mes» (Licencias) alineado con licencias.js / parseAdminLicenseLineToSplitParts.
Se usa en la API de vista cliente para colorear verde/rojo por día.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

LICENSE_LINE_FIELD_SEP = '\x1f'
PREV_GOOD_BAD_PREFIX = '__prev_good:'
PORTAL_GREEN_EXTRA_PREFIX = '_u_green:'
PORTAL_BAD_EXTRA_PREFIX = '_u_bad:'
AUTO_MES_EXTRA_PREFIX = '_auto_mes:'

# Valores que el cliente puede elegir en el portal (sin ok ni terminado).
PORTAL_USER_SELECTABLE_GOOD_VALUES = [
    'renovar 1 mes mas',
    'dejar mes a mes',
    'no renovar',
]

# Coincide con ADMIN_LICENSE_STATUS_OPTIONS_GOOD en licencias.js + «terminado» en GOOD_KEYS.
OPTIONS_GOOD_VALUES = [
    'ok',
    'renovar 1 mes mas',
    'dejar mes a mes',
    'no renovar',
    'garantia',
    'reemplazar',
    'terminado',
]
OPTIONS_BAD_VALUES = [
    'caida o suspendida',
    'no reproduce',
    'error de contraseña',
    'otro',
    'caida',
    'suspendida',
    'repetida',
]


def normalize_status_key(s: Any) -> str:
    raw = str(s or '').strip()
    if not raw:
        return ''
    try:
        nfd = unicodedata.normalize('NFD', raw)
        no_marks = ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')
    except Exception:
        no_marks = raw
    return re.sub(r'\s+', ' ', no_marks.lower()).strip()


def _canonical_good_from_stored(st: str) -> str:
    raw = str(st or '').strip()
    if not raw:
        return ''
    k = normalize_status_key(raw)
    for o in OPTIONS_GOOD_VALUES:
        if o and normalize_status_key(o) == k:
            return o
    return raw


def _canonical_bad_from_stored(st: str) -> str:
    raw = str(st or '').strip()
    if not raw:
        return ''
    k = normalize_status_key(raw)
    if k in ('caida', 'suspendida'):
        return 'caida o suspendida'
    for o in OPTIONS_BAD_VALUES:
        if o and normalize_status_key(o) == k:
            return o
    return raw


def _canonical_status_from_stored(st: str) -> str:
    raw = str(st or '').strip()
    if not raw:
        return ''
    k = normalize_status_key(raw)
    if k in ('caida', 'suspendida'):
        return 'caida o suspendida'
    for o in OPTIONS_GOOD_VALUES + OPTIONS_BAD_VALUES:
        if o and normalize_status_key(o) == k:
            return o
    return raw


ADMIN_LICENSE_STATUS_GOOD_KEYS = {normalize_status_key(x) for x in OPTIONS_GOOD_VALUES if x}
ADMIN_LICENSE_STATUS_BAD_KEYS = {normalize_status_key(x) for x in OPTIONS_BAD_VALUES if x}


def admin_license_status_tier_from_stored(status_text: Optional[str]) -> str:
    raw = str(status_text or '').strip()
    k = normalize_status_key(raw)
    if not k:
        return 'neutral'
    if re.match(r'^otro[-:\s]', raw, re.I) or k == 'otro':
        return 'bad'
    if k in ADMIN_LICENSE_STATUS_GOOD_KEYS:
        return 'good'
    if k in ADMIN_LICENSE_STATUS_BAD_KEYS:
        return 'bad'
    return 'neutral'


def unpack_prev_good_from_bad_segment(bad_raw: str) -> Tuple[str, str]:
    """Separa incidencia visible del estado verde guardado antes de «ok»."""
    s = str(bad_raw or '').strip()
    if not s:
        return '', ''
    if s.startswith(PREV_GOOD_BAD_PREFIX):
        prev = s[len(PREV_GOOD_BAD_PREFIX) :].strip()
        prev = _canonical_good_from_stored(prev) or prev
        return '', prev
    return s, ''


def pack_prev_good_bad_segment(prev_good: str) -> str:
    pg = str(prev_good or '').strip()
    if not pg or normalize_status_key(pg) == 'ok':
        return ''
    canon = _canonical_good_from_stored(pg) or pg
    return PREV_GOOD_BAD_PREFIX + canon


def parse_bad_stored_segment(bad_raw: str) -> Dict[str, str]:
    visible_bad, _prev = unpack_prev_good_from_bad_segment(bad_raw)
    s = str(visible_bad or '').strip()
    if not s:
        return {'selValue': '', 'otroDetail': ''}
    m = re.match(r'^otro-?\s*(.*)$', s, re.I)
    if m:
        return {'selValue': 'otro', 'otroDetail': (m.group(1) or '').strip()}
    return {'selValue': _canonical_bad_from_stored(s) or s, 'otroDetail': ''}


def dual_from_stored_segments(cred: str, user: str, good_raw: str, bad_raw: str, extra: str) -> Dict[str, Any]:
    visible_bad, prev_good = unpack_prev_good_from_bad_segment(bad_raw)
    bp = parse_bad_stored_segment(visible_bad if visible_bad else bad_raw)
    sg = good_raw.strip() if good_raw else ''
    status_good = (_canonical_good_from_stored(sg) or sg) if sg else ''
    return {
        'cred': cred if cred is not None else '',
        'user': (user or '').strip(),
        'statusGood': status_good,
        'statusBad': bp['selValue'],
        'otroDetail': bp['otroDetail'],
        'extra': (extra or '').strip(),
        'prevGoodRestore': prev_good,
    }


def effective_bad_for_tier(status_bad: str, otro_detail: str) -> str:
    visible_bad, _prev = unpack_prev_good_from_bad_segment(status_bad)
    sv = str(visible_bad or '').strip()
    if not sv:
        return ''
    if normalize_status_key(sv) == 'otro':
        d = str(otro_detail or '').strip()
        d = re.sub(r'^otro-?', '', d, flags=re.I).strip()
        return ('otro-' + d) if d else 'otro-'
    return sv


def dual_to_storage_line(dual: Dict[str, Any]) -> str:
    """Formato LICENCIA con LICENSE_LINE_FIELD_SEP (alineado con buildAdminLicenseStorageLine en licencias.js)."""
    c = str(dual.get('cred') or '').strip()
    u_raw = str(dual.get('user') or '').strip()
    uu = u_raw if u_raw else 'anonimo'
    sg_raw = str(dual.get('statusGood') or '').strip()
    sg = (_canonical_good_from_stored(sg_raw) or sg_raw) if sg_raw else ''
    sb_sel = str(dual.get('statusBad') or '').strip()
    od = str(dual.get('otroDetail') or '').strip()
    extra = str(dual.get('extra') or '').strip()
    bad_seg = effective_bad_for_tier(sb_sel, od)
    if normalize_status_key(sg) == 'ok':
        prev_bad_save = str(dual.get('prevBadRestore') or '').strip()
        if not prev_bad_save:
            prev_bad_save = effective_bad_for_tier(sb_sel, od)
        if not prev_bad_save:
            prev_bad_save = portal_bad_from_extra(extra)
        prev_pack = str(dual.get('prevGoodRestore') or '').strip()
        if not prev_pack:
            _, prev_pack = unpack_prev_good_from_bad_segment(bad_seg)
        if not prev_pack:
            prev_pack = portal_green_from_extra(extra)
        packed_prev = pack_prev_good_bad_segment(prev_pack)
        bad_seg = packed_prev if packed_prev else ''
        if prev_bad_save:
            extra = portal_bad_embed_in_extra(extra, prev_bad_save)
    green_tag = ''
    if normalize_status_key(sg) == 'ok':
        green_tag = str(dual.get('prevGoodRestore') or '').strip() or portal_green_from_extra(extra)
    elif sg and normalize_status_key(sg) in _portal_selectable_good_keys():
        green_tag = sg
    if green_tag:
        extra = portal_green_embed_in_extra(extra, green_tag)
    if not c and not sg and not bad_seg and not extra and (not u_raw or uu == 'anonimo'):
        return ''
    return LICENSE_LINE_FIELD_SEP.join([c, uu, sg, bad_seg, extra])


def collect_visible_day_line_targets_assigned(
    day_text: Optional[str],
    allowed_usernames: List[str],
    email: str,
    account_identifier: str,
) -> Tuple[List[str], List[Tuple[int, str, Dict[str, Any]]]]:
    raw_lines = str(day_text or '').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    visible: List[Tuple[int, str, Dict[str, Any]]] = []
    for idx, line in enumerate(raw_lines):
        stripped = line.strip()
        if not stripped:
            continue
        dual = parse_admin_license_line_to_split_parts(line)
        if not line_visible_for_assignee_account(dual, allowed_usernames, email, account_identifier):
            continue
        visible.append((idx, line, dual))
    return raw_lines, visible


def collect_visible_day_line_targets_username_only(
    day_text: Optional[str],
    allowed_usernames: List[str],
) -> Tuple[List[str], List[Tuple[int, str, Dict[str, Any]]]]:
    raw_lines = str(day_text or '').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    visible: List[Tuple[int, str, Dict[str, Any]]] = []
    for idx, line in enumerate(raw_lines):
        stripped = line.strip()
        if not stripped:
            continue
        dual = parse_admin_license_line_to_split_parts(line)
        if not username_linked_explicitly_to_viewer(str(dual.get('user') or ''), allowed_usernames):
            continue
        visible.append((idx, line, dual))
    return raw_lines, visible


def _portal_extra_segments(extra: str) -> List[str]:
    s = str(extra or '').strip()
    if not s:
        return []
    return [p.strip() for p in re.split(r'\s*·\s*', s) if p.strip()]


def _portal_strip_tag_segments(extra: str, prefix: str) -> str:
    pl = str(prefix or '').lower()
    kept: List[str] = []
    for seg in _portal_extra_segments(extra):
        if not seg.lower().startswith(pl):
            kept.append(seg)
    return (' · '.join(kept)).strip()


def _canonical_portal_user_good(st: Any) -> str:
    """Estado verde del portal (renovar, mes a mes, etc.), incl. valores truncados en tags."""
    raw = str(st or '').strip()
    if not raw:
        return ''
    k = normalize_status_key(raw)
    if not k or k in ('ok', 'terminado'):
        return ''
    for o in PORTAL_USER_SELECTABLE_GOOD_VALUES:
        if o and k == normalize_status_key(o):
            return o
    matches = [
        o
        for o in PORTAL_USER_SELECTABLE_GOOD_VALUES
        if o and normalize_status_key(o).startswith(k)
    ]
    if len(matches) == 1:
        return matches[0]
    return ''


def _sanitize_portal_bad_input(sb_raw: Any) -> str:
    s = str(sb_raw or '').strip()
    if not s:
        return ''
    if s.lower().startswith(PORTAL_BAD_EXTRA_PREFIX.lower()):
        s = s[len(PORTAL_BAD_EXTRA_PREFIX) :].strip()
    visible, _prev = unpack_prev_good_from_bad_segment(s)
    return str(visible or '').strip()


def validate_portal_user_status_values(
    status_good_raw: Any, status_bad_raw: Any, otro_detail_raw: Any
) -> Tuple[str, str, str]:
    """Devuelve (status_good canónico, statusBad selector '', 'otro', etc., otroDetail limpio)."""
    sg_req = _canonical_portal_user_good(status_good_raw) or str(status_good_raw or '').strip()
    sb_req = _sanitize_portal_bad_input(status_bad_raw)
    od_raw = str(otro_detail_raw or '').strip()
    od_clean = re.sub(r'^otro-?', '', od_raw, flags=re.I).strip()

    if sg_req and normalize_status_key(sg_req) == 'ok':
        raise ValueError('Solo soporte puede marcar «Buena y revisada».')
    if sg_req and normalize_status_key(sg_req) == 'terminado':
        raise ValueError('Estado no disponible.')

    canon_good = ''
    if sg_req:
        found_g = _canonical_portal_user_good(sg_req)
        if not found_g:
            raise ValueError('Estado favorable no válido.')
        canon_good = found_g

    canon_sb = ''
    visible_sb, _prev_sb = unpack_prev_good_from_bad_segment(sb_req)
    nk_sb = normalize_status_key(visible_sb) if visible_sb else ''
    if visible_sb:
        if nk_sb == 'otro':
            canon_sb = 'otro'
        else:
            found_b = ''
            for o in OPTIONS_BAD_VALUES:
                if o and normalize_status_key(o) == nk_sb:
                    found_b = o
                    break
            if not found_b:
                raise ValueError('Estado de reporte no válido.')
            canon_sb = _canonical_bad_from_stored(found_b) or found_b

    if normalize_status_key(canon_sb or '') != 'otro':
        otro_detail = ''
    else:
        if len(od_clean) > 2000:
            od_clean = od_clean[:2000]
        otro_detail = od_clean

    return canon_good, canon_sb, otro_detail


def portal_green_from_extra(extra: str) -> str:
    pl = PORTAL_GREEN_EXTRA_PREFIX.lower()
    for seg in _portal_extra_segments(extra):
        if not seg.lower().startswith(pl):
            continue
        raw = seg[len(PORTAL_GREEN_EXTRA_PREFIX) :].strip()
        g = _canonical_portal_user_good(raw) or (_canonical_good_from_stored(raw) or raw).strip()
        if not g or normalize_status_key(g) == 'ok':
            return ''
        return g
    return ''


def portal_bad_from_extra(extra: str) -> str:
    pl = PORTAL_BAD_EXTRA_PREFIX.lower()
    for seg in _portal_extra_segments(extra):
        if not seg.lower().startswith(pl):
            continue
        raw = seg[len(PORTAL_BAD_EXTRA_PREFIX) :].strip()
        if normalize_status_key(raw) == 'otro':
            return 'otro'
        return _canonical_bad_from_stored(raw) or raw
    return ''


def portal_strip_bad_from_extra(extra: str) -> str:
    return _portal_strip_tag_segments(str(extra or '').strip(), PORTAL_BAD_EXTRA_PREFIX)


def portal_bad_embed_in_extra(extra: str, bad_val: str) -> str:
    e = portal_strip_bad_from_extra(str(extra or '').strip())
    b = str(bad_val or '').strip()
    if not b:
        return e
    if normalize_status_key(b) == 'otro':
        tag = PORTAL_BAD_EXTRA_PREFIX + 'otro'
    else:
        tag = PORTAL_BAD_EXTRA_PREFIX + (_canonical_bad_from_stored(b) or b)
    return (e + ' · ' + tag).strip() if e else tag


def _prev_bad_restore_from_dual(dual: Dict[str, Any]) -> str:
    return portal_bad_from_extra(str(dual.get('extra') or ''))


def portal_strip_green_from_extra(extra: str) -> str:
    return _portal_strip_tag_segments(str(extra or '').strip(), PORTAL_GREEN_EXTRA_PREFIX)


def strip_auto_mes_from_extra(extra: str) -> str:
    return re.sub(
        r'(?:\s*·\s*)?' + re.escape(AUTO_MES_EXTRA_PREFIX) + r'\d{4}-\d{2}',
        '',
        str(extra or '').strip(),
    ).strip()


def user_visible_notes_from_extra(extra: str) -> str:
    """Notas visibles al admin: sin tags internos (_u_green, _auto_mes)."""
    return strip_auto_mes_from_extra(portal_strip_green_from_extra(str(extra or '').strip()))


def portal_green_embed_in_extra(extra: str, green_val: str) -> str:
    e = portal_strip_green_from_extra(str(extra or '').strip())
    g = str(green_val or '').strip()
    if not g or normalize_status_key(g) == 'ok':
        return e
    canon = _canonical_portal_user_good(g) or (_canonical_good_from_stored(g) or g).strip()
    tag = PORTAL_GREEN_EXTRA_PREFIX + canon
    return (e + ' · ' + tag).strip() if e else tag


def _prev_good_restore_from_dual(dual: Dict[str, Any]) -> str:
    prev = str(dual.get('prevGoodRestore') or '').strip()
    if prev:
        return prev
    _, prev = unpack_prev_good_from_bad_segment(str(dual.get('statusBad') or ''))
    prev = str(prev or '').strip()
    if prev:
        return prev
    return portal_green_from_extra(str(dual.get('extra') or ''))


def resolve_portal_green_select_value(
    dual: Dict[str, Any], raw_line: Optional[str] = None
) -> str:
    """Valor del desplegable verde del portal (renovar, mes a mes, etc.)."""
    sg = str(dual.get('statusGood') or '').strip()
    canon_g = (_canonical_good_from_stored(sg) or sg).strip() if sg else ''
    portable = _portal_selectable_good_keys()
    if normalize_status_key(canon_g) == 'ok':
        prev = _prev_good_restore_from_dual(dual)
        raw = str(raw_line or '').strip()
        if not prev and raw and LICENSE_LINE_FIELD_SEP in raw:
            parts = raw.split(LICENSE_LINE_FIELD_SEP)
            if len(parts) >= 4:
                _, prev = unpack_prev_good_from_bad_segment(parts[3] or '')
        if not prev:
            prev = portal_green_from_extra(str(dual.get('extra') or ''))
        return _canonical_portal_user_good(prev) or prev
    if canon_g and normalize_status_key(canon_g) in portable:
        return canon_g
    extra_g = portal_green_from_extra(str(dual.get('extra') or ''))
    if extra_g:
        return extra_g
    prev = _prev_good_restore_from_dual(dual)
    canon_prev = _canonical_portal_user_good(prev)
    if canon_prev:
        return canon_prev
    return ''


def _portal_selectable_good_keys() -> set:
    return {normalize_status_key(x) for x in PORTAL_USER_SELECTABLE_GOOD_VALUES}


def apply_portal_user_status_update(
    current_dual: Dict[str, Any],
    status_good_raw: Any,
    status_bad_raw: Any,
    otro_detail_raw: Any,
    *,
    revert_buena_revisada: bool = False,
    status_good_omitted: bool = False,
) -> Tuple[str, str, str]:
    """
    Actualiza estados desde el portal del cliente.
    Si la fila está en «ok», el cliente solo puede revertir al estado anterior (no elegir ok).
    Cualquier otro guardado (p. ej. notas) debe conservar «ok» y el respaldo de renovación.
    Si no se envía status_good, se conserva el verde (renovar, etc.) al cambiar solo la columna roja.
    """
    cur_sg = str(current_dual.get('statusGood') or '').strip()
    cur_sg_key = normalize_status_key(cur_sg)
    portable = _portal_selectable_good_keys()

    if cur_sg_key == 'ok':
        prev = _prev_good_restore_from_dual(current_dual)
        sg_req = str(status_good_raw or '').strip() if status_good_raw is not None else ''
        if normalize_status_key(sg_req) == 'ok':
            raise ValueError('Solo soporte puede marcar «Buena y revisada».')
        if not revert_buena_revisada:
            return 'ok', '', ''
        restore_bad = _prev_bad_restore_from_dual(current_dual)
        sb_req = _sanitize_portal_bad_input(status_bad_raw) if status_bad_raw is not None else ''
        canon_sg = _canonical_portal_user_good(sg_req) if sg_req else ''
        if canon_sg:
            return validate_portal_user_status_values(
                canon_sg, sb_req or restore_bad, otro_detail_raw
            )
        restore_good = _canonical_portal_user_good(prev) or _canonical_portal_user_good(
            portal_green_from_extra(str(current_dual.get('extra') or ''))
        )
        if not restore_good and prev:
            restore_good = _canonical_good_from_stored(prev) or prev
            if normalize_status_key(restore_good) not in portable:
                restore_good = ''
        if restore_bad:
            restore_bad = _canonical_bad_from_stored(restore_bad) or restore_bad
        return restore_good, restore_bad, ''

    sg_use = status_good_raw
    if status_good_omitted and cur_sg_key in portable:
        sg_use = cur_sg
    elif (
        status_good_raw is not None
        and not str(status_good_raw or '').strip()
        and cur_sg_key in portable
    ):
        visible_sb, _prev_sb = unpack_prev_good_from_bad_segment(str(status_bad_raw or ''))
        if visible_sb or str(status_bad_raw or '').strip():
            sg_use = cur_sg

    return validate_portal_user_status_values(sg_use, status_bad_raw, otro_detail_raw)


def rebuild_day_notepad_lines_with_physical_index(
    raw_lines: List[str], physical_idx: int, new_line_content: str
) -> str:
    if physical_idx < 0 or physical_idx >= len(raw_lines):
        raise ValueError('Índice de línea inconsistente.')
    upd = raw_lines.copy()
    upd[physical_idx] = new_line_content
    return '\n'.join(upd)


def parse_row_tail_fields(cred: str, user: str, seg3: str, seg4: str) -> Dict[str, Any]:
    c = str(cred or '')
    u = (user or '').strip()
    s3 = (seg3 or '').strip()
    s4 = (seg4 or '').strip()
    m_dash = re.match(r'^otro\s*-\s*(.*)$', s3, re.I)
    if m_dash:
        return {'cred': c, 'user': u, 'status': 'otro', 'otroDetail': (m_dash.group(1) or '').strip(), 'extra': s4}
    m_colon = re.match(r'^otro:\s*(.*)$', s3, re.I)
    if m_colon:
        return {'cred': c, 'user': u, 'status': 'otro', 'otroDetail': (m_colon.group(1) or '').strip(), 'extra': s4}
    if s3.lower() == 'otro' and s4:
        return {'cred': c, 'user': u, 'status': 'otro', 'otroDetail': s4, 'extra': ''}
    norm = 'otro' if s3.lower() == 'otro' else _canonical_status_from_stored(s3)
    return {'cred': c, 'user': u, 'status': norm, 'otroDetail': '', 'extra': s4}


def migrate_legacy_four_part_to_dual(cred: str, user: str, seg3: str, seg4: str) -> Dict[str, Any]:
    legacy = parse_row_tail_fields(cred, user, seg3, seg4)
    st = legacy['status']
    st_for_tier = ('otro-' + str(legacy['otroDetail']).strip()) if str(st).lower() == 'otro' and legacy.get('otroDetail') else st
    tier = admin_license_status_tier_from_stored(str(st_for_tier))
    if tier == 'good':
        return {
            'cred': legacy['cred'],
            'user': legacy['user'],
            'statusGood': _canonical_good_from_stored(st) or st,
            'statusBad': '',
            'otroDetail': '',
            'extra': legacy['extra'],
        }
    if tier == 'bad':
        if str(st).lower() == 'otro':
            od = str(legacy.get('otroDetail') or '').strip()
            return {
                'cred': legacy['cred'],
                'user': legacy['user'],
                'statusGood': '',
                'statusBad': 'otro',
                'otroDetail': od,
                'extra': legacy['extra'],
            }
        bs = _canonical_bad_from_stored(st) or st
        return {
            'cred': legacy['cred'],
            'user': legacy['user'],
            'statusGood': '',
            'statusBad': bs,
            'otroDetail': '',
            'extra': legacy['extra'],
        }
    if not st:
        return {
            'cred': legacy['cred'],
            'user': legacy['user'],
            'statusGood': '',
            'statusBad': '',
            'otroDetail': '',
            'extra': legacy['extra'],
        }
    return {
        'cred': legacy['cred'],
        'user': legacy['user'],
        'statusGood': _canonical_good_from_stored(st) or st,
        'statusBad': '',
        'otroDetail': '',
        'extra': legacy['extra'],
    }


def index_of_legacy_double_slash_from(s: str, start_pos: int = 0) -> int:
    t = str(s or '')
    pos = start_pos or 0
    while pos < len(t):
        i = t.find('//', pos)
        if i == -1:
            return -1
        if i == 0 or t[i - 1] != ':':
            return i
        pos = i + 2
    return -1


def split_line_cred_notes_user(line: str) -> Dict[str, str]:
    t = str(line or '').strip()
    if not t:
        return {'cred': '', 'notes': '', 'user': '', 'extra': ''}
    i1 = index_of_legacy_double_slash_from(t, 0)
    if i1 == -1:
        return {'cred': t, 'notes': '', 'user': '', 'extra': ''}
    cred = t[:i1].strip()
    after1 = t[i1 + 2 :]
    i2 = index_of_legacy_double_slash_from(after1, 0)
    if i2 == -1:
        return {'cred': cred, 'notes': after1.strip(), 'user': '', 'extra': ''}
    notes = after1[:i2].strip()
    after2 = after1[i2 + 2 :]
    i3 = index_of_legacy_double_slash_from(after2, 0)
    if i3 == -1:
        return {'cred': cred, 'notes': notes, 'user': after2.strip(), 'extra': ''}
    return {'cred': cred, 'notes': notes, 'user': after2[:i3].strip(), 'extra': after2[i3 + 2 :].strip()}


def parse_admin_license_line_to_split_parts(line: Any) -> Dict[str, Any]:
    raw = str(line if line is not None else '').replace('\r', '')
    if not raw.strip():
        return {'cred': '', 'user': '', 'statusGood': '', 'statusBad': '', 'otroDetail': '', 'extra': ''}
    if LICENSE_LINE_FIELD_SEP in raw:
        parts = raw.split(LICENSE_LINE_FIELD_SEP)
        cred = parts[0] if parts else ''
        usr = (parts[1] or '').strip()
        if len(parts) >= 5:
            good = (parts[2] or '').strip()
            bad_raw = (parts[3] or '').strip()
            extra = (parts[4] or '').strip()
            return dual_from_stored_segments(cred, usr, good, bad_raw, extra)
        # Menos de 5 segmentos tras split: igual que licencias.js (seg3/seg4 vacíos si faltan).
        seg3 = ((parts[2] if len(parts) > 2 else '') or '').strip()
        seg4 = ((parts[3] if len(parts) > 3 else '') or '').strip()
        return migrate_legacy_four_part_to_dual(cred, usr, seg3, seg4)
    if index_of_legacy_double_slash_from(raw, 0) == -1:
        return migrate_legacy_four_part_to_dual(raw, '', '', '')
    sp = split_line_cred_notes_user(raw)
    cred = sp['cred'] if sp['cred'] is not None else ''
    usr = (sp['notes'] or '').strip()
    seg3 = (sp['user'] or '').strip()
    seg4 = (sp['extra'] or '').strip()
    return migrate_legacy_four_part_to_dual(cred, usr, seg3, seg4)


def dual_row_green_red(dual: Dict[str, Any]) -> Tuple[bool, bool]:
    """(verde con columna buena rellena, rojo con tier malo en columna mala)."""
    sg = str(dual.get('statusGood') or '').strip()
    show_green = bool(sg)
    eff = effective_bad_for_tier(dual.get('statusBad') or '', dual.get('otroDetail') or '')
    tier_bad = admin_license_status_tier_from_stored(eff)
    show_red = tier_bad == 'bad'
    return show_green, show_red


def usernames_match(line_user: str, allowed_names: List[str]) -> bool:
    """Cliente explícito en la línea debe coincidir con el viewer (nunca «anonimo»)."""
    lu = normalize_status_key(line_user)
    if not lu or lu == 'anonimo':
        return False
    for n in allowed_names:
        if normalize_status_key(n) == lu:
            return True
    return False


def credential_matches_account(raw_cred: str, email: str, account_identifier: str) -> bool:
    c = str(raw_cred or '').lower()
    em = str(email or '').strip().lower()
    aid = str(account_identifier or '').strip().lower()
    if em and em in c:
        return True
    if aid and aid in c:
        return True
    if em:
        prefix = em.split('@', 1)[0]
        parts = str(raw_cred or '').strip().split()
        first = parts[0].lower() if parts else ''
        if prefix and prefix == first:
            return True
    return False


def line_visible_for_assignee_account(
    dual: Dict[str, Any],
    allowed_usernames: List[str],
    email: str,
    account_identifier: str,
) -> bool:
    """
    Vista portal: credencial de la línea acorde a la cuenta **y** cliente explícito del viewer.
    «anonimo» o vacío no se vinculan a ningún usuario del portal (solo inventario/admin).
    """
    if not credential_matches_account(str(dual.get('cred')), email, account_identifier):
        return False
    line_user = str(dual.get('user') or '').strip()
    if not line_user:
        return False
    return usernames_match(line_user, allowed_usernames)


def accumulate_day_signals_for_account(
    day_text: Optional[str],
    allowed_usernames: List[str],
    email: str,
    account_identifier: str,
) -> Tuple[bool, bool]:
    """OR de líneas del día que coinciden cliente + cuenta."""
    txt = str(day_text or '')
    show_green_any = False
    show_red_any = False
    for line in txt.split('\n'):
        dual = parse_admin_license_line_to_split_parts(line)
        if not line_visible_for_assignee_account(dual, allowed_usernames, email, account_identifier):
            continue
        g, r = dual_row_green_red(dual)
        if g:
            show_green_any = True
        if r:
            show_red_any = True
    return show_green_any, show_red_any


# Etiquetas en español (alineadas a licencias.js / desplegables admin)
_GOOD_KEY_TO_LABEL: Dict[str, str] = {}
for _raw, _es in (
    ('ok', 'Buena y revisada'),
    ('renovar 1 mes mas', 'Renovar 1 mes más'),
    ('dejar mes a mes', 'Dejar mes a mes'),
    ('no renovar', 'No renovar'),
    ('garantia', 'Garantía (repuesto)'),
    ('reemplazar', 'Reemplazar'),
    ('terminado', 'Terminado'),
):
    _GOOD_KEY_TO_LABEL[normalize_status_key(_raw)] = _es

_BAD_KEY_TO_LABEL: Dict[str, str] = {}
for _raw, _es in (
    ('caida o suspendida', 'Caída o suspendida'),
    ('no reproduce', 'No reproduce'),
    ('error de contraseña', 'Error de contraseña'),
    ('otro', 'Otro'),
    ('caida', 'Caída o suspendida'),
    ('suspendida', 'Caída o suspendida'),
    ('repetida', 'Repetida'),
):
    _BAD_KEY_TO_LABEL[normalize_status_key(_raw)] = _es


def _spanish_good_label(status_good: str) -> str:
    s = str(status_good or '').strip()
    if not s:
        return ''
    canon = _canonical_good_from_stored(s) or s
    nk = normalize_status_key(canon)
    return _GOOD_KEY_TO_LABEL.get(nk, canon)


def _spanish_bad_label(sel: str, otro_detail: str) -> str:
    s = str(sel or '').strip()
    if not s:
        return ''
    nk = normalize_status_key(s)
    if nk == 'otro':
        od = str(otro_detail or '').strip()
        od = re.sub(r'^otro-?', '', od, flags=re.I).strip()
        return f'Otro: {od}' if od else 'Otro'
    canon = _canonical_bad_from_stored(s) or s
    nk2 = normalize_status_key(canon)
    return _BAD_KEY_TO_LABEL.get(nk2, canon)


def username_linked_explicitly_to_viewer(line_user: str, allowed_names: List[str]) -> bool:
    """
    La columna cliente de una línea del bloc día coincide exactamente con un nombre permitido
    (principal o subusuario), sin usar el comodín histórico «anonimo», que solo aplica cuando
    ya cruzamos credencial con una cuenta inventario.
    """
    lu = normalize_status_key(str(line_user or '').strip())
    if not lu or lu == 'anonimo':
        return False
    for n in allowed_names:
        if normalize_status_key(n) == lu:
            return True
    return False


def matched_rows_for_username_only_day(
    day_text: Optional[str],
    allowed_usernames: List[str],
    calendar_day: int,
) -> List[Dict[str, Any]]:
    """
    Para licencias cargadas sólo en «Días» con el nombre del cliente (venta manual, sin cuenta
    asignada por la tienda): mismas etiquetas sólo lectura que matched_rows_for_account_day.
    """
    out: List[Dict[str, Any]] = []
    raw_lines = str(day_text or '').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    for phys_idx, line in enumerate(raw_lines):
        stripped = line.strip()
        if not stripped:
            continue
        dual = parse_admin_license_line_to_split_parts(line)
        if not username_linked_explicitly_to_viewer(str(dual.get('user') or ''), allowed_usernames):
            continue
        sg = str(dual.get('statusGood') or '').strip()
        sb_sel = str(dual.get('statusBad') or '').strip()
        od = str(dual.get('otroDetail') or '').strip()
        eff = effective_bad_for_tier(sb_sel, od if sb_sel else '')
        tier_bad = admin_license_status_tier_from_stored(eff)

        gv = _spanish_good_label(sg) if sg else ''
        bv = ''
        if sb_sel or od:
            bv = _spanish_bad_label(sb_sel, od)

        lt_good = 'good' if sg else 'neutral'
        lt_bad = 'bad' if tier_bad == 'bad' else 'neutral'
        canon_g = (_canonical_good_from_stored(sg) or sg).strip() if sg else ''
        is_ok = normalize_status_key(canon_g) == 'ok'
        green_select = resolve_portal_green_select_value(dual, stripped)
        prev_restore = green_select if is_ok else ''
        prev_bad_restore = _prev_bad_restore_from_dual(dual) if is_ok else ''

        out.append(
            {
                'cred': str(dual.get('cred') or ''),
                'user': str(dual.get('user') or ''),
                'vinculo_dia': int(calendar_day),
                'label_good': gv,
                'label_bad': bv,
                'tier_good': lt_good,
                'tier_bad': lt_bad,
                'status_good': canon_g,
                'status_bad': sb_sel,
                'otro_detail': od,
                'prev_good_restore': prev_restore,
                'prev_bad_restore': prev_bad_restore,
                'green_select_value': green_select,
                'buena_revisada_readonly': is_ok,
                'phys_line_index': int(phys_idx),
                'row_ordinal': len(out),
            }
        )
    return out


def matched_rows_for_account_day(
    day_text: Optional[str],
    allowed_usernames: List[str],
    email: str,
    account_identifier: str,
    calendar_day: int,
    license_id: Optional[int] = None,
    consumed_lines: Optional[set] = None,
) -> List[Dict[str, Any]]:
    """
    Líneas del bloc día que corresponden a este cliente/cuenta, listas para mostrar sólo lectura.
    calendar_day: día del calendario (1–31) de esta sección «Día N», para mostrar el vínculo usuario–día en la UI.
    """
    out: List[Dict[str, Any]] = []
    raw_lines = str(day_text or '').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    for phys_idx, line in enumerate(raw_lines):
        if consumed_lines is not None and license_id is not None:
            if (license_id, calendar_day, phys_idx) in consumed_lines:
                continue
        stripped = line.strip()
        if not stripped:
            continue
        dual = parse_admin_license_line_to_split_parts(line)
        if not line_visible_for_assignee_account(dual, allowed_usernames, email, account_identifier):
            continue
        if consumed_lines is not None and license_id is not None:
            consumed_lines.add((license_id, calendar_day, phys_idx))
        sg = str(dual.get('statusGood') or '').strip()
        sb_sel = str(dual.get('statusBad') or '').strip()
        od = str(dual.get('otroDetail') or '').strip()
        eff = effective_bad_for_tier(sb_sel, od if sb_sel else '')
        tier_bad = admin_license_status_tier_from_stored(eff)

        gv = _spanish_good_label(sg) if sg else ''
        bv = ''
        if sb_sel or od:
            bv = _spanish_bad_label(sb_sel, od)

        lt_good = 'good' if sg else 'neutral'
        lt_bad = 'bad' if tier_bad == 'bad' else 'neutral'
        canon_g = (_canonical_good_from_stored(sg) or sg).strip() if sg else ''
        is_ok = normalize_status_key(canon_g) == 'ok'
        green_select = resolve_portal_green_select_value(dual, stripped)
        prev_restore = green_select if is_ok else ''
        prev_bad_restore = _prev_bad_restore_from_dual(dual) if is_ok else ''

        out.append(
            {
                'cred': str(dual.get('cred') or ''),
                'user': str(dual.get('user') or ''),
                'vinculo_dia': int(calendar_day),
                'label_good': gv,
                'label_bad': bv,
                'tier_good': lt_good,
                'tier_bad': lt_bad,
                'status_good': canon_g,
                'status_bad': sb_sel,
                'otro_detail': od,
                'prev_good_restore': prev_restore,
                'prev_bad_restore': prev_bad_restore,
                'green_select_value': green_select,
                'buena_revisada_readonly': is_ok,
                'phys_line_index': int(phys_idx),
                'row_ordinal': len(out),
            }
        )
    return out
