# app/models/filters.py

from app.extensions import db

class FilterModel(db.Model):
    __tablename__ = "filters"
    id = db.Column(db.Integer, primary_key=True)
    sender = db.Column(db.String(200), nullable=True)
    keyword = db.Column(db.String(200), nullable=True)
    enabled = db.Column(db.Boolean, default=True)
    cut_after_html = db.Column(db.String(255), nullable=True)
    is_default = db.Column(db.Boolean, nullable=False, server_default='0')

class RegexModel(db.Model):
    __tablename__ = "regexes"
    id = db.Column(db.Integer, primary_key=True)
    sender = db.Column(db.String(200), nullable=True)
    pattern = db.Column(db.String(200), nullable=False)
    enabled = db.Column(db.Boolean, default=True)
    description = db.Column(db.String(255), nullable=True)
    is_default = db.Column(db.Boolean, nullable=False, server_default='0')

    protected = db.Column(db.Boolean, default=False)  # <--- Campo Nuevo

    def __repr__(self):
        return f"<Regex sender={self.sender} pattern={self.pattern[:30]}... protected={self.protected}>"
