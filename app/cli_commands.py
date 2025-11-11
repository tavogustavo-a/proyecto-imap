from flask import current_app as app
import os, re, click
from cryptography.fernet import Fernet
from werkzeug.security import generate_password_hash
from datetime import datetime, timedelta, timezone
from app import db
from app.models import User, RegexModel, ServiceModel, AppSecrets, SecurityRule, TriggerLog, RememberDevice, IMAPServer, ObserverIMAPServer
from app.admin.site_settings import get_site_setting, set_site_setting
from app.imap.advanced_imap import search_emails_for_observer, delete_emails_by_message_id
from app.services.email_service import send_security_alert_email
from app.helpers import safe_regex_search

# NOTA: usamos current_app para obtener la instancia dentro de comandos.

def register_cli_commands(app):
    """Registra todos los comandos CLI personalizados."""

    @app.cli.command("create-admin")
    def create_admin_command():
        """Crea o actualiza el usuario administrador definido en variables de entorno."""
        admin_username = os.getenv("ADMIN_USER")
        admin_pass = os.getenv("ADMIN_PASS")

        if not admin_username or not admin_pass:
            return

        with app.app_context():
            admin = User.query.filter_by(username=admin_username).first()
            hashed_password = generate_password_hash(admin_pass)

            if admin:
                admin.password = hashed_password
            else:
                admin_email_env = os.getenv("ADMIN_EMAIL")
                admin = User(username=admin_username,
                              password=hashed_password,
                              email=admin_email_env,
                              email_verified=True,
                              twofa_enabled=False,
                              twofa_method="TOTP",
                              enabled=True,
                              can_search_any=True,
                              color="#ffffff",
                              position=0)
                db.session.add(admin)

            try:
                db.session.commit()
            except Exception as e:
                db.session.rollback()

    @app.cli.command("init-imap-keys")
    def init_imap_keys_command():
        """Crea CURRENT_IMAP_KEY y NEXT_IMAP_KEY si no existen."""
        with app.app_context():
            current_secret = AppSecrets.query.filter_by(key_name="CURRENT_IMAP_KEY").first()
            next_secret = AppSecrets.query.filter_by(key_name="NEXT_IMAP_KEY").first()
            changed = False
            if not current_secret:
                current_secret = AppSecrets(key_name="CURRENT_IMAP_KEY", key_value=Fernet.generate_key().decode())
                db.session.add(current_secret)
                changed = True
            if not next_secret:
                next_secret = AppSecrets.query.filter_by(key_name="NEXT_IMAP_KEY").first()
                next_secret = AppSecrets(key_name="NEXT_IMAP_KEY", key_value=Fernet.generate_key().decode())
                db.session.add(next_secret)
                changed = True
            if changed:
                db.session.commit()

    @app.cli.command("seed-netflix-defaults")
    def seed_netflix_defaults_command():
        """Crea/actualiza Regex + Servicio por defecto para Netflix."""
        with app.app_context():
            try:
                pattern = r'(?i)_([A-Z]{2})_EVO'
                regex = RegexModel.query.filter_by(sender='info@account.netflix.com', pattern=pattern).first()
                if not regex:
                    regex = RegexModel(sender='info@account.netflix.com', pattern=pattern,
                                       description="pais de netflix", enabled=True, protected=True)
                    db.session.add(regex)
                else:
                    regex.enabled = True
                    regex.protected = True

                service = ServiceModel.query.filter_by(name="Pais Netflix").first()
                if not service:
                    alt = ServiceModel.query.filter_by(name="Servicio Netflix").first()
                    if alt:
                        alt.name = "Pais Netflix"
                        alt.protected = True
                        service = alt
                    else:
                        service = ServiceModel(name="Pais Netflix", color="black", 
                                               position=1, enabled=True, protected=True, visibility_mode="on-usuarios")
                        db.session.add(service)

                if regex not in service.regexes:
                    service.regexes.append(regex)

                db.session.commit()
            except Exception as e:
                db.session.rollback()

    # ---- Comando combinado para una sola vez ----
    @app.cli.command("initial-seed")
    def initial_seed_command():
        """Ejecuta create-admin, init-imap-keys y seed-netflix-defaults."""
        create_admin_command.invoke(click.Context(create_admin_command))
        init_imap_keys_command.invoke(click.Context(init_imap_keys_command))
        seed_netflix_defaults_command.invoke(click.Context(seed_netflix_defaults_command))
        print("=== initial-seed terminado ===") 