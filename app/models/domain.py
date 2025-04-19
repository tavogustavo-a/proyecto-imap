from app.extensions import db

class DomainModel(db.Model):
    __tablename__ = "domains"
    id = db.Column(db.Integer, primary_key=True)
    domain = db.Column(db.String(255), unique=True, nullable=False)
    enabled = db.Column(db.Boolean, default=True)

    def __repr__(self):
        return f"<Domain {self.domain} (enabled={self.enabled})>"
