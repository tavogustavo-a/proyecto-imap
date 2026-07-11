# -*- coding: utf-8 -*-
"""Normalización compartida de correos permitidos (manual + Licencias → AllowedEmail)."""

from __future__ import annotations

import re

# Misma forma que app.api.validate_email_format / EMAIL_REGEX
ALLOWED_EMAIL_REGEX = re.compile(
    r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'
)

# Extrae el primer correo válido dentro de una credencial (p. ej. "user@x.com:pass" o "user@x.com (1) clave")
ALLOWED_EMAIL_EXTRACT_RE = re.compile(
    r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}'
)


def normalize_allowed_email(raw) -> str | None:
    """
    Devuelve email en minúsculas listo para AllowedEmail, o None si no es válido.
    Acepta tokens con basura alrededor (extrae el primer match).
    """
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s or len(s) > 254:
        return None
    if ALLOWED_EMAIL_REGEX.match(s):
        return s
    m = ALLOWED_EMAIL_EXTRACT_RE.search(s)
    if not m:
        return None
    email = m.group(0).strip().lower()
    if not ALLOWED_EMAIL_REGEX.match(email):
        return None
    return email
