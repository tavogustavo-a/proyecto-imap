# app/helpers.py

from app.extensions import db

def increment_global_session_revocation_count():
    """
    Suma 1 al contador global de revocación de sesiones 'session_revocation_count'.
    Esto forza a que todas las sesiones existentes se invaliden (según tu lógica).
    """
    # Importamos las funciones unificadas desde site_settings.py
    from app.admin.site_settings import get_site_setting, set_site_setting

    rev_str = get_site_setting("session_revocation_count", "0")
    new_count = int(rev_str) + 1
    set_site_setting("session_revocation_count", str(new_count))
