# app/admin/admin_users.py

from flask import (
    request, jsonify, render_template, redirect,
    url_for, flash, current_app, session
)
import re
from werkzeug.security import generate_password_hash
from app.extensions import db
from app.models import User
from app.models.filters import FilterModel, RegexModel
from app.models.service import ServiceModel
from app.admin.decorators import admin_required
from .admin_bp import admin_bp
from app.models import RememberDevice
from app.helpers import increment_global_session_revocation_count
import logging
from werkzeug.exceptions import BadRequest
from app.models.user import AllowedEmail
from sqlalchemy.exc import IntegrityError # Para capturar errores de unicidad
from sqlalchemy import or_ # Importar 'or_'

# --- Función Auxiliar para obtener y formatear usuarios principales ---
def _get_principal_users_data(admin_username):
    """Consulta y formatea la lista de usuarios principales para respuesta JSON."""
    user_q = User.query.filter(User.parent_id.is_(None)).filter(User.username != admin_username)
    user_q = user_q.order_by(User.position.asc())
    all_users = user_q.all()
    data_resp = []
    for usr in all_users:
        data_resp.append({
            "id": usr.id,
            "username": usr.username,
            "enabled": usr.enabled,
            "color": usr.color, # Solo el color original
            "position": usr.position,
            "can_search_any": usr.can_search_any,
            "can_create_subusers": usr.can_create_subusers,
            "can_add_own_emails": usr.can_add_own_emails,
            "parent_id": usr.parent_id if usr.parent_id else None,
            "full_name": usr.full_name or "",
            "phone": usr.phone or "",
            "email": usr.email or ""
        })
    return data_resp
# --- Fin Función Auxiliar ---

@admin_bp.route("/usuarios", methods=["GET"])
@admin_required
def usuarios_page():
    """
    Muestra la plantilla usuarios.html, donde se listan
    únicamente usuarios principales (parent_id IS NULL),
    excluyendo además al usuario admin.
    """
    return render_template("usuarios.html")


@admin_bp.route("/search_users_ajax", methods=["GET"])
@admin_required
def search_users_ajax():
    """
    Devuelve en JSON la lista de usuarios PRINCIPALES (no sub-usuarios),
    excluyendo además al usuario administrador.
    """
    query = request.args.get("query", "").strip().lower()
    user_q = User.query

    # Excluir sub-usuarios => parent_id IS NULL
    user_q = user_q.filter(User.parent_id.is_(None))

    # Excluir admin
    admin_username = current_app.config.get("ADMIN_USER", "admin")
    user_q = user_q.filter(User.username != admin_username)

    if query:
        user_q = user_q.filter(User.username.ilike(f"%{query}%"))

    # Se asume que el modelo User tiene un campo 'position'
    # (Si no existe, eliminar .order_by(User.position.asc()))
    user_q = user_q.order_by(User.position.asc())
    all_users = user_q.all()

    data = []
    for u in all_users:
        # Buscar el rol al que está vinculado el usuario (si existe)
        rol_actual = None
        rol_nombre = None
        if hasattr(u, 'roles_tienda') and u.roles_tienda:
            rol_actual = u.roles_tienda[0].id  # Suponiendo que solo puede estar en un rol
            rol_nombre = u.roles_tienda[0].name
        data.append({
            "id": u.id,
            "username": u.username,
            "enabled": u.enabled,
            "color": u.color,
            "position": u.position,
            "can_search_any": u.can_search_any,
            "can_create_subusers": u.can_create_subusers,
            "can_add_own_emails": u.can_add_own_emails,
            "parent_id": u.parent_id if u.parent_id else None,
            "full_name": u.full_name or "",
            "phone": u.phone or "",
            "email": u.email or "",
            "rol_actual": rol_actual,
            "rol_nombre": rol_nombre
        })
    return jsonify({"status": "ok", "users": data}), 200


@admin_bp.route("/create_user_ajax", methods=["POST"])
@admin_required
def create_user_ajax():
    """
    Crea un usuario principal (no sub-usuario).
    """
    try:

        data = request.get_json()
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()
        color = data.get("color", "#ffffff").strip() or "#ffffff"
        position = data.get("position", 1)
        can_search_any = data.get("can_search_any", False)
        full_name = data.get("full_name", "").strip()
        phone = data.get("phone", "").strip()
        email = data.get("email", "").strip()
        if not email:
            email = None

        # Validar email si se proporciona
        if email:
            if '@' not in email or '.' not in email:
                return jsonify({"status": "error", "message": "El correo electrónico debe contener '@' y '.'"}), 400

        # Validar teléfono si se proporciona
        if phone:
            if not phone.startswith('+'):
                return jsonify({"status": "error", "message": "El teléfono debe comenzar con '+' e incluir el indicativo de país."}), 400

        if not username or not password:
            return jsonify({"status": "error", "message": "Usuario y contraseña son obligatorios."}), 400

        # Evitar que el nuevo usuario sea el admin
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if username == admin_username:
            return jsonify({"status": "error", "message": "No puedes usar ese usuario."}), 403

        existing_user = User.query.filter_by(username=username).first()
        if existing_user:
            return jsonify({"status": "error", "message": f"El usuario '{username}' ya existe."}), 400

        # Validar si el email ya existe
        if email:
            existing_email = User.query.filter_by(email=email).first()
            if existing_email:
                return jsonify({"status": "error", "message": f"El correo electrónico '{email}' ya está registrado por otro usuario."}), 400

        hashed_pass = generate_password_hash(password)
        try:
            position = int(position)
        except ValueError:
            position = 1


        new_user = User(
            username=username,
            password=hashed_pass,
            color=color,
            position=position,
            enabled=True,
            parent_id=None,
            full_name=full_name,
            phone=phone,
            email=email,
            can_add_own_emails=False  # Por defecto desactivado
        )
        # Asignar can_search_any después de crear el objeto (como lo teníamos)
        new_user.can_search_any = bool(can_search_any)
        
        db.session.add(new_user)

        
        # ¡Importante! Flush para obtener el ID del new_user si fuera necesario
        # para relaciones complejas, aunque aquí append debería funcionar sin él.
        # db.session.flush() 


        # ===== Asignar TODOS los filtros y regex existentes =====

        all_filters = FilterModel.query.all()
        all_regexes = RegexModel.query.all()

        for f in all_filters:
            new_user.filters_allowed.append(f)
        for r in all_regexes:
            new_user.regexes_allowed.append(r)


        # ===== Asignar TODOS los servicios existentes =====

        all_services = ServiceModel.query.all()
        for s in all_services:
            new_user.services_allowed.append(s)


        # Commit único para todas las operaciones (crear usuario, añadir relaciones)
        db.session.commit()

        # Respuesta con lista actualizada de usuarios usando la función auxiliar
        updated_users = _get_principal_users_data(admin_username)
        return jsonify({"status": "ok", "users": updated_users}), 200

    except Exception as e:
        current_app.logger.error(f"Error crítico al crear usuario ajax: {e}", exc_info=True)
        db.session.rollback()
        return jsonify({"status": "error", "message": f"Error interno del servidor: {str(e)}"}), 500


@admin_bp.route("/toggle_user_ajax", methods=["POST"])
@admin_required
def toggle_user_ajax():
    """
    Activa/Desactiva un usuario principal.
    Si se desactiva un usuario principal => TODOS sus sub-usuarios también quedan OFF.
    Si se activa un usuario principal => Los sub-usuarios vuelven a su estado anterior.
    """
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        estado_anterior = data.get("currently_enabled", True)

        user = User.query.get_or_404(user_id)
        admin_username = current_app.config.get("ADMIN_USER", "admin")

        if user.username == admin_username:
            return jsonify({"status":"error","message":"No se puede cambiar el estado del usuario admin."}),403

        if user.parent_id is not None:
            return jsonify({"status":"error","message":"Esta operación solo aplica a usuarios principales."}),403

        # Determinar el nuevo estado
        nuevo_estado = not estado_anterior

        
        # 1. Modificar estado del usuario principal en la sesión
        user.enabled = nuevo_estado
        # db.session.commit() # <--- ELIMINAR COMMIT INTERMEDIO

        # --- Manejo de Sub-usuarios (Modificaciones en sesión) ---
        needs_commit = True # Asumimos que siempre hay que hacer commit (al menos por el padre)

        # Si el usuario principal está siendo ACTIVADO
        if user.enabled and not estado_anterior:

            subusers = User.query.filter_by(parent_id=user.id).all()
            for subuser in subusers:
                if subuser.was_enabled:

                    subuser.enabled = True
                    subuser.was_enabled = None
                elif subuser.was_enabled is False:
                    subuser.was_enabled = None
            # db.session.commit() # <--- ELIMINAR COMMIT INTERMEDIO

        # Si el usuario principal está siendo DESACTIVADO
        elif not user.enabled and estado_anterior:

            subusers = User.query.filter_by(parent_id=user.id).all()
            for subuser in subusers:
                estado_actual_sub = subuser.enabled

                subuser.was_enabled = estado_actual_sub

                if estado_actual_sub:

                    subuser.enabled = False
                    # Limpieza de sesión/token para sub-usuario
                    # Nota: RememberDevice se elimina automáticamente por CASCADE al eliminar el usuario
                    # Solo invalidamos la sesión incrementando el contador
                    subuser.user_session_rev_count += 1
                elif subuser.was_enabled is None:
                    subuser.was_enabled = False
            # db.session.commit() # <--- ELIMINAR COMMIT INTERMEDIO
            
        # 2. Commit único para todos los cambios (padre, hijos, tokens, contadores)
        db.session.commit()

        # --- Respuesta con lista actualizada --- 
        # admin_username ya está definido arriba
        updated_users = _get_principal_users_data(admin_username)
        return jsonify({"status":"ok","users":updated_users}), 200

    except Exception as e:
        current_app.logger.error(f"Error en toggle_user_ajax: {e}", exc_info=True)
        db.session.rollback()
        return jsonify({"status":"error","message":f"Error interno del servidor: {str(e)}"}), 500


@admin_bp.route("/delete_user_ajax", methods=["POST"])
@admin_required
def delete_user_ajax():
    """
    Elimina un usuario principal y sus sub-usuarios (si existen).
    Retorna la lista de usuarios actualizada.
    """
    try:
        data = request.get_json()

        if data is None:
            return jsonify({"status":"error","message":"Invalid request format (expected JSON)."}), 400

        user_id = data.get("user_id")

        if user_id is None:
             return jsonify({"status": "error", "message": "Falta el ID del usuario en la solicitud."}), 400

        user = User.query.get_or_404(user_id)
        admin_username = current_app.config.get("ADMIN_USER", "admin")

        if user.username == admin_username:
            return jsonify({"status":"error","message":"No puedes eliminar el usuario admin."}),403

        if user.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        # 1) Buscamos y eliminamos sub-usuarios primero (se eliminarán en cascada sus RememberDevice, AllowedEmail, etc.)
        # Nota: RememberDevice se elimina automáticamente por CASCADE (ondelete='CASCADE')
        subusers = User.query.filter_by(parent_id=user.id).all()
        for subuser in subusers:
            # Eliminar el registro del sub-usuario (CASCADE eliminará automáticamente):
            # - RememberDevice (ondelete='CASCADE')
            # - AllowedEmail (ondelete='CASCADE')
            # - Relaciones M2M (user_regex, user_filter, user_service, etc.)
            # - ChatSession, ChatMessage (ondelete='CASCADE')
            # - TriggerLog (ondelete='CASCADE')
            # - Y todas las demás relaciones con CASCADE
            db.session.delete(subuser)
        
        # 2) Eliminamos al usuario principal
        # CASCADE eliminará automáticamente:
        # - RememberDevice (ondelete='CASCADE')
        # - AllowedEmail (cascade="all, delete-orphan")
        # - Sub-usuarios (ya eliminados arriba, pero CASCADE también lo haría)
        # - Relaciones M2M (user_regex, user_filter, user_service, codigos2_users, role_users, etc.)
        # - ChatSession, ChatMessage (ondelete='CASCADE')
        # - TriggerLog (ondelete='CASCADE')
        # - Sale (ondelete='CASCADE')
        # - Y todas las demás relaciones con CASCADE
        db.session.delete(user)
        
        # 4) Commit final para todas las eliminaciones
        db.session.commit()

        # Actualizar la lista final usando la función auxiliar
        updated_users = _get_principal_users_data(admin_username)
        return jsonify({"status":"ok","users":updated_users}),200

    except Exception as e:
        # Verificar si la excepción es de tipo BadRequest (puede venir de get_json)
        if isinstance(e, BadRequest):
             current_app.logger.error(f"Error 400 al procesar JSON en delete_user_ajax: {e}", exc_info=True)
             return jsonify({"status": "error", "message": f"Error al procesar la solicitud JSON: {str(e)}"}), 400
        
        current_app.logger.error(f"Error crítico al eliminar usuario ajax: {e}", exc_info=True)
        db.session.rollback()
        return jsonify({"status": "error", "message": f"Error interno del servidor: {str(e)}"}), 500


@admin_bp.route("/update_user_ajax", methods=["POST"])
@admin_required
def update_user_ajax():
    """
    Actualiza datos de un usuario principal (no sub-usuario).
    Retorna la lista de usuarios actualizada.
    (Renombrada variable 'u' a 'user_to_update')
    """
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        # Solo extraer los campos que realmente se usan, ignorar el resto
        new_username = data.get("username", "").strip() if "username" in data else None
        new_password = data.get("password", "").strip() if "password" in data else None
        new_color = data.get("color", "#ffffff").strip() if "color" in data else "#ffffff"
        new_position = data.get("position", 1) if "position" in data else 1
        can_search_any = data.get("can_search_any", False) if "can_search_any" in data else False
        new_can_create_subusers = data.get("can_create_subusers", False) if "can_create_subusers" in data else False
        new_can_add_own_emails = data.get("can_add_own_emails", False) if "can_add_own_emails" in data else False
        new_full_name = data.get("full_name", "").strip() if "full_name" in data else ""
        new_phone = data.get("phone", "").strip() if "phone" in data else ""
        new_email = data.get("email", None)
        if new_email is not None:
            new_email = new_email.strip()
            if new_email == "":
                new_email = None

        # Validar email si se proporciona
        if new_email:
            if '@' not in new_email or '.' not in new_email:
                return jsonify({"status": "error", "message": "El correo electrónico debe contener '@' y '.'"}), 400

        # Validar teléfono si se proporciona
        if new_phone:
            if not new_phone.startswith('+'):
                return jsonify({"status": "error", "message": "El teléfono debe comenzar con '+' e incluir el indicativo de país."}), 400

        user_to_update = User.query.get_or_404(user_id)

        # Evitar cambiar al nombre del admin
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if new_username and new_username != user_to_update.username and new_username == admin_username:
            return jsonify({"status":"error","message":"No puedes usar el nombre del admin."}),403

        # Evitar si nuevo username ya existe
        if new_username and new_username != user_to_update.username:
            existing = User.query.filter_by(username=new_username).first()
            if existing:
                return jsonify({"status":"error","message":f"El usuario '{new_username}' ya existe."}),400

        # Validar si el nuevo email ya existe (excluyendo el usuario actual)
        if new_email and new_email != user_to_update.email:
            existing_email = User.query.filter_by(email=new_email).first()
            if existing_email:
                return jsonify({"status":"error","message":f"El correo electrónico '{new_email}' ya está registrado por otro usuario."}),400

        # Actualizar datos solo si están presentes
        if new_username is not None:
            user_to_update.username = new_username
        if new_color is not None:
            user_to_update.color = new_color
        try:
            user_to_update.position = int(new_position)
        except (ValueError, TypeError):
            user_to_update.position = 1
        user_to_update.can_search_any = bool(can_search_any)
        if new_full_name is not None:
            user_to_update.full_name = new_full_name
        if new_phone is not None:
            user_to_update.phone = new_phone
        if new_email is not None:
            user_to_update.email = new_email

        if new_password:
            hashed_pass = generate_password_hash(new_password)
            user_to_update.password = hashed_pass

        # Manejo de can_create_subusers
        old_can_sub = user_to_update.can_create_subusers
        new_can_sub = bool(new_can_create_subusers)
        user_to_update.can_create_subusers = new_can_sub
        
        # Manejo de can_add_own_emails
        user_to_update.can_add_own_emails = bool(new_can_add_own_emails)

        # --- INICIO: Lógica de Inicialización/Limpieza de Defaults ---
        if not old_can_sub and new_can_sub:
            allowed_regexes = user_to_update.regexes_allowed
            user_to_update.default_regexes_for_subusers = list(allowed_regexes)
            allowed_filters = user_to_update.filters_allowed
            user_to_update.default_filters_for_subusers = list(allowed_filters)
        elif old_can_sub and not new_can_sub:
            user_to_update.default_regexes_for_subusers = []
            user_to_update.default_filters_for_subusers = []
            subusers = User.query.filter_by(parent_id=user_to_update.id).all()
            for su in subusers:
                # Nota: RememberDevice se elimina automáticamente por CASCADE (ondelete='CASCADE')
                # Solo necesitamos eliminar el sub-usuario
                db.session.delete(su)
        # --- FIN: Lógica de Inicialización/Limpieza --- 
        db.session.commit()
        updated_users = _get_principal_users_data(admin_username)
        return jsonify({"status":"ok","users":updated_users}), 200

    except Exception as e:
        # Restaurar manejo de excepción con rollback
        db.session.rollback()
        current_app.logger.error(f"Error crítico al actualizar usuario ajax: {e}", exc_info=True)
        return jsonify({"status":"error","message":f"Error interno del servidor: {str(e)}"}),500


@admin_bp.route("/check_email_exists", methods=["GET"])
@admin_required
def check_email_exists():
    """
    Verifica si un email ya existe en la base de datos.
    """
    try:
        email = request.args.get("email", "").strip()
        if not email:
            return jsonify({"exists": False}), 200
        
        existing_user = User.query.filter_by(email=email).first()
        return jsonify({"exists": existing_user is not None}), 200
        
    except Exception as e:
        current_app.logger.error(f"Error al verificar email: {e}", exc_info=True)
        return jsonify({"exists": False, "error": "Error interno del servidor"}), 500


# ================== Emails permitidos (versión principal) ==================
@admin_bp.route("/user_emails/<int:user_id>", methods=["GET", "POST"])
@admin_required
def user_emails_page(user_id):
    """
    Muestra y gestiona los correos permitidos para un usuario principal.
    Utiliza la nueva tabla AllowedEmail.
    """
    user = User.query.get_or_404(user_id)
    if user.parent_id is not None: # No es usuario principal
        flash("Esta opción solo es para usuarios principales.", "warning")
        return redirect(url_for("admin_bp.usuarios_page"))

    if request.method == "POST":
        raw_text = request.form.get("allowed_emails_text", "").strip()
        # Limpiar correos existentes para este usuario
        AllowedEmail.query.filter_by(user_id=user.id).delete()
        
        lines = [x.strip().lower() for x in re.split(r"[,\n\r\s]+", raw_text) if x.strip()]
        unique_emails = sorted(list(set(lines)))
        
        new_email_objects = []
        for email in unique_emails:
            if email: # Asegurarse de no añadir emails vacíos
                new_email_objects.append(AllowedEmail(user_id=user.id, email=email))
        
        if new_email_objects:
            db.session.bulk_save_objects(new_email_objects)
            
        try:
            db.session.commit()
            flash(f"Correos permitidos para {user.username} actualizados.", "success")
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error al guardar correos para user {user.id}: {e}")
            flash("Error al guardar correos.", "danger")
            
        # Redirigir a GET para mostrar los cambios
        return redirect(url_for("admin_bp.user_emails_page", user_id=user.id))

    # --- Método GET ---
    # Obtener correos de la nueva tabla y formatear para el textarea
    try:
        # Obtener la lista de correos permitidos desde la relación
        allowed_emails_list = [entry.email for entry in user.allowed_email_entries.all()]
        # Unirlos en una cadena multilínea
        multiline = "\n".join(allowed_emails_list)
    except AttributeError:
        # Manejo de error por si acaso, aunque el error original era diferente
        current_app.logger.error(f"Error al acceder a allowed_email_entries para el usuario {user_id}", exc_info=True)
        multiline = ""
    
    return render_template("email.html", user=user, allowed_emails_text=multiline)


@admin_bp.route("/search_allowed_emails_ajax", methods=["POST"])
@admin_required
def search_allowed_emails_ajax():
    """
    Busca correos dentro de AllowedEmail de un usuario principal,
    aceptando múltiples términos de búsqueda separados por comas/espacios/newlines.
    """
    data = request.get_json()
    user_id = data.get("user_id")
    # Cambiar 'term' por 'search_text' para recibir el texto crudo
    search_text = data.get("search_text", "").strip()

    user = User.query.get_or_404(user_id)
    if user.parent_id is not None: 
        return jsonify({"status": "error", "message": "Usuario no es principal"}), 403

    # Procesar el texto de búsqueda para obtener una lista de términos no vacíos
    search_terms = [t.lower() for t in re.split(r"[,\n\r\s]+", search_text) if t.strip()]

    if not search_terms:
        # Si no hay términos de búsqueda válidos, devolver vacío o todos?
        # Devolver vacío parece más apropiado para una búsqueda.
        email_query = user.allowed_email_entries.filter(db.false()).order_by(AllowedEmail.email.asc()) 
    else:
        # Construir una condición OR con ILIKE para cada término
        conditions = []
        for term in search_terms:
            conditions.append(AllowedEmail.email.ilike(f"%{term}%"))
        # Aplicar el filtro OR a la consulta
        email_query = user.allowed_email_entries.filter(or_(*conditions)).order_by(AllowedEmail.email.asc())
        
    found_emails = [ae.email for ae in email_query.all()]
    
    return jsonify({"status": "ok", "emails": found_emails})


@admin_bp.route("/delete_allowed_email_ajax", methods=["POST"])
@admin_required
def delete_allowed_email_ajax():
    """
    Elimina un correo específico de AllowedEmail de un usuario principal
    Y TAMBIÉN lo elimina de todos sus sub-usuarios.
    """
    data = request.get_json()
    user_id = data.get("user_id")
    email_to_delete = data.get("email", "").strip().lower()

    if not user_id or not email_to_delete:
        return jsonify({"status":"error","message":"Faltan datos (user_id o email)."}), 400

    user = User.query.get_or_404(user_id)
    if user.parent_id is not None:
        return jsonify({"status": "error", "message": "Usuario no es principal"}), 403

    # --- INICIO: Lógica Añadida para Sub-usuarios ---
    # Obtener IDs de los sub-usuarios usando el backref correcto
    subuser_ids = [sub.id for sub in user.subusers] # CORREGIDO: Usar subusers
    # --- FIN: Lógica Añadida ---

    # Eliminar del padre
    deleted_count_parent = AllowedEmail.query.filter_by(user_id=user_id, email=email_to_delete).delete()

    # --- INICIO: Eliminar de Sub-usuarios ---
    deleted_count_subusers = 0
    if subuser_ids:
        # Usar filter() y '==' para comparación exacta de email
        deleted_count_subusers = AllowedEmail.query.filter(
            AllowedEmail.user_id.in_(subuser_ids),
            AllowedEmail.email == email_to_delete
        ).delete(synchronize_session=False)
    # --- FIN: Eliminar de Sub-usuarios ---

    try:
        db.session.commit()
        log_message = ""
        if deleted_count_parent > 0:
             log_message += f"Correo '{email_to_delete}' eliminado para user {user_id} (padre)."
        # Loguear eliminación de subusuarios solo si ocurrió
        if deleted_count_subusers > 0:
             log_message += f" Y de {deleted_count_subusers} sub-usuarios."
        


        # Devolver OK si se eliminó del padre o si se limpió de hijos (incluso si ya no estaba en el padre)
        # El estado final es el deseado: el correo no está asociado.
        if deleted_count_parent > 0 or deleted_count_subusers > 0:
             return jsonify({"status":"ok"})
        else:
             # Si no se encontró en el padre ni en hijos, informar pero devolver OK
             return jsonify({"status":"ok", "message":"Correo no encontrado."}) 

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar correo '{email_to_delete}' para user {user_id} y/o sus sub-usuarios: {e}", exc_info=True)
        return jsonify({"status":"error","message":"Error al eliminar correo."}), 500


@admin_bp.route("/delete_many_emails_ajax", methods=["POST"])
@admin_required
def delete_many_emails_ajax():
    """
    Elimina varios correos a la vez de AllowedEmail de un usuario principal
    Y TAMBIÉN los elimina de todos sus sub-usuarios.
    """
    data = request.get_json()
    user_id = data.get("user_id")
    emails_to_delete = data.get("emails", [])

    if not user_id or not emails_to_delete:
        return jsonify({"status":"error","message":"Faltan datos (user_id o lista de emails)."}), 400
        
    user = User.query.get_or_404(user_id)
    if user.parent_id is not None: 
        return jsonify({"status": "error", "message": "Usuario no es principal"}), 403

    # Normalizar emails a eliminar
    normalized_emails = [e.strip().lower() for e in emails_to_delete if isinstance(e, str) and e.strip()]
    if not normalized_emails:
        return jsonify({"status":"ok", "message":"No emails validos para eliminar."})
        
    # --- Obtener IDs de sub-usuarios ---    
    subuser_ids = [sub.id for sub in user.subusers] # CORREGIDO: Usar subusers
    # -----------------------------------

    # Eliminar del padre usando un IN clause
    deleted_count_parent = 0
    if normalized_emails: # Solo ejecutar si hay emails que borrar
        deleted_count_parent = AllowedEmail.query.filter(
            AllowedEmail.user_id == user_id,
            AllowedEmail.email.in_(normalized_emails)
        ).delete(synchronize_session=False)
    
    # Eliminar de sub-usuarios usando IN clause
    deleted_count_subusers = 0
    if subuser_ids and normalized_emails:
        deleted_count_subusers = AllowedEmail.query.filter(
            AllowedEmail.user_id.in_(subuser_ids),
            AllowedEmail.email.in_(normalized_emails)
        ).delete(synchronize_session=False)

    try:
        db.session.commit()
        log_message = ""
        if deleted_count_parent > 0:
             log_message += f"{deleted_count_parent} correos eliminados para user {user_id} (padre)."
        if deleted_count_subusers > 0:
             log_message += f" Y de {deleted_count_subusers} instancias en sub-usuarios."
             
                # Devolver OK siempre que la operación se complete sin excepción,
        # incluso si no se borró nada (porque ya no existían).
        return jsonify({"status":"ok"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar multiples correos para user {user_id} y/o sus sub-usuarios: {e}", exc_info=True)
        return jsonify({"status":"error","message":"Error al eliminar correos."}), 500


@admin_bp.route("/delete_emails_from_all_users_ajax", methods=["POST"])
@admin_required
def delete_emails_from_all_users_ajax():
    """
    Elimina correos masivamente de TODOS los usuarios que los tengan vinculados.
    Similar a la funcionalidad de búsqueda y eliminación en la plantilla email,
    pero elimina el correo de todos los usuarios de una vez.
    """
    data = request.get_json()
    emails_to_delete = data.get("emails", [])

    if not emails_to_delete:
        return jsonify({"status":"error","message":"Faltan datos (lista de emails)."}), 400

    # Normalizar emails a eliminar
    normalized_emails = [e.strip().lower() for e in emails_to_delete if isinstance(e, str) and e.strip()]
    if not normalized_emails:
        return jsonify({"status":"ok", "message":"No emails validos para eliminar."})

    try:
        # Eliminar de TODOS los usuarios (principales y sub-usuarios) usando IN clause
        deleted_count = AllowedEmail.query.filter(
            AllowedEmail.email.in_(normalized_emails)
        ).delete(synchronize_session=False)

        db.session.commit()

        return jsonify({
            "status":"ok",
            "message":f"Se eliminaron {deleted_count} instancia(s) de correo(s) de todos los usuarios.",
            "deleted_count": deleted_count
        })

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar correos masivamente de todos los usuarios: {e}", exc_info=True)
        return jsonify({"status":"error","message":"Error al eliminar correos."}), 500


@admin_bp.route("/add_allowed_emails_ajax", methods=["POST"])
@admin_required
def add_allowed_emails_ajax():
    """
    Añade una lista de nuevos correos permitidos para un usuario principal.
    Evita añadir duplicados si ya existen para ESE usuario.
    """
    data = request.get_json()
    user_id = data.get("user_id")
    emails_to_add = data.get("emails", [])

    if not user_id or not emails_to_add:
        return jsonify({"status":"error","message":"Faltan datos (user_id o lista de emails)."}), 400
        
    user = User.query.get_or_404(user_id)
    if user.parent_id is not None: 
        return jsonify({"status": "error", "message": "Usuario no es principal"}), 403

    # Normalizar y asegurar unicidad en la lista de entrada
    normalized_new_emails = list(set( # set para unicidad rápida
        e.strip().lower() 
        for e in emails_to_add if isinstance(e, str) and e.strip() and ('@' in e and '.' in e)
    ))
    
    if not normalized_new_emails:
        return jsonify({"status":"ok", "added_count": 0, "message":"No emails válidos para añadir."})

    # Obtener los emails que YA existen para este usuario para evitar IntegrityError
    existing_emails = {ae.email for ae in user.allowed_email_entries.filter(AllowedEmail.email.in_(normalized_new_emails)).all()}
    
    new_email_objects = []
    actually_added_count = 0
    for email in normalized_new_emails:
        if email not in existing_emails:
            new_email_objects.append(AllowedEmail(user_id=user_id, email=email))
            actually_added_count += 1
        else:
            pass
    if not new_email_objects:
        return jsonify({"status":"ok", "added_count": 0, "message":"Todos los correos proporcionados ya existían."}) 

    # Añadir los que realmente son nuevos
    db.session.bulk_save_objects(new_email_objects)
    
    try:
        db.session.commit()

        return jsonify({"status":"ok", "added_count": actually_added_count})
    except Exception as e: # Capturar otros posibles errores
        db.session.rollback()
        current_app.logger.error(f"Error en bulk insert para añadir correos a user {user_id}: {e}")
        return jsonify({"status":"error","message":"Error al guardar los nuevos correos."}), 500


@admin_bp.route("/delete_all_allowed_emails_ajax", methods=["POST"])
@admin_required
def delete_all_allowed_emails_ajax():
    """
    Elimina TODOS los correos permitidos para un usuario principal
    Y TAMBIÉN elimina TODOS los correos de sus sub-usuarios.
    """
    data = request.get_json()
    user_id = data.get("user_id")

    if not user_id:
        return jsonify({"status":"error","message":"Falta user_id."}), 400
        
    user = User.query.get_or_404(user_id)
    if user.parent_id is not None: 
        return jsonify({"status": "error", "message": "Usuario no es principal"}), 403

    # --- Obtener IDs de sub-usuarios ---    
    subuser_ids = [sub.id for sub in user.subusers] # CORREGIDO: Usar subusers
    # -----------------------------------

    try:
        # Eliminar del padre
        deleted_count_parent = AllowedEmail.query.filter_by(user_id=user_id).delete()
        
        # Eliminar de TODOS los sub-usuarios
        deleted_count_subusers = 0
        if subuser_ids:
            deleted_count_subusers = AllowedEmail.query.filter(
                AllowedEmail.user_id.in_(subuser_ids)
            ).delete(synchronize_session=False)
            
        db.session.commit()

        # Devolver el conteo del padre podría ser útil para el frontend
        return jsonify({"status":"ok", "deleted_count_parent": deleted_count_parent})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al eliminar TODOS los correos para user {user_id} y/o sus sub-usuarios: {e}", exc_info=True)
        return jsonify({"status":"error","message":"Error interno al eliminar todos los correos."}), 500


# ============ Manejo de Regex/Filter que el usuario principal puede usar ============
@admin_bp.route("/list_regex_ajax", methods=["GET"])
@admin_required
def list_regex_ajax():
    """
    Lista los regex globales, marcando cuáles tiene "allowed" un usuario principal.
    """
    try:
        user_id = request.args.get("user_id", type=int)
        if not user_id:
            return jsonify({"status":"error","message":"Falta user_id"}),400

        user = User.query.get_or_404(user_id)
        if user.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        all_rx = RegexModel.query.all()

        rx_data = []
        for r in all_rx:
            is_allowed = (r in user.regexes_allowed)
            rx_data.append({
                "id": r.id,
                "pattern": r.pattern,
                "description": r.description or "",
                "allowed": is_allowed
            })
        return jsonify({"status":"ok","regexes":rx_data}),200
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),400


@admin_bp.route("/list_filters_ajax", methods=["GET"])
@admin_required
def list_filters_ajax():
    """
    Lista los filtros globales, marcando cuáles tiene "allowed" un usuario principal.
    """
    try:
        user_id = request.args.get("user_id", type=int)
        if not user_id:
            return jsonify({"status":"error","message":"Falta user_id"}),400

        user = User.query.get_or_404(user_id)
        if user.parent_id is not None:
            return jsonify({"status":"error","message":"No es un usuario principal."}),403

        all_ft = FilterModel.query.all()

        ft_data = []
        for f in all_ft:
            is_allowed = (f in user.filters_allowed)
            ft_data.append({
                "id": f.id,
                "sender": f.sender or "",
                "keyword": f.keyword or "",
                "allowed": is_allowed
            })
        return jsonify({"status":"ok","filters":ft_data}),200
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}),400


@admin_bp.route("/update_user_rfs_ajax", methods=["POST"])
@admin_required
def update_user_rfs_ajax():
    """
    Actualiza los Regex/Filtros permitidos para un usuario principal.
    Y PROPAGA los cambios a sus sub-usuarios (quitando los que ya no permite el padre).
    Usa un solo commit al final.
    """
    data = request.get_json()
    user_id = data.get("user_id")
    rfs_type = data.get("type") # 'regex' o 'filter'
    allowed_ids = data.get("allowed_ids", [])

    if not user_id or rfs_type not in ["regex", "filter"]:
        return jsonify({"status":"error","message":"Faltan datos o tipo inválido."}), 400

    user = User.query.get_or_404(user_id)
    if user.parent_id is not None:
        return jsonify({"status":"error","message":"Solo aplica a usuarios principales."}), 403

    try:

        # Determinar el modelo y la relación a actualizar
        if rfs_type == "regex":
            model_class = RegexModel
            relationship_attr = "regexes_allowed"
        else:
            model_class = FilterModel
            relationship_attr = "filters_allowed"

        # Obtener la relación del usuario padre
        parent_relationship = getattr(user, relationship_attr)

        # 1. Obtener los NUEVOS objetos permitidos para el padre
        new_allowed_entities = model_class.query.filter(model_class.id.in_(allowed_ids)).all()
        # Convertir a set de IDs para comparación rápida
        new_allowed_ids_set = {entity.id for entity in new_allowed_entities}

        # 2. Actualizar relación del padre (limpiar y añadir los nuevos)
        # Es más eficiente trabajar directamente con la colección que clear/append
        parent_relationship[:] = new_allowed_entities


        # 3. PROPAGAR CAMBIOS A SUB-USUARIOS (SI ES PADRE)
        if user.subusers: # user.parent_id ya sabemos que es None por chequeo inicial

            for sub_user in user.subusers:
                # Aplicar la misma lista de permitidos del padre al hijo
                sub_relationship = getattr(sub_user, relationship_attr)
                sub_relationship[:] = new_allowed_entities
                
        # --- FIN PROPAGACIÓN --- 

        # 4. Invalidar sesión si es necesario (en sesión)
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if session.get("username") != admin_username:
            user.user_session_rev_count += 1


        # 5. Commit único para todos los cambios (padre y sub-usuarios)

        db.session.commit()


        return jsonify({"status":"ok"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al actualizar permisos '{rfs_type}' para user {user_id}: {e}", exc_info=True)
        return jsonify({"status":"error","message":"Error interno al actualizar permisos."}), 500


# ============ FIN Manejo Regex/Filter Usuario Principal ============

@admin_bp.route("/list_allowed_emails_paginated", methods=["GET"])
@admin_required
def list_allowed_emails_paginated():
    """
    Devuelve una lista paginada de correos permitidos para un usuario principal.
    """
    user_id = request.args.get("user_id", type=int)
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 30, type=int) # Default 30

    if not user_id:
        return jsonify({"status":"error","message":"Falta user_id."}), 400

    user = User.query.get_or_404(user_id)
    if user.parent_id is not None: 
        return jsonify({"status": "error", "message": "Usuario no es principal"}), 403

    # Validar per_page, si se pide "Todos", usar un número muy grande
    if per_page == -1: # Usamos -1 para indicar "Todos"
        per_page = user.allowed_email_entries.count() + 1 # +1 por si acaso
        if per_page == 1: per_page = 10 # Evitar per_page=0 o 1 si no hay emails
        
    # Consulta paginada
    pagination = user.allowed_email_entries.order_by(AllowedEmail.email.asc()).paginate(
        page=page, per_page=per_page, error_out=False
    )

    emails_data = [ae.email for ae in pagination.items]
    
    return jsonify({
        "status": "ok",
        "emails": emails_data,
        "pagination": {
            "page": pagination.page,
            "per_page": pagination.per_page if per_page > 0 else -1, # Devolver -1 si es "Todos"
            "total_pages": pagination.pages,
            "total_items": pagination.total,
            "has_prev": pagination.has_prev,
            "has_next": pagination.has_next
        }
    })
