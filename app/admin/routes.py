@admin_bp.route("/toggle_user/<int:user_id>", methods=["POST"])
@login_required
@admin_required
def toggle_user(user_id):
    """
    Alternar el estado enabled/disabled de un usuario.
    """
    user = User.query.get_or_404(user_id)
    if user.username == current_app.config["ADMIN_USER"]:
        flash("No se puede deshabilitar al usuario admin.", "danger")
        return redirect(url_for("admin_bp.manage_users"))

    # Obtener el estado actual antes de cambiar
    estado_anterior = user.enabled
    
    # Cambiar el estado del usuario
    user.enabled = not user.enabled
    db.session.commit()

    # Si el usuario está siendo activado (pasando de disabled a enabled)
    if user.enabled and not estado_anterior:
        # Obtener todos los sub-usuarios que estaban activos antes de ser desactivados
        subusers = User.query.filter(
            User.parent_id == user.id,
            User.was_enabled == True  # Solo los que estaban activos antes
        ).all()
        
        # Activar los sub-usuarios que estaban activos
        for subuser in subusers:
            subuser.enabled = True
            subuser.was_enabled = None  # Limpiar el estado anterior
        db.session.commit()

    flash(f"Usuario {user.username} {'habilitado' if user.enabled else 'deshabilitado'}.", "success")
    return redirect(url_for("admin_bp.manage_users")) 