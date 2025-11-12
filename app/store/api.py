from flask import Blueprint, request, jsonify, current_app, session
from app.extensions import db
from app.store.models import WorksheetTemplate, WorksheetData, WorksheetPermission, WorksheetConnectionLog
from app.models.user import User
import secrets
from functools import wraps
from datetime import datetime, timedelta
try:
    from zoneinfo import ZoneInfo  # ⭐ NUEVO: Para manejo de zonas horarias (Python 3.9+)
except ImportError:
    from datetime import timezone  # ⭐ FALLBACK: Para versiones anteriores de Python

# Decorator para excluir rutas del CSRF
def csrf_exempt_api(func):
    """Decorator para excluir rutas de la API del CSRF"""
    # Marcar la función para exención de CSRF
    func._csrf_exempt = True
    return func

# ⭐ NUEVO: Función para formatear fechas en zona horaria de Colombia
def format_colombia_time(utc_datetime):
    """Convierte fecha UTC a zona horaria de Colombia con formato 12h"""
    if not utc_datetime:
        return "N/A"
    
    try:
        from datetime import timezone as dt_timezone, timedelta
        
        # Crear una copia para no modificar el original
        dt = utc_datetime
        
        # Si el datetime es naive (sin timezone), asumir que está en UTC
        # Esto es común cuando viene de SQLite que no guarda timezone
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=dt_timezone.utc)
        
        try:
            # Intentar usar zoneinfo (Python 3.9+)
            from zoneinfo import ZoneInfo
            colombia_tz = ZoneInfo('America/Bogota')
            # Convertir a Colombia (dt ya tiene timezone UTC)
            colombia_time = dt.astimezone(colombia_tz)
            return colombia_time.strftime('%d/%m/%Y  %I:%M %p')
        except (NameError, ImportError):
            # Fallback para versiones anteriores o si zoneinfo no está disponible
            # Usar pytz si está disponible
            try:
                from pytz import timezone as pytz_timezone
                utc_tz = pytz_timezone('UTC')
                colombia_tz = pytz_timezone('America/Bogota')
                
                # Si el datetime es naive, localizarlo como UTC
                if dt.tzinfo is None:
                    dt = utc_tz.localize(dt)
                elif dt.tzinfo != utc_tz:
                    # Convertir a UTC primero si tiene otro timezone
                    dt = dt.astimezone(utc_tz)
                
                colombia_time = dt.astimezone(colombia_tz)
                return colombia_time.strftime('%d/%m/%Y  %I:%M %p')
            except ImportError:
                # Fallback final: UTC-5 fijo (no considera horario de verano)
                colombia_offset = dt_timezone(timedelta(hours=-5))
                # Si el datetime es naive, asumir UTC
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=dt_timezone.utc)
                colombia_time = dt.astimezone(colombia_offset)
                return colombia_time.strftime('%d/%m/%Y  %I:%M %p')
    except Exception as e:
        # En caso de error, retornar el datetime original formateado
        try:
            return utc_datetime.strftime('%d/%m/%Y  %I:%M %p')
        except:
            return "N/A"

# ⭐ NUEVO: Función para formatear rangos de tiempo
def format_colombia_time_range(log):
    """Convierte timestamps de inicio y fin a un rango de tiempo legible en Colombia"""
    if not log or not log.connection_time or not log.end_time:
        return "N/A"
    
    try:
        colombia_tz = ZoneInfo('America/Bogota')
        start_time = log.connection_time.replace(tzinfo=ZoneInfo('UTC')).astimezone(colombia_tz)
        end_time = log.end_time.replace(tzinfo=ZoneInfo('UTC')).astimezone(colombia_tz)
        
        # ⭐ CORREGIDO: Siempre mostrar fecha completa como solicitaste
        start_str = start_time.strftime('%d/%m/%Y %I:%M %p')
        end_str = end_time.strftime('%I:%M %p')
        
        # Si es el mismo día, mostrar fecha solo al inicio
        if start_time.date() == end_time.date():
            return f"{start_str} - {end_str}"
        else:
            # Si es diferente día, mostrar fecha completa en ambos
            end_str_full = end_time.strftime('%d/%m/%Y %I:%M %p')
            return f"{start_str} - {end_str_full}"
            
    except NameError:
        # Fallback para versiones anteriores
        start_time = log.connection_time.replace(tzinfo=timezone.utc).astimezone(timezone(timedelta(hours=-5)))
        end_time = log.end_time.replace(tzinfo=timezone.utc).astimezone(timezone(timedelta(hours=-5)))
        
        # ⭐ CORREGIDO: Siempre mostrar fecha completa como solicitaste
        start_str = start_time.strftime('%d/%m/%Y %I:%M %p')
        end_str = end_time.strftime('%I:%M %p')
        
        # Si es el mismo día, mostrar fecha solo al inicio
        if start_time.date() == end_time.date():
            return f"{start_str} - {end_str}"
        else:
            # Si es diferente día, mostrar fecha completa en ambos
            end_str_full = end_time.strftime('%d/%m/%Y %I:%M %p')
            return f"{start_str} - {end_str_full}"
            
    except Exception as e:
        return "N/A"

api_bp = Blueprint('store_api', __name__)

@api_bp.route('/worksheet_templates', methods=['POST'])
def create_worksheet_template():
    data = request.get_json()
    title = data.get('title')
    fields = data.get('fields')
    if not title or not fields or not isinstance(fields, list):
        return jsonify({'error': 'Datos inválidos'}), 400
    # Validar unicidad de título (case-insensitive)
    existing = WorksheetTemplate.query.filter(db.func.lower(WorksheetTemplate.title) == title.lower()).first()
    if existing:
        return jsonify({'error': 'Ya existe una plantilla con ese título'}), 400
    template = WorksheetTemplate(title=title, fields=fields)
    db.session.add(template)
    db.session.commit()
    return jsonify({'id': template.id, 'title': template.title, 'fields': template.fields}), 201

@api_bp.route('/worksheet_templates/order', methods=['PATCH'])
def update_worksheet_templates_order():
    # Solo admin
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    username = session.get('username')
    if not username or username != admin_username:
        return jsonify({'error': 'Solo el admin puede cambiar el orden'}), 403
    data = request.get_json()
    ids = data.get('ids')
    if not ids or not isinstance(ids, list):
        return jsonify({'error': 'Lista de IDs inválida'}), 400
    for idx, template_id in enumerate(ids):
        template = WorksheetTemplate.query.get(template_id)
        if template:
            template.order = idx
    db.session.commit()
    return jsonify({'ok': True})

@api_bp.route('/worksheet_templates', methods=['GET'])
def get_worksheet_templates():
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    username = session.get('username')
    user_id = session.get('user_id')
    
    # Si es admin, devolver todas las plantillas
    if username == admin_username:
        templates = WorksheetTemplate.query.order_by(WorksheetTemplate.order.asc(), WorksheetTemplate.created_at.desc()).all()
        return jsonify([
            {'id': t.id, 'title': t.title, 'fields': t.fields, 'created_at': t.created_at.isoformat()}
            for t in templates
        ])
    
    # Si no es admin, obtener el usuario correctamente
    user = None
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
    
    if not user:
        return jsonify([])
    
    # Obtener solo las hojas de cálculo a las que el usuario tiene acceso específico
    user_worksheets = []
    
    # Buscar permisos donde el usuario está incluido
    permissions = WorksheetPermission.query.filter_by(access_type='users').all()
    
    for permission in permissions:
        users_in_permission = permission.users.all()
        
        if user in users_in_permission:
            # Obtener la plantilla asociada al permiso
            worksheet = WorksheetTemplate.query.get(permission.worksheet_id)
            if worksheet:
                worksheet_data = {
                    'id': worksheet.id,
                    'title': worksheet.title,
                    'fields': worksheet.fields,
                    'created_at': worksheet.created_at.isoformat() if worksheet.created_at else None
                }
                user_worksheets.append(worksheet_data)
    
    # Ordenar por el campo 'order'
    user_worksheets.sort(key=lambda w: w.get('order', 0))
    
    # Verificar que no haya objetos vacíos
    filtered_worksheets = [w for w in user_worksheets if w and w.get('id')]
    
    return jsonify(filtered_worksheets)

@api_bp.route('/worksheet_templates/<int:template_id>', methods=['DELETE'])
def delete_worksheet_template(template_id):
    template = WorksheetTemplate.query.get(template_id)
    if not template:
        return jsonify({'error': 'No existe la plantilla'}), 404
    # Eliminar datos asociados
    WorksheetData.query.filter_by(template_id=template_id).delete()
    db.session.delete(template)
    db.session.commit()
    return jsonify({'ok': True})

@api_bp.route('/worksheet_templates/<int:template_id>/rename', methods=['PATCH'])
def rename_worksheet_template(template_id):
    data = request.get_json()
    new_title = data.get('title')
    if not new_title:
        return jsonify({'success': False, 'error': 'Título requerido'}), 400
    template = WorksheetTemplate.query.get(template_id)
    if not template:
        return jsonify({'success': False, 'error': 'Plantilla no encontrada'}), 404
    # Validar unicidad de título (case-insensitive)
    existing = WorksheetTemplate.query.filter(db.func.lower(WorksheetTemplate.title) == new_title.lower(), WorksheetTemplate.id != template_id).first()
    if existing:
        return jsonify({'success': False, 'error': 'Ya existe una plantilla con ese título'}), 400
    template.title = new_title
    db.session.commit()
    return jsonify({'success': True, 'title': new_title})

@api_bp.route('/worksheet_templates', methods=['PUT'])
def update_worksheet_template():
    data = request.get_json()
    template_id = data.get('id')
    title = data.get('title')
    fields = data.get('fields')
    
    if not template_id:
        return jsonify({'error': 'ID de plantilla requerido'}), 400
    
    template = WorksheetTemplate.query.get(template_id)
    if not template:
        return jsonify({'error': 'Plantilla no encontrada'}), 404
    
    # Actualizar campos si se proporcionan
    if title:
        # Validar unicidad de título (case-insensitive)
        existing = WorksheetTemplate.query.filter(
            db.func.lower(WorksheetTemplate.title) == title.lower(), 
            WorksheetTemplate.id != template_id
        ).first()
        if existing:
            return jsonify({'error': 'Ya existe una plantilla con ese título'}), 400
        template.title = title
    
    if fields and isinstance(fields, list):
        template.fields = fields
    
    db.session.commit()
    return jsonify({
        'id': template.id, 
        'title': template.title, 
        'fields': template.fields
    })

@api_bp.route('/worksheet_data/<int:template_id>', methods=['GET'])
def get_worksheet_data(template_id):
    # Verificar permisos del usuario
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    username = session.get('username')
    user_id = session.get('user_id')
    
    # Si no es admin, verificar que tenga acceso a esta plantilla
    if username != admin_username:
        user = None
        if username:
            user = User.query.filter_by(username=username).first()
        elif user_id:
            user = User.query.get(user_id)
            
        if not user:
            return jsonify({'error': 'Usuario no encontrado'}), 404
        
        # Verificar si el usuario tiene acceso a esta plantilla específica
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=template_id, 
            access_type='users'
        ).first()
        
        if not permission or user not in permission.users.all():
            return jsonify({'error': 'No tienes acceso a esta plantilla'}), 403
    
    data = WorksheetData.query.filter_by(template_id=template_id).first()
    if not data:
        return jsonify({
            'data': [], 
            'formato': {},
            'last_edit_time': None,
            'last_editor': None
        })
    return jsonify({
        'data': data.data,
        'formato': data.formato or {},
        'last_edit_time': data.last_edit_time.isoformat() if data.last_edit_time else None,
        'last_editor': data.last_editor
    })

@api_bp.route('/worksheet_data', methods=['POST'])
def save_worksheet_data():
    data = request.get_json()
    template_id = data.get('template_id')
    rows = data.get('data')
    formato = data.get('formato', {})
    
    if not template_id or not isinstance(rows, list):
        return jsonify({'error': 'Datos inválidos'}), 400
    
    # Verificar permisos del usuario
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    username = session.get('username')
    user_id = session.get('user_id')
    
    # Si no es admin, verificar que tenga acceso a esta plantilla
    if username != admin_username:
        user = None
        if username:
            user = User.query.filter_by(username=username).first()
        elif user_id:
            user = User.query.get(user_id)
            
        if not user:
            return jsonify({'error': 'Usuario no encontrado'}), 404
        
        # Verificar si el usuario tiene acceso a esta plantilla específica
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=template_id, 
            access_type='users'
        ).first()
        
        if not permission or user not in permission.users.all():
            return jsonify({'error': 'No tienes acceso a esta plantilla'}), 403
    
    # ⭐ NUEVO: Registrar información del editor admin
    current_username = session.get('username', 'Usuario')
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    is_admin = current_username == admin_user
    
    editor_info = f"{current_username} (Admin)" if is_admin else current_username
    
    worksheet_data = WorksheetData.query.filter_by(template_id=template_id).first()
    new_timestamp = datetime.utcnow()
    
    if worksheet_data:
        # ⭐ NUEVO: Logging antes de actualizar

        
        worksheet_data.data = rows
        worksheet_data.formato = formato
        worksheet_data.last_editor = editor_info
        worksheet_data.last_edit_time = new_timestamp
    else:
        # ⭐ NUEVO: Logging para nuevo registro

        
        worksheet_data = WorksheetData(
            template_id=template_id, 
            data=rows, 
            formato=formato,
            last_editor=editor_info,
            last_edit_time=new_timestamp
        )
        db.session.add(worksheet_data)
    
    db.session.commit()
    
    # ⭐ NUEVO: Verificar que se guardó correctamente
    verified_data = WorksheetData.query.filter_by(template_id=template_id).first()
    return jsonify({
        'ok': True,
        'editor_info': editor_info
    }) 

# ============================================
# RUTAS PARA PERMISOS DE WORKSHEET
# ============================================

@csrf_exempt_api
@api_bp.route('/usuarios', methods=['GET'])
def get_users():
    """Obtener lista de usuarios para permisos"""
    try:
        # Solo admin puede ver usuarios
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        current_username = session.get("username")
        
        # Verificar que esté logueado y sea admin
        if not session.get("logged_in") or current_username != admin_username:
            return jsonify({'error': 'No autorizado'}), 401
        
        # Usar la misma lógica que en admin_users.js
        # Filtrar usuarios principales (no sub-usuarios) y excluir admin
        users_query = User.query.filter(
            User.username != admin_username,
            User.parent_id == None
        )
        
        # Aplicar búsqueda si se proporciona
        search_query = request.args.get('search', '')
        if search_query:
            users_query = users_query.filter(
                db.or_(
                    User.username.ilike(f'%{search_query}%'),
                    User.full_name.ilike(f'%{search_query}%'),
                    User.email.ilike(f'%{search_query}%')
                )
            )
        
        # Obtener todos los usuarios
        users = users_query.order_by(User.position.asc(), User.username.asc()).all()
        

        
        return jsonify([{
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'full_name': user.full_name or user.username,
            'position': user.position or 1
        } for user in users])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@csrf_exempt_api
@api_bp.route('/worksheet_permissions', methods=['POST'])
def save_worksheet_permissions():
    """Guardar permisos de acceso a una worksheet"""
    try:
        # Solo admin puede gestionar permisos
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if not session.get("logged_in") or session.get("username") != admin_username:
            return jsonify({'error': 'No autorizado'}), 401
        
        data = request.get_json()
        worksheet_id = data.get('worksheet_id')
        access_type = data.get('type')
        users = data.get('users', [])
        public_link = data.get('public_link')
        
        
        if not worksheet_id or not access_type:
            return jsonify({'error': 'Datos inválidos'}), 400
        
        # Verificar que la worksheet existe
        worksheet = WorksheetTemplate.query.get(worksheet_id)
        if not worksheet:
            return jsonify({'error': 'Worksheet no encontrada'}), 404
        
        # CORREGIDO: Sistema NO mutuamente exclusivo - permitir coexistencia
        if access_type == 'private':
            # Solo eliminar permisos públicos (view/edit), mantener users
            WorksheetPermission.query.filter(
                WorksheetPermission.worksheet_id == worksheet_id,
                WorksheetPermission.access_type.in_(['view', 'edit'])
            ).delete(synchronize_session=False)
            
            # Buscar o crear permiso privado
            permission = WorksheetPermission.query.filter_by(
                worksheet_id=worksheet_id, 
                access_type='private'
            ).first()
            
            if not permission:
                permission = WorksheetPermission(worksheet_id=worksheet_id, access_type='private')
                permission.public_token = None
                db.session.add(permission)
            
        elif access_type in ['view', 'edit']:
            # CORREGIDO: Eliminar el permiso opuesto para evitar conflictos
            opposite_type = 'edit' if access_type == 'view' else 'view'
            
            # Verificar permisos existentes antes de eliminar
            existing_permissions = WorksheetPermission.query.filter_by(worksheet_id=worksheet_id).all()
            
            # Eliminar private y el tipo opuesto
            deleted_count = WorksheetPermission.query.filter(
                WorksheetPermission.worksheet_id == worksheet_id,
                WorksheetPermission.access_type.in_(['private', opposite_type])
            ).delete(synchronize_session=False)
            
            # Verificar después de eliminar
            remaining_permissions = WorksheetPermission.query.filter_by(worksheet_id=worksheet_id).all()
            
            # Buscar o crear permiso público
            permission = WorksheetPermission.query.filter_by(
                worksheet_id=worksheet_id, 
                access_type=access_type
            ).first()
            
            if not permission:
                permission = WorksheetPermission(worksheet_id=worksheet_id, access_type=access_type)
                db.session.add(permission)
            
            # ⭐ CORREGIDO: Generar token público siempre nuevo para evitar problemas
            # Regenerar token para asegurar que funcione correctamente
            permission.public_token = secrets.token_urlsafe(32)
                
        elif access_type == 'users':
            # CORREGIDO: No eliminar permisos generales, mantener independencia
            # Los usuarios específicos son independientes de la configuración general
            
            # Buscar o crear permiso de usuarios
            permission = WorksheetPermission.query.filter_by(
                worksheet_id=worksheet_id, 
                access_type='users'
            ).first()
            
            if not permission:
                permission = WorksheetPermission(worksheet_id=worksheet_id, access_type='users')
                db.session.add(permission)
            
            # Manejar usuarios específicos
            if users:
                user_objects = User.query.filter(User.id.in_(users)).all()
                permission.users = []  # Limpiar usuarios existentes
                permission.users.extend(user_objects)  # Agregar nuevos usuarios
            else:
                permission.users = []
            
            # ⭐ CORREGIDO: Generar token para usuarios específicos siempre nuevo
            # Regenerar token para asegurar que funcione correctamente
            permission.public_token = secrets.token_urlsafe(32)
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'permission': permission.to_dict()
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@api_bp.route('/worksheet_permissions/<int:worksheet_id>', methods=['GET'])
def get_worksheet_permissions(worksheet_id):
    """Obtener todos los permisos de una worksheet"""
    try:
        
        permissions = WorksheetPermission.query.filter_by(worksheet_id=worksheet_id).all()
        
        if not permissions:
            return jsonify({'permissions': [], 'default_access_type': 'private'})
        
        # Convertir todos los permisos a diccionario
        permissions_dict = {}
        for permission in permissions:
            permissions_dict[permission.access_type] = permission.to_dict()
        
        return jsonify({'permissions': permissions_dict})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route('/worksheet_permissions/<int:worksheet_id>', methods=['DELETE'])
def delete_worksheet_permissions(worksheet_id):
    """Eliminar permisos de una worksheet (volver a privado)"""
    try:
        # Solo admin puede eliminar permisos
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if not session.get("logged_in") or session.get("username") != admin_username:
            return jsonify({'error': 'No autorizado'}), 401
        
        permission = WorksheetPermission.query.filter_by(worksheet_id=worksheet_id).first()
        if permission:
            db.session.delete(permission)
            db.session.commit()
        
        return jsonify({'success': True})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ============================================
# ⭐ NUEVO: SISTEMA DE PRESENCIA PARA ADMIN
# ============================================

# ELIMINADO: Imports de viewers (código muerto)
# from app.store.presence import add_viewer, remove_viewer, get_active_viewers, cleanup_inactive_viewers
import time

@csrf_exempt_api
@api_bp.route('/worksheet_presence/<int:worksheet_id>', methods=['POST'])
def admin_worksheet_presence(worksheet_id):
    """API para registrar presencia admin en worksheet"""
    try:
        # Verificar permisos del usuario
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        username = session.get('username')
        user_id = session.get('user_id')
        
        # Si no es admin, verificar que tenga acceso a esta plantilla
        if username != admin_username:
            user = None
            if username:
                user = User.query.filter_by(username=username).first()
            elif user_id:
                user = User.query.get(user_id)
                
            if not user:
                return jsonify({'error': 'Usuario no encontrado'}), 404
            
            # Verificar si el usuario tiene acceso a esta plantilla específica
            permission = WorksheetPermission.query.filter_by(
                worksheet_id=worksheet_id, 
                access_type='users'
            ).first()
            
            if not permission or user not in permission.users.all():
                return jsonify({'error': 'No tienes acceso a esta plantilla'}), 403
        
        data = request.get_json()
        session_id = data.get('session_id')
        action = data.get('action', 'viewing')
        user_from_frontend = data.get('user')  # ⭐ NUEVO: Obtener nombre del usuario desde frontend
        
        if not session_id:
            return jsonify({'error': 'Session ID requerido'}), 400
        
        # ELIMINADO: Imports y llamadas de viewers (código muerto)
        # from app.store.presence import add_viewer, remove_viewer, update_viewer_presence, update_user_activity
        
        # ⭐ NUEVO: Usar nombre del usuario desde frontend si está disponible
        current_username = session.get('username', 'Usuario')
        admin_user_config = current_app.config.get("ADMIN_USER", "admin")
        is_admin = current_username == admin_user_config
        
        # Usar el nombre del frontend si está disponible, sino usar el de la sesión
        display_name = user_from_frontend if user_from_frontend and user_from_frontend != 'Usuario' else (
            f"admin ({current_username})" if is_admin else current_username
        )
        
        # ⭐ NUEVO: Detectar actividad si es una acción de visualización
        if action == 'viewing':
            # Importar función de presencia
            from app.store.presence import update_user_activity
            update_user_activity(worksheet_id, display_name)
        
        user_info = {
            'user': display_name,
            'access_type': 'admin' if is_admin else 'user',
            'is_admin': is_admin,
            'ip': request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'Unknown'))
        }
        
        # ELIMINADO: Llamadas a funciones de viewers (código muerto)
        # if action == 'viewing':
        #     add_viewer(worksheet_id, session_id, user_info)
        # elif action == 'left':
        #     remove_viewer(worksheet_id, session_id, is_real_disconnect=True)
        # else:
        #     update_viewer_presence(worksheet_id, session_id)
        
        # ⭐ NUEVO: Ejecutar limpieza mensual automática si es día 28
        from app.store.presence import auto_monthly_cleanup
        auto_monthly_cleanup()
        
        return jsonify({'success': True, 'action': action})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ⭐ NUEVO: Endpoint para registrar actividad específica del usuario
@api_bp.route('/worksheet_activity/<int:worksheet_id>', methods=['POST'])
def register_user_activity(worksheet_id):
    """API para registrar actividad específica del usuario (clicks, movimientos, etc.)"""
    try:
        data = request.get_json()
        activity_type = data.get('activity_type', 'interaction')
        
        # ⭐ NUEVO: Información adicional de actividad
        timestamp = data.get('timestamp')
        user_agent = data.get('user_agent')
        url = data.get('url')
        referrer = data.get('referrer')
        screen_resolution = data.get('screen_resolution')
        window_size = data.get('window_size')
        is_visible = data.get('is_visible', True)
        is_focused = data.get('is_focused', True)
        
        # Importar función de presencia
        from app.store.presence import update_user_activity
        
        # Determinar usuario actual
        current_username = session.get('username', 'Usuario')
        admin_user_config = current_app.config.get("ADMIN_USER", "admin")
        is_admin = current_username == admin_user_config
        
        if session.get('logged_in') and current_username:
            user_identifier = f"admin ({current_username})" if is_admin else current_username
        else:
            # Usuario anónimo
            ip_address = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'Unknown'))
            if ',' in ip_address:
                ip_address = ip_address.split(',')[0].strip()
            user_identifier = f"Anónimo [{ip_address}]"
        
        # ⭐ MEJORADO: Registrar actividad con información adicional
        update_user_activity(worksheet_id, user_identifier)
        
        # ⭐ NUEVO: Log detallado de actividad
        activity_message = f"Actividad registrada: {activity_type}"
        if activity_type in ['page_refresh', 'page_load', 'page_visible']:
            activity_message = f"Página recargada/visible: {activity_type}"
        elif activity_type in ['window_focus', 'window_blur', 'tab_return']:
            activity_message = f"Ventana enfocada/desenfocada: {activity_type}"
        elif activity_type in ['mouse_movement', 'page_scroll', 'table_scroll']:
            activity_message = f"Movimiento detectado: {activity_type}"
        

        
        return jsonify({
            'success': True, 
            'activity_type': activity_type,
            'user': user_identifier,
            'message': activity_message,
            'timestamp': timestamp,
            'is_visible': is_visible,
            'is_focused': is_focused
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@csrf_exempt_api
# ELIMINADO: Ruta de viewers (código muerto)
# @api_bp.route('/worksheet_viewers/<int:worksheet_id>', methods=['GET'])

# ============================================
# ⭐ NUEVO: SISTEMA DE SINCRONIZACIÓN TIEMPO REAL PARA ADMIN
# ============================================

@csrf_exempt_api
@api_bp.route('/worksheet_changes/<int:worksheet_id>', methods=['GET'])
def check_admin_worksheet_changes(worksheet_id):
    """API para verificar si hay cambios en worksheet (modo admin)"""
    try:
        # Verificar permisos del usuario
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        username = session.get('username')
        user_id = session.get('user_id')
        
        # Si no es admin, verificar que tenga acceso a esta plantilla
        if username != admin_username:
            user = None
            if username:
                user = User.query.filter_by(username=username).first()
            elif user_id:
                user = User.query.get(user_id)
                
            if not user:
                # En lugar de 404, devolver respuesta sin cambios
                return jsonify({
                    'has_changes': False,
                    'last_edit_time': None,
                    'last_editor': None
                })
            
            # Verificar si el usuario tiene acceso a esta plantilla específica
            permission = WorksheetPermission.query.filter_by(
                worksheet_id=worksheet_id, 
                access_type='users'
            ).first()
            
            if not permission or user not in permission.users.all():
                # En lugar de 403, devolver respuesta sin cambios
                return jsonify({
                    'has_changes': False,
                    'last_edit_time': None,
                    'last_editor': None
                })
        
        last_known_time = request.args.get('last_time')
        
        # Obtener datos actuales
        worksheet_data = WorksheetData.query.filter_by(template_id=worksheet_id).first()
        
        if not worksheet_data:
            return jsonify({
                'has_changes': False,
                'last_edit_time': None,
                'last_editor': None
            })
        
        # Convertir timestamps para comparación
        current_time = worksheet_data.last_edit_time
        if current_time:
            current_timestamp = current_time.isoformat()
        else:
            current_timestamp = None
        

        
        # Verificar si hay cambios
        has_changes = False
        change_reason = "sin_cambios"
        
        if last_known_time and current_timestamp:
            has_changes = current_timestamp != last_known_time
            change_reason = "timestamp_diferente" if has_changes else "timestamp_igual"
        elif not last_known_time and current_timestamp:
            has_changes = True
            change_reason = "primera_carga"
        else:
            # No hay timestamp conocido ni actual
            has_changes = False
            change_reason = "sin_timestamp"
        
        result = {
            'has_changes': has_changes,
            'last_edit_time': current_timestamp,
            'last_editor': worksheet_data.last_editor,
            'data': worksheet_data.data if has_changes else None,
            'formato': worksheet_data.formato if has_changes else None,
        }
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================
# ⭐ NUEVO: ENDPOINTS PARA REGISTROS DE CONEXIÓN
# ============================================

@api_bp.route('/worksheet_connection_logs/<int:worksheet_id>', methods=['GET'])
def get_worksheet_connection_logs(worksheet_id):
    """API para obtener registros de conexión de un worksheet"""
    try:
        # Parámetros de consulta
        limit = request.args.get('limit', 100, type=int)
        search_query = request.args.get('search', None)
        
        # Importar función de presencia
        from app.store.presence import get_connection_logs, fix_anonymous_logs
        
        # ⭐ NUEVO: Intentar corregir registros anónimos antes de obtener logs
        fix_anonymous_logs(worksheet_id)
        
        # Obtener registros
        logs = get_connection_logs(worksheet_id, limit, search_query)
        
        # Formatear respuesta
        formatted_logs = []
        for log in logs:
            try:
                formatted_logs.append({
                    'id': log.id,
                    'user_type': log.user_type,
                    'user_identifier': log.user_identifier,
                    'display_name': log.display_name,
                    'session_id': log.session_id,
                    'action': log.action,
                    'ip_address': log.ip_address,
                    'connection_time': log.connection_time.isoformat() if log.connection_time else None,
                    'end_time': log.end_time.isoformat() if log.end_time else None,
                    'formatted_time': format_colombia_time(log.connection_time) if log.connection_time else "N/A",
                    'formatted_time_range': format_colombia_time_range(log),
                    'duration_seconds': log.duration_seconds,
                    'formatted_duration': log.formatted_duration,
                    'user_agent': log.user_agent
                })
            except Exception as log_error:
        
                # Agregar log básico en caso de error
                formatted_logs.append({
                    'id': log.id,
                    'user_type': log.user_type or 'unknown',
                    'user_identifier': log.user_identifier or 'Unknown',
                    'display_name': log.user_identifier or 'Unknown',
                    'session_id': log.session_id,
                    'action': log.action or 'unknown',
                    'ip_address': log.ip_address or 'Unknown',
                    'connection_time': None,
                    'end_time': None,
                    'formatted_time': "N/A",
                    'formatted_time_range': "N/A",
                    'duration_seconds': log.duration_seconds,
                    'formatted_duration': "N/A",
                    'user_agent': log.user_agent or 'Unknown'
                })
        
        return jsonify({
            'success': True,
            'logs': formatted_logs,
            'total': len(formatted_logs)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route('/worksheet_connection_logs/<int:worksheet_id>/clear', methods=['DELETE'])
def clear_worksheet_connection_logs(worksheet_id):
    """API para limpiar todos los registros de conexión de un worksheet"""
    try:
        # ⭐ NUEVO: Solo el admin puede borrar registros
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        username = session.get('username')
        
        if username != admin_username:
            return jsonify({'error': 'Solo el administrador puede borrar registros de conexión'}), 403
        
        # Importar función de presencia
        from app.store.presence import clear_all_logs
        
        # Limpiar registros
        deleted_count = clear_all_logs(worksheet_id)
        
        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'message': f'Se eliminaron {deleted_count} registros de conexión'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route('/worksheet_connection_logs/cleanup', methods=['POST'])
def cleanup_worksheet_connection_logs():
    """API para limpiar registros de conexión antiguos"""
    try:
        # ⭐ NUEVO: Solo el admin puede ejecutar limpieza manual
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        username = session.get('username')
        
        if username != admin_username:
            return jsonify({'error': 'Solo el administrador puede ejecutar limpieza manual'}), 403
        
        # Importar función de limpieza
        from app.store.cleanup import manual_cleanup
        
        # Ejecutar limpieza manual
        result = manual_cleanup()
        
        if 'error' in result:
            return jsonify({'error': result['error']}), 500
        
        return jsonify({
            'success': True,
            'inactive_count': result['inactive_count'],
            'deleted_count': result['deleted_count'],
            'message': f'Limpieza completada: {result["inactive_count"]} sesiones inactivas, {result["deleted_count"]} registros antiguos'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route('/worksheet_connection_logs/initialize', methods=['POST'])
def initialize_connection_system():
    """API para inicializar sistema de registros de conexión"""
    try:
        from app.store.presence import initialize_connection_system
        
        result = initialize_connection_system()
        
        return jsonify({
            'success': True,
            'message': 'Sistema de registros inicializado correctamente',
            'result': result
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================
# ⭐ NUEVO: ENDPOINTS PARA HISTORIAL DE CAMBIOS (SISTEMA UNIFICADO)
# ============================================

# ⭐ NUEVO: Importar el sistema unificado de historial
from app.store.history_manager import (
    add_change_to_history, 
    get_worksheet_history, 
    clear_worksheet_history,
    merge_histories,
    validate_change
)

@api_bp.route('/worksheet_history/<int:worksheet_id>', methods=['POST'])
def save_worksheet_history(worksheet_id):
    """API para guardar historial de cambios de un worksheet (modo admin) - SISTEMA UNIFICADO"""
    try:
        data = request.get_json()
        change = data.get('change')
        full_history = data.get('full_history', [])
        
        if not change:
            return jsonify({'error': 'Datos de cambio requeridos'}), 400
        
        # Validar el cambio
        if not validate_change(change):
            return jsonify({'error': 'Datos de cambio inválidos'}), 400
        
        # Agregar el cambio al historial unificado
        success = add_change_to_history(worksheet_id, change)
        
        if success:
            # Obtener el historial actualizado
            current_history = get_worksheet_history(worksheet_id)
            

            
            return jsonify({
                'success': True,
                'message': 'Historial guardado correctamente',
                'total_changes': len(current_history),
                'history': current_history  # Devolver historial actualizado
            })
        else:
            return jsonify({'error': 'Error guardando el cambio'}), 500
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route('/worksheet_history/<int:worksheet_id>', methods=['GET'])
def get_worksheet_history_endpoint(worksheet_id):
    """API para obtener historial de cambios de un worksheet (modo admin) - SISTEMA UNIFICADO"""
    try:
        # Obtener historial del sistema unificado
        history = get_worksheet_history(worksheet_id)
        
        
        
        return jsonify({
            'success': True,
            'history': history,
            'total_changes': len(history)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route('/worksheet_history/<int:worksheet_id>', methods=['DELETE'])
def clear_worksheet_history_endpoint(worksheet_id):
    """API para limpiar historial de cambios de un worksheet (modo admin) - SISTEMA UNIFICADO"""
    try:
        # Limpiar historial usando el sistema unificado
        deleted_count = clear_worksheet_history(worksheet_id)
        
        
        
        return jsonify({
            'success': True,
            'message': f'Se eliminaron {deleted_count} cambios del historial',
            'deleted_count': deleted_count
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


 
