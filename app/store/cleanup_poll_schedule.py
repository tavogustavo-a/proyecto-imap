# Intervalos adaptativos para comprobar si toca una limpieza programada (días/horas, no segundos).
# Solo aplica cuando auto_enabled está activo en la configuración admin.

import time
from datetime import datetime, timezone

# Si faltan más de 12 h para la próxima ejecución.
POLL_INTERVAL_FAR_SEC = 3 * 3600
# Si faltan entre 2 h y 12 h.
POLL_INTERVAL_MID_SEC = 3600
# Si faltan ≤ 2 h o ya venció el intervalo.
POLL_INTERVAL_NEAR_SEC = 10 * 60
# Auto desactivado mientras el hilo sigue vivo (p. ej. lo apagaron en admin).
POLL_INTERVAL_DISABLED_SEC = 24 * 3600

NEAR_DUE_THRESHOLD_SEC = 2 * 3600
MID_DUE_THRESHOLD_SEC = 12 * 3600


def is_auto_cleanup_enabled(settings) -> bool:
    return bool(settings and settings.get('auto_enabled'))


def _parse_last_run(last_run):
    if not last_run:
        return None
    try:
        return datetime.fromisoformat(str(last_run).replace('Z', ''))
    except ValueError:
        return None


def seconds_until_next_run(settings, now=None):
    """
    Segundos hasta la próxima ejecución automática.
    Requiere auto_enabled=True.
    """
    if not is_auto_cleanup_enabled(settings):
        return None

    interval_h = max(1, int(settings.get('run_interval_hours') or 24))
    interval_sec = interval_h * 3600
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)

    last_dt = _parse_last_run(settings.get('last_run_at'))
    if last_dt is None:
        return 0

    elapsed = (now - last_dt).total_seconds()
    return max(0.0, interval_sec - elapsed)


def compute_poll_interval_seconds(settings, now=None):
    """Cuánto dormir antes de volver a consultar (solo si auto_enabled)."""
    remaining = seconds_until_next_run(settings, now=now)
    if remaining is None:
        return POLL_INTERVAL_DISABLED_SEC
    if remaining <= NEAR_DUE_THRESHOLD_SEC:
        return POLL_INTERVAL_NEAR_SEC
    if remaining <= MID_DUE_THRESHOLD_SEC:
        return POLL_INTERVAL_MID_SEC
    return POLL_INTERVAL_FAR_SEC


def run_adaptive_cleanup_loop(app, get_settings_fn, run_if_due_fn):
    """
    Loop compartido de limpieza programada.
    No ejecuta limpieza si auto_enabled está apagado; solo espera por si se reactiva.
    """
    while True:
        poll_sec = POLL_INTERVAL_DISABLED_SEC
        try:
            with app.app_context():
                settings = get_settings_fn()
                if not is_auto_cleanup_enabled(settings):
                    poll_sec = POLL_INTERVAL_DISABLED_SEC
                else:
                    poll_sec = compute_poll_interval_seconds(settings)
                    run_if_due_fn(app)
        except Exception:
            pass
        time.sleep(poll_sec)


def maybe_start_cleanup_loop(app, loop_started_flag, loop_lock, start_fn, get_settings_fn):
    """
    Inicia el hilo de limpieza solo si auto_enabled está activo y aún no arrancó.
    Llamar también al guardar configuración en admin cuando se enciende auto.
    """
    with loop_lock:
        if loop_started_flag['started']:
            return False
        try:
            with app.app_context():
                if not is_auto_cleanup_enabled(get_settings_fn()):
                    return False
        except Exception:
            return False
        loop_started_flag['started'] = True
    start_fn()
    return True
