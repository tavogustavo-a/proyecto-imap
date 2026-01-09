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
import re


def validate_route_path(route_path, server_id=None):
    """
    Valida que una ruta no entre en conflicto con rutas del sistema.
    La ruta es OBLIGATORIA y debe empezar con '/'.
    Retorna (is_valid, error_message)
    """
    if not route_path:
        return False, "La ruta es obligatoria y no puede estar vacía."
    
    # Validar que empiece con '/'
    if not route_path.startswith('/'):
        return False, "La ruta debe empezar con '/' (ej: /codigos4, /pagina2)."
    
    # Normalizar la ruta (sin barras iniciales/finales y en minúsculas)
    route_normalized = route_path.lower().strip('/')
    
    # Prefijos excluidos que no pueden usarse
    EXCLUDED_PREFIXES = [
        'admin',     # /admin/* - admin_bp
        'auth',      # /auth/* - auth_bp
        'tienda',    # /tienda/* - store_bp
        'api',       # /api/* - api_bp
        'smtp',      # /smtp/* - smtp_server_bp
        'usuario',   # /usuario/* - user_auth_bp
        'subusers',  # /subusers/* - subuser_bp
        'static',    # /static/* - Flask maneja esto automáticamente
    ]
    
    # Rutas específicas que también deben ser excluidas
    EXCLUDED_ROUTES = [
        'favicon.ico',
        'robots.txt',
        'sitemap.xml',
    ]
    
    # Verificar contra rutas específicas excluidas
    if route_normalized in EXCLUDED_ROUTES:
        return False, f"La ruta '{route_path}' está reservada y no puede ser utilizada."
    
    # Verificar que la ruta no empiece con ningún prefijo excluido
    # Esto debe validarse ANTES de verificar duplicados, porque rutas inválidas no deberían permitirse
    for prefix in EXCLUDED_PREFIXES:
        if route_normalized.startswith(prefix + '/') or route_normalized == prefix:
            return False, f"La ruta '{route_path}' entra en conflicto con rutas del sistema. No puede empezar con '{prefix}'."
    
    # Validar caracteres permitidos (solo letras, números, guiones, guiones bajos y barras)
    if not re.match(r'^[a-zA-Z0-9_\-/]+$', route_path):
        return False, "La ruta solo puede contener letras, números, guiones, guiones bajos y barras."
    
    # Validar que no haya otro servidor con el mismo route_path
    route_path_normalized = '/' + route_path if not route_path.startswith('/') else route_path
    query = IMAPServer2.query.filter(
        (IMAPServer2.route_path == route_path_normalized) |
        (IMAPServer2.route_path == route_path)
    )
    if server_id:
        query = query.filter(IMAPServer2.id != server_id)
    existing = query.first()
    if existing:
        return False, f"Ya existe otro servidor con la ruta '{route_path}'"
    
    return True, None


@admin_bp.route("/manage_imap2", methods=["POST"])
@admin_required
def manage_imap2():
    server_id = request.form.get("server_id")
    description = request.form.get("description", "").strip()
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
        # Actualizar description, route_path y paragraph
        srv.description = description if description else None
        # IMPORTANTE: route_path es ahora obligatorio
        if not route_path:
            flash("La ruta es obligatoria y debe empezar con '/'.", "danger")
            return redirect(url_for("admin_bp.edit_imap2", server_id=server_id))
        
        is_valid, error_msg = validate_route_path(route_path, server_id=server_id)
        if not is_valid:
            flash(error_msg, "danger")
            return redirect(url_for("admin_bp.edit_imap2", server_id=server_id))
        srv.route_path = route_path
        srv.paragraph = paragraph if paragraph else None
        db.session.commit()
        flash(f"Editado servidor IMAP2 {host}:{port}", "info")
    else:
        # Validar route_path (ahora es obligatorio)
        if not route_path:
            flash("La ruta es obligatoria y debe empezar con '/'.", "danger")
            return redirect(url_for("admin_bp.dashboard"))
        
        is_valid, error_msg = validate_route_path(route_path)
        if not is_valid:
            flash(error_msg, "danger")
            return redirect(url_for("admin_bp.dashboard"))
        
        srv = create_imap_server(host, port, username, password, folders, model_cls=IMAPServer2)
        srv.description = description if description else None
        srv.route_path = route_path
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
            "enabled": s.enabled,
            "route_path": s.route_path if s.route_path else None,
            "description": s.description if s.description else None
        })
    return jsonify({"status": "ok", "servers": data})

@admin_bp.route("/create_imap2_ajax", methods=["POST"])
@admin_required
def create_imap2_ajax():
    """Crea un nuevo servidor IMAP2 vía AJAX"""
    try:
        data = request.get_json()
        description = data.get("description", "").strip()
        host = data.get("host", "").strip()
        port = data.get("port", 993)
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()
        folders = data.get("folders", "INBOX").strip()
        route_path = data.get("route_path", "").strip()

        if not host or not username:
            return jsonify({"status": "error", "message": "Host y usuario son obligatorios."}), 400

        # Validar route_path (ahora es obligatorio)
        if not route_path:
            return jsonify({"status": "error", "message": "La ruta es obligatoria y debe empezar con '/'."}), 400
        
        is_valid, error_msg = validate_route_path(route_path)
        if not is_valid:
            return jsonify({"status": "error", "message": error_msg}), 400

        # Crear el servidor
        srv = create_imap_server(host, port, username, password, folders, model_cls=IMAPServer2)
        srv.description = description if description else None
        srv.route_path = route_path
        srv.paragraph = None
        db.session.commit()

        # Obtener todos los servidores para devolver la lista actualizada
        all_servers = IMAPServer2.query.all()
        servers_data = []
        for s in all_servers:
            servers_data.append({
                "id": s.id,
                "host": s.host,
                "port": s.port,
                "username": s.username,
                "folders": s.folders,
                "enabled": s.enabled,
                "route_path": s.route_path if s.route_path else None,
                "description": s.description if s.description else None
            })

        return jsonify({
            "status": "ok",
            "message": f"Servidor IMAP2 {host}:{port} creado correctamente",
            "servers": servers_data
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al crear servidor IMAP2: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500

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
                "enabled": s.enabled,
                "route_path": s.route_path if s.route_path else None,
                "description": s.description if s.description else None
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
                "enabled": s.enabled,
                "route_path": s.route_path if s.route_path else None,
                "description": s.description if s.description else None
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

