# app/admin/admin_imap2.py

from flask import (
    request, redirect, url_for, flash, render_template, jsonify, abort, current_app
)
from .admin_bp import admin_bp
from app.extensions import db
from app.models import IMAPServer2
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

    if server_id:
        update_imap_server(server_id, host, port, username, password, folders, model_cls=IMAPServer2)
        flash(f"Editado servidor IMAP2 {host}:{port}", "info")
    else:
        create_imap_server(host, port, username, password, folders, model_cls=IMAPServer2)
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
    return render_template("edit_imap2.html", srv=srv)

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

