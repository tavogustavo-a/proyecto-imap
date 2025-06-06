# app/__init__.py

import os
import sys  # <-- Importante para chequear argumentos de línea de comando
from dotenv import load_dotenv
# Aquí pueden ir imports de bibliotecas estándar de Python que no dependen de tu app o config.

# ESTE BLOQUE DEBE ESTAR AQUÍ, INMEDIATAMENTE DESPUÉS DE LOS IMPORTS BÁSICOS
# --- INICIO CARGA DE .ENV ---
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dotenv_path = os.path.join(project_root, '.env')

# Cargar .env si existe
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path)
    print(f"[INFO] Archivo .env cargado desde {dotenv_path}")
    # --- NUEVO PRINT DE DIAGNÓSTICO ---
    print(f"[DEBUG][app/__init__.py] Valor de SECRET_KEY después de load_dotenv: '{os.getenv('SECRET_KEY')}'")
    print(f"[DEBUG][app/__init__.py] Valor de FLASK_ENV después de load_dotenv: '{os.getenv('FLASK_ENV')}'")
    # --- FIN NUEVO PRINT DE DIAGNÓSTICO ---
else:
    # En producción, es posible que las variables de entorno ya estén definidas
    # en el sistema o a través del servidor WSGI, así que no fallar aquí,
    # pero es bueno saber si .env no se cargó.
    print(f"[INFO] Archivo .env no encontrado en {dotenv_path}. Se asumirá que las variables de entorno están predefinidas.")
# --- FIN CARGA DE .ENV ---

# Y LUEGO, DESPUÉS DEL BLOQUE ANTERIOR, DEBEN VENIR ESTAS IMPORTACIONES
from flask import Flask
print("[DEBUG][app/__init__.py] Importando Config...")
from config import Config
print("[DEBUG][app/__init__.py] Config importada.")
from werkzeug.security import generate_password_hash
from sqlalchemy import inspect
from flask_seasurf import SeaSurf
from app.extensions import db, migrate
from app.models import User  # <-- Importa tu modelo User

def create_app(config_class_passed=None):
    print("[DEBUG] Entrando a create_app")
    try:
        current_app = Flask(__name__)
        print(f"[DEBUG] Flask app instance creada: {current_app}")
    except Exception as e:
        print(f"[DEBUG] ERROR al crear Flask(__name__): {e}")
        raise # Re-lanzar el error para verlo completo

    # Determinar qué clase de configuración usar
    config_to_use = config_class_passed if config_class_passed else Config
    print(f"[DEBUG] Usando clase de configuración: {config_to_use}")

    try:
        current_app.config.from_object(config_to_use)
        print("[DEBUG] Configuración cargada desde objeto")
    except Exception as e:
        print(f"[DEBUG] ERROR al cargar config.from_object: {e}")
        raise

    # Renombrar la variable app para el resto de la función para evitar confusiones
    # y para que coincida con tu código original si quieres revertir fácilmente.
    app = current_app 

    print("[DEBUG] Inicializando SeaSurf...")
    SeaSurf(app)
    print("[DEBUG] Inicializando DB...")
    db.init_app(app)
    print("[DEBUG] Inicializando Migrate...")
    migrate.init_app(app, db)
    print("[DEBUG] Extensiones inicializadas")

    @app.context_processor
    def inject_admin_user():
        return {"ADMIN_USER": app.config["ADMIN_USER"]}

    with app.app_context():
        # ---------------------------------------------------------------------
        # El bloque de inicialización de datos (seed) ha sido eliminado de aquí.
        # Se moverá a un script de migración o comando de seed.
        # ---------------------------------------------------------------------
        pass # Puedes dejar 'pass' o simplemente eliminar el bloque 'with' si no hace nada más.

    # === Registro de Blueprints ===
    from app.auth.routes import auth_bp
    app.register_blueprint(auth_bp, url_prefix="/auth")

    from app.admin import admin_bp
    app.register_blueprint(admin_bp, url_prefix="/admin")

    from app.main import main_bp
    app.register_blueprint(main_bp)

    from app.api import api_bp
    app.register_blueprint(api_bp, url_prefix="/api")

    # Registrar el blueprint de autenticación de usuario
    try:
        from app.user_auth import user_auth_bp
        app.register_blueprint(user_auth_bp, url_prefix="/usuario")
        print("=== Blueprint user_auth_bp registrado correctamente ===")
    except ImportError as e:
        print(f"[ADVERTENCIA] No se encontró user_auth_bp: {str(e)}")

    from app.subusers import subuser_bp
    app.register_blueprint(subuser_bp, url_prefix="/subusers")

    # Registrar comandos CLI personalizados
    try:
        from app.cli_commands import register_cli_commands
        register_cli_commands(app)
    except Exception as cli_err:
        print(f"[WARN] No se pudieron registrar comandos CLI: {cli_err}")

    from sqlalchemy import inspect as insp2

    @app.context_processor
    def inject_site_settings():
        # Intentamos obtener las settings, pero sin crear/modificar si no existen aquí.
        settings_dict = {
            "search_message": "",
            "logo_enabled": "true",
            "card_opacity": "0.8",
            "current_theme": "tema1",
            "dark_mode": "false",
            "current_gif": "gif1", # Dejamos el default inicial
            "search_message_mode": "off",
            "search_message2": "",
            "search_message2_mode": "off",
        }
        try:
            inspector2 = insp2(db.engine)
            t2 = inspector2.get_table_names()
            if "site_settings" in t2:
                from app.admin.site_settings import get_site_setting
                # Sobrescribimos los defaults si la tabla existe y las keys están
                settings_dict["search_message"] = get_site_setting("search_message", settings_dict["search_message"])
                settings_dict["logo_enabled"] = get_site_setting("logo_enabled", settings_dict["logo_enabled"])
                settings_dict["card_opacity"] = get_site_setting("card_opacity", settings_dict["card_opacity"])
                settings_dict["current_theme"] = get_site_setting("current_theme", settings_dict["current_theme"])
                settings_dict["dark_mode"] = get_site_setting("dark_mode", settings_dict["dark_mode"])
                settings_dict["current_gif"] = get_site_setting("current_gif", settings_dict["current_gif"])
                settings_dict["search_message_mode"] = get_site_setting("search_message_mode", settings_dict["search_message_mode"])
                settings_dict["search_message2"] = get_site_setting("search_message2", settings_dict["search_message2"])
                settings_dict["search_message2_mode"] = get_site_setting("search_message2_mode", settings_dict["search_message2_mode"])
        except Exception as e:
            # Loggear el error si es necesario, pero no detener la app
            print(f"[WARN] Error al leer site_settings en context_processor: {e}")

        return {"site_settings": settings_dict}


    @app.context_processor
    def inject_models():
        return {
            "User": User
        }

    return app
