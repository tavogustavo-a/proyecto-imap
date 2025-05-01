# app/admin/admin_settings.py

import os
import json
from datetime import datetime
from flask import (
    render_template, request, redirect,
    url_for, flash, current_app, jsonify,
    Response
)
from werkzeug.utils import secure_filename
from . import admin_bp
from app.extensions import db
from app.models import (
    SiteSettings, IMAPServer, FilterModel as Filter,
    RegexModel as RegexPattern, User, DomainModel,
    ServiceModel,
    ServiceAlias as Alias,
    AliasIcon,
    service_regex, service_filter,
    AllowedEmail,
    ServiceIcon
)
from app.admin.site_settings import (
    get_site_setting, set_site_setting
)
from app.services.domain_service import (
    get_all_domains
)
from app.admin.decorators import admin_required

# --- Helper para Importar/Exportar ---
ALLOWED_EXTENSIONS = {'json'}
def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@admin_bp.route("/")
@admin_required
def dashboard():
    imap_search = request.args.get("imap_search", "").strip().lower()
    servers_query = IMAPServer.query
    if imap_search:
        servers_query = servers_query.filter(
            (IMAPServer.host.ilike(f"%{imap_search}%"))
            | (IMAPServer.username.ilike(f"%{imap_search}%"))
        )
    servers = servers_query.all()

    # Estos valores se usan en la vista "admin_dashboard.html"
    paragraph_item = SiteSettings.query.filter_by(key="search_message").first()
    paragraph = paragraph_item.value if paragraph_item else ""
    paragraph_mode = get_site_setting("search_message_mode", "off")  # => 'off' o 'guests'

    paragraph2_item = SiteSettings.query.filter_by(key="search_message2").first()
    paragraph2 = paragraph2_item.value if paragraph2_item else ""
    paragraph2_mode = get_site_setting("search_message2_mode", "off")  # => 'off' o 'users'

    lg = SiteSettings.query.filter_by(key="logo_enabled").first()
    logo_enabled = lg.value if lg else "true"

    op = SiteSettings.query.filter_by(key="card_opacity").first()
    card_opacity = op.value if op else "0.8"

    th = SiteSettings.query.filter_by(key="current_theme").first()
    current_theme = th.value if th else "tema1"

    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()

    return render_template(
        "admin_dashboard.html",
        servers=servers,
        paragraph=paragraph,
        paragraph_mode=paragraph_mode,
        paragraph2=paragraph2,
        paragraph2_mode=paragraph2_mode,
        logo_enabled=logo_enabled,
        card_opacity=card_opacity,
        current_theme=current_theme,
        admin_user=admin_user
    )

@admin_bp.route("/filters")
@admin_required
def filters_page():
    filter_search = request.args.get("filter_search", "").strip().lower()
    domains = get_all_domains()

    filters_query = Filter.query
    if filter_search:
        filters_query = filters_query.filter(
            (Filter.sender.ilike(f"%{filter_search}%"))
            | (Filter.keyword.ilike(f"%{filter_search}%"))
        )
    filters_list = filters_query.all()

    return render_template(
        "filters.html",
        domains=domains,
        filters=filters_list,
        filter_search=filter_search
    )

@admin_bp.route("/regex")
@admin_required
def regex_page():
    regex_search = request.args.get("regex_search", "").strip().lower()

    regexes_query = RegexPattern.query
    if regex_search:
        regexes_query = regexes_query.filter(
            (RegexPattern.sender.ilike(f"%{regex_search}%"))
            | (RegexPattern.pattern.ilike(f"%{regex_search}%"))
            | (RegexPattern.description.ilike(f"%{regex_search}%"))
        )
    regex_list = regexes_query.all()

    return render_template(
        "regex.html",
        regexes=regex_list,
        regex_search=regex_search
    )

@admin_bp.route("/parrafos", methods=["GET"])
@admin_required
def parrafos_page():
    """
    Muestra la configuración de Párrafo 1 y 2:
    - P1 => 'off' o 'guests'
    - P2 => 'off' o 'users'
    """
    paragraph_item = SiteSettings.query.filter_by(key="search_message").first()
    paragraph = paragraph_item.value if paragraph_item else ""
    paragraph_mode = get_site_setting("search_message_mode", "off")

    paragraph2_item = SiteSettings.query.filter_by(key="search_message2").first()
    paragraph2 = paragraph2_item.value if paragraph2_item else ""
    paragraph2_mode = get_site_setting("search_message2_mode", "off")

    return render_template(
        "parrafos.html",
        paragraph=paragraph,
        paragraph_mode=paragraph_mode,
        paragraph2=paragraph2,
        paragraph2_mode=paragraph2_mode
    )

@admin_bp.route("/update_paragraph/<int:num_paragraph>", methods=["POST"])
@admin_required
def update_paragraph(num_paragraph):
    new_paragraph = request.form.get("paragraph", "")
    key = "search_message" if num_paragraph == 1 else "search_message2"

    item = SiteSettings.query.filter_by(key=key).first()
    if not item:
        item = SiteSettings(key=key, value=new_paragraph)
        db.session.add(item)
    else:
        item.value = new_paragraph
    db.session.commit()

    flash(f"Párrafo {num_paragraph} actualizado.", "success")
    return redirect(url_for("admin_bp.parrafos_page"))

@admin_bp.route("/cycle_paragraph_mode/<int:num_paragraph>", methods=["POST"])
@admin_required
def cycle_paragraph_mode(num_paragraph):
    """
    Párrafo 1 => alterna entre [off, guests]
    Párrafo 2 => alterna entre [off, users]
    """
    if num_paragraph == 1:
        mode_key = "search_message_mode"
        current_mode = get_site_setting(mode_key, "off")
        # Toggle: 'off' <-> 'guests'
        if current_mode == "off":
            new_mode = "guests"
        else:
            new_mode = "off"
        set_site_setting(mode_key, new_mode)

    elif num_paragraph == 2:
        mode_key = "search_message2_mode"
        current_mode = get_site_setting(mode_key, "off")
        # Toggle: 'off' <-> 'users'
        if current_mode == "off":
            new_mode = "users"
        else:
            new_mode = "off"
        set_site_setting(mode_key, new_mode)

    return redirect(url_for("admin_bp.parrafos_page"))

@admin_bp.route("/toggle_logo", methods=["POST"])
@admin_required
def toggle_logo():
    item = SiteSettings.query.filter_by(key="logo_enabled").first()
    if not item:
        item = SiteSettings(key="logo_enabled", value="true")
        db.session.add(item)
        db.session.commit()

    new_val = "false" if item.value == "true" else "true"
    item.value = new_val
    db.session.commit()

    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/set_opacity", methods=["POST"])
@admin_required
def set_opacity():
    new_opacity = request.form.get("card_opacity", "0.8")
    item = SiteSettings.query.filter_by(key="card_opacity").first()
    if not item:
        item = SiteSettings(key="card_opacity", value=new_opacity)
        db.session.add(item)
    else:
        item.value = new_opacity
    db.session.commit()

    flash(f"Cambió opacidad a {new_opacity}", "info")
    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/change_theme", methods=["POST"])
@admin_required
def change_theme():
    theme = request.form.get("theme", "tema1")
    item = SiteSettings.query.filter_by(key="current_theme").first()
    if not item:
        item = SiteSettings(key="current_theme", value=theme)
        db.session.add(item)
    else:
        item.value = theme
    db.session.commit()

    flash(f"Tema cambiado a {theme}", "info")
    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/logout_all_users", methods=["POST"])
@admin_required
def logout_all_users():
    from app.models import RememberDevice
    RememberDevice.query.delete()
    db.session.commit()

    rev_str = get_site_setting("session_revocation_count", "0")
    new_count = int(rev_str) + 1
    set_site_setting("session_revocation_count", str(new_count))

    flash("Se han cerrado las sesiones de todos los usuarios.", "info")
    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/toggle_dark_mode", methods=["POST"])
@admin_required
def toggle_dark_mode():
    current_val = get_site_setting("dark_mode", "false")
    new_val = "false" if current_val == "true" else "true"
    set_site_setting("dark_mode", new_val)
    flash(f"Modo oscuro: {new_val}", "info")
    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/change_gif", methods=["POST"])
@admin_required
def change_gif():
    gif_name = request.form.get("gif_name", "none")
    set_site_setting("current_gif", gif_name)
    flash(f"Gif cambiado a {gif_name}", "info")
    return redirect(url_for("admin_bp.dashboard"))

# --- Rutas para Importar/Exportar Configuración --- (AÑADIDO AL FINAL)

@admin_bp.route('/export_config')
@admin_required
def export_config():
    """Exporta la configuración actual a un archivo JSON."""
    submitted_code = request.args.get('security_code')
    actual_security_code = current_app.config.get('ADMIN_CONFIG_SECURITY_CODE', 'tu_codigo_secreto_aqui') 
    
    # --- MODIFICADO: Verificar código y devolver error JSON si es incorrecto --- 
    if not submitted_code or submitted_code != actual_security_code:
        current_app.logger.warning("Intento de exportación con código de seguridad INCORRECTO.")
        # Devolver error JSON específico en lugar de redirigir
        return jsonify({"error": "Código de seguridad incorrecto"}), 401 # 401 Unauthorized
    # --- FIN Verificación --- 

    try:
        # 1. Obtener datos ASEGURANDO carga de relaciones ManyToMany
        filters = Filter.query.all()
        regexes = RegexPattern.query.all() # Ya no necesitamos .all() aquí si solo usamos IDs
        services_query = ServiceModel.query.options(
                        db.selectinload(ServiceModel.aliases).selectinload(Alias.alias_icons),
                        db.selectinload(ServiceModel.service_icons),
                        db.selectinload(ServiceModel.filters), # <-- Asegurar carga explícita
                        db.selectinload(ServiceModel.regexes)  # <-- Asegurar carga explícita
                   ).order_by(ServiceModel.position).all()

        # 2. Convertir a formato serializable
        config_data = {
            "filters": [f.to_dict() for f in filters],
            "regexes": [r.to_dict() for r in RegexPattern.query.all()], # Volvemos a obtener todos aquí
            "services": [s.to_dict(include_relations=True) for s in services_query]
        }

        # --- Añadir Usuarios al Export --- 
        # Obtener todos los usuarios (padres y subusuarios) ordenados
        # Es importante cargarlos en un orden que permita reconstruir la jerarquía,
        # pero la serialización con parent_id debería ser suficiente.
        # Aseguramos cargar relaciones necesarias con `options` para eficiencia.
        all_users = User.query.options(
            db.selectinload(User.regexes_allowed),
            db.selectinload(User.filters_allowed),
            db.selectinload(User.services_allowed)
            # Eliminamos las siguientes líneas debido a lazy='dynamic':
            # db.selectinload(User.default_regexes_for_subusers),
            # db.selectinload(User.default_filters_for_subusers)
        ).order_by(User.parent_id.asc().nullsfirst(), User.id.asc()).all() # Padres primero
        
        # No incluir el usuario admin definido en config.py
        admin_username = current_app.config.get("ADMIN_USER")
        users_to_export = [u for u in all_users if u.username != admin_username]

        config_data["users"] = [u.to_dict() for u in users_to_export]
        # --- Fin Añadir Usuarios --- 

        # 3. Convertir a JSON
        # Usar un serializador personalizado si hay tipos de datos complejos (como datetime)
        def default_serializer(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            raise TypeError(f"Object of type {obj.__class__.__name__} is not JSON serializable")

        json_data = json.dumps(config_data, indent=2, ensure_ascii=False, default=default_serializer)

        # 4. Crear la respuesta Flask
        response = Response(json_data, mimetype='application/json')
        response.headers['Content-Disposition'] = 'attachment; filename=proyectoimap_config.json'
        return response

    except Exception as e:
        current_app.logger.error(f"Error al exportar configuración: {e}")
        # En caso de error INTERNO, sí flasheamos y redirigimos (o devolvemos otro error JSON)
        flash('Error al generar el archivo de configuración.', 'danger')
        return jsonify({"error": "Error interno al generar el archivo"}), 500 # Error interno del servidor
        # O mantener la redirección si se prefiere:
        # return redirect(url_for('admin_bp.dashboard'))

@admin_bp.route('/import_config', methods=['POST'])
@admin_required
def import_config():
    """Importa configuración desde un archivo JSON."""
    # 1. Verificar código de seguridad
    submitted_code = request.form.get('security_code', '').strip()
    actual_security_code = current_app.config.get('ADMIN_CONFIG_SECURITY_CODE')

    if not actual_security_code or actual_security_code == 'tu_codigo_secreto_aqui':
        current_app.logger.error("¡El código de seguridad ADMIN_CONFIG_SECURITY_CODE no está configurado correctamente en config.py!")
        flash('Error de configuración interna del servidor (código de seguridad).', 'danger')
        return redirect(url_for('admin_bp.dashboard'))

    if submitted_code != str(actual_security_code):
        current_app.logger.warning("Intento de importación con código de seguridad INCORRECTO.")
        flash('Código de seguridad incorrecto.', 'danger')
        return redirect(url_for('admin_bp.dashboard'))
    
    # 2. Verificar archivo
    if 'config_file' not in request.files:
        flash('No se seleccionó ningún archivo.', 'warning')
        return redirect(url_for('admin_bp.dashboard'))
    file = request.files['config_file']
    if file.filename == '' or not allowed_file(file.filename):
        flash('Archivo no válido o tipo incorrecto (solo .json).', 'warning')
        return redirect(url_for('admin_bp.dashboard'))

    try:
        file_content = file.read().decode('utf-8')
        config_data = json.loads(file_content)

        old_to_new_filter_ids = {}
        old_to_new_regex_ids = {}
        old_to_new_service_ids = {}
        old_to_new_user_ids = {} # Mapeo para IDs de usuario
        
        # --- CORREGIDO: Obtener datos originales ANTES de modificarlos --- 
        original_services_data = config_data.get('services', []) 
        filters_data = config_data.get('filters', [])
        regexes_data = config_data.get('regexes', [])
        users_data = config_data.get('users', []) # Obtener datos de usuarios

        # --- INICIO TRANSACCIÓN 1: Borrar y Crear Objetos Base --- 
        try:
            admin_username = current_app.config.get("ADMIN_USER")
            # 5. BORRAR CONFIGURACIÓN ACTUAL (Incluyendo Usuarios, EXCEPTO admin)
            # Borrar dependencias primero (como AllowedEmail si tiene FK a User)
            AllowedEmail.query.delete()
            # Borrar dispositivos recordados
            from app.models import RememberDevice
            RememberDevice.query.delete()
            # Borrar Usuarios (Excepto el admin principal)
            User.query.filter(User.username != admin_username).delete()
            # Borrar el resto
            # --- NUEVO: Borrar tablas de asociación PRIMERO --- 
            db.session.execute(service_regex.delete()) # Borrar vínculos Servicio <-> Regex
            db.session.execute(service_filter.delete()) # Borrar vínculos Servicio <-> Filtro
            # --- FIN NUEVO ---
            AliasIcon.query.delete()
            Alias.query.delete()
            ServiceModel.query.delete() # Ahora sí se puede borrar servicios
            RegexPattern.query.delete()
            Filter.query.delete()
            db.session.flush() # Aplicar borrados antes de recrear

            # 6. Crear nuevos objetos base y mapear IDs viejos a NUEVOS
            # Crear Filtros y Regex (como antes)
            if filters_data:
                for f_data in filters_data:
                    old_id = f_data.get('id') or f_data.get('original_id') # Compatibilidad
                    f_data_cleaned = {k: v for k, v in f_data.items() if k not in ['id', 'original_id']}
                    new_filter = Filter(**f_data_cleaned) 
                    db.session.add(new_filter)
                    db.session.flush() 
                    if old_id is not None:
                        old_to_new_filter_ids[old_id] = new_filter.id 
            
            if regexes_data:
                 for r_data in regexes_data:
                    old_id = r_data.get('id') or r_data.get('original_id') # Compatibilidad
                    r_data_cleaned = {k: v for k, v in r_data.items() if k not in ['id', 'original_id']}
                    new_regex = RegexPattern(**r_data_cleaned) 
                    db.session.add(new_regex)
                    db.session.flush()
                    if old_id is not None:
                        old_to_new_regex_ids[old_id] = new_regex.id
            
            # 7. Crear Usuarios (en dos pasadas: padres y luego hijos)
            users_to_create_phase2 = []
            if users_data:
                # Fase 7.1: Crear usuarios principales (parent_id is None)
                for u_data in users_data:
                    if u_data.get('parent_id') is None:
                        old_user_id = u_data.get('original_id')
                        # Limpiar datos: excluir IDs, relaciones M2M (se harán en fase 2),
                        # contraseña (requiere manejo especial), y fechas (se manejan auto)
                        u_data_cleaned = {
                            k: v for k, v in u_data.items() 
                            if k not in [
                                'original_id', 'parent_id', 'password',
                                'allowed_regex_ids', 'allowed_filter_ids', 'allowed_service_ids',
                                'default_regex_ids_for_subusers', 'default_filter_ids_for_subusers',
                                'allowed_emails', 'created_at', 'updated_at'
                            ]
                        }
                        # Generar un hash de contraseña vacío o temporal si es necesario
                        # ¡ADVERTENCIA! Esto dejará a los usuarios sin poder loguear hasta
                        # que el admin les ponga contraseña. Es MÁS SEGURO que importar hashes.
                        from werkzeug.security import generate_password_hash
                        u_data_cleaned['password'] = generate_password_hash("imported_user_placeholder_password") 

                        new_user = User(**u_data_cleaned)
                        db.session.add(new_user)
                        db.session.flush() # Obtener el nuevo ID
                        if old_user_id is not None and new_user.id is not None:
                            old_to_new_user_ids[old_user_id] = new_user.id
                            users_to_create_phase2.append({'new_obj': new_user, 'old_data': u_data})
                        else:
                             current_app.logger.warning(f"No se pudo mapear ID viejo {old_user_id} para usuario {u_data.get('username')}")

                # Fase 7.2: Crear sub-usuarios (parent_id existe)
                for u_data in users_data:
                    old_parent_id = u_data.get('parent_id')
                    if old_parent_id is not None:
                        new_parent_id = old_to_new_user_ids.get(old_parent_id)
                        if new_parent_id is None:
                            current_app.logger.warning(f"Subusuario {u_data.get('username')} no pudo crearse, padre ID {old_parent_id} no encontrado en mapeo.")
                            continue # Saltar este subusuario
                        
                        old_user_id = u_data.get('original_id')
                        u_data_cleaned = {
                            k: v for k, v in u_data.items() 
                            if k not in [
                                'original_id', 'parent_id', 'password',
                                'allowed_regex_ids', 'allowed_filter_ids', 'allowed_service_ids',
                                'default_regex_ids_for_subusers', 'default_filter_ids_for_subusers',
                                'allowed_emails', 'created_at', 'updated_at'
                            ]
                        }
                        from werkzeug.security import generate_password_hash
                        u_data_cleaned['password'] = generate_password_hash("imported_user_placeholder_password")
                        u_data_cleaned['parent_id'] = new_parent_id # Asignar nuevo parent_id

                        new_user = User(**u_data_cleaned)
                        db.session.add(new_user)
                        db.session.flush()
                        if old_user_id is not None and new_user.id is not None:
                            old_to_new_user_ids[old_user_id] = new_user.id
                            users_to_create_phase2.append({'new_obj': new_user, 'old_data': u_data})
                        else:
                             current_app.logger.warning(f"No se pudo mapear ID viejo {old_user_id} para subusuario {u_data.get('username')}")

            # 8. Crear Servicios (como antes, pero después de filtros/regex)
            services_to_create = [] # Renombrado para claridad
            for s_data in original_services_data:
                old_id = s_data.get('id') or s_data.get('original_id') # Compatibilidad
                # Creamos copia limpia para el constructor SIN modificar s_data original
                s_data_cleaned = { 
                    k: v for k, v in s_data.items() 
                    if k not in ['id', 'original_id', 'aliases', 'filter_ids', 'regex_ids', 'service_icons', 'service_icon_names'] 
                }
                new_service = ServiceModel(**s_data_cleaned) 
                db.session.add(new_service)
                if old_id is not None:
                    # Guardamos objeto y datos originales para la fase 2 y mapeo
                    services_to_create.append({'new_obj': new_service, 'old_data': s_data})
                
                # --- NUEVO: Crear ServiceIcon asociados al new_service --- 
                service_icon_names = s_data.get('service_icon_names', [])
                for icon_name in service_icon_names:
                    if icon_name:
                        new_service_icon = ServiceIcon(icon_name=icon_name)
                        new_service_icon.service = new_service # Vincular al servicio recién creado
                        db.session.add(new_service_icon)
                # --- FIN NUEVO --- 
                
                # Crear Alias e Iconos asociados al new_service (como antes)
                aliases_data = s_data.get('aliases', [])
                for al_data in aliases_data:
                    icons_data_alias = al_data.get('alias_icons', [])
                    al_data_cleaned = {k: v for k, v in al_data.items() if k not in ['id', 'service_id', 'alias_icons']}
                    new_alias = Alias(**al_data_cleaned)
                    new_alias.service = new_service 
                    db.session.add(new_alias)
                    for icon_name in icons_data_alias:
                        if icon_name:
                             new_icon = AliasIcon(icon_name=icon_name)
                             new_icon.alias = new_alias 
                             db.session.add(new_icon)
            
            db.session.flush() 
            # Llenar mapeo de IDs de servicio
            for item in services_to_create:
                old_id = item['old_data'].get('id') or item['old_data'].get('original_id')
                if old_id is not None and item['new_obj'].id is not None:
                    old_to_new_service_ids[old_id] = item['new_obj'].id
            
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error FASE 1 importación: {e}", exc_info=True)
            flash(f'Error en la fase 1 de importación (creación base): {e}', 'danger')
            return redirect(url_for('admin_bp.dashboard'))
        # --- FIN TRANSACCIÓN 1 ---

        # --- INICIO TRANSACCIÓN 2: Vincular Relaciones ManyToMany y Datos Asociados --- 
        try:
            # 9. Vincular Filtros/Regex a Servicios (como antes)
            for item in services_to_create:
                s_data = item['old_data']
                new_service_id = item['new_obj'].id # Ya tenemos el nuevo ID
                service_to_update = db.session.get(ServiceModel, new_service_id)
                if not service_to_update:
                    current_app.logger.warning(f"(Fase 2) No se encontró servicio {new_service_id} para vincular relaciones.")
                    continue

                # Vincular Filtros
                old_filter_ids = s_data.get('filter_ids', [])
                filters_to_link = []
                for old_f_id in old_filter_ids:
                    new_f_id = old_to_new_filter_ids.get(old_f_id)
                    if new_f_id:
                        filter_obj = db.session.get(Filter, new_f_id)
                        if filter_obj: filters_to_link.append(filter_obj)
                service_to_update.filters = filters_to_link

                # Vincular Regex
                old_regex_ids = s_data.get('regex_ids', [])
                regexes_to_link = []
                for old_r_id in old_regex_ids:
                    new_r_id = old_to_new_regex_ids.get(old_r_id)
                    if new_r_id:
                        regex_obj = db.session.get(RegexPattern, new_r_id)
                        if regex_obj: regexes_to_link.append(regex_obj)
                service_to_update.regexes = regexes_to_link
                db.session.add(service_to_update)

            # 10. Vincular Relaciones a Usuarios y Crear Correos Permitidos
            for item in users_to_create_phase2:
                u_data = item['old_data']
                new_user_id = item['new_obj'].id
                user_to_update = db.session.get(User, new_user_id)
                if not user_to_update:
                    current_app.logger.warning(f"(Fase 2) No se encontró usuario {new_user_id} para vincular relaciones.")
                    continue

                # Vincular Regex permitidos
                old_regex_ids = u_data.get('allowed_regex_ids', [])
                regexes_to_link = []
                for old_r_id in old_regex_ids:
                    new_r_id = old_to_new_regex_ids.get(old_r_id)
                    if new_r_id:
                        regex_obj = db.session.get(RegexPattern, new_r_id)
                        if regex_obj: regexes_to_link.append(regex_obj)
                user_to_update.regexes_allowed = regexes_to_link

                # Vincular Filtros permitidos
                old_filter_ids = u_data.get('allowed_filter_ids', [])
                filters_to_link = []
                for old_f_id in old_filter_ids:
                    new_f_id = old_to_new_filter_ids.get(old_f_id)
                    if new_f_id:
                        filter_obj = db.session.get(Filter, new_f_id)
                        if filter_obj: filters_to_link.append(filter_obj)
                user_to_update.filters_allowed = filters_to_link

                # Vincular Servicios permitidos
                old_service_ids = u_data.get('allowed_service_ids', [])
                services_to_link = []
                for old_s_id in old_service_ids:
                    new_s_id = old_to_new_service_ids.get(old_s_id)
                    if new_s_id:
                        service_obj = db.session.get(ServiceModel, new_s_id)
                        if service_obj: services_to_link.append(service_obj)
                user_to_update.services_allowed = services_to_link
                
                # Vincular Defaults para subusuarios (si es padre)
                old_default_regex_ids = u_data.get('default_regex_ids_for_subusers', [])
                default_regex_to_link = []
                for old_dr_id in old_default_regex_ids:
                    new_dr_id = old_to_new_regex_ids.get(old_dr_id)
                    if new_dr_id:
                        regex_obj = db.session.get(RegexPattern, new_dr_id)
                        if regex_obj: default_regex_to_link.append(regex_obj)
                user_to_update.default_regexes_for_subusers = default_regex_to_link
                
                old_default_filter_ids = u_data.get('default_filter_ids_for_subusers', [])
                default_filters_to_link = []
                for old_df_id in old_default_filter_ids:
                    new_df_id = old_to_new_filter_ids.get(old_df_id)
                    if new_df_id:
                        filter_obj = db.session.get(Filter, new_df_id)
                        if filter_obj: default_filters_to_link.append(filter_obj)
                user_to_update.default_filters_for_subusers = default_filters_to_link

                # Crear Correos Permitidos (si existen en los datos)
                allowed_emails_list = u_data.get('allowed_emails', [])
                if allowed_emails_list:
                    for email_str in allowed_emails_list:
                        if email_str: # Evitar vacíos
                            db.session.add(AllowedEmail(user_id=new_user_id, email=email_str))

                db.session.add(user_to_update)

            db.session.commit()

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error FASE 2 importación (vinculación): {e}", exc_info=True)
            flash(f'Error en la fase 2 de importación (vinculación): {e}', 'danger')
            return redirect(url_for('admin_bp.dashboard'))
        # --- FIN TRANSACCIÓN 2 ---

        flash('Configuración (incl. usuarios y vínculos) importada correctamente.', 'success')

    except json.JSONDecodeError:
        db.session.rollback()
        flash('Error: El archivo no es un JSON válido.', 'danger')
    except KeyError as e:
        db.session.rollback()
        flash(f'Error: Falta la clave "{e}" en el archivo JSON.', 'danger')

    return redirect(url_for('admin_bp.dashboard'))

# --- Fin Rutas Importar/Exportar ---
