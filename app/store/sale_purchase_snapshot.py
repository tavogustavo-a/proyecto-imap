# Snapshots permanentes de licencias por compra (Ver licencias / historial archivado).

import json
import logging
from datetime import datetime

from sqlalchemy import inspect, text

from app.extensions import db
from app.store.models import LicenseAccount, Product, Sale, SalePurchaseSnapshot

logger = logging.getLogger(__name__)


def _ensure_column(table_name, column_name, ddl_fragment):
    try:
        insp = inspect(db.engine)
        if table_name not in insp.get_table_names():
            return
        cols = {c['name'] for c in insp.get_columns(table_name)}
        if column_name in cols:
            return
        db.session.execute(text(f'ALTER TABLE {table_name} ADD COLUMN {ddl_fragment}'))
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.warning('No se pudo añadir %s.%s: %s', table_name, column_name, exc)


def ensure_sale_schema():
    """Columna is_renewal en ventas (renovación 1 mes / mes a mes)."""
    _ensure_column('store_sales', 'is_renewal', 'is_renewal BOOLEAN DEFAULT 0 NOT NULL')


def ensure_snapshot_table():
    """Crea la tabla en SQLite/Postgres si aún no existe (sin migración Alembic)."""
    try:
        insp = inspect(db.engine)
        if 'store_sale_purchase_snapshots' not in insp.get_table_names():
            SalePurchaseSnapshot.__table__.create(db.engine, checkfirst=True)
        else:
            _ensure_column(
                'store_sale_purchase_snapshots',
                'is_renewal',
                'is_renewal BOOLEAN DEFAULT 0 NOT NULL',
            )
    except Exception as exc:
        logger.warning('No se pudo asegurar tabla store_sale_purchase_snapshots: %s', exc)


def _licencias_from_accounts(accounts):
    out = []
    for acc in accounts:
        out.append({
            'email': acc.email,
            'password': acc.password,
            'identifier': acc.account_identifier,
        })
    return out


def _load_licencias_json(snap):
    if not snap or not snap.licencias_json:
        return []
    try:
        data = json.loads(snap.licencias_json)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def upsert_snapshot_for_sale(sale, mark_purged=False):
    """Guarda o actualiza credenciales entregadas en una venta."""
    ensure_snapshot_table()
    if not sale or not sale.id:
        return None

    product = Product.query.get(sale.product_id) if sale.product_id else None
    accounts = (
        LicenseAccount.query.filter_by(sale_id=sale.id)
        .order_by(LicenseAccount.id.asc())
        .all()
    )
    licencias = _licencias_from_accounts(accounts)

    snap = SalePurchaseSnapshot.query.filter_by(sale_id=sale.id).first()
    if not snap:
        snap = SalePurchaseSnapshot(sale_id=sale.id, user_id=sale.user_id)

    snap.user_id = sale.user_id
    snap.product_id = sale.product_id
    snap.product_name = product.name if product else f'Producto #{sale.product_id}'
    snap.quantity = sale.quantity or 1
    snap.total_price = sale.total_price
    snap.sale_created_at = sale.created_at or datetime.utcnow()
    snap.is_renewal = bool(getattr(sale, 'is_renewal', False))
    if licencias or not snap.licencias_json:
        snap.licencias_json = json.dumps(licencias, ensure_ascii=False)
    if mark_purged:
        snap.purged_from_sales = True
    snap.updated_at = datetime.utcnow()
    db.session.add(snap)
    return snap


def archive_sales_before_purge(sale_ids):
    """Copia credenciales al snapshot antes de borrar filas de store_sales."""
    if not sale_ids:
        return
    ensure_snapshot_table()
    for sid in sale_ids:
        sale = Sale.query.get(int(sid))
        if sale:
            upsert_snapshot_for_sale(sale, mark_purged=True)
    db.session.commit()


def detach_snapshots_after_sale_purge(sale_ids):
    """Evita snapshots con sale_id apuntando a ventas ya eliminadas."""
    if not sale_ids:
        return
    ensure_snapshot_table()
    ids = [int(x) for x in sale_ids]
    (
        SalePurchaseSnapshot.query.filter(SalePurchaseSnapshot.sale_id.in_(ids))
        .update({SalePurchaseSnapshot.sale_id: None}, synchronize_session=False)
    )
    db.session.commit()


def repair_stale_snapshot_sale_ids():
    """Limpia sale_id huérfanos en snapshots (venta ya no existe en store_sales)."""
    ensure_snapshot_table()
    rows = (
        SalePurchaseSnapshot.query.filter(SalePurchaseSnapshot.sale_id.isnot(None))
        .with_entities(SalePurchaseSnapshot.sale_id)
        .distinct()
        .all()
    )
    sale_ids = [int(r[0]) for r in rows if r[0] is not None]
    if not sale_ids:
        return 0
    existing = {
        int(r[0])
        for r in Sale.query.filter(Sale.id.in_(sale_ids)).with_entities(Sale.id).all()
    }
    stale = [sid for sid in sale_ids if sid not in existing]
    if not stale:
        return 0
    updated = (
        SalePurchaseSnapshot.query.filter(SalePurchaseSnapshot.sale_id.in_(stale))
        .update({SalePurchaseSnapshot.sale_id: None}, synchronize_session=False)
    )
    db.session.commit()
    return updated


def mark_sale_reversed(sale_id):
    """Marca la compra como revertida pero conserva credenciales en el historial."""
    ensure_snapshot_table()
    sale = Sale.query.get(int(sale_id))
    if not sale:
        snap = SalePurchaseSnapshot.query.filter_by(sale_id=int(sale_id)).first()
    else:
        snap = upsert_snapshot_for_sale(sale)
    if not snap:
        snap = SalePurchaseSnapshot.query.filter_by(sale_id=int(sale_id)).first()
    if not snap:
        return None
    snap.is_reversed = True
    snap.reversed_at = datetime.utcnow()
    snap.updated_at = datetime.utcnow()
    db.session.add(snap)
    db.session.commit()
    return snap


def get_licencias_for_sale_row(sale):
    """Licencias para «Ver licencias»: snapshot primero, luego cuentas vivas."""
    ensure_snapshot_table()
    snap = SalePurchaseSnapshot.query.filter_by(sale_id=sale.id).first()
    is_renewal = bool(getattr(sale, 'is_renewal', False))
    if snap:
        licencias = _load_licencias_json(snap)
        is_renewal = is_renewal or bool(getattr(snap, 'is_renewal', False))
        if licencias:
            return licencias, bool(snap.is_reversed), is_renewal, snap.id
    accounts = (
        LicenseAccount.query.filter_by(sale_id=sale.id)
        .order_by(LicenseAccount.id.asc())
        .all()
    )
    licencias = _licencias_from_accounts(accounts)
    return licencias, False, is_renewal, snap.id if snap else None


def snapshot_to_historial_item(snap, username_by_id=None):
    from app.utils.timezone import utc_to_colombia
    from app.models.user import User

    fecha_str = 'Fecha no disponible'
    sort_ts = 0.0
    if snap.sale_created_at:
        try:
            sort_ts = snap.sale_created_at.timestamp()
            fecha_col = utc_to_colombia(snap.sale_created_at)
            fecha_str = fecha_col.strftime('%y/%m/%d %I:%M:%S %p')
        except (ValueError, TypeError, OSError):
            pass

    licencias = _load_licencias_json(snap)
    producto = snap.product_name or 'Compra'
    if snap.is_reversed:
        producto = producto + ' (compra revertida)'

    is_renewal = bool(getattr(snap, 'is_renewal', False))

    usuario = None
    if username_by_id and snap.user_id in username_by_id:
        usuario = username_by_id[snap.user_id]
    else:
        u = User.query.get(snap.user_id)
        if u:
            usuario = u.username

    item = {
        'id': 'snap-' + str(snap.id),
        'fecha': fecha_str,
        'producto': producto,
        'cantidad': snap.quantity or 0,
        'total': float(snap.total_price or 0),
        'licencias': licencias,
        'is_archived_sale': True,
        'is_renewal': is_renewal,
        'is_reversed': bool(snap.is_reversed),
        'has_licencias': len(licencias) > 0,
        'sort_ts': sort_ts,
        'user_id': snap.user_id,
        'usuario': usuario,
    }
    return item


def sync_snapshots_for_sale_ids(sale_ids):
    """Tras checkout: guardar credenciales de cada venta nueva."""
    ensure_snapshot_table()
    for sid in sale_ids:
        sale = Sale.query.get(int(sid))
        if sale:
            upsert_snapshot_for_sale(sale)
    db.session.commit()
