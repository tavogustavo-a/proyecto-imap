# app/admin/admin_imap2.py

from flask import (
    request, redirect, url_for, flash, render_template, jsonify, abort, current_app
)
from .admin_bp import admin_bp
from app.extensions import db
from app.models import IMAPServer2, FilterModel, RegexModel
from app.models.imap import IMAPServer
from app.models.imap2 import IMAP2TwoFAConfig
from app.services.imap_service import (
    create_imap_server,
    update_imap_server,
    test_imap_connection,
    delete_imap_server
)
from app.services.imap_crypto import encrypt_password
from app.admin.decorators import admin_required
from urllib.parse import unquote, urlparse
from datetime import datetime
import re

# Decorator para excluir rutas del CSRF (para AJAX)
def csrf_exempt_route(func):
    """Decorator para excluir rutas del CSRF"""
    func._csrf_exempt = True
    return func


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
    
    # Obtener todos los servidores IMAP disponibles (para vincular)
    all_imap_servers = IMAPServer.query.order_by(IMAPServer.host.asc(), IMAPServer.username.asc()).all()
    # Obtener servidores IMAP ya vinculados a este IMAPServer2
    linked_imap_ids = [imap.id for imap in srv.linked_imap_servers]
    
    return render_template(
        "edit_imap2.html",
        srv=srv,
        all_filters=all_filters,
        all_regexes=all_regexes,
        associated_filter_ids=associated_filter_ids,
        associated_regex_ids=associated_regex_ids,
        all_imap_servers=all_imap_servers,
        linked_imap_ids=linked_imap_ids
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
        password_enc = encrypt_password(password)
        srv = IMAPServer2(
            host=host,
            port=port,
            username=username,
            password_enc=password_enc,
            folders=folders or "INBOX",
            description=description if description else None,
            route_path=route_path,  # Obligatorio
            paragraph=None
        )
        db.session.add(srv)
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

@admin_bp.route("/test_imap2_ajax", methods=["POST"])
@admin_required
@csrf_exempt_route
def test_imap2_ajax():
    """Prueba la conexión de un servidor IMAP2 vía AJAX"""
    try:
        data = request.get_json()
        server_id = data.get("server_id")
        
        if not server_id:
            return jsonify({"status": "error", "message": "server_id es requerido"}), 400
        
        is_ok, message = test_imap_connection(server_id, model_cls=IMAPServer2)
        
        if is_ok:
            return jsonify({"status": "ok", "message": message}), 200
        else:
            return jsonify({"status": "error", "message": message}), 200
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


# ============================================================================
# ✅ RUTAS PARA GESTIÓN DE 2FA POR CORREO ESPECÍFICO DE IMAP2
# ============================================================================

@admin_bp.route("/imap2/<int:server_id>/twofa-configs", methods=["GET"])
@admin_required
def list_imap2_twofa_configs(server_id):
    """Lista todas las configuraciones 2FA de un servidor IMAP2 específico"""
    try:
        server = IMAPServer2.query.get_or_404(server_id)
        configs = IMAP2TwoFAConfig.query.filter_by(imap_server_id=server_id).order_by(IMAP2TwoFAConfig.created_at.desc()).all()
        configs_data = []
        for config in configs:
            configs_data.append({
                'id': config.id,
                'secret_key': config.secret_key,
                'emails': config.emails,
                'emails_list': config.get_emails_list(),
                'is_enabled': config.is_enabled,
                'created_at': config.created_at.isoformat() if config.created_at else None,
                'updated_at': config.updated_at.isoformat() if config.updated_at else None
            })
        return jsonify({'success': True, 'configs': configs_data}), 200
    except Exception as e:
        current_app.logger.error(f"Error al listar configuraciones 2FA de IMAP2: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@admin_bp.route("/imap2/<int:server_id>/twofa-configs", methods=["POST"])
@admin_required
def create_imap2_twofa_config(server_id):
    """Crea una nueva configuración 2FA para un servidor IMAP2 específico"""
    try:
        import re
        
        server = IMAPServer2.query.get_or_404(server_id)
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No se recibieron datos'}), 400
        
        secret_key = data.get('secret_key', '').strip()
        emails_input = data.get('emails', '').strip()
        
        if not secret_key:
            return jsonify({'success': False, 'error': 'El secreto TOTP es obligatorio'}), 400
        
        if not emails_input:
            return jsonify({'success': False, 'error': 'Debes agregar al menos un correo'}), 400
        
        # Normalizar correos: separar por coma o espacio, limpiar y validar
        emails_list = []
        for email in re.split(r'[,\s]+', emails_input):
            email = email.strip().lower()
            if email:
                # Validar formato básico de email
                if re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
                    emails_list.append(email)
                else:
                    return jsonify({'success': False, 'error': f'Correo inválido: {email}'}), 400
        
        if not emails_list:
            return jsonify({'success': False, 'error': 'No se encontraron correos válidos'}), 400
        
        # Verificar si algún correo ya está asociado a otra configuración del mismo servidor
        existing_configs = IMAP2TwoFAConfig.query.filter_by(
            imap_server_id=server_id,
            is_enabled=True
        ).all()
        for existing_config in existing_configs:
            existing_emails = existing_config.get_emails_list()
            duplicates = set(emails_list) & set(existing_emails)
            if duplicates:
                return jsonify({
                    'success': False, 
                    'error': f'Los correos {", ".join(duplicates)} ya están asociados a otra configuración 2FA de este servidor'
                }), 400
        
        # Crear nueva configuración
        new_config = IMAP2TwoFAConfig(
            imap_server_id=server_id,
            secret_key=secret_key,
            emails=','.join(emails_list),
            is_enabled=True
        )
        db.session.add(new_config)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Configuración 2FA creada correctamente',
            'config': {
                'id': new_config.id,
                'secret_key': new_config.secret_key,
                'emails': new_config.emails,
                'emails_list': new_config.get_emails_list(),
                'is_enabled': new_config.is_enabled
            }
        }), 201
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al crear configuración 2FA de IMAP2: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@admin_bp.route("/imap2/twofa-configs/<int:config_id>", methods=["PUT"])
@admin_required
def update_imap2_twofa_config(config_id):
    """Actualiza una configuración 2FA de IMAP2"""
    try:
        import re
        
        config = IMAP2TwoFAConfig.query.get_or_404(config_id)
        data = request.get_json()
        
        if not data:
            return jsonify({'success': False, 'error': 'No se recibieron datos'}), 400
        
        # Actualizar secreto si se proporciona
        if 'secret_key' in data:
            secret_key = data.get('secret_key', '').strip()
            if secret_key:
                config.secret_key = secret_key
        
        # Actualizar correos si se proporcionan
        if 'emails' in data:
            emails_input = data.get('emails', '').strip()
            if emails_input:
                emails_list = []
                for email in re.split(r'[,\s]+', emails_input):
                    email = email.strip().lower()
                    if email:
                        if re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
                            emails_list.append(email)
                        else:
                            return jsonify({'success': False, 'error': f'Correo inválido: {email}'}), 400
                
                if emails_list:
                    # Verificar duplicados en otras configuraciones del mismo servidor (excluyendo la actual)
                    existing_configs = IMAP2TwoFAConfig.query.filter(
                        IMAP2TwoFAConfig.id != config_id,
                        IMAP2TwoFAConfig.imap_server_id == config.imap_server_id,
                        IMAP2TwoFAConfig.is_enabled == True
                    ).all()
                    for existing_config in existing_configs:
                        existing_emails = existing_config.get_emails_list()
                        duplicates = set(emails_list) & set(existing_emails)
                        if duplicates:
                            return jsonify({
                                'success': False,
                                'error': f'Los correos {", ".join(duplicates)} ya están asociados a otra configuración 2FA de este servidor'
                            }), 400
                    
                    config.emails = ','.join(emails_list)
        
        # Actualizar estado si se proporciona
        if 'is_enabled' in data:
            config.is_enabled = bool(data.get('is_enabled'))
        
        config.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Configuración 2FA actualizada correctamente',
            'config': {
                'id': config.id,
                'secret_key': config.secret_key,
                'emails': config.emails,
                'emails_list': config.get_emails_list(),
                'is_enabled': config.is_enabled
            }
        }), 200
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al actualizar configuración 2FA de IMAP2: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@admin_bp.route("/imap2/twofa-configs/<int:config_id>", methods=["DELETE"])
@admin_required
def delete_imap2_twofa_config(config_id):
    """Elimina una configuración 2FA de IMAP2"""
    try:
        config = IMAP2TwoFAConfig.query.get_or_404(config_id)
        db.session.delete(config)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Configuración 2FA eliminada correctamente'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar configuración 2FA de IMAP2: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@admin_bp.route("/imap2/twofa-configs/read-qr", methods=["POST"])
@admin_required
def read_imap2_qr_code():
    """Lee un código QR y extrae el secreto TOTP para configuraciones 2FA de IMAP2"""
    try:
        from PIL import Image
        import io
        import re
        
        if 'qr_file' not in request.files:
            return jsonify({'success': False, 'error': 'No se recibió archivo QR'}), 400
        
        qr_file = request.files['qr_file']
        if qr_file.filename == '':
            return jsonify({'success': False, 'error': 'No se seleccionó ningún archivo'}), 400
        
        # Leer la imagen
        image_data = qr_file.read()
        image = Image.open(io.BytesIO(image_data))
        
        # Intentar leer el QR code
        try:
            from pyzbar import pyzbar
            decoded_objects = pyzbar.decode(image)
        except ImportError:
            # Intentar import alternativo
            from pyzbar.pyzbar import decode as pyzbar_decode
            decoded_objects = pyzbar_decode(image)
        
        if not decoded_objects:
            return jsonify({'success': False, 'error': 'No se pudo leer el código QR'}), 400
        
        qr_data = decoded_objects[0].data.decode('utf-8')
        
        # Extraer el secreto del formato otpauth://totp/...
        # Formato: otpauth://totp/Label?secret=SECRET&issuer=Issuer
        secret_match = re.search(r'secret=([A-Z0-9]+)', qr_data, re.IGNORECASE)
        if secret_match:
            secret_key = secret_match.group(1).upper()
            return jsonify({
                'success': True,
                'secret_key': secret_key,
                'qr_data': qr_data
            }), 200
        else:
            # Si no está en formato otpauth, intentar usar el contenido completo como secreto
            # (algunos QR codes solo contienen el secreto)
            if re.match(r'^[A-Z0-9]{16,}$', qr_data, re.IGNORECASE):
                return jsonify({
                    'success': True,
                    'secret_key': qr_data.upper(),
                    'qr_data': qr_data
                }), 200
            else:
                return jsonify({'success': False, 'error': 'El código QR no contiene un secreto TOTP válido'}), 400
                    
    except ImportError:
        return jsonify({'success': False, 'error': 'Biblioteca pyzbar no instalada. Instala con: pip install pyzbar'}), 500
    except Exception as e:
        current_app.logger.error(f"Error al leer QR code: {e}", exc_info=True)
        return jsonify({'success': False, 'error': f'Error al leer el código QR: {str(e)}'}), 500

# =========== RUTAS AJAX PARA VINCULAR SERVIDORES IMAP ===========

@admin_bp.route("/imap2/<int:imap2_id>/create_and_link_imap", methods=["POST"])
@admin_required
@csrf_exempt_route
def create_and_link_imap_to_imap2(imap2_id):
    """Crea un nuevo servidor IMAP y lo vincula automáticamente a un servidor IMAP2"""
    try:
        data = request.get_json()
        host = data.get("host", "").strip()
        port = data.get("port", 993)
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()
        folders = data.get("folders", "INBOX").strip()

        if not host or not username:
            return jsonify({"status": "error", "message": "Host y usuario son obligatorios."}), 400

        # Obtener el servidor IMAP2
        imap2_server = IMAPServer2.query.get_or_404(imap2_id)

        # Crear el servidor IMAP
        from app.services.imap_service import create_imap_server
        new_imap_server = create_imap_server(host, port, username, password, folders or "INBOX")
        
        # Vincular automáticamente al IMAP2
        imap2_server.linked_imap_servers.append(new_imap_server)
        db.session.commit()

        # Obtener todos los servidores IMAP vinculados para devolver la lista actualizada
        linked_servers = imap2_server.linked_imap_servers.all()
        servers_data = []
        for s in linked_servers:
            servers_data.append({
                "id": s.id,
                "host": s.host,
                "port": s.port,
                "username": s.username,
                "folders": s.folders,
                "enabled": s.enabled
            })

        return jsonify({
            "status": "ok",
            "message": f"Servidor IMAP {host}:{port} creado y vinculado correctamente.",
            "servers": servers_data
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al crear y vincular servidor IMAP: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/imap2/<int:imap2_id>/link_imap/<int:imap_id>", methods=["POST"])
@admin_required
@csrf_exempt_route
def link_imap_to_imap2(imap2_id, imap_id):
    """Vincula un servidor IMAP existente a un servidor IMAP2"""
    try:
        imap2_server = IMAPServer2.query.get_or_404(imap2_id)
        imap_server = IMAPServer.query.get_or_404(imap_id)
        
        # Verificar que no esté ya vinculado
        if imap_server in imap2_server.linked_imap_servers:
            return jsonify({"status": "error", "message": "Este servidor IMAP ya está vinculado."}), 400
        
        imap2_server.linked_imap_servers.append(imap_server)
        db.session.commit()
        
        return jsonify({
            "status": "ok",
            "message": f"Servidor IMAP {imap_server.host}:{imap_server.port} vinculado correctamente."
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al vincular servidor IMAP: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/imap2/<int:imap2_id>/unlink_imap/<int:imap_id>", methods=["POST"])
@admin_required
@csrf_exempt_route
def unlink_imap_from_imap2(imap2_id, imap_id):
    """Desvincula y ELIMINA un servidor IMAP de un servidor IMAP2 (elimina completamente de la BD)"""
    try:
        imap2_server = IMAPServer2.query.get_or_404(imap2_id)
        imap_server = IMAPServer.query.get_or_404(imap_id)
        
        # Verificar que esté vinculado
        if imap_server not in imap2_server.linked_imap_servers:
            return jsonify({"status": "error", "message": "Este servidor IMAP no está vinculado."}), 400
        
        # Eliminar la vinculación primero
        imap2_server.linked_imap_servers.remove(imap_server)
        
        # Eliminar el servidor IMAP completamente de la base de datos
        db.session.delete(imap_server)
        db.session.commit()
        
        return jsonify({
            "status": "ok",
            "message": f"Servidor IMAP {imap_server.host}:{imap_server.port} eliminado correctamente."
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar servidor IMAP: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/imap2/<int:imap2_id>/linked_imap_servers", methods=["GET"])
@admin_required
def get_linked_imap_servers(imap2_id):
    """Obtiene la lista de servidores IMAP vinculados a un IMAP2"""
    try:
        imap2_server = IMAPServer2.query.get_or_404(imap2_id)
        linked_servers = imap2_server.linked_imap_servers.all()
        
        servers_data = []
        for s in linked_servers:
            servers_data.append({
                "id": s.id,
                "host": s.host,
                "port": s.port,
                "username": s.username,
                "folders": s.folders,
                "enabled": s.enabled
            })
        
        return jsonify({"status": "ok", "servers": servers_data}), 200
    except Exception as e:
        current_app.logger.error(f"Error al obtener servidores IMAP vinculados: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 400
            
    except Exception as e:
        current_app.logger.error(f"Error al procesar QR code de IMAP2: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500

