# app/smtp/smtp_server.py

import asyncio
import email
import logging
import threading
import time
from email.header import decode_header
from email.utils import getaddresses
from typing import Optional

from aiosmtpd.controller import Controller
from aiosmtpd.smtp import SMTP as SMTPServer
from flask import Blueprint, Flask

from app.services.email_buzon_service import process_smtp_email

smtp_server_bp = Blueprint('smtp_server', __name__)
_log = logging.getLogger(__name__)

# Referencia a la app Flask (run_smtp.py debe llamar bind_smtp_flask_app antes de start_smtp_server).
_smtp_flask_app: Optional[Flask] = None


def bind_smtp_flask_app(app: Flask) -> None:
    """Necesario para que process_smtp_email use db.session fuera del hilo principal."""
    global _smtp_flask_app
    _smtp_flask_app = app


def _line(msg: str) -> None:
    print(msg, flush=True)
    _log.info(msg)


def _decode_part_payload(part) -> str | None:
    """Decodifica el cuerpo de una parte MIME (no multipart)."""
    if part.get_content_maintype() == "multipart":
        return None
    payload = part.get_payload(decode=True)
    if payload is None:
        return None
    if not isinstance(payload, bytes):
        return str(payload)
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except (LookupError, TypeError, UnicodeError):
        return payload.decode("utf-8", errors="replace")


def extract_text_and_html_from_message(message: email.message.Message) -> tuple[str, str]:
    """
    Extrae texto plano y HTML de un mensaje, incluyendo multiparts anidados.
    Prefiere el HTML más largo (correos marketing suelen traer varias partes).
    """
    plain_chunks: list[str] = []
    html_chunks: list[str] = []

    if message.is_multipart():
        for part in message.walk():
            if part.get_content_maintype() == "multipart":
                continue
            if part.get_content_disposition() == "attachment":
                continue
            ctype = part.get_content_type()
            body = _decode_part_payload(part)
            if not body or not str(body).strip():
                continue
            if ctype == "text/plain":
                plain_chunks.append(body)
            elif ctype == "text/html":
                html_chunks.append(body)
        content_text = "\n\n".join(plain_chunks).strip()
        content_html = max(html_chunks, key=len).strip() if html_chunks else ""
    else:
        body = _decode_part_payload(message)
        if body is None:
            body = ""
        ctype = message.get_content_type()
        if ctype == "text/html":
            content_html = body.strip()
            content_text = ""
        else:
            content_text = body.strip()
            content_html = ""

    return content_text, content_html


def _decode_mime_header(value) -> str:
    """Decodifica =?UTF-8?Q?...?= y similares en cabeceras RFC 2047."""
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if not value:
        return ""
    try:
        parts = decode_header(value)
        chunks = []
        for text, charset in parts:
            if isinstance(text, bytes):
                chunks.append(text.decode(charset or "utf-8", errors="replace"))
            else:
                chunks.append(text)
        return "".join(chunks).strip()
    except Exception:
        return value


def _normalize_smtp_envelope_address(addr: str) -> str:
    """Quita <> y espacios del MAIL FROM / RCPT."""
    if not addr:
        return ""
    s = addr.strip()
    if s.startswith("<") and s.endswith(">"):
        s = s[1:-1].strip()
    return s


def _sender_from_rfc822_headers(message: email.message.Message) -> Optional[str]:
    """
    Dirección del remitente según cabeceras del mensaje (From / Sender / Resent-From).
    En reenvíos desde Gmail, MAIL FROM suele ser SRS (ej. +caf_=...) pero el From
    del MIME sigue siendo el emisor real (p. ej. Netflix).
    """
    for header in ("From", "Sender", "Resent-From"):
        raw = message.get(header)
        if not raw:
            continue
        decoded = _decode_mime_header(raw)
        for _name, addr in getaddresses([decoded]):
            addr = (addr or "").strip()
            if addr and "@" in addr:
                return addr
    return None


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
            
            # Remitente: preferir From (RFC 822) frente a MAIL FROM del sobre SMTP
            # (reenvíos/Gmail SRS suelen tener sobre distinto al emisor mostrable).
            hdr_from = _sender_from_rfc822_headers(message)
            env_from = _normalize_smtp_envelope_address(envelope.mail_from or "")
            from_email = hdr_from or env_from
            to_emails = envelope.rcpt_tos
            subject = _decode_mime_header(message.get("Subject", ""))
            
            content_text, content_html = extract_text_and_html_from_message(message)
            
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
                
                # BD Flask requiere application context (el handler SMTP va en otro hilo / asyncio).
                if _smtp_flask_app is None:
                    _line("❌ SMTP: bind_smtp_flask_app() no se llamó; no se puede guardar el correo")
                    return '451 Temporary failure'

                with _smtp_flask_app.app_context():
                    result = process_smtp_email(email_data)
                    # Leer id dentro del contexto: fuera de él el objeto queda detached tras commit.
                    saved_id = result.id if result is not None else None

                if saved_id is not None:
                    _line(f"✅ SMTP: guardado id={saved_id}")
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
