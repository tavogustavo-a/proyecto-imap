"""Apps de escritorio autorizadas a entrar por HWID en vez de por IP.

Solo las apps de esta lista pueden firmar un HWID. El administrador pega el
hash en «IPs permitidas» (el mismo campo) vinculado al usuario dueño.

Prueba HMAC: HMAC-SHA256(secreto, "{app_id}|{hwid}") en hex.
"""
from __future__ import annotations

import hmac
import hashlib
import re

from flask import request

# app_id -> código interno. Nuevos proyectos se añaden aquí.
HWID_APPS = {
    "cambios-plataformas": "CP10-HWID-9f3a7c2e1b84d056",
}

_HWID_RE = re.compile(r"^[0-9a-f]{64}$")


def is_hwid_token(raw) -> bool:
    s = str(raw or "").strip().lower()
    return bool(_HWID_RE.fullmatch(s))


def normalize_hwid_token(raw):
    s = str(raw or "").strip().lower()
    if _HWID_RE.fullmatch(s):
        return s
    return None


def _header_or_body(headers_keys, body_keys, body):
    for key in headers_keys:
        val = (request.headers.get(key) or "").strip()
        if val:
            return val
    if isinstance(body, dict):
        for key in body_keys:
            val = str(body.get(key) or "").strip()
            if val:
                return val
    return ""


def _app_secrets():
    apps = dict(HWID_APPS)
    extra = None
    try:
        from flask import current_app

        extra = current_app.config.get("PARTNER_HWID_APPS")
    except RuntimeError:
        extra = None
    if isinstance(extra, dict):
        for app_id, secret in extra.items():
            aid = str(app_id or "").strip()
            sec = str(secret or "").strip()
            if aid and sec:
                apps[aid] = sec
    return apps


def expected_hwid_proof(app_id: str, hwid: str, secret: str) -> str:
    msg = f"{app_id}|{hwid}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def verified_hwid_from_request():
    """HWID en minúsculas si app_id es conocida y la firma HMAC cuadra. Si no, None."""
    body = request.get_json(silent=True)
    app_id = _header_or_body(("X-App-Id", "X-App-ID"), ("app_id",), body)
    hwid = normalize_hwid_token(_header_or_body(("X-HWID", "X-Hwid"), ("hwid",), body))
    proof = _header_or_body(("X-HWID-Proof", "X-Hwid-Proof"), ("hwid_proof",), body).lower()
    if not app_id or not hwid or not proof:
        return None
    secret = _app_secrets().get(app_id)
    if not secret:
        return None
    expected = expected_hwid_proof(app_id, hwid, secret)
    if not hmac.compare_digest(expected, proof):
        return None
    return hwid
