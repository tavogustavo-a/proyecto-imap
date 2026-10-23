# app/services/email_buzon_service.py

import logging

from sqlalchemy import func

from app.extensions import db
from app.models import EmailBuzonServer, ReceivedEmail, EmailTag
from app.models.email_buzon import email_tags
from app.imap.parser import parse_raw_email
# Importación de auto_tag_email se hace dentro de la función para evitar importaciones circulares
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Intervalo del job en run.py y ancho de la ventana de disparo (deben coincidir).
# La limpieza se ejecuta si "ahora" (Colombia) está entre la hora configurada y esa hora + N minutos.
EMAIL_CLEANUP_SCHEDULER_INTERVAL_MINUTES = 5

# Lista de correos (admin buzón): tamaño por defecto y opciones tipo Gmail
BUZON_LIST_PER_PAGE_DEFAULT = 100
BUZON_LIST_PER_PAGE_CHOICES = (25, 50, 100, 200, 500, 1000, 10000)


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


def is_email_buzon_globally_enabled() -> bool:
    """Interruptor global del buzón (Admin Dashboard → Gestionar Buzón)."""
    from app.admin.site_settings import get_site_setting

    return get_site_setting('email_buzon_enabled', '1') == '1'


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
    if not is_email_buzon_globally_enabled():
        logger.warning('[buzón] process_incoming_email omitido: buzón global apagado')
        return None
    try:
        # Parsear el email usando el parser existente
        parsed_email = parse_raw_email(raw_email_data)
        from_email = parsed_email.get('from', '')
        
        # 🚫 VERIFICAR REMITENTES BLOQUEADOS ANTES DE GUARDAR
        from app.services.blocked_sender_service import is_sender_blocked
        if is_sender_blocked(from_email):
            logger.warning("[buzón] process_incoming_email omitido: remitente bloqueado from=%s", from_email)
            return None  # No guardar en la base de datos
        
        # 🗑️ VERIFICAR FILTROS DE PAPELERA ANTES DE GUARDAR
        if should_email_go_to_trash(parsed_email):
            logger.warning(
                "[buzón] process_incoming_email omitido: filtro papelera from=%s",
                from_email,
            )
            return None  # No guardar en la base de datos
        
        to_addr = parsed_email.get('to', '')
        forwarding_id = None
        try:
            from app.models.email_forwarding import EmailForwarding
            from sqlalchemy import func

            to_norm = (to_addr or '').strip().lower()
            if to_norm and '@' in to_norm:
                fwd = (
                    EmailForwarding.query.filter(
                        EmailForwarding.source_email.isnot(None),
                        func.lower(func.trim(EmailForwarding.source_email)) == to_norm,
                    ).first()
                )
                if fwd:
                    forwarding_id = fwd.id
        except Exception:
            forwarding_id = None

        # Crear registro en la base de datos
        received_email = ReceivedEmail(
            from_email=from_email,
            to_email=to_addr,
            subject=parsed_email.get('subject', ''),
            content_text=parsed_email.get('text', ''),
            content_html=parsed_email.get('html', ''),
            message_id=parsed_email.get('message_id', ''),
            buzon_server_id=buzon_server_id,
            forwarding_id=forwarding_id,
            processed=False
        )
        
        db.session.add(received_email)
        db.session.commit()

        if forwarding_id:
            try:
                from app.models.email_forwarding import EmailForwarding

                fwd = EmailForwarding.query.get(forwarding_id)
                if fwd:
                    apply_forwarding_folder_routing(received_email, fwd)
            except Exception:
                logger.exception(
                    '[buzón] apply_forwarding_folder_routing falló (incoming id=%s)',
                    getattr(received_email, 'id', None),
                )

        # Aplicar solo filtros manuales configurados por el usuario
        from app.services.email_filter_service import auto_tag_email
        auto_tag_email(received_email)

        return received_email
        
    except Exception:
        logger.exception("[buzón] process_incoming_email error al guardar")
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
    if not is_email_buzon_globally_enabled():
        logger.warning(
            '[buzón] SMTP omitido: buzón global apagado (from=%s to=%s)',
            (email_data or {}).get('from'),
            (email_data or {}).get('to'),
        )
        return None
    try:
        from_email = email_data.get('from', '')
        to_email = email_data.get('to', '')
        
        # Solo direcciones dadas de alta explícitamente (sin catch-all).
        from app.models.email_forwarding import EmailForwarding
        from sqlalchemy import func

        to_norm = (to_email or "").strip().lower()
        if not to_norm or "@" not in to_norm:
            logger.warning("[buzón] SMTP rechazado: destinatario inválido to=%r", to_email)
            return None

        configured_forwarding = (
            EmailForwarding.query.filter(
                EmailForwarding.enabled.is_(True),
                EmailForwarding.source_email.isnot(None),
                func.lower(func.trim(EmailForwarding.source_email)) == to_norm,
            ).first()
        )

        if not configured_forwarding:
            logger.warning(
                "[buzón] SMTP rechazado: no hay EmailForwarding habilitado con source_email=%s (from=%s)",
                to_norm,
                from_email or "?",
            )
            return None

        # 🚫 VERIFICAR REMITENTES BLOQUEADOS ANTES DE GUARDAR
        from app.services.blocked_sender_service import is_sender_blocked
        if is_sender_blocked(from_email):
            logger.warning(
                "[buzón] SMTP rechazado: remitente bloqueado from=%s to=%s", from_email, to_norm
            )
            return None  # No guardar en la base de datos
        
        # 🗑️ VERIFICAR FILTROS DE PAPELERA ANTES DE GUARDAR
        if should_email_go_to_trash(email_data):
            logger.warning(
                "[buzón] SMTP rechazado: filtro papelera from=%s to=%s",
                from_email,
                to_norm,
            )
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
            forwarding_id=configured_forwarding.id,
            processed=False
        )
        
        db.session.add(received_email)
        db.session.commit()

        # Carpetas de la dirección SMTP (etiqueta / spam / papelera; sin inbox → no Recibidos)
        apply_forwarding_folder_routing(received_email, configured_forwarding)

        # Filtros manuales adicionales del usuario
        from app.services.email_filter_service import auto_tag_email
        auto_tag_email(received_email)

        return received_email
        
    except Exception:
        logger.exception(
            "[buzón] process_smtp_email error (from=%s to=%s)",
            (email_data or {}).get("from"),
            (email_data or {}).get("to"),
        )
        return None


def apply_forwarding_folder_routing(email, forwarding):
    """
    Enruta un correo nuevo según las carpetas de la dirección SMTP.

    - tag:<id> / spam → etiqueta el correo (sale de Recibidos).
    - trash → lo mueve a papelera.
    - solo inbox (o sin carpetas guardadas) → queda en Recibidos (sin etiquetas).
    """
    if email is None or forwarding is None:
        return []

    from datetime import datetime

    from app.models import EmailTag
    from app.services.email_tag_service import get_or_create_spam_tag

    keys = forwarding.stored_folder_keys()
    if keys is None:
        # Dirección antigua sin carpetas configuradas → Recibidos
        return []

    applied = []
    for key in keys:
        key = str(key or '').strip()
        if not key or key == 'inbox':
            continue
        if key == 'trash':
            email.deleted = True
            if not email.deleted_at:
                email.deleted_at = datetime.utcnow()
            applied.append('trash')
            continue
        tag = None
        if key == 'spam':
            tag = get_or_create_spam_tag()
        elif key.startswith('tag:') and key[4:].isdigit():
            tag = EmailTag.query.get(int(key[4:]))
        if tag is not None and tag not in email.tags:
            email.tags.append(tag)
            applied.append(f'tag:{tag.id}')

    if applied:
        db.session.commit()
        logger.info(
            '[buzón] Enrutado por carpetas SMTP forwarding_id=%s → %s',
            forwarding.id,
            applied,
        )
    return applied


def cascade_delete_received_emails_for_forwarding(forwarding):
    """
    Al eliminar un reenvío, borra ReceivedEmail asociados.

    Preferencia:
    1) Filas con forwarding_id (FK ON DELETE CASCADE también limpia restos).
    2) Legacy: match por to_email / original_to_email (sin forwarding_id).
    3) Catch-all legado (source_email None) como antes.
    """
    from app.models.email_forwarding import EmailForwarding
    from sqlalchemy import func, or_

    fid = forwarding.id
    src = forwarding.source_email
    others = EmailForwarding.query.filter(EmailForwarding.id != fid).all()

    def norm(s):
        return (s or "").strip().lower()

    seen_ids = set()
    to_delete = []

    def _collect(rows):
        for email in rows:
            if email.id in seen_ids:
                continue
            seen_ids.add(email.id)
            to_delete.append(email)

    _collect(ReceivedEmail.query.filter(ReceivedEmail.forwarding_id == fid).all())

    if src is not None:
        n = norm(src)
        _collect(
            ReceivedEmail.query.filter(
                ReceivedEmail.forwarding_id.is_(None),
                or_(
                    func.lower(func.trim(ReceivedEmail.to_email)) == n,
                    func.lower(func.trim(ReceivedEmail.original_to_email)) == n,
                ),
            ).all()
        )
    else:
        still_catch_all = any(f.source_email is None for f in others)
        if still_catch_all:
            # Solo los ya vinculados por FK a este catch-all (si los hay)
            pass
        else:
            specifics = {norm(f.source_email) for f in others if f.source_email}
            if not specifics:
                _collect(
                    ReceivedEmail.query.filter(ReceivedEmail.forwarding_id.is_(None)).all()
                )
            else:
                _collect(
                    ReceivedEmail.query.filter(
                        ReceivedEmail.forwarding_id.is_(None),
                        ~func.lower(func.trim(ReceivedEmail.to_email)).in_(list(specifics)),
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


def _buzon_search_text_condition(query: str):
    """Coincidencia parcial en remitente, destinatario, destino original y asunto."""
    from sqlalchemy import or_

    term = (query or "").strip()
    if not term:
        return None
    pattern = f"%{term}%"
    return or_(
        ReceivedEmail.from_email.ilike(pattern),
        ReceivedEmail.to_email.ilike(pattern),
        ReceivedEmail.original_to_email.ilike(pattern),
        ReceivedEmail.subject.ilike(pattern),
    )


def search_received_emails(query, view="inbox", tag_id=None, limit=200):
    """
    Busca correos por remitente, destinatario (to / original_to) y asunto.
    En Recibidos incluye también mensajes con etiquetas (no solo la bandeja sin tag).
    """
    cond = _buzon_search_text_condition(query)
    if cond is None:
        return []

    q = ReceivedEmail.query.filter(cond)
    view_key = (view or "inbox").strip().lower()

    if view_key == "trash":
        q = q.filter(ReceivedEmail.deleted.is_(True))
    elif view_key == "tag" and tag_id:
        q = q.join(ReceivedEmail.tags).filter(EmailTag.id == int(tag_id))
        q = q.filter(ReceivedEmail.deleted.is_(False))
    elif view_key == "spam":
        spam_tag = EmailTag.query.filter_by(name="spam").first()
        if spam_tag:
            q = q.join(ReceivedEmail.tags).filter(EmailTag.id == spam_tag.id)
        else:
            return []
        q = q.filter(ReceivedEmail.deleted.is_(False))
    else:
        q = q.filter(ReceivedEmail.deleted.is_(False))

    try:
        lim = int(limit)
    except (TypeError, ValueError):
        lim = 200
    lim = max(1, min(lim, 500))

    return q.order_by(ReceivedEmail.received_at.desc()).limit(lim).all()

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


def _emails_for_cleanup_key(key):
    """Correos que pertenecen a una carpeta de la limpieza automática."""
    if key == "inbox":
        return ReceivedEmail.query.filter(
            ReceivedEmail.deleted.is_(False),
            ~ReceivedEmail.tags.any(),
        ).all()
    if key == "trash":
        return ReceivedEmail.query.filter(ReceivedEmail.deleted.is_(True)).all()
    if key == "spam":
        spam_tag = EmailTag.query.filter(func.lower(EmailTag.name) == "spam").first()
        if not spam_tag:
            return []
        return (
            ReceivedEmail.query.join(ReceivedEmail.tags)
            .filter(EmailTag.id == spam_tag.id, ReceivedEmail.deleted.is_(False))
            .all()
        )
    if isinstance(key, str) and key.startswith("tag:"):
        try:
            tag_id = int(key.split(":", 1)[1])
        except ValueError:
            return []
        if not EmailTag.query.get(tag_id):
            return []
        return (
            ReceivedEmail.query.join(ReceivedEmail.tags)
            .filter(EmailTag.id == tag_id)
            .all()
        )
    return []


def run_scheduled_email_cleanups_for_colombia_clock():
    """
    Ejecuta las reglas EmailCleanup activas cuando la hora Colombia cae en la ventana configurada.

    Ventana: desde la hora guardada (HH:MM) hasta esa hora + EMAIL_CLEANUP_SCHEDULER_INTERVAL_MINUTES.
    El job en run.py debe dispararse con ese mismo intervalo (p. ej. cada 5 min); no hace falta coincidir
    al minuto exacto.

    - inbox: correos no eliminados y sin etiquetas (misma lógica que vista Recibidos).
    - trash: todos los correos en papelera (borrado permanente).
    - spam: correos con la etiqueta spam.
    - tag:<id>: correos de esa etiqueta (borrado permanente).
    Una regla puede incluir varias carpetas; se borran todas en la misma hora.
    """
    from app.models.email_cleanup import EmailCleanup
    from app.utils.timezone import get_colombia_now

    now = get_colombia_now()
    window = EMAIL_CLEANUP_SCHEDULER_INTERVAL_MINUTES

    cleanups = EmailCleanup.get_active_cleanups()
    total = 0

    for rule in cleanups:
        t = rule.time
        if not _cleanup_rule_fires_in_window(now, t, window):
            continue

        keys = rule.folder_keys()
        to_delete = {}
        for key in keys:
            for email in _emails_for_cleanup_key(key):
                to_delete[email.id] = email
        total += _delete_received_emails_bulk(list(to_delete.values()))

    try:
        from app.services.email_filter_service import purge_orphan_email_filters
        purge_orphan_email_filters()
    except Exception as e:
        print(f"⚠️ No se pudieron purgar filtros huérfanos: {e}")

    return total
