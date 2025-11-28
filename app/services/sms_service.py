# app/services/sms_service.py
"""Servicio para manejar SMS usando Twilio"""

from flask import current_app, request
from twilio.rest import Client
from twilio.twiml.messaging_response import MessagingResponse
from app.extensions import db
from app.store.models import SMSConfig, SMSMessage
from app.utils.timezone import get_colombia_now
import logging

logger = logging.getLogger(__name__)


def get_twilio_client(account_sid=None, auth_token=None):
    """Crea un cliente de Twilio"""
    if account_sid and auth_token:
        return Client(account_sid, auth_token)
    
    config = SMSConfig.query.filter_by(is_enabled=True).first()
    if config:
        return Client(config.twilio_account_sid, config.twilio_auth_token)
    
    raise ValueError("No hay configuración SMS habilitada")


def receive_sms_webhook():
    """Procesa un webhook de Twilio cuando se recibe un SMS"""
    try:
        from_number = request.form.get('From', '')
        to_number = request.form.get('To', '')
        message_body = request.form.get('Body', '')
        message_sid = request.form.get('MessageSid', '')
        
        config = SMSConfig.query.filter_by(phone_number=to_number, is_enabled=True).first()
        
        if not config:
            config = SMSConfig.query.filter_by(is_enabled=True).first()
            if not config:
                logger.error("No hay configuración SMS disponible")
                response = MessagingResponse()
                return str(response)
        
        raw_data = {
            'From': from_number,
            'To': to_number,
            'Body': message_body,
            'MessageSid': message_sid,
            'AccountSid': request.form.get('AccountSid', ''),
        }
        
        sms_message = SMSMessage(
            sms_config_id=config.id,
            from_number=from_number,
            to_number=to_number,
            message_body=message_body,
            twilio_message_sid=message_sid,
            twilio_status=request.form.get('MessageStatus', 'received'),
            raw_data=raw_data,
            processed=False
        )
        
        db.session.add(sms_message)
        db.session.commit()
        
        logger.info(f"SMS recibido: {from_number} -> {to_number} | {message_body[:50]}")
        
        response = MessagingResponse()
        return str(response)
    
    except Exception as e:
        logger.error(f"Error procesando webhook SMS: {str(e)}", exc_info=True)
        response = MessagingResponse()
        return str(response)

