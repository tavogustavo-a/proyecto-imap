# app/services/email_filter_service.py

try:
    from app.extensions import db
    from app.models.email_buzon import EmailFilter, EmailTag, ReceivedEmail
    from sqlalchemy.exc import IntegrityError
    from datetime import datetime
    MODELS_AVAILABLE = True
except ImportError as e:
    print(f"⚠️ WARNING: No se pudieron importar los modelos: {e}")
    MODELS_AVAILABLE = False

def get_all_filters():
    """Obtiene todos los filtros ordenados por prioridad"""
    if not MODELS_AVAILABLE:
        print("⚠️ WARNING: Modelos no disponibles, retornando lista vacía")
        return []
    
    try:
        return EmailFilter.query.join(EmailTag).order_by(EmailFilter.priority.desc(), EmailFilter.created_at.desc()).all()
    except Exception as e:
        print(f"❌ ERROR en get_all_filters: {e}")
        return []

def get_filter_by_id(filter_id):
    """Obtiene un filtro por su ID"""
    return EmailFilter.query.get(filter_id)

def create_filter(name, tag_id, filter_from_email=None, filter_to_email=None, 
                 filter_subject_contains=None, filter_content_contains=None, priority=0):
    """Crea un nuevo filtro automático"""
    try:
        # Manejar caso especial de papelera
        if tag_id == 'trash':
            # Para papelera, usar tag_id = -1 (valor especial)
            tag_id = -1  # Indicará que va a papelera
        else:
            # Verificar que la etiqueta existe
            tag = EmailTag.query.get(tag_id)
            if not tag:
                raise ValueError("La etiqueta especificada no existe")
        
        # Verificar que al menos una condición esté especificada
        if not any([filter_from_email, filter_to_email, filter_subject_contains, filter_content_contains]):
            raise ValueError("Debe especificar al menos una condición para el filtro")
        
        # Crear el filtro
        new_filter = EmailFilter(
            name=name.strip(),
            tag_id=tag_id,  # Puede ser None para papelera
            filter_from_email=filter_from_email.strip() if filter_from_email else None,
            filter_to_email=filter_to_email.strip() if filter_to_email else None,
            filter_subject_contains=filter_subject_contains.strip() if filter_subject_contains else None,
            filter_content_contains=filter_content_contains.strip() if filter_content_contains else None,
            priority=priority,
            enabled=True
        )
        
        db.session.add(new_filter)
        db.session.commit()
        return new_filter
        
    except IntegrityError as e:
        db.session.rollback()
        raise ValueError("Error al crear el filtro: " + str(e))
    except Exception as e:
        db.session.rollback()
        raise e

def update_filter(filter_id, name=None, tag_id=None, filter_from_email=None, 
                 filter_to_email=None, filter_subject_contains=None, 
                 filter_content_contains=None, priority=None, enabled=None):
    """Actualiza un filtro existente"""
    try:
        email_filter = EmailFilter.query.get(filter_id)
        if not email_filter:
            raise ValueError("El filtro especificado no existe")
        
        # Actualizar campos si se proporcionan
        if name is not None:
            email_filter.name = name.strip()
        
        if tag_id is not None:
            tag = EmailTag.query.get(tag_id)
            if not tag:
                raise ValueError("La etiqueta especificada no existe")
            email_filter.tag_id = tag_id
        
        if filter_from_email is not None:
            email_filter.filter_from_email = filter_from_email.strip() if filter_from_email else None
        
        if filter_to_email is not None:
            email_filter.filter_to_email = filter_to_email.strip() if filter_to_email else None
        
        if filter_subject_contains is not None:
            email_filter.filter_subject_contains = filter_subject_contains.strip() if filter_subject_contains else None
        
        if filter_content_contains is not None:
            email_filter.filter_content_contains = filter_content_contains.strip() if filter_content_contains else None
        
        if priority is not None:
            email_filter.priority = priority
        
        if enabled is not None:
            email_filter.enabled = enabled
        
        # Verificar que al menos una condición esté especificada
        if not email_filter.has_conditions():
            raise ValueError("Debe especificar al menos una condición para el filtro")
        
        db.session.commit()
        return email_filter
        
    except Exception as e:
        db.session.rollback()
        raise e

def delete_filter(filter_id):
    """Elimina un filtro"""
    try:
        email_filter = EmailFilter.query.get(filter_id)
        if not email_filter:
            raise ValueError("El filtro especificado no existe")
        
        db.session.delete(email_filter)
        db.session.commit()
        return True
        
    except Exception as e:
        db.session.rollback()
        raise e

def toggle_filter_status(filter_id):
    """Activa o desactiva un filtro"""
    try:
        email_filter = EmailFilter.query.get(filter_id)
        if not email_filter:
            raise ValueError("El filtro especificado no existe")
        
        email_filter.enabled = not email_filter.enabled
        db.session.commit()
        return email_filter
        
    except Exception as e:
        db.session.rollback()
        raise e

def apply_filters_to_email(email):
    """Aplica todos los filtros activos a un email y retorna las etiquetas que coinciden"""
    matching_tags = []
    
    # Obtener todos los filtros activos ordenados por prioridad
    active_filters = EmailFilter.query.filter_by(enabled=True).order_by(EmailFilter.priority.desc()).all()
    
    for email_filter in active_filters:
        if email_filter.matches_email(email):
            # Ignorar filtros huérfanos (sin etiqueta asignada)
            if email_filter.tag_id is None:
                print(f"⚠️ Filtro huérfano ignorado: {email_filter.name} (sin etiqueta asignada)")
                continue
            
            # Agregar la etiqueta si no está ya en la lista
            if email_filter.tag and email_filter.tag not in matching_tags:
                matching_tags.append(email_filter.tag)
    
    return matching_tags

def auto_tag_email(email):
    """Aplica automáticamente etiquetas a un email basado en los filtros configurados (NO incluye papelera)"""
    try:
        # Obtener solo filtros activos que NO sean de papelera (tag_id != -1)
        active_filters = EmailFilter.query.filter(
            EmailFilter.enabled == True,
            EmailFilter.tag_id != -1,  # Excluir filtros de papelera
            EmailFilter.tag_id.isnot(None)  # Excluir filtros huérfanos
        ).order_by(EmailFilter.priority.desc()).all()
        
        matching_tags = []
        
        for email_filter in active_filters:
            if email_filter.matches_email(email):
                # Solo filtros normales de etiqueta (ya excluimos papelera y huérfanos)
                if email_filter.tag and email_filter.tag not in matching_tags:
                    matching_tags.append(email_filter.tag)
                    print(f"🏷️ Email coincide con filtro de etiqueta: {email_filter.name} -> {email_filter.tag.name}")
        
        # Agregar las etiquetas al email
        if matching_tags:
            for tag in matching_tags:
                if tag not in email.tags:
                    email.tags.append(tag)
            print(f"🏷️ Email etiquetado automáticamente con: {[tag.name for tag in matching_tags]}")
        
        db.session.commit()
        return matching_tags
        
    except Exception as e:
        db.session.rollback()
        print(f"❌ Error aplicando etiquetas automáticas: {e}")
        raise e

def get_filters_by_tag(tag_id):
    """Obtiene todos los filtros asociados a una etiqueta específica"""
    return EmailFilter.query.filter_by(tag_id=tag_id).order_by(EmailFilter.priority.desc()).all()

def _orphan_email_filters_query():
    """
    Filtros sin destino válido: tag_id NULL (etiqueta borrada) o tag_id inexistente.
    tag_id == -1 (papelera) se conserva.
    """
    valid_tag_ids = db.session.query(EmailTag.id)
    return EmailFilter.query.filter(
        db.or_(
            EmailFilter.tag_id.is_(None),
            db.and_(
                EmailFilter.tag_id != -1,
                ~EmailFilter.tag_id.in_(valid_tag_ids),
            ),
        )
    )


def purge_orphan_email_filters(commit=True):
    """Elimina filtros huérfanos de la BD. Retorna cantidad borrada."""
    if not MODELS_AVAILABLE:
        return 0
    try:
        orphans = _orphan_email_filters_query().all()
        if not orphans:
            return 0
        names = [f.name for f in orphans]
        for email_filter in orphans:
            db.session.delete(email_filter)
        if commit:
            db.session.commit()
        else:
            db.session.flush()
        print(f"🗑️ Filtros huérfanos eliminados ({len(orphans)}): {', '.join(names)}")
        return len(orphans)
    except Exception as e:
        db.session.rollback()
        print(f"❌ Error purgando filtros huérfanos: {e}")
        return 0


def get_filter_statistics():
    """Obtiene estadísticas de los filtros"""
    total_filters = EmailFilter.query.count()
    active_filters = EmailFilter.query.filter_by(enabled=True).count()
    inactive_filters = total_filters - active_filters
    
    return {
        'total': total_filters,
        'active': active_filters,
        'inactive': inactive_filters
    }

def test_filter_against_emails(filter_id, limit=10):
    """Prueba un filtro contra emails existentes para ver cuántos coincidirían"""
    email_filter = EmailFilter.query.get(filter_id)
    if not email_filter:
        raise ValueError("El filtro especificado no existe")
    
    # Obtener emails recientes para probar
    recent_emails = ReceivedEmail.query.filter_by(deleted=False).order_by(ReceivedEmail.received_at.desc()).limit(limit).all()
    
    matching_emails = []
    for email in recent_emails:
        if email_filter.matches_email(email):
            matching_emails.append(email)
    
    return {
        'total_tested': len(recent_emails),
        'matches': len(matching_emails),
        'matching_emails': matching_emails
    }
