"""
Dominio del proyecto (misma fuente que las apps móviles).

Todo sale de DOMINIO.txt (URL + opcionales). No hay marca hardcodeada aquí.

Prioridad de lectura:
  1) DOMINIO.txt en la raíz del repo
  2) mobile/DOMINIO.txt
  3) mobile-android-native/DOMINIO.txt

Formato de DOMINIO.txt:
  - Una línea con la URL pública (obligatoria)
    https://ejemplo.com → package com.ejemplo.app
  - Opcionales (clave=valor):
      appName=Mi Tienda                  # nombre visible; si falta, usa el label del dominio
      applicationId=com.otro.app         # solo para forzar otro package
      appIdSuffix=mitienda               # solo si no hay URL usable
"""
from __future__ import annotations

import os
import re
from urllib.parse import urlparse

_ROOT = os.path.abspath(os.path.dirname(__file__))

_PACKAGE_RE = re.compile(
    r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$",
    re.I,
)


def dominio_txt_candidates():
    return (
        os.path.join(_ROOT, "DOMINIO.txt"),
        os.path.join(_ROOT, "mobile", "DOMINIO.txt"),
        os.path.join(_ROOT, "mobile-android-native", "DOMINIO.txt"),
    )


def _parse_dominio_file(path):
    """Lee URL + claves opcionales de un DOMINIO.txt."""
    url_raw = ""
    extras = {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                trimmed = line.strip()
                if not trimmed or trimmed.startswith("#"):
                    continue
                if "=" in trimmed and not trimmed.lower().startswith(("http://", "https://")):
                    key, _, val = trimmed.partition("=")
                    k = key.strip().lower().replace("-", "_")
                    v = val.strip()
                    if k and v:
                        extras[k] = v
                    continue
                if not url_raw:
                    url_raw = trimmed
    except OSError:
        return "", {}, None
    return url_raw, extras, path


def read_dominio_raw_line():
    """Compat: (primera URL, path) o ('', None)."""
    for path in dominio_txt_candidates():
        if not os.path.isfile(path):
            continue
        url_raw, _extras, src = _parse_dominio_file(path)
        if url_raw:
            return url_raw, src
    return "", None


def read_dominio_file():
    """(url_raw, extras_dict, source_path) del primer DOMINIO.txt usable."""
    for path in dominio_txt_candidates():
        if not os.path.isfile(path):
            continue
        url_raw, extras, src = _parse_dominio_file(path)
        if url_raw or extras:
            return url_raw, extras, src
    return "", {}, None


def normalize_site_url(raw):
    value = (raw or "").strip()
    if not value:
        return None
    if not re.match(r"^https?://", value, re.I):
        value = "https://" + value
    try:
        parsed = urlparse(value)
    except Exception:
        return None
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    host = parsed.hostname.lower()
    origin = f"{parsed.scheme}://{parsed.hostname}"
    if parsed.port and parsed.port not in (80, 443):
        origin = f"{origin}:{parsed.port}"
    return {
        "href": origin,
        "hostname": host,
        "hostname_no_www": host[4:] if host.startswith("www.") else host,
    }


def brand_suffix_from_hostname(hostname):
    """ejemplo.com → ejemplo | tienda.ejemplo.com → tienda"""
    h = (hostname or "").lower().strip()
    h = h[4:] if h.startswith("www.") else h
    if not h:
        return "app"
    if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", h) or ":" in h:
        return re.sub(r"[^a-z0-9]", "", h) or "app"
    multi = re.match(r"^(.*)\.(co|com|org|net|gov|ac|edu|gob)\.[a-z]{2}$", h, re.I)
    if multi and multi.group(1):
        base = multi.group(1).split(".")[0]
        return re.sub(r"[^a-z0-9]", "", base.lower()) or "app"
    label = h.split(".")[0]
    return re.sub(r"[^a-z0-9]", "", label.lower()) or "app"


def sanitize_app_id_suffix(raw):
    s = re.sub(r"[^a-z0-9]", "", (raw or "").lower())
    return s or "app"


def sanitize_application_id(raw):
    """Normaliza package Android (minúsculas, solo [a-z0-9_.])."""
    pkg = re.sub(r"[^a-zA-Z0-9_.]", "", (raw or "").strip()).lower()
    if not pkg or not _PACKAGE_RE.match(pkg):
        return ""
    return pkg


def default_application_id(suffix):
    return f"com.{sanitize_app_id_suffix(suffix)}.app"


def load_site_branding():
    """
    Devuelve dict con:
      site_url, hostname, hostname_no_www, brand_suffix, app_name,
      application_id, cors_origins, android_app_package, source_path
    o None si no hay DOMINIO.txt usable.
    """
    raw, extras, source = read_dominio_file()
    info = normalize_site_url(raw)
    if not info:
        return None

    suffix_override = sanitize_app_id_suffix(extras.get("appidsuffix") or extras.get("app_id_suffix") or "")
    suffix = suffix_override if extras.get("appidsuffix") or extras.get("app_id_suffix") else brand_suffix_from_hostname(
        info["hostname"]
    )

    app_name = (extras.get("appname") or extras.get("app_name") or "").strip()
    if not app_name:
        app_name = suffix

    # Por defecto: com.<label-del-dominio>.app (desde la URL de DOMINIO.txt).
    # applicationId= en DOMINIO.txt solo si hace falta forzar otro package.
    explicit_pkg = sanitize_application_id(
        extras.get("applicationid")
        or extras.get("application_id")
        or extras.get("package")
        or extras.get("android_package")
        or ""
    )
    application_id = explicit_pkg or default_application_id(suffix)

    host = info["hostname_no_www"]
    scheme = urlparse(info["href"]).scheme or "https"
    primary = f"{scheme}://{host}"
    www = f"{scheme}://www.{host}"
    origins = []
    for o in (info["href"], primary, www):
        if o and o not in origins:
            origins.append(o)

    # Package principal (desde dominio) + legado Capacitor si aún se usa.
    packages = [application_id]
    legacy = "com.imap.storeclient"
    if legacy not in packages:
        packages.append(legacy)

    return {
        "site_url": info["href"],
        "hostname": info["hostname"],
        "hostname_no_www": host,
        "brand_suffix": suffix,
        "app_name": app_name,
        "application_id": application_id,
        "cors_origins": ",".join(origins),
        "android_app_package": ",".join(packages),
        "source_path": source,
    }
