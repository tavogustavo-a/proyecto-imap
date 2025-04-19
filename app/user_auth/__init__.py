from flask import Blueprint

# Definir el blueprint
user_auth_bp = Blueprint("user_auth_bp", __name__)

# Importar las rutas después de definir el blueprint
from . import routes
