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
        """Inyecta el nombre del admin y verifica si el usuario actual es realmente admin."""
        from flask import session
        admin_username = app.config.get("ADMIN_USER", "admin")
        
        # ✅ SEGURIDAD: Verificar que el usuario sea realmente admin basándose en la BD
        is_admin = False
        is_user = False
        is_subuser = False
        is_normal_user = False
        current_user_obj = None
        
        username = session.get('username')
        user_id = session.get('user_id')
        
        # Obtener el usuario de la base de datos
        if username:
            current_user_obj = User.query.filter_by(username=username).first()
        elif user_id:
            current_user_obj = User.query.get(user_id)
        
        if current_user_obj:
            # Verificar si es admin
            if current_user_obj.username == admin_username and current_user_obj.parent_id is None:
                is_admin = True
            # Verificar si es sub-usuario
            elif current_user_obj.parent_id is not None:
                is_subuser = True
                is_user = True  # Los sub-usuarios también son usuarios
            # Verificar si es usuario normal (principal, no admin)
            elif session.get("is_user") or not session.get("username"):
                # Si tiene session["is_user"] o no tiene session["username"], es usuario normal
                is_user = True
                is_normal_user = True
        
        return {
            "ADMIN_USER": admin_username,
            "is_admin": is_admin,  # Variable segura para usar en plantillas
            "is_user": is_user,  # Variable segura: True si es usuario normal o sub-usuario
            "is_subuser": is_subuser,  # Variable segura: True si es sub-usuario
            "is_normal_user": is_normal_user,  # Variable segura: True si es usuario principal (no admin, no sub-usuario)
            "current_user_obj": current_user_obj  # Objeto User de la BD para uso en plantillas
        }

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
