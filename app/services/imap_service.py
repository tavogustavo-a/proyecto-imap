# app/services/imap_service.py

import ssl
import os
import errno
import socket
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

_MSG_SIN_INTERNET = "No tienes internet. Prueba nuevamente."
_MSG_HOST_MAL = "El servidor no existe o está mal escrito. Revisa el host."
_MSG_LOGIN = "El usuario o la contraseña son incorrectos."
_MSG_PUERTO = "El servidor rechazó la conexión. Revisa el puerto. Lo habitual es 993."
_MSG_TIEMPO = "El servidor no contestó a tiempo. Revisa el host, el puerto o tu internet, y prueba nuevamente."
_MSG_SSL = "No se pudo conectar de forma segura. Revisa que el puerto sea 993."
_MSG_GENERICO = "No se pudo probar el servidor. Revisa el host, el puerto, el usuario y la contraseña, y prueba nuevamente."


def _internet_disponible():
    """True si este equipo puede resolver un nombre público."""
    try:
        socket.getaddrinfo("dns.google", 443)
        return True
    except Exception:
        return False


def _mensaje_login_imap(exc):
    texto = str(exc).lower()
    if "application-specific password" in texto or "contraseña de aplicación" in texto:
        return "La contraseña no sirve para IMAP. Esta cuenta pide una contraseña de aplicación."
    if "web login" in texto or "log in via your web browser" in texto or "please log in" in texto:
        return "El correo bloqueó el acceso. Entra en la web del correo, permite IMAP y prueba nuevamente."
    return _MSG_LOGIN


def _mensaje_error_red(exc):
    code = getattr(exc, "errno", None)
    if code in (errno.ENETUNREACH, errno.ENETDOWN, errno.EHOSTUNREACH, errno.ENETRESET):
        return _MSG_SIN_INTERNET
    if code in (errno.ECONNREFUSED,):
        return _MSG_PUERTO
    if code in (errno.ETIMEDOUT, errno.EHOSTDOWN):
        return _MSG_TIEMPO
    if not _internet_disponible():
        return _MSG_SIN_INTERNET
    return _MSG_GENERICO

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
    except Exception:
        return False, "No se pudo leer la contraseña guardada. Vuelve a escribirla, guarda y prueba nuevamente."

    if not (srv.host or "").strip():
        return False, _MSG_HOST_MAL
    if not (srv.username or "").strip():
        return False, "Falta el usuario. Escríbelo y prueba nuevamente."
    if not password:
        return False, "Falta la contraseña. Escríbela, guarda y prueba nuevamente."

    context = ssl.create_default_context()
    try:
        with IMAPClient(host=srv.host, port=srv.port, ssl=True, ssl_context=context, timeout=10) as client:
            client.login(srv.username, password)
        return True, "Conexión correcta. El servidor, el usuario y la contraseña funcionan."

    except gaierror:
        if not _internet_disponible():
            return False, _MSG_SIN_INTERNET
        return False, _MSG_HOST_MAL
    except (timeout, TimeoutError):
        if not _internet_disponible():
            return False, _MSG_SIN_INTERNET
        return False, _MSG_TIEMPO
    except ConnectionRefusedError:
        return False, _MSG_PUERTO
    except imap_exceptions.LoginError as e:
        return False, _mensaje_login_imap(e)
    except SSLError:
        return False, _MSG_SSL
    except imap_exceptions.IMAPClientError:
        if not _internet_disponible():
            return False, _MSG_SIN_INTERNET
        return False, _MSG_GENERICO
    except IMAP4.error as e:
        texto = str(e).lower()
        if "auth" in texto or "login" in texto or "credentials" in texto or "password" in texto:
            return False, _mensaje_login_imap(e)
        return False, _MSG_GENERICO
    except OSError as e:
        return False, _mensaje_error_red(e)
    except Exception as e:
        if current_app:
            current_app.logger.warning("Fallo al probar IMAP %s: %s", getattr(srv, "id", "?"), e)
        if not _internet_disponible():
            return False, _MSG_SIN_INTERNET
        return False, _MSG_GENERICO

def delete_imap_server(server_id, model_cls=IMAPServer):
    """
    Elimina un servidor IMAP y todas sus relaciones asociadas.
    Para IMAPServer2, también limpia las relaciones M2M con filtros y regex,
    y elimina el fondo personalizado si existe.
    y elimina todos los servidores IMAP vinculados.
    """
    srv = model_cls.query.get_or_404(server_id)

    # Las reglas del observador ya no usan un IMAP concreto. Si una regla vieja
    # todavía apunta a este servidor, se conserva y solo se suelta el vínculo.
    if getattr(srv, '__tablename__', '') == 'imap_servers':
        from app.models.security_rules import SecurityRule
        SecurityRule.query.filter_by(imap_server_id=srv.id).update(
            {SecurityRule.imap_server_id: None},
            synchronize_session=False,
        )
        db.session.flush()
    
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
        # allowed_users es lazy="dynamic", así que necesitamos obtener la lista primero
        linked_users = list(srv.allowed_users.all())
        for user in linked_users:
            srv.allowed_users.remove(user)
        db.session.flush()  # Aplicar cambios antes de eliminar

    if getattr(srv, '__tablename__', '') == 'imap_servers2':
        from app.models.imap2 import IMAP2TwoFAConfig
        IMAP2TwoFAConfig.query.filter_by(imap_server_id=srv.id).delete(synchronize_session=False)
        db.session.flush()
    
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
    cleanup_orphaned_imap2_backgrounds()


def cleanup_orphaned_imap2_backgrounds(app=None) -> int:
    """Elimina archivos en imap2_backgrounds sin referencia en IMAPServer2.background_image."""
    import logging

    log = logging.getLogger(__name__)

    def _run() -> int:
        from app.models.imap2 import IMAPServer2

        upload_dir = os.path.join(current_app.root_path, 'static', 'uploads', 'imap2_backgrounds')
        if not os.path.isdir(upload_dir):
            return 0

        used_backgrounds = {
            srv.background_image
            for srv in IMAPServer2.query.all()
            if srv.background_image
        }

        deleted = 0
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            if not os.path.isfile(file_path):
                continue
            if filename in used_backgrounds:
                continue
            try:
                os.remove(file_path)
                deleted += 1
                log.info('Fondo IMAP2 huérfano eliminado: %s', filename)
            except OSError as exc:
                log.warning('No se pudo eliminar fondo huérfano %s: %s', filename, exc)
        return deleted

    try:
        if app is not None:
            with app.app_context():
                return _run()
        return _run()
    except Exception as exc:
        log.exception('Error limpiando fondos IMAP2 huérfanos: %s', exc)
        return 0


def search_imap_with_days(server, to_address, limit_days=2):
    """
    Búsqueda IMAP con limit_days días atrás. 
    """
    results = []
    password = decrypt_password(server.password_enc)
    context = ssl.create_default_context()
    folder_list = server.folders.split(",")

    try:
        with IMAPClient(host=server.host, port=server.port, ssl=True, ssl_context=context, timeout=30) as client:
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

    except gaierror:
        # Error de DNS: no se pudo resolver el hostname
        # Silenciar el error completamente (no loguear)
        return results
    except timeout:
        # Timeout de conexión
        # Silenciar el error completamente (no loguear)
        return results
    except ConnectionRefusedError:
        # Conexión rechazada
        # Silenciar el error completamente (no loguear)
        return results
    except imap_exceptions.LoginError:
        # Error de login
        # Silenciar el error completamente (no loguear)
        return results
    except SSLError:
        # Error de SSL
        # Silenciar el error completamente (no loguear)
        return results
    except imap_exceptions.IMAPClientError:
        # Otros errores de IMAPClient
        # Silenciar el error completamente (no loguear)
        return results
    except Exception:
        # Otros errores no esperados - silenciar completamente
        return results

    return results
