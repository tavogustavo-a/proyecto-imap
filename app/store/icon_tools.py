"""Iconos de streaming adaptados a fondo oscuro.

Los PNG de static/images traen el logo sobre un círculo blanco. Aquí se quita ese
fondo y los trazos oscuros sin color (negro, gris) se vuelven claros para que se
lean sobre una placa negra. Los colores (rojo Netflix, naranja Vix) se conservan.
"""

from __future__ import annotations

import io
import os
import threading
from collections import deque

_cache: dict[tuple[str, int, float], bytes] = {}
_lock = threading.Lock()

_DARK_MAX = 120
_SAT_MAX = 46
_BG_LUM_MIN = 170
_BG_SAT_MAX = 48
_HOLE_MAX_AREA = 8000


def _sat_lum(r: int, g: int, b: int) -> tuple[int, int]:
    hi = max(r, g, b)
    lo = min(r, g, b)
    lum = (r * 299 + g * 587 + b * 114) // 1000
    return hi - lo, lum


def _is_light_plate(pixel) -> bool:
    """Blanco o gris claro, sin color. No incluye el rojo, el azul ni el negro del logo."""
    r, g, b, a = pixel
    if a < 40:
        return True
    sat, lum = _sat_lum(r, g, b)
    return sat <= _BG_SAT_MAX and lum >= _BG_LUM_MIN


def _remove_background(image):
    """Deja transparente el fondo claro que toca los bordes, aunque haya un anillo gris."""
    width, height = image.size
    pixels = image.load()
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def push(x: int, y: int) -> None:
        index = y * width + x
        if seen[index]:
            return
        seen[index] = 1
        if _is_light_plate(pixels[x, y]):
            queue.append((x, y))

    for x in range(width):
        push(x, 0)
        push(x, height - 1)
    for y in range(height):
        push(0, y)
        push(width - 1, y)

    while queue:
        x, y = queue.popleft()
        r, g, b, _a = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        if x > 0:
            push(x - 1, y)
        if x < width - 1:
            push(x + 1, y)
        if y > 0:
            push(x, y - 1)
        if y < height - 1:
            push(x, y + 1)
    return image


def _clear_light_holes(image):
    """Quita islas claras chicas, como el hueco blanco de la O, y deja las placas grandes del logo."""
    width, height = image.size
    pixels = image.load()
    seen = bytearray(width * height)
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if seen[index]:
                continue
            if not _is_light_plate(pixels[x, y]) or pixels[x, y][3] < 40:
                seen[index] = 1
                continue
            queue: deque[tuple[int, int]] = deque([(x, y)])
            seen[index] = 1
            cells = [(x, y)]
            while queue:
                cx, cy = queue.popleft()
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    neighbor = ny * width + nx
                    if seen[neighbor]:
                        continue
                    pixel = pixels[nx, ny]
                    if pixel[3] >= 40 and _is_light_plate(pixel):
                        seen[neighbor] = 1
                        queue.append((nx, ny))
                        cells.append((nx, ny))
            if len(cells) <= _HOLE_MAX_AREA:
                for cx, cy in cells:
                    r, g, b, _a = pixels[cx, cy]
                    pixels[cx, cy] = (r, g, b, 0)
    return image


def _lighten_dark_strokes(image):
    """Negro y gris sin saturación pasan a blanco/gris claro."""
    width, height = image.size
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            hi = max(r, g, b)
            lo = min(r, g, b)
            lum = (r * 299 + g * 587 + b * 114) // 1000
            if hi - lo <= _SAT_MAX and lum <= _DARK_MAX:
                new = 255 - lum
                pixels[x, y] = (new, new, new, a)
    return image


def dark_screen_icon(path: str, size: int = 160):
    """Imagen RGBA del icono lista para una placa oscura, o None si no existe."""
    from PIL import Image

    if not path or not os.path.isfile(path):
        return None
    try:
        image = Image.open(path).convert('RGBA')
    except Exception:
        return None
    image = _remove_background(image)
    image = _clear_light_holes(image)
    image.thumbnail((size, size))
    image = _lighten_dark_strokes(image)
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)
    return image


def dark_screen_icon_png(path: str, size: int = 160) -> bytes | None:
    """PNG en memoria con caché por archivo y tamaño."""
    try:
        stamp = os.path.getmtime(path)
    except OSError:
        return None
    key = (path, size, stamp)
    with _lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached
    image = dark_screen_icon(path, size)
    if image is None:
        return None
    out = io.BytesIO()
    image.save(out, format='PNG', optimize=True)
    data = out.getvalue()
    with _lock:
        if len(_cache) > 200:
            _cache.clear()
        _cache[key] = data
    return data
