# Anuncios de tienda: schema, duración y consultas activas.

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from flask import current_app, session
from sqlalchemy import inspect, or_, text

from app.extensions import db
from app.models.user import User
from app.store.models import StoreAnnouncement

logger = logging.getLogger(__name__)


def viewer_can_see_store_announcements() -> bool:
    """Solo usuarios logueados (no admin, no invitados). Sub-usuarios: requiere permiso del padre."""
    if not session.get('logged_in'):
        return False
    admin_username = (current_app.config.get('ADMIN_USER') or 'admin').strip()
    username = (session.get('username') or '').strip()
    if username and username == admin_username:
        return False
    user_id = session.get('user_id')
    if not user_id:
        return False
    user = User.query.get(int(user_id)) if user_id else None
    if not user:
        return False
    if (user.username or '').strip() == admin_username:
        return False
    if getattr(user, 'parent_id', None) is not None and not bool(
        getattr(user, 'can_view_announcements', False)
    ):
        return False
    return True

DURATION_PRESETS = (
    'indefinido',
    '1d',
    '3d',
    '7d',
    '10d',
    '1m',
    'personalizado',
)

_PRESET_DELTAS = {
    '1d': timedelta(days=1),
    '3d': timedelta(days=3),
    '7d': timedelta(days=7),
    '10d': timedelta(days=10),
    '1m': timedelta(days=30),
}


def ensure_store_announcements_schema() -> None:
    try:
        insp = inspect(db.engine)
        dialect = (getattr(db.engine.dialect, 'name', '') or '').lower()
        if 'store_announcements' not in insp.get_table_names():
            StoreAnnouncement.__table__.create(db.engine, checkfirst=True)
            return
        cols = {c['name'].lower(): c for c in insp.get_columns('store_announcements')}
        # Permitir decimales en días/horas personalizados (Postgres).
        if dialect in ('postgresql', 'postgres'):
            for col_name in ('custom_days', 'custom_hours'):
                meta = cols.get(col_name)
                if not meta:
                    continue
                typ = str(meta.get('type') or '').lower()
                if 'int' in typ and 'float' not in typ and 'double' not in typ and 'numeric' not in typ:
                    try:
                        db.session.execute(
                            text(
                                f'ALTER TABLE store_announcements '
                                f'ALTER COLUMN {col_name} TYPE DOUBLE PRECISION '
                                f'USING {col_name}::double precision'
                            )
                        )
                        db.session.commit()
                    except Exception as col_exc:
                        db.session.rollback()
                        logger.warning('anuncios alter %s: %s', col_name, col_exc)
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        logger.warning('ensure_store_announcements_schema: %s', exc)


def _parse_nonneg_float(raw: Any, default: float = 0.0) -> float:
    if raw is None:
        return default
    try:
        if isinstance(raw, str):
            raw = raw.strip().replace(',', '.')
            if raw == '':
                return default
        n = float(raw)
    except (TypeError, ValueError):
        return default
    if n < 0 or n != n:  # NaN
        return default
    return n


def normalize_duration_preset(raw: Any) -> str:
    key = str(raw or 'indefinido').strip().lower()
    if key in DURATION_PRESETS:
        return key
    return 'indefinido'


def compute_expires_at(
    preset: str,
    *,
    custom_days: float = 0,
    custom_hours: float = 0,
    starts_at: datetime | None = None,
) -> datetime | None:
    start = starts_at or datetime.utcnow()
    p = normalize_duration_preset(preset)
    if p == 'indefinido':
        return None
    if p == 'personalizado':
        days = max(0.0, float(custom_days or 0))
        hours = max(0.0, float(custom_hours or 0))
        delta = timedelta(days=days, hours=hours)
        if delta.total_seconds() <= 0:
            return None
        return start + delta
    delta = _PRESET_DELTAS.get(p)
    if not delta:
        return None
    return start + delta


def announcement_is_live(row: StoreAnnouncement, *, now: datetime | None = None) -> bool:
    if not row or not bool(getattr(row, 'enabled', False)):
        return False
    now = now or datetime.utcnow()
    exp = getattr(row, 'expires_at', None)
    if exp is None:
        return True
    try:
        return exp > now
    except TypeError:
        return False


def serialize_announcement(row: StoreAnnouncement, *, public: bool = False) -> dict[str, Any]:
    data = {
        'id': int(row.id),
        'title': row.title or '',
        'html': row.html_content or '',
        'duration_preset': normalize_duration_preset(row.duration_preset),
        'custom_days': float(row.custom_days or 0) if row.custom_days is not None else 0,
        'custom_hours': float(row.custom_hours or 0) if row.custom_hours is not None else 0,
        'show_on_entry': bool(row.show_on_entry),
        'enabled': bool(row.enabled),
        'expires_at': row.expires_at.isoformat() if row.expires_at else None,
        'is_live': announcement_is_live(row),
    }
    if public:
        return {
            'id': data['id'],
            'html': data['html'],
            'show_on_entry': data['show_on_entry'],
        }
    return data


def apply_duration_fields(
    row: StoreAnnouncement,
    *,
    preset: str,
    custom_days: float = 0,
    custom_hours: float = 0,
    refresh_start: bool = True,
) -> None:
    p = normalize_duration_preset(preset)
    row.duration_preset = p
    if p == 'personalizado':
        row.custom_days = float(custom_days or 0)
        row.custom_hours = float(custom_hours or 0)
    else:
        row.custom_days = None
        row.custom_hours = None
    if refresh_start or not row.starts_at:
        row.starts_at = datetime.utcnow()
    row.expires_at = compute_expires_at(
        p,
        custom_days=float(row.custom_days or 0),
        custom_hours=float(row.custom_hours or 0),
        starts_at=row.starts_at,
    )


def purge_expired_announcements() -> int:
    """
    Elimina anuncios con fecha de vencimiento cumplida.
    Los indefinidos (expires_at IS NULL) no se tocan.
    Aplica a personalizado y presets con días (1d, 3d, 7d, 10d, 1m).
    """
    ensure_store_announcements_schema()
    now = datetime.utcnow()
    # Sanar filas con duración acotada pero sin expires_at (datos viejos / bug).
    try:
        orphan_timed = (
            StoreAnnouncement.query.filter(
                StoreAnnouncement.duration_preset.isnot(None),
                StoreAnnouncement.duration_preset != 'indefinido',
                StoreAnnouncement.expires_at.is_(None),
            ).all()
        )
        for row in orphan_timed:
            start = row.starts_at or row.created_at or now
            if not row.starts_at:
                row.starts_at = start
            row.expires_at = compute_expires_at(
                normalize_duration_preset(row.duration_preset),
                custom_days=float(row.custom_days or 0),
                custom_hours=float(row.custom_hours or 0),
                starts_at=start,
            )
        if orphan_timed:
            db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception('purge_expired_announcements: no se pudo sanar expires_at')

    try:
        expired = (
            StoreAnnouncement.query.filter(
                StoreAnnouncement.expires_at.isnot(None),
                StoreAnnouncement.expires_at <= now,
            ).all()
        )
        if not expired:
            return 0
        n = 0
        for row in expired:
            db.session.delete(row)
            n += 1
        db.session.commit()
        if n:
            logger.info('Anuncios vencidos eliminados: %s', n)
        return n
    except Exception:
        db.session.rollback()
        logger.exception('purge_expired_announcements falló')
        return 0


def list_announcements_admin() -> list[dict[str, Any]]:
    ensure_store_announcements_schema()
    purge_expired_announcements()
    rows = StoreAnnouncement.query.order_by(StoreAnnouncement.id.desc()).all()
    return [serialize_announcement(r) for r in rows]


def list_live_announcements(*, on_entry_only: bool = False) -> list[dict[str, Any]]:
    ensure_store_announcements_schema()
    # No purgar aquí: el vencido ya no se muestra (filtro expires_at).
    # El borrado físico corre a las 03:00 CO (scheduler) o al listar en admin.
    now = datetime.utcnow()
    q = StoreAnnouncement.query.filter(StoreAnnouncement.enabled.is_(True))
    if on_entry_only:
        q = q.filter(StoreAnnouncement.show_on_entry.is_(True))
    q = q.filter(
        or_(StoreAnnouncement.expires_at.is_(None), StoreAnnouncement.expires_at > now)
    )
    rows = q.order_by(StoreAnnouncement.id.desc()).all()
    return [serialize_announcement(r, public=True) for r in rows]


def create_announcement_from_payload(data: dict[str, Any]) -> tuple[StoreAnnouncement | None, str | None]:
    title = str(data.get('title') or '').strip()
    html = str(data.get('html') or data.get('html_content') or '').strip()
    if not title:
        return None, 'El título es obligatorio.'
    if not html:
        return None, 'El campo HTML es obligatorio.'
    preset = normalize_duration_preset(data.get('duration_preset') or data.get('tiempo'))
    custom_days = _parse_nonneg_float(data.get('custom_days', data.get('dias')), 0.0)
    custom_hours = _parse_nonneg_float(data.get('custom_hours', data.get('horas')), 0.0)
    if preset == 'personalizado' and custom_days <= 0 and custom_hours <= 0:
        return None, 'En personalizado indica días y/o horas (puedes usar decimales, ej. 0.1).'
    row = StoreAnnouncement(
        title=title,
        html_content=html,
        show_on_entry=bool(data.get('show_on_entry') or data.get('aparece_al_ingresar')),
        enabled=True,
        created_at=datetime.utcnow(),
    )
    apply_duration_fields(
        row,
        preset=preset,
        custom_days=custom_days,
        custom_hours=custom_hours,
        refresh_start=True,
    )
    db.session.add(row)
    db.session.commit()
    return row, None


def update_announcement_from_payload(
    row: StoreAnnouncement,
    data: dict[str, Any],
) -> tuple[bool, str | None]:
    title = str(data.get('title') or '').strip()
    html = str(data.get('html') or data.get('html_content') or '').strip()
    if not title:
        return False, 'El título es obligatorio.'
    if not html:
        return False, 'El campo HTML es obligatorio.'
    preset = normalize_duration_preset(data.get('duration_preset') or data.get('tiempo'))
    custom_days = _parse_nonneg_float(data.get('custom_days', data.get('dias')), 0.0)
    custom_hours = _parse_nonneg_float(data.get('custom_hours', data.get('horas')), 0.0)
    if preset == 'personalizado' and custom_days <= 0 and custom_hours <= 0:
        return False, 'En personalizado indica días y/o horas (puedes usar decimales, ej. 0.1).'
    row.title = title
    row.html_content = html
    row.show_on_entry = bool(data.get('show_on_entry') or data.get('aparece_al_ingresar'))
    apply_duration_fields(
        row,
        preset=preset,
        custom_days=custom_days,
        custom_hours=custom_hours,
        refresh_start=True,
    )
    row.updated_at = datetime.utcnow()
    db.session.add(row)
    db.session.commit()
    return True, None
