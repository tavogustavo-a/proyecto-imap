# app/services/smtp_client.py
"""Envío SMTP de la tienda — delega en email_service (SMTP_USER autenticado)."""

from flask import current_app


def send_email_via_smtp(from_email, to_email, subject, text_content, html_content=None):
    """
    Envía email transaccional usando SMTP_HOST / SMTP_USER / SMTP_PASSWORD (.env).
    El remitente autenticado debe coincidir con SMTP_USER (política Gmail/SPF).
    """
    try:
        from app.services.email_service import send_transactional_email

        return send_transactional_email(
            to_email=to_email,
            subject=subject,
            body_text=text_content or "",
            body_html=html_content,
        )
    except Exception as ex:
        current_app.logger.error("send_email_via_smtp: %s", ex)
        return False


def simulate_email_send(from_email, to_email, subject, text_content, html_content=None):
    """
    Simula el envío de email creando un registro en la base de datos
    (Para desarrollo cuando no hay servidor SMTP de envío)
    """
    try:
        from app.models import ReceivedEmail
        from app.extensions import db

        simulated_email = ReceivedEmail(
            from_email=from_email,
            to_email=to_email,
            subject=f"[ENVIADO] {subject}",
            content_text=text_content,
            content_html=html_content or "",
            message_id=f"simulated-{hash(str(text_content))}",
            processed=True,
        )

        db.session.add(simulated_email)
        db.session.commit()

        current_app.logger.info("Email simulado: %s -> %s", from_email, to_email)
        return True

    except Exception as e:
        current_app.logger.error("Error simulando email: %s", e)
        return False
