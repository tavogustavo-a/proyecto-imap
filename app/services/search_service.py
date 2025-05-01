# app/services/search_service.py

from datetime import datetime, timezone
from flask import current_app
from email.utils import parsedate_to_datetime

from app.models import IMAPServer, ServiceModel, FilterModel, RegexModel, User
from app.imap.advanced_imap import search_in_all_servers
from app.admin.regex import passes_any_regex, extract_regex
from app.extensions import db

def search_and_apply_filters(to_address, service_id=None, user=None):
    """
    Realiza la búsqueda de correos en servidores IMAP habilitados,
    aplicando solo los filtros/regex habilitados en el servicio.

    - Si user es None (anónimo) o user es admin => no hay intersección M2M (toma todo lo del servicio).
    - Si user es un usuario normal => se intersectan (service.filters ∩ user.filters_allowed) y
      (service.regexes ∩ user.regexes_allowed).
    - El segundo intento de búsqueda (sin límite de días) ocurre si el servicio
      contiene el regex "Pais de Netflix" => '_(?:es_|en-)([A-Za-z]{2})[^_]*_EVO'. Así no se rompe
      la lógica antigua.

    * Por defecto se buscan correos de 2 días atrás (limit_days=2).
    * EXCEPCIÓN (Netflix): si el servicio incluye el regex de Netflix
      (sender='info@account.netflix.com', pattern='_(?:es_|en-)([A-Za-z]{2})[^_]*_EVO'),
      y no se encuentra nada en 2 días, hacemos UNA segunda búsqueda
      con limit_days=None (correos antiguos).
    """

    # 1) Verificar el service_id
    if not service_id:
        return None

    service = ServiceModel.query.get(service_id)
    if not service or not service.enabled:
        return None

    # 2) Filtros y Regex habilitados del servicio
    service_filters = [f for f in service.filters if f.enabled]
    service_regexes = [r for r in service.regexes if r.enabled]

    if not service_filters and not service_regexes:
        return None

    # 3) Definir filters/regex finales, según si el user es admin, None, o normal
    final_filters = service_filters
    final_regexes = service_regexes

    if user and user.enabled:
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        # Identificar si es sub-usuario
        is_subuser = (user.parent_id is not None)
        parent_user = None
        if is_subuser:
            parent_user = User.query.get(user.parent_id)
            # Cargar las relaciones default_... del padre si es sub-usuario
            if parent_user:
                 # Forzar la carga si son lazy='dynamic' o por si acaso
                 _ = parent_user.default_filters_for_subusers.all()
                 _ = parent_user.default_regexes_for_subusers.all()

        if user.username != admin_username:
            # Usuario normal o sub-usuario => intersecta VERIFICANDO ESTADOS

            # IDs permitidos directamente al usuario (padre o sub, ya sincronizado si es sub)
            allowed_filter_ids = {f.id for f in user.filters_allowed}
            allowed_regex_ids = {r.id for r in user.regexes_allowed}

            # --- OBTENER IDs HABILITADOS GLOBALMENTE --- 
            # (Esta parte verifica el estado enabled del FilterModel/RegexModel global)
            currently_globally_enabled_filter_ids = { 
                f.id for f in FilterModel.query.filter(FilterModel.enabled == True).all()
            }
            currently_globally_enabled_regex_ids = {
                r.id for r in RegexModel.query.filter(RegexModel.enabled == True).all()
            }
            # -------------------------------------------

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

        current_app.logger.info(f"--- BUSQUEDA PARA: {log_user_type}, Email: {to_address}, Servicio ID: {service_id} ---")
        current_app.logger.info(f"    Filtros Finales (ID, Enabled): {log_final_filters}")
        current_app.logger.info(f"    Regex Finales (ID, Enabled): {log_final_regexes}")
        current_app.logger.info(f"--- FIN DEBUG BUSQUEDA ---")
    except Exception as log_err:
        current_app.logger.error(f"Error durante el logging de búsqueda: {log_err}")
    # --- FIN: Logging para Depuración ---

    # 4) Buscamos en servidores IMAP habilitados
    servers = IMAPServer.query.filter_by(enabled=True).all()
    if not servers:
        return None

    app_obj = current_app._get_current_object()

    # -- Primer intento: 2 días
    all_mails = search_in_all_servers(app_obj, to_address, servers, limit_days=2)
    found_mail = _process_mails(all_mails, final_filters, final_regexes)
    if found_mail:
        return found_mail

    # 5) EXCEPCIÓN: Netflix => se activa si el SERVICIO lo tiene
    #    (independientemente de si el user lo tiene en su M2M),
    #    para replicar la antigua lógica.
    has_netflix_regex_service = any(
        (r.sender or "").lower() == "info@account.netflix.com"
        and r.pattern == "_(?:es_|en-)([A-Za-z]{2})[^_]*_EVO"
        for r in service_regexes
    )
    if has_netflix_regex_service:
        older_mails = search_in_all_servers(app_obj, to_address, servers, limit_days=None)
        found_mail_older = _process_mails(older_mails, final_filters, final_regexes)
        if found_mail_older:
            return found_mail_older

    return None


def _process_mails(all_mails, filters, regexes):
    """
    Aplica los filters y regex a la lista de correos ordenada desc por fecha.
    Retorna el primer mail que coincida con (filter || regex).
    """
    if not all_mails:
        return None

    # Orden desc por INTERNALDATE
    all_mails.sort(key=lambda x: x.get("internal_date", datetime.min), reverse=True)

    for mail in all_mails:
        _format_date(mail)

        # Filtro
        matched_filter = get_first_filter_that_matches(mail, filters)
        if matched_filter:
            cut_str = (matched_filter.cut_after_html or "").strip() if matched_filter.cut_after_html else ""
            if cut_str:
                apply_cut_after_html(mail, cut_str)
            mail["filter_matched"] = True
        else:
            mail["filter_matched"] = False

        # Regex
        found_regex = False
        if regexes:
            if passes_any_regex(mail, regexes):
                found_regex = True
                mail["regex_matches"] = extract_regex(mail, regexes)
            else:
                mail["regex_matches"] = {}
        else:
            mail["regex_matches"] = {}

        # Si coincide regex pero NO hay filtro => ocultamos HTML
        if not mail["filter_matched"] and found_regex:
            mail["html"] = ""
            mail["text"] = ""

        # Si coincidió Filtro o Regex => retornamos
        if mail["filter_matched"] or found_regex:
            return mail

    return None


def get_first_filter_that_matches(mail_dict, filters):
    """
    Retorna el primer Filter que coincida con:
    - f.sender en mail['from'] (si f.sender no es None)
    - f.keyword en body_text (si f.keyword no es None)
    """
    body_text = (mail_dict.get("text", "") + mail_dict.get("html", "")).lower()
    sender_text = mail_dict.get("from", "").lower()

    for f in filters:
        filter_sender = (f.sender or "").lower()
        filter_keyword = (f.keyword or "").lower()

        if filter_sender and filter_sender not in sender_text:
            continue
        if filter_keyword and filter_keyword not in body_text:
            continue
        return f
    return None


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


def _format_date(mail):
    raw_date = mail.get("date")
    if raw_date:
        try:
            dt = parsedate_to_datetime(raw_date)
            if dt.tzinfo is None:
                from datetime import timezone
                dt = dt.replace(tzinfo=timezone.utc)
            dt_local = dt.astimezone()
            mail["formatted_date"] = dt_local.strftime("%d %b %Y, %H:%M")
        except:
            mail["formatted_date"] = raw_date
    else:
        mail["formatted_date"] = None
