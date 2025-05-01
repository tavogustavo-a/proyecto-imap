# app/api/__init__.py

from flask import Blueprint, jsonify, request, session
from app.services.search_service import search_and_apply_filters
from app.models import User
from app.models.user import AllowedEmail

api_bp = Blueprint("api_bp", __name__)

@api_bp.route("/search_mails", methods=["POST"])
def search_mails():
    data = request.get_json()
    if not data or "email_to_search" not in data:
        return jsonify({"error": "Missing email_to_search"}), 400

    email_to_search = data["email_to_search"]
    service_id = data.get("service_id")

    user_id = session.get("user_id")
    if user_id:
        user = User.query.get(user_id)
    else:
        user = None  # usuario anónimo

    # Validar usuario
    if user:
        if not user.enabled:
            return jsonify({"error": "No tienes permiso al consultar este correo."}), 403
        
        # Si el usuario NO puede buscar cualquiera, verificamos si el email está permitido
        if not user.can_search_any:
            # Consulta a la nueva tabla AllowedEmail
            is_allowed = user.allowed_email_entries.filter_by(email=email_to_search.lower()).first() is not None
            # Alternativa (puede ser ligeramente más eficiente si no necesitas el objeto):
            # is_allowed = db.session.query(AllowedEmail.query.filter_by(user_id=user.id, email=email_to_search.lower()).exists()).scalar()
            
            if not is_allowed:
                return jsonify({"error": "No tienes permiso para consultar este correo específico."}), 403
    else:
        # Usuario anónimo => se permite o no (tu lógica actual)
        pass

    # Llamada con user
    mail_result = search_and_apply_filters(email_to_search, service_id, user=user)
    if not mail_result:
        return jsonify({"results": []}), 200

    return jsonify({"results": [mail_result]}), 200
