"""Varios remitentes en un regex o filtro, separados por coma."""
import re

SENDER_ERROR = "Remitente inválido."
MAX_SENDER_LEN = 500
_PART_RE = re.compile(r"^[^@\s,]+@[^@\s,]+\.[^@\s,]+$")


class InvalidSenderError(ValueError):
    pass


def normalize_sender_list(raw):
    """
    Vacío -> None.
    Un correo, o varios separados por coma (se permiten espacios junto a la coma).
    Un espacio que no esté junto a una coma es un remitente inválido.
    """
    text = (raw or "").strip()
    if not text:
        return None

    cleaned = []
    seen = set()
    for part in text.split(","):
        item = part.strip()
        if not item or re.search(r"\s", item) or not _PART_RE.fullmatch(item):
            raise InvalidSenderError(SENDER_ERROR)
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(item)

    stored = ", ".join(cleaned)
    if len(stored) > MAX_SENDER_LEN:
        raise InvalidSenderError(SENDER_ERROR)
    return stored


def sender_parts(raw):
    return [part.strip() for part in (raw or "").split(",") if part.strip()]


def any_sender_in_text(rule_sender, haystack) -> bool:
    """True si no hay remitente, o si alguno de la lista aparece en el From."""
    parts = sender_parts(rule_sender)
    if not parts:
        return True
    hay = (haystack or "").lower()
    return any(part.lower() in hay for part in parts)
