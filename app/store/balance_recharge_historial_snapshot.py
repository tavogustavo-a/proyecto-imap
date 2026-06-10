# Snapshots permanentes de recargas para el historial de compras (independiente del panel admin).

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Iterable, List, Optional

from sqlalchemy import inspect

from app.extensions import db
from app.store.balance_recharge_historial import (
    HISTORIAL_STATUSES,
    compute_historial_producto,
    ensure_historial_producto_schema,
    historial_item_from_row,
)
from app.store.models import BalanceRecharge, BalanceRechargeHistorialSnapshot

logger = logging.getLogger(__name__)


def ensure_snapshot_table():
    try:
        insp = inspect(db.engine)
        if 'store_balance_recharge_historial_snapshots' not in insp.get_table_names():
            BalanceRechargeHistorialSnapshot.__table__.create(db.engine, checkfirst=True)
        ensure_historial_producto_schema()
    except Exception as exc:
        logger.warning(
            'No se pudo asegurar tabla store_balance_recharge_historial_snapshots: %s',
            exc,
        )


def _event_at_from_recharge(row: BalanceRecharge) -> datetime:
    return row.reviewed_at or row.created_at or datetime.utcnow()


def upsert_snapshot_for_recharge(row: BalanceRecharge, *, mark_purged: bool = False) -> BalanceRechargeHistorialSnapshot | None:
    if not row or not row.id:
        return None
    st = (row.status or '').lower()
    if st not in HISTORIAL_STATUSES:
        return None

    ensure_snapshot_table()
    snap = BalanceRechargeHistorialSnapshot.query.filter_by(recharge_id=int(row.id)).first()
    if not snap:
        snap = BalanceRechargeHistorialSnapshot(recharge_id=int(row.id), user_id=int(row.user_id))

    snap.user_id = int(row.user_id)
    snap.currency = (row.currency or 'COP').strip().upper()[:3]
    snap.payment_method_id = row.payment_method_id
    snap.amount_claimed = row.amount_claimed
    snap.amount_credited = row.amount_credited
    snap.status = row.status
    snap.auto_credited = bool(getattr(row, 'auto_credited', False))
    snap.admin_verified = getattr(row, 'admin_verified', None)
    snap.admin_note = row.admin_note
    snap.historial_producto = getattr(row, 'historial_producto', None) or compute_historial_producto(row)
    snap.event_at = _event_at_from_recharge(row)
    if mark_purged:
        snap.purged_from_recharges = True
    snap.updated_at = datetime.utcnow()
    db.session.add(snap)
    return snap


def archive_recharges_before_purge(rows: Iterable[BalanceRecharge]) -> int:
    """Copia al snapshot las recargas visibles en historial de compras antes de borrarlas del admin."""
    if not rows:
        return 0
    ensure_snapshot_table()
    archived = 0
    for row in rows:
        if upsert_snapshot_for_recharge(row, mark_purged=True):
            archived += 1
    if archived:
        db.session.commit()
    return archived


def detach_snapshots_after_recharge_purge(recharge_ids: List[int]) -> None:
    if not recharge_ids:
        return
    ensure_snapshot_table()
    ids = [int(x) for x in recharge_ids]
    (
        BalanceRechargeHistorialSnapshot.query.filter(
            BalanceRechargeHistorialSnapshot.recharge_id.in_(ids)
        ).update({BalanceRechargeHistorialSnapshot.recharge_id: None}, synchronize_session=False)
    )
    db.session.commit()


def repair_stale_snapshot_recharge_ids() -> int:
    ensure_snapshot_table()
    rows = (
        BalanceRechargeHistorialSnapshot.query.filter(
            BalanceRechargeHistorialSnapshot.recharge_id.isnot(None)
        )
        .with_entities(BalanceRechargeHistorialSnapshot.recharge_id)
        .distinct()
        .all()
    )
    recharge_ids = [int(r[0]) for r in rows if r[0] is not None]
    if not recharge_ids:
        return 0
    existing = {
        int(r[0])
        for r in BalanceRecharge.query.filter(BalanceRecharge.id.in_(recharge_ids))
        .with_entities(BalanceRecharge.id)
        .all()
    }
    stale = [rid for rid in recharge_ids if rid not in existing]
    if not stale:
        return 0
    updated = (
        BalanceRechargeHistorialSnapshot.query.filter(
            BalanceRechargeHistorialSnapshot.recharge_id.in_(stale)
        ).update({BalanceRechargeHistorialSnapshot.recharge_id: None}, synchronize_session=False)
    )
    db.session.commit()
    return updated


def _snapshots_query(*, user_id: Optional[int] = None, all_users: bool = False):
    ensure_snapshot_table()
    q = BalanceRechargeHistorialSnapshot.query.filter_by(purged_from_recharges=True)
    if not all_users:
        if not user_id:
            return None
        q = q.filter(BalanceRechargeHistorialSnapshot.user_id == int(user_id))
    return q.order_by(BalanceRechargeHistorialSnapshot.event_at.desc())


def purge_snapshots_batched(retention_days: int, user_id: Optional[int] = None, batch_size: int = 250) -> int:
    """Elimina snapshots archivados (solo desde limpieza del historial de compras)."""
    from app.store.balance_recharge_cleanup import _cutoff_utc

    cutoff = _cutoff_utc(retention_days)
    total = 0
    batch_size = max(50, int(batch_size or 250))

    while True:
        q = BalanceRechargeHistorialSnapshot.query.filter_by(purged_from_recharges=True)
        if cutoff is not None:
            q = q.filter(BalanceRechargeHistorialSnapshot.event_at <= cutoff)
        if user_id is not None:
            q = q.filter(BalanceRechargeHistorialSnapshot.user_id == int(user_id))
        ids = [
            int(r[0])
            for r in q.with_entities(BalanceRechargeHistorialSnapshot.id)
            .order_by(BalanceRechargeHistorialSnapshot.id.asc())
            .limit(batch_size)
            .all()
        ]
        if not ids:
            break
        BalanceRechargeHistorialSnapshot.query.filter(
            BalanceRechargeHistorialSnapshot.id.in_(ids)
        ).delete(synchronize_session=False)
        db.session.commit()
        total += len(ids)
        if len(ids) < batch_size:
            break
    return total


def count_snapshots_to_purge(retention_days: int, user_id: Optional[int] = None) -> int:
    from app.store.balance_recharge_cleanup import _cutoff_utc

    cutoff = _cutoff_utc(retention_days)
    q = BalanceRechargeHistorialSnapshot.query.filter_by(purged_from_recharges=True)
    if cutoff is not None:
        q = q.filter(BalanceRechargeHistorialSnapshot.event_at <= cutoff)
    if user_id is not None:
        q = q.filter(BalanceRechargeHistorialSnapshot.user_id == int(user_id))
    return q.count()


def build_archived_recharge_historial_items(
    *,
    user_id: Optional[int] = None,
    all_users: bool = False,
    utc_to_colombia_fn,
    exclude_recharge_ids: Optional[set[int]] = None,
) -> List[dict[str, Any]]:
    q = _snapshots_query(user_id=user_id, all_users=all_users)
    if q is None:
        return []
    rows = q.limit(500).all()
    if not rows:
        return []

    exclude = exclude_recharge_ids or set()
    user_ids = {int(r.user_id) for r in rows if r.user_id}
    users_map: dict[int, str] = {}
    if user_ids and all_users:
        from app.store.models import User

        for u in User.query.filter(User.id.in_(user_ids)).all():
            users_map[int(u.id)] = u.username or str(u.id)

    out: List[dict[str, Any]] = []
    for snap in rows:
        if snap.recharge_id is not None and int(snap.recharge_id) in exclude:
            continue
        item = historial_item_from_row(
            snap,
            row_id_prefix='recharge-snap',
            row_id_value=snap.id,
            utc_to_colombia_fn=utc_to_colombia_fn,
            users_map=users_map if all_users else None,
        )
        item['is_archived_recharge'] = True
        out.append(item)
    return out
