import smtplib
import random
from email.mime.text import MIMEText
from email.header import Header
import os
from app.extensions import db

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
        print(f"No se pudo enviar OTP a {to_email}. Error: {e}")
        raise
