# app/utils/totp_config_serialize.py
"""Serialización segura de configs TOTP (listado sin secreto completo)."""

from __future__ import annotations


def mask_totp_secret(secret: str | None) -> str:
    s = (secret or "").strip()
    if not s:
        return ""
    if len(s) <= 8:
        return "••••••••"
    return f"{s[:4]}••••••••{s[-4:]}"


def serialize_twofa_config(config, *, include_secret: bool = False) -> dict:
    """
    Listado: sin secret_key (solo máscara + has_secret).
    Detalle/edición: include_secret=True incluye secret_key completo.
    """
    data = {
        "id": config.id,
        "emails": config.emails,
        "emails_list": config.get_emails_list() if hasattr(config, "get_emails_list") else [],
        "is_enabled": bool(getattr(config, "is_enabled", True)),
        "has_secret": bool(getattr(config, "secret_key", None)),
        "secret_key_masked": mask_totp_secret(getattr(config, "secret_key", None)),
        "created_at": config.created_at.isoformat() if getattr(config, "created_at", None) else None,
        "updated_at": config.updated_at.isoformat() if getattr(config, "updated_at", None) else None,
    }
    if include_secret:
        data["secret_key"] = getattr(config, "secret_key", None) or ""
    return data
