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
from sqlalchemy import inspect, text
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
        # Columnas nuevas sin migración Alembic en servidor (p. ej. original_to_email en received_emails)
        try:
            insp = inspect(db.engine)
            if insp.has_table("received_emails"):
                col_names = {c["name"] for c in insp.get_columns("received_emails")}
                if "original_to_email" not in col_names:
                    db.session.execute(
                        text(
                            "ALTER TABLE received_emails ADD COLUMN original_to_email VARCHAR(255)"
                        )
                    )
                    db.session.commit()
                    app.logger.info(
                        "Esquema: columna original_to_email añadida a received_emails"
                    )
        except Exception as schema_err:
            db.session.rollback()
            app.logger.warning(
                "No se pudo aplicar parche de esquema email buzón: %s", schema_err
            )

        try:
            insp = inspect(db.engine)
            if insp.has_table("store_licenses"):
                col_names = {c["name"] for c in insp.get_columns("store_licenses")}
                if "personal_notes" not in col_names:
                    db.session.execute(
                        text("ALTER TABLE store_licenses ADD COLUMN personal_notes TEXT")
                    )
                    db.session.commit()
                    app.logger.info(
                        "Esquema: columna personal_notes añadida a store_licenses"
                    )
                col_names = {c["name"] for c in insp.get_columns("store_licenses")}
                if "license_notes" not in col_names:
                    db.session.execute(
                        text("ALTER TABLE store_licenses ADD COLUMN license_notes TEXT")
                    )
                    db.session.commit()
                    app.logger.info(
                        "Esquema: columna license_notes añadida a store_licenses"
                    )
                col_names = {c["name"] for c in insp.get_columns("store_licenses")}
                if "suspended_notes" not in col_names:
                    db.session.execute(
                        text("ALTER TABLE store_licenses ADD COLUMN suspended_notes TEXT")
                    )
                    db.session.commit()
                    app.logger.info(
                        "Esquema: columna suspended_notes añadida a store_licenses"
                    )
        except Exception as schema_err:
            db.session.rollback()
            app.logger.warning(
                "No se pudo aplicar parche store_licenses (notas): %s", schema_err
            )

        try:
            insp = inspect(db.engine)
            dialect = getattr(db.engine.dialect, "name", "") or ""

            if insp.has_table("store_license_accounts"):
                acc_cols = {c["name"].lower() for c in insp.get_columns("store_license_accounts")}
                reserved_at_type = "TIMESTAMP" if dialect == "postgresql" else "DATETIME"
                if "renewal_reserved_user_id" not in acc_cols:
                    if dialect == "postgresql":
                        db.session.execute(
                            text(
                                "ALTER TABLE store_license_accounts ADD COLUMN renewal_reserved_user_id INTEGER "
                                "REFERENCES users(id) ON DELETE SET NULL"
                            )
                        )
                    else:
                        db.session.execute(
                            text(
                                "ALTER TABLE store_license_accounts ADD COLUMN renewal_reserved_user_id INTEGER"
                            )
                        )
                    db.session.commit()
                    app.logger.info(
                        "Esquema: columna renewal_reserved_user_id añadida a store_license_accounts"
                    )
                    acc_cols.add("renewal_reserved_user_id")
                if "renewal_reserved_at" not in acc_cols:
                    db.session.execute(
                        text(
                            f"ALTER TABLE store_license_accounts ADD COLUMN renewal_reserved_at {reserved_at_type}"
                        )
                    )
                    db.session.commit()
                    app.logger.info(
                        "Esquema: columna renewal_reserved_at añadida a store_license_accounts"
                    )
        except Exception as schema_acc_err:
            db.session.rollback()
            app.logger.warning(
                "No se pudo aplicar parche store_license_accounts (renewal_reserved): %s",
                schema_acc_err,
            )

        try:
            insp = inspect(db.engine)
            dialect = getattr(db.engine.dialect, "name", "") or ""

            def _cols(table):
                raw = insp.get_columns(table)
                # PostgreSQL devuelve nombres en minúsculas; el modelo suele usar minúsculas igual.
                return {c["name"].lower() for c in raw}

            if insp.has_table("users"):
                ucols = _cols("users")
                if "saldo" not in ucols:
                    if dialect == "sqlite":
                        saldo_sql = "ALTER TABLE users ADD COLUMN saldo REAL NOT NULL DEFAULT 0"
                    else:
                        # PostgreSQL / MySQL típicos de producción (REAL también vale en PG; DOUBLE PRECISION más explícito)
                        saldo_sql = (
                            "ALTER TABLE users ADD COLUMN saldo DOUBLE PRECISION NOT NULL DEFAULT 0"
                        )
                    db.session.execute(text(saldo_sql))
                    db.session.commit()
                    app.logger.info(
                        "Esquema: columna saldo (pendiente de cuenta; 0 = al día) "
                        "añadida a users (%s)",
                        dialect,
                    )

                ucols = _cols("users")
                if "portal_license_activity_log" not in ucols:
                    db.session.execute(
                        text(
                            "ALTER TABLE users ADD COLUMN portal_license_activity_log TEXT"
                        )
                    )
                    db.session.commit()
                    app.logger.info(
                        "Esquema: columna portal_license_activity_log "
                        "(historial actividad licencias) añadida a users (%s)",
                        dialect,
                    )

                ucols = _cols("users")
                if "admin_licencias_ui_prefs" not in ucols:
                    db.session.execute(
                        text(
                            "ALTER TABLE users ADD COLUMN admin_licencias_ui_prefs TEXT"
                        )
                    )
                    db.session.commit()
                    app.logger.info(
                        "Esquema: columna admin_licencias_ui_prefs "
                        "(JSON preferencias UI admin licencias) añadida a users (%s)",
                        dialect,
                    )
        except Exception as schema_users_patch_err:
            db.session.rollback()
            app.logger.warning(
                "No se pudo aplicar parche columnas users (saldo / portal_license_activity_log / admin_licencias_ui_prefs): %s",
                schema_users_patch_err,
            )

        try:
            from app.store.routes import _ensure_balance_recharges_table
            from app.store.sale_purchase_snapshot import ensure_sale_schema, ensure_snapshot_table

            _ensure_balance_recharges_table()
            from app.store.balance_recharge_accum import normalize_unreviewed_accumulations

            repaired_accum = normalize_unreviewed_accumulations()
            ensure_sale_schema()
            ensure_snapshot_table()
            from app.store.customer_account_renewals import ensure_customer_account_renewal_schema
            from app.store.product_reservations import ensure_product_reservation_schema
            from app.store.routes import _ensure_license_expired_notes_and_month_columns

            _ensure_license_expired_notes_and_month_columns()
            ensure_product_reservation_schema()
            ensure_customer_account_renewal_schema()
            app.logger.debug(
                "Esquema: tablas/columnas de recargas y ventas (historial) verificadas"
                + (
                    f"; {repaired_accum} acumulación(es) legacy reparada(s)"
                    if repaired_accum
                    else ""
                )
            )
        except Exception as store_schema_err:
            db.session.rollback()
            app.logger.warning(
                "No se pudo aplicar parche esquema tienda (recargas / historial compras): %s",
                store_schema_err,
            )

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

    from sqlalchemy import inspect as insp2

    @app.context_processor
    def inject_site_settings():
        # Intentamos obtener las settings, pero sin crear/modificar si no existen aquí.
        settings_dict = {
            "search_message": "",
            "card_opacity": "0.8",
            "current_theme": "tema1",
            "dark_mode": "false",
            "search_message_mode": "off",
            "search_message2": "",
            "search_message2_mode": "off",
            "public_access_enabled": "true",
        }
        try:
            inspector2 = insp2(db.engine)
            t2 = inspector2.get_table_names()
            if "site_settings" in t2:
                from app.admin.site_settings import get_site_setting
                # Sobrescribimos los defaults si la tabla existe y las keys están
                settings_dict["search_message"] = get_site_setting("search_message", settings_dict["search_message"])
                settings_dict["card_opacity"] = get_site_setting("card_opacity", settings_dict["card_opacity"])
                settings_dict["current_theme"] = get_site_setting("current_theme", settings_dict["current_theme"])
                settings_dict["dark_mode"] = get_site_setting("dark_mode", settings_dict["dark_mode"])
                settings_dict["search_message_mode"] = get_site_setting("search_message_mode", settings_dict["search_message_mode"])
                settings_dict["search_message2"] = get_site_setting("search_message2", settings_dict["search_message2"])
                settings_dict["search_message2_mode"] = get_site_setting("search_message2_mode", settings_dict["search_message2_mode"])
                settings_dict["public_access_enabled"] = get_site_setting("public_access_enabled", settings_dict["public_access_enabled"])
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

    @app.context_processor
    def inject_store_menu_balance():
        """Texto de saldo para el pie del menú móvil de usuarios con tienda (USD/COP)."""
        from flask import session

        defaults = {"store_menu_show_saldo": False, "store_menu_saldo_line": None}
        if not session.get("logged_in"):
            return defaults
        try:
            from app.store.routes import build_store_menu_saldo_display
        except ImportError:
            return defaults

        uid = session.get("user_id")
        if not uid:
            return defaults
        user = User.query.get(uid)
        if not user:
            return defaults
        result = build_store_menu_saldo_display(user)
        if not result.get("show"):
            return defaults
        return {"store_menu_show_saldo": True, "store_menu_saldo_line": result.get("line")}

    @app.context_processor
    def inject_admin_archivados_count():
        """Número de licencias archivadas para el botón Archivados del Menú2 admin."""
        defaults = {"admin_archivados_count": 0}
        if not session.get("logged_in"):
            return defaults
        admin_username = app.config.get("ADMIN_USER", "admin")
        username = session.get("username")
        user_id = session.get("user_id")
        user = None
        if username:
            user = User.query.filter_by(username=username).first()
        elif user_id:
            user = User.query.get(user_id)
        if not user or user.username != admin_username or user.parent_id is not None:
            return defaults
        try:
            from app.store.models import License

            count = License.query.filter_by(enabled=False).count()
            return {"admin_archivados_count": count}
        except Exception:
            return defaults

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
        # Detectar si es una petición AJAX/JSON
        from flask import request, jsonify
        is_ajax = (
            request.is_json or 
            request.headers.get('Content-Type', '').startswith('application/json') or
            request.headers.get('X-Requested-With') == 'XMLHttpRequest' or
            request.path.startswith('/api/') or
            request.path.startswith('/usuario/my_page/') or
            request.method in ['GET', 'POST', 'PUT', 'DELETE'] and 'twofa-configs' in request.path
        )
        
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
                
                if is_ajax:
                    return jsonify({"status": "error", "message": "Tu sesión ha sido cerrada por el administrador."}), 401
                
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

    # Mantenimiento de logs de conexión: un solo proceso por máquina.
    try:
        from app.store.connection_logs_maintenance import start_connection_logs_maintenance_loop
        start_connection_logs_maintenance_loop(app)
    except Exception:
        pass

    try:
        from app.store.purchase_history_cleanup import start_purchase_history_cleanup_loop
        start_purchase_history_cleanup_loop(app)
        from app.store.license_history_cleanup import start_license_history_cleanup_loop
        start_license_history_cleanup_loop(app)
        from app.store.balance_recharge_cleanup import start_balance_recharge_cleanup_loop
        start_balance_recharge_cleanup_loop(app)
        from app.store.balance_recharge_email_scheduler import start_balance_recharge_email_verify_loop
        start_balance_recharge_email_verify_loop(app)
        from app.store.whatsapp_health_scheduler import start_whatsapp_health_loop
        start_whatsapp_health_loop(app)
        from app.store.whatsapp_license_notify_scheduler import start_whatsapp_license_notify_loop
        start_whatsapp_license_notify_loop(app)
        from app.store.balance_recharge_events import start_balance_recharge_events_redis_listener
        start_balance_recharge_events_redis_listener(app)

        from app.services.disk_orphan_maintenance import start_disk_orphan_maintenance_loop
        start_disk_orphan_maintenance_loop(app)
    except Exception:
        pass

    # ✅ CORREGIDO: Los eventos de SocketIO se cargan solo en socketio_server.py
    # No se cargan aquí para evitar conflictos con la aplicación principal IMAP

    from app.utils.html_sanitize import sanitize_admin_message_html

    @app.template_filter("sanitize_message_html")
    def sanitize_message_html_filter(value):
        return sanitize_admin_message_html(value)

    return app
