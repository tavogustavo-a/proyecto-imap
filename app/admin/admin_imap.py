# app/admin/admin_imap.py

from flask import (
    request, redirect, url_for, flash, render_template, jsonify, abort, current_app
)
from .admin_bp import admin_bp
from app.extensions import db
from app.models import IMAPServer
from app.services.imap_service import (
    create_imap_server,
    update_imap_server,
    test_imap_connection,
    delete_imap_server
)
from app.admin.decorators import admin_required
from urllib.parse import unquote, urlparse

@admin_bp.route("/manage_imap", methods=["POST"])
@admin_required
def manage_imap():
    server_id = request.form.get("server_id")
    host = request.form.get("host", "")
    port = request.form.get("port", 993)
    username = request.form.get("username", "")
    password = request.form.get("password", "")
    folders = request.form.get("folders", "INBOX")

    if server_id:
        update_imap_server(server_id, host, port, username, password, folders)
        flash(f"Editado servidor IMAP {host}:{port}", "info")
    else:
        create_imap_server(host, port, username, password, folders)
        flash(f"Creado servidor IMAP {host}:{port}", "success")

    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/enable_imap/<int:server_id>", methods=["POST"])
@admin_required
def enable_imap(server_id):
    srv = IMAPServer.query.get_or_404(server_id)
    srv.enabled = True
    db.session.commit()
    flash(f"Habilitado IMAP server {srv.host}", "info")
    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/disable_imap/<int:server_id>", methods=["POST"])
@admin_required
def disable_imap(server_id):
    srv = IMAPServer.query.get_or_404(server_id)
    srv.enabled = False
    db.session.commit()
    flash(f"Deshabilitado IMAP server {srv.host}", "info")
    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/test_imap/<int:server_id>", methods=["POST"])
@admin_required
def test_imap(server_id):
    is_ok, message = test_imap_connection(server_id)

    if is_ok:
        flash(f"Éxito probando servidor ID {server_id}: {message}", "success")
    else:

        flash(f"Error probando servidor ID {server_id}: {message}", "danger")

    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/edit_imap/<int:server_id>", methods=["GET"])
@admin_required
def edit_imap(server_id):
    srv = IMAPServer.query.get_or_404(server_id)
    return render_template("edit_imap.html", srv=srv)

# =========== RUTAS AJAX ===========

@admin_bp.route("/search_imap_ajax", methods=["GET"])
@admin_required
def search_imap_ajax():
    query = request.args.get("query", "").strip().lower()
    servers_q = IMAPServer.query
    if query:
        servers_q = servers_q.filter(
            (IMAPServer.host.ilike(f"%{query}%"))
            | (IMAPServer.username.ilike(f"%{query}%"))
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

@admin_bp.route("/delete_imap_ajax", methods=["POST"])
@admin_required
def delete_imap_ajax():
    try:
        data = request.get_json()
        server_id = data.get("server_id")
        delete_imap_server(server_id)

        # Retornamos todos los servers actualizados
        servers = IMAPServer.query.all()
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

@admin_bp.route("/toggle_imap_ajax", methods=["POST"])
@admin_required
def toggle_imap_ajax():
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

        srv = IMAPServer.query.get_or_404(srv_id)
        srv.enabled = not currently_enabled
        db.session.commit()

        # Refrescamos la lista
        servers = IMAPServer.query.all()
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

# ADDED: Nueva ruta para redirigir enlaces reescritos en parser.py, 
#       con verificación de dominios permitidos.
@admin_bp.route("/redirect_to")
def redirect_to():
    encoded_url = request.args.get("url", "")
    real_url = unquote(encoded_url)

    # Extraer dominio (host) de la URL
    parsed = urlparse(real_url)
    netloc = parsed.netloc.lower()

    # Quitar "www." si quieres unificar
    if netloc.startswith("www."):
        netloc = netloc[4:]

    # Buscar si el dominio está en la tabla 'domains' con enabled=True
    from app.models.domain import DomainModel
    domain_obj = DomainModel.query.filter_by(domain=netloc).first()

    if not domain_obj or not domain_obj.enabled:
        # Si el dominio no existe o está deshabilitado => 403
        flash("El dominio no está permitido.", "warning")
        return abort(403, "Dominio no permitido")

    return redirect(real_url)
