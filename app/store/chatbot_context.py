# -*- coding: utf-8 -*-
"""Contexto seguro, identidad y redacción para el asistente de la tienda."""
from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timedelta
import re
import threading
import time
from typing import Any, Dict, Iterable, List

from app.extensions import db
from app.models.user import User


_EMAIL_RE = re.compile(
    r"\b([A-Z0-9._%+\-])([A-Z0-9._%+\-]*)(@[A-Z0-9.\-]+\.[A-Z]{2,})\b",
    re.IGNORECASE,
)
_LABELED_SECRET_RE = re.compile(
    r"(?i)\b(password|contrase(?:ñ|n)a|token|api[_ -]?key|secret|clave privada)"
    r"\s*[:=]\s*([^\s,;]{4,})"
)
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}")
_LONG_HEX_RE = re.compile(r"\b[a-fA-F0-9]{32,}\b")
_SENSITIVE_SOURCE_RE = re.compile(
    r"(?i)(password\s*[:=]|contrase(?:ñ|n)a\s*[:=]|"
    r"api[_ -]?key\s*[:=]|bearer\s+[a-z0-9]|"
    r"master[_ -]?token\s*[:=]|secret\s*[:=]|BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY)"
)

_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: Dict[int, deque] = defaultdict(deque)
_RATE_WINDOW_SECONDS = 60
_RATE_MAX_REQUESTS = 12


def is_effective_admin(app, user_obj: User, session_data: Any) -> bool:
    """Admin real: usuario raíz, login admin y nombre configurado."""
    if not user_obj:
        return False
    admin_username = str(app.config.get("ADMIN_USER", "admin") or "admin")
    return bool(
        (user_obj.username or "") == admin_username
        and getattr(user_obj, "parent_id", None) is None
        and not bool(session_data.get("is_user"))
    )


def build_identity(app, user_obj: User, session_data: Any) -> Dict[str, Any]:
    """Identidad mínima que puede llegar al motor; nunca contiene secretos."""
    admin = is_effective_admin(app, user_obj, session_data)
    billing_user = user_obj
    if not admin and getattr(user_obj, "parent_id", None):
        parent = User.query.get(user_obj.parent_id)
        if parent:
            billing_user = parent
    return {
        "user_id": int(user_obj.id),
        "username": str(user_obj.username or "usuario")[:80],
        "role": "admin" if admin else "user",
        "is_admin": admin,
        "billing_user_id": int(billing_user.id),
        "billing_username": str(billing_user.username or "usuario")[:80],
        "is_subuser": bool(getattr(user_obj, "parent_id", None)),
    }


def chatbot_rate_limited(user_id: int) -> bool:
    """Límite en memoria por usuario; evita abuso accidental del proveedor LLM."""
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW_SECONDS
    uid = int(user_id)
    with _RATE_LOCK:
        bucket = _RATE_BUCKETS[uid]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= _RATE_MAX_REQUESTS:
            return True
        bucket.append(now)
        return False


def reset_chatbot_rate_limits_for_tests() -> None:
    with _RATE_LOCK:
        _RATE_BUCKETS.clear()


def mask_email(value: str) -> str:
    def repl(match: re.Match) -> str:
        return f"{match.group(1)}***{match.group(3)}"

    return _EMAIL_RE.sub(repl, str(value or ""))


def redact_sensitive_text(value: str) -> str:
    """Última barrera antes de mostrar una respuesta al navegador."""
    text = str(value or "")
    text = _LABELED_SECRET_RE.sub(lambda m: f"{m.group(1)}: [DATO PROTEGIDO]", text)
    text = _BEARER_RE.sub("Bearer [DATO PROTEGIDO]", text)
    text = _LONG_HEX_RE.sub("[DATO PROTEGIDO]", text)
    return mask_email(text)


def source_contains_sensitive_material(value: str) -> bool:
    """Rechaza notas que parecen contener credenciales o claves."""
    text = str(value or "")
    return bool(_SENSITIVE_SOURCE_RE.search(text) or _LONG_HEX_RE.search(text))


def _query_mentions(query: str, terms: Iterable[str]) -> bool:
    normalized = str(query or "").lower()
    return any(term in normalized for term in terms)


def _money(value: Any, currency: str) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0.0
    return f"{number:,.2f} {currency}".replace(",", " ")


def _safe_user_balances(identity: Dict[str, Any]) -> List[str]:
    billing = User.query.get(identity["billing_user_id"])
    if not billing:
        return []
    return [
        f"Saldo prepago USD: {_money(getattr(billing, 'saldo_usd', 0), 'USD')}.",
        f"Saldo prepago COP: {_money(getattr(billing, 'saldo_cop', 0), 'COP')}.",
        f"Saldo pendiente de licencias: {_money(getattr(billing, 'saldo', 0), 'según moneda de la cuenta')}.",
    ]


def _safe_user_license_summary(user_obj: User, identity: Dict[str, Any]) -> List[str]:
    from app.store.models import LicenseAccount

    visible_ids = [int(user_obj.id)]
    if (
        getattr(user_obj, "parent_id", None)
        and getattr(user_obj, "can_access_store", False)
        and int(identity["billing_user_id"]) not in visible_ids
    ):
        visible_ids.append(int(identity["billing_user_id"]))

    rows = (
        LicenseAccount.query.filter(LicenseAccount.assigned_to_user_id.in_(visible_ids))
        .filter(LicenseAccount.status.in_(("assigned", "sold")))
        .order_by(LicenseAccount.expires_at.asc(), LicenseAccount.id.asc())
        .limit(40)
        .all()
    )
    if not rows:
        return ["No hay licencias activas asignadas visibles para esta cuenta."]

    now = datetime.utcnow()
    by_product: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        product = (
            row.license.product.name
            if getattr(row, "license", None) and getattr(row.license, "product", None)
            else "Producto"
        )
        item = by_product.setdefault(product, {"count": 0, "nearest": None})
        item["count"] += 1
        expires = getattr(row, "expires_at", None)
        if expires and (item["nearest"] is None or expires < item["nearest"]):
            item["nearest"] = expires

    lines = [f"Licencias activas visibles: {len(rows)}."]
    for product, item in sorted(by_product.items())[:12]:
        nearest = item["nearest"]
        expiry_text = ""
        if nearest:
            days = max(0, (nearest.replace(tzinfo=None) - now).days)
            expiry_text = f"; próximo vencimiento en {days} día(s)"
        lines.append(f"{product}: {item['count']} cuenta(s){expiry_text}.")
    lines.append("Por seguridad, el asistente no muestra correos, usuarios ni contraseñas de licencias.")
    return lines


def _safe_user_purchase_summary(identity: Dict[str, Any]) -> List[str]:
    from app.store.models import Product, Sale

    rows = (
        db.session.query(Sale, Product.name)
        .join(Product, Product.id == Sale.product_id)
        .filter(Sale.user_id == int(identity["billing_user_id"]))
        .order_by(Sale.created_at.desc())
        .limit(8)
        .all()
    )
    if not rows:
        return ["No hay compras recientes registradas para la cuenta de facturación."]
    lines = ["Compras recientes (sin credenciales):"]
    for sale, product_name in rows:
        when = sale.created_at.strftime("%Y-%m-%d") if sale.created_at else "sin fecha"
        currency = str(getattr(sale, "currency", "") or "")
        lines.append(
            f"{when}: {product_name}, cantidad {int(sale.quantity or 1)}, "
            f"total {_money(sale.total_price, currency)}."
        )
    return lines


def _safe_user_recharge_summary(identity: Dict[str, Any]) -> List[str]:
    from app.store.models import BalanceRecharge

    rows = (
        BalanceRecharge.query.filter_by(user_id=int(identity["billing_user_id"]))
        .order_by(BalanceRecharge.created_at.desc())
        .limit(6)
        .all()
    )
    if not rows:
        return ["No hay solicitudes recientes de recarga."]
    lines = ["Recargas recientes (sin comprobantes ni datos bancarios):"]
    for row in rows:
        when = row.created_at.strftime("%Y-%m-%d") if row.created_at else "sin fecha"
        amount = row.amount_credited if row.amount_credited is not None else row.amount_claimed
        lines.append(f"{when}: estado {row.status}; monto {_money(amount, row.currency)}.")
    return lines


def _safe_admin_summary(query: str) -> List[str]:
    """Solo agregados operativos. Nunca carga filas, notas, chats o credenciales."""
    from app.store.models import BalanceRecharge, LicenseAccount, Product, Sale

    lines: List[str] = []
    if _query_mentions(query, ("usuario", "cliente", "cuenta")):
        total_users = User.query.filter(User.parent_id.is_(None)).count()
        subusers = User.query.filter(User.parent_id.isnot(None)).count()
        lines.append(f"Usuarios principales registrados: {total_users}; subusuarios: {subusers}.")
    if _query_mentions(query, ("tienda", "producto", "venta", "compra")):
        enabled_products = Product.query.filter_by(enabled=True).count()
        since = datetime.utcnow() - timedelta(days=30)
        sales_30 = Sale.query.filter(Sale.created_at >= since).count()
        lines.append(f"Productos habilitados: {enabled_products}; ventas de los últimos 30 días: {sales_30}.")
    if _query_mentions(query, ("licencia", "venc", "stock")):
        assigned = LicenseAccount.query.filter(
            LicenseAccount.status.in_(("assigned", "sold"))
        ).count()
        available = LicenseAccount.query.filter_by(status="available").count()
        lines.append(f"Licencias disponibles: {available}; asignadas o vendidas: {assigned}.")
    if _query_mentions(query, ("recarga", "saldo", "pago")):
        pending = BalanceRecharge.query.filter(
            BalanceRecharge.status.in_(("pending", "pending_binance_pay", "pending_gateway"))
        ).count()
        lines.append(f"Solicitudes de recarga pendientes: {pending}.")
    return lines


def build_safe_live_context(
    user_obj: User, identity: Dict[str, Any], query: str
) -> str:
    """Carga únicamente datos necesarios para la intención detectada."""
    sections: List[str] = []

    def append_section(title: str, loader) -> None:
        try:
            lines = loader()
        except Exception:
            # El conocimiento general sigue disponible aunque una tabla esté migrando.
            return
        if lines:
            sections.append(f"{title}:\n" + "\n".join(lines))

    if identity.get("is_admin"):
        append_section("RESUMEN OPERATIVO ADMIN", lambda: _safe_admin_summary(query))
        return "\n\n".join(sections)

    if _query_mentions(query, ("saldo", "debo", "deuda", "crédito", "credito")):
        append_section("DATOS PROPIOS DE SALDOS", lambda: _safe_user_balances(identity))
    if _query_mentions(query, ("licencia", "cuenta", "vence", "vencimiento", "renovar")):
        append_section(
            "DATOS PROPIOS DE LICENCIAS",
            lambda: _safe_user_license_summary(user_obj, identity),
        )
    if _query_mentions(query, ("compra", "pedido", "historial", "compré", "compre")):
        append_section(
            "DATOS PROPIOS DE COMPRAS",
            lambda: _safe_user_purchase_summary(identity),
        )
    if _query_mentions(query, ("recarga", "comprobante", "acredit", "pago")):
        append_section(
            "DATOS PROPIOS DE RECARGAS",
            lambda: _safe_user_recharge_summary(identity),
        )
    return redact_sensitive_text("\n\n".join(sections))
