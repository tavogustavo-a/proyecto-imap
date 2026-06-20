# app/admin/admin_settings.py

import os
import json
from datetime import datetime
from flask import (
    render_template, request, redirect,
    url_for, flash, current_app, jsonify,
    Response, session, make_response
)
from werkzeug.utils import secure_filename
from sqlalchemy import inspect
from . import admin_bp
from app.extensions import db
from app.models import (
    SiteSettings, IMAPServer, FilterModel as Filter,
    RegexModel as RegexPattern, User,
    ServiceModel,
    ServiceAlias as Alias,
    AliasIcon,
    service_regex, service_filter,
    AllowedEmail,
    ServiceIcon,
    ObserverIMAPServer,
    SecurityRule,
    IMAPServer2,
)
from app.models.settings import AppSecrets
from app.services.regex_service import regex_list_order_by
from app.admin.site_settings import (
    get_site_setting, set_site_setting
)
from app.admin.decorators import admin_required

def csrf_exempt_route(func):
    func._csrf_exempt = True
    return func

# Constantes de configuración interna
_ADMIN_MODULE_SIG = 0x1B3E
_ADMIN_MODULE_HASH = 0x4A2F

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
    
    # Excluir servidores IMAP que están vinculados a algún IMAP2 (son exclusivos de edit_imap2)
    # Obtener IDs de servidores vinculados a algún IMAP2
    from app.models.imap2 import imap2_linked_imap
    linked_imap_ids = db.session.query(imap2_linked_imap.c.imap_id).distinct().all()
    linked_imap_ids_list = [row[0] for row in linked_imap_ids]
    
    if linked_imap_ids_list:
        servers_query = servers_query.filter(~IMAPServer.id.in_(linked_imap_ids_list))
    
    if imap_search:
        servers_query = servers_query.filter(
            (IMAPServer.host.ilike(f"%{imap_search}%"))
            | (IMAPServer.username.ilike(f"%{imap_search}%"))
        )
    servers = servers_query.all()

    from app.models import ObserverIMAPServer, IMAPServer2
    observer_servers = ObserverIMAPServer.query.all()
    
    # Cargar servidores IMAP2
    imap2_search = request.args.get("imap2_search", "").strip().lower()
    servers2_query = IMAPServer2.query
    if imap2_search:
        servers2_query = servers2_query.filter(
            (IMAPServer2.host.ilike(f"%{imap2_search}%"))
            | (IMAPServer2.username.ilike(f"%{imap2_search}%"))
        )
    servers2 = servers2_query.all()

    # --- Cargar TODOS los SiteSettings en un diccionario ---
    all_settings = SiteSettings.query.all()
    site_settings_dict = {s.key: s.value for s in all_settings}
    # --- Fin carga ---



    # Obtener valores específicos que ya usabas, usando el dict o get_site_setting
    paragraph = site_settings_dict.get("search_message", "")
    paragraph_mode = site_settings_dict.get("search_message_mode", "off")
    paragraph2 = site_settings_dict.get("search_message2", "")
    paragraph2_mode = site_settings_dict.get("search_message2_mode", "off")
    # logo_enabled = site_settings_dict.get("logo_enabled", "true")
    # card_opacity y current_theme ya se usan en la plantilla con site_settings.get
    
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()

    return render_template(
        "admin_dashboard.html",
        servers=servers,
        servers2=servers2,
        observer_servers=observer_servers,
        paragraph=paragraph,
        paragraph_mode=paragraph_mode,
        paragraph2=paragraph2,
        paragraph2_mode=paragraph2_mode,
        # card_opacity=card_opacity, # Ya no es necesario, la plantilla usa site_settings.get
        # current_theme=current_theme, # Ya no es necesario
        site_settings=site_settings_dict, # <-- PASAR EL DICCIONARIO A LA PLANTILLA
        admin_user=admin_user
    )

@admin_bp.route("/toggle_email_buzon_ajax", methods=["POST"])
@csrf_exempt_route
@admin_required
def toggle_email_buzon_ajax():
    """Activa/desactiva el buzón de mensajes (recepción SMTP / almacenamiento en ReceivedEmail)."""
    try:
        current = get_site_setting("email_buzon_enabled", "1")
        new_val = "0" if current == "1" else "1"
        set_site_setting("email_buzon_enabled", new_val)
        return jsonify({"success": True, "enabled": new_val == "1"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@admin_bp.route("/toggle_imap_management_ajax", methods=["POST"])
@csrf_exempt_route
@admin_required
def toggle_imap_management_ajax():
    """Compatibilidad: redirige al toggle del buzón (ya no controla el observador IMAP)."""
    return toggle_email_buzon_ajax()

@admin_bp.route("/filters")
@admin_required
def filters_page():
    filter_search = request.args.get("filter_search", "").strip().lower()

    filters_query = Filter.query
    if filter_search:
        filters_query = filters_query.filter(
            (Filter.sender.ilike(f"%{filter_search}%"))
            | (Filter.keyword.ilike(f"%{filter_search}%"))
        )
    filters_list = filters_query.all()

    return render_template(
        "filters.html",
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
    regex_list = regex_list_order_by(regexes_query).all()

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
    from app.utils.html_sanitize import sanitize_admin_message_html_str

    new_paragraph = sanitize_admin_message_html_str(request.form.get("paragraph", ""))
    if num_paragraph == 1:
        key = "search_message"
    elif num_paragraph == 2:
        key = "search_message2"
    else:
        flash("Número de párrafo inválido.", "error")
        return redirect(url_for("admin_bp.parrafos_page"))

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

@admin_bp.route("/logout_all_and_clear_cookies", methods=["GET", "POST"])
@csrf_exempt_route
@admin_required
def logout_all_and_clear_cookies():
    """
    Cierra sesión de todos los usuarios (admin, usuarios y sub-usuarios)
    y limpia todas las cookies del dominio.
    Solo se ejecuta una vez por solicitud.
    """
    from app.models import RememberDevice
    from app.auth.session_tokens import revoke_all_tokens
    
    # ✅ SEGURIDAD: Revocar todos los tokens de sesión
    revoke_all_tokens()
    
    RememberDevice.query.delete()
    db.session.commit()

    rev_str = get_site_setting("session_revocation_count", "0")
    new_count = int(rev_str) + 1
    set_site_setting("session_revocation_count", str(new_count))

    # Limpiar la sesión del admin actual
    session.clear()
    
    # Crear respuesta que limpia todas las cookies
    response = make_response(redirect(url_for("auth_bp.login")))
    
    # Obtener el nombre de la cookie de sesión de Flask desde la configuración
    session_cookie_name = current_app.config.get("SESSION_COOKIE_NAME", "session")
    
    # Obtener también el nombre desde la interfaz de sesión si está disponible
    try:
        session_cookie_name_from_interface = current_app.session_interface.get_cookie_name(current_app)
    except:
        session_cookie_name_from_interface = session_cookie_name
    
    # Lista de cookies conocidas que deben eliminarse
    known_cookies = [
        session_cookie_name,  # Cookie de sesión de Flask (desde config)
        session_cookie_name_from_interface,  # Cookie de sesión de Flask (desde interface)
        'remember_username',  # Cookie de recordar usuario
        'remember_2fa_device',  # Cookie de recordar dispositivo 2FA
        'session',  # Cookie de sesión alternativa (valor por defecto)
    ]
    
    # Eliminar duplicados manteniendo el orden
    known_cookies = list(dict.fromkeys(known_cookies))
    
    # Eliminar cookies conocidas
    for cookie_name in known_cookies:
        response.delete_cookie(
            cookie_name,
            path='/',
            domain=None,
            secure=False,
            httponly=True,
            samesite='Lax'
        )
    
    # Eliminar todas las cookies que el cliente envió
    for cookie_name in request.cookies:
        if cookie_name not in known_cookies:  # Evitar duplicados
            # Intentar eliminar con diferentes configuraciones
            response.delete_cookie(cookie_name, path='/', domain=None)
            response.delete_cookie(cookie_name, path='/')
            # También intentar con el dominio completo si está disponible
            if request.host:
                response.delete_cookie(cookie_name, path='/', domain=request.host)
    
    flash("Se han cerrado todas las sesiones y se han limpiado las cookies.", "info")
    return response

@admin_bp.route("/toggle_dark_mode", methods=["POST"])
@admin_required
def toggle_dark_mode():
    current_val = get_site_setting("dark_mode", "false")
    new_val = "false" if current_val == "true" else "true"
    set_site_setting("dark_mode", new_val)
    flash(f"Modo oscuro: {new_val}", "info")
    return redirect(url_for("admin_bp.dashboard"))

# --- Rutas para Importar/Exportar Configuración --- (AÑADIDO AL FINAL)

@admin_bp.route('/export_config')
@admin_required
def export_config():
    """Exporta la configuración completa del sistema a un archivo JSON."""
    submitted_code = request.args.get('security_code')
    actual_security_code = current_app.config.get('ADMIN_CONFIG_SECURITY_CODE', 'tu_codigo_secreto_aqui') 
    
    # --- MODIFICADO: Verificar código y devolver error JSON si es incorrecto --- 
    if not submitted_code or submitted_code != actual_security_code:

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
            "regexes": [r.to_dict() for r in RegexPattern.query.all()],
            "services": [s.to_dict(include_relations=True) for s in services_query],
            "security_rules": [r.to_dict() for r in SecurityRule.query.all()],
            # --- Añadir IMAP Servers al Export ---
            "imap_servers": [s.to_dict() for s in IMAPServer.query.all()],
            # --- Añadir Observer IMAP Servers al Export ---
            "observer_imap_servers": [s.to_dict() for s in ObserverIMAPServer.query.all()],
            # --- Añadir IMAP2 Servers al Export ---
            "imap2_servers": [s.to_dict(include_relations=True) for s in IMAPServer2.query.all()],
            # --- Añadir AppSecrets (CRÍTICO para descifrar contraseñas IMAP) ---
            "app_secrets": [
                {
                    'key_name': s.key_name,
                    'key_value': s.key_value
                } for s in AppSecrets.query.all()
            ]
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

        # --- Añadir Accesos a Códigos 2 al Export ---

        # --- Añadir Párrafos al Export ---
        paragraphs_data = {}
        paragraph_keys = [
            ('search_message', 'search_message_mode'),
            ('search_message2', 'search_message2_mode'),
        ]
        for content_key, mode_key in paragraph_keys:
            content_item = SiteSettings.query.filter_by(key=content_key).first()
            mode_item = SiteSettings.query.filter_by(key=mode_key).first()
            paragraphs_data[content_key] = content_item.value if content_item else ""
            paragraphs_data[mode_key] = mode_item.value if mode_item else "off"
        config_data["paragraphs"] = paragraphs_data
        # --- Fin Añadir Párrafos ---

        # 3. Convertir a JSON
        # Usar un serializador personalizado si hay tipos de datos complejos (como datetime)
        def default_serializer(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            raise TypeError(f"Object of type {obj.__class__.__name__} is not JSON serializable")

        json_data = json.dumps(config_data, indent=2, ensure_ascii=False, default=default_serializer)

        # 4. Crear la respuesta Flask
        response = Response(json_data, mimetype='application/json')
        response.headers['Content-Disposition'] = 'attachment; filename=configuracion_exportada.json'
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
        security_rules_data = config_data.get('security_rules', [])
        app_secrets_data = config_data.get('app_secrets', [])  # CRÍTICO: Claves de cifrado IMAP
        imap_servers_data = config_data.get('imap_servers', [])  # IMAP Servers
        observer_imap_data = config_data.get('observer_imap_servers', [])  # Observer IMAP Servers
        imap2_data = config_data.get('imap2_servers', [])  # IMAP2 Servers

        # --- INICIO TRANSACCIÓN 1: Borrar y Crear Objetos Base --- 
        try:
            admin_username = current_app.config.get("ADMIN_USER")
            
            # --- CRÍTICO: Importar AppSecrets PRIMERO (antes de servidores IMAP) ---
            # Esto es necesario para que las contraseñas encriptadas puedan descifrarse
            if app_secrets_data:
                # Borrar app_secrets existentes
                AppSecrets.query.delete()
                db.session.flush()
                
                # Crear nuevos app_secrets desde el backup
                for secret_data in app_secrets_data:
                    new_secret = AppSecrets(
                        key_name=secret_data.get('key_name'),
                        key_value=secret_data.get('key_value')
                    )
                    db.session.add(new_secret)
                db.session.flush()
                current_app.logger.info(f"✅ AppSecrets importados: {len(app_secrets_data)} claves")
            else:
                current_app.logger.warning("⚠️  No se encontraron AppSecrets en el archivo de importación. Las contraseñas IMAP pueden no funcionar.")
            # 5. BORRAR CONFIGURACIÓN ACTUAL (Incluyendo Usuarios, EXCEPTO admin)
            # Borrar dependencias primero (como AllowedEmail si tiene FK a User)
            AllowedEmail.query.delete()
            # Borrar dispositivos recordados
            from app.models import RememberDevice
            RememberDevice.query.delete()

            # --- Borrar tablas de asociación PRIMERO ---
            db.session.execute(service_regex.delete()) # Borrar vínculos Servicio <-> Regex
            db.session.execute(service_filter.delete()) # Borrar vínculos Servicio <-> Filtro
            # <<< --- AÑADIR BORRADO DE ASOCIACIONES DE USUARIO --- >>>
            from app.models.user import user_regex, user_filter, user_service # Asegurar importación
            db.session.execute(user_regex.delete())   # Borrar vínculos User <-> Regex
            db.session.execute(user_filter.delete())  # Borrar vínculos User <-> Filter
            db.session.execute(user_service.delete()) # Borrar vínculos User <-> Service
            # --- FIN Borrado Asociaciones ---

            # --- Borrar Usuarios (Excepto el admin principal) --- AHORA SÍ SE PUEDE
            users_to_drop = User.query.filter(User.username != admin_username).all()
            if users_to_drop:
                from app.services.user_deletion_cleanup import cleanup_disk_assets_for_user_ids

                cleanup_disk_assets_for_user_ids(
                    current_app._get_current_object(),
                    [u.id for u in users_to_drop],
                )
            User.query.filter(User.username != admin_username).delete()

            # Borrar el resto de objetos base
            AliasIcon.query.delete()
            Alias.query.delete()
            # ---> AÑADIR BORRADO EXPLÍCITO DE ServiceIcon <--- 
            from app.models import ServiceIcon # Asegurar importación si no está global
            ServiceIcon.query.delete()
            ServiceModel.query.delete() # Ahora sí se puede borrar servicios
            RegexPattern.query.delete()
            Filter.query.delete()
            # Borrar reglas de seguridad existentes
            SecurityRule.query.delete()
            # --- Borrar Observer IMAP y IMAP2 Servers ---
            from app.models.imap2 import IMAP2TwoFAConfig, imap2_filter, imap2_regex, imap2_linked_imap, imap2_users
            # Borrar relaciones M2M de IMAP2 primero
            db.session.execute(imap2_filter.delete())
            db.session.execute(imap2_regex.delete())
            db.session.execute(imap2_linked_imap.delete())
            db.session.execute(imap2_users.delete())
            # Borrar configuraciones 2FA de IMAP2
            IMAP2TwoFAConfig.query.delete()
            # Borrar servidores IMAP2, Observer IMAP e IMAP regulares
            IMAPServer2.query.delete()
            ObserverIMAPServer.query.delete()
            IMAPServer.query.delete()
            db.session.flush() # Aplicar borrados antes de recrear

            # 6. Crear nuevos objetos base y mapear IDs viejos a NUEVOS
            # Crear Filtros y Regex (como antes)
            if filters_data:
                # Verificar una sola vez si el modelo tiene el campo description
                try:
                    mapper = inspect(Filter)
                    filter_columns = [col.key for col in mapper.columns]
                    has_description_column = 'description' in filter_columns
                except:
                    # Fallback: verificar con hasattr
                    has_description_column = hasattr(Filter, 'description')
                
                for f_data in filters_data:
                    old_id = f_data.get('id') or f_data.get('original_id') # Compatibilidad
                    f_data_cleaned = {k: v for k, v in f_data.items() if k not in ['id', 'original_id']}
                    
                    # Manejar description según si el modelo lo soporta
                    if has_description_column:
                        # Si el modelo tiene description, asegurar que esté presente
                        if 'description' not in f_data_cleaned or not f_data_cleaned.get('description'):
                            f_data_cleaned['description'] = 'Sin descripción'
                    else:
                        # Si el modelo NO tiene description, removerlo de los datos
                        f_data_cleaned.pop('description', None)
                    
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
            
            # 6.5. Crear Servicios (sin relaciones ManyToMany todavía)
            # Solo columnas mapeadas (evita fallos si el JSON trae claves nuevas y el modelo local no)
            try:
                _service_column_keys = {c.key for c in inspect(ServiceModel).columns}
            except Exception:
                _service_column_keys = None
            services_to_create = []
            if original_services_data:
                for s_data in original_services_data:
                    old_id = s_data.get('id') or s_data.get('original_id')
                    # Limpiar datos: excluir IDs, relaciones M2M (se harán en fase 2), aliases e iconos
                    s_data_cleaned = {
                        k: v for k, v in s_data.items() 
                        if k not in [
                            'id', 'original_id',
                            'filter_ids', 'regex_ids', 'aliases', 'service_icon_names', 'service_icons'
                        ]
                    }
                    if _service_column_keys is not None:
                        s_data_cleaned = {
                            k: v for k, v in s_data_cleaned.items() if k in _service_column_keys
                        }
                    new_service = ServiceModel(**s_data_cleaned)
                    db.session.add(new_service)
                    db.session.flush()
                    if old_id is not None and new_service.id is not None:
                        old_to_new_service_ids[old_id] = new_service.id
                        services_to_create.append({'new_obj': new_service, 'old_data': s_data})
            
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
                                'original_id', 'parent_id',
                                'allowed_regex_ids', 'allowed_filter_ids', 'allowed_service_ids',
                                'default_regex_ids_for_subusers', 'default_filter_ids_for_subusers',
                                'allowed_emails', 'created_at', 'updated_at'
                            ]
                        }
                        # Restaurar la contraseña hasheada del archivo JSON
                        u_data_cleaned['password'] = u_data.get('password')
                        new_user = User(**u_data_cleaned)
                        db.session.add(new_user)
                        db.session.flush() # Obtener el nuevo ID
                        if old_user_id is not None and new_user.id is not None:
                            old_to_new_user_ids[old_user_id] = new_user.id
                            users_to_create_phase2.append({'new_obj': new_user, 'old_data': u_data})
                        else:
                            pass
                # Fase 7.2: Crear sub-usuarios (parent_id existe)
                for u_data in users_data:
                    old_parent_id = u_data.get('parent_id')
                    if old_parent_id is not None:
                        new_parent_id = old_to_new_user_ids.get(old_parent_id)
                        if new_parent_id is None:

                            continue # Saltar este subusuario
                        
                        old_user_id = u_data.get('original_id')
                        u_data_cleaned = {
                            k: v for k, v in u_data.items() 
                            if k not in [
                                'original_id', 'parent_id',
                                'allowed_regex_ids', 'allowed_filter_ids', 'allowed_service_ids',
                                'default_regex_ids_for_subusers', 'default_filter_ids_for_subusers',
                                'allowed_emails', 'created_at', 'updated_at'
                            ]
                        }
                        # Restaurar la contraseña hasheada del archivo JSON
                        u_data_cleaned['password'] = u_data.get('password')
                        u_data_cleaned['parent_id'] = new_parent_id # Asignar nuevo parent_id

                        new_user = User(**u_data_cleaned)
                        db.session.add(new_user)
                        db.session.flush()
                        if old_user_id is not None and new_user.id is not None:
                            old_to_new_user_ids[old_user_id] = new_user.id
                            users_to_create_phase2.append({'new_obj': new_user, 'old_data': u_data})
                        else:
                            pass
            # 8. Crear reglas de seguridad
            if security_rules_data:
                for rule_data in security_rules_data:
                    rule_data_cleaned = {k: v for k, v in rule_data.items() if k != 'id'}
                    new_rule = SecurityRule(**rule_data_cleaned)
                    db.session.add(new_rule)
            
            # --- Crear IMAP Servers ---
            if imap_servers_data:
                for imap_data in imap_servers_data:
                    imap_data_cleaned = {k: v for k, v in imap_data.items() if k not in ['id', 'original_id']}
                    new_imap = IMAPServer(**imap_data_cleaned)
                    db.session.add(new_imap)
            
            # --- Crear Observer IMAP Servers ---
            if observer_imap_data:
                for obs_data in observer_imap_data:
                    obs_data_cleaned = {k: v for k, v in obs_data.items() if k not in ['id', 'original_id']}
                    new_observer = ObserverIMAPServer(**obs_data_cleaned)
                    db.session.add(new_observer)
            
            # --- Crear IMAP2 Servers (sin relaciones M2M todavía) ---
            imap2_to_create_phase2 = []
            old_to_new_imap2_ids = {}
            if imap2_data:
                for imap2_data_item in imap2_data:
                    old_imap2_id = imap2_data_item.get('original_id')
                    # Limpiar datos: excluir IDs y relaciones M2M (se harán en fase 2)
                    imap2_data_cleaned = {
                        k: v for k, v in imap2_data_item.items()
                        if k not in ['original_id', 'filter_ids', 'regex_ids', 'linked_imap_ids', 'allowed_user_ids', 'twofa_configs']
                    }
                    new_imap2 = IMAPServer2(**imap2_data_cleaned)
                    db.session.add(new_imap2)
                    db.session.flush()
                    if old_imap2_id is not None and new_imap2.id is not None:
                        old_to_new_imap2_ids[old_imap2_id] = new_imap2.id
                        imap2_to_create_phase2.append({'new_obj': new_imap2, 'old_data': imap2_data_item})
            
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
                
                # Crear Aliases del servicio
                aliases_data = s_data.get('aliases', [])
                for alias_data in aliases_data:
                    new_alias = Alias(
                        service_id=new_service_id,
                        alias_name=alias_data.get('alias_name'),
                        border_color=alias_data.get('border_color', '#000000'),
                        gradient_color=alias_data.get('gradient_color', '#000000'),
                        enabled=alias_data.get('enabled', True)
                    )
                    db.session.add(new_alias)
                    db.session.flush()
                    
                    # Crear iconos del alias
                    alias_icons = alias_data.get('alias_icons', [])
                    for icon_name in alias_icons:
                        new_alias_icon = AliasIcon(
                            alias_id=new_alias.id,
                            icon_name=icon_name
                        )
                        db.session.add(new_alias_icon)
                
                # Crear ServiceIcons del servicio
                service_icon_names = s_data.get('service_icon_names', [])
                for icon_name in service_icon_names:
                    new_service_icon = ServiceIcon(
                        service_id=new_service_id,
                        icon_name=icon_name
                    )
                    db.session.add(new_service_icon)

            # 10. Vincular Relaciones a Usuarios y Crear Correos Permitidos
            for item in users_to_create_phase2:
                u_data = item['old_data']
                new_user_id = item['new_obj'].id
                user_to_update = db.session.get(User, new_user_id)
                if not user_to_update:

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

            # --- Vincular Relaciones M2M de IMAP2 Servers ---
            from app.models.imap2 import IMAP2TwoFAConfig, imap2_filter, imap2_regex, imap2_linked_imap, imap2_users
            for item in imap2_to_create_phase2:
                imap2_data_item = item['old_data']
                new_imap2_id = item['new_obj'].id
                imap2_to_update = db.session.get(IMAPServer2, new_imap2_id)
                if not imap2_to_update:
                    continue
                
                # Vincular Filtros
                old_filter_ids = imap2_data_item.get('filter_ids', [])
                filters_to_link = []
                for old_f_id in old_filter_ids:
                    new_f_id = old_to_new_filter_ids.get(old_f_id)
                    if new_f_id:
                        filter_obj = db.session.get(Filter, new_f_id)
                        if filter_obj:
                            filters_to_link.append(filter_obj)
                imap2_to_update.filters = filters_to_link
                
                # Vincular Regex
                old_regex_ids = imap2_data_item.get('regex_ids', [])
                regexes_to_link = []
                for old_r_id in old_regex_ids:
                    new_r_id = old_to_new_regex_ids.get(old_r_id)
                    if new_r_id:
                        regex_obj = db.session.get(RegexPattern, new_r_id)
                        if regex_obj:
                            regexes_to_link.append(regex_obj)
                imap2_to_update.regexes = regexes_to_link
                
                # Vincular IMAP Servers vinculados (linked_imap_servers)
                # Nota: Los IMAP servers vinculados deben existir en la base de datos
                # Si no existen, se saltan (no se crean automáticamente)
                old_linked_imap_ids = imap2_data_item.get('linked_imap_ids', [])
                linked_imaps_to_link = []
                for old_imap_id in old_linked_imap_ids:
                    # Los IMAP servers vinculados no se recrean, solo se vinculan si existen
                    imap_obj = db.session.get(IMAPServer, old_imap_id)
                    if imap_obj:
                        linked_imaps_to_link.append(imap_obj)
                imap2_to_update.linked_imap_servers = linked_imaps_to_link
                
                # Vincular Usuarios permitidos
                old_allowed_user_ids = imap2_data_item.get('allowed_user_ids', [])
                users_to_link = []
                for old_u_id in old_allowed_user_ids:
                    new_u_id = old_to_new_user_ids.get(old_u_id)
                    if new_u_id:
                        user_obj = db.session.get(User, new_u_id)
                        if user_obj:
                            users_to_link.append(user_obj)
                imap2_to_update.allowed_users = users_to_link
                
                # Crear configuraciones 2FA
                twofa_configs_data = imap2_data_item.get('twofa_configs', [])
                for twofa_data in twofa_configs_data:
                    new_twofa = IMAP2TwoFAConfig(
                        imap_server_id=new_imap2_id,
                        secret_key=twofa_data.get('secret_key'),
                        emails=twofa_data.get('emails'),
                        is_enabled=twofa_data.get('is_enabled', True)
                    )
                    db.session.add(new_twofa)
                
                db.session.add(imap2_to_update)

            db.session.commit()

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error FASE 2 importación (vinculación): {e}", exc_info=True)
            flash(f'Error en la fase 2 de importación (vinculación): {e}', 'danger')
            return redirect(url_for('admin_bp.dashboard'))
        # --- FIN TRANSACCIÓN 2 ---

        # --- INICIO TRANSACCIÓN 3: Importar Párrafos ---
        try:
            paragraphs_data = config_data.get('paragraphs', {})
            
            # Siempre procesar párrafos, incluso si el diccionario está vacío
            # Borrar todos los párrafos existentes antes de importar
            paragraph_keys_to_delete = [
                'search_message', 'search_message_mode',
                'search_message2', 'search_message2_mode'
            ]
            for key in paragraph_keys_to_delete:
                SiteSettings.query.filter_by(key=key).delete()
            db.session.flush()
            
            # Crear/restaurar párrafos del archivo importado
            paragraph_keys = [
                ('search_message', 'search_message_mode'),
                ('search_message2', 'search_message2_mode'),
            ]
            for content_key, mode_key in paragraph_keys:
                # Restaurar contenido del párrafo
                content_value = paragraphs_data.get(content_key, "") if isinstance(paragraphs_data, dict) else ""
                content_item = SiteSettings(key=content_key, value=content_value)
                db.session.add(content_item)
                
                # Restaurar modo del párrafo
                mode_value = paragraphs_data.get(mode_key, "off") if isinstance(paragraphs_data, dict) else "off"
                mode_item = SiteSettings(key=mode_key, value=mode_value)
                db.session.add(mode_item)
            
            db.session.commit()

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error FASE 3 importación (importación de párrafos): {e}", exc_info=True)
            flash(f'Error en la fase 3 de importación (importación de párrafos): {e}', 'danger')
            return redirect(url_for('admin_bp.dashboard'))
        # --- FIN TRANSACCIÓN 3 ---

        flash('Configuración (incl. usuarios y vínculos) importada correctamente.', 'success')

    except json.JSONDecodeError:
        db.session.rollback()
        flash('Error: El archivo no es un JSON válido.', 'danger')
    except KeyError as e:
        db.session.rollback()
        flash(f'Error: Falta la clave "{e}" en el archivo JSON.', 'danger')

    return redirect(url_for('admin_bp.dashboard'))

# --- Fin Rutas Importar/Exportar ---
