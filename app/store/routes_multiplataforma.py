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
    check_recharge_attempt,
    clear_credentials,
    create_payment_issue,
    create_recharge_attempt,
    enrich_recharge_attempt_qr,
    get_market,
    get_plan_links,
    get_platforms,
    get_profile,
    get_recharge_attempt,
    get_recharge_config,
    get_saved_username,
    has_credentials,
    list_payment_history,
    list_payment_issues,
    list_recharge_attempts,
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


def _mp_recharge_payload(data):
    if not isinstance(data, dict):
        return data
    return enrich_recharge_attempt_qr(dict(data))


@store_bp.route('/admin/proveedores-fuera/mp/recharge/config')
@admin_required
def admin_mp_recharge_config():
    try:
        data = get_recharge_config()
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    return jsonify({'success': True, 'data': data})


@store_bp.route('/admin/proveedores-fuera/mp/recharge/attempts', methods=['GET'])
@admin_required
def admin_mp_recharge_attempts_list():
    try:
        data = list_recharge_attempts()
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    if isinstance(data, list):
        payload = {'attempts': [x for x in data if isinstance(x, dict)]}
    elif isinstance(data, dict):
        payload = dict(data)
        items = (
            payload.get('attempts')
            or payload.get('results')
            or payload.get('items')
            or []
        )
        payload['attempts'] = items if isinstance(items, list) else []
    else:
        payload = {'attempts': []}
    return jsonify({'success': True, 'data': payload})


@store_bp.route('/admin/proveedores-fuera/mp/recharge/attempts', methods=['POST'])
@admin_required
def admin_mp_recharge_attempts_create():
    body = request.get_json(silent=True) or {}
    name = (body.get('name') or '').strip()
    value = body.get('value')
    if not name:
        return jsonify({'success': False, 'error': 'Indica el nombre del titular (como en el comprobante).'}), 400
    try:
        value_num = int(float(str(value).replace(',', '.')))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Monto inválido.'}), 400
    if value_num <= 0:
        return jsonify({'success': False, 'error': 'El monto debe ser mayor que cero.'}), 400
    try:
        data = create_recharge_attempt(name, value_num)
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    return jsonify({'success': True, 'data': _mp_recharge_payload(data)}), 201


@store_bp.route('/admin/proveedores-fuera/mp/recharge/attempts/<int:payment_id>/check', methods=['POST'])
@admin_required
def admin_mp_recharge_attempt_check(payment_id):
    try:
        data = check_recharge_attempt(payment_id)
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    profile = None
    try:
        if isinstance(data, dict) and (
            data.get('validated') or data.get('check_status') == 'verified'
        ):
            profile = get_profile()
    except MultiplataformaApiError:
        profile = None
    return jsonify({'success': True, 'data': _mp_recharge_payload(data), 'profile': profile})


@store_bp.route('/admin/proveedores-fuera/mp/recharge/attempts/<int:payment_id>')
@admin_required
def admin_mp_recharge_attempt_detail(payment_id):
    try:
        data = get_recharge_attempt(payment_id)
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    return jsonify({'success': True, 'data': _mp_recharge_payload(data)})


@store_bp.route('/admin/proveedores-fuera/mp/recharge/history')
@admin_required
def admin_mp_recharge_history():
    try:
        page = int(request.args.get('page') or 1)
        page_size = int(request.args.get('page_size') or 20)
    except (TypeError, ValueError):
        page, page_size = 1, 20
    q = (request.args.get('q') or '').strip() or None
    try:
        data = list_payment_history(page=page, page_size=page_size, q=q)
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    return jsonify({'success': True, 'data': data})


@store_bp.route('/admin/proveedores-fuera/mp/recharge/issues', methods=['GET'])
@admin_required
def admin_mp_recharge_issues_list():
    try:
        data = list_payment_issues()
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    return jsonify({'success': True, 'data': data})


@store_bp.route('/admin/proveedores-fuera/mp/recharge/issues', methods=['POST'])
@admin_required
def admin_mp_recharge_issues_create():
    payment_id = request.form.get('payment_id') or (request.get_json(silent=True) or {}).get('payment_id')
    issue = request.form.get('issue') or (request.get_json(silent=True) or {}).get('issue') or ''
    image = request.files.get('image')
    try:
        payment_id = int(payment_id)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'payment_id inválido.'}), 400
    if not str(issue).strip():
        return jsonify({'success': False, 'error': 'Describe el problema en issue.'}), 400
    if image is None or not getattr(image, 'filename', ''):
        return jsonify({'success': False, 'error': 'La imagen del comprobante es obligatoria.'}), 400
    raw = image.read()
    if not raw:
        return jsonify({'success': False, 'error': 'El archivo de imagen está vacío.'}), 400
    try:
        data = create_payment_issue(
            payment_id,
            issue,
            image.filename,
            raw,
            image.mimetype or 'image/jpeg',
        )
    except MultiplataformaApiError as exc:
        return _error_response(exc)
    return jsonify({'success': True, 'data': data}), 201
