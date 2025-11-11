# app/admin/site_settings.py

from app.extensions import db
from app.models import SiteSettings

def get_site_setting(key, default=None):
    """
    Retorna el valor de un SiteSettings (tabla site_settings).
    Si no existe la key, se devuelve default.
    """
    item = SiteSettings.query.filter_by(key=key).first()
    if item:
        return item.value
    return default

def set_site_setting(key, value):
    """
    Actualiza o crea un registro en site_settings con la key y value dados.
    """
    item = SiteSettings.query.filter_by(key=key).first()
    if not item:
        item = SiteSettings(key=key, value=value)
        db.session.add(item)
    else:
        item.value = value
    db.session.commit()

def toggle_setting(key, default="true"):
    """
    Alterna un valor 'true'/'false' en site_settings.
    Si no existía la key, la crea con 'default'.
    Luego cambia 'true' -> 'false' o 'false' -> 'true'.
    Retorna el nuevo valor.
    """
    current = get_site_setting(key, default)
    if not current:
        current = default
    current = current.lower()
    new_val = "false" if current == "true" else "true"
    set_site_setting(key, new_val)
    return new_val
