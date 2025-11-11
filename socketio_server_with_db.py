#!/usr/bin/env python3
# socketio_server_with_db.py
# Servidor SocketIO que SÍ guarda en la base de datos

# ✅ CRÍTICO: Monkey patch DEBE ir ANTES de cualquier import
import eventlet
eventlet.monkey_patch()

import os
import sys
from datetime import datetime, timezone

# Agregar el directorio raíz del proyecto al path
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, project_root)

# Cargar variables de entorno desde .env
from dotenv import load_dotenv
load_dotenv()

# Configurar variables de entorno
os.environ['FLASK_APP'] = 'app'
# FLASK_ENV se carga desde .env, no hardcodear

# ✅ NUEVO: Importar la aplicación Flask principal para acceder a la base de datos
try:
    from app import create_app
    from app.extensions import db
    from app.models.chat import ChatMessage, ChatSession
    from app.models.user import User
    from flask_socketio import SocketIO, emit, join_room, leave_room
    
    # Crear la aplicación Flask
    app = create_app()
    
except Exception as e:
    import traceback
    traceback.print_exc()
    input("Presiona Enter para salir...")
    sys.exit(1)

# ✅ NUEVO: Usar el SocketIO de socketio_standalone para compatibilidad
try:
    from app.store.socketio_standalone import tienda_socketio
    
    # ✅ NUEVO: Inicializar el SocketIO con la aplicación Flask
    tienda_socketio.init_app(app)
    
    # ✅ NUEVO: Importar y usar los manejadores de socketio_events.py
    from app.store import socketio_events
    
except Exception as e:
    import traceback
    traceback.print_exc()
    input("Presiona Enter para salir...")
    sys.exit(1)



if __name__ == "__main__":
    # Usar configuración desde variables de entorno o config.py
    from config import Config
    config = Config()
    
    host = config.SOCKETIO_HOST
    port = config.SOCKETIO_PORT
    debug = config.SOCKETIO_DEBUG
    
    try:
        
        # ✅ NUEVO: Deshabilitar logs de SocketIO para evitar spam
        import logging
        logging.getLogger('socketio').setLevel(logging.WARNING)
        logging.getLogger('engineio').setLevel(logging.WARNING)
        
        # Usar eventlet para producción
        tienda_socketio.run(app, host=host, port=port, debug=debug, use_reloader=False)
    except Exception as e:
        import traceback
        traceback.print_exc()
        input("Presiona Enter para salir...")
        sys.exit(1)
