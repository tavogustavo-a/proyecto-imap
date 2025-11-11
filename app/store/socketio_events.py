# app/store/socketio_events.py
# Manejo de eventos de SocketIO para chat en tiempo real

from flask import current_app, request
from flask_socketio import emit, join_room, leave_room, disconnect
from app.store.socketio_standalone import tienda_socketio
from app.extensions import db
from app.models.chat import ChatMessage, ChatSession
from app.models.user import User
from datetime import datetime, timezone
import json
import time


# Almacenar usuarios conectados y sus salas
connected_users = {}

# Almacenar asignaciones de chat
chat_assignments = {}

# Almacenamiento temporal de chunks
file_chunks = {}

# ✅ OPTIMIZACIÓN: Configuraciones de rendimiento
import asyncio
from concurrent.futures import ThreadPoolExecutor
import threading
import queue

# Pool de hilos para operaciones pesadas
executor = ThreadPoolExecutor(max_workers=4)

# Cache para usuarios conectados (evitar consultas repetidas a DB)
user_cache = {}
cache_timeout = 300  # 5 minutos

# ✅ NUEVO: Pool de conexiones para manejar alta concurrencia
connection_pool = {}
connection_lock = threading.Lock()

@tienda_socketio.on('connect')
def handle_connect():
    """Manejar conexión de usuario"""
    try:
        # Usuario conectado
        emit('connected', {'status': 'connected', 'socket_id': request.sid})
    except Exception as e:
        pass

@tienda_socketio.on('disconnect')
def handle_disconnect():
    """Manejar desconexión de usuario"""
    try:
        user_id = None
        for uid, connections in connected_users.items():
            for i, connection in enumerate(connections):
                if connection['socket_id'] == request.sid:
                    user_id = uid
                    connections.pop(i)
                    if not connections:
                        del connected_users[user_id]
                    emit('user_disconnected', {
                        'user_id': user_id,
                        'timestamp': datetime.utcnow().isoformat()
                    }, broadcast=True, include_self=False)
                    emit('user_list_update', {
                        'user_id': user_id,
                        'action': 'user_offline',
                        'timestamp': datetime.utcnow().isoformat()
                    }, room="support_room")
                    emit('user_list_update', {
                        'user_id': user_id,
                        'action': 'user_offline',
                        'timestamp': datetime.utcnow().isoformat()
                    }, room="admin_chat_1")
                    break
    except Exception as e:
        pass

@tienda_socketio.on('join_chat')
def handle_join_chat(data):
    """Usuario se une al chat"""
    try:
        user_id = data.get('user_id')
        username = data.get('username')
        is_support = data.get('is_support', False)
        
        if not user_id:
            emit('error', {'message': 'ID de usuario requerido'})
            return
        
        # Crear sala para el usuario
        room = f"user_chat_{user_id}"
        join_room(room)

        # Si es un admin, también unirse a su sala de admin
        admin_room = f"admin_chat_{user_id}"
        join_room(admin_room)

        # Si es usuario soporte, unirse a TODAS las salas de chat activas
        if is_support:
            # Obtener todos los usuarios (no solo los que tienen mensajes)
            all_users = User.query.filter(User.id != user_id).all()
            
            # Unirse a todas las salas de chat
            for user in all_users:
                support_room = f"user_chat_{user.id}"
                join_room(support_room)
                
                # También unirse a las salas de admin para ver mensajes del admin
                admin_room = f"admin_chat_{user.id}"
                join_room(admin_room)
            
            # También unirse a una sala general de soporte
            join_room("support_room")
        
        # Si es admin, también unirse a la sala de soporte para ver mensajes del soporte
        import os
        admin_username = os.getenv('ADMIN_USER', 'admin')
        
        # Verificar si es admin por username O por ID (más robusto)
        is_admin = (username == admin_username) or (username == 'tavo') or (user_id == '1')
        
        if is_admin:
            join_room("support_room")
        
        # Almacenar información del usuario (soporte para múltiples conexiones)
        if user_id not in connected_users:
            connected_users[user_id] = []
        
        # Agregar nueva conexión
        connection_info = {
            'socket_id': request.sid,
            'room': room,
            'admin_room': admin_room,
            'username': username,
            'is_support': is_support
        }
        connected_users[user_id].append(connection_info)
        
        # Notificar que el usuario se unió
        emit('user_joined', {
            'user_id': user_id,
            'username': username,
            'timestamp': datetime.utcnow().isoformat()
        }, room=room, include_self=False)
        
        # Notificar actualización de lista de usuarios a admin/soporte
        emit('user_list_update', {
            'user_id': user_id,
            'action': 'user_online',
            'username': username,
            'timestamp': datetime.utcnow().isoformat()
        }, room="support_room")
        
        # También notificar a la sala de admin principal
        emit('user_list_update', {
            'user_id': user_id,
            'action': 'user_online',
            'username': username,
            'timestamp': datetime.utcnow().isoformat()
        }, room="admin_chat_1")
        
        # ✅ NUEVO: Emitir evento para recargar lista completa cuando hay nuevo usuario
        emit('user_list_update', {
                'user_id': user_id,
            'action': 'new_user',
            'username': username,
                'timestamp': datetime.utcnow().isoformat()
        }, room="support_room")
        
        emit('user_list_update', {
                'user_id': user_id,
            'action': 'new_user',
                'username': username,
            'timestamp': datetime.utcnow().isoformat()
        }, room="admin_chat_1")
            
    except Exception as e:
        # Error al unirse al chat
        pass

@tienda_socketio.on('new_message')
def handle_new_message(data):
    """Nuevo mensaje de chat - OPTIMIZADO para alta velocidad"""
    try:
        sender_id = data.get('sender_id')
        recipient_id = data.get('recipient_id')
        message = data.get('message')
        message_type = data.get('message_type', 'user')
        
        if not all([sender_id, recipient_id, message]):
            emit('error', {'message': 'Datos de mensaje incompletos'})
            return
        
        # ✅ OPTIMIZACIÓN: Crear mensaje en la base de datos de forma más eficiente
        chat_message = ChatMessage(
            sender_id=sender_id,
            recipient_id=recipient_id,
            message=message,
            message_type=message_type
        )
        
        db.session.add(chat_message)
        db.session.flush()  # Flush para obtener el ID sin commit completo
        
        # ✅ OPTIMIZACIÓN: Obtener información del remitente de forma más eficiente
        sender_name = 'Usuario'  # Valor por defecto
        if str(sender_id) in connected_users:
            sender_name = connected_users[str(sender_id)][0].get('username', 'Usuario')
        
        # Preparar datos del mensaje para enviar
        message_data = {
            'id': chat_message.id,
            'sender_id': sender_id,
            'sender_name': sender_name,
            'recipient_id': recipient_id,
            'message': message,
            'message_type': message_type,
            'created_at': chat_message.created_at.isoformat(),
            'timestamp': chat_message.created_at.isoformat(),
            'is_read': False
        }
        
        # ✅ OPTIMIZACIÓN: Lógica de envío más eficiente
        if message_type == 'admin' or message_type == 'support':
            # Mensajes de admin/soporte: enviar a todas las salas relevantes
            rooms_to_notify = [
                f"user_chat_{recipient_id}",  # Usuario destinatario
                f"admin_chat_{recipient_id}", # Admin del chat
                "support_room",               # Sala de soporte
                f"admin_chat_1"               # Admin principal
            ]
            
            # Si el admin/soporte se envía a sí mismo, agregar su sala personal
            if sender_id == recipient_id:
                rooms_to_notify.append(f"admin_chat_{sender_id}")
        else:
            # Mensajes de usuario normal: enviar a salas específicas
            rooms_to_notify = [
                f"user_chat_{recipient_id}",  # Usuario destinatario
                f"user_chat_{sender_id}",     # Usuario remitente (para ver su mensaje)
                f"admin_chat_{recipient_id}", # Admin del chat
                "support_room"                # Sala de soporte
            ]
            
        # ✅ OPTIMIZACIÓN: Emitir directamente con manejo robusto de errores
        try:
            # Emitir a todas las salas con manejo individual de errores
            for room in rooms_to_notify:
                try:
                    emit('message_received', message_data, room=room)
                except Exception as emit_error:
                    # Log del error pero continuar con otras salas
                    print(f"Error emitiendo a sala {room}: {emit_error}")
                    continue
        except Exception as emit_error:
            # Si falla completamente, continuar con el commit
            print(f"Error en emisión principal: {emit_error}")
            pass

        # ✅ OPTIMIZACIÓN: Emitir cambio de estado de forma más eficiente
        status_data = {
            'user_id': recipient_id if message_type in ['admin', 'support'] else sender_id,
            'status': 'responded' if message_type in ['admin', 'support'] else 'active',
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Emitir cambio de estado a salas relevantes
        for room in ["support_room", "admin_chat_1"]:
            emit('chat_status_changed', status_data, room=room)
        
        # ✅ NUEVO: Emitir actualización de lista de usuarios para ordenar por recientes
        user_list_data = {
            'user_id': recipient_id if message_type in ['admin', 'support'] else sender_id,
            'action': 'new_message',
            'username': sender_name,
            'message_preview': message[:50] + '...' if len(message) > 50 else message,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Emitir actualización de lista a salas de admin/soporte
        for room in ["support_room", "admin_chat_1"]:
            emit('user_list_update', user_list_data, room=room)
        
        # ✅ OPTIMIZACIÓN: Commit al final para mejor rendimiento
        try:
            db.session.commit()
        except Exception as commit_error:
            db.session.rollback()
            emit('error', {'message': 'Error al guardar mensaje en la base de datos'})
            return
        
        # ✅ OPTIMIZACIÓN: Confirmar envío de forma más eficiente
        try:
            emit('message_sent', {
                'status': 'success',
                'data': message_data,
                'message_id': chat_message.id,
                'timestamp': chat_message.created_at.isoformat()
            })
        except Exception as confirm_error:
            # Si falla la confirmación, no es crítico
            pass
        
    except Exception as e:
        db.session.rollback()
        emit('error', {'message': 'Error al enviar mensaje'})

@tienda_socketio.on('send_message')
def handle_send_message(data):
    """Enviar mensaje de texto (alias de new_message)"""
    # Reutilizar la lógica de new_message
    handle_new_message(data)

@tienda_socketio.on('send_file_message')
def handle_send_file_message(data):
    """Enviar mensaje con archivo"""
    try:
        sender_id = data.get('sender_id')
        recipient_id = data.get('recipient_id')
        message = data.get('message', '')
        attachment_filename = data.get('attachment_filename')
        attachment_type = data.get('attachment_type')
        attachment_data = data.get('attachment_data')
        attachment_size = data.get('attachment_size', 0)
        
        if not all([sender_id, recipient_id, attachment_filename]):
            emit('error', {'message': 'Datos de archivo incompletos'})
            return
        
        # Obtener el tipo de mensaje del data
        message_type = data.get('message_type', 'user')
        
        # Crear mensaje con archivo en la base de datos
        chat_message = ChatMessage(
            sender_id=sender_id,
            recipient_id=recipient_id,
            message=message or f'Archivo: {attachment_filename}',
            message_type=message_type,
            has_attachment=True,
            attachment_filename=attachment_filename,
            attachment_type=attachment_type,
            attachment_size=attachment_size
        )
        
        db.session.add(chat_message)
        db.session.commit()
        
        # Guardar archivo en el sistema de archivos
        import os
        import base64
        from werkzeug.utils import secure_filename
        
        # Crear directorio de uploads si no existe
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        os.makedirs(upload_dir, exist_ok=True)
        
        # Generar nombre único para el archivo
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        unique_filename = f"{timestamp}_{secure_filename(attachment_filename)}"
        file_path = os.path.join(upload_dir, unique_filename)
        
        try:
            # ✅ OPTIMIZADO: Decodificar y guardar el archivo base64 de forma más eficiente
            if attachment_data:
                # ✅ OPTIMIZACIÓN: Usar chunked writing para archivos grandes
                file_bytes = base64.b64decode(attachment_data)
                chunk_size = 8192  # 8KB chunks
                
                with open(file_path, 'wb') as f:
                    for i in range(0, len(file_bytes), chunk_size):
                        f.write(file_bytes[i:i + chunk_size])
                
                # ✅ OPTIMIZADO: Verificación rápida del archivo
                if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
                    emit('error', {'message': 'Error: Archivo no se guardó correctamente'})
                    return
                
                # Actualizar el mensaje con la ruta del archivo guardado
                chat_message.attachment_path = unique_filename
                db.session.commit()
            else:
                emit('error', {'message': 'No se proporcionó datos de archivo'})
                return
                
        except Exception as file_error:
            # ✅ MEJORADO: Manejar errores de archivo de forma más específica
            emit('error', {'message': f'Error guardando archivo: {str(file_error)}'})
            return
        
        # Obtener información del remitente
        sender = User.query.get(sender_id)
        sender_name = sender.username if sender else 'Usuario'
        
        # Preparar datos del mensaje para enviar
        message_data = {
            'id': chat_message.id,
            'sender_id': sender_id,
            'sender_name': sender_name,
            'recipient_id': recipient_id,
            'message': chat_message.message,
            'message_type': message_type,
            'has_attachment': True,
            'attachment_filename': attachment_filename,
            'attachment_type': attachment_type,
            'attachment_size': attachment_size,
            'attachment_data': attachment_data,  # Incluir datos del archivo
            'attachment_path': chat_message.attachment_path,  # Incluir path del archivo
            'created_at': chat_message.created_at.isoformat(),
            'timestamp': chat_message.created_at.isoformat(),
            'is_temp': False
        }
        
        # ✅ OPTIMIZADO: Enviar mensaje a todas las salas de forma más eficiente
        rooms_to_notify = [
            f"user_chat_{recipient_id}",
            f"admin_chat_{recipient_id}",
            "support_room",
            f"admin_chat_{sender_id}",
            "admin_chat_1"
        ]
        
        # Emitir a todas las salas de una vez
        for room in rooms_to_notify:
            emit('file_message_received', message_data, room=room)
        
        # ✅ NUEVO: Emitir actualización de lista de usuarios para archivos
        user_list_data = {
            'user_id': recipient_id if message_type in ['admin', 'support'] else sender_id,
            'action': 'new_message',
            'username': sender_name,
            'message_preview': f"[Archivo.{attachment_filename.split('.')[-1] if '.' in attachment_filename else ''}]",
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Emitir actualización de lista a salas de admin/soporte
        for room in ["support_room", "admin_chat_1"]:
            emit('user_list_update', user_list_data, room=room)
        
        # ✅ NUEVO: Emitir cambio de estado del chat para archivos
        status_data = {
            'user_id': recipient_id if message_type in ['admin', 'support'] else sender_id,
            'status': 'responded' if message_type in ['admin', 'support'] else 'active',
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Emitir cambio de estado a salas relevantes
        for room in ["support_room", "admin_chat_1"]:
            emit('chat_status_changed', status_data, room=room)
        
        # Confirmar envío al remitente
        emit('file_message_sent', {
            'status': 'success',
            'data': message_data,
            'message_id': chat_message.id,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        
    except Exception as e:
        emit('error', {'message': f'Error al enviar archivo: {str(e)}'})

@tienda_socketio.on('send_audio_message')
def handle_send_audio_message(data):
    """Enviar mensaje de audio"""
    try:
        sender_id = data.get('sender_id')
        recipient_id = data.get('recipient_id')
        audio_data = data.get('audio_data')  # Base64 encoded audio
        audio_filename = data.get('audio_filename')
        message_type = data.get('message_type', 'user')
        
        if not all([sender_id, recipient_id, audio_data]):
            emit('error', {'message': 'Datos de audio incompletos'})
            return
        
        # Validar que audio_data es base64 válido
        try:
            import base64
            # Intentar decodificar para validar que es base64 válido
            base64.b64decode(audio_data, validate=True)
        except Exception as e:
            emit('error', {'message': 'Datos de audio inválidos - no es base64 válido'})
            return
        
        # Crear mensaje de audio en la base de datos
        chat_message = ChatMessage(
            sender_id=sender_id,
            recipient_id=recipient_id,
            message='[Audio]',
            message_type=message_type,
            has_attachment=True,
            attachment_filename=audio_filename,
            attachment_type='audio'
        )
        
        db.session.add(chat_message)
        db.session.commit()
        
        # Guardar archivo de audio en el sistema de archivos
        import os
        import base64
        from werkzeug.utils import secure_filename
        
        # Crear directorio de uploads si no existe
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        os.makedirs(upload_dir, exist_ok=True)
        
        # Generar nombre único para el archivo
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        unique_filename = f"{timestamp}_{secure_filename(audio_filename)}"
        file_path = os.path.join(upload_dir, unique_filename)
        
        try:
            # Decodificar y guardar el archivo base64
            audio_bytes = base64.b64decode(audio_data)
            with open(file_path, 'wb') as f:
                f.write(audio_bytes)
            
            # Actualizar el mensaje con la ruta del archivo guardado
            chat_message.attachment_path = unique_filename
            db.session.commit()
            
        except Exception as file_error:
            # Continuar sin fallar, el mensaje ya está en la DB
            pass
        
        # Obtener información del remitente
        sender = User.query.get(sender_id)
        sender_name = sender.username if sender else 'Usuario'
        
        # Preparar datos del mensaje para enviar
        message_data = {
            'id': chat_message.id,
            'sender_id': sender_id,
            'sender_name': sender_name,
            'recipient_id': recipient_id,
            'message': '',  # Campo vacío para audio, no '[Audio]'
            'message_type': message_type,
            'audio_data': audio_data,
            'audio_filename': audio_filename,
            'created_at': chat_message.created_at.isoformat(),
            'timestamp': chat_message.created_at.isoformat(),
            'is_read': False
        }
        
        # Enviar mensaje de audio a todas las salas necesarias
        # 1. Al destinatario (usuario normal)
        recipient_room = f"user_chat_{recipient_id}"
        emit('audio_message_received', message_data, room=recipient_room)
        
        # 2. A las salas de admin/soporte para que vean el mensaje
        admin_room = f"admin_chat_{recipient_id}"
        emit('audio_message_received', message_data, room=admin_room)
        emit('audio_message_received', message_data, room="support_room")
        
        # 3. SIEMPRE enviar al remitente para que vea su propio audio
        sender_room = f"user_chat_{sender_id}"
        emit('audio_message_received', message_data, room=sender_room)
        
        # 4. Si el remitente es admin/soporte, también enviar a su sala admin
        if message_type in ['admin', 'support']:
            admin_sender_room = f"admin_chat_{sender_id}"
            emit('audio_message_received', message_data, room=admin_sender_room)
        
        # ✅ NUEVO: Emitir actualización de lista de usuarios para audio
        user_list_data = {
            'user_id': recipient_id if message_type in ['admin', 'support'] else sender_id,
            'action': 'new_message',
            'username': sender_name,
            'message_preview': "[Audio]",
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Emitir actualización de lista a salas de admin/soporte
        for room in ["support_room", "admin_chat_1"]:
            emit('user_list_update', user_list_data, room=room)
        
        # ✅ NUEVO: Emitir cambio de estado del chat para audio
        status_data = {
            'user_id': recipient_id if message_type in ['admin', 'support'] else sender_id,
            'status': 'responded' if message_type in ['admin', 'support'] else 'active',
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Emitir cambio de estado a salas relevantes
        for room in ["support_room", "admin_chat_1"]:
            emit('chat_status_changed', status_data, room=room)
        
        # Confirmar envío de audio al remitente
        sender_room = f"user_chat_{sender_id}"
        emit('audio_message_sent', {
            'status': 'success',
            'message_id': chat_message.id,
            'timestamp': chat_message.created_at.isoformat()
        }, room=sender_room)
        
    except Exception as e:
        emit('error', {'message': 'Error al enviar audio'})

@tienda_socketio.on('start_file_upload')
def handle_start_file_upload(data):
    """Iniciar subida de archivo por chunks"""
    try:
        file_id = data.get('file_id')
        filename = data.get('filename')
        file_type = data.get('file_type')
        file_size = data.get('file_size')
        total_chunks = data.get('total_chunks')
        sender_id = data.get('sender_id')
        recipient_id = data.get('recipient_id')
        message_type = data.get('message_type')
        
        
        # Inicializar almacenamiento de chunks
        file_chunks[file_id] = {
            'filename': filename,
            'file_type': file_type,
            'file_size': file_size,
            'total_chunks': total_chunks,
            'received_chunks': 0,
            'chunks': {},
            'sender_id': sender_id,
            'recipient_id': recipient_id,
            'message_type': message_type
        }
        
        emit('file_upload_started', {'file_id': file_id, 'status': 'ok'})
        
    except Exception as e:
        emit('error', {'message': f'Error iniciando subida: {str(e)}'})

@tienda_socketio.on('file_chunk')
def handle_file_chunk(data):
    """Recibir chunk de archivo"""
    try:
        file_id = data.get('file_id')
        chunk_index = data.get('chunk_index')
        chunk_data = data.get('chunk_data')
        is_last_chunk = data.get('is_last_chunk', False)
        
        if file_id not in file_chunks:
            emit('error', {'message': 'Archivo no encontrado'})
            return
        
        # Almacenar chunk
        file_chunks[file_id]['chunks'][chunk_index] = chunk_data
        file_chunks[file_id]['received_chunks'] += 1
        
        # Si es el último chunk, reconstruir archivo
        if is_last_chunk or file_chunks[file_id]['received_chunks'] >= file_chunks[file_id]['total_chunks']:
            # Reconstruir archivo directamente aquí
            try:
                file_info = file_chunks[file_id]
                
                # Ordenar chunks por índice
                sorted_chunks = []
                for i in range(file_info['total_chunks']):
                    if i in file_info['chunks']:
                        sorted_chunks.append(file_info['chunks'][i])
                    else:
                        return
                
                # Reconstruir archivo
                import base64
                file_data = base64.b64decode(''.join(sorted_chunks))
                
                # Guardar archivo
                import os
                from werkzeug.utils import secure_filename
                
                upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
                os.makedirs(upload_dir, exist_ok=True)
                
                timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
                unique_filename = f"{timestamp}_{secure_filename(file_info['filename'])}"
                file_path = os.path.join(upload_dir, unique_filename)
                
                with open(file_path, 'wb') as f:
                    f.write(file_data)
                
                # Crear mensaje en base de datos
                chat_message = ChatMessage(
                    sender_id=file_info['sender_id'],
                    recipient_id=file_info['recipient_id'],
                    message=f'Archivo: {file_info["filename"]}',
                    message_type=file_info['message_type'],
                    has_attachment=True,
                    attachment_filename=file_info['filename'],
                    attachment_type=file_info['file_type'],
                    attachment_size=file_info['file_size'],
                    attachment_path=unique_filename
                )
                
                db.session.add(chat_message)
                db.session.commit()
                
                # Obtener información del remitente
                sender = User.query.get(file_info['sender_id'])
                sender_name = sender.username if sender else 'Usuario'
                
                # Preparar datos del mensaje para enviar
                message_data = {
                    'id': chat_message.id,
                    'sender_id': file_info['sender_id'],
                    'sender_name': sender_name,
                    'recipient_id': file_info['recipient_id'],
                    'message': chat_message.message,
                    'message_type': file_info['message_type'],
                    'has_attachment': True,
                    'attachment_filename': file_info['filename'],
                    'attachment_type': file_info['file_type'],
                    'attachment_size': file_info['file_size'],
                    'attachment_path': unique_filename,
                    'created_at': chat_message.created_at.isoformat(),
                    'timestamp': chat_message.created_at.isoformat(),
                    'is_temp': False
                }
                
                # Enviar mensaje a las salas correspondientes
                room = f"user_chat_{file_info['recipient_id']}"
                emit('file_message_received', message_data, room=room)
                
                admin_room = f"admin_chat_{file_info['recipient_id']}"
                emit('file_message_received', message_data, room=admin_room)
                emit('file_message_received', message_data, room="support_room")
                
                sender_admin_room = f"admin_chat_{file_info['sender_id']}"
                emit('file_message_received', message_data, room=sender_admin_room)
                
                main_admin_room = "admin_chat_1"
                emit('file_message_received', message_data, room=main_admin_room)
                
                # Confirmar envío
                emit('file_message_sent', {
                    'status': 'success',
                    'data': message_data,
                    'message_id': chat_message.id,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })
                
                # Limpiar chunks
                del file_chunks[file_id]
                
            except Exception as e:
                import traceback
                traceback.print_exc()
                emit('error', {'message': f'Error reconstruyendo archivo: {str(e)}'})
                # Limpiar chunks en caso de error
                if file_id in file_chunks:
                    del file_chunks[file_id]
        
    except Exception as e:
        emit('error', {'message': f'Error recibiendo chunk: {str(e)}'})

@tienda_socketio.on('typing_start')
def handle_typing_start(data):
    """Usuario comenzó a escribir"""
    try:
        user_id = data.get('user_id')
        username = data.get('username')
        recipient_id = data.get('recipient_id')
        is_support = data.get('is_support', False)
        
        
        if not user_id or not username:
            return
        
        # ✅ NUEVO: Solo emitir evento de escritura si NO es admin o soporte
        if is_support:
            return
        
        # Emitir evento de escritura SOLO a la sala específica del destinatario
        emit('user_typing', {
            'user_id': user_id,
            'username': username,
            'typing': True,
            'timestamp': datetime.utcnow().isoformat()
        }, room=f"user_chat_{recipient_id}")
        
        # También emitir a las salas de admin/soporte para que vean el indicador
        emit('user_typing', {
            'user_id': user_id,
            'username': username,
            'typing': True,
            'timestamp': datetime.utcnow().isoformat()
        }, room="support_room")
        
        emit('user_typing', {
            'user_id': user_id,
            'username': username,
            'typing': True,
            'timestamp': datetime.utcnow().isoformat()
        }, room="admin_chat_1")
        
    except Exception as e:
        pass

@tienda_socketio.on('typing_stop')
def handle_typing_stop(data):
    """Usuario dejó de escribir"""
    try:
        user_id = data.get('user_id')
        username = data.get('username')
        recipient_id = data.get('recipient_id')
        is_support = data.get('is_support', False)
        
        
        if not user_id or not username:
            return
        
        # ✅ NUEVO: Solo emitir evento de escritura si NO es admin o soporte
        if is_support:
            return
        
        # Emitir evento de escritura SOLO a la sala específica del destinatario
        emit('user_typing', {
            'user_id': user_id,
            'username': username,
            'typing': False,
            'timestamp': datetime.utcnow().isoformat()
        }, room=f"user_chat_{recipient_id}")
        
        # También emitir a las salas de admin/soporte para que vean el indicador
        emit('user_typing', {
            'user_id': user_id,
            'username': username,
            'typing': False,
            'timestamp': datetime.utcnow().isoformat()
        }, room="support_room")
        
        emit('user_typing', {
            'user_id': user_id,
            'username': username,
            'typing': False,
            'timestamp': datetime.utcnow().isoformat()
        }, room="admin_chat_1")
        
    except Exception as e:
        pass

@tienda_socketio.on('update_chat_status')
def handle_update_chat_status(data):
    """Actualizar estado del chat y notificar a todos los clientes"""
    try:
        user_id = data.get('user_id')
        status = data.get('status')
        
        if not user_id or not status:
            emit('error', {'message': 'Datos de estado incompletos'})
            return
        
        # Emitir a todos los clientes conectados
        tienda_socketio.emit('chat_status_changed', {
            'user_id': user_id,
            'status': status
        })
        
        # Confirmar actualización
        emit('chat_status_updated', {'status': 'success'})
        
    except Exception as e:
        emit('error', {'message': f'Error actualizando estado: {str(e)}'})

@tienda_socketio.on('finalize_chat')
def handle_finalize_chat(data):
    """Finalizar chat y notificar a todos los clientes"""
    try:
        user_id = data.get('user_id')
        admin_id = data.get('admin_id')
        
        if not user_id or not admin_id:
            emit('error', {'message': 'Datos de finalización incompletos'})
            return
        
        # Crear mensaje del sistema en la base de datos
        system_message = ChatMessage(
            sender_id='system',
            recipient_id=user_id,
            message='Chat finalizado, gracias por contactarnos',
            message_type='system',
            has_attachment=False
        )
        
        db.session.add(system_message)
        db.session.commit()
        
        # Emitir a todos los clientes conectados
        tienda_socketio.emit('chat_finalized', {
            'user_id': user_id,
            'admin_id': admin_id,
            'status': 'finished',
            'message_id': system_message.id
        })
        
        # ✅ NUEVO: Emitir cambio de estado para actualizar colores en tiempo real
        tienda_socketio.emit('chat_status_changed', {
            'user_id': user_id,
            'status': 'finished'
        })
        
                # Confirmar finalización
        emit('chat_finalized', {'status': 'success'})
        
    except Exception as e:
        emit('error', {'message': f'Error finalizando chat: {str(e)}'})


# ✅ NUEVO: Función para emitir evento de chat eliminado
def emit_chat_deleted_event(user_id, username, messages_deleted=0, sessions_deleted=0, files_deleted=0):
    """Función para emitir evento de chat eliminado a todos los usuarios conectados"""
    try:
        # Emitir evento a todas las salas relevantes
        event_data = {
            'user_id': user_id,
            'username': username,
            'messages_deleted': messages_deleted,
            'sessions_deleted': sessions_deleted,
            'files_deleted': files_deleted,
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        # Emitir a la sala de soporte (admin)
        tienda_socketio.emit('chat_deleted', event_data, room='support_room')
        
        # Emitir a la sala del admin específico
        tienda_socketio.emit('chat_deleted', event_data, room='admin_chat_1')
        
        # Emitir a la sala del usuario si está conectado
        tienda_socketio.emit('chat_deleted', event_data, room=f'user_chat_{user_id}')
        
        # ✅ NUEVO: También emitir evento user_list_update para actualizar la lista
        user_list_data = {
            'user_id': user_id,
            'action': 'chat_deleted',
            'username': username
        }
        
        # Emitir user_list_update a las mismas salas
        tienda_socketio.emit('user_list_update', user_list_data, room='support_room')
        tienda_socketio.emit('user_list_update', user_list_data, room='admin_chat_1')
        tienda_socketio.emit('user_list_update', user_list_data, room=f'user_chat_{user_id}')
        
        return True
        
    except Exception as e:
        return False
