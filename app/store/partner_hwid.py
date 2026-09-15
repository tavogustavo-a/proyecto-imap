"""Apps de escritorio autorizadas a entrar por dispositivo en vez de por IP.

Solo las apps de esta lista pueden firmar el identificador. El administrador
pega el hash en «IPs permitidas» vinculado al usuario dueño.
"""
from __future__ import annotations

import hmac
import hashlib
import json
import re

from flask import request

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


def _secret_for_app(app_id: str):
    if not app_id:
        return None
    apps = _app_secrets()
    if app_id in apps:
        return apps[app_id]
    lower = app_id.lower()
    for key, secret in apps.items():
        if key.lower() == lower:
            return secret
    return None


def expected_hwid_proof(app_id: str, hwid: str, secret: str) -> str:
    msg = f"{app_id}|{hwid}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _json_body():
    body = request.get_json(silent=True)
    if isinstance(body, dict):
        return body
    raw = request.get_data(cache=True, as_text=True) or ""
    raw = raw.strip()
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
        except ValueError:
            return None
        if isinstance(parsed, dict):
            return parsed
    return None


def _identity_candidates():
    """Pares (app_id, hwid, proof) desde JSON, query y cabeceras (JSON primero)."""
    out = []
    body = _json_body()
    if isinstance(body, dict):
        out.append(
            (
                str(body.get("app_id") or "").strip(),
                str(body.get("hwid") or "").strip(),
                str(body.get("hwid_proof") or "").strip(),
            )
        )
    args = request.args
    out.append(
        (
            str(args.get("app_id") or "").strip(),
            str(args.get("hwid") or "").strip(),
            str(args.get("hwid_proof") or "").strip(),
        )
    )
    out.append(
        (
            (request.headers.get("X-App-Id") or request.headers.get("X-App-ID") or "").strip(),
            (request.headers.get("X-HWID") or request.headers.get("X-Hwid") or "").strip(),
            (request.headers.get("X-HWID-Proof") or request.headers.get("X-Hwid-Proof") or "").strip(),
        )
    )
    return out


def _proof_ok(app_id: str, hwid: str, proof: str, secret: str) -> bool:
    proof_n = (proof or "").strip().lower()
    if not proof_n:
        return False
    variants = [
        expected_hwid_proof(app_id, hwid, secret),
        expected_hwid_proof(app_id.lower(), hwid, secret),
        expected_hwid_proof(app_id, hwid.lower(), secret),
        expected_hwid_proof(app_id.lower(), hwid.lower(), secret),
    ]
    for expected in variants:
        if len(expected) != len(proof_n):
            continue
        try:
            if hmac.compare_digest(expected, proof_n):
                return True
        except (TypeError, ValueError):
            continue
    return False


def verified_hwid_from_request():
    """Identificador de PC en minúsculas si la app es conocida y la firma cuadra."""
    for app_id, hwid_raw, proof in _identity_candidates():
        hwid = normalize_hwid_token(hwid_raw)
        if not app_id or not hwid or not proof:
            continue
        secret = _secret_for_app(app_id)
        if not secret:
            continue
        if _proof_ok(app_id, hwid_raw.strip(), proof, secret) or _proof_ok(
            app_id, hwid, proof, secret
        ):
            return hwid
    return None
