"""Sanitización HTML para mensajes configurables por admin (anti-XSS)."""
from __future__ import annotations

import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Comment
from markupsafe import Markup

_ALLOWED_TAGS = frozenset({
    "p", "div", "span", "a", "strong", "b", "em", "i", "u", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "img", "pre", "code", "blockquote",
})

_GLOBAL_ATTRS = frozenset({"class", "title", "aria-label"})
_TAG_ATTRS = {
    "a": frozenset({"href", "target", "rel"}),
    "img": frozenset({"src", "alt", "width", "height"}),
    "th": frozenset({"colspan", "rowspan", "scope"}),
    "td": frozenset({"colspan", "rowspan"}),
}

_UNSAFE_URL_SCHEMES = frozenset({"javascript", "vbscript", "data"})


def _is_safe_url(value: str, *, allow_data_images: bool = False) -> bool:
    if not value:
        return False
    raw = value.strip()
    if raw.startswith("#"):
        return True
    if raw.startswith("/") and not raw.startswith("//"):
        return True
    parsed = urlparse(raw)
    scheme = (parsed.scheme or "").lower()
    if not scheme:
        return True
    if scheme in ("http", "https"):
        return True
    if allow_data_images and scheme == "data":
        return raw.lower().startswith("data:image/")
    return False


def _clean_attr_name(name: str) -> str:
    return (name or "").strip().lower()


def _sanitize_element(tag) -> None:
    name = tag.name.lower() if tag.name else ""
    if name not in _ALLOWED_TAGS:
        tag.unwrap()
        return

    allowed = _GLOBAL_ATTRS | _TAG_ATTRS.get(name, frozenset())
    attrs = dict(tag.attrs or {})
    for attr in list(attrs.keys()):
        attr_name = _clean_attr_name(attr)
        if attr_name.startswith("on") or attr_name not in allowed:
            del tag.attrs[attr]
            continue
        value = attrs[attr]
        if attr_name in ("href", "src"):
            candidate = value[0] if isinstance(value, list) else value
            if not _is_safe_url(str(candidate), allow_data_images=(attr_name == "src" and name == "img")):
                del tag.attrs[attr]
        elif attr_name == "target" and str(value).lower() not in ("_blank", "_self"):
            del tag.attrs[attr]
        elif attr_name == "rel" and not re.fullmatch(r"[\w\s\-]+", str(value)):
            del tag.attrs[attr]

    if name == "a" and tag.has_attr("target") and tag.get("target") == "_blank":
        rel = tag.get("rel") or []
        rel_text = " ".join(rel) if isinstance(rel, list) else str(rel)
        parts = set(rel_text.split()) | {"noopener", "noreferrer"}
        tag["rel"] = " ".join(sorted(parts))


def sanitize_admin_message_html(raw: str | None) -> Markup:
    """Permite formato básico admin; elimina scripts, eventos y URLs peligrosas."""
    if not raw:
        return Markup("")

    text = str(raw).strip()
    if not text:
        return Markup("")

    if "<" not in text and ">" not in text:
        return Markup(text)

    soup = BeautifulSoup(text, "html.parser")
    for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()

    for tag in list(soup.find_all(True)):
        _sanitize_element(tag)

    body = soup.body
    if body:
        cleaned = "".join(str(child) for child in body.contents)
    else:
        cleaned = "".join(str(child) for child in soup.contents)

    return Markup(cleaned)


def sanitize_admin_message_html_str(raw: str | None) -> str:
    """Versión serializable para guardar en base de datos."""
    return str(sanitize_admin_message_html(raw))
