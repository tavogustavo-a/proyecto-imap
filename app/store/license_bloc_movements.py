# -*- coding: utf-8 -*-
"""
Movimientos de blocs de licencias hechos por usuarios soporte (agregó / borró líneas
en Licencias, Caídas, Vencidas o Cambios).

Se registra el neto por día Colombia: si el mismo actor agrega y luego borra la misma
credencial en el mismo bloc el mismo día (p. ej. tecleo parcial con autoguardado),
ambos registros se cancelan y no aparecen en el resumen.

Alimenta:
- Sección «Movimientos soporte» del Resumen diario (historial de compras + WhatsApp).
- Filas del «Historial · Licencias» (altas/bajas de blocs hechas por soporte).

Destinatarios:
- Usuario soporte: sus propios movimientos (y los de sus subusuarios).
- Admin principal: los movimientos de todos los usuarios soporte.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from flask import current_app

from app.extensions import db
from app.utils.timezone import get_colombia_datetime

logger = logging.getLogger(__name__)

BLOC_LABELS = {
    'license_notes': 'Licencias',
    'suspended_notes': 'Caídas',
    'expired_notes': 'Vencidas',
    'changes_notes': 'Cambios',
}
_BLOC_ORDER = ('license_notes', 'changes_notes', 'suspended_notes', 'expired_notes')

ACTION_DELETED = 'borro'
ACTION_ADDED = 'agrego'


class LicenseBlocMovement(db.Model):
    __tablename__ = 'license_bloc_movements'
    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    co_date = db.Column(db.String(10), index=True)  # YYYY-MM-DD (día Colombia)
    actor_user_id = db.Column(db.Integer, index=True)
    actor_username = db.Column(db.String(150))
    license_id = db.Column(db.Integer)
    product_name = db.Column(db.String(255))
    bloc_key = db.Column(db.String(32))
    action = db.Column(db.String(8))  # 'agrego' | 'borro'
    cred_line = db.Column(db.Text)
    cred_key = db.Column(db.String(400))
    # Marcadores de envío WhatsApp por destinatario (el mismo registro alimenta
    # el resumen del propio soporte y el del admin).
    wa_actor_sent_at = db.Column(db.DateTime, nullable=True)
    wa_admin_sent_at = db.Column(db.DateTime, nullable=True)


_schema_ready = False


def ensure_license_bloc_movements_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    try:
        LicenseBlocMovement.__table__.create(bind=db.engine, checkfirst=True)
        _schema_ready = True
    except Exception:
        logger.exception('ensure_license_bloc_movements_schema')


def _cred_from_storage_line(line: str) -> str:
    """Parte de credencial (antes del primer «|») de una línea del bloc."""
    raw = str(line or '').strip()
    if not raw:
        return ''
    return raw.split('|', 1)[0].strip()


def _cred_key(cred: str) -> str:
    return ' '.join(str(cred or '').split()).lower()


def _cred_map_from_bloc_text(text: str) -> Dict[str, str]:
    """clave normalizada → credencial visible (email/clave), líneas no vacías."""
    out: Dict[str, str] = {}
    for line in str(text or '').replace('\r\n', '\n').split('\n'):
        cred = _cred_from_storage_line(line)
        key = _cred_key(cred)
        if key:
            out.setdefault(key, cred)
    return out


def record_soporte_bloc_movements(
    license_obj: Any,
    *,
    bloc_key: str,
    old_text: str,
    new_text: str,
    actor_user_id: Any,
) -> None:
    """Registra el diff (altas/bajas de credenciales) hecho por un usuario soporte."""
    if bloc_key not in BLOC_LABELS:
        return
    try:
        actor_id = int(actor_user_id)
    except (TypeError, ValueError):
        return
    old_map = _cred_map_from_bloc_text(old_text)
    new_map = _cred_map_from_bloc_text(new_text)
    added = {k: v for k, v in new_map.items() if k not in old_map}
    removed = {k: v for k, v in old_map.items() if k not in new_map}
    if not added and not removed:
        return

    ensure_license_bloc_movements_schema()

    from app.models.user import User

    actor = User.query.get(actor_id)
    actor_username = (actor.username if actor else '') or f'user-{actor_id}'
    co_date_iso = get_colombia_datetime().date().isoformat()
    product_name = 'Producto'
    try:
        if license_obj.product is not None and license_obj.product.name:
            product_name = str(license_obj.product.name).strip() or 'Producto'
    except Exception:
        product_name = 'Producto'

    for action, mapping in ((ACTION_ADDED, added), (ACTION_DELETED, removed)):
        opposite = ACTION_DELETED if action == ACTION_ADDED else ACTION_ADDED
        for key, cred in mapping.items():
            # Neteo del día: alta + baja de la misma credencial en el mismo bloc se cancelan.
            opp = (
                LicenseBlocMovement.query.filter_by(
                    co_date=co_date_iso,
                    actor_user_id=actor_id,
                    license_id=int(license_obj.id),
                    bloc_key=bloc_key,
                    action=opposite,
                    cred_key=key,
                )
                .first()
            )
            if opp is not None:
                db.session.delete(opp)
                continue
            db.session.add(
                LicenseBlocMovement(
                    co_date=co_date_iso,
                    actor_user_id=actor_id,
                    actor_username=actor_username,
                    license_id=int(license_obj.id),
                    product_name=product_name,
                    bloc_key=bloc_key,
                    action=action,
                    cred_line=cred,
                    cred_key=key,
                )
            )


# ---------------------------------------------------------------------------
# Identificación de destinatarios
# ---------------------------------------------------------------------------

def _main_admin_user():
    from app.models.user import User

    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    return User.query.filter_by(username=admin_username, parent_id=None).first()


def user_is_main_admin(user_obj: Any) -> bool:
    if user_obj is None:
        return False
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    return (
        getattr(user_obj, 'parent_id', None) is None
        and str(getattr(user_obj, 'username', '') or '') == str(admin_username)
    )


def user_has_soporte_licencias_flag(user_obj: Any) -> bool:
    """Flag propio o heredado del padre (mismo criterio que las notificaciones de reportes)."""
    if user_obj is None:
        return False
    up = user_obj.user_prices if isinstance(getattr(user_obj, 'user_prices', None), dict) else {}
    if bool(up.get('soporte_licencias')):
        return True
    parent_id = getattr(user_obj, 'parent_id', None)
    if parent_id:
        from app.models.user import User

        parent = User.query.get(parent_id)
        pup = parent.user_prices if parent and isinstance(parent.user_prices, dict) else {}
        return bool(pup.get('soporte_licencias'))
    return False


def _actor_ids_scope_for(user_obj: Any) -> List[int]:
    """El usuario principal ve también los movimientos de sus subusuarios."""
    from app.models.user import User

    ids = [int(user_obj.id)]
    try:
        for sub in User.query.filter(User.parent_id == user_obj.id).all():
            ids.append(int(sub.id))
    except Exception:
        pass
    return ids


def _billing_main_user_for_actor(actor_user_id: int):
    """Sube al usuario principal (los subusuarios no reciben resumen propio)."""
    from app.models.user import User

    u = User.query.get(int(actor_user_id))
    seen = set()
    while u is not None and getattr(u, 'parent_id', None) and u.id not in seen:
        seen.add(u.id)
        u = User.query.get(u.parent_id)
    return u


# ---------------------------------------------------------------------------
# Sección «Movimientos soporte» del resumen diario
# ---------------------------------------------------------------------------

def _movement_rows_for_day(co_date_iso: str, actor_ids: Optional[List[int]] = None):
    ensure_license_bloc_movements_schema()
    q = LicenseBlocMovement.query.filter_by(co_date=co_date_iso)
    if actor_ids is not None:
        if not actor_ids:
            return []
        q = q.filter(LicenseBlocMovement.actor_user_id.in_(actor_ids))
    return q.order_by(LicenseBlocMovement.id.asc()).all()


def movement_timeline_tipo_label(action: str, bloc_key: str) -> str:
    bloc = BLOC_LABELS.get(str(bloc_key or ''), 'Bloc')
    if str(action or '') == ACTION_DELETED:
        return f'Borró de {bloc}'
    return f'Agregó en {bloc}'


def build_bloc_movement_timeline_entries(
    *,
    utc_to_colombia_fn: Callable,
    actor_ids: Optional[List[int]] = None,
    include_usuario: bool = False,
    retention_days: int = 180,
) -> List[Tuple[datetime, Dict[str, Any]]]:
    """
    Entradas (dt_utc, row) para fusionar en Historial · Licencias.
    Si actor_ids es None → todos; si es lista vacía → ninguna.
    """
    try:
        ensure_license_bloc_movements_schema()
        if actor_ids is not None and not actor_ids:
            return []
        cutoff = datetime.utcnow() - timedelta(days=int(retention_days))
        q = LicenseBlocMovement.query.filter(LicenseBlocMovement.created_at >= cutoff)
        if actor_ids is not None:
            q = q.filter(LicenseBlocMovement.actor_user_id.in_(actor_ids))
        rows = q.order_by(LicenseBlocMovement.id.desc()).all()
    except Exception:
        logger.exception('build_bloc_movement_timeline_entries')
        return []

    out: List[Tuple[datetime, Dict[str, Any]]] = []
    for r in rows:
        dt = getattr(r, 'created_at', None) or datetime.utcnow()
        try:
            fecha_col = utc_to_colombia_fn(dt).strftime('%Y-%m-%d %H:%M')
        except Exception:
            fecha_col = dt.strftime('%Y-%m-%d %H:%M')
        pname = str(r.product_name or 'Producto').strip() or 'Producto'
        cred = str(r.cred_line or '—').strip() or '—'
        tipo_label = movement_timeline_tipo_label(r.action, r.bloc_key)
        row: Dict[str, Any] = {
            'fecha_col': fecha_col,
            'tipo_label': tipo_label,
            'summary': f'{pname} · {cred}',
            'detail': '',
            'sort_ts': dt,
        }
        if include_usuario:
            row['usuario'] = str(r.actor_username or '—').strip() or '—'
        out.append((dt, row))
    return out


def _format_movements_lines(rows: list, *, group_by_user: bool) -> List[str]:
    """
    Movimientos soporte — fher:
    Borró de Cambios estas cuentas (total 2):
    Netflix 1 Pantalla:
    correo1@mail.com clave1
    correo2@mail.com clave2

    Agregó en Caídas estas cuentas (total 2):
    ...
    """
    out: List[str] = []
    by_actor: Dict[str, list] = {}
    for r in rows:
        by_actor.setdefault(str(r.actor_username or '—'), []).append(r)

    first_actor = True
    for actor in sorted(by_actor.keys(), key=lambda s: s.lower()):
        arows = by_actor[actor]
        if not first_actor:
            out.append('')
        first_actor = False
        if group_by_user:
            out.append(f'Movimientos soporte — {actor}:')
        else:
            out.append('Movimientos soporte:')
        first_section = True
        for action, verbo, prep in (
            (ACTION_DELETED, 'Borró', 'de'),
            (ACTION_ADDED, 'Agregó', 'en'),
        ):
            for bloc in _BLOC_ORDER:
                sub = [r for r in arows if r.action == action and r.bloc_key == bloc]
                if not sub:
                    continue
                if not first_section:
                    out.append('')
                first_section = False
                out.append(
                    f'{verbo} {prep} {BLOC_LABELS[bloc]} estas cuentas (total {len(sub)}):'
                )
                by_product: Dict[str, list] = {}
                for r in sub:
                    by_product.setdefault(str(r.product_name or 'Producto'), []).append(r)
                for pname in sorted(by_product.keys(), key=lambda s: s.lower()):
                    out.append(f'{pname}:')
                    for r in by_product[pname]:
                        out.append(str(r.cred_line or '—'))
    return out


def daily_movements_summary_lines(billing_user: Any, co_date: date) -> List[str]:
    """Sección para el resumen diario de este usuario (vacía si no le aplica)."""
    if billing_user is None or co_date is None:
        return []
    try:
        iso = co_date.isoformat()
        if user_is_main_admin(billing_user):
            rows = _movement_rows_for_day(iso)
            group_by_user = True
        elif user_has_soporte_licencias_flag(billing_user):
            rows = _movement_rows_for_day(iso, actor_ids=_actor_ids_scope_for(billing_user))
            group_by_user = False
        else:
            return []
        if not rows:
            return []
        return _format_movements_lines(rows, group_by_user=group_by_user)
    except Exception:
        logger.exception('daily_movements_summary_lines')
        return []


def movement_summary_billing_keys(
    *,
    viewer_billing_user_id: Optional[int] = None,
    all_users: bool = False,
) -> Set[Tuple[int, str]]:
    """
    (billing_user_id, co_date ISO) que deben tener fila «Resumen diario» en el
    historial aunque ese día no haya compras: el admin (todos los movimientos)
    y cada usuario soporte principal (los suyos).
    """
    try:
        ensure_license_bloc_movements_schema()
        pairs = (
            db.session.query(
                LicenseBlocMovement.actor_user_id, LicenseBlocMovement.co_date
            )
            .distinct()
            .all()
        )
    except Exception:
        logger.exception('movement_summary_billing_keys')
        return set()
    if not pairs:
        return set()

    keys: Set[Tuple[int, str]] = set()
    admin = _main_admin_user()
    if admin is not None:
        for _actor_id, d in pairs:
            if d:
                keys.add((int(admin.id), str(d)))
    for actor_id, d in pairs:
        if not d:
            continue
        main = _billing_main_user_for_actor(actor_id)
        if main is not None:
            keys.add((int(main.id), str(d)))

    if not all_users and viewer_billing_user_id:
        vid = int(viewer_billing_user_id)
        keys = {k for k in keys if k[0] == vid}
    return keys


# ---------------------------------------------------------------------------
# Envío WhatsApp (pendientes y marcado por destinatario)
# ---------------------------------------------------------------------------

def mark_movements_whatsapp_sent(billing_user: Any, co_date: date) -> None:
    """Marca como enviados los movimientos incluidos en el resumen de este destinatario."""
    if billing_user is None or co_date is None:
        return
    try:
        ensure_license_bloc_movements_schema()
        iso = co_date.isoformat()
        now = datetime.utcnow()
        if user_is_main_admin(billing_user):
            rows = (
                LicenseBlocMovement.query.filter_by(co_date=iso)
                .filter(LicenseBlocMovement.wa_admin_sent_at.is_(None))
                .all()
            )
            for r in rows:
                r.wa_admin_sent_at = now
                db.session.add(r)
        elif user_has_soporte_licencias_flag(billing_user):
            actor_ids = _actor_ids_scope_for(billing_user)
            rows = (
                LicenseBlocMovement.query.filter_by(co_date=iso)
                .filter(
                    LicenseBlocMovement.actor_user_id.in_(actor_ids),
                    LicenseBlocMovement.wa_actor_sent_at.is_(None),
                )
                .all()
            )
            for r in rows:
                r.wa_actor_sent_at = now
                db.session.add(r)
    except Exception:
        logger.exception('mark_movements_whatsapp_sent')


def pending_movement_digest_recipients(
    *,
    ready_fn: Callable[[date], bool],
    force: bool = False,
) -> List[Tuple[Any, date]]:
    """
    Destinatarios (User, co_date) con movimientos sin resumen WhatsApp enviado,
    para días en que ese día no hubo ventas (resumen solo-movimientos).
    """
    out: List[Tuple[Any, date]] = []
    try:
        ensure_license_bloc_movements_schema()
        seen: Set[Tuple[int, str]] = set()

        admin = _main_admin_user()
        if admin is not None:
            admin_dates = (
                db.session.query(LicenseBlocMovement.co_date)
                .filter(LicenseBlocMovement.wa_admin_sent_at.is_(None))
                .distinct()
                .all()
            )
            for (d,) in admin_dates:
                if not d:
                    continue
                try:
                    cd = date.fromisoformat(str(d))
                except ValueError:
                    continue
                if not force and not ready_fn(cd):
                    continue
                key = (int(admin.id), str(d))
                if key not in seen:
                    seen.add(key)
                    out.append((admin, cd))

        actor_pairs = (
            db.session.query(
                LicenseBlocMovement.actor_user_id, LicenseBlocMovement.co_date
            )
            .filter(LicenseBlocMovement.wa_actor_sent_at.is_(None))
            .distinct()
            .all()
        )
        for actor_id, d in actor_pairs:
            if not d:
                continue
            main = _billing_main_user_for_actor(actor_id)
            if main is None or user_is_main_admin(main):
                continue
            if not user_has_soporte_licencias_flag(main):
                continue
            try:
                cd = date.fromisoformat(str(d))
            except ValueError:
                continue
            if not force and not ready_fn(cd):
                continue
            key = (int(main.id), str(d))
            if key not in seen:
                seen.add(key)
                out.append((main, cd))
    except Exception:
        logger.exception('pending_movement_digest_recipients')
    return out
