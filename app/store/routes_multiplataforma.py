# -*- coding: utf-8 -*-
"""Rutas admin para la integración con la API Partner de Multiplataforma.

Usadas por la página «proveedores fuera» (admin_proveedores_anadir_fuera.html).
"""

from __future__ import annotations

from flask import jsonify, request

from app.admin.decorators import admin_required

from . import store_bp
from .multiplataforma_api import (
    MultiplataformaApiError,
    clear_credentials,
    get_market,
    get_plan_links,
    get_platforms,
    get_profile,
    get_saved_username,
    has_credentials,
    save_credentials,
    set_plan_link,
)


def _license_products_list():
    """Productos de licencias vinculables: [{license_id, product_id, name}]."""
    from app.store.models import License, Product

    rows = (
        License.query.join(Product, License.product_id == Product.id)
        .filter(Product.enabled.is_(True))
        .order_by(Product.name.asc())
        .all()
    )
    out = []
    for lic in rows:
        name = lic.product.name if lic.product else ('Producto %s' % lic.product_id)
        out.append({
            'license_id': lic.id,
            'product_id': lic.product_id,
            'name': name,
        })
    return out


def _error_response(exc, default_status=502):
    status = 400 if exc.code in ('no_credentials',) else default_status
    return (
        jsonify({'success': False, 'error': str(exc), 'code': exc.code}),
        status,
    )


@store_bp.route('/admin/proveedores-fuera/mp/status')
@admin_required
def admin_mp_api_status():
    """Estado de configuración (no llama a la API externa)."""
    from .multiplataforma_fulfillment import get_low_balance_threshold

    return jsonify({
        'success': True,
        'configured': has_credentials(),
        'username': get_saved_username(),
        'low_balance_threshold': get_low_balance_threshold(),
    })


@store_bp.route('/admin/proveedores-fuera/mp/threshold', methods=['POST'])
@admin_required
def admin_mp_api_save_threshold():
    """Guarda el umbral del aviso de saldo bajo (0 = desactivado)."""
    from .multiplataforma_fulfillment import set_low_balance_threshold

    data = request.get_json(silent=True) or {}
    try:
        value = float(data.get('threshold'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Umbral inválido.'}), 400
    saved = set_low_balance_threshold(value)
    return jsonify({'success': True, 'low_balance_threshold': saved})


@store_bp.route('/admin/proveedores-fuera/mp/credentials', methods=['POST'])
@admin_required
def admin_mp_api_save_credentials():
    """Guarda usuario/contraseña del vendedor y prueba la conexión."""
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({
            'success': False,
            'error': 'Usuario y contraseña son obligatorios.',
        }), 400

    save_credentials(username, password)

    # Probar de inmediato; si falla (p. ej. IP sin aprobar) igual quedan guardadas.
    try:
        profile = get_profile()
        return jsonify({'success': True, 'saved': True, 'profile': profile})
    except MultiplataformaApiError as exc:
        return jsonify({
            'success': True,
            'saved': True,
            'test_error': str(exc),
            'code': exc.code,
        })


@store_bp.route('/admin/proveedores-fuera/mp/credentials/delete', methods=['POST'])
@admin_required
def admin_mp_api_delete_credentials():
    clear_credentials()
    return jsonify({'success': True})


@store_bp.route('/admin/proveedores-fuera/mp/test', methods=['POST'])
@admin_required
def admin_mp_api_test():
    """Prueba la conexión y devuelve perfil + saldo del vendedor."""
    try:
        profile = get_profile()
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    return jsonify({'success': True, 'profile': profile})


@store_bp.route('/admin/proveedores-fuera/mp/platforms')
@admin_required
def admin_mp_api_platforms():
    """Plataformas multi habilitadas para el vendedor."""
    try:
        data = get_platforms()
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    return jsonify({'success': True, 'data': data})


@store_bp.route('/admin/proveedores-fuera/mp/platforms/<int:platform_id>/market')
@admin_required
def admin_mp_api_market(platform_id):
    """Planes, precio del vendedor y stock de una plataforma."""
    try:
        data = get_market(platform_id)
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    return jsonify({'success': True, 'data': data})


@store_bp.route('/admin/proveedores-fuera/mp/links')
@admin_required
def admin_mp_api_links():
    """Vínculos plan→producto guardados + productos de licencias vinculables."""
    return jsonify({
        'success': True,
        'links': get_plan_links(),
        'products': _license_products_list(),
    })


@store_bp.route('/admin/proveedores-fuera/mp/links', methods=['POST'])
@admin_required
def admin_mp_api_save_link():
    """Vincula o desvincula un plan de Multiplataforma a un producto propio."""
    data = request.get_json(silent=True) or {}
    plan_id = data.get('plan_id')
    try:
        plan_id = int(plan_id)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'plan_id inválido.'}), 400

    license_id = data.get('license_id')
    if license_id in (None, '', 0, '0'):
        license_id = None
    else:
        try:
            license_id = int(license_id)
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Producto inválido.'}), 400
        from app.store.models import License

        if License.query.get(license_id) is None:
            return jsonify({'success': False, 'error': 'El producto no existe.'}), 404

    meta = {
        'platform_id': data.get('platform_id'),
        'platform_name': (data.get('platform_name') or '')[:120] or None,
        'plan_name': (data.get('plan_name') or '')[:120] or None,
        'days': data.get('days'),
    }
    ok, error = set_plan_link(plan_id, license_id, meta)
    if not ok:
        return jsonify({'success': False, 'error': error}), 409
    return jsonify({'success': True, 'links': get_plan_links()})
