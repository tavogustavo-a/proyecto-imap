# app/models/trigger_log.py
from app.extensions import db
from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import relationship

class TriggerLog(db.Model):
    __tablename__ = "trigger_log"
    id = db.Column(db.Integer, primary_key=True)
    
    # Quién hizo la búsqueda que activó el trigger
    user_id = db.Column(db.Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    user = relationship("User") # Relación opcional para fácil acceso
    
    # Qué regla de seguridad se activó
    rule_id = db.Column(db.Integer, ForeignKey('security_rules.id', ondelete='CASCADE'), nullable=False, index=True)
    rule = relationship("SecurityRule") # Relación opcional
    
    # Cómo identificar el correo específico
    # Usar Message-ID es lo ideal si lo puedes obtener y buscar
    email_identifier = db.Column(String(512), nullable=False, index=True) 
    
    # Identificador único del correo (para re-búsqueda si es necesario)
    searched_email = db.Column(String(255), nullable=True, index=True)
    
    # Cuándo se registró este log
    timestamp = db.Column(DateTime, default=db.func.current_timestamp(), index=True)

    def __repr__(self):
        return f"<TriggerLog id={self.id} user={self.user_id} rule={self.rule_id} searched='{self.searched_email}' time='{self.timestamp}'>" 