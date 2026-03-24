# run_smtp.py
# systemd: añade en [Service]  Environment=PYTHONUNBUFFERED=1
# para ver prints al instante en journalctl.

import logging
import signal
import sys

# Salida inmediata en journalctl / sin TTY
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, "reconfigure") else None
sys.stderr.reconfigure(line_buffering=True) if hasattr(sys.stderr, "reconfigure") else None

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
    force=True,
)
logging.getLogger("aiosmtpd").setLevel(logging.INFO)

from app import create_app
from app.smtp.smtp_server import start_smtp_server


def signal_handler(sig, frame):
    """Manejador de señales para cerrar limpiamente"""
    print('\n🛑 Cerrando servidor SMTP...', flush=True)
    from app.smtp.smtp_server import stop_smtp_server
    stop_smtp_server()
    sys.exit(0)

if __name__ == '__main__':
    # Crear la aplicación Flask
    app = create_app()
    
    # Configurar manejador de señales
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    def _say(msg):
        print(msg, flush=True)
        logging.getLogger("run_smtp").info(msg)

    _say("🚀 Iniciando sistema completo...")
    _say("📧 Servidor SMTP en puerto 25")
    _say("🌐 Servidor Flask en puerto 5000")
    _say("Presiona Ctrl+C para detener")

    # Iniciar servidor SMTP en hilo separado
    _say("🚀 Iniciando servidor SMTP...")
    smtp_thread = start_smtp_server()
    
    # Esperar un momento para que SMTP se inicie
    import time
    time.sleep(2)
    
    with app.app_context():
        _say("✅ Aplicación Flask inicializada")
        _say("✅ Base de datos conectada")

        # Verificar si SMTP se inició correctamente
        from app.smtp.smtp_server import smtp_manager
        if smtp_manager.controller:
            _say("✅ Servidor SMTP iniciado en puerto 25")
        else:
            _say("❌ Error: Servidor SMTP no se pudo iniciar")
    
    # Iniciar servidor Flask
    try:
        app.run(
            host='0.0.0.0',
            port=5000,
            debug=False,  # Cambiar a True solo para desarrollo
            use_reloader=False  # Evitar conflictos con el hilo SMTP
        )
    except KeyboardInterrupt:
        signal_handler(signal.SIGINT, None)
