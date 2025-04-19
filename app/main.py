# app/main.py

from flask import Blueprint, render_template
from app.models.service import ServiceModel
from app.models.settings import SiteSettings
from app.extensions import db

main_bp = Blueprint("main_bp", __name__)

@main_bp.route("/", methods=["GET"])
def home():
    logo_enabled = SiteSettings.query.filter_by(key="logo_enabled").first()
    search_message = SiteSettings.query.filter_by(key="search_message").first()

    # Tomar servicios con visibility_mode != 'off'
    all_visible = ServiceModel.query.filter(ServiceModel.visibility_mode != "off").all()

    def priority_key(s):
        return abs(s.position)*2 + (1 if s.position > 0 else 0)

    services_sorted = sorted(all_visible, key=priority_key)
    default_service_id = services_sorted[0].id if services_sorted else None

    services_in_rows = [services_sorted[i:i+2] for i in range(0, len(services_sorted), 2)]

    return render_template(
        "search.html",
        logo_on=(logo_enabled.value == "true" if logo_enabled else False),
        main_message=(search_message.value if search_message else ""),
        services_in_rows=services_in_rows,
        default_service_id=default_service_id
    )