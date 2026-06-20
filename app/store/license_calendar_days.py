# -*- coding: utf-8 -*-
"""
Días de calendario (1–31) para renovación / caducidad de licencias.

En meses con menos de 31 días, los blocs «Día 29», «Día 30» y «Día 31» no tienen
fecha propia: se procesan el **día 1 del mes siguiente** (medianoche Colombia),
pero las filas **permanecen** en su bloc original (29/30/31).
"""
from __future__ import annotations

import calendar as pycalendar
from datetime import date, datetime
from typing import List, Optional

from app.utils.timezone import get_colombia_datetime


def days_in_month(year: int, month: int) -> int:
    return int(pycalendar.monthrange(int(year), int(month))[1])


def previous_month_days(year: int, month: int) -> int:
    y, m = int(year), int(month)
    if m == 1:
        return days_in_month(y - 1, 12)
    return days_in_month(y, m - 1)


def is_overflow_renewal_run(co: datetime, calendar_day: int) -> bool:
    """True si hoy es día 1 y el bloc N no existió el mes anterior (29–31 en febrero, etc.)."""
    if int(co.day) != 1:
        return False
    cal = int(calendar_day)
    if cal < 1 or cal > 31:
        return False
    return cal > previous_month_days(co.year, co.month)


def overflow_calendar_days_on_first(co: datetime) -> List[int]:
    """Días 29–31 pendientes del mes anterior cuando hoy es día 1."""
    if int(co.day) != 1:
        return []
    prev_dim = previous_month_days(co.year, co.month)
    return list(range(prev_dim + 1, 32))


def calendar_days_to_process(co: Optional[datetime] = None) -> List[int]:
    """
    Días de bloc a procesar en la pasada de medianoche.

    - Cualquier día: el día actual del calendario.
    - Día 1: además los overflow del mes anterior (p. ej. 29–31 tras febrero).
    """
    co = co or get_colombia_datetime()
    today = int(co.day)
    overflow = overflow_calendar_days_on_first(co)
    if overflow:
        ordered = overflow + ([today] if today not in overflow else [])
        return ordered
    return [today]


def renewal_ym_tag(co: datetime, calendar_day: int, *, overflow_run: bool) -> str:
    """
    Etiqueta mensual para idempotencia «mes a mes».

    En overflow (día 1 procesando 29–31 del mes anterior) usa YYYY-MM del mes
    que se cierra, no el mes actual — así no bloquea el cobro normal del día N
    en el mes en curso (p. ej. 29 mar vs overflow 29 feb el 1 mar).
    """
    if overflow_run:
        y, m = int(co.year), int(co.month)
        if m == 1:
            py, pm = y - 1, 12
        else:
            py, pm = y, m - 1
        return f'{py:04d}-{pm:02d}'
    return co.strftime('%Y-%m')


def next_calendar_processing_date(calendar_day: int, ref_co: Optional[datetime] = None) -> Optional[date]:
    """Próxima fecha (Colombia) en que se procesará el bloc «Día N»."""
    co = ref_co or get_colombia_datetime()
    try:
        cal = int(calendar_day)
    except (TypeError, ValueError):
        return None
    if cal < 1 or cal > 31:
        return None

    y, m, d = int(co.year), int(co.month), int(co.day)
    today = date(y, m, d)
    dim = days_in_month(y, m)
    candidates: List[date] = []

    if cal <= dim and cal >= d:
        candidates.append(date(y, m, cal))

    if d == 1:
        prev_dim = previous_month_days(y, m)
        if cal > prev_dim:
            candidates.append(today)

    nm, ny = (m + 1, y) if m < 12 else (1, y + 1)
    ndim = days_in_month(ny, nm)
    if cal > dim:
        candidates.append(date(ny, nm, 1))
    elif cal <= ndim:
        candidates.append(date(ny, nm, cal))
    else:
        nnm, nny = (nm + 1, ny) if nm < 12 else (1, ny + 1)
        candidates.append(date(nny, nnm, 1))

    future = [c for c in candidates if c >= today]
    if not future:
        return None
    return min(future)


def days_until_calendar_sale_day(calendar_day_int, ref_co=None) -> Optional[int]:
    """Días hasta la próxima ejecución del bloc «Día N» (hora Colombia)."""
    co = ref_co or get_colombia_datetime()
    nxt = next_calendar_processing_date(int(calendar_day_int), co)
    if nxt is None:
        return None
    today = date(int(co.year), int(co.month), int(co.day))
    delta = (nxt - today).days
    return max(0, int(delta))
