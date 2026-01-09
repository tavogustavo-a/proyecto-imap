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
            "can_add_own_emails": usr.can_add_own_emails if usr.can_add_own_emails is not None else False,
            "can_bulk_delete_emails": usr.can_bulk_delete_emails if usr.can_bulk_delete_emails is not None else False,
            "can_manage_2fa_emails": usr.can_manage_2fa_emails if usr.can_manage_2fa_emails is not None else False,
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
        # Los roles ya no se usan, ahora se gestiona directamente con tipo_precio en user_prices
        # Verificar can_access_codigos2 desde la tabla codigos2_users también
        from app.models.codigos2_access import codigos2_users
        from sqlalchemy import select
        has_codigos2_access_table = db.session.execute(
            select(codigos2_users.c.user_id).where(codigos2_users.c.user_id == u.id)
        ).first() is not None
        
        # Combinar can_access_codigos2 del modelo con el estado de la tabla
        can_access_codigos2_value = u.can_access_codigos2 if u.can_access_codigos2 is not None else False
        can_access_codigos2_final = can_access_codigos2_value or has_codigos2_access_table
        
        # Obtener tipo_precio desde user_prices
        tipo_precio_rol = None
        if u.user_prices and isinstance(u.user_prices, dict):
            tipo_precio_raw = u.user_prices.get('tipo_precio')
            if tipo_precio_raw and tipo_precio_raw in ['USD', 'COP']:
                tipo_precio_rol = tipo_precio_raw.lower()
        
        data.append({
            "id": u.id,
            "username": u.username,
            "enabled": u.enabled,
            "color": u.color,
            "position": u.position,
            "can_search_any": u.can_search_any,
            "can_create_subusers": u.can_create_subusers,
            "can_add_own_emails": u.can_add_own_emails if u.can_add_own_emails is not None else False,
            "can_bulk_delete_emails": u.can_bulk_delete_emails if u.can_bulk_delete_emails is not None else False,
            "can_manage_2fa_emails": u.can_manage_2fa_emails if u.can_manage_2fa_emails is not None else False,
            "can_access_codigos2": can_access_codigos2_final,
            "can_chat": u.can_chat if u.can_chat is not None else False,
            "can_manage_subusers": u.can_manage_subusers if u.can_manage_subusers is not None else False,
            "is_support": u.is_support if u.is_support is not None else False,
            "parent_id": u.parent_id if u.parent_id else None,
            "full_name": u.full_name or "",
            "phone": u.phone or "",
            "email": u.email or "",
            "saldo_usd": u.saldo_usd or 0,
            "saldo_cop": u.saldo_cop or 0,
            "tipo_precio_rol": tipo_precio_rol
        })
        
        # Agregar datos de precios si existen
        if hasattr(u, 'user_prices') and u.user_prices:
            precio_data = u.user_prices
            data[-1]["precio_original_cop"] = precio_data.get("precio_original_cop", 0)
            data[-1]["precio_original_usd"] = precio_data.get("precio_original_usd", 0)
            data[-1]["descuento_cop"] = precio_data.get("descuento_cop", 0)
            data[-1]["descuento_usd"] = precio_data.get("descuento_usd", 0)
            data[-1]["tipo_precio"] = precio_data.get("tipo_precio")
        else:
            data[-1]["precio_original_cop"] = 0
            data[-1]["precio_original_usd"] = 0
            data[-1]["descuento_cop"] = 0
            data[-1]["descuento_usd"] = 0
            data[-1]["tipo_precio"] = None
            
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
            can_add_own_emails=False,  # Por defecto desactivado
            can_bulk_delete_emails=False,  # Por defecto desactivado
            can_manage_2fa_emails=False  # Por defecto desactivado
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
        new_can_bulk_delete_emails = data.get("can_bulk_delete_emails", False) if "can_bulk_delete_emails" in data else False
        new_can_manage_2fa_emails = data.get("can_manage_2fa_emails", False) if "can_manage_2fa_emails" in data else False
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
        
        # Manejo de can_bulk_delete_emails
        user_to_update.can_bulk_delete_emails = bool(new_can_bulk_delete_emails)
        
        # Manejo de can_manage_2fa_emails
        user_to_update.can_manage_2fa_emails = bool(new_can_manage_2fa_emails)

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


@admin_bp.route("/bulk_add_emails_to_users_ajax", methods=["POST"])
@admin_required
def bulk_add_emails_to_users_ajax():
    """
    Añade correos masivamente a múltiples usuarios seleccionados.
    """
    try:
        data = request.get_json()
        user_ids = data.get("user_ids", [])
        emails = data.get("emails", [])

        if not user_ids or not isinstance(user_ids, list):
            return jsonify({"status": "error", "message": "Debes seleccionar al menos un usuario."}), 400

        if not emails or not isinstance(emails, list):
            return jsonify({"status": "error", "message": "Debes proporcionar al menos un correo."}), 400

        added_count = 0
        skipped_count = 0
        errors = []

        for user_id in user_ids:
            user = User.query.get(user_id)
            if not user:
                errors.append(f"Usuario {user_id} no encontrado")
                continue

            # Obtener correos permitidos actuales del usuario
            current_emails = set()
            if user.allowed_email_entries:
                current_emails = {e.email.lower() for e in user.allowed_email_entries.all()}

            # Añadir nuevos correos
            for email in emails:
                email_lower = email.lower().strip()
                if not email_lower or '@' not in email_lower:
                    continue

                if email_lower not in current_emails:
                    new_allowed_email = AllowedEmail(user_id=user.id, email=email_lower)
                    db.session.add(new_allowed_email)
                    current_emails.add(email_lower)
                    added_count += 1
                else:
                    skipped_count += 1

        db.session.commit()

        return jsonify({
            "status": "ok",
            "message": f"Correos añadidos correctamente a {len(user_ids)} usuario(s).",
            "added_count": added_count,
            "skipped_count": skipped_count,
            "errors": errors if errors else None
        })

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al añadir correos masivamente: {e}", exc_info=True)
        return jsonify({"status": "error", "message": f"Error interno: {str(e)}"}), 500


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

@admin_bp.route("/manage_permissions", methods=["GET"])
@admin_required
def manage_permissions_page():
    """Página para gestionar todos los permisos de usuarios de forma centralizada"""
    return render_template("manage_permissions.html")

@admin_bp.route("/update_permissions_bulk_ajax", methods=["POST"])
@admin_required
def update_permissions_bulk_ajax():
    """
    Actualiza permisos de múltiples usuarios de forma masiva.
    Recibe: { "updates": [{"user_id": 1, "permissions": {"can_search_any": true, ...}}, ...] }
    """
    try:
        data = request.get_json()
        if not data or "updates" not in data:
            return jsonify({"status": "error", "message": "Formato de datos inválido"}), 400
        
        updates = data.get("updates", [])
        if not updates:
            return jsonify({"status": "error", "message": "No hay actualizaciones para aplicar"}), 400
        
        # Lista de permisos válidos
        valid_permissions = [
            'can_search_any',
            'can_create_subusers',
            'can_add_own_emails',
            'can_bulk_delete_emails',
            'can_manage_2fa_emails',
            'can_access_codigos2',
            'can_chat',
            'can_manage_subusers',
            'is_support'
        ]
        
        updated_count = 0
        errors = []
        
        for update_data in updates:
            user_id = update_data.get("user_id")
            permissions = update_data.get("permissions", {})
            
            if not user_id:
                errors.append("user_id faltante en una actualización")
                continue
            
            # Obtener usuario
            user = User.query.get(user_id)
            if not user:
                errors.append(f"Usuario {user_id} no encontrado")
                continue
            
            # Verificar que no sea admin
            admin_username = current_app.config.get("ADMIN_USER", "admin")
            if user.username == admin_username:
                errors.append(f"No se pueden modificar permisos del usuario admin")
                continue
            
            # Actualizar cada permiso válido
            for perm_key, perm_value in permissions.items():
                if perm_key in valid_permissions:
                    # Convertir a boolean
                    bool_value = bool(perm_value) if perm_value is not None else False
                    setattr(user, perm_key, bool_value)
                    
                    # Sincronizar can_access_codigos2 con la tabla codigos2_users
                    if perm_key == 'can_access_codigos2':
                        from app.models.codigos2_access import Codigos2Access, codigos2_users
                        from sqlalchemy import select, insert, delete
                        
                        # Verificar si el usuario está en codigos2_users
                        existing = db.session.execute(
                            select(codigos2_users.c.user_id).where(codigos2_users.c.user_id == user.id)
                        ).first()
                        
                        if bool_value:
                            # Si se otorga permiso y no está en la tabla, agregarlo
                            if not existing:
                                db.session.execute(
                                    insert(codigos2_users).values(user_id=user.id)
                                )
                        else:
                            # Si se revoca permiso y está en la tabla, eliminarlo
                            if existing:
                                db.session.execute(
                                    delete(codigos2_users).where(codigos2_users.c.user_id == user.id)
                                )
                else:
                    errors.append(f"Permiso inválido: {perm_key}")
            
            # ✅ REGLA: Si is_support es True, forzar can_chat y can_manage_subusers a False
            if user.is_support:
                user.can_chat = False
                user.can_manage_subusers = False
            
            updated_count += 1
        
        # Guardar cambios en la base de datos
        try:
            db.session.commit()
            message = f"Se actualizaron {updated_count} usuario(s)"
            if errors:
                message += f". Advertencias: {len(errors)}"
            return jsonify({
                "status": "ok",
                "message": message,
                "updated_count": updated_count,
                "errors": errors if errors else None
            })
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error al guardar permisos: {e}", exc_info=True)
            return jsonify({
                "status": "error",
                "message": f"Error al guardar en la base de datos: {str(e)}"
            }), 500
        
    except Exception as e:
        current_app.logger.error(f"Error en update_permissions_bulk_ajax: {e}", exc_info=True)
        return jsonify({
            "status": "error",
            "message": f"Error interno: {str(e)}"
        }), 500

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

@admin_bp.route("/get_tools_resources_ajax", methods=["GET"])
@admin_required
def get_tools_resources_ajax():
    """
    Obtiene todos los recursos de herramientas admin (ToolInfo, HtmlInfo, YouTubeListing, ApiInfo)
    con sus usuarios vinculados.
    """
    try:
        from app.store.models import ToolInfo, HtmlInfo, YouTubeListing, ApiInfo
        
        # Obtener todos los recursos
        tools = ToolInfo.query.order_by(ToolInfo.id.desc()).all()
        htmls = HtmlInfo.query.order_by(HtmlInfo.id.desc()).all()
        youtube_listings = YouTubeListing.query.order_by(YouTubeListing.id.desc()).all()
        apis = ApiInfo.query.order_by(ApiInfo.id.desc()).all()
        
        # Serializar recursos con sus usuarios vinculados
        resources = []
        
        # ToolInfo (Información añadida)
        for tool in tools:
            user_ids = [u.id for u in tool.usuarios_vinculados.all()]
            resources.append({
                "id": tool.id,
                "type": "tool",
                "title": tool.title,
                "category": "Información añadida",
                "enabled": tool.enabled,
                "user_ids": user_ids
            })
        
        # HtmlInfo (HTML añadidos)
        for html in htmls:
            user_ids = [u.id for u in html.users.all()]
            resources.append({
                "id": html.id,
                "type": "html",
                "title": html.title,
                "category": "HTML añadidos",
                "enabled": html.enabled,
                "user_ids": user_ids
            })
        
        # YouTubeListing (Listado de YouTube)
        for yt in youtube_listings:
            user_ids = [u.id for u in yt.users.all()]
            resources.append({
                "id": yt.id,
                "type": "youtube",
                "title": yt.title,
                "category": "Listado de YouTube",
                "enabled": yt.enabled,
                "user_ids": user_ids
            })
        
        # ApiInfo (Lista de Creación de APIs)
        for api in apis:
            user_ids = [u.id for u in api.users.all()]
            resources.append({
                "id": api.id,
                "type": "api",
                "title": api.title,
                "category": "Lista de Creación de APIs",
                "enabled": api.enabled,
                "user_ids": user_ids
            })
        
        return jsonify({
            "status": "ok",
            "resources": resources
        })
        
    except Exception as e:
        current_app.logger.error(f"Error en get_tools_resources_ajax: {e}", exc_info=True)
        return jsonify({
            "status": "error",
            "message": f"Error interno: {str(e)}"
        }), 500

@admin_bp.route("/update_tools_resources_permissions_ajax", methods=["POST"])
@admin_required
def update_tools_resources_permissions_ajax():
    """
    Actualiza los permisos de acceso a recursos de herramientas admin.
    Recibe: { "updates": [{"resource_id": 1, "resource_type": "tool", "user_ids": [1, 2, 3]}, ...] }
    """
    try:
        from app.store.models import ToolInfo, HtmlInfo, YouTubeListing, ApiInfo
        
        data = request.get_json()
        if not data or "updates" not in data:
            return jsonify({"status": "error", "message": "Formato de datos inválido"}), 400
        
        updates = data.get("updates", [])
        if not updates:
            return jsonify({"status": "error", "message": "No hay actualizaciones para aplicar"}), 400
        
        updated_count = 0
        errors = []
        
        for update_data in updates:
            resource_id = update_data.get("resource_id")
            resource_type = update_data.get("resource_type")
            user_ids = update_data.get("user_ids", [])
            
            if not resource_id or not resource_type:
                errors.append("resource_id o resource_type faltante en una actualización")
                continue
            
            try:
                # Obtener usuarios
                users = User.query.filter(User.id.in_(user_ids)).all() if user_ids else []
                
                # Actualizar según el tipo de recurso
                if resource_type == "tool":
                    resource = ToolInfo.query.get(resource_id)
                    if not resource:
                        errors.append(f"ToolInfo {resource_id} no encontrado")
                        continue
                    resource.usuarios_vinculados = users
                    
                elif resource_type == "html":
                    resource = HtmlInfo.query.get(resource_id)
                    if not resource:
                        errors.append(f"HtmlInfo {resource_id} no encontrado")
                        continue
                    resource.users = users
                    
                elif resource_type == "youtube":
                    resource = YouTubeListing.query.get(resource_id)
                    if not resource:
                        errors.append(f"YouTubeListing {resource_id} no encontrado")
                        continue
                    resource.users = users
                    
                elif resource_type == "api":
                    resource = ApiInfo.query.get(resource_id)
                    if not resource:
                        errors.append(f"ApiInfo {resource_id} no encontrado")
                        continue
                    resource.users = users
                    
                else:
                    errors.append(f"Tipo de recurso inválido: {resource_type}")
                    continue
                
                updated_count += 1
                
            except Exception as e:
                errors.append(f"Error al actualizar recurso {resource_id}: {str(e)}")
                continue
        
        # Guardar cambios en la base de datos
        try:
            db.session.commit()
            message = f"Se actualizaron {updated_count} recurso(s)"
            if errors:
                message += f". Advertencias: {len(errors)}"
            return jsonify({
                "status": "ok",
                "message": message,
                "updated_count": updated_count,
                "errors": errors if errors else None
            })
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error al guardar permisos de recursos: {e}", exc_info=True)
            return jsonify({
                "status": "error",
                "message": f"Error al guardar en la base de datos: {str(e)}"
            }), 500
        
    except Exception as e:
        current_app.logger.error(f"Error en update_tools_resources_permissions_ajax: {e}", exc_info=True)
        return jsonify({
            "status": "error",
            "message": f"Error interno: {str(e)}"
        }), 500

@admin_bp.route("/update_user_prices_ajax", methods=["POST"])
@admin_required
def update_user_prices_ajax():
    """
    Actualiza los precios por usuario de forma masiva.
    Recibe: { "updates": [{"user_id": 1, "tipo_precio": "USD", "precio_original_cop": 0, ...}, ...] }
    """
    try:
        # Obtener el user_id del admin actual ANTES de hacer cambios
        current_admin_id = session.get("user_id")
        
        data = request.get_json()
        if not data or "updates" not in data:
            return jsonify({"status": "error", "message": "Formato de datos inválido"}), 400
        
        updates = data.get("updates", [])
        if not updates:
            return jsonify({"status": "error", "message": "No hay actualizaciones para aplicar"}), 400
        
        updated_count = 0
        errors = []
        
        for update_data in updates:
            user_id = update_data.get("user_id")
            if not user_id:
                errors.append("user_id faltante en una actualización")
                continue
            
            # Evitar modificar el usuario actual (admin) para prevenir problemas de sesión
            if user_id == current_admin_id:
                errors.append("No se puede modificar el tipo de precio del administrador actual")
                continue
            
            # Obtener usuario usando merge para evitar problemas de sesión
            user = User.query.get(user_id)
            if not user:
                errors.append(f"Usuario {user_id} no encontrado")
                continue
            
            # Obtener tipo_precio a actualizar
            nuevo_tipo_precio = update_data.get("tipo_precio")
            
            # Preservar los campos existentes en user_prices y solo actualizar tipo_precio
            if not user.user_prices:
                user.user_prices = {}
            
            # Crear una copia del diccionario existente para evitar problemas con SQLAlchemy
            new_user_prices = dict(user.user_prices) if user.user_prices else {}
            
            # Actualizar solo tipo_precio, preservando el resto
            if nuevo_tipo_precio:
                new_user_prices['tipo_precio'] = nuevo_tipo_precio
            elif 'tipo_precio' in new_user_prices:
                # Si se envía None o vacío, eliminar tipo_precio
                del new_user_prices['tipo_precio']
            
            # Asignar el nuevo diccionario y marcar como modificado
            user.user_prices = new_user_prices
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(user, 'user_prices')
            updated_count += 1
        
        try:
            db.session.commit()
            return jsonify({
                "status": "ok",
                "message": f"Se actualizaron {updated_count} usuario(s) correctamente",
                "updated_count": updated_count,
                "errors": errors if errors else None
            })
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error al guardar precios de usuarios: {e}", exc_info=True)
            return jsonify({
                "status": "error",
                "message": f"Error al guardar en la base de datos: {str(e)}"
            }), 500
        
    except Exception as e:
        current_app.logger.error(f"Error en update_user_prices_ajax: {e}", exc_info=True)
        return jsonify({
            "status": "error",
            "message": f"Error interno: {str(e)}"
        }), 500


@admin_bp.route("/users/<int:user_id>/edit_products", methods=["GET", "POST"])
@admin_required
def edit_user_products(user_id):
    """
    Edita los productos asociados a un usuario específico.
    Los productos y descuentos se almacenan en user_prices.
    """
    from app.store.models import Product
    
    user = User.query.get_or_404(user_id)
    
    # Verificar que el usuario tenga tipo_precio configurado
    tipo_precio = None
    if user.user_prices and isinstance(user.user_prices, dict):
        tipo_precio = user.user_prices.get('tipo_precio')
    
    if not tipo_precio or tipo_precio not in ['USD', 'COP']:
        flash("El usuario debe tener un tipo de precio configurado (USD o COP) para gestionar productos asociados.", "warning")
        return redirect(url_for('admin_bp.manage_permissions_page'))
    
    productos = Product.query.filter_by(enabled=True).order_by(Product.name).all()
    
    # Obtener productos permitidos y descuentos desde user_prices
    productos_ids = []
    descuentos_productos = {}
    productos_permitidos_existe = False
    
    if user.user_prices and isinstance(user.user_prices, dict):
        # Verificar si la clave 'productos_permitidos' existe (aunque esté vacía)
        if 'productos_permitidos' in user.user_prices:
            productos_permitidos_existe = True
            productos_ids_raw = user.user_prices.get('productos_permitidos', [])
            # Asegurar que los IDs sean enteros (pueden venir como strings desde JSON)
            if productos_ids_raw:
                productos_ids = [int(pid) for pid in productos_ids_raw if pid is not None and str(pid).strip() != '']
        descuentos_productos = user.user_prices.get('descuentos_productos', {})
    
    # Si la clave 'productos_permitidos' NO existe en user_prices, marcar todos por defecto
    # Si existe pero está vacía, mantenerla vacía (usuario explícitamente configuró que no quiere ver productos)
    if not productos_permitidos_existe:
        productos_ids = [p.id for p in productos]
    
    if request.method == 'POST':
        if request.is_json:
            data = request.get_json()
            productos_permitidos = data.get('productos_permitidos', [])
            descuentos_productos_data = data.get('descuentos_productos', {})
            
            # Validar que los productos existan y estén habilitados
            productos_objs = Product.query.filter(
                Product.id.in_(productos_permitidos),
                Product.enabled == True
            ).all()
            
            # Filtrar solo productos habilitados (no guardar productos deshabilitados)
            productos_permitidos_enabled = [p.id for p in productos_objs]
            
            # Si hay productos que no existen o no están habilitados, solo guardar los válidos
            if len(productos_permitidos_enabled) < len(productos_permitidos):
                productos_permitidos = productos_permitidos_enabled
            
            # Validar precios finales solo para productos que tienen descuentos configurados
            errores = []
            for prod in productos_objs:
                cop = float(prod.price_cop)
                usd = float(prod.price_usd)
                d_extra = descuentos_productos_data.get(str(prod.id)) or descuentos_productos_data.get(int(prod.id)) or {}
                d_cop_extra = float(d_extra.get('cop', 0) or 0)
                d_usd_extra = float(d_extra.get('usd', 0) or 0)
                
                # Solo validar si hay descuento configurado (mayor a 0)
                if d_cop_extra > 0 or d_usd_extra > 0:
                    if tipo_precio == 'COP':
                        final_cop = cop - d_cop_extra
                        if final_cop <= 0:
                            errores.append(f"El precio final en COP para '{prod.name}' debe ser mayor a 0 (actual: {final_cop})")
                    else:
                        final_usd = usd - d_usd_extra
                        if final_usd < 0.1:
                            errores.append(f"El precio final en USD para '{prod.name}' debe ser mayor a 0.1 (actual: {final_usd})")
            
            if errores:
                return jsonify({'status': 'error', 'message': ' | '.join(errores)}), 400
            
            # Actualizar user_prices (preservar tipo_precio y otros campos existentes)
            if not user.user_prices:
                user.user_prices = {}
            
            # Preservar tipo_precio y otros campos existentes
            tipo_precio_existente = user.user_prices.get('tipo_precio')
            
            # Asegurar que los IDs sean enteros
            productos_permitidos_int = [int(pid) for pid in productos_permitidos if pid is not None]
            
            # Crear un nuevo diccionario en lugar de modificar el existente (importante para SQLAlchemy)
            new_user_prices = dict(user.user_prices) if user.user_prices else {}
            
            # Actualizar solo los campos necesarios, preservando el resto
            new_user_prices['productos_permitidos'] = productos_permitidos_int
            new_user_prices['descuentos_productos'] = descuentos_productos_data
            
            # Restaurar tipo_precio si existía
            if tipo_precio_existente:
                new_user_prices['tipo_precio'] = tipo_precio_existente
            
            # Asignar el nuevo diccionario completo
            user.user_prices = new_user_prices
            
            # CRÍTICO: Indicar a SQLAlchemy que el campo JSON ha cambiado
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(user, 'user_prices')
            
            try:
                db.session.commit()
                return jsonify({'status': 'ok', 'message': 'Productos asociados actualizados correctamente.'})
            except Exception as e:
                db.session.rollback()
                current_app.logger.error(f"Error al guardar productos asociados del usuario: {e}", exc_info=True)
                return jsonify({'status': 'error', 'message': f'Error al guardar: {str(e)}'}), 500
        
        return jsonify({'status': 'error', 'message': 'Petición inválida'}), 400
    
    # Asignar descuentos a los productos para mostrarlos en la plantilla
    for p in productos:
        d = descuentos_productos.get(str(p.id)) or descuentos_productos.get(int(p.id)) or {}
        p.discount_cop_extra = d.get('cop', 0)
        p.discount_usd_extra = d.get('usd', 0)
    
    return render_template('edit_user_products.html', 
                          user=user, 
                          productos=productos, 
                          productos_ids=productos_ids,
                          tipo_precio=tipo_precio)
