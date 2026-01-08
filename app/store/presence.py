# ============================================
# SISTEMA DE PRESENCIA DE USUARIOS EN TIEMPO REAL + LOGGING DE CONEXIONES
# ============================================

import time
from datetime import datetime, timedelta
from flask import request
from app import db

# ELIMINADO: Variable de viewers (código muerto)
# worksheet_viewers = {}  # {worksheet_id: {session_id: {user_info, last_seen}}}

# ⭐ NUEVO: Diccionario para rastrear último registro por usuario (evitar spam de logs)
user_last_log_time = {}  # {f"{worksheet_id}_{user_identifier}": timestamp}
user_last_activity = {}  # {f"{worksheet_id}_{user_identifier}": last_activity_timestamp}

def should_log_connection(worksheet_id, user_identifier):
    """Verificar si debe registrar conexión (primera vez o han pasado 15 minutos de ACTIVIDAD)"""
    key = f"{worksheet_id}_{user_identifier}"
    current_time = time.time()
    last_log_time = user_last_log_time.get(key, 0)
    
    # Registrar si es primera vez o han pasado 15 minutos (900 segundos)
    if current_time - last_log_time >= 900:  # 15 minutos
        user_last_log_time[key] = current_time
        return True
    return False

def should_mark_disconnected(worksheet_id, user_identifier):
    """Verificar si debe marcar como desconectado (han pasado 15 minutos de INACTIVIDAD)"""
    key = f"{worksheet_id}_{user_identifier}"
    current_time = time.time()
    last_activity = user_last_activity.get(key, 0)
    
    # Marcar como desconectado si han pasado 15 minutos (900 segundos) de inactividad
    if last_activity > 0 and current_time - last_activity >= 900:  # 15 minutos
        return True
    return False

def update_user_activity(worksheet_id, user_identifier):
    """Actualizar timestamp de última actividad del usuario"""
    key = f"{worksheet_id}_{user_identifier}"
    user_last_activity[key] = time.time()

def is_user_recently_active(worksheet_id, user_identifier, max_inactive_seconds=300):
    """Verificar si el usuario ha tenido actividad reciente (últimos 5 minutos por defecto)"""
    key = f"{worksheet_id}_{user_identifier}"
    last_activity = user_last_activity.get(key, 0)
    current_time = time.time()
    
    if last_activity == 0:
        return False
    
    seconds_since_activity = int(current_time - last_activity)
    is_active = seconds_since_activity <= max_inactive_seconds
    
    return is_active

def log_or_update_connection(worksheet_id, session_id, user_info, action='connected'):
    """Registrar o actualizar conexión en la base de datos con rangos de tiempo mejorados"""
    try:
        from app.store.models import WorksheetConnectionLog
        
        # Obtener información básica
        ip_address = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'Unknown'))
        if ',' in ip_address:
            ip_address = ip_address.split(',')[0].strip()
        
        user_agent = request.headers.get('User-Agent', 'Unknown')[:500]
        user_type = 'anonymous'
        user_identifier = user_info.get('user', 'Unknown')
        current_time = datetime.utcnow()
        
        # ⭐ CORREGIDO: Determinar user_type sin cortar el user_identifier
        if 'admin' in user_identifier.lower():
            user_type = 'admin'
        elif user_info.get('access_type') == 'user' or user_info.get('is_admin') == False:
            user_type = 'user'
        elif user_identifier != 'Unknown' and user_identifier != 'Usuario':
            user_type = 'user'
        
        # ⭐ MEJORADO: Buscar registro activo más reciente del usuario
        active_log = WorksheetConnectionLog.query.filter_by(
            worksheet_id=worksheet_id,
            user_identifier=user_identifier,
            user_type=user_type,
            action='connected'
        ).order_by(WorksheetConnectionLog.connection_time.desc()).first()
        
        # Si no se encuentra y es admin, buscar también con formato antiguo
        if not active_log and user_type == 'admin' and '(' in user_identifier:
            base_identifier = user_identifier.split(' (')[0]
            active_log = WorksheetConnectionLog.query.filter_by(
                worksheet_id=worksheet_id,
                user_identifier=base_identifier,
                user_type=user_type,
                action='connected'
            ).order_by(WorksheetConnectionLog.connection_time.desc()).first()
            
            if active_log:
                active_log.user_identifier = user_identifier
        
        if action == 'connected':
            # ⭐ NUEVO: Verificar si debe crear nueva sesión o continuar la existente
            should_create_new_session = True
            
            if active_log:
                # Verificar si han pasado más de 15 minutos desde la última actividad
                time_since_last_activity = (current_time - active_log.end_time).total_seconds()
                
                if time_since_last_activity < 900:  # Menos de 15 minutos
                    # Continuar sesión existente
                    should_create_new_session = False
                    active_log.end_time = current_time
                    active_log.session_id = session_id
                    active_log.ip_address = ip_address
                    active_log.user_agent = user_agent
                else:
                    # Han pasado más de 15 minutos, finalizar sesión anterior y crear nueva
                    active_log.action = 'disconnected'
                    if active_log.connection_time:
                        duration = (active_log.end_time - active_log.connection_time).total_seconds()
                        active_log.duration_seconds = int(duration)
            
            if should_create_new_session:
                # ⭐ NUEVO: Crear nueva sesión activa
                new_log = WorksheetConnectionLog(
                    worksheet_id=worksheet_id,
                    user_type=user_type,
                    user_identifier=user_identifier,
                    session_id=session_id,
                    action='connected',
                    ip_address=ip_address,
                    user_agent=user_agent,
                    connection_time=current_time,
                    end_time=current_time
                )
                db.session.add(new_log)
        
        elif action == 'disconnected':
            if active_log:
                # ⭐ MEJORADO: Solo finalizar si han pasado 15 minutos de inactividad
                if should_mark_disconnected(worksheet_id, user_identifier):
                    active_log.action = 'disconnected'
                    active_log.end_time = current_time
                    
                    # Calcular duración total de la sesión
                    if active_log.connection_time:
                        duration = (current_time - active_log.connection_time).total_seconds()
                        active_log.duration_seconds = int(duration)
        
        db.session.commit()
        
    except Exception as e:
        db.session.rollback()
        # Error interno

# ELIMINADO: Función add_viewer (código muerto)

# ELIMINADO: Función remove_viewer (código muerto)

# ELIMINADO: Función get_active_viewers (código muerto)

# ELIMINADO: Función cleanup_inactive_viewers (código muerto)

# ELIMINADO: Función update_viewer_presence (código muerto)

# ============================================
# ⭐ NUEVO: SISTEMA DE LOGGING DE CONEXIONES
# ============================================

# Diccionario para rastrear sesiones activas y sus tiempos de conexión
active_sessions = {}  # {session_id: {'start_time': datetime, 'worksheet_id': int, 'user_info': dict}}

def log_connection(worksheet_id, session_id, user_info, action='connected'):
    """Registrar conexión/desconexión en la base de datos"""
    try:
        # Importar aquí para evitar imports circulares
        from app.store.models import WorksheetConnectionLog
        
        # ⭐ OPTIMIZACIÓN: Validación para evitar duplicados
        if action == 'connected' and session_id in active_sessions:
            return
        
        if action == 'disconnected' and session_id not in active_sessions:
            return
        
        # Obtener información de IP y user agent
        ip_address = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'Unknown'))
        if ',' in ip_address:
            ip_address = ip_address.split(',')[0].strip()
        
        user_agent = request.headers.get('User-Agent', 'Unknown')[:500]  # Limitar longitud
        
        # Determinar tipo de usuario e identificador
        user_type = 'anonymous'
        user_identifier = user_info.get('user', 'Unknown')
        
        if 'admin' in user_identifier.lower():
            user_type = 'admin'
            user_identifier = user_identifier.split(' (')[0]  # Remover "(Admin)" si existe
        elif user_info.get('is_logged_user', False):
            user_type = 'user'
        
        # Calcular duración si es desconexión
        duration_seconds = None
        if action == 'disconnected' and session_id in active_sessions:
            start_time = active_sessions[session_id]['start_time']
            duration_seconds = int((datetime.utcnow() - start_time).total_seconds())
            # Remover de sesiones activas
            active_sessions.pop(session_id, None)
        elif action == 'connected':
            # Agregar a sesiones activas
            active_sessions[session_id] = {
                'start_time': datetime.utcnow(),
                'worksheet_id': worksheet_id,
                'user_info': user_info
            }
        
        # Crear registro de conexión
        connection_log = WorksheetConnectionLog(
            worksheet_id=worksheet_id,
            user_type=user_type,
            user_identifier=user_identifier,
            session_id=session_id,
            action=action,
            ip_address=ip_address,
            user_agent=user_agent,
            connection_time=datetime.utcnow(),
            duration_seconds=duration_seconds
        )
        
        db.session.add(connection_log)
        db.session.commit()
        
        # ⭐ OPTIMIZACIÓN: Log más descriptivo
        duration_info = f" (duración: {duration_seconds}s)" if duration_seconds else ""

        
    except Exception as e:
        db.session.rollback()

def cleanup_old_logs(days=28):
    """Limpiar registros de conexión antiguos (por defecto 28 días)"""
    try:
        from app.store.models import WorksheetConnectionLog
        
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        # Contar registros a eliminar
        old_logs_count = WorksheetConnectionLog.query.filter(
            WorksheetConnectionLog.connection_time < cutoff_date
        ).count()
        
        if old_logs_count > 0:
            # Eliminar registros antiguos
            WorksheetConnectionLog.query.filter(
                WorksheetConnectionLog.connection_time < cutoff_date
            ).delete()
            
            db.session.commit()
            # Registros eliminados
        else:
            # No hay registros antiguos
            pass
            
        return old_logs_count
            
    except Exception as e:
        db.session.rollback()
        return 0

def should_run_monthly_cleanup():
    """Verificar si debe ejecutar limpieza mensual (día 28 de cada mes)"""
    today = datetime.utcnow()
    return today.day == 28

def auto_monthly_cleanup():
    """Ejecutar limpieza automática si es el día 28 del mes"""
    if should_run_monthly_cleanup():
        deleted_count = cleanup_old_logs(28)
        return deleted_count
    return 0

def schedule_daily_cleanup():
    """Programar limpieza diaria a las 5:00 AM hora Colombia"""
    import threading
    import time
    
    def daily_cleanup_worker():
        while True:
            try:
                # Obtener hora actual en zona horaria Colombia usando módulo centralizado
                from app.utils.timezone import get_colombia_now
                now = get_colombia_now()
                
                # Ejecutar limpieza a las 5:00 AM
                if now.hour == 5 and now.minute < 30:
                    # Limpiar sesiones inactivas (15+ minutos)
                    cleanup_inactive_sessions()
                    
                    # Limpiar registros antiguos (28+ días)
                    cleanup_old_logs(28)
                
                # Esperar 1 hora antes de verificar de nuevo
                time.sleep(3600)
                
            except Exception as e:
                time.sleep(3600)  # Esperar 1 hora en caso de error
    
    # Ejecutar en hilo separado
    cleanup_thread = threading.Thread(target=daily_cleanup_worker, daemon=True)
    cleanup_thread.start()

def get_connection_logs(worksheet_id, limit=100, search_query=None):
    """Obtener registros de conexión de un worksheet"""
    try:
        from app.store.models import WorksheetConnectionLog
        
        query = WorksheetConnectionLog.query.filter_by(worksheet_id=worksheet_id)
        
        # Aplicar filtro de búsqueda si se proporciona
        if search_query:
            search = f"%{search_query}%"
            query = query.filter(
                db.or_(
                    WorksheetConnectionLog.user_identifier.ilike(search),
                    WorksheetConnectionLog.ip_address.ilike(search),
                    WorksheetConnectionLog.action.ilike(search)
                )
            )
        
        # Ordenar por fecha más reciente y limitar
        logs = query.order_by(WorksheetConnectionLog.connection_time.desc()).limit(limit).all()
        
        return logs
        
    except Exception as e:
        # Error interno
        return []

def clear_all_logs(worksheet_id):
    """Limpiar todos los registros de conexión de un worksheet"""
    try:
        from app.store.models import WorksheetConnectionLog
        
        # Contar registros a eliminar
        logs_count = WorksheetConnectionLog.query.filter_by(worksheet_id=worksheet_id).count()
        
        # Eliminar todos los registros del worksheet
        WorksheetConnectionLog.query.filter_by(worksheet_id=worksheet_id).delete()
        
        db.session.commit()

        
        return logs_count
        
    except Exception as e:
        db.session.rollback()
        return 0

def fix_anonymous_logs(worksheet_id):
    """Corregir registros anónimos con nombres reales de usuarios"""
    try:
        from app.store.models import WorksheetConnectionLog, User
        from flask import session
        
        # Obtener registros anónimos recientes
        anonymous_logs = WorksheetConnectionLog.query.filter_by(
            worksheet_id=worksheet_id,
            user_type='anonymous'
        ).filter(
            WorksheetConnectionLog.connection_time >= datetime.utcnow() - timedelta(hours=1)
        ).all()
        
        fixed_count = 0
        for log in anonymous_logs:
            # Intentar identificar al usuario por IP y tiempo
            ip_address = log.ip_address
            connection_time = log.connection_time
            
            # Buscar usuario que se conectó en ese momento
            # Por ahora, usar el usuario actual de la sesión si está disponible
            current_username = session.get('username')
            if current_username and current_username != 'admin':
                log.user_identifier = current_username
                log.user_type = 'user'
                fixed_count += 1
        
        if fixed_count > 0:
            db.session.commit()
        
        return fixed_count
        
    except Exception as e:
        db.session.rollback()
        return 0 

# ⭐ NUEVO: Función para consolidar registros duplicados existentes
def consolidate_duplicate_logs(worksheet_id=None, hours_back=24):
    """Consolidar registros de conexión duplicados/consecutivos del mismo usuario"""
    try:
        from app.store.models import WorksheetConnectionLog
        from sqlalchemy import and_, desc
        
        # Filtros de consulta
        filters = [WorksheetConnectionLog.connection_time >= datetime.utcnow() - timedelta(hours=hours_back)]
        if worksheet_id:
            filters.append(WorksheetConnectionLog.worksheet_id == worksheet_id)
        
        # Obtener logs recientes agrupados por usuario
        logs = WorksheetConnectionLog.query.filter(
            and_(*filters)
        ).order_by(
            WorksheetConnectionLog.user_identifier,
            WorksheetConnectionLog.connection_time.desc()
        ).all()
        
        if not logs:
    
            return
        
        # Agrupar por usuario e identificar duplicados
        user_logs = {}
        for log in logs:
            key = f"{log.user_identifier}_{log.worksheet_id}"
            if key not in user_logs:
                user_logs[key] = []
            user_logs[key].append(log)
        
        consolidation_count = 0
        
        # Procesar cada grupo de usuario
        for user_key, user_log_list in user_logs.items():
            if len(user_log_list) < 2:
                continue
                
            # Encontrar secuencias de "connected" consecutivos
            consecutive_connected = []
            current_sequence = []
            
            for log in reversed(user_log_list):  # Orden cronológico
                if log.action == 'connected':
                    current_sequence.append(log)
                else:
                    if len(current_sequence) > 1:
                        consecutive_connected.append(current_sequence)
                    current_sequence = []
            
            # Agregar última secuencia si es necesario
            if len(current_sequence) > 1:
                consecutive_connected.append(current_sequence)
            
            # Consolidar secuencias
            for sequence in consecutive_connected:
                if len(sequence) <= 1:
                    continue
                    
                # Mantener el primer "connected", eliminar el resto
                first_log = sequence[0]
                logs_to_delete = sequence[1:]
                
        
                
                # Eliminar registros duplicados
                for log_to_delete in logs_to_delete:
                    db.session.delete(log_to_delete)
                    consolidation_count += 1
        
        # Commit cambios
        if consolidation_count > 0:
            db.session.commit()
            
        return consolidation_count
        
    except Exception as e:
        db.session.rollback()
        return 0 

# ⭐ NUEVO: Función de inicialización automática del sistema
def initialize_connection_system():
    """Inicializar y optimizar el sistema de registros de conexión"""
    try:
        # Limpiar registros antiguos (más de 28 días)
        deleted_count = cleanup_old_logs(28)
        
        # Consolidar registros duplicados de las últimas 48 horas
        consolidated_count = consolidate_duplicate_logs(hours_back=48)
        
        # Programar limpieza diaria a las 5:00 AM hora Colombia
        schedule_daily_cleanup()
        
        return {
            'deleted_count': deleted_count,
            'consolidated_count': consolidated_count
        }
        
    except Exception as e:
        return {
            'deleted_count': 0,
            'consolidated_count': 0
        } 

def cleanup_inactive_sessions(worksheet_id=None, max_inactive_minutes=15):
    """Finalizar automáticamente sesiones que han estado inactivas más de X minutos"""
    try:
        from app.store.models import WorksheetConnectionLog
        
        # ⭐ CORREGIDO: Usar tiempo actual para verificar inactividad REAL
        current_time = time.time()
        
        # Buscar sesiones activas (action='connected')
        query = WorksheetConnectionLog.query.filter(
            WorksheetConnectionLog.action == 'connected'
        )
        
        if worksheet_id:
            query = query.filter(WorksheetConnectionLog.worksheet_id == worksheet_id)
        
        active_sessions = query.all()
        
        closed_count = 0
        for session in active_sessions:
            # ⭐ MEJORADO: Usar la nueva función should_mark_disconnected
            if should_mark_disconnected(session.worksheet_id, session.user_identifier):
                # Finalizar la sesión
                session.action = 'disconnected'
                session.end_time = datetime.utcnow()
                
                # Calcular duración
                if session.connection_time:
                    duration = (session.end_time - session.connection_time).total_seconds()
                    session.duration_seconds = int(duration)
                
                closed_count += 1
        
        if closed_count > 0:
            db.session.commit()
        
        return closed_count
        
    except Exception as e:
        db.session.rollback()
        return 0 