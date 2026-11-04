# app/admin/regex.py
import html
import re
import urllib.parse

from app.services.sender_list import any_sender_in_text

FLAGS = re.IGNORECASE | re.MULTILINE | re.DOTALL

_REDIRECT_PREFIX = '/admin/redirect_to?url='


def mail_body_for_regex(mail_dict):
    """Cuerpo para regex: HTML original sin reescritura /admin/redirect_to."""
    html = mail_dict.get('html_raw')
    if html is None:
        html = mail_dict.get('html', '')
    return (mail_dict.get('text', '') or '') + (html or '')


def unwrap_admin_redirect_url(value):
    """Quita envoltorio /admin/redirect_to?url= si quedó en una coincidencia."""
    if value is None:
        return value
    if not isinstance(value, str):
        return value
    s = value.strip()
    if not s:
        return s
    idx = s.find(_REDIRECT_PREFIX)
    if idx >= 0:
        encoded = s[idx + len(_REDIRECT_PREFIX):]
        return urllib.parse.unquote(encoded.split('"', 1)[0].split("'", 1)[0])
    return s


def _normalize_regex_match(match):
    if isinstance(match, tuple):
        parts = []
        for part in match:
            if isinstance(part, str):
                cleaned = unwrap_admin_redirect_url(part)
                if cleaned:
                    parts.append(cleaned)
            elif part:
                parts.append(str(part))
        return html.unescape(''.join(parts))
    if isinstance(match, str):
        return html.unescape(unwrap_admin_redirect_url(match))
    return match


def passes_any_regex(mail_dict, regexes):
    """
    Determina si el mail_dict hace match con
    alguna regex habilitada (y con el sender si corresponde).
    """
    body_raw = mail_body_for_regex(mail_dict)
    sender_lower = mail_dict.get('from', '').lower()

    for r in regexes:
        if not r.enabled:
            continue
        if not any_sender_in_text(r.sender, sender_lower):
            continue

        try:
            found = re.findall(r.pattern, body_raw, FLAGS)
            if found:
                return True
        except re.error:
            pass
    return False


def netflix_link_action_label(regex_row):
    """Botón rojo de enlace para los regex indicados. None si no aplica."""
    description = re.sub(
        r'\s+',
        ' ',
        str(getattr(regex_row, 'description', '') or ''),
    ).casefold()
    if 'restablecimiento de contraseña' in description:
        return 'Restablece tu contraseña'
    description_plain = (
        description
        .replace('á', 'a')
        .replace('é', 'e')
        .replace('í', 'i')
        .replace('ó', 'o')
        .replace('ú', 'u')
    )
    if 'iniciar sesion vix' in description_plain:
        return 'Aprobar inicio de sesión'
    if 'confirma tu nuevo inicio de sesion en crunchyroll' in description_plain:
        return 'Aprobar inicio de sesión'
    if 'ingresar con link ha spotify' in description_plain:
        return 'Aprobar inicio de sesión'
    sender = str(getattr(regex_row, 'sender', '') or '').lower()
    pattern = str(getattr(regex_row, 'pattern', '') or '')
    if 'info@account.netflix.com' not in sender:
        return None
    compact = re.sub(r'\s+', '', pattern).lower()
    approve = re.sub(
        r'\s+',
        '',
        r'(?i)(?:aprobar|approve)\s*\[\s*(https?://[^\]\s]+)\]',
    ).lower()
    if compact == approve:
        return 'Aprobar inicio de sesión'
    if 'update-primary-location' in compact and 'operation=update' in compact:
        return 'Obtener codigo hogar'
    if 'travel/verify' in compact or 'travel\\/verify' in compact:
        return 'Obtener codigo viaje'
    return None


def is_netflix_approve_access_regex(regex_row) -> bool:
    """Solo el regex de aprobar acceso: info@account.netflix.com y el patrón Aprobar [url]."""
    sender = str(getattr(regex_row, 'sender', '') or '').lower()
    pattern = str(getattr(regex_row, 'pattern', '') or '')
    if 'info@account.netflix.com' not in sender:
        return False
    compact = re.sub(r'\s+', '', pattern).lower()
    approve = re.sub(
        r'\s+',
        '',
        r'(?i)(?:aprobar|approve)\s*\[\s*(https?://[^\]\s]+)\]',
    ).lower()
    return compact == approve


def link_action_rank(label):
    """Viaje y hogar ganan. Restablecimiento de contraseña queda de último si hay otro enlace."""
    text = re.sub(r'\s+', ' ', str(label or '')).casefold()
    plain = (
        text
        .replace('á', 'a')
        .replace('é', 'e')
        .replace('í', 'i')
        .replace('ó', 'o')
        .replace('ú', 'u')
    )
    if 'codigo viaje' in plain or ('viaje' in plain and 'netflix' in plain):
        return 0
    if 'codigo hogar' in plain or ('hogar' in plain and 'netflix' in plain):
        return 1
    if 'restablece tu contraseña' in text or 'restablecimiento de contraseña' in text:
        return 80
    return 40


def extract_regex(mail_dict, regexes):
    """
    Retorna un dict {regex_id: [coincidencias, ...], ...}
    con todos los matches de cada regex.
    """
    results = {}
    body_raw = mail_body_for_regex(mail_dict)
    sender_lower = mail_dict.get('from', '').lower()

    for r in regexes:
        if not r.enabled:
            continue
        if not any_sender_in_text(r.sender, sender_lower):
            continue

        try:
            found = re.findall(r.pattern, body_raw, FLAGS)
            if found:
                values = []
                for item in found:
                    value = _normalize_regex_match(item)
                    if value and value not in values:
                        values.append(value)
                if values:
                    results[r.id] = values
        except re.error:
            pass

    return results
