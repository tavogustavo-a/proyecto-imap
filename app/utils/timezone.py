"""
Utilidades para manejo de zona horaria de Colombia
Funciona independientemente de la zona horaria del servidor
"""
from datetime import datetime, time
import pytz

# Zona horaria de Colombia
COLOMBIA_TZ = pytz.timezone('America/Bogota')
UTC_TZ = pytz.timezone('UTC')

def get_colombia_now():
    """
    Obtiene la fecha y hora actual en zona horaria de Colombia.
    Siempre usa UTC como base, independientemente de la zona horaria del servidor.
    
    Returns:
        datetime: Fecha y hora actual en zona horaria de Colombia (America/Bogota)
    """
    now_utc = datetime.utcnow()
    now_utc_with_tz = now_utc.replace(tzinfo=UTC_TZ)
    colombia_time = now_utc_with_tz.astimezone(COLOMBIA_TZ)
    return colombia_time

def get_colombia_time():
    """
    Obtiene solo la hora (time) actual en zona horaria de Colombia.
    
    Returns:
        time: Hora actual en zona horaria de Colombia
    """
    colombia_now = get_colombia_now()
    return colombia_now.time()

def get_colombia_datetime():
    """
    Alias para get_colombia_now() para compatibilidad con código existente.
    
    Returns:
        datetime: Fecha y hora actual en zona horaria de Colombia
    """
    return get_colombia_now()

def colombia_strftime(format_string='%Y-%m-%d %H:%M:%S'):
    """
    Obtiene la fecha/hora actual de Colombia y la formatea.
    Equivalente a time.strftime() pero con hora de Colombia.
    
    Args:
        format_string: Formato de fecha (por defecto: '%Y-%m-%d %H:%M:%S')
    
    Returns:
        str: Fecha/hora formateada en zona horaria de Colombia
    """
    colombia_now = get_colombia_now()
    return colombia_now.strftime(format_string)

def utc_to_colombia(utc_datetime):
    """
    Convierte un datetime UTC a zona horaria de Colombia.
    
    Args:
        utc_datetime: datetime en UTC (puede ser naive o con timezone)
    
    Returns:
        datetime: datetime en zona horaria de Colombia
    """
    if utc_datetime.tzinfo is None:
        # Si es naive, asumir UTC
        utc_datetime = utc_datetime.replace(tzinfo=UTC_TZ)
    elif utc_datetime.tzinfo != UTC_TZ:
        # Si tiene otro timezone, convertir a UTC primero
        utc_datetime = utc_datetime.astimezone(UTC_TZ)
    
    return utc_datetime.astimezone(COLOMBIA_TZ)

def colombia_to_utc(colombia_datetime):
    """
    Convierte un datetime de Colombia a UTC.
    
    Args:
        colombia_datetime: datetime en zona horaria de Colombia
    
    Returns:
        datetime: datetime en UTC
    """
    if colombia_datetime.tzinfo is None:
        # Si es naive, asumir que está en Colombia
        colombia_datetime = COLOMBIA_TZ.localize(colombia_datetime)
    
    return colombia_datetime.astimezone(UTC_TZ)

def timesince(dt, default="ahora"):
    """
    Devuelve una cadena que representa el tiempo transcurrido desde una fecha.
    Ejemplo: "hace 5 minutos", "hace 2 horas", "ayer".
    """
    if not dt:
        return ""
        
    now = get_colombia_now()
    
    # Asegurar que dt tenga zona horaria
    if dt.tzinfo is None:
        # Si no tiene zona horaria, asumimos que es UTC y convertimos a Colombia
        dt = utc_to_colombia(dt)
    elif dt.tzinfo == UTC_TZ:
        dt = utc_to_colombia(dt)
        
    diff = now - dt
    
    periods = (
        (diff.days // 365, "año", "años"),
        (diff.days // 30, "mes", "meses"),
        (diff.days // 7, "semana", "semanas"),
        (diff.days, "día", "días"),
        (diff.seconds // 3600, "hora", "horas"),
        (diff.seconds // 60, "minuto", "minutos"),
        (diff.seconds, "segundo", "segundos"),
    )
    
    for period, singular, plural in periods:
        if period:
            return "hace %d %s" % (period, singular if period == 1 else plural)
            
    return default