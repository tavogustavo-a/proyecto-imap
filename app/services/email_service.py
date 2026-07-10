import smtplib
import random
import os
import re
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formataddr, formatdate, make_msgid
from app.extensions import db
from flask import current_app, render_template


def _smtp_credentials():
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = (os.getenv("SMTP_USER", "") or "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    return smtp_host, smtp_port, smtp_user, smtp_password


def _is_valid_email_address(value: str) -> bool:
    em = (value or "").strip()
    if not em or "@" not in em:
        return False
    return bool(re.match(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", em))


def email_recipient_display_name(user) -> str:
    """
    Nombre seguro para el saludo del correo.
    Evita «Hola, 1» u otros usernames numéricos/cortos que parecen spam.
    """
    if not user:
        return ""
    full = (getattr(user, "full_name", None) or "").strip()
    if full and not re.match(r"^\d+$", full):
        return full
    un = (getattr(user, "username", None) or "").strip()
    if not un or un.lower() in ("anonimo", "generico", "genérico"):
        return ""
    if re.match(r"^\d+$", un):
        return ""
    if len(un) <= 2:
        return ""
    return un


def _transactional_reply_to(smtp_user: str) -> str | None:
    """Reply-To distinto del From autenticado mejora confianza; si no hay soporte, omitir."""
    raw = (os.getenv("SMTP_REPLY_TO", "") or os.getenv("SUPPORT_EMAIL", "") or "").strip()
    if raw and _is_valid_email_address(raw) and raw.lower() != (smtp_user or "").lower():
        return raw
    return None


def send_transactional_email(
    to_email,
    subject,
    body_text,
    body_html=None,
    *,
    from_display_name="Tu Premium",
):
    """
    Correo transaccional (tienda, renovaciones, etc.) vía SMTP autenticado.
    Mismas credenciales que OTP: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD.
    Cabeceras alineadas con buenas prácticas (From = cuenta autenticada, texto + HTML).
    """
    to_email = (to_email or "").strip()
    if not _is_valid_email_address(to_email):
        current_app.logger.warning(
            "Email transaccional omitido: destinatario inválido (%r).", to_email
        )
        return False

    smtp_host, smtp_port, smtp_user, smtp_password = _smtp_credentials()
    if not smtp_user or not smtp_password:
        current_app.logger.error(
            "SMTP_USER o SMTP_PASSWORD no configurados. No se puede enviar email transaccional."
        )
        return False

    subject = (subject or "").strip() or "Aviso de Tu Premium"
    body_text = (body_text or "").strip() or subject

    msg = MIMEMultipart("alternative")
    msg["Subject"] = str(Header(subject, "utf-8"))
    msg["From"] = formataddr((from_display_name, smtp_user))
    msg["To"] = to_email
    reply_to = _transactional_reply_to(smtp_user)
    if reply_to:
        msg["Reply-To"] = formataddr(("Soporte Tu Premium", reply_to))
    msg["Date"] = formatdate(localtime=True)
    domain = smtp_user.split("@")[-1] if "@" in smtp_user else "localhost"
    msg["Message-ID"] = make_msgid(domain=domain)
    msg["MIME-Version"] = "1.0"
    msg["Content-Language"] = "es"
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "All"

    msg.attach(MIMEText(body_text, "plain", "utf-8"))
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [to_email], msg.as_string())
        current_app.logger.info("Email transaccional enviado a %s", to_email)
        return True
    except Exception as e:
        current_app.logger.error(
            "No se pudo enviar email transaccional a %s: %s", to_email, e
        )
        return False


def render_transactional_email_html(
    email_title, recipient_name, paragraphs, *, preheader=None, include_store_link=True
):
    """Plantilla HTML con autoescape para párrafos de texto plano."""
    safe_name = (recipient_name or "").strip()
    para_list = [str(p).strip() for p in (paragraphs or []) if str(p).strip()]
    pre = (preheader or "").strip()
    if not pre and para_list:
        pre = para_list[0][:120]
    ctx = dict(
        email_title=email_title,
        recipient_name=safe_name,
        paragraphs=para_list,
        preheader=pre,
        year=datetime.utcnow().year,
        store_url=None,
    )
    with current_app.test_request_context():
        if include_store_link:
            try:
                from flask import url_for

                ctx["store_url"] = url_for("store_bp.store_front", _external=True)
            except Exception:
                ctx["store_url"] = None
        return render_template("email_transactional_template.html", **ctx)

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
