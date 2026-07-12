# app/store/socketio_standalone.py
# SocketIO COMPLETAMENTE INDEPENDIENTE para la tienda
# NO interfiere con el proyecto IMAP principal

import os
from flask_socketio import SocketIO
from dotenv import load_dotenv

# Cargar variables de entorno si no están ya cargadas
load_dotenv()

# Obtener CORS origins: .env > DOMINIO.txt > desarrollo
FLASK_ENV = os.getenv("FLASK_ENV", "development")
cors_origins = os.getenv('SOCKETIO_CORS_ORIGINS')
if not cors_origins:
    try:
        from branding_domain import load_site_branding
        _brand = load_site_branding()
        if _brand:
            cors_origins = _brand.get('cors_origins')
    except Exception:
        cors_origins = None

# Orígenes para desarrollo (localhost + red local + HTTPS)
DEV_ORIGINS = [
    "http://127.0.0.1:5000", "http://127.0.0.1:5001",
    "http://localhost:5000", "http://localhost:5001",
    "http://192.168.1.5:5000", "http://192.168.1.5:5001",
    "https://127.0.0.1:5000", "https://127.0.0.1:5001",
    "https://localhost:5000", "https://localhost:5001",
    "https://192.168.1.5:5000", "https://192.168.1.5:5001",
    "http://0.0.0.0:5000", "http://0.0.0.0:5001",
]

# ✅ CORREGIDO: En desarrollo permitir localhost + IP local
if FLASK_ENV == "development":
    if not cors_origins:
        origins_list = list(DEV_ORIGINS)
        cors_origins = ",".join(origins_list)
    else:
        if isinstance(cors_origins, str) and "," in cors_origins:
            origins_list = [o.strip() for o in cors_origins.split(",")]
        elif isinstance(cors_origins, str):
            origins_list = [cors_origins]
        else:
            origins_list = cors_origins if isinstance(cors_origins, list) else []
        for o in DEV_ORIGINS:
            if o not in origins_list:
                origins_list.append(o)
        cors_origins = ",".join(origins_list)
else:
    # En producción, si no está configurado, usar lista vacía (solo mismo origen)
    if not cors_origins:
        cors_origins = []

# ✅ CORREGIDO: Asegurar que CORS funcione correctamente
# Si cors_origins es "*", convertirlo a lista para compatibilidad
if cors_origins == "*":
    cors_origins_list = "*"
else:
    # Si es una cadena con múltiples orígenes separados por coma, convertir a lista
    if isinstance(cors_origins, str) and "," in cors_origins:
        cors_origins_list = [origin.strip() for origin in cors_origins.split(",")]
    elif isinstance(cors_origins, str):
        cors_origins_list = [cors_origins]
    else:
        cors_origins_list = cors_origins

# ✅ SIMPLIFICADO: SocketIO independiente solo para la tienda
tienda_socketio = SocketIO(
    cors_allowed_origins=cors_origins_list,
    cors_credentials=True,  # ✅ NUEVO: Permitir credenciales en CORS
    async_mode='eventlet',  # Forzar modo eventlet para mejor compatibilidad
    logger=False,           # ✅ DESHABILITADO: Para reducir ruido
    engineio_logger=False,  # ✅ DESHABILITADO: Para reducir ruido
    ping_timeout=60,        # Timeout de ping más largo
    ping_interval=25,       # Intervalo de ping más frecuente
    max_http_buffer_size=1000000000,  # ✅ NUEVO: 1GB para archivos grandes
    max_payload_size=1000000000,      # ✅ NUEVO: 1GB para payloads grandes
    allow_upgrades=True,    # ✅ NUEVO: Permitir upgrades de conexión
    transports=['polling', 'websocket'],  # ✅ NUEVO: Especificar transportes
    always_connect=True,    # ✅ NUEVO: Siempre permitir conexión
    # ✅ NUEVO: Configuración adicional para archivos grandes
    max_request_size=1000000000,  # 1GB para requests
    max_response_size=1000000000, # 1GB para responses
    compression_threshold=1024,   # Comprimir solo archivos > 1KB
    compression=False             # Deshabilitar compresión para archivos grandes
)
