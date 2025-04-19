# app/admin/admin_settings.py

import os
from datetime import datetime
from flask import (
    render_template, request, redirect,
    url_for, flash, current_app, jsonify
)
from . import admin_bp
from app.extensions import db
from app.models import (
    SiteSettings, IMAPServer, FilterModel,
    RegexModel, User, DomainModel
)
from app.admin.site_settings import (
    get_site_setting, set_site_setting
)
from app.services.domain_service import (
    get_all_domains
)
from app.admin.decorators import admin_required

@admin_bp.route("/")
@admin_required
def dashboard():
    imap_search = request.args.get("imap_search", "").strip().lower()
    servers_query = IMAPServer.query
    if imap_search:
        servers_query = servers_query.filter(
            (IMAPServer.host.ilike(f"%{imap_search}%"))
            | (IMAPServer.username.ilike(f"%{imap_search}%"))
        )
    servers = servers_query.all()

    # Estos valores se usan en la vista "admin_dashboard.html"
    paragraph_item = SiteSettings.query.filter_by(key="search_message").first()
    paragraph = paragraph_item.value if paragraph_item else ""
    paragraph_mode = get_site_setting("search_message_mode", "off")  # => 'off' o 'guests'

    paragraph2_item = SiteSettings.query.filter_by(key="search_message2").first()
    paragraph2 = paragraph2_item.value if paragraph2_item else ""
    paragraph2_mode = get_site_setting("search_message2_mode", "off")  # => 'off' o 'users'

    lg = SiteSettings.query.filter_by(key="logo_enabled").first()
    logo_enabled = lg.value if lg else "true"

    op = SiteSettings.query.filter_by(key="card_opacity").first()
    card_opacity = op.value if op else "0.8"

    th = SiteSettings.query.filter_by(key="current_theme").first()
    current_theme = th.value if th else "tema1"

    admin_user = User.query.filter_by(username=current_app.config["ADMIN_USER"]).first()

    return render_template(
        "admin_dashboard.html",
        servers=servers,
        paragraph=paragraph,
        paragraph_mode=paragraph_mode,
        paragraph2=paragraph2,
        paragraph2_mode=paragraph2_mode,
        logo_enabled=logo_enabled,
        card_opacity=card_opacity,
        current_theme=current_theme,
        admin_user=admin_user
    )

@admin_bp.route("/filters")
@admin_required
def filters_page():
    filter_search = request.args.get("filter_search", "").strip().lower()
    domains = get_all_domains()

    filters_query = FilterModel.query
    if filter_search:
        filters_query = filters_query.filter(
            (FilterModel.sender.ilike(f"%{filter_search}%"))
            | (FilterModel.keyword.ilike(f"%{filter_search}%"))
        )
    filters_list = filters_query.all()

    return render_template(
        "filters.html",
        domains=domains,
        filters=filters_list,
        filter_search=filter_search
    )

@admin_bp.route("/regex")
@admin_required
def regex_page():
    regex_search = request.args.get("regex_search", "").strip().lower()

    regexes_query = RegexModel.query
    if regex_search:
        regexes_query = regexes_query.filter(
            (RegexModel.sender.ilike(f"%{regex_search}%"))
            | (RegexModel.pattern.ilike(f"%{regex_search}%"))
            | (RegexModel.description.ilike(f"%{regex_search}%"))
        )
    regex_list = regexes_query.all()

    return render_template(
        "regex.html",
        regexes=regex_list,
        regex_search=regex_search
    )

@admin_bp.route("/parrafos", methods=["GET"])
@admin_required
def parrafos_page():
    """
    Muestra la configuración de Párrafo 1 y 2:
    - P1 => 'off' o 'guests'
    - P2 => 'off' o 'users'
    """
    paragraph_item = SiteSettings.query.filter_by(key="search_message").first()
    paragraph = paragraph_item.value if paragraph_item else ""
    paragraph_mode = get_site_setting("search_message_mode", "off")

    paragraph2_item = SiteSettings.query.filter_by(key="search_message2").first()
    paragraph2 = paragraph2_item.value if paragraph2_item else ""
    paragraph2_mode = get_site_setting("search_message2_mode", "off")

    return render_template(
        "parrafos.html",
        paragraph=paragraph,
        paragraph_mode=paragraph_mode,
        paragraph2=paragraph2,
        paragraph2_mode=paragraph2_mode
    )

@admin_bp.route("/update_paragraph/<int:num_paragraph>", methods=["POST"])
@admin_required
def update_paragraph(num_paragraph):
    new_paragraph = request.form.get("paragraph", "")
    key = "search_message" if num_paragraph == 1 else "search_message2"

    item = SiteSettings.query.filter_by(key=key).first()
    if not item:
        item = SiteSettings(key=key, value=new_paragraph)
        db.session.add(item)
    else:
        item.value = new_paragraph
    db.session.commit()

    flash(f"Párrafo {num_paragraph} actualizado.", "success")
    return redirect(url_for("admin_bp.parrafos_page"))

@admin_bp.route("/cycle_paragraph_mode/<int:num_paragraph>", methods=["POST"])
@admin_required
def cycle_paragraph_mode(num_paragraph):
    """
    Párrafo 1 => alterna entre [off, guests]
    Párrafo 2 => alterna entre [off, users]
    """
    if num_paragraph == 1:
        mode_key = "search_message_mode"
        current_mode = get_site_setting(mode_key, "off")
        # Toggle: 'off' <-> 'guests'
        if current_mode == "off":
            new_mode = "guests"
        else:
            new_mode = "off"
        set_site_setting(mode_key, new_mode)

    elif num_paragraph == 2:
        mode_key = "search_message2_mode"
        current_mode = get_site_setting(mode_key, "off")
        # Toggle: 'off' <-> 'users'
        if current_mode == "off":
            new_mode = "users"
        else:
            new_mode = "off"
        set_site_setting(mode_key, new_mode)

    return redirect(url_for("admin_bp.parrafos_page"))

@admin_bp.route("/toggle_logo", methods=["POST"])
@admin_required
def toggle_logo():
    item = SiteSettings.query.filter_by(key="logo_enabled").first()
    if not item:
        item = SiteSettings(key="logo_enabled", value="true")
        db.session.add(item)
        db.session.commit()

    new_val = "false" if item.value == "true" else "true"
    item.value = new_val
    db.session.commit()

    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/set_opacity", methods=["POST"])
@admin_required
def set_opacity():
    new_opacity = request.form.get("card_opacity", "0.8")
    item = SiteSettings.query.filter_by(key="card_opacity").first()
    if not item:
        item = SiteSettings(key="card_opacity", value=new_opacity)
        db.session.add(item)
    else:
        item.value = new_opacity
    db.session.commit()

    flash(f"Cambió opacidad a {new_opacity}", "info")
    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/change_theme", methods=["POST"])
@admin_required
def change_theme():
    theme = request.form.get("theme", "tema1")
    item = SiteSettings.query.filter_by(key="current_theme").first()
    if not item:
        item = SiteSettings(key="current_theme", value=theme)
        db.session.add(item)
    else:
        item.value = theme
    db.session.commit()

    flash(f"Tema cambiado a {theme}", "info")
    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/logout_all_users", methods=["POST"])
@admin_required
def logout_all_users():
    from app.models import RememberDevice
    RememberDevice.query.delete()
    db.session.commit()

    rev_str = get_site_setting("session_revocation_count", "0")
    new_count = int(rev_str) + 1
    set_site_setting("session_revocation_count", str(new_count))

    flash("Se han cerrado las sesiones de todos los usuarios.", "info")
    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/toggle_dark_mode", methods=["POST"])
@admin_required
def toggle_dark_mode():
    current_val = get_site_setting("dark_mode", "false")
    new_val = "false" if current_val == "true" else "true"
    set_site_setting("dark_mode", new_val)
    flash(f"Modo oscuro: {new_val}", "info")
    return redirect(url_for("admin_bp.dashboard"))

@admin_bp.route("/change_gif", methods=["POST"])
@admin_required
def change_gif():
    gif_name = request.form.get("gif_name", "none")
    set_site_setting("current_gif", gif_name)
    flash(f"Gif cambiado a {gif_name}", "info")
    return redirect(url_for("admin_bp.dashboard"))
