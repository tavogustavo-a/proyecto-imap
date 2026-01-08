# app/models/filters.py

from app.extensions import db

class FilterModel(db.Model):
    __tablename__ = "filters"
    id = db.Column(db.Integer, primary_key=True)
    sender = db.Column(db.String(200), nullable=True)
    keyword = db.Column(db.String(200), nullable=True)
    enabled = db.Column(db.Boolean, default=True)
    cut_after_html = db.Column(db.String(255), nullable=True)
    cut_before_html = db.Column(db.String(255), nullable=True)
    is_default = db.Column(db.Boolean, nullable=False, server_default='0')

    def __repr__(self):
        return f"<Filter sender={self.sender} keyword={self.keyword}>"

    def to_dict(self):
        return {
            'id': self.id,
            'sender': self.sender,
            'keyword': self.keyword,
            'enabled': self.enabled,
            'cut_after_html': self.cut_after_html,
            'cut_before_html': self.cut_before_html
        }

class RegexModel(db.Model):
    __tablename__ = "regexes"
    id = db.Column(db.Integer, primary_key=True)
    sender = db.Column(db.String(200), nullable=True)
    pattern = db.Column(db.String(200), nullable=False)
    enabled = db.Column(db.Boolean, default=True)
    description = db.Column(db.String(255), nullable=True)
    is_default = db.Column(db.Boolean, nullable=False, server_default='0')
    protected = db.Column(db.Boolean, default=False)

    def __repr__(self):
        return f"<Regex sender={self.sender} pattern={self.pattern[:30]}... protected={self.protected}>"

    def to_dict(self):
        return {
            'id': self.id,
            'sender': self.sender,
            'pattern': self.pattern,
            'description': self.description,
            'enabled': self.enabled,
            'protected': self.protected
        }
