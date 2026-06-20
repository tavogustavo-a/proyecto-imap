# Snapshots permanentes de licencias por compra (Ver licencias / historial archivado).

import json
import logging
from datetime import datetime

from sqlalchemy import inspect, text

from app.extensions import db
from app.store.models import LicenseAccount, Product, Sale, SalePurchaseSnapshot

logger = logging.getLogger(__name__)

RENEWAL_KIND_RENOVAR = 'renovar_1_mes'
RENEWAL_KIND_MES_A_MES = 'dejar_mes_a_mes'
RENEWAL_KIND_MIXTO = 'mixto'

RENEWAL_KIND_LABELS = {
    RENEWAL_KIND_RENOVAR: 'Renovación: 1 mes más',
    RENEWAL_KIND_MES_A_MES: 'Renovación: mes a mes',
    RENEWAL_KIND_MIXTO: 'Renovación mixta (1 mes más y mes a mes)',
}


def renewal_kind_display_label(kind):
    k = str(kind or '').strip()
    if not k:
        return ''
    return RENEWAL_KIND_LABELS.get(k, '')


def _green_storage_to_renewal_kind(status_good):
    from app.store.user_license_line_parse import normalize_status_key

    nk = normalize_status_key(str(status_good or '').strip())
    if nk == normalize_status_key('renovar 1 mes mas'):
        return RENEWAL_KIND_RENOVAR
    if nk == normalize_status_key('dejar mes a mes'):
        return RENEWAL_KIND_MES_A_MES
    return None


def _renewal_kind_from_dual(dual, raw_line=None):
    """Infiere renovar 1 mes / mes a mes desde una línea dual (portal o inventario)."""
    from app.store.user_license_line_parse import resolve_portal_green_select_value

    green = resolve_portal_green_select_value(dual or {}, raw_line=raw_line)
    return _green_storage_to_renewal_kind(green)


def detect_renewal_kind_for_account(
    user_row,
    license_row,
    account,
    allowed_usernames,
    raw_inventory_line=None,
    prefer_day_key=None,
):
    """Estado verde del portal (día N) o línea de inventario antes del checkout de renovación."""
    from app.store.user_license_line_parse import (
        line_visible_for_assignee_account,
        parse_admin_license_line_to_split_parts,
    )

    if raw_inventory_line and str(raw_inventory_line).strip():
        raw_inv = str(raw_inventory_line).strip()
        dual_raw = parse_admin_license_line_to_split_parts(raw_inv)
        kind_raw = _renewal_kind_from_dual(dual_raw, raw_line=raw_inv)
        if kind_raw:
            return kind_raw

    names = [n for n in (allowed_usernames or []) if n]
    if user_row and getattr(user_row, 'username', None):
        un = str(user_row.username or '').strip()
        if un and un not in names:
            names.append(un)
    email = str(getattr(account, 'email', '') or '').strip()
    aid = str(getattr(account, 'account_identifier', '') or '').strip()
    found = []

    def _scan_day_text(day_text):
        for line in str(day_text or '').replace('\r\n', '\n').replace('\r', '\n').split('\n'):
            stripped = line.strip()
            if not stripped:
                continue
            dual = parse_admin_license_line_to_split_parts(stripped)
            if not line_visible_for_assignee_account(dual, names, email, aid):
                continue
            kind = _renewal_kind_from_dual(dual, raw_line=stripped)
            if kind:
                found.append(kind)

    raw_dn = getattr(license_row, 'day_notepads_json', None) or ''
    if str(raw_dn).strip():
        try:
            day_map = json.loads(raw_dn)
        except (json.JSONDecodeError, TypeError):
            day_map = {}
        if isinstance(day_map, dict):
            pref = str(prefer_day_key or '').strip()
            if pref and pref in day_map:
                _scan_day_text(day_map.get(pref))
            for _day_key, day_text in day_map.items():
                if pref and str(_day_key) == pref:
                    continue
                _scan_day_text(day_text)

    slot = getattr(account, 'inventory_bloc_ord', None)
    if slot is not None:
        try:
            sb = int(slot)
        except (TypeError, ValueError):
            sb = None
        if sb is not None and sb >= 1:
            notes = getattr(license_row, 'license_notes', None) or ''
            lines = str(notes).replace('\r\n', '\n').replace('\r', '\n').split('\n')
            idx = sb - 1
            if 0 <= idx < len(lines):
                raw_slot = lines[idx].strip()
                dual = parse_admin_license_line_to_split_parts(raw_slot)
                kind = _renewal_kind_from_dual(dual, raw_line=raw_slot)
                if kind:
                    found.append(kind)

    if RENEWAL_KIND_MES_A_MES in found and RENEWAL_KIND_RENOVAR in found:
        return RENEWAL_KIND_MIXTO
    if found:
        return found[-1]
    return None


def merge_sale_renewal_kind(sale, kind):
    kind = str(kind or '').strip()
    if not kind or not sale:
        return
    cur = str(getattr(sale, 'renewal_kind', None) or '').strip()
    if not cur:
        sale.renewal_kind = kind
    elif cur == kind:
        pass
    else:
        sale.renewal_kind = RENEWAL_KIND_MIXTO


def resolve_renewal_kind_for_sale(sale, snap=None):
    if not sale or not getattr(sale, 'is_renewal', False):
        return None
    stored = str(getattr(sale, 'renewal_kind', None) or '').strip()
    if stored:
        return stored
    if snap is not None:
        stored = str(getattr(snap, 'renewal_kind', None) or '').strip()
        if stored:
            return stored

    from app.models.user import User
    from app.store.models import License, LicenseAccount

    user = User.query.get(sale.user_id)
    if not user:
        return None
    names = [(user.username or '').strip()]
    prefer_day = None
    if sale.created_at:
        try:
            from app.utils.timezone import utc_to_colombia

            prefer_day = str(int(utc_to_colombia(sale.created_at).day))
        except (TypeError, ValueError, OSError, OverflowError):
            prefer_day = None
    accounts = LicenseAccount.query.filter_by(sale_id=sale.id).all()
    kinds = set()
    for acc in accounts:
        lic = License.query.get(acc.license_id) if acc.license_id else None
        if not lic:
            continue
        k = detect_renewal_kind_for_account(
            user, lic, acc, names, prefer_day_key=prefer_day
        )
        if k == RENEWAL_KIND_MIXTO:
            _persist_inferred_renewal_kind(sale, snap, RENEWAL_KIND_MIXTO)
            return RENEWAL_KIND_MIXTO
        if k:
            kinds.add(k)
    inferred = None
    if len(kinds) == 1:
        inferred = next(iter(kinds))
    elif len(kinds) > 1:
        inferred = RENEWAL_KIND_MIXTO
    if inferred:
        _persist_inferred_renewal_kind(sale, snap, inferred)
    return inferred


def _persist_inferred_renewal_kind(sale, snap, kind):
    if not kind or not sale:
        return
    changed = False
    if not str(getattr(sale, 'renewal_kind', None) or '').strip():
        sale.renewal_kind = kind
        db.session.add(sale)
        changed = True
    if snap is not None and not str(getattr(snap, 'renewal_kind', None) or '').strip():
        snap.renewal_kind = kind
        db.session.add(snap)
        changed = True
    if not changed:
        return
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.debug('No se pudo guardar renewal_kind inferido sale_id=%s: %s', getattr(sale, 'id', None), exc)


def _db_dialect():
    return getattr(db.engine.dialect, 'name', '') or ''


def _bool_default_false():
    return 'FALSE' if _db_dialect() == 'postgresql' else '0'


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
        logger.warning(
            'No se pudo añadir %s.%s (%s): %s',
            table_name,
            column_name,
            _db_dialect(),
            exc,
        )


def ensure_sale_schema():
    """Columnas de renovación en ventas (tipo 1 mes / mes a mes)."""
    bool_false = _bool_default_false()
    _ensure_column('store_sales', 'is_renewal', f'is_renewal BOOLEAN DEFAULT {bool_false} NOT NULL')
    _ensure_column('store_sales', 'renewal_kind', 'renewal_kind VARCHAR(24)')


def ensure_snapshot_table():
    """Crea la tabla en SQLite/Postgres si aún no existe (sin migración Alembic)."""
    try:
        insp = inspect(db.engine)
        if 'store_sale_purchase_snapshots' not in insp.get_table_names():
            SalePurchaseSnapshot.__table__.create(db.engine, checkfirst=True)
        else:
            bool_false = _bool_default_false()
            _ensure_column(
                'store_sale_purchase_snapshots',
                'is_renewal',
                f'is_renewal BOOLEAN DEFAULT {bool_false} NOT NULL',
            )
            _ensure_column(
                'store_sale_purchase_snapshots',
                'renewal_kind',
                'renewal_kind VARCHAR(24)',
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
    snap.renewal_kind = getattr(sale, 'renewal_kind', None)
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
    renewal_kind = None
    if is_renewal:
        renewal_kind = str(getattr(snap, 'renewal_kind', None) or '').strip() or None
        if not renewal_kind and snap.sale_id:
            sale_row = Sale.query.get(snap.sale_id)
            if sale_row:
                renewal_kind = resolve_renewal_kind_for_sale(sale_row, snap)

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
        'renewal_kind': renewal_kind,
        'renewal_kind_label': renewal_kind_display_label(renewal_kind),
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
    try:
        from app.store.whatsapp_daily_sales import queue_snapshots_for_whatsapp_daily

        queue_snapshots_for_whatsapp_daily(sale_ids)
    except Exception as exc:
        logger.warning('Cola WhatsApp resumen diario tras checkout: %s', exc)
