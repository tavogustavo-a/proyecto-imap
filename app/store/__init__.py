from flask import Blueprint, url_for, request
from decimal import Decimal, InvalidOperation
import os
import re
from .models import Product, Sale
from app.store.models import WorksheetTemplate, WorksheetData
from app.store.api import api_bp

store_bp = Blueprint(
    'store_bp',
    __name__,
    template_folder='templates',
    static_folder=os.path.join(os.path.dirname(__file__), 'static'),
    static_url_path='/store/static'
)


@store_bp.after_request
def add_microphone_permission_header(response):
    """Permitir permiso de micrófono para grabación de audio en chat"""
    response.headers['Permissions-Policy'] = 'microphone=(self), camera=()'
    return response


@store_bp.app_template_filter('rewrite_external_images')
def rewrite_external_images_filter(html):
    """Reescribe img src externos para usar proxy local y evitar CORB/CORS."""
    if not html or not isinstance(html, str):
        return html
    try:
        host = request.host if request else ''
        def replace_src(m):
            full_url = m.group(1)
            if not full_url.startswith(('http://', 'https://')):
                return m.group(0)
            from urllib.parse import urlparse
            parsed = urlparse(full_url)
            if parsed.netloc and host and (parsed.netloc in host or host in parsed.netloc):
                return m.group(0)
            proxy_url = url_for('store_bp.proxy_image', url=full_url, _external=True)
            return f'src="{proxy_url}"'
        return re.sub(r'src="([^"]+)"', replace_src, html)
    except Exception:
        return html


@store_bp.app_template_filter('decimal')
def decimal_filter(value):
    if value is None:
        return Decimal('0')
    try:
        if isinstance(value, (int, float, Decimal)):
            return Decimal(str(value))
        if isinstance(value, str):
            # Limpiar la cadena de caracteres no numéricos excepto punto decimal
            cleaned = ''.join(c for c in value if c.isdigit() or c == '.')
            if cleaned:
                return Decimal(cleaned)
        return Decimal('0')
    except (InvalidOperation, TypeError, ValueError):
        return Decimal('0')

from . import routes
from . import routes_whatsapp  # noqa: F401 — registra rutas WhatsApp en store_bp
from . import routes_licencias  # noqa: F401 — registra rutas licencias en store_bp
from . import routes_historial  # noqa: F401 — registra rutas historial compras en store_bp

try:
    from app.store.mobile_push import register_mobile_push_listeners

    register_mobile_push_listeners()
except Exception:
    pass

# Contexto global para plantillas
@store_bp.context_processor
def inject_worksheet_access():
    from .routes import user_has_worksheet_access
    return dict(user_has_worksheet_access=user_has_worksheet_access)

# ✅ NUEVO: Cargar eventos de SocketIO solo cuando se use la tienda
def load_socketio_events():
    """Cargar eventos de SocketIO solo cuando se necesiten"""
    try:
        from . import socketio_events
        # Eventos de SocketIO de la tienda cargados correctamente
        return True
    except Exception as e:
        # Error al cargar eventos de SocketIO de la tienda
        return False
