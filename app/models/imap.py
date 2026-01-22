# app/models/imap.py

from app.extensions import db

class IMAPServer(db.Model):
    __tablename__ = "imap_servers"
    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.String(500), nullable=True)  # Descripción opcional del servidor
    host = db.Column(db.String(200), nullable=False)
    port = db.Column(db.Integer, default=993)
    username = db.Column(db.String(200), nullable=False)
    password_enc = db.Column(db.String(255), nullable=False)
    enabled = db.Column(db.Boolean, default=True)
    folders = db.Column(db.String(500), nullable=False, server_default="INBOX")

    def to_dict(self):
        """Serializa el objeto IMAPServer a un diccionario para exportación."""
        return {
            'original_id': self.id,
            'description': self.description,
            'host': self.host,
            'port': self.port,
            'username': self.username,
            'password_enc': self.password_enc,
            'enabled': self.enabled,
            'folders': self.folders
        }

    def __repr__(self):
        return f"<IMAPServer {self.host}:{self.port}>"
