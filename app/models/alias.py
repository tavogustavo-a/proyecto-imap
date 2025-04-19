# app/models/alias.py

from app.extensions import db
# IMPORTANTE: importar aquí la clase AliasIcon
from app.models.alias_icon import AliasIcon

class ServiceAlias(db.Model):
    __tablename__ = "service_aliases"

    id = db.Column(db.Integer, primary_key=True)
    service_id = db.Column(db.Integer, db.ForeignKey("services.id"), nullable=False)
    alias_name = db.Column(db.String(100), nullable=False)
    border_color = db.Column(db.String(50), default="#ff0000")
    enabled = db.Column(db.Boolean, default=True)

    # Relación "Alias => muchos Iconos"
    alias_icons = db.relationship(
        "AliasIcon",
        back_populates="alias",
        cascade="all, delete-orphan"
    )

    # Relación bidireccional con ServiceModel
    service = db.relationship("ServiceModel", back_populates="aliases")

    def __repr__(self):
        return f"<ServiceAlias {self.alias_name} (service_id={self.service_id}, color={self.border_color})>"
