# app/api/__init__.py

from flask import Blueprint, jsonify, request, session, current_app
from app.services.search_service import (
    search_and_apply_filters,
    search_and_apply_filters2,
    search_imap2_server_dynamic,
    search_linked_projects_only,
)
from app.models import User
from app.models.user import AllowedEmail
from app.models.service import ServiceModel
from app.store.models import SMSConfig, SMSMessage, AllowedSMSNumber, SMSRegex, TwoFAConfig
from app.models.imap2 import IMAP2TwoFAConfig, IMAPServer2
from app.extensions import db
from app.utils.timezone import utc_to_colombia
from datetime import datetime, timedelta
import re
import secrets
import threading
from urllib.parse import urlparse
from ipaddress import ip_address, AddressValueError
from sqlalchemy import func

api_bp = Blueprint("api_bp", __name__)


def _user_has_allowed_email(user, email_normalized: str) -> bool:
    """
    True si el correo está en allowed_emails del usuario.
    Comparación insensible a mayúsculas y con trim (evita rechazos si en BD quedó otro casing o espacios).
    """
    if not user or not email_normalized:
        return False
    en = email_normalized.strip().lower()
    if not en:
        return False
    return (
        user.allowed_email_entries.filter(
            func.lower(func.trim(AllowedEmail.email)) == en
        ).first()
        is not None
    )

# ===== SEGURIDAD: Rate Limiting =====
# Almacenar requests por IP con timestamps
_rate_limit_store = {}
_rate_limit_lock = threading.Lock()
RATE_LIMIT_REQUESTS = 20  # 20 requests por minuto
RATE_LIMIT_WINDOW = 60  # Ventana de 60 segundos

def check_rate_limit(ip_address):
    """Verifica si una IP ha excedido el límite de requests"""
    current_time = datetime.utcnow()
    
    with _rate_limit_lock:
        # Limpiar entradas antiguas (más de 1 minuto)
        if ip_address in _rate_limit_store:
            _rate_limit_store[ip_address] = [
                ts for ts in _rate_limit_store[ip_address]
                if (current_time - ts).total_seconds() < RATE_LIMIT_WINDOW
            ]
        else:
            _rate_limit_store[ip_address] = []
        
        # Verificar límite
        if len(_rate_limit_store[ip_address]) >= RATE_LIMIT_REQUESTS:
            return False
        
        # Agregar timestamp actual
        _rate_limit_store[ip_address].append(current_time)
        return True

def get_client_ip():
    """Obtiene la IP real del cliente, considerando proxies"""
    if request.headers.get('X-Forwarded-For'):
        # Tomar la primera IP de la cadena (IP real del cliente)
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    elif request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP')
    else:
        return request.remote_addr or 'unknown'

# ===== SEGURIDAD: Validación de Email =====
EMAIL_REGEX = re.compile(
    r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
)

def validate_email_format(email):
    """Valida el formato de un email"""
    if not email or not isinstance(email, str):
        return False
    email = email.strip()
    if len(email) > 254:  # RFC 5321 límite
        return False
    return bool(EMAIL_REGEX.match(email))

# ===== SEGURIDAD: Validación de Dominios Permitidos =====
def get_allowed_domains():
    """Obtiene lista de dominios permitidos desde configuración o BD"""
    # Por ahora retornar lista vacía, se puede expandir con configuración
    # Se puede obtener de site_settings o configuración
    allowed = current_app.config.get('ALLOWED_EXTERNAL_DOMAINS', [])
    if isinstance(allowed, str):
        allowed = [d.strip() for d in allowed.split(',') if d.strip()]
    return allowed

def validate_origin_domain(origin_domain):
    """Valida que el dominio de origen esté en la lista permitida"""
    if not origin_domain:
        return False
    
    try:
        parsed = urlparse(origin_domain if origin_domain.startswith('http') else f'https://{origin_domain}')
        domain = parsed.netloc or parsed.path.split('/')[0]
        domain = domain.lower().strip()
        
        allowed_domains = get_allowed_domains()
        if allowed_domains:
            return domain in allowed_domains or any(domain.endswith(f'.{ad}') for ad in allowed_domains)
        
        # Si no hay lista configurada, permitir cualquier dominio válido
        return bool(domain and '.' in domain)
    except Exception:
        return False

def validate_request_host():
    """Valida que el host de la request sea un dominio permitido"""
    try:
        host = request.host.lower().split(':')[0]
        allowed_domains = get_allowed_domains()
        
        if allowed_domains:
            return host in allowed_domains or any(host.endswith(f'.{ad}') for ad in allowed_domains)
        
        # Si no hay lista configurada, permitir cualquier host válido
        return bool(host and '.' in host)
    except Exception:
        return False

# ===== SEGURIDAD: Protección SSRF =====
def is_internal_ip(ip_str):
    """Verifica si una IP es interna/localhost"""
    try:
        ip = ip_address(ip_str)
        return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved
    except (ValueError, AddressValueError):
        return False

def validate_external_url(url):
    """Valida que una URL sea externa y no apunte a recursos internos"""
    if not url:
        return False
    
    try:
        parsed = urlparse(url)
        
        # Verificar esquema
        if parsed.scheme not in ('http', 'https'):
            return False
        
        # Verificar que no sea localhost
        hostname = parsed.hostname
        if not hostname:
            return False
        
        hostname_lower = hostname.lower()
        
        # Bloquear localhost y variantes
        blocked_hosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1']
        if hostname_lower in blocked_hosts:
            return False
        
        # Verificar que no sea IP interna
        if is_internal_ip(hostname):
            return False
        
        # Verificar que no sea dominio interno común
        internal_domains = ['.local', '.internal', '.lan', '.corp']
        if any(hostname_lower.endswith(d) for d in internal_domains):
            return False
        
        return True
    except Exception:
        return False

# ===== SEGURIDAD: Validación de origin_user =====
def validate_origin_user(origin_user):
    """Valida que origin_user tenga formato válido (solo alfanuméricos y guiones bajos)"""
    if not origin_user or not isinstance(origin_user, str):
        return False
    # Solo permitir alfanuméricos, guiones bajos y guiones, máximo 80 caracteres
    return bool(re.match(r'^[a-zA-Z0-9_-]{1,80}$', origin_user))

# ===== SEGURIDAD: Logging Seguro =====
def safe_log_email(email):
    """Retorna versión segura del email para logging (oculta parte)"""
    if not email or len(email) < 5:
        return "***"
    parts = email.split('@')
    if len(parts) != 2:
        return "***"
    local, domain = parts
    if len(local) <= 2:
        masked_local = "**"
    else:
        masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
    return f"{masked_local}@{domain}"

def safe_log_token(token):
    """Retorna versión segura del token para logging (solo primeros y últimos caracteres)"""
    if not token or len(token) < 8:
        return "***"
    return f"{token[:4]}...{token[-4:]}"

# Decorator para excluir rutas del CSRF (para APIs externas)
def csrf_exempt_api(func):
    """Decorator para excluir rutas de la API del CSRF"""
    func._csrf_exempt = True
    return func

def _parse_optional_service_id(raw):
    """None si no viene o vacío; int >= 1 si es válido."""
    if raw is None:
        return None
    if isinstance(raw, str) and not raw.strip():
        return None
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return None
    if v < 1:
        return None
    return v


def _resolve_external_service_id(ext_service_id, service_name_raw, match_key_raw=None):
    """
    Entre proyectos con distinta BD, el mismo botón puede tener otro service_id u otro nombre visible.
    Orden: match_key (clave compartida) > nombre > id numérico del origen.
    """
    if isinstance(match_key_raw, str) and match_key_raw.strip():
        mk = match_key_raw.strip()
        if len(mk) > 64:
            mk = mk[:64]
        svc = ServiceModel.query.filter(
            ServiceModel.enabled.is_(True),
            ServiceModel.match_key == mk,
        ).first()
        if svc:
            return svc.id
    if isinstance(service_name_raw, str) and service_name_raw.strip():
        nm = service_name_raw.strip()
        if len(nm) > 100:
            nm = nm[:100]
        svc = ServiceModel.query.filter(
            ServiceModel.enabled.is_(True),
            func.lower(func.trim(ServiceModel.name)) == func.lower(nm),
        ).first()
        if svc:
            return svc.id
    return ext_service_id


@api_bp.route("/search_mails", methods=["POST"])
def search_mails():
    data = request.get_json()
    if not data or "email_to_search" not in data:
        return jsonify({"error": "Missing email_to_search"}), 400

    email_to_search = data["email_to_search"]
    raw_sid = data.get("service_id")
    service_id = _parse_optional_service_id(raw_sid)
    if raw_sid is not None and str(raw_sid).strip() != "" and service_id is None:
        return jsonify({"error": "service_id inválido"}), 400

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
            # search_sms_messages ya maneja la verificación de 2FA internamente
            return search_sms_messages(email_to_search, user)

    # Normalización del correo (búsqueda IMAP: permisos por lista + proyecto vinculado + regex/filtro;
    # no se usa TwoFAConfig para decidir si se permite la consulta).
    email_normalized = email_to_search.lower().strip()

    # Si el usuario no está logueado: permitir búsqueda solo si acceso público está habilitado
    if not user:
        from app.admin.site_settings import get_site_setting
        public_access_enabled = get_site_setting('public_access_enabled', 'true')
        if public_access_enabled != 'true':
            return jsonify({"error": "Debes iniciar sesión para realizar búsquedas."}), 401
        # Acceso público: usar IMAP principal con filtros/regex globales (sin IMAP2)
        mail_result = search_and_apply_filters(email_to_search, service_id, user=None, public_access=True)
        if not mail_result:
            return jsonify({"results": []}), 200
        return jsonify({"results": [mail_result]}), 200

    # Usuario logueado: obligar a elegir servicio (botón/categoría) para no mezclar regex/filtros
    if service_id is None:
        return jsonify({
            "error": "Debes seleccionar un servicio (categoría) antes de buscar."
        }), 400
    
    # Validar usuario (para búsquedas normales de correos)
    # El admin puede consultar sin restricciones de AllowedEmail
    admin_username = current_app.config.get("ADMIN_USER", "admin")
    # Verificar si es admin basándose SOLO en la base de datos (más confiable)
    # Admin: username == admin_username Y parent_id is None
    is_admin = (user.username == admin_username and user.parent_id is None)
    
    # IMPORTANTE: El admin en su propio proyecto NUNCA se bloquea
    # Solo los usuarios normales deben estar habilitados para hacer búsquedas
    # Si un usuario está inhabilitado, no puede hacer búsquedas locales ni consultar proyectos vinculados
    if not is_admin and not user.enabled:
        return jsonify({"error": "Tu cuenta está inhabilitada. No puedes realizar búsquedas."}), 403
    
    # Si es admin, puede consultar sin restricciones de correo específico
    if is_admin:
        pass
    else:
        # Usuario normal: lista permitida localmente O resultado del proyecto vinculado (mismo service_id).
        # Basta con que el correo esté permitido en el proyecto que realmente consulta el buzón (p. ej. solo proyecto 1).
        if not user.can_search_any:
            is_allowed = _user_has_allowed_email(user, email_normalized)
            if not is_allowed:
                mail_result = search_linked_projects_only(
                    email_to_search, user, service_id=service_id
                )
                if mail_result:
                    return jsonify({"results": [mail_result]}), 200
                return jsonify({"error": "No tienes permiso para consultar este correo específico."}), 403

    # Llamada con user
    mail_result = search_and_apply_filters(email_to_search, service_id, user=user)
    if not mail_result:
        return jsonify({"results": []}), 200

    return jsonify({"results": [mail_result]}), 200

def search_sms_messages(email_to_search, user=None, origin_domain=None):
    """Busca mensajes SMS para un correo específico en TODOS los números donde esté agregado"""
    # Normalizar el correo a minúsculas
    email_normalized = email_to_search.lower().strip()
    
    # PRIMERO: Verificar si existe configuración 2FA para este correo
    has_2fa_config = False
    configs_2fa = TwoFAConfig.query.filter(TwoFAConfig.is_enabled == True).all()
    for cfg in configs_2fa:
        emails_list = cfg.get_emails_list()
        if email_normalized in emails_list:
            has_2fa_config = True
            break
    
    # SEGUNDO: Validar permisos del usuario y determinar si es admin
    # IMPORTANTE: Solo el ADMIN_USER oficial tiene acceso total
    # Las 2 condiciones de autorización externa NO otorgan privilegios especiales aquí
    is_admin_user = False
    if user and user.enabled:
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        # Solo el ADMIN_USER oficial tiene acceso total
        if user.username == admin_username and user.parent_id is None:
            is_admin_user = True
        
        # Si es admin, puede consultar sin restricciones
        if is_admin_user:
            pass  # Admin puede consultar cualquier correo sin restricciones
        elif has_2fa_config:
            # Si existe configuración 2FA, validar permisos ANTES de permitir búsqueda
            # Esto evita mostrar el spinner cuando el usuario no tiene permisos
            if not user.enabled:
                return jsonify({"error": "No tienes permiso al consultar este correo."}), 403
            
            # Si el usuario NO puede buscar cualquiera, verificar AllowedEmail (igual que correos normales)
            if not user.can_search_any:
                is_allowed = _user_has_allowed_email(user, email_normalized)
                if not is_allowed:
                    return jsonify({"error": "No tienes permiso al consultar este correo."}), 403
            # Si tiene configuración 2FA y pasa las validaciones, permitir acceso
        else:
            # Si no es admin y NO tiene configuración 2FA, validar permisos normalmente
            if not user.enabled:
                return jsonify({"error": "No tienes permiso al consultar este correo."}), 403
            
            # Si el usuario NO puede buscar cualquiera, verificamos si el email está permitido
            if not user.can_search_any:
                # Consulta a la tabla AllowedEmail del usuario
                is_allowed = _user_has_allowed_email(user, email_normalized)
                if not is_allowed:
                    return jsonify({"error": "No tienes permiso para consultar este correo específico."}), 403
    
    # TERCERO: Obtener configuraciones SMS según permisos
    # Si es admin o tiene configuración 2FA, buscar en TODAS las configuraciones SMS habilitadas
    # Si no, buscar solo en las configuraciones donde el correo esté agregado en AllowedSMSNumber
    
    if is_admin_user or has_2fa_config:
        # Admin o correo con 2FA: buscar en TODAS las configuraciones SMS habilitadas
        enabled_configs = SMSConfig.query.filter_by(is_enabled=True).all()
        if not enabled_configs:
            return jsonify({"error": "No hay configuraciones SMS habilitadas."}), 500
    else:
        # Usuario normal sin 2FA: buscar solo en configuraciones donde el correo esté agregado
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

@api_bp.route("/2fa/code/<path:email>", methods=["GET"])
def get_2fa_code_for_email(email):
    """Obtiene el código 2FA actual para un correo específico (requiere sesión)."""
    try:
        import pyotp
        import time
        from flask import session

        # Validar: no aceptar URLs (evitar peticiones malformadas que usan href en lugar de email)
        email_str = (email or "").strip().lower()
        if email_str.startswith("http://") or email_str.startswith("https://") or "@" not in email_str:
            return jsonify({"error": "Invalid email parameter"}), 400

        email_normalized = email_str

        # Exigir sesión: sin user_id no se entrega código ni se revela si hay config 2FA
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Debes iniciar sesión para consultar códigos 2FA."}), 401

        user = User.query.get(user_id)
        if not user:
            return jsonify({"error": "Sesión inválida."}), 401

        admin_username = current_app.config.get("ADMIN_USER", "admin")
        is_admin = user.username == admin_username and user.parent_id is None

        if not is_admin:
            if not user.enabled:
                return jsonify({"error": "No tienes permiso al consultar este correo."}), 403
            if not user.can_search_any:
                if not _user_has_allowed_email(user, email_normalized):
                    return jsonify({"error": "No tienes permiso al consultar este correo."}), 403

        configs = TwoFAConfig.query.filter(TwoFAConfig.is_enabled == True).all()
        matching_config = None
        for cfg in configs:
            emails_list = cfg.get_emails_list()
            if email_normalized in emails_list:
                matching_config = cfg
                break

        # Sin configuración 2FA para este correo
        if not matching_config:
            return "", 204

        secret_key_raw = matching_config.secret_key
        secret_key_normalized = secret_key_raw.strip().upper().replace(" ", "").replace("-", "")
        totp = pyotp.TOTP(secret_key_normalized)
        current_time = int(time.time())
        current_code = totp.now()
        time_remaining = 30 - (current_time % 30)

        return jsonify({
            "success": True,
            "code": current_code,
            "time_remaining": time_remaining,
            "email": email_normalized,
        }), 200

    except Exception as e:
        return jsonify({"error": f"Error al generar código 2FA: {str(e)}"}), 500

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
        "api_key": "tu_api_key_secreta"  // Obligatoria (también acepta header X-API-Key)
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
        
        # API KEY OBLIGATORIA: sin key configurada o sin key en el request → rechazar
        api_key = (
            data.get("api_key")
            or request.headers.get("X-API-Key")
            or request.headers.get("X-Api-Key")
            or ""
        )
        if isinstance(api_key, str):
            api_key = api_key.strip()
        else:
            api_key = str(api_key or "").strip()

        from app.admin.site_settings import get_site_setting
        import secrets

        expected_api_key_db = (get_site_setting("android_sms_api_key", "") or "").strip()
        expected_api_key_config = current_app.config.get("ANDROID_SMS_API_KEY") or ""
        if isinstance(expected_api_key_config, str):
            expected_api_key_config = expected_api_key_config.strip()
        else:
            expected_api_key_config = str(expected_api_key_config).strip()

        expected_api_key = expected_api_key_db or expected_api_key_config

        if not expected_api_key:
            return jsonify({
                "success": False,
                "error": "API key no configurada en el servidor. Configúrala en el panel SMS Android.",
            }), 503

        if not api_key:
            return jsonify({
                "success": False,
                "error": "API key requerida",
            }), 401

        if not secrets.compare_digest(api_key, expected_api_key):
            return jsonify({
                "success": False,
                "error": "API key inválida",
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

@api_bp.route("/search_imap2_dynamic", methods=["POST"])
def search_imap2_dynamic():
    """
    Ruta para búsqueda usando un servidor IMAP2 específico basado en route_path.
    Usa los filtros y regex asociados directamente al servidor IMAP2.
    
    ACCESO LIBRE: Las plantillas dinámicas de IMAP2 (dominios personalizados, /consulta, etc.)
    están diseñadas para acceso público. No se requiere login para realizar búsquedas.
    Similar a search_mails2.
    """
    data = request.get_json()
    if not data or "email_to_search" not in data:
        return jsonify({"error": "Missing email_to_search"}), 400

    email_to_search = data["email_to_search"]
    imap_server_id = data.get("imap_server_id")
    
    if not imap_server_id:
        return jsonify({"error": "Missing imap_server_id"}), 400

    # Acceso libre: no requerir login (plantillas dinámicas IMAP2 son de uso público)
    user_id = session.get("user_id")
    current_user = User.query.get(user_id) if user_id else None

    mail_result = search_imap2_server_dynamic(email_to_search, imap_server_id, user=current_user)
    if not mail_result:
        return jsonify({"results": []}), 200

    return jsonify({"results": [mail_result]}), 200


@api_bp.route("/imap2/<int:imap_server_id>/2fa/code/<email>", methods=["GET"])
@csrf_exempt_api
def get_imap2_2fa_code_for_email(imap_server_id, email):
    """Obtiene el código 2FA actual para un correo específico en un servidor IMAP2 específico"""
    try:
        import pyotp
        import time
        
        # Verificar que el servidor IMAP2 existe
        server = IMAPServer2.query.get_or_404(imap_server_id)
        
        # Normalizar el correo
        email_normalized = email.lower().strip()
        
        # Buscar configuración 2FA específica de este servidor IMAP2
        configs = IMAP2TwoFAConfig.query.filter(
            IMAP2TwoFAConfig.imap_server_id == imap_server_id,
            IMAP2TwoFAConfig.is_enabled == True
        ).all()
        
        matching_config = None
        for cfg in configs:
            emails_list = cfg.get_emails_list()
            if email_normalized in emails_list:
                matching_config = cfg
                break
        
        # Si no hay configuración 2FA para este correo en este servidor, devolver 204 (No Content) en lugar de 404
        if not matching_config:
            return "", 204
        
        # Generar código TOTP
        import base64
        import hashlib
        
        secret_key_raw = matching_config.secret_key
        # Limpieza absoluta del secreto
        secret_key_normalized = secret_key_raw.strip().upper().replace(' ', '').replace('-', '')
        
        def get_code(s, t_val, digits=6):
            try:
                # Caso 1: Secreto es Base32 estándar (lo más común)
                return pyotp.TOTP(s, digits=digits).at(t_val)
            except:
                try:
                    # Caso 2: El secreto fue enviado como texto plano y necesita ser convertido a Base32
                    # (A veces pasa con ciertos generadores)
                    s_b32 = base64.b32encode(s.encode()).decode().replace('=', '')
                    return pyotp.TOTP(s_b32, digits=digits).at(t_val)
                except:
                    return "000000"

        current_time = int(time.time())
        current_code = get_code(secret_key_normalized, current_time)
        
        time_remaining = 30 - (current_time % 30)
        
        return jsonify({
            "success": True,
            "code": current_code,
            "time_remaining": time_remaining,
            "email": email_normalized
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error al generar código 2FA de IMAP2: {e}", exc_info=True)
        return jsonify({"error": f"Error al generar código 2FA: {str(e)}"}), 500


@api_bp.route("/external/search", methods=["POST"])
@csrf_exempt_api
def external_search():
    """
    API externa para búsqueda de correos desde otros proyectos.
    
    Las 2 condiciones solo AUTORIZAN el uso de la API externa (no otorgan acceso total):
    1. Mismo usuario en ambos proyectos
    2. Usuario que coincide con el nombre del dominio del proyecto B (sin extensión)
       Ejemplo: dominio "tupremiumm.com" -> usuario "tupremiumm"
    
    Una vez autorizado, el usuario se trata como NORMAL con todas sus restricciones
    (filtros, regex, SMS, reglas de seguridad). Solo el ADMIN_USER oficial tiene acceso total.
    """
    # ===== SEGURIDAD: Rate Limiting =====
    client_ip = get_client_ip()
    if not check_rate_limit(client_ip):
        current_app.logger.warning(f"[RATE-LIMIT] IP {client_ip} excedió límite de {RATE_LIMIT_REQUESTS} requests/minuto")
        return jsonify({"error": "Rate limit exceeded. Please try again later."}), 429
    
    # ===== SEGURIDAD: Validación de request.host =====
    if not validate_request_host():
        current_app.logger.warning(f"[SECURITY] Request host inválido: {request.host}")
        return jsonify({"error": "Invalid request host"}), 403
    
    # ===== SEGURIDAD: Límite de tamaño de payload JSON =====
    MAX_JSON_SIZE = 10 * 1024  # 10KB máximo (suficiente para peticiones pequeñas)
    if request.content_length and request.content_length > MAX_JSON_SIZE:
        current_app.logger.warning(f"[SECURITY] Payload demasiado grande: {request.content_length} bytes")
        return jsonify({"error": "Payload too large"}), 413
    
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data received"}), 400
        
    token = data.get("token")
    email_to_search = data.get("email_to_search")
    origin_user = data.get("origin_user") # Usuario que envía desde Proyecto A
    origin_domain = data.get("origin_domain") # Dominio del proyecto A (opcional, para logging)
    raw_ext_sid = data.get("service_id")
    ext_service_id = _parse_optional_service_id(raw_ext_sid)
    service_name_raw = data.get("service_name")
    match_key_raw = data.get("service_match_key") or data.get("match_key")
    # service_id numérico inválido: puede resolverse por match_key o nombre en el otro proyecto
    if raw_ext_sid is not None and str(raw_ext_sid).strip() != "" and ext_service_id is None:
        sn_ok = isinstance(service_name_raw, str) and bool(service_name_raw.strip())
        mk_ok = isinstance(match_key_raw, str) and bool(match_key_raw.strip())
        if not (sn_ok or mk_ok):
            return jsonify({"error": "service_id inválido"}), 400

    if not token or not email_to_search:
        return jsonify({"error": "Missing token or email_to_search"}), 400
    
    # ===== SEGURIDAD: Validación de formato de email =====
    if not validate_email_format(email_to_search):
        current_app.logger.warning(f"[SECURITY] Email inválido recibido: {safe_log_email(email_to_search)}")
        return jsonify({"error": "Invalid email format"}), 400
    
    # ===== SEGURIDAD: Validación de origin_user =====
    if origin_user and not validate_origin_user(origin_user):
        current_app.logger.warning(f"[SECURITY] origin_user inválido recibido")
        return jsonify({"error": "Invalid origin_user format"}), 400
    
    # ===== SEGURIDAD: Validación de origin_domain =====
    if origin_domain and not validate_origin_domain(origin_domain):
        current_app.logger.warning(f"[SECURITY] origin_domain no permitido: {origin_domain}")
        return jsonify({"error": "Origin domain not allowed"}), 403
        
    # ===== SEGURIDAD: Protección timing attack en comparación de tokens =====
    # Usar comparación constante en tiempo para prevenir timing attacks
    user = None
    if token:
        # Buscar todos los usuarios con tokens (para evitar timing attack)
        all_users = User.query.filter(User.master_token.isnot(None)).all()
        for u in all_users:
            if u.master_token and secrets.compare_digest(u.master_token, token):
                user = u
                break
    
    if not user:
        # Usar mismo tiempo de respuesta aunque el token sea inválido
        secrets.compare_digest("dummy", "dummy")
        return jsonify({"error": "Invalid token"}), 401
    
    # Verificar si es admin oficial del proyecto B ANTES de validar enabled
    admin_username = current_app.config.get("ADMIN_USER", "admin")
    is_admin_project_b = (user.username == admin_username and user.parent_id is None)
    
    # IMPORTANTE: El admin del proyecto B NO tiene restricciones, incluso si está inhabilitado
    # Solo los usuarios normales del proyecto B deben estar habilitados para recibir consultas externas
    if not is_admin_project_b and not user.enabled:
        return jsonify({"error": "User is disabled"}), 403

    # --- VALIDACIÓN DE LAS 2 CONDICIONES (PROYECTO B) ---
    authorized = False
    
    # Condición 1: Mismo usuario en ambos proyectos (Confianza total)
    if origin_user and origin_user.lower() == user.username.lower():
        authorized = True
        
    # Condición 2: El usuario en este proyecto se llama como el nombre del dominio (sin extensión)
    # Ejemplo: dominio "tupremiumm.com" -> usuario "tupremiumm"
    # Esto protege la identidad del admin y no revela si es admin o usuario normal
    else:
        # Obtener nombre del dominio de este proyecto (B) sin extensión
        my_host = request.host.lower().split(':')[0] # e.g. "tupremiumm.com"
        my_domain_name = my_host.split('.')[0] # e.g. "tupremiumm"
        
        # Solo aceptar el nombre del dominio sin extensión
        if user.username.lower() == my_domain_name:
            authorized = True

    if not authorized:
        # ===== SEGURIDAD: Logging seguro (no exponer datos sensibles) =====
        current_app.logger.warning(
            f"[AUTH-FAILED] External search denied for user: {user.username}. "
            f"Origin user '{origin_user or 'unknown'}' does not match security conditions."
        )
        return jsonify({"error": "Unauthorized: Security conditions not met"}), 403

    # ===== SEGURIDAD: Logging seguro (no exponer datos sensibles) =====
    current_app.logger.info(
        f"[EXTERNAL-SEARCH] Authorized! User: {user.username} | "
        f"Search: {safe_log_email(email_to_search)} | "
        f"From: {origin_user or 'unknown'} | "
        f"Domain: {origin_domain or 'unknown'}"
    )

    # Mismo servicio lógico que en el proyecto origen: por nombre si el id numérico no coincide entre BDs
    resolved_sid = _resolve_external_service_id(
        ext_service_id, service_name_raw, match_key_raw
    )

    # --- VALIDACIONES DE CORREOS (misma idea que search_mails: sin usar TwoFAConfig) ---
    email_normalized = email_to_search.lower().strip()

    # Aplicar las mismas validaciones que search_mails
    # IMPORTANTE: El admin del proyecto B NO tiene restricciones (incluso si está inhabilitado)
    if is_admin_project_b:
        pass
    else:
        # Usuario no admin: ya se rechazó inhabilitado arriba; aquí solo lista + vinculado
        if not user.can_search_any:
            is_allowed = _user_has_allowed_email(user, email_normalized)
            if not is_allowed:
                mail_result = search_linked_projects_only(
                    email_to_search, user, service_id=resolved_sid
                )
                if mail_result:
                    return jsonify({"results": [mail_result]}), 200
                return jsonify({"error": "No tienes permiso para consultar este correo específico."}), 403

    # IMPORTANTE: Pasamos el usuario REAL del proyecto B para que se respeten TODAS sus reglas
    # resolved_sid: servicio local tras resolver por nombre si vino desde otro proyecto
    mail_result = search_and_apply_filters(
        email_to_search, service_id=resolved_sid, user=user
    )
    
    if mail_result:
        return jsonify({"results": [mail_result]}), 200
        
    # Intentar búsqueda en SMS (también con el usuario real para respetar sus reglas)
    # Pasar origin_domain para logging y trazabilidad
    sms_response = search_sms_messages(email_to_search, user=user, origin_domain=origin_domain)
    
    if sms_response.status_code == 200:
        return sms_response
        
    return jsonify({"results": []}), 200
