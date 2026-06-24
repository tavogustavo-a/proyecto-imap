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
    "style", "button",
})

_GLOBAL_ATTRS = frozenset({"class", "title", "aria-label"})
_TAG_ATTRS = {
    "a": frozenset({"href", "target", "rel"}),
    "img": frozenset({"src", "alt", "width", "height"}),
    "th": frozenset({"colspan", "rowspan", "scope"}),
    "td": frozenset({"colspan", "rowspan"}),
    "button": frozenset({"type", "disabled"}),
    "style": frozenset({"type"}),
}

_UNSAFE_URL_SCHEMES = frozenset({"javascript", "vbscript", "data"})

_STYLE_UNSAFE = re.compile(
    r"@import\b|expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding\b|behavior\s*\(|"
    r"url\s*\(\s*['\"]?\s*javascript",
    re.I,
)


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


def _wrap_bare_css_prefix(text: str) -> str:
    """CSS pegado sin <style> (común al copiar desde Herramienta HTML) → envolver en <style>."""
    stripped = text.lstrip()
    if stripped.startswith("<") or "{" not in stripped or "}" not in stripped:
        return text
    tag_match = re.search(r"<\s*[a-zA-Z]", stripped)
    if not tag_match or tag_match.start() <= 0:
        return text
    prefix = stripped[: tag_match.start()]
    if "<" in prefix or ">" in prefix:
        return text
    if not re.search(r"\{[^{}]*\}", prefix):
        return text
    rest = stripped[tag_match.start() :]
    return "<style type=\"text/css\">\n" + prefix.strip() + "\n</style>\n" + rest


def _sanitize_style_element(tag) -> None:
    css_text = tag.get_text() or ""
    if _STYLE_UNSAFE.search(css_text):
        tag.decompose()
        return
    tag.attrs = {"type": "text/css"}
    tag.clear()
    tag.append(css_text)


def _sanitize_element(tag) -> None:
    name = tag.name.lower() if tag.name else ""
    if name == "style":
        _sanitize_style_element(tag)
        return
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

    if name == "button":
        tag["type"] = "button"


def sanitize_admin_message_html(raw: str | None) -> Markup:
    """Permite formato básico admin; elimina scripts, eventos y URLs peligrosas."""
    if not raw:
        return Markup("")

    text = str(raw).strip()
    if not text:
        return Markup("")

    if "<" not in text and ">" not in text:
        return Markup(text)

    text = _wrap_bare_css_prefix(text)

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
