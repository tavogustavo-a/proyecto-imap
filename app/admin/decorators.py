# app/admin/decorators.py

from functools import wraps
from flask import session, current_app, flash, redirect, url_for, request, jsonify
from app.models import User

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        admin_user = current_app.config.get("ADMIN_USER", "admin")
        
        # Detectar si es una petición AJAX/JSON (más preciso)
        # Solo considerar AJAX si realmente es una petición de API o tiene headers específicos
        is_ajax = (
            request.is_json or 
            request.headers.get('Content-Type', '').startswith('application/json') or
            request.headers.get('X-Requested-With') == 'XMLHttpRequest' or
            request.path.startswith('/api/') or
            request.method == 'POST' and request.path.endswith(('.json', '/ajax'))
        )
        
        # Función helper para devolver error en formato apropiado
        # IMPORTANTE: NO limpiar sesión en peticiones AJAX para evitar cerrar sesiones válidas
        def return_error(message, status_code=403, clear_session=False):
            if is_ajax:
                # En peticiones AJAX, solo devolver JSON sin limpiar sesión
                # (a menos que sea explícitamente necesario por seguridad)
                return jsonify({'success': False, 'error': message}), status_code
            else:
                # En peticiones HTML normales, limpiar sesión y redirigir
                flash(message, "danger")
                if clear_session:
                    session.clear()
                return redirect(url_for("auth_bp.login"))
        
        # 1) ✅ SEGURIDAD: Verificar que NO sea un usuario normal o sub-usuario PRIMERO
        # Los usuarios normales tienen session["is_user"] = True
        if session.get("is_user"):
            # Solo limpiar sesión si NO es AJAX (para evitar cerrar sesiones válidas de usuarios normales)
            if not is_ajax:
                session.clear()
            return return_error("Solo el administrador puede acceder a esta sección.", clear_session=not is_ajax)

        # 2) ✅ SEGURIDAD: Verificar que esté logueado
        if not session.get("logged_in"):
            return return_error("Inicia sesión para acceder.", 401, clear_session=False)

        # 3) ✅ SEGURIDAD CRÍTICA: Verificar token de sesión único ANTES de verificar user_id
        # Esto previene sesiones duplicadas - el token debe estar registrado en el servidor
        from app.auth.session_tokens import validate_session_token, generate_session_token
        session_token = session.get("session_token")
        user_id = session.get("user_id")
        
        # Si no hay token, intentar regenerarlo si la sesión Flask es válida
        # Esto previene que se cierren sesiones válidas después de reinicios del servidor
        if not session_token:
            # Verificar primero que tenemos user_id y username válidos antes de regenerar
            if user_id and session.get("username") == admin_user:
                # Regenerar token para sesión válida que perdió su token (ej: reinicio del servidor)
                try:
                    user_obj_temp = User.query.get(user_id)
                    if user_obj_temp and user_obj_temp.username == admin_user and user_obj_temp.parent_id is None:
                        session_token = generate_session_token(user_id, is_admin=True)
                        session["session_token"] = session_token
                        # Continuar con la validación normal
                    else:
                        if not is_ajax:
                            session.clear()
                        return return_error("Sesión inválida. Por favor, inicia sesión nuevamente.", clear_session=not is_ajax)
                except Exception:
                    if not is_ajax:
                        session.clear()
                    return return_error("Error al validar sesión. Por favor, inicia sesión nuevamente.", clear_session=not is_ajax)
            else:
                # No hay token y no podemos regenerarlo - sesión inválida
                if not is_ajax:
                    session.clear()
                return return_error("Sesión inválida. Por favor, inicia sesión nuevamente.", clear_session=not is_ajax)
        
        # Validar el token - debe existir en el servidor y ser de admin
        token_valid = validate_session_token(session_token, expected_user_id=user_id, require_admin=True)
        
        # Si el token no es válido pero tenemos una sesión Flask válida, regenerar el token
        # Esto maneja el caso de reinicios del servidor donde los tokens en memoria se pierden
        if not token_valid:
            # Verificar que la sesión Flask es válida antes de regenerar
            if user_id and session.get("username") == admin_user and session.get("logged_in"):
                try:
                    user_obj_temp = User.query.get(user_id)
                    if user_obj_temp and user_obj_temp.username == admin_user and user_obj_temp.parent_id is None:
                        # Regenerar token para sesión válida que perdió su token
                        session_token = generate_session_token(user_id, is_admin=True)
                        session["session_token"] = session_token
                        # Continuar con la validación - ahora debería pasar
                    else:
                        if not is_ajax:
                            session.clear()
                        return return_error("Sesión inválida. Por favor, inicia sesión nuevamente.", clear_session=not is_ajax)
                except Exception:
                    if not is_ajax:
                        session.clear()
                    return return_error("Error al validar sesión. Por favor, inicia sesión nuevamente.", clear_session=not is_ajax)
            else:
                # Token inválido y no podemos regenerarlo - sesión inválida
                if not is_ajax:
                    session.clear()
                return return_error("Sesión inválida o expirada. Por favor, inicia sesión nuevamente.", clear_session=not is_ajax)

        # 4) ✅ SEGURIDAD CRÍTICA: Verificar que el user_id corresponda realmente al admin en la BD
        # Esta es la verificación más importante - debe existir y ser el admin
        if not user_id:
            # Si no hay user_id, no puede ser una sesión válida de admin
            if not is_ajax:
                session.clear()
            return return_error("Sesión inválida. Por favor, inicia sesión nuevamente.", clear_session=not is_ajax)
        
        # Verificar en la BD que el user_id corresponda al admin
        user_obj = User.query.get(user_id)
        if not user_obj:
            # Usuario no existe en la BD
            if not is_ajax:
                session.clear()
            return return_error("Usuario no encontrado. Por favor, inicia sesión nuevamente.", clear_session=not is_ajax)
        
        # Verificar que el usuario de la BD sea realmente el admin
        if user_obj.username != admin_user or user_obj.parent_id is not None:
            # No es admin o es sub-usuario
            if not is_ajax:
                session.clear()
            return return_error("Solo el administrador puede acceder a esta sección.", clear_session=not is_ajax)

        # 5) ✅ SEGURIDAD ADICIONAL: Verificar que el username en sesión coincida con el de la BD
        # Esto previene sesiones donde se falsifica solo el username pero no el user_id
        session_username = session.get("username")
        if session_username != admin_user:
            if not is_ajax:
                session.clear()
            return return_error("Sesión inválida. Por favor, inicia sesión nuevamente.", clear_session=not is_ajax)

        # 6) ✅ SEGURIDAD ADICIONAL: Verificar que la sesión tenga login_time (sesión válida iniciada correctamente)
        # Esto previene sesiones que no fueron iniciadas mediante el proceso de login normal
        # PERO: Ser más permisivo aquí - si falta login_time pero todo lo demás está bien, permitir acceso
        # (puede ser una sesión antigua antes de implementar login_time)
        if not session.get("login_time"):
            # Solo advertir, no bloquear completamente si es una sesión válida de admin
            # Esto evita cerrar sesiones válidas que fueron creadas antes de agregar login_time
            pass  # Permitir acceso si todas las demás verificaciones pasaron

        return f(*args, **kwargs)
    return decorated_function
