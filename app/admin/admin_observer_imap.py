"""Blueprint para gestionar servidores IMAP que solo se usan por la capa de observador.
Es una copia funcional de admin_imap.py pero opera sobre ObserverIMAPServer
para que el administrador tenga dos listas totalmente separadas.
"""

from flask import (
    request, redirect, url_for, flash, render_template, jsonify, abort, current_app
)
from .admin_bp import admin_bp
from app.extensions import db
from app.models.observer_imap import ObserverIMAPServer as IMAPModel
from app.services.imap_service import (
    create_imap_server,
    update_imap_server,
    test_imap_connection,
    delete_imap_server
)
from app.admin.decorators import admin_required
from urllib.parse import unquote, urlparse
from sqlalchemy.exc import IntegrityError

TABLE_NAME = "observer_imap_servers"

# ---------- Helpers internos reutilizando funciones del servicio ----------

def _create_server(host, port, username, password, folders, description=None):
    create_imap_server(host, port, username, password, folders, description=description, model_cls=IMAPModel)

def _update_server(server_id, host, port, username, password, folders, description=None):
    update_imap_server(server_id, host, port, username, password, folders, description=description, model_cls=IMAPModel)

# ---------- Rutas ----------

def _detect_imap_host_from_email(email_address):
    """
    Detecta automáticamente el host IMAP basándose en el dominio del email.
    Retorna el host IMAP apropiado o None si no se puede detectar.
    """
    if not email_address:
        return None
    
    email_lower = email_address.lower().strip()
    
    # Mapeo de dominios comunes a sus hosts IMAP
    domain_to_host = {
        'gmail.com': 'imap.gmail.com',
        'outlook.com': 'outlook.office365.com',
        'hotmail.com': 'outlook.office365.com',
        'live.com': 'outlook.office365.com',
        'yahoo.com': 'imap.mail.yahoo.com',
        'yahoo.es': 'imap.mail.yahoo.com',
        'icloud.com': 'imap.mail.me.com',
        'me.com': 'imap.mail.me.com',
        'mac.com': 'imap.mail.me.com',
    }
    
    # Extraer dominio del email
    if '@' in email_lower:
        domain = email_lower.split('@')[1].split('+')[0].strip()  # Manejar alias como user+alias@gmail.com
        return domain_to_host.get(domain)
    
    return None

@admin_bp.route("/observer_manage_imap", methods=["POST"])
@admin_required
def observer_manage_imap():
    server_id = request.form.get("server_id")
    description = request.form.get("description", "").strip() or None
    host = request.form.get("host", "").strip()
    port = request.form.get("port", 993)
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    folders = request.form.get("folders", "INBOX")

    # Si el host está vacío pero hay username, intentar detectar automáticamente
    if not host and username:
        detected_host = _detect_imap_host_from_email(username)
        if detected_host:
            host = detected_host
        else:
            flash("No se pudo detectar automáticamente el host IMAP. Por favor, ingresa el host manualmente (ej: imap.gmail.com).", "warning")
            return redirect(url_for("admin_bp.security_rules_page"))
    
    # Validar que el host no esté vacío
    if not host:
        flash("El host del servidor IMAP es obligatorio.", "danger")
        return redirect(url_for("admin_bp.security_rules_page"))

    try:
        if server_id:
            _update_server(server_id, host, port, username, password, folders, description)
            flash(f"Editado servidor Observador {host}:{port}", "info")
        else:
            _create_server(host, port, username, password, folders, description)
            flash(f"Creado servidor Observador {host}:{port}", "success")
    except IntegrityError:
        db.session.rollback()
        flash("Ya existe un servidor Observador con el mismo host, puerto y usuario.", "warning")
    except Exception as e:
        db.session.rollback()
        flash(f"Error guardando servidor Observador: {e}", "danger")

    return redirect(url_for("admin_bp.security_rules_page"))

@admin_bp.route("/observer_enable_imap/<int:server_id>", methods=["POST"])
@admin_required
def observer_enable_imap(server_id):
    srv = IMAPModel.query.get_or_404(server_id)
    srv.enabled = True
    db.session.commit()
    flash(f"Habilitado IMAP Observador {srv.host}", "info")
    return redirect(url_for("admin_bp.security_rules_page"))

@admin_bp.route("/observer_disable_imap/<int:server_id>", methods=["POST"])
@admin_required
def observer_disable_imap(server_id):
    srv = IMAPModel.query.get_or_404(server_id)
    srv.enabled = False
    db.session.commit()
    flash(f"Deshabilitado IMAP Observador {srv.host}", "info")
    return redirect(url_for("admin_bp.security_rules_page"))

@admin_bp.route("/observer_test_imap/<int:server_id>", methods=["POST"])
@admin_required
def observer_test_imap(server_id):
    is_ok, message = test_imap_connection(server_id, model_cls=IMAPModel)
    if is_ok:
        flash(f"Éxito probando servidor Observador ID {server_id}: {message}", "success")
    else:

        flash(f"Error probando servidor Observador ID {server_id}: {message}", "danger")
    return redirect(url_for("admin_bp.security_rules_page"))

@admin_bp.route("/observer_edit_imap/<int:server_id>", methods=["GET"])
@admin_required
def observer_edit_imap(server_id):
    srv = IMAPModel.query.get_or_404(server_id)
    return render_template("edit_imap.html", srv=srv, observer_mode=True)

# ---------- AJAX ----------

@admin_bp.route("/observer_search_imap_ajax", methods=["GET"])
@admin_required
def observer_search_imap_ajax():
    query = request.args.get("query", "").strip().lower()
    servers_q = IMAPModel.query
    if query:
        servers_q = servers_q.filter(
            (IMAPModel.host.ilike(f"%{query}%")) | (IMAPModel.username.ilike(f"%{query}%"))
        )
    servers = servers_q.all()
    data = [
        {
            "id": s.id,
            "host": s.host,
            "port": s.port,
            "username": s.username,
            "folders": s.folders,
            "enabled": s.enabled,
            "description": s.description if hasattr(s, 'description') else None,
        }
        for s in servers
    ]
    return jsonify({"status": "ok", "servers": data})

@admin_bp.route("/observer_delete_imap_ajax", methods=["POST"])
@admin_required
def observer_delete_imap_ajax():
    try:
        data = request.get_json()
        server_id = data.get("server_id")
        
        if not server_id:
            return jsonify({"status": "error", "message": "ID del servidor no proporcionado"}), 400
        
        # Buscar el servidor antes de eliminarlo para verificar que existe
        server = IMAPModel.query.get(server_id)
        if not server:
            return jsonify({"status": "error", "message": "Servidor no encontrado"}), 404
        
        # Eliminar el servidor
        delete_imap_server(server_id, model_cls=IMAPModel)
        
        # Obtener la lista actualizada de servidores
        servers = IMAPModel.query.all()
        data_out = [
            {
                "id": s.id,
                "host": s.host,
                "port": s.port,
                "username": s.username,
                "folders": s.folders,
                "enabled": s.enabled,
                "description": s.description if hasattr(s, 'description') else None,
            }
            for s in servers
        ]
        
        return jsonify({
            "status": "ok", 
            "servers": data_out
        })
        
    except Exception as e:
        return jsonify({
            "status": "error", 
            "message": f"Error interno del servidor: {str(e)}"
        }), 500

@admin_bp.route("/observer_test_imap_ajax", methods=["POST"])
@admin_required
def observer_test_imap_ajax():
    """Prueba la conexión de un servidor IMAP Observador vía AJAX"""
    try:
        data = request.get_json()
        server_id = data.get("server_id")
        
        if not server_id:
            return jsonify({"status": "error", "message": "server_id es requerido"}), 400
        
        is_ok, message = test_imap_connection(server_id, model_cls=IMAPModel)
        
        if is_ok:
            return jsonify({"status": "ok", "message": message}), 200
        else:
            return jsonify({"status": "error", "message": message}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/observer_toggle_imap_ajax", methods=["POST"])
@admin_required
def observer_toggle_imap_ajax():
    data = request.get_json()
    srv_id = data.get("server_id")
    currently_enabled = data.get("currently_enabled", True)
    if isinstance(currently_enabled, str):
        currently_enabled = currently_enabled.lower() == "true"

    srv = IMAPModel.query.get_or_404(srv_id)
    srv.enabled = not currently_enabled
    db.session.commit()

    servers = IMAPModel.query.all()
    data_out = [
        {
            "id": s.id,
            "host": s.host,
            "port": s.port,
            "username": s.username,
            "folders": s.folders,
            "enabled": s.enabled,
            "description": s.description if hasattr(s, 'description') else None,
        }
        for s in servers
    ]
    return jsonify({"status": "ok", "servers": data_out}) 