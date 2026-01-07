#!/usr/bin/env python3
# socketio_server_with_db.py
# Servidor SocketIO que SÍ guarda en la base de datos

# ✅ CRÍTICO: Monkey patch DEBE ir ANTES de cualquier import
import eventlet
import sys
import os
import warnings
from io import StringIO

# Suprimir warnings y errores conocidos de eventlet en Windows
warnings.filterwarnings('ignore', category=RuntimeWarning)

# Configurar monkey_patch para evitar problemas en Windows
# Los errores de símbolos en Windows pueden ignorarse si no afectan la funcionalidad
class FilteredStderr:
    """Clase que filtra mensajes de error conocidos de eventlet en Windows"""
    def __init__(self, original_stderr):
        self.original_stderr = original_stderr
        self.buffer = StringIO()
    
    def write(self, message):
        # Filtrar mensajes conocidos de eventlet en Windows
        message_lower = message.lower()
        if any(keyword in message_lower for keyword in [
            'kernel32.dll', 'ntdll.dll', 'rtlntstatus', 'cancelioex', 
            'ffi.error', 'monkey_patching', 'exception was thrown'
        ]):
            # No escribir estos mensajes
            return
        # Escribir otros mensajes normalmente
        self.original_stderr.write(message)
    
    def flush(self):
        self.original_stderr.flush()
    
    def __getattr__(self, name):
        return getattr(self.original_stderr, name)

# Redirigir stderr para filtrar errores conocidos durante monkey_patch
old_stderr = sys.stderr
filtered_stderr = FilteredStderr(old_stderr)
sys.stderr = filtered_stderr

try:
    # Aplicar monkey_patch
    eventlet.monkey_patch()
except (Exception, SystemError):
    # Si falla, intentar con select=False
    try:
        eventlet.monkey_patch(select=False)
    except Exception:
        # Si aún falla, continuar sin monkey_patch completo
        pass
finally:
    # Restaurar stderr original
    sys.stderr = old_stderr

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
    from flask import request, jsonify
    
    # Crear la aplicación Flask
    app = create_app()
    
    # ✅ NUEVO: Middleware para manejar CORS preflight requests
    @app.after_request
    def after_request(response):
        # Agregar encabezados CORS a todas las respuestas
        origin = request.headers.get('Origin')
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-CSRFToken'
        return response
    
    @app.before_request
    def handle_preflight():
        if request.method == "OPTIONS":
            response = jsonify({})
            origin = request.headers.get('Origin')
            if origin:
                response.headers['Access-Control-Allow-Origin'] = origin
                response.headers['Access-Control-Allow-Credentials'] = 'true'
                response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
                response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-CSRFToken'
            return response
    
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
        
        # ✅ PRODUCCIÓN: Logs informativos
        print(f"[SocketIO] Iniciando servidor en {host}:{port}")
        print(f"[SocketIO] Modo: {'DEBUG' if debug else 'PRODUCCIÓN'}")
        print(f"[SocketIO] CORS Origins: {config.SOCKETIO_CORS_ORIGINS}")
        
        # Usar eventlet para producción
        tienda_socketio.run(app, host=host, port=port, debug=debug, use_reloader=False)
    except Exception as e:
        import traceback
        traceback.print_exc()
        # En producción, no usar input() que bloquea
        if os.getenv('FLASK_ENV') == 'production':
            sys.exit(1)
        else:
            input("Presiona Enter para salir...")
            sys.exit(1)
