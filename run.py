# run.py
import os
import atexit
import gevent.monkey
gevent.monkey.patch_all()

# Configuración para evitar errores de socket en Windows
import socket
socket.setdefaulttimeout(30)  # Timeout de 30 segundos para operaciones de socket

# Configurar warnings ANTES de cualquier import
import warnings
warnings.filterwarnings("ignore")
os.environ['PYTHONWARNINGS'] = 'ignore'

import click # Importar click para los comandos
from dotenv import load_dotenv
from cryptography.fernet import Fernet, InvalidToken
from werkzeug.security import generate_password_hash
from datetime import datetime, timedelta, timezone 
import re 
from app.models import User, RegexModel, ServiceModel, AppSecrets, SecurityRule, TriggerLog, RememberDevice, IMAPServer, ObserverIMAPServer
from app.admin.site_settings import get_site_setting, set_site_setting
from app.imap.advanced_imap import search_emails_for_observer, delete_emails_by_message_id
from app.services.email_service import send_security_alert_email 
import sqlalchemy
from app.helpers import safe_regex_search

# Cargar variables de entorno ANTES de importar app y config si dependen de ellas
load_dotenv()

from app import create_app, db # Importar db también
from config import Config

# Crear la app fuera de main para que los decoradores de comandos la usen
app = create_app(Config)

# Restaurar imports de scheduler si se mantiene la rotación de claves
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.executors.pool import ThreadPoolExecutor

warnings.filterwarnings("ignore", category=sqlalchemy.exc.SAWarning)

@app.cli.command("create-admin")
def create_admin_command():
    """Crea o actualiza el usuario administrador definido en .env."""
    admin_username = os.getenv("ADMIN_USER")
    admin_pass = os.getenv("ADMIN_PASS")

    if not admin_username or not admin_pass:
        return

    with app.app_context(): # Necesario para acceder a db.session
        admin = User.query.filter_by(username=admin_username).first()
        hashed_password = generate_password_hash(admin_pass)

        if admin:
            print(f"El usuario admin '{admin_username}' ya existe. Actualizando contraseña...")
            admin.password = hashed_password
        else:
            print(f"Creando usuario admin '{admin_username}'...")
            admin_email_from_env = os.getenv("ADMIN_EMAIL", None)
            admin = User(
                username=admin_username,
                password=hashed_password,
                email=admin_email_from_env,
                email_verified=True,
                twofa_enabled=False,
                twofa_method="TOTP",
                enabled=True,
                can_search_any=True,
                color='#ffffff',
                position=0
            )
            db.session.add(admin)

        try:
            db.session.commit()
            print(f"Usuario admin '{admin_username}' creado/actualizado exitosamente.")
        except Exception as e:
            db.session.rollback()
            print(f"Error al guardar el usuario admin: {e}")

@app.cli.command("seed-netflix-defaults")
def seed_netflix_defaults_command():
    """Crea/actualiza el Regex y Servicio 'Pais Netflix' predeterminados."""
    print("=== Iniciando seed para Regex y Servicio Netflix... ===")
    with app.app_context():
        try:
            pattern_netflix = r'(?i)_([A-Z]{2})_EVO'
            existing_nf = RegexModel.query.filter_by(
                sender='info@account.netflix.com',
                pattern=pattern_netflix
            ).first()
            netflix_regex_to_link = None

            if not existing_nf:
                print("Creando Regex Netflix...")
                new_nf = RegexModel(
                    sender='info@account.netflix.com',
                    pattern=pattern_netflix,
                    description="pais de netflix",
                    enabled=True,
                    protected=True
                )
                db.session.add(new_nf)
                db.session.flush()
                netflix_regex_to_link = new_nf
                print("Regex Netflix creado.")
            else:
                print("Regex Netflix ya existía. Asegurando estado...")
                existing_nf.enabled = True
                existing_nf.protected = True
                netflix_regex_to_link = existing_nf
                print("Regex Netflix asegurado.")

            existing_srv = ServiceModel.query.filter_by(name="Servicio Netflix").first()
            alt_srv = ServiceModel.query.filter_by(name="Pais Netflix").first()
            netflix_srv = None

            if alt_srv:
                print("'Pais Netflix' ya existía. Asegurando estado...")
                alt_srv.protected = True
                netflix_srv = alt_srv
                print("'Pais Netflix' asegurado.")
            elif existing_srv:
                print("Renombrando 'Servicio Netflix' a 'Pais Netflix'...")
                existing_srv.name = "Pais Netflix"
                existing_srv.protected = True
                netflix_srv = existing_srv
                print("'Pais Netflix' renombrado.")
            else:
                print("Creando servicio 'Pais Netflix'...")
                new_srv = ServiceModel(
                    name="Pais Netflix",
                    color="black",
                    border_color="#cc0000",
                    position=1,
                    enabled=True,
                    protected=True,
                    visibility_mode="on-todos"
                )
                db.session.add(new_srv)
                netflix_srv = new_srv
                print("Servicio 'Pais Netflix' creado.")

            if netflix_regex_to_link and netflix_srv:
                if netflix_regex_to_link not in netflix_srv.regexes:
                    print("Vinculando Regex Netflix => Pais Netflix...")
                    netflix_srv.regexes.append(netflix_regex_to_link)
                    print("Vinculación completada.")
                else:
                    print("Regex Netflix ya estaba vinculado a Pais Netflix.")
            else:
                print("ADVERTENCIA: No se pudo realizar la vinculación (Regex o Servicio no encontrados).")

            db.session.commit()
            print("=== Seed para Netflix completado exitosamente. ===")

        except Exception as e:
            db.session.rollback()
            print(f"ERROR FATAL durante el seed de Netflix: {e}")

@app.cli.command("init-imap-keys")
def init_imap_keys_command():
    """Inicializa CURRENT_IMAP_KEY y NEXT_IMAP_KEY en AppSecrets si no existen."""
    print("=== Iniciando inicialización de claves IMAP... ===")
    with app.app_context():
        try:
            # --- INICIALIZAR CLAVES IMAP ---
            current_key_secret = AppSecrets.query.filter_by(key_name="CURRENT_IMAP_KEY").first()
            next_key_secret = AppSecrets.query.filter_by(key_name="NEXT_IMAP_KEY").first()
            changes_made = False

            if not current_key_secret:
                initial_current_key = Fernet.generate_key().decode()
                print("Inicializando Clave IMAP actual (CURRENT_IMAP_KEY)...")
                new_current_secret = AppSecrets(key_name="CURRENT_IMAP_KEY", key_value=initial_current_key)
                db.session.add(new_current_secret)
                changes_made = True
            else:
                print("Clave IMAP actual (CURRENT_IMAP_KEY) ya existe.")

            if not next_key_secret:
                initial_next_key = Fernet.generate_key().decode()
                print("Inicializando Clave IMAP siguiente (NEXT_IMAP_KEY)...")
                new_next_secret = AppSecrets(key_name="NEXT_IMAP_KEY", key_value=initial_next_key)
                db.session.add(new_next_secret)
                changes_made = True
            else:
                print("Clave IMAP siguiente (NEXT_IMAP_KEY) ya existe.")

            if changes_made:
                db.session.commit()
                print("Claves IMAP inicializadas y guardadas.")
            else:
                print("No se necesitaron inicializar claves IMAP.")

            print("=== Inicialización de claves IMAP completada. ===")

        except Exception as e:
            db.session.rollback()
            print(f"ERROR FATAL durante inicialización de claves IMAP: {e}")

def check_observer_patterns_job():
    with app.app_context():
        # <<< --- NUEVA VERIFICACIÓN AL INICIO --- >>>
        observer_enabled = get_site_setting("observer_enabled", "1")
        if observer_enabled != "1":
            # Solo imprimir si se quiere un log de que fue llamado pero no ejecutó
            # print(f"[{datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")}] [JOB_OBSERVER] Tarea llamada, pero observador está OFF. Saliendo.")
            return # Salir si el observador está deshabilitado
        # <<< --- FIN NUEVA VERIFICACIÓN --- >>>

        current_time_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


        try:
            run_frequency_minutes = int(get_site_setting("observer_check_frequency", "5"))
            if run_frequency_minutes <= 0: run_frequency_minutes = 5
        except ValueError:
            run_frequency_minutes = 5

        last_run_setting_key = "observer_job_last_actual_run_utc"
        last_run_iso = get_site_setting(last_run_setting_key)
        now_utc = datetime.now(timezone.utc)

        if last_run_iso:
            try:
                last_run_utc_dt = datetime.fromisoformat(last_run_iso)
                if now_utc < last_run_utc_dt + timedelta(minutes=run_frequency_minutes):
            
                    return
            except ValueError:
                pass
        
        active_rules = SecurityRule.query.filter_by(enabled=True).all()
        if not active_rules:
            set_site_setting(last_run_setting_key, now_utc.isoformat())
            try: 
                db.session.commit()
            except Exception as e_commit: 
                pass
            return

        servers = ObserverIMAPServer.query.filter_by(enabled=True).all()
        if not servers:
            set_site_setting(last_run_setting_key, now_utc.isoformat())
            try: 
                db.session.commit()
            except Exception as e_commit: 
                pass
            return
            
        # Prioridad 1: ventana en minutos (imap_observer_scan_window_minutes)
        scan_window_minutes = None
        try:
            scan_window_minutes = int(get_site_setting("imap_observer_scan_window_minutes", "0"))
        except ValueError:
            scan_window_minutes = None

        if scan_window_minutes and scan_window_minutes > 0:
            since_date_for_imap_scan = now_utc - timedelta(minutes=scan_window_minutes)
        else:
            # Fallback: configuración en días
            try:
                days_back = int(get_site_setting("observer_scan_days_back", "2"))
                if days_back < 0:
                    days_back = 1
            except ValueError:
                days_back = 1
            since_date_for_imap_scan = (now_utc - timedelta(days=days_back)).replace(hour=0, minute=0, second=0, microsecond=0)

        for rule in active_rules:
            # print(f"[{current_time_str}] [JOB_OBSERVER] Procesando Regla ID {rule.id}: '{rule.description or 'N/A'}' (Sender filter: '{rule.sender or "Cualquiera"}')")
            try:
                servers_for_rule = servers
                if getattr(rule, 'imap_server_id', None):
                    servers_for_rule = [s for s in servers if s.id == rule.imap_server_id]
                    if not servers_for_rule:
                        # print(f"[{current_time_str}] [JOB_OBSERVER] Regla {rule.id}: servidor IMAP específico no encontrado o deshabilitado. Omitiendo.")
                        continue

                found_emails_in_scan = search_emails_for_observer(servers_for_rule, since_date_for_imap_scan, rule.sender)
            except Exception as imap_e:
                # print(f"[{current_time_str}] [JOB_OBSERVER] Error buscando correos para Regla {rule.id}: {imap_e}")
                continue 

            for scanned_email_data in found_emails_in_scan:
                scanned_email_content = scanned_email_data.get('body_raw', "")
                import html
                cleaned_content = re.sub(r'<[^>]+>', ' ', scanned_email_content)
                cleaned_content = html.unescape(cleaned_content)
                scanned_email_message_id = scanned_email_data.get('message_id')
                scanned_email_to_list = scanned_email_data.get('to', [])

                if not scanned_email_message_id:
                    scanned_email_message_id = f"obs_no_id_{rule.id}_{now_utc.timestamp()}_{scanned_email_data.get('subject', '')[:20]}"
                    # print(f"[{current_time_str}] [JOB_OBSERVER] WARN: No se encontró Message-ID para un correo. Usando ID generado: {scanned_email_message_id}")

                try:
                    if safe_regex_search(rule.observer_pattern, cleaned_content):
                        # print(f"[{current_time_str}] [ALERTA-OBSERVER] Coincidencia Patrón Observador! Regla ID: {rule.id}, Correo ID: {scanned_email_message_id}")
                        log_retention_minutes = int(get_site_setting("log_retention_minutes", "60"))
                        log_cutoff_time = now_utc - timedelta(minutes=log_retention_minutes)
                        
                        from sqlalchemy import func, or_

                        dest_emails_lower = [addr.lower() for addr in scanned_email_to_list if addr]

                        access_logs = TriggerLog.query.filter(
                            TriggerLog.rule_id == rule.id,
                            TriggerLog.timestamp >= log_cutoff_time,
                            or_(
                                TriggerLog.email_identifier == scanned_email_message_id,
                                func.lower(TriggerLog.searched_email).in_(dest_emails_lower)
                            )
                        ).order_by(TriggerLog.user_id, TriggerLog.timestamp.desc()).all()

                        email_destinatarios_str = ", ".join(scanned_email_to_list) if scanned_email_to_list else "(desconocido)"

                        if not access_logs:
                            # print(f"[{current_time_str}] [INFO] Tarea Observador: Regla {rule.id} detectó correo {scanned_email_message_id} (para: {email_destinatarios_str}), pero ningún usuario lo ha consultado. Eliminando correo para evitar detecciones futuras.")
                            try:
                                delete_emails_by_message_id(servers_for_rule, scanned_email_message_id)
                                # print(f"[{current_time_str}] [INFO] Correo {scanned_email_message_id} eliminado exitosamente por falta de logs activadores.")
                            except Exception as del_mail_err:
                                # print(f"[JOB_OBSERVER] Error al eliminar correo {scanned_email_message_id}: {del_mail_err}")
                                pass
                            continue
                        
                        processed_users_for_this_email = set()
                        unique_latest_logs_for_processing = []
                        for log in access_logs:
                            if log.user_id not in processed_users_for_this_email:
                                unique_latest_logs_for_processing.append(log)
                                processed_users_for_this_email.add(log.user_id)

                        for log_entry in unique_latest_logs_for_processing:
                            user = User.query.get(log_entry.user_id)
                            if not user: continue

                            admin_username_cfg = app.config.get("ADMIN_USER", "admin")
                            parent_user = user 
                            is_sub = user.parent_id is not None
                            if is_sub:
                                parent_user = User.query.get(user.parent_id)
                                if not parent_user: continue

                            privileged_support = {"soporte", "soporte1", "soporte2", "soporte3"}
                            is_privileged = (
                                user.username == admin_username_cfg
                                or user.username.lower() in privileged_support
                                or (
                                    parent_user
                                    and (
                                        parent_user.username == admin_username_cfg
                                        or parent_user.username.lower() in privileged_support
                                    )
                                )
                            )

                            dest_email_for_msg = (log_entry.searched_email or (scanned_email_to_list[0] if scanned_email_to_list else '(desconocido)'))
                            alert_subject = "ALERTA SEGURIDAD correo cambiado"
                            alert_body_lines = [f"El correo {dest_email_for_msg} fue cambiado"]

                            if is_sub:
                                alert_body_lines.append(f"Sub-usuario que realizó la acción: '{user.username}'.")
                            else:
                                alert_body_lines.append(f"Usuario que realizó la acción: '{user.username}'.")

                            if not is_privileged:
                                alert_body_lines.append(f"ACCIÓN: Usuario principal '{parent_user.username}' DESHABILITADO.")
                                if parent_user:
                                    parent_user.enabled = False
                                    parent_user.user_session_rev_count += 1
                                    RememberDevice.query.filter_by(user_id=parent_user.id).delete()
                                    db.session.add(parent_user)

                                    sub_users = User.query.filter_by(parent_id=parent_user.id).all()
                                    for su in sub_users:
                                        su.enabled = False
                                        su.user_session_rev_count += 1
                                        RememberDevice.query.filter_by(user_id=su.id).delete()
                                        db.session.add(su)

                                    key_last_disable = f"observer_last_disable_{parent_user.id}"
                                    set_site_setting(key_last_disable, now_utc.isoformat())
                                    # print(f"[{current_time_str}] [ACCIÓN-OBSERVADOR] Usuario {parent_user.username} deshabilitado.")
                                db.session.delete(log_entry)
                            else:
                                alert_body_lines.append("ACCIÓN: Ninguna.")
                                # print(f"[{current_time_str}] [INFO] Tarea Observador: Alerta para privilegiado {user.username}.")
                                db.session.delete(log_entry)

                            alert_body = "\n".join(alert_body_lines)
                            try:
                                send_security_alert_email(None, alert_subject, alert_body)
                                app.logger.info(f"Alerta enviada (Message-ID {scanned_email_message_id}).")
                            except Exception as email_err:
                                # print(f"[{current_time_str}] [ERROR] Envío alerta: {email_err}")
                                pass
                            
                            try:
                                delete_emails_by_message_id(servers_for_rule, scanned_email_message_id)
                            except Exception as del_mail_err:
                                # print(f"[{current_time_str}] [WARN] No se pudo eliminar correo {scanned_email_message_id}: {del_mail_err}")
                                pass
                except re.error as re_err:
                    # print(f"[{current_time_str}] [JOB_OBSERVER] Regex error en Regla {rule.id} (observer): {re_err}")
                    pass
                except Exception as observer_err:
                    # print(f"[{current_time_str}] [JOB_OBSERVER] Procesando Regla {rule.id}, correo {scanned_email_message_id}: {observer_err}")
                    pass
        
        set_site_setting(last_run_setting_key, now_utc.isoformat())
        try: 
            db.session.commit()
            # print(f"[{current_time_str}] [JOB_OBSERVER] Tarea finalizada. Cambios (usuarios/settings) guardados.")
        except Exception as final_commit_e:
            db.session.rollback()
            # print(f"[{current_time_str}] [JOB_OBSERVER] Commit final falló: {final_commit_e}")
            pass

def cleanup_trigger_logs_job():
    with app.app_context():
        current_time_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

        try:
            retention_minutes = int(get_site_setting("log_retention_minutes", "60")) 
            if retention_minutes <= 0: retention_minutes = 60
        except ValueError:
             retention_minutes = 60

        last_cleanup_setting_key = "cleanup_job_last_actual_run_utc"
        last_cleanup_iso = get_site_setting(last_cleanup_setting_key)
        now_utc = datetime.now(timezone.utc)
        
        try:
            cleanup_run_frequency_minutes = int(get_site_setting("log_cleanup_frequency_minutes", "30"))
            if cleanup_run_frequency_minutes <= 0:
                cleanup_run_frequency_minutes = 30
        except ValueError:
            cleanup_run_frequency_minutes = 30

        if last_cleanup_iso:
            try:
                last_cleanup_utc_dt = datetime.fromisoformat(last_cleanup_iso)
                if now_utc < last_cleanup_utc_dt + timedelta(minutes=cleanup_run_frequency_minutes):
                    return
            except ValueError:
                pass

        # Iniciando lógica principal de limpieza...
        cutoff_time = now_utc - timedelta(minutes=retention_minutes)
        
        try:
            num_deleted = db.session.query(TriggerLog).filter(TriggerLog.timestamp < cutoff_time).delete()
            set_site_setting(last_cleanup_setting_key, now_utc.isoformat()) 
            db.session.commit()
            if num_deleted > 0:
                pass  # Log eliminado
            else:
                pass  # Log eliminado
        except Exception as e:
            db.session.rollback()
            pass  # Log eliminado
        # Tarea de limpieza finalizada

def main():
    scheduler = BackgroundScheduler(executors={"default": ThreadPoolExecutor(max_workers=5)})

    # Iniciar Drive Transfer Scheduler (método simple del usuario) - FUERA del contexto
    from app.store.drive_manager import start_simple_drive_loop
    start_simple_drive_loop()

    with app.app_context(): 
        def rotate_imap_keys_job():
            # ... (código de la función)
            pass # Placeholder para brevedad

        job_id = 'auto_rotate_imap_keys'
        scheduler.add_job(
            func=rotate_imap_keys_job,
            trigger='cron',
            day='1', 
            hour='2', 
            minute='0',
            id=job_id,
            replace_existing=True
        )


        observer_job_id = 'check_observer_patterns'
        scheduler_call_freq_observer = 1
        scheduler.add_job(
            func=check_observer_patterns_job,
            trigger='interval',
            minutes=scheduler_call_freq_observer, 
            id=observer_job_id,
            replace_existing=True,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30) 
        )


        cleanup_job_id = 'cleanup_trigger_logs'
        scheduler_call_freq_cleanup = 10 
        scheduler.add_job(
            func=cleanup_trigger_logs_job,
            trigger='interval',
            minutes=scheduler_call_freq_cleanup, 
            id=cleanup_job_id,
            replace_existing=True,
            next_run_time=datetime.now(timezone.utc) + timedelta(minutes=1, seconds=30) 
        )

        # Tarea para limpiar mensajes SMS antiguos (mayores a 15 minutos) y huérfanos
        def cleanup_old_sms_messages_job():
            """Elimina mensajes SMS mayores a 15 minutos y huérfanos de la base de datos"""
            with app.app_context():
                try:
                    from app.store.models import SMSMessage, SMSConfig
                    from sqlalchemy import and_
                    
                    # Calcular la fecha límite: mensajes mayores a 15 minutos
                    time_limit = datetime.utcnow() - timedelta(minutes=15)
                    
                    # Buscar mensajes antiguos
                    old_messages = SMSMessage.query.filter(
                        SMSMessage.created_at < time_limit
                    ).all()
                    
                    # Buscar mensajes huérfanos (sin sms_config asociado)
                    # Usar LEFT JOIN para encontrar mensajes cuyo sms_config_id no existe en sms_configs
                    orphan_messages = db.session.query(SMSMessage).outerjoin(
                        SMSConfig, SMSMessage.sms_config_id == SMSConfig.id
                    ).filter(
                        SMSConfig.id.is_(None)
                    ).all()
                    
                    # Combinar ambos tipos de mensajes a eliminar (sin duplicados)
                    messages_to_delete = list(set(old_messages + orphan_messages))
                    
                    # Solo eliminar si hay mensajes
                    if messages_to_delete:
                        count = len(messages_to_delete)
                        orphan_count = len(orphan_messages)
                        for msg in messages_to_delete:
                            db.session.delete(msg)
                        db.session.commit()
                        # Log opcional (puedes comentarlo si no quieres logs)
                        # print(f"✅ Eliminados {count} mensajes SMS ({count - orphan_count} antiguos, {orphan_count} huérfanos)")
                    # Si no hay mensajes, no hacer nada (como solicitó el usuario)
                    
                except Exception as e:
                    # En caso de error, hacer rollback y continuar
                    db.session.rollback()
                    # Log opcional de error (puedes comentarlo si no quieres logs)
                    # print(f"❌ Error al limpiar mensajes SMS: {str(e)}")
                    pass

        sms_cleanup_job_id = 'cleanup_old_sms_messages'
        scheduler_call_freq_sms_cleanup = 5  # Ejecutar cada 5 minutos
        scheduler.add_job(
            func=cleanup_old_sms_messages_job,
            trigger='interval',
            minutes=scheduler_call_freq_sms_cleanup,
            id=sms_cleanup_job_id,
            replace_existing=True,
            next_run_time=datetime.now(timezone.utc) + timedelta(minutes=1)  # Empezar después de 1 minuto
        )

    
    import atexit
    scheduler.start()
    atexit.register(lambda: scheduler.shutdown())
    # Drive Transfer deshabilitado

    # ✅ SISTEMA SMTP ACTIVADO
    # Los emails se reciben via servidor SMTP en puerto 25
    
    # Configurar logging para suprimir warnings pero permitir logs de Flask
    import logging
    import warnings
    import os
    
    # Suprimir TODOS los warnings de manera más agresiva
    warnings.filterwarnings("ignore")
    os.environ['PYTHONWARNINGS'] = 'ignore'
    
    # Suprimir logs específicos pero permitir werkzeug para ver códigos HTTP
    logging.getLogger('apscheduler').setLevel(logging.ERROR)
    logging.getLogger('pkg_resources').setLevel(logging.ERROR)
    logging.getLogger('setuptools').setLevel(logging.ERROR)
    
    # Suprimir logs de detección de cambios y debugger
    logging.getLogger('werkzeug.reloader').setLevel(logging.ERROR)
    
    # Configurar werkzeug para mostrar logs de inicio Y HTTP, pero sin token
    werkzeug_logger = logging.getLogger('werkzeug')
    werkzeug_logger.setLevel(logging.INFO)
    
    # Filtro personalizado para mostrar logs importantes
    class AllLogsFilter:
        def filter(self, record):
            message = record.getMessage()
            # Permitir TODOS los logs de werkzeug (HTTP requests)
            if record.name == 'werkzeug':
                return True
            # Permitir logs de la aplicación
            if record.name.startswith('app.'):
                return True
            # Suprimir solo logs específicos problemáticos
            return not any(unwanted in message for unwanted in [
                'Debugger PIN',
                'Debugger is active',
                'Detected change in',
                'Restarting with stat'
            ])
    
    werkzeug_logger.addFilter(AllLogsFilter())
    
    if not app.debug:
        app.logger.setLevel("INFO")

    # Configuración mejorada para evitar errores de socket en Windows
    import signal
    import sys
    
    def signal_handler(sig, frame):
        print('\n🛑 Cerrando servidor de forma segura...')
        try:
            scheduler.shutdown()
            # Drive Transfer deshabilitado
        except:
            pass
        sys.exit(0)
    
    # Registrar manejadores de señales para cierre limpio
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        app.run(host="0.0.0.0", port=5000, debug=Config.DEBUG, threaded=True, use_reloader=False)
    except OSError as e:
        if "WinError 10038" in str(e):
            print("⚠️  Error de socket detectado, reiniciando servidor...")
            # Reiniciar el servidor automáticamente
            import time
            time.sleep(2)
            app.run(host="0.0.0.0", port=5000, debug=Config.DEBUG, threaded=True, use_reloader=False)
        else:
            raise e

@app.cli.command("test-alert-email")
@click.argument("recipient_email")
@click.option("--subject", default="Prueba de Alerta de Seguridad IMAP", help="Asunto del correo.")
@click.option("--body", default="Este es un correo de prueba para la funcionalidad de alertas de seguridad.", help="Cuerpo del correo.")
def test_alert_email_command(recipient_email, subject, body):
    """Envía un email de alerta de prueba al destinatario especificado."""
    print(f"Intentando enviar email de prueba a: {recipient_email}...")
    try:
        # La función send_security_alert_email ya está en app.services.email_service
        # y es importada al inicio de run.py
        send_security_alert_email(recipient_email, subject, body)
        print(f"Comando para enviar email a {recipient_email} ejecutado. Revisa la bandeja de entrada y los logs de la aplicación.")
    except Exception as e:
        print(f"Error ejecutando el comando test-alert-email: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
