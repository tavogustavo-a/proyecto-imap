"""
Sistema completo de Drive Transfer
Incluye: servicio de transferencia, scheduler y auto-scheduler
"""
import json
import logging
import threading
import time
from datetime import datetime, time as dt_time, timedelta
from typing import List, Dict, Any, Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app import db, create_app
from app.store.models import DriveTransfer

logger = logging.getLogger(__name__)

# ==================== SERVICIO DE TRANSFERENCIA ====================

class DriveTransferService:
    def __init__(self, credentials_json: str):
        """Inicializa el servicio con credenciales de Google"""
        self.credentials_json = credentials_json
        self.service = None
        self._authenticate()
    
    def _authenticate(self):
        """Autentica con Google Drive API"""
        try:
            credentials_dict = json.loads(self.credentials_json)
            credentials = service_account.Credentials.from_service_account_info(
                credentials_dict,
                scopes=['https://www.googleapis.com/auth/drive']
            )
            self.service = build('drive', 'v3', credentials=credentials)
        except json.JSONDecodeError as e:
            logger.error(f"Error en formato JSON de credenciales: {str(e)}")
            raise Exception("Credenciales JSON inválidas")
        except Exception as e:
            logger.error(f"Error en autenticación: {str(e)}")
            raise Exception(f"Error de autenticación: {str(e)}")
    
    def get_files_in_folder(self, folder_id: str, file_types: List[str] = None) -> List[Dict[str, Any]]:
        """Obtiene todos los archivos de una carpeta específica"""
        if not self.service:
            raise Exception("Servicio no autenticado")
        
        try:
            # Tipos de archivos por defecto (fotos y videos)
            if not file_types:
                file_types = [
                    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
                    'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv',
                    'video/webm', 'video/mkv', 'video/3gp'
                ]
            
            # Construir query para buscar archivos en la carpeta
            mime_types_query = " or ".join([f"mimeType='{mime}'" for mime in file_types])
            query = f"'{folder_id}' in parents and ({mime_types_query}) and trashed=false"
            
            files = []
            page_token = None
            
            while True:
                results = self.service.files().list(
                    q=query,
                    pageSize=100,
                    fields="nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)",
                    pageToken=page_token
                ).execute()
                
                files.extend(results.get('files', []))
                page_token = results.get('nextPageToken')
                
                if not page_token:
                    break
            
            return files
            
        except HttpError as e:
            logger.error(f"Error de Google Drive API: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"Error obteniendo archivos: {str(e)}")
            raise
    
    def move_file(self, file_id: str, source_folder_id: str, destination_folder_id: str) -> bool:
        """Mueve un archivo de una carpeta a otra"""
        if not self.service:
            raise Exception("Servicio no autenticado")
        
        try:
            # Obtener el archivo actual
            file = self.service.files().get(fileId=file_id, fields='parents').execute()
            current_parents = file.get('parents', [])
            
            # Verificar si ya está en la carpeta destino
            if destination_folder_id in current_parents:
                return True
            
            # Verificar si está en la carpeta origen
            if source_folder_id not in current_parents:
                return False
            
            # Mover el archivo a la nueva carpeta
            file = self.service.files().update(
                fileId=file_id,
                addParents=destination_folder_id,
                removeParents=source_folder_id,
                fields='id, parents'
            ).execute()
            
            return True
            
        except HttpError as e:
            if "cannotAddParent" in str(e):
                return True
            logger.error(f"Error moviendo archivo {file_id}: {str(e)}")
            return False
        except Exception as e:
            logger.error(f"Error moviendo archivo {file_id}: {str(e)}")
            return False
    
    def transfer_files(self, source_folder_id: str, destination_folder_id: str) -> Dict[str, Any]:
        """Transfiere todos los archivos de fotos y videos de una carpeta a otra"""
        if not self.service:
            # Intentar autenticar si no está autenticado
            try:
                self._authenticate()
            except Exception as e:
                raise Exception(f"Servicio no autenticado y error al autenticar: {str(e)}")
        
        try:
            
            # Obtener archivos de la carpeta origen
            files = self.get_files_in_folder(source_folder_id)
            
            if not files:
                return {
                    'success': True,
                    'message': 'No se encontraron archivos de fotos/videos para transferir',
                    'files_processed': 0,
                    'files_moved': 0,
                    'files_failed': 0,
                    'transfer_completed': True  # Indica que la transferencia está completa
                }
            
            
            files_moved = 0
            files_failed = 0
            failed_files = []
            
            # Mover cada archivo con control de rate limiting
            for i, file in enumerate(files, 1):
                file_id = file['id']
                file_name = file['name']
                file_size = file.get('size', 'N/A')
                file_mime = file.get('mimeType', 'unknown')
                
                
                try:
                    if self.move_file(file_id, source_folder_id, destination_folder_id):
                        files_moved += 1
                    else:
                        files_failed += 1
                        failed_files.append(file_name)
                        logger.error(f"Error moviendo archivo: {file_name}")
                    
                    # Rate limiting: pausa cada 10 archivos para evitar límites de API
                    if i % 10 == 0:
                        time.sleep(1)  # Pausa de 1 segundo cada 10 archivos
                        
                except Exception as e:
                    files_failed += 1
                    failed_files.append(file_name)
                    logger.error(f"Error procesando archivo {file_name}: {str(e)}")
                    
                    # Si hay muchos errores consecutivos, pausa más tiempo
                    if files_failed > 5:
                        time.sleep(5)  # Pausa de 5 segundos si hay muchos errores
            
            # Determinar si la transferencia está completa
            transfer_completed = files_moved > 0 and files_failed == 0
            
            result = {
                'success': files_failed == 0,
                'message': f'Transferencia completada. {files_moved} archivos movidos, {files_failed} fallaron',
                'files_processed': len(files),
                'files_moved': files_moved,
                'files_failed': files_failed,
                'failed_files': failed_files,
                'transfer_completed': transfer_completed
            }
            
            return result
            
        except Exception as e:
            logger.error(f"Error en transferencia: {str(e)}")
            return {
                'success': False,
                'message': f'Error en transferencia: {str(e)}',
                'files_processed': 0,
                'files_moved': 0,
                'files_failed': 0
            }
    
    def test_connection(self) -> Dict[str, Any]:
        """Prueba la conexión con Google Drive con timeout y reintentos"""
        if not self.service:
            return {'success': False, 'message': 'Servicio no autenticado'}
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                # Intentar listar archivos para probar la conexión con timeout
                results = self.service.files().list(pageSize=1).execute()
                files = results.get('files', [])
                
                return {
                    'success': True,
                    'message': f'Conexión exitosa. Se encontraron {len(files)} archivos en el Drive.'
                }
            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(2)  # Esperar 2 segundos antes del siguiente intento
                    continue
                else:
                    return {
                        'success': False,
                        'message': f'Error de conexión después de {max_retries} intentos: {str(e)}'
                    }
    
    def cleanup_old_files(self, folder_id: str, days_old: int = 30, deleted_folder_id: str = None) -> Dict[str, Any]:
        """Elimina archivos más antiguos que X días de una carpeta (0 días = TODOS los archivos)"""
        if not self.service:
            return {'success': False, 'message': 'Servicio no autenticado'}
        
        try:
            # Guardar ID de carpeta de eliminados
            self.deleted_folder_id = deleted_folder_id
            
            # Tipos de archivos a eliminar (fotos y videos)
            file_types = [
                'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
                'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv',
                'video/webm', 'video/mkv', 'video/3gp'
            ]
            
            # Construir query para buscar archivos
            mime_types_query = " or ".join([f"mimeType='{mime}'" for mime in file_types])
            
            if days_old == 0:
                # Si days_old es 0, eliminar TODOS los archivos sin filtro de fecha
                query = f"'{folder_id}' in parents and ({mime_types_query}) and trashed=false"
            else:
                # Calcular fecha límite para archivos antiguos
                from datetime import datetime, timedelta
                cutoff_date = datetime.utcnow() - timedelta(days=days_old)
                cutoff_date_str = cutoff_date.isoformat() + 'Z'
                query = f"'{folder_id}' in parents and ({mime_types_query}) and trashed=false and modifiedTime < '{cutoff_date_str}'"
            
            files_to_delete = []
            page_token = None
            
            # Obtener todos los archivos antiguos
            while True:
                results = self.service.files().list(
                    q=query,
                    pageSize=100,
                    fields="nextPageToken, files(id, name, mimeType, modifiedTime)",
                    pageToken=page_token
                ).execute()
                
                files_to_delete.extend(results.get('files', []))
                page_token = results.get('nextPageToken')
                
                if not page_token:
                    break
            
            if not files_to_delete:
                return {
                    'success': True,
                    'message': f'No se encontraron archivos más antiguos que {days_old} días',
                    'files_deleted': 0,
                    'files_failed': 0
                }
            
            # Eliminar archivos
            deleted_count = 0
            failed_count = 0
            failed_files = []
            
            for file in files_to_delete:
                try:
                    # Si hay carpeta de eliminados, mover archivo; si no, eliminar permanentemente
                    if hasattr(self, 'deleted_folder_id') and self.deleted_folder_id:
                        # Usar la función move_file que ya funciona correctamente
                        if self.move_file(file['id'], folder_id, self.deleted_folder_id):
                            deleted_count += 1
                        else:
                            failed_count += 1
                            failed_files.append(file['name'])
                            logger.error(f"Error moviendo archivo a eliminados: {file['name']}")
                    else:
                        # Eliminar permanentemente
                        self.service.files().delete(fileId=file['id']).execute()
                        deleted_count += 1
                except Exception as e:
                    failed_count += 1
                    failed_files.append(file['name'])
                    logger.error(f"Error procesando archivo {file['name']}: {str(e)}")
            
            action_text = "movidos a carpeta de eliminados" if deleted_folder_id else "eliminados permanentemente"
            return {
                'success': failed_count == 0,
                'message': f'Limpieza completada. {deleted_count} archivos {action_text}, {failed_count} fallaron',
                'files_deleted': deleted_count,
                'files_failed': failed_count,
                'failed_files': failed_files
            }
            
        except Exception as e:
            logger.error(f"Error en limpieza de archivos: {str(e)}")
            return {
                'success': False,
                'message': f'Error en limpieza: {str(e)}',
                'files_deleted': 0,
                'files_failed': 0
            }

# ==================== SCHEDULER DE TAREAS ====================

class DriveScheduler:
    def __init__(self):
        self.logger = logger
    
    def check_and_execute_transfers(self) -> Dict[str, Any]:
        """Verifica y ejecuta transferencias programadas"""
        try:
            # Obtener configuraciones activas
            active_transfers = DriveTransfer.query.filter_by(is_active=True).all()
            
            if not active_transfers:
                return {
                    'success': True,
                    'message': 'No hay transferencias activas configuradas',
                    'executed': 0
                }
            
            executed_count = 0
            results = []
            
            for transfer in active_transfers:
                # Verificar si es hora de ejecutar
                if self._should_execute_transfer(transfer):
                    result = self._execute_transfer(transfer)
                    results.append(result)
                    
                    if result['success']:
                        executed_count += 1
                        # Actualizar última ejecución (usar UTC para consistencia en BD)
                        transfer.last_processed = datetime.utcnow()
                        db.session.commit()
            
            return {
                'success': True,
                'message': f'Verificación completada. {executed_count} transferencias ejecutadas',
                'executed': executed_count,
                'results': results
            }
            
        except Exception as e:
            self.logger.error(f"Error en verificación de transferencias: {str(e)}")
            return {
                'success': False,
                'message': f'Error en verificación: {str(e)}',
                'executed': 0
            }
    
    def _should_execute_transfer(self, transfer: DriveTransfer) -> bool:
        """Verifica si debe ejecutar una transferencia"""
        try:
            from pytz import timezone as pytz_timezone
            
            # Obtener hora actual de Colombia
            col_tz = pytz_timezone('America/Bogota')
            now_utc = datetime.utcnow()
            now_colombia = now_utc.replace(tzinfo=pytz_timezone('UTC')).astimezone(col_tz)
            current_time = now_colombia.time()
            current_date = now_colombia.date()
            
            # Log de verificación cada vez
            
            # Si ya se ejecutó hoy, no ejecutar de nuevo
            if transfer.last_processed:
                last_execution = transfer.last_processed
                # Convertir last_processed a zona horaria de Colombia para comparar
                if last_execution.tzinfo is None:
                    # Si no tiene zona horaria, asumir UTC
                    last_execution_col = last_execution.replace(tzinfo=pytz_timezone('UTC')).astimezone(col_tz)
                else:
                    last_execution_col = last_execution.astimezone(col_tz)
                
                if current_date == last_execution_col.date():
                    return False
            
            # Verificar si es la hora programada (con margen de 5 minutos)
            target_time = transfer.processing_time
            time_diff = abs((current_time.hour * 60 + current_time.minute) - 
                          (target_time.hour * 60 + target_time.minute))
            
            # Ejecutar si está dentro del margen de 5 minutos
            should_execute = time_diff <= 5
            
            
            return should_execute
            
        except Exception as e:
            self.logger.error(f"Error verificando tiempo de ejecución: {str(e)}")
            return False
    
    def _execute_transfer(self, transfer: DriveTransfer) -> Dict[str, Any]:
        """Ejecuta una transferencia específica"""
        try:
            
            # Crear servicio de transferencia
            service = DriveTransferService(transfer.credentials_json)
            
            # Ejecutar transferencia
            result = service.transfer_files(
                transfer.drive_original_id,
                transfer.drive_processed_id
            )
            
            # Resetear contador de errores si fue exitosa
            if result.get('transfer_completed', False):
                transfer.consecutive_errors = 0
            
            return result
            
        except Exception as e:
            error_msg = str(e)
            self.logger.error(f"Error ejecutando transferencia ID {transfer.id}: {error_msg}")
            
            # Detectar errores de conexión específicos
            connection_errors = [
                'Service account info was not in the expected format',
                'Invalid credentials',
                'Authentication failed',
                'Access denied',
                'Permission denied',
                'Invalid folder ID',
                'Folder not found',
                'Network error',
                'Connection timeout'
            ]
            
            is_connection_error = any(error in error_msg for error in connection_errors)
            
            if is_connection_error:
                # Incrementar contador de errores consecutivos
                if not hasattr(transfer, 'consecutive_errors'):
                    transfer.consecutive_errors = 0
                transfer.consecutive_errors += 1
                
                
                # Si hay muchos errores consecutivos, desactivar temporalmente
                if transfer.consecutive_errors >= 3:
                    transfer.is_active = False
                    transfer.last_error = error_msg
                    self.logger.error(f"Transferencia ID {transfer.id} desactivada por {transfer.consecutive_errors} errores consecutivos")
                    
                    # Guardar cambios en la base de datos
                    from app.extensions import db
                    db.session.commit()
            
            return {
                'success': False,
                'message': f'Error en transferencia: {error_msg}',
                'files_processed': 0,
                'files_moved': 0,
                'files_failed': 0,
                'transfer_completed': False,
                'connection_error': is_connection_error,
                'consecutive_errors': getattr(transfer, 'consecutive_errors', 0)
            }

# ==================== AUTO-SCHEDULER ====================

class DriveAutoScheduler:
    def __init__(self):
        self.running = False
        self.thread = None
        self.scheduler = DriveScheduler()
    
    def start(self):
        """Inicia el scheduler en un thread separado"""
        if self.running:
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
    
    def stop(self):
        """Detiene el scheduler"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
    
    def _run_loop(self):
        """Loop principal del scheduler optimizado"""
        app = create_app()
        
        with app.app_context():
            while self.running:
                try:
                    
                    # Ejecutar transferencias
                    result = self.scheduler.check_and_execute_transfers()
                    
                    
                    # Calcular tiempo de espera inteligente
                    wait_time = self._calculate_next_check_time()
                    
                    # Esperar el tiempo calculado (máximo 1 hora)
                    for _ in range(min(wait_time, 3600)):
                        if not self.running:
                            break
                        time.sleep(1)
                        
                except Exception as e:
                    logger.error(f"Error en Drive Auto Scheduler: {str(e)}")
                    time.sleep(300)  # Esperar 5 minutos antes de reintentar
    
    def _calculate_next_check_time(self):
        """Calcula cuántos segundos esperar hasta la próxima verificación"""
        try:
            # Obtener configuraciones activas
            active_transfers = DriveTransfer.query.filter_by(is_active=True).all()
            
            if not active_transfers:
                return 3600  # 1 hora si no hay configuraciones
            
            # Usar hora de Colombia para el cálculo
            from pytz import timezone as pytz_timezone
            col_tz = pytz_timezone('America/Bogota')
            now_utc = datetime.utcnow()
            now_colombia = now_utc.replace(tzinfo=pytz_timezone('UTC')).astimezone(col_tz)
            current_time = now_colombia.time()
            
            # Encontrar la próxima hora de ejecución
            next_execution_times = []
            
            for transfer in active_transfers:
                target_time = transfer.processing_time
                
                # Calcular minutos hasta la próxima ejecución
                current_minutes = current_time.hour * 60 + current_time.minute
                target_minutes = target_time.hour * 60 + target_time.minute
                
                if target_minutes > current_minutes:
                    # Hoy mismo
                    minutes_until = target_minutes - current_minutes
                else:
                    # Mañana
                    minutes_until = (24 * 60) - current_minutes + target_minutes
                
                next_execution_times.append(minutes_until)
            
            if next_execution_times:
                # Esperar hasta 5 minutos antes de la próxima ejecución
                min_wait = min(next_execution_times) - 5
                return max(min_wait * 60, 60)  # Mínimo 1 minuto, máximo 1 hora
            
            return 3600  # 1 hora por defecto
            
        except Exception as e:
            logger.error(f"Error calculando tiempo de espera: {str(e)}")
            return 300  # 5 minutos en caso de error

# ==================== SISTEMA SIMPLE (BASADO EN TU CÓDIGO) ====================

def should_execute_simple(transfer):
    """Verifica si debe ejecutar (método simple)"""
    try:
        from pytz import timezone as pytz_timezone
        from datetime import timedelta
        
        # Hora actual de Colombia
        col_tz = pytz_timezone('America/Bogota')
        now_utc = datetime.utcnow()
        now_colombia = now_utc.replace(tzinfo=pytz_timezone('UTC')).astimezone(col_tz)
        current_time = now_colombia.time()
        current_date = now_colombia.date()
        
        # Verificar si es la hora (margen de 5 minutos para mayor flexibilidad)
        target_time = transfer.processing_time
        current_minutes = current_time.hour * 60 + current_time.minute
        target_minutes = target_time.hour * 60 + target_time.minute
        time_diff = abs(current_minutes - target_minutes)
        
        # NUEVA LÓGICA: Verificar si la hora fue modificada recientemente (últimos 30 minutos)
        # Si fue modificada recientemente Y la nueva hora ya pasó, ejecutar incluso si ya se ejecutó hoy
        hora_modificada_recientemente = False
        if transfer.updated_at:
            updated_at_utc = transfer.updated_at
            if updated_at_utc.tzinfo is None:
                updated_at_col = updated_at_utc.replace(tzinfo=pytz_timezone('UTC')).astimezone(col_tz)
            else:
                updated_at_col = updated_at_utc.astimezone(col_tz)
            
            time_since_update = now_colombia - updated_at_col
            if time_since_update <= timedelta(minutes=30):
                hora_modificada_recientemente = True
                minutos_desde_update = time_since_update.seconds // 60
                logger.debug(f"[DRIVE_TRANSFER] Transfer {transfer.id}: ⏰ Hora modificada hace {minutos_desde_update} minutos - Permitir ejecución aunque ya se ejecutó hoy")
        
        # Verificar si ya se ejecutó hoy (pero permitir si la hora fue modificada recientemente)
        if transfer.last_processed and not hora_modificada_recientemente:
            last_execution = transfer.last_processed
            if last_execution.tzinfo is None:
                last_execution_col = last_execution.replace(tzinfo=pytz_timezone('UTC')).astimezone(col_tz)
            else:
                last_execution_col = last_execution.astimezone(col_tz)
            
            # Si ya se ejecutó hoy Y la hora NO fue modificada recientemente, no ejecutar
            if current_date == last_execution_col.date():
                logger.debug(f"[DRIVE_TRANSFER] Transfer {transfer.id}: Ya se ejecutó hoy ({last_execution_col.date()}), saltando ejecución")
                return False
        
        # LÓGICA MEJORADA: Si la hora objetivo ya pasó hoy, ejecutar inmediatamente
        # (especialmente si la hora fue modificada recientemente)
        if current_minutes >= target_minutes:
            # La hora objetivo ya pasó hoy
            if not transfer.last_processed or (transfer.last_processed and 
                transfer.last_processed.replace(tzinfo=pytz_timezone('UTC')).astimezone(col_tz).date() < current_date) or hora_modificada_recientemente:
                # No se ha ejecutado hoy O la hora fue modificada recientemente, ejecutar inmediatamente
                motivo = "hora modificada recientemente" if hora_modificada_recientemente else "hora objetivo ya pasó"
                logger.info(f"[DRIVE_TRANSFER] Transfer {transfer.id}: ⚡ Ejecutando inmediatamente - {motivo}")
                return True
        
        # Lógica normal: ejecutar si está dentro del margen de 5 minutos
        should_execute = time_diff <= 5
        
        # Log para debugging (solo si está cerca de la hora o si la hora ya pasó)
        if time_diff <= 30 or current_minutes >= target_minutes:  # Loggear si está cerca o si ya pasó
            logger.debug(f"[DRIVE_TRANSFER] Transfer {transfer.id}: Hora actual: {current_time.strftime('%H:%M')}, "
                       f"Objetivo: {target_time.strftime('%H:%M')}, Diff: {time_diff} min, Execute: {should_execute}")
        
        if should_execute:
            logger.info(f"[DRIVE_TRANSFER] Transfer {transfer.id}: ✅ Ejecutando transferencia")
            return True
        else:
            return False
        
    except Exception as e:
        logger.error(f"[DRIVE_TRANSFER] Error en should_execute_simple para transfer {transfer.id}: {str(e)}", exc_info=True)
        return False

def execute_transfer_simple(transfer, app):
    """Ejecuta transferencia (método simple)"""
    transfer_id = transfer.id
    credentials_json = transfer.credentials_json
    drive_original_id = transfer.drive_original_id
    drive_processed_id = transfer.drive_processed_id
    
    try:
        logger.info(f"[DRIVE_TRANSFER] Iniciando transferencia {transfer_id}: {drive_original_id[:20]}... -> {drive_processed_id[:20]}...")
        
        # Crear servicio (fuera del contexto de app para evitar problemas)
        service = DriveTransferService(credentials_json)
        
        # Ejecutar transferencia
        result = service.transfer_files(
            drive_original_id,
            drive_processed_id
        )
        logger.info(f"[DRIVE_TRANSFER] Transferencia {transfer_id} completada. Archivos movidos: {result.get('files_moved', 0)}, Fallidos: {result.get('files_failed', 0)}")
        
        # Actualizar base de datos dentro del contexto de app
        with app.app_context():
            # Recargar el objeto desde la base de datos para evitar problemas de sesión
            transfer_obj = DriveTransfer.query.get(transfer_id)
            if transfer_obj:
                transfer_obj.last_processed = datetime.utcnow()
                transfer_obj.consecutive_errors = 0
                transfer_obj.last_error = None
                db.session.commit()
            else:
                logger.error(f"[DRIVE_TRANSFER] No se encontró transfer {transfer_id} en la base de datos")
        
        return result
        
    except Exception as e:
        logger.error(f"[DRIVE_TRANSFER] ❌ Error ejecutando transferencia {transfer_id}: {str(e)}", exc_info=True)
        # Actualizar contador de errores
        try:
            with app.app_context():
                transfer_obj = DriveTransfer.query.get(transfer_id)
                if transfer_obj:
                    transfer_obj.consecutive_errors = (transfer_obj.consecutive_errors or 0) + 1
                    transfer_obj.last_error = str(e)[:500]  # Limitar longitud del error
                    db.session.commit()
        except Exception as update_error:
            logger.error(f"[DRIVE_TRANSFER] Error actualizando contador de errores: {str(update_error)}", exc_info=True)
        
        # Re-lanzar la excepción para que la ruta pueda manejarla
        raise

def calculate_smart_wait_time(transfers):
    """Calcula tiempo de espera inteligente basado en las transferencias"""
    try:
        from pytz import timezone as pytz_timezone
        
        if not transfers:
            return 3600  # 1 hora si no hay transferencias
        
        col_tz = pytz_timezone('America/Bogota')
        now_utc = datetime.utcnow()
        now_colombia = now_utc.replace(tzinfo=pytz_timezone('UTC')).astimezone(col_tz)
        current_time = now_colombia.time()
        
        min_wait = 3600  # Mínimo 1 hora
        
        for transfer in transfers:
            target_time = transfer.processing_time
            time_diff = abs((current_time.hour * 60 + current_time.minute) - 
                          (target_time.hour * 60 + target_time.minute))
            
            # Si está extremadamente cerca (menos de 30 minutos), verificar cada 2 minutos
            if time_diff <= 30:
                min_wait = min(min_wait, 120)  # 2 minutos
            # Si está muy cerca (menos de 60 minutos), verificar cada 5 minutos
            elif time_diff <= 60:
                min_wait = min(min_wait, 300)  # 5 minutos
            # Si está cerca (menos de 120 minutos), verificar cada 20 minutos
            elif time_diff <= 120:
                min_wait = min(min_wait, 1200)  # 20 minutos
            # Si está lejos (más de 120 minutos), verificar cada 1 hora
            else:
                min_wait = min(min_wait, 3600)  # 1 hora
        
        return min_wait
        
    except Exception as e:
        logger.error(f"[DRIVE_TRANSFER] Error calculando tiempo de espera: {str(e)}")
        return 300  # 5 minutos en caso de error

def start_simple_drive_loop():
    """Inicia el loop simple basado en tu código que funciona"""
    import threading
    import time
    from app import create_app
    
    def simple_drive_loop():
        """Loop simple como tu código que funciona"""
        # Crear contexto de aplicación Flask
        app = create_app()
        logger.info("[DRIVE_TRANSFER] 🚀 Loop de transferencia de Drive iniciado")
        
        while True:
            try:
                with app.app_context():
                    # Verificar limpiezas programadas
                    check_scheduled_cleanups()
                    
                    # Obtener configuraciones activas
                    active_transfers = DriveTransfer.query.filter_by(is_active=True).all()
                    
                    if not active_transfers:
                        logger.debug("[DRIVE_TRANSFER] No hay transferencias activas, esperando 1 hora...")
                        time.sleep(3600)  # Esperar 1 hora si no hay transferencias
                        continue
                    
                    logger.debug(f"[DRIVE_TRANSFER] Verificando {len(active_transfers)} transferencia(s) activa(s)")
                    
                    # Verificar cada transferencia
                    for transfer in active_transfers:
                        if should_execute_simple(transfer):
                            execute_transfer_simple(transfer, app)
                
                # Calcular tiempo de espera inteligente
                wait_time = calculate_smart_wait_time(active_transfers)
                logger.debug(f"[DRIVE_TRANSFER] Esperando {wait_time} segundos ({wait_time/60:.1f} minutos) hasta la próxima verificación")
                time.sleep(wait_time)
                
            except Exception as e:
                logger.error(f"[DRIVE_TRANSFER] Error en el loop principal: {str(e)}", exc_info=True)
                time.sleep(3600)  # Esperar 1 hora antes de reintentar
    
    # Iniciar loop en thread separado
    thread = threading.Thread(target=simple_drive_loop, daemon=True)
    thread.start()
    logger.info("[DRIVE_TRANSFER] Thread de loop iniciado")

# ==================== SISTEMA DE LIMPIEZA PROGRAMADA ====================

# Diccionario para almacenar tareas de limpieza programadas (thread-safe)
import threading
scheduled_cleanup_tasks = {}
cleanup_tasks_lock = threading.Lock()

def schedule_cleanup_task(transfer_id, days_old, scheduled_time):
    """Programa una tarea de limpieza para una hora específica"""
    try:
        from datetime import datetime, time as dt_time
        from pytz import timezone as pytz_timezone
        
        # Generar ID único para la tarea
        task_id = f"cleanup_{transfer_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        # Almacenar información de la tarea (thread-safe)
        with cleanup_tasks_lock:
            scheduled_cleanup_tasks[task_id] = {
                'transfer_id': transfer_id,
                'days_old': days_old,
                'scheduled_time': scheduled_time,
                'created_at': datetime.now(),
                'status': 'scheduled'
            }
        
        return task_id
        
    except Exception as e:
        return None

def check_scheduled_cleanups():
    """Verifica si hay limpiezas programadas que deben ejecutarse"""
    try:
        from datetime import datetime, time as dt_time
        from pytz import timezone as pytz_timezone
        from app import create_app
        
        col_tz = pytz_timezone('America/Bogota')
        now_utc = datetime.utcnow()
        now_colombia = now_utc.replace(tzinfo=pytz_timezone('UTC')).astimezone(col_tz)
        current_time = now_colombia.time()
        
        tasks_to_execute = []
        
        for task_id, task_info in scheduled_cleanup_tasks.items():
            # Solo verificar tareas programadas (no ejecutadas, completadas o fallidas)
            if task_info['status'] != 'scheduled':
                continue
                
            scheduled_time = task_info['scheduled_time']
            time_diff = abs((current_time.hour * 60 + current_time.minute) - 
                          (scheduled_time.hour * 60 + scheduled_time.minute))
            
            # Si es la hora (margen de 5 minutos)
            if time_diff <= 5:
                tasks_to_execute.append(task_id)
        
        # Ejecutar tareas programadas
        for task_id in tasks_to_execute:
            execute_scheduled_cleanup(task_id)
            
        # Limpiar tareas completadas o fallidas (opcional - para no acumular memoria)
        cleanup_completed_tasks()
            
    except Exception as e:
        pass

def cleanup_completed_tasks():
    """Limpia tareas completadas o fallidas para liberar memoria"""
    try:
        from datetime import datetime, timedelta
        
        # Eliminar tareas completadas o fallidas de hace más de 1 hora (más agresivo)
        cutoff_time = datetime.now() - timedelta(hours=1)
        
        tasks_to_remove = []
        for task_id, task_info in scheduled_cleanup_tasks.items():
            if task_info['status'] in ['completed', 'failed']:
                if 'completed_at' in task_info and task_info['completed_at'] < cutoff_time:
                    tasks_to_remove.append(task_id)
                elif 'created_at' in task_info and task_info['created_at'] < cutoff_time:
                    tasks_to_remove.append(task_id)
        
        # Límite máximo de tareas en memoria (100 tareas máximo)
        if len(scheduled_cleanup_tasks) > 100:
            # Ordenar por fecha de creación y eliminar las más antiguas
            sorted_tasks = sorted(scheduled_cleanup_tasks.items(), 
                                key=lambda x: x[1].get('created_at', datetime.min))
            excess_count = len(scheduled_cleanup_tasks) - 100
            for i in range(excess_count):
                tasks_to_remove.append(sorted_tasks[i][0])
        
        for task_id in tasks_to_remove:
            del scheduled_cleanup_tasks[task_id]
            
    except Exception as e:
        pass

def execute_scheduled_cleanup(task_id):
    """Ejecuta una limpieza programada"""
    try:
        from app import create_app
        
        if task_id not in scheduled_cleanup_tasks:
            return False
            
        task_info = scheduled_cleanup_tasks[task_id]
        transfer_id = task_info['transfer_id']
        days_old = task_info['days_old']
        
        # Marcar tarea como ejecutándose
        scheduled_cleanup_tasks[task_id]['status'] = 'running'
        
        # Crear contexto de aplicación
        app = create_app()
        with app.app_context():
            from app.store.models import DriveTransfer
            from .drive_manager import DriveTransferService
            
            # Obtener transferencia
            transfer = DriveTransfer.query.get(transfer_id)
            if not transfer:
                scheduled_cleanup_tasks[task_id]['status'] = 'failed'
                return False
            
            # Ejecutar limpieza
            service = DriveTransferService(transfer.credentials_json)
            result = service.cleanup_old_files(transfer.drive_processed_id, days_old, transfer.drive_deleted_id)
            
            if result['success']:
                scheduled_cleanup_tasks[task_id]['status'] = 'completed'
                scheduled_cleanup_tasks[task_id]['result'] = result
                scheduled_cleanup_tasks[task_id]['completed_at'] = datetime.now()
            else:
                scheduled_cleanup_tasks[task_id]['status'] = 'failed'
                scheduled_cleanup_tasks[task_id]['error'] = result['message']
                scheduled_cleanup_tasks[task_id]['failed_at'] = datetime.now()
            
            return result['success']
            
    except Exception as e:
        if task_id in scheduled_cleanup_tasks:
            scheduled_cleanup_tasks[task_id]['status'] = 'failed'
            scheduled_cleanup_tasks[task_id]['error'] = str(e)
        return False

# ==================== INSTANCIA GLOBAL ====================

# Drive Transfer deshabilitado temporalmente
# drive_auto_scheduler = DriveAutoScheduler()
