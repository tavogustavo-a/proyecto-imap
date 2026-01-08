# app/models/security_rules.py
from app.extensions import db

class SecurityRule(db.Model):
    __tablename__ = "security_rules"
    id = db.Column(db.Integer, primary_key=True)
    
    sender = db.Column(db.String(255), nullable=True) 
    description = db.Column(db.String(255), nullable=True)
    trigger_pattern = db.Column(db.Text, nullable=False)
    observer_pattern = db.Column(db.Text, nullable=False) 
    imap_server_id = db.Column(db.Integer, db.ForeignKey('imap_servers.id', ondelete='CASCADE'), nullable=True)
    imap_server = db.relationship('IMAPServer', backref=db.backref('security_rules', lazy=True))
    imap_folder = db.Column(db.String(255), nullable=True)  # Carpeta específica dentro del servidor
    enabled = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=db.func.current_timestamp())
    updated_at = db.Column(db.DateTime, default=db.func.current_timestamp(), onupdate=db.func.current_timestamp())

    def __repr__(self):
        return f"<SecurityRule id={self.id} sender='{self.sender}' trigger='{self.trigger_pattern[:30]}...'>"

    def to_dict(self):
        return {
            'id': self.id,
            'sender': self.sender,
            'description': self.description,
            'trigger_pattern': self.trigger_pattern,
            'observer_pattern': self.observer_pattern,
            'imap_server_id': self.imap_server_id,
            'imap_folder': self.imap_folder,
            'enabled': self.enabled
        } 