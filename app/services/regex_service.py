# app/services/regex_service.py

from app.extensions import db
from app.models import RegexModel, User
# from app.helpers import increment_global_session_revocation_count # Comentar o eliminar import
from flask import current_app

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
    current_app.logger.info(f"Nuevo regex {new_regex.id} asignado a todos los usuarios y a defaults de {len(parents_to_update)} padres.")

    # Forzar logout global solo si NO es el admin
    if not skip_revocation:
        # increment_global_session_revocation_count() # Comentar o eliminar llamada
        pass # Añadir pass si se quiere mantener el if, o eliminar el if completo


def update_regex_service(r: RegexModel, sender, pattern, description, enabled):
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
    r = RegexModel.query.get_or_404(regex_id)
    db.session.delete(r)
    db.session.commit()

    # Forzar logout global solo si NO es el admin
    if not skip_revocation:
        # increment_global_session_revocation_count() # Comentar o eliminar llamada
        pass # Añadir pass
