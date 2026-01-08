# app/models/email_forwarding.py

from app.extensions import db
from datetime import datetime

class EmailForwarding(db.Model):
    """Modelo para configuración de reenvío de correos vía dominio"""
    
    __tablename__ = 'email_forwarding'
    
    id = db.Column(db.Integer, primary_key=True)
    source_email = db.Column(db.String(255), nullable=True, unique=True, index=True)  # Opcional para catch-all
    destination_email = db.Column(db.String(255), nullable=False)
    enabled = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        source = self.source_email or '[TODOS]'
        return f'<EmailForwarding {source} -> {self.destination_email}>'
    
    def to_dict(self):
        """Convierte el objeto a diccionario"""
        return {
            'id': self.id,
            'source_email': self.source_email,
            'destination_email': self.destination_email,
            'enabled': self.enabled,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    @classmethod
    def get_active_forwardings(cls):
        """Obtiene todos los reenvíos activos"""
        return cls.query.filter_by(enabled=True).all()
    
    @classmethod
    def find_by_source_email(cls, source_email):
        """Busca un reenvío por email origen"""
        return cls.query.filter_by(source_email=source_email).first()
    
    def toggle_status(self):
        """Cambia el estado activo/inactivo"""
        self.enabled = not self.enabled
        self.updated_at = datetime.utcnow()
        return self.enabled
