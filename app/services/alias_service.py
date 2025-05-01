# app/services/alias_service.py

from app.extensions import db
from app.models.alias import ServiceAlias

def create_service_alias(service_id, alias_name, alias_color="#ff0000"):
    """
    Crea un nuevo alias para un servicio específico.
    """
    new_alias = ServiceAlias(
        service_id=service_id,
        alias_name=alias_name,
        border_color=alias_color,
        enabled=True
    )
    db.session.add(new_alias)
    db.session.commit()
    return new_alias

def update_service_alias(alias_id, new_name, new_color):
    """
    Actualiza el nombre y color de un alias existente.
    """
    alias_obj = ServiceAlias.query.get_or_404(alias_id)
    alias_obj.alias_name = new_name
    alias_obj.border_color = new_color
    db.session.commit()
    return alias_obj

def delete_service_alias(alias_id):
    """
    Elimina un alias por su ID.
    """
    alias_obj = ServiceAlias.query.get_or_404(alias_id)
    db.session.delete(alias_obj)
    db.session.commit()
    return True
