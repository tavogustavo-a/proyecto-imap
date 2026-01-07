# app/admin/admin_codigos2_access.py

from flask import render_template, request, jsonify, flash, redirect, url_for, current_app
from app.models import User, Codigos2Access, codigos2_users
from app.extensions import db
from app.admin.decorators import admin_required
from app.admin.admin_bp import admin_bp
from sqlalchemy import select, insert, delete

@admin_bp.route("/accesos_codigos2", methods=["GET"], endpoint='accesos_codigos2_page')
@admin_required
def accesos_codigos2_page():
    """Página para gestionar accesos a Códigos 2."""
    return render_template("admin/accesos_codigos2.html")

@admin_bp.route("/accesos_codigos2/usuarios", methods=["GET"], endpoint='get_codigos2_users')
@admin_required
def get_codigos2_users():
    """API para obtener usuarios con paginación y búsqueda."""
    admin_username = current_app.config.get('ADMIN_USER')
    
    page = request.args.get('page', 1, type=int)
    per_page_param = request.args.get('per_page', '5')
    search_query = request.args.get('search', '')
    
    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    # Obtener IDs de usuarios con acceso desde codigos2_users
    linked_user_ids_result = db.session.execute(
        select(codigos2_users.c.user_id)
    ).all()
    linked_user_ids_from_table = {row[0] for row in linked_user_ids_result}
    
    # También obtener usuarios con can_access_codigos2=True para sincronización
    users_with_permission = User.query.filter(
        User.can_access_codigos2 == True,
        User.username != admin_username,
        User.parent_id == None
    ).all()
    linked_user_ids_from_field = {user.id for user in users_with_permission}
    
    # Sincronizar: Si un usuario tiene can_access_codigos2=True pero no está en codigos2_users, agregarlo
    to_sync = linked_user_ids_from_field - linked_user_ids_from_table
    if to_sync:
        for user_id in to_sync:
            db.session.execute(
                insert(codigos2_users).values(user_id=user_id)
            )
        db.session.commit()
        # Actualizar linked_user_ids_from_table después de la sincronización
        linked_user_ids_from_table = linked_user_ids_from_table | to_sync
    
    # Combinar ambos (unión) para mostrar todos los usuarios con acceso
    linked_user_ids = linked_user_ids_from_table | linked_user_ids_from_field
    
    # Manejar el caso cuando per_page es "all"
    if per_page_param == 'all':
        users = users_query.all()
        users_data = [{
            'id': user.id,
            'username': user.username,
            'full_name': user.full_name or ''
        } for user in users]
        
        return jsonify({
            'users': users_data,
            'pagination': {
                'page': 1,
                'per_page': len(users),
                'total': len(users),
                'pages': 1,
                'has_prev': False,
                'has_next': False,
                'prev_num': None,
                'next_num': None
            },
            'linked_user_ids': list(linked_user_ids)
        })
    
    # Caso normal con paginación
    per_page = int(per_page_param)
    pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    
    users_data = [{
        'id': user.id,
        'username': user.username,
        'full_name': user.full_name or ''
    } for user in pagination.items]
    
    return jsonify({
        'users': users_data,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_prev': pagination.has_prev,
            'has_next': pagination.has_next,
            'prev_num': pagination.prev_num,
            'next_num': pagination.next_num
        },
        'linked_user_ids': list(linked_user_ids)
    })

@admin_bp.route("/accesos_codigos2/guardar", methods=["POST"], endpoint='save_codigos2_access')
@admin_required
def save_codigos2_access():
    """Guarda los accesos a Códigos 2."""
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    try:
        user_ids_str = request.form.getlist('user_ids')
        user_ids = [int(uid) for uid in user_ids_str]
        
        # Obtener usuarios actualmente vinculados
        current_linked_result = db.session.execute(
            select(codigos2_users.c.user_id)
        ).all()
        current_linked_ids = {row[0] for row in current_linked_result}
        
        # Desvincular usuarios que ya no están seleccionados
        to_remove = current_linked_ids - set(user_ids)
        for user_id in to_remove:
            user = User.query.get(user_id)
            if user and user.username != admin_username:
                db.session.execute(
                    delete(codigos2_users).where(codigos2_users.c.user_id == user_id)
                )
        
        # Vincular nuevos usuarios
        to_add = set(user_ids) - current_linked_ids
        for user_id in to_add:
            user = User.query.get(user_id)
            if user and user.username != admin_username:
                # Verificar que no exista ya
                existing = db.session.execute(
                    select(codigos2_users.c.user_id).where(codigos2_users.c.user_id == user_id)
                ).first()
                if not existing:
                    db.session.execute(
                        insert(codigos2_users).values(user_id=user_id)
                    )
                # Sincronizar can_access_codigos2 en el modelo User
                user.can_access_codigos2 = True
        
        # Desvincular usuarios también actualiza can_access_codigos2
        for user_id in to_remove:
            user = User.query.get(user_id)
            if user and user.username != admin_username:
                user.can_access_codigos2 = False
        
        db.session.commit()
        flash('Accesos a Códigos 2 actualizados correctamente.', 'success')
        return redirect(url_for('admin_bp.accesos_codigos2_page'))
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al guardar accesos a Códigos 2: {e}", exc_info=True)
        flash('Error al guardar los accesos.', 'error')
        return redirect(url_for('admin_bp.accesos_codigos2_page'))

