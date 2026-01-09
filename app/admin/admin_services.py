# app/admin/admin_services.py

from flask import (
    request, redirect, url_for, flash, render_template, jsonify, current_app, session
)
from .admin_bp import admin_bp
from app.extensions import db
from app.models import (
    ServiceModel,
    RegexModel,
    FilterModel,
    ServiceAlias,
    ServiceIcon,
    AliasIcon
)
from app.admin.decorators import admin_required
from app.services.alias_service import (
    create_service_alias,
    update_service_alias,
    delete_service_alias
)
import re
from sqlalchemy.orm import joinedload, selectinload
import os # Necesario para listar archivos

@admin_bp.route("/services", methods=["GET"])
@admin_required
def services_page():
    service_search = request.args.get("service_search", "").strip().lower()
    srv_q = ServiceModel.query
    if service_search:
        srv_q = srv_q.filter(ServiceModel.name.ilike(f"%{service_search}%"))

    services_list = srv_q.order_by(ServiceModel.id.desc()).all()
    return render_template("services.html", services=services_list)

@admin_bp.route("/search_services_ajax", methods=["GET"])
@admin_required
def search_services_ajax():
    query = request.args.get("query", "").strip().lower()
    srv_q = ServiceModel.query.options(
        selectinload(ServiceModel.aliases).selectinload(ServiceAlias.alias_icons),
        selectinload(ServiceModel.service_icons)
    )
    if query:
        srv_q = srv_q.filter(ServiceModel.name.ilike(f"%{query}%"))

    all_srv = srv_q.order_by(ServiceModel.id.desc()).all()
    data = []
    for s in all_srv:
        alias_list = []
        for al in s.aliases:
            alias_icons_data = []
            for ali_icon in al.alias_icons:
                alias_icons_data.append({
                    "id": ali_icon.id,
                    "icon_name": ali_icon.icon_name
                })
            alias_list.append({
                "id": al.id,
                "alias_name": al.alias_name,
                "alias_color": al.border_color,  # Color 1 del degradado
                "alias_color2": al.gradient_color,  # Color 2 del degradado
                "alias_icons": alias_icons_data
            })

        service_icons_data = []
        for si in s.service_icons:
            service_icons_data.append({
                "id": si.id,
                "icon_name": si.icon_name
            })

        data.append({
            "id": s.id,
            "name": s.name,
            "color": s.color,
            "border_color": s.border_color,
            "position": s.position,
            "protected": s.protected,
            "visibility_mode": s.visibility_mode,
            "service_icons": service_icons_data,
            "aliases": alias_list
        })

    return jsonify({"status": "ok", "services": data}), 200

@admin_bp.route("/create_service_ajax", methods=["POST"])
@admin_required
def create_service_ajax():
    try:
        data = request.get_json()
        name = data.get("name", "").strip()
        border_color = data.get("border_color", "#764ba2")
        gradient_color = data.get("gradient_color", "#667eea")
        click_color1 = data.get("click_color1", "#031faa")
        click_color2 = data.get("click_color2", "#031faa")

        if not name:
            return jsonify({"status": "error", "message": "Falta el nombre del servicio."}), 400

        existing = ServiceModel.query.filter_by(name=name).first()
        if existing:
            return jsonify({"status": "error", "message": f"El servicio '{name}' ya existe."}), 400

        new_srv = ServiceModel(
            name=name,
            color="black",
            border_color=border_color,
            gradient_color=gradient_color,
            click_color1=click_color1,
            click_color2=click_color2,
            position=0,
            protected=False,
            visibility_mode="off"
        )
        db.session.add(new_srv)
        db.session.commit()

        return jsonify({"status": "ok", "message": f"Servicio '{name}' creado."}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@admin_bp.route("/toggle_service_visibility_ajax", methods=["POST"])
@admin_required
def toggle_service_visibility_ajax():
    try:
        data = request.get_json()
        service_id = data.get("service_id")
        new_state = data.get("new_state")

        srv = ServiceModel.query.get_or_404(service_id)
        srv.visibility_mode = new_state
        db.session.commit()

        return _refresh_services()
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/delete_service_ajax", methods=["POST"])
@admin_required
def delete_service_ajax():
    try:
        data = request.get_json()
        service_id = data.get("service_id")
        srv = ServiceModel.query.get_or_404(service_id)
        if srv.protected:
            return jsonify({"status": "error", "message": "Servicio protegido, no se puede eliminar."}), 400

        db.session.delete(srv)
        db.session.commit()
        return _refresh_services()
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

def _refresh_services():
    all_srv = ServiceModel.query.order_by(ServiceModel.id.desc()).all()
    output = []
    for s in all_srv:
        alias_list = []
        for al in s.aliases:
            alias_icons_data = []
            for ali_icon in al.alias_icons:
                alias_icons_data.append({
                    "id": ali_icon.id,
                    "icon_name": ali_icon.icon_name
                })
            alias_list.append({
                "id": al.id,
                "alias_name": al.alias_name,
                "alias_color": al.border_color,  # Color 1 del degradado
                "alias_color2": al.gradient_color,  # Color 2 del degradado
                "alias_icons": alias_icons_data
            })

        service_icons_data = []
        for si in s.service_icons:
            service_icons_data.append({
                "id": si.id,
                "icon_name": si.icon_name
            })

        output.append({
            "id": s.id,
            "name": s.name,
            "color": s.color,
            "border_color": s.border_color,
            "position": s.position,
            "protected": s.protected,
            "visibility_mode": s.visibility_mode,
            "service_icons": service_icons_data,
            "aliases": alias_list
        })
    return jsonify({"status": "ok", "services": output})

# =========== Vincular Regex / Filtros ===========

@admin_bp.route("/list_regex_names", methods=["GET"])
@admin_required
def list_regex_names():
    all_rx = RegexModel.query.all()
    data = []
    for rx in all_rx:
        data.append({
            "id": rx.id,
            "pattern": rx.pattern,
            "description": rx.description or ""
        })
    return jsonify({"status": "ok", "regex": data})

@admin_bp.route("/list_filter_names", methods=["GET"])
@admin_required
def list_filter_names():
    all_ft = FilterModel.query.all()
    data = []
    for f in all_ft:
        data.append({
            "id": f.id,
            "keyword": f.keyword or "",
            "sender": f.sender or ""
        })
    return jsonify({"status": "ok", "filters": data})

@admin_bp.route("/link_service_ajax", methods=["POST"])
@admin_required
def link_service_ajax():
    try:
        data = request.get_json()
        service_id = data.get("service_id")
        regex_id = data.get("regex_id")
        filter_id = data.get("filter_id")

        srv = ServiceModel.query.get_or_404(service_id)

        if regex_id:
            rx = RegexModel.query.get_or_404(regex_id)
            if rx not in srv.regexes:
                srv.regexes.append(rx)
                db.session.commit()
            return jsonify({"status": "ok", "message": "Regex vinculado"}), 200
        elif filter_id:
            ft = FilterModel.query.get_or_404(filter_id)
            if ft not in srv.filters:
                srv.filters.append(ft)
                db.session.commit()
            return jsonify({"status": "ok", "message": "Filtro vinculado"}), 200
        else:
            return jsonify({"status": "error", "message": "No se indicó regex_id o filter_id."}), 400
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/unlink_service_ajax", methods=["POST"])
@admin_required
def unlink_service_ajax():
    try:
        data = request.get_json()
        service_id = data.get("service_id")
        filter_id = data.get("filter_id")
        regex_id = data.get("regex_id")

        srv = ServiceModel.query.get_or_404(service_id)

        if filter_id:
            f = FilterModel.query.get_or_404(filter_id)
            if f in srv.filters:
                srv.filters.remove(f)
                db.session.commit()
            return jsonify({"status": "ok", "message": "Filtro desvinculado."}), 200

        if regex_id:
            r = RegexModel.query.get_or_404(regex_id)
            if r in srv.regexes:
                srv.regexes.remove(r)
                db.session.commit()
            return jsonify({"status": "ok", "message": "Regex desvinculado."}), 200

        return jsonify({"status": "error", "message": "No se indicó filter_id ni regex_id."}), 400
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

# =========== Editar Servicio (solo alias) ===========
@admin_bp.route("/edit_service/<int:service_id>", methods=["GET","POST"])
@admin_required
def edit_service(service_id):
    srv = ServiceModel.query.get_or_404(service_id)
    if request.method == "POST":
        new_name = request.form.get("service_name", srv.name).strip()
        new_position_str = request.form.get("position", "0").strip()
        new_vis_mode = request.form.get("visibility_mode", "off").strip()

        if new_name != srv.name and not (srv.protected and srv.name == "Pais Netflix"):
            existing_conflict = ServiceModel.query.filter_by(name=new_name).first()
            if existing_conflict and existing_conflict.id != srv.id:
                flash("Ya existe un servicio con ese nombre.", "danger")
                return redirect(url_for("admin_bp.edit_service", service_id=srv.id))

            if not (srv.protected and srv.name == "Pais Netflix"):
                srv.name = new_name

        try:
            new_position = int(new_position_str)
        except ValueError:
            flash("La posición debe ser un número entero.", "danger")
            return redirect(url_for("admin_bp.edit_service", service_id=srv.id))

        conflict_srv = ServiceModel.query.filter_by(position=new_position).first()
        if conflict_srv and conflict_srv.id != srv.id:
            flash(f"La posición {new_position} ya está ocupada por '{conflict_srv.name}'.", "danger")
            return redirect(url_for("admin_bp.edit_service", service_id=srv.id))

        # Validar unicidad para on-no-usuarios-no-visible
        if new_vis_mode == "on-no-usuarios-no-visible":
            existing_no_visible = ServiceModel.query.filter(
                ServiceModel.visibility_mode == "on-no-usuarios-no-visible",
                ServiceModel.id != srv.id
            ).first()
            
            if existing_no_visible:
                flash(f"❌ Error: Solo puede haber un servicio con modo 'on-no-usuarios-no-visible'. El servicio '{existing_no_visible.name}' ya tiene este modo activo. Cambia primero ese servicio a otro modo.", "danger")
                return redirect(url_for("admin_bp.edit_service", service_id=srv.id))
        
        # Validar unicidad para sms
        if new_vis_mode == "sms":
            existing_sms = ServiceModel.query.filter(
                ServiceModel.visibility_mode == "sms",
                ServiceModel.id != srv.id
            ).first()
            
            if existing_sms:
                flash(f"❌ Error: Solo puede haber un servicio con modo 'sms'. El servicio '{existing_sms.name}' ya tiene este modo activo. Cambia primero ese servicio a otro modo.", "danger")
                return redirect(url_for("admin_bp.edit_service", service_id=srv.id))
        
        # Validar conflictos entre on-no-usuarios y on-no-usuarios-no-visible
        if new_vis_mode == "on-no-usuarios-no-visible":
            conflicting_usuarios = ServiceModel.query.filter(
                ServiceModel.visibility_mode == "on-no-usuarios",
                ServiceModel.id != srv.id
            ).all()
            
            if conflicting_usuarios:
                service_names = [s.name for s in conflicting_usuarios]
                flash(f"❌ Error: No puedes activar 'on-no-usuarios-no-visible' porque hay servicios con 'on-no-usuarios' activos: {', '.join(service_names)}. Cambia primero esos servicios a 'off'.", "danger")
                return redirect(url_for("admin_bp.edit_service", service_id=srv.id))
                
        elif new_vis_mode == "on-no-usuarios":
            conflicting_no_visible = ServiceModel.query.filter(
                ServiceModel.visibility_mode == "on-no-usuarios-no-visible",
                ServiceModel.id != srv.id
            ).all()
            
            if conflicting_no_visible:
                service_names = [s.name for s in conflicting_no_visible]
                flash(f"❌ Error: No puedes activar 'on-no-usuarios' porque hay servicios con 'on-no-usuarios-no-visible' activos: {', '.join(service_names)}. Cambia primero esos servicios a 'off'.", "danger")
                return redirect(url_for("admin_bp.edit_service", service_id=srv.id))

        srv.position = new_position
        srv.visibility_mode = new_vis_mode

        try:
            db.session.commit()
            flash("Servicio actualizado.", "success")
        except Exception as e:
            db.session.rollback()
            flash(f"Error al actualizar: {e}", "danger")

        return redirect(url_for("admin_bp.services_page"))

    return render_template("edit_service.html", srv=srv)

# =========== ALIAS y ALIAS ICONS ===========
@admin_bp.route("/create_alias_ajax", methods=["POST"])
@admin_required
def create_alias_ajax():
    try:
        data = request.get_json()
        service_id = data.get("service_id")
        alias_name = data.get("alias_name", "").strip()
        alias_color = data.get("alias_color", "#000000")

        if not alias_name:
            return jsonify({"status": "error", "message": "El alias está vacío."}), 400

        from app.services.alias_service import create_service_alias
        
        # Obtener colores globales actuales para alias
        alias_with_color = ServiceAlias.query.filter(
            ServiceAlias.border_color.isnot(None)
        ).order_by(ServiceAlias.id.desc()).first()
        
        default_color1 = alias_with_color.border_color if alias_with_color else "#000000"
        default_color2 = alias_with_color.gradient_color if alias_with_color else "#000000"
        
        new_alias = create_service_alias(service_id, alias_name, default_color1, default_color2)
        db.session.refresh(new_alias)
        return _refresh_services()
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@admin_bp.route("/update_alias_ajax", methods=["POST"])
@admin_required
def update_alias_ajax():
    try:
        data = request.get_json()
        alias_id = data.get("alias_id")
        new_name = data.get("alias_name", "").strip()

        from app.services.alias_service import update_service_alias_name_only
        alias_obj = update_service_alias_name_only(alias_id, new_name)
        db.session.refresh(alias_obj)
        return _refresh_services()
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@admin_bp.route("/delete_alias_ajax", methods=["POST"])
@admin_required
def delete_alias_ajax():
    try:
        data = request.get_json()
        alias_id = data.get("alias_id")
        from app.services.alias_service import delete_service_alias
        delete_service_alias(alias_id)
        return _refresh_services()
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

# =========== SERVICE ICONS ===========
@admin_bp.route("/create_service_icon_ajax", methods=["POST"])
@admin_required
def create_service_icon_ajax():
    try:
        data = request.get_json()
        service_id = data.get("service_id")
        icon_name = data.get("icon_name", "").strip()
        if not icon_name:
            return jsonify({"status": "error", "message": "No se indicó icon_name"}), 400

        new_icon = ServiceIcon(service_id=service_id, icon_name=icon_name)
        db.session.add(new_icon)
        db.session.commit()
        return _refresh_services()
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/delete_service_icon_ajax", methods=["POST"])
@admin_required
def delete_service_icon_ajax():
    try:
        data = request.get_json()
        icon_id = data.get("icon_id")
        si = ServiceIcon.query.get_or_404(icon_id)
        db.session.delete(si)
        db.session.commit()
        return _refresh_services()
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/create_alias_icon_ajax", methods=["POST"])
@admin_required
def create_alias_icon_ajax():
    try:
        data = request.get_json()
        alias_id = data.get("alias_id")
        icon_name = data.get("icon_name", "").strip()
        if not icon_name:
            return jsonify({"status": "error", "message": "No se indicó icon_name"}), 400

        new_icon = AliasIcon(alias_id=alias_id, icon_name=icon_name)
        db.session.add(new_icon)
        db.session.commit()
        return _refresh_services()
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@admin_bp.route("/delete_alias_icon_ajax", methods=["POST"])
@admin_required
def delete_alias_icon_ajax():
    try:
        data = request.get_json()
        icon_id = data.get("icon_id")
        ai = AliasIcon.query.get_or_404(icon_id)
        db.session.delete(ai)
        db.session.commit()
        return jsonify({"status": "ok", "message": "Ícono de alias eliminado."}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

# --- NUEVA RUTA PARA ACTUALIZAR COLOR VIA AJAX ---
@admin_bp.route('/update_service_color_ajax', methods=['POST'])
@admin_required
def update_service_color_ajax():
    data = request.get_json()
    if not data:
        return jsonify(status='error', message='No se recibieron datos JSON.'), 400

    service_id = data.get('service_id')
    new_color = data.get('border_color')

    if not service_id or new_color is None:
        return jsonify(status='error', message='Faltan datos (ID de servicio o color).'), 400

    try:
        service_id = int(service_id)
    except ValueError:
        return jsonify(status='error', message='ID de servicio inválido.'), 400

    service = ServiceModel.query.get(service_id)
    if not service:
        return jsonify(status='error', message='Servicio no encontrado.'), 404

    if not isinstance(new_color, str) or not re.match(r'^#[0-9a-fA-F]{6}$', new_color):
        return jsonify(status='error', message=f'Formato de color inválido: {new_color}'), 400

    try:
        if service.protected and service.name == "Pais Netflix":
            # Pais Netflix usa colores globales, no individuales
            return jsonify(status='ok', message='Pais Netflix usa colores globales automáticamente.')

        service.border_color = new_color
        db.session.commit()

        return jsonify(status='ok', message='Color actualizado.')
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al actualizar color del servicio {service_id}: {e}")
        return jsonify(status='error', message='Error interno al guardar el color.'), 500
# --- FIN NUEVA RUTA ---

# =========== NUEVA RUTA PARA LISTAR ICONOS ===========
@admin_bp.route("/list_icons_ajax", methods=["GET"])
@admin_required
def list_icons_ajax():
    """
    Lista los nombres de archivo de imágenes (.png, .jpg, .svg, etc.)
    encontrados en la carpeta 'static/images/'.
    """
    try:
        # Construir la ruta absoluta a la carpeta de imágenes estáticas
        image_folder_path = os.path.join(current_app.static_folder, 'images')

        if not os.path.isdir(image_folder_path):
            current_app.logger.error(f"La carpeta de imágenes no existe: {image_folder_path}")
            return jsonify({"status": "error", "message": "Carpeta de imágenes no encontrada."}), 404

        allowed_extensions = ('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico')
        icon_files = []
        for filename in os.listdir(image_folder_path):
            if os.path.isfile(os.path.join(image_folder_path, filename)) and \
               filename.lower().endswith(allowed_extensions):
                icon_files.append(filename)

        icon_files.sort()

        return jsonify({"status": "ok", "icons": icon_files})

    except Exception as e:
        current_app.logger.error(f"Error al listar iconos: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno al listar iconos."}), 500

@admin_bp.route("/update_service_gradient_ajax", methods=["POST"])
@admin_required
def update_service_gradient_ajax():
    """
    Actualiza el degradado de colores de un servicio (border_color y gradient_color)
    """
    try:
        data = request.get_json()
        service_id = data.get("service_id")
        border_color = data.get("border_color", "#764ba2")
        gradient_color = data.get("gradient_color", "#667eea")

        if not service_id:
            return jsonify({"status": "error", "message": "ID de servicio requerido."}), 400

        service = ServiceModel.query.get_or_404(service_id)
        
        # Verificar si es Pais Netflix (protegido)
        if service.protected and service.name == "Pais Netflix":
            return jsonify({"status": "ok", "message": "Pais Netflix usa colores globales automáticamente."}), 200
        
        service.border_color = border_color
        service.gradient_color = gradient_color
        db.session.commit()

        return jsonify({"status": "ok", "message": f"Degradado del servicio '{service.name}' actualizado."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error actualizando degradado del servicio: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno al actualizar el degradado."}), 500

@admin_bp.route("/sync_netflix_colors_ajax", methods=["POST"])
@admin_required
def sync_netflix_colors_ajax():
    """
    Sincroniza los colores de 'Pais Netflix' con los colores globales configurados
    """
    try:
        data = request.get_json()
        normal_color1 = data.get("normal_color1", "#764ba2")
        normal_color2 = data.get("normal_color2", "#667eea")
        click_color1 = data.get("click_color1", "#031faa")
        click_color2 = data.get("click_color2", "#031faa")

        # Buscar el servicio Pais Netflix
        netflix_service = ServiceModel.query.filter_by(name="Pais Netflix", protected=True).first()
        
        if not netflix_service:
            return jsonify({"status": "error", "message": "Servicio 'Pais Netflix' no encontrado."}), 404

        # Actualizar con los colores globales
        netflix_service.border_color = normal_color1
        netflix_service.gradient_color = normal_color2
        netflix_service.click_color1 = click_color1
        netflix_service.click_color2 = click_color2
        
        db.session.commit()

        return jsonify({"status": "ok", "message": "Colores de Pais Netflix sincronizados con configuración global."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error sincronizando colores de Pais Netflix: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno al sincronizar colores."}), 500

@admin_bp.route("/save_global_alias_colors_ajax", methods=["POST"])
@admin_required
def save_global_alias_colors_ajax():
    """Guarda los colores globales para alias"""
    try:
        data = request.get_json()
        color1 = data.get("color1", "#000000")
        color2 = data.get("color2", "#000000")
        
        # Actualizar todos los alias existentes con los nuevos colores
        from app.models.alias import ServiceAlias
        aliases = ServiceAlias.query.all()
        for alias in aliases:
            alias.border_color = color1      # Color 1 del degradado
            alias.gradient_color = color2    # Color 2 del degradado
        
        db.session.commit()
        
        return jsonify({
            "status": "ok",
            "message": "Colores de alias guardados correctamente"
        })
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error guardando colores globales de alias: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno al guardar colores de alias."}), 500

@admin_bp.route("/save_global_click_colors_ajax", methods=["POST"])
def save_global_click_colors_ajax():
    """Guarda los colores globales para cuando se da clic"""
    try:
        data = request.get_json()
        color1 = data.get("color1", "#031faa")
        color2 = data.get("color2", "#031faa")
        
        # Actualizar todos los servicios con los nuevos colores de clic
        services = ServiceModel.query.all()
        for service in services:
            service.click_color1 = color1
            service.click_color2 = color2
        
        db.session.commit()
        
        return jsonify({
            "status": "ok",
            "message": "Colores de clic guardados correctamente"
        })
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error guardando colores globales de clic: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno al guardar colores de clic."}), 500

@admin_bp.route("/save_global_normal_colors_ajax", methods=["POST"])
def save_global_normal_colors_ajax():
    """Guarda los colores globales para sin darle clic (normales)"""
    try:
        data = request.get_json()
        color1 = data.get("color1", "#764ba2")
        color2 = data.get("color2", "#667eea")
        
        # Actualizar todos los servicios con los nuevos colores normales
        services = ServiceModel.query.all()
        for service in services:
            service.border_color = color1
            service.gradient_color = color2
        
        db.session.commit()
        
        return jsonify({
            "status": "ok",
            "message": "Colores normales guardados correctamente"
        })
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error guardando colores globales normales: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno al guardar colores normales."}), 500

@admin_bp.route("/get_global_colors_ajax", methods=["GET"])
@admin_required
def get_global_colors_ajax():
    """Obtiene los colores globales actuales"""
    try:
        # Obtener colores más recientes de servicios (excluyendo NULL)
        from app.models.alias import ServiceAlias
        
        # Para colores normales, buscar el servicio más reciente con colores definidos
        service_with_normal = ServiceModel.query.filter(
            ServiceModel.border_color.isnot(None),
            ServiceModel.gradient_color.isnot(None)
        ).order_by(ServiceModel.id.desc()).first()
        
        # Para colores de clic, buscar el servicio más reciente con colores de clic definidos
        service_with_click = ServiceModel.query.filter(
            ServiceModel.click_color1.isnot(None),
            ServiceModel.click_color2.isnot(None)
        ).order_by(ServiceModel.id.desc()).first()
        
        # Para colores de alias, buscar el alias más reciente con color definido
        alias_with_color = ServiceAlias.query.filter(
            ServiceAlias.border_color.isnot(None)
        ).order_by(ServiceAlias.id.desc()).first()
        
        # Valores por defecto
        normal_colors = {
            "color1": service_with_normal.border_color if service_with_normal else "#764ba2",
            "color2": service_with_normal.gradient_color if service_with_normal else "#667eea"
        }
        
        click_colors = {
            "color1": service_with_click.click_color1 if service_with_click else "#031faa",
            "color2": service_with_click.click_color2 if service_with_click else "#031faa"
        }
        
        alias_colors = {
            "color1": alias_with_color.border_color if alias_with_color else "#000000",
            "color2": alias_with_color.gradient_color if alias_with_color else "#000000"
        }
        
        return jsonify({
            "status": "ok",
            "normal_colors": normal_colors,
            "click_colors": click_colors,
            "alias_colors": alias_colors
        })
        
    except Exception as e:
        current_app.logger.error(f"Error obteniendo colores globales: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno al obtener colores."}), 500

@admin_bp.route("/check_visibility_conflict_ajax", methods=["POST"])
@admin_required
def check_visibility_conflict_ajax():
    """Verifica conflictos entre modos de visibilidad on-no-usuarios y on-no-usuarios-no-visible"""
    try:
        data = request.get_json()
        conflict_mode = data.get("conflict_mode")
        current_service_id = data.get("current_service_id")
        
        # Buscar servicios con el modo conflictivo (excluyendo el servicio actual)
        conflicting_services = ServiceModel.query.filter(
            ServiceModel.visibility_mode == conflict_mode,
            ServiceModel.id != current_service_id
        ).all()
        
        if conflicting_services:
            service_names = [srv.name for srv in conflicting_services]
            return jsonify({
                "status": "conflict",
                "conflicting_services": service_names,
                "message": f"Hay servicios con modo '{conflict_mode}' activos"
            })
        else:
            return jsonify({
                "status": "ok",
                "message": "No hay conflictos de visibilidad"
            })
            
    except Exception as e:
        current_app.logger.error(f"Error verificando conflicto de visibilidad: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno al verificar conflictos."}), 500

@admin_bp.route("/check_visibility_uniqueness_ajax", methods=["POST"])
@admin_required
def check_visibility_uniqueness_ajax():
    """Verifica que solo haya un servicio con modo on-no-usuarios-no-visible o codigos-2"""
    try:
        data = request.get_json()
        mode = data.get("mode")
        current_service_id = data.get("current_service_id")
        
        # Solo verificar unicidad para on-no-usuarios-no-visible, codigos-2 y sms
        if mode not in ["on-no-usuarios-no-visible", "codigos-2", "sms"]:
            return jsonify({"status": "ok", "message": "Modo no requiere unicidad"})
        
        # Buscar otros servicios con el mismo modo (excluyendo el servicio actual)
        existing_service = ServiceModel.query.filter(
            ServiceModel.visibility_mode == mode,
            ServiceModel.id != current_service_id
        ).first()
        
        if existing_service:
            return jsonify({
                "status": "duplicate",
                "existing_service": existing_service.name,
                "message": f"Ya existe un servicio con modo '{mode}'"
            })
        else:
            return jsonify({
                "status": "ok",
                "message": "No hay duplicados"
            })
            
    except Exception as e:
        current_app.logger.error(f"Error verificando unicidad de visibilidad: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Error interno al verificar unicidad."}), 500
