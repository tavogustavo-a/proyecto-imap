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

            mail["filter_matched"] = True
            if _is_netflix_login_6_digits_filter(matched_filter):
                mail["filter_code"] = (
                    _extract_six_digit_code_from_mail(mail)
                    or _extract_six_digit_code_from_mail({
                        "text": body_text_before,
                        "html": body_html_before,
                    })
                )
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
