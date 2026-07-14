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
import json
from sqlalchemy import inspect
from dotenv import load_dotenv
from cryptography.fernet import Fernet, InvalidToken
from app.services.imap_crypto import decrypt_password_with_key, encrypt_password_with_key
from werkzeug.security import generate_password_hash
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import re 
from app.models import User, AppSecrets, SecurityRule, TriggerLog, RememberDevice, IMAPServer, ObserverIMAPServer
from app.models.imap2 import IMAPServer2
from app.admin.site_settings import get_site_setting, set_site_setting
from app.imap.advanced_imap import search_emails_for_observer, delete_emails_by_message_id
from app.services.email_service import send_security_alert_email 
import sqlalchemy
from app.helpers import safe_regex_search

# Cargar variables de entorno ANTES de importar app y config si dependen de ellas
load_dotenv()

from app import create_app, db # Importar db también
from config import Config

# Restaurar imports de scheduler si se mantiene la rotación de claves
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.executors.pool import ThreadPoolExecutor
import os

# Crear la app fuera de main para que los decoradores de comandos la usen
app = create_app(Config)

from app.services.email_buzon_service import EMAIL_CLEANUP_SCHEDULER_INTERVAL_MINUTES

# Variables globales para el scheduler
_scheduler = None
_scheduler_started = False

def start_scheduler_if_needed():
    """Inicia el scheduler solo si no está ya iniciado"""
    global _scheduler, _scheduler_started
    
    if _scheduler_started:
        return
    
    # Con Gunicorn y gevent, usar un archivo de bloqueo para asegurar que solo un proceso inicie el scheduler
    lock_file = '/tmp/scheduler_lock.pid'
    
    try:
        # Intentar crear el archivo de bloqueo
        import fcntl
        lock_fd = os.open(lock_file, os.O_CREAT | os.O_WRONLY | os.O_TRUNC)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            # Si llegamos aquí, tenemos el bloqueo
            should_start = True
        except (IOError, OSError):
            # Otro proceso ya tiene el bloqueo
            os.close(lock_fd)
            should_start = False
    except (ImportError, AttributeError, OSError):
        # En Windows o si no hay fcntl, iniciar siempre (para desarrollo)
        should_start = True
        lock_fd = None
    
    if should_start:
        try:
            _scheduler = BackgroundScheduler(executors={"default": ThreadPoolExecutor(max_workers=5)})
            
            with app.app_context():
                # Configurar los mismos jobs que en main()
                _scheduler.add_job(
                    func=rotate_imap_keys_job,
                    trigger='cron',
                    day='1', hour='2', minute='0',
                    id='auto_rotate_imap_keys',
                    replace_existing=True
                )
                
                _scheduler.add_job(
                    func=check_observer_patterns_job,
                    trigger='interval',
                    minutes=1,
                    id='check_observer_patterns',
                    replace_existing=True,
                    next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30)
                )
                
                _scheduler.add_job(
                    func=cleanup_trigger_logs_job,
                    trigger='interval',
                    minutes=10,
                    id='cleanup_trigger_logs',
                    replace_existing=True,
                    next_run_time=datetime.now(timezone.utc) + timedelta(minutes=1, seconds=30)
                )
                
                def cleanup_old_sms_messages_job():
                    with app.app_context():
                        try:
                            from app.store.models import SMSMessage, SMSConfig
                            time_limit = datetime.utcnow() - timedelta(minutes=15)
                            old_messages = SMSMessage.query.filter(SMSMessage.created_at < time_limit).all()
                            orphan_messages = db.session.query(SMSMessage).outerjoin(
                                SMSConfig, SMSMessage.sms_config_id == SMSConfig.id
                            ).filter(SMSConfig.id.is_(None)).all()
                            messages_to_delete = list(set(old_messages + orphan_messages))
                            if messages_to_delete:
                                for msg in messages_to_delete:
                                    db.session.delete(msg)
                                db.session.commit()
                        except Exception:
                            db.session.rollback()
                
                _scheduler.add_job(
                    func=cleanup_old_sms_messages_job,
                    trigger='interval',
                    minutes=5,
                    id='cleanup_old_sms_messages',
                    replace_existing=True,
                    next_run_time=datetime.now(timezone.utc) + timedelta(minutes=1)
                )

                _scheduler.add_job(
                    func=cleanup_email_trash_30d_job,
                    trigger='cron',
                    hour=4,
                    minute=0,
                    id='cleanup_email_trash_30d',
                    replace_existing=True,
                    timezone=ZoneInfo('America/Bogota'),
                )

                _scheduler.add_job(
                    func=scheduled_email_buzon_cleanup_tick_job,
                    trigger='interval',
                    minutes=EMAIL_CLEANUP_SCHEDULER_INTERVAL_MINUTES,
                    id='email_buzon_scheduled_cleanup_tick',
                    replace_existing=True,
                    next_run_time=datetime.now(timezone.utc) + timedelta(seconds=45),
                )

                _scheduler.add_job(
                    func=license_day_renewal_midnight_job,
                    trigger='cron',
                    hour=0,
                    minute=5,
                    id='license_day_renewal_midnight',
                    replace_existing=True,
                    timezone=ZoneInfo('America/Bogota'),
                )

                _scheduler.add_job(
                    func=license_warranty_auto_deliver_job,
                    trigger='interval',
                    minutes=1,
                    id='license_warranty_auto_deliver',
                    replace_existing=True,
                    next_run_time=datetime.now(timezone.utc) + timedelta(seconds=90),
                )

                _scheduler.add_job(
                    func=release_stale_renewal_reservations_job,
                    trigger='interval',
                    minutes=2,
                    id='release_stale_renewal_reservations',
                    replace_existing=True,
                    next_run_time=datetime.now(timezone.utc) + timedelta(seconds=120),
                )

                _scheduler.add_job(
                    func=hourly_sqlite_backup_job,
                    trigger='interval',
                    hours=1,
                    id='hourly_sqlite_auto_backup',
                    replace_existing=True,
                    next_run_time=datetime.now(timezone.utc) + timedelta(minutes=3),
                )
            
            import atexit
            _scheduler.start()
            atexit.register(lambda: _scheduler.shutdown() if _scheduler else None)
            _scheduler_started = True
            
            # Escribir PID en el archivo de bloqueo
            if lock_fd:
                os.write(lock_fd, str(os.getpid()).encode())
                os.fsync(lock_fd)
            
            # Iniciar Drive Transfer Scheduler
            from app.store.drive_manager import start_simple_drive_loop
            start_simple_drive_loop(app)
            
        except Exception as e:
            # Si hay error, cerrar el archivo de bloqueo si existe
            if 'lock_fd' in locals() and lock_fd:
                try:
                    os.close(lock_fd)
                    os.unlink(lock_file)
                except:
                    pass
            # Si hay error, no fallar silenciosamente pero continuar
            import traceback
            traceback.print_exc()
    else:
        # Otro proceso ya tiene el scheduler corriendo
        if lock_fd:
            os.close(lock_fd)

# NO iniciar scheduler aquí - se iniciará después de que todas las funciones estén definidas
# Ver línea ~800 donde se llama start_scheduler_if_needed() después de definir todas las funciones

warnings.filterwarnings("ignore", category=sqlalchemy.exc.SAWarning)

@app.cli.command("create-admin")
def create_admin_command():
    """Crea o actualiza el usuario administrador definido en .env."""
    # Cargar .env desde la raíz del proyecto (independiente del directorio actual)
    project_root = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(project_root, ".env"))
    admin_username = os.getenv("ADMIN_USER")
    admin_pass = os.getenv("ADMIN_PASS")

    if not admin_username or not admin_pass:
        print("ERROR: ADMIN_USER y/o ADMIN_PASS no están definidos en .env. No se puede crear el admin.")
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


def _seed_default_catalog():
    """Inserta filtros, regex, servicios y vínculos M2M desde app/data/default_catalog_seed.json
    solo si las tres tablas están vacías (despliegue nuevo). Idempotente."""
    project_root = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(project_root, "app", "data", "default_catalog_seed.json")
    if not os.path.isfile(json_path):
        print(f"[seed-catalog] No existe {json_path}; se omite.")
        return
    skip = os.getenv("SKIP_CATALOG_SEED", "").strip().lower()
    if skip in ("1", "true", "yes"):
        print("[seed-catalog] SKIP_CATALOG_SEED está activo; se omite.")
        return

    from app.models import FilterModel as Filter, RegexModel as RegexPattern, ServiceModel, service_regex, service_filter

    if Filter.query.count() or RegexPattern.query.count() or ServiceModel.query.count():
        print("[seed-catalog] Ya existen filtros, regex o servicios; no se inserta el catálogo por defecto.")
        return

    try:
        with open(json_path, encoding="utf-8") as f:
            bundle = json.load(f)
    except Exception as e:
        print(f"[seed-catalog] No se pudo leer JSON: {e}")
        return

    filters_data = bundle.get("filters") or []
    regexes_data = bundle.get("regexes") or []
    services_data = bundle.get("services") or []
    pairs_sr = bundle.get("service_regex_pairs") or []
    pairs_sf = bundle.get("service_filter_pairs") or []
    if not filters_data and not regexes_data and not services_data:
        print("[seed-catalog] JSON sin datos de catálogo; se omite.")
        return

    try:
        mapper_svc = inspect(ServiceModel)
        service_column_keys = {c.key for c in mapper_svc.columns}
    except Exception:
        service_column_keys = None

    def _as_bool(v):
        if v is None:
            return v
        return bool(int(v)) if isinstance(v, (int, str)) and str(v).isdigit() else bool(v)

    old_to_new_filter = {}
    old_to_new_regex = {}
    old_to_new_service = {}

    try:
        for row in sorted(filters_data, key=lambda x: x.get("id") or 0):
            old_id = row.get("id")
            d = {k: v for k, v in row.items() if k != "id"}
            if "enabled" in d:
                d["enabled"] = _as_bool(d.get("enabled"))
            if "is_default" in d:
                d["is_default"] = _as_bool(d.get("is_default"))
            obj = Filter(**d)
            db.session.add(obj)
            db.session.flush()
            if old_id is not None:
                old_to_new_filter[old_id] = obj.id

        for row in sorted(regexes_data, key=lambda x: x.get("id") or 0):
            old_id = row.get("id")
            d = {k: v for k, v in row.items() if k != "id"}
            for key in ("enabled", "is_default", "protected"):
                if key in d:
                    d[key] = _as_bool(d.get(key))
            obj = RegexPattern(**d)
            db.session.add(obj)
            db.session.flush()
            if old_id is not None:
                old_to_new_regex[old_id] = obj.id

        for row in sorted(services_data, key=lambda x: x.get("id") or 0):
            old_id = row.get("id")
            d = {k: v for k, v in row.items() if k != "id"}
            if service_column_keys is not None:
                d = {k: v for k, v in d.items() if k in service_column_keys}
            for key in ("enabled", "protected"):
                if key in d:
                    d[key] = _as_bool(d.get(key))
            obj = ServiceModel(**d)
            db.session.add(obj)
            db.session.flush()
            if old_id is not None:
                old_to_new_service[old_id] = obj.id

        for p in pairs_sr:
            ns = old_to_new_service.get(p.get("service_id"))
            nr = old_to_new_regex.get(p.get("regex_id"))
            if ns and nr:
                db.session.execute(service_regex.insert().values(service_id=ns, regex_id=nr))

        for p in pairs_sf:
            ns = old_to_new_service.get(p.get("service_id"))
            nf = old_to_new_filter.get(p.get("filter_id"))
            if ns and nf:
                db.session.execute(service_filter.insert().values(service_id=ns, filter_id=nf))

        db.session.commit()
        print(
            f"[seed-catalog] OK: {len(old_to_new_filter)} filtros, {len(old_to_new_regex)} regex, "
            f"{len(old_to_new_service)} servicios, +vínculos M2M."
        )
    except Exception as e:
        db.session.rollback()
        print(f"[seed-catalog] ERROR: {e}")


@app.cli.command("seed-catalog")
def seed_catalog_command():
    """Inserta catálogo por defecto (filtros/regex/servicios) si las tablas están vacías."""
    project_root = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(project_root, ".env"))
    print("=== seed-catalog ===")
    with app.app_context():
        _seed_default_catalog()
    print("=== seed-catalog terminado ===")


@app.cli.command("initial-seed")
def initial_seed_command():
    """Ejecuta create-admin, init-imap-keys y catálogo por defecto (filtros/regex/servicios)."""
    # Cargar .env desde la raíz del proyecto
    project_root = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(project_root, ".env"))
    print("=== Ejecutando initial-seed ===")
    create_admin_command()
    init_imap_keys_command()
    with app.app_context():
        _seed_default_catalog()
    print("=== initial-seed terminado ===")

def rotate_imap_keys_job():
    """Rota las claves de cifrado IMAP automáticamente.
    Re-encripta todas las contraseñas con la nueva clave y actualiza las claves en AppSecrets."""
    with app.app_context():
        try:
            from app.models.settings import get_current_imap_key, get_next_imap_key
            
            app.logger.info("🔄 Iniciando rotación automática de claves IMAP...")
            
            # 1. Obtener claves actuales
            current_key = get_current_imap_key()
            next_key = get_next_imap_key()
            
            # 2. Si NEXT_IMAP_KEY no existe, generarla
            if not next_key:
                app.logger.warning("⚠️  NEXT_IMAP_KEY no existe. Generando nueva clave...")
                next_key = Fernet.generate_key().decode()
                next_key_secret = AppSecrets.query.filter_by(key_name="NEXT_IMAP_KEY").first()
                if not next_key_secret:
                    next_key_secret = AppSecrets(key_name="NEXT_IMAP_KEY", key_value=next_key)
                    db.session.add(next_key_secret)
                    db.session.commit()
                else:
                    next_key_secret.key_value = next_key
                    db.session.commit()
                app.logger.info("✅ NEXT_IMAP_KEY generada y guardada.")
            
            # 3. Re-encriptar todas las contraseñas IMAP
            reencrypted_count = 0
            failed_count = 0
            
            # IMAP Servers regulares
            imap_servers = IMAPServer.query.all()
            for server in imap_servers:
                try:
                    # Intentar descifrar con la clave actual
                    try:
                        plain_password = decrypt_password_with_key(server.password_enc, current_key)
                    except InvalidToken:
                        # Si falla, puede estar encriptada con otra clave, intentar con next_key
                        try:
                            plain_password = decrypt_password_with_key(server.password_enc, next_key)
                            # Ya está encriptada con la nueva clave, saltar
                            continue
                        except InvalidToken:
                            app.logger.error(f"❌ No se pudo descifrar contraseña para IMAP Server {server.id} ({server.host})")
                            failed_count += 1
                            continue
                    
                    # Re-encriptar con la nueva clave
                    server.password_enc = encrypt_password_with_key(plain_password, next_key)
                    reencrypted_count += 1
                except Exception as e:
                    app.logger.error(f"❌ Error re-encriptando IMAP Server {server.id}: {e}")
                    failed_count += 1
            
            # Observer IMAP Servers
            observer_servers = ObserverIMAPServer.query.all()
            for server in observer_servers:
                try:
                    try:
                        plain_password = decrypt_password_with_key(server.password_enc, current_key)
                    except InvalidToken:
                        try:
                            plain_password = decrypt_password_with_key(server.password_enc, next_key)
                            continue
                        except InvalidToken:
                            app.logger.error(f"❌ No se pudo descifrar contraseña para Observer IMAP Server {server.id} ({server.host})")
                            failed_count += 1
                            continue
                    
                    server.password_enc = encrypt_password_with_key(plain_password, next_key)
                    reencrypted_count += 1
                except Exception as e:
                    app.logger.error(f"❌ Error re-encriptando Observer IMAP Server {server.id}: {e}")
                    failed_count += 1
            
            # IMAP2 Servers
            imap2_servers = IMAPServer2.query.all()
            for server in imap2_servers:
                try:
                    try:
                        plain_password = decrypt_password_with_key(server.password_enc, current_key)
                    except InvalidToken:
                        try:
                            plain_password = decrypt_password_with_key(server.password_enc, next_key)
                            continue
                        except InvalidToken:
                            app.logger.error(f"❌ No se pudo descifrar contraseña para IMAP2 Server {server.id} ({server.host})")
                            failed_count += 1
                            continue
                    
                    server.password_enc = encrypt_password_with_key(plain_password, next_key)
                    reencrypted_count += 1
                except Exception as e:
                    app.logger.error(f"❌ Error re-encriptando IMAP2 Server {server.id}: {e}")
                    failed_count += 1
            
            # 4. Actualizar CURRENT_IMAP_KEY con NEXT_IMAP_KEY
            current_key_secret = AppSecrets.query.filter_by(key_name="CURRENT_IMAP_KEY").first()
            if current_key_secret:
                current_key_secret.key_value = next_key
            else:
                app.logger.error("❌ CURRENT_IMAP_KEY no encontrada en AppSecrets!")
                return
            
            # 5. Generar nueva NEXT_IMAP_KEY
            new_next_key = Fernet.generate_key().decode()
            next_key_secret = AppSecrets.query.filter_by(key_name="NEXT_IMAP_KEY").first()
            if next_key_secret:
                next_key_secret.key_value = new_next_key
            else:
                next_key_secret = AppSecrets(key_name="NEXT_IMAP_KEY", key_value=new_next_key)
                db.session.add(next_key_secret)
            
            # 6. Commit de todos los cambios
            db.session.commit()
            
            app.logger.info(f"✅ Rotación de claves IMAP completada:")
            app.logger.info(f"   - Contraseñas re-encriptadas: {reencrypted_count}")
            if failed_count > 0:
                app.logger.warning(f"   - Contraseñas con errores: {failed_count}")
            app.logger.info(f"   - CURRENT_IMAP_KEY actualizada")
            app.logger.info(f"   - Nueva NEXT_IMAP_KEY generada")
            
        except Exception as e:
            db.session.rollback()
            app.logger.error(f"❌ Error fatal durante rotación de claves IMAP: {e}", exc_info=True)

def check_observer_patterns_job():
    with app.app_context():
        try:
            # <<< --- NUEVA VERIFICACIÓN AL INICIO --- >>>
            observer_enabled = get_site_setting("observer_enabled", "0")
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
                try:
                    set_site_setting(last_run_setting_key, now_utc.isoformat())
                    db.session.commit()
                except Exception:
                    db.session.rollback()
                return

            servers = ObserverIMAPServer.query.filter_by(enabled=True).all()
            if not servers:
                try:
                    set_site_setting(last_run_setting_key, now_utc.isoformat())
                    db.session.commit()
                except Exception:
                    db.session.rollback()
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
                            log_retention_minutes = float(get_site_setting("log_retention_minutes", "60"))
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
                                    if not parent_user: parent_user = user 

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
                                        try:
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
                                        except sqlalchemy.exc.OperationalError as db_lock_err:
                                            if "database is locked" in str(db_lock_err):
                                                db.session.rollback()
                                                # En local: silencioso, en servidor: registrar
                                                if not app.config.get('DEBUG', False):
                                                    app.logger.warning(f"DB bloqueada al deshabilitar usuario {parent_user.username}, reintentará en próximo ciclo")
                                                continue  # Saltar este usuario, se procesará en el próximo ciclo
                                            else:
                                                db.session.rollback()
                                                app.logger.error(f"Error DB al deshabilitar usuario {parent_user.username}: {db_lock_err}")
                                                continue
                                        except Exception as disable_err:
                                            db.session.rollback()
                                            app.logger.error(f"Error al deshabilitar usuario {parent_user.username}: {disable_err}")
                                            continue
                                    try:
                                        db.session.delete(log_entry)
                                    except Exception:
                                        db.session.rollback()
                                else:
                                    alert_body_lines.append("ACCIÓN: Ninguna.")
                                    # print(f"[{current_time_str}] [INFO] Tarea Observador: Alerta para privilegiado {user.username}.")
                                    try:
                                        db.session.delete(log_entry)
                                    except Exception:
                                        db.session.rollback()

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
                                    # print(f"[JOB_OBSERVER] Error al eliminar correo {scanned_email_message_id} tras alertas: {del_mail_err}")
                                    pass

                    except sqlalchemy.exc.OperationalError as db_err:
                        if "database is locked" in str(db_err):
                            # SQLite lock en local: rollback silencioso
                            db.session.rollback()
                            # En local (DEBUG=True) no registrar, en servidor sí
                            if not app.config.get('DEBUG', False):
                                app.logger.error(f"Error DB bloqueada en regla {rule.id}: {db_err}")
                        else:
                            # Otro error de DB: registrar siempre
                            db.session.rollback()
                            app.logger.error(f"Error de base de datos en regla {rule.id}: {db_err}")
                        continue
                    except sqlalchemy.exc.PendingRollbackError as pending_err:
                        # Sesión en estado de rollback: limpiar y continuar
                        db.session.rollback()
                        # Solo registrar en servidor
                        if not app.config.get('DEBUG', False):
                            app.logger.warning(f"Sesión en rollback en regla {rule.id}, limpiada")
                        continue
                    except Exception as rule_e:
                        # Otros errores: registrar siempre
                        db.session.rollback()
                        app.logger.error(f"Error procesando regla {rule.id} para correo {scanned_email_message_id}: {rule_e}")
                        continue

            # Marcar última ejecución exitosa
            try:
                set_site_setting(last_run_setting_key, now_utc.isoformat())
                db.session.commit()
            except Exception:
                db.session.rollback()

        except sqlalchemy.exc.OperationalError as e:
            if "database is locked" in str(e):
                # SQLite lock es normal en concurrencia local, simplemente hacer rollback y salir silenciosamente
                db.session.rollback()
                # Solo registrar en servidor (no en local con DEBUG=True)
                if not app.config.get('DEBUG', False):
                    app.logger.warning("Observer job: Base de datos bloqueada temporalmente, reintentará en próximo ciclo")
            else:
                app.logger.error(f"Error de base de datos en observer job: {e}")
                db.session.rollback()
        except sqlalchemy.exc.PendingRollbackError as pending_e:
            # Sesión en estado de rollback: limpiar silenciosamente en local
            db.session.rollback()
            if not app.config.get('DEBUG', False):
                app.logger.warning("Observer job: Sesión en rollback, limpiada")
        except Exception as e:
            # Otros errores: siempre registrar
            app.logger.error(f"Error general en observer job: {e}", exc_info=True)
            db.session.rollback()

def cleanup_trigger_logs_job():
    with app.app_context():
        current_time_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

        try:
            retention_minutes = float(get_site_setting("log_retention_minutes", "60")) 
            if retention_minutes <= 0: retention_minutes = 60.0
        except ValueError:
             retention_minutes = 60.0

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


def cleanup_email_trash_30d_job():
    """Elimina permanentemente correos en papelera con más de 30 días (deleted_at)."""
    with app.app_context():
        try:
            from app.services.email_buzon_service import cleanup_old_trash_emails

            cleanup_old_trash_emails(days=30)
        except Exception as e:
            db.session.rollback()
            app.logger.warning("Buzón email: error en limpieza papelera 30d: %s", e)


def scheduled_email_buzon_cleanup_tick_job():
    """Cada minuto: si en Colombia coincide HH:MM con una regla EmailCleanup activa, borra esa carpeta."""
    with app.app_context():
        try:
            from app.services.email_buzon_service import run_scheduled_email_cleanups_for_colombia_clock

            run_scheduled_email_cleanups_for_colombia_clock()
        except Exception as e:
            db.session.rollback()
            app.logger.warning("Buzón email: error en limpieza programada (tick): %s", e)


def license_day_renewal_midnight_job():
    """
    00:05 Colombia: renovar / dejar mes a mes en el día del calendario;
    luego vencidas → Cambios (producto mes a mes) o Vencidas (no renovar / —).
    """
    with app.app_context():
        try:
            from app.store.license_day_renewal_job import run_license_day_renewal_pipeline

            r = run_license_day_renewal_pipeline()
            ren = r.get('renewals') or {}
            exp = r.get('expired') or {}
            if ren.get('charged') or exp.get('lines_moved'):
                app.logger.info(
                    "Licencias día %s (CO): cobradas=%s, movidas_vencidas=%s",
                    r.get('calendar_day'),
                    ren.get('charged', 0),
                    exp.get('lines_moved', 0),
                )
        except Exception as e:
            db.session.rollback()
            app.logger.warning("Licencias renovación día (medianoche CO): %s", e)


def license_warranty_auto_deliver_job():
    """Cada minuto: si hay stock gar. con ≥5 min, entrega pendientes de garantía."""
    with app.app_context():
        try:
            from app.store.license_warranty_auto_deliver_job import (
                run_license_warranty_auto_deliver_pipeline,
            )

            r = run_license_warranty_auto_deliver_pipeline()
            if r.get('delivered'):
                app.logger.info(
                    "Garantía auto-entrega: delivered=%s scanned=%s",
                    r.get('delivered', 0),
                    r.get('scanned_lines', 0),
                )
        except Exception as e:
            db.session.rollback()
            app.logger.warning("Garantía auto-entrega: %s", e)


def release_stale_renewal_reservations_job():
    """Cada 2 min: libera reservas de renovación vencidas (carritos abandonados),
    para que no dependa de que algún endpoint dispare la limpieza."""
    with app.app_context():
        try:
            from app.store.routes import _renewal_release_stale_reservations

            _renewal_release_stale_reservations()
        except Exception as e:
            db.session.rollback()
            app.logger.warning("Liberar reservas renovación vencidas: %s", e)


def sync_month_to_month_changes_midnight_job():
    """Alias: misma tubería que license_day_renewal_midnight_job (compatibilidad)."""
    license_day_renewal_midnight_job()


def hourly_sqlite_backup_job():
    """Copia horaria de la base SQLite (rotación de auto_*.db)."""
    with app.app_context():
        try:
            from app.services.db_backup_service import scheduled_backup_tick

            scheduled_backup_tick(app)
        except Exception as e:
            try:
                app.logger.warning("Copia automática BD: %s", e)
            except Exception:
                pass


def main():
    scheduler = BackgroundScheduler(executors={"default": ThreadPoolExecutor(max_workers=5)})

    # Drive loop: start_scheduler_if_needed() ya lo inicia con lock de proceso.
    with app.app_context():
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

        scheduler.add_job(
            func=cleanup_email_trash_30d_job,
            trigger='cron',
            hour=4,
            minute=0,
            id='cleanup_email_trash_30d',
            replace_existing=True,
            timezone=ZoneInfo('America/Bogota'),
        )

        scheduler.add_job(
            func=scheduled_email_buzon_cleanup_tick_job,
            trigger='interval',
            minutes=EMAIL_CLEANUP_SCHEDULER_INTERVAL_MINUTES,
            id='email_buzon_scheduled_cleanup_tick',
            replace_existing=True,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=45),
        )

        scheduler.add_job(
            func=license_day_renewal_midnight_job,
            trigger='cron',
            hour=0,
            minute=5,
            id='license_day_renewal_midnight',
            replace_existing=True,
            timezone=ZoneInfo('America/Bogota'),
        )

        scheduler.add_job(
            func=license_warranty_auto_deliver_job,
            trigger='interval',
            minutes=1,
            id='license_warranty_auto_deliver',
            replace_existing=True,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=90),
        )

        scheduler.add_job(
            func=release_stale_renewal_reservations_job,
            trigger='interval',
            minutes=2,
            id='release_stale_renewal_reservations',
            replace_existing=True,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=120),
        )

        scheduler.add_job(
            func=hourly_sqlite_backup_job,
            trigger='interval',
            hours=1,
            id='hourly_sqlite_auto_backup',
            replace_existing=True,
            next_run_time=datetime.now(timezone.utc) + timedelta(minutes=3),
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
    
    use_https = os.getenv("RUN_HTTPS", "").lower() in ("1", "true", "yes")
    if use_https:
        print("=" * 60)
        print("HTTPS activado. Accede desde: https://192.168.1.5:5000")
        print("O desde este equipo: https://localhost:5000")
        print("Acepta el aviso del certificado la primera vez.")
        print("=" * 60)
    try:
        app.run(
            host="0.0.0.0",
            port=5000,
            debug=Config.DEBUG,
            threaded=True,
            use_reloader=False,
            ssl_context="adhoc" if use_https else None,
        )
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

# Iniciar scheduler automáticamente después de que todas las funciones estén definidas
# Esto funciona tanto para ejecución directa como para Gunicorn
# Usar un enfoque muy seguro: si hay cualquier error, ignorarlo completamente
try:
    # Solo intentar iniciar si las funciones necesarias están definidas
    if 'check_observer_patterns_job' in globals() and 'cleanup_trigger_logs_job' in globals():
        start_scheduler_if_needed()
except Exception:
    # Ignorar completamente cualquier error - la aplicación debe funcionar sin scheduler
    pass

if __name__ == "__main__":
    main()
