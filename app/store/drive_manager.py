"""
Sistema completo de Drive Transfer
Incluye: servicio de transferencia, scheduler y auto-scheduler
"""
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, time as dt_time, timedelta
from typing import List, Dict, Any, Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app import db
from app.store.models import DriveTransfer

logger = logging.getLogger(__name__)
_DRIVE_ID = re.compile(r'^[A-Za-z0-9_-]{8,200}$')


class DriveFolderMissing(Exception):
    """La carpeta de Drive ya no existe. No es un fallo de un archivo."""


def _drive_folder_missing(exc: Exception) -> bool:
    status = getattr(getattr(exc, 'resp', None), 'status', None)
    if status == 404:
        return True
    text = str(exc).lower()
    content = getattr(exc, 'content', None)
    if content:
        try:
            text += ' ' + content.decode('utf-8', errors='replace').lower()
        except Exception:
            pass
    return 'not found' in text or 'filenotfound' in text


def _valid_drive_id(value: str) -> bool:
    return bool(_DRIVE_ID.fullmatch(value or ''))


def ensure_drive_telegram_columns() -> None:
    """Añade grupo de Telegram y el registro de problemas si la tabla ya existía."""
    try:
        from sqlalchemy import inspect, text

        inspector = inspect(db.engine)
        if 'drive_transfers' not in inspector.get_table_names():
            return
        cols = {c['name'] for c in inspector.get_columns('drive_transfers')}
        additions = [
            ('telegram_group_id', 'ALTER TABLE drive_transfers ADD COLUMN telegram_group_id VARCHAR(32)'),
            ('telegram_topic_id', 'ALTER TABLE drive_transfers ADD COLUMN telegram_topic_id VARCHAR(32)'),
            ('telegram_send_problems', 'ALTER TABLE drive_transfers ADD COLUMN telegram_send_problems TEXT'),
            ('source_telegram_chats', 'ALTER TABLE drive_transfers ADD COLUMN source_telegram_chats TEXT'),
            ('source_telegram_state', 'ALTER TABLE drive_transfers ADD COLUMN source_telegram_state TEXT'),
        ]
        for name, ddl in additions:
            if name in cols:
                continue
            try:
                db.session.execute(text(ddl))
                db.session.commit()
                cols.add(name)
            except Exception as exc:
                db.session.rollback()
                logger.warning('No se pudo añadir drive_transfers.%s: %s', name, exc)
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        logger.warning('ensure_drive_telegram_columns: %s', exc)

# ==================== HELPER FUNCIONES DE ZONA HORARIA ====================
# Usar módulo centralizado de timezone
from app.utils.timezone import get_colombia_now as get_colombia_datetime, get_colombia_time, utc_to_colombia

def get_colombia_date():
    """
    Obtiene solo la fecha (date) actual en zona horaria de Colombia.
    
    Returns:
        date: Fecha actual en zona horaria de Colombia
    """
    return get_colombia_datetime().date()

# ==================== HELPER FUNCIONES PARA INTERVALOS ====================

def parse_interval(interval_str: str) -> Optional[timedelta]:
    """
    Parsea un intervalo en formato "5h" o "10m" y retorna un timedelta.
    
    Args:
        interval_str: String con formato "5h", "10m", "5H", "10M", etc.
    
    Returns:
        timedelta: Intervalo en segundos, o None si el formato es inválido
    """
    if not interval_str:
        return None
    
    interval_str = interval_str.strip().upper()
    
    try:
        # Extraer número y unidad
        if interval_str.endswith('H'):
            # Horas
            hours = int(interval_str[:-1])
            if hours <= 0:
                return None
            return timedelta(hours=hours)
        elif interval_str.endswith('M'):
            # Minutos
            minutes = int(interval_str[:-1])
            if minutes <= 0:
                return None
            return timedelta(minutes=minutes)
        else:
            # Intentar parsear como número puro (asumir minutos)
            minutes = int(interval_str)
            if minutes <= 0:
                return None
            return timedelta(minutes=minutes)
    except (ValueError, AttributeError):
        return None

def _pending_retry_seconds() -> int:
    """Cuánto esperar para seguir con lo que quedó. Libre: poco. Cargado: un poco más."""
    try:
        from app.store.telegram_bot_service import host_room

        room = host_room()
    except Exception:
        room = 'medio'
    if room == 'cargado':
        return 90
    if room == 'medio':
        return 30
    return 12


def should_execute_by_interval(transfer: DriveTransfer) -> bool:
    """
    Verifica si debe ejecutar basándose en el intervalo configurado.
    
    PRIORIDAD 1: Si hay archivos pendientes, ejecutar cada 5 minutos hasta completarlos.
    PRIORIDAD 2: Si pasó el intervalo configurado, ejecutar normalmente.
    
    Args:
        transfer: Objeto DriveTransfer con la configuración
    
    Returns:
        bool: True si debe ejecutar, False en caso contrario
    """
    try:
        now_utc = datetime.utcnow()
        
        # PRIORIDAD 1: Verificar si hay archivos pendientes de la última ejecución
        has_pending_files = False
        if transfer.last_error and transfer.last_error.startswith("PENDING_FILES:"):
            try:
                pending_count = int(transfer.last_error.split(":")[1])
                if pending_count > 0:
                    has_pending_files = True
            except (ValueError, IndexError):
                pass
        
        if has_pending_files and transfer.last_processed:
            time_since_last = now_utc - transfer.last_processed
            if time_since_last >= timedelta(seconds=_pending_retry_seconds()):
                return True
        
        # PRIORIDAD 2: Verificar intervalo normal
        # Parsear intervalo
        interval = parse_interval(transfer.processing_time)
        if not interval:
            return False
        
        # Si nunca se ha ejecutado, usar activated_at o created_at como referencia
        if not transfer.last_processed:
            # Si tiene activated_at, usar ese; si no, usar created_at
            reference_time = transfer.activated_at or transfer.created_at
            if not reference_time:
                # Si no hay referencia, ejecutar inmediatamente
                return True
            
            # Calcular tiempo desde la referencia
            time_since_reference = now_utc - reference_time
            
            # Si ya pasó el intervalo desde la referencia, ejecutar
            if time_since_reference >= interval:
                return True
            return False
        
        # Si ya se ejecutó antes, calcular desde la última ejecución
        time_since_last = now_utc - transfer.last_processed
        
        # Si ya pasó el intervalo desde la última ejecución, ejecutar
        if time_since_last >= interval:
            return True
        
        return False
        
    except Exception as e:
        logger.error(f"Error verificando intervalo para transfer {transfer.id}: {str(e)}")
        return False

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
        except json.JSONDecodeError:
            logger.error('Credenciales de Drive con JSON inválido')
            raise Exception('Credenciales JSON inválidas')
        except Exception as exc:
            logger.error('Error de autenticación con Drive: %s', type(exc).__name__)
            raise Exception('Error de autenticación con Google Drive')
        http = getattr(self.service, '_http', None)
        if http is not None:
            try:
                http.timeout = 120
            except Exception:
                pass
    
    def get_files_in_folder(self, folder_id: str, file_types: List[str] = None) -> List[Dict[str, Any]]:
        """Obtiene todos los archivos de una carpeta específica"""
        if not self.service:
            raise Exception("Servicio no autenticado")
        if not _valid_drive_id(folder_id):
            raise Exception('ID de carpeta de Drive no válido')
        
        try:
            # Cualquier foto o video. El envío los convierte a un formato que Telegram acepte.
            query = (
                f"'{folder_id}' in parents and trashed=false and "
                "(mimeType contains 'image/' or mimeType contains 'video/')"
            )
            
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
            if _drive_folder_missing(e):
                raise DriveFolderMissing()
            logger.error('Error de Google Drive API: %s', type(e).__name__)
            raise
        except Exception as e:
            logger.error(f"Error obteniendo archivos: {str(e)}")
            raise
    
    def move_file(self, file_id: str, source_folder_id: str, destination_folder_id: str) -> bool:
        """Mueve un archivo de una carpeta a otra"""
        if not self.service:
            raise Exception("Servicio no autenticado")
        if not all(_valid_drive_id(value) for value in (file_id, source_folder_id, destination_folder_id)):
            return False
        
        try:
            # Obtener el archivo actual
            file = self.service.files().get(fileId=file_id, fields='parents').execute()
            current_parents = file.get('parents', [])
            
            # Verificar si ya está en la carpeta destino
            if destination_folder_id in current_parents:
                if source_folder_id in current_parents and source_folder_id != destination_folder_id:
                    self.service.files().update(
                        fileId=file_id,
                        removeParents=source_folder_id,
                        fields='id, parents',
                    ).execute()
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
            if _drive_folder_missing(e):
                return False
            logger.error('Error moviendo archivo %s: %s', file_id, type(e).__name__)
            return False
        except Exception as e:
            logger.error(f"Error moviendo archivo {file_id}: {str(e)}")
            return False

    def _drop_drive_connections(self) -> None:
        """Suelta la conexión de Drive. Después de bajar un archivo a veces queda inutilizable."""
        http = getattr(self.service, '_http', None)
        if http is None:
            return
        connections = getattr(http, 'connections', None)
        if isinstance(connections, dict):
            for conn in list(connections.values()):
                try:
                    conn.close()
                except Exception:
                    pass
            connections.clear()
        try:
            http.timeout = 120
        except Exception:
            pass

    def download_file(self, file_id: str, dest_path: str) -> None:
        """Descarga un archivo de Drive a una ruta local."""
        from googleapiclient.http import MediaIoBaseDownload

        if not self.service:
            raise Exception('Servicio no autenticado')
        if not _valid_drive_id(file_id):
            raise Exception('ID de archivo de Drive no válido')
        from app.store.telegram_bot_service import host_room

        chunk = 1024 * 1024 if host_room() == 'cargado' else 4 * 1024 * 1024
        last_error = None
        for attempt in range(3):
            self._drop_drive_connections()
            request = self.service.files().get_media(fileId=file_id)
            try:
                with open(dest_path, 'wb') as handle:
                    downloader = MediaIoBaseDownload(handle, request, chunksize=chunk)
                    done = False
                    while not done:
                        _, done = downloader.next_chunk()
                return
            except DriveFolderMissing:
                try:
                    os.remove(dest_path)
                except OSError:
                    pass
                raise
            except Exception as exc:
                if _drive_folder_missing(exc):
                    try:
                        os.remove(dest_path)
                    except OSError:
                        pass
                    raise DriveFolderMissing()
                last_error = exc
                try:
                    os.remove(dest_path)
                except OSError:
                    pass
                time.sleep(0.4 * (attempt + 1))
        raise last_error

    def upload_to_folder(self, folder_id: str, local_path: str, name: str, mime: str) -> str:
        """Sube un archivo al Drive procesado y devuelve su ID."""
        from googleapiclient.http import MediaFileUpload

        if not self.service:
            raise Exception('Servicio no autenticado')
        if not _valid_drive_id(folder_id):
            raise Exception('ID de carpeta de Drive no válido')
        body = {'name': name, 'parents': [folder_id]}
        media = MediaFileUpload(local_path, mimetype=mime or 'application/octet-stream', resumable=False)
        created = self.service.files().create(body=body, media_body=media, fields='id').execute()
        return str(created.get('id') or '')
    
    def publish_original_to_telegram(self, source_folder_id: str, on_file=None) -> Dict[str, Any]:
        """Envía lo que hay en el original sin moverlo. Sirve cuando no hay Drive procesado."""
        try:
            files = self.get_files_in_folder(source_folder_id)
        except DriveFolderMissing:
            return {
                'success': True,
                'drive_missing': True,
                'message': '',
                'files_processed': 0,
                'files_moved': 0,
                'files_failed': 0,
                'moved_files': [],
                'transfer_completed': False,
                'remaining_files': 0,
            }
        for file in files:
            info = {
                'id': file.get('id'),
                'name': file.get('name'),
                'mimeType': file.get('mimeType') or '',
                'size': file.get('size') or 0,
            }
            if on_file is not None and info.get('id'):
                try:
                    on_file(info)
                except Exception:
                    logger.warning('No se pudo enviar a Telegram un archivo del Drive original')
        return {
            'success': True,
            'message': 'Sin Drive procesado: se envió a Telegram y los archivos siguen en el original.',
            'files_processed': len(files),
            'files_moved': 0,
            'files_failed': 0,
            'moved_files': [],
            'transfer_completed': True,
            'remaining_files': 0,
        }

    def transfer_files(self, source_folder_id: str, destination_folder_id: str, max_files_per_batch: Optional[int] = None, on_moved=None) -> Dict[str, Any]:
        """Mueve fotos y videos. Si el servidor está libre, avanza más; si está cargado, espera."""
        if not self.service:
            # Intentar autenticar si no está autenticado
            try:
                self._authenticate()
            except Exception as e:
                # Retornar error en lugar de lanzar excepción
                return {
                    'success': False,
                    'message': f'Servicio no autenticado y error al autenticar: {str(e)}',
                    'files_processed': 0,
                    'files_moved': 0,
                    'files_failed': 0,
                    'transfer_completed': False,
                    'remaining_files': 0
                }
        
        files_moved = 0
        files_failed = 0
        moved_files = []
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
                    'transfer_completed': True,
                    'remaining_files': 0
                }
            
            from app.store.telegram_bot_service import host_room, wait_for_host_room

            room = host_room()
            if max_files_per_batch is None:
                if room == 'cargado':
                    max_files_per_batch = 12
                elif room == 'medio':
                    max_files_per_batch = 40
                else:
                    max_files_per_batch = 200
            files_to_process = files[:max_files_per_batch]
            remaining_files = len(files) - len(files_to_process)
            
            failed_files = []
            
            # Procesar archivos de forma gradual con pausas inteligentes y manejo robusto de errores
            consecutive_errors = 0
            max_consecutive_errors = 5  # Máximo de errores consecutivos antes de pausar más tiempo
            stopped_early = False
            
            for i, file in enumerate(files_to_process, 1):
                file_id = file['id']
                file_name = file['name']
                file_size = file.get('size', 'N/A')
                file_mime = file.get('mimeType', 'unknown')
                
                is_video = file_mime.startswith('video/')
                
                # Convertir tamaño a bytes si es posible
                file_size_bytes = 0
                try:
                    if file_size != 'N/A' and file_size:
                        file_size_bytes = int(file_size)
                except (ValueError, TypeError):
                    file_size_bytes = 0
                
                room = wait_for_host_room()
                if room == 'cargado':
                    pause_time = 0.8 if is_video else 0.35
                elif room == 'medio':
                    pause_time = 0.25 if is_video else 0.1
                else:
                    pause_time = 0.02
                
                # Intentar mover archivo con reintentos
                max_retries = 3
                retry_delay = 2.0  # Segundos a esperar entre reintentos
                file_moved_successfully = False
                
                for attempt in range(max_retries):
                    try:
                        # Mover archivo
                        if self.move_file(file_id, source_folder_id, destination_folder_id):
                            files_moved += 1
                            file_moved_successfully = True
                            moved_info = {
                                'id': file_id,
                                'name': file_name,
                                'mimeType': file_mime,
                                'size': file_size_bytes,
                            }
                            moved_files.append(moved_info)
                            if on_moved is not None:
                                try:
                                    on_moved(moved_info)
                                except Exception:
                                    logger.warning('No se pudo enviar a Telegram el archivo movido')
                            consecutive_errors = 0  # Resetear contador de errores consecutivos
                            break  # Salir del loop de reintentos
                        else:
                            # Si move_file retorna False, puede ser que el archivo ya esté movido
                            # Verificar si realmente falló o ya está en destino
                            files_failed += 1
                            failed_files.append(file_name)
                            consecutive_errors += 1
                            break
                            
                    except DriveFolderMissing:
                        raise
                    except Exception as e:
                        consecutive_errors += 1
                        
                        # Si es el último intento, marcar como fallido
                        if attempt == max_retries - 1:
                            files_failed += 1
                            failed_files.append(file_name)
                        else:
                            # Esperar antes de reintentar (pausa progresiva)
                            time.sleep(retry_delay * (attempt + 1))
                
                if consecutive_errors > 0:
                    wait_for_host_room(max_wait=8)
                    if consecutive_errors >= max_consecutive_errors:
                        pause_after_error = min(2.0 + (consecutive_errors - max_consecutive_errors) * 0.5, 6.0)
                        time.sleep(pause_after_error)
                    else:
                        time.sleep(0.6)
                else:
                    time.sleep(pause_time)
                
                # Si hay demasiados errores consecutivos, detener el batch para evitar saturación
                if consecutive_errors >= 10:
                    remaining_files += len(files_to_process) - i
                    stopped_early = True
                    break
            
            # Determinar si la transferencia está completa (no quedan archivos pendientes)
            transfer_completed = remaining_files == 0 and files_failed == 0 and not stopped_early
            
            # Mensaje informativo
            if remaining_files > 0:
                message = f'Procesados {len(files_to_process)} de {len(files)} archivos. {files_moved} movidos, {files_failed} fallaron. Quedan {remaining_files} pendientes.'
            else:
                message = f'Transferencia completada. {files_moved} archivos movidos, {files_failed} fallaron.'
            
            result = {
                'success': files_failed == 0,
                'message': message,
                'files_processed': len(files_to_process),
                'files_total': len(files),
                'files_moved': files_moved,
                'files_failed': files_failed,
                'failed_files': failed_files,
                'moved_files': moved_files,
                'transfer_completed': transfer_completed,
                'remaining_files': remaining_files
            }
            
            return result

        except DriveFolderMissing:
            return {
                'success': True,
                'drive_missing': True,
                'message': '',
                'files_processed': files_moved + files_failed,
                'files_moved': files_moved,
                'files_failed': 0,
                'failed_files': [],
                'moved_files': moved_files,
                'transfer_completed': False,
                'remaining_files': 0,
            }
            
        except Exception as exc:
            logger.error('Error en transferencia: %s', type(exc).__name__)
            return {
                'success': False,
                'message': 'Error en transferencia',
                'files_processed': files_moved + files_failed,
                'files_moved': files_moved,
                'files_failed': files_failed,
                'moved_files': moved_files,
                'transfer_completed': False,
                'remaining_files': 0
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
            
            mime_clause = "(mimeType contains 'image/' or mimeType contains 'video/')"
            
            if days_old == 0:
                # Si days_old es 0, eliminar TODOS los archivos sin filtro de fecha
                query = f"'{folder_id}' in parents and {mime_clause} and trashed=false"
            else:
                # Calcular fecha límite para archivos antiguos
                from datetime import datetime, timedelta
                cutoff_date = datetime.utcnow() - timedelta(days=days_old)
                cutoff_date_str = cutoff_date.isoformat() + 'Z'
                query = f"'{folder_id}' in parents and {mime_clause} and trashed=false and modifiedTime < '{cutoff_date_str}'"
            
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
            # Obtener hora actual de Colombia usando módulo centralizado
            now_colombia = get_colombia_datetime()
            current_time = now_colombia.time()
            current_date = now_colombia.date()
            
            # Log de verificación cada vez
            
            # Si ya se ejecutó hoy, no ejecutar de nuevo
            if transfer.last_processed:
                last_execution = transfer.last_processed
                # Convertir last_processed a zona horaria de Colombia para comparar
                last_execution_col = utc_to_colombia(last_execution)
                
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
    
    def start(self, app=None):
        """Inicia el scheduler en un thread separado."""
        if self.running:
            return
        if app is None:
            raise ValueError('DriveAutoScheduler.start requiere la instancia Flask existente')
        self._app = app
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
    
    def stop(self):
        """Detiene el scheduler"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
    
    def _run_loop(self):
        """Loop principal del scheduler optimizado."""
        app = getattr(self, '_app', None)
        if app is None:
            return

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
            
            # Usar hora de Colombia para el cálculo (módulo centralizado)
            now_colombia = get_colombia_datetime()
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
    """Verifica si debe ejecutar basándose en el intervalo configurado"""
    try:
        # Usar la nueva función de intervalos
        return should_execute_by_interval(transfer)
        
        # NUEVA LÓGICA: Verificar si la hora fue modificada recientemente (últimos 30 minutos)
        # Si fue modificada recientemente Y la nueva hora ya pasó, ejecutar incluso si ya se ejecutó hoy
        hora_modificada_recientemente = False
        minutos_desde_update = 0
        if transfer.updated_at:
            updated_at_utc = transfer.updated_at
            updated_at_col = utc_to_colombia(updated_at_utc)
            
            time_since_update = now_colombia - updated_at_col
            if time_since_update <= timedelta(minutes=30):
                hora_modificada_recientemente = True
                minutos_desde_update = time_since_update.seconds // 60
        
        # Verificar si hay archivos pendientes de la última ejecución
        has_pending_files = False
        if transfer.last_error and transfer.last_error.startswith("PENDING_FILES:"):
            try:
                pending_count = int(transfer.last_error.split(":")[1])
                if pending_count > 0:
                    has_pending_files = True
            except (ValueError, IndexError):
                pass
        
        # PRIORIDAD 1: Si hay archivos pendientes, ejecutar si pasaron al menos 5 minutos desde la última ejecución
        if has_pending_files and transfer.last_processed:
            last_execution = transfer.last_processed
            last_execution_col = utc_to_colombia(last_execution)
            time_since_last = now_colombia - last_execution_col
            
            # Si pasaron al menos 5 minutos desde la última ejecución parcial, ejecutar de nuevo
            if time_since_last >= timedelta(minutes=5):
                return True
        
        # PRIORIDAD 2: Si la hora objetivo ya pasó hoy Y no se ha ejecutado hoy, ejecutar inmediatamente
        if current_minutes >= target_minutes:
            # Verificar si ya se ejecutó hoy
            ya_ejecutado_hoy = False
            if transfer.last_processed:
                last_execution = transfer.last_processed
                last_execution_col = utc_to_colombia(last_execution)
                if current_date == last_execution_col.date():
                    ya_ejecutado_hoy = True
            
            # Si NO se ha ejecutado hoy, ejecutar inmediatamente (sin importar si la hora fue modificada)
            if not ya_ejecutado_hoy:
                return True
            
            # Si ya se ejecutó hoy PERO la hora fue modificada recientemente, también ejecutar
            if ya_ejecutado_hoy and hora_modificada_recientemente:
                return True
            
            # Si ya se ejecutó hoy Y la hora NO fue modificada recientemente, no ejecutar
            return False
        
        # PRIORIDAD 2: Verificar si ya se ejecutó hoy (pero permitir si la hora fue modificada recientemente)
        if transfer.last_processed and not hora_modificada_recientemente:
            last_execution = transfer.last_processed
            last_execution_col = utc_to_colombia(last_execution)
            
            # Si ya se ejecutó hoy Y la hora NO fue modificada recientemente, no ejecutar
            if current_date == last_execution_col.date():
                return False
        
        # PRIORIDAD 3: Lógica normal: ejecutar si está dentro del margen de 5 minutos
        should_execute = time_diff <= 5
        
        if should_execute:
            return True
        else:
            return False
        
    except Exception as e:
        return False

def execute_transfer_simple(transfer, app):
    """Ejecuta transferencia (método simple) - NO lanza excepciones, retorna resultado con error si falla"""
    transfer_id = transfer.id
    credentials_json = transfer.credentials_json
    drive_original_id = transfer.drive_original_id
    drive_processed_id = transfer.drive_processed_id
    sender = None
    
    try:
        # Crear servicio (fuera del contexto de app para evitar problemas)
        service = DriveTransferService(credentials_json)
        try:
            with app.app_context():
                ensure_drive_telegram_columns()
                transfer_obj = DriveTransfer.query.get(transfer_id)
                if transfer_obj is not None:
                    from app.store.drive_telegram_send import DriveTelegramSender

                    sender = DriveTelegramSender(service)
                    sender.prepare(transfer_obj)
                    db.session.commit()
        except Exception:
            logger.warning('No se pudo preparar el envío de Drive a Telegram')
            if sender is not None and sender.tmp:
                import shutil
                shutil.rmtree(sender.tmp, ignore_errors=True)
                sender.tmp = ''
            sender = None
        
        # Ejecutar transferencia. Cada archivo movido se envía enseguida si hay grupo.
        def _save_send_notes():
            if sender is None:
                return
            try:
                with app.app_context():
                    note_row = DriveTransfer.query.get(transfer_id)
                    if note_row is not None:
                        sender.write_notes(note_row)
                        db.session.commit()
            except Exception:
                logger.warning('No se pudo anotar el resultado del envío a Telegram')

        def _send_moved(item, sender=sender):
            if sender is None or not sender.active or sender.skipped:
                return
            try:
                sender.send_one(item)
            except Exception:
                from app.store.drive_telegram_send import _problem
                sender.problems.append(_problem(
                    str(item.get('name') or ''),
                    '',
                    'El envío de este archivo se cortó antes de terminar.',
                ))
                logger.warning('No se pudo enviar a Telegram el archivo movido')
            _save_send_notes()

        processed_id = (drive_processed_id or '').strip()
        if processed_id:
            result = service.transfer_files(
                drive_original_id,
                processed_id,
                on_moved=_send_moved if sender is not None and sender.active else None,
            )
        else:
            result = service.publish_original_to_telegram(
                drive_original_id,
                on_file=_send_moved if sender is not None and sender.active else None,
            )
        
        # Verificar si la transferencia fue exitosa (completa o parcial)
        if result and isinstance(result, dict):
            transfer_completed = result.get('transfer_completed', False)
            files_moved = result.get('files_moved', 0)
            remaining_files = result.get('remaining_files', 0)
            
            # Actualizar base de datos dentro del contexto de app
            try:
                with app.app_context():
                    ensure_drive_telegram_columns()
                    # Recargar el objeto desde la base de datos para evitar problemas de sesión
                    transfer_obj = DriveTransfer.query.get(transfer_id)
                    if transfer_obj:
                        # Establecer activated_at si es la primera vez que se ejecuta
                        if not transfer_obj.activated_at:
                            transfer_obj.activated_at = datetime.utcnow()

                        extra_notes = []
                        try:
                            from app.store.telegram_user_ads import import_source_ads
                            extra_notes = import_source_ads(transfer_obj, service, sender) or []
                        except Exception as exc:
                            extra_notes = [{
                                'file': '',
                                'destino': '',
                                'problema': 'No se pudo copiar la publicidad de los grupos de Telegram (' + type(exc).__name__ + ').',
                            }]
                            logger.exception('No se pudo copiar la publicidad de los grupos de Telegram')
                        if sender is not None:
                            sender.problems.extend(extra_notes)
                        else:
                            from app.store.drive_telegram_send import _store_problems
                            _store_problems(transfer_obj, extra_notes)
                        
                        # Si se movieron archivos o se completó, actualizar last_processed
                        if result.get('drive_missing'):
                            transfer_obj.last_error = None
                        elif files_moved > 0 or transfer_completed:
                            transfer_obj.last_processed = datetime.utcnow()

                        if sender is not None:
                            try:
                                result['telegram'] = sender.finish(transfer_obj)
                            except Exception:
                                logger.warning('No se pudo guardar el resultado del envío a Telegram')
                                if sender.tmp:
                                    import shutil
                                    shutil.rmtree(sender.tmp, ignore_errors=True)
                                    sender.tmp = ''
                        
                        # Si la transferencia está completa, resetear errores
                        if result.get('drive_missing'):
                            pass
                        elif transfer_completed:
                            transfer_obj.consecutive_errors = 0
                            transfer_obj.last_error = None
                        elif files_moved > 0:
                            # Si se procesaron archivos pero quedan pendientes, reducir errores pero no resetear
                            if transfer_obj.consecutive_errors > 0:
                                transfer_obj.consecutive_errors = max(0, transfer_obj.consecutive_errors - 1)
                            
                            # Guardar información de archivos pendientes en last_error para permitir ejecuciones más frecuentes
                            if remaining_files > 0:
                                transfer_obj.last_error = f"PENDING_FILES:{remaining_files}"  # Marcar que hay archivos pendientes
                            else:
                                transfer_obj.last_error = None
                        
                        db.session.commit()
            except Exception as db_error:
                # Si falla la actualización de BD, no es crítico, continuar
                pass
        
        return result
        
    except Exception as e:
        if sender is not None and not sender.finished and sender.tmp:
            import shutil
            shutil.rmtree(sender.tmp, ignore_errors=True)
            sender.tmp = ''
        error_msg = 'La transferencia no se pudo completar'
        error_type = type(e).__name__
        logger.error('Error en transferencia de Drive: %s', error_type)
        
        # Actualizar contador de errores en base de datos
        try:
            with app.app_context():
                transfer_obj = DriveTransfer.query.get(transfer_id)
                if transfer_obj:
                    transfer_obj.consecutive_errors = (transfer_obj.consecutive_errors or 0) + 1
                    transfer_obj.last_error = error_msg[:500]  # Limitar longitud del error
                    
                    # Si hay muchos errores consecutivos (5 o más), desactivar automáticamente
                    if transfer_obj.consecutive_errors >= 5:
                        transfer_obj.is_active = False
                    
                    db.session.commit()
        except Exception as db_error:
            # Si falla la actualización de BD, continuar de todas formas
            pass
        
        # Retornar resultado con error en lugar de lanzar excepción
        return {
            'success': False,
            'error': error_msg,
            'error_type': error_type,
            'transfer_completed': False,
            'files_moved': 0,
            'files_failed': 0,
            'files_processed': 0,
            'consecutive_errors': getattr(transfer, 'consecutive_errors', 0) + 1
        }

def calculate_smart_wait_time(transfers):
    """Calcula tiempo de espera inteligente basado en los intervalos de las transferencias
    
    Estrategia:
    - Si hay archivos pendientes, revisar cada 5 minutos (máximo)
    - Calcula cuándo será la próxima ejecución para cada transferencia
    - Toma el intervalo más corto y espera hasta 5 minutos antes de esa ejecución
    - Mínimo 30 segundos, máximo 1 hora
    """
    try:
        if not transfers:
            return 3600  # 1 hora si no hay transferencias
        
        now_utc = datetime.utcnow()
        next_execution_times = []
        has_pending_files = False
        
        for transfer in transfers:
            # Verificar si hay archivos pendientes
            if transfer.last_error and transfer.last_error.startswith("PENDING_FILES:"):
                try:
                    pending_count = int(transfer.last_error.split(":")[1])
                    if pending_count > 0:
                        has_pending_files = True
                        # Si hay archivos pendientes, calcular tiempo desde última ejecución
                        if transfer.last_processed:
                            time_since_last = now_utc - transfer.last_processed
                            gap = timedelta(seconds=_pending_retry_seconds())
                            if time_since_last < gap:
                                time_until = gap - time_since_last
                                next_execution_times.append(time_until.total_seconds())
                            else:
                                next_execution_times.append(0)
                        else:
                            # No se ha ejecutado, puede ejecutarse inmediatamente
                            next_execution_times.append(0)
                        continue  # Ya procesamos este transfer, pasar al siguiente
                except (ValueError, IndexError):
                    pass
            
            # Parsear intervalo para transferencias sin archivos pendientes
            interval = parse_interval(transfer.processing_time)
            if not interval:
                continue
            
            # Calcular tiempo hasta la próxima ejecución
            if not transfer.last_processed:
                # Si nunca se ejecutó, usar activated_at o created_at
                reference_time = transfer.activated_at or transfer.created_at
                if not reference_time:
                    # Si no hay referencia, puede ejecutarse inmediatamente
                    next_execution_times.append(0)
                    continue
                
                # Calcular tiempo desde la referencia
                time_since_reference = now_utc - reference_time
                
                if time_since_reference >= interval:
                    # Ya debería ejecutarse
                    next_execution_times.append(0)
                else:
                    # Calcular cuánto falta
                    time_until = interval - time_since_reference
                    next_execution_times.append(time_until.total_seconds())
            else:
                # Si ya se ejecutó, calcular desde la última ejecución
                time_since_last = now_utc - transfer.last_processed
                
                if time_since_last >= interval:
                    # Ya debería ejecutarse
                    next_execution_times.append(0)
                else:
                    # Calcular cuánto falta
                    time_until = interval - time_since_last
                    next_execution_times.append(time_until.total_seconds())
        
        if not next_execution_times:
            return 3600  # 1 hora por defecto
        
        # Si hay archivos pendientes, revisar más frecuentemente (máximo 5 minutos)
        if has_pending_files:
            min_time = min(next_execution_times)
            return min(max(int(min_time), 5), 90)
        
        # Tomar el tiempo más corto y esperar hasta 5 minutos antes (mínimo 30 segundos)
        min_time = min(next_execution_times)
        wait_time = max(min_time - 300, 30)  # 5 minutos antes, mínimo 30 segundos
        
        # Limitar a máximo 1 hora
        return min(int(wait_time), 3600)
        
    except Exception as e:
        return 3600  # 1 hora en caso de error

# Variable global para evitar múltiples inicializaciones
_drive_loop_started = False
_drive_loop_lock = threading.Lock()

def start_simple_drive_loop(app):
    """Inicia el loop de Drive en un solo proceso por máquina (lock de archivo)."""
    global _drive_loop_started

    if app is None:
        return

    with _drive_loop_lock:
        if _drive_loop_started:
            return

        from app.utils.process_lock import process_lock_acquired, try_acquire_process_lock

        lock_fd = try_acquire_process_lock('/tmp/proyectoimap_drive_loop.lock')
        if not process_lock_acquired(lock_fd):
            return

        _drive_loop_started = True

    import threading
    import time

    def simple_drive_loop():
        while True:
            try:
                with app.app_context():
                    # Verificar limpiezas programadas (con manejo de errores)
                    try:
                        check_scheduled_cleanups()
                    except Exception as cleanup_error:
                        # Error en limpieza programada, continuar de todas formas
                        pass
                    
                    # Obtener configuraciones activas
                    try:
                        active_transfers = DriveTransfer.query.filter_by(is_active=True).all()
                    except Exception as query_error:
                        # Error al consultar BD, esperar y reintentar
                        time.sleep(60)
                        continue
                    
                    if not active_transfers:
                        time.sleep(60)  # Esperar 1 minuto para detectar cambios rápido
                        continue
                    
                    # Verificar cada transferencia con manejo individual de errores
                    for transfer in active_transfers:
                        try:
                            if should_execute_simple(transfer):
                                # Ejecutar transferencia (no lanza excepciones, retorna resultado con error si falla)
                                result = execute_transfer_simple(transfer, app)
                                # El resultado ya maneja errores internamente, no lanzará excepciones
                                # Si hay error, está registrado en result y en la BD, continuar con siguiente
                        except Exception as transfer_error:
                            # Capturar cualquier error inesperado sin detener el loop
                            try:
                                with app.app_context():
                                    transfer_obj = DriveTransfer.query.get(transfer.id)
                                    if transfer_obj:
                                        transfer_obj.consecutive_errors = (transfer_obj.consecutive_errors or 0) + 1
                                        transfer_obj.last_error = str(transfer_error)[:500]
                                        if transfer_obj.consecutive_errors >= 5:
                                            transfer_obj.is_active = False
                                        db.session.commit()
                            except Exception:
                                # Si falla la actualización de BD, continuar de todas formas
                                pass
                            # Continuar con la siguiente transferencia sin detener el loop
                            continue
                
                # Calcular tiempo de espera inteligente (ya optimizado internamente)
                try:
                    wait_time = calculate_smart_wait_time(active_transfers)
                except Exception:
                    # Si falla el cálculo, usar tiempo por defecto seguro
                    wait_time = 60
                
                time.sleep(wait_time)
                
            except Exception as e:
                # Error crítico en el loop principal, esperar y reintentar
                # No detener el loop nunca
                time.sleep(60)  # Esperar 1 minuto antes de reintentar
    
    # Iniciar loop en thread separado
    thread = threading.Thread(target=simple_drive_loop, daemon=True)
    thread.start()

# ==================== SISTEMA DE LIMPIEZA PROGRAMADA ====================

# Diccionario para almacenar tareas de limpieza programadas (thread-safe)
import threading
scheduled_cleanup_tasks = {}
cleanup_tasks_lock = threading.Lock()

def schedule_cleanup_task(transfer_id, days_old, scheduled_time):
    """Programa una tarea de limpieza para una hora específica"""
    try:
        from datetime import datetime, time as dt_time
        
        # Generar ID único para la tarea
        # Usar UTC para el task_id, independientemente de la zona horaria del servidor
        task_id = f"cleanup_{transfer_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        
        # Almacenar información de la tarea (thread-safe)
        with cleanup_tasks_lock:
            scheduled_cleanup_tasks[task_id] = {
                'transfer_id': transfer_id,
                'days_old': days_old,
                'scheduled_time': scheduled_time,
                'created_at': datetime.utcnow(),  # Siempre usar UTC
                'status': 'scheduled'
            }
        
        return task_id
        
    except Exception as e:
        return None

def check_scheduled_cleanups():
    """Verifica si hay limpiezas programadas que deben ejecutarse."""
    try:
        from datetime import datetime, time as dt_time

        # Usar módulo centralizado de timezone
        now_colombia = get_colombia_datetime()
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
        # Usar UTC para comparaciones, independientemente de la zona horaria del servidor
        cutoff_time = datetime.utcnow() - timedelta(hours=1)
        
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
    """Ejecuta una limpieza programada (requiere app_context del llamador)."""
    try:
        if task_id not in scheduled_cleanup_tasks:
            return False

        task_info = scheduled_cleanup_tasks[task_id]
        transfer_id = task_info['transfer_id']
        days_old = task_info['days_old']

        scheduled_cleanup_tasks[task_id]['status'] = 'running'

        from app.store.models import DriveTransfer

        transfer = DriveTransfer.query.get(transfer_id)
        if not transfer:
            scheduled_cleanup_tasks[task_id]['status'] = 'failed'
            return False

        service = DriveTransferService(transfer.credentials_json)
        result = service.cleanup_old_files(
            transfer.drive_processed_id,
            days_old,
            transfer.drive_deleted_id,
        )

        if result['success']:
            scheduled_cleanup_tasks[task_id]['status'] = 'completed'
            scheduled_cleanup_tasks[task_id]['result'] = result
            scheduled_cleanup_tasks[task_id]['completed_at'] = datetime.utcnow()
        else:
            scheduled_cleanup_tasks[task_id]['status'] = 'failed'
            scheduled_cleanup_tasks[task_id]['error'] = result['message']
            scheduled_cleanup_tasks[task_id]['failed_at'] = datetime.utcnow()

        return result['success']

    except Exception as e:
        if task_id in scheduled_cleanup_tasks:
            scheduled_cleanup_tasks[task_id]['status'] = 'failed'
            scheduled_cleanup_tasks[task_id]['error'] = str(e)
        return False

# ==================== INSTANCIA GLOBAL ====================

# Drive Transfer deshabilitado temporalmente
# drive_auto_scheduler = DriveAutoScheduler()
