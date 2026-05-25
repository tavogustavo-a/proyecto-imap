# app/user_auth/routes.py

from flask import render_template, request, flash, redirect, url_for, session, current_app, jsonify, url_for as flask_url_for
from werkzeug.security import check_password_hash
from werkzeug.utils import secure_filename
from datetime import datetime
from app.models import User, IMAPServer2, IMAPServer, FilterModel, RegexModel
from app.models.imap2 import IMAP2TwoFAConfig
from app.services.imap_service import create_imap_server, test_imap_connection
from app.extensions import db
from config import Config
from functools import wraps
import os
import re

# Importar el blueprint desde el módulo actual
from . import user_auth_bp
from app.auth.security import (
    record_login_attempt, 
    is_blocked, 
    reset_failed_attempts, 
    block_user
)

# Importar el decorador de control de acceso a la tienda
from app.store.routes import store_access_required

# Decorador para excluir rutas del CSRF
def csrf_exempt_route(func):
    """Decorator para excluir rutas del CSRF"""
    func._csrf_exempt = True
    return func

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            # Detectar si es una petición AJAX/JSON
            is_ajax = (
                request.is_json or 
                request.headers.get('Content-Type', '').startswith('application/json') or
                request.headers.get('X-Requested-With') == 'XMLHttpRequest' or
                request.path.startswith('/api/') or
                request.path.startswith('/usuario/my_page/') or
                request.method in ['GET', 'POST', 'PUT', 'DELETE'] and 'twofa-configs' in request.path
            )
            
            if is_ajax:
                return jsonify({"status": "error", "message": "No autenticado"}), 401
            else:
                flash('Por favor inicie sesión para acceder a esta página.', 'danger')
                return redirect(url_for('user_auth_bp.login'))
        
        # Verificar también que is_user esté presente para usuarios normales
        if request.path.startswith('/usuario/') and 'is_user' not in session:
            flash('Por favor inicie sesión para acceder a esta página.', 'danger')
            return redirect(url_for('user_auth_bp.login'))
        
        return f(*args, **kwargs)
    return decorated_function

@user_auth_bp.before_app_request
def check_session_revocation_user():
    """
    Verifica si el usuario principal o sub-usuario sigue habilitado o existe.
    Si no, fuerza cierre de sesión y redirige a login.
    Además, fuerza cierre de sesión si el contador user_session_rev_count cambió (revocación individual).
    NOTA: La verificación global session_revocation_count ahora se maneja en app/__init__.py
    """
    # Excluir rutas de login y logout para evitar loops infinitos
    if request.endpoint in ['user_auth_bp.login', 'user_auth_bp.logout']:
        return None
    
    # Detectar si es una petición AJAX/JSON
    is_ajax = (
        request.is_json or 
        request.headers.get('Content-Type', '').startswith('application/json') or
        request.headers.get('X-Requested-With') == 'XMLHttpRequest' or
        request.path.startswith('/api/') or
        request.path.startswith('/usuario/my_page/') or
        request.method in ['GET', 'POST', 'PUT', 'DELETE'] and 'twofa-configs' in request.path
    )
    
    if "logged_in" in session and "is_user" in session:
        user_id = session.get("user_id")
        if user_id:
            user_obj = User.query.get(user_id)
            if not user_obj:
                session.clear()
                if is_ajax:
                    return jsonify({"status": "error", "message": "El usuario fue eliminado."}), 401
                flash("El usuario fue eliminado.", "danger")
                return redirect(url_for("user_auth_bp.login"))
            if not user_obj.enabled:
                session.clear()
                if is_ajax:
                    return jsonify({"status": "error", "message": "Este usuario está deshabilitado (OFF)."}), 403
                flash("Este usuario está deshabilitado (OFF).", "danger")
                return redirect(url_for("user_auth_bp.login"))
            # Revocación individual por cambio en user_session_rev_count
            if user_obj.user_session_rev_count > session.get("user_session_rev_count_local", 0):
                session.clear()
                if is_ajax:
                    return jsonify({"status": "error", "message": "Tu sesión se ha cerrado por un cambio en tu configuración de usuario."}), 401
                flash("Tu sesión se ha cerrado por un cambio en tu configuración de usuario.", "info")
                return redirect(url_for("user_auth_bp.login"))
    
    return None

@user_auth_bp.route("/login", methods=["GET", "POST"])
@csrf_exempt_route
def login():
    """
    Pantalla de login para usuarios normales (o sub-usuarios).
    """
    # Si llegamos desde logout, forzar limpieza y mostrar login (no redirigir a Códigos)
    if request.args.get("from_logout"):
        session.clear()
    # Si ya está logueado y NO venimos de logout, redirigir al home
    elif "logged_in" in session and "is_user" in session:
        return redirect(url_for("main_bp.home"))

    if request.method == "GET":
        from app.admin.site_settings import get_site_setting
        public_access_enabled = get_site_setting('public_access_enabled', 'true')
        return render_template("user_login.html", public_access_enabled=public_access_enabled)

    # --- INICIO PROCESO POST --- 
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")

    # 1. Verificar si el usuario está bloqueado
    if is_blocked(username):
        user_temp = User.query.filter_by(username=username).first()
        if user_temp and user_temp.blocked_until:
             tiempo_restante = user_temp.blocked_until - datetime.utcnow()
             # Asegurarse que tiempo_restante sea positivo
             mins_restantes = max(0, tiempo_restante.seconds // 60)
             flash(f"Cuenta bloqueada. Intenta de nuevo en {mins_restantes} min.", "warning")
        else:
             flash("Cuenta bloqueada temporalmente.", "warning")
        return render_template("user_login.html")

    # 2. Obtener usuario
    user = User.query.filter_by(username=username).first()

    # ✅ SEGURIDAD: El admin no puede loguearse en la plantilla de usuarios
    if user and username == current_app.config.get("ADMIN_USER"):
        flash("Acceso denegado.", "danger")
        return render_template("user_login.html")

    # 3. Validar contraseña y estado
    if user and user.enabled and check_password_hash(user.password, password):
        # --- LOGIN EXITOSO --- 
        # a) Resetear contadores (antes de commit)
        reset_failed_attempts(user) 
        # b) Configurar sesión
        from app.auth.session_tokens import generate_session_token
        
        # ✅ SEGURIDAD: Generar token de sesión único para prevenir duplicaciones
        session_token = generate_session_token(user.id, is_admin=False)
        
        session.clear()
        session["logged_in"] = True
        session["username"] = user.username
        session["user_id"] = user.id
        session["is_user"] = True
        session["session_token"] = session_token  # ✅ Token único de sesión
        session.permanent = True
        session["user_session_rev_count_local"] = user.user_session_rev_count
        session["login_time"] = datetime.utcnow().isoformat()  # ✅ SEGURIDAD: Timestamp de login
        
        # ✅ AGREGADO: Asignar contador global de revocación para "cerrar sesión de todos"
        from app.admin.site_settings import get_site_setting
        rev_str = get_site_setting("session_revocation_count", "0")
        session["session_revocation_count"] = int(rev_str)
        # c) Commit final para guardar reseteo de contadores
        try:
            db.session.commit()
            flash("Login exitoso (usuario).", "success")
            return redirect(url_for("main_bp.home"))
        except Exception as e:
            db.session.rollback()
            flash("Error interno al iniciar sesión.", "danger")
            return render_template("user_login.html")

    else:
        # --- LOGIN FALLIDO --- 
        flash_message = "Credenciales inválidas." 
        if user and not user.enabled:
             flash_message = "Este usuario está deshabilitado (OFF)."
        
        # a) Registrar intento fallido (antes de commit)
        # Solo registrar si el usuario existe
        if user:
             record_login_attempt(user.username, success=False)
             # b) Commit para guardar intento fallido y posible bloqueo
             try:
                 db.session.commit()
                 # c) Verificar si AHORA está bloqueado y mostrar mensaje correcto
                 if is_blocked(username): 
                      tiempo_restante = user.blocked_until - datetime.utcnow()
                      mins_restantes = max(0, tiempo_restante.seconds // 60)
                      flash(f"Has superado los intentos permitidos. Cuenta bloqueada por {mins_restantes} min.", "danger")
                 else:
                      flash(flash_message, "danger") # Mostrar mensaje original si no se bloqueó
             except Exception as e:
                  db.session.rollback()
                  flash("Error interno al procesar el intento de login.", "danger")
        else:
             # Usuario no existe
             flash(flash_message, "danger") 
        
        return render_template("user_login.html")

@user_auth_bp.route("/logout")
def logout():
    # Siempre limpiar sesión cuando el usuario hace logout explícito
    if session.get("logged_in") or session.get("is_user") or session.get("user_id"):
        from app.auth.session_tokens import revoke_session_token
        session_token = session.get("session_token")
        if session_token:
            revoke_session_token(session_token)
        session.clear()
        flash("Sesión de usuario cerrada.", "info")
    # Redirigir a login con ?from=logout para forzar pantalla de login (evita redirect a Códigos)
    return redirect(url_for("user_auth_bp.login", from_logout=1))

@user_auth_bp.route("/manage_my_page/<int:server_id>", methods=["GET"])
@login_required
def manage_my_page(server_id):
    """Permite a un usuario gestionar su página dinámica asignada"""
    # Verificar sesión
    if 'logged_in' not in session or 'is_user' not in session:
        flash("Debes iniciar sesión para acceder a esta página.", "danger")
        return redirect(url_for("user_auth_bp.login"))
    
    user_id = session.get("user_id")
    if not user_id:
        flash("Debes iniciar sesión para acceder a esta página.", "danger")
        return redirect(url_for("user_auth_bp.login"))
    
    user = User.query.get(user_id)
    if not user:
        flash("Usuario no encontrado.", "danger")
        return redirect(url_for("main_bp.home"))
    
    # Obtener el servidor IMAP2
    imap_server = IMAPServer2.query.get_or_404(server_id)
    
    # Verificar que el usuario tenga permiso para gestionar esta página
    # Usar .filter() en lugar de .all() para mejor rendimiento
    allowed_users_list = imap_server.allowed_users.filter(User.id == user.id).first()
    if not allowed_users_list:
        flash("No tienes permiso para gestionar esta página.", "danger")
        return redirect(url_for("main_bp.home"))
    
    # Obtener el conteo de servidores IMAP vinculados para el template
    linked_imap_count = imap_server.linked_imap_servers.count()
    
    # Obtener filtros y regexes permitidos para este usuario
    # Solo los que el usuario tiene permitidos (filters_allowed y regexes_allowed)
    allowed_filters = [f for f in user.filters_allowed if f.enabled]
    allowed_regexes = [r for r in user.regexes_allowed if r.enabled]
    
    # Ordenar alfabéticamente por descripción (igual que edit_imap2 / página Regex)
    def _by_description(item):
        return ((item.description or '').lower(), item.id or 0)

    allowed_filters.sort(key=_by_description)
    allowed_regexes.sort(key=_by_description)
    
    # Obtener IDs de filtros y regex asociados a este servidor IMAP2
    associated_filter_ids = [f.id for f in imap_server.filters]
    associated_regex_ids = [r.id for r in imap_server.regexes]
    
    return render_template(
        "manage_my_page.html",
        imap_server=imap_server,
        linked_imap_count=linked_imap_count,
        all_filters=allowed_filters,
        all_regexes=allowed_regexes,
        associated_filter_ids=associated_filter_ids,
        associated_regex_ids=associated_regex_ids,
        current_user=user,
    )

@user_auth_bp.route("/my_pages", methods=["GET"])
@login_required
def my_pages_list():
    """Lista todas las páginas dinámicas que el usuario puede gestionar"""
    user_id = session.get("user_id")
    if not user_id:
        flash("Debes iniciar sesión para acceder a esta página.", "danger")
        return redirect(url_for("user_auth_bp.login"))
    
    user = User.query.get(user_id)
    if not user:
        flash("Usuario no encontrado.", "danger")
        return redirect(url_for("main_bp.home"))
    
    # Obtener todas las páginas que el usuario puede gestionar
    # managed_imap2_pages es una lista (lazy="select"), no un Query, así que no necesita .all()
    managed_pages = list(user.managed_imap2_pages)
    
    return render_template(
        "my_pages_list.html",
        managed_pages=managed_pages,
        current_user=user,
    )

@user_auth_bp.route("/update_my_page_paragraph/<int:server_id>", methods=["POST"])
@login_required
@csrf_exempt_route
def update_my_page_paragraph(server_id):
    """Actualiza el párrafo personalizado de la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
    
    imap_server = IMAPServer2.query.get_or_404(server_id)
    
    # Verificar permiso
    if user not in imap_server.allowed_users.all():
        return jsonify({"status": "error", "message": "No tienes permiso"}), 403
    
    paragraph = request.form.get("paragraph", "").strip()
    imap_server.paragraph = paragraph if paragraph else None
    db.session.commit()
    
    # Asegurar que la sesión del usuario actual no se haya perdido después del commit
    current_user = User.query.get(user_id)
    if current_user:
        session["user_session_rev_count_local"] = current_user.user_session_rev_count
    
    flash("Párrafo actualizado correctamente.", "success")
    # Redirigir de vuelta a la página de gestión
    return redirect(url_for("user_auth_bp.manage_my_page", server_id=server_id))

@user_auth_bp.route("/my_page/<int:imap2_id>/upload_background", methods=["POST"])
@login_required
@csrf_exempt_route
def upload_my_page_background(imap2_id):
    """Sube un fondo personalizado para la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
    
    imap2_server = IMAPServer2.query.get_or_404(imap2_id)
    
    # Verificar permiso
    if user not in imap2_server.allowed_users.all():
        return jsonify({"status": "error", "message": "No tienes permiso"}), 403
    
    # Implementar subida directamente
    try:
        # El JavaScript usa 'background' como nombre del campo
        if 'background' not in request.files:
            return jsonify({"status": "error", "message": "No se recibió archivo"}), 400
        
        file = request.files['background']
        if file.filename == '':
            return jsonify({"status": "error", "message": "No se seleccionó ningún archivo"}), 400
        
        # Validar que sea una imagen
        if not file.content_type or not file.content_type.startswith('image/'):
            return jsonify({"status": "error", "message": "El archivo debe ser una imagen"}), 400
        
        # Crear directorio si no existe
        upload_dir = os.path.join(current_app.root_path, 'static', 'uploads', 'imap2_backgrounds')
        os.makedirs(upload_dir, exist_ok=True)
        
        # Generar nombre único para el archivo
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        filename = secure_filename(file.filename)
        name, ext = os.path.splitext(filename)
        unique_filename = f"imap2_{imap2_id}_{timestamp}{ext}"
        file_path = os.path.join(upload_dir, unique_filename)
        
        # Eliminar fondo anterior si existe
        if imap2_server.background_image:
            old_file_path = os.path.join(upload_dir, imap2_server.background_image)
            if os.path.exists(old_file_path):
                try:
                    os.remove(old_file_path)
                except Exception:
                    pass
        
        # Guardar nuevo archivo
        file.save(file_path)
        
        # Actualizar en base de datos
        imap2_server.background_image = unique_filename
        
        # Asegurar que la sesión del usuario actual no se haya perdido después del commit
        current_user = User.query.get(user_id)
        if current_user:
            session["user_session_rev_count_local"] = current_user.user_session_rev_count
        
        db.session.commit()

        from app.services.imap_service import cleanup_orphaned_imap2_backgrounds
        cleanup_orphaned_imap2_backgrounds()
        
        return jsonify({
            "status": "ok",
            "message": "Fondo subido correctamente",
            "filename": unique_filename
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400

@user_auth_bp.route("/my_page/<int:imap2_id>/delete_background", methods=["POST"])
@login_required
@csrf_exempt_route
def delete_my_page_background(imap2_id):
    """Elimina el fondo personalizado de la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
    
    imap2_server = IMAPServer2.query.get_or_404(imap2_id)
    
    # Verificar permiso
    if user not in imap2_server.allowed_users.all():
        return jsonify({"status": "error", "message": "No tienes permiso"}), 403
    
    # Implementar eliminación directamente
    try:
        if not imap2_server.background_image:
            return jsonify({"status": "error", "message": "No hay fondo configurado"}), 400
        
        # Eliminar archivo del sistema de archivos
        upload_dir = os.path.join(current_app.root_path, 'static', 'uploads', 'imap2_backgrounds')
        file_path = os.path.join(upload_dir, imap2_server.background_image)
        
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass
        
        # Limpiar el campo en la base de datos
        imap2_server.background_image = None
        
        # Asegurar que la sesión del usuario actual no se haya perdido después del commit
        current_user = User.query.get(user_id)
        if current_user:
            session["user_session_rev_count_local"] = current_user.user_session_rev_count
        
        db.session.commit()

        from app.services.imap_service import cleanup_orphaned_imap2_backgrounds
        cleanup_orphaned_imap2_backgrounds()
        
        return jsonify({
            "status": "ok",
            "message": "Fondo eliminado correctamente"
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400

@user_auth_bp.route("/my_page/<int:server_id>/twofa-configs", methods=["GET", "POST"])
@login_required
def my_page_twofa_configs(server_id):
    """Gestiona las configuraciones 2FA de la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
    
    imap_server = IMAPServer2.query.get_or_404(server_id)
    
    # Verificar permiso
    if user not in imap_server.allowed_users.all():
        return jsonify({"status": "error", "message": "No tienes permiso"}), 403
    
    if request.method == "GET":
        # Implementar directamente sin llamar a función del admin
        try:
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
            return jsonify({'success': False, 'error': str(e)}), 500
    elif request.method == "POST":
        # Implementar creación directamente
        try:
            data = request.get_json()
            emails = data.get('emails', '').strip()
            secret_key = data.get('secret_key', '').strip().upper().replace(' ', '').replace('-', '')
            
            if not emails:
                return jsonify({'success': False, 'error': 'Debes proporcionar al menos un correo'}), 400
            
            if not secret_key or not re.match(r'^[A-Z0-9]{8,}$', secret_key):
                return jsonify({'success': False, 'error': 'Debes proporcionar un secreto TOTP válido (mínimo 8 caracteres)'}), 400
            
            new_config = IMAP2TwoFAConfig(
                imap_server_id=server_id,
                emails=emails,
                secret_key=secret_key,
                is_enabled=True
            )
            db.session.add(new_config)
            db.session.commit()
            
            return jsonify({
                'success': True,
                'message': 'Configuración 2FA creada correctamente',
                'config': {
                    'id': new_config.id,
                    'emails': new_config.emails,
                    'emails_list': new_config.get_emails_list(),
                    'is_enabled': new_config.is_enabled
                }
            }), 201
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'error': str(e)}), 500

@user_auth_bp.route("/my_page/twofa-configs/<int:config_id>", methods=["PUT", "DELETE"])
@login_required
@csrf_exempt_route
def my_page_twofa_config(config_id):
    """Gestiona una configuración 2FA específica de la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
    
    config = IMAP2TwoFAConfig.query.get_or_404(config_id)
    
    # Verificar permiso
    if user not in config.imap_server.allowed_users.all():
        return jsonify({"status": "error", "message": "No tienes permiso"}), 403
    
    if request.method == "PUT":
        # Implementar actualización directamente
        try:
            data = request.get_json()
            emails = data.get('emails', '').strip()
            secret_key = data.get('secret_key', '').strip().upper().replace(' ', '').replace('-', '')
            
            if not emails:
                return jsonify({'success': False, 'error': 'Debes proporcionar al menos un correo'}), 400
            
            if not secret_key or not re.match(r'^[A-Z0-9]{8,}$', secret_key):
                return jsonify({'success': False, 'error': 'Debes proporcionar un secreto TOTP válido (mínimo 8 caracteres)'}), 400
            
            config.emails = emails
            config.secret_key = secret_key
            config.updated_at = datetime.utcnow()
            db.session.commit()
            
            return jsonify({
                'success': True,
                'message': 'Configuración 2FA actualizada correctamente',
                'config': {
                    'id': config.id,
                    'emails': config.emails,
                    'emails_list': config.get_emails_list(),
                    'is_enabled': config.is_enabled
                }
            }), 200
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'error': str(e)}), 500
    elif request.method == "DELETE":
        # Implementar eliminación directamente
        try:
            db.session.delete(config)
            db.session.commit()
            return jsonify({'success': True, 'message': 'Configuración 2FA eliminada correctamente'}), 200
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'error': str(e)}), 500

@user_auth_bp.route("/my_page/twofa-configs/read-qr", methods=["POST"])
@login_required
@csrf_exempt_route
def my_page_read_qr():
    """Lee un código QR para 2FA de la página del usuario"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    # Implementar lectura de QR directamente
    try:
        from PIL import Image
        import io
        
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
        # El secreto puede tener padding Base32 (=) y puede terminar con & o al final de la cadena
        secret_match = re.search(r'secret=([A-Z0-9=]+?)(?:&|$)', qr_data, re.IGNORECASE)
        if secret_match:
            secret_key = secret_match.group(1).upper().replace(' ', '').replace('-', '')
            return jsonify({
                'success': True,
                'secret_key': secret_key,
                'qr_data': qr_data
            }), 200
        else:
            # Si no está en formato otpauth, intentar usar el contenido completo como secreto
            # (algunos QR codes solo contienen el secreto)
            if re.match(r'^[A-Z0-9]{8,}$', qr_data, re.IGNORECASE):
                return jsonify({
                    'success': True,
                    'secret_key': qr_data.upper(),
                    'qr_data': qr_data
                }), 200
            else:
                return jsonify({'success': False, 'error': 'El código QR no contiene un secreto TOTP válido'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =========== RUTAS PARA GESTIONAR SERVIDORES IMAP VINCULADOS ===========

def check_imap2_permission(user, imap2_id):
    """Verifica que el usuario tenga permiso para gestionar el servidor IMAP2"""
    imap2_server = IMAPServer2.query.get(imap2_id)
    if not imap2_server:
        return False, None
    if user not in imap2_server.allowed_users.all():
        return False, None
    return True, imap2_server

@user_auth_bp.route("/my_page/<int:imap2_id>/create_and_link_imap", methods=["POST"])
@login_required
@csrf_exempt_route
def create_and_link_imap_to_my_page(imap2_id):
    """Crea un nuevo servidor IMAP y lo vincula automáticamente a un servidor IMAP2 (para usuarios)"""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"status": "error", "message": "No autenticado"}), 401
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
        
        # Verificar permiso
        has_permission, imap2_server = check_imap2_permission(user, imap2_id)
        if not has_permission:
            return jsonify({"status": "error", "message": "No tienes permiso"}), 403
        
        data = request.get_json()
        host = data.get("host", "").strip()
        port = data.get("port", 993)
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()
        folders = data.get("folders", "INBOX").strip()

        if not host or not username:
            return jsonify({"status": "error", "message": "Host y usuario son obligatorios."}), 400

        # Verificar límite de 4 servidores IMAP vinculados para usuarios
        current_linked_count = imap2_server.linked_imap_servers.count()
        MAX_LINKED_IMAP_FOR_USERS = 4
        
        if current_linked_count >= MAX_LINKED_IMAP_FOR_USERS:
            return jsonify({
                "status": "error",
                "message": f"Has alcanzado el límite máximo de {MAX_LINKED_IMAP_FOR_USERS} servidores IMAP vinculados. Puedes eliminar uno existente para crear uno nuevo."
            }), 400

        # Crear el servidor IMAP
        new_imap_server = create_imap_server(host, port, username, password, folders or "INBOX")
        
        # Vincular automáticamente al IMAP2
        imap2_server.linked_imap_servers.append(new_imap_server)
        
        # Actualizar sesión para evitar logout
        current_user = User.query.get(user_id)
        if current_user:
            session["user_session_rev_count_local"] = current_user.user_session_rev_count
        
        db.session.commit()

        # Obtener todos los servidores IMAP vinculados para devolver la lista actualizada
        linked_servers = imap2_server.linked_imap_servers.all()
        current_count = len(linked_servers)
        MAX_LINKED_IMAP_FOR_USERS = 4
        
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
            "servers": servers_data,
            "current_count": current_count,
            "max_allowed": MAX_LINKED_IMAP_FOR_USERS,
            "can_create_more": current_count < MAX_LINKED_IMAP_FOR_USERS
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400

@user_auth_bp.route("/my_page/<int:imap2_id>/linked_imap_servers", methods=["GET"])
@login_required
def get_my_page_linked_imap_servers(imap2_id):
    """Obtiene la lista de servidores IMAP vinculados a un IMAP2 (para usuarios)"""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"status": "error", "message": "No autenticado"}), 401
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
        
        # Verificar permiso
        has_permission, imap2_server = check_imap2_permission(user, imap2_id)
        if not has_permission:
            return jsonify({"status": "error", "message": "No tienes permiso"}), 403
        
        linked_servers = imap2_server.linked_imap_servers.all()
        current_count = len(linked_servers)
        MAX_LINKED_IMAP_FOR_USERS = 4
        
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
            "servers": servers_data,
            "current_count": current_count,
            "max_allowed": MAX_LINKED_IMAP_FOR_USERS,
            "can_create_more": current_count < MAX_LINKED_IMAP_FOR_USERS
        }), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@user_auth_bp.route("/my_page/<int:imap2_id>/unlink_imap/<int:imap_id>", methods=["POST"])
@login_required
@csrf_exempt_route
def unlink_imap_from_my_page(imap2_id, imap_id):
    """Desvincula y ELIMINA un servidor IMAP de un servidor IMAP2 (para usuarios)"""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"status": "error", "message": "No autenticado"}), 401
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
        
        # Verificar permiso
        has_permission, imap2_server = check_imap2_permission(user, imap2_id)
        if not has_permission:
            return jsonify({"status": "error", "message": "No tienes permiso"}), 403
        
        imap_server = IMAPServer.query.get_or_404(imap_id)
        
        # Verificar que esté vinculado
        if imap_server not in imap2_server.linked_imap_servers:
            return jsonify({"status": "error", "message": "Este servidor IMAP no está vinculado."}), 400
        
        # Eliminar la vinculación primero
        imap2_server.linked_imap_servers.remove(imap_server)
        
        # Eliminar el servidor IMAP completamente de la base de datos
        db.session.delete(imap_server)
        
        # Actualizar sesión para evitar logout
        current_user = User.query.get(user_id)
        if current_user:
            session["user_session_rev_count_local"] = current_user.user_session_rev_count
        
        db.session.commit()
        
        # Obtener el conteo actualizado
        current_count = imap2_server.linked_imap_servers.count()
        MAX_LINKED_IMAP_FOR_USERS = 4
        
        return jsonify({
            "status": "ok",
            "message": f"Servidor IMAP {imap_server.host}:{imap_server.port} eliminado correctamente.",
            "current_count": current_count,
            "max_allowed": MAX_LINKED_IMAP_FOR_USERS,
            "can_create_more": current_count < MAX_LINKED_IMAP_FOR_USERS
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400

@user_auth_bp.route("/my_page/test_imap_ajax", methods=["POST"])
@login_required
@csrf_exempt_route
def test_my_page_imap_ajax():
    """Prueba la conexión de un servidor IMAP vinculado vía AJAX (para usuarios)"""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"status": "error", "message": "No autenticado"}), 401
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
        
        data = request.get_json()
        server_id = data.get("server_id")
        
        if not server_id:
            return jsonify({"status": "error", "message": "server_id es requerido"}), 400
        
        # Obtener el servidor IMAP
        imap_server = IMAPServer.query.get(server_id)
        if not imap_server:
            return jsonify({"status": "error", "message": "Servidor IMAP no encontrado"}), 404
        
        # Verificar que el servidor IMAP esté vinculado a algún IMAP2 que el usuario pueda gestionar
        imap2_servers = IMAPServer2.query.filter(
            IMAPServer2.linked_imap_servers.any(IMAPServer.id == server_id)
        ).all()
        
        has_permission = False
        for imap2 in imap2_servers:
            if user in imap2.allowed_users.all():
                has_permission = True
                break
        
        if not has_permission:
            return jsonify({"status": "error", "message": "No tienes permiso"}), 403
        
        is_ok, message = test_imap_connection(server_id, model_cls=IMAPServer)
        
        if is_ok:
            return jsonify({"status": "ok", "message": message}), 200
        else:
            return jsonify({"status": "error", "message": message}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@user_auth_bp.route("/my_page/test_imap/<int:server_id>", methods=["POST"])
@login_required
def test_my_page_imap(server_id):
    """Prueba la conexión de un servidor IMAP vinculado (para usuarios)"""
    try:
        user_id = session.get("user_id")
        if not user_id:
            flash("Debes iniciar sesión para acceder a esta página.", "danger")
            return redirect(url_for("user_auth_bp.login"))
        
        user = User.query.get(user_id)
        if not user:
            flash("Usuario no encontrado.", "danger")
            return redirect(url_for("main_bp.home"))
        
        # Obtener el servidor IMAP
        imap_server = IMAPServer.query.get_or_404(server_id)
        
        # Verificar que el servidor IMAP esté vinculado a algún IMAP2 que el usuario pueda gestionar
        imap2_servers = IMAPServer2.query.filter(
            IMAPServer2.linked_imap_servers.any(IMAPServer.id == server_id)
        ).all()
        
        has_permission = False
        for imap2 in imap2_servers:
            if user in imap2.allowed_users.all():
                has_permission = True
                break
        
        if not has_permission:
            flash("No tienes permiso para probar este servidor.", "danger")
            return redirect(url_for("main_bp.home"))
        
        is_ok, message = test_imap_connection(server_id, model_cls=IMAPServer)

        if is_ok:
            flash(f"Éxito probando servidor IMAP ID {server_id}: {message}", "success")
        else:
            flash(f"Error probando servidor IMAP ID {server_id}: {message}", "danger")

        # Redirigir de vuelta a la página de gestión
        # Buscar el primer IMAP2 que tenga este servidor vinculado y que el usuario pueda gestionar
        for imap2 in imap2_servers:
            if user in imap2.allowed_users.all():
                return redirect(url_for("user_auth_bp.manage_my_page", server_id=imap2.id))
        
        return redirect(url_for("main_bp.home"))
    except Exception as e:
        flash(f"Error al probar servidor: {str(e)}", "danger")
        return redirect(url_for("main_bp.home"))

@user_auth_bp.route("/my_page/toggle_imap", methods=["POST"])
@login_required
@csrf_exempt_route
def toggle_my_page_imap():
    """Cambia el estado enabled/disabled de un servidor IMAP vinculado (para usuarios)"""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"status": "error", "message": "No autenticado"}), 401
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
        
        data = request.get_json()
        srv_id = data.get("server_id")
        imap2_id = data.get("imap2_id")  # Recibir imap2_id desde el frontend para evitar búsquedas
        currently_enabled = data.get("currently_enabled", True)

        if isinstance(currently_enabled, str):
            currently_enabled = (currently_enabled.lower() == "true")

        if not srv_id:
            return jsonify({"status": "error", "message": "server_id es requerido"}), 400

        srv = IMAPServer.query.get_or_404(srv_id)
        
        # Si tenemos imap2_id, verificar permiso directamente (más rápido)
        if imap2_id:
            imap2_server = IMAPServer2.query.get(imap2_id)
            if not imap2_server:
                return jsonify({"status": "error", "message": "Servidor IMAP2 no encontrado"}), 404
            
            # Verificar permiso de forma más eficiente
            if user not in imap2_server.allowed_users.all():
                return jsonify({"status": "error", "message": "No tienes permiso"}), 403
            
            # Verificar que el servidor esté vinculado
            if srv not in imap2_server.linked_imap_servers.all():
                return jsonify({"status": "error", "message": "Este servidor IMAP no está vinculado."}), 400
        else:
            # Fallback: buscar IMAP2 que tenga este servidor vinculado (más lento)
            imap2_servers = IMAPServer2.query.filter(
                IMAPServer2.linked_imap_servers.any(IMAPServer.id == srv_id)
            ).all()
            
            has_permission = False
            imap2_server = None
            for imap2 in imap2_servers:
                if user in imap2.allowed_users.all():
                    has_permission = True
                    imap2_server = imap2
                    imap2_id = imap2.id
                    break
            
            if not has_permission or not imap2_server:
                return jsonify({"status": "error", "message": "No tienes permiso"}), 403
        
        # Cambiar estado
        srv.enabled = not currently_enabled
        
        # Actualizar sesión para evitar logout (antes del commit)
        current_user = User.query.get(user_id)
        if current_user:
            session["user_session_rev_count_local"] = current_user.user_session_rev_count
        
        db.session.commit()

        # Obtener todos los servidores IMAP vinculados para devolver la lista actualizada
        if imap2_id:
            # Recargar desde la sesión para obtener datos frescos
            db.session.refresh(imap2_server)
            linked_servers = imap2_server.linked_imap_servers.all()
            current_count = len(linked_servers)
            MAX_LINKED_IMAP_FOR_USERS = 4
            
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
                "servers": servers_data,
                "current_count": current_count,
                "max_allowed": MAX_LINKED_IMAP_FOR_USERS,
                "can_create_more": current_count < MAX_LINKED_IMAP_FOR_USERS
            }), 200

        return jsonify({"status": "ok"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400

@user_auth_bp.route("/my_page/update_imap2_filter_association_ajax", methods=["POST"])
@login_required
@csrf_exempt_route
def update_my_page_imap2_filter_association_ajax():
    """Actualiza la asociación de un filtro con un servidor IMAP2 (para usuarios)"""
    try:
        # Verificar sesión
        if 'logged_in' not in session or 'is_user' not in session:
            return jsonify({"status": "error", "message": "Debes iniciar sesión"}), 401
        
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"status": "error", "message": "Debes iniciar sesión"}), 401
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
        
        data = request.get_json()
        server_id = data.get("server_id")
        filter_id = data.get("filter_id")
        is_checked = data.get("checked", False)

        if not server_id or not filter_id:
            return jsonify({"status": "error", "message": "Faltan parámetros requeridos"}), 400

        # Obtener el servidor IMAP2
        imap_server = IMAPServer2.query.get_or_404(server_id)
        
        # Verificar que el usuario tenga permiso para gestionar esta página
        if user not in imap_server.allowed_users.all():
            return jsonify({"status": "error", "message": "No tienes permiso para gestionar esta página"}), 403
        
        # Obtener el filtro
        filter_obj = FilterModel.query.get_or_404(filter_id)
        
        # Verificar que el usuario tenga permiso para usar este filtro
        if filter_obj not in user.filters_allowed:
            return jsonify({"status": "error", "message": "No tienes permiso para usar este filtro"}), 403

        if is_checked:
            # Añadir asociación si no existe
            if filter_obj not in imap_server.filters:
                imap_server.filters.append(filter_obj)
        else:
            # Remover asociación si existe
            if filter_obj in imap_server.filters:
                imap_server.filters.remove(filter_obj)

        db.session.commit()
        return jsonify({"status": "ok", "message": "Asociación actualizada correctamente"})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al actualizar asociación filtro-IMAP2: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500

@user_auth_bp.route("/my_page/update_imap2_regex_association_ajax", methods=["POST"])
@login_required
@csrf_exempt_route
def update_my_page_imap2_regex_association_ajax():
    """Actualiza la asociación de un regex con un servidor IMAP2 (para usuarios)"""
    try:
        # Verificar sesión
        if 'logged_in' not in session or 'is_user' not in session:
            return jsonify({"status": "error", "message": "Debes iniciar sesión"}), 401
        
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"status": "error", "message": "Debes iniciar sesión"}), 401
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
        
        data = request.get_json()
        server_id = data.get("server_id")
        regex_id = data.get("regex_id")
        is_checked = data.get("checked", False)

        if not server_id or not regex_id:
            return jsonify({"status": "error", "message": "Faltan parámetros requeridos"}), 400

        # Obtener el servidor IMAP2
        imap_server = IMAPServer2.query.get_or_404(server_id)
        
        # Verificar que el usuario tenga permiso para gestionar esta página
        if user not in imap_server.allowed_users.all():
            return jsonify({"status": "error", "message": "No tienes permiso para gestionar esta página"}), 403
        
        # Obtener el regex
        regex_obj = RegexModel.query.get_or_404(regex_id)
        
        # Verificar que el usuario tenga permiso para usar este regex
        if regex_obj not in user.regexes_allowed:
            return jsonify({"status": "error", "message": "No tienes permiso para usar este regex"}), 403

        if is_checked:
            # Añadir asociación si no existe
            if regex_obj not in imap_server.regexes:
                imap_server.regexes.append(regex_obj)
        else:
            # Remover asociación si existe
            if regex_obj in imap_server.regexes:
                imap_server.regexes.remove(regex_obj)

        db.session.commit()
        return jsonify({"status": "ok", "message": "Asociación actualizada correctamente"})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al actualizar asociación regex-IMAP2: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500
