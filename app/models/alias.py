# app/models/alias.py

from app.extensions import db
# IMPORTANTE: importar aquí la clase AliasIcon
from app.models.alias_icon import AliasIcon

class ServiceAlias(db.Model):
    __tablename__ = "service_aliases"

    id = db.Column(db.Integer, primary_key=True)
    service_id = db.Column(db.Integer, db.ForeignKey("services.id", ondelete='CASCADE'), nullable=False)
    alias_name = db.Column(db.String(500), nullable=False)
    border_color = db.Column(db.String(50), default="#000000")
    gradient_color = db.Column(db.String(50), default="#000000")  # Segundo color para degradado de alias
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
        return f"<ServiceAlias {self.alias_name} for service {self.service_id}>"

    def to_dict(self, include_icons=False):
        data = {
            'id': self.id,
            # 'service_id': self.service_id, # No necesario si se importa bajo un servicio
            'alias_name': self.alias_name,
            'border_color': self.border_color,
            'gradient_color': self.gradient_color
        }
        if include_icons:
            # Exportamos solo los nombres, suficiente para recrearlos
            data['alias_icons'] = [icon.icon_name for icon in self.alias_icons]
            # O si necesitas más info del icono: 
            # data['alias_icons'] = [icon.to_dict() for icon in self.alias_icons]
        return data
