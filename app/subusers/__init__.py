# app/subusers/__init__.py

from flask import Blueprint
subuser_bp = Blueprint("subuser_bp", __name__)

from . import routes  # Importamos las rutas del sub-usuario
