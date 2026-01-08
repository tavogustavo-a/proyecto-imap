# app/models/alias_icon.py

from app.extensions import db

class AliasIcon(db.Model):
    __tablename__ = "alias_icons"

    id = db.Column(db.Integer, primary_key=True)
    alias_id = db.Column(db.Integer, db.ForeignKey("service_aliases.id", ondelete='CASCADE'), nullable=False)
    icon_name = db.Column(db.String(50), nullable=False)

    # Relación inversa hacia ServiceAlias
    alias = db.relationship("ServiceAlias", back_populates="alias_icons")

    def __repr__(self):
        return f"<AliasIcon {self.icon_name} (alias_id={self.alias_id})>"

    def to_dict(self):
        return {
            'id': self.id,
            # 'alias_id': self.alias_id, # Probablemente no necesario para exportar/importar si se maneja por relación
            'icon_name': self.icon_name 
        }
