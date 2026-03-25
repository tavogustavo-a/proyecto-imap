# app/services/email_buzon_service.py

from sqlalchemy import func

from app.extensions import db
from app.models import EmailBuzonServer, ReceivedEmail, EmailTag
from app.models.email_buzon import email_tags
from app.imap.parser import parse_raw_email
# Importación de auto_tag_email se hace dentro de la función para evitar importaciones circulares
from datetime import datetime, timedelta

# Intervalo del job en run.py y ancho de la ventana de disparo (deben coincidir).
# La limpieza se ejecuta si "ahora" (Colombia) está entre la hora configurada y esa hora + N minutos.
EMAIL_CLEANUP_SCHEDULER_INTERVAL_MINUTES = 5

# Lista de correos (admin buzón): tamaño por defecto y opciones tipo Gmail
BUZON_LIST_PER_PAGE_DEFAULT = 100
BUZON_LIST_PER_PAGE_CHOICES = (25, 50, 100, 200)


def normalize_buzon_list_page(value):
    try:
        p = int(value)
        return p if p >= 1 else 1
    except (TypeError, ValueError):
        return 1


def normalize_buzon_list_per_page(value):
    try:
        v = int(value)
        if v in BUZON_LIST_PER_PAGE_CHOICES:
            return v
    except (TypeError, ValueError):
        pass
    return BUZON_LIST_PER_PAGE_DEFAULT


def _cleanup_rule_fires_in_window(now, rule_time, interval_minutes):
    """
    True si `now` cae en [slot_start, slot_start + interval) en hora Colombia.
    slot_start es la última ocurrencia de rule_time (H:M) en el calendario local
    que no es posterior a `now` (puede ser el día anterior si cruza medianoche).
    """
    slot_today = now.replace(
        hour=rule_time.hour, minute=rule_time.minute, second=0, microsecond=0
    )
    if now >= slot_today:
        slot_start = slot_today
    else:
        slot_start = slot_today - timedelta(days=1)
    slot_end = slot_start + timedelta(minutes=interval_minutes)
    return slot_start <= now < slot_end


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
                return True
        
        return False
        
    except Exception:
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
            return None  # No guardar en la base de datos
        
        # 🗑️ VERIFICAR FILTROS DE PAPELERA ANTES DE GUARDAR
        if should_email_go_to_trash(parsed_email):
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
        
        return received_email
        
    except Exception:
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
        
        # Solo direcciones dadas de alta explícitamente (sin catch-all).
        from app.models.email_forwarding import EmailForwarding
        from sqlalchemy import func

        to_norm = (to_email or "").strip().lower()
        if not to_norm or "@" not in to_norm:
            return None

        configured_forwarding = (
            EmailForwarding.query.filter(
                EmailForwarding.enabled.is_(True),
                EmailForwarding.source_email.isnot(None),
                func.lower(func.trim(EmailForwarding.source_email)) == to_norm,
            ).first()
        )

        if not configured_forwarding:
            return None

        # 🚫 VERIFICAR REMITENTES BLOQUEADOS ANTES DE GUARDAR
        from app.services.blocked_sender_service import is_sender_blocked
        if is_sender_blocked(from_email):
            return None  # No guardar en la base de datos
        
        # 🗑️ VERIFICAR FILTROS DE PAPELERA ANTES DE GUARDAR
        if should_email_go_to_trash(email_data):
            return None  # No guardar en la base de datos
        
        original_to = (email_data.get('original_to') or '').strip()
        if original_to and original_to.lower() == to_norm:
            original_to = ''

        # Crear registro directamente desde datos del SMTP
        received_email = ReceivedEmail(
            from_email=from_email,
            to_email=to_email,
            original_to_email=original_to or None,
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
        
        return received_email
        
    except Exception:
        return None


def cascade_delete_received_emails_for_forwarding(forwarding):
    """
    Al eliminar un reenvío, borra ReceivedEmail asociados.

    - source_email concreto: borra correos cuyo to_email coincide (sin distinguir mayúsculas).
    - Fila legada sin source (None): mismo criterio que antes si quedan otras filas con/sin catch-all.
    """
    from app.models.email_forwarding import EmailForwarding
    from sqlalchemy import func

    fid = forwarding.id
    src = forwarding.source_email
    others = EmailForwarding.query.filter(EmailForwarding.id != fid).all()

    def norm(s):
        return (s or "").strip().lower()

    to_delete = []

    if src is not None:
        n = norm(src)
        to_delete = (
            ReceivedEmail.query.filter(
                func.lower(func.trim(ReceivedEmail.to_email)) == n
            ).all()
        )
    else:
        still_catch_all = any(f.source_email is None for f in others)
        if still_catch_all:
            return 0
        specifics = {norm(f.source_email) for f in others if f.source_email}
        if not specifics:
            to_delete = ReceivedEmail.query.all()
        else:
            to_delete = (
                ReceivedEmail.query.filter(
                    ~func.lower(func.trim(ReceivedEmail.to_email)).in_(list(specifics))
                ).all()
            )

    count = 0
    for email in to_delete:
        try:
            email.tags.clear()
        except Exception:
            pass
        db.session.delete(email)
        count += 1
    return count


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

def get_recent_emails(limit=None):
    """Obtiene los emails más recientes (excluyendo eliminados Y sin etiquetas)"""
    q = ReceivedEmail.query.filter(
        ReceivedEmail.deleted == False,
        ~ReceivedEmail.tags.any(),
    ).order_by(ReceivedEmail.received_at.desc())
    if limit is not None:
        q = q.limit(limit)
    return q.all()


def count_recent_emails():
    return (
        ReceivedEmail.query.filter(
            ReceivedEmail.deleted == False,
            ~ReceivedEmail.tags.any(),
        ).count()
    )


def paginate_recent_emails(page=1, per_page=BUZON_LIST_PER_PAGE_DEFAULT):
    """Recibidos (sin etiquetas), paginado."""
    q = ReceivedEmail.query.filter(
        ReceivedEmail.deleted == False,
        ~ReceivedEmail.tags.any(),
    ).order_by(ReceivedEmail.received_at.desc())
    return q.paginate(page=page, per_page=per_page, error_out=False)

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

def get_trash_emails(limit=None):
    """Obtiene emails en la papelera"""
    q = ReceivedEmail.query.filter(ReceivedEmail.deleted == True).order_by(
        ReceivedEmail.deleted_at.desc()
    )
    if limit is not None:
        q = q.limit(limit)
    return q.all()


def count_trash_emails():
    return ReceivedEmail.query.filter(ReceivedEmail.deleted == True).count()


def paginate_trash_emails(page=1, per_page=BUZON_LIST_PER_PAGE_DEFAULT):
    q = ReceivedEmail.query.filter(ReceivedEmail.deleted == True).order_by(
        ReceivedEmail.deleted_at.desc()
    )
    return q.paginate(page=page, per_page=per_page, error_out=False)


def count_emails_for_tag(tag_id, exclude_deleted=False):
    q = ReceivedEmail.query.join(ReceivedEmail.tags).filter(EmailTag.id == tag_id)
    if exclude_deleted:
        q = q.filter(ReceivedEmail.deleted == False)
    return q.count()


def paginate_emails_for_tag(
    tag_id, page=1, per_page=BUZON_LIST_PER_PAGE_DEFAULT, exclude_deleted=False
):
    q = ReceivedEmail.query.join(ReceivedEmail.tags).filter(EmailTag.id == tag_id)
    if exclude_deleted:
        q = q.filter(ReceivedEmail.deleted == False)
    q = q.order_by(ReceivedEmail.received_at.desc())
    return q.paginate(page=page, per_page=per_page, error_out=False)


def get_tag_email_counts_non_deleted():
    """Conteo por etiqueta (solo correos no eliminados) para badges del sidebar."""
    rows = (
        db.session.query(email_tags.c.tag_id, func.count(ReceivedEmail.id))
        .join(ReceivedEmail, ReceivedEmail.id == email_tags.c.email_id)
        .filter(ReceivedEmail.deleted.is_(False))
        .group_by(email_tags.c.tag_id)
        .all()
    )
    return {tid: n for tid, n in rows}

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
    
    count = 0
    for email in all_trash_emails:
        db.session.delete(email)
        count += 1
    
    db.session.commit()
    return count


def _delete_received_emails_bulk(emails):
    """
    Elimina correos de la BD y limpia etiquetas (tabla de unión) antes de borrar cada fila.
    Retorna cantidad eliminada.
    """
    count = 0
    for email in emails:
        try:
            email.tags.clear()
        except Exception:
            pass
        db.session.delete(email)
        count += 1
    if count:
        db.session.commit()
    return count


def run_scheduled_email_cleanups_for_colombia_clock():
    """
    Ejecuta las reglas EmailCleanup activas cuando la hora Colombia cae en la ventana configurada.

    Ventana: desde la hora guardada (HH:MM) hasta esa hora + EMAIL_CLEANUP_SCHEDULER_INTERVAL_MINUTES.
    El job en run.py debe dispararse con ese mismo intervalo (p. ej. cada 5 min); no hace falta coincidir
    al minuto exacto.

    - inbox: correos no eliminados y sin etiquetas (misma lógica que vista Recibidos).
    - trash: todos los correos en papelera (borrado permanente).
    - tag: correos que tienen la etiqueta indicada en cleanup.tag_id (borrado permanente).
    """
    from app.models.email_cleanup import EmailCleanup
    from app.models.email_buzon import EmailTag
    from app.utils.timezone import get_colombia_now

    now = get_colombia_now()
    window = EMAIL_CLEANUP_SCHEDULER_INTERVAL_MINUTES

    cleanups = EmailCleanup.get_active_cleanups()
    total = 0

    for rule in cleanups:
        t = rule.time
        if not _cleanup_rule_fires_in_window(now, t, window):
            continue

        if rule.folder_type == "inbox":
            q = ReceivedEmail.query.filter(
                ReceivedEmail.deleted.is_(False),
                ~ReceivedEmail.tags.any(),
            )
            emails = q.all()
            n = _delete_received_emails_bulk(emails)
            total += n

        elif rule.folder_type == "trash":
            emails = ReceivedEmail.query.filter(ReceivedEmail.deleted.is_(True)).all()
            n = _delete_received_emails_bulk(emails)
            total += n

        elif rule.folder_type == "tag":
            if not rule.tag_id:
                continue
            tag = EmailTag.query.get(rule.tag_id)
            if not tag:
                continue
            emails = (
                ReceivedEmail.query.join(ReceivedEmail.tags)
                .filter(EmailTag.id == rule.tag_id)
                .all()
            )
            n = _delete_received_emails_bulk(emails)
            total += n

    return total
