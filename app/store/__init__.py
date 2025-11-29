from flask import Blueprint
from decimal import Decimal, InvalidOperation
import os
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
