# app/services/alias_service.py

from app.extensions import db
from app.models.alias import ServiceAlias

def create_service_alias(service_id, alias_name, alias_color="#000000", gradient_color="#000000"):
    """
    Crea un nuevo alias para un servicio específico.
    """
    new_alias = ServiceAlias(
        service_id=service_id,
        alias_name=alias_name,
        border_color=alias_color,
        gradient_color=gradient_color,
        enabled=True
    )
    db.session.add(new_alias)
    db.session.commit()
    return new_alias

def update_service_alias(alias_id, new_name, new_color, gradient_color=None):
    """
    Actualiza el nombre y colores de un alias existente.
    """
    alias_obj = ServiceAlias.query.get_or_404(alias_id)
    alias_obj.alias_name = new_name
    alias_obj.border_color = new_color
    if gradient_color is not None:
        alias_obj.gradient_color = gradient_color
    db.session.commit()
    return alias_obj

def update_service_alias_name_only(alias_id, new_name):
    """
    Actualiza solo el nombre de un alias existente, manteniendo el color actual.
    """
    alias_obj = ServiceAlias.query.get_or_404(alias_id)
    alias_obj.alias_name = new_name
    # No se modifica border_color, se mantiene el actual
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
