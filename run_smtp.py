# run_smtp.py

from app import create_app
from app.smtp.smtp_server import start_smtp_server
import signal
import sys

def signal_handler(sig, frame):
    """Manejador de señales para cerrar limpiamente"""
    print('\n🛑 Cerrando servidor SMTP...')
    from app.smtp.smtp_server import stop_smtp_server
    stop_smtp_server()
    sys.exit(0)

if __name__ == '__main__':
    # Crear la aplicación Flask
    app = create_app()
    
    # Configurar manejador de señales
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    print("🚀 Iniciando sistema completo...")
    print("📧 Servidor SMTP en puerto 25")
    print("🌐 Servidor Flask en puerto 5000")
    print("Presiona Ctrl+C para detener")
    
    # Iniciar servidor SMTP en hilo separado
    print("🚀 Iniciando servidor SMTP...")
    smtp_thread = start_smtp_server()
    
    # Esperar un momento para que SMTP se inicie
    import time
    time.sleep(2)
    
    with app.app_context():
        print("✅ Aplicación Flask inicializada")
        print("✅ Base de datos conectada")
        
        # Verificar si SMTP se inició correctamente
        from app.smtp.smtp_server import smtp_manager
        if smtp_manager.controller:
            print("✅ Servidor SMTP iniciado en puerto 25")
        else:
            print("❌ Error: Servidor SMTP no se pudo iniciar")
    
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
