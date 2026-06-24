"""Inventario proveedor en user_prices: lectura, guardado y limpieza en cascada."""

from __future__ import annotations

from sqlalchemy.orm.attributes import flag_modified

PROVEEDOR_INVENTORY_KEYS = (
    'proveedor_license_lines',
    'proveedor_license_notes',
    'proveedor_day_lines',
    'proveedor_day_notepads',
    'proveedor_expired_lines',
    'proveedor_expired_notes',
    'proveedor_suspended_lines',
    'proveedor_suspended_notes',
)

PROVEEDOR_PURGE_KEYS = PROVEEDOR_INVENTORY_KEYS + ('proveedor_services',)


def clear_proveedor_daily_summaries_for_user(user_obj) -> None:
    from app.store.proveedor_daily_summaries import _save_summaries_map

    if not user_obj:
        return
    _save_summaries_map(user_obj, {})


def purge_proveedor_keys_from_prices(user_prices, *, remove_flag: bool = True) -> dict:
    """Devuelve copia de user_prices sin datos proveedor (inventario, servicios, resúmenes)."""
    up = dict(user_prices) if isinstance(user_prices, dict) else {}
    for key in PROVEEDOR_PURGE_KEYS:
        up.pop(key, None)
    up.pop('proveedor_daily_summaries', None)
    if remove_flag:
        up.pop('proveedor', None)
    return up


def purge_proveedor_data_for_user(user_obj, *, remove_flag: bool = True) -> None:
    """
    Elimina todos los datos proveedor del usuario (inventario, servicios, resúmenes diarios).
    No mueve líneas a Caídas ni Vencidas.
    """
    if not user_obj:
        return
    user_obj.user_prices = purge_proveedor_keys_from_prices(user_obj.user_prices, remove_flag=remove_flag)
    flag_modified(user_obj, 'user_prices')


def proveedor_inventory_from_user_prices(user_prices):
    from app.store.routes import (
        _proveedor_day_lines_to_legacy_notepads,
        _proveedor_lines_to_plain_text,
        _proveedor_normalize_day_lines_map,
        _proveedor_normalize_extra_line_entries,
        _proveedor_normalize_line_entries,
    )

    up = user_prices if isinstance(user_prices, dict) else {}
    lic_lines = _proveedor_normalize_line_entries(
        up.get('proveedor_license_lines'),
        up.get('proveedor_license_notes'),
    )
    day_lines = _proveedor_normalize_day_lines_map(
        up.get('proveedor_day_lines'),
        up.get('proveedor_day_notepads'),
    )
    expired_lines = _proveedor_normalize_extra_line_entries(
        up.get('proveedor_expired_lines'),
        up.get('proveedor_expired_notes'),
    )
    suspended_lines = _proveedor_normalize_extra_line_entries(
        up.get('proveedor_suspended_lines'),
        up.get('proveedor_suspended_notes'),
    )
    day_notepads = _proveedor_day_lines_to_legacy_notepads(day_lines)
    return {
        'license_notes': _proveedor_lines_to_plain_text(lic_lines),
        'license_lines': lic_lines,
        'day_notepads': day_notepads,
        'day_lines': day_lines,
        'expired_lines': expired_lines,
        'expired_notes': _proveedor_extra_lines_to_plain_text(expired_lines),
        'suspended_lines': suspended_lines,
        'suspended_notes': _proveedor_extra_lines_to_plain_text(suspended_lines),
    }


def proveedor_extra_lines_to_plain_text(lines):
    from app.store.routes import _proveedor_lines_to_plain_text

    return _proveedor_lines_to_plain_text(lines)


def _proveedor_extra_lines_to_plain_text(lines):
    return proveedor_extra_lines_to_plain_text(lines)


def save_proveedor_inventory_on_user(
    user_obj,
    *,
    license_lines=None,
    day_lines=None,
    expired_lines=None,
    suspended_lines=None,
    license_notes=None,
    day_notepads=None,
    expired_notes=None,
    suspended_notes=None,
):
    """
    Guarda inventario proveedor. Las líneas eliminadas de license/day NO se copian a Caídas/Vencidas.
    """
    from app.store.routes import (
        _proveedor_day_lines_to_legacy_notepads,
        _proveedor_extra_lines_to_legacy_notes,
        _proveedor_lines_to_plain_text,
        _proveedor_normalize_day_lines_map,
        _proveedor_normalize_extra_line_entries,
        _proveedor_normalize_line_entries,
    )

    if not user_obj:
        return False
    if not user_obj.user_prices:
        user_obj.user_prices = {}
    new_up = dict(user_obj.user_prices) if user_obj.user_prices else {}
    current = proveedor_inventory_from_user_prices(new_up)

    if license_lines is not None:
        lic_norm = _proveedor_normalize_line_entries(license_lines)
    elif license_notes is not None:
        lic_norm = _proveedor_normalize_line_entries(None, license_notes)
    else:
        lic_norm = list(current.get('license_lines') or [])

    if day_lines is not None:
        day_norm = _proveedor_normalize_day_lines_map(day_lines)
    elif day_notepads is not None:
        day_norm = _proveedor_normalize_day_lines_map(None, day_notepads)
    else:
        day_norm = dict(current.get('day_lines') or {})

    if expired_lines is not None:
        exp_norm = _proveedor_normalize_extra_line_entries(expired_lines)
    elif expired_notes is not None:
        exp_norm = _proveedor_normalize_extra_line_entries(None, expired_notes)
    else:
        exp_norm = list(current.get('expired_lines') or [])

    if suspended_lines is not None:
        susp_norm = _proveedor_normalize_extra_line_entries(suspended_lines)
    elif suspended_notes is not None:
        susp_norm = _proveedor_normalize_extra_line_entries(None, suspended_notes)
    else:
        susp_norm = list(current.get('suspended_lines') or [])

    new_up['proveedor_license_lines'] = lic_norm
    new_up['proveedor_day_lines'] = day_norm
    new_up['proveedor_license_notes'] = _proveedor_lines_to_plain_text(lic_norm)
    new_up['proveedor_day_notepads'] = _proveedor_day_lines_to_legacy_notepads(day_norm)
    new_up['proveedor_expired_lines'] = exp_norm
    new_up['proveedor_expired_notes'] = _proveedor_extra_lines_to_legacy_notes(exp_norm)
    new_up['proveedor_suspended_lines'] = susp_norm
    new_up['proveedor_suspended_notes'] = _proveedor_extra_lines_to_legacy_notes(susp_norm)
    user_obj.user_prices = new_up
    flag_modified(user_obj, 'user_prices')
    return True
