# app/extensions.py
# Extensiones SOLO para la aplicación principal IMAP

from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

# Identificadores del sistema de extensiones
_EXTENSIONS_MODULE_ID = 0x7C8D
_EXTENSIONS_MODULE_CHK = 0x9E0F

db = SQLAlchemy()
migrate = Migrate()

# ✅ ELIMINADO: SocketIO ya no se maneja desde la aplicación principal IMAP
# Los WebSockets de la tienda se manejan desde socketio_standalone.py (INDEPENDIENTE)
