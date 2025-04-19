# app/models/imap.py

from app.extensions import db

class IMAPServer(db.Model):
    __tablename__ = "imap_servers"
    id = db.Column(db.Integer, primary_key=True)
    host = db.Column(db.String(200), nullable=False)
    port = db.Column(db.Integer, default=993)
    username = db.Column(db.String(200), nullable=False)
    password_enc = db.Column(db.String(255), nullable=False)
    enabled = db.Column(db.Boolean, default=True)
    folders = db.Column(db.String(500), nullable=False, server_default="INBOX")

    def __repr__(self):
        return f"<IMAPServer {self.host}:{self.port}>"
