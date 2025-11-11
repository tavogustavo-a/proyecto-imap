# app/models/user.py

from datetime import datetime
from flask import current_app, session
from cryptography.fernet import Fernet
from app.extensions import db

# Constantes internas del modelo de usuario
_USER_MODEL_SIG = 0x1B3E
_USER_MODEL_VER = 0x4A2F

# Tablas M2M para Regex y Filters
user_regex = db.Table(
    "user_regex",
    db.Column("user_id", db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    db.Column("regex_id", db.Integer, db.ForeignKey('regexes.id', ondelete='CASCADE'), primary_key=True)
)

user_filter = db.Table(
    "user_filter",
    db.Column("user_id", db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    db.Column("filter_id", db.Integer, db.ForeignKey('filters.id', ondelete='CASCADE'), primary_key=True)
)

# Tabla M2M para Services
user_service = db.Table(
    "user_service",
    db.Column("user_id", db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    db.Column("service_id", db.Integer, db.ForeignKey('services.id', ondelete='CASCADE'), primary_key=True)
)

# --- INICIO: Nuevas Tablas para Defaults de Sub-usuarios ---
parent_default_regex = db.Table(
    "parent_default_regex",
    db.Column("parent_user_id", db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    db.Column("regex_id", db.Integer, db.ForeignKey('regexes.id', ondelete='CASCADE'), primary_key=True),
    db.Index('ix_parent_default_regex_ids', 'parent_user_id', 'regex_id') # Índice útil
)

parent_default_filter = db.Table(
    "parent_default_filter",
    db.Column("parent_user_id", db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    db.Column("filter_id", db.Integer, db.ForeignKey('filters.id', ondelete='CASCADE'), primary_key=True),
    db.Index('ix_parent_default_filter_ids', 'parent_user_id', 'filter_id') # Índice útil
)
# --- FIN: Nuevas Tablas ---

# --- Nuevo Modelo para Correos Permitidos ---
class AllowedEmail(db.Model):
    __tablename__ = "allowed_emails"
    # Índices para búsquedas rápidas y unicidad por usuario
    __table_args__ = (db.UniqueConstraint('user_id', 'email', name='uq_user_email'),
                      db.Index('ix_allowed_emails_user_id_email', 'user_id', 'email'))

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    email = db.Column(db.String(255), nullable=False, index=True) # Indexar email también es útil

    def __repr__(self):
        return f'<AllowedEmail user_id={self.user_id} email="{self.email}">'
# --- Fin Nuevo Modelo ---

class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)

    # Más campos...
    email = db.Column(db.String(120), unique=True, nullable=True)
    email_verified = db.Column(db.Boolean, default=False)
    twofa_enabled = db.Column(db.Boolean, default=False)
    twofa_method = db.Column(db.String(10), default="TOTP")
    twofa_secret_enc = db.Column(db.String(255), nullable=True)

    # --- NUEVOS CAMPOS para 2FA pendiente y recuperación --- 
    pending_2fa_method = db.Column(db.String(10), nullable=True) # Almacena "TOTP" o "EMAIL" temporalmente
    pending_2fa_code = db.Column(db.String(10), nullable=True)   # Código OTP Email pendiente
    pending_2fa_code_expires = db.Column(db.DateTime, nullable=True) # Expiración del código OTP
    pending_email_code = db.Column(db.String(10), nullable=True) # Código para confirmar nuevo email
    pending_email_code_expires = db.Column(db.DateTime, nullable=True) # Expiración de confirmación de email
    recovery_email = db.Column(db.String(120), nullable=True) # Email de recuperación (usado temporalmente)
    # --- FIN NUEVOS CAMPOS ---

    enabled = db.Column(db.Boolean, default=True)
    was_enabled = db.Column(db.Boolean, nullable=True)
    blocked_until = db.Column(db.DateTime, nullable=True)
    failed_attempts = db.Column(db.Integer, default=0)
    block_count = db.Column(db.Integer, default=0)
    user_session_rev_count = db.Column(db.Integer, default=0)

    # --- Campos para reseteo de contraseña ---
    forgot_token = db.Column(db.String(100), nullable=True, index=True)
    forgot_token_time = db.Column(db.DateTime, nullable=True)
    forgot_count = db.Column(db.Integer, nullable=False, default=0, server_default='0')
    # --- Fin Campos Reseteo ---

    parent_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete='CASCADE'), nullable=True)
    can_create_subusers = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    color = db.Column(db.String(50), default="#ffffff")
    position = db.Column(db.Integer, default=1)

    # Saldo del cliente en USD y COP
    saldo_usd = db.Column(db.Float, default=0.0)
    saldo_cop = db.Column(db.Float, default=0.0)

    # Campo para indicar si el usuario puede buscar cualquier email (o solo los permitidos)
    can_search_any = db.Column(db.Boolean, default=False, nullable=False)

    # Campo para nombre completo
    full_name = db.Column(db.String(120), nullable=True)
    # Campo para teléfono
    phone = db.Column(db.String(30), nullable=True)

    # Relación de sub-usuarios (uno-a-muchos recursivo)
    parent = db.relationship("User", remote_side=[id], backref="subusers")

    # --- Nueva Relación con AllowedEmail ---
    allowed_email_entries = db.relationship(
        "AllowedEmail",
        backref="user",
        cascade="all, delete-orphan", # Borrar correos si se borra el usuario
        lazy='dynamic' # Usar lazy='dynamic' si esperas muchos correos por usuario
    )
    # --- Fin Nueva Relación ---

    # Relación M2M con Regex y Filtros
    regexes_allowed = db.relationship(
        "RegexModel",
        secondary=user_regex,
        backref="users_who_allow"
    )
    filters_allowed = db.relationship(
        "FilterModel",
        secondary=user_filter,
        backref="users_who_allow"
    )

    # Relación M2M con Services
    services_allowed = db.relationship(
        "ServiceModel",
        secondary=user_service,
        backref="users_who_allow"
    )

    # --- INICIO: Nuevas Relaciones para Defaults de Sub-usuarios ---
    # Estos son los Regex que los sub-usuarios de este User tendrán por defecto
    default_regexes_for_subusers = db.relationship(
        "RegexModel",
        secondary=parent_default_regex,
        # No necesitamos backref aquí usualmente
        lazy='dynamic' # O 'select', según preferencia
    )
    
    # Estos son los Filtros que los sub-usuarios de este User tendrán por defecto
    default_filters_for_subusers = db.relationship(
        "FilterModel",
        secondary=parent_default_filter,
        # No necesitamos backref aquí usualmente
        lazy='dynamic' # O 'select', según preferencia
    )
    # --- FIN: Nuevas Relaciones ---

    # Relación UNO (User) -> MUCHOS (RememberDevice), con delete-orphan y single_parent
    devices = db.relationship(
        "RememberDevice",
        back_populates="user",           # Se refleja en RememberDevice.user
        cascade="all, delete-orphan",    # Borramos en cascada
        single_parent=True,              # Requerido con delete-orphan
        lazy=True
    )

    can_access_store = db.Column(db.Boolean, default=False, nullable=False)
    can_access_codigos2 = db.Column(db.Boolean, default=False, nullable=False)
    can_chat = db.Column(db.Boolean, default=False, nullable=False)
    can_manage_subusers = db.Column(db.Boolean, default=False, nullable=False)
    is_support = db.Column(db.Boolean, default=False, nullable=False)

    def has_public_tools_access(self):
        """
        Verifica si un sub-usuario tiene acceso a al menos una herramienta pública.
        Los usuarios principales siempre tienen acceso.
        """
        # Si es usuario principal (no sub-usuario), siempre tiene acceso
        if not self.parent_id:
            return True
            
        # Si es sub-usuario, verificar si tiene al menos una herramienta pública asignada
        from app.store.models import ToolInfo, HtmlInfo, YouTubeListing, ApiInfo
        
        # Verificar herramientas de cálculo
        tools_count = ToolInfo.query.filter(
            ToolInfo.enabled == True,
            ToolInfo.usuarios_vinculados.any(id=self.id)
        ).count()
        
        # Verificar HTMLs
        htmls_count = HtmlInfo.query.filter(
            HtmlInfo.enabled == True,
            HtmlInfo.users.any(id=self.id)
        ).count()
        
        # Verificar videos de producción
        youtube_count = YouTubeListing.query.filter(
            YouTubeListing.enabled == True,
            YouTubeListing.users.any(id=self.id)
        ).count()
        
        # Verificar APIs
        apis_count = ApiInfo.query.filter(
            ApiInfo.enabled == True,
            ApiInfo.users.any(id=self.id)
        ).count()
        
        # Retornar True si tiene acceso a al menos una herramienta
        return (tools_count + htmls_count + youtube_count + apis_count) > 0

    @property
    def twofa_secret(self):
        """Desencripta el twofa_secret_enc usando la key en TWOFA_KEY."""
        if not self.twofa_secret_enc:
            return None
        cipher = Fernet(current_app.config["TWOFA_KEY"].encode())
        dec = cipher.decrypt(self.twofa_secret_enc.encode())
        return dec.decode()

    @twofa_secret.setter
    def twofa_secret(self, raw_secret):
        """Encripta y setea en twofa_secret_enc el valor raw_secret."""
        if not raw_secret:
            self.twofa_secret_enc = None
            return
        cipher = Fernet(current_app.config["TWOFA_KEY"].encode())
        enc = cipher.encrypt(raw_secret.encode())
        self.twofa_secret_enc = enc.decode()

    def to_dict(self):
        """Serializa el objeto User a un diccionario para exportación."""
        return {
            # Incluye el ID original para mapeo durante la importación
            'original_id': self.id,
            'username': self.username,
            # Incluir la contraseña hasheada para que se restaure al importar
            'password': self.password,
            'email': self.email,
            'full_name': self.full_name,
            'phone': self.phone,
            'email_verified': self.email_verified,
            'twofa_enabled': self.twofa_enabled,
            'twofa_method': self.twofa_method,
            # No exportar el secreto 2FA encriptado por seguridad.
            # 'twofa_secret_enc': self.twofa_secret_enc,
            'enabled': self.enabled,
            'was_enabled': self.was_enabled, # Puede ser útil para restaurar estado
            # No exportar datos de bloqueo temporal o tokens de reseteo
            # 'blocked_until': self.blocked_until.isoformat() if self.blocked_until else None,
            # 'failed_attempts': self.failed_attempts,
            # 'block_count': self.block_count,
            # 'forgot_token': self.forgot_token,
            # 'forgot_token_time': self.forgot_token_time.isoformat() if self.forgot_token_time else None,
            # 'forgot_count': self.forgot_count,
            'user_session_rev_count': self.user_session_rev_count,
            'parent_id': self.parent_id, # Clave para reconstruir jerarquía
            'can_create_subusers': self.can_create_subusers,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'color': self.color,
            'position': self.position,
            'can_search_any': self.can_search_any,
            # Incluir IDs de relaciones ManyToMany
            'allowed_regex_ids': [r.id for r in self.regexes_allowed],
            'allowed_filter_ids': [f.id for f in self.filters_allowed],
            'allowed_service_ids': [s.id for s in self.services_allowed],
            # Incluir IDs de los defaults para subusuarios (si es un padre)
            'default_regex_ids_for_subusers': [r.id for r in self.default_regexes_for_subusers],
            'default_filter_ids_for_subusers': [f.id for f in self.default_filters_for_subusers],
            # Incluir correos permitidos (si can_search_any es False)
            'allowed_emails': [ae.email for ae in self.allowed_email_entries] if not self.can_search_any else [],
            'can_access_store': self.can_access_store,
            'can_access_codigos2': self.can_access_codigos2
        }


class RememberDevice(db.Model):
    """
    Tabla para manejar la lógica de "recordar dispositivo"
    y no pedir 2FA en cada login. Almacena un token + expiración.
    """
    __tablename__ = "remember_devices"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    token = db.Column(db.String(255), unique=True, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)

    # Relación hijo => N sub-devices asociados a 1 user
    # Sin "cascade" aquí, ni "delete-orphan", en la parte "many".
    user = db.relationship(
        "User",
        back_populates="devices",  # <-- se enlaza con devices en la clase User
        lazy=True
    )
