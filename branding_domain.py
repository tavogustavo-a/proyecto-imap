"""
Dominio del proyecto (misma fuente que las apps móviles).

Prioridad de lectura:
  1) DOMINIO.txt en la raíz del repo
  2) mobile/DOMINIO.txt
  3) mobile-android-native/DOMINIO.txt

Editá solo la URL (una línea sin #). El resto (CORS, package nativo, App Links)
se deriva solo — no hardcodear el dominio en .env.
"""
from __future__ import annotations

import os
import re
from urllib.parse import urlparse

_ROOT = os.path.abspath(os.path.dirname(__file__))


def dominio_txt_candidates():
    return (
        os.path.join(_ROOT, "DOMINIO.txt"),
        os.path.join(_ROOT, "mobile", "DOMINIO.txt"),
        os.path.join(_ROOT, "mobile-android-native", "DOMINIO.txt"),
    )


def read_dominio_raw_line():
    for path in dominio_txt_candidates():
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    trimmed = line.strip()
                    if not trimmed or trimmed.startswith("#"):
                        continue
                    return trimmed, path
        except OSError:
            continue
    return "", None


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
    """tupremiumm.com → tupremiumm | tienda.ejemplo.com → tienda"""
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
    # primer label del host (sin TLD)
    label = h.split(".")[0]
    return re.sub(r"[^a-z0-9]", "", label.lower()) or "app"


def load_site_branding():
    """
    Devuelve dict con:
      site_url, hostname, hostname_no_www, brand_suffix,
      cors_origins, android_app_package, source_path
    o None si no hay DOMINIO.txt usable.
    """
    raw, source = read_dominio_raw_line()
    info = normalize_site_url(raw)
    if not info:
        return None
    suffix = brand_suffix_from_hostname(info["hostname"])
    host = info["hostname_no_www"]
    scheme = urlparse(info["href"]).scheme or "https"
    primary = f"{scheme}://{host}"
    www = f"{scheme}://www.{host}"
    # Si el usuario puso www. en DOMINIO, primary ya incluye www; igual listamos ambos
    origins = []
    for o in (info["href"], primary, www):
        if o and o not in origins:
            origins.append(o)
    packages = [
        f"com.imap.nativestore.{suffix}",
        "com.imap.storeclient",
    ]
    return {
        "site_url": info["href"],
        "hostname": info["hostname"],
        "hostname_no_www": host,
        "brand_suffix": suffix,
        "cors_origins": ",".join(origins),
        "android_app_package": ",".join(packages),
        "source_path": source,
    }
