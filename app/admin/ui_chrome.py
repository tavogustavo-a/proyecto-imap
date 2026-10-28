# Colores de menús, iconos y tienda. Los guarda «Sin darle clic» y «Cuando se da clic».

from app.models.service import (
    CODIGOS_CLICK_COLOR1,
    CODIGOS_CLICK_COLOR2,
    CODIGOS_NORMAL_COLOR1,
    CODIGOS_NORMAL_COLOR2,
    UI_CLICK_DARK,
)

_HEX = set("0123456789abcdef")


def safe_hex(value, fallback):
    if not isinstance(value, str):
        return fallback
    v = value.strip().lower()
    if len(v) == 7 and v[0] == "#" and all(c in _HEX for c in v[1:]):
        return v
    return fallback


def get_ui_chrome_colors():
    """Colores globales de la interfaz. Si aún no se guardaron, usa los del servicio más reciente."""
    from app.models.settings import SiteSettings

    keys = (
        "ui_static_color1",
        "ui_static_color2",
        "ui_click_color1",
        "ui_click_color2",
        "ui_click_dark",
    )
    found = {}
    try:
        rows = SiteSettings.query.filter(SiteSettings.key.in_(keys)).all()
        found = {row.key: row.value for row in rows}
    except Exception:
        found = {}

    static1 = found.get("ui_static_color1")
    static2 = found.get("ui_static_color2")
    click1 = found.get("ui_click_color1")
    click2 = found.get("ui_click_color2")
    click_dark = found.get("ui_click_dark")

    if not (static1 and static2 and click1 and click2):
        try:
            from app.models.service import ServiceModel

            service = (
                ServiceModel.query.filter(
                    ServiceModel.border_color.isnot(None),
                    ServiceModel.gradient_color.isnot(None),
                )
                .order_by(ServiceModel.id.desc())
                .first()
            )
            if service:
                static1 = static1 or service.border_color
                static2 = static2 or service.gradient_color
                click1 = click1 or service.click_color1
                click2 = click2 or service.click_color2
        except Exception:
            pass

    return {
        "static1": safe_hex(static1, CODIGOS_NORMAL_COLOR1),
        "static2": safe_hex(static2, CODIGOS_NORMAL_COLOR2),
        "click1": safe_hex(click1, CODIGOS_CLICK_COLOR1),
        "click2": safe_hex(click2, CODIGOS_CLICK_COLOR2),
        "click_dark": safe_hex(click_dark, UI_CLICK_DARK),
    }


def save_ui_static_colors(color1, color2):
    from app.admin.site_settings import set_site_setting

    set_site_setting("ui_static_color1", color1)
    set_site_setting("ui_static_color2", color2)


def save_ui_click_colors(color1, color2, color_dark):
    from app.admin.site_settings import set_site_setting

    set_site_setting("ui_click_color1", color1)
    set_site_setting("ui_click_color2", color2)
    set_site_setting("ui_click_dark", color_dark)
