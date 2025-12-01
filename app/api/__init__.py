# app/api/__init__.py

from flask import Blueprint, jsonify, request, session
from app.services.search_service import search_and_apply_filters, search_and_apply_filters2
from app.models import User
from app.models.user import AllowedEmail
from app.models.service import ServiceModel
from app.store.models import SMSConfig, SMSMessage, AllowedSMSNumber, SMSRegex
from app.extensions import db
from app.utils.timezone import utc_to_colombia
from datetime import datetime, timedelta
import re

api_bp = Blueprint("api_bp", __name__)

@api_bp.route("/search_mails", methods=["POST"])
def search_mails():
    data = request.get_json()
    if not data or "email_to_search" not in data:
        return jsonify({"error": "Missing email_to_search"}), 400

    email_to_search = data["email_to_search"]
    service_id = data.get("service_id")

    user_id = session.get("user_id")
    if user_id:
        user = User.query.get(user_id)
    else:
        user = None  # usuario anónimo

    # Verificar si el servicio es SMS
    if service_id:
        service = ServiceModel.query.get(service_id)
        if service and service.visibility_mode == 'sms':
            # Lógica para búsqueda SMS (pasar el usuario para validaciones)
            return search_sms_messages(email_to_search, user)

    # Validar usuario (para búsquedas normales de correos)
    if user:
        if not user.enabled:
            return jsonify({"error": "No tienes permiso al consultar este correo."}), 403
        
        # Si el usuario NO puede buscar cualquiera, verificamos si el email está permitido
        if not user.can_search_any:
            # Consulta a la nueva tabla AllowedEmail
            is_allowed = user.allowed_email_entries.filter_by(email=email_to_search.lower()).first() is not None
            # Alternativa (puede ser ligeramente más eficiente si no necesitas el objeto):
            # is_allowed = db.session.query(AllowedEmail.query.filter_by(user_id=user.id, email=email_to_search.lower()).exists()).scalar()
            
            if not is_allowed:
                return jsonify({"error": "No tienes permiso para consultar este correo específico."}), 403
    else:
        # Usuario anónimo => se permite o no (tu lógica actual)
        pass

    # Llamada con user
    mail_result = search_and_apply_filters(email_to_search, service_id, user=user)
    if not mail_result:
        return jsonify({"results": []}), 200

    return jsonify({"results": [mail_result]}), 200

def search_sms_messages(email_to_search, user=None):
    """Busca mensajes SMS para un correo específico"""
    # Normalizar el correo a minúsculas
    email_normalized = email_to_search.lower().strip()
    
    # PRIMERO: Validar permisos del usuario (igual que en search_mails)
    if user:
        if not user.enabled:
            return jsonify({"error": "No tienes permiso al consultar este correo."}), 403
        
        # Si el usuario NO puede buscar cualquiera, verificamos si el email está permitido
        if not user.can_search_any:
            # Consulta a la tabla AllowedEmail del usuario
            is_allowed = user.allowed_email_entries.filter_by(email=email_normalized).first() is not None
            
            if not is_allowed:
                return jsonify({"error": "No tienes permiso para consultar este correo específico."}), 403
    
    # SEGUNDO: Verificar que el correo esté en la lista global de SMS y obtener su sms_config_id
    allowed_sms_entry = AllowedSMSNumber.query.filter_by(phone_number=email_normalized).first()
    if not allowed_sms_entry:
        return jsonify({"error": "No tienes permiso al consultar este correo."}), 403
    
    # Usar el sms_config_id del correo encontrado
    sms_config = SMSConfig.query.get(allowed_sms_entry.sms_config_id)
    if not sms_config:
        return jsonify({"error": "Configuración SMS asociada al correo no encontrada."}), 404
    
    # Verificar que la configuración esté habilitada (aunque siempre debería estar)
    if not sms_config.is_enabled:
        return jsonify({"error": "La configuración SMS asociada no está habilitada."}), 500
    
    # Obtener los regexes habilitados para este SMSConfig
    regexes = SMSRegex.query.filter_by(
        sms_config_id=sms_config.id,
        enabled=True
    ).order_by(SMSRegex.created_at.asc()).all()
    
    # Si no hay regexes configurados, no devolver ningún mensaje
    if not regexes:
        return jsonify({
            "results": [{
                "sms_messages": [],
                "sms_config_phone": sms_config.phone_number,
                "email_searched": email_to_search,
                "is_sms_result": True
            }]
        }), 200
    
    # Calcular la fecha límite: últimos 15 minutos
    time_limit = datetime.utcnow() - timedelta(minutes=15)
    
    # Obtener TODOS los mensajes SMS para este número específico
    # Ordenar por fecha descendente para obtener los más recientes primero
    all_messages = SMSMessage.query.filter(
        SMSMessage.sms_config_id == sms_config.id
    ).order_by(
        SMSMessage.created_at.desc()
    ).limit(200).all()  # Obtener más mensajes para asegurar que encontramos los que coinciden
    
    # Formatear los mensajes para el frontend
    # Solo incluir mensajes que coincidan con algún regex Y sean de los últimos 15 minutos
    messages_data = []
    
    for msg in all_messages:
        # Verificar que el mensaje sea de los últimos 15 minutos
        if not msg.created_at or msg.created_at < time_limit:
            continue  # Saltar mensajes más antiguos de 15 minutos
        
        extracted_code = None
        
        # Buscar el primer regex que coincida
        for regex_obj in regexes:
            try:
                match = re.search(regex_obj.pattern, msg.message_body, re.IGNORECASE)
                if match:
                    # Si hay grupos de captura, usar el primer grupo
                    if match.groups():
                        extracted_code = match.group(1)  # Primer grupo de captura
                    else:
                        # Si no hay grupos, usar el match completo
                        extracted_code = match.group(0)
                    break  # Usar el primer regex que coincida
            except re.error as e:
                # Si el regex es inválido, continuar con el siguiente
                continue
        
        # Solo agregar el mensaje si coincidió con algún regex
        if extracted_code is not None:
            messages_data.append({
                'id': msg.id,
                'from_number': msg.from_number,
                'to_number': msg.to_number,
                'message_body': extracted_code,  # Usar el código extraído
                'twilio_status': msg.twilio_status,
                'created_at': utc_to_colombia(msg.created_at).strftime('%d/%m/%Y|%I:%M %p') if msg.created_at else None,
                'is_sms': True  # Flag para identificar que son mensajes SMS
            })
            
            # Limitar a máximo 15 códigos
            if len(messages_data) >= 15:
                break
    
    # Devolver en formato similar a los correos pero con flag SMS
    # Incluso si no hay mensajes, devolver la estructura con lista vacía
    return jsonify({
        "results": [{
            "sms_messages": messages_data,
            "sms_config_phone": sms_config.phone_number,
            "email_searched": email_to_search,
            "is_sms_result": True
        }]
    }), 200

@api_bp.route("/search_mails2", methods=["POST"])
def search_mails2():
    """
    Ruta para búsqueda usando servidores IMAP2 (para search2.html).
    Las búsquedas son sin restricciones de usuario (incluso si el usuario está logueado),
    pero se aplican los filtros y regex configurados en el servicio.
    
    IMPORTANTE: Esta ruta NO valida permisos de usuario, permitiendo búsquedas
    sin restricciones para cualquier usuario (logueado o no).
    """
    data = request.get_json()
    if not data or "email_to_search" not in data:
        return jsonify({"error": "Missing email_to_search"}), 400

    email_to_search = data["email_to_search"]
    service_id = data.get("service_id")

    # Búsquedas sin restricciones: NO validamos usuario ni permisos
    # Incluso si hay un usuario logueado, ignoramos sus restricciones
    # Pasamos user=None para que use todos los filtros/regex del servicio
    # según la configuración, sin restricciones de usuario
    mail_result = search_and_apply_filters2(email_to_search, service_id, user=None)
    if not mail_result:
        return jsonify({"results": []}), 200

    return jsonify({"results": [mail_result]}), 200
