# app/auth/session_guards.py
"""Validación de session_token para sesiones de usuario (alineada con admin)."""

from flask import request, session, jsonify, flash, redirect, url_for

from app.models import User
from app.auth.session_tokens import resolve_session_token


def user_request_is_ajax():
    return (
        request.is_json
        or request.headers.get('Content-Type', '').startswith('application/json')
        or request.headers.get('X-Requested-With') == 'XMLHttpRequest'
        or request.path.startswith('/api/')
        or request.path.startswith('/usuario/my_page/')
        or (request.method in ['GET', 'POST', 'PUT', 'DELETE'] and 'twofa-configs' in request.path)
    )


def reject_user_session(message, status_code=401, clear_session=True, is_ajax=None):
    """Respuesta uniforme al rechazar sesión de usuario."""
    if is_ajax is None:
        is_ajax = user_request_is_ajax()
    if clear_session:
        session.clear()
    if is_ajax:
        return jsonify({"status": "error", "message": message}), status_code
    flash(message, 'danger')
    return redirect(url_for('user_auth_bp.login'))


def ensure_user_session_token_valid(is_ajax=None):
    """
    Valida session_token de usuario (igual que admin).
    Si el token se perdió en memoria del servidor pero la sesión Flask es coherente, regenera.
    Returns None si OK, o una respuesta Flask si debe abortar.
    """
    if is_ajax is None:
        is_ajax = user_request_is_ajax()

    user_id = session.get('user_id')
    if user_id is None:
        return reject_user_session(
            'Sesión inválida. Vuelve a iniciar sesión.',
            401,
            clear_session=not is_ajax,
            is_ajax=is_ajax,
        )

    user_obj = User.query.get(user_id)
    sess_uname = session.get('username')
    recover_ok = bool(
        user_obj
        and user_obj.enabled
        and (not sess_uname or user_obj.username == sess_uname)
    )

    resolved = resolve_session_token(
        session.get('session_token'),
        user_id,
        is_admin=False,
        allow_recover=recover_ok,
    )
    if not resolved:
        return reject_user_session(
            'Sesión inválida o expirada. Vuelve a iniciar sesión.',
            401,
            clear_session=not is_ajax,
            is_ajax=is_ajax,
        )

    session['session_token'] = resolved
    return None
