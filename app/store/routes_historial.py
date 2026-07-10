# -*- coding: utf-8 -*-
"""Rutas historial de compras (store_bp)."""

from __future__ import annotations

from datetime import datetime

from flask import (
    current_app,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

from app import db
from app.admin.decorators import admin_required
from app.models.user import User
from app.utils.timezone import utc_to_colombia

from . import store_bp
from .routes import (
    _attach_private_no_cache_headers,
    _balance_recharge_viewer_billing_user,
    _eligible_tienda_user_licencias_portal,
    _ensure_balance_recharges_table,
    _ensure_license_account_sale_id_column,
    _ensure_user_portal_license_activity_log_column,
    _json_licencias_view_only_forbidden,
    _user_licencias_viewer_scope,
    _user_store_proveedor_flag,
    _user_store_view_only,
    csrf_exempt_route,
    store_access_required,
)


def _historial_show_individual_sale_row(*, is_reversed, renewal_kind, snap_row):
    """
    Compras, renovaciones de licencia y reservas cumplidas van solo en resumen diario.
    Filas sueltas: revertidas, renovar tu cuenta, ventas sin snapshot.
    """
    if is_reversed:
        return True
    if renewal_kind == 'customer_account':
        return True
    if snap_row is None:
        return True
    return False


@store_bp.route('/admin/purchase_history')
@admin_required
def admin_purchase_history():
    """Ruta legacy: la vista unificada es historial_compras_usuario."""
    return redirect(url_for('store_bp.historial_compras_usuario'))


@store_bp.route('/historial_compras')
@store_access_required
def historial_compras_usuario():
    """Mostrar el historial de compras del usuario"""
    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username
    
    if not user:
        flash('Debes iniciar sesión para ver tu historial de compras', 'warning')
        return redirect(url_for('user_auth_bp.login'))

    _ensure_license_account_sale_id_column()

    from app.store.models import Sale, Product, LicenseAccount, SalePurchaseSnapshot
    from app.store.sale_purchase_snapshot import (
        ensure_sale_schema,
        ensure_snapshot_table,
        get_licencias_for_sale_row,
        renewal_kind_display_label,
        resolve_renewal_kind_for_sale,
        snapshot_to_historial_item,
    )

    ensure_sale_schema()
    ensure_snapshot_table()

    # Obtener todas las compras del usuario, ordenadas por fecha más reciente

    admin_username = current_app.config.get("ADMIN_USER", "admin")
    mostrar_usuario_comprador = username == admin_username

    # Admin del sistema ve todas las ventas con el comprador; el resto solo las propias.
    if mostrar_usuario_comprador:
        compras = (
            db.session.query(Sale, Product, User)
            .join(Product, Sale.product_id == Product.id)
            .join(User, Sale.user_id == User.id)
            .order_by(Sale.created_at.desc())
            .all()
        )
    else:
        compras = (
            db.session.query(Sale, Product)
            .join(Product, Sale.product_id == Product.id)
            .filter(Sale.user_id == user.id)
            .order_by(Sale.created_at.desc())
            .all()
        )

    compras_info = []
    from app.store.product_reservations import (
        build_reservation_historial_items,
        fulfilled_reservation_map_for_sale_ids,
        historial_product_label_with_reservation,
    )

    sale_ids_for_res = [row[0].id for row in compras]
    fulfilled_res_by_sale = fulfilled_reservation_map_for_sale_ids(sale_ids_for_res)

    for row in compras:
        if mostrar_usuario_comprador:
            sale, product, comprador = row
        else:
            sale, product = row
            comprador = None
        # Formatear fecha en zona horaria de Colombia
        fecha_colombia = sale.created_at
        if fecha_colombia:
            # Convertir a zona horaria de Colombia usando módulo centralizado
            fecha_colombia = utc_to_colombia(fecha_colombia)
            fecha_str = fecha_colombia.strftime('%y/%m/%d %I:%M:%S %p')
        else:
            fecha_str = 'Fecha no disponible'

        licencias, is_reversed, is_renewal, snap_id = get_licencias_for_sale_row(sale)
        snap_row = SalePurchaseSnapshot.query.get(snap_id) if snap_id else None
        renewal_kind = resolve_renewal_kind_for_sale(sale, snap_row) if is_renewal else None
        producto_label = historial_product_label_with_reservation(
            product.name, sale.id, fulfilled_res_by_sale
        )
        if is_reversed:
            producto_label = producto_label + ' (compra revertida)'

        sort_ts = sale.created_at.timestamp() if sale.created_at else 0.0
        res_info = fulfilled_res_by_sale.get(int(sale.id))
        item = {
            'id': sale.id,
            'fecha': fecha_str,
            'producto': producto_label,
            'cantidad': sale.quantity,
            'total': float(sale.total_price),
            'product_id': product.id,
            'licencias': licencias,
            'is_renewal': is_renewal,
            'renewal_kind': renewal_kind,
            'renewal_kind_label': renewal_kind_display_label(renewal_kind),
            'is_reversed': is_reversed,
            'has_licencias': len(licencias) > 0,
            'sort_ts': sort_ts,
        }
        if res_info:
            item['is_reservation_fulfilled'] = True
            item['reservation_kind'] = res_info.get('kind')
            item['reservation_fulfilled_label'] = res_info.get('suffix')
        if mostrar_usuario_comprador and comprador is not None:
            item['user_id'] = comprador.id
            item['usuario'] = comprador.username
        if renewal_kind == 'customer_account':
            from app.store.customer_account_renewals import enrich_historial_item_customer_renewal

            enrich_historial_item_customer_renewal(item, sale_id=sale.id)
        if not _historial_show_individual_sale_row(
            is_reversed=is_reversed,
            renewal_kind=renewal_kind,
            snap_row=snap_row,
        ):
            continue
        compras_info.append(item)

    try:
        compras_info.extend(
            build_reservation_historial_items(all_users=True, utc_to_colombia_fn=utc_to_colombia)
            if mostrar_usuario_comprador
            else build_reservation_historial_items(user_id=user.id, utc_to_colombia_fn=utc_to_colombia)
        )
    except Exception as res_hist_exc:
        current_app.logger.warning('Historial reservas canceladas: %s', res_hist_exc)

    archived_q = SalePurchaseSnapshot.query.filter_by(purged_from_sales=True)
    if not mostrar_usuario_comprador:
        archived_q = archived_q.filter_by(user_id=user.id)
    archived_snaps = archived_q.order_by(SalePurchaseSnapshot.sale_created_at.desc()).all()
    archived_sale_ids = [s.sale_id for s in archived_snaps if s.sale_id]
    archived_res_by_sale = fulfilled_reservation_map_for_sale_ids(archived_sale_ids)
    for snap in archived_snaps:
        item = snapshot_to_historial_item(snap)
        if snap.sale_id and int(snap.sale_id) in archived_res_by_sale:
            res_info = archived_res_by_sale[int(snap.sale_id)]
            base_name = (snap.product_name or 'Compra').split(' (')[0]
            item['producto'] = historial_product_label_with_reservation(
                base_name, snap.sale_id, archived_res_by_sale
            )
            if snap.is_reversed:
                item['producto'] = item['producto'] + ' (compra revertida)'
            item['is_reservation_fulfilled'] = True
            item['reservation_kind'] = res_info.get('kind')
            item['reservation_fulfilled_label'] = res_info.get('suffix')
        arch_renewal_kind = (
            resolve_renewal_kind_for_sale(
                Sale.query.get(snap.sale_id) if snap.sale_id else None,
                snap,
            )
            if snap.is_renewal and snap.sale_id
            else None
        )
        if arch_renewal_kind == 'customer_account' and snap.sale_id:
            from app.store.customer_account_renewals import enrich_historial_item_customer_renewal

            enrich_historial_item_customer_renewal(item, sale_id=snap.sale_id)
        if not _historial_show_individual_sale_row(
            is_reversed=bool(snap.is_reversed),
            renewal_kind=arch_renewal_kind,
            snap_row=snap,
        ):
            continue
        compras_info.append(item)

    _ensure_balance_recharges_table()
    from app.store.balance_recharge_historial_snapshot import ensure_snapshot_table

    ensure_snapshot_table()
    from app.store.balance_recharge_historial import build_recharge_historial_items

    if mostrar_usuario_comprador:
        compras_info.extend(
            build_recharge_historial_items(all_users=True, utc_to_colombia_fn=utc_to_colombia)
        )
    else:
        billing = _balance_recharge_viewer_billing_user(user)
        uid = int(billing.id) if billing else int(user.id)
        compras_info.extend(
            build_recharge_historial_items(user_id=uid, utc_to_colombia_fn=utc_to_colombia)
        )

    if mostrar_usuario_comprador:
        from app.store.purchase_history_cleanup import (
            cleanup_log_product_label,
            get_cleanup_logs,
        )

        for log in get_cleanup_logs():
            at_raw = log.get('at')
            sort_ts = 0.0
            fecha_str = 'Fecha no disponible'
            if at_raw:
                try:
                    at_dt = datetime.fromisoformat(str(at_raw).replace('Z', ''))
                    sort_ts = at_dt.timestamp()
                    fecha_col = utc_to_colombia(at_dt)
                    fecha_str = fecha_col.strftime('%y/%m/%d %I:%M:%S %p')
                except (ValueError, TypeError):
                    pass
            kind = (log.get('kind') or 'manual').strip().lower()
            producto = cleanup_log_product_label(kind, log.get('retention_days'))
            compras_info.append({
                'id': 'cleanup-' + str(log.get('id', '')),
                'fecha': fecha_str,
                'producto': producto,
                'cantidad': log.get('deleted_count', 0),
                'total': 0,
                'licencias': [],
                'is_cleanup_log': True,
                'usuario': 'Sistema' if kind == 'automatica' else username,
                'sort_ts': sort_ts,
            })

    compras_info.sort(key=lambda x: x.get('sort_ts', 0), reverse=True)

    try:
        from app.store.whatsapp_daily_sales import build_purchase_history_daily_summary_items

        if mostrar_usuario_comprador:
            daily_rows = build_purchase_history_daily_summary_items(
                all_users=True,
                utc_to_colombia_fn=utc_to_colombia,
            )
        else:
            billing = _balance_recharge_viewer_billing_user(user)
            uid = int(billing.id) if billing else int(user.id)
            daily_rows = build_purchase_history_daily_summary_items(
                viewer_billing_user_id=uid,
                utc_to_colombia_fn=utc_to_colombia,
            )
        compras_info.extend(daily_rows)
        compras_info.sort(key=lambda x: x.get('sort_ts', 0), reverse=True)
    except Exception as daily_exc:
        current_app.logger.warning('Resúmenes diarios en historial compras: %s', daily_exc)

    billing_viewer = _balance_recharge_viewer_billing_user(user) or user
    viewer_is_proveedor = bool(
        not mostrar_usuario_comprador
        and billing_viewer
        and _user_store_proveedor_flag(billing_viewer)
    )
    try:
        from app.store.proveedor_daily_summaries import build_proveedor_sales_daily_summary_items

        if mostrar_usuario_comprador:
            proveedor_daily_rows = build_proveedor_sales_daily_summary_items(
                all_users=True,
                utc_to_colombia_fn=utc_to_colombia,
            )
        elif viewer_is_proveedor:
            proveedor_daily_rows = build_proveedor_sales_daily_summary_items(
                billing_viewer,
                utc_to_colombia_fn=utc_to_colombia,
            )
        else:
            proveedor_daily_rows = []
        if proveedor_daily_rows:
            compras_info.extend(proveedor_daily_rows)
            compras_info.sort(key=lambda x: x.get('sort_ts', 0), reverse=True)
    except Exception as prov_daily_exc:
        current_app.logger.warning(
            'Resúmenes diarios proveedor en historial compras: %s', prov_daily_exc
        )

    for row in compras_info:
        row.pop('sort_ts', None)

    mostrar_historial_licencias = False
    historial_licencias_es_admin = False
    license_timeline_rows = []
    _ensure_user_portal_license_activity_log_column()
    if mostrar_usuario_comprador:
        from app.store.user_license_activity import (
            build_admin_store_license_activity_timeline_rows,
        )

        license_timeline_rows = build_admin_store_license_activity_timeline_rows(
            utc_to_colombia_fn=utc_to_colombia
        )
        mostrar_historial_licencias = True
        historial_licencias_es_admin = True
    elif _eligible_tienda_user_licencias_portal(user):
        from app.store.user_license_activity import build_user_license_activity_timeline_rows

        assignee_ids, _ = _user_licencias_viewer_scope(user)
        license_timeline_rows = build_user_license_activity_timeline_rows(
            assignee_ids, user, utc_to_colombia_fn=utc_to_colombia
        )
        mostrar_historial_licencias = True

    admin_user = current_app.config.get("ADMIN_USER", "admin")
    cleanup_settings = None
    cleanup_selected_user = None
    lic_cleanup_settings = None
    lic_cleanup_selected_user = None
    if mostrar_usuario_comprador:
        from app.store.purchase_history_cleanup import get_cleanup_settings
        cleanup_settings = get_cleanup_settings()
        if (
            cleanup_settings
            and cleanup_settings.get('scope') == 'user'
            and cleanup_settings.get('user_id')
        ):
            selected = User.query.get(int(cleanup_settings['user_id']))
            if selected:
                cleanup_selected_user = {
                    'id': selected.id,
                    'username': selected.username,
                    'label': selected.username,
                }
        if mostrar_historial_licencias and historial_licencias_es_admin:
            from app.store.license_history_cleanup import get_cleanup_settings as get_lic_cleanup_settings
            lic_cleanup_settings = get_lic_cleanup_settings()
            if (
                lic_cleanup_settings
                and lic_cleanup_settings.get('scope') == 'user'
                and lic_cleanup_settings.get('user_id')
            ):
                lic_selected = User.query.get(int(lic_cleanup_settings['user_id']))
                if lic_selected:
                    lic_cleanup_selected_user = {
                        'id': lic_selected.id,
                        'username': lic_selected.username,
                        'label': lic_selected.username,
                    }
    from app.store.proveedor_daily_summaries import PROVEEDOR_METRICS_COHERENCE_NOTE

    return render_template(
        'purchase_history_user.html',
        compras=compras_info,
        current_user=user,
        username=username,
        ADMIN_USER=admin_user,
        mostrar_usuario_comprador=mostrar_usuario_comprador,
        mostrar_historial_licencias=mostrar_historial_licencias,
        historial_licencias_es_admin=historial_licencias_es_admin,
        license_timeline_rows=license_timeline_rows,
        cleanup_settings=cleanup_settings,
        cleanup_selected_user=cleanup_selected_user,
        lic_cleanup_settings=lic_cleanup_settings,
        lic_cleanup_selected_user=lic_cleanup_selected_user,
        viewer_is_proveedor=viewer_is_proveedor,
        proveedor_metrics_coherence_note=PROVEEDOR_METRICS_COHERENCE_NOTE,
    )


@store_bp.route('/api/historial_compras/recharges')
@store_access_required
def api_historial_compras_recharges():
    """Etiquetas actuales de recargas/acumulador (corrige filas ya guardadas sin recargar toda la página)."""
    user = None
    username = session.get('username')
    user_id = session.get('user_id')
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
    if not user:
        return jsonify({'ok': False, 'error': 'no_auth'}), 401

    _ensure_balance_recharges_table()
    from app.store.balance_recharge_historial_snapshot import ensure_snapshot_table
    from app.store.balance_recharge_historial import build_recharge_historial_items

    ensure_snapshot_table()
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    mostrar_usuario_comprador = username == admin_username
    if mostrar_usuario_comprador:
        items = build_recharge_historial_items(all_users=True, utc_to_colombia_fn=utc_to_colombia)
    else:
        billing = _balance_recharge_viewer_billing_user(user)
        uid = int(billing.id) if billing else int(user.id)
        items = build_recharge_historial_items(user_id=uid, utc_to_colombia_fn=utc_to_colombia)
    return jsonify({'ok': True, 'items': items})


@store_bp.route('/api/purchase-history/cleanup-settings', methods=['GET', 'POST'])
@csrf_exempt_route
@admin_required
def api_purchase_history_cleanup_settings():
    from app.store.purchase_history_cleanup import (
        get_cleanup_settings,
        save_cleanup_settings,
        count_sales_to_purge,
    )

    if request.method == 'GET':
        settings = get_cleanup_settings()
        user_id = settings.get('user_id') if settings.get('scope') == 'user' else None
        preview = count_sales_to_purge(
            settings.get('retention_days', 90),
            user_id=user_id,
        )
        return _attach_private_no_cache_headers(jsonify({
            'success': True,
            'settings': settings,
            'preview_count': preview,
        }))

    data = request.get_json(silent=True) or {}
    try:
        retention_days = max(0, min(3650, int(data.get('retention_days', 90))))
        run_interval_hours = max(1, min(8760, int(data.get('run_interval_hours', 24))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Días o intervalo inválidos.'}), 400

    scope = (data.get('scope') or 'all').strip().lower()
    if scope not in ('all', 'user'):
        scope = 'all'

    user_id = data.get('user_id')
    if scope == 'user':
        if not user_id:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(user_id)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(user_id)
    else:
        user_id = None

    auto_enabled = bool(data.get('auto_enabled'))
    if auto_enabled and retention_days <= 0:
        return jsonify({
            'success': False,
            'error': 'La limpieza automática requiere al menos 1 día de antigüedad.',
        }), 400

    settings = save_cleanup_settings({
        'auto_enabled': auto_enabled,
        'retention_days': retention_days,
        'run_interval_hours': run_interval_hours,
        'scope': scope,
        'user_id': user_id,
    })
    preview = count_sales_to_purge(retention_days, user_id=user_id)
    return jsonify({
        'success': True,
        'message': 'Configuración de limpieza guardada.',
        'settings': settings,
        'preview_count': preview,
    })


@store_bp.route('/api/purchase-history/purge', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_purchase_history_purge():
    from app.store.purchase_history_cleanup import (
        count_sales_to_purge,
        enqueue_purge_background,
        is_purge_running,
    )

    data = request.get_json(silent=True) or {}
    try:
        retention_days = max(0, min(3650, int(data.get('retention_days', 90))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Antigüedad en días inválida.'}), 400

    scope = (data.get('scope') or 'all').strip().lower()
    user_id = None
    if scope == 'user':
        uid = data.get('user_id')
        if not uid:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(uid)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(uid)

    dry_run = bool(data.get('dry_run'))
    if dry_run:
        count = count_sales_to_purge(retention_days, user_id=user_id)
        return jsonify({'success': True, 'dry_run': True, 'count': count})

    if not data.get('confirm'):
        count = count_sales_to_purge(retention_days, user_id=user_id)
        return jsonify({
            'success': False,
            'error': 'Confirma la eliminación.',
            'requires_confirm': True,
            'count': count,
        }), 400

    pending_count = count_sales_to_purge(retention_days, user_id=user_id)

    if is_purge_running():
        return jsonify({
            'success': False,
            'error': 'Ya hay una limpieza del historial en curso. Espera a que termine.',
        }), 409

    started = enqueue_purge_background(
        current_app._get_current_object(),
        retention_days,
        user_id=user_id,
        kind='manual',
        scope=scope,
        mark_auto_run=False,
    )
    if not started:
        return jsonify({
            'success': False,
            'error': 'No se pudo iniciar la limpieza en segundo plano.',
        }), 500

    return jsonify({
        'success': True,
        'background': True,
        'message': (
            f'Limpieza iniciada en segundo plano ({pending_count} registro(s) aprox.). '
            'Solo se borra el historial de compras; las licencias quedan en inventario '
            'sin vínculo a la venta. Recarga la página en unos momentos para ver el resultado.'
        ),
    })


@store_bp.route('/api/purchase-history/purge-preview', methods=['GET'])
@csrf_exempt_route
@admin_required
def api_purchase_history_purge_preview():
    from app.store.purchase_history_cleanup import count_sales_to_purge

    try:
        retention_days = max(0, min(3650, int(request.args.get('retention_days', 90))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Antigüedad inválida.'}), 400

    scope = (request.args.get('scope') or 'all').strip().lower()
    user_id = None
    if scope == 'user':
        uid = request.args.get('user_id')
        if uid:
            user_id = int(uid)

    count = count_sales_to_purge(retention_days, user_id=user_id)
    return jsonify({'success': True, 'count': count})


@store_bp.route('/api/license-history/cleanup-settings', methods=['GET', 'POST'])
@csrf_exempt_route
@admin_required
def api_license_history_cleanup_settings():
    from app.store.license_history_cleanup import (
        count_portal_entries_to_purge,
        get_cleanup_settings,
        save_cleanup_settings,
    )

    _ensure_user_portal_license_activity_log_column()

    if request.method == 'GET':
        settings = get_cleanup_settings()
        user_id = settings.get('user_id') if settings.get('scope') == 'user' else None
        preview = count_portal_entries_to_purge(
            settings.get('retention_days', 90),
            user_id=user_id,
        )
        return _attach_private_no_cache_headers(jsonify({
            'success': True,
            'settings': settings,
            'preview_count': preview,
        }))

    data = request.get_json(silent=True) or {}
    try:
        retention_days = max(0, min(3650, int(data.get('retention_days', 90))))
        run_interval_hours = max(1, min(8760, int(data.get('run_interval_hours', 24))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Días o intervalo inválidos.'}), 400

    scope = (data.get('scope') or 'all').strip().lower()
    if scope not in ('all', 'user'):
        scope = 'all'

    user_id = data.get('user_id')
    if scope == 'user':
        if not user_id:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(user_id)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(user_id)
    else:
        user_id = None

    auto_enabled = bool(data.get('auto_enabled'))
    if auto_enabled and retention_days <= 0:
        return jsonify({
            'success': False,
            'error': 'La limpieza automática requiere al menos 1 día de antigüedad.',
        }), 400

    settings = save_cleanup_settings({
        'auto_enabled': auto_enabled,
        'retention_days': retention_days,
        'run_interval_hours': run_interval_hours,
        'scope': scope,
        'user_id': user_id,
    })
    preview = count_portal_entries_to_purge(retention_days, user_id=user_id)
    return jsonify({
        'success': True,
        'message': 'Configuración de limpieza del historial · Licencias guardada.',
        'settings': settings,
        'preview_count': preview,
    })


@store_bp.route('/api/license-history/purge', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_license_history_purge():
    from app.store.license_history_cleanup import (
        count_portal_entries_to_purge,
        enqueue_purge_background,
        is_purge_running,
    )

    _ensure_user_portal_license_activity_log_column()

    data = request.get_json(silent=True) or {}
    try:
        retention_days = max(0, min(3650, int(data.get('retention_days', 90))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Antigüedad en días inválida.'}), 400

    scope = (data.get('scope') or 'all').strip().lower()
    user_id = None
    if scope == 'user':
        uid = data.get('user_id')
        if not uid:
            return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
        if not User.query.get(int(uid)):
            return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
        user_id = int(uid)

    dry_run = bool(data.get('dry_run'))
    if dry_run:
        count = count_portal_entries_to_purge(retention_days, user_id=user_id)
        return jsonify({'success': True, 'dry_run': True, 'count': count})

    if not data.get('confirm'):
        count = count_portal_entries_to_purge(retention_days, user_id=user_id)
        return jsonify({
            'success': False,
            'error': 'Confirma la eliminación.',
            'requires_confirm': True,
            'count': count,
        }), 400

    pending_count = count_portal_entries_to_purge(retention_days, user_id=user_id)

    if is_purge_running():
        return jsonify({
            'success': False,
            'error': 'Ya hay una limpieza del historial · Licencias en curso. Espera a que termine.',
        }), 409

    started = enqueue_purge_background(
        current_app._get_current_object(),
        retention_days,
        user_id=user_id,
        kind='manual',
        scope=scope,
        mark_auto_run=False,
    )
    if not started:
        return jsonify({
            'success': False,
            'error': 'No se pudo iniciar la limpieza en segundo plano.',
        }), 500

    return jsonify({
        'success': True,
        'background': True,
        'message': (
            f'Limpieza del historial · Licencias iniciada ({pending_count} registro(s) aprox.). '
            'Solo se borran entradas antiguas del registro portal; las licencias en inventario no se eliminan. '
            'Recarga la página en unos momentos.'
        ),
    })


@store_bp.route('/api/license-history/purge-preview', methods=['GET'])
@csrf_exempt_route
@admin_required
def api_license_history_purge_preview():
    from app.store.license_history_cleanup import count_portal_entries_to_purge

    _ensure_user_portal_license_activity_log_column()

    try:
        retention_days = max(0, min(3650, int(request.args.get('retention_days', 90))))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Antigüedad inválida.'}), 400

    scope = (request.args.get('scope') or 'all').strip().lower()
    user_id = None
    if scope == 'user':
        uid = request.args.get('user_id')
        if uid:
            user_id = int(uid)

    count = count_portal_entries_to_purge(retention_days, user_id=user_id)
    return jsonify({'success': True, 'count': count})


def _purchase_history_stats_period_from_request():
    date_from = (request.args.get('date_from') or '').strip() or None
    date_to = (request.args.get('date_to') or '').strip() or None
    days_int = None
    if not date_from or not date_to:
        days = request.args.get('days', '30')
        try:
            days_int = int(days) if str(days).strip().lower() != 'all' else 3650
        except (TypeError, ValueError):
            days_int = 30
    return date_from, date_to, days_int


@store_bp.route('/api/purchase-history/stats', methods=['GET'])
@csrf_exempt_route
@admin_required
def api_purchase_history_stats():
    from app.store.purchase_history_stats import compute_purchase_history_stats

    scope = (request.args.get('scope') or 'all').strip().lower()
    if scope not in ('all', 'user', 'proveedor'):
        scope = 'all'
    user_id = None
    if scope in ('user', 'proveedor'):
        uid = request.args.get('user_id')
        if scope == 'user':
            if not uid:
                return jsonify({'success': False, 'error': 'Selecciona un usuario.'}), 400
            if not User.query.get(int(uid)):
                return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
            user_id = int(uid)
        elif uid:
            prov = User.query.get(int(uid))
            if not prov:
                return jsonify({'success': False, 'error': 'Proveedor no encontrado.'}), 404
            up = prov.user_prices if isinstance(prov.user_prices, dict) else {}
            if not up.get('proveedor') or prov.parent_id:
                return jsonify({'success': False, 'error': 'El usuario seleccionado no es proveedor.'}), 400
            user_id = int(uid)

    date_from, date_to, days_int = _purchase_history_stats_period_from_request()
    data = compute_purchase_history_stats(
        scope=scope,
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
        days=days_int,
    )
    return _attach_private_no_cache_headers(jsonify(data))


@store_bp.route('/api/purchase-history/my-stats', methods=['GET'])
@csrf_exempt_route
@store_access_required
def api_purchase_history_my_stats():
    """Estadísticas del historial solo para el usuario en sesión."""
    from app.store.purchase_history_stats import compute_purchase_history_stats

    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'error': 'Debes iniciar sesión.'}), 401
    user = User.query.get(int(user_id))
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404

    scope = (request.args.get('scope') or 'user').strip().lower()
    billing = _balance_recharge_viewer_billing_user(user) or user
    date_from, date_to, days_int = _purchase_history_stats_period_from_request()

    if scope == 'proveedor':
        if not _user_store_proveedor_flag(billing):
            return jsonify({'success': False, 'error': 'Sin permiso de proveedor.'}), 403
        data = compute_purchase_history_stats(
            scope='proveedor',
            user_id=int(billing.id),
            date_from=date_from,
            date_to=date_to,
            days=days_int,
        )
    elif scope == 'unified':
        if not _user_store_proveedor_flag(billing):
            return jsonify({'success': False, 'error': 'Sin permiso de proveedor.'}), 403
        mis_compras = compute_purchase_history_stats(
            scope='user',
            user_id=user.id,
            date_from=date_from,
            date_to=date_to,
            days=days_int,
        )
        ventas_proveedor = compute_purchase_history_stats(
            scope='proveedor',
            user_id=int(billing.id),
            date_from=date_from,
            date_to=date_to,
            days=days_int,
        )
        if not mis_compras.get('success'):
            return jsonify(mis_compras), 400
        if not ventas_proveedor.get('success'):
            return jsonify(ventas_proveedor), 400
        data = {
            'success': True,
            'unified': True,
            'mis_compras': mis_compras,
            'ventas_proveedor': ventas_proveedor,
        }
    else:
        data = compute_purchase_history_stats(
            scope='user',
            user_id=user.id,
            date_from=date_from,
            date_to=date_to,
            days=days_int,
        )
    return _attach_private_no_cache_headers(jsonify(data))

@store_bp.route('/api/purchase-history/my-proveedor-daily-summary/delete', methods=['POST'])
@store_access_required
def api_purchase_history_my_proveedor_daily_summary_delete():
    """Borra un día concreto del resumen diario del proveedor en sesión."""
    from datetime import date as date_cls
    from app.store.proveedor_daily_summaries import delete_proveedor_daily_summary_day

    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'error': 'Debes iniciar sesión.'}), 401
    user = User.query.get(int(user_id))
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
    if _user_store_view_only(user):
        return _json_licencias_view_only_forbidden()
    billing = _balance_recharge_viewer_billing_user(user) or user
    if not _user_store_proveedor_flag(billing):
        return jsonify({'success': False, 'error': 'Sin permiso de proveedor.'}), 403

    data = request.get_json(silent=True) or {}
    co_date_raw = (data.get('co_date') or data.get('date') or '').strip()
    if not co_date_raw:
        return jsonify({'success': False, 'error': 'Indica la fecha del resumen.'}), 400
    try:
        co_date = date_cls.fromisoformat(str(co_date_raw)[:10])
    except ValueError:
        return jsonify({'success': False, 'error': 'Fecha inválida.'}), 400

    ok, err = delete_proveedor_daily_summary_day(billing, co_date)
    if not ok:
        return jsonify({'success': False, 'error': err or 'No se pudo borrar.'}), 400
    return _attach_private_no_cache_headers(
        jsonify({'success': True, 'co_date': co_date.isoformat()})
    )


@store_bp.route('/api/admin/proveedor-daily-summary/delete', methods=['POST'])
@csrf_exempt_route
@admin_required
def api_admin_proveedor_daily_summary_delete():
    """Borra un día concreto del resumen diario de un proveedor (admin)."""
    from datetime import date as date_cls
    from app.store.proveedor_daily_summaries import delete_proveedor_daily_summary_day

    data = request.get_json(silent=True) or {}
    co_date_raw = (data.get('co_date') or data.get('date') or '').strip()
    try:
        uid = int(data.get('user_id'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Proveedor inválido.'}), 400
    if not co_date_raw:
        return jsonify({'success': False, 'error': 'Indica la fecha del resumen.'}), 400
    try:
        co_date = date_cls.fromisoformat(str(co_date_raw)[:10])
    except ValueError:
        return jsonify({'success': False, 'error': 'Fecha inválida.'}), 400

    user_row = User.query.get(uid)
    if not user_row or user_row.parent_id:
        return jsonify({'success': False, 'error': 'Proveedor no encontrado.'}), 404
    up = user_row.user_prices if isinstance(user_row.user_prices, dict) else {}
    if not up.get('proveedor'):
        return jsonify({'success': False, 'error': 'El usuario no es proveedor.'}), 400

    ok, err = delete_proveedor_daily_summary_day(user_row, co_date)
    if not ok:
        return jsonify({'success': False, 'error': err or 'No se pudo borrar.'}), 400
    return _attach_private_no_cache_headers(
        jsonify({'success': True, 'user_id': uid, 'co_date': co_date.isoformat()})
    )
