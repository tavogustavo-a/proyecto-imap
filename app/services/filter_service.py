# app/services/filter_service.py

from app.extensions import db
from app.models import FilterModel, User
# from app.helpers import increment_global_session_revocation_count # Comentar o eliminar import
from flask import current_app

def create_filter_service(sender, keyword, cut_after_html, cut_before_html, description, skip_revocation=False):
    new_filter = FilterModel(
        sender=sender,
        keyword=keyword,
        enabled=True,
        cut_after_html=cut_after_html or None,
        cut_before_html=cut_before_html or None,
        description=description or "Sin descripción"
    )
    db.session.add(new_filter)
    db.session.commit()

    # Asociar este filtro a todos los usuarios existentes Y a los defaults de los padres
    all_users = User.query.all()
    parents_to_update = [] # Para commit eficiente
    for u in all_users:
        # Asignar a permisos directos (como antes)
        u.filters_allowed.append(new_filter)
        # Si es un usuario principal (o podría ser padre), añadir a sus defaults
        # Usamos 'parent_id is None' para identificar usuarios principales
        if u.parent_id is None:
            # Verificar si ya lo tiene (poco probable, pero seguro)
            if new_filter not in u.default_filters_for_subusers:
                 u.default_filters_for_subusers.append(new_filter)
                 parents_to_update.append(u) # Marcar para posible commit si es necesario
            
    db.session.commit() # Commit para permisos directos y defaults


    # Forzar logout global solo si NO es el admin (Lógica eliminada)


def update_filter_service(f: FilterModel, sender, keyword, enabled, cut_after_html, cut_before_html, description):
    f.sender = sender
    f.keyword = keyword
    f.enabled = enabled
    f.cut_after_html = cut_after_html or None
    f.cut_before_html = cut_before_html or None
    f.description = description
    db.session.commit()

    # Forzar logout global solo si NO es el admin (Lógica eliminada)
    # if not skip_revocation: # (Este if se eliminaría si no hay skip_revocation en la firma)
    #     pass


def delete_filter_service(filter_id, skip_revocation=False):
    """
    Elimina un filtro y todas sus relaciones en cascada.
    Las relaciones M2M se eliminan automáticamente por CASCADE configurado en las Foreign Keys,
    pero se limpian explícitamente para asegurar que no queden registros huérfanos.
    """
    f = FilterModel.query.get_or_404(filter_id)
    
    # Limpiar explícitamente todas las relaciones M2M antes de eliminar
    # Aunque CASCADE debería hacerlo automáticamente, esto asegura limpieza completa
    
    # Limpiar relaciones con usuarios (filters_allowed)
    if hasattr(f, 'users_who_allow'):
        f.users_who_allow.clear()
    
    # Limpiar relaciones con usuarios padres (default_filters_for_subusers)
    from app.models.user import parent_default_filter
    # Buscar usuarios que tienen este filtro en sus defaults y removerlo
    users_with_default = User.query.join(parent_default_filter).filter(
        parent_default_filter.c.filter_id == filter_id
    ).all()
    for user in users_with_default:
        if f in user.default_filters_for_subusers:
            user.default_filters_for_subusers.remove(f)
    
    # Limpiar relaciones con servicios
    if hasattr(f, 'services'):
        f.services.clear()
    
    # Limpiar relaciones con IMAP2
    if hasattr(f, 'imap2_servers'):
        # Obtener la lista antes de limpiar para evitar problemas de iteración
        imap2_list = list(f.imap2_servers)
        for imap2 in imap2_list:
            if f in imap2.filters:
                imap2.filters.remove(f)
    
    db.session.flush()  # Aplicar cambios antes de eliminar
    
    # Eliminar el filtro
    # CASCADE eliminará automáticamente las relaciones M2M restantes en las tablas:
    # - user_filter
    # - parent_default_filter
    # - service_filter
    # - imap2_filter
    db.session.delete(f)
    db.session.commit()

    # Forzar logout global solo si NO es el admin (Lógica eliminada)
    if not skip_revocation:
        pass
