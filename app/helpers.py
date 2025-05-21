# app/helpers.py

from app.extensions import db
from app.admin.site_settings import get_site_setting

def increment_global_session_revocation_count():
    """
    Suma 1 al contador global de revocación de sesiones 'session_revocation_count'.
    Esto forza a que todas las sesiones existentes se invaliden (según tu lógica).
    """
    # Importamos las funciones unificadas desde site_settings.py
    from app.admin.site_settings import set_site_setting

    rev_str = get_site_setting("session_revocation_count", "0")
    new_count = int(rev_str) + 1
    set_site_setting("session_revocation_count", str(new_count))

# === Utilidad de Regex con Timeout ==========================================
# Usa la librería 'regex' (third-party) que soporta parámetro timeout; si no está
# disponible, cae en re estándar sin timeout. Devuelve el objeto Match o None.

def safe_regex_search(pattern: str, text: str, flags=0, timeout_ms: int = 100):
    """Realiza una búsqueda regex con timeout en milisegundos.

    Si la librería `regex` está disponible la utiliza con su parámetro
    `timeout`; de lo contrario usa el módulo estándar `re` (sin timeout).
    En caso de TimeoutError o error de compilación, devuelve None.
    """
    try:
        import regex as re_timeout
        try:
            return re_timeout.search(pattern, text, flags | re_timeout.DOTALL | re_timeout.IGNORECASE, timeout=timeout_ms/1000)
        except re_timeout.TimeoutError:
            return None
        except re_timeout.error:
            return None
    except ImportError:
        # Fallback sin timeout
        import re as re_fallback
        try:
            return re_fallback.search(pattern, text, flags | re_fallback.DOTALL | re_fallback.IGNORECASE)
        except re_fallback.error:
            return None
