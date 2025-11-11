# app/main.py

from flask import Blueprint, render_template
from app.models.service import ServiceModel
from app.models.settings import SiteSettings
from app.extensions import db

main_bp = Blueprint("main_bp", __name__)

@main_bp.context_processor
def inject_worksheet_access():
    try:
        from app.store.routes import user_has_worksheet_access
        return {"user_has_worksheet_access": user_has_worksheet_access}
    except ImportError:
        # Si no se puede importar, devolver una función que siempre retorna False
        def dummy_worksheet_access(user):
            return False
        return {"user_has_worksheet_access": dummy_worksheet_access}

# ✅ NUEVO: Ruta para favicon.ico para evitar error 404
@main_bp.route('/favicon.ico')
def favicon():
    """Redirigir favicon.ico a favicon.svg para evitar error 404"""
    from flask import redirect, url_for
    return redirect(url_for('static', filename='images/favicon.svg'))

@main_bp.route("/", methods=["GET"])
def home():
    from flask import session
    from app.models.user import User
    
    # logo_enabled = SiteSettings.query.filter_by(key="logo_enabled").first()
    search_message = SiteSettings.query.filter_by(key="search_message").first()

    # Tomar servicios con visibility_mode != 'off'
    all_visible = ServiceModel.query.filter(ServiceModel.visibility_mode != "off").all()

    def priority_key(s):
        return abs(s.position)*2 + (1 if s.position > 0 else 0)

    services_sorted = sorted(all_visible, key=priority_key)
    default_service_id = services_sorted[0].id if services_sorted else None

    services_in_rows = [services_sorted[i:i+2] for i in range(0, len(services_sorted), 2)]

    # Obtener usuario actual
    current_user = None
    username = session.get('username')
    user_id = session.get('user_id')
    
    if username:
        current_user = User.query.filter_by(username=username).first()
    elif user_id:
        current_user = User.query.get(user_id)

    return render_template(
        "search.html",
        # logo_on=(logo_enabled.value == "true" if logo_enabled else False),
        main_message=(search_message.value if search_message else ""),
        services_in_rows=services_in_rows,
        default_service_id=default_service_id,
        current_user=current_user
    )

@main_bp.route("/codigos2", methods=["GET"])
def home2():
    """Ruta para la segunda página de códigos (search2.html) que usa servidores IMAP2"""
    from flask import session
    from app.models.user import User
    
    # Tomar solo servicios con visibility_mode = 'codigos-2'
    all_visible = ServiceModel.query.filter(ServiceModel.visibility_mode == "codigos-2").all()

    def priority_key(s):
        return abs(s.position)*2 + (1 if s.position > 0 else 0)

    services_sorted = sorted(all_visible, key=priority_key)
    default_service_id = services_sorted[0].id if services_sorted else None

    services_in_rows = [services_sorted[i:i+2] for i in range(0, len(services_sorted), 2)]

    # Obtener usuario actual
    current_user = None
    username = session.get('username')
    user_id = session.get('user_id')
    
    if username:
        current_user = User.query.filter_by(username=username).first()
    elif user_id:
        current_user = User.query.get(user_id)

    return render_template(
        "search2.html",
        services_in_rows=services_in_rows,
        default_service_id=default_service_id,
        current_user=current_user
    )