from app.extensions import db

class ObserverIMAPServer(db.Model):
    __tablename__ = "observer_imap_servers"

    __table_args__ = (
        db.UniqueConstraint('host', 'port', 'username', name='uq_observer_host_port_user'),
    )

    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.String(500), nullable=True)  # Descripción opcional del servidor
    host = db.Column(db.String(200), nullable=False)
    port = db.Column(db.Integer, default=993)
    username = db.Column(db.String(200), nullable=False)
    password_enc = db.Column(db.String(255), nullable=False)
    enabled = db.Column(db.Boolean, default=True)
    folders = db.Column(db.String(500), nullable=False, server_default="INBOX")
    buzon_folders_json = db.Column(db.Text, nullable=True)

    def buzon_folder_keys(self):
        """Carpetas del buzón a revisar. Lista vacía: no se consulta el buzón."""
        from app.models.email_forwarding import normalize_folder_keys
        return normalize_folder_keys(self.buzon_folders_json, empty_as_none=True) or []

    def set_buzon_folders(self, raw):
        import json
        from app.models.email_forwarding import normalize_folder_keys
        keys = normalize_folder_keys(raw, empty_as_none=True) or []
        self.buzon_folders_json = json.dumps(keys)
        return keys

    def to_dict(self):
        """Serializa el objeto ObserverIMAPServer a un diccionario para exportación."""
        return {
            'original_id': self.id,
            'description': self.description,
            'host': self.host,
            'port': self.port,
            'username': self.username,
            'password_enc': self.password_enc,
            'enabled': self.enabled,
            'folders': self.folders,
            'buzon_folders_json': self.buzon_folders_json,
        }

    def __repr__(self):
        return f"<ObserverIMAP {self.host}:{self.port}>" 