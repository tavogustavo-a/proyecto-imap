# app/services/filter_service.py

from app.extensions import db
from app.models import FilterModel, User
# from app.helpers import increment_global_session_revocation_count # Comentar o eliminar import
from flask import current_app

def create_filter_service(sender, keyword, cut_after_html, cut_before_html, skip_revocation=False):
    new_filter = FilterModel(
        sender=sender,
        keyword=keyword,
        enabled=True,
        cut_after_html=cut_after_html or None,
        cut_before_html=cut_before_html or None
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


def update_filter_service(f: FilterModel, sender, keyword, enabled, cut_after_html, cut_before_html):
    f.sender = sender
    f.keyword = keyword
    f.enabled = enabled
    f.cut_after_html = cut_after_html or None
    f.cut_before_html = cut_before_html or None
    db.session.commit()

    # Forzar logout global solo si NO es el admin (Lógica eliminada)
    # if not skip_revocation: # (Este if se eliminaría si no hay skip_revocation en la firma)
    #     pass


def delete_filter_service(filter_id, skip_revocation=False):
    f = FilterModel.query.get_or_404(filter_id)
    db.session.delete(f)
    db.session.commit()

    # Forzar logout global solo si NO es el admin (Lógica eliminada)
    if not skip_revocation:
        pass
