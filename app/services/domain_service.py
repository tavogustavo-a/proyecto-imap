# app/services/domain_service.py

from app.extensions import db
from app.models import DomainModel

def create_domain_service(domain_str):
    domain_str = domain_str.strip().lower()
    if not domain_str:
        return None
    existing = DomainModel.query.filter_by(domain=domain_str).first()
    if existing:
        return None
    new_dom = DomainModel(domain=domain_str, enabled=True)
    db.session.add(new_dom)
    db.session.commit()
    return new_dom

def update_domain_service(dom: DomainModel, new_domain_str):
    dom.domain = new_domain_str.strip().lower()
    db.session.commit()
    return dom

def toggle_domain_service(dom_id):
    dom = DomainModel.query.get_or_404(dom_id)
    dom.enabled = not dom.enabled
    db.session.commit()
    return dom.enabled

def delete_domain_service(dom_id):
    dom = DomainModel.query.get_or_404(dom_id)
    db.session.delete(dom)
    db.session.commit()

def get_all_domains():
    return DomainModel.query.order_by(DomainModel.domain).all()