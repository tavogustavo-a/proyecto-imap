# app/models/imap2.py

from app.extensions import db

# Tablas M2M para asociar filtros y regex con IMAPServer2
# CASCADE en imap2_id: cuando se elimina un IMAPServer2, se eliminan automáticamente sus relaciones M2M
# CASCADE en filter_id/regex_id: cuando se elimina un filtro o regex, se eliminan las relaciones M2M que lo referencian
# Esto asegura que no queden relaciones huérfanas en la base de datos
imap2_filter = db.Table(
    "imap2_filter",
    db.Column("imap2_id", db.Integer, db.ForeignKey('imap_servers2.id', ondelete='CASCADE'), primary_key=True),
    db.Column("filter_id", db.Integer, db.ForeignKey('filters.id', ondelete='CASCADE'), primary_key=True)
)

imap2_regex = db.Table(
    "imap2_regex",
    db.Column("imap2_id", db.Integer, db.ForeignKey('imap_servers2.id', ondelete='CASCADE'), primary_key=True),
    db.Column("regex_id", db.Integer, db.ForeignKey('regexes.id', ondelete='CASCADE'), primary_key=True)
)

class IMAPServer2(db.Model):
    __tablename__ = "imap_servers2"
    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.String(500), nullable=True)  # Descripción opcional del servidor
    host = db.Column(db.String(200), nullable=False)
    port = db.Column(db.Integer, default=993)
    username = db.Column(db.String(200), nullable=False)
    password_enc = db.Column(db.String(255), nullable=False)
    enabled = db.Column(db.Boolean, default=True)
    folders = db.Column(db.String(500), nullable=False, server_default="INBOX")
    route_path = db.Column(db.String(100), nullable=False, unique=True)  # Ej: /pagina2, /web - OBLIGATORIO
    paragraph = db.Column(db.Text, nullable=True)  # Párrafo personalizado para esta página

    # Relaciones M2M con FilterModel y RegexModel
    filters = db.relationship(
        "FilterModel",
        secondary=imap2_filter,
        backref="imap2_servers"
    )
    regexes = db.relationship(
        "RegexModel",
        secondary=imap2_regex,
        backref="imap2_servers"
    )

    def __repr__(self):
        return f"<IMAPServer2 {self.host}:{self.port} route={self.route_path}>"

