from datetime import datetime, time
import pytz
from app import db

# Timezone de Colombia
COLOMBIA_TZ = pytz.timezone('America/Bogota')

class EmailCleanup(db.Model):
    __tablename__ = 'email_cleanup'
    
    id = db.Column(db.Integer, primary_key=True)
    time = db.Column(db.Time, nullable=False)  # Hora diaria de ejecución
    folder_type = db.Column(db.String(20), nullable=False)  # 'inbox', 'trash', 'tag'
    tag_id = db.Column(db.Integer, db.ForeignKey('email_tags_table.id'), nullable=True)  # Solo para folder_type='tag'
    enabled = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relación con EmailTag
    tag = db.relationship('EmailTag', backref='cleanups')
    
    def __repr__(self):
        folder_name = self.get_folder_name()
        return f'<EmailCleanup {self.time.strftime("%H:%M")} - {folder_name}>'
    
    def get_folder_name(self):
        """Obtiene el nombre de la carpeta a limpiar"""
        if self.folder_type == 'inbox':
            return 'Recibidos'
        elif self.folder_type == 'trash':
            return 'Papelera'
        elif self.folder_type == 'tag' and self.tag:
            return self.tag.name
        else:
            return 'Carpeta desconocida'
    
    @property
    def folder_name(self):
        """Propiedad para usar en templates"""
        return self.get_folder_name()
    
    def get_time_12h(self):
        """Obtiene la hora en formato 12 horas (AM/PM)"""
        return self.time.strftime('%I:%M %p')
    
    def get_time_24h(self):
        """Obtiene la hora en formato 24 horas"""
        return self.time.strftime('%H:%M')
    
    @classmethod
    def parse_time_12h(cls, time_str):
        """Convierte hora en formato 12h (ej: '02:30 PM') a objeto time"""
        try:
            return datetime.strptime(time_str, '%I:%M %p').time()
        except ValueError:
            # Si falla, intentar formato 24h como fallback
            return datetime.strptime(time_str, '%H:%M').time()
    
    def get_colombia_datetime(self):
        """Obtiene la fecha/hora actual en timezone de Colombia"""
        utc_now = datetime.utcnow().replace(tzinfo=pytz.UTC)
        colombia_now = utc_now.astimezone(COLOMBIA_TZ)
        return colombia_now
    
    def to_dict(self):
        return {
            'id': self.id,
            'time': self.time.strftime('%H:%M'),
            'time_12h': self.get_time_12h(),
            'folder_type': self.folder_type,
            'tag_id': self.tag_id,
            'folder_name': self.get_folder_name(),
            'enabled': self.enabled,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }
    
    def toggle_status(self):
        """Cambia el estado activo/inactivo"""
        self.enabled = not self.enabled
        return self.enabled
    
    @classmethod
    def get_active_cleanups(cls):
        """Obtiene todas las limpiezas activas"""
        return cls.query.filter_by(enabled=True).all()
    
    @classmethod
    def create_cleanup(cls, cleanup_time, folder_type, tag_id=None):
        """Crea una nueva limpieza automática"""
        cleanup = cls(
            time=cleanup_time,
            folder_type=folder_type,
            tag_id=tag_id if folder_type == 'tag' else None
        )
        db.session.add(cleanup)
        db.session.commit()
        return cleanup
