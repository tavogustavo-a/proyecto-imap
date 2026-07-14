# app/main.py

from flask import Blueprint, render_template, abort, redirect, url_for
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


def is_imap2_accessible(imap_server):
    """
    Verifica si un servidor IMAP2 es accesible.
    Un servidor es accesible si:
    1. Está habilitado (enabled=True), O
    2. Tiene al menos un servidor IMAP vinculado habilitado
    """
    if imap_server.enabled:
        return True
    
    # Si el servidor principal está deshabilitado, verificar si hay servidores vinculados activos
    linked_servers = imap_server.linked_imap_servers.filter_by(enabled=True).all()
    return len(linked_servers) > 0

def get_imap2_by_custom_domain(request):
    """
    Busca un servidor IMAP2 por dominio personalizado.
    Retorna el servidor si existe y es accesible, None si no.
    """
    # Obtener el dominio desde el header Host o X-Forwarded-Host (para proxies reversos)
    host_header = request.headers.get('X-Forwarded-Host') or request.headers.get('Host', '')
    if not host_header:
        return None
    
    # Normalizar: convertir a minúsculas, remover espacios, remover puerto
    host_domain = host_header.lower().strip().split(':')[0]
    
    # Buscar servidor IMAP2 con este dominio personalizado (comparación case-insensitive)
    # NO filtrar por enabled aquí, lo verificaremos después
    imap_server_by_domain = IMAPServer2.query.filter(
        db.func.lower(IMAPServer2.custom_domain) == host_domain
    ).first()
    
    # Verificar si es accesible (habilitado o tiene servidores vinculados activos)
    if imap_server_by_domain and is_imap2_accessible(imap_server_by_domain):
        return imap_server_by_domain
    
    return None

# ✅ NUEVO: Ruta para favicon.ico para evitar error 404
@main_bp.route('/.well-known/assetlinks.json')
def android_assetlinks():
    """
    Digital Asset Links para App Links (deep links verificados).
    ANDROID_APP_PACKAGE: uno o varios packages separados por coma
      (nativa + Capacitor).
    ANDROID_APP_SHA256_FINGERPRINTS: huellas SHA-256 del/los keystore(s),
      separadas por coma. Formato: AA:BB:CC:...
    """
    from flask import current_app, jsonify
    import os

    raw_packages = (
        current_app.config.get('ANDROID_APP_PACKAGE')
        or os.getenv('ANDROID_APP_PACKAGE')
        or 'com.imap.storeclient'
    )
    packages = []
    for part in str(raw_packages).replace(';', ',').split(','):
        pkg = part.strip()
        if pkg:
            packages.append(pkg)

    raw = (
        current_app.config.get('ANDROID_APP_SHA256_FINGERPRINTS')
        or os.getenv('ANDROID_APP_SHA256_FINGERPRINTS')
        or ''
    )
    fingerprints = []
    for part in str(raw).replace(';', ',').split(','):
        fp = part.strip().upper()
        if not fp:
            continue
        # Normalizar sin separadores → con :
        if ':' not in fp and len(fp) == 64:
            fp = ':'.join(fp[i : i + 2] for i in range(0, 64, 2))
        fingerprints.append(fp)

    if not fingerprints or not packages:
        # Sin huellas configuradas: respuesta vacía (App Links no se verifican aún)
        return jsonify([]), 200

    payload = [
        {
            'relation': ['delegate_permission/common.handle_all_urls'],
            'target': {
                'namespace': 'android_app',
                'package_name': package,
                'sha256_cert_fingerprints': fingerprints,
            },
        }
        for package in packages
    ]
    resp = jsonify(payload)
    resp.headers['Content-Type'] = 'application/json'
    return resp


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


def _public_branding_for_legal_pages():
    """Nombre / host / URL públicos para páginas legales (privacidad, borrado de cuenta)."""
    from datetime import date
    from urllib.parse import urlparse

    from flask import current_app

    from branding_domain import brand_suffix_from_hostname, load_site_branding

    def _is_public_host(hostname: str) -> bool:
        h = (hostname or '').strip().lower().rstrip('.')
        if not h:
            return False
        if h in ('localhost', '127.0.0.1', '0.0.0.0', '::1'):
            return False
        if h.startswith('127.') or h.endswith('.local'):
            return False
        parts = h.split('.')
        if len(parts) == 4 and all(p.isdigit() for p in parts):
            return False
        if '.' not in h or not h[0].isalpha():
            return False
        return True

    def _pretty_brand(suffix: str, host: str) -> str:
        s = (suffix or '').strip().lower()
        if s and not s.isdigit() and any(c.isalpha() for c in s):
            return s[:1].upper() + s[1:]
        if _is_public_host(host):
            label = host.split('.')[0]
            if label and label[0].isalpha() and not label.isdigit():
                return label[:1].upper() + label[1:]
        return 'esta plataforma'

    branding = load_site_branding() or {}
    site_url = (branding.get('site_url') or '').strip().rstrip('/')
    host = (branding.get('hostname_no_www') or branding.get('hostname') or '').strip().lower()
    brand_suffix = (branding.get('brand_suffix') or '').strip()

    if not _is_public_host(host):
        host = ''
        site_url = ''
        brand_suffix = ''
        cfg_url = (current_app.config.get('PUBLIC_SITE_URL') or '').strip().rstrip('/')
        try:
            cfg_host = (urlparse(cfg_url).hostname or '').lower() if cfg_url else ''
        except Exception:
            cfg_host = ''
        if _is_public_host(cfg_host):
            host = cfg_host[4:] if cfg_host.startswith('www.') else cfg_host
            site_url = cfg_url
            brand_suffix = brand_suffix_from_hostname(host)

    brand_name = _pretty_brand(brand_suffix, host)
    if not _is_public_host(host):
        host = ''
        site_url = ''
    elif site_url and not _is_public_host(urlparse(site_url).hostname or ''):
        site_url = f'https://{host}'

    return {
        'brand_name': brand_name,
        'brand_host': host,
        'site_url': site_url,
        'privacy_updated': date.today().isoformat(),
    }


@main_bp.route('/privacidad', methods=['GET'])
def privacy_policy():
    """Política de privacidad genérica por proyecto (DOMINIO.txt / branding)."""
    ctx = _public_branding_for_legal_pages()
    return render_template('privacy_policy.html', **ctx)


@main_bp.route('/eliminar-cuenta', methods=['GET'])
@main_bp.route('/delete-account', methods=['GET'])
def account_deletion_request():
    """
    Página pública exigida por Google Play: solicitar borrado de cuenta y datos asociados.
    """
    ctx = _public_branding_for_legal_pages()
    return render_template('account_deletion.html', **ctx)


@main_bp.route("/", methods=["GET"])
def home():
    from flask import session, request
    from app.models.user import User
    from app.admin.site_settings import get_site_setting
    
    # Verificar si hay un dominio personalizado configurado para la raíz
    imap_server_by_domain = get_imap2_by_custom_domain(request)
    if imap_server_by_domain:
        # Si hay un dominio personalizado configurado, servir esa página
        return render_imap2_page(imap_server_by_domain, session)
    
    # Verificar si el acceso libre está habilitado
    public_access_enabled = get_site_setting('public_access_enabled', 'true')
    
    # Si el acceso libre está deshabilitado, verificar si el usuario está logueado
    if public_access_enabled != 'true':
        # Verificar si hay sesión activa (admin o usuario)
        if not session.get('logged_in'):
            # Redirigir a la página de login de usuarios
            return redirect(url_for('user_auth_bp.login'))
    
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

    codigos_view_prefs = {}
    if current_user:
        cp = getattr(current_user, 'codigos_view_prefs', None)
        if isinstance(cp, dict):
            try:
                from app.store.routes import _sanitize_codigos_view_prefs
                codigos_view_prefs = _sanitize_codigos_view_prefs(cp)
            except Exception:
                codigos_view_prefs = {}

    return render_template(
        "search.html",
        # logo_on=(logo_enabled.value == "true" if logo_enabled else False),
        main_message=(search_message.value if search_message else ""),
        services_in_rows=services_in_rows,
        default_service_id=default_service_id,
        current_user=current_user,
        codigos_view_prefs=codigos_view_prefs,
    )

def render_imap2_page(imap_server, session):
    """Función auxiliar para renderizar una página IMAP2"""
    from app.models.user import User
    
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
        background_image=imap_server.background_image,
        services_in_rows=services_in_rows,
        default_service_id=default_service_id,
        current_user=current_user,
        associated_filter_ids=associated_filter_ids,
        associated_regex_ids=associated_regex_ids
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
    
    # PRIMERO: Verificar si hay un dominio personalizado configurado
    # Si hay un dominio personalizado, tiene prioridad absoluta sobre la ruta
    # Esto permite dominios con path (ej. ejemplo.com/codigos4) además de la raíz.
    imap_server_by_domain = get_imap2_by_custom_domain(request)
    if imap_server_by_domain:
        # Si hay un dominio personalizado configurado, servir esa página
        # (ignorar la ruta, el dominio personalizado tiene prioridad)
        return render_imap2_page(imap_server_by_domain, session)
    
    # SEGUNDO: Si no hay dominio personalizado, buscar por route_path (comportamiento normal)
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
        '.well-known',  # App Links / assetlinks.json
    ]
    
    # Rutas específicas que también deben ser excluidas
    EXCLUDED_ROUTES = [
        'favicon.ico',
        'robots.txt',
        'sitemap.xml',
        '.well-known/assetlinks.json',
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
    # NO filtrar por enabled aquí, lo verificaremos después
    imap_server = IMAPServer2.query.filter(
        (IMAPServer2.route_path == route_path_with_slash) | 
        (IMAPServer2.route_path == route_path)
    ).first()
    
    if not imap_server:
        # Si no existe, devolver 404
        abort(404)
    
    # Verificar si es accesible (habilitado o tiene servidores vinculados activos)
    if not is_imap2_accessible(imap_server):
        # Si no es accesible, devolver 404
        abort(404)
    
    return render_imap2_page(imap_server, session)
