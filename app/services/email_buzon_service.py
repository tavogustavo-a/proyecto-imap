# app/services/email_buzon_service.py

from app.extensions import db
from app.models import EmailBuzonServer, ReceivedEmail
from app.imap.parser import parse_raw_email
# Importación de auto_tag_email se hace dentro de la función para evitar importaciones circulares
from datetime import datetime, timedelta

def create_buzon_server(domain, smtp_port=25, max_emails_per_second=300):
    """Crea un nuevo servidor de buzón SMTP"""
    buzon_server = EmailBuzonServer(
        domain=domain,
        smtp_port=smtp_port,
        max_emails_per_second=max_emails_per_second,
        enabled=True
    )
    db.session.add(buzon_server)
    db.session.commit()
    return buzon_server

def update_buzon_server(server_id, domain, smtp_port=25, max_emails_per_second=300, enabled=True):
    """Actualiza un servidor de buzón SMTP"""
    buzon_server = EmailBuzonServer.query.get_or_404(server_id)
    
    buzon_server.domain = domain
    buzon_server.smtp_port = smtp_port
    buzon_server.max_emails_per_second = max_emails_per_second
    buzon_server.enabled = enabled
    buzon_server.updated_at = datetime.utcnow()
    
    db.session.commit()
    return buzon_server

def delete_buzon_server(server_id):
    """Elimina un servidor de buzón de mensajes"""
    buzon_server = EmailBuzonServer.query.get_or_404(server_id)
    db.session.delete(buzon_server)
    db.session.commit()
    return True

def get_all_buzon_servers():
    """Obtiene todos los servidores de buzón de mensajes"""
    return EmailBuzonServer.query.all()

def get_enabled_buzon_servers():
    """Obtiene solo los servidores de buzón habilitados"""
    return EmailBuzonServer.query.filter(EmailBuzonServer.enabled == True).all()

def should_email_go_to_trash(email_data):
    """Verifica si un email debe ir directo a papelera (sin guardarse en BD)"""
    try:
        from app.models.email_buzon import EmailFilter
        
        # Obtener filtros activos de papelera (tag_id = -1)
        trash_filters = EmailFilter.query.filter_by(enabled=True, tag_id=-1).all()
        
        for email_filter in trash_filters:
            # Crear objeto temporal para verificar coincidencias
            temp_email = type('TempEmail', (), {
                'from_email': email_data.get('from', ''),
                'to_email': email_data.get('to', ''),
                'subject': email_data.get('subject', ''),
                'content_text': email_data.get('body', email_data.get('text', '')),
                'content_html': email_data.get('html', '')
            })()
            
            if email_filter.matches_email(temp_email):
                print(f"🗑️ Email rechazado - coincide con filtro de papelera: {email_filter.name}")
                return True
        
        return False
        
    except Exception as e:
        print(f"❌ Error verificando filtros de papelera: {e}")
        return False

def process_incoming_email(raw_email_data, buzon_server_id=None):
    """Procesa un email recibido y lo almacena en la base de datos"""
    try:
        # Parsear el email usando el parser existente
        parsed_email = parse_raw_email(raw_email_data)
        from_email = parsed_email.get('from', '')
        
        # 🚫 VERIFICAR REMITENTES BLOQUEADOS ANTES DE GUARDAR
        from app.services.blocked_sender_service import is_sender_blocked
        if is_sender_blocked(from_email):
            print(f"🚫 Email rechazado - remitente bloqueado: {from_email}")
            return None  # No guardar en la base de datos
        
        # 🗑️ VERIFICAR FILTROS DE PAPELERA ANTES DE GUARDAR
        if should_email_go_to_trash(parsed_email):
            print(f"🗑️ Email rechazado - filtro de papelera: {from_email}")
            return None  # No guardar en la base de datos
        
        # Crear registro en la base de datos
        received_email = ReceivedEmail(
            from_email=from_email,
            to_email=parsed_email.get('to', ''),
            subject=parsed_email.get('subject', ''),
            content_text=parsed_email.get('text', ''),
            content_html=parsed_email.get('html', ''),
            message_id=parsed_email.get('message_id', ''),
            buzon_server_id=buzon_server_id,
            processed=False
        )
        
        db.session.add(received_email)
        db.session.commit()
        
        # Aplicar solo filtros manuales configurados por el usuario
        from app.services.email_filter_service import auto_tag_email
        auto_tag_email(received_email)
        
        print(f"✅ Email procesado y guardado: {from_email} -> {parsed_email.get('to', '')}")
        return received_email
        
    except Exception as e:
        print(f"Error procesando email: {e}")
        return None

def process_smtp_email(email_data):
    """
    Procesa un email recibido desde servidor SMTP
    
    Args:
        email_data (dict): Datos del email desde SMTP
            - from: Email del remitente
            - to: Email del destinatario  
            - subject: Asunto del email
            - body: Contenido en texto plano
            - html: Contenido HTML (opcional)
            - message_id: ID del mensaje (opcional)
    
    Returns:
        ReceivedEmail: Objeto del email guardado o None si falló
    """
    try:
        from_email = email_data.get('from', '')
        to_email = email_data.get('to', '')
        
        # 📧 VERIFICAR QUE EL EMAIL DE DESTINO ESTÉ CONFIGURADO Y ACTIVO
        from app.models.email_forwarding import EmailForwarding
        
        # Buscar si el email de destino está configurado en "Correo Electrónico vía Dominio"
        configured_forwarding = EmailForwarding.query.filter_by(
            source_email=to_email,
            enabled=True
        ).first()
        
        # También verificar catch-all (source_email=None) si no hay configuración específica
        if not configured_forwarding:
            catch_all_forwarding = EmailForwarding.query.filter_by(
                source_email=None,
                enabled=True
            ).first()
            
            if catch_all_forwarding:
                configured_forwarding = catch_all_forwarding
        
        # Si no hay configuración válida, rechazar el email
        if not configured_forwarding:
            print(f"📧 Email rechazado - destinatario no configurado o desactivado: {to_email}")
            return None  # No guardar en la base de datos
        
        print(f"✅ Email de destino validado: {to_email} (configurado y activo)")
        
        # 🚫 VERIFICAR REMITENTES BLOQUEADOS ANTES DE GUARDAR
        from app.services.blocked_sender_service import is_sender_blocked
        if is_sender_blocked(from_email):
            print(f"🚫 Email rechazado - remitente bloqueado: {from_email}")
            return None  # No guardar en la base de datos
        
        # 🗑️ VERIFICAR FILTROS DE PAPELERA ANTES DE GUARDAR
        if should_email_go_to_trash(email_data):
            print(f"🗑️ Email rechazado - filtro de papelera: {from_email}")
            return None  # No guardar en la base de datos
        
        # Crear registro directamente desde datos del SMTP
        received_email = ReceivedEmail(
            from_email=from_email,
            to_email=to_email,
            subject=email_data.get('subject', ''),
            content_text=email_data.get('body', email_data.get('text', '')),
            content_html=email_data.get('html', ''),
            message_id=email_data.get('message_id', f"smtp-{hash(str(email_data))}"),
            processed=False
        )
        
        db.session.add(received_email)
        db.session.commit()
        
        # Aplicar solo filtros manuales configurados por el usuario
        from app.services.email_filter_service import auto_tag_email
        auto_tag_email(received_email)
        
        print(f"✅ Email SMTP procesado: {from_email} -> {to_email}")
        return received_email
        
    except Exception as e:
        print(f"❌ Error procesando email desde SMTP: {e}")
        return None


def get_received_emails(limit=100, processed=None, tag_id=None):
    """Obtiene emails recibidos con filtros opcionales"""
    query = ReceivedEmail.query
    
    if processed is not None:
        query = query.filter(ReceivedEmail.processed == processed)
    
    if tag_id:
        query = query.join(ReceivedEmail.tags).filter(ReceivedEmail.tags.any(id=tag_id))
    
    return query.order_by(ReceivedEmail.received_at.desc()).limit(limit).all()

def mark_email_as_processed(email_id):
    """Marca un email como procesado"""
    email = ReceivedEmail.query.get_or_404(email_id)
    email.processed = True
    db.session.commit()
    return email

def get_recent_emails(limit=50):
    """Obtiene los emails más recientes (excluyendo eliminados Y sin etiquetas)"""
    # Solo emails que NO están eliminados Y NO tienen etiquetas asignadas
    emails = ReceivedEmail.query.filter(
        ReceivedEmail.deleted == False,
        ~ReceivedEmail.tags.any()  # No tiene ninguna etiqueta
    ).order_by(ReceivedEmail.received_at.desc()).limit(limit).all()
    
    print(f"[INBOX] 📥 Encontrados {len(emails)} emails sin etiquetas para 'Recibidos'")
    for email in emails[:3]:  # Solo mostrar los primeros 3
        tag_names = [tag.name for tag in email.tags]
        print(f"[INBOX] Email ID {email.id}: '{email.subject[:30]}...' - Etiquetas: {tag_names}")
    
    return emails

def mark_email_processed(email_id):
    """Marca un email como procesado (alias para compatibilidad)"""
    return mark_email_as_processed(email_id)

def move_email_to_trash(email_id):
    """Mueve un email a la papelera"""
    email = ReceivedEmail.query.get_or_404(email_id)
    email.deleted = True
    email.deleted_at = datetime.utcnow()
    db.session.commit()
    return email

def restore_email_from_trash(email_id):
    """Restaura un email desde la papelera"""
    email = ReceivedEmail.query.get_or_404(email_id)
    email.deleted = False
    email.deleted_at = None
    db.session.commit()
    return email

def get_trash_emails(limit=50):
    """Obtiene emails en la papelera"""
    return ReceivedEmail.query.filter(ReceivedEmail.deleted == True).order_by(ReceivedEmail.deleted_at.desc()).limit(limit).all()

def permanently_delete_email(email_id):
    """Elimina permanentemente un email de la base de datos"""
    email = ReceivedEmail.query.get_or_404(email_id)
    db.session.delete(email)
    db.session.commit()
    return True

def cleanup_old_trash_emails(days=30):
    """Elimina permanentemente emails en papelera más antiguos que X días"""
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    old_trash_emails = ReceivedEmail.query.filter(
        ReceivedEmail.deleted == True,
        ReceivedEmail.deleted_at < cutoff_date
    ).all()
    
    count = 0
    for email in old_trash_emails:
        db.session.delete(email)
        count += 1
    
    db.session.commit()
    return count

def cleanup_all_trash_emails():
    """Elimina permanentemente TODOS los emails en papelera"""
    all_trash_emails = ReceivedEmail.query.filter(
        ReceivedEmail.deleted == True
    ).all()
    
    print(f"[CLEANUP] Encontrados {len(all_trash_emails)} emails en papelera para eliminar permanentemente")
    
    count = 0
    for email in all_trash_emails:
        print(f"[CLEANUP] Eliminando permanentemente email ID {email.id}: {email.subject[:50]}...")
        db.session.delete(email)
        count += 1
    
    db.session.commit()
    print(f"[CLEANUP] ✅ Eliminados permanentemente {count} emails de la base de datos")
    return count
