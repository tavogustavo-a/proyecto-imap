from flask import render_template, request, redirect, url_for, flash, current_app, jsonify
from . import admin_bp
from app.extensions import db
from app.models.security_rules import SecurityRule
from app.admin.decorators import admin_required
from app.admin.site_settings import set_site_setting, get_site_setting
from app.models.trigger_log import TriggerLog
from app.store.api import format_colombia_time
from flask import session
from sqlalchemy.orm import joinedload, undefer
from app.models.user import User
from sqlalchemy import or_
from app.models.settings import SiteSettings
from app.models.imap import IMAPServer
from app.models.observer_imap import ObserverIMAPServer
from app.admin.site_settings import get_site_setting

# --- Función Auxiliar para obtener y formatear reglas --- 
def _get_all_security_rules_data(search_query=""):
    rules_q = SecurityRule.query
    if search_query:
        rules_q = rules_q.filter(
            # SecurityRule.target_email_address.ilike(f"%{search_query}%") | # Ya no existe
            SecurityRule.sender.ilike(f"%{search_query}%") |
            SecurityRule.description.ilike(f"%{search_query}%")
        )
    rules = rules_q.order_by(SecurityRule.id.desc()).all()
    return [rule.to_dict() for rule in rules]

# --- Página para Listar y Crear Reglas de Seguridad ---
@admin_bp.route("/security_rules", methods=["GET", "POST"])
@admin_required
def security_rules_page():
    # Campos IMAP eliminados en nueva versión

    if request.method == "POST":
        try:
            sender = request.form.get("sender", "").strip() or None
            description = request.form.get("description", "").strip() or None
            trigger_pattern = request.form.get("trigger_pattern", "").strip()
            observer_pattern = request.form.get("observer_pattern", "").strip()
            # ya no se guarda imap_server_id ni carpeta,
            
            if not trigger_pattern or not observer_pattern:
                flash("Patrón Activador y Patrón Observador son obligatorios.", "danger")
            else:
                new_rule = SecurityRule(
                    sender=sender,
                    description=description,
                    trigger_pattern=trigger_pattern,
                    observer_pattern=observer_pattern,
                    enabled=True 
                )
                db.session.add(new_rule)
                db.session.commit()
                flash("Nueva regla de seguridad creada.", "success")
        except Exception as e:
            db.session.rollback()
            flash(f"Error al crear regla: {e}", "danger")
            current_app.logger.error(f"Error creando SecurityRule: {e}", exc_info=True)
        # Después de un POST (creación), siempre redirigimos a la página GET para ver la lista actualizada    
        return redirect(url_for("admin_bp.security_rules_page")) 
            
    # --- SECCIÓN GET MODIFICADA ---
    search_query = request.args.get("search_query", "").strip()
    # Obtener lista de servidores Observador para la plantilla
    observer_servers = ObserverIMAPServer.query.all()
    rules_data = _get_all_security_rules_data(search_query)

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        # Si es AJAX, devolvemos JSON
        return jsonify({"status": "ok", "rules": rules_data})
    else:
        # Si es carga normal de página, pasamos los datos a la plantilla
        return render_template("admin/security_rules.html", rules=rules_data, search_query=search_query, observer_servers=observer_servers)
    # --- FIN SECCIÓN GET MODIFICADA ---

# --- Página para Editar Regla de Seguridad ---
@admin_bp.route("/edit_security_rule/<int:rule_id>", methods=["GET", "POST"])
@admin_required
def edit_security_rule_page(rule_id):
    rule = SecurityRule.query.get_or_404(rule_id)
    # Campos IMAP eliminados

    if request.method == "POST":
        try:
            rule.sender = request.form.get("sender", "").strip() or None
            rule.description = request.form.get("description", "").strip() or None
            rule.trigger_pattern = request.form.get("trigger_pattern", "").strip()
            rule.observer_pattern = request.form.get("observer_pattern", "").strip()
            # campos IMAP eliminados

            if not rule.trigger_pattern or not rule.observer_pattern:
                 flash("Patrón Activador y Patrón Observador son obligatorios.", "danger")
            else:
                db.session.commit()
                flash("Regla de seguridad actualizada.", "success")
                return redirect(url_for("admin_bp.security_rules_page"))
        except Exception as e:
            db.session.rollback()
            flash(f"Error al actualizar regla: {e}", "danger")
            current_app.logger.error(f"Error actualizando SecurityRule {rule_id}: {e}", exc_info=True)

    return render_template("admin/edit_security_rule.html", rule=rule)

# --- Ruta AJAX para Borrar Regla (similar a otros) ---
@admin_bp.route("/delete_security_rule_ajax", methods=["POST"])
@admin_required
def delete_security_rule_ajax():
    data = request.get_json()
    rule_id = data.get("rule_id")
    if not rule_id:
        return jsonify({"status": "error", "message": "Falta ID de la regla."}), 400
    
    rule = SecurityRule.query.get(rule_id)
    if rule:
        try:
            db.session.delete(rule)
            db.session.commit()
            rules_data = _get_all_security_rules_data() 
            return jsonify({"status": "ok", "message": "Regla eliminada.", "rules": rules_data})
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error eliminando SecurityRule {rule_id}: {e}")
            return jsonify({"status": "error", "message": "Error al eliminar regla."}), 500
    return jsonify({"status": "error", "message": "Regla no encontrada."}), 404

# --- Ruta AJAX para Toggle Enabled (similar a otros) ---
@admin_bp.route("/toggle_security_rule_ajax", methods=["POST"])
@admin_required
def toggle_security_rule_ajax():
    data = request.get_json()
    rule_id = data.get("rule_id")
    if not rule_id:
        return jsonify({"status": "error", "message": "Falta ID de la regla."}), 400
        
    rule = SecurityRule.query.get(rule_id)
    if rule:
        try:
            rule.enabled = not rule.enabled
            db.session.commit()
            # <<< --- AÑADIR: Obtener y devolver lista actualizada --- >>>
            rules_data = _get_all_security_rules_data() 
            # Devolver la lista completa además del status
            return jsonify({"status": "ok", "rule": rule.to_dict(), "rules": rules_data})
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error cambiando estado de SecurityRule {rule_id}: {e}")
            return jsonify({"status": "error", "message": "Error al cambiar estado."}), 500
    return jsonify({"status": "error", "message": "Regla no encontrada."}), 404

# --- Ruta para Guardar Ajustes de Seguridad ---
@admin_bp.route("/save_security_settings", methods=["POST"])
@admin_required
def save_security_settings():
    try:
        retention = request.form.get("log_retention_minutes")
        frequency = request.form.get("observer_check_frequency")
        observer_enabled = request.form.get("observer_enabled", "0")

        if retention is None or frequency is None:
             flash("Faltan valores de tiempo.", "danger")
        else:
            try:
                # Validar que sean enteros positivos
                ret_minutes = int(retention)
                freq_minutes = int(frequency)
                if ret_minutes <= 0 or freq_minutes <= 0:
                    raise ValueError("Los minutos deben ser mayores a cero.")
                
                set_site_setting("log_retention_minutes", str(ret_minutes))
                set_site_setting("observer_check_frequency", str(freq_minutes))
                set_site_setting("observer_enabled", observer_enabled)
                flash("Tiempos de seguridad guardados.", "success")


                
            except ValueError as ve:
                 flash(f"Valor inválido: {ve}", "danger")
                 
    except Exception as e:
        flash(f"Error guardando ajustes: {e}", "danger")
        current_app.logger.error(f"Error guardando ajustes de seguridad: {e}", exc_info=True)
        
    return redirect(url_for("admin_bp.dashboard"))


# --- Ruta para Limpiar el Log de Activadores ---
@admin_bp.route("/clear_trigger_log", methods=["POST"])
@admin_required
def clear_trigger_log():
    try:
        num_deleted = db.session.query(TriggerLog).delete()
        db.session.commit()
        # No usamos flash aquí, el mensaje va en el JSON
        # flash(f"Log de activadores limpiado ({num_deleted} entradas eliminadas).", "info")
        # Log removido: no es necesario registrar esta acción de limpieza
        # <<< --- DEVOLVER JSON EN LUGAR DE REDIRECT --- >>>
        return jsonify({"success": True, "deleted_count": num_deleted, "message": f"Log de activadores limpiado ({num_deleted} entradas eliminadas)."})
    except Exception as e:
        db.session.rollback()
        # flash(f"Error al limpiar el log: {e}", "danger") # El error va en el JSON
        current_app.logger.error(f"Error limpiando TriggerLog: {e}", exc_info=True)
        # <<< --- DEVOLVER JSON CON ERROR --- >>>
        return jsonify({"success": False, "message": f"Error al limpiar el log: {str(e)}"}), 500

    # Quitar el redirect final
    # return redirect(url_for("admin_bp.dashboard"))

# --- RUTA MODIFICADA: Ver Logs de Activadores --- 
@admin_bp.route("/view_trigger_logs")
@admin_required
def view_trigger_logs_page():
    page = request.args.get('page', 1, type=int)
    search_query = request.args.get("search_query", "").strip()
    per_page = 50

    logs_q = TriggerLog.query.options(
        joinedload(TriggerLog.user).joinedload(User.parent),
        # joinedload(TriggerLog.rule) # Quitado si ya no se usa la relación
    )

    if search_query:
        search_term = f"%{search_query}%"
        logs_q = logs_q.outerjoin(User, TriggerLog.user_id == User.id)
        logs_q = logs_q.filter(
            or_(
                TriggerLog.searched_email.ilike(search_term),
                User.username.ilike(search_term),
                User.parent.has(User.username.ilike(search_term))
            )
        )

    log_pagination = logs_q.order_by(TriggerLog.timestamp.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    logs = log_pagination.items

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        logs_data = []
        for log in logs:
            logs_data.append({
                "timestamp": format_colombia_time(log.timestamp),
                "username": log.user.username if log.user else 'Usuario Desconocido',
                "parent_username": log.user.parent.username if log.user and log.user.parent else None,
                "searched_email": log.searched_email or '(No guardado)'
            })
        return jsonify({
            "status": "ok",
            "logs": logs_data,
            "pagination": {
                "page": log_pagination.page,
                "per_page": log_pagination.per_page,
                "total_pages": log_pagination.pages,
                "total_items": log_pagination.total,
                "has_prev": log_pagination.has_prev,
                "has_next": log_pagination.has_next,
                "prev_num": log_pagination.prev_num,
                "next_num": log_pagination.next_num
            }
        })
    else:
        return render_template("admin/view_trigger_logs.html",
                               logs=logs,
                               pagination=log_pagination,
                               search_query=search_query) 