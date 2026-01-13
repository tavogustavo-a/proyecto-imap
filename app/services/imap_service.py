# app/services/imap_service.py

import ssl
import traceback
import os
from datetime import datetime, timedelta
from socket import gaierror, timeout
from imaplib import IMAP4
from ssl import SSLError
from imapclient import IMAPClient, exceptions as imap_exceptions
from flask import current_app
from app.extensions import db
from app.models import IMAPServer
from app.services.imap_crypto import encrypt_password, decrypt_password
from app.imap.parser import parse_raw_email

def create_imap_server(host, port, username, password_plain, folders="INBOX", description=None, model_cls=IMAPServer):
    """Crea un registro IMAPServer (o subclase) parametrizable."""
    password_enc = encrypt_password(password_plain)
    srv = model_cls(
        host=host,
        port=port,
        username=username,
        password_enc=password_enc,
        folders=folders or "INBOX"
    )
    # Agregar description si el modelo lo soporta y se proporciona
    if hasattr(srv, 'description') and description:
        srv.description = description
    db.session.add(srv)
    db.session.commit()
    return srv

def update_imap_server(server_id, host, port, username, password_plain, folders="INBOX", description=None, model_cls=IMAPServer):
    srv = model_cls.query.get_or_404(server_id)
    srv.host = host
    srv.port = port
    srv.username = username

    if password_plain.strip():
        srv.password_enc = encrypt_password(password_plain)

    srv.folders = folders or "INBOX"
    
    # Actualizar description si el modelo lo soporta
    if hasattr(srv, 'description'):
        srv.description = description if description else None
    
    db.session.commit()
    return srv

def test_imap_connection(server_id, model_cls=IMAPServer):
    """
    Intenta conectar y loguearse al servidor IMAP.
    Devuelve una tupla (bool, str): (éxito, mensaje).
    No lanza excepciones directamente, las captura y las devuelve en el mensaje.
    """
    srv = model_cls.query.get_or_404(server_id)
    try:
        password = decrypt_password(srv.password_enc)
    except Exception as e: # Error al desencriptar (p.ej. clave incorrecta)
        # print(f"Error desencriptando contraseña para {srv.host}: {e}")
        # Podrías loggear el traceback completo aquí si quieres: traceback.print_exc()
        return False, f"Error interno al procesar la contraseña almacenada: {e}"

    context = ssl.create_default_context()
    try:
        with IMAPClient(host=srv.host, port=srv.port, ssl=True, ssl_context=context, timeout=10) as client: # Añadir timeout
            client.login(srv.username, password)
        # Si llegamos aquí, la conexión y login fueron exitosos
        return True, "Conexión y login exitosos."

    # Capturar errores específicos
    except gaierror:
        # traceback.print_exc() # Opcional: loggear para depuración
        return False, "Error de DNS: No se pudo resolver el nombre del host."
    except timeout:
        # traceback.print_exc()
        return False, "Error: Tiempo de espera agotado al intentar conectar."
    except ConnectionRefusedError:
        # traceback.print_exc()
        return False, "Error: Conexión rechazada por el servidor."
    except imap_exceptions.LoginError:
        # traceback.print_exc()
        return False, "Error de Login: Usuario o contraseña incorrectos."
    except imap_exceptions.IMAPClientError as e: # Otros errores de la librería IMAPClient
         # traceback.print_exc()
         return False, f"Error de IMAPClient: {e}"
    except SSLError as e:
        # traceback.print_exc()
        return False, f"Error de SSL: {e}. ¿El puerto o la configuración SSL son correctos?"
    except IMAP4.error as e: # Errores generales de imaplib
        # traceback.print_exc()
        return False, f"Error de IMAP: {e}"
    except Exception as e: # Captura genérica para otros errores
        traceback.print_exc() # Loggear este porque es inesperado
        return False, f"Error inesperado durante la conexión: {e}"

def delete_imap_server(server_id, model_cls=IMAPServer):
    """
    Elimina un servidor IMAP y todas sus relaciones asociadas.
    Para IMAPServer2, también limpia las relaciones M2M con filtros y regex,
    y elimina el fondo personalizado si existe.
    y elimina todos los servidores IMAP vinculados.
    """
    srv = model_cls.query.get_or_404(server_id)
    
    # Si es IMAPServer2, eliminar todos los servidores IMAP vinculados primero
    if hasattr(srv, 'linked_imap_servers'):
        # Obtener lista de servidores vinculados antes de eliminarlos
        linked_servers = list(srv.linked_imap_servers.all())
        # Eliminar cada servidor IMAP vinculado (son exclusivos de este IMAP2)
        for linked_imap in linked_servers:
            db.session.delete(linked_imap)
        db.session.flush()  # Aplicar cambios antes de continuar
    
    # Si es IMAPServer2, limpiar explícitamente las relaciones M2M antes de eliminar
    # Verificar por el nombre de la tabla para ser más seguro
    if hasattr(srv, 'filters') and hasattr(srv, 'regexes'):
        # Limpiar relaciones con filtros y regex (aunque CASCADE debería hacerlo, 
        # es mejor hacerlo explícitamente para evitar problemas y asegurar limpieza completa)
        srv.filters.clear()
        srv.regexes.clear()
        db.session.flush()  # Aplicar cambios antes de eliminar
    
    # Si es IMAPServer2, limpiar también relaciones M2M con usuarios (aunque CASCADE debería hacerlo)
    if hasattr(srv, 'allowed_users'):
        srv.allowed_users.clear()
        db.session.flush()  # Aplicar cambios antes de eliminar
    
    # Si es IMAPServer2 y tiene fondo personalizado, eliminarlo del sistema de archivos
    if hasattr(srv, 'background_image') and srv.background_image:
        try:
            upload_dir = os.path.join(current_app.root_path, 'static', 'uploads', 'imap2_backgrounds')
            file_path = os.path.join(upload_dir, srv.background_image)
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception as e:
            # Loggear el error pero no fallar la eliminación del servidor
            if current_app:
                current_app.logger.warning(f"No se pudo eliminar el fondo personalizado: {e}")
    
    db.session.delete(srv)
    db.session.commit()

def search_imap_with_days(server, to_address, limit_days=2):
    """
    Búsqueda IMAP con limit_days días atrás. 
    """
    results = []
    password = decrypt_password(server.password_enc)
    context = ssl.create_default_context()
    folder_list = server.folders.split(",")

    try:
        with IMAPClient(host=server.host, port=server.port, ssl=True, ssl_context=context) as client:
            client.login(server.username, password)

            for folder_name in folder_list:
                folder_name = folder_name.strip() or "INBOX"
                try:
                    client.select_folder(folder_name)
                except imap_exceptions.IMAPClientError as e:
                    continue

                if limit_days is None:
                    search_criteria = ['TO', to_address]
                else:
                    since_date = (datetime.now() - timedelta(days=limit_days)).strftime("%d-%b-%Y")
                    search_criteria = ['TO', to_address, 'SENTSINCE', since_date]

                message_ids = client.search(search_criteria)
                if message_ids:
                    fetched = client.fetch(message_ids, [b'RFC822', b'INTERNALDATE'])
                    for _, data_dict in fetched.items():
                        raw_bytes = data_dict.get(b'RFC822')
                        if not raw_bytes:
                            continue
                        try:
                            parsed_mail = parse_raw_email(raw_bytes)
                        except (UnicodeDecodeError, UnicodeEncodeError) as e:
                            # Log específico para errores de codificación
                            print(f"Error de codificación al parsear email: {e}")
                            # Intentar con manejo más agresivo de errores
                            try:
                                if isinstance(raw_bytes, str):
                                    raw_bytes = raw_bytes.encode('utf-8', errors='replace')
                                parsed_mail = parse_raw_email(raw_bytes)
                            except Exception:
                                parsed_mail = None
                        except Exception as e:
                            print(f"Error general al parsear email: {e}")
                            parsed_mail = None
                        
                        if parsed_mail:
                            internal_date = data_dict.get(b'INTERNALDATE')
                            if internal_date:
                                parsed_mail["internal_date"] = internal_date
                            results.append(parsed_mail)

    except Exception as e:
        traceback.print_exc()

    return results
