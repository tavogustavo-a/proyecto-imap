# app/services/sms_service.py
"""Servicio para manejar SMS usando Twilio"""

from flask import current_app, request
from twilio.rest import Client
from twilio.twiml.messaging_response import MessagingResponse
from app.extensions import db
from app.store.models import SMSConfig, SMSMessage
from app.utils.timezone import get_colombia_now
from datetime import datetime


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
        
        response = MessagingResponse()
        return str(response)
    
    except Exception as e:
        response = MessagingResponse()
        return str(response)


def receive_sms_from_android(from_number, to_number, message_body, sms_config_id=None):
    """
    Procesa un SMS recibido desde una app Android.
    
    Args:
        from_number: Número que envió el SMS (formato: +1234567890)
        to_number: Número que recibió el SMS (tu número Android)
        message_body: Contenido del mensaje SMS
        sms_config_id: ID de SMSConfig a usar (opcional, si no se proporciona busca por número o usa el primero habilitado)
    
    Returns:
        dict: {"success": bool, "message": str, "sms_message_id": int}
    """
    try:
        # Obtener configuración SMS
        if sms_config_id:
            config = SMSConfig.query.get(sms_config_id)
            if not config or not config.is_enabled:
                return {"success": False, "message": "SMSConfig no encontrado o deshabilitado"}
        else:
            # ✅ MEJORADO: Buscar configuración Android por número primero
            # Buscar configuración que coincida con el número Android
            config = SMSConfig.query.filter_by(phone_number=to_number, is_enabled=True).first()
            
            # Si no se encuentra, buscar configuración Android desde site_settings
            if not config:
                from app.admin.site_settings import get_site_setting
                android_config_id = get_site_setting("android_sms_config_id", None)
                if android_config_id:
                    try:
                        config = SMSConfig.query.get(int(android_config_id))
                        if config and config.is_enabled:
                            pass  # Usar esta configuración
                        else:
                            config = None
                    except (ValueError, TypeError):
                        config = None
            
            # Si aún no hay configuración, usar la primera habilitada
            if not config:
                config = SMSConfig.query.filter_by(is_enabled=True).first()
                if not config:
                    return {"success": False, "message": "No hay configuración SMS habilitada"}
        
        # Crear registro del SMS (similar a Twilio pero sin twilio_message_sid)
        raw_data = {
            'From': from_number,
            'To': to_number,
            'Body': message_body,
            'Source': 'android_app',  # Identificar que viene de Android
            'ReceivedAt': datetime.utcnow().isoformat()
        }
        
        sms_message = SMSMessage(
            sms_config_id=config.id,
            from_number=from_number,
            to_number=to_number,
            message_body=message_body,
            twilio_message_sid=None,  # No hay SID de Twilio para SMS de Android
            twilio_status='received',  # Estado recibido
            raw_data=raw_data,
            processed=False
        )
        
        db.session.add(sms_message)
        db.session.commit()
        
        return {
            "success": True,
            "message": "SMS recibido correctamente",
            "sms_message_id": sms_message.id,
            "sms_config_id": config.id
        }
    
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al recibir SMS desde Android: {e}", exc_info=True)
        return {"success": False, "message": f"Error al procesar SMS: {str(e)}"}
