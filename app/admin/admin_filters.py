# app/admin/admin_filters.py

from flask import (
    request, redirect, url_for, flash, jsonify, render_template, session, current_app
)
from .admin_bp import admin_bp
from app.extensions import db
from app.models import FilterModel, User
from app.services.filter_service import (
    create_filter_service,
    update_filter_service,
    delete_filter_service
)
from app.services.domain_service import (
    create_domain_service,
    update_domain_service,
    toggle_domain_service,
    delete_domain_service,
    get_all_domains
)
from app.admin.decorators import admin_required

@admin_bp.route("/create_filter", methods=["POST"])
@admin_required
def create_filter():
    sender = request.form.get("sender", "").strip()
    keyword = request.form.get("keyword", "").strip()
    enabled = request.form.get("enabled") == "on" 
    # Obtener el valor de cut_after_html
    cut_after_html = request.form.get("cut_after_html", "").strip() # Obtener valor
    cut_before_html = request.form.get("cut_before_html", "").strip() # Obtener valor

    # Verificamos si es el admin => para saltarse el forced logout
    admin_username = current_app.config["ADMIN_USER"]
    is_admin = (session.get("username") == admin_username)

    if not sender and not keyword:
        flash("Se requiere al menos un remitente o una palabra clave.", "danger")
        return redirect(url_for("admin_bp.filters_page"))

    new_filter = FilterModel(
        sender=sender if sender else None,
        keyword=keyword if keyword else None,
        enabled=enabled,
        # Asignar el valor obtenido (será None si está vacío gracias a or None en el servicio)
        cut_after_html=cut_after_html,
        cut_before_html=cut_before_html,
        is_default=True
    )
    db.session.add(new_filter)

    try:
        # Commit 1: Guardar el nuevo Filtro para obtener su ID
        db.session.commit()
        flash(f"Filtro '{sender or keyword}' creado exitosamente.", "success")

        # --- INICIO: Asignar a defaults de usuarios PADRE con can_create_subusers ---
        users_to_update_defaults = User.query.filter_by(parent_id=None, can_create_subusers=True).all()
        updated_defaults_count = 0
        if users_to_update_defaults:
            for user in users_to_update_defaults:
                if new_filter not in user.default_filters_for_subusers:
                    # No necesitamos db.session.add(user) aquí, la relación se maneja en memoria
                    user.default_filters_for_subusers.append(new_filter)
                    updated_defaults_count += 1
            
            if updated_defaults_count > 0:
                # Commit 2: Guardar las nuevas relaciones de defaults M2M
                # Nota: Es posible que este commit sea redundante si el siguiente bloque también hace commit.
                # Se puede optimizar si se confirma que el siguiente bloque siempre se ejecuta y hace commit.
                db.session.commit()

        # --- INICIO: Asignar a la lista _allowed de TODOS los usuarios PRINCIPALES --- 
        all_principal_users = User.query.filter_by(parent_id=None).all() 
        updated_allowed_principal_count = 0
        if all_principal_users:
            for user in all_principal_users:
                if new_filter not in user.filters_allowed:
                    user.filters_allowed.append(new_filter)
                    # No necesitamos db.session.add(user) aquí tampoco
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
                # Verificamos si el padre del subusuario tiene el permiso (debería tenerlo por el bloque anterior)
                # Esta verificación es una seguridad adicional.
                parent = subuser.parent # Asumiendo que la relación 'parent' está definida en el modelo User
                if parent and new_filter in parent.filters_allowed:
                    if new_filter not in subuser.filters_allowed:
                        subuser.filters_allowed.append(new_filter)
                        updated_allowed_subuser_count += 1
                else:
                    pass
            if updated_allowed_subuser_count > 0:
                # Commit 4 (o 3, o 2): Guardar las nuevas relaciones allowed M2M para sub-usuarios
                db.session.commit()
        # --- FIN: Asignar a allowed SUB-USUARIOS ---

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al crear Filtro o asignar a defaults/allowed de usuarios: {e}", exc_info=True)
        flash("Error al crear el Filtro o asignarlo.", "danger")

    return redirect(url_for("admin_bp.filters_page"))


@admin_bp.route("/edit_filter/<int:filter_id>", methods=["GET", "POST"])
@admin_required
def edit_filter(filter_id):
    f = FilterModel.query.get_or_404(filter_id)

    if request.method == "POST":
        sender = request.form.get("sender", "").strip()
        keyword = request.form.get("keyword", "").strip()
        enabled = True if request.form.get("enabled") == "on" else False
        cut_after_html = request.form.get("cut_after_html", "").strip()
        cut_before_html = request.form.get("cut_before_html", "").strip()

        update_filter_service(f, sender, keyword, enabled, cut_after_html, cut_before_html)
        flash("Filtro actualizado.", "success")
        return redirect(url_for("admin_bp.filters_page"))

    return render_template("edit_filter.html", filter=f)


@admin_bp.route("/toggle_filter/<int:filter_id>", methods=["POST"])
@admin_required
def toggle_filter(filter_id):
    f = FilterModel.query.get_or_404(filter_id)
    f.enabled = not f.enabled
    db.session.commit()
    status = "habilitado" if f.enabled else "deshabilitado"
    flash(f"Filtro {status}.", "info")
    return redirect(url_for("admin_bp.filters_page"))


@admin_bp.route("/delete_filter/<int:filter_id>", methods=["POST"])
@admin_required
def delete_filter(filter_id):
    # También chequeamos si es admin => skip_revocation
    admin_username = current_app.config["ADMIN_USER"]
    is_admin = (session.get("username") == admin_username)

    delete_filter_service(filter_id, skip_revocation=is_admin)
    flash("Filtro eliminado.", "danger")
    return redirect(url_for("admin_bp.filters_page"))


@admin_bp.route("/search_filters_ajax", methods=["GET"])
@admin_required
def search_filters_ajax():
    query = request.args.get("query", "").strip().lower()
    filters_q = FilterModel.query
    if query:
        filters_q = filters_q.filter(
            (FilterModel.sender.ilike(f"%{query}%"))
            | (FilterModel.keyword.ilike(f"%{query}%"))
        )
    filters_list = filters_q.all()

    data = []
    for f in filters_list:
        data.append({
            "id": f.id,
            "sender": f.sender or "",
            "keyword": f.keyword or "",
            "cut_after_html": f.cut_after_html or "",
            "cut_before_html": f.cut_before_html or "",
            "enabled": f.enabled
        })

    return jsonify({"status": "ok", "filters": data})


@admin_bp.route("/toggle_filter_ajax", methods=["POST"])
@admin_required
def toggle_filter_ajax():
    try:
        data = request.get_json()
        filter_id = data.get("filter_id")
        currently_enabled = data.get("currently_enabled")

        f = FilterModel.query.get_or_404(filter_id)
        f.enabled = not currently_enabled
        db.session.commit()

        filters_list = FilterModel.query.all()
        data_resp = []
        for fil in filters_list:
            data_resp.append({
                "id": fil.id,
                "sender": fil.sender or "",
                "keyword": fil.keyword or "",
                "cut_after_html": fil.cut_after_html or "",
                "cut_before_html": fil.cut_before_html or "",
                "enabled": fil.enabled
            })
        return jsonify({"status": "ok", "filters": data_resp})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@admin_bp.route("/delete_filter_ajax", methods=["POST"])
@admin_required
def delete_filter_ajax():
    try:
        data = request.get_json()
        filter_id = data.get("filter_id")

        # Chequeamos admin => skip revocation
        admin_username = current_app.config["ADMIN_USER"]
        is_admin = (session.get("username") == admin_username)

        delete_filter_service(filter_id, skip_revocation=is_admin)

        filters_list = FilterModel.query.all()
        data_resp = []
        for fil in filters_list:
            data_resp.append({
                "id": fil.id,
                "sender": fil.sender or "",
                "keyword": fil.keyword or "",
                "cut_after_html": fil.cut_after_html or "",
                "cut_before_html": fil.cut_before_html or "",
                "enabled": fil.enabled
            })
        return jsonify({"status": "ok", "filters": data_resp})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


# =========== DOMINIOS (misma sección) ===========

@admin_bp.route("/create_domain", methods=["POST"])
@admin_required
def create_domain():
    domain_str = request.form.get("domain", "").strip()
    new_dom = create_domain_service(domain_str)
    if new_dom:
        flash(f"Dominio '{domain_str}' creado correctamente.", "success")
    else:
        flash(f"El dominio '{domain_str}' ya existía o no es válido.", "warning")
    return redirect(url_for("admin_bp.filters_page"))


@admin_bp.route("/edit_domain/<int:dom_id>", methods=["GET", "POST"])
@admin_required
def edit_domain(dom_id):
    from app.models.domain import DomainModel
    dom = DomainModel.query.get_or_404(dom_id)

    if request.method == "POST":
        new_domain_str = request.form.get("domain", "").strip().lower()
        update_domain_service(dom, new_domain_str)
        flash("Dominio actualizado.", "success")
        return redirect(url_for("admin_bp.filters_page"))

    return render_template("edit_domain.html", dom=dom)


@admin_bp.route("/search_domains_ajax", methods=["GET"])
@admin_required
def search_domains_ajax():
    from app.services.domain_service import get_all_domains
    query = request.args.get("query", "").strip().lower()
    domains_q = get_all_domains()
    if query:
        domains_q = [d for d in domains_q if query in d.domain.lower()]

    data = []
    for d in domains_q:
        data.append({
            "id": d.id,
            "domain": d.domain,
            "enabled": d.enabled
        })
    return jsonify({"status": "ok", "domains": data})


@admin_bp.route("/toggle_domain_ajax", methods=["POST"])
@admin_required
def toggle_domain_ajax():
    try:
        data = request.get_json()
        dom_id = data.get("dom_id")
        currently_enabled = data.get("currently_enabled", True)
        from app.services.domain_service import toggle_domain_service, get_all_domains
        new_status = toggle_domain_service(dom_id)
        domains = get_all_domains()

        data_resp = []
        for d in domains:
            data_resp.append({
                "id": d.id,
                "domain": d.domain,
                "enabled": d.enabled
            })
        return jsonify({"status": "ok", "domains": data_resp})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@admin_bp.route("/delete_domain_ajax", methods=["POST"])
@admin_required
def delete_domain_ajax():
    try:
        data = request.get_json()
        dom_id = data.get("dom_id")
        from app.services.domain_service import delete_domain_service, get_all_domains
        delete_domain_service(dom_id)
        domains = get_all_domains()
        data_resp = []
        for d in domains:
            data_resp.append({
                "id": d.id,
                "domain": d.domain,
                "enabled": d.enabled
            })
        return jsonify({"status": "ok", "domains": data_resp})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400
