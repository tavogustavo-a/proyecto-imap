# -*- coding: utf-8 -*-
"""Duración de licencias por producto (días) y etiqueta para la tienda."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

DEFAULT_LICENSE_TERM_DAYS = 30

# Valor en días → clave preset (para UI)
LICENSE_TERM_PRESETS: Tuple[Tuple[str, int], ...] = (
    ('mes', 30),
    ('2_meses', 60),
    ('3_meses', 90),
    ('4_meses', 120),
    ('5_meses', 150),
    ('6_meses', 180),
    ('7_meses', 210),
    ('8_meses', 240),
    ('9_meses', 270),
    ('10_meses', 300),
    ('11_meses', 330),
    ('1_ano', 365),
    ('2_anos', 730),
)

_PRESET_DAYS = {days: preset_key for preset_key, days in LICENSE_TERM_PRESETS}


def license_term_days_public(license_row) -> int:
    """Días de vigencia de una licencia vendida; default 30 («mes»)."""
    if license_row is None:
        return DEFAULT_LICENSE_TERM_DAYS
    raw = getattr(license_row, 'license_term_days', None)
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_LICENSE_TERM_DAYS
    if n < 1:
        return DEFAULT_LICENSE_TERM_DAYS
    if n > 3650:
        return 3650
    return n


def license_term_preset_key(days: int) -> str:
    return _PRESET_DAYS.get(int(days), 'personalizado')


def license_billing_period_label(days: Optional[int]) -> str:
    """Etiqueta corta para tienda / admin («mensual», «2 meses», «60 días», …)."""
    try:
        n = int(days)
    except (TypeError, ValueError):
        n = DEFAULT_LICENSE_TERM_DAYS
    if n == 30:
        return 'mensual'
    if n == 365:
        return '1 año'
    if n == 730:
        return '2 años'
    for _key, preset_days in LICENSE_TERM_PRESETS:
        if preset_days == n and n not in (30, 365, 730):
            num = n // 30
            return f'{num} meses'
    return f'{n} días'


def license_term_ui_label(days: Optional[int]) -> str:
    """Etiqueta del botón «mes» en Gestionar productos."""
    try:
        n = int(days)
    except (TypeError, ValueError):
        return 'mes'
    if n == 30:
        return 'mes'
    if n == 365:
        return '1 año'
    if n == 730:
        return '2 años'
    for _key, preset_days in LICENSE_TERM_PRESETS:
        if preset_days == n and n not in (30, 365, 730):
            num = n // 30
            return f'{num} meses'
    return f'{n}d'


def license_term_preset_options() -> List[Dict[str, Any]]:
    """Opciones para el selector del modal admin."""
    opts: List[Dict[str, Any]] = []
    for key, days in LICENSE_TERM_PRESETS:
        opts.append({
            'key': key,
            'days': days,
            'label': license_term_ui_label(days),
            'billing_label': license_billing_period_label(days),
        })
    opts.append({
        'key': 'personalizado',
        'days': None,
        'label': 'Personalizado',
        'billing_label': None,
    })
    return opts


def normalize_license_term_days(raw) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        raise ValueError('term_days inválido')
    if n < 1 or n > 3650:
        raise ValueError('term_days debe estar entre 1 y 3650')
    return n
