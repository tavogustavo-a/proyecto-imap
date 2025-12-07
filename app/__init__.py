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
else:
    # En producción, es posible que las variables de entorno ya estén definidas
    # en el sistema o a través del servidor WSGI, así que no fallar aquí.
    pass  # Eliminado print para máxima discreción
# --- FIN CARGA DE .ENV ---

# Y LUEGO, DESPUÉS DEL BLOQUE ANTERIOR, DEBEN VENIR ESTAS IMPORTACIONES
from flask import Flask, session
from config import Config
from werkzeug.security import generate_password_hash
from sqlalchemy import inspect
from flask_seasurf import SeaSurf
from app.extensions import db, migrate
from app.models import User  # <-- Importa tu modelo User

# ⭐ Configurar zona horaria de Colombia a nivel de aplicación
import os
os.environ['TZ'] = 'America/Bogota'
try:
    import time
    time.tzset()  # Solo funciona en Unix/Linux
except (AttributeError, ImportError):
    # En Windows, tzset no existe, pero no es crítico
    # La aplicación usará las funciones de timezone.py
    pass

def create_app(config_class_passed=None):
    current_app = Flask(__name__)

    # Determinar qué clase de configuración usar
    config_to_use = config_class_passed if config_class_passed else Config

    try:
        current_app.config.from_object(config_to_use)
    except Exception as e:
        raise

    # Renombrar la variable app para el resto de la función para evitar confusiones
    # y para que coincida con tu código original si quieres revertir fácilmente.
    app = current_app 

    # Verificación de integridad del sistema (inicialización interna)
    _sys_verif_a = 0x4A2F
    _sys_verif_b = 0x1B3E
    _sys_integrity = (_sys_verif_a | _sys_verif_b) & 0xFFFF

    # CSRF Protection
    csrf = SeaSurf(app)
    
    # Hacer el objeto csrf disponible globalmente para los decoradores
    app.csrf = csrf
    

    
    # Función para aplicar exenciones de CSRF después de registrar blueprints
    def apply_csrf_exemptions():
        with app.app_context():
            for rule in app.url_map.iter_rules():
                endpoint = rule.endpoint
                if endpoint:
                    view_func = app.view_functions.get(endpoint)
                    if view_func and hasattr(view_func, '_csrf_exempt'):
                        csrf.exempt(view_func)

    # Inicializar extensiones de base de datos
    db.init_app(app)
    migrate.init_app(app, db)
    # ✅ CORREGIDO: NO inicializar SocketIO aquí para evitar conflictos
    # SocketIO se maneja solo en socketio_server.py para la tienda

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
    
    # Registrar blueprint del buzón de emails
    from app.admin.admin_email_buzon import admin_email_buzon_bp
    app.register_blueprint(admin_email_buzon_bp, url_prefix="/admin")

    # Registrar servidor SMTP para emails
    from app.smtp import smtp_server_bp, smtp_routes_bp
    app.register_blueprint(smtp_server_bp, url_prefix="/smtp")
    app.register_blueprint(smtp_routes_bp, url_prefix="/admin/smtp")

    # Blueprint Tienda (Store)
    from app.store import store_bp
    app.register_blueprint(store_bp, url_prefix="/tienda")

    # Registrar el blueprint de la API de hojas de cálculo
    from app.store.api import api_bp as store_api_bp
    app.register_blueprint(store_api_bp, url_prefix="/api/store")

    from app.main import main_bp
    app.register_blueprint(main_bp)

    from app.api import api_bp
    app.register_blueprint(api_bp, url_prefix="/api")



    # Registrar el blueprint de autenticación de usuario
    try:
        from app.user_auth import user_auth_bp
        app.register_blueprint(user_auth_bp, url_prefix="/usuario")
    except ImportError as e:
        pass

    from app.subusers import subuser_bp
    app.register_blueprint(subuser_bp, url_prefix="/subusers")

    # Registrar comandos CLI personalizados
    try:
        from app.cli_commands import register_cli_commands
        register_cli_commands(app)
    except Exception as cli_err:
        # print de advertencia eliminado para producción; usa logging si es necesario
        pass

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
            "search_message_mode": "off",
            "search_message2": "",
            "search_message2_mode": "off",
            "search_message3": "",
            "search_message3_mode": "off",
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
                settings_dict["search_message_mode"] = get_site_setting("search_message_mode", settings_dict["search_message_mode"])
                settings_dict["search_message2"] = get_site_setting("search_message2", settings_dict["search_message2"])
                settings_dict["search_message2_mode"] = get_site_setting("search_message2_mode", settings_dict["search_message2_mode"])
                settings_dict["search_message3"] = get_site_setting("search_message3", settings_dict["search_message3"])
                settings_dict["search_message3_mode"] = get_site_setting("search_message3_mode", settings_dict["search_message3_mode"])
        except Exception as e:
            # Usa logging.warning en lugar de print si deseas registrar este error
            pass

        return {"site_settings": settings_dict}


    @app.context_processor
    def inject_models():
        return {
            "User": User
        }

    @app.context_processor
    def inject_admin_user():
        return {"ADMIN_USER": app.config.get("ADMIN_USER")}

    @app.context_processor
    def inject_worksheet_access():
        try:
            from app.store.routes import user_has_worksheet_access
            return {"user_has_worksheet_access": user_has_worksheet_access}
        except ImportError:
            # Si no se puede importar, devolver una función que siempre retorna False
            def dummy_worksheet_access(user):
                return False
            return {"user_has_worksheet_access": dummy_worksheet_access}

    @app.context_processor
    def inject_codigos2_access():
        """Inyecta función para verificar acceso a Códigos 2 en todas las plantillas."""
        from flask import session
        from app.models import Codigos2Access
        
        def user_has_codigos2_access():
            """Verifica si el usuario actual tiene acceso a Códigos 2."""
            username = session.get('username')
            user_id = session.get('user_id')
            
            if username:
                user = User.query.filter_by(username=username).first()
            elif user_id:
                user = User.query.get(user_id)
            else:
                return False
            
            if not user:
                return False
            
            # Si es sub-usuario, verificar el permiso específico
            if user.parent_id:
                return user.can_access_codigos2
            
            # Si es usuario principal, verificar en la tabla de accesos
            return Codigos2Access.user_has_access(user)
        
        return {"user_has_codigos2_access": user_has_codigos2_access}

    # Aplicar exenciones de CSRF después de registrar todos los blueprints
    apply_csrf_exemptions()

    # ✅ VERIFICACIÓN GLOBAL DE REVOCACIÓN DE SESIONES (Cerrar sesión de todos)
    @app.before_request
    def check_global_session_revocation():
        """
        Verifica si el contador global de revocación de sesiones cambió.
        Si cambió, fuerza cierre de sesión para TODOS los usuarios (admin, usuarios normales y sub-usuarios).
        Esto se activa cuando el admin usa "Cerrar sesión de todos".
        """
        # Solo verificar si hay una sesión activa
        if "logged_in" in session or "is_user" in session:
            from app.admin.site_settings import get_site_setting
            from flask import redirect, url_for, flash
            
            # Obtener el contador global actual
            current_global_count = int(get_site_setting("session_revocation_count", "0"))
            
            # Obtener el contador guardado en la sesión (puede no existir en sesiones antiguas)
            session_count = session.get("session_revocation_count", 0)
            
            # Si el contador global es mayor que el de la sesión, forzar logout
            if current_global_count > session_count:
                # Guardar el tipo de usuario antes de limpiar la sesión
                is_admin = "username" in session and session.get("username") == app.config.get("ADMIN_USER", "admin")
                is_user_normal = "is_user" in session
                
                session.clear()
                flash("Tu sesión ha sido cerrada por el administrador.", "info")
                
                # Redirigir según el tipo de usuario
                if is_admin:
                    # Admin
                    return redirect(url_for("auth_bp.login"))
                elif is_user_normal:
                    # Usuario normal o sub-usuario
                    return redirect(url_for("user_auth_bp.login"))
                else:
                    # Fallback: admin por defecto
                    return redirect(url_for("auth_bp.login"))

    # ⭐ NUEVO: Inicializar sistema de limpieza automática de registros de conexión
    try:
        from app.store.cleanup import initialize_cleanup_system
        # Usar modo 'smart' para limpieza inteligente cada 28 días a las 5:00 AM
        initialize_cleanup_system(mode='smart')
    except Exception as e:
        pass
    
    # ⭐ NUEVO: Inicializar sistema de registros de conexión
    try:
        from app.store.presence import initialize_connection_system
        initialize_connection_system()
    except Exception as e:
        pass
    
    # ⭐ NUEVO: Inicializar loop de Drive Transfer (se ejecuta siempre, incluso con Gunicorn)
    try:
        from app.store.drive_manager import start_simple_drive_loop
        # Iniciar el loop en un thread separado (solo se ejecuta una vez por proceso)
        start_simple_drive_loop()
    except Exception as e:
        # No fallar si hay error, solo continuar
        pass

    # ✅ CORREGIDO: Los eventos de SocketIO se cargan solo en socketio_server.py
    # No se cargan aquí para evitar conflictos con la aplicación principal IMAP

    return app
