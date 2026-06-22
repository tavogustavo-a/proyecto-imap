# -*- coding: utf-8 -*-
"""Resumen diario WhatsApp: compras y renovaciones del día (Colombia) + pausa de ventas."""

from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, time
from typing import Any, Callable

from app.extensions import db
from app.models.user import User
from app.store.models import Sale, SalePurchaseSnapshot, WhatsAppConfig
from app.utils.timezone import COLOMBIA_TZ, get_colombia_datetime, utc_to_colombia

logger = logging.getLogger(__name__)


def ensure_whatsapp_daily_sales_columns():
    """Añade columnas de cola diaria en snapshots si faltan."""
    try:
        from sqlalchemy import inspect, text

        inspector = inspect(db.engine)
        if 'store_sale_purchase_snapshots' not in inspector.get_table_names():
            return
        cols = {c['name'] for c in inspector.get_columns('store_sale_purchase_snapshots')}
        dialect = getattr(db.engine.dialect, 'name', '') or ''
        date_type = 'DATE'
        dt_type = 'TIMESTAMP' if dialect == 'postgresql' else 'DATETIME'

        additions = [
            ('whatsapp_daily_co_date', f'ALTER TABLE store_sale_purchase_snapshots ADD COLUMN whatsapp_daily_co_date {date_type}'),
            ('whatsapp_daily_sent_at', f'ALTER TABLE store_sale_purchase_snapshots ADD COLUMN whatsapp_daily_sent_at {dt_type}'),
        ]
        for col_name, ddl in additions:
            if col_name in cols:
                continue
            try:
                db.session.execute(text(ddl))
                db.session.commit()
                cols.add(col_name)
            except Exception as col_exc:
                try:
                    db.session.rollback()
                except Exception:
                    pass
                logger.warning(
                    'No se pudo añadir columna store_sale_purchase_snapshots.%s: %s',
                    col_name,
                    col_exc,
                )
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        logger.warning('No se pudo asegurar columnas whatsapp_daily_sales: %s', exc)


def is_whatsapp_daily_digest_active() -> bool:
    from app.store.whatsapp_web_service import get_whatsapp_singleton_config

    cfg = get_whatsapp_singleton_config()
    return bool(cfg and cfg.is_enabled)


def _store_account_user_ids(user: User) -> set[int]:
    """Titular + subusuarios con tienda (misma cuenta de facturación)."""
    from app.store.routes import _billing_user_for_store_debt_limit

    billing = _billing_user_for_store_debt_limit(user)
    if not billing:
        return set()
    ids = {int(billing.id)}
    subs = User.query.filter_by(parent_id=billing.id, enabled=True).all()
    for sub in subs:
        ids.add(int(sub.id))
    return ids


def _snapshot_co_date(snap: SalePurchaseSnapshot) -> date | None:
    raw = getattr(snap, 'whatsapp_daily_co_date', None)
    if raw:
        return raw if isinstance(raw, date) else date.fromisoformat(str(raw))
    stamp = snap.sale_created_at
    if stamp:
        try:
            return utc_to_colombia(stamp).date()
        except Exception:
            pass
    return None


def _co_date_ready_for_send(co_date: date, config: WhatsAppConfig, co_now) -> bool:
    """True si ya corresponde enviar el resumen de ese día calendario CO."""
    if co_date < co_now.date():
        return True
    if co_date > co_now.date():
        return False
    target = config.notification_time
    if not target:
        return False
    return (co_now.hour * 60 + co_now.minute) >= (target.hour * 60 + target.minute)


def pending_daily_snapshots_query():
    ensure_whatsapp_daily_sales_columns()
    return SalePurchaseSnapshot.query.filter(
        SalePurchaseSnapshot.is_reversed.is_(False),
        SalePurchaseSnapshot.whatsapp_daily_sent_at.is_(None),
        SalePurchaseSnapshot.whatsapp_daily_co_date.isnot(None),
    )


def user_has_pending_whatsapp_daily_sales(user: User) -> bool:
    if not is_whatsapp_daily_digest_active():
        return False
    ids = _store_account_user_ids(user)
    if not ids:
        return False
    return pending_daily_snapshots_query().filter(
        SalePurchaseSnapshot.user_id.in_(list(ids))
    ).count() > 0


def check_whatsapp_daily_sales_block(user: User) -> str | None:
    """Checkout no se bloquea por resúmenes WhatsApp pendientes; siguen en cola para envío."""
    del user
    return None


def has_pending_daily_digests_ready(config: WhatsAppConfig, co_now=None) -> bool:
    if not config or not config.is_enabled:
        return False
    co_now = co_now or get_colombia_datetime()
    pending = pending_daily_snapshots_query().all()
    for snap in pending:
        co_date = _snapshot_co_date(snap)
        if co_date and _co_date_ready_for_send(co_date, config, co_now):
            return True
    return False


def queue_snapshots_for_whatsapp_daily(sale_ids: list[int]) -> None:
    """Marca ventas del checkout para el resumen diario WhatsApp."""
    if not is_whatsapp_daily_digest_active() or not sale_ids:
        return

    from app.store.routes import _eligible_tienda_user_licencias_portal

    ensure_whatsapp_daily_sales_columns()
    co_now = get_colombia_datetime()

    for sid in sale_ids:
        try:
            sale = Sale.query.get(int(sid))
        except (TypeError, ValueError):
            continue
        if not sale:
            continue
        user = User.query.get(sale.user_id)
        if not user or not _eligible_tienda_user_licencias_portal(user):
            continue

        snap = SalePurchaseSnapshot.query.filter_by(sale_id=sale.id).first()
        if not snap:
            continue
        if getattr(snap, 'whatsapp_daily_sent_at', None):
            continue

        try:
            sale_co = utc_to_colombia(sale.created_at or datetime.utcnow()).date()
        except Exception:
            sale_co = co_now.date()

        snap.whatsapp_daily_co_date = sale_co
        db.session.add(snap)

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.warning('queue_snapshots_for_whatsapp_daily: %s', exc)


def _group_pending_by_user_and_date(
    config: WhatsAppConfig,
    co_now,
    *,
    force: bool = False,
) -> dict[tuple[int, date], list[SalePurchaseSnapshot]]:
    from app.store.routes import _billing_user_for_store_debt_limit

    groups: dict[tuple[int, date], list[SalePurchaseSnapshot]] = {}
    for snap in pending_daily_snapshots_query().order_by(SalePurchaseSnapshot.id.asc()).all():
        co_date = _snapshot_co_date(snap)
        if not co_date:
            continue
        if co_date > co_now.date():
            continue
        if not force and not _co_date_ready_for_send(co_date, config, co_now):
            continue
        snap_user = User.query.get(int(snap.user_id))
        billing = _billing_user_for_store_debt_limit(snap_user) if snap_user else None
        billing_id = int(billing.id) if billing else int(snap.user_id)
        key = (billing_id, co_date)
        groups.setdefault(key, []).append(snap)
    return groups


def _billing_currency(billing_user: User) -> str:
    up = billing_user.user_prices if isinstance(billing_user.user_prices, dict) else {}
    return (up.get('tipo_precio') or 'COP').strip().upper()


def _billing_prepaid_balance(billing_user: User, currency: str) -> float:
    if currency == 'USD':
        return float(getattr(billing_user, 'saldo_usd', 0) or 0)
    return float(getattr(billing_user, 'saldo_cop', 0) or 0)


def _format_whatsapp_amount(amount: float) -> str:
    try:
        val = float(amount or 0)
    except (TypeError, ValueError):
        val = 0.0
    abs_val = abs(val)
    if abs(abs_val - round(abs_val)) < 1e-9:
        body = f'{int(round(abs_val)):,}'.replace(',', '.')
    else:
        body = f'{abs_val:.2f}'.replace('.', ',')
    if val < -1e-9:
        return f'-{body}'
    return f'${body}'


def _format_whatsapp_saldo_line(amount: float) -> str:
    if amount > 1e-9:
        return f'a favor {_format_whatsapp_amount(amount)}'
    if amount < -1e-9:
        return _format_whatsapp_amount(amount)
    return 'al día ($0)'


def _aggregate_snapshots_by_product(
    snapshots: list[SalePurchaseSnapshot],
    *,
    is_renewal: bool,
) -> list[tuple[str, int]]:
    order: list[str] = []
    totals: dict[str, int] = {}
    for snap in snapshots:
        if bool(getattr(snap, 'is_renewal', False)) != is_renewal:
            continue
        name = (snap.product_name or 'Producto').strip()
        qty = max(1, int(snap.quantity or 1))
        if name not in totals:
            order.append(name)
            totals[name] = 0
        totals[name] += qty
    return [(name, totals[name]) for name in order]


def _section_summary_line(
    label: str,
    snapshots: list[SalePurchaseSnapshot],
    *,
    is_renewal: bool,
) -> str | None:
    items = _aggregate_snapshots_by_product(snapshots, is_renewal=is_renewal)
    if not items:
        return None
    parts = [f'{qty} {name}' for name, qty in items]
    return f'{label}: ' + ', '.join(parts)


def _day_has_commerce_snapshots(snapshots: list[SalePurchaseSnapshot]) -> bool:
    """True si el día tiene al menos una compra o renovación en tienda."""
    return bool(
        _section_summary_line('Renovaciones', snapshots, is_renewal=True)
        or _section_summary_line('Compras', snapshots, is_renewal=False)
    )


def _email_es_credencial_interna(email: str) -> bool:
    e = (email or '').lower().strip()
    if not e:
        return False
    if e.endswith('@store.internal'):
        return True
    return bool(re.match(r'^inv\.l\d+\.', e, re.IGNORECASE))


def _password_para_mostrar(password: str) -> str:
    p = (password or '').strip()
    if not p or p in ('—', '-', '.'):
        return ''
    return p


def _whatsapp_license_line(lic: dict[str, Any]) -> str | None:
    if not isinstance(lic, dict):
        return None
    email = (lic.get('email') or '').strip()
    password = _password_para_mostrar(str(lic.get('password') or ''))
    identifier = (lic.get('identifier') or '').strip()
    if _email_es_credencial_interna(email):
        main = password or identifier
        return main or None
    if email:
        return email
    if password:
        return password
    if identifier:
        return identifier
    return None


def _collect_license_lines(
    snapshots: list[SalePurchaseSnapshot],
    *,
    is_renewal: bool,
) -> list[str]:
    from app.store.sale_purchase_snapshot import _load_licencias_json

    product_order: list[str] = []
    by_product: dict[str, list[str]] = {}
    for snap in snapshots:
        if bool(getattr(snap, 'is_renewal', False)) != is_renewal:
            continue
        name = (snap.product_name or 'Producto').strip()
        if name not in by_product:
            product_order.append(name)
            by_product[name] = []
        licencias = _load_licencias_json(snap)
        if licencias:
            for lic in licencias:
                line = _whatsapp_license_line(lic)
                if line:
                    by_product[name].append(line)
            continue
        qty = max(1, int(snap.quantity or 1))
        for _ in range(qty):
            by_product[name].append('—')

    lines: list[str] = []
    for name in product_order:
        lines.extend(by_product[name])
    return lines


def _saldo_inicio_con_total_hoy(saldo_before: float, day_total: float) -> str:
    menos = _format_whatsapp_amount(day_total)
    if saldo_before > 1e-9:
        return (
            f'Saldo al inicio del día: a favor {_format_whatsapp_amount(saldo_before)} '
            f'menos {menos} de hoy'
        )
    if saldo_before < -1e-9:
        return (
            f'Saldo al inicio del día: {_format_whatsapp_amount(saldo_before)} '
            f'menos {menos} de hoy'
        )
    return f'Saldo al inicio del día: al día ($0) menos {menos} de hoy'


def _snapshot_day_total(snapshots: list[SalePurchaseSnapshot]) -> float:
    total = 0.0
    for snap in snapshots:
        try:
            total += float(snap.total_price or 0)
        except (TypeError, ValueError):
            continue
    return total


def _snapshot_total_quantity(snapshots: list[SalePurchaseSnapshot]) -> int:
    qty = 0
    for snap in snapshots:
        qty += max(1, int(snap.quantity or 1))
    return qty


def _renewal_blocked_account_line(item: dict[str, Any]) -> str | None:
    extra = item.get('extra') if isinstance(item.get('extra'), dict) else {}
    hint = str(extra.get('cred_hint') or '').strip()
    if hint:
        return hint
    detail = str(item.get('detail') or '').strip()
    if ' — ' in detail:
        left = detail.split(' — ', 1)[0].strip()
        if left:
            return left
    summary = str(item.get('summary') or '').strip()
    return summary or None


def _renewal_blocked_accounts_on_co_date(billing_user: User, co_date: date) -> list[str]:
    raw = getattr(billing_user, 'portal_license_activity_log', None) or ''
    if not str(raw).strip():
        return []
    try:
        items = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(items, list):
        return []

    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if str(item.get('tipo') or '').strip().lower() != 'renovacion_saldo':
            continue
        ts_raw = item.get('ts')
        if not ts_raw:
            continue
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace('Z', '')[:26])
        except ValueError:
            continue
        try:
            item_co = utc_to_colombia(ts).date()
        except Exception:
            continue
        if item_co != co_date:
            continue
        line = _renewal_blocked_account_line(item)
        if not line or line in seen:
            continue
        seen.add(line)
        out.append(line)
    return out


def _failed_renewal_historial_lines(billing_user: User, co_date: date) -> list[str]:
    accounts = _renewal_blocked_accounts_on_co_date(billing_user, co_date)
    if not accounts:
        return []
    lines = [
        'No se pudo renovar porque no tenías saldo suficiente de las siguientes cuentas:',
        *accounts,
    ]
    return lines


def build_daily_summary_lines(
    snapshots: list[SalePurchaseSnapshot],
    billing_user: User | None,
    *,
    co_date: date | None = None,
    include_failed_renewals: bool = False,
) -> list[str] | None:
    renewals_summary = _section_summary_line('Renovaciones', snapshots, is_renewal=True)
    purchases_summary = _section_summary_line('Compras', snapshots, is_renewal=False)

    if not renewals_summary and not purchases_summary:
        return None

    failed_lines: list[str] = []
    if include_failed_renewals and billing_user and co_date:
        failed_lines = _failed_renewal_historial_lines(billing_user, co_date)

    day_total = _snapshot_day_total(snapshots)
    saldo_before = 0.0
    saldo_after = 0.0
    has_balance = bool(billing_user) and (renewals_summary or purchases_summary)
    if billing_user and has_balance:
        currency = _billing_currency(billing_user)
        saldo_after = _billing_prepaid_balance(billing_user, currency)
        saldo_before = saldo_after + day_total

    lines: list[str] = []
    if renewals_summary:
        lines.append(renewals_summary)
    if purchases_summary:
        lines.append(purchases_summary)

    license_lines = _collect_license_lines(snapshots, is_renewal=True)
    license_lines.extend(_collect_license_lines(snapshots, is_renewal=False))
    if license_lines:
        if lines:
            lines.append('')
        lines.extend(license_lines)

    if has_balance:
        lines.extend(
            [
                '',
                f'Total hoy: {_format_whatsapp_amount(day_total)}',
                _saldo_inicio_con_total_hoy(saldo_before, day_total),
                f'Saldo final: {_format_whatsapp_saldo_line(saldo_after)}',
            ]
        )

    if failed_lines:
        if lines:
            lines.append('')
        lines.extend(failed_lines)

    return lines


def _group_all_snapshots_by_billing_and_date(
    snapshots: list[SalePurchaseSnapshot],
) -> dict[tuple[int, date], list[SalePurchaseSnapshot]]:
    from app.store.routes import _billing_user_for_store_debt_limit

    groups: dict[tuple[int, date], list[SalePurchaseSnapshot]] = {}
    for snap in snapshots:
        co_date = _snapshot_co_date(snap)
        if not co_date:
            continue
        snap_user = User.query.get(int(snap.user_id))
        billing = _billing_user_for_store_debt_limit(snap_user) if snap_user else None
        billing_id = int(billing.id) if billing else int(snap.user_id)
        key = (billing_id, co_date)
        groups.setdefault(key, []).append(snap)
    return groups


def _daily_summary_sort_ts(snaps: list[SalePurchaseSnapshot], co_date: date) -> float:
    sent_ts: list[float] = []
    for snap in snaps:
        sent_at = getattr(snap, 'whatsapp_daily_sent_at', None)
        if sent_at:
            try:
                sent_ts.append(float(sent_at.timestamp()))
            except (AttributeError, TypeError, ValueError):
                pass
    if sent_ts:
        return max(sent_ts)
    try:
        end = COLOMBIA_TZ.localize(datetime.combine(co_date, time(23, 59, 59)))
        return end.timestamp()
    except Exception:
        return datetime.combine(co_date, time(23, 59, 59)).timestamp()


def build_purchase_history_daily_summary_items(
    *,
    viewer_billing_user_id: int | None = None,
    all_users: bool = False,
    utc_to_colombia_fn: Callable | None = None,
) -> list[dict[str, Any]]:
    """Filas virtuales de resumen diario para historial de compras (usuario y admin)."""
    del utc_to_colombia_fn

    ensure_whatsapp_daily_sales_columns()

    q = SalePurchaseSnapshot.query.filter(
        SalePurchaseSnapshot.is_reversed.is_(False),
        SalePurchaseSnapshot.whatsapp_daily_co_date.isnot(None),
    )
    account_ids: set[int] | None = None
    if not all_users and viewer_billing_user_id:
        billing_seed = User.query.get(int(viewer_billing_user_id))
        if billing_seed:
            account_ids = _store_account_user_ids(billing_seed)
        if account_ids:
            q = q.filter(SalePurchaseSnapshot.user_id.in_(list(account_ids)))

    snapshots = q.order_by(SalePurchaseSnapshot.id.asc()).all()
    groups = _group_all_snapshots_by_billing_and_date(snapshots)

    items_out: list[dict[str, Any]] = []
    for billing_id, co_date in sorted(groups.keys(), key=lambda k: (k[1], k[0]), reverse=True):
        billing_user = User.query.get(int(billing_id))
        if not billing_user:
            continue

        snaps = groups.get((billing_id, co_date), [])
        if not snaps or not _day_has_commerce_snapshots(snaps):
            continue
        summary_lines = build_daily_summary_lines(
            snaps,
            billing_user,
            co_date=co_date,
            include_failed_renewals=True,
        )
        if not summary_lines:
            continue

        sort_ts = _daily_summary_sort_ts(snaps, co_date)
        fecha_str = 'Fecha no disponible'
        try:
            fecha_col = utc_to_colombia(datetime.utcfromtimestamp(sort_ts))
            fecha_str = fecha_col.strftime('%y/%m/%d %I:%M:%S %p')
        except (ValueError, TypeError, OSError):
            fecha_str = co_date.strftime('%y/%m/%d') + ' 11:59:59 PM'

        day_total = _snapshot_day_total(snaps)
        qty = _snapshot_total_quantity(snaps) if snaps else 0
        item: dict[str, Any] = {
            'id': f'daily-summary-{billing_id}-{co_date.isoformat()}',
            'fecha': fecha_str,
            'producto': f'Resumen diario — {co_date.strftime("%d/%m/%Y")}',
            'cantidad': qty if qty else '—',
            'total': float(day_total),
            'licencias': [],
            'has_licencias': False,
            'is_daily_summary': True,
            'daily_summary_text': '\n'.join(summary_lines),
            'user_id': int(billing_id),
            'usuario': billing_user.username or '—',
            'sort_ts': sort_ts,
        }
        items_out.append(item)

    return items_out


def build_daily_sales_whatsapp_message(
    *,
    customer_name: str,
    co_date: date,
    snapshots: list[SalePurchaseSnapshot],
    billing_user: User | None = None,
) -> str | None:
    del customer_name
    lines = build_daily_summary_lines(
        snapshots,
        billing_user,
        co_date=co_date,
        include_failed_renewals=False,
    )
    if not lines:
        return None
    return '\n'.join(lines)


def mark_daily_snapshots_sent(snapshots: list[SalePurchaseSnapshot]) -> None:
    now = datetime.utcnow()
    for snap in snapshots:
        snap.whatsapp_daily_sent_at = now
        db.session.add(snap)


def send_pending_daily_digests_for_config(
    config: WhatsAppConfig,
    co_now,
    *,
    send_text_message,
    resolve_config_base_url,
    resolve_config_api_key,
    config_evolution_instance,
    resolve_phone,
    customer_name_fn,
    pause_sec: float,
    force: bool = False,
    delivery_details: list | None = None,
) -> dict[str, Any]:
    """Envía resúmenes diarios listos; devuelve estadísticas."""
    import time

    stats: dict[str, Any] = {
        'daily_sent': 0,
        'daily_errors': 0,
        'daily_skipped_no_phone': 0,
        'daily_groups': 0,
    }
    details = delivery_details if delivery_details is not None else []

    def _append_detail(*, username: str, phone: str | None, outcome: str, reason: str = '') -> None:
        if len(details) >= 100:
            return
        details.append(
            {
                'username': (username or '').strip() or '—',
                'phone': (phone or '').strip(),
                'kind': 'resumen',
                'outcome': outcome,
                'reason': (reason or '').strip(),
            }
        )

    groups = _group_pending_by_user_and_date(config, co_now, force=force)
    if not groups:
        return stats

    for (billing_user_id, co_date), snaps in groups.items():
        billing_user = User.query.get(billing_user_id)
        if not billing_user:
            continue
        from app.store.whatsapp_user_notify_prefs import user_receives_whatsapp_notifications

        if not user_receives_whatsapp_notifications(billing_user):
            stats['daily_skipped_no_phone'] += 1
            _append_detail(
                username=billing_user.username or '',
                phone=None,
                outcome='deshabilitado',
                reason='WhatsApp desactivado para este usuario',
            )
            continue
        phone = resolve_phone(billing_user)
        if not phone:
            stats['daily_skipped_no_phone'] += 1
            _append_detail(
                username=billing_user.username or '',
                phone=None,
                outcome='sin_telefono',
                reason='Sin teléfono en perfil',
            )
            continue

        body = build_daily_sales_whatsapp_message(
            customer_name=customer_name_fn(billing_user),
            co_date=co_date,
            snapshots=snaps,
            billing_user=billing_user,
        )
        if not body:
            mark_daily_snapshots_sent(snaps)
            continue

        stats['daily_groups'] += 1
        try:
            result = send_text_message(
                resolve_config_base_url(config),
                resolve_config_api_key(config),
                config_evolution_instance(config),
                phone,
                body,
            )
            if result.get('success'):
                mark_daily_snapshots_sent(snaps)
                stats['daily_sent'] += 1
                logger.info(
                    'WhatsApp resumen diario user=%s fecha=%s compras=%s',
                    billing_user.username,
                    co_date.isoformat(),
                    len(snaps),
                )
                time.sleep(pause_sec)
            else:
                stats['daily_errors'] += 1
                err_msg = str(result.get('error') or 'Envío fallido')
                _append_detail(
                    username=billing_user.username or '',
                    phone=phone,
                    outcome='error',
                    reason=err_msg,
                )
                logger.warning(
                    'WhatsApp resumen diario falló user=%s: %s',
                    billing_user.username,
                    result.get('error'),
                )
        except Exception as exc:
            stats['daily_errors'] += 1
            _append_detail(
                username=billing_user.username or '',
                phone=phone,
                outcome='error',
                reason=str(exc),
            )

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.warning('commit daily digests: %s', exc)

    return stats
