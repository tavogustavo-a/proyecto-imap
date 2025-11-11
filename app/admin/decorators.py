# app/admin/decorators.py

from functools import wraps
from flask import session, current_app, flash, redirect, url_for

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 1) Chequear si está logueado
        if not session.get("logged_in"):
            flash("Inicia sesión para acceder.", "danger")
            return redirect(url_for("auth_bp.login"))

        # 2) Chequear si el usuario es el admin => session["username"] == ADMIN_USER
        admin_user = current_app.config.get("ADMIN_USER", "admin")
        if session.get("username") != admin_user:
            flash("Solo el administrador puede acceder a esta sección.", "danger")
            return redirect(url_for("auth_bp.login"))

        return f(*args, **kwargs)
    return decorated_function
