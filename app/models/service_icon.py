# app/models/service_icon.py

from app.extensions import db

class ServiceIcon(db.Model):
    __tablename__ = "service_icons"

    id = db.Column(db.Integer, primary_key=True)
    service_id = db.Column(db.Integer, db.ForeignKey("services.id", ondelete='CASCADE'), nullable=False)
    icon_name = db.Column(db.String(50), nullable=False)

    # Relación: un ServiceIcon pertenece a un Service
    service = db.relationship("ServiceModel", back_populates="service_icons")

    def __repr__(self):
        return f"<ServiceIcon {self.icon_name} (service_id={self.service_id})>"
