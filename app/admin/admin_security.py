# app/admin/admin_security.py

import random
import pyotp
import qrcode
import io
from datetime import datetime, timedelta

from flask import (
    request, flash, session, current_app,
    render_template, redirect, url_for, make_response, jsonify
)
from . import admin_bp
from app.extensions import db
from app.models import User
from app.services.email_service import send_otp_email
from werkzeug.security import generate_password_hash
from .decorators import admin_required

@admin_bp.route("/enable_2fa", methods=["POST"])
@admin_required
def enable_2fa():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    if admin_user.twofa_enabled:
        flash("Ya hay un 2FA activo, desactiva primero si quieres cambiarlo.", "warning")
        return redirect(url_for("admin_bp.dashboard"))

    method = request.form.get("method", "TOTP")
    admin_user.pending_2fa_method = method

    if method == "TOTP":
        if not admin_user.twofa_secret_enc:
            try:
                new_secret = pyotp.random_base32()
                admin_user.twofa_secret = new_secret
            except Exception as e:
                current_app.logger.error(f"[enable_2fa] ¡ERROR al generar/asignar secreto TOTP!: {e}", exc_info=True)
                flash("Error interno al generar el secreto 2FA. Revisa la configuración TWOFA_KEY.", "danger")
                db.session.rollback()
                return redirect(url_for("admin_bp.dashboard"))
        flash("Seleccionaste 2FA TOTP. Escanea el QR y luego confirma el código.", "info")

    elif method == "EMAIL":
        if not admin_user.email or not admin_user.email_verified:
            flash("Necesitas un correo verificado antes de activar 2FA por Email.", "danger")
            admin_user.pending_2fa_method = None
        else:
            code = str(random.randint(100000, 999999))
            admin_user.pending_2fa_code = code
            admin_user.pending_2fa_code_expires = datetime.utcnow() + timedelta(minutes=10)
            db.session.commit()
            try:
                send_otp_email(admin_user.email, code)
                flash("Se envió un código OTP a tu correo. Confírmalo para 2FA Email.", "info")
            except Exception as e:
                flash(f"No se pudo enviar OTP: {e}", "danger")

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        flash("Error al guardar la configuración 2FA en la base de datos.", "danger")
        admin_user.pending_2fa_method = None
        admin_user.twofa_secret_enc = None
        return redirect(url_for("admin_bp.dashboard"))

    return redirect(url_for("admin_bp.dashboard"))


@admin_bp.route("/qr_code")
def qr_code():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    if not admin_user or not admin_user.twofa_secret:
        flash("No hay secret TOTP para generar QR.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    issuer = "ProyectoIMAP"
    totp_uri = pyotp.TOTP(admin_user.twofa_secret).provisioning_uri(
        admin_user.username,
        issuer_name=issuer
    )
    import qrcode
    import io
    img = qrcode.make(totp_uri)
    output = io.BytesIO()
    img.save(output, "PNG")
    output.seek(0)

    resp = make_response(output.read())
    resp.headers.set("Content-Type", "image/png")
    return resp


@admin_bp.route("/confirm_2fa", methods=["POST"])
def confirm_2fa():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    if not admin_user.pending_2fa_method:
        flash("No hay 2FA pendiente por confirmar.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    code = request.form.get("code", "").strip()
    method = admin_user.pending_2fa_method

    if method == "TOTP":
        import pyotp
        totp = pyotp.TOTP(admin_user.twofa_secret)
        if totp.verify(code):
            admin_user.twofa_enabled = True
            admin_user.twofa_method = "TOTP"
            admin_user.pending_2fa_method = None
            admin_user.pending_2fa_code = None
            admin_user.pending_2fa_code_expires = None
            flash("2FA TOTP activado.", "success")
        else:
            flash("Código TOTP inválido.", "danger")

    elif method == "EMAIL":
        if admin_user.pending_2fa_code_expires and admin_user.pending_2fa_code_expires < datetime.utcnow():
            flash("El código 2FA por correo ha expirado. Solicita uno nuevo.", "danger")
            admin_user.pending_2fa_code = None
            admin_user.pending_2fa_code_expires = None
            admin_user.pending_2fa_method = None
            db.session.commit()
            return redirect(url_for("admin_bp.dashboard"))

        if code == admin_user.pending_2fa_code:
            admin_user.twofa_enabled = True
            admin_user.twofa_method = "EMAIL"
            admin_user.pending_2fa_method = None
            admin_user.pending_2fa_code = None
            admin_user.pending_2fa_code_expires = None
            flash("2FA Email activado.", "success")
        else:
            flash("Código OTP de correo inválido.", "danger")

    db.session.commit()
    return redirect(url_for("admin_bp.dashboard"))


@admin_bp.route("/cancel_pending_2fa", methods=["POST"])
def cancel_pending_2fa():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    if admin_user and admin_user.pending_2fa_method:
        admin_user.pending_2fa_method = None
        admin_user.pending_2fa_code = None
        admin_user.pending_2fa_code_expires = None
        if not admin_user.twofa_enabled:
            admin_user.twofa_secret = None
        db.session.commit()
        flash("Cancelaste la configuración 2FA pendiente.", "info")
    else:
        flash("No había configuración 2FA pendiente.", "warning")
    return redirect(url_for("admin_bp.dashboard"))


@admin_bp.route("/disable_2fa", methods=["GET", "POST"])
def disable_2fa():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    if request.method == "GET":
        if not admin_user.twofa_enabled:
            flash("No hay 2FA activo que desactivar.", "danger")
            return redirect(url_for("admin_bp.dashboard"))

        if admin_user.twofa_method == "EMAIL":
            code = str(random.randint(100000, 999999))
            admin_user.pending_2fa_code = code
            admin_user.pending_2fa_code_expires = datetime.utcnow() + timedelta(minutes=10)
            db.session.commit()
            if admin_user.email:
                try:
                    send_otp_email(admin_user.email, code)
                    flash("Se envió un código OTP a tu correo para desactivar 2FA.", "info")
                except Exception as e:
                    flash(f"Error enviando OTP: {e}", "danger")

        return render_template("disable_2fa.html", user=admin_user)

    code = request.form.get("code", "").strip()
    if admin_user.twofa_method == "TOTP":
        import pyotp
        totp = pyotp.TOTP(admin_user.twofa_secret)
        if totp.verify(code):
            admin_user.twofa_enabled = False
            admin_user.twofa_method = ""
            admin_user.twofa_secret = None
            admin_user.pending_2fa_method = None
            admin_user.pending_2fa_code = None
            admin_user.pending_2fa_code_expires = None
            db.session.commit()
            flash("2FA TOTP desactivado.", "success")
        else:
            flash("Código TOTP inválido.", "danger")

    elif admin_user.twofa_method == "EMAIL":
        if admin_user.pending_2fa_code_expires and admin_user.pending_2fa_code_expires < datetime.utcnow():
            flash("El código ha expirado. Solicita otro OTP.", "danger")
            admin_user.pending_2fa_code = None
            admin_user.pending_2fa_code_expires = None
            db.session.commit()
            return redirect(url_for("admin_bp.dashboard"))

        if code == admin_user.pending_2fa_code:
            admin_user.twofa_enabled = False
            admin_user.twofa_method = ""
            admin_user.twofa_secret = None
            admin_user.pending_2fa_method = None
            admin_user.pending_2fa_code = None
            admin_user.pending_2fa_code_expires = None
            db.session.commit()
            flash("2FA por correo desactivado.", "success")
        else:
            flash("Código OTP inválido.", "danger")

    return redirect(url_for("admin_bp.dashboard"))


@admin_bp.route("/start_change_admin", methods=["GET", "POST"])
def start_change_admin():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    if not admin_user or not admin_user.twofa_enabled:
        flash("No hay 2FA activo, no se puede cambiar credenciales.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    if request.method == "GET":
        if admin_user.twofa_method == "EMAIL":
            code = str(random.randint(100000, 999999))
            admin_user.pending_2fa_code = code
            admin_user.pending_2fa_code_expires = datetime.utcnow() + timedelta(minutes=10)
            db.session.commit()
            if admin_user.email:
                try:
                    send_otp_email(admin_user.email, code)
                    flash("Se envió un código OTP a tu correo para cambiar credenciales.", "info")
                except Exception as e:
                    flash(f"Error enviando OTP: {e}", "danger")

        return render_template("verify_2fa_for_creds.html")

    code = request.form.get("code", "").strip()
    if admin_user.twofa_method == "TOTP":
        import pyotp
        totp = pyotp.TOTP(admin_user.twofa_secret)
        if totp.verify(code):
            session["can_change_admin"] = True
            session["2fa_verified_time"] = datetime.utcnow().isoformat()
            flash("Código TOTP correcto. Ahora cambia credenciales.", "success")
            return redirect(url_for("admin_bp.change_creds_form"))
        else:
            flash("Código TOTP inválido.", "danger")

    elif admin_user.twofa_method == "EMAIL":
        if admin_user.pending_2fa_code_expires and admin_user.pending_2fa_code_expires < datetime.utcnow():
            flash("El código ha expirado. Solicita otro OTP.", "danger")
            admin_user.pending_2fa_code = None
            admin_user.pending_2fa_code_expires = None
            db.session.commit()
            return redirect(url_for("admin_bp.dashboard"))

        if code == admin_user.pending_2fa_code:
            session["can_change_admin"] = True
            session["2fa_verified_time"] = datetime.utcnow().isoformat()
            flash("OTP de correo correcto. Ahora cambia credenciales.", "success")
            return redirect(url_for("admin_bp.change_creds_form"))
        else:
            flash("Código OTP inválido.", "danger")

    return redirect(url_for("admin_bp.dashboard"))


@admin_bp.route("/change_creds_form", methods=["GET", "POST"])
def change_creds_form():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    if not admin_user or not admin_user.twofa_enabled:
        flash("No hay 2FA activo, no se puede cambiar credenciales.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    if not session.get("can_change_admin"):
        flash("Debes verificar 2FA antes de cambiar credenciales.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    verified_time_str = session.get("2fa_verified_time")
    if not verified_time_str:
        flash("Necesitas verificar 2FA para cambiar credenciales.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    from datetime import datetime, timedelta
    verified_time = datetime.fromisoformat(verified_time_str)
    if datetime.utcnow() - verified_time > timedelta(minutes=10):
        flash("Han pasado más de 10 minutos desde que confirmaste 2FA. Reintenta.", "warning")
        return redirect(url_for("admin_bp.dashboard"))

    if request.method == "GET":
        return render_template("change_creds_form.html", admin_user=admin_user)

    new_password = request.form.get("new_password", "").strip()
    new_email = request.form.get("new_email", "").strip()

    if new_password:
        admin_user.password = generate_password_hash(new_password)

    if new_email:
        if admin_user.twofa_method == "EMAIL":
            code = str(random.randint(100000, 999999))
            admin_user.pending_email_code = code
            admin_user.pending_email_code_expires = datetime.utcnow() + timedelta(minutes=10)
            db.session.commit()
            session["new_otp_email"] = new_email

            try:
                send_otp_email(new_email, code)
                flash(f"Se envió un OTP al nuevo correo {new_email}. Confírmalo.", "info")
            except Exception as e:
                flash(f"No se pudo enviar OTP a {new_email}. Error: {e}", "danger")

            return redirect(url_for("admin_bp.confirm_new_otp_email"))
        else:
            admin_user.email = new_email
            admin_user.email_verified = True
            admin_user.recovery_email = new_email

    db.session.commit()
    session["can_change_admin"] = False
    flash("Credenciales del admin actualizadas.", "success")
    return redirect(url_for("auth_bp.logout"))


@admin_bp.route("/confirm_new_otp_email", methods=["GET", "POST"])
def confirm_new_otp_email():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    if not admin_user or not admin_user.pending_email_code:
        flash("No hay un correo pendiente de confirmación.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    new_otp_email = session.get("new_otp_email")
    if not new_otp_email:
        flash("No se encontró el correo que se pretendía confirmar.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    if request.method == "GET":
        return render_template("confirm_new_otp_email.html", new_otp_email=new_otp_email)

    code_input = request.form.get("code", "").strip()
    if not code_input:
        flash("No ingresaste ningún código.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    if admin_user.pending_email_code_expires and admin_user.pending_email_code_expires < datetime.utcnow():
        flash("El código para verificar el nuevo correo ha expirado. Solicita otro.", "danger")
        admin_user.pending_email_code = None
        admin_user.pending_email_code_expires = None
        db.session.commit()
        return redirect(url_for("admin_bp.dashboard"))

    if code_input == admin_user.pending_email_code:
        admin_user.email = new_otp_email
        admin_user.email_verified = True
        admin_user.recovery_email = None
        admin_user.pending_email_code = None
        admin_user.pending_email_code_expires = None
        db.session.commit()

        session.pop("new_otp_email", None)
        flash(f"Nuevo correo unificado {new_otp_email} confirmado.", "success")
    else:
        flash("El código ingresado es inválido.", "danger")

    return redirect(url_for("admin_bp.dashboard"))


@admin_bp.route("/set_admin_email", methods=["POST"])
def set_admin_email():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    new_email = request.form.get("new_email", "").strip()
    if not new_email:
        flash("No ingresaste un email.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    admin_user.recovery_email = new_email
    admin_user.email_verified = False

    from datetime import datetime, timedelta
    code = str(random.randint(100000, 999999))
    admin_user.pending_email_code = code
    admin_user.pending_email_code_expires = datetime.utcnow() + timedelta(minutes=10)
    db.session.commit()

    session["new_otp_email"] = new_email
    try:
        send_otp_email(new_email, code)
        flash(f"Se envió un código a {new_email}. Confírmalo para verificar el correo.", "info")
    except Exception as e:
        flash(f"No se pudo enviar código a {new_email}: {e}", "danger")

    return redirect(url_for("admin_bp.confirm_new_otp_email"))


@admin_bp.route("/resend_activation_email_otp", methods=["POST"])
@admin_required
def resend_activation_email_otp():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    if not admin_user:
        flash("No se encontró el usuario admin.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    if admin_user.pending_2fa_method != "EMAIL":
        flash("No hay una activación 2FA por Email pendiente.", "warning")
        return redirect(url_for("admin_bp.dashboard"))

    if not admin_user.email or not admin_user.email_verified:
        flash("Se necesita un correo verificado para reenviar el OTP.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    code = str(random.randint(100000, 999999))
    admin_user.pending_2fa_code = code
    admin_user.pending_2fa_code_expires = datetime.utcnow() + timedelta(minutes=10)
    
    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        flash("Error interno al guardar el nuevo código OTP.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    try:
        email_to_send = admin_user.email
        if not email_to_send:
            flash("No hay un correo configurado para el admin para enviar el OTP.", "danger")
            return redirect(url_for("admin_bp.disable_2fa")) 
        
        send_otp_email(email_to_send, code)
        flash("Se reenvió el código de activación 2FA a tu correo.", "info")
    except Exception as e:
        current_app.logger.error(f"[resend_activation] EXCEPCIÓN al intentar enviar OTP a {admin_user.email}: {e}", exc_info=True)
        flash(f"No se pudo reenviar el código de activación: {e}", "danger")

    return redirect(url_for("admin_bp.dashboard"))


@admin_bp.route("/resend_2fa_code_disable", methods=["POST"])
@admin_required
def resend_2fa_code_disable():
    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()
    if not admin_user:
        flash("No se encontró el usuario admin.", "danger")
        return redirect(url_for("admin_bp.dashboard"))

    if not admin_user.twofa_enabled or admin_user.twofa_method != "EMAIL":
        flash("No se puede reenviar código: 2FA no está activo o no es por Email.", "danger")
        return redirect(url_for("admin_bp.disable_2fa"))

    code = str(random.randint(100000, 999999))
    admin_user.pending_2fa_code = code
    admin_user.pending_2fa_code_expires = datetime.utcnow() + timedelta(minutes=10)
    
    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        flash("Error interno al guardar el nuevo código OTP.", "danger")
        return redirect(url_for("admin_bp.disable_2fa"))

    try:
        email_to_send = admin_user.email
        if not email_to_send:
            flash("No hay un correo configurado para el admin para enviar el OTP.", "danger")
            return redirect(url_for("admin_bp.disable_2fa")) 
        
        send_otp_email(email_to_send, code)
        flash("Se reenvió el código 2FA a tu correo.", "info")
    except Exception as e:
        current_app.logger.error(f"[resend_disable] EXCEPCIÓN al intentar enviar OTP a {admin_user.email}: {e}", exc_info=True)
        flash(f"No se pudo reenviar el código 2FA: {e}", "danger")

    return redirect(url_for("admin_bp.disable_2fa"))


@admin_bp.route('/resend_2fa_code_for_creds', methods=['POST'])
@admin_required
def resend_2fa_code_for_creds():
    """Genera y reenvía el código OTP para el admin logueado, si usa el método EMAIL."""
    try:
        admin_username = session.get("username")
        if not admin_username or admin_username != current_app.config.get("ADMIN_USER"):
            return jsonify({"status": "error", "message": "Permiso denegado o sesión inválida"}), 403

        admin_user = User.query.filter_by(username=admin_username).first()
        if not admin_user:
            return jsonify({"status": "error", "message": "Usuario admin no encontrado"}), 404

        # Verificar que el 2FA esté habilitado y sea por EMAIL
        if not admin_user.twofa_enabled or admin_user.twofa_method != "EMAIL":
            return jsonify({"status": "error", "message": "El reenvío de código solo está disponible para el método EMAIL activo."}), 400

        if not admin_user.email or not admin_user.email_verified:
            return jsonify({"status": "error", "message": "No hay un correo verificado para enviar el código."}), 400

        # Generar, guardar y enviar el nuevo código OTP
        new_code = str(random.randint(100000, 999999))
        admin_user.pending_2fa_code = new_code # Usar el campo existente para OTPs pendientes
        admin_user.pending_2fa_code_expires = datetime.utcnow() + timedelta(minutes=10)

        try:
            db.session.commit()
        except Exception as db_err:
            db.session.rollback()
            current_app.logger.error(f"Error DB al guardar nuevo OTP para reenvío ({admin_username}): {db_err}", exc_info=True)
            return jsonify({"status": "error", "message": "Error interno al guardar el código"}), 500

        try:
            send_otp_email(admin_user.email, new_code)

            return jsonify({"status": "ok", "message": "Código reenviado."}) # Añadir mensaje para JS si es útil
        except Exception as email_err:
            current_app.logger.error(f"Error al reenviar OTP para credenciales ({admin_username}): {email_err}", exc_info=True)
            # Aunque falle el email, el código se generó. Devolver OK para el contador? O error?
            # Devolver error es más seguro, para que el usuario sepa que no se envió.
            return jsonify({"status": "error", "message": "Error al enviar el correo."}), 500

    except Exception as e:
        current_app.logger.error(f"Error general en resend_2fa_code_for_creds: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno del servidor"}), 500
