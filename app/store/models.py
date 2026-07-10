from datetime import datetime, timezone
from app.extensions import db
from app.models.user import User
from sqlalchemy.dialects.sqlite import JSON
# Nota: Los defaults de BD usan datetime.utcnow() para consistencia.
# Para mostrar fechas al usuario, usar utc_to_colombia() del módulo app.utils.timezone

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
    is_renewal = db.Column(db.Boolean, default=False, nullable=False, index=True)
    # renovar_1_mes | dejar_mes_a_mes | mixto (renovación pagada en tienda)
    renewal_kind = db.Column(db.String(24), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class SalePurchaseSnapshot(db.Model):
    """Copia permanente de credenciales por compra (historial / Ver licencias)."""
    __tablename__ = 'store_sale_purchase_snapshots'
    id = db.Column(db.Integer, primary_key=True)
    sale_id = db.Column(db.Integer, nullable=True, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    product_id = db.Column(db.Integer, nullable=True)
    product_name = db.Column(db.String(200), nullable=False)
    quantity = db.Column(db.Integer, default=1)
    total_price = db.Column(db.Numeric(10, 2), nullable=False)
    sale_created_at = db.Column(db.DateTime, nullable=False, index=True)
    licencias_json = db.Column(db.Text, nullable=False, default='[]')
    is_renewal = db.Column(db.Boolean, default=False, nullable=False)
    renewal_kind = db.Column(db.String(24), nullable=True)
    is_reversed = db.Column(db.Boolean, default=False, nullable=False)
    reversed_at = db.Column(db.DateTime, nullable=True)
    purged_from_sales = db.Column(db.Boolean, default=False, nullable=False, index=True)
    whatsapp_daily_co_date = db.Column(db.Date, nullable=True, index=True)
    whatsapp_daily_sent_at = db.Column(db.DateTime, nullable=True, index=True)
    whatsapp_daily_send_attempts = db.Column(db.Integer, default=0, nullable=False, server_default='0')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Coupon(db.Model):
    __tablename__ = "store_coupons"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    discount_cop = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    discount_usd = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    duration_days = db.Column(db.Integer, nullable=False, default=1)
    max_uses_per_user = db.Column(db.Integer, nullable=True, default=None)
    enabled = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
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
    cell_history = db.relationship('WorksheetCellHistory', backref='template', cascade="all, delete-orphan")

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


# ⭐ Historial de cambios por celda para Ctrl+Z / Ctrl+Y (estilo Excel, 15 por celda)
class WorksheetCellHistory(db.Model):
    __tablename__ = 'worksheet_cell_history'
    id = db.Column(db.Integer, primary_key=True)
    template_id = db.Column(db.Integer, db.ForeignKey('worksheet_templates.id', ondelete='CASCADE'), nullable=False)
    row = db.Column(db.Integer, nullable=False)
    col = db.Column(db.Integer, nullable=False)
    old_value = db.Column(db.Text, nullable=True)  # valor anterior (para undo)
    new_value = db.Column(db.Text, nullable=True)  # valor nuevo (para redo)
    created_at = db.Column(db.DateTime, server_default=db.func.now())
    status = db.Column(db.String(20), default='undo')  # 'undo' = disponible para deshacer, 'redo' = disponible para rehacer

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

class DriveTransfer(db.Model):
    __tablename__ = "drive_transfers"
    id = db.Column(db.Integer, primary_key=True)
    credentials_json = db.Column(db.Text, nullable=False)
    drive_original_id = db.Column(db.String(128), nullable=False)
    drive_processed_id = db.Column(db.String(128), nullable=False)
    drive_deleted_id = db.Column(db.String(128), nullable=True)  # Carpeta para archivos eliminados
    processing_time = db.Column(db.String(20), nullable=False)  # Intervalo: "5h" o "10m" (horas o minutos)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    last_processed = db.Column(db.DateTime, nullable=True)
    activated_at = db.Column(db.DateTime, nullable=True)  # Momento en que se activó por primera vez
    consecutive_errors = db.Column(db.Integer, default=0, nullable=False)  # Contador de errores consecutivos
    last_error = db.Column(db.Text, nullable=True)  # Último error de conexión
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<DriveTransfer {self.drive_original_id} -> {self.drive_processed_id}>'

class WhatsAppConfig(db.Model):
    __tablename__ = "whatsapp_configs"
    id = db.Column(db.Integer, primary_key=True)
    # Evolution API key (AUTHENTICATION_API_KEY del servicio)
    api_key = db.Column(db.String(255), nullable=False)
    # Número esperado / etiqueta (opcional, sin +)
    phone_number = db.Column(db.String(20), nullable=False)
    webhook_verify_token = db.Column(db.String(255), nullable=False, default='')
    template_message = db.Column(db.Text, nullable=False, default='')
    notification_time = db.Column(db.Time, nullable=False)  # Hora colombiana
    is_enabled = db.Column(db.Boolean, default=True, nullable=False)
    last_sent = db.Column(db.DateTime, nullable=True)
    last_notify_at = db.Column(db.DateTime, nullable=True)
    notify_run_log_json = db.Column(db.Text, nullable=True)
    notify_catchup_after = db.Column(db.DateTime, nullable=True)
    last_notify_fail_alert_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # WhatsApp Web (Evolution API)
    base_url = db.Column(db.String(512), nullable=True)
    instance_name = db.Column(db.String(120), nullable=True)
    connection_status = db.Column(db.String(40), nullable=True, default='unknown')
    linked_phone = db.Column(db.String(40), nullable=True)
    last_health_at = db.Column(db.DateTime, nullable=True)
    last_health_error = db.Column(db.Text, nullable=True)
    last_disconnect_alert_at = db.Column(db.DateTime, nullable=True)
    alert_email = db.Column(db.String(255), nullable=True)
    health_alert_enabled = db.Column(db.Boolean, default=True, nullable=False)

    def __repr__(self):
        return f'<WhatsAppConfig {self.phone_number}>'

# Modelo para Regex específicos de SMS
class SMSRegex(db.Model):
    """Regex específicos para filtrar mensajes SMS - Cada regex pertenece a un solo SMSConfig"""
    __tablename__ = "sms_regex"
    id = db.Column(db.Integer, primary_key=True)
    sms_config_id = db.Column(db.Integer, db.ForeignKey('sms_configs.id', ondelete='CASCADE'), nullable=False, index=True)
    name = db.Column(db.String(200), nullable=False)  # Nombre descriptivo del regex
    pattern = db.Column(db.String(500), nullable=False)  # Patrón regex
    enabled = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relación uno-a-muchos: cada regex pertenece a un solo SMSConfig
    # El backref 'regexes' se define en SMSConfig para evitar conflictos
    sms_config = db.relationship('SMSConfig', back_populates='regexes')
    
    def __repr__(self):
        return f'<SMSRegex {self.name} ({self.pattern[:30]}...)>'

class SMSConfig(db.Model):
    """Configuración de números SMS para recibir mensajes de texto"""
    __tablename__ = "sms_configs"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)  # Nombre descriptivo
    twilio_account_sid = db.Column(db.String(255), nullable=False)
    twilio_auth_token = db.Column(db.String(255), nullable=False)
    phone_number = db.Column(db.String(20), nullable=False, unique=True)  # Formato: +12672441170
    is_enabled = db.Column(db.Boolean, default=True, nullable=False, index=True)
    number_type = db.Column(db.String(20), default='desconocido', nullable=True, server_default='desconocido')  # 'comprado', 'temporal', 'desconocido'
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    messages = db.relationship('SMSMessage', backref='sms_config', lazy='dynamic', cascade='all, delete-orphan')
    allowed_numbers = db.relationship('AllowedSMSNumber', backref='sms_config', lazy='dynamic', cascade='all, delete-orphan')
    regexes = db.relationship('SMSRegex', back_populates='sms_config', lazy='dynamic', cascade='all, delete-orphan')
    
    # Relación uno-a-muchos con SMSRegex (cada regex pertenece a un solo SMSConfig)
    # La relación también se define en SMSRegex con backref='sms_config' para acceso bidireccional
    
    def __repr__(self):
        return f'<SMSConfig {self.phone_number} ({self.name})>'

class SMSMessage(db.Model):
    """Mensajes SMS recibidos"""
    __tablename__ = "sms_messages"
    id = db.Column(db.Integer, primary_key=True)
    sms_config_id = db.Column(db.Integer, db.ForeignKey('sms_configs.id', ondelete='CASCADE'), nullable=False, index=True)
    from_number = db.Column(db.String(20), nullable=False, index=True)
    to_number = db.Column(db.String(20), nullable=False)
    message_body = db.Column(db.Text, nullable=False)
    twilio_message_sid = db.Column(db.String(255), nullable=True, unique=True)
    twilio_status = db.Column(db.String(50), nullable=True)
    raw_data = db.Column(JSON, nullable=True)
    processed = db.Column(db.Boolean, default=False, nullable=False, index=True)
    processed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    
    def __repr__(self):
        return f'<SMSMessage {self.from_number} -> {self.to_number} ({self.created_at})>'

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
    # Reserva de garantía (admin «gar.»): n.º de cuentas disponibles que no se venden; por defecto 5
    warranty_days = db.Column(db.Integer, default=5, nullable=False)
    # Duración de cada periodo de licencia (días); default 30 = «mes» / mensual en tienda
    license_term_days = db.Column(db.Integer, default=30, nullable=False)
    enabled = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Notas de admin (también sincronizadas desde el bloc en la UI)
    personal_notes = db.Column(db.Text, nullable=True)
    license_notes = db.Column(db.Text, nullable=True)
    # Caídas / suspendidas (mismo formato que license_notes; persiste hasta borrado manual)
    suspended_notes = db.Column(db.Text, nullable=True)
    # Cuentas / licencias no renovables (sin mes a mes); mismo formato que license_notes
    expired_notes = db.Column(db.Text, nullable=True)
    # Si True, el producto se renueva mes a mes (oculta bloc Vencidas en admin)
    month_to_month = db.Column(db.Boolean, default=False, nullable=False)
    # Si True y stock=0 en tienda pública, el cliente puede reservar hasta que haya existencias.
    allow_reservation = db.Column(db.Boolean, default=False, nullable=False)
    # Si True, el cliente puede programar compras para el día siguiente (se procesan al cerrar el día).
    allow_next_day_reservation = db.Column(db.Boolean, default=False, nullable=False)
    # Si True, la tienda no vende inventario: el cliente envía su cuenta para que la enlacen/renueven.
    renew_customer_account = db.Column(db.Boolean, default=False, nullable=False)
    # Bloc «Cuentas para renovar»: credenciales del cliente (fuera de inventario); mismo formato pipe que license_notes.
    customer_renewal_notes = db.Column(db.Text, nullable=True)
    # Bloc «Cambios» (mes a mes): correo, terminado / problemas; mismo formato pipe que license_notes
    changes_notes = db.Column(db.Text, nullable=True)
    # JSON {"1":"texto bloc día 1", ...} — texto exacto del bloc por día (persiste aunque falle el parseo a cuentas)
    day_notepads_json = db.Column(db.Text, nullable=True)
    # Notas del cliente en portal «Licencias» por línea de día (no mezcladas con notas admin del bloc).
    # JSON: { "<user_id>": { "<día>_<índice_físico_línea>": "texto" } }
    portal_day_row_notes_json = db.Column(db.Text, nullable=True)

    # Relación con producto
    product = db.relationship('Product', backref='license_info')
    
    # Relación con cuentas de licencia
    accounts = db.relationship('LicenseAccount', backref='license', cascade="all, delete-orphan")
    
    def __repr__(self):
        return f'<License {self.product.name if self.product else "Unknown"} (pos: {self.position})>'

def _license_account_expiry_as_utc_aware(dt):
    """PostgreSQL puede devolver timestamptz (aware); utcnow() naive mezclado → TypeError en comparaciones."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc)
    return dt.replace(tzinfo=timezone.utc)


class LicenseAccount(db.Model):
    __tablename__ = 'store_license_accounts'
    id = db.Column(db.Integer, primary_key=True)
    license_id = db.Column(db.Integer, db.ForeignKey('store_licenses.id', ondelete='CASCADE'), nullable=False)
    account_identifier = db.Column(db.String(200), nullable=False)  # Ej: "disneyprem5+0k9"
    # Correo opcional en inventario bloc: usar '' cuando la línea no trae formato email.
    email = db.Column(db.String(120), nullable=False, default='')
    password = db.Column(db.String(200), nullable=False)  # Ej: "3dw9k65tz"
    status = db.Column(db.String(20), default='available')  # 'available', 'assigned', 'sold'
    assigned_to_user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    # Venta en tienda pública que originó la asignación (historial de compras / credenciales por compra).
    sale_id = db.Column(db.Integer, db.ForeignKey('store_sales.id', ondelete='SET NULL'), nullable=True, index=True)
    assigned_at = db.Column(db.DateTime, nullable=True)
    expires_at = db.Column(db.DateTime, nullable=True)  # Fecha de expiración (1 mes)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Posición 1-based en el bloc «Licencias» (license_notes): una unidad por línea aunque la credencial se repita.
    # NULL = creada fuera del sync del bloc (p. ej. API POST manual).
    inventory_bloc_ord = db.Column(db.Integer, nullable=True, index=True)
    # Reserva temporal en carrito de renovación (tienda pública).
    renewal_reserved_user_id = db.Column(
        db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True
    )
    renewal_reserved_at = db.Column(db.DateTime, nullable=True)

    # Relación con usuario asignado (foreign_keys: también existe renewal_reserved_user_id → users)
    assigned_user = db.relationship(
        'User',
        foreign_keys=[assigned_to_user_id],
        backref='assigned_license_accounts',
    )
    # Notas privadas del cliente (solo lectura/escritura en vista «Licencias» usuario; distintas del bloc admin).
    client_notes = db.Column(db.Text, nullable=True)
    
    def __repr__(self):
        return f'<LicenseAccount {self.account_identifier} ({self.status})>'
    
    @property
    def is_expired(self):
        """Verifica si la cuenta ha expirado"""
        if not self.expires_at:
            return False
        exp = _license_account_expiry_as_utc_aware(self.expires_at)
        return datetime.now(timezone.utc) > exp
    
    @property
    def days_until_expiry(self):
        """Devuelve los días hasta la expiración"""
        if not self.expires_at:
            return None
        exp = _license_account_expiry_as_utc_aware(self.expires_at)
        delta = exp - datetime.now(timezone.utc)
        return delta.days if delta.days > 0 else 0


class ProductReservation(db.Model):
    """Cola de reserva: producto agotado (kind='stock') o venta programada para el día
    siguiente Colombia (kind='next_day', allow_next_day_reservation en License)."""
    __tablename__ = 'store_product_reservations'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey('store_products.id', ondelete='CASCADE'), nullable=False, index=True)
    license_id = db.Column(db.Integer, db.ForeignKey('store_licenses.id', ondelete='SET NULL'), nullable=True)
    status = db.Column(db.String(20), default='pending', nullable=False, index=True)
    sale_id = db.Column(db.Integer, db.ForeignKey('store_sales.id', ondelete='SET NULL'), nullable=True)
    license_account_id = db.Column(db.Integer, nullable=True)
    price_cop = db.Column(db.Numeric(10, 2), nullable=False, server_default='0')
    price_usd = db.Column(db.Numeric(10, 2), nullable=False, server_default='0')
    currency = db.Column(db.String(3), default='USD', nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    fulfilled_at = db.Column(db.DateTime, nullable=True)
    cancelled_at = db.Column(db.DateTime, nullable=True)
    last_error = db.Column(db.String(500), nullable=True)
    # 'stock' = lista de espera clásica; 'next_day' = venta programada para otro día.
    kind = db.Column(db.String(16), default='stock', nullable=False, index=True)
    quantity = db.Column(db.Integer, default=1, nullable=False)
    # Resultado parcial ofrecido (p. ej. 5 de 10) pendiente de que el cliente acepte.
    offered_quantity = db.Column(db.Integer, nullable=True)
    fulfilled_quantity = db.Column(db.Integer, nullable=True)
    # Día calendario Colombia (YYYY-MM-DD) en que debe procesarse la venta programada.
    target_co_date = db.Column(db.String(10), nullable=True, index=True)

    user = db.relationship('User', foreign_keys=[user_id])
    product = db.relationship('Product', foreign_keys=[product_id])


class CustomerAccountRenewalOrder(db.Model):
    """Pedido pagado: cuenta enviada por el cliente para renovar/enlazar (sin inventario)."""
    __tablename__ = 'store_customer_account_renewals'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey('store_products.id', ondelete='CASCADE'), nullable=False, index=True)
    license_id = db.Column(db.Integer, db.ForeignKey('store_licenses.id', ondelete='SET NULL'), nullable=True)
    sale_id = db.Column(db.Integer, db.ForeignKey('store_sales.id', ondelete='SET NULL'), nullable=True, index=True)
    customer_email = db.Column(db.String(255), nullable=False)
    customer_password = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), default='pending', nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    processed_at = db.Column(db.DateTime, nullable=True)
    admin_notes = db.Column(db.Text, nullable=True)

    user = db.relationship('User', foreign_keys=[user_id])
    product = db.relationship('Product', foreign_keys=[product_id])


class CustomerRenewalNotifyBatch(db.Model):
    """Cola de avisos agrupados al cliente (complete/reject) — ventana 30 s desde el primero."""
    __tablename__ = 'store_customer_renewal_notify_batches'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    items_json = db.Column(db.Text, nullable=False, default='[]')
    flush_at = db.Column(db.DateTime, nullable=False, index=True)
    flushed_at = db.Column(db.DateTime, nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship('User', foreign_keys=[user_id])


class StoreUserNotification(db.Model):
    """Notificaciones in-app para usuarios de tienda (p. ej. reserva cumplida)."""
    __tablename__ = 'store_user_notifications'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    kind = db.Column(db.String(40), nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=False, default='')
    payload_json = db.Column(db.Text, nullable=True)
    read_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    user = db.relationship('User', foreign_keys=[user_id])


class MobilePushToken(db.Model):
    """Token FCM de la app Android/iOS Capacitor por usuario."""
    __tablename__ = 'store_mobile_push_tokens'
    __table_args__ = (db.UniqueConstraint('token', name='uq_store_mobile_push_token'),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    token = db.Column(db.String(512), nullable=False)
    platform = db.Column(db.String(20), nullable=False, default='android')
    device_label = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = db.relationship('User', foreign_keys=[user_id])


class AllowedSMSNumber(db.Model):
    """Modelo para almacenar números de teléfono permitidos para recibir SMS vinculados a un número SMS específico"""
    __tablename__ = "allowed_sms_numbers"
    __table_args__ = (
        db.UniqueConstraint('phone_number', 'sms_config_id', name='uq_allowed_sms_number_config'),
        db.Index('ix_allowed_sms_numbers_phone_number', 'phone_number'),
        db.Index('ix_allowed_sms_numbers_sms_config_id', 'sms_config_id')
    )
    
    id = db.Column(db.Integer, primary_key=True)
    phone_number = db.Column(db.String(255), nullable=False, index=True)  # Aumentado para soportar correos electrónicos
    sms_config_id = db.Column(db.Integer, db.ForeignKey('sms_configs.id', ondelete='CASCADE'), nullable=False, index=True)
    description = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relación con SMSConfig (backref 'sms_config' está definido en SMSConfig.allowed_numbers con cascade)
    
    def __repr__(self):
        return f'<AllowedSMSNumber {self.phone_number} (config: {self.sms_config_id})>'

class TwoFAConfig(db.Model):
    """Modelo para almacenar configuraciones de 2FA por correo (TOTP)"""
    __tablename__ = "twofa_configs"
    
    id = db.Column(db.Integer, primary_key=True)
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
        return f'<TwoFAConfig id={self.id} emails={self.emails[:50]}...>'


class BalanceRecharge(db.Model):
    """Solicitud de recarga de saldo (comprobante de transferencia, etc.)."""
    __tablename__ = "store_balance_recharges"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    submitted_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    currency = db.Column(db.String(3), nullable=False)
    payment_method_id = db.Column(db.String(48), nullable=True, index=True)
    amount_claimed = db.Column(db.Numeric(12, 2), nullable=True)
    note = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    proof_files_json = db.Column(db.Text, nullable=False, default="[]")
    auto_credited = db.Column(db.Boolean, nullable=False, default=False)
    amount_credited = db.Column(db.Numeric(12, 2), nullable=True)
    analyzer_json = db.Column(db.Text, nullable=True)
    admin_verified = db.Column(db.Boolean, nullable=True)
    receipt_number = db.Column(db.String(64), nullable=True, index=True)
    proof_image_hash = db.Column(db.String(64), nullable=True, unique=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    reviewed_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    admin_note = db.Column(db.Text, nullable=True)
    email_verify_status = db.Column(db.String(32), nullable=True, index=True)
    email_verify_attempts = db.Column(db.Integer, nullable=False, default=0)
    email_verify_next_at = db.Column(db.DateTime, nullable=True, index=True)
    email_verify_json = db.Column(db.Text, nullable=True)
    historial_producto = db.Column(db.String(200), nullable=True)

    def __repr__(self):
        return f"<BalanceRecharge id={self.id} user_id={self.user_id} status={self.status}>"


class BalanceRechargeHistorialSnapshot(db.Model):
    """Copia permanente de recargas para historial de compras tras limpieza del panel admin."""
    __tablename__ = 'store_balance_recharge_historial_snapshots'

    id = db.Column(db.Integer, primary_key=True)
    recharge_id = db.Column(db.Integer, nullable=True, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    currency = db.Column(db.String(3), nullable=False)
    payment_method_id = db.Column(db.String(48), nullable=True)
    amount_claimed = db.Column(db.Numeric(12, 2), nullable=True)
    amount_credited = db.Column(db.Numeric(12, 2), nullable=True)
    status = db.Column(db.String(20), nullable=False, index=True)
    auto_credited = db.Column(db.Boolean, nullable=False, default=False)
    admin_verified = db.Column(db.Boolean, nullable=True)
    admin_note = db.Column(db.Text, nullable=True)
    event_at = db.Column(db.DateTime, nullable=False, index=True)
    purged_from_recharges = db.Column(db.Boolean, default=False, nullable=False, index=True)
    historial_producto = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

 