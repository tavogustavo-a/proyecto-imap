# ============================================
# SISTEMA DE LIMPIEZA AUTOMÁTICA DE REGISTROS
# ============================================

import threading
import time
from datetime import datetime, timedelta
from app import db

def initialize_cleanup_system(mode='smart'):
    """
    Inicializar sistema de limpieza automática
    
    Args:
        mode: 'smart' - Limpieza inteligente cada 28 días a las 5:00 AM hora Colombia
              'daily' - Limpieza diaria a las 5:00 AM
    """
    if mode == 'smart':
        schedule_smart_cleanup()
    elif mode == 'daily':
        schedule_daily_cleanup()
    


def schedule_smart_cleanup():
    """Programar limpieza inteligente cada 28 días a las 5:00 AM hora Colombia"""
    
    def smart_cleanup_worker():
        while True:
            try:
                # Obtener hora actual en Colombia usando módulo centralizado
                from app.utils.timezone import get_colombia_now
                now = get_colombia_now()
                
                # Verificar si es 5:00 AM y día 28 del mes
                if now.hour == 5 and now.minute == 0 and now.day == 28:

                    
                    # Limpiar registros de conexión antiguos (28+ días)
                    from app.store.presence import cleanup_old_logs
                    deleted_count = cleanup_old_logs(days=28)
                    
                    # Limpiar sesiones inactivas
                    from app.store.presence import cleanup_inactive_sessions
                    inactive_count = cleanup_inactive_sessions()
                    

                    
                    # Esperar 24 horas para evitar múltiples ejecuciones
                    time.sleep(86400)  # 24 horas
                else:
                    # Verificar cada minuto
                    time.sleep(60)
                
            except Exception as e:

                time.sleep(300)  # Esperar 5 minutos en caso de error
    
    # Iniciar worker en thread separado
    cleanup_thread = threading.Thread(target=smart_cleanup_worker, daemon=True)
    cleanup_thread.start()

def schedule_daily_cleanup():
    """Programar limpieza diaria a las 5:00 AM hora Colombia"""
    
    def daily_cleanup_worker():
        while True:
            try:
                # Obtener hora actual en Colombia usando módulo centralizado
                from app.utils.timezone import get_colombia_now
                now = get_colombia_now()
                
                # Verificar si es 5:00 AM
                if now.hour == 5 and now.minute == 0:

                    
                    # Limpiar sesiones inactivas (15+ minutos)
                    from app.store.presence import cleanup_inactive_sessions
                    inactive_count = cleanup_inactive_sessions()
                    
                    # Limpiar registros antiguos (28 días)
                    from app.store.presence import cleanup_old_logs
                    deleted_count = cleanup_old_logs(days=28)
                    

                    
                    # Esperar 1 hora para evitar múltiples ejecuciones
                    time.sleep(3600)
                else:
                    # Verificar cada minuto
                    time.sleep(60)
                
            except Exception as e:

                time.sleep(300)  # Esperar 5 minutos en caso de error
    
    # Iniciar worker en thread separado
    cleanup_thread = threading.Thread(target=daily_cleanup_worker, daemon=True)
    cleanup_thread.start()

def manual_cleanup():
    """Ejecutar limpieza manual de registros"""
    try:

        
        # Limpiar sesiones inactivas
        from app.store.presence import cleanup_inactive_sessions
        inactive_count = cleanup_inactive_sessions()
        
        # Limpiar registros antiguos
        from app.store.presence import cleanup_old_logs
        deleted_count = cleanup_old_logs(days=28)
        

        
        return {
            'inactive_count': inactive_count,
            'deleted_count': deleted_count
        }
        
    except Exception as e:

        return {
            'inactive_count': 0,
            'deleted_count': 0,
            'error': str(e)
        }