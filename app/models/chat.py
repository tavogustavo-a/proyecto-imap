# app/models/chat.py

from datetime import datetime, timedelta
from app.extensions import db
from app.models.user import User

class ChatMessage(db.Model):
    __tablename__ = "chat_messages"
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Usuario que envía el mensaje (puede ser usuario, sub-usuario, soporte o admin)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    
    # Usuario que recibe el mensaje (siempre será el usuario principal o sub-usuario)
    recipient_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    
    # Contenido del mensaje
    message = db.Column(db.Text, nullable=False)
    
    # Tipo de mensaje: 'user', 'support', 'admin'
    message_type = db.Column(db.String(10), nullable=False, default='user')
    
    # Campos para archivos multimedia
    has_attachment = db.Column(db.Boolean, default=False)
    attachment_type = db.Column(db.String(20), nullable=True)  # 'image', 'video'
    attachment_filename = db.Column(db.String(255), nullable=True)
    attachment_path = db.Column(db.String(500), nullable=True)
    attachment_size = db.Column(db.Integer, nullable=True)  # en bytes
    
    # Si el mensaje ha sido leído
    is_read = db.Column(db.Boolean, default=False)
    
    # Timestamp del mensaje
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relaciones
    sender = db.relationship('User', foreign_keys=[sender_id], backref='sent_messages')
    recipient = db.relationship('User', foreign_keys=[recipient_id], backref='received_messages')
    
    def __repr__(self):
        return f'<ChatMessage {self.id}: {self.sender_id} -> {self.recipient_id}>'
    
    def to_dict(self):
        """Convertir mensaje a diccionario para JSON"""
        result = {
            'id': self.id,
            'sender_id': self.sender_id,
            'sender_name': self.get_sender_display_name(),
            'recipient_id': self.recipient_id,
            'message': self.message,
            'message_type': self.message_type,
            'has_attachment': self.has_attachment,
            'attachment_type': self.attachment_type,
            'attachment_filename': self.attachment_filename,
            'attachment_path': self.attachment_path,
            'attachment_size': self.attachment_size,
            'is_read': self.is_read,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
        
        # ✅ NUEVO: Si es un mensaje de audio, incluir el contenido del archivo
        if self.has_attachment and self.attachment_type == 'audio' and self.attachment_path:
            try:
                import os
                import base64
                from flask import current_app
                
                # Construir ruta completa del archivo
                upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
                file_path = os.path.join(upload_dir, self.attachment_path)
                
                # Verificar que el archivo existe
                if os.path.exists(file_path) and os.path.isfile(file_path):
                    # Leer archivo y convertir a base64
                    with open(file_path, 'rb') as f:
                        audio_bytes = f.read()
                        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                        
                        # Determinar el tipo MIME basado en la extensión
                        file_extension = os.path.splitext(self.attachment_path)[1].lower()
                        if file_extension == '.webm':
                            mime_type = 'audio/webm'
                        elif file_extension == '.mp4':
                            mime_type = 'audio/mp4'
                        elif file_extension == '.ogg':
                            mime_type = 'audio/ogg'
                        else:
                            mime_type = 'audio/wav'
                        
                        # Agregar datos de audio al resultado
                        result['audio_data'] = f"data:{mime_type};base64,{audio_base64}"
                        result['audio_filename'] = self.attachment_filename
                        
            except Exception as e:
                # Si hay error leyendo el archivo, continuar sin audio_data
                pass
        
        return result
    
    def get_sender_display_name(self):
        """Obtener el nombre de visualización del remitente"""
        if self.message_type == 'admin':
            return 'Admin'
        elif self.message_type == 'support':
            # Para soporte, mostrar el username real del usuario
            return self.sender.username if self.sender else 'Usuario'
        else:
            # Para usuarios normales, mostrar su username
            return self.sender.username if self.sender else 'Usuario'
    
    @classmethod
    def get_conversation(cls, user_id, limit=50):
        """Obtener conversación de un usuario (mensajes enviados y recibidos)"""
        return cls.query.filter(
            db.or_(
                cls.sender_id == user_id,
                cls.recipient_id == user_id
            )
        ).order_by(cls.created_at.desc()).limit(limit).all()
    
    @classmethod
    def get_all_conversations_for_support(cls, limit=100):
        """Obtener todas las conversaciones para soporte/admin"""
        return cls.query.order_by(cls.created_at.desc()).limit(limit).all()
    
    @classmethod
    def get_unread_count(cls, user_id):
        """Obtener cantidad de mensajes no leídos para un usuario"""
        return cls.query.filter_by(recipient_id=user_id, is_read=False).count()
    
    @classmethod
    def get_unread_count_for_admin(cls, user_id):
        """Obtener cantidad de mensajes no leídos para un usuario desde la perspectiva del admin"""
        # Para el admin, "no leído" significa:
        # 1. Mensajes que el usuario envió AL admin y que el admin aún no ha leído
        # 2. Mensajes que el admin envió AL usuario y que el usuario aún no ha leído
        # Ambos casos indican actividad pendiente en la conversación
        from app.models.user import User
        admin_user = User.query.filter_by(username='admin').first()
        if not admin_user:
            return 0
            
        # Contar mensajes enviados POR el usuario AL admin que no han sido leídos
        unread_from_user = cls.query.filter_by(
            sender_id=user_id,
            recipient_id=admin_user.id,
            is_read=False
        ).count()
        
        # También contar mensajes enviados POR el admin AL usuario que el usuario no ha leído
        # (esto indica que el admin respondió pero el usuario no ha visto la respuesta)
        unread_to_user = cls.query.filter_by(
            sender_id=admin_user.id,
            recipient_id=user_id,
            is_read=False
        ).count()
        
        # Si hay mensajes del usuario al admin sin leer, o si el admin respondió pero el usuario no vio,
        # entonces hay actividad pendiente
        return unread_from_user + unread_to_user
    
    @classmethod
    def mark_as_read(cls, user_id, sender_id=None):
        """Marcar mensajes como leídos"""
        query = cls.query.filter_by(recipient_id=user_id, is_read=False)
        if sender_id:
            query = query.filter_by(sender_id=sender_id)
        query.update({'is_read': True})
        db.session.commit()
    
    @classmethod
    def mark_as_read_for_admin(cls, user_id):
        """Marcar mensajes como leídos desde la perspectiva del admin"""
        from app.models.user import User
        admin_user = User.query.filter_by(username='admin').first()
        if not admin_user:
            return
            
        # Marcar como leídos los mensajes enviados POR el usuario AL admin
        cls.query.filter_by(
            sender_id=user_id,
            recipient_id=admin_user.id,
            is_read=False
        ).update({'is_read': True})
        
        # También marcar como leídos los mensajes enviados POR el admin AL usuario
        # (esto indica que el admin ya vio la conversación)
        cls.query.filter_by(
            sender_id=admin_user.id,
            recipient_id=user_id,
            is_read=False
        ).update({'is_read': True})
        
        db.session.commit()
    
    @classmethod
    def cleanup_old_messages(cls, days=7):
        """Limpiar mensajes antiguos (más de X días) y archivos huérfanos"""
        from flask import current_app
        
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        # ⭐ NUEVO: También limpiar mensajes de usuarios que ahora son de soporte
        from app.models.user import User
        support_users = User.query.filter_by(is_support=True).all()
        support_user_ids = [user.id for user in support_users]
        
        # Obtener mensajes con archivos antes de eliminarlos (incluyendo usuarios de soporte)
        messages_with_files = cls.query.filter(
            db.or_(
                cls.created_at < cutoff_date,
                cls.sender_id.in_(support_user_ids),
                cls.recipient_id.in_(support_user_ids)
            ),
            cls.has_attachment == True
        ).all()
        
        # Eliminar archivos físicos del servidor
        files_deleted = 0
        if messages_with_files:
            import os
            from flask import current_app
            
            upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
            if os.path.exists(upload_dir) and os.path.isdir(upload_dir):
                for message in messages_with_files:
                    # Eliminar por attachment_path
                    if message.attachment_path:
                        file_path = os.path.join(upload_dir, message.attachment_path)
                        try:
                            if os.path.exists(file_path):
                                os.remove(file_path)
                                files_deleted += 1
                        except Exception:
                            pass
                    
                    # Eliminar por attachment_filename (por si acaso)
                    if message.attachment_filename and message.attachment_filename != message.attachment_path:
                        file_path = os.path.join(upload_dir, message.attachment_filename)
                        try:
                            if os.path.exists(file_path):
                                os.remove(file_path)
                                files_deleted += 1
                        except Exception:
                            pass
        
        # Eliminar mensajes de la base de datos (incluyendo usuarios de soporte)
        deleted_count = cls.query.filter(
            db.or_(
                cls.created_at < cutoff_date,
                cls.sender_id.in_(support_user_ids),
                cls.recipient_id.in_(support_user_ids)
            )
        ).delete()
        
        # ⭐ NUEVO: También eliminar sesiones de chat de usuarios de soporte
        from app.models.chat import ChatSession
        sessions_deleted = 0
        if support_user_ids:
            sessions_deleted = ChatSession.query.filter(
                ChatSession.user_id.in_(support_user_ids)
            ).delete()
        
        db.session.commit()
        
        # Limpiar archivos huérfanos después de eliminar mensajes
        orphaned_files_deleted = 0
        if messages_with_files or deleted_count > 0:  # Si se eliminaron mensajes o archivos
            import os
            from flask import current_app
            
            upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
            if os.path.exists(upload_dir) and os.path.isdir(upload_dir):
                # Verificar archivos huérfanos
                for filename in os.listdir(upload_dir):
                    file_path = os.path.join(upload_dir, filename)
                    
                    # Verificar si es un archivo válido
                    if not os.path.isfile(file_path):
                        continue
                    
                    # Verificar si el archivo pertenece a algún mensaje existente
                    existing_message = cls.query.filter_by(attachment_path=filename).first()
                    if not existing_message:
                        try:
                            os.remove(file_path)
                            orphaned_files_deleted += 1
                        except Exception:
                            pass
                
                # Limpiar archivos temporales y caché
                temp_files = 0
                for filename in os.listdir(upload_dir):
                    if filename.startswith('temp_') or filename.startswith('cache_') or filename.endswith('.tmp'):
                        file_path = os.path.join(upload_dir, filename)
                        try:
                            if os.path.isfile(file_path):
                                os.remove(file_path)
                                temp_files += 1
                        except Exception:
                            pass
                
                orphaned_files_deleted += temp_files
        

        
        # Retornar diccionario con información detallada
        return {
            'messages_deleted': deleted_count,
            'sessions_deleted': sessions_deleted,
            'files_deleted': files_deleted,
            'orphaned_files_deleted': orphaned_files_deleted,
            'support_users_cleaned': len(support_user_ids)
        }
    
    @classmethod
    def cleanup_all_messages(cls):
        """Limpiar TODOS los mensajes del chat (función agresiva)"""
        from flask import current_app
        import os
        
        # Obtener TODOS los mensajes con archivos antes de eliminarlos
        all_messages_with_files = cls.query.filter(cls.has_attachment == True).all()
        
        # Definir directorio de uploads
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        
        # Eliminar TODOS los archivos físicos del servidor
        files_deleted = 0
        if all_messages_with_files and os.path.exists(upload_dir):
            for message in all_messages_with_files:
                # Eliminar por attachment_path
                if message.attachment_path:
                    file_path = os.path.join(upload_dir, message.attachment_path)
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            files_deleted += 1
                    except Exception:
                        pass
                
                # Eliminar por attachment_filename (por si acaso)
                if message.attachment_filename and message.attachment_filename != message.attachment_path:
                    file_path = os.path.join(upload_dir, message.attachment_filename)
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            files_deleted += 1
                    except Exception:
                        pass
        
        # Eliminar TODOS los mensajes de la base de datos
        deleted_count = cls.query.delete()
        
        # Eliminar TODAS las sesiones de chat
        from app.models.chat import ChatSession
        sessions_deleted = ChatSession.query.delete()
        
        db.session.commit()
        
        # Limpiar TODOS los archivos restantes del directorio (archivos huérfanos)
        orphaned_files_deleted = 0
        if os.path.exists(upload_dir) and os.path.isdir(upload_dir):
            try:
                # Obtener lista de archivos
                remaining_files = os.listdir(upload_dir)
                
                # Eliminar TODOS los archivos restantes
                for filename in remaining_files:
                    file_path = os.path.join(upload_dir, filename)
                    try:
                        if os.path.isfile(file_path):
                            os.remove(file_path)
                            orphaned_files_deleted += 1
                    except Exception:
                        pass
                        
            except Exception:
                pass
        
        # Retornar diccionario con información detallada
        return {
            'messages_deleted': deleted_count,
            'sessions_deleted': sessions_deleted,
            'files_deleted': files_deleted,
            'orphaned_files_deleted': orphaned_files_deleted,
            'total_cleaned': deleted_count + sessions_deleted + files_deleted + orphaned_files_deleted
        }
    
    @classmethod
    def cleanup_orphaned_files(cls):
        """Limpiar solo archivos huérfanos (archivos sin mensaje asociado)"""
        from flask import current_app
        import os
        
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        orphaned_files_deleted = 0
        
        if os.path.exists(upload_dir) and os.path.isdir(upload_dir):
            try:
                # Obtener todos los archivos en el directorio
                all_files = os.listdir(upload_dir)
                
                for filename in all_files:
                    file_path = os.path.join(upload_dir, filename)
                    
                    # Verificar si es un archivo válido
                    if not os.path.isfile(file_path):
                        continue
                    
                    # Verificar si el archivo pertenece a algún mensaje existente
                    existing_message = cls.query.filter(
                        db.or_(
                            cls.attachment_path == filename,
                            cls.attachment_filename == filename
                        )
                    ).first()
                    
                    if not existing_message:
                        try:
                            os.remove(file_path)
                            orphaned_files_deleted += 1
                        except Exception:
                            pass
                            
            except Exception:
                pass
        
        return {
            'orphaned_files_deleted': orphaned_files_deleted
        }

class ChatSession(db.Model):
    __tablename__ = "chat_sessions"
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Usuario principal de la conversación
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    
    # Estado de la sesión: 'active', 'closed', 'finished', 'responded', 'new_message'
    # - 'active': Sesión activa (por defecto)
    # - 'closed': Sesión cerrada
    # - 'finished': Chat finalizado (morado)
    # - 'responded': Admin/soporte respondió (azul)
    # - 'new_message': Usuario escribió (verde)
    status = db.Column(db.String(20), default='active')
    
    # Timestamp de creación y última actividad
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_activity = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relación
    user = db.relationship('User', backref='chat_sessions')
    
    def __repr__(self):
        return f'<ChatSession {self.id}: User {self.user_id} - {self.status}>'
    
    def to_dict(self):
        """Convertir sesión a diccionario para JSON"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'username': self.user.username if self.user else 'Usuario',
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_activity': self.last_activity.isoformat() if self.last_activity else None
        }
    
    @classmethod
    def get_active_sessions(cls):
        """Obtener todas las sesiones activas"""
        return cls.query.filter_by(status='active').order_by(cls.last_activity.desc()).all()
    
    @classmethod
    def get_or_create_session(cls, user_id):
        """Obtener sesión activa o crear una nueva"""
        session = cls.query.filter_by(user_id=user_id, status='active').first()
        if not session:
            session = cls(user_id=user_id)
            db.session.add(session)
            db.session.commit()
        return session
    
    def update_activity(self):
        """Actualizar timestamp de última actividad"""
        self.last_activity = datetime.utcnow()
        db.session.commit()
    
    def close_session(self):
        """Cerrar la sesión de chat"""
        self.status = 'closed'
        self.last_activity = datetime.utcnow()
        db.session.commit()
    
    def update_chat_status(self, new_status):
        """Actualizar el estado del chat (finished, responded, new_message)"""
        self.status = new_status
        self.last_activity = datetime.utcnow()
        db.session.commit()
    
    @classmethod
    def get_chat_status(cls, user_id):
        """Obtener el estado actual del chat para un usuario"""
        session = cls.query.filter_by(user_id=user_id, status='active').first()
        if session:
            return session.status
        return 'active'  # Por defecto
