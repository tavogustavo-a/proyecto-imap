# app/admin/decorators.py

from functools import wraps
from flask import session, current_app, flash, redirect, url_for
from app.models import User

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        admin_user = current_app.config.get("ADMIN_USER", "admin")
        
        # 1) ✅ SEGURIDAD: Verificar que NO sea un usuario normal o sub-usuario PRIMERO
        # Los usuarios normales tienen session["is_user"] = True
        if session.get("is_user"):
            flash("Solo el administrador puede acceder a esta sección.", "danger")
            session.clear()  # Limpiar sesión inválida
            return redirect(url_for("user_auth_bp.login"))

        # 2) ✅ SEGURIDAD: Verificar que esté logueado
        if not session.get("logged_in"):
            flash("Inicia sesión para acceder.", "danger")
            return redirect(url_for("auth_bp.login"))

        # 3) ✅ SEGURIDAD CRÍTICA: Verificar token de sesión único ANTES de verificar user_id
        # Esto previene sesiones duplicadas - el token debe estar registrado en el servidor
        from app.auth.session_tokens import validate_session_token
        session_token = session.get("session_token")
        user_id = session.get("user_id")
        
        if not session_token:
            # No hay token de sesión - sesión inválida o duplicada sin token
            flash("Solo el administrador puede acceder a esta sección.", "danger")
            session.clear()
            return redirect(url_for("auth_bp.login"))
        
        # Validar el token - debe existir en el servidor y ser de admin
        if not validate_session_token(session_token, expected_user_id=user_id, require_admin=True):
            # Token inválido, expirado, o no es de admin - sesión duplicada o inválida
            flash("Solo el administrador puede acceder a esta sección.", "danger")
            session.clear()
            return redirect(url_for("auth_bp.login"))

        # 4) ✅ SEGURIDAD CRÍTICA: Verificar que el user_id corresponda realmente al admin en la BD
        # Esta es la verificación más importante - debe existir y ser el admin
        if not user_id:
            # Si no hay user_id, no puede ser una sesión válida de admin
            flash("Solo el administrador puede acceder a esta sección.", "danger")
            session.clear()
            return redirect(url_for("auth_bp.login"))
        
        # Verificar en la BD que el user_id corresponda al admin
        user_obj = User.query.get(user_id)
        if not user_obj:
            # Usuario no existe en la BD
            flash("Solo el administrador puede acceder a esta sección.", "danger")
            session.clear()
            return redirect(url_for("auth_bp.login"))
        
        # Verificar que el usuario de la BD sea realmente el admin
        if user_obj.username != admin_user or user_obj.parent_id is not None:
            # No es admin o es sub-usuario
            flash("Solo el administrador puede acceder a esta sección.", "danger")
            session.clear()
            return redirect(url_for("auth_bp.login"))

        # 5) ✅ SEGURIDAD ADICIONAL: Verificar que el username en sesión coincida con el de la BD
        # Esto previene sesiones donde se falsifica solo el username pero no el user_id
        session_username = session.get("username")
        if session_username != admin_user:
            flash("Solo el administrador puede acceder a esta sección.", "danger")
            session.clear()
            return redirect(url_for("auth_bp.login"))

        # 6) ✅ SEGURIDAD ADICIONAL: Verificar que la sesión tenga login_time (sesión válida iniciada correctamente)
        # Esto previene sesiones que no fueron iniciadas mediante el proceso de login normal
        if not session.get("login_time"):
            flash("Solo el administrador puede acceder a esta sección.", "danger")
            session.clear()
            return redirect(url_for("auth_bp.login"))

        return f(*args, **kwargs)
    return decorated_function
