# app/models/email_buzon.py

from app.extensions import db
from datetime import datetime

# Tabla de asociación para la relación many-to-many entre emails y etiquetas
email_tags = db.Table('email_tags',
    db.Column('email_id', db.Integer, db.ForeignKey('received_emails.id'), primary_key=True),
    db.Column('tag_id', db.Integer, db.ForeignKey('email_tags_table.id'), primary_key=True)
)

class EmailBuzonServer(db.Model):
    """Servidor de buzón de mensajes para recibir reenvíos de Gmail/Hotmail"""
    __tablename__ = "email_buzon_servers"
    
    id = db.Column(db.Integer, primary_key=True)
    domain = db.Column(db.String(200), nullable=False, unique=True)  # tudominio.com
    smtp_port = db.Column(db.Integer, default=25)
    enabled = db.Column(db.Boolean, default=True)
    max_emails_per_second = db.Column(db.Integer, default=300)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<EmailBuzonServer {self.domain}>"

class EmailTag(db.Model):
    """Etiquetas personalizadas para emails"""
    __tablename__ = "email_tags_table"
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    color = db.Column(db.String(7), default="#3498db")  # Color hexadecimal
    
    # Campos legacy para compatibilidad (se mantendrán por ahora)
    filter_from_email = db.Column(db.Text)  # Filtro por remitente
    filter_to_email = db.Column(db.Text)    # Filtro por destinatario
    filter_subject_contains = db.Column(db.Text)  # Filtro por palabras en asunto
    filter_content_contains = db.Column(db.Text)  # Filtro por palabras en contenido
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def __repr__(self):
        return f"<EmailTag {self.name}>"
    
    def has_filters(self):
        """Verifica si la etiqueta tiene filtros configurados"""
        return any([
            self.filter_from_email,
            self.filter_to_email,
            self.filter_subject_contains,
            self.filter_content_contains
        ])
    
    def get_filter_summary(self):
        """Obtiene un resumen de los filtros configurados"""
        filters = []
        if self.filter_from_email:
            filters.append(f"De: {self.filter_from_email}")
        if self.filter_to_email:
            filters.append(f"Para: {self.filter_to_email}")
        if self.filter_subject_contains:
            filters.append(f"Asunto: {self.filter_subject_contains}")
        if self.filter_content_contains:
            filters.append(f"Contenido: {self.filter_content_contains}")
        return " | ".join(filters) if filters else "Sin filtros"

class EmailFilter(db.Model):
    """Filtros automáticos independientes para clasificación de emails"""
    __tablename__ = "email_filters"
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)  # Nombre descriptivo del filtro
    tag_id = db.Column(db.Integer, db.ForeignKey('email_tags_table.id'), nullable=True)  # Nullable para papelera
    
    # Condiciones del filtro
    filter_from_email = db.Column(db.Text)  # Filtro por remitente (contiene)
    filter_to_email = db.Column(db.Text)    # Filtro por destinatario (contiene)
    filter_subject_contains = db.Column(db.Text)  # Filtro por palabras en asunto
    filter_content_contains = db.Column(db.Text)  # Filtro por palabras en contenido
    
    # Configuración del filtro
    enabled = db.Column(db.Boolean, default=True)
    priority = db.Column(db.Integer, default=0)  # Para ordenar filtros (mayor prioridad = se ejecuta primero)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relación con la etiqueta
    tag = db.relationship('EmailTag', backref='filters')
    
    def __repr__(self):
        return f"<EmailFilter {self.name} -> {self.tag.name if self.tag else 'No Tag'}>"
    
    def has_conditions(self):
        """Verifica si el filtro tiene al menos una condición"""
        return any([
            self.filter_from_email,
            self.filter_to_email,
            self.filter_subject_contains,
            self.filter_content_contains
        ])
    
    def matches_email(self, email):
        """Verifica si un email coincide con las condiciones del filtro"""
        if not self.enabled or not self.has_conditions():
            return False
        
        # Verificar condición de remitente
        if self.filter_from_email:
            if not email.from_email or self.filter_from_email.lower() not in email.from_email.lower():
                return False
        
        # Verificar condición de destinatario
        if self.filter_to_email:
            if not email.to_email or self.filter_to_email.lower() not in email.to_email.lower():
                return False
        
        # Verificar condición de asunto
        if self.filter_subject_contains:
            if not email.subject or self.filter_subject_contains.lower() not in email.subject.lower():
                return False
        
        # Verificar condición de contenido
        if self.filter_content_contains:
            content = (email.content_text or '') + ' ' + (email.content_html or '')
            if self.filter_content_contains.lower() not in content.lower():
                return False
        
        return True
    
    def get_conditions_summary(self):
        """Obtiene un resumen de las condiciones del filtro"""
        conditions = []
        if self.filter_from_email:
            conditions.append(f"De: {self.filter_from_email}")
        if self.filter_to_email:
            conditions.append(f"Para: {self.filter_to_email}")
        if self.filter_subject_contains:
            conditions.append(f"Asunto: {self.filter_subject_contains}")
        if self.filter_content_contains:
            conditions.append(f"Contenido: {self.filter_content_contains}")
        return " | ".join(conditions) if conditions else "Sin condiciones"

class ReceivedEmail(db.Model):
    """Emails recibidos en el buzón de mensajes"""
    __tablename__ = "received_emails"
    
    id = db.Column(db.Integer, primary_key=True)
    from_email = db.Column(db.String(255), nullable=False, index=True)
    to_email = db.Column(db.String(255), nullable=False, index=True)
    subject = db.Column(db.Text)
    content_text = db.Column(db.Text)
    content_html = db.Column(db.Text)
    received_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    processed = db.Column(db.Boolean, default=False, index=True)
    message_id = db.Column(db.String(255), unique=True)
    buzon_server_id = db.Column(db.Integer, db.ForeignKey('email_buzon_servers.id'), nullable=True)
    
    # Campos para papelera
    deleted = db.Column(db.Boolean, default=False, index=True)
    deleted_at = db.Column(db.DateTime, nullable=True)
    
    # Relación con el servidor de buzón
    buzon_server = db.relationship('EmailBuzonServer', backref='received_emails')
    
    # Relación many-to-many con etiquetas
    tags = db.relationship('EmailTag', secondary=email_tags, backref='emails')
    
    def get_colombia_datetime(self):
        """Convierte la fecha UTC a zona horaria de Colombia"""
        if self.received_at:
            from app.utils.timezone import utc_to_colombia
            return utc_to_colombia(self.received_at)
        return None
    
    def get_time_12h(self):
        """Retorna la hora en formato 12 horas (AM/PM) en zona horaria de Colombia"""
        colombia_dt = self.get_colombia_datetime()
        if colombia_dt:
            return colombia_dt.strftime('%I:%M %p')
        return ''
    
    def get_date_time_12h(self):
        """Retorna fecha y hora completa en formato 12 horas en zona horaria de Colombia"""
        colombia_dt = self.get_colombia_datetime()
        if colombia_dt:
            return colombia_dt.strftime('%d/%m/%Y %I:%M %p')
        return ''
    
    def __repr__(self):
        return f"<ReceivedEmail {self.from_email} -> {self.to_email}>"

class BlockedSender(db.Model):
    """Remitentes bloqueados para evitar que lleguen a la base de datos"""
    __tablename__ = "blocked_senders"
    
    id = db.Column(db.Integer, primary_key=True)
    sender_email = db.Column(db.String(255), nullable=True, index=True)  # Email específico
    sender_domain = db.Column(db.String(255), nullable=True, index=True)  # Dominio completo
    enabled = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        if self.sender_email:
            return f"<BlockedSender email={self.sender_email}>"
        elif self.sender_domain:
            return f"<BlockedSender domain={self.sender_domain}>"
        return f"<BlockedSender id={self.id}>"
    
    def get_display_name(self):
        """Retorna el nombre a mostrar (email o dominio)"""
        if self.sender_email:
            return self.sender_email
        elif self.sender_domain:
            return f"@{self.sender_domain}"
        return "Sin especificar"
    
    def matches_email(self, email):
        """Verifica si este bloqueo coincide con el email dado"""
        if not self.enabled:
            return False
            
        if self.sender_email and self.sender_email.lower() == email.lower():
            return True
            
        if self.sender_domain:
            # Extraer dominio del email
            if '@' in email:
                email_domain = email.split('@')[1].lower()
                return email_domain == self.sender_domain.lower()
        
        return False
