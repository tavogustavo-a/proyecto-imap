import smtplib
import random
from email.mime.text import MIMEText
from email.header import Header
import os
from app.extensions import db
from flask import current_app

def send_otp_email(to_email, code):
    """
    Envía un OTP por correo usando las variables de entorno:
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
    Asegúrate de que la configuración sea correcta y que
    el servidor permita conexiones en el puerto indicado.
    """
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")

    subject = "Código OTP"
    body_text = f"Tu código OTP es: {code}\nPor favor introdúcelo para continuar."

    msg = MIMEText(body_text, "plain", "utf-8")
    msg["Subject"] = str(Header(subject, "utf-8"))
    msg["From"] = smtp_user
    msg["To"] = to_email

    try:
        # Conexión SSL (normal para puerto 465)
        with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [to_email], msg.as_string())

    except Exception as e:
        # Maneja el error para que se vea en logs y sepas si es credencial o puerto
        # print(f"No se pudo enviar OTP a {to_email}. Error: {e}")
        raise

# --- FUNCIÓN IMPLEMENTADA usando smtplib --- 
def send_security_alert_email(to_email, subject, body):
    """
    Envía un correo electrónico de alerta de seguridad usando smtplib,
    similar a send_otp_email, con las credenciales SMTP del .env.
    """
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USER", "")  # Remitente
    smtp_password = os.getenv("SMTP_PASSWORD", "")

    if not smtp_user or not smtp_password:
        current_app.logger.error("SMTP_USER o SMTP_PASSWORD no configurados en .env. No se puede enviar alerta.")
        return

    # --- NUEVO: lógica de respaldo para 'to_email' ---
    if not to_email:
        # 1) Intentar SiteSetting 'ADMIN_EMAIL_ALERT' si se está ejecutando dentro de app context
        fallback_email = None
        try:
            from app.admin.site_settings import get_site_setting
            fallback_email = get_site_setting("ADMIN_EMAIL_ALERT")
        except Exception:
            # Puede no haber contexto o tabla, ignorar
            fallback_email = None

        # 2) Intentar variable de configuración 'ADMIN_EMAIL'
        if not fallback_email:
            from flask import current_app as _ca
            fallback_email = _ca.config.get("ADMIN_EMAIL") if _ca else None

        # 3) Intentar correo del usuario administrador definido en ADMIN_USER
        if not fallback_email:
            try:
                from app.models import User  # Importar aquí para evitar ciclos al inicio
                admin_username_env = os.getenv("ADMIN_USER", "admin")
                admin_user = User.query.filter_by(username=admin_username_env).first()
                if admin_user and admin_user.email:
                    fallback_email = admin_user.email
            except Exception:
                # Evitar fallar si no existe contexto o la tabla todavía
                fallback_email = None

        to_email = fallback_email

        if not to_email:
            current_app.logger.error("No se encontró un correo destinatario (ADMIN_EMAIL_ALERT/ADMIN_EMAIL). Alerta no enviada.")
            return
        else:
            current_app.logger.warning(f"'to_email' vacío. Usando email de respaldo: {to_email}")
    # --- FIN NUEVO ---

    msg = MIMEText(body, "plain", "utf-8") # Usar el cuerpo de la alerta
    msg["Subject"] = str(Header(subject, "utf-8")) # Usar el asunto de la alerta
    msg["From"] = smtp_user
    msg["To"] = to_email

    try:
        with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [to_email], msg.as_string())

    except Exception as e:
        current_app.logger.error(f"Error enviando alerta de seguridad a {to_email} vía smtplib: {e}", exc_info=True)
        # Considerar si se debe lanzar la excepción o solo loguear
        # raise # Descomentar si quieres que el error se propague
# --- Fin Función Implementada ---
