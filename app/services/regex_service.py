# app/services/regex_service.py

from sqlalchemy import func

from app.extensions import db
from app.models import RegexModel, User
# from app.helpers import increment_global_session_revocation_count # Comentar o eliminar import
from flask import current_app


def regex_list_order_by(query):
    """Lista de regex ordenada alfabéticamente por descripción (luego por id)."""
    return query.order_by(
        func.coalesce(func.lower(RegexModel.description), '').asc(),
        RegexModel.id.asc(),
    )

def create_regex_service(sender, pattern, description, skip_revocation=False):
    new_regex = RegexModel(
        sender=sender,
        pattern=pattern,
        enabled=True,
        description=description
    )
    db.session.add(new_regex)
    db.session.commit()

    # Asignar el nuevo regex a todos los usuarios Y a los defaults de los padres
    all_users = User.query.all()
    parents_to_update = []
    for u in all_users:
        # Asignar a permisos directos
        u.regexes_allowed.append(new_regex)
        # Si es un usuario principal, añadir a sus defaults
        if u.parent_id is None:
             if new_regex not in u.default_regexes_for_subusers:
                 u.default_regexes_for_subusers.append(new_regex)
                 parents_to_update.append(u)

    db.session.commit() # Commit para permisos directos y defaults


    # Forzar logout global solo si NO es el admin
    if not skip_revocation:
        # increment_global_session_revocation_count() # Comentar o eliminar llamada
        pass # Añadir pass si se quiere mantener el if, o eliminar el if completo


def update_regex_service(r: RegexModel, sender, pattern, description, enabled, skip_revocation=False):
    r.sender = sender
    r.pattern = pattern
    r.description = description
    r.enabled = enabled
    db.session.commit()

    # Forzar logout global solo si NO es el admin
    if not skip_revocation:
        # increment_global_session_revocation_count() # Comentar o eliminar llamada
        pass # Añadir pass


def delete_regex_service(regex_id, skip_revocation=False):
    """
    Elimina un regex y todas sus relaciones en cascada.
    Las relaciones M2M se eliminan automáticamente por CASCADE configurado en las Foreign Keys,
    pero se limpian explícitamente para asegurar que no queden registros huérfanos.
    """
    r = RegexModel.query.get_or_404(regex_id)
    
    # Limpiar explícitamente todas las relaciones M2M antes de eliminar
    # Aunque CASCADE debería hacerlo automáticamente, esto asegura limpieza completa
    
    # Limpiar relaciones con usuarios (regexes_allowed)
    if hasattr(r, 'users_who_allow'):
        r.users_who_allow.clear()
    
    # Limpiar relaciones con usuarios padres (default_regexes_for_subusers)
    from app.models import User
    from app.models.user import parent_default_regex
    # Buscar usuarios que tienen este regex en sus defaults y removerlo
    users_with_default = User.query.join(parent_default_regex).filter(
        parent_default_regex.c.regex_id == regex_id
    ).all()
    for user in users_with_default:
        if r in user.default_regexes_for_subusers:
            user.default_regexes_for_subusers.remove(r)
    
    # Limpiar relaciones con servicios
    if hasattr(r, 'services'):
        r.services.clear()
    
    # Limpiar relaciones con IMAP2
    if hasattr(r, 'imap2_servers'):
        # Obtener la lista antes de limpiar para evitar problemas de iteración
        imap2_list = list(r.imap2_servers)
        for imap2 in imap2_list:
            if r in imap2.regexes:
                imap2.regexes.remove(r)
    
    db.session.flush()  # Aplicar cambios antes de eliminar
    
    # Eliminar el regex
    # CASCADE eliminará automáticamente las relaciones M2M restantes en las tablas:
    # - user_regex
    # - parent_default_regex
    # - service_regex
    # - imap2_regex
    db.session.delete(r)
    db.session.commit()

    # Forzar logout global solo si NO es el admin
    if not skip_revocation:
        # increment_global_session_revocation_count() # Comentar o eliminar llamada
        pass # Añadir pass
