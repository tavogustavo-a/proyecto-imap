# app/services/email_tag_service.py

from app.extensions import db
from app.models import EmailTag, ReceivedEmail
from datetime import datetime

def get_all_tags():
    """Obtener todas las etiquetas"""
    return EmailTag.query.order_by(EmailTag.name).all()

def get_or_create_spam_tag():
    """Obtener o crear la etiqueta 'spam'"""
    spam_tag = EmailTag.query.filter_by(name='spam').first()
    if not spam_tag:
        spam_tag = EmailTag(
            name='spam',
            color='#e74c3c'  # Color rojo para spam
        )
        db.session.add(spam_tag)
        db.session.commit()
    return spam_tag

def create_tag(name, color="#3498db"):
    """Crear una nueva etiqueta"""
    tag = EmailTag(
        name=name.strip(),
        color=color
    )
    db.session.add(tag)
    db.session.commit()
    return tag

def update_tag(tag_id, name, color="#3498db"):
    """Actualizar una etiqueta existente"""
    tag = EmailTag.query.get_or_404(tag_id)
    tag.name = name.strip()
    tag.color = color
    db.session.commit()
    return tag

def update_tag_filters(tag_id, filter_from_email="", filter_to_email="", filter_subject_contains="", filter_content_contains=""):
    """Actualizar los filtros de una etiqueta"""
    tag = EmailTag.query.get_or_404(tag_id)
    tag.filter_from_email = filter_from_email.strip()
    tag.filter_to_email = filter_to_email.strip()
    tag.filter_subject_contains = filter_subject_contains.strip()
    tag.filter_content_contains = filter_content_contains.strip()
    db.session.commit()
    return tag

def delete_tag(tag_id):
    """Eliminar una etiqueta, sus filtros huérfanos y todos los emails asociados"""
    from app.models.email_buzon import EmailFilter
    from app.services.email_buzon_service import permanently_delete_email
    
    tag = EmailTag.query.get_or_404(tag_id)
    
    # Buscar filtros que usan esta etiqueta
    filters_with_tag = EmailFilter.query.filter_by(tag_id=tag_id).all()
    
    # Convertir filtros a huérfanos (sin etiqueta asignada)
    for filter_obj in filters_with_tag:
        filter_obj.tag_id = None  # Marcar como huérfano
        print(f"🔄 Filtro '{filter_obj.name}' marcado como huérfano (sin etiqueta)")
    
    # Buscar todos los emails que tienen esta etiqueta
    emails_with_tag = get_emails_by_tag(tag_id)
    emails_count = len(emails_with_tag)
    
    # Eliminar todos los emails que tienen esta etiqueta
    for email in emails_with_tag:
        try:
            permanently_delete_email(email.id)
            print(f"🗑️ Email ID {email.id} de '{email.from_email}' eliminado permanentemente")
        except Exception as e:
            print(f"❌ Error al eliminar email ID {email.id}: {str(e)}")
    
    # Eliminar la etiqueta
    db.session.delete(tag)
    db.session.commit()
    
    print(f"✅ Etiqueta '{tag.name}' eliminada. {len(filters_with_tag)} filtros marcados como huérfanos. {emails_count} emails eliminados permanentemente")
    return True

def get_tag(tag_id):
    """Obtener una etiqueta por ID"""
    return EmailTag.query.get_or_404(tag_id)

def add_tag_to_email(email_id, tag_id):
    """Agregar una etiqueta a un email"""
    email = ReceivedEmail.query.get_or_404(email_id)
    tag = EmailTag.query.get_or_404(tag_id)
    
    if tag not in email.tags:
        email.tags.append(tag)
        db.session.commit()
    return True

def remove_tag_from_email(email_id, tag_id):
    """Remover una etiqueta de un email"""
    email = ReceivedEmail.query.get_or_404(email_id)
    tag = EmailTag.query.get_or_404(tag_id)
    
    if tag in email.tags:
        email.tags.remove(tag)
        db.session.commit()
    return True

def get_emails_by_tag(tag_id):
    """Obtener emails filtrados por etiqueta"""
    from app.models import ReceivedEmail
    tag = EmailTag.query.get_or_404(tag_id)
    emails = ReceivedEmail.query.join(ReceivedEmail.tags).filter(EmailTag.id == tag_id).order_by(ReceivedEmail.received_at.desc()).all()
    
    print(f"[TAG] 🏷️ Encontrados {len(emails)} emails con etiqueta '{tag.name}' (ID: {tag_id})")
    for email in emails[:3]:  # Solo mostrar los primeros 3
        tag_names = [t.name for t in email.tags]
        print(f"[TAG] Email ID {email.id}: '{email.subject[:30]}...' - Etiquetas: {tag_names}")
    
    return emails

def get_emails_without_tags():
    """Obtener emails sin etiquetas"""
    return ReceivedEmail.query.filter(~ReceivedEmail.tags.any()).order_by(ReceivedEmail.received_at.desc()).all()

def apply_auto_tags_to_email(email):
    """Aplicar automáticamente etiquetas a un email basado en los filtros configurados"""
    tags = EmailTag.query.filter(EmailTag.has_filters()).all()
    applied_tags = []
    
    for tag in tags:
        if matches_tag_filters(email, tag):
            if tag not in email.tags:
                email.tags.append(tag)
                applied_tags.append(tag)
    
    if applied_tags:
        db.session.commit()
    
    return applied_tags

def matches_tag_filters(email, tag):
    """Verificar si un email coincide con los filtros de una etiqueta"""
    # Filtro por remitente
    if tag.filter_from_email:
        if tag.filter_from_email.lower() not in email.from_email.lower():
            return False
    
    # Filtro por destinatario
    if tag.filter_to_email:
        if tag.filter_to_email.lower() not in email.to_email.lower():
            return False
    
    # Filtro por asunto
    if tag.filter_subject_contains:
        subject = email.subject or ""
        if tag.filter_subject_contains.lower() not in subject.lower():
            return False
    
    # Filtro por contenido
    if tag.filter_content_contains:
        content = (email.content_text or "") + " " + (email.content_html or "")
        if tag.filter_content_contains.lower() not in content.lower():
            return False
    
    return True

