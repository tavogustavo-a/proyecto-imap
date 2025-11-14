from datetime import datetime, timezone
from app.extensions import db
from app.models.user import User
from sqlalchemy.dialects.sqlite import JSON

def get_colombia_time():
    """Obtiene la fecha y hora actual en zona horaria de Colombia
    Siempre usa UTC como base, independientemente de la zona horaria del servidor"""
    from pytz import timezone as pytz_timezone
    col_tz = pytz_timezone('America/Bogota')
    # Siempre obtener UTC primero, luego convertir a Colombia
    # Esto asegura que funcione correctamente sin importar dónde esté el servidor
    now_utc = datetime.utcnow()
    now_utc_with_tz = now_utc.replace(tzinfo=pytz_timezone('UTC'))
    colombia_time = now_utc_with_tz.astimezone(col_tz)
    return colombia_time

class Product(db.Model):
    __tablename__ = "store_products"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    price_cop = db.Column(db.Numeric(10, 2), nullable=False, server_default='0')
    price_usd = db.Column(db.Numeric(10, 2), nullable=False, server_default='0')
    image_filename = db.Column(db.String(255), nullable=False)
    enabled = db.Column(db.Boolean, default=True, index=True)
    is_preset = db.Column(db.Boolean, default=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    description = db.Column(db.Text, nullable=True)

    def __repr__(self):
        return f"<Product {self.name}>"

class Sale(db.Model):
    __tablename__ = "store_sales"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete='CASCADE'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey("store_products.id", ondelete='CASCADE'), nullable=False)
    quantity = db.Column(db.Integer, default=1)
    total_price = db.Column(db.Numeric(10, 2), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

class Coupon(db.Model):
    __tablename__ = "store_coupons"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    discount_cop = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    discount_usd = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    duration_days = db.Column(db.Integer, nullable=False, default=1)
    max_uses_per_user = db.Column(db.Integer, nullable=True, default=None)
    enabled = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=get_colombia_time)
    updated_at = db.Column(db.DateTime, default=get_colombia_time, onupdate=get_colombia_time)
    description = db.Column(db.Text, nullable=True)
    min_amount = db.Column(db.Numeric(10, 2), nullable=True)
    show_public = db.Column(db.Boolean, default=False)
    # Relación ManyToMany con productos
    products = db.relationship('Product', secondary='coupon_products', backref='coupons')

# Tabla de asociación cupones-productos
coupon_products = db.Table('coupon_products',
    db.Column('coupon_id', db.Integer, db.ForeignKey('store_coupons.id', ondelete='CASCADE'), primary_key=True),
    db.Column('product_id', db.Integer, db.ForeignKey('store_products.id', ondelete='CASCADE'), primary_key=True)
)

# Tabla de asociación roles-productos
role_products = db.Table('role_products',
    db.Column('role_id', db.Integer, db.ForeignKey('store_roles.id', ondelete='CASCADE'), primary_key=True),
    db.Column('product_id', db.Integer, db.ForeignKey('store_products.id', ondelete='CASCADE'), primary_key=True)
)

# Tabla de asociación roles-usuarios
role_users = db.Table('role_users',
    db.Column('role_id', db.Integer, db.ForeignKey('store_roles.id', ondelete='CASCADE'), primary_key=True),
    db.Column('user_id', db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
)

class Role(db.Model):
    __tablename__ = 'store_roles'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    enabled = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # Productos permitidos
    productos_permitidos = db.relationship('Product', secondary=role_products, backref='roles')
    # Usuarios vinculados
    usuarios_vinculados = db.relationship('User', secondary=role_users, backref='roles_tienda')
    # Descuentos por producto (opcional, para futuro)
    descuentos = db.Column(JSON, nullable=True)
    tipo_precio = db.Column(db.String(10), default='USD')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'enabled': self.enabled,
            'productos': [{'id': p.id, 'name': p.name} for p in self.productos_permitidos],
            'descuentos': self.descuentos,
            'tipo_precio': self.tipo_precio,
            'usuarios': [{'id': u.id, 'username': u.username} for u in self.usuarios_vinculados]
        }

    def __repr__(self):
        return f"<Role {self.name}>"

# Tabla de asociación herramientas-usuarios
toolinfo_users = db.Table('toolinfo_users',
    db.Column('toolinfo_id', db.Integer, db.ForeignKey('store_tool_info.id', ondelete='CASCADE'), primary_key=True),
    db.Column('user_id', db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
)

class ToolInfo(db.Model):
    __tablename__ = 'store_tool_info'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    text = db.Column(db.Text, nullable=False)
    percent = db.Column(db.Float, nullable=False, default=0)
    enabled = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Relación con usuarios que pueden ver la herramienta
    usuarios_vinculados = db.relationship('User', 
                                        secondary=toolinfo_users,
                                        backref=db.backref('herramientas_vinculadas', lazy='dynamic'),
                                        lazy='dynamic')

    def user_has_access(self, user):
        """Verifica si un usuario tiene acceso a esta herramienta.
        
        Args:
            user: Objeto User a verificar
            
        Returns:
            bool: True si el usuario es admin o está vinculado, False en caso contrario
        """
        if not user:
            return False
        from flask import current_app
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if user.username == admin_username:
            return True
        return user in self.usuarios_vinculados.all()

    def __repr__(self):
        return f"<ToolInfo {self.title} ({self.percent}%)>"

# Tabla de asociación para HtmlInfo y User
htmlinfo_users = db.Table('htmlinfo_users',
    db.Column('htmlinfo_id', db.Integer, db.ForeignKey('html_info.id', ondelete='CASCADE'), primary_key=True),
    db.Column('user_id', db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
)

class HtmlInfo(db.Model):
    __tablename__ = 'html_info'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    text = db.Column(db.Text, nullable=False)
    enabled = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow) 
    
    # Relación con usuarios que pueden ver el HTML
    users = db.relationship('User', 
                            secondary=htmlinfo_users,
                            backref=db.backref('html_info_items', lazy='dynamic'),
                            lazy='dynamic')

    def user_has_access(self, user):
        """Verifica si un usuario tiene acceso a este contenido HTML."""
        if not user:
            return False
        from flask import current_app
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if user.username == admin_username:
            return True
        return user in self.users.all()

    def __repr__(self):
        return f"<HtmlInfo {self.title}>"

# Tabla de asociación para YouTubeListing y User
youtube_listing_users = db.Table('youtube_listing_users',
    db.Column('user_id', db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    db.Column('youtube_listing_id', db.Integer, db.ForeignKey('store_youtube_listings.id', ondelete='CASCADE'), primary_key=True)
)

class YouTubeListing(db.Model):
    __tablename__ = 'store_youtube_listings'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text, nullable=True)
    enabled = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    users = db.relationship('User', secondary=youtube_listing_users, lazy='dynamic',
                            backref=db.backref('youtube_listings', lazy=True))
    production_links = db.relationship('ProductionLink', backref='youtube_listing', lazy='dynamic', cascade="all, delete-orphan")

    def user_has_access(self, user):
        if not user:
            return False
        return user in self.users

    def __repr__(self):
        return f"<YouTubeListing {self.title}>"

class ProductionLink(db.Model):
    __tablename__ = 'store_production_links'
    id = db.Column(db.Integer, primary_key=True)
    url = db.Column(db.String(512), nullable=False)
    title = db.Column(db.String(512), nullable=True)
    youtube_listing_id = db.Column(db.Integer, db.ForeignKey('store_youtube_listings.id', ondelete='CASCADE'), nullable=False)

    def __repr__(self):
        return f"<ProductionLink {self.url}>"

# Tabla de asociación para ApiInfo y User
apiinfo_users = db.Table('apiinfo_users',
    db.Column('apiinfo_id', db.Integer, db.ForeignKey('api_info.id', ondelete='CASCADE'), primary_key=True),
    db.Column('user_id', db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
)

class ApiInfo(db.Model):
    __tablename__ = 'api_info'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    api_key = db.Column(db.Text, nullable=False)
    api_type = db.Column(db.String(50), nullable=True)
    api_url = db.Column(db.String(255), nullable=True)
    enabled = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # Campos para subtítulos de Drive
    drive_subtitle_photos = db.Column(db.String(100), nullable=True)
    drive_subtitle_videos = db.Column(db.String(100), nullable=True)
    
    users = db.relationship('User',
                            secondary=apiinfo_users,
                            backref=db.backref('api_info_items', lazy='dynamic'),
                            lazy='dynamic')

    def user_has_access(self, user):
        """Verifica si un usuario tiene acceso a esta API."""
        if not user:
            return False
        from flask import current_app
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if user.username == admin_username:
            return True
        return user in self.users.all()

    def __repr__(self):
        return f"<ApiInfo {self.title}>" 

class WorksheetTemplate(db.Model):
    __tablename__ = 'worksheet_templates'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(128), nullable=False)
    fields = db.Column(JSON, nullable=False)  # lista de campos
    created_at = db.Column(db.DateTime, server_default=db.func.now())
    order = db.Column(db.Integer, nullable=False, default=0, index=True)
    
    # ⭐ NUEVO: Relaciones con cascade delete configurado correctamente
    worksheet_data = db.relationship('WorksheetData', backref='template', cascade="all, delete-orphan")
    permissions = db.relationship('WorksheetPermission', backref='worksheet', cascade="all, delete-orphan")
    connection_logs = db.relationship('WorksheetConnectionLog', backref='worksheet', cascade="all, delete-orphan")

class WorksheetData(db.Model):
    __tablename__ = 'worksheet_data'
    id = db.Column(db.Integer, primary_key=True)
    template_id = db.Column(db.Integer, db.ForeignKey('worksheet_templates.id', ondelete='CASCADE'), nullable=False)
    data = db.Column(JSON, nullable=False)  # lista de filas, cada fila es lista de valores
    formato = db.Column(JSON, nullable=True)  # formato de celdas (colores, estilos, etc.)
    updated_at = db.Column(db.DateTime, server_default=db.func.now(), onupdate=db.func.now())
    # ⭐ NUEVO: Campos para rastrear editor y tiempo de edición
    last_editor = db.Column(db.String(200), nullable=True)  # Nombre del último editor
    last_edit_time = db.Column(db.DateTime, nullable=True)  # Tiempo de última edición
    # Relación definida en WorksheetTemplate
    pass

# Tabla de asociación para permisos de worksheet y usuarios
worksheet_permission_users = db.Table('worksheet_permission_users',
    db.Column('permission_id', db.Integer, db.ForeignKey('worksheet_permissions.id', ondelete='CASCADE'), primary_key=True),
    db.Column('user_id', db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
)

class WorksheetPermission(db.Model):
    __tablename__ = 'worksheet_permissions'
    id = db.Column(db.Integer, primary_key=True)
    worksheet_id = db.Column(db.Integer, db.ForeignKey('worksheet_templates.id', ondelete='CASCADE'), nullable=False)
    access_type = db.Column(db.String(20), nullable=False)  # 'private', 'view', 'edit', 'users'
    public_token = db.Column(db.String(100), nullable=True)  # Token para enlaces públicos
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relación con usuarios específicos (solo para access_type = 'users')
    users = db.relationship('User', 
                          secondary=worksheet_permission_users,
                          backref=db.backref('worksheet_permissions', lazy='dynamic'),
                          lazy='dynamic')
    
    # Relación definida en WorksheetTemplate
    pass
    
    def to_dict(self):
        return {
            'id': self.id,
            'worksheet_id': self.worksheet_id,
            'access_type': self.access_type,
            'public_token': self.public_token,
            'users': [{'id': u.id, 'username': u.username} for u in self.users.all()],
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    def __repr__(self):
        return f"<WorksheetPermission {self.worksheet_id} ({self.access_type})>"

class StoreSetting(db.Model):
    __tablename__ = "store_settings"
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(128), unique=True, nullable=False)
    value = db.Column(db.Text, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow) 

class GSheetsLink(db.Model):
    __tablename__ = "gsheets_links"
    id = db.Column(db.Integer, primary_key=True)
    plantilla = db.Column(db.String(64), nullable=False, index=True)  # nombre interno de la plantilla
    credentials_json = db.Column(db.Text, nullable=False)
    sheet_id = db.Column(db.String(128), nullable=False)
    tab_name = db.Column(db.String(128), nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class DriveTransfer(db.Model):
    __tablename__ = "drive_transfers"
    id = db.Column(db.Integer, primary_key=True)
    credentials_json = db.Column(db.Text, nullable=False)
    drive_original_id = db.Column(db.String(128), nullable=False)
    drive_processed_id = db.Column(db.String(128), nullable=False)
    drive_deleted_id = db.Column(db.String(128), nullable=True)  # Carpeta para archivos eliminados
    processing_time = db.Column(db.Time, nullable=False)  # Hora colombiana
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    last_processed = db.Column(db.DateTime, nullable=True)
    consecutive_errors = db.Column(db.Integer, default=0, nullable=False)  # Contador de errores consecutivos
    last_error = db.Column(db.Text, nullable=True)  # Último error de conexión
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<DriveTransfer {self.drive_original_id} -> {self.drive_processed_id}>'

class WhatsAppConfig(db.Model):
    __tablename__ = "whatsapp_configs"
    id = db.Column(db.Integer, primary_key=True)
    api_key = db.Column(db.String(255), nullable=False)
    phone_number = db.Column(db.String(20), nullable=False)
    webhook_verify_token = db.Column(db.String(255), nullable=False)
    template_message = db.Column(db.Text, nullable=False)
    notification_time = db.Column(db.Time, nullable=False)  # Hora colombiana
    is_enabled = db.Column(db.Boolean, default=True, nullable=False)
    last_sent = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<WhatsAppConfig {self.phone_number}>'

# ⭐ NUEVO: Modelo para registros de conexión de worksheets
class WorksheetConnectionLog(db.Model):
    __tablename__ = 'worksheet_connection_logs'
    id = db.Column(db.Integer, primary_key=True)
    worksheet_id = db.Column(db.Integer, db.ForeignKey('worksheet_templates.id', ondelete='CASCADE'), nullable=False)
    user_type = db.Column(db.String(20), nullable=False)  # 'admin', 'user', 'anonymous'
    user_identifier = db.Column(db.String(200), nullable=False)  # username, email, IP, etc.
    session_id = db.Column(db.String(100), nullable=True)  # ID de sesión para anónimos
    action = db.Column(db.String(20), nullable=False)  # 'connected', 'disconnected'
    ip_address = db.Column(db.String(45), nullable=True)  # IPv4 o IPv6
    user_agent = db.Column(db.String(500), nullable=True)  # Información del navegador
    connection_time = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)  # Tiempo de inicio
    end_time = db.Column(db.DateTime, nullable=True)  # ⭐ NUEVO: Tiempo de fin (para rangos)
    duration_seconds = db.Column(db.Integer, nullable=True)  # Duración de la sesión si es disconnect
    
    # Relación definida en WorksheetTemplate
    pass
    
    def __repr__(self):
        return f'<ConnectionLog {self.user_identifier} - {self.action} - {self.connection_time}>'
    
    @property
    def formatted_duration(self):
        """Devuelve la duración formateada en texto legible"""
        if not self.duration_seconds:
            return "N/A"
        
        hours = self.duration_seconds // 3600
        minutes = (self.duration_seconds % 3600) // 60
        seconds = self.duration_seconds % 60
        
        if hours > 0:
            return f"{hours}h {minutes}m {seconds}s"
        elif minutes > 0:
            return f"{minutes}m {seconds}s"
        else:
            return f"{seconds}s"
    
    @property
    def display_name(self):
        """Devuelve el nombre a mostrar según el tipo de usuario"""
        if self.user_type == 'anonymous':
            # Solo para anónimos usamos formato especial con IP
            return f"Anónimo [{self.ip_address}]"
        else:
            # Para admin y user, usar user_identifier tal como está guardado
            # Ya incluye el formato correcto como "admin (tavo)" o "username"
            return self.user_identifier

# ================== MODELOS PARA LICENCIAS ==================

class License(db.Model):
    __tablename__ = 'store_licenses'
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('store_products.id', ondelete='CASCADE'), nullable=False)
    position = db.Column(db.Integer, default=0, index=True)  # Posición para ordenar
    enabled = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relación con producto
    product = db.relationship('Product', backref='license_info')
    
    # Relación con cuentas de licencia
    accounts = db.relationship('LicenseAccount', backref='license', cascade="all, delete-orphan")
    
    def __repr__(self):
        return f'<License {self.product.name if self.product else "Unknown"} (pos: {self.position})>'

class LicenseAccount(db.Model):
    __tablename__ = 'store_license_accounts'
    id = db.Column(db.Integer, primary_key=True)
    license_id = db.Column(db.Integer, db.ForeignKey('store_licenses.id', ondelete='CASCADE'), nullable=False)
    account_identifier = db.Column(db.String(200), nullable=False)  # Ej: "disneyprem5+0k9"
    email = db.Column(db.String(120), nullable=False)  # Ej: "disneyprem5+0k9@gmail.com"
    password = db.Column(db.String(200), nullable=False)  # Ej: "3dw9k65tz"
    status = db.Column(db.String(20), default='available')  # 'available', 'assigned', 'sold'
    assigned_to_user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    assigned_at = db.Column(db.DateTime, nullable=True)
    expires_at = db.Column(db.DateTime, nullable=True)  # Fecha de expiración (1 mes)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relación con usuario asignado
    assigned_user = db.relationship('User', backref='assigned_license_accounts')
    
    def __repr__(self):
        return f'<LicenseAccount {self.account_identifier} ({self.status})>'
    
    @property
    def is_expired(self):
        """Verifica si la cuenta ha expirado"""
        if not self.expires_at:
            return False
        return datetime.utcnow() > self.expires_at
    
    @property
    def days_until_expiry(self):
        """Devuelve los días hasta la expiración"""
        if not self.expires_at:
            return None
        delta = self.expires_at - datetime.utcnow()
        return delta.days if delta.days > 0 else 0

 