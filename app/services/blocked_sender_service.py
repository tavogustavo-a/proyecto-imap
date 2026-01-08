#!/usr/bin/env python3
"""
Servicio para gestionar remitentes bloqueados
"""

def is_sender_blocked(from_email):
    """
    Verifica si un remitente está bloqueado
    Retorna True si está bloqueado, False si no
    """
    try:
        # Intentar usar SQLAlchemy primero
        from app.models.email_buzon import BlockedSender
        
        # Obtener todos los remitentes bloqueados activos
        blocked_senders = BlockedSender.query.filter_by(enabled=True).all()
        
        # Verificar si alguno coincide con el email
        for blocked in blocked_senders:
            if blocked.matches_email(from_email):
                print(f"🚫 Email bloqueado: {from_email} (coincide con {blocked.get_display_name()})")
                return True
        
        return False
        
    except Exception as e:
        print(f"❌ Error verificando remitente bloqueado: {e}")
        return False

def get_all_blocked_senders():
    """
    Obtiene todos los remitentes bloqueados
    """
    try:
        from app.models.email_buzon import BlockedSender
        
        blocked_senders = BlockedSender.query.order_by(BlockedSender.created_at.desc()).all()
        print(f"📋 Obtenidos {len(blocked_senders)} remitentes bloqueados")
        return blocked_senders
        
    except Exception as e:
        print(f"⚠️ Error obteniendo remitentes bloqueados: {e}")
        return []

def create_blocked_sender(sender_email=None, sender_domain=None):
    """
    Crea un nuevo remitente bloqueado
    """
    try:
        from app.models.email_buzon import BlockedSender
        from app.extensions import db
        
        # Validar que al menos uno esté presente
        if not sender_email and not sender_domain:
            raise ValueError("Debe especificar al menos un email o dominio")
        
        # Limpiar datos
        if sender_email:
            sender_email = sender_email.strip().lower()
        if sender_domain:
            sender_domain = sender_domain.strip().lower()
            # Quitar @ si está presente
            if sender_domain.startswith('@'):
                sender_domain = sender_domain[1:]
        
        # Crear el registro
        blocked_sender = BlockedSender(
            sender_email=sender_email,
            sender_domain=sender_domain,
            enabled=True
        )
        
        db.session.add(blocked_sender)
        db.session.commit()
        
        # Refrescar cache SMTP
        try:
            pass
        except ImportError:
            pass  # El servicio SMTP puede no estar disponible
        
        print(f"✅ Remitente bloqueado creado: {blocked_sender.get_display_name()}")
        return blocked_sender
        
    except Exception as e:
        print(f"❌ Error creando remitente bloqueado: {e}")
        from app.extensions import db
        db.session.rollback()
        raise e

def update_blocked_sender(sender_id, sender_email=None, sender_domain=None):
    """Actualiza un remitente bloqueado"""
    try:
        from app.models.email_buzon import BlockedSender
        from app.extensions import db
        
        blocked_sender = BlockedSender.query.get_or_404(sender_id)
        
        # Limpiar datos
        if sender_email:
            sender_email = sender_email.strip().lower()
        if sender_domain:
            sender_domain = sender_domain.strip().lower()
            # Quitar @ si está presente
            if sender_domain.startswith('@'):
                sender_domain = sender_domain[1:]
        
        # Actualizar campos
        blocked_sender.sender_email = sender_email if sender_email else None
        blocked_sender.sender_domain = sender_domain if sender_domain else None
        
        db.session.commit()
        
        # Refrescar cache SMTP
        try:
            pass
        except ImportError:
            pass
        
        print(f"✅ Remitente bloqueado actualizado: {blocked_sender.get_display_name()}")
        return blocked_sender
        
    except Exception as e:
        print(f"❌ Error actualizando remitente bloqueado: {e}")
        from app.extensions import db
        db.session.rollback()
        raise e

def delete_blocked_sender(sender_id):
    """Elimina un remitente bloqueado"""
    try:
        from app.models.email_buzon import BlockedSender
        from app.extensions import db
        
        blocked_sender = BlockedSender.query.get_or_404(sender_id)
        display_name = blocked_sender.get_display_name()
        
        db.session.delete(blocked_sender)
        db.session.commit()
        
        # Refrescar cache SMTP
        try:
            pass
        except ImportError:
            pass
        
        print(f"🗑️ Remitente bloqueado eliminado: {display_name}")
        return True
        
    except Exception as e:
        print(f"❌ Error eliminando remitente bloqueado: {e}")
        from app.extensions import db
        db.session.rollback()
        raise e

def toggle_blocked_sender_status(sender_id):
    """Cambia el estado activo/inactivo de un remitente bloqueado"""
    try:
        from app.models.email_buzon import BlockedSender
        from app.extensions import db
        
        blocked_sender = BlockedSender.query.get_or_404(sender_id)
        blocked_sender.enabled = not blocked_sender.enabled
        
        db.session.commit()
        
        # Refrescar cache SMTP
        try:
            pass
        except ImportError:
            pass
        
        status = "activado" if blocked_sender.enabled else "desactivado"
        print(f"🔄 Remitente bloqueado {status}: {blocked_sender.get_display_name()}")
        
        return blocked_sender
        
    except Exception as e:
        print(f"❌ Error cambiando estado del remitente bloqueado: {e}")
        from app.extensions import db
        db.session.rollback()
        raise e
