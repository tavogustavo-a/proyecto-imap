# app/admin/admin_regex.py

import re
from flask import (
    request, redirect, url_for, flash, render_template, jsonify, session, current_app
)
from .admin_bp import admin_bp
from app.extensions import db
from app.models import RegexModel, User
from app.services.regex_service import (
    create_regex_service,
    update_regex_service,
    delete_regex_service
)
from app.admin.decorators import admin_required

@admin_bp.route("/create_regex", methods=["POST"])
@admin_required
def create_regex():
    sender = request.form.get("sender", "").strip()
    pattern = request.form.get("pattern", "").strip()
    description = request.form.get("description", "").strip()
    enabled = request.form.get("enabled") == "on"

    # Verificamos si es admin => skip revocation
    admin_username = current_app.config["ADMIN_USER"]
    is_admin = (session.get("username") == admin_username)

    if not pattern:
        flash("El patrón Regex es obligatorio.", "danger")
        return redirect(url_for("admin_bp.regex_page"))

    new_regex = RegexModel(
        sender=sender if sender else None,
        pattern=pattern,
        description=description if description else None,
        enabled=enabled,
        protected=False, # Los creados por admin no son protegidos por defecto
        is_default=True  # Marcar como predeterminado
    )
    db.session.add(new_regex)

    try:
        # Commit 1: Guardar el nuevo Regex para obtener su ID
        db.session.commit()
        flash(f"Regex '{pattern}' creado exitosamente.", "success")

        # --- INICIO: Asignar a defaults de usuarios PADRE con can_create_subusers ---
        users_to_update_defaults = User.query.filter_by(parent_id=None, can_create_subusers=True).all()
        updated_defaults_count = 0
        if users_to_update_defaults:
            for user in users_to_update_defaults:
                if new_regex not in user.default_regexes_for_subusers:
                    user.default_regexes_for_subusers.append(new_regex)
                    db.session.add(user)
                    updated_defaults_count += 1
            
            if updated_defaults_count > 0:
                # Commit 2: Guardar las nuevas relaciones de defaults M2M
                db.session.commit()

        # --- INICIO: Asignar a la lista _allowed de TODOS los usuarios PRINCIPALES --- 
        all_principal_users = User.query.filter_by(parent_id=None).all() # Solo usuarios principales
        updated_allowed_principal_count = 0
        if all_principal_users:
            for user in all_principal_users:
                if new_regex not in user.regexes_allowed:
                    user.regexes_allowed.append(new_regex)
                    # No es necesario db.session.add(user) aquí
                    updated_allowed_principal_count += 1
            
            if updated_allowed_principal_count > 0:
                # Commit 3 (o 2): Guardar las nuevas relaciones allowed M2M para principales
                db.session.commit()
        # --- FIN: Asignar a allowed PRINCIPALES --- 

        # --- INICIO: NUEVO - Asignar a la lista _allowed de TODOS los SUB-USUARIOS existentes ---
        all_subusers = User.query.filter(User.parent_id.isnot(None)).all()
        updated_allowed_subuser_count = 0
        if all_subusers:
            for subuser in all_subusers:
                parent = subuser.parent # Asumiendo relación 'parent' definida
                if parent and new_regex in parent.regexes_allowed:
                    if new_regex not in subuser.regexes_allowed:
                        subuser.regexes_allowed.append(new_regex)
                        updated_allowed_subuser_count += 1
                else:
                    pass
            if updated_allowed_subuser_count > 0:
                # Commit 4 (o 3, o 2): Guardar las nuevas relaciones allowed M2M para sub-usuarios
                db.session.commit()
        # --- FIN: Asignar a allowed SUB-USUARIOS ---

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al crear Regex o asignar a defaults/allowed de usuarios: {e}", exc_info=True)
        flash("Error al crear el Regex o asignarlo.", "danger")

    return redirect(url_for("admin_bp.regex_page"))


@admin_bp.route("/edit_regex/<int:regex_id>", methods=["GET", "POST"])
@admin_required
def edit_regex(regex_id):
    r = RegexModel.query.get_or_404(regex_id)
    if r.protected:
        flash("Este regex está protegido y no se puede editar.", "danger")
        return redirect(url_for("admin_bp.regex_page"))

    if request.method == "POST":
        sender = request.form.get("sender", "").strip()
        pattern = request.form.get("pattern", "").strip()
        description = request.form.get("description", "").strip()
        enabled = True if request.form.get("enabled") == "on" else False

        update_regex_service(r, sender, pattern, description, enabled)
        flash("Regex actualizado.", "success")
        return redirect(url_for("admin_bp.regex_page"))

    return render_template("edit_regex.html", regex=r)


@admin_bp.route("/toggle_regex/<int:regex_id>", methods=["POST"])
@admin_required
def toggle_regex(regex_id):
    r = RegexModel.query.get_or_404(regex_id)
    r.enabled = not r.enabled
    db.session.commit()

    status = "habilitado" if r.enabled else "deshabilitado"
    flash(f"Regex {status}.", "info")
    return redirect(url_for("admin_bp.regex_page"))


@admin_bp.route("/delete_regex/<int:regex_id>", methods=["POST"])
@admin_required
def delete_regex(regex_id):
    r = RegexModel.query.get_or_404(regex_id)
    if r.protected:
        flash("Este regex está protegido y no se puede eliminar.", "danger")
        return redirect(url_for("admin_bp.regex_page"))

    # Chequeamos si es admin => skip revocation
    admin_username = current_app.config["ADMIN_USER"]
    is_admin = (session.get("username") == admin_username)

    delete_regex_service(regex_id, skip_revocation=is_admin)
    flash("Regex eliminado.", "danger")
    return redirect(url_for("admin_bp.regex_page"))


@admin_bp.route("/search_regex_ajax", methods=["GET"])
@admin_required
def search_regex_ajax():
    query = request.args.get("query", "").strip().lower()
    regexes_q = RegexModel.query
    if query:
        regexes_q = regexes_q.filter(
            (RegexModel.sender.ilike(f"%{query}%"))
            | (RegexModel.pattern.ilike(f"%{query}%"))
            | (RegexModel.description.ilike(f"%{query}%"))
        )
    regex_list = regexes_q.all()

    data = []
    for r in regex_list:
        data.append({
            "id": r.id,
            "sender": r.sender or "",
            "pattern": r.pattern,
            "description": r.description or "",
            "enabled": r.enabled,
            "protected": r.protected
        })
    return jsonify({"status": "ok", "regexes": data})


@admin_bp.route("/toggle_regex_ajax", methods=["POST"])
@admin_required
def toggle_regex_ajax():
    try:
        data = request.get_json()
        regex_id = data.get("regex_id")
        currently_enabled = data.get("currently_enabled")

        r = RegexModel.query.get_or_404(regex_id)
        r.enabled = not currently_enabled
        db.session.commit()

        all_regex = RegexModel.query.all()
        data_resp = []
        for rx in all_regex:
            data_resp.append({
                "id": rx.id,
                "sender": rx.sender or "",
                "pattern": rx.pattern,
                "description": rx.description or "",
                "enabled": rx.enabled,
                "protected": rx.protected
            })
        return jsonify({"status": "ok", "regexes": data_resp})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@admin_bp.route("/delete_regex_ajax", methods=["POST"])
@admin_required
def delete_regex_ajax():
    try:
        data = request.get_json()
        if not data or 'regex_id' not in data:
            return jsonify({"status": "error", "message": "Falta regex_id"}), 400
            
        regex_id = data.get("regex_id")

        r = RegexModel.query.get(regex_id) # Usar get en lugar de get_or_404 para manejar no encontrado aquí
        if not r:
             return jsonify({"status": "error", "message": "Regex no encontrado"}), 404 # Devolver 404 si no existe
             
        if r.protected:
            return jsonify({"status": "error", "message": "Regex protegido, no se puede eliminar"}), 400

        admin_username = current_app.config["ADMIN_USER"]
        is_admin = (session.get("username") == admin_username)

        delete_regex_service(regex_id, skip_revocation=is_admin)
        
        # Ya no se obtiene ni devuelve la lista completa
        # Simplemente confirmar éxito
        return jsonify({"status": "ok"})
        
    except Exception as e:
        current_app.logger.error(f"Error en delete_regex_ajax: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno del servidor"}), 500 # Devolver 500 para errores inesperados
