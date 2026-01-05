# app/auth/routes.py

import random
import smtplib
from datetime import datetime, timedelta
from secrets import token_urlsafe

from flask import (
    render_template, redirect, url_for, flash,
    request, session, make_response, current_app
)
from werkzeug.security import check_password_hash, generate_password_hash

from config import Config
from app.extensions import db
from app.models import User, RememberDevice
from app.auth.security import (
    is_blocked,
    record_login_attempt,
    block_user,
    reset_failed_attempts
)
from app.auth.totp import verify_totp_code
from app.forms import LoginForm, ForgotPasswordForm
from app.services.email_service import send_otp_email
import os

from . import auth_bp

@auth_bp.before_app_request
def check_session_revocation():
    """
    Verifica si hay que forzar logout individual por user_session_rev_count.
    NOTA: La verificación global session_revocation_count ahora se maneja en app/__init__.py
    NOTA: La expiración automática de sesión se maneja mediante PERMANENT_SESSION_LIFETIME (15 días)
    """
    if "logged_in" in session and "username" in session:
        user_id = session.get("user_id")
        if user_id:
            user_obj = User.query.get(user_id)
            if user_obj and user_obj.user_session_rev_count > session.get("user_session_rev_count_local", 0):
                session.clear()
                flash("Tu sesión se ha cerrado por un cambio en tu configuración de usuario.", "info")
                return redirect(url_for("auth_bp.login"))


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    """
    Pantalla de inicio de sesión (admin).
    Usa un WTForms (LoginForm) para validar datos.
    """
    form = LoginForm(request.form)

    if request.method == "GET":
        saved_username = request.cookies.get("remember_username")
        if saved_username:
            form.username.data = saved_username
        return render_template("login.html", form=form)

    if not form.validate():
        flash("Verifica los campos del formulario.", "danger")
        return render_template("login.html", form=form)

    username = form.username.data.strip()
    password = form.password.data

    if is_blocked(username):
        user_temp = User.query.filter_by(username=username).first()
        if user_temp and user_temp.blocked_until:
            tiempo_restante = user_temp.blocked_until - datetime.utcnow()
            flash(f"Cuenta bloqueada. Intenta de nuevo en {tiempo_restante.seconds // 60} minutos.", "warning")
        else:
            flash("Cuenta bloqueada temporalmente.", "warning")
        return render_template("login.html", form=form)

    user = User.query.filter_by(username=username).first()

    # ✅ SEGURIDAD: Solo el admin puede loguearse en la plantilla de admin
    if user and username != current_app.config.get("ADMIN_USER"):
        flash("Acceso denegado.", "danger")
        return render_template("login.html", form=form)

    if user and user.enabled and check_password_hash(user.password, password):
        reset_failed_attempts(user)
        if user.twofa_enabled:
            if _remember_device_exists(user):
                flash("Bienvenido (2FA omitido en este dispositivo).", "info")
                _setup_session(user)
                db.session.commit()
                return make_response(_post_login_redirect(username))

            if user.twofa_method == "TOTP":
                session["2fa_user_id"] = user.id
                session["2fa_username"] = user.username
                db.session.commit()
                return redirect(url_for("auth_bp.twofa", username=username))
            elif user.twofa_method == "EMAIL":
                if not user.email or not user.email_verified:
                    flash("No se ha verificado tu correo para 2FA Email.", "danger")
                    return render_template("login.html", form=form)
                code = str(random.randint(100000, 999999))
                user.pending_2fa_code = code
                user.pending_2fa_code_expires = datetime.utcnow() + timedelta(minutes=10)
                session["2fa_user_id"] = user.id
                session["2fa_username"] = user.username
                try:
                    db.session.commit()
                    send_otp_email(user.email, code)
                    flash("Se envió un código OTP a tu correo. Ingresa el código 2FA.", "info")
                    return redirect(url_for("auth_bp.twofa", username=username))
                except Exception as e:
                    db.session.rollback()
                    return render_template("login.html", form=form)
            else:
                flash("2FA indefinido. Iniciando sesión...", "warning")
                _setup_session(user)
                db.session.commit()
                return make_response(_post_login_redirect(username))
        else:
            flash("Login exitoso.", "success")
            _setup_session(user)
            db.session.commit()
            resp = make_response(_post_login_redirect(username))
            remember_usr = request.form.get("remember_user")
            if remember_usr == "on":
                resp.set_cookie("remember_username", username, max_age=15*24*3600, httponly=True)
            else:
                resp.set_cookie("remember_username", "", expires=0)
            return resp
    else:
        if user:
            record_login_attempt(user.username, success=False)
            db.session.commit()
            if is_blocked(username):
                tiempo_restante = user.blocked_until - datetime.utcnow()
                mins_restantes = max(0, tiempo_restante.seconds // 60)
                flash(f"Has superado los intentos permitidos. Cuenta bloqueada por {mins_restantes} min.", "danger")
            else:
                flash("Credenciales inválidas.", "danger")
        else:
            flash("Credenciales inválidas.", "danger")
        return render_template("login.html", form=form)


def _remember_device_exists(user):
    device_token = request.cookies.get("remember_2fa_device")
    if not device_token:
        return False
    rem_dev = RememberDevice.query.filter_by(token=device_token, user_id=user.id).first()
    if rem_dev and rem_dev.expires_at > datetime.utcnow():
        return True
    return False


def _post_login_redirect(username):
    if username == current_app.config["ADMIN_USER"]:
        return redirect(url_for("admin_bp.dashboard"))
    return redirect(url_for("main_bp.home"))


@auth_bp.route("/twofa/<username>", methods=["GET", "POST"])
def twofa(username):
    user_id_pending = session.get("2fa_user_id")
    username_pending = session.get("2fa_username")
    if not user_id_pending or username_pending != username:
        flash("Error en el proceso 2FA. Intenta iniciar sesión de nuevo.", "danger")
        return redirect(url_for("auth_bp.login"))
    
    user = User.query.get(user_id_pending)
    if not user:
        flash("Usuario 2FA no encontrado.", "danger")
        return redirect(url_for("auth_bp.login"))

    if request.method == "POST":
        code = request.form.get("code", "").strip()
        remember_device = request.form.get("remember_device")

        code_valid = False
        if user.twofa_method == "TOTP":
            if verify_totp_code(username, code):
                code_valid = True
                flash("2FA TOTP verificada.", "success")
            else:
                flash("Código TOTP inválido.", "danger")
        elif user.twofa_method == "EMAIL":
            if user.pending_2fa_code_expires and user.pending_2fa_code_expires < datetime.utcnow():
                flash("El código 2FA de email ha expirado. Inicia sesión de nuevo.", "danger")
                session.pop("2fa_user_id", None)
                session.pop("2fa_username", None)
                return redirect(url_for("auth_bp.login"))

            if code == user.pending_2fa_code:
                code_valid = True
                user.pending_2fa_code = None
                user.pending_2fa_code_expires = None
                flash("2FA Email verificada.", "success")
            else:
                flash("Código OTP inválido.", "danger")
        else:
            flash("Método 2FA desconocido.", "warning")

        if code_valid:
            _setup_session(user)
            reset_failed_attempts(user)
            db.session.commit()

            if remember_device == "on":
                token, resp = create_remember_cookie(user)
                return resp
            else:
                return redirect(_post_2fa_redirect(username))

    return render_template("twofa.html", username=username)


def create_remember_cookie(user):
    from secrets import token_urlsafe
    from datetime import datetime, timedelta
    token = token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(days=15)
    rem_dev = RememberDevice(user_id=user.id, token=token, expires_at=expires)

    devices = RememberDevice.query.filter_by(user_id=user.id).order_by(RememberDevice.expires_at.asc()).all()
    if len(devices) >= 2:
        oldest = devices[0]
        db.session.delete(oldest)
    db.session.add(rem_dev)
    db.session.commit()

    resp = make_response(redirect(_post_2fa_redirect(user.username)))
    resp.set_cookie("remember_2fa_device", token, expires=expires, httponly=True)
    return token, resp


def _post_2fa_redirect(username):
    if username == current_app.config["ADMIN_USER"]:
        return url_for("admin_bp.dashboard")
    return url_for("main_bp.home")


@auth_bp.route("/logout")
def logout():
    # ✅ SEGURIDAD: Revocar token de sesión antes de limpiar
    from app.auth.session_tokens import revoke_session_token
    session_token = session.get("session_token")
    if session_token:
        revoke_session_token(session_token)
    
    # ✅ CORREGIDO: No incrementar el contador global al cerrar sesión individual
    # Solo limpiar la sesión del usuario actual sin afectar a otros usuarios
    session.clear()
    flash("Has cerrado sesión correctamente.", "info")
    # ✅ CORREGIDO: Redirigir al login de administradores en lugar del login de usuarios normales
    resp = make_response(redirect(url_for("auth_bp.login")))
    resp.set_cookie("remember_2fa_device", "", expires=0)
    return resp


@auth_bp.route("/forgot_password", methods=["GET", "POST"])
def forgot_password():
    form = ForgotPasswordForm(request.form)
    if request.method == "POST":
        if not form.validate():
            flash("Completa el campo de usuario o correo.", "danger")
            return render_template("forgot_password.html", form=form)

        user_input = form.user_input.data.strip()
        if not user_input:
            flash("Ingresa tu usuario o correo.", "danger")
            return render_template("forgot_password.html", form=form)

        user = User.query.filter(
            (User.username == user_input) | (User.email == user_input)
        ).first()

        if user:
            now = datetime.utcnow()
            window_10min = now - timedelta(minutes=10)
            if user.forgot_token_time is None or user.forgot_token_time < window_10min:
                user.forgot_count = 0
                user.forgot_token_time = now
            
            if user.forgot_count is None:
                user.forgot_count = 0

            if user.forgot_count >= 3:
                flash("Has superado el límite de 3 solicitudes en 10 minutos.", "danger")
                return redirect(url_for("user_auth_bp.login"))

            user.forgot_count += 1
            reset_tok = token_urlsafe(32)
            user.forgot_token = reset_tok
            
            db.session.commit()

            if user.email:
                reset_link = url_for("auth_bp.reset_password", token=reset_tok, _external=True)
                _send_reset_email(user.email, reset_link)
                flash("Si el correo existe, se envió un enlace de restablecimiento.", "info")
            else:
                flash("Este usuario no tiene correo asociado.", "danger")
        else:
            flash("Si el usuario/email existe, se enviará un enlace de recuperación.", "info")

        return redirect(url_for("user_auth_bp.login"))

    return render_template("forgot_password.html", form=form)


@auth_bp.route("/reset_password/<token>", methods=["GET", "POST"])
def reset_password(token):
    user = User.query.filter_by(forgot_token=token).first()
    if not user:
        flash("Token inválido o usuario no encontrado.", "danger")
        return redirect(url_for("user_auth_bp.login"))

    if request.method == "GET":
        return render_template("reset_password.html", token=token, user=user)

    new_password = request.form.get("new_password", "").strip()
    confirm_password = request.form.get("confirm_password", "").strip()
    if not new_password or new_password != confirm_password:
        flash("Las contraseñas no coinciden o están vacías.", "danger")
        return redirect(url_for("auth_bp.reset_password", token=token))

    user.password = generate_password_hash(new_password)
    user.forgot_token = None
    user.forgot_token_time = None
    user.forgot_count = 0
    db.session.commit()

    flash("Tu contraseña ha sido restablecida. Ya puedes iniciar sesión.", "success")
    return redirect(url_for("user_auth_bp.login"))


def _send_reset_email(to_email, reset_link):
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = os.getenv("SMTP_PORT", "465")
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")

    from email.mime.text import MIMEText
    from email.header import Header

    subject = "Restablecer Contraseña"
    body_text = (
        f"Has solicitado restablecer tu contraseña.\n"
        f"Haz clic en este enlace: {reset_link}\n\n"
        f"Si no fuiste tú, ignora este mensaje."
    )

    msg = MIMEText(body_text, "plain", "utf-8")
    msg["Subject"] = str(Header(subject, "utf-8"))
    msg["From"] = smtp_user
    msg["To"] = to_email

    try:
        with smtplib.SMTP_SSL(smtp_host, int(smtp_port)) as server:
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [to_email], msg.as_string())
    except Exception as e:
        # Error interno
        pass
@auth_bp.route("/resend_2fa_email_user/<username>", methods=["POST"])
def resend_2fa_email_user(username):
    user = User.query.filter_by(username=username).first_or_404()

    if not user.twofa_enabled or user.twofa_method != "EMAIL":
        flash("No se puede reenviar 2FA por Email a este usuario (no tiene 2FA Email).", "danger")
        return redirect(url_for("auth_bp.twofa", username=username))

    code = str(random.randint(100000, 999999))
    user.pending_2fa_code = code
    user.pending_2fa_code_expires = datetime.utcnow() + timedelta(minutes=10)
    db.session.commit()

    try:
        send_otp_email(user.email, code)
        flash("Se reenvió el código 2FA a tu correo.", "info")
    except Exception as e:
        flash(f"No se pudo reenviar el código 2FA: {e}", "danger")

    return redirect(url_for("auth_bp.twofa", username=username))


def _setup_session(user):
    from app.auth.session_tokens import generate_session_token
    
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    is_admin = user.username == admin_user and user.parent_id is None
    
    # ✅ SEGURIDAD: Generar token de sesión único para prevenir duplicaciones
    session_token = generate_session_token(user.id, is_admin=is_admin)
    
    session["logged_in"] = True
    session["username"] = user.username
    session["user_id"] = user.id
    session["session_token"] = session_token  # ✅ Token único de sesión
    session.permanent = True

    from app.admin.site_settings import get_site_setting
    rev_str = get_site_setting("session_revocation_count", "0")
    session["session_revocation_count"] = int(rev_str)
    session["user_session_rev_count_local"] = user.user_session_rev_count
    session["login_time"] = datetime.utcnow().isoformat()
    session.pop("2fa_user_id", None)
    session.pop("2fa_username", None)
