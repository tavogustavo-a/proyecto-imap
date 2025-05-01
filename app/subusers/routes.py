# app/subusers/routes.py

from flask import (
    request, jsonify, render_template, session,
    redirect, url_for, current_app, flash
)
from app.subusers import subuser_bp
from app.extensions import db
from app.models import User, FilterModel, RegexModel, RememberDevice, ServiceModel
from werkzeug.security import generate_password_hash
import re
from app.helpers import increment_global_session_revocation_count
from app.services.email_service import send_otp_email
from datetime import datetime, timedelta
from functools import wraps
from app.models.user import AllowedEmail
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_
# Eliminar la siguiente línea si Flask-Login no se usa
# from flask_login import current_user, login_required

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            flash('Por favor inicie sesión para acceder a esta página.', 'danger')
            return redirect(url_for('user_auth_bp.login'))
        return f(*args, **kwargs)
    return decorated_function

def can_access_subusers():
    """
    Determina si el usuario actual (sesión) está logueado
    y tiene permiso para manejar sub-usuarios.
    """
    if not session.get("logged_in"):
        return False

    admin_username = current_app.config.get("ADMIN_USER", "admin")
    # El admin puede manipular cualquier sub-usuario
    if session.get("username") == admin_username:
        return True

    # Caso usuario normal con can_create_subusers
    if session.get("is_user"):
        parent_id = session.get("user_id")
        parent_user = User.query.get(parent_id)
        if parent_user and parent_user.can_create_subusers:
            return True

    return False


@subuser_bp.route("/manage_subusers")
def manage_subusers():
    """
    Renderiza la plantilla principal de administración
    de sub-usuarios (creación, toggle, eliminación, etc.).
    """
    if not can_access_subusers():
        flash("No autorizado", "danger")
        return redirect(url_for("user_auth_bp.login"))
    return render_template("manage_subusers.html")


@subuser_bp.route("/list_subusers_ajax", methods=["GET"])
def list_subusers_ajax():
    """
    Devuelve en JSON la lista de sub-usuarios del parent actual
    (o todos, si eres admin), con posibilidad de filtrar por ?query=.
    # Quitamos la parte de correos de aquí
    """
    if not can_access_subusers():
        return jsonify({"status": "error", "message": "No autorizado"}), 403

    admin_username = current_app.config.get("ADMIN_USER", "admin")
    current_username = session.get("username")

    query_str = request.args.get("query", "").strip().lower()
    parent_id_from_request = request.args.get("parent_id", type=int) 

    # Volvemos a la lógica original de obtención de subusuarios
    sub_q = None
    parent_id_context = None # Para la función auxiliar _get_subusers_data si se usa

    if current_username == admin_username:
        if parent_id_from_request:
            parent_user = User.query.get(parent_id_from_request)
            if not parent_user:
                 return jsonify({"status": "error", "message": f"Usuario padre con ID {parent_id_from_request} no encontrado."}), 404
            sub_q = User.query.filter_by(parent_id=parent_user.id)
            parent_id_context = parent_user.id
        else:
            # Admin sin especificar parent_id lista TODOS los sub-usuarios
            sub_q = User.query.filter(User.parent_id.isnot(None))
            # No hay parent_id_context aquí
    else:
        # Usuario normal
        real_parent_id = session.get("user_id")
        if parent_id_from_request and parent_id_from_request != real_parent_id:
            return jsonify({"status":"error","message":"No tienes permiso para ver subusuarios de otro padre."}), 403
        
        parent_user = User.query.get(real_parent_id)
        if not parent_user:
            session.clear()
            return jsonify({"status":"error","message":"Error de sesión, usuario padre no encontrado."}), 500
        
        sub_q = User.query.filter_by(parent_id=parent_user.id)
        parent_id_context = parent_user.id

    if query_str and sub_q is not None: # Asegurarse que sub_q está definido
        sub_q = sub_q.filter(User.username.ilike(f"%{query_str}%"))

    # Si sub_q no se inicializó (ej: admin sin parent_id), devolver lista vacía o error
    if sub_q is None:
        # Podríamos decidir devolver error o lista vacía si el admin no especifica padre
        # Por consistencia con el código anterior, devolvemos todos los subusers en este caso para admin
        if current_username == admin_username and not parent_id_from_request:
             sub_q = User.query.filter(User.parent_id.isnot(None))
        else:
            # Situación inesperada o usuario normal sin padre (ya manejado)
             return jsonify({"status": "ok", "subusers": []}), 200 # Devuelve vacío si no hay query builder

    subusers = sub_q.order_by(User.username.asc()).all() 
    
    # Usar la función auxiliar si existe y tiene sentido, o formatear aquí
    # Revertimos al formateo simple original
    data = []
    for su in subusers:
        data.append({
            "id": su.id,
            "username": su.username,
            "enabled": su.enabled
        })

    # Ya no devolvemos parent_emails
    return jsonify({"status": "ok", "subusers": data}), 200


@subuser_bp.route("/create_subuser_ajax", methods=["POST"])
def create_subuser_ajax():
    """
    Crea un nuevo sub-usuario (hijo de un usuario principal).
    """
    if not can_access_subusers():
        return jsonify({"status": "error", "message": "No autorizado"}), 403

    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    if not username or not password:
        return jsonify({"status":"error","message":"Faltan datos"}), 400

    existing = User.query.filter_by(username=username).first()
    if existing:
        return jsonify({"status":"error","message":f"El usuario '{username}' ya existe."}), 400

    # --- OBTENER PADRE DESDE LA SESIÓN --- 
    parent_user_id = session.get("user_id")
    if not parent_user_id:
        current_app.logger.error("[CreateSubuser] No se encontró parent_user_id en la sesión.")
        return jsonify({"status": "error", "message": "Error de sesión."}), 500
        
    parent_user = User.query.get(parent_user_id)
    if not parent_user:
        current_app.logger.error(f"[CreateSubuser] No se encontró usuario padre con ID {parent_user_id}.")
        session.clear()
        return jsonify({"status": "error", "message": "Error de sesión."}), 500
    # --- FIN OBTENER PADRE --- 

    # Verificar permiso del padre obtenido
    if not parent_user.can_create_subusers:
         return jsonify({"status":"error","message":"No tienes permiso"}), 403

    # Crear sub-usuario
    hashed_pass = generate_password_hash(password)
    new_subuser = User(
        username=username,
        password=hashed_pass,
        parent_id=parent_user.id, # Usar ID del padre obtenido
        enabled=True
        # Otros campos por defecto: color, position, can_search_any=False, etc.
    )
    db.session.add(new_subuser)

    # --- INICIO: Asignar Permisos PERMITIDOS del Padre --- 
    parent_allowed_regexes = parent_user.regexes_allowed
    new_subuser.regexes_allowed = list(parent_allowed_regexes)

    parent_allowed_filters = parent_user.filters_allowed
    new_subuser.filters_allowed = list(parent_allowed_filters)
    # --- FIN: Asignar Permisos --- 

    # --- Asignar Servicios --- 
    all_services = ServiceModel.query.all()
    if all_services:
        new_subuser.services_allowed = all_services

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al crear sub-usuario {username} o asignar permisos: {e}", exc_info=True)
        return jsonify({"status":"error", "message": "Error interno al crear sub-usuario."}), 500

    # Recargar y devolver lista actualizada
    updated_subusers = _get_subusers_data(parent_user.id)
    return jsonify({"status":"ok","subusers":updated_subusers}),200


@subuser_bp.route("/toggle_subuser/<int:subuser_id>", methods=["POST"])
@login_required
def toggle_subuser(subuser_id):
    """
    Alternar el estado enabled/disabled de un sub-usuario.
    """
    subuser = User.query.get_or_404(subuser_id)
    
    # Verificar que el usuario actual es el padre del sub-usuario
    if subuser.parent_id != session.get("user_id"):
        flash("No tienes permiso para modificar este sub-usuario.", "danger")
        return redirect(url_for("subuser_bp.manage_subusers"))

    # Si el sub-usuario está siendo desactivado, guardar su estado anterior
    if subuser.enabled:
        subuser.was_enabled = True
    else:
        subuser.was_enabled = None  # Limpiar el estado anterior si se está activando

    # Cambiar el estado del sub-usuario
    subuser.enabled = not subuser.enabled
    db.session.commit()

    flash(f"Sub-usuario {subuser.username} {'habilitado' if subuser.enabled else 'deshabilitado'}.", "success")
    return redirect(url_for("subuser_bp.manage_subusers"))


@subuser_bp.route("/toggle_subuser_ajax", methods=["POST"])
def toggle_subuser_ajax():
    """
    Activa/Desactiva un sub-usuario específico.
    Retorna la lista actualizada de sub-usuarios del mismo padre.
    Usa un solo commit.
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403

    data = request.get_json()
    sub_id = data.get("sub_id")
    currently_enabled = data.get("currently_enabled", True)

    sub_user = User.query.get_or_404(sub_id)

    # Validar pertenencia si no es admin
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    parent_id_of_sub = sub_user.parent_id # Guardar el ID del padre
    parent_user = None
    if current_username != admin_username:
        parent_id_session = session.get("user_id")
        if parent_id_of_sub != parent_id_session:
            return jsonify({"status":"error","message":"No existe o no te pertenece"}),403
        parent_user = User.query.get(parent_id_session)
    
    # Validar si el padre está habilitado (si no es admin)
    if parent_user and not parent_user.enabled:
         return jsonify({"status":"error","message":"El usuario padre está desactivado."}),403

    try:
        new_status = not currently_enabled
        sub_user.enabled = new_status
        current_app.logger.info(f"Cambiando estado de sub-user {sub_id} a enabled={new_status}")

        # Si se deshabilita => limpiar sesión/token
        if not new_status:
            current_app.logger.info(f"Sub-usuario {sub_id} desactivado. Limpiando sesión/token.")
            RememberDevice.query.filter_by(user_id=sub_user.id).delete()
            sub_user.user_session_rev_count += 1
        
        # Commit único
        db.session.commit()
        current_app.logger.info(f"Estado de sub-user {sub_id} actualizado con éxito.")

        # Recargar la lista usando función auxiliar
        # Necesitamos el ID del padre para la función auxiliar
        if not parent_id_of_sub:
             current_app.logger.error(f"Sub-usuario {sub_id} no tiene parent_id!")
             # Decide cómo manejar esto, quizás devolver lista vacía o error
             updated_subusers = [] 
        else:
             updated_subusers = _get_subusers_data(parent_id_of_sub)
             
        return jsonify({"status":"ok","subusers":updated_subusers}),200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al hacer toggle a sub-user {sub_id}: {e}", exc_info=True)
        return jsonify({"status":"error","message":"Error interno al cambiar estado."}), 500


@subuser_bp.route("/delete_subuser_ajax", methods=["POST"])
def delete_subuser_ajax():
    """
    Elimina un sub-usuario por su ID.
    Retorna la lista actualizada de sub-usuarios del mismo padre.
    Usa un solo commit.
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403

    data = request.get_json()
    sub_id = data.get("subuser_id")

    if sub_id is None:
         return jsonify({"status": "error", "message": "Falta el ID del sub-usuario."}), 400

    sub_user = User.query.get_or_404(sub_id)
    parent_id_of_sub = sub_user.parent_id # Guardar ID del padre ANTES de borrar

    if not parent_id_of_sub:
        # No debería pasar si la lógica de creación es correcta, pero por seguridad
        return jsonify({"status":"error","message":"El usuario no es un sub-usuario válido."}), 400

    # Validar pertenencia si no es admin
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    if current_username != admin_username:
        parent_id_session = session.get("user_id")
        if parent_id_of_sub != parent_id_session:
            return jsonify({"status":"error","message":"No existe o no te pertenece"}),403

    try:
        current_app.logger.info(f"Iniciando eliminación de sub-user {sub_id}...")
        # 1. Eliminar RememberDevice asociados
        RememberDevice.query.filter_by(user_id=sub_user.id).delete()
        # Nota: No incrementamos user_session_rev_count porque el usuario se elimina

        # 2. Eliminar el sub-usuario
        db.session.delete(sub_user)
        
        # 3. Commit único
        db.session.commit()
        current_app.logger.info(f"Sub-usuario {sub_id} eliminado con éxito.")

        # Recargar la lista de sub-usuarios usando función auxiliar
        updated_subusers = _get_subusers_data(parent_id_of_sub)
        return jsonify({"status":"ok","subusers":updated_subusers}),200
    
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar sub-user {sub_id}: {e}", exc_info=True)
        return jsonify({"status":"error","message":"Error interno al eliminar sub-usuario."}), 500


@subuser_bp.route("/edit/<int:sub_id>", methods=["GET"])
def edit_subuser(sub_id):
    """
    Muestra la plantilla "edit_subuser.html" para administrar
    un sub-usuario (cambiar pass, correos...).
    Ahora obtiene los correos permitidos del sub-usuario y los del padre.
    """
    if not can_access_subusers():
        flash("No autorizado", "danger")
        return redirect(url_for("user_auth_bp.login"))

    sub_user = User.query.get_or_404(sub_id)

    # --- Validación de Pertenencia y obtención del Padre --- 
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    parent_user = None # Inicializar parent_user

    if not sub_user.parent_id:
         flash("Este usuario no parece ser un sub-usuario válido.", "danger")
         return redirect(url_for("subuser_bp.manage_subusers")) # O a donde corresponda

    if current_username != admin_username:
        parent_id_session = session.get("user_id")
        if sub_user.parent_id != parent_id_session:
            flash("No tienes permiso para editar este sub-usuario.", "danger")
            return redirect(url_for("subuser_bp.manage_subusers"))
        # Obtener el padre desde la sesión si es usuario normal
        parent_user = User.query.get(parent_id_session)
        if not parent_user:
            session.clear()
            flash("Error de sesión, usuario padre no encontrado.", "danger")
            return redirect(url_for("user_auth_bp.login"))
    else:
        # Si es admin, obtener el padre directamente del sub-usuario
        parent_user = User.query.get(sub_user.parent_id)
        if not parent_user:
            # Esto sería un error de datos inconsistentes
            flash(f"Error: El padre (ID: {sub_user.parent_id}) de este sub-usuario no existe.", "danger")
            return redirect(url_for("subuser_bp.manage_subusers")) # O a vista admin
    # --- Fin Validación y obtención del Padre --- 

    # Obtener correos asignados al sub-usuario (lista de strings)
    assigned_emails_entries = sub_user.allowed_email_entries.order_by(AllowedEmail.email.asc()).all()
    assigned_emails = [ae.email for ae in assigned_emails_entries]

    # Obtener correos permitidos para el padre (lista de strings)
    # parent_user ya está definido y validado arriba
    parent_allowed_emails_entries = parent_user.allowed_email_entries.order_by(AllowedEmail.email.asc()).all()
    parent_allowed_emails = [ae.email for ae in parent_allowed_emails_entries]

    # Mantener el texto multilinea original por si aún se usa en algún sitio de la plantilla antigua
    allowed_emails_text = "\n".join(assigned_emails) 

    return render_template("edit_subuser.html", 
                           sub_user=sub_user, 
                           assigned_emails=assigned_emails, # Lista de correos asignados al sub_user
                           parent_allowed_emails=parent_allowed_emails, # Lista de correos permitidos del padre
                           allowed_emails_text=allowed_emails_text # Mantener por compatibilidad temporal
                           )


@subuser_bp.route("/update_subuser_password", methods=["POST"])
def update_subuser_password():
    """
    Actualiza la contraseña de un sub-usuario.
    """
    if not can_access_subusers():
        flash("No autorizado", "danger")
        return redirect(url_for("user_auth_bp.login"))

    sub_id = request.form.get("sub_id")
    new_pass = request.form.get("new_pass","").strip()

    sub_user = User.query.get_or_404(sub_id)

    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")

    if current_username != admin_username:
        parent_id = session.get("user_id")
        if sub_user.parent_id != parent_id:
            flash("No existe o no te pertenece", "danger")
            return redirect(url_for("subuser_bp.manage_subusers"))

    if not new_pass:
        flash("Contraseña vacía", "danger")
        return redirect(url_for("subuser_bp.edit_subuser", sub_id=sub_user.id))

    hashed_pass = generate_password_hash(new_pass)
    sub_user.password = hashed_pass
    db.session.commit()

    flash("Contraseña de sub-usuario actualizada correctamente.", "success")
    return redirect(url_for("subuser_bp.edit_subuser", sub_id=sub_user.id))


# ================== Manejo de Correos Sub-usuario ==================
@subuser_bp.route("/search_subuser_emails_ajax", methods=["POST"])
def search_subuser_emails_ajax():
    """
    Busca correos dentro de AllowedEmail de un sub-usuario,
    aceptando múltiples términos de búsqueda separados.
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403

    data = request.get_json()
    sub_id = data.get("sub_id")
    search_text = data.get("search_text", "").strip()

    if sub_id is None:
        return jsonify({"status":"error","message":"Falta sub_id."}), 400

    sub_user = User.query.get_or_404(sub_id)

    # Validar pertenencia si no es admin
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    if current_username != admin_username:
        parent_id = session.get("user_id")
        if sub_user.parent_id != parent_id:
            return jsonify({"status":"error","message":"No existe o no te pertenece"}),403

    # Procesar texto de búsqueda
    search_terms = [t.lower() for t in re.split(r"[,\n\r\s]+", search_text) if t.strip()]

    if not search_terms:
        # Devolver vacío si no hay términos
        email_query = sub_user.allowed_email_entries.filter(db.false()).order_by(AllowedEmail.email.asc()) 
    else:
        # Construir condición OR con ILIKE
        conditions = []
        for term in search_terms:
            conditions.append(AllowedEmail.email.ilike(f"%{term}%"))
        # Aplicar filtro OR
        email_query = sub_user.allowed_email_entries.filter(or_(*conditions)).order_by(AllowedEmail.email.asc())
        
    found_emails = [ae.email for ae in email_query.all()]
    current_app.logger.info(f"Búsqueda de correos para sub-user {sub_id} con términos {search_terms} encontró {len(found_emails)} resultados.")
    return jsonify({"status": "ok", "emails": found_emails})


@subuser_bp.route("/delete_subuser_email_ajax", methods=["POST"])
def delete_subuser_email_ajax():
    """
    Elimina 1 correo específico de AllowedEmail de un sub-usuario.
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403

    data = request.get_json()
    sub_id = data.get("sub_id")
    email_to_remove = data.get("email", "").strip().lower()

    if not sub_id or not email_to_remove:
        return jsonify({"status":"error","message":"Faltan datos (sub_id o email)."}), 400

    sub_user = User.query.get_or_404(sub_id)

    # Validar pertenencia si no es admin
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    if current_username != admin_username:
        parent_id = session.get("user_id")
        if sub_user.parent_id != parent_id:
            return jsonify({"status":"error","message":"No existe o no te pertenece"}),403

    # Eliminar el registro AllowedEmail
    deleted_count = AllowedEmail.query.filter_by(user_id=sub_id, email=email_to_remove).delete()
    
    try:
        db.session.commit()
        if deleted_count > 0:
             current_app.logger.info(f"Correo '{email_to_remove}' eliminado para sub-user {sub_id}.")
             return jsonify({"status":"ok"})
        else:
             current_app.logger.warning(f"Se intentó eliminar correo '{email_to_remove}' para sub-user {sub_id}, pero no se encontró.")
             return jsonify({"status":"error","message":"Correo no encontrado."}) # O status ok?
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar correo '{email_to_remove}' para sub-user {sub_id}: {e}")
        return jsonify({"status":"error","message":"Error al eliminar correo."}), 500


@subuser_bp.route("/delete_many_subuser_emails_ajax", methods=["POST"])
def delete_many_subuser_emails_ajax():
    """
    Elimina varios correos a la vez de AllowedEmail de un sub-usuario.
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403

    data = request.get_json()
    sub_id = data.get("sub_id")
    emails_array = data.get("emails", [])

    if not sub_id or not emails_array:
        return jsonify({"status":"error","message":"Faltan datos (sub_id o emails)."}), 400

    sub_user = User.query.get_or_404(sub_id)

    # Validar pertenencia si no es admin
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    if current_username != admin_username:
        parent_id = session.get("user_id")
        if sub_user.parent_id != parent_id:
            return jsonify({"status":"error","message":"No existe o no te pertenece"}),403

    # Normalizar emails
    normalized_emails = [e.strip().lower() for e in emails_array if isinstance(e, str) and e.strip()]
    if not normalized_emails:
        return jsonify({"status":"ok", "message":"No emails validos para eliminar."})
        
    # Eliminar usando IN clause
    deleted_count = AllowedEmail.query.filter(
        AllowedEmail.user_id == sub_id,
        AllowedEmail.email.in_(normalized_emails)
    ).delete(synchronize_session=False)
    
    try:
        db.session.commit()
        current_app.logger.info(f"{deleted_count} correos eliminados para sub-user {sub_id}.")
        return jsonify({"status":"ok"})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar multiples correos para sub-user {sub_id}: {e}")
        return jsonify({"status":"error","message":"Error al eliminar correos."}), 500


@subuser_bp.route("/save_allowed_emails/<int:sub_id>", methods=["POST"])
def save_allowed_emails(sub_id):
    """
    Guarda los correos permitidos para un sub-usuario en la tabla AllowedEmail.
    (La lógica de herencia/limitación por el padre ya no aplica directamente aquí,
     se asume que los correos proporcionados son los que debe tener el sub-usuario).
    """
    if not can_access_subusers():
        flash("No autorizado", "danger")
        return redirect(url_for("user_auth_bp.login"))

    sub_user = User.query.get_or_404(sub_id)

    # Validar pertenencia si no es admin
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    parent_user = None
    if current_username != admin_username:
        parent_id = session.get("user_id")
        if sub_user.parent_id != parent_id:
            flash("No existe o no te pertenece", "danger")
            return redirect(url_for("subuser_bp.manage_subusers"))
        parent_user = User.query.get(parent_id)
    
    raw_text = request.form.get("allowed_emails_text", "").strip() # Asume que el textarea se llama así
    
    # Limpiar correos existentes para este sub-usuario
    AllowedEmail.query.filter_by(user_id=sub_user.id).delete()
    
    lines = [x.strip().lower() for x in re.split(r"[,\n\r\s]+", raw_text) if x.strip()]
    unique_emails = sorted(list(set(lines)))
    
    # --- INICIO: Validar contra correos del padre (si no es admin) ---
    final_emails_to_save = []
    filtered_out_count = 0
    if parent_user: # parent_user se obtiene si current_user != admin_username
        parent_allowed_set = {ae.email for ae in parent_user.allowed_email_entries.all()}
        for email in unique_emails:
            if email in parent_allowed_set:
                final_emails_to_save.append(email)
            else:
                filtered_out_count += 1
        current_app.logger.info(f"Guardando correos para sub-user {sub_id}: {len(final_emails_to_save)} permitidos por el padre, {filtered_out_count} filtrados.")
    else: # Es el admin, no filtramos
        final_emails_to_save = unique_emails
        current_app.logger.info(f"Guardando correos para sub-user {sub_id} (Admin). Sin filtro de padre.")
    # --- FIN: Validar contra correos del padre --- 
            
    new_email_objects = []
    # Usar final_emails_to_save en lugar de unique_emails
    for email in final_emails_to_save:
        if email:
            new_email_objects.append(AllowedEmail(user_id=sub_user.id, email=email))
    
    if new_email_objects:
        db.session.bulk_save_objects(new_email_objects)
        
    try:
        db.session.commit()
        flash_message = f"Correos permitidos para {sub_user.username} actualizados."
        if filtered_out_count > 0:
            flash_message += f" ({filtered_out_count} correos ignorados por no estar permitidos para el padre)."
            flash(flash_message, "warning") # Usar warning si se filtraron
        else:
            flash(flash_message, "success")

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al guardar correos para sub-user {sub_id}: {e}")
        flash("Error al guardar correos.", "danger")
        
    return redirect(url_for("subuser_bp.edit_subuser", sub_id=sub_id))


# ========================= Manejo Global de Regex / Filtros sub-usuario =========================
@subuser_bp.route("/list_subusers_regex_global", methods=["GET"])
def list_subusers_regex_global():
    """
    Retorna TODOS los Regex globales, indicando para el modal:
    - locked: si el padre NO tiene permiso para este regex.
    - enabled: si el regex está en la lista default_regexes_for_subusers del padre
      (es decir, si estaba marcado la última vez que se guardó el modal).
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403

    parent_id = request.args.get("parent_id", type=int)
    if not parent_id:
        return jsonify({"status":"error","message":"Falta parent_id"}),400

    # Usar .get() en lugar de .get_or_404() para manejar el error como JSON
    parent_user = User.query.options(
        db.selectinload(User.regexes_allowed)
    ).get(parent_id)

    # Comprobar si el usuario padre existe
    if parent_user is None:
        return jsonify({"status": "error", "message": f"Usuario padre con ID {parent_id} no encontrado."}), 404

    # Validación de permisos...
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    if current_username != admin_username:
        if parent_user.id != session.get("user_id"):
            return jsonify({"status":"error","message":"No existe o no te pertenece"}),404

    from app.models.filters import RegexModel
    all_regexes = RegexModel.query.order_by(RegexModel.pattern.asc()).all()
    parent_allowed_ids = {rx.id for rx in parent_user.regexes_allowed}
    subuser_default_ids = {rx.id for rx in parent_user.default_regexes_for_subusers.all()}
    
    items = []
    for rx in all_regexes:
        is_locked = rx.id not in parent_allowed_ids
        is_enabled = rx.id in subuser_default_ids
        current_app.logger.debug(f"[ListSubRegexModal] Item ID {rx.id}: parent_allows={not is_locked}, is_default={is_enabled} -> final_enabled={is_enabled}, final_locked={is_locked}")
        items.append({
            "id": rx.id,
            "pattern": rx.pattern,
            "description": rx.description or "",
            "enabled": is_enabled,
            "locked": is_locked
        })
    return jsonify({"status":"ok","items":items})


@subuser_bp.route("/save_subusers_regex_global", methods=["POST"])
def save_subusers_regex_global():
    """
    Guarda la configuración "global" de Regex POR DEFECTO para los 
    futuros sub-usuarios del parent_id especificado (y para poblar el modal).
    Utiliza la nueva relación parent_user.default_regexes_for_subusers.
    NOTA: NO modifica los permisos activos (regexes_allowed) de los sub-usuarios.
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403

    data = request.get_json()
    parent_id = data.get("parent_id")
    modal_selected_ids = data.get("allowed_ids", []) # IDs seleccionados en el modal

    if not parent_id:
         return jsonify({"status":"error","message":"Falta parent_id."}), 400
         
    # Solo necesitamos cargar regexes_allowed del padre para validación
    parent_user = User.query.options(db.selectinload(User.regexes_allowed)).get_or_404(parent_id)
    if not parent_user:
        return jsonify({"status":"error","message":f"Usuario padre {parent_id} no encontrado."}), 404

    # Validación de permisos...
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    if current_username != admin_username:
        if parent_user.id != session.get("user_id"):
            return jsonify({"status":"error","message":"No tienes permiso para modificar la configuración de este usuario."}),403

    from app.models.filters import RegexModel
    
    try:
        modal_selected_ids_int = {int(id_) for id_ in modal_selected_ids}
    except ValueError:
         return jsonify({"status":"error","message":"Formato de ID inválido en los datos enviados."}), 400

    parent_allowed_regex_ids = {rx.id for rx in parent_user.regexes_allowed}
    
    # Calcular los IDs que se guardarán como default: Intersección modal + padre
    final_default_ids = modal_selected_ids_int.intersection(parent_allowed_regex_ids)

    current_app.logger.info(f"[SaveSubRegexDefaults] Padre {parent_id}: Modal={modal_selected_ids_int}, PadrePermite={parent_allowed_regex_ids}, Final para Default={final_default_ids}")

    # Obtener los objetos RegexModel correspondientes a los IDs finales para default
    final_regex_to_set_as_default = RegexModel.query.filter(RegexModel.id.in_(final_default_ids)).all()

    try:
        # 1. Actualizar SOLAMENTE la lista de DEFAULTS del padre
        parent_user.default_regexes_for_subusers = list(final_regex_to_set_as_default)
        current_app.logger.info(f"[SaveSubRegexDefaults] Relación default_regexes_for_subusers actualizada en sesión para padre {parent_id}.")

        # 2. Los _allowed de los sub-usuarios NO se tocan aquí.

        # 3. Commit único para los cambios en los defaults del padre
        db.session.commit()
        current_app.logger.info(f"[SaveSubRegexDefaults] Commit exitoso para defaults de padre {parent_id}.")
        return jsonify({"status":"ok"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error guardando config default regex para padre {parent_id}: {e}", exc_info=True)
        return jsonify({"status":"error","message":"Error interno al guardar la configuración default."}), 500


@subuser_bp.route("/list_subusers_filters_global", methods=["GET"])
def list_subusers_filters_global():
    """
    Retorna TODOS los Filtros globales, indicando para el modal:
    - locked: si el padre NO tiene permiso para este filtro.
    - enabled: si el filtro está en la lista default_filters_for_subusers del padre 
      (es decir, si estaba marcado la última vez que se guardó el modal).
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403

    parent_id = request.args.get("parent_id", type=int)
    if not parent_id:
        return jsonify({"status":"error","message":"Falta parent_id"}),400

    # Usar .get() en lugar de .get_or_404() para manejar el error como JSON
    parent_user = User.query.options(
        db.selectinload(User.filters_allowed)
    ).get(parent_id)

    # Comprobar si el usuario padre existe
    if parent_user is None:
        return jsonify({"status": "error", "message": f"Usuario padre con ID {parent_id} no encontrado."}), 404
    
    # Validación de permisos...
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    if current_username != admin_username:
        if parent_user.id != session.get("user_id"):
            return jsonify({"status":"error","message":"No existe o no te pertenece"}),404

    from app.models.filters import FilterModel
    all_filters = FilterModel.query.order_by(FilterModel.id.asc()).all()
    parent_allowed_ids = {f.id for f in parent_user.filters_allowed}
    subuser_default_ids = {f.id for f in parent_user.default_filters_for_subusers.all()}
    
    items = []
    for ft in all_filters:
        is_locked = ft.id not in parent_allowed_ids
        is_enabled = ft.id in subuser_default_ids
        current_app.logger.debug(f"[ListSubFiltersModal] Item ID {ft.id}: parent_allows={not is_locked}, is_default={is_enabled} -> final_enabled={is_enabled}, final_locked={is_locked}")
        items.append({
            "id": ft.id,
            "sender": ft.sender or "",
            "keyword": ft.keyword or "",
            "enabled": is_enabled,
            "locked": is_locked
        })
    return jsonify({"status":"ok","items":items})


@subuser_bp.route("/save_subusers_filters_global", methods=["POST"])
def save_subusers_filters_global():
    """
    Guarda la configuración "global" de Filtros POR DEFECTO para los 
    futuros sub-usuarios del parent_id especificado (y para poblar el modal).
    Utiliza la nueva relación parent_user.default_filters_for_subusers.
    NOTA: NO modifica los permisos activos (filters_allowed) de los sub-usuarios.
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403

    data = request.get_json()
    parent_id = data.get("parent_id")
    modal_selected_ids = data.get("allowed_ids", []) # IDs seleccionados en el modal

    if not parent_id:
         return jsonify({"status":"error","message":"Falta parent_id."}), 400
         
    # Solo necesitamos cargar filters_allowed del padre para validación
    parent_user = User.query.options(db.selectinload(User.filters_allowed)).get_or_404(parent_id)
    if not parent_user:
        return jsonify({"status":"error","message":f"Usuario padre {parent_id} no encontrado."}), 404

    # Validación de permisos...
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    if current_username != admin_username:
        if parent_user.id != session.get("user_id"):
            return jsonify({"status":"error","message":"No tienes permiso para modificar la configuración de este usuario."}),403

    from app.models.filters import FilterModel
    
    try:
        modal_selected_ids_int = {int(id_) for id_ in modal_selected_ids}
    except ValueError:
         return jsonify({"status":"error","message":"Formato de ID inválido en los datos enviados."}), 400

    parent_allowed_filter_ids = {ft.id for ft in parent_user.filters_allowed}
    
    # Calcular los IDs que se guardarán como default: Intersección modal + padre
    final_default_ids = modal_selected_ids_int.intersection(parent_allowed_filter_ids)

    current_app.logger.info(f"[SaveSubFiltersDefaults] Padre {parent_id}: Modal={modal_selected_ids_int}, PadrePermite={parent_allowed_filter_ids}, Final para Default={final_default_ids}")

    # Obtener los objetos FilterModel correspondientes a los IDs finales para default
    final_filters_to_set_as_default = FilterModel.query.filter(FilterModel.id.in_(final_default_ids)).all()

    try:
        # 1. Actualizar SOLAMENTE la lista de DEFAULTS del padre
        parent_user.default_filters_for_subusers = list(final_filters_to_set_as_default)
        current_app.logger.info(f"[SaveSubFiltersDefaults] Relación default_filters_for_subusers actualizada en sesión para padre {parent_id}.")

        # 2. Los _allowed de los sub-usuarios NO se tocan aquí.

        # 3. Commit único para los cambios en los defaults del padre
        db.session.commit()
        current_app.logger.info(f"[SaveSubFiltersDefaults] Commit exitoso para defaults de padre {parent_id}.")
        return jsonify({"status":"ok"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error guardando config default filtros para padre {parent_id}: {e}", exc_info=True)
        return jsonify({"status":"error","message":"Error interno al guardar la configuración default."}), 500


@subuser_bp.route("/add_allowed_emails_ajax", methods=["POST"])
def add_allowed_emails_ajax():
    """
    Añade una lista de nuevos correos permitidos para un sub-usuario.
    Verifica permisos y evita duplicados para ESE sub-usuario.
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403

    data = request.get_json()
    sub_id = data.get("sub_id")
    emails_to_add = data.get("emails", [])

    if not sub_id or not emails_to_add:
        return jsonify({"status":"error","message":"Faltan datos (sub_id o emails)."}), 400

    sub_user = User.query.get_or_404(sub_id)

    # Validar pertenencia si no es admin
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    parent_user = None
    if current_username != admin_username:
        parent_id = session.get("user_id")
        if sub_user.parent_id != parent_id:
            return jsonify({"status":"error","message":"No existe o no te pertenece"}),403
        parent_user = User.query.get(parent_id) # Necesario para posible validación cruzada
        
    # Normalizar y obtener únicos de la entrada
    normalized_new_emails = list(set(
        e.strip().lower() 
        for e in emails_to_add if isinstance(e, str) and e.strip()
    ))
    
    if not normalized_new_emails:
        return jsonify({"status":"ok", "added_count": 0, "message":"No emails válidos para añadir."})

    # --- INICIO: Validar contra correos del padre (si no es admin) ---
    if parent_user: # parent_user se obtuvo si no es admin
        parent_allowed_set = {ae.email for ae in parent_user.allowed_email_entries.all()}
        original_count = len(normalized_new_emails)
        normalized_new_emails = [e for e in normalized_new_emails if e in parent_allowed_set]
        filtered_out_count = original_count - len(normalized_new_emails)
        if filtered_out_count > 0:
             current_app.logger.info(f"Añadiendo a sub-user {sub_id}: {filtered_out_count} correos filtrados por no estar en el padre.")
        # Si después de filtrar no queda ninguno, devolver el mensaje solicitado
        if not normalized_new_emails:
            # Mensaje de error específico para esta condición
            custom_message = "No tienes permiso para añadir estos correos (no están permitidos en tu cuenta principal)."
            return jsonify({"status":"error", "message": custom_message, "added_count": 0}), 400
    # --- FIN: Validar contra correos del padre --- 

    # Obtener los emails que YA existen para este SUB-USUARIO
    # (Se hace después de filtrar por padre para no consultar emails innecesarios)
    existing_emails = {ae.email for ae in sub_user.allowed_email_entries.filter(AllowedEmail.email.in_(normalized_new_emails)).all()}
    
    new_email_objects = []
    actually_added_count = 0
    for email in normalized_new_emails:
        if email not in existing_emails:
            new_email_objects.append(AllowedEmail(user_id=sub_id, email=email))
            actually_added_count += 1
        else:
             current_app.logger.info(f"Correo '{email}' ya existe para sub-user {sub_id}. Omitiendo.")

    if not new_email_objects:
        return jsonify({"status":"ok", "added_count": 0, "message":"Todos los correos proporcionados ya existían para este sub-usuario."})

    # Añadir los realmente nuevos
    db.session.bulk_save_objects(new_email_objects)
    
    try:
        db.session.commit()
        current_app.logger.info(f"{actually_added_count} nuevos correos añadidos para sub-user {sub_id} (después de filtros).")
        # Incluir información sobre filtrados si aplica
        response_data = {"status":"ok", "added_count": actually_added_count}
        if 'filtered_out_count' in locals() and filtered_out_count > 0:
            response_data["message"] = f"{filtered_out_count} correos ignorados (no permitidos por el padre)."
        return jsonify(response_data)
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error en bulk insert para añadir correos a sub-user {sub_id}: {e}")
        return jsonify({"status":"error","message":"Error al guardar los nuevos correos."}), 500

@subuser_bp.route("/list_subuser_emails_paginated", methods=["GET"])
def list_subuser_emails_paginated():
    """
    Devuelve una lista paginada de correos permitidos para un sub-usuario.
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403
        
    sub_id = request.args.get("sub_id", type=int)
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 30, type=int)

    if not sub_id:
        return jsonify({"status":"error","message":"Falta sub_id."}), 400

    sub_user = User.query.get_or_404(sub_id)

    # Validar pertenencia si no es admin
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    if current_username != admin_username:
        parent_id = session.get("user_id")
        if sub_user.parent_id != parent_id:
            return jsonify({"status":"error","message":"No existe o no te pertenece"}),403
            
    # Validar per_page, si se pide "Todos", usar un número muy grande
    if per_page == -1: # Usamos -1 para indicar "Todos"
        per_page = sub_user.allowed_email_entries.count() + 1
        if per_page == 1: per_page = 10

    # Consulta paginada
    pagination = sub_user.allowed_email_entries.order_by(AllowedEmail.email.asc()).paginate(
        page=page, per_page=per_page, error_out=False
    )

    emails_data = [ae.email for ae in pagination.items]
    
    return jsonify({
        "status": "ok",
        "emails": emails_data,
        "pagination": {
            "page": pagination.page,
            "per_page": pagination.per_page if per_page > 0 else -1,
            "total_pages": pagination.pages,
            "total_items": pagination.total,
            "has_prev": pagination.has_prev,
            "has_next": pagination.has_next
        }
    })

@subuser_bp.route("/delete_all_allowed_emails_ajax", methods=["POST"])
def delete_all_allowed_emails_ajax():
    """
    Elimina TODOS los correos permitidos para un sub-usuario específico.
    """
    if not can_access_subusers():
        return jsonify({"status":"error","message":"No autorizado"}),403
        
    data = request.get_json()
    sub_id = data.get("sub_id")

    if not sub_id:
        return jsonify({"status":"error","message":"Falta sub_id."}), 400

    sub_user = User.query.get_or_404(sub_id)

    # Validar pertenencia si no es admin
    admin_username = current_app.config.get("ADMIN_USER","admin")
    current_username = session.get("username")
    if current_username != admin_username:
        parent_id = session.get("user_id")
        if sub_user.parent_id != parent_id:
            return jsonify({"status":"error","message":"No existe o no te pertenece"}),403
    
    try:
        deleted_count = AllowedEmail.query.filter_by(user_id=sub_id).delete()
        db.session.commit()
        current_app.logger.info(f"TODOS ({deleted_count}) los correos permitidos eliminados para sub-user {sub_id}.")
        return jsonify({"status":"ok", "deleted_count": deleted_count})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar TODOS los correos para sub-user {sub_id}: {e}")
        return jsonify({"status":"error","message":"Error interno al eliminar todos los correos."}), 500

@subuser_bp.route("/update_subuser_emails_ajax", methods=["POST"])
def update_subuser_emails_ajax():
    """
    Actualiza los correos permitidos para un sub-usuario específico.
    Recibe el subuser_id y una lista de emails seleccionados.
    Reemplaza completamente los correos asignados anteriores por los nuevos.
    Valida que los correos seleccionados estén permitidos para el padre.
    """
    if not can_access_subusers():
        return jsonify({"status": "error", "message": "No autorizado"}), 403

    data = request.get_json()
    subuser_id = data.get("subuser_id")
    selected_emails = data.get("selected_emails", []) # Lista de strings de correos

    if subuser_id is None or not isinstance(selected_emails, list):
        return jsonify({"status": "error", "message": "Datos inválidos (subuser_id o selected_emails)."}), 400

    sub_user = User.query.get(subuser_id) # Usar get en lugar de get_or_404 para mensaje personalizado
    if not sub_user:
         return jsonify({"status": "error", "message": "Sub-usuario no encontrado."}), 404

    # --- Validación de Pertenencia y Padre ---
    admin_username = current_app.config.get("ADMIN_USER", "admin")
    current_username = session.get("username")
    parent_user = None

    if not sub_user.parent_id:
         # Esto no debería ocurrir si el sub-usuario se creó correctamente
         current_app.logger.error(f"Sub-usuario {subuser_id} no tiene parent_id.")
         return jsonify({"status":"error", "message":"Error interno: Sub-usuario sin padre."}), 500

    if current_username != admin_username:
        parent_id_session = session.get("user_id")
        if sub_user.parent_id != parent_id_session:
            return jsonify({"status":"error","message":"No tienes permiso para modificar este sub-usuario."}), 403
        parent_user = User.query.get(parent_id_session)
        if not parent_user:
             # El padre debería existir si la sesión es válida, pero comprobamos
             session.clear()
             return jsonify({"status":"error","message":"Error de sesión, usuario padre no encontrado."}), 500
    else:
        # Si es admin, necesitamos obtener el padre del sub-usuario para validar correos
        parent_user = User.query.get(sub_user.parent_id)
        if not parent_user:
             current_app.logger.error(f"Admin intentando modificar correos de sub-usuario {subuser_id} cuyo padre {sub_user.parent_id} no existe.")
             return jsonify({"status":"error","message":"Error interno: Padre del sub-usuario no encontrado."}), 500
    # --- Fin Validación ---
    
    # --- Validación de Correos contra el Padre ---
    # Obtener los correos permitidos para el padre en un Set para eficiencia
    parent_allowed_emails_set = {ae.email for ae in parent_user.allowed_email_entries.all()}
    
    final_emails_to_save = []
    invalid_emails_found = []
    # Normalizar y validar cada correo seleccionado
    normalized_selected_emails = {email.strip().lower() for email in selected_emails if isinstance(email, str) and email.strip()}

    for email in normalized_selected_emails:
        if email in parent_allowed_emails_set:
            final_emails_to_save.append(email)
        else:
            invalid_emails_found.append(email)
    
    if invalid_emails_found:
        current_app.logger.warning(f"Usuario {current_username} intentó asignar correos no permitidos ({invalid_emails_found}) al sub-usuario {subuser_id}. Serán ignorados.")
        # Podríamos devolver un error aquí, o simplemente ignorarlos y guardar los válidos.
        # Por ahora, los ignoramos.

    # --- Actualización en Base de Datos ---    
    try:
        # 1. Eliminar TODOS los correos previamente asignados a este sub-usuario
        # Usamos delete() directamente para eficiencia, no necesitamos los objetos
        AllowedEmail.query.filter_by(user_id=subuser_id).delete(synchronize_session=False)
        
        # 2. Crear los nuevos objetos AllowedEmail para los correos válidos
        new_email_objects = []
        if final_emails_to_save:
            for email in sorted(list(set(final_emails_to_save))): # Asegurar unicidad y orden
                 new_email_objects.append(AllowedEmail(user_id=subuser_id, email=email))
            
            # 3. Guardar los nuevos objetos en bloque
            db.session.bulk_save_objects(new_email_objects)

        # 4. Commit de la transacción
        db.session.commit()
        current_app.logger.info(f"Correos actualizados para sub-usuario {subuser_id} por {current_username}. {len(final_emails_to_save)} guardados, {len(invalid_emails_found)} ignorados.")
        return jsonify({"status": "ok", "message": "Correos actualizados correctamente."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al actualizar correos para sub-usuario {subuser_id}: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno al guardar los correos."}), 500

# --- Función Auxiliar para obtener y formatear sub-usuarios --- 
def _get_subusers_data(parent_id):
    """Consulta y formatea la lista de sub-usuarios de un padre específico."""
    sub_q = User.query.filter_by(parent_id=parent_id)
    # Aquí podrías añadir un order_by si los sub-usuarios tienen un campo de orden
    # sub_q = sub_q.order_by(User.username.asc()) 
    all_subs = sub_q.all()
    data_resp = []
    for su in all_subs:
        data_resp.append({
            "id": su.id,
            "username": su.username,
            "enabled": su.enabled
            # Añadir más campos si son necesarios en la respuesta JSON
        })
    return data_resp
# --- Fin Función Auxiliar ---
