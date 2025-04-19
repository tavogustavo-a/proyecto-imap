# app/admin/admin_services.py

from flask import (
    request, redirect, url_for, flash, render_template, jsonify, current_app
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
                "border_color": al.border_color,
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
        border_color = data.get("border_color", "#333")

        if not name:
            return jsonify({"status": "error", "message": "Falta el nombre del servicio."}), 400

        existing = ServiceModel.query.filter_by(name=name).first()
        if existing:
            return jsonify({"status": "error", "message": f"El servicio '{name}' ya existe."}), 400

        new_srv = ServiceModel(
            name=name,
            color="black",
            border_color=border_color,
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
                "border_color": al.border_color,
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
        new_border = request.form.get("border_color", "#333").strip()
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

        srv.border_color = new_border
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
        alias_color = data.get("alias_color", "#333")

        if not alias_name:
            return jsonify({"status": "error", "message": "El alias está vacío."}), 400

        from app.services.alias_service import create_service_alias
        new_alias = create_service_alias(service_id, alias_name, alias_color)
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
        new_color = data.get("alias_color", "#333")

        from app.services.alias_service import update_service_alias
        alias_obj = update_service_alias(alias_id, new_name, new_color)
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
        return _refresh_services()
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
            pass

        service.border_color = new_color
        db.session.commit()
        current_app.logger.info(f"Color del servicio ID {service_id} actualizado a {new_color}")
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
