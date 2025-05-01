# app/user_auth/routes.py

from flask import render_template, request, flash, redirect, url_for, session, current_app
from werkzeug.security import check_password_hash
from datetime import datetime
from app.models import User
from app.extensions import db
from config import Config

# Importar el blueprint desde el módulo actual
from . import user_auth_bp
from app.auth.security import (
    record_login_attempt, 
    is_blocked, 
    reset_failed_attempts, 
    block_user
)

@user_auth_bp.before_app_request
def check_session_revocation_user():
    """
    Verifica si el usuario normal o sub-usuario sigue habilitado.
    """
    if "logged_in" in session and "is_user" in session:
        user_id = session.get("user_id")
        if user_id:
            user_obj = User.query.get(user_id)
            if not user_obj:
                session.clear()
                flash("El usuario/sub-usuario fue eliminado.", "danger")
                return redirect(url_for("user_auth_bp.login"))
            if not user_obj.enabled:
                session.clear()
                flash("Este usuario está deshabilitado (OFF).", "danger")
                return redirect(url_for("user_auth_bp.login"))

@user_auth_bp.route("/login", methods=["GET", "POST"])
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

    # 3. Validar contraseña y estado
    if user and user.enabled and check_password_hash(user.password, password):
        # --- LOGIN EXITOSO --- 
        # a) Resetear contadores (antes de commit)
        reset_failed_attempts(user) 
        # b) Configurar sesión
        session.clear()
        session["logged_in"] = True
        session["user_id"] = user.id
        session["is_user"] = True
        session.permanent = True
        session["user_session_rev_count_local"] = user.user_session_rev_count
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
        session.clear()
        flash("Sesión de usuario cerrada.", "info")
    return redirect(url_for("user_auth_bp.login"))
