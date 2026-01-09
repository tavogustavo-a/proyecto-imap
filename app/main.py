# app/main.py

from flask import Blueprint, render_template, abort
from app.models.service import ServiceModel
from app.models.settings import SiteSettings
from app.models import IMAPServer2
from app.extensions import db

main_bp = Blueprint("main_bp", __name__)

@main_bp.context_processor
def inject_worksheet_access():
    try:
        from app.store.routes import user_has_worksheet_access
        return {"user_has_worksheet_access": user_has_worksheet_access}
    except ImportError:
        # Si no se puede importar, devolver una función que siempre retorna False
        def dummy_worksheet_access(user):
            return False
        return {"user_has_worksheet_access": dummy_worksheet_access}

# ✅ NUEVO: Ruta para favicon.ico para evitar error 404
@main_bp.route('/favicon.ico')
def favicon():
    """Servir favicon.svg directamente con tipo MIME correcto"""
    from flask import send_from_directory, current_app
    import os
    favicon_path = os.path.join(current_app.static_folder, 'images', 'favicon.svg')
    if os.path.exists(favicon_path):
        return send_from_directory(
            os.path.join(current_app.static_folder, 'images'),
            'favicon.svg',
            mimetype='image/svg+xml'
        )
    return '', 404

@main_bp.route("/", methods=["GET"])
def home():
    from flask import session
    from app.models.user import User
    
    # logo_enabled = SiteSettings.query.filter_by(key="logo_enabled").first()
    search_message = SiteSettings.query.filter_by(key="search_message").first()

    # Tomar servicios con visibility_mode != 'off'
    all_visible = ServiceModel.query.filter(ServiceModel.visibility_mode != "off").all()

    def priority_key(s):
        return abs(s.position)*2 + (1 if s.position > 0 else 0)

    services_sorted = sorted(all_visible, key=priority_key)
    default_service_id = services_sorted[0].id if services_sorted else None

    services_in_rows = [services_sorted[i:i+2] for i in range(0, len(services_sorted), 2)]

    # Obtener usuario actual
    current_user = None
    username = session.get('username')
    user_id = session.get('user_id')
    
    if username:
        current_user = User.query.filter_by(username=username).first()
    elif user_id:
        current_user = User.query.get(user_id)

    # El botón SMS siempre será visible si el servicio SMS está activo
    # La validación de permisos se hace al buscar (en search_sms_messages)
    # No necesitamos verificar permisos aquí para mostrar el botón

    return render_template(
        "search.html",
        # logo_on=(logo_enabled.value == "true" if logo_enabled else False),
        main_message=(search_message.value if search_message else ""),
        services_in_rows=services_in_rows,
        default_service_id=default_service_id,
        current_user=current_user
    )

@main_bp.route("/<path:route_path>", methods=["GET"])
def dynamic_imap2_route(route_path):
    """
    Ruta dinámica para páginas de códigos basadas en route_path de IMAPServer2.
    Ejemplo: /codigos3, /pagina2, /web
    
    IMPORTANTE: Esta ruta solo se ejecuta si ninguna otra ruta más específica coincide.
    Flask procesa las rutas en orden de registro, y las rutas con prefijos específicos
    (como /admin, /auth, /tienda, etc.) tienen prioridad.
    
    PROTECCIÓN: Verificamos que la ruta no empiece con prefijos de otros blueprints
    para evitar conflictos.
    """
    from flask import session, request, current_app
    from app.models.user import User
    
    # Lista de prefijos de rutas existentes que NO deben ser capturadas por esta ruta dinámica
    # Estos son los prefijos de los blueprints registrados en app/__init__.py
    EXCLUDED_PREFIXES = [
        'admin',      # /admin/* - admin_bp
        'auth',       # /auth/* - auth_bp
        'tienda',     # /tienda/* - store_bp
        'api',        # /api/* - api_bp
        'smtp',       # /smtp/* - smtp_server_bp
        'usuario',    # /usuario/* - user_auth_bp
        'subusers',   # /subusers/* - subuser_bp
        'static',     # /static/* - Flask maneja esto automáticamente
    ]
    
    # Rutas específicas que también deben ser excluidas
    EXCLUDED_ROUTES = [
        'favicon.ico',
        'robots.txt',
        'sitemap.xml',
    ]
    
    # Normalizar la ruta (sin barras iniciales/finales y en minúsculas)
    route_normalized = route_path.lower().strip('/')
    
    # Verificar contra rutas específicas excluidas
    if route_normalized in EXCLUDED_ROUTES:
        abort(404)
    
    # Verificar que la ruta no empiece con ningún prefijo excluido
    for prefix in EXCLUDED_PREFIXES:
        if route_normalized.startswith(prefix + '/') or route_normalized == prefix:
            # Esta ruta pertenece a otro blueprint, devolver 404
            abort(404)
    
    # Verificación adicional: si la ruta contiene caracteres no permitidos para URLs
    # (protección básica contra intentos de acceso malicioso)
    import re
    if not re.match(r'^[a-zA-Z0-9_\-/]+$', route_path):
        abort(404)
    
    # Buscar servidor IMAP2 con este route_path
    # Flask ya pasa route_path sin el / inicial, así que lo agregamos
    route_path_with_slash = '/' + route_path if not route_path.startswith('/') else route_path
    
    # Buscar con y sin slash por si acaso
    imap_server = IMAPServer2.query.filter(
        (IMAPServer2.route_path == route_path_with_slash) | 
        (IMAPServer2.route_path == route_path)
    ).filter_by(enabled=True).first()
    
    if not imap_server:
        # Si no existe, devolver 404
        abort(404)
    
    # Obtener usuario actual
    current_user = None
    username = session.get('username')
    user_id = session.get('user_id')
    
    if username:
        current_user = User.query.filter_by(username=username).first()
    elif user_id:
        current_user = User.query.get(user_id)
    
    # Obtener servicios con visibility_mode != 'off' (igual que en home)
    all_visible = ServiceModel.query.filter(ServiceModel.visibility_mode != "off").all()
    
    def priority_key(s):
        return abs(s.position)*2 + (1 if s.position > 0 else 0)
    
    services_sorted = sorted(all_visible, key=priority_key)
    default_service_id = services_sorted[0].id if services_sorted else None
    services_in_rows = [services_sorted[i:i+2] for i in range(0, len(services_sorted), 2)]
    
    # Obtener filtros y regex asociados a este servidor
    associated_filter_ids = [f.id for f in imap_server.filters]
    associated_regex_ids = [r.id for r in imap_server.regexes]
    
    return render_template(
        "search_imap2_dynamic.html",
        imap_server=imap_server,
        paragraph=imap_server.paragraph,
        services_in_rows=services_in_rows,
        default_service_id=default_service_id,
        current_user=current_user,
        associated_filter_ids=associated_filter_ids,
        associated_regex_ids=associated_regex_ids
    )
