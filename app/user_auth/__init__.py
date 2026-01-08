from flask import Blueprint

# Definir el blueprint
user_auth_bp = Blueprint("user_auth_bp", __name__)

@user_auth_bp.context_processor
def inject_worksheet_access():
    try:
        from app.store.routes import user_has_worksheet_access
        return {"user_has_worksheet_access": user_has_worksheet_access}
    except ImportError:
        # Si no se puede importar, devolver una función que siempre retorna False
        def dummy_worksheet_access(user):
            return False
        return {"user_has_worksheet_access": dummy_worksheet_access}

# Importar las rutas después de definir el blueprint
from . import routes
