# app/models/service.py

from app.extensions import db
from app.models.alias import ServiceAlias
from app.models.service_icon import ServiceIcon

# Tablas asociativas para Filter y Regex
service_regex = db.Table(
    "service_regex",
    db.Column("service_id", db.Integer, db.ForeignKey("services.id"), primary_key=True),
    db.Column("regex_id", db.Integer, db.ForeignKey("regexes.id"), primary_key=True)
)

service_filter = db.Table(
    "service_filter",
    db.Column("service_id", db.Integer, db.ForeignKey("services.id"), primary_key=True),
    db.Column("filter_id", db.Integer, db.ForeignKey("filters.id"), primary_key=True)
)


class ServiceModel(db.Model):
    __tablename__ = "services"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    color = db.Column(db.String(50), default="black")       # Color de texto
    border_color = db.Column(db.String(50), default="#000") # Contorno
    position = db.Column(db.Integer, default=1)
    enabled = db.Column(db.Boolean, default=True)
    protected = db.Column(db.Boolean, default=False)

    # Unificamos a: off / on-no-usuarios / on-usuarios
    visibility_mode = db.Column(db.String(20), default="off")

    # Relación many-to-many con RegexModel y FilterModel
    regexes = db.relationship(
        "RegexModel",
        secondary=service_regex,
        backref="services"
    )
    filters = db.relationship(
        "FilterModel",
        secondary=service_filter,
        backref="services"
    )

    # Relación con ServiceAlias
    aliases = db.relationship(
        "ServiceAlias",
        back_populates="service",
        cascade="all, delete-orphan"
    )

    # Relación con ServiceIcon (1 servicio => muchos iconos)
    service_icons = db.relationship(
        "ServiceIcon",
        back_populates="service",
        cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Service {self.name} (id={self.id}, visibility={self.visibility_mode})>"
