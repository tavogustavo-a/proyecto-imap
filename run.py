# run.py
import os
import atexit
import gevent.monkey
gevent.monkey.patch_all()
import click # Importar click para los comandos
from dotenv import load_dotenv
from cryptography.fernet import Fernet, InvalidToken
from werkzeug.security import generate_password_hash
from app.models import User, RegexModel, ServiceModel, AppSecrets

# Cargar variables de entorno ANTES de importar app y config si dependen de ellas
load_dotenv()

from app import create_app, db # Importar db también
from config import Config

# Crear la app fuera de main para que los decoradores de comandos la usen
app = create_app(Config)

# Restaurar imports de scheduler si se mantiene la rotación de claves
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.executors.pool import ThreadPoolExecutor

@app.cli.command("create-admin")
def create_admin_command():
    """Crea o actualiza el usuario administrador definido en .env."""
    admin_username = os.getenv("ADMIN_USER")
    admin_pass = os.getenv("ADMIN_PASS")

    if not admin_username or not admin_pass:
        print("Error: Las variables de entorno ADMIN_USER y ADMIN_PASS deben estar definidas en .env")
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
            pattern_netflix = r'_(?:es_|en-)([A-Za-z]{2})[^_]*_EVO'
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

def main():
    # Restaurar creación local del scheduler
    scheduler = BackgroundScheduler(executors={"default": ThreadPoolExecutor(max_workers=5)})

    # Tarea de rotación de claves (asegurar contexto)
    def rotate_imap_keys_job():
        with app.app_context(): 
            try:
                current_secret = AppSecrets.query.filter_by(key_name="CURRENT_IMAP_KEY").first()
                next_secret = AppSecrets.query.filter_by(key_name="NEXT_IMAP_KEY").first()

                if not current_secret or not next_secret:
                    print("[ERROR] No se encontraron las claves CURRENT_IMAP_KEY o NEXT_IMAP_KEY en AppSecrets. Abortando rotación.")
                    return # Salir si falta alguna clave esencial

                old_key_b64 = current_secret.key_value
                # La nueva clave *actual* será la que estaba como *siguiente*
                new_current_key_b64 = next_secret.key_value

                old_cipher = Fernet(old_key_b64.encode())
                new_cipher = Fernet(new_current_key_b64.encode())

                servers = IMAPServer.query.all()
                print(f"[INFO] Re-encriptando {len(servers)} servidores IMAP...")
                success_count = 0
                error_count = 0
                for srv in servers:
                    try:
                        old_enc = srv.password_enc
                        # Intentar desencriptar con la clave vieja
                        plain_password = old_cipher.decrypt(old_enc.encode()).decode()
                        # Re-encriptar con la nueva clave (la que era 'next')
                        new_enc = new_cipher.encrypt(plain_password.encode()).decode()
                        srv.password_enc = new_enc
                        success_count += 1
                    except InvalidToken:
                        print(f"[WARN] Token inválido para {srv.host}:{srv.port}. ¿Ya estaba encriptado con la clave nueva o es inválido?")
                        error_count += 1
                    except Exception as e:
                        print(f"[ERROR rotando {srv.host}:{srv.port}] => {e}")
                        error_count += 1

                # Solo hacer commit si hubo éxito o queremos guardar los errores
                if success_count > 0 or error_count > 0: # O ajustar la condición
                     db.session.commit()
                     print(f"[INFO] Servidores procesados. Éxitos: {success_count}, Errores/Advertencias: {error_count}")
                else:
                    print("[INFO] No se procesaron servidores.")

                # Ahora, actualizamos las claves en AppSecrets:
                # La 'next' se convierte en 'current'
                current_secret.key_value = new_current_key_b64

                # Generamos una *nueva* clave 'next' para la *próxima* rotación
                brand_new_next_key_b64 = Fernet.generate_key().decode()
                next_secret.key_value = brand_new_next_key_b64

                db.session.commit()

                print("[OK] Rotación de la clave IMAP completada.")
                print(f"[INFO] Nueva clave actual (hash corto): {new_current_key_b64[:5]}..." )
                print(f"[INFO] Nueva clave siguiente preparada (hash corto): {brand_new_next_key_b64[:5]}...")

            except Exception as e:
                db.session.rollback() # Revertir cambios si algo falla en el proceso general
                print(f"[ERROR FATAL] Error durante la rotación de claves IMAP: {e}")

    # Añadir la tarea al scheduler LOCAL
    job_id = 'auto_rotate_imap_keys'
    scheduler.add_job(
        func=rotate_imap_keys_job,
        trigger='cron',
        day='1',
        hour='2',
        minute='0',
        id=job_id,
        replace_existing=True # Puede ser True para el local
    )
    app.logger.info(f"Tarea '{job_id}' añadida al scheduler local.")

    import atexit # Asegurar import local si se eliminó de init
    scheduler.start()
    atexit.register(lambda: scheduler.shutdown())

    # Iniciar la app
    app.run(host="0.0.0.0", port=5000, debug=Config.DEBUG)

if __name__ == "__main__":
    main()
