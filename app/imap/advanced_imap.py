# app/imap/advanced_imap.py
import gevent
from gevent.pool import Pool
import ssl
from imapclient import exceptions as imap_exceptions
from datetime import datetime, timezone, timedelta
import re
from imapclient import IMAPClient
from email.header import decode_header, make_header
from flask import current_app

# Constantes de configuración IMAP
_IMAP_MODULE_SIG = 0x1B3E
_IMAP_MODULE_VER = 0x4A2F

# Eliminado semáforo global; la concurrencia se controla únicamente con el tamaño del Pool (GEVENT_POOL_SIZE).

# Eliminado semáforo global; la concurrencia se controla únicamente con el tamaño del Pool (GEVENT_POOL_SIZE).

def search_in_all_servers(to_address, servers, limit_days=2):
    """
    Realiza la búsqueda en paralelo (gevent) sobre cada servidor IMAP.
    - limit_days=2 => busca correos de los últimos 2 días.
    - limit_days=None => sin límite.
    """
    if not servers:
        return []

    # Obtener la instancia real de la app aquí, donde current_app está disponible
    app_instance = current_app._get_current_object()

    pool_size = app_instance.config.get("GEVENT_POOL_SIZE", 5)
    pool = Pool(min(len(servers), pool_size))

    # Pasar app_instance al worker
    def worker(current_app_for_worker, server_obj, target_email, days_limit):
        from app.services.imap_service import search_imap_with_days # Asumiendo que esta usa current_app internamente
        import gevent

        attempts = 2
        while attempts > 0:
            # Empujar el contexto de la aplicación para este greenlet
            with current_app_for_worker.app_context(): 
                try:
                    # No necesitamos CONNECTION_LOCK si GEVENT_POOL_SIZE controla la concurrencia
                    return search_imap_with_days(server_obj, target_email, days_limit)
                except imap_exceptions.IMAPClientError as e:
                    if "Too many simultaneous connections" in str(e):
                        gevent.sleep(2)
                        attempts -= 1
                        continue
                    else:
                        return []
                except Exception as ex:
                    return []
        return []

    jobs = [pool.spawn(worker, app_instance, srv, to_address, limit_days) for srv in servers]
    gevent.joinall(jobs)

    results = []
    for job in jobs:
        if job.value:
            results.extend(job.value)
    return results

# --- FUNCIÓN CON ESTRUCTURA PARA IMPLEMENTAR ---
def search_raw_email_by_id(email_id_to_search, servers):
    """
    Busca un correo específico por su identificador (Message-ID idealmente)
    en los servidores IMAP proporcionados.
    Devuelve el contenido RAW del correo (string) si se encuentra, o None.
    """
    if not email_id_to_search or not servers:
        return None

    pool_size = current_app.config.get("GEVENT_POOL_SIZE", 5)
    pool = Pool(min(len(servers), pool_size))

    search_criteria_final = None
    # Limpiar y verificar el Message-ID (debe ser solo el ID, sin '<' ni '>')
    # La búsqueda IMAP por HEADER Message-ID espera solo el ID.
    cleaned_email_id = email_id_to_search.strip()
    if cleaned_email_id.startswith('<') and cleaned_email_id.endswith('>'):
        cleaned_email_id = cleaned_email_id[1:-1]
    
    if '@' in cleaned_email_id: # Un Message-ID válido usualmente tiene @
        search_criteria_final = ['HEADER', 'Message-ID', cleaned_email_id] # Criterio para buscar el ID limpio
    else:
        return None

    def worker(server):
        from flask import current_app
        from app.services.imap_service import decrypt_password # SOLO decrypt_password
        from imapclient import IMAPClient, exceptions as imap_exceptions
        import ssl
        import gevent
        import email
        from datetime import datetime, timezone # Para los logs internos

        mail_content_raw_str = None
        client = None
        attempts = 1 # Reintentos pueden ser complicados aquí sin UIDs estables

        folders = [f.strip() for f in server.folders.split(',') if f.strip()]
        if not folders: folders = ['INBOX']

        while attempts > 0:
            try:
                # Concurrencia controlada solo por el Pool
                context = ssl.create_default_context()
                client = IMAPClient(host=server.host, port=server.port, ssl=True, ssl_context=context, timeout=60) # Timeout aumentado a 60
                password = decrypt_password(server.password_enc) # Sin 'app'
                client.login(server.username, password)

                for folder_name in folders:
                    try:
                        client.select_folder(folder_name, readonly=True)
                        uids = client.search(search_criteria_final)
                        
                        if uids:
                            # Obtener el cuerpo RAW del primer UID encontrado
                            fetch_result = client.fetch(uids[0], [b'BODY.PEEK[]'])
                            if uids[0] in fetch_result and b'BODY[]' in fetch_result[uids[0]]:
                                raw_email_bytes = fetch_result[uids[0]][b'BODY[]']
                                mail_content_raw_str = raw_email_bytes.decode('utf-8', errors='replace')
                                if client:
                                    try:
                                        client.logout()
                                    except:
                                        pass
                                return mail_content_raw_str # Devolver inmediatamente
                    except imap_exceptions.IMAPClientError as folder_err:
                        pass
                    if mail_content_raw_str: # Si ya lo encontramos en una carpeta, no seguir
                        break
                
                if client:
                    try:
                        client.logout()
                    except:
                        pass
                break # Salir del while si no hubo errores de conexión mayores

            except imap_exceptions.LoginError as le:
                current_app.logger.error(f"search_raw_email_by_id: [ERROR Login IMAP] {server.host}:{server.port} - {le}")
                break 
            except imap_exceptions.IMAPClientError as e:
                if "Too many simultaneous connections" in str(e) and attempts > 1:
                    if client:
                        try: 
                            client.logout()
                        except: 
                            pass
                    gevent.sleep(2)
                    attempts -= 1
                    continue
                else:
                    current_app.logger.error(f"search_raw_email_by_id: [ERROR IMAP Worker] {server.host}: {e}")
                    break 
            except Exception as ex:
                current_app.logger.error(f"search_raw_email_by_id: [ERROR Genérico Worker] {server.host}: {ex}", exc_info=True)
                break 
            finally:
                try: 
                    if client:
                        client.logout() 
                except: 
                    pass 
            
            attempts = 0 
        
        return mail_content_raw_str

    jobs = [pool.spawn(worker, srv) for srv in servers]
    gevent.joinall(jobs, timeout=30) # Añadir un timeout global para los jobs

    for job in jobs:
        if job.value: # Devuelve el primer resultado no-None
            return job.value 
            
    return None
# --- Fin Nueva Función ---

def search_emails_for_observer(servers, since_date_utc, optional_sender_from_rule=None):
    """
    Busca correos en los servidores IMAP para la tarea del observador.
    Devuelve lista de dicts: [{'message_id': str, 'from': str, 'to': list, 'subject': str, 'body_raw': str}]
    """
    if not servers:

        return []

    # Obtener la instancia real de la app aquí
    app_instance = current_app._get_current_object()

    pool_size = app_instance.config.get("GEVENT_POOL_SIZE", 5)
    pool = Pool(min(len(servers), pool_size))
    
    search_criteria = ['SINCE', since_date_utc.strftime("%d-%b-%Y")]
    if optional_sender_from_rule:
        search_criteria.extend(['FROM', optional_sender_from_rule])

    # Pasar app_instance al worker
    def worker(current_app_for_worker, server_obj, search_criteria_for_worker, since_date_for_worker):
        from app.services.imap_service import decrypt_password
        from imapclient import IMAPClient, exceptions as imap_exceptions
        import ssl
        import gevent
        import email
        from datetime import datetime, timezone, timedelta # Asegurar timedelta

        found_mails_list = [] 
        client = None
        folders = [f.strip() for f in server_obj.folders.split(',') if f.strip()] or ['INBOX']

        # Empujar el contexto de la aplicación para este greenlet
        with current_app_for_worker.app_context():
            try:
                # Concurrencia controlada solo por el Pool
                worker_current_app = current_app_for_worker
                
                context = ssl.create_default_context()
                client = IMAPClient(host=server_obj.host, port=server_obj.port, ssl=True, ssl_context=context, timeout=60)
                
                password = decrypt_password(server_obj.password_enc)
                client.login(server_obj.username, password)

                for folder_name in folders:
                    try:
                        client.select_folder(folder_name, readonly=True)
                        uids = client.search(search_criteria_for_worker)
                        
                        if uids:
                            uids_to_fetch = uids[-worker_current_app.config.get("OBSERVER_MAX_EMAILS_PER_FOLDER", 50):]
                            if not uids_to_fetch: continue
                            fetched_data = dict(client.fetch(uids_to_fetch, [b'UID', b'ENVELOPE', b'RFC822', b'INTERNALDATE']))
                            
                            for uid_key, data in fetched_data.items():
                                internal_date_dt = data.get(b'INTERNALDATE')
                                strict_window = True # Re-evaluar cómo manejar esto si es necesario
                                try:
                                    from app.admin.site_settings import get_site_setting # Importación local
                                    strict_window = get_site_setting("observer_strict_time_window", "true").lower() in ("true", "1", "yes")
                                except Exception:
                                    strict_window = True

                                if internal_date_dt and strict_window:
                                    try:
                                        mail_dt_utc = internal_date_dt
                                        if internal_date_dt.tzinfo is not None:
                                            mail_dt_utc = internal_date_dt.astimezone(timezone.utc)
                                        else:
                                            mail_dt_utc = internal_date_dt.replace(tzinfo=timezone.utc)
                                        if mail_dt_utc < (since_date_for_worker - timedelta(minutes=1)):
                                            continue
                                    except Exception as dt_err:
                                        pass
                                raw_email_bytes = data.get(b'RFC822')
                                envelope_data = data.get(b'ENVELOPE')
                                if not raw_email_bytes or not envelope_data:
                                    continue
                                msg = email.message_from_bytes(raw_email_bytes)
                                message_id_header = msg.get('Message-ID')
                                message_id_cleaned = None
                                if message_id_header:
                                    message_id_cleaned = message_id_header.strip()
                                    if message_id_cleaned.startswith('<') and message_id_cleaned.endswith('>'):
                                        message_id_cleaned = message_id_cleaned[1:-1]
                                from_address_str = str(make_header(decode_header(msg.get("From",""))))
                                to_addresses_list = []
                                to_header = msg.get_all('To', [])
                                cc_header = msg.get_all('Cc', [])
                                for raw_to in to_header + cc_header:
                                    for addr_name, addr_email in email.utils.getaddresses([raw_to]):
                                        if addr_email: to_addresses_list.append(addr_email)
                                subject_str = str(make_header(decode_header(msg.get("Subject",""))))
                                body_content_str = ""
                                if msg.is_multipart():
                                    for part in msg.walk():
                                        ctype = part.get_content_type()
                                        cdispo = str(part.get('Content-Disposition'))
                                        if 'attachment' not in cdispo.lower() and part.get_payload(decode=True):
                                            if ctype == 'text/plain' or ctype == 'text/html':
                                                try:
                                                    payload_bytes = part.get_payload(decode=True)
                                                    charset = part.get_content_charset() or 'utf-8'
                                                    body_content_str += payload_bytes.decode(charset, errors='replace')
                                                except Exception as e_payload_decode: 
                                                    pass 
                                                body_content_str += "\n"
                                else:
                                    try:
                                        payload_bytes = msg.get_payload(decode=True)
                                        charset = msg.get_content_charset() or 'utf-8'
                                        body_content_str = payload_bytes.decode(charset, errors='replace')
                                    except Exception as e_payload_decode_single:
                                        pass
                                found_mails_list.append({
                                    'message_id': message_id_cleaned,
                                    'from': from_address_str,
                                    'to': list(set(to_addresses_list)),
                                    'subject': subject_str,
                                    'body_raw': body_content_str.strip()
                                })
                    except imap_exceptions.IMAPClientError as folder_err:
                        pass
                    except Exception as e_fetch:
                        worker_current_app.logger.error(f"[{current_time_str_worker}] [OBSERVER_IMAP_SEARCH] Error fetch/parse en {folder_name} para {server_obj.host}: {e_fetch}", exc_info=True)
                if client: 
                    try: client.logout()
                    except: pass
            except imap_exceptions.LoginError as le:
                worker_current_app.logger.error(f"[{current_time_str_worker}] [OBSERVER_IMAP_SEARCH] LoginError en {server_obj.host}: {le}")
            except Exception as ex:
                worker_current_app.logger.error(f"[{current_time_str_worker}] [OBSERVER_IMAP_SEARCH] Error genérico worker {server_obj.host}: {ex}", exc_info=True)
            finally:
                if client: 
                    try: client.logout()
                    except: pass 
        return found_mails_list

    all_found_emails = []
    # Pasar app_instance, server, search_criteria, y since_date_utc al worker
    jobs = [pool.spawn(worker, app_instance, srv, search_criteria, since_date_utc) for srv in servers]
    gevent.joinall(jobs, timeout=app_instance.config.get("OBSERVER_IMAP_JOB_TIMEOUT", 120))

    for job in jobs:
        if job.value:
            all_found_emails.extend(job.value)
    
    return all_found_emails

# --- Nueva utilidad: borrar correos por Message-ID ---
def delete_emails_by_message_id(servers, message_id):
    r"""Marca como eliminados (\Deleted) y expunge los correos cuyo Message-ID coincida.
    No lanza excepción; sólo registra en logs.
    """
    if not message_id or not servers:
        return

    cleaned_id = message_id.strip()
    if cleaned_id.startswith('<') and cleaned_id.endswith('>'):
        cleaned_id = cleaned_id[1:-1]

    search_criteria = ['HEADER', 'Message-ID', cleaned_id]

    for server in servers:
        try:
            from app.services.imap_service import decrypt_password
            context = ssl.create_default_context()
            client = IMAPClient(host=server.host, port=server.port, ssl=True, ssl_context=context, timeout=60)
            client.login(server.username, decrypt_password(server.password_enc))

            folders = [f.strip() for f in server.folders.split(',') if f.strip()] or ['INBOX']
            for folder in folders:
                try:
                    client.select_folder(folder, readonly=False)
                    uids = client.search(search_criteria)
                    if not uids:
                        continue
                    client.set_flags(uids, [b'\\Deleted'])
                    client.expunge()

                except Exception as fol_err:
                    pass
            try:
                client.logout()
            except:
                pass
        except Exception as conn_err:
            pass
