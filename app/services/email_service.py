import smtplib
import random
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
import os
from app.extensions import db
from flask import current_app, render_template

def send_otp_email(to_email, code):
    """
    Envía un OTP por correo usando las variables de entorno:
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
    Utiliza una plantilla HTML y una versión de texto plano para mejor entregabilidad.
    
    NOTA IMPORTANTE: Los estilos CSS en bloques <style> dentro del HTML del correo
    son completamente normales y estándar en la industria. NO afectan el SSL/TLS
    estricto de la conexión SMTP, ya que:
    - SSL/TLS cifra la CONEXIÓN entre servidores (transporte)
    - CSS es parte del CONTENIDO del mensaje (no relacionado con SSL)
    - El CSP estricto aplica solo a páginas web, NO a correos electrónicos
    Los correos HTML con CSS son la práctica estándar y segura para envío de OTP.
    """
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")

    if not smtp_user or not smtp_password:
        current_app.logger.error("SMTP_USER o SMTP_PASSWORD no configurados. No se puede enviar OTP.")
        return

    subject = "Código de verificación - Tu Premium"
    
    # Cuerpo en texto plano (fallback)
    body_text = f"Tu código de verificación es: {code}\n\nPor favor, introdúcelo para continuar. Si no has solicitado este código, ignora este mensaje."
    
    # Cuerpo en HTML usando plantilla (estilos definidos en bloque <style>)
    try:
        body_html = render_template('email_otp_template.html', code=code)
    except Exception as e:
        current_app.logger.error(f"Error renderizando plantilla de email: {e}")
        body_html = f"<html><body><h2>Código OTP: {code}</h2></body></html>"

    # Crear mensaje multipart
    msg = MIMEMultipart('alternative')
    msg["Subject"] = str(Header(subject, "utf-8"))
    msg["From"] = f"Tu Premium <{smtp_user}>"
    msg["To"] = to_email

    # Adjuntar partes
    msg.attach(MIMEText(body_text, "plain", "utf-8"))
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [to_email], msg.as_string())
    except Exception as e:
        current_app.logger.error(f"No se pudo enviar OTP a {to_email}. Error: {e}")
        raise

def send_security_alert_email(to_email, subject, body):
    """
    Envía un correo electrónico de alerta de seguridad usando smtplib.
    Siempre usa el email de respaldo e ignora el parámetro to_email.
    
    NOTA: Los estilos CSS en bloques <style> son normales en correos HTML
    y NO afectan el SSL/TLS estricto de la conexión SMTP.
    """
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")

    if not smtp_user or not smtp_password:
        current_app.logger.error("SMTP_USER o SMTP_PASSWORD no configurados. No se puede enviar alerta.")
        return

    # --- Lógica para email de respaldo ---
    fallback_email = None
    try:
        from app.admin.site_settings import get_site_setting
        fallback_email = get_site_setting("ADMIN_EMAIL_ALERT")
    except Exception:
        fallback_email = None

    if not fallback_email:
        fallback_email = current_app.config.get("ADMIN_EMAIL")

    if not fallback_email:
        try:
            from app.models import User
            admin_username_env = os.getenv("ADMIN_USER", "admin")
            admin_user = User.query.filter_by(username=admin_username_env).first()
            if admin_user:
                fallback_email = admin_user.email
        except Exception:
            fallback_email = None

    to_email = fallback_email

    if not to_email:
        current_app.logger.error("No se encontró destinatario para la alerta.")
        return

    # Crear mensaje multipart para la alerta
    msg = MIMEMultipart('alternative')
    msg["Subject"] = str(Header(subject, "utf-8"))
    msg["From"] = f"Seguridad Tu Premium <{smtp_user}>"
    msg["To"] = to_email

    # Versión texto plano
    msg.attach(MIMEText(body, "plain", "utf-8"))

    # Versión HTML simple para la alerta (estilos en bloque <style>)
    alert_html = f"""
    <html>
    <head>
        <style>
            .alert-box {{
                font-family: Arial, sans-serif;
                border: 1px solid #ffcccc;
                background-color: #fff5f5;
                padding: 20px;
                border-radius: 5px;
            }}
            .alert-header {{
                color: #cc0000;
                font-weight: bold;
                font-size: 18px;
                margin-bottom: 10px;
            }}
            .alert-footer {{
                font-size: 11px;
                color: #777;
                margin-top: 20px;
            }}
        </style>
    </head>
    <body>
        <div class="alert-box">
            <div class="alert-header">ALERTA DE SEGURIDAD</div>
            <p>{body.replace('\n', '<br>')}</p>
            <div class="alert-footer">Este es un mensaje automático del sistema de seguridad.</div>
        </div>
    </body>
    </html>
    """
    msg.attach(MIMEText(alert_html, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [to_email], msg.as_string())
    except Exception as e:
        current_app.logger.error(f"Error enviando alerta a {to_email}: {e}")
# --- Fin Función Implementada ---
