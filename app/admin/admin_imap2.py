# app/admin/admin_imap2.py

from flask import (
    request, redirect, url_for, flash, render_template, jsonify, abort, current_app
)
from .admin_bp import admin_bp
from app.extensions import db
from app.models import IMAPServer2, FilterModel, RegexModel
from app.services.imap_service import (
    create_imap_server,
    update_imap_server,
    test_imap_connection,
    delete_imap_server
)
from app.admin.decorators import admin_required
from urllib.parse import unquote, urlparse

@admin_bp.route("/manage_imap2", methods=["POST"])
@admin_required
def manage_imap2():
    server_id = request.form.get("server_id")
    host = request.form.get("host", "")
    port = request.form.get("port", 993)
    username = request.form.get("username", "")
    password = request.form.get("password", "")
    folders = request.form.get("folders", "INBOX")
    route_path = request.form.get("route_path", "").strip()
    paragraph = request.form.get("paragraph", "").strip()

    if server_id:
        srv = IMAPServer2.query.get_or_404(server_id)
        update_imap_server(server_id, host, port, username, password, folders, model_cls=IMAPServer2)
        # Actualizar route_path y paragraph
        if route_path:
            # Validar que no haya otro servidor con el mismo route_path
            existing = IMAPServer2.query.filter(
                IMAPServer2.route_path == route_path,
                IMAPServer2.id != server_id
            ).first()
            if existing:
                flash(f"Ya existe otro servidor con la ruta '{route_path}'", "danger")
                return redirect(url_for("admin_bp.edit_imap2", server_id=server_id))
            srv.route_path = route_path
        else:
            srv.route_path = None
        srv.paragraph = paragraph if paragraph else None
        db.session.commit()
        flash(f"Editado servidor IMAP2 {host}:{port}", "info")
    else:
        # Validar que no haya otro servidor con el mismo route_path
        if route_path:
            existing = IMAPServer2.query.filter_by(route_path=route_path).first()
            if existing:
                flash(f"Ya existe otro servidor con la ruta '{route_path}'", "danger")
                return redirect(url_for("admin_bp.dashboard"))
        srv = create_imap_server(host, port, username, password, folders, model_cls=IMAPServer2)
        srv.route_path = route_path if route_path else None
        srv.paragraph = paragraph if paragraph else None
        db.session.commit()
        flash(f"Creado servidor IMAP2 {host}:{port}", "success")

    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/test_imap2/<int:server_id>", methods=["POST"])
@admin_required
def test_imap2(server_id):
    is_ok, message = test_imap_connection(server_id, model_cls=IMAPServer2)

    if is_ok:
        flash(f"Éxito probando servidor IMAP2 ID {server_id}: {message}", "success")
    else:
        flash(f"Error probando servidor IMAP2 ID {server_id}: {message}", "danger")

    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/edit_imap2/<int:server_id>", methods=["GET"])
@admin_required
def edit_imap2(server_id):
    srv = IMAPServer2.query.get_or_404(server_id)
    # Obtener todos los filtros y regex disponibles
    all_filters = FilterModel.query.filter_by(enabled=True).order_by(FilterModel.keyword.asc()).all()
    all_regexes = RegexModel.query.filter_by(enabled=True).order_by(RegexModel.description.asc()).all()
    
    # Obtener IDs de filtros y regex asociados a este servidor
    associated_filter_ids = [f.id for f in srv.filters]
    associated_regex_ids = [r.id for r in srv.regexes]
    
    return render_template(
        "edit_imap2.html",
        srv=srv,
        all_filters=all_filters,
        all_regexes=all_regexes,
        associated_filter_ids=associated_filter_ids,
        associated_regex_ids=associated_regex_ids
    )

# =========== RUTAS AJAX ===========

@admin_bp.route("/search_imap2_ajax", methods=["GET"])
@admin_required
def search_imap2_ajax():
    query = request.args.get("query", "").strip().lower()
    servers_q = IMAPServer2.query
    if query:
        servers_q = servers_q.filter(
            (IMAPServer2.host.ilike(f"%{query}%"))
            | (IMAPServer2.username.ilike(f"%{query}%"))
        )
    servers = servers_q.all()

    data = []
    for s in servers:
        data.append({
            "id": s.id,
            "host": s.host,
            "port": s.port,
            "username": s.username,
            "folders": s.folders,
            "enabled": s.enabled
        })
    return jsonify({"status": "ok", "servers": data})

@admin_bp.route("/delete_imap2_ajax", methods=["POST"])
@admin_required
def delete_imap2_ajax():
    try:
        data = request.get_json()
        server_id = data.get("server_id")
        delete_imap_server(server_id, model_cls=IMAPServer2)

        # Retornamos todos los servers actualizados
        servers = IMAPServer2.query.all()
        data_out = []
        for s in servers:
            data_out.append({
                "id": s.id,
                "host": s.host,
                "port": s.port,
                "username": s.username,
                "folders": s.folders,
                "enabled": s.enabled
            })
        return jsonify({"status": "ok", "servers": data_out})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/toggle_imap2_ajax", methods=["POST"])
@admin_required
def toggle_imap2_ajax():
    """
    Recibe { server_id, currently_enabled }
    Cambia server.enabled = not currently_enabled
    Retorna la lista en JSON
    """
    try:
        data = request.get_json()
        srv_id = data.get("server_id")
        currently_enabled = data.get("currently_enabled", True)

        if isinstance(currently_enabled, str):
            currently_enabled = (currently_enabled.lower() == "true")

        srv = IMAPServer2.query.get_or_404(srv_id)
        srv.enabled = not currently_enabled
        db.session.commit()

        # Refrescamos la lista
        servers = IMAPServer2.query.all()
        data_out = []
        for s in servers:
            data_out.append({
                "id": s.id,
                "host": s.host,
                "port": s.port,
                "username": s.username,
                "folders": s.folders,
                "enabled": s.enabled
            })
        return jsonify({"status": "ok", "servers": data_out})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/update_imap2_paragraph/<int:server_id>", methods=["POST"])
@admin_required
def update_imap2_paragraph(server_id):
    """Actualiza el párrafo personalizado de un servidor IMAP2"""
    try:
        srv = IMAPServer2.query.get_or_404(server_id)
        paragraph = request.form.get("paragraph", "").strip()
        srv.paragraph = paragraph if paragraph else None
        db.session.commit()
        flash("Párrafo actualizado correctamente.", "success")
        return redirect(url_for("admin_bp.edit_imap2", server_id=server_id))
    except Exception as e:
        current_app.logger.error(f"Error al actualizar párrafo de IMAP2 {server_id}: {e}", exc_info=True)
        flash("Error al actualizar el párrafo.", "danger")
        return redirect(url_for("admin_bp.edit_imap2", server_id=server_id))

@admin_bp.route("/update_imap2_filter_association_ajax", methods=["POST"])
@admin_required
def update_imap2_filter_association_ajax():
    """Actualiza la asociación de un filtro con un servidor IMAP2"""
    try:
        data = request.get_json()
        server_id = data.get("server_id")
        filter_id = data.get("filter_id")
        is_checked = data.get("checked", False)

        if not server_id or not filter_id:
            return jsonify({"status": "error", "message": "Faltan parámetros requeridos"}), 400

        srv = IMAPServer2.query.get_or_404(server_id)
        filter_obj = FilterModel.query.get_or_404(filter_id)

        if is_checked:
            # Añadir asociación si no existe
            if filter_obj not in srv.filters:
                srv.filters.append(filter_obj)
        else:
            # Remover asociación si existe
            if filter_obj in srv.filters:
                srv.filters.remove(filter_obj)

        db.session.commit()
        return jsonify({"status": "ok", "message": "Asociación actualizada correctamente"})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al actualizar asociación filtro-IMAP2: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500

@admin_bp.route("/update_imap2_regex_association_ajax", methods=["POST"])
@admin_required
def update_imap2_regex_association_ajax():
    """Actualiza la asociación de un regex con un servidor IMAP2"""
    try:
        data = request.get_json()
        server_id = data.get("server_id")
        regex_id = data.get("regex_id")
        is_checked = data.get("checked", False)

        if not server_id or not regex_id:
            return jsonify({"status": "error", "message": "Faltan parámetros requeridos"}), 400

        srv = IMAPServer2.query.get_or_404(server_id)
        regex_obj = RegexModel.query.get_or_404(regex_id)

        if is_checked:
            # Añadir asociación si no existe
            if regex_obj not in srv.regexes:
                srv.regexes.append(regex_obj)
        else:
            # Remover asociación si existe
            if regex_obj in srv.regexes:
                srv.regexes.remove(regex_obj)

        db.session.commit()
        return jsonify({"status": "ok", "message": "Asociación actualizada correctamente"})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al actualizar asociación regex-IMAP2: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500

