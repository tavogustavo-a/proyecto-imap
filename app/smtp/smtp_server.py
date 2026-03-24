# app/smtp/smtp_server.py

import asyncio
import email
import logging
import threading
import time

from aiosmtpd.controller import Controller
from aiosmtpd.smtp import SMTP as SMTPServer
from flask import Blueprint

from app.services.email_buzon_service import process_smtp_email

smtp_server_bp = Blueprint('smtp_server', __name__)
_log = logging.getLogger(__name__)


def _line(msg: str) -> None:
    print(msg, flush=True)
    _log.info(msg)


class LoggingSMTP(SMTPServer):
    """Registra cada conexión TCP al puerto 25 (diagnóstico en journalctl)."""

    def connection_made(self, transport):
        try:
            peer = transport.get_extra_info('peername')
            _line(f"🔌 SMTP conexión entrante desde {peer!r}")
        except Exception:
            _line("🔌 SMTP conexión entrante (sin datos de peer)")
        super().connection_made(transport)


class LoggingController(Controller):
    def factory(self):
        return LoggingSMTP(self.handler)


class EmailHandler:
    """Manejador de emails SMTP que procesa los emails recibidos"""
    
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        """Maneja el comando RCPT TO del protocolo SMTP"""
        _line(f"📧 SMTP: RCPT TO <{address}>")
        envelope.rcpt_tos.append(address)
        return '250 OK'

    async def handle_DATA(self, server, session, envelope):
        """Maneja los datos del email recibido"""
        try:
            _line(f"📧 SMTP: DATA de mail_from={envelope.mail_from!r} rcpt={envelope.rcpt_tos!r}")
            
            # Parsear el email
            message = email.message_from_bytes(envelope.content)
            
            # Extraer información del email
            from_email = envelope.mail_from
            to_emails = envelope.rcpt_tos
            subject = message.get('Subject', '')
            
            # Obtener contenido del email
            content_text = ""
            content_html = ""
            
            if message.is_multipart():
                for part in message.walk():
                    content_type = part.get_content_type()
                    if content_type == "text/plain":
                        content_text = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                    elif content_type == "text/html":
                        content_html = part.get_payload(decode=True).decode('utf-8', errors='ignore')
            else:
                content_text = message.get_payload(decode=True).decode('utf-8', errors='ignore')
            
            # Procesar cada destinatario
            for to_email in to_emails:
                email_data = {
                    'from': from_email,
                    'to': to_email,
                    'subject': subject,
                    'body': content_text,
                    'html': content_html,
                    'message_id': message.get('Message-ID', f"smtp-{hash(str(envelope.content))}")
                }
                
                # Procesar el email usando el servicio existente
                result = process_smtp_email(email_data)
                
                if result:
                    _line(f"✅ SMTP: guardado id={result.id}")
                else:
                    _line("🚫 SMTP: rechazado (sin buzón / bloqueo / filtro papelera)")
            
            return '250 Message accepted for delivery'
            
        except Exception as e:
            _line(f"❌ SMTP: error procesando: {e}")
            return '550 Error processing message'

class SMTPServerManager:
    """Gestor del servidor SMTP"""
    
    def __init__(self, host='0.0.0.0', port=25):
        self.host = host
        self.port = port
        self.controller = None
        self.handler = EmailHandler()
        
    def start(self):
        """Inicia el servidor SMTP"""
        try:
            self.controller = LoggingController(
                self.handler,
                hostname=self.host,
                port=self.port,
            )
            self.controller.start()
            _line(f"🚀 Servidor SMTP escuchando en {self.host}:{self.port}")
            return True
        except Exception as e:
            _line(f"❌ Error iniciando servidor SMTP: {e}")
            return False
    
    def stop(self):
        """Detiene el servidor SMTP"""
        if self.controller:
            self.controller.stop()
            _line("🛑 Servidor SMTP detenido")

# Instancia global del servidor SMTP
smtp_manager = SMTPServerManager()

def start_smtp_server():
    """Función para iniciar el servidor SMTP en un hilo separado"""
    def run_server():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        success = smtp_manager.start()
        if success:
            try:
                # Mantener el servidor corriendo
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                smtp_manager.stop()
        else:
            _line("❌ No se pudo iniciar el servidor SMTP")
    
    # Ejecutar en un hilo separado
    smtp_thread = threading.Thread(target=run_server, daemon=True)
    smtp_thread.start()
    return smtp_thread

def stop_smtp_server():
    """Función para detener el servidor SMTP"""
    smtp_manager.stop()
