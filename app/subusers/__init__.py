# app/subusers/__init__.py

from flask import Blueprint
subuser_bp = Blueprint("subuser_bp", __name__)

@subuser_bp.context_processor
def inject_worksheet_access():
    try:
        from app.store.routes import user_has_worksheet_access
        return {"user_has_worksheet_access": user_has_worksheet_access}
    except ImportError:
        # Si no se puede importar, devolver una función que siempre retorna False
        def dummy_worksheet_access(user):
            return False
        return {"user_has_worksheet_access": dummy_worksheet_access}

from . import routes  # Importamos las rutas del sub-usuario
