# app/services/smtp_client.py

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from flask import current_app

def send_email_via_smtp(from_email, to_email, subject, text_content, html_content=None):
    """
    Envía un email usando el servidor SMTP local en puerto 587
    """
    try:
        # Configuración SMTP para envío
        smtp_host = current_app.config.get('SMTP_SEND_HOST', '127.0.0.1')
        smtp_port = current_app.config.get('SMTP_SEND_PORT', 587)
        
        # Crear mensaje
        msg = MIMEMultipart('alternative')
        msg['From'] = from_email
        msg['To'] = to_email
        msg['Subject'] = subject
        
        # Agregar contenido de texto
        if text_content:
            text_part = MIMEText(text_content, 'plain', 'utf-8')
            msg.attach(text_part)
        
        # Agregar contenido HTML si existe
        if html_content:
            html_part = MIMEText(html_content, 'html', 'utf-8')
            msg.attach(html_part)
        
        # Conectar y enviar
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            # No necesitamos autenticación para servidor local
            server.send_message(msg)
            
        print(f"✅ Email enviado exitosamente: {from_email} -> {to_email}")
        return True
        
    except Exception as e:
        print(f"❌ Error enviando email: {e}")
        return False

def simulate_email_send(from_email, to_email, subject, text_content, html_content=None):
    """
    Simula el envío de email creando un registro en la base de datos
    (Para desarrollo cuando no hay servidor SMTP de envío)
    """
    try:
        from app.models import ReceivedEmail
        from app.extensions import db
        
        # Crear email simulado como "enviado"
        simulated_email = ReceivedEmail(
            from_email=from_email,
            to_email=to_email,
            subject=f"[ENVIADO] {subject}",
            content_text=text_content,
            content_html=html_content or "",
            message_id=f"simulated-{hash(str(text_content))}",
            processed=True
        )
        
        db.session.add(simulated_email)
        db.session.commit()
        
        print(f"✅ Email simulado creado: {from_email} -> {to_email}")
        return True
        
    except Exception as e:
        print(f"❌ Error simulando email: {e}")
        return False
