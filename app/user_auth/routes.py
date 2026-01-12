# app/user_auth/routes.py

from flask import render_template, request, flash, redirect, url_for, session, current_app, jsonify, url_for as flask_url_for
from werkzeug.security import check_password_hash
from werkzeug.utils import secure_filename
from datetime import datetime
from app.models import User, IMAPServer2
from app.models.imap2 import IMAP2TwoFAConfig
from app.extensions import db
from config import Config
from functools import wraps
import os

# Importar el blueprint desde el módulo actual
from . import user_auth_bp
from app.auth.security import (
    record_login_attempt, 
    is_blocked, 
    reset_failed_attempts, 
    block_user
)

# Importar el decorador de control de acceso a la tienda
from app.store.routes import store_access_required

# Decorador para excluir rutas del CSRF
def csrf_exempt_route(func):
    """Decorator para excluir rutas del CSRF"""
    func._csrf_exempt = True
    return func

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            flash('Por favor inicie sesión para acceder a esta página.', 'danger')
            return redirect(url_for('user_auth_bp.login'))
        return f(*args, **kwargs)
    return decorated_function

@user_auth_bp.before_app_request
def check_session_revocation_user():
    """
    Verifica si el usuario principal o sub-usuario sigue habilitado o existe.
    Si no, fuerza cierre de sesión y redirige a login.
    Además, fuerza cierre de sesión si el contador user_session_rev_count cambió (revocación individual).
    NOTA: La verificación global session_revocation_count ahora se maneja en app/__init__.py
    """
    if "logged_in" in session and "is_user" in session:
        user_id = session.get("user_id")
        if user_id:
            user_obj = User.query.get(user_id)
            if not user_obj:
                session.clear()
                flash("El usuario fue eliminado.", "danger")
                return redirect(url_for("user_auth_bp.login"))
            if not user_obj.enabled:
                session.clear()
                flash("Este usuario está deshabilitado (OFF).", "danger")
                return redirect(url_for("user_auth_bp.login"))
            # Revocación individual por cambio en user_session_rev_count
            if user_obj.user_session_rev_count > session.get("user_session_rev_count_local", 0):
                session.clear()
                flash("Tu sesión se ha cerrado por un cambio en tu configuración de usuario.", "info")
                return redirect(url_for("user_auth_bp.login"))

@user_auth_bp.route("/login", methods=["GET", "POST"])
@csrf_exempt_route
def login():
    """
    Pantalla de login para usuarios normales (o sub-usuarios).
    """
    # Si ya está logueado, redirigir al home
    if "logged_in" in session and "is_user" in session:
        return redirect(url_for("main_bp.home"))

    if request.method == "GET":
        return render_template("user_login.html")

    # --- INICIO PROCESO POST --- 
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")

    # 1. Verificar si el usuario está bloqueado
    if is_blocked(username):
        user_temp = User.query.filter_by(username=username).first()
        if user_temp and user_temp.blocked_until:
             tiempo_restante = user_temp.blocked_until - datetime.utcnow()
             # Asegurarse que tiempo_restante sea positivo
             mins_restantes = max(0, tiempo_restante.seconds // 60)
             flash(f"Cuenta bloqueada. Intenta de nuevo en {mins_restantes} min.", "warning")
        else:
             flash("Cuenta bloqueada temporalmente.", "warning")
        return render_template("user_login.html")

    # 2. Obtener usuario
    user = User.query.filter_by(username=username).first()

    # ✅ SEGURIDAD: El admin no puede loguearse en la plantilla de usuarios
    if user and username == current_app.config.get("ADMIN_USER"):
        flash("Acceso denegado.", "danger")
        return render_template("user_login.html")

    # 3. Validar contraseña y estado
    if user and user.enabled and check_password_hash(user.password, password):
        # --- LOGIN EXITOSO --- 
        # a) Resetear contadores (antes de commit)
        reset_failed_attempts(user) 
        # b) Configurar sesión
        from app.auth.session_tokens import generate_session_token
        
        # ✅ SEGURIDAD: Generar token de sesión único para prevenir duplicaciones
        session_token = generate_session_token(user.id, is_admin=False)
        
        session.clear()
        session["logged_in"] = True
        session["user_id"] = user.id
        session["is_user"] = True
        session["session_token"] = session_token  # ✅ Token único de sesión
        session.permanent = True
        session["user_session_rev_count_local"] = user.user_session_rev_count
        session["login_time"] = datetime.utcnow().isoformat()  # ✅ SEGURIDAD: Timestamp de login
        
        # ✅ AGREGADO: Asignar contador global de revocación para "cerrar sesión de todos"
        from app.admin.site_settings import get_site_setting
        rev_str = get_site_setting("session_revocation_count", "0")
        session["session_revocation_count"] = int(rev_str)
        # c) Commit final para guardar reseteo de contadores
        try:
            db.session.commit()
            flash("Login exitoso (usuario).", "success")
            return redirect(url_for("main_bp.home"))
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error al hacer commit en login de usuario {username}: {e}", exc_info=True)
            flash("Error interno al iniciar sesión.", "danger")
            return render_template("user_login.html")

    else:
        # --- LOGIN FALLIDO --- 
        flash_message = "Credenciales inválidas." 
        if user and not user.enabled:
             flash_message = "Este usuario está deshabilitado (OFF)."
        
        # a) Registrar intento fallido (antes de commit)
        # Solo registrar si el usuario existe
        if user:
             record_login_attempt(user.username, success=False)
             # b) Commit para guardar intento fallido y posible bloqueo
             try:
                 db.session.commit()
                 # c) Verificar si AHORA está bloqueado y mostrar mensaje correcto
                 if is_blocked(username): 
                      tiempo_restante = user.blocked_until - datetime.utcnow()
                      mins_restantes = max(0, tiempo_restante.seconds // 60)
                      flash(f"Has superado los intentos permitidos. Cuenta bloqueada por {mins_restantes} min.", "danger")
                 else:
                      flash(flash_message, "danger") # Mostrar mensaje original si no se bloqueó
             except Exception as e:
                  db.session.rollback()
                  current_app.logger.error(f"Error al hacer commit en login fallido de usuario {username}: {e}", exc_info=True)
                  flash("Error interno al procesar el intento de login.", "danger")
        else:
             # Usuario no existe
             flash(flash_message, "danger") 
        
        return render_template("user_login.html")

@user_auth_bp.route("/logout")
def logout():
    if "logged_in" in session and "is_user" in session:
        # ✅ SEGURIDAD: Revocar token de sesión antes de limpiar
        from app.auth.session_tokens import revoke_session_token
        session_token = session.get("session_token")
        if session_token:
            revoke_session_token(session_token)
        
        session.clear()
        flash("Sesión de usuario cerrada.", "info")
    return redirect(url_for("user_auth_bp.login"))

@user_auth_bp.route("/manage_my_page/<int:server_id>", methods=["GET"])
@login_required
def manage_my_page(server_id):
    """Permite a un usuario gestionar su página dinámica asignada"""
    user_id = session.get("user_id")
    if not user_id:
        flash("Debes iniciar sesión para acceder a esta página.", "danger")
        return redirect(url_for("user_auth_bp.login"))
    
    user = User.query.get(user_id)
    if not user:
        flash("Usuario no encontrado.", "danger")
        return redirect(url_for("main_bp.home"))
    
    # Obtener el servidor IMAP2
    imap_server = IMAPServer2.query.get_or_404(server_id)
    
    # Verificar que el usuario tenga permiso para gestionar esta página
    if user not in imap_server.allowed_users.all():
        flash("No tienes permiso para gestionar esta página.", "danger")
        return redirect(url_for("main_bp.home"))
    
    return render_template(
        "manage_my_page.html",
        imap_server=imap_server
    )

@user_auth_bp.route("/my_pages", methods=["GET"])
@login_required
def my_pages_list():
    """Lista todas las páginas dinámicas que el usuario puede gestionar"""
    user_id = session.get("user_id")
    if not user_id:
        flash("Debes iniciar sesión para acceder a esta página.", "danger")
        return redirect(url_for("user_auth_bp.login"))
    
    user = User.query.get(user_id)
    if not user:
        flash("Usuario no encontrado.", "danger")
        return redirect(url_for("main_bp.home"))
    
    # Obtener todas las páginas que el usuario puede gestionar
    managed_pages = user.managed_imap2_pages.all()
    
    return render_template(
        "my_pages_list.html",
        managed_pages=managed_pages
    )

@user_auth_bp.route("/update_my_page_paragraph/<int:server_id>", methods=["POST"])
@login_required
@csrf_exempt_route
def update_my_page_paragraph(server_id):
    """Actualiza el párrafo personalizado de la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
    
    imap_server = IMAPServer2.query.get_or_404(server_id)
    
    # Verificar permiso
    if user not in imap_server.allowed_users.all():
        return jsonify({"status": "error", "message": "No tienes permiso"}), 403
    
    paragraph = request.form.get("paragraph", "").strip()
    imap_server.paragraph = paragraph if paragraph else None
    db.session.commit()
    
    flash("Párrafo actualizado correctamente.", "success")
    # Redirigir de vuelta a la página de gestión
    return redirect(url_for("user_auth_bp.manage_my_page", server_id=server_id))

@user_auth_bp.route("/my_page/<int:imap2_id>/upload_background", methods=["POST"])
@login_required
@csrf_exempt_route
def upload_my_page_background(imap2_id):
    """Sube un fondo personalizado para la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
    
    imap2_server = IMAPServer2.query.get_or_404(imap2_id)
    
    # Verificar permiso
    if user not in imap2_server.allowed_users.all():
        return jsonify({"status": "error", "message": "No tienes permiso"}), 403
    
    # Reutilizar la lógica del admin
    from app.admin.admin_imap2 import upload_imap2_background
    return upload_imap2_background(imap2_id)

@user_auth_bp.route("/my_page/<int:imap2_id>/delete_background", methods=["POST"])
@login_required
@csrf_exempt_route
def delete_my_page_background(imap2_id):
    """Elimina el fondo personalizado de la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
    
    imap2_server = IMAPServer2.query.get_or_404(imap2_id)
    
    # Verificar permiso
    if user not in imap2_server.allowed_users.all():
        return jsonify({"status": "error", "message": "No tienes permiso"}), 403
    
    # Reutilizar la lógica del admin
    from app.admin.admin_imap2 import delete_imap2_background
    return delete_imap2_background(imap2_id)

@user_auth_bp.route("/my_page/<int:server_id>/twofa-configs", methods=["GET", "POST"])
@login_required
def my_page_twofa_configs(server_id):
    """Gestiona las configuraciones 2FA de la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
    
    imap_server = IMAPServer2.query.get_or_404(server_id)
    
    # Verificar permiso
    if user not in imap_server.allowed_users.all():
        return jsonify({"status": "error", "message": "No tienes permiso"}), 403
    
    # Reutilizar las rutas del admin pero con verificación de permiso
    from app.admin.admin_imap2 import (
        list_imap2_twofa_configs,
        create_imap2_twofa_config,
        update_imap2_twofa_config,
        delete_imap2_twofa_config,
        read_imap2_qr_code
    )
    
    if request.method == "GET":
        return list_imap2_twofa_configs(server_id)
    elif request.method == "POST":
        return create_imap2_twofa_config(server_id)

@user_auth_bp.route("/my_page/twofa-configs/<int:config_id>", methods=["PUT", "DELETE"])
@login_required
@csrf_exempt_route
def my_page_twofa_config(config_id):
    """Gestiona una configuración 2FA específica de la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
    
    config = IMAP2TwoFAConfig.query.get_or_404(config_id)
    
    # Verificar permiso
    if user not in config.imap_server.allowed_users.all():
        return jsonify({"status": "error", "message": "No tienes permiso"}), 403
    
    # Reutilizar las rutas del admin
    from app.admin.admin_imap2 import (
        update_imap2_twofa_config,
        delete_imap2_twofa_config
    )
    
    if request.method == "PUT":
        return update_imap2_twofa_config(config_id)
    elif request.method == "DELETE":
        return delete_imap2_twofa_config(config_id)

@user_auth_bp.route("/my_page/twofa-configs/read-qr", methods=["POST"])
@login_required
@csrf_exempt_route
def my_page_read_qr():
    """Lee un código QR para 2FA de la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    # Reutilizar la ruta del admin (la verificación de permiso se hace en la creación)
    from app.admin.admin_imap2 import read_imap2_qr_code
    return read_imap2_qr_code()
