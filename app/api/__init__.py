# app/api/__init__.py

from flask import Blueprint, jsonify, request, session, current_app
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

# Decorator para excluir rutas del CSRF (para APIs externas)
def csrf_exempt_api(func):
    """Decorator para excluir rutas de la API del CSRF"""
    func._csrf_exempt = True
    return func

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
    """Busca mensajes SMS para un correo específico en TODOS los números donde esté agregado"""
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
    
    # SEGUNDO: Obtener TODOS los números SMS donde este correo esté agregado
    allowed_sms_entries = AllowedSMSNumber.query.filter_by(phone_number=email_normalized).all()
    if not allowed_sms_entries:
        return jsonify({"error": "No tienes permiso al consultar este correo."}), 403
    
    # Obtener todos los sms_config_id únicos donde el correo esté agregado
    sms_config_ids = list(set([entry.sms_config_id for entry in allowed_sms_entries]))
    
    # Obtener todas las configuraciones SMS
    sms_configs = SMSConfig.query.filter(SMSConfig.id.in_(sms_config_ids)).all()
    
    # Verificar que todas las configuraciones estén habilitadas
    enabled_configs = [config for config in sms_configs if config.is_enabled]
    if not enabled_configs:
        return jsonify({"error": "Ninguna configuración SMS asociada está habilitada."}), 500
    
    # Calcular la fecha límite: últimos 15 minutos
    time_limit = datetime.utcnow() - timedelta(minutes=15)
    
    # Buscar mensajes en TODOS los números donde el correo esté agregado
    all_messages_data = []
    
    for sms_config in enabled_configs:
        # Obtener los regexes habilitados para este SMSConfig
        regexes = SMSRegex.query.filter_by(
            sms_config_id=sms_config.id,
            enabled=True
        ).order_by(SMSRegex.created_at.asc()).all()
        
        # Si no hay regexes configurados para este número, saltarlo
        if not regexes:
            continue
        
        # Obtener TODOS los mensajes SMS para este número específico
        all_messages = SMSMessage.query.filter(
            SMSMessage.sms_config_id == sms_config.id
        ).order_by(
            SMSMessage.created_at.desc()
        ).limit(200).all()
        
        # Procesar mensajes de este número
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
                except re.error:
                    # Si el regex es inválido, continuar con el siguiente
                    continue
            
            # Solo agregar el mensaje si coincidió con algún regex
            if extracted_code is not None:
                all_messages_data.append({
                    'id': msg.id,
                    'from_number': msg.from_number,
                    'to_number': msg.to_number,
                    'message_body': extracted_code,  # Usar el código extraído
                    'twilio_status': msg.twilio_status,
                    'created_at': utc_to_colombia(msg.created_at).strftime('%d/%m/%Y|%I:%M %p') if msg.created_at else None,
                    'is_sms': True,  # Flag para identificar que son mensajes SMS
                    'sms_config_phone': sms_config.phone_number  # Agregar el número para referencia
                })
                
                # Limitar a máximo 15 códigos en total (de todos los números)
                if len(all_messages_data) >= 15:
                    break
        
        # Si ya alcanzamos el límite, salir del bucle
        if len(all_messages_data) >= 15:
            break
    
    # Ordenar todos los mensajes por fecha descendente (más recientes primero)
    all_messages_data.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    
    # Limitar a máximo 15 códigos en total
    all_messages_data = all_messages_data[:15]
    
    # Obtener la lista de números donde se encontraron mensajes (para mostrar en el frontend)
    phones_found = list(set([msg.get('sms_config_phone', '') for msg in all_messages_data]))
    
    # Devolver en formato similar a los correos pero con flag SMS
    return jsonify({
        "results": [{
            "sms_messages": all_messages_data,
            "sms_config_phone": ", ".join(phones_found) if phones_found else enabled_configs[0].phone_number if enabled_configs else "",
            "email_searched": email_to_search,
            "is_sms_result": True
        }]
    }), 200

@api_bp.route("/sms/android-receive", methods=["POST"])
@api_bp.route("/sms/android/receive", methods=["POST"])  # ✅ Alias para compatibilidad con SMS Forwarder
@csrf_exempt_api  # ✅ Exentar del CSRF porque es una API externa (SMS Forwarder no puede enviar tokens CSRF)
def receive_sms_from_android():
    """
    Endpoint para recibir SMS desde una app Android.
    Este endpoint permite que una app Android envíe SMS recibidos al servidor.
    
    Formato esperado (JSON):
    {
        "from_number": "+1234567890",  // Número que envió el SMS
        "to_number": "+0987654321",    // Tu número Android
        "message_body": "Código: 123456",  // Contenido del SMS
        "sms_config_id": 1,            // (Opcional) ID de SMSConfig a usar
        "api_key": "tu_api_key_secreta"  // (Opcional) Clave API para seguridad
    }
    
    Respuesta:
    {
        "success": true,
        "message": "SMS recibido correctamente",
        "sms_message_id": 123
    }
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"success": False, "error": "No se recibieron datos"}), 400
        
        # ✅ COMPATIBILIDAD SMS FORWARDER: Detectar formato simple (solo 'text')
        is_text_only_format = len(data) == 1 and 'text' in data and not isinstance(data.get('text', ''), dict)
        
        # ✅ FLEXIBLE: Aceptar múltiples nombres de campos (compatibilidad con diferentes apps)
        # Intentar diferentes nombres comunes que pueden usar las apps Android
        
        # Para el número remitente (quien envió el SMS)
        from_number = (
            data.get("from_number") or 
            data.get("from") or 
            data.get("sender") or 
            data.get("phone_number") or
            data.get("phone") or
            data.get("address") or  # Algunas apps usan "address" para el remitente
            data.get("originating_address") or
            data.get("orig_addr")
        )
        if from_number:
            from_number = str(from_number).strip()
        
        # Para el número destinatario (tu número Android)
        to_number = (
            data.get("to_number") or 
            data.get("to") or 
            data.get("receiver") or 
            data.get("recipient") or
            data.get("destination") or
            data.get("dest_addr")
        )
        if to_number:
            to_number = str(to_number).strip()
        
        # Para el cuerpo del mensaje
        message_body = (
            data.get("message_body") or 
            data.get("message") or 
            data.get("body") or 
            data.get("text") or
            data.get("content") or
            data.get("sms_body") or
            data.get("msg")
        )
        if message_body:
            message_body = str(message_body).strip()
        
        # ✅ INTELIGENTE: Si falta to_number, intentar obtenerlo de la configuración Android
        if not to_number:
            android_config = SMSConfig.query.filter_by(number_type='android', is_enabled=True).first()
            if android_config:
                to_number = android_config.phone_number
        
        # ✅ INTELIGENTE: Si falta from_number pero hay message_body, usar "Desconocido" como fallback
        if not from_number:
            from_number = "Desconocido"
        
        # Validar campos requeridos (message_body es el único realmente crítico)
        if not message_body:
            return jsonify({
                "success": False,
                "error": "Falta el campo requerido: message_body (o message/body/text)"
            }), 400
        
        # Si falta to_number después de intentar inferirlo, es un error crítico
        if not to_number:
            return jsonify({
                "success": False,
                "error": "No se pudo determinar el número destinatario. Configura un número Android en el panel de administración."
            }), 400
        
        # ✅ API KEY OPCIONAL: Validar solo si está configurada, permitir acceso sin ella
        api_key = data.get("api_key", "")
        from app.admin.site_settings import get_site_setting
        expected_api_key_db = get_site_setting("android_sms_api_key", "")
        expected_api_key_config = current_app.config.get("ANDROID_SMS_API_KEY", None)
        
        # Usar la API key de la BD si existe, sino la de config.py
        expected_api_key = expected_api_key_db if expected_api_key_db else expected_api_key_config
        
        # Solo validar si hay API key configurada Y se envió una API key
        if expected_api_key and api_key:
            if api_key != expected_api_key:
                return jsonify({
                    "success": False, 
                    "error": "API key inválida"
                }), 401
        
        # Obtener sms_config_id si se proporciona, o buscar configuración Android automáticamente
        sms_config_id = data.get("sms_config_id")
        if sms_config_id:
            try:
                sms_config_id = int(sms_config_id)
            except (ValueError, TypeError):
                sms_config_id = None
        else:
            # ✅ MEJORADO: Si no se proporciona sms_config_id, buscar configuración Android
            # Buscar por número primero
            config_by_number = SMSConfig.query.filter_by(phone_number=to_number, is_enabled=True).first()
            if config_by_number:
                sms_config_id = config_by_number.id
            else:
                # Buscar configuración Android desde site_settings
                from app.admin.site_settings import get_site_setting
                android_config_id = get_site_setting("android_sms_config_id", None)
                if android_config_id:
                    try:
                        android_config = SMSConfig.query.get(int(android_config_id))
                        if android_config and android_config.is_enabled:
                            sms_config_id = android_config.id
                    except (ValueError, TypeError):
                        pass
        
        # Procesar el SMS usando el servicio
        from app.services.sms_service import receive_sms_from_android
        result = receive_sms_from_android(
            from_number=from_number,
            to_number=to_number,
            message_body=message_body,
            sms_config_id=sms_config_id
        )
        
        if result["success"]:
            return jsonify(result), 200
        else:
            return jsonify(result), 400
    
    except Exception as e:
        current_app.logger.error(f"Error en receive_sms_from_android endpoint: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": "Error interno del servidor"
        }), 500


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
