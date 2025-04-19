# app/admin/admin_users.py

from flask import (
    request, jsonify, render_template, redirect,
    url_for, flash, current_app, session
)
import re
from werkzeug.security import generate_password_hash
from app.extensions import db
from app.models import User
from app.models.filters import FilterModel, RegexModel
from app.models.service import ServiceModel
from app.admin.decorators import admin_required
from .admin_bp import admin_bp
from app.models import RememberDevice
from app.helpers import increment_global_session_revocation_count

# Importamos AllowedEmail
from app.models.user import AllowedEmail

@admin_bp.route("/usuarios", methods=["GET"])
@admin_required
def usuarios_page():
    """
    Muestra la plantilla usuarios.html, donde se listan
    únicamente usuarios principales (parent_id IS NULL),
    excluyendo además al usuario admin.
    """
    return render_template("usuarios.html")


@admin_bp.route("/search_users_ajax", methods=["GET"])
@admin_required
def search_users_ajax():
    """
    Devuelve en JSON la lista de usuarios PRINCIPALES (no sub-usuarios),
    excluyendo además al usuario administrador.
    """
    query = request.args.get("query", "").strip().lower()
    user_q = User.query

    # Excluir sub-usuarios => parent_id IS NULL
    user_q = user_q.filter(User.parent_id.is_(None))

    # Excluir admin
    admin_username = current_app.config.get("ADMIN_USER", "admin")
    user_q = user_q.filter(User.username != admin_username)

    if query:
        user_q = user_q.filter(User.username.ilike(f"%{query}%"))

    user_q = user_q.order_by(User.position.asc())
    all_users = user_q.all()

    data = []
    for u in all_users:
        data.append({
            "id": u.id,
            "username": u.username,
            "enabled": u.enabled,
            "color": u.color,
            "position": u.position,
            "can_search_any": u.can_search_any,
            "can_create_subusers": u.can_create_subusers,
            "parent_id": u.parent_id if u.parent_id else None
        })
    return jsonify({"status": "ok", "users": data}), 200


@admin_bp.route("/create_user_ajax", methods=["POST"])
@admin_required
def create_user_ajax():
    """
    Crea un usuario principal (no sub-usuario).
    """
    try:
        data = request.get_json()
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()
        color = data.get("color", "#ffffff").strip() or "#ffffff"
        position = data.get("position", 1)
        can_search_any = data.get("can_search_any", False)

        if not username or not password:
            return jsonify({"status": "error", "message": "Usuario y contraseña son obligatorios."}), 400

        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if username == admin_username:
            return jsonify({"status": "error", "message": "No puedes usar el nombre del admin."}), 403

        existing_user = User.query.filter_by(username=username).first()
        if existing_user:
            return jsonify({"status": "error", "message": f"El usuario '{username}' ya existe."}), 400

        hashed_pass = generate_password_hash(password)
        try:
            position = int(position)
        except:
            position = 1

        new_user = User(
            username=username,
            password=hashed_pass,
            color=color,
            position=position,
            can_search_any=bool(can_search_any),
            enabled=True,
            parent_id=None
        )
        db.session.add(new_user)
        db.session.commit()

        # ===== Asignar TODOS los filtros y regex existentes =====
        all_filters = FilterModel.query.all()
        all_regexes = RegexModel.query.all()

        for f in all_filters:
            new_user.filters_allowed.append(f)
        for r in all_regexes:
            new_user.regexes_allowed.append(r)

        db.session.commit()

        user_q = User.query.filter(User.parent_id.is_(None)).filter(User.username != admin_username)
        user_q = user_q.order_by(User.position.asc())
        all_users = user_q.all()

        data_resp = []
        for u in all_users:
            data_resp.append({
                "id": u.id,
                "username": u.username,
                "enabled": u.enabled,
                "color": u.color,
                "position": u.position,
                "can_search_any": u.can_search_any,
                "can_create_subusers": u.can_create_subusers,
                "parent_id": u.parent_id if u.parent_id else None
            })

        return jsonify({"status": "ok", "users": data_resp}), 200

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@admin_bp.route("/toggle_user_ajax", methods=["POST"])
@admin_required
def toggle_user_ajax():
    """
    Activa/Desactiva un usuario principal.
    Si se desactiva un usuario principal => TODOS sus sub-usuarios también quedan OFF.
    Si se activa un usuario principal => Los sub-usuarios vuelven a su estado anterior.
    """
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        currently_enabled = data.get("currently_enabled", True)

        u = User.query.get_or_404(user_id)
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if u.username == admin_username:
            return jsonify({"status": "error", "message": "No puedes modificar el usuario admin."}), 403

        if u.parent_id is not None:
            return jsonify({"status": "error", "message": "No es un usuario principal."}), 403

        new_status = not currently_enabled
        u.enabled = new_status
        db.session.commit()

        if not u.enabled:
            RememberDevice.query.filter_by(user_id=u.id).delete()
            u.user_session_rev_count += 1

            subusers = User.query.filter_by(parent_id=u.id).all()
            for su in subusers:
                if su.enabled:
                    su.was_enabled = True
                    su.enabled = False
                    RememberDevice.query.filter_by(user_id=su.id).delete()
                    su.user_session_rev_count += 1
            db.session.commit()
        else:
            subusers = User.query.filter_by(parent_id=u.id).all()
            for su in subusers:
                if su.was_enabled is not None:
                    su.enabled = su.was_enabled
                    su.was_enabled = None
            db.session.commit()

        admin_username = current_app.config.get("ADMIN_USER", "admin")
        user_q = User.query.filter(User.parent_id.is_(None)).filter(User.username != admin_username)
        user_q = user_q.order_by(User.position.asc())
        all_users = user_q.all()

        data_resp = []
        for usr in all_users:
            data_resp.append({
                "id": usr.id,
                "username": usr.username,
                "enabled": usr.enabled,
                "color": usr.color,
                "position": usr.position,
                "can_search_any": usr.can_search_any,
                "can_create_subusers": usr.can_create_subusers,
                "parent_id": usr.parent_id if usr.parent_id else None
            })
        return jsonify({"status": "ok", "users": data_resp}), 200

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@admin_bp.route("/delete_user_ajax", methods=["POST"])
@admin_required
def delete_user_ajax():
    """
    Elimina un usuario principal.
    """
    try:
        data = request.get_json()
        user_id = data.get("user_id")

        u = User.query.get_or_404(user_id)
        admin_username = current_app.config.get("ADMIN_USER", "admin")

        if u.username == admin_username:
            return jsonify({"status":"error","message":"No puedes eliminar el usuario admin."}),403

        if u.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        RememberDevice.query.filter_by(user_id=u.id).delete()
        db.session.commit()

        db.session.delete(u)
        db.session.commit()

        user_q = User.query.filter(User.parent_id.is_(None)).filter(User.username != admin_username)
        user_q = user_q.order_by(User.position.asc())
        all_users = user_q.all()

        data_resp = []
        for usr in all_users:
            data_resp.append({
                "id": usr.id,
                "username": usr.username,
                "enabled": usr.enabled,
                "color": usr.color,
                "position": usr.position,
                "can_search_any": usr.can_search_any,
                "can_create_subusers": usr.can_create_subusers,
                "parent_id": usr.parent_id if usr.parent_id else None
            })
        return jsonify({"status":"ok","users":data_resp}),200

    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),400


@admin_bp.route("/update_user_ajax", methods=["POST"])
@admin_required
def update_user_ajax():
    """
    Actualiza datos de un usuario principal (no sub-usuario):
    username, password, color, posición, can_search_any, can_create_subusers
    """
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        new_username = data.get("username", "").strip()
        new_color = data.get("color", "#ffffff").strip()
        new_position = data.get("position", 1)
        can_search_any = data.get("can_search_any", False)
        new_password = data.get("password", "").strip()
        new_can_create_subusers = data.get("can_create_subusers", False)

        u = User.query.get_or_404(user_id)
        admin_username = current_app.config.get("ADMIN_USER", "admin")

        if u.username == admin_username:
            return jsonify({"status": "error", "message": "No puedes modificar el usuario admin."}), 403

        if u.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        if not new_username:
            return jsonify({"status": "error", "message": "El usuario no puede quedar vacío."}), 400
        if new_username == admin_username:
            return jsonify({"status": "error", "message": "No puedes asignar el nombre admin."}), 403

        conflict = User.query.filter(User.username == new_username, User.id != user_id).first()
        if conflict:
            return jsonify({"status": "error", "message": f"Ya existe otro usuario '{new_username}'."}), 400

        u.username = new_username
        u.color = new_color
        try:
            new_position = int(new_position)
        except:
            new_position = 1
        u.position = new_position
        u.can_search_any = bool(can_search_any)

        if new_password:
            hashed_pass = generate_password_hash(new_password)
            u.password = hashed_pass

        old_can_sub = u.can_create_subusers
        u.can_create_subusers = bool(new_can_create_subusers)
        db.session.commit()

        if old_can_sub and not u.can_create_subusers:
            subusers = User.query.filter_by(parent_id=u.id).all()
            for su in subusers:
                db.session.delete(su)
            db.session.commit()

        admin_username = current_app.config.get("ADMIN_USER", "admin")
        user_q = User.query.filter(User.parent_id.is_(None)).filter(User.username != admin_username)
        user_q = user_q.order_by(User.position.asc())
        all_users = user_q.all()

        data_resp = []
        for usr in all_users:
            data_resp.append({
                "id": usr.id,
                "username": usr.username,
                "enabled": usr.enabled,
                "color": usr.color,
                "position": usr.position,
                "can_search_any": usr.can_search_any,
                "can_create_subusers": usr.can_create_subusers,
                "parent_id": usr.parent_id if usr.parent_id else None
            })

        return jsonify({"status":"ok","users":data_resp}),200

    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),400


# ================== Emails permitidos (versión principal) ==================
@admin_bp.route("/user_emails/<int:user_id>", methods=["GET","POST"])
@admin_required
def user_emails_page(user_id):
    """
    Para usuarios principales. Muestra y guarda la lista de correos permitidos.
    """
    user = User.query.get_or_404(user_id)
    if user.parent_id is not None:
        flash("No es un usuario principal.", "danger")
        return redirect(url_for("admin_bp.usuarios_page"))

    if request.method == "POST":
        # Tomamos el contenido del textarea 'allowed_emails'
        raw_text = request.form.get("allowed_emails", "").strip()
        # Dividir por comas, espacios o saltos de línea
        lines = re.split(r"[\n\r\t, ]+", raw_text)
        lines_clean = [ln.strip().lower() for ln in lines if ln.strip()]

        # Quitar duplicados
        unique_emails = list(dict.fromkeys(lines_clean))

        # Borramos todos los correos que tenía antes
        AllowedEmail.query.filter_by(user_id=user.id).delete()

        # Creamos los nuevos
        for em in unique_emails:
            db.session.add(AllowedEmail(user_id=user.id, email=em))

        db.session.commit()
        flash("Correos permitidos actualizados correctamente.", "success")
        return redirect(url_for("admin_bp.user_emails_page", user_id=user.id))

    # GET => convertimos los AllowedEmail a multilinea
    assigned_entries = user.allowed_email_entries.all()
    multiline = "\n".join([ae.email for ae in assigned_entries])

    return render_template("email.html", user=user, existing_emails=multiline)


@admin_bp.route("/search_allowed_emails_ajax", methods=["POST"])
@admin_required
def search_allowed_emails_ajax():
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        emails_to_search = data.get("emails", [])

        user = User.query.get_or_404(user_id)
        if user.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        all_emails = [x.email for x in user.allowed_email_entries.all()] if user.allowed_email_entries else []

        results = []
        for em in all_emails:
            for srch in emails_to_search:
                if srch in em:
                    results.append(em)
                    break
        results = list(dict.fromkeys(results))
        return jsonify({"status":"ok","results":results}),200
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),400


@admin_bp.route("/delete_allowed_email_ajax", methods=["POST"])
@admin_required
def delete_allowed_email_ajax():
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        email_to_remove = data.get("email", "").strip().lower()

        user = User.query.get_or_404(user_id)
        if user.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        deleted_count = AllowedEmail.query.filter_by(user_id=user.id, email=email_to_remove).delete()
        db.session.commit()

        if deleted_count > 0:
            return jsonify({"status":"ok"}),200
        else:
            return jsonify({"status":"error","message":"Correo no encontrado."}),400

    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),400


@admin_bp.route("/delete_many_emails_ajax", methods=["POST"])
@admin_required
def delete_many_emails_ajax():
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        emails_array = data.get("emails", [])

        user = User.query.get_or_404(user_id)
        if user.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        if not emails_array:
            return jsonify({"status":"ok"}),200

        from sqlalchemy import func
        normalized = [x.strip().lower() for x in emails_array]
        AllowedEmail.query.filter(AllowedEmail.user_id == user.id, AllowedEmail.email.in_(normalized)).delete(synchronize_session=False)
        db.session.commit()

        return jsonify({"status":"ok"}),200
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),400


# ============ Manejo de Regex/Filter que el usuario principal puede usar ============
@admin_bp.route("/list_regex_ajax", methods=["GET"])
@admin_required
def list_regex_ajax():
    try:
        user_id = request.args.get("user_id", type=int)
        if not user_id:
            return jsonify({"status":"error","message":"Falta user_id"}),400

        user = User.query.get_or_404(user_id)
        if user.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        from app.models.filters import RegexModel
        all_rx = RegexModel.query.all()

        rx_data = []
        for r in all_rx:
            is_allowed = (r in user.regexes_allowed)
            rx_data.append({
                "id": r.id,
                "pattern": r.pattern,
                "description": r.description or "",
                "allowed": is_allowed
            })
        return jsonify({"status":"ok","regexes":rx_data}),200
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),400


@admin_bp.route("/list_filters_ajax", methods=["GET"])
@admin_required
def list_filters_ajax():
    try:
        user_id = request.args.get("user_id", type=int)
        if not user_id:
            return jsonify({"status":"error","message":"Falta user_id"}),400

        user = User.query.get_or_404(user_id)
        if user.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        from app.models.filters import FilterModel
        all_ft = FilterModel.query.all()

        ft_data = []
        for f in all_ft:
            is_allowed = (f in user.filters_allowed)
            ft_data.append({
                "id": f.id,
                "sender": f.sender or "",
                "keyword": f.keyword or "",
                "allowed": is_allowed
            })
        return jsonify({"status":"ok","filters":ft_data}),200
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),400


@admin_bp.route("/update_user_rfs_ajax", methods=["POST"])
@admin_required
def update_user_rfs_ajax():
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        rfs_type = data.get("type")
        allowed_ids = data.get("allowed_ids", [])

        user = User.query.get_or_404(user_id)
        if user.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        from app.models.filters import RegexModel, FilterModel

        if rfs_type == "regex":
            user.regexes_allowed.clear()
            db.session.commit()
            for rid in allowed_ids:
                rx = RegexModel.query.get(rid)
                if rx:
                    user.regexes_allowed.append(rx)
            db.session.commit()

        elif rfs_type == "filter":
            user.filters_allowed.clear()
            db.session.commit()
            for fid in allowed_ids:
                ft = FilterModel.query.get(fid)
                if ft:
                    user.filters_allowed.append(ft)
            db.session.commit()
        else:
            return jsonify({"status":"error","message":"Tipo inválido (usa 'regex' o 'filter')."}),400

        admin_username = current_app.config.get("ADMIN_USER","admin")
        if session.get("username") != admin_username:
            user.user_session_rev_count += 1
            db.session.commit()

        return jsonify({"status":"ok"}),200
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),400

