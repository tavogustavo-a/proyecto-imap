# app/services/search_service.py

import logging
import os
import re
import requests
from datetime import datetime, timezone, timedelta
from email.utils import format_datetime, parsedate_to_datetime
from flask import current_app
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload
from urllib.parse import urlparse
from ipaddress import ip_address, AddressValueError

from app.models import (
    IMAPServer, IMAPServer2, ServiceModel, FilterModel, RegexModel, User,
    SecurityRule, TriggerLog, ReceivedEmail,
    service_regex, service_filter,
)
from app.imap.advanced_imap import search_in_all_servers
from app.admin.regex import passes_any_regex, extract_regex
from app.extensions import db
from app.helpers import safe_regex_search
from app.store.api import format_colombia_time

_buzon_search_log = logging.getLogger(__name__)


def _buzon_search_trace_enabled():
    """Logs de filas buzón usadas en búsqueda: export BUZON_SEARCH_TRACE=1"""
    return (os.environ.get("BUZON_SEARCH_TRACE") or "").strip().lower() in ("1", "true", "yes", "on")


# ===== SEGURIDAD: Funciones auxiliares =====
def is_internal_ip(ip_str):
    """Verifica si una IP es interna/localhost"""
    try:
        ip = ip_address(ip_str)
        return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved
    except (ValueError, AddressValueError):
        return False

def validate_external_url_ssrf(url):
    """Valida que una URL sea externa y no apunte a recursos internos (protección SSRF)"""
    if not url:
        return False
    
    try:
        parsed = urlparse(url)
        
        # Verificar esquema
        if parsed.scheme not in ('http', 'https'):
            return False
        
        # Verificar que no sea localhost
        hostname = parsed.hostname
        if not hostname:
            return False
        
        hostname_lower = hostname.lower()
        
        # Bloquear localhost y variantes
        blocked_hosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1']
        if hostname_lower in blocked_hosts:
            return False
        
        # Verificar que no sea IP interna
        if is_internal_ip(hostname):
            return False
        
        # Verificar que no sea dominio interno común
        internal_domains = ['.local', '.internal', '.lan', '.corp']
        if any(hostname_lower.endswith(d) for d in internal_domains):
            return False
        
        return True
    except Exception:
        return False

def validate_and_sanitize_external_response(data, project_name):
    """Valida y sanitiza la respuesta de un proyecto externo"""
    try:
        # Validar estructura esperada
        if not isinstance(data, dict):
            current_app.logger.error(f"[SECURITY] Respuesta inválida de proyecto '{project_name}': no es dict")
            return None
        
        results = data.get("results", [])
        if not isinstance(results, list):
            current_app.logger.error(f"[SECURITY] Respuesta inválida de proyecto '{project_name}': results no es list")
            return None
        
        if not results:
            return None
        
        # Validar que el primer resultado tenga estructura válida
        external_result = results[0]
        if not isinstance(external_result, dict):
            current_app.logger.error(f"[SECURITY] Resultado inválido de proyecto '{project_name}': no es dict")
            return None
        
        # Sanitizar: solo permitir campos esperados
        allowed_fields = ['subject', 'from', 'to', 'date', 'text', 'html',
                         'filter_matched', 'filter_code', 'regex_matches', 'message_id',
                         'internal_date', 'external_project_name', 'formatted_date']
        sanitized_result = {k: v for k, v in external_result.items() if k in allowed_fields}
        sanitized_result["external_project_name"] = project_name
        
        return sanitized_result
    except (ValueError, KeyError, TypeError) as e:
        current_app.logger.error(f"[SECURITY] Error procesando respuesta de proyecto '{project_name}': {e}")
        return None


def _friendly_linked_api_connect_error(exc, url_stripped):
    """Traduce errores de red de requests a un mensaje claro para el admin."""
    host = ""
    try:
        host = (urlparse(url_stripped).hostname or "").strip()
    except Exception:
        host = ""
    host_hint = f" ({host})" if host else ""
    text = str(exc or "").lower()
    name = exc.__class__.__name__ if exc is not None else ""

    if isinstance(exc, requests.Timeout) or "timed out" in text or "timeout" in text:
        return "El servidor no respondió a tiempo (más de 10s). Revisa que esté en línea."
    if isinstance(exc, requests.exceptions.SSLError) or "ssl" in text or "certificate" in text:
        return "Error de certificado SSL/HTTPS. Revisa que la URL use https correcto."
    if (
        isinstance(exc, requests.exceptions.ConnectionError)
        or name in ("ConnectionError", "ConnectTimeoutError", "NewConnectionError", "NameResolutionError")
        or "nameresolution" in text
        or "name or service not known" in text
        or "getaddrinfo failed" in text
        or "failed to resolve" in text
        or "nodename nor servname" in text
    ):
        if (
            "nameresolution" in text
            or "name or service not known" in text
            or "getaddrinfo failed" in text
            or "failed to resolve" in text
            or "nodename nor servname" in text
        ):
            return (
                f"No se encontró el dominio{host_hint}. "
                "Revisa la URL (ejemplo: https://tudominio.com/api/external/search)."
            )
        if "connection refused" in text or "actively refused" in text:
            return f"El servidor rechazó la conexión{host_hint}. ¿Está apagado o el puerto es incorrecto?"
        return (
            f"No se pudo conectar con el servidor{host_hint}. "
            "Revisa que la URL sea correcta y que el otro proyecto esté accesible."
        )
    if isinstance(exc, requests.exceptions.InvalidURL) or "invalid url" in text:
        return "La URL no es válida. Debe verse así: https://tudominio.com/api/external/search"
    if isinstance(exc, requests.exceptions.TooManyRedirects):
        return "Demasiadas redirecciones. Revisa la URL del endpoint."
    return "No se pudo conectar con el otro proyecto. Revisa la URL e inténtalo de nuevo."


def _suggested_external_search_url(url_stripped):
    """Si la URL no apunta al endpoint, sugiere la forma correcta."""
    try:
        p = urlparse((url_stripped or "").strip())
        if not p.scheme or not p.netloc:
            return "https://otroproyecto.com/api/external/search"
        path = (p.path or "").rstrip("/")
        if path.endswith("/api/external/search"):
            return None
        return f"{p.scheme}://{p.netloc}/api/external/search"
    except Exception:
        return "https://otroproyecto.com/api/external/search"


def _linked_api_response_looks_valid(data, response):
    """
    True solo si la respuesta parece el API /api/external/search de este proyecto.
    Evita marcar como OK páginas HTML (dominios en venta, parkings, etc.) que dan HTTP 200.
    """
    if not isinstance(data, dict):
        return False
    if "results" in data and isinstance(data.get("results"), list):
        return True
    # Errores JSON conocidos del endpoint (la ruta existe aunque falle auth/datos).
    err = data.get("error")
    if isinstance(err, str) and err.strip():
        ctype = ""
        try:
            ctype = str((response.headers or {}).get("Content-Type") or "").lower()
        except Exception:
            ctype = ""
        if "json" in ctype or data.get("results") is not None:
            return True
        known = (
            "invalid token",
            "missing token",
            "rate limit",
            "unauthorized",
            "disabled",
            "invalid email",
            "payload too large",
            "invalid request host",
            "service_id",
        )
        low = err.lower()
        if any(k in low for k in known):
            return True
    return False


def _friendly_linked_api_http_error(status, err_msg, url_stripped):
    """Mensajes claros según el código HTTP del remoto."""
    suggested = _suggested_external_search_url(url_stripped)
    path = ""
    try:
        path = (urlparse(url_stripped).path or "").strip() or "/"
    except Exception:
        path = "/"
    missing_endpoint = not path.rstrip("/").endswith("/api/external/search")
    tip = ""
    if suggested and missing_endpoint:
        tip = f" Prueba con: {suggested}"

    if status == 400:
        detail = f" ({err_msg})" if err_msg else ""
        return f"El remoto rechazó la petición{detail}. Revisa URL y token."
    if status == 401:
        return "La URL responde, pero el token no es válido. Copia de nuevo el token del otro proyecto."
    if status == 403:
        low = (err_msg or "").lower()
        if "disabled" in low:
            return "La URL/token llegan, pero el usuario remoto está deshabilitado."
        if "security" in low or "unauthorized" in low:
            return (
                "La URL/token llegan, pero el remoto rechazó la autorización "
                "(el usuario de origen debe coincidir con el del token o con el nombre del dominio)."
            )
        if "permission" in low or "permiso" in low or "correo" in low:
            return (
                "La URL/token llegan, pero el remoto no permitió esa consulta de prueba. "
                "Eso no siempre indica fallo: revisa permisos del usuario remoto."
            )
        return (
            "La URL/token llegan, pero el remoto rechazó la prueba"
            + (f" ({err_msg})." if err_msg else ".")
        )
    if status == 404:
        return (
            "No se encontró esa ruta en el otro proyecto."
            + (tip or " La URL debe terminar en /api/external/search")
        )
    if status == 405:
        return (
            "Esa dirección no acepta la prueba (método no permitido)."
            + (
                tip
                or " Debes usar la URL completa del API, no solo el dominio "
                "(…/api/external/search)."
            )
        )
    if status == 408:
        return "El remoto tardó demasiado en responder. Inténtalo de nuevo."
    if status == 413:
        return "El remoto rechazó la petición por tamaño. Revisa la URL del API."
    if status == 429:
        return "El otro proyecto está limitando peticiones. Espera un momento e inténtalo de nuevo."
    if status == 502:
        return "El otro proyecto no está disponible ahora (puerta de enlace / proxy). Inténtalo más tarde."
    if status == 503:
        return "El otro proyecto está en mantenimiento o sobrecargado. Inténtalo más tarde."
    if status == 504:
        return "El otro proyecto no respondió a tiempo (gateway). Inténtalo más tarde."
    if status >= 500:
        return f"El otro proyecto tuvo un error interno (código {status}). Revisa ese servidor."
    if status >= 400:
        detail = f": {err_msg}" if err_msg else ""
        return (
            f"El remoto respondió con error (código {status}){detail}."
            + (tip if missing_endpoint else "")
        )
    detail = f": {err_msg}" if err_msg else ""
    return f"Respuesta inesperada del remoto (código {status}){detail}."


def test_linked_project_api(url, token, *, origin_user=None, origin_domain=None, project_name=None):
    """
    Prueba URL + token de un proyecto vinculado (mismo endpoint que la búsqueda real).

    Returns:
        (ok: bool, message: str)
    """
    label = (project_name or "API vinculada").strip() or "API vinculada"
    url_stripped = (url or "").strip()
    token_stripped = (token or "").strip()
    if not url_stripped or not token_stripped:
        return False, f"«{label}»: faltan URL o token."
    if not url_stripped.startswith(("http://", "https://")):
        return False, f"«{label}»: la URL debe empezar por http:// o https://"
    parsed = urlparse(url_stripped)
    host = (parsed.hostname or "").strip()
    if not host or "." not in host:
        return False, (
            f"«{label}»: la URL no parece un dominio válido"
            + (f" («{host}»)." if host else ".")
            + " Usa algo como https://otroproyecto.com/api/external/search"
        )
    if not validate_external_url_ssrf(url_stripped):
        return False, (
            f"«{label}»: esa URL no está permitida "
            "(no se puede usar localhost ni redes internas)."
        )

    payload = {
        "token": token_stripped,
        "email_to_search": "linked-api-probe@example.com",
        "origin_user": (origin_user or "").strip() or "probe",
        "origin_domain": (origin_domain or "").strip() or "unknown",
    }
    try:
        response = requests.post(url_stripped, json=payload, timeout=10)
    except requests.RequestException as e:
        return False, f"«{label}»: {_friendly_linked_api_connect_error(e, url_stripped)}"

    status = response.status_code
    ctype = str((response.headers or {}).get("Content-Type") or "").lower()
    err_msg = ""
    data = None
    try:
        data = response.json()
        if isinstance(data, dict):
            err_msg = str(data.get("error") or data.get("message") or "").strip()
    except ValueError:
        data = None

    # Página web / parking (p. ej. tudominio.com) suele devolver HTML 200: no es el API.
    if data is None or not isinstance(data, dict):
        if "html" in ctype or (response.text or "").lstrip()[:15].lower().startswith(
            ("<!doctype", "<html")
        ):
            return False, (
                f"«{label}»: esa URL respondió con una página web, no con el API de códigos. "
                "Usa la URL real del otro proyecto terminada en /api/external/search "
                "(no un dominio de ejemplo ni una web genérica)."
            )
        return False, (
            f"«{label}»: la respuesta no es JSON del API. "
            "Revisa que la URL sea …/api/external/search del otro proyecto IMAP."
        )

    if status == 200:
        if isinstance(data.get("results"), list):
            return True, f"«{label}»: conexión correcta. URL y token válidos."
        if _linked_api_response_looks_valid(data, response):
            return True, f"«{label}»: conexión correcta. URL y token válidos."
        return False, (
            f"«{label}»: el servidor respondió 200, pero no parece el API de búsqueda. "
            "Revisa la URL (debe ser /api/external/search del otro proyecto)."
        )

    # 401/403 JSON del API real: la URL es correcta; falla token o autorización.
    if status in (401, 403) and _linked_api_response_looks_valid(data, response):
        msg = _friendly_linked_api_http_error(status, err_msg, url_stripped)
        return False, f"«{label}»: {msg}"

    if not _linked_api_response_looks_valid(data, response):
        return False, (
            f"«{label}»: la respuesta no parece el API de códigos (código {status}). "
            "Revisa la URL completa …/api/external/search."
        )

    msg = _friendly_linked_api_http_error(status, err_msg, url_stripped)
    return False, f"«{label}»: {msg}"


def _friendly_linked_licenses_api_http_error(status, err_msg="", url=""):
    """Igual que códigos, pero con tip de /api/external/licenses/search."""
    tip = (
        " Usa la URL completa del otro proyecto terminada en "
        "/api/external/licenses/search (no solo el dominio)."
    )
    path = (urlparse(url or "").path or "").rstrip("/")
    missing_endpoint = path in ("", "/")
    if status == 405:
        return (
            "Ese servidor no acepta POST en esa URL (error 405)."
            + (tip if missing_endpoint else " Revisa que la URL sea …/api/external/licenses/search.")
        )
    if status == 404:
        return (
            "No se encontró el endpoint del API de licencias (404)."
            + tip
        )
    if status in (401, 403):
        base = "Token inválido o no autorizado."
        if err_msg:
            return f"{base} ({err_msg})"
        return base
    if status >= 500:
        detail = f" Detalle: {err_msg}" if err_msg else ""
        return f"El servidor remoto falló (código {status}).{detail}"
    if err_msg:
        detail = f": {err_msg}"
        return (
            f"El remoto respondió con error (código {status}){detail}."
            + (tip if missing_endpoint else "")
        )
    detail = f": {err_msg}" if err_msg else ""
    return f"Respuesta inesperada del remoto (código {status}){detail}."


def test_linked_licenses_api(url, token, *, origin_user=None, origin_domain=None, project_name=None):
    """
    Prueba URL + token de un API de licencias vinculado.

    Misma mecánica que proyectos vinculados (códigos), pero espera
    /api/external/licenses/search y mensajes orientados a licencias.

    Returns:
        (ok: bool, message: str)
    """
    label = (project_name or "API de licencias").strip() or "API de licencias"
    url_stripped = (url or "").strip()
    token_stripped = (token or "").strip()
    if not url_stripped or not token_stripped:
        return False, f"«{label}»: faltan URL o token."
    if not url_stripped.startswith(("http://", "https://")):
        return False, f"«{label}»: la URL debe empezar por http:// o https://"
    parsed = urlparse(url_stripped)
    host = (parsed.hostname or "").strip()
    path = (parsed.path or "").rstrip("/")
    if not host or "." not in host:
        return False, (
            f"«{label}»: la URL no parece un dominio válido"
            + (f" («{host}»)." if host else ".")
            + " Usa algo como https://otroproyecto.com/api/external/licenses/search"
        )
    if not validate_external_url_ssrf(url_stripped):
        return False, (
            f"«{label}»: esa URL no está permitida "
            "(no se puede usar localhost ni redes internas)."
        )

    payload = {
        "token": token_stripped,
        "email_to_search": "linked-licenses-api-probe@example.com",
        "origin_user": (origin_user or "").strip() or "probe",
        "origin_domain": (origin_domain or "").strip() or "unknown",
        "scope": "licenses",
    }
    try:
        response = requests.post(url_stripped, json=payload, timeout=10)
    except requests.RequestException as e:
        connect_msg = _friendly_linked_api_connect_error(e, url_stripped).replace(
            "/api/external/search", "/api/external/licenses/search"
        )
        return False, f"«{label}»: {connect_msg}"

    status = response.status_code
    ctype = str((response.headers or {}).get("Content-Type") or "").lower()
    err_msg = ""
    data = None
    try:
        data = response.json()
        if isinstance(data, dict):
            err_msg = str(data.get("error") or data.get("message") or "").strip()
    except ValueError:
        data = None

    if data is None or not isinstance(data, dict):
        if "html" in ctype or (response.text or "").lstrip()[:15].lower().startswith(
            ("<!doctype", "<html")
        ):
            return False, (
                f"«{label}»: esa URL respondió con una página web, no con el API de licencias. "
                "Usa la URL real del otro proyecto terminada en /api/external/licenses/search "
                "(no un dominio de ejemplo ni una web genérica)."
            )
        return False, (
            f"«{label}»: la respuesta no es JSON del API de licencias. "
            "Revisa que la URL sea …/api/external/licenses/search del otro proyecto IMAP."
        )

    path_is_licenses = path.endswith("/api/external/licenses/search")
    scope_is_licenses = str(data.get("scope") or "").strip().lower() == "licenses"
    looks_like_codes_only = (
        path.endswith("/api/external/search")
        and not path_is_licenses
        and not scope_is_licenses
    )

    if status == 200:
        if looks_like_codes_only and isinstance(data.get("results"), list):
            return False, (
                f"«{label}»: esa URL es el API de códigos, no el de licencias. "
                "Usa …/api/external/licenses/search (botón Mi API de licencias del otro proyecto)."
            )
        if isinstance(data.get("results"), list) or (
            _linked_api_response_looks_valid(data, response)
            and (path_is_licenses or scope_is_licenses)
        ):
            return True, f"«{label}»: conexión correcta. URL y token de licencias válidos."
        return False, (
            f"«{label}»: el servidor respondió 200, pero no parece el API de licencias. "
            "Revisa la URL (debe ser /api/external/licenses/search del otro proyecto)."
        )

    if status in (401, 403) and _linked_api_response_looks_valid(data, response):
        msg = _friendly_linked_licenses_api_http_error(status, err_msg, url_stripped)
        return False, f"«{label}»: {msg}"

    if not _linked_api_response_looks_valid(data, response):
        return False, (
            f"«{label}»: la respuesta no parece el API de licencias (código {status}). "
            "Revisa la URL completa …/api/external/licenses/search."
        )

    msg = _friendly_linked_licenses_api_http_error(status, err_msg, url_stripped)
    return False, f"«{label}»: {msg}"


def search_linked_projects_only(to_address, user, service_id=None):
    """
    Solo consulta las URLs configuradas en proyectos vinculados (otro servidor/proyecto).

    Sirve cuando el correo no está en AllowedEmail de este proyecto pero sí puede existir
    en el otro proyecto (misma cadena de confianza vía token en LinkedProject).

    service_id: si se indica, el proyecto remoto debe acotar regex/filtros a ese servicio
    (mismo botón/categoría), no a todos los globales). Se envía también service_name
    (nombre del ServiceModel en origen) para que el otro proyecto resuelva el id local
    aunque el número no coincida entre bases de datos.
    """
    if not user or not getattr(user, "enabled", False):
        return None
    linked_projects = user.linked_projects.filter_by(enabled=True).all()
    if not linked_projects:
        return None
    from flask import request as flask_request

    try:
        origin_domain = flask_request.url_root.rstrip("/") if flask_request else "unknown"
    except RuntimeError:
        origin_domain = "unknown"

    for project in linked_projects:
        try:
            if not project.url or not project.url.strip():
                current_app.logger.warning(
                    f"Proyecto vinculado '{project.name}' tiene URL vacía, saltando..."
                )
                continue
            url_stripped = project.url.strip()
            if not url_stripped.startswith(("http://", "https://")):
                current_app.logger.warning(
                    f"Proyecto vinculado '{project.name}' tiene URL inválida (sin esquema): "
                    f"'{url_stripped}', saltando..."
                )
                continue
            if not validate_external_url_ssrf(url_stripped):
                current_app.logger.warning(
                    f"[SSRF-BLOCKED] Proyecto '{project.name}' tiene URL que apunta a "
                    f"recursos internos: {url_stripped}"
                )
                continue
            try:
                here = (flask_request.url_root or "").rstrip("/").lower()
            except RuntimeError:
                here = ""
            if here and url_stripped.rstrip("/").lower().startswith(here):
                continue
            payload = {
                "token": project.token,
                "email_to_search": to_address,
                "origin_user": user.username,
                "origin_domain": origin_domain,
            }
            if service_id is not None:
                payload["service_id"] = service_id
                try:
                    svc = ServiceModel.query.get(int(service_id))
                    if svc:
                        if getattr(svc, "name", None):
                            payload["service_name"] = (svc.name or "").strip()
                        mk = getattr(svc, "match_key", None)
                        if mk and str(mk).strip():
                            payload["service_match_key"] = str(mk).strip()
                except (TypeError, ValueError):
                    pass
            response = requests.post(url_stripped, json=payload, timeout=10)
            if response.status_code == 200:
                try:
                    data = response.json()
                    external_result = validate_and_sanitize_external_response(
                        data, project.name
                    )
                    if external_result:
                        return external_result
                except ValueError as e:
                    current_app.logger.error(
                        f"[SECURITY] Error parseando JSON de proyecto '{project.name}': {e}"
                    )
        except Exception as e:
            current_app.logger.error(
                f"Error buscando en proyecto vinculado '{project.name}': {e}"
            )
    return None


# Constantes internas para validación del sistema
_SEARCH_MODULE_ID = 0x7C8D
_SEARCH_MODULE_VER = 0x9E0F


def _filters_and_regexes_for_service_id(service_id):
    """
    Filtros y regex habilitados vinculados solo a este servicio vía tablas
    service_filter / service_regex. Consulta explícita (no solo service.filters/.regexes)
    para que cada categoría no mezcle reglas de otra por caché de sesión u ORM.
    """
    sid = int(service_id)
    service_filters = (
        FilterModel.query.join(
            service_filter,
            service_filter.c.filter_id == FilterModel.id,
        )
        .filter(
            service_filter.c.service_id == sid,
            FilterModel.enabled.is_(True),
        )
        .all()
    )
    service_regexes = (
        RegexModel.query.join(
            service_regex,
            service_regex.c.regex_id == RegexModel.id,
        )
        .filter(
            service_regex.c.service_id == sid,
            RegexModel.enabled.is_(True),
        )
        .all()
    )
    return service_filters, service_regexes


def _buzon_emails_as_mail_dicts(to_address, limit_days=2, max_rows=None):
    """
    Correos guardados en BD (buzón SMTP / Gestionar buzón), To coincidente, no en papelera.
    Mismo shape que los dicts de IMAP para _process_mails.
    Por defecto usa la misma ventana que el primer pase IMAP (limit_days=2) y devuelve
    todos los correos en ese rango (sin cap fijo de 100). max_rows solo acota si se define.
    limit_days=None: sin filtro por fecha.
    """
    to_norm = (to_address or "").strip().lower()
    if not to_norm or "@" not in to_norm:
        return []
    try:
        # Coincidir por RCPT (to_email) o por destinatario mostrable (original_to_email),
        # p. ej. usuario busca user+tag@gmail.com pero el sobre SMTP es mensaje@dominio-reenvío.
        q = ReceivedEmail.query.filter(
            ReceivedEmail.deleted.is_(False),
            or_(
                func.lower(func.trim(ReceivedEmail.to_email)) == to_norm,
                func.lower(func.trim(ReceivedEmail.original_to_email)) == to_norm,
            ),
        )
        if limit_days is not None:
            cutoff = datetime.now(timezone.utc) - timedelta(days=int(limit_days))
            q = q.filter(
                or_(
                    ReceivedEmail.received_at >= cutoff,
                    ReceivedEmail.received_at.is_(None),
                )
            )
        q = q.order_by(ReceivedEmail.received_at.desc())
        if max_rows is not None:
            q = q.limit(int(max_rows))
        rows = q.all()
    except Exception:
        _buzon_search_log.exception("[buzón búsqueda] error consultando received_emails para to=%s", to_norm)
        return []

    if _buzon_search_trace_enabled():
        _buzon_search_log.info(
            "[buzón búsqueda] to=%s filas_en_ventana=%s limit_days=%s max_rows=%s",
            to_norm,
            len(rows),
            limit_days,
            max_rows,
        )

    out = []
    for email in rows:
        rdt = email.received_at
        if rdt is None:
            rdt = datetime.now(timezone.utc)
        elif rdt.tzinfo is None:
            rdt = rdt.replace(tzinfo=timezone.utc)
        out.append(
            {
                "from": email.from_email or "",
                "to": (email.original_to_email or email.to_email or ""),
                "subject": email.subject or "",
                "text": email.content_text or "",
                "html": email.content_html or "",
                "date": format_datetime(rdt),
                "message_id": email.message_id or f"buzon-db-{email.id}",
                "internal_date": rdt,
            }
        )
    return out


def search_and_apply_filters(to_address, service_id=None, user=None, origin_domain=None, public_access=False):
    """
    Realiza la búsqueda de correos en servidores IMAP habilitados.
    
    Solo el ADMIN_USER oficial tiene acceso total.
    Todos los demás usuarios (incluyendo los que cumplen las 3 condiciones de autorización externa)
    son tratados como usuarios normales con todas sus restricciones.
    
    Cuando public_access=True y user=None (acceso público sin login), se usan todos los filtros/regex
    habilitados globalmente, y solo servidores IMAP principales (no IMAP2).
    """

    # 1) Obtener filtros y regex base
    # Si service_id es None, obtener todos los filtros y regex habilitados globalmente
    # (para búsquedas externas o búsquedas generales)
    if service_id:
        service = ServiceModel.query.get(service_id)
        if not service or not service.enabled:
            return None
        service_filters, service_regexes = _filters_and_regexes_for_service_id(service_id)
    else:
        # Sin service_id: obtener todos los filtros y regex habilitados globalmente
        service_filters = FilterModel.query.filter(FilterModel.enabled == True).all()
        service_regexes = RegexModel.query.filter(RegexModel.enabled == True).all()

    if not service_filters and not service_regexes:
        return None

    # 2) Determinar si el usuario es el ADMIN_USER oficial (único con acceso total)
    # O si es acceso público sin login (public_access=True, user=None)
    is_admin_official = False
    if user and user.enabled:
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        # Solo el ADMIN_USER oficial tiene acceso total
        if user.username == admin_username and user.parent_id is None:
            is_admin_official = True
    elif public_access and user is None:
        # Acceso público: usar todos los filtros/regex habilitados globalmente (como admin)
        is_admin_official = True

    # 3) Definir filters/regex finales
    # IMPORTANTE: TODOS los usuarios (incluido admin) deben respetar las reglas:
    # - Regex/filtros deben estar habilitados globalmente (enabled=True)
    # - Usuario debe tener permisos para ese regex/filtro
    # Esto asegura que incluso el admin respete las reglas del proyecto donde busca
    
    admin_username = current_app.config.get("ADMIN_USER", "admin")
    # Identificar si es sub-usuario
    is_subuser = (user.parent_id is not None) if user else False
    parent_user = None
    if is_subuser and user:
        parent_user = User.query.get(user.parent_id)
        # Cargar las relaciones default_... del padre si es sub-usuario
        if parent_user:
             # Forzar la carga si son lazy='dynamic' o por si acaso
             _ = parent_user.default_filters_for_subusers.all()
             _ = parent_user.default_regexes_for_subusers.all()

    # --- OBTENER IDs HABILITADOS GLOBALMENTE --- 
    # (Esta parte verifica el estado enabled del FilterModel/RegexModel global)
    # TODOS los usuarios (incluido admin) deben respetar que estén habilitados globalmente
    currently_globally_enabled_filter_ids = { 
        f.id for f in FilterModel.query.filter(FilterModel.enabled == True).all()
    }
    currently_globally_enabled_regex_ids = {
        r.id for r in RegexModel.query.filter(RegexModel.enabled == True).all()
    }
    # -------------------------------------------

    if is_admin_official:
        # Admin oficial: tiene acceso a TODOS los regex/filtros habilitados globalmente
        # pero aún debe respetar que estén habilitados (no puede usar deshabilitados)
        final_filters = [f for f in service_filters if f.id in currently_globally_enabled_filter_ids]
        final_regexes = [r for r in service_regexes if r.id in currently_globally_enabled_regex_ids]
    else:
        # Usuario normal o sub-usuario => aplicar intersecciones y restricciones
        # IDs permitidos directamente al usuario (padre o sub, ya sincronizado si es sub)
        allowed_filter_ids = {f.id for f in user.filters_allowed} if user else set()
        allowed_regex_ids = {r.id for r in user.regexes_allowed} if user else set()

        # --- OBTENER IDs configurados como DEFAULT por el PADRE (si es sub-usuario) ---
        subuser_default_filter_ids = set()
        subuser_default_regex_ids = set()
        if is_subuser and parent_user:
            subuser_default_filter_ids = {f.id for f in parent_user.default_filters_for_subusers}
            subuser_default_regex_ids = {r.id for r in parent_user.default_regexes_for_subusers}
        # --------------------------------------------------------------------------

        # --- CALCULAR IDs FINALES --- 
        final_filter_ids_to_use = set()
        if allowed_filter_ids: # Si el usuario tiene algún filtro permitido
            # 1. Intersectar permitidos del usuario con habilitados globalmente
            potentially_usable_filter_ids = allowed_filter_ids.intersection(currently_globally_enabled_filter_ids)
            
            # 2. Si es sub-usuario, intersectar ADEMÁS con los defaults del padre
            if is_subuser:
                final_filter_ids_to_use = potentially_usable_filter_ids.intersection(subuser_default_filter_ids)
            else: # Si es usuario principal, usar el resultado del paso 1
                final_filter_ids_to_use = potentially_usable_filter_ids
        
        final_regex_ids_to_use = set()
        if allowed_regex_ids:
             # 1. Intersectar permitidos del usuario con habilitados globalmente
            potentially_usable_regex_ids = allowed_regex_ids.intersection(currently_globally_enabled_regex_ids)

            # 2. Si es sub-usuario, intersectar ADEMÁS con los defaults del padre
            if is_subuser:
                final_regex_ids_to_use = potentially_usable_regex_ids.intersection(subuser_default_regex_ids)
            else: # Si es usuario principal, usar el resultado del paso 1
                 final_regex_ids_to_use = potentially_usable_regex_ids
        # --------------------------- 

        # Filtrar los service_filters/regexes usando los IDs finales calculados
        final_filters = [f for f in service_filters if f.id in final_filter_ids_to_use]
        final_regexes = [r for r in service_regexes if r.id in final_regex_ids_to_use]

    # --- INICIO: Logging para Depuración ---
    try:
        log_user_type = "Anonimo"
        if user:
            log_user_type = f"User ID {user.id} ({user.username})"
            if user.username == current_app.config.get("ADMIN_USER", "admin"):
                log_user_type += " [Admin]"
            elif user.parent_id:
                 log_user_type += f" [SubUsuario de {user.parent_id}]"
            else:
                 log_user_type += " [Usuario Principal]"

        # Obtener solo IDs y estado enabled para el log
        log_final_filters = [(f.id, f.enabled) for f in final_filters]
        log_final_regexes = [(r.id, r.enabled) for r in final_regexes]


    except Exception as log_err:
        pass
    # --- FIN: Logging para Depuración ---

    # 3b) Buzón local (BD): prioridad sobre IMAP (más rápido)
    buzon_mails = _buzon_emails_as_mail_dicts(to_address)
    found_mail = _process_mails(buzon_mails, final_filters, final_regexes, user, to_address)
    if found_mail:
        return found_mail

    # 4) Servidores IMAP solo si están activos (enabled=True; en admin suele mostrarse como OFF)
    servers = []
    
    # Obtener servidores IMAP normales (principal)
    imap_servers = IMAPServer.query.filter_by(enabled=True).all()
    servers.extend(imap_servers)
    
    # Solo incluir IMAP2 cuando NO es acceso público (plantilla principal usa solo IMAP)
    if not public_access:
        imap2_servers = IMAPServer2.query.filter_by(enabled=True).all()
        servers.extend(imap2_servers)

    if servers:
        # -- Primer intento: 2 días
        all_mails = search_in_all_servers(to_address, servers, limit_days=2)
        found_mail = _process_mails(all_mails, final_filters, final_regexes, user, to_address)
        if found_mail:
            return found_mail

    ext = search_linked_projects_only(to_address, user, service_id=service_id)
    if ext:
        return ext

    return None


def search_and_apply_filters2(to_address, service_id=None, user=None):
    """
    Versión de search_and_apply_filters que usa IMAPServer2 en lugar de IMAPServer.
    Realiza la búsqueda de correos en servidores IMAP2 habilitados,
    aplicando solo los filtros/regex habilitados en el servicio.
    """
    # 1) Verificar el service_id
    if not service_id:
        return None

    service = ServiceModel.query.get(service_id)
    if not service or not service.enabled:
        return None

    # 2) Filtros y Regex habilitados del servicio (tablas service_* explícitas)
    service_filters, service_regexes = _filters_and_regexes_for_service_id(service_id)

    if not service_filters and not service_regexes:
        return None

    # 3) Definir filters/regex finales, según si el user es admin, None, o normal
    final_filters = service_filters
    final_regexes = service_regexes

    if user and user.enabled:
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        is_subuser = (user.parent_id is not None)
        parent_user = None
        if is_subuser:
            parent_user = User.query.get(user.parent_id)
            if parent_user:
                 _ = parent_user.default_filters_for_subusers.all()
                 _ = parent_user.default_regexes_for_subusers.all()

        if user.username != admin_username:
            allowed_filter_ids = {f.id for f in user.filters_allowed}
            allowed_regex_ids = {r.id for r in user.regexes_allowed}

            currently_globally_enabled_filter_ids = { 
                f.id for f in FilterModel.query.filter(FilterModel.enabled == True).all()
            }
            currently_globally_enabled_regex_ids = {
                r.id for r in RegexModel.query.filter(RegexModel.enabled == True).all()
            }

            subuser_default_filter_ids = set()
            subuser_default_regex_ids = set()
            if is_subuser and parent_user:
                subuser_default_filter_ids = {f.id for f in parent_user.default_filters_for_subusers}
                subuser_default_regex_ids = {r.id for r in parent_user.default_regexes_for_subusers}

            final_filter_ids_to_use = set()
            if allowed_filter_ids:
                potentially_usable_filter_ids = allowed_filter_ids.intersection(currently_globally_enabled_filter_ids)
                if is_subuser:
                    final_filter_ids_to_use = potentially_usable_filter_ids.intersection(subuser_default_filter_ids)
                else:
                    final_filter_ids_to_use = potentially_usable_filter_ids
            
            final_regex_ids_to_use = set()
            if allowed_regex_ids:
                potentially_usable_regex_ids = allowed_regex_ids.intersection(currently_globally_enabled_regex_ids)
                if is_subuser:
                    final_regex_ids_to_use = potentially_usable_regex_ids.intersection(subuser_default_regex_ids)
                else:
                     final_regex_ids_to_use = potentially_usable_regex_ids

            final_filters = [f for f in service_filters if f.id in final_filter_ids_to_use]
            final_regexes = [r for r in service_regexes if r.id in final_regex_ids_to_use]

    # 3b) Buzón local (BD) antes de IMAP2
    buzon_mails = _buzon_emails_as_mail_dicts(to_address)
    found_mail = _process_mails(buzon_mails, final_filters, final_regexes, user, to_address)
    if found_mail:
        return found_mail

    # 4) Buscamos en servidores IMAP2 habilitados
    servers = IMAPServer2.query.filter_by(enabled=True).all()
    if servers:
        # -- Primer intento: 2 días
        all_mails = search_in_all_servers(to_address, servers, limit_days=2)
        found_mail = _process_mails(all_mails, final_filters, final_regexes, user, to_address)
        if found_mail:
            return found_mail

    ext = search_linked_projects_only(to_address, user)
    if ext:
        return ext

    return None


def search_imap2_server_dynamic(to_address, imap_server_id, user=None):
    """
    Busca correos usando un servidor IMAP2 específico y sus filtros/regex asociados.
    Similar a search_and_apply_filters2 pero usa solo el servidor IMAP2 especificado
    y sus filtros/regex asociados directamente (no a través de un servicio).
    """
    # 1) Verificar el imap_server_id
    if not imap_server_id:
        return None

    imap_server = IMAPServer2.query.get(imap_server_id)
    if not imap_server:
        return None

    # 2) Obtener filtros y regex asociados directamente al servidor IMAP2
    # IMPORTANTE: Solo obtener los que están habilitados globalmente
    # Los filtros/regex asociados al servidor están en imap_server.filters y imap_server.regexes
    server_filters = [f for f in imap_server.filters if f.enabled]
    server_regexes = [r for r in imap_server.regexes if r.enabled]

    if not server_filters and not server_regexes:
        return None

    # 3) Definir filters/regex finales según el usuario
    final_filters = server_filters
    final_regexes = server_regexes

    if user and user.enabled:
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        is_subuser = (user.parent_id is not None)
        parent_user = None
        if is_subuser:
            parent_user = User.query.get(user.parent_id)
            if parent_user:
                 _ = parent_user.default_filters_for_subusers.all()
                 _ = parent_user.default_regexes_for_subusers.all()

        if user.username != admin_username:
            allowed_filter_ids = {f.id for f in user.filters_allowed}
            allowed_regex_ids = {r.id for r in user.regexes_allowed}

            currently_globally_enabled_filter_ids = { 
                f.id for f in FilterModel.query.filter(FilterModel.enabled == True).all()
            }
            currently_globally_enabled_regex_ids = {
                r.id for r in RegexModel.query.filter(RegexModel.enabled == True).all()
            }

            subuser_default_filter_ids = set()
            subuser_default_regex_ids = set()
            if is_subuser and parent_user:
                subuser_default_filter_ids = {f.id for f in parent_user.default_filters_for_subusers}
                subuser_default_regex_ids = {r.id for r in parent_user.default_regexes_for_subusers}

            final_filter_ids_to_use = set()
            if allowed_filter_ids:
                potentially_usable_filter_ids = allowed_filter_ids.intersection(currently_globally_enabled_filter_ids)
                if is_subuser:
                    final_filter_ids_to_use = potentially_usable_filter_ids.intersection(subuser_default_filter_ids)
                else:
                    final_filter_ids_to_use = potentially_usable_filter_ids
            
            final_regex_ids_to_use = set()
            if allowed_regex_ids:
                potentially_usable_regex_ids = allowed_regex_ids.intersection(currently_globally_enabled_regex_ids)
                if is_subuser:
                    final_regex_ids_to_use = potentially_usable_regex_ids.intersection(subuser_default_regex_ids)
                else:
                     final_regex_ids_to_use = potentially_usable_regex_ids

            final_filters = [f for f in server_filters if f.id in final_filter_ids_to_use]
            final_regexes = [r for r in server_regexes if r.id in final_regex_ids_to_use]

    # 3b) Buzón local (BD) antes de IMAP / IMAP2 vinculados
    buzon_mails = _buzon_emails_as_mail_dicts(to_address)
    found_mail = _process_mails(buzon_mails, final_filters, final_regexes, user, to_address)
    if found_mail:
        return found_mail

    # 4) Buscar en este servidor IMAP2 específico Y en los servidores IMAP vinculados
    # IMPORTANTE: Cada servidor funciona independientemente según su estado enabled
    servers = []
    
    # Agregar el servidor principal IMAP2 solo si está habilitado
    if imap_server.enabled:
        servers.append(imap_server)
    
    # Agregar servidores IMAP vinculados que estén habilitados (independientemente del estado del principal)
    linked_imap_servers = imap_server.linked_imap_servers.filter_by(enabled=True).all()
    for linked_imap in linked_imap_servers:
        servers.append(linked_imap)

    if servers:
        # -- Primer intento: 2 días
        all_mails = search_in_all_servers(to_address, servers, limit_days=2)
        found_mail = _process_mails(all_mails, final_filters, final_regexes, user, to_address)
        if found_mail:
            return found_mail

    ext = search_linked_projects_only(to_address, user)
    if ext:
        return ext

    return None


def _mail_internal_date_utc(mail: dict) -> datetime:
    """Normaliza internal_date del correo a UTC para comparar recencia."""
    dt = mail.get("internal_date")
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _should_prefer_mail_over(current_best: dict, challenger: dict, *, challenger_has_filter: bool) -> bool:
    """
    True si challenger debe reemplazar current_best.
    Gana el más reciente; a igual fecha, filtro > regex.
    """
    best_dt = _mail_internal_date_utc(current_best)
    chall_dt = _mail_internal_date_utc(challenger)
    if chall_dt > best_dt:
        return True
    if chall_dt < best_dt:
        return False
    best_has_filter = bool(current_best.get("filter_matched"))
    return bool(challenger_has_filter) and not best_has_filter


def _process_mails(all_mails, filters, regexes, user_searching, searched_address):
    """
    Aplica filters y regex a correos ordenados por fecha (desc).
    Devuelve el match más reciente; si comparten fecha exacta, filtro > regex.
    """
    if not all_mails:
        return None

    all_mails.sort(key=lambda x: x.get("internal_date", datetime.min), reverse=True)

    try: 
        active_security_rules = SecurityRule.query.filter_by(enabled=True).all()
    except Exception as e:
        current_app.logger.error(f"Error al obtener SecurityRules: {e}")
        active_security_rules = []

    logs_to_commit = False
    best_mail = None

    for mail in all_mails:
        _format_date(mail)
        body_raw = mail.get("text", "") + (mail.get("html_raw") or mail.get("html", ""))
        sender_lower = mail.get("from", "").lower()

        matched_filter = get_first_filter_that_matches(mail, filters)
        if matched_filter:
            body_text_before = mail.get("text") or ""
            body_html_before = mail.get("html") or ""

            cut_after_str = (matched_filter.cut_after_html or "").strip() if matched_filter.cut_after_html else ""
            if cut_after_str:
                apply_cut_after_html(mail, cut_after_str)

            cut_before_str = (matched_filter.cut_before_html or "").strip() if matched_filter.cut_before_html else ""
            if cut_before_str:
                apply_cut_before_html(mail, cut_before_str)

            # Crunchyroll login: ocultar «THIS WAS NOT ME» y centrar «THIS WAS ME».
            if _is_crunchyroll_login_confirm_filter(matched_filter):
                _normalize_crunchyroll_login_action_buttons(mail)

            # Netflix: Aprobar, Obtener código, o actualizar Hogar.
            if (
                _is_netflix_approve_session_filter(matched_filter)
                or _looks_like_netflix_get_code_mail(mail)
                or _looks_like_netflix_hogar_mail(mail)
            ):
                _normalize_netflix_approve_session_content(mail)

            mail["filter_matched"] = True
            if _is_netflix_login_6_digits_filter(matched_filter):
                mail["filter_code"] = (
                    _extract_six_digit_code_from_mail(mail)
                    or _extract_six_digit_code_from_mail({
                        "text": body_text_before,
                        "html": body_html_before,
                    })
                )
            elif _is_universal_activation_filter(matched_filter):
                mail["filter_code"] = (
                    _extract_universal_activation_code(mail)
                    or _extract_universal_activation_code({
                        "text": body_text_before,
                        "html": body_html_before,
                    })
                )
                # Evitar el HTML del mail (tablas/imagen/blanco extra); el front usa filter_code.
                if mail.get("filter_code"):
                    mail["html"] = ""
                    mail["text"] = ""
            else:
                mail["filter_code"] = None
        else:
            mail["filter_matched"] = False
            mail["filter_code"] = None

        found_regex = False
        if not mail["filter_matched"] and regexes:
            if passes_any_regex(mail, regexes):
                found_regex = True
                mail["regex_matches"] = extract_regex(mail, regexes)
            else:
                mail["regex_matches"] = {}
        else:
            mail["regex_matches"] = {}

        if not mail["filter_matched"] and found_regex:
            mail["html"] = ""
            mail["text"] = ""

        has_match = mail["filter_matched"] or found_regex
        if not has_match:
            continue

        if best_mail is None or _should_prefer_mail_over(
            best_mail, mail, challenger_has_filter=mail["filter_matched"]
        ):
            best_mail = mail
            if _maybe_log_security_triggers(
                mail, body_raw, sender_lower, user_searching, searched_address, active_security_rules
            ):
                logs_to_commit = True

    found_mail = best_mail

    # Commit final (si corresponde) después de salir del bucle
    if logs_to_commit:
        try:
            db.session.commit()
        except Exception as final_commit_err:
            current_app.logger.error(f"Error haciendo commit en _process_mails (final): {final_commit_err}")
            db.session.rollback()

    return found_mail


def _maybe_log_security_triggers(mail, body_raw, sender_lower, user_searching, searched_address, active_security_rules):
    admin_username_cfg = current_app.config.get("ADMIN_USER", "admin")
    if not user_searching or user_searching.username == admin_username_cfg or not active_security_rules:
        return False

    email_id = mail.get("message_id") or mail.get("subject", "") + str(mail.get("internal_date", datetime.min))
    needs_commit = False

    for rule in active_security_rules:
        rule_sender_lower = (rule.sender or "").lower()
        if rule_sender_lower and rule_sender_lower not in sender_lower:
            continue
        try:
            if safe_regex_search(rule.trigger_pattern, body_raw):
                log_entry = TriggerLog(
                    user_id=user_searching.id,
                    rule_id=rule.id,
                    email_identifier=email_id[:512],
                    searched_email=searched_address,
                    timestamp=datetime.now(timezone.utc),
                )
                db.session.add(log_entry)
                needs_commit = True
        except re.error as re_err:
            current_app.logger.error(
                "Error de Regex en SecurityRule ID %s (trigger_pattern): %s",
                rule.id,
                re_err,
            )
        except Exception as log_err:
            current_app.logger.error(
                "Error procesando SecurityRule ID %s o creando TriggerLog: %s",
                rule.id,
                log_err,
            )
    return needs_commit


def _normalize_for_filter_match(value) -> str:
    """Minúsculas sin tildes para comparar palabras clave de filtros."""
    import unicodedata

    raw = str(value or "").strip().lower()
    decomposed = unicodedata.normalize("NFD", raw)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def _plain_text_from_html(html: str) -> str:
    import html as html_module

    if not html:
        return ""
    t = re.sub(r"(?i)<br\s*/?>", " ", html)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html_module.unescape(t)
    t = t.replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip()


def _filter_searchable_text(mail_dict) -> str:
    """
    Texto donde buscar la palabra clave del filtro: asunto + cuerpo visible.
    Los correos tipo Netflix Hogar suelen repetir la clave en el asunto y en HTML con tags.
    """
    parts = [
        mail_dict.get("subject") or "",
        mail_dict.get("text") or "",
        _plain_text_from_html(mail_dict.get("html") or ""),
    ]
    combined = " ".join(p for p in parts if p).strip()
    return _normalize_for_filter_match(combined)


def get_first_filter_that_matches(mail_dict, filters):
    """
    Retorna el Filter que coincida con:
    - f.sender en mail['from'] (si f.sender no es None)
    - f.keyword en asunto/cuerpo (si f.keyword no es None)
    Prioriza reglas más específicas (con palabra clave).
    """
    body_text = _filter_searchable_text(mail_dict)
    sender_text = _normalize_for_filter_match(mail_dict.get("from", ""))

    def _specificity(f):
        score = 0
        if (f.sender or "").strip():
            score += 100
        if (f.keyword or "").strip():
            score += 1000 + min(len((f.keyword or "").strip()), 500)
        return score

    for f in sorted(filters, key=_specificity, reverse=True):
        filter_sender = _normalize_for_filter_match(f.sender or "")
        filter_keyword = _normalize_for_filter_match(f.keyword or "")

        if filter_sender and filter_sender not in sender_text:
            continue
        if filter_keyword and filter_keyword not in body_text:
            continue
        return f
    return None


def _is_netflix_login_6_digits_filter(matched_filter) -> bool:
    """Caso puntual: ingreso sesión Netflix 6 dígitos (info@account.netflix.com)."""
    if matched_filter is None:
        return False
    sender = _normalize_for_filter_match(getattr(matched_filter, "sender", ""))
    keyword = _normalize_for_filter_match(getattr(matched_filter, "keyword", ""))
    description = _normalize_for_filter_match(getattr(matched_filter, "description", ""))
    return (
        sender == "info@account.netflix.com"
        and "alguien intenta acceder a tu cuenta" in keyword
        and "ingreso sesion netflix 6 digitos" in description
    )


def _is_netflix_approve_session_filter(matched_filter) -> bool:
    """Netflix con CTA «Obtener código» o «Aprobar» (nueva solicitud / viaje)."""
    if matched_filter is None:
        return False
    sender = _normalize_for_filter_match(getattr(matched_filter, "sender", ""))
    blob = _normalize_for_filter_match(
        " ".join(
            [
                getattr(matched_filter, "keyword", None) or "",
                getattr(matched_filter, "description", None) or "",
            ]
        )
    )
    if "aprueba la nueva solicitud" in blob:
        return True
    if "codigo de acceso temporal" in blob or "temporary access code" in blob:
        return True
    if (
        "actualizar tu hogar" in blob
        or "solicitaste actualizar" in blob
        or "actualizar hogar" in blob
        or "update your home" in blob
    ):
        return True
    if "netflix.com" not in sender:
        return False
    return (
        "aprobar sesion" in blob
        or "solicitud netflix" in blob
        or "codigo netflix viaje" in blob
        or "codigo de acceso temporal" in blob
        or "temporary access code" in blob
        or ("approve" in blob and "sign" in blob)
    )


_NF_APPROVE_LABELS = (
    "aprobar",
    "approve",
)
_NF_DECLINE_LABELS = (
    "rechazar",
    "decline",
    "deny",
    "reject",
)
_NF_DEVICE_NAME_HINTS = (
    "tv",
    "iphone",
    "ipad",
    "android",
    "windows",
    "mac",
    "chrome",
    "playstation",
    "xbox",
    "smart",
    "lg ",
    "samsung",
    "sony",
    "roku",
    "fire",
    "browser",
    "tablet",
    "movil",
    "phone",
    "webos",
    "tizen",
    "hisense",
    "vizio",
    "tcl",
    "philips",
    "apple tv",
    "fire tv",
    "smart tv",
)
_NF_IN_MAIL_DATE_RE = re.compile(
    r"(?is)("
    r"\d{1,2}\s+de\s+(?:ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|"
    r"jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|set(?:iembre)?|"
    r"oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)"
    r"|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
    r"\s+\d{1,2}"
    r").{0,48}(?:a\.\s*m\.|p\.\s*m\.|am|pm)?.{0,16}(?:gmt|utc)"
)


def _nf_label_is_approve(label: str) -> bool:
    n = _normalize_for_filter_match(label)
    if not n:
        return False
    if n in _NF_APPROVE_LABELS:
        return True
    return n.startswith("aprobar") or n.startswith("approve")


def _nf_label_is_decline(label: str) -> bool:
    n = _normalize_for_filter_match(label)
    if not n:
        return False
    return any(token in n for token in _NF_DECLINE_LABELS)


def _nf_text_is_in_mail_date(raw: str) -> bool:
    if not raw:
        return False
    if _NF_IN_MAIL_DATE_RE.search(raw):
        return True
    n = _normalize_for_filter_match(raw)
    return bool(re.search(r"gmt[+\-]?\d{1,2}", n))


def _netflix_mail_has_approve_decline_buttons(mail) -> bool:
    """Plantilla «Aprueba la nueva solicitud…»: botones Aprobar / Rechazar."""
    html = mail.get("html") or ""
    text = mail.get("text") or ""
    blob = _normalize_for_filter_match(html + " " + text)
    has_approve = any(tok in blob for tok in ("aprobar", "approve"))
    has_decline = any(tok in blob for tok in _NF_DECLINE_LABELS)
    return has_approve and has_decline


_NF_GET_CODE_CTA_TOKENS = (
    "obtener codigo",
    "obtener enlace",
    "get code",
    "get link",
)
_NF_HOGAR_CTA_TOKENS = (
    "si, la envie yo",
    "si la envie yo",
    "la envie yo",
    "yes, i sent it",
    "yes i sent it",
    "i sent it",
)


def _nf_label_matches_tokens(label: str, tokens) -> bool:
    n = _normalize_for_filter_match(label)
    return bool(n) and any(token in n for token in tokens)


def _looks_like_netflix_get_code_mail(mail) -> bool:
    """Correo Netflix «Obtener código» / acceso temporal."""
    if _netflix_mail_has_approve_decline_buttons(mail):
        return False
    html = mail.get("html") or ""
    text = mail.get("text") or ""
    blob = _normalize_for_filter_match(html + " " + text)
    has_cta = any(tok in blob for tok in _NF_GET_CODE_CTA_TOKENS)
    has_expire = ("vence" in blob or "expires" in blob) and (
        "minuto" in blob or "minute" in blob
    )
    return has_cta and has_expire


def _looks_like_netflix_hogar_mail(mail) -> bool:
    """Correo Netflix «¿Solicitaste actualizar tu Hogar?»: Sí, la envié yo."""
    if _netflix_mail_has_approve_decline_buttons(mail):
        return False
    html = mail.get("html") or ""
    text = mail.get("text") or ""
    blob = _normalize_for_filter_match(html + " " + text)
    has_cta = any(tok in blob for tok in _NF_HOGAR_CTA_TOKENS)
    has_expire = ("vence" in blob or "expires" in blob) and (
        "minuto" in blob or "minute" in blob
    )
    return has_cta and has_expire


def _nf_shorten_expire_notice(raw: str) -> str:
    """Deja solo «vence en N minutos.» (sin asterisco ni «El enlace»)."""
    if not raw:
        return ""
    m = re.search(r"(?i)vence\s+en\s+(\d+)\s+minutos?", raw)
    if m:
        return f"vence en {m.group(1)} minutos."
    m = re.search(r"(?i)expires?\s+in\s+(\d+)\s+minutes?", raw)
    if m:
        return f"vence en {m.group(1)} minutos."
    return ""


def _nf_full_expire_notice(raw: str) -> str:
    """Conserva «* El enlace vence en N minutos.»."""
    if not raw:
        return ""
    m = re.search(r"(?i)\*?\s*el\s+enlace\s+vence\s+en\s+(\d+)\s+minutos?\.?", raw)
    if m:
        mins = m.group(1)
        return f"* El enlace vence en {mins} minutos."
    m = re.search(r"(?i)\*?\s*the\s+link\s+expires?\s+in\s+(\d+)\s+minutes?\.?", raw)
    if m:
        mins = m.group(1)
        return f"* El enlace vence en {mins} minutos."
    short = _nf_shorten_expire_notice(raw)
    if short:
        return f"* El enlace {short}"
    return ""


def _nf_build_approve_button_html(href: str, label: str) -> str:
    """Botón rojo sin borde blanco (el contorno lo da la tarjeta de resultado)."""
    import html as html_module

    safe_href = html_module.escape(href or "#", quote=True)
    safe_label = html_module.escape(label)
    inner = (
        f'<a href="{safe_href}" target="_blank" rel="noopener noreferrer" '
        'style="text-decoration:none;display:flex;align-items:center;justify-content:center;'
        'height:48px;margin:0;padding:0;line-height:1;color:#fff;border:0;outline:none;">'
        f"{safe_label}</a>"
        if href
        else (
            '<span style="display:flex;align-items:center;justify-content:center;'
            'height:48px;margin:0;padding:0;line-height:1;color:#fff;">'
            f"{safe_label}</span>"
        )
    )
    return (
        '<table cellpadding="0" cellspacing="0" border="0" role="presentation" '
        'style="border:0;border-collapse:collapse;border-spacing:0;outline:none;'
        "background-color:rgb(229,9,20);width:100%;height:48px;margin:8px 0 0;"
        'border-radius:0;box-shadow:none;filter:none;">'
        "<tbody><tr>"
        '<td align="center" valign="middle" style="border:0;outline:none;height:48px;padding:0;'
        "font-family:Helvetica Neue,Roboto,Segoe UI,sans-serif;font-weight:700;font-size:16px;"
        'line-height:1;color:#fff;background-color:rgb(229,9,20);vertical-align:middle;">'
        f"{inner}</td></tr></tbody></table>"
    )


def _nf_extract_device_name_from_soup(soup) -> str:
    best = ""
    for node in soup.find_all(["p", "td", "div", "span", "strong", "b", "h1", "h2", "h3"]):
        if node.find("a"):
            continue
        raw = " ".join((node.get_text(" ", strip=True) or "").split())
        if not raw or len(raw) > 80:
            continue
        if _nf_label_is_approve(raw) or _nf_label_is_decline(raw):
            continue
        if _nf_text_is_in_mail_date(raw):
            continue
        raw_n = _normalize_for_filter_match(raw)
        hinted = any(h.strip() in raw_n for h in _NF_DEVICE_NAME_HINTS) or " - " in raw
        if not hinted:
            continue
        # Preferir el nodo más corto (p. ej. «LG - Smart TV» frente al td padre).
        if not best or len(raw) < len(best):
            best = raw
    return best


def _normalize_netflix_new_sign_in_request_content(mail):
    """
    Correo «Aprueba la nueva solicitud de inicio de sesión»:
    deja nombre del equipo + botón Aprobar; oculta icono, fecha in-mail y Rechazar.
    """
    import html as html_module

    html = mail.get("html") or ""
    text = mail.get("text") or ""
    device_name = ""
    approve_label = ""
    approve_href = ""
    button_html = ""

    if html.strip():
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(html, "html.parser")
            device_name = _nf_extract_device_name_from_soup(soup)
            for anchor in soup.find_all("a"):
                label = " ".join((anchor.get_text(" ", strip=True) or "").split())
                if _nf_label_is_decline(label):
                    continue
                if not _nf_label_is_approve(label):
                    continue
                approve_label = label
                approve_href = (anchor.get("href") or "").strip()
                break
        except Exception:
            pass

    if not device_name or not approve_label:
        plain = text or _plain_text_from_html(html)
        if not approve_label:
            m = re.search(r"\b(Aprobar|Approve)\b", plain, flags=re.I)
            if m:
                approve_label = m.group(1)
        if not device_name:
            for line in re.split(r"[\n\r]+", plain):
                raw = " ".join(line.split())
                if not raw or len(raw) > 80:
                    continue
                if _nf_label_is_approve(raw) or _nf_label_is_decline(raw):
                    continue
                if _nf_text_is_in_mail_date(raw):
                    continue
                raw_n = _normalize_for_filter_match(raw)
                if " - " in raw or any(h.strip() in raw_n for h in _NF_DEVICE_NAME_HINTS):
                    device_name = raw
                    break

    if approve_label:
        button_html = _nf_build_approve_button_html(approve_href, approve_label)

    if not button_html and not device_name:
        return

    pieces = [
        '<div class="nf-sign-in-cta" style="text-align:center;padding:0;max-width:100%;'
        'margin:0 auto;box-shadow:none;filter:none;">'
    ]
    if device_name:
        pieces.append(
            '<p style="font-family:Helvetica Neue,Roboto,Segoe UI,sans-serif;font-size:16px;'
            'font-weight:700;line-height:20px;color:#221f1f;margin:0 0 8px;text-align:center;">'
            f"{html_module.escape(device_name)}</p>"
        )
    if button_html:
        pieces.append(button_html)
    pieces.append("</div>")
    mail["html"] = "".join(pieces)

    text_parts = []
    if device_name:
        text_parts.append(device_name)
    if approve_label:
        text_parts.append(approve_label)
    if approve_href:
        text_parts.append(approve_href)
    mail["text"] = "\n".join(text_parts)


def _normalize_netflix_approve_session_content(mail):
    """
    Deja el CTA (Obtener código / Get code) y «vence en N minutos.».
    Quita avatar, «Solicitud de…» y la fecha incrustada del correo.
    Si el correo es Aprobar/Rechazar (nueva solicitud), deja equipo + Aprobar.
    Conserva formatted_date (Fecha: … de la consulta).
    """
    html = mail.get("html") or ""
    text = mail.get("text") or ""
    if not html.strip() and not text.strip():
        return

    if _netflix_mail_has_approve_decline_buttons(mail):
        _normalize_netflix_new_sign_in_request_content(mail)
        return

    is_hogar = _looks_like_netflix_hogar_mail(mail)
    cta_tokens = _NF_HOGAR_CTA_TOKENS + _NF_GET_CODE_CTA_TOKENS
    cta_label = ""
    cta_href = ""
    expire_source = text or _plain_text_from_html(html)

    if html.strip():
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(html, "html.parser")
            for anchor in soup.find_all("a"):
                label = " ".join((anchor.get_text(" ", strip=True) or "").split())
                if not _nf_label_matches_tokens(label, cta_tokens):
                    continue
                cta_label = label
                cta_href = (anchor.get("href") or "").strip()
                if _nf_label_matches_tokens(label, _NF_HOGAR_CTA_TOKENS):
                    is_hogar = True
                break
            expire_source = soup.get_text(" ", strip=True) or expire_source
        except Exception:
            pass

    if not cta_label:
        plain = expire_source or text or _plain_text_from_html(html)
        if is_hogar:
            m = re.search(
                r"(S[ií],?\s+la\s+envi[eé]\s+yo|Yes,?\s+I\s+sent\s+it)",
                plain,
                flags=re.I,
            )
        else:
            m = re.search(
                r"(Obtener\s+c[oó]digo|Obtener\s+enlace|Get\s+Code|Get\s+Link)",
                plain,
                flags=re.I,
            )
        if m:
            cta_label = " ".join(m.group(1).split())

    if is_hogar:
        expire_text = _nf_full_expire_notice(expire_source) or _nf_full_expire_notice(
            text or _plain_text_from_html(html)
        )
    else:
        expire_text = _nf_shorten_expire_notice(expire_source)
        if not expire_text:
            expire_text = _nf_shorten_expire_notice(text or _plain_text_from_html(html))

    button_html = ""
    if cta_label:
        button_html = _nf_build_approve_button_html(cta_href, cta_label)

    if not button_html and not expire_text:
        return

    pieces = [
        '<div class="nf-sign-in-cta" style="text-align:center;padding:0;max-width:100%;'
        'margin:0 auto;box-shadow:none;filter:none;">'
    ]
    if button_html:
        pieces.append(button_html)
    if expire_text:
        import html as html_module

        pieces.append(
            '<p style="font-family:Helvetica Neue,Roboto,Segoe UI,sans-serif;font-size:12px;'
            'line-height:15px;color:#696666;margin:10px 0 0;text-align:center;">'
            f"{html_module.escape(expire_text)}</p>"
        )
    pieces.append("</div>")
    mail["html"] = "".join(pieces)

    text_parts = []
    if cta_label:
        text_parts.append(cta_label)
    if cta_href:
        text_parts.append(cta_href)
    if expire_text:
        text_parts.append(expire_text)
    mail["text"] = "\n".join(text_parts)


def _extract_six_digit_code_from_text(combined: str):
    if not combined:
        return None
    for pat in (r"(?:\d[\s\u00a0]*){6}", r"\b(\d{6})\b"):
        m = re.search(pat, combined)
        if not m:
            continue
        digits = re.sub(r"\D", "", m.group(0))
        if len(digits) >= 6:
            return digits[:6]
    return None


def _extract_six_digit_code_from_mail(mail_dict):
    parts = [
        mail_dict.get("text") or "",
        _plain_text_from_html(mail_dict.get("html") or ""),
    ]
    combined = " ".join(p for p in parts if p).strip()
    return _extract_six_digit_code_from_text(combined)


def _is_universal_activation_filter(matched_filter) -> bool:
    """Código de activación Universal+ (On Demand / universalplus)."""
    if matched_filter is None:
        return False
    sender = (getattr(matched_filter, "sender", None) or "").lower()
    blob = " ".join(
        [
            sender,
            (getattr(matched_filter, "keyword", None) or "").lower(),
            (getattr(matched_filter, "description", None) or "").lower(),
        ]
    )
    if "universal" not in blob and "universalplus" not in sender:
        return False
    return any(
        token in blob
        for token in ("on demand", "activaci", "iniciar sesion", "iniciar sesión", "codigo", "código")
    )


def _extract_universal_activation_code(mail_dict):
    """
    Extrae el código de activación (p. ej. JU2EHK) del HTML/texto ya filtrado.
    Prioriza <h1>/<strong>; luego tokens con letras+dígitos; evita palabras tipo DEMAND.
    """
    html = mail_dict.get("html") or ""
    text = mail_dict.get("text") or ""
    _skip = {
        "DEMAND", "UNIVERSAL", "ONDEMAND", "CODIGO", "CÓDIGO", "ACTIVAR",
        "ACTIVATION", "ACCOUNT", "CUENTA", "SESSION", "SESION", "SESIÓN",
    }

    def _rank_token(token: str):
        t = (token or "").upper()
        if not re.fullmatch(r"[A-Z0-9]{4,10}", t) or t in _skip or t.isdigit():
            return None
        has_letter = bool(re.search(r"[A-Z]", t))
        has_digit = bool(re.search(r"[0-9]", t))
        if has_letter and has_digit:
            return (0, t)  # preferido: JU2EHK
        if has_letter:
            return (1, t)  # solo letras (último recurso)
        return None

    preferred = []
    fallback = []

    def _add(token: str):
        ranked = _rank_token(token)
        if not ranked:
            return
        priority, t = ranked
        (preferred if priority == 0 else fallback).append(t)

    if html.strip():
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(html, "html.parser")
            for tag in soup.find_all(["h1", "h2", "strong", "b"]):
                raw = "".join((tag.get_text() or "").split())
                _add(raw)
            if not preferred and not fallback:
                plain = soup.get_text(" ", strip=True)
                for m in re.finditer(r"\b([A-Za-z0-9]{4,10})\b", plain):
                    _add(m.group(1))
        except Exception:
            pass

    if not preferred and not fallback and text:
        for m in re.finditer(r"\b([A-Za-z0-9]{4,10})\b", text):
            _add(m.group(1))

    if preferred:
        return preferred[0]
    return fallback[0] if fallback else None


def apply_cut_after_html(mail, cut_str):
    """
    Si se encuentra 'cut_str' en el HTML o texto,
    se recorta ese contenido (HTML y texto) desde ese punto en adelante.
    """
    original_html = mail.get("html", "")
    idx_html = original_html.lower().find(cut_str.lower())
    if idx_html != -1:
        mail["html"] = original_html[:idx_html]

    original_text = mail.get("text", "")
    idx_text = original_text.lower().find(cut_str.lower())
    if idx_text != -1:
        mail["text"] = original_text[:idx_text]


def apply_cut_before_html(mail, cut_str):
    """
    Si se encuentra 'cut_str' en el HTML o texto,
    se recorta ese contenido (HTML y texto) desde el inicio hasta ese punto.
    """
    original_html = mail.get("html", "")
    idx_html = original_html.lower().find(cut_str.lower())
    if idx_html != -1:
        # Cortar desde el final del cut_str hacia adelante
        new_html = original_html[idx_html + len(cut_str):]
        # Asegurar que siempre haya contenido para mostrar
        if new_html.strip():
            mail["html"] = new_html
        else:
            # Si no hay contenido después del corte, mantener el cut_str
            mail["html"] = cut_str

    original_text = mail.get("text", "")
    idx_text = original_text.lower().find(cut_str.lower())
    if idx_text != -1:
        # Cortar desde el final del cut_str hacia adelante
        new_text = original_text[idx_text + len(cut_str):]
        # Asegurar que siempre haya contenido para mostrar
        if new_text.strip():
            mail["text"] = new_text
        else:
            # Si no hay contenido después del corte, mantener el cut_str
            mail["text"] = cut_str


_CR_NOT_ME_LABELS = (
    'this was not me',
    'esto no fui yo',
    'no fui yo',
    'no fuiste tú',
    'no fuiste tu',
)
_CR_WAS_ME_LABELS = (
    'this was me',
    'sí fui yo',
    'si fui yo',
    'fui yo',
)


def _is_crunchyroll_login_confirm_filter(matched_filter):
    """Filtros de confirmación de inicio de sesión de Crunchyroll (EN/ES)."""
    if not matched_filter:
        return False
    sender = (getattr(matched_filter, 'sender', None) or '').lower()
    blob = ' '.join(
        [
            sender,
            (getattr(matched_filter, 'keyword', None) or '').lower(),
            (getattr(matched_filter, 'description', None) or '').lower(),
        ]
    )
    if 'crunchyroll' not in blob:
        return False
    return any(
        token in blob
        for token in (
            'login',
            'inicio de sesi',
            'confirma tu nuevo',
            'confirm your new',
        )
    )


def _crunchyroll_link_label(anchor):
    return ' '.join((anchor.get_text(' ', strip=True) or '').split()).lower()


def _normalize_crunchyroll_login_action_buttons(mail):
    """
    En consultas Crunchyroll de login: quita «THIS WAS NOT ME» y centra «THIS WAS ME».
    """
    html = mail.get('html') or ''
    text = mail.get('text') or ''
    low = html.lower()
    if 'this was' not in low and 'fui yo' not in low:
        # Solo texto plano
        if text:
            lines = []
            for line in text.splitlines():
                ll = line.strip().lower()
                if any(lab in ll for lab in _CR_NOT_ME_LABELS):
                    continue
                lines.append(line)
            mail['text'] = '\n'.join(lines)
        return

    try:
        from bs4 import BeautifulSoup
    except Exception:
        return

    soup = BeautifulSoup(html, 'html.parser')
    changed = False

    for anchor in list(soup.find_all('a')):
        label = _crunchyroll_link_label(anchor)
        if not any(lab in label for lab in _CR_NOT_ME_LABELS):
            continue
        cell = anchor.find_parent('td')
        if cell is not None:
            cell.decompose()
        else:
            anchor.decompose()
        changed = True

    for anchor in soup.find_all('a'):
        label = _crunchyroll_link_label(anchor)
        if not any(lab in label for lab in _CR_WAS_ME_LABELS):
            continue
        cell = anchor.find_parent('td')
        row = anchor.find_parent('tr')
        table = anchor.find_parent('table')
        if cell is not None:
            cell['align'] = 'center'
            style = (cell.get('style') or '').rstrip()
            if 'text-align' not in style.lower():
                cell['style'] = (style + (';' if style else '') + 'text-align:center;')
            changed = True
        if row is not None:
            row['align'] = 'center'
            changed = True
        if table is not None:
            table['align'] = 'center'
            style = (table.get('style') or '').rstrip()
            if 'margin' not in style.lower():
                table['style'] = (style + (';' if style else '') + 'margin:0 auto;')
            changed = True

    if changed:
        mail['html'] = str(soup)

    if text:
        lines = []
        for line in text.splitlines():
            ll = line.strip().lower()
            if any(lab in ll for lab in _CR_NOT_ME_LABELS):
                continue
            lines.append(line)
        mail['text'] = '\n'.join(lines)


def _format_date(mail):
    raw_date = mail.get("date")
    if raw_date:
        try:
            dt = parsedate_to_datetime(raw_date)
            if dt.tzinfo is None:
                from datetime import timezone
                dt = dt.replace(tzinfo=timezone.utc)
            # Usar formato de Colombia con zona horaria y 12 horas
            mail["formatted_date"] = format_colombia_time(dt)
        except:
            mail["formatted_date"] = raw_date
    else:
        mail["formatted_date"] = None
