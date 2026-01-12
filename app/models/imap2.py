# app/models/imap2.py

from app.extensions import db
from datetime import datetime

# Tablas M2M para asociar filtros y regex con IMAPServer2
# CASCADE en imap2_id: cuando se elimina un IMAPServer2, se eliminan automáticamente sus relaciones M2M
# CASCADE en filter_id/regex_id: cuando se elimina un filtro o regex, se eliminan las relaciones M2M que lo referencian
# Esto asegura que no queden relaciones huérfanas en la base de datos
imap2_filter = db.Table(
    "imap2_filter",
    db.Column("imap2_id", db.Integer, db.ForeignKey('imap_servers2.id', ondelete='CASCADE'), primary_key=True),
    db.Column("filter_id", db.Integer, db.ForeignKey('filters.id', ondelete='CASCADE'), primary_key=True)
)

imap2_regex = db.Table(
    "imap2_regex",
    db.Column("imap2_id", db.Integer, db.ForeignKey('imap_servers2.id', ondelete='CASCADE'), primary_key=True),
    db.Column("regex_id", db.Integer, db.ForeignKey('regexes.id', ondelete='CASCADE'), primary_key=True)
)

# Tabla M2M para asociar servidores IMAP adicionales con IMAPServer2
# Permite vincular múltiples servidores IMAP a un servidor IMAP2 para consultar múltiples al mismo tiempo
imap2_linked_imap = db.Table(
    "imap2_linked_imap",
    db.Column("imap2_id", db.Integer, db.ForeignKey('imap_servers2.id', ondelete='CASCADE'), primary_key=True),
    db.Column("imap_id", db.Integer, db.ForeignKey('imap_servers.id', ondelete='CASCADE'), primary_key=True)
)

class IMAPServer2(db.Model):
    __tablename__ = "imap_servers2"
    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.String(500), nullable=True)  # Descripción opcional del servidor
    host = db.Column(db.String(200), nullable=False)
    port = db.Column(db.Integer, default=993)
    username = db.Column(db.String(200), nullable=False)
    password_enc = db.Column(db.String(255), nullable=False)
    enabled = db.Column(db.Boolean, default=True)
    folders = db.Column(db.String(500), nullable=False, server_default="INBOX")
    route_path = db.Column(db.String(100), nullable=False, unique=True)  # Ej: /pagina2, /web - OBLIGATORIO
    paragraph = db.Column(db.Text, nullable=True)  # Párrafo personalizado para esta página

    # Relaciones M2M con FilterModel y RegexModel
    filters = db.relationship(
        "FilterModel",
        secondary=imap2_filter,
        backref="imap2_servers"
    )
    regexes = db.relationship(
        "RegexModel",
        secondary=imap2_regex,
        backref="imap2_servers"
    )

    # Relación con configuraciones 2FA específicas de este servidor
    twofa_configs = db.relationship(
        "IMAP2TwoFAConfig",
        backref="imap_server",
        lazy="dynamic",
        cascade="all, delete-orphan"
    )

    # Relación M2M con servidores IMAP adicionales vinculados
    linked_imap_servers = db.relationship(
        "IMAPServer",
        secondary=imap2_linked_imap,
        backref="linked_imap2_servers",
        lazy="dynamic"
    )

    def __repr__(self):
        return f"<IMAPServer2 {self.host}:{self.port} route={self.route_path}>"


class IMAP2TwoFAConfig(db.Model):
    """Modelo para almacenar configuraciones de 2FA por correo específicas para servidores IMAP2"""
    __tablename__ = "imap2_twofa_configs"
    
    id = db.Column(db.Integer, primary_key=True)
    imap_server_id = db.Column(db.Integer, db.ForeignKey('imap_servers2.id', ondelete='CASCADE'), nullable=False, index=True)
    secret_key = db.Column(db.String(255), nullable=False)  # Secreto TOTP (ej: LDPUPZLQRGQ5VDD6HORPH44OMXGCDGFP)
    emails = db.Column(db.Text, nullable=False)  # Correos asociados separados por coma
    is_enabled = db.Column(db.Boolean, default=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def get_emails_list(self):
        """Retorna una lista de correos normalizados"""
        if not self.emails:
            return []
        # Separar por coma o espacio, normalizar y limpiar
        emails = self.emails.replace(',', ' ').split()
        return [email.strip().lower() for email in emails if email.strip()]
    
    def __repr__(self):
        return f'<IMAP2TwoFAConfig id={self.id} server_id={self.imap_server_id} emails={self.emails[:50]}...>'

