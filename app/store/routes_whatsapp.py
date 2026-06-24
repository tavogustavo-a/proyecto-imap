# -*- coding: utf-8 -*-
"""Rutas admin y webhook de WhatsApp Web (Evolution API)."""

from __future__ import annotations

import json
import time
from datetime import datetime

from flask import Response, current_app, jsonify, request, stream_with_context

from app import db
from app.admin.decorators import admin_required
from app.store.models import WhatsAppConfig

from . import store_bp


def whatsapp_ensure_schema() -> None:
    from app.store.whatsapp_web_db import ensure_whatsapp_web_columns
    from app.store.whatsapp_daily_sales import ensure_whatsapp_daily_sales_columns

    ensure_whatsapp_web_columns()
    ensure_whatsapp_daily_sales_columns()


def whatsapp_try_activate_evolution(config) -> str | None:
    """Activa instancia Evolution si WhatsApp Web está habilitado. Devuelve aviso opcional."""
    if not config or not config.is_enabled:
        return None
    from app.store.whatsapp_web_service import ensure_config_evolution_instance

    try:
        result = ensure_config_evolution_instance(config)
        if result.get('success'):
            return None
        return 'Guardado, pero Evolution no pudo activar la instancia. Revisá el servicio y usá «Mostrar QR».'
    except Exception as exc:
        current_app.logger.warning('WhatsApp Evolution activate on save: %s', exc)
        return 'Guardado, pero no se pudo contactar Evolution. Revisá que el servicio esté corriendo.'


def whatsapp_apply_enabled_flag(config, is_enabled: bool) -> None:
    """Persiste activación global; al desactivar cancela catch-up pendiente."""
    config.is_enabled = is_enabled
    if not is_enabled:
        from app.store.whatsapp_license_notify_schedule import clear_reconnect_catchup

        clear_reconnect_catchup(config)


@store_bp.route('/admin/whatsapp_configs', methods=['GET'])
@admin_required
def list_whatsapp_configs():
    whatsapp_ensure_schema()
    from app.store.whatsapp_web_service import (
        apply_whatsapp_config_env_secrets,
        consolidate_extra_whatsapp_configs,
        get_whatsapp_singleton_config,
        serialize_whatsapp_config,
        whatsapp_using_default_api_key,
    )

    config = get_whatsapp_singleton_config()
    if config:
        apply_whatsapp_config_env_secrets(config)
        if whatsapp_using_default_api_key(config):
            current_app.logger.warning(
                'WhatsApp Web: API key por defecto; definí EVOLUTION_API_KEY en producción.'
            )
        consolidate_extra_whatsapp_configs(config)
        from app.store.whatsapp_license_notify_log import compact_notify_run_log

        compact_notify_run_log(config, persist=True)
        db.session.commit()
    configs = [config] if config else []
    return jsonify({
        'configs': [serialize_whatsapp_config(c, include_secrets=True) for c in configs]
    })


@store_bp.route('/admin/whatsapp_configs', methods=['POST'])
@admin_required
def create_whatsapp_config():
    whatsapp_ensure_schema()
    from app.store.whatsapp_web_service import (
        DEFAULT_INSTANCE,
        apply_whatsapp_config_env_secrets,
        consolidate_extra_whatsapp_configs,
        default_evolution_api_key,
        default_evolution_base_url,
        get_whatsapp_singleton_config,
        new_whatsapp_webhook_token,
    )

    data = request.form if request.form else request.json

    base_url = (data.get('whatsapp_base_url') or '').strip() or default_evolution_base_url()
    api_key = (data.get('whatsapp_api_key') or '').strip() or default_evolution_api_key()
    notification_time_str = data.get('whatsapp_notification_time') or '00:00'
    is_enabled = data.get('whatsapp_enabled', 'on') == 'on'

    if not api_key:
        return jsonify({'success': False, 'error': 'Falta API Key de Evolution (EVOLUTION_API_KEY)'}), 400

    try:
        from datetime import time

        if ':' in notification_time_str:
            time_parts = notification_time_str.split(':')
            hour = int(time_parts[0])
            minute = int(time_parts[1])
            notification_time = time(hour, minute)
        else:
            raise ValueError('Formato de hora inválido')

        existing = get_whatsapp_singleton_config()
        if existing:
            config = existing
            apply_whatsapp_config_env_secrets(config)
            config.notification_time = notification_time
            whatsapp_apply_enabled_flag(config, is_enabled)
            config.health_alert_enabled = True
            config.updated_at = datetime.utcnow()
            consolidate_extra_whatsapp_configs(config)
        else:
            config = WhatsAppConfig(
                api_key=api_key,
                phone_number='0',
                webhook_verify_token=new_whatsapp_webhook_token(),
                notification_time=notification_time,
                is_enabled=is_enabled,
                base_url=base_url,
                instance_name=DEFAULT_INSTANCE,
                health_alert_enabled=True,
                connection_status='unknown',
            )
            apply_whatsapp_config_env_secrets(config)
            db.session.add(config)

        db.session.commit()
        msg = 'Configuración WhatsApp Web guardada.'
        evolution_note = whatsapp_try_activate_evolution(config)
        if evolution_note:
            msg += ' ' + evolution_note
        return jsonify({'success': True, 'message': msg, 'id': config.id})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al guardar: {str(e)}'}), 500


@store_bp.route('/admin/whatsapp_configs/<int:config_id>', methods=['DELETE'])
@admin_required
def delete_whatsapp_config(config_id):
    config = WhatsAppConfig.query.get_or_404(config_id)
    db.session.delete(config)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Configuración eliminada.'})


@store_bp.route('/admin/whatsapp_configs/<int:config_id>', methods=['PUT'])
@admin_required
def update_whatsapp_config(config_id):
    whatsapp_ensure_schema()
    data = request.form if request.form else request.json
    config = WhatsAppConfig.query.get_or_404(config_id)

    try:
        from app.store.whatsapp_web_service import apply_whatsapp_config_env_secrets

        apply_whatsapp_config_env_secrets(config)
        if 'whatsapp_api_key' in data and str(data.get('whatsapp_api_key') or '').strip():
            config.api_key = str(data['whatsapp_api_key']).strip()
        if 'whatsapp_base_url' in data:
            config.base_url = str(data.get('whatsapp_base_url') or '').strip() or config.base_url
        if 'whatsapp_notification_time' in data:
            from datetime import time

            notification_time_str = data['whatsapp_notification_time']
            time_parts = str(notification_time_str).split(':')
            config.notification_time = time(int(time_parts[0]), int(time_parts[1]))
        if 'whatsapp_enabled' in data:
            whatsapp_apply_enabled_flag(config, data['whatsapp_enabled'] == 'on')
        config.health_alert_enabled = True

        config.updated_at = datetime.utcnow()
        db.session.commit()
        msg = 'Configuración actualizada.'
        evolution_note = whatsapp_try_activate_evolution(config)
        if evolution_note:
            msg += ' ' + evolution_note
        return jsonify({'success': True, 'message': msg})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar: {str(e)}'}), 500


@store_bp.route('/admin/whatsapp_configs/<int:config_id>/toggle', methods=['POST'])
@admin_required
def toggle_whatsapp_config(config_id):
    config = WhatsAppConfig.query.get_or_404(config_id)
    whatsapp_apply_enabled_flag(config, not config.is_enabled)
    db.session.commit()
    status = 'activada' if config.is_enabled else 'desactivada'
    msg = f'WhatsApp Web {status}.'
    evolution_note = whatsapp_try_activate_evolution(config)
    if evolution_note:
        msg += ' ' + evolution_note
    return jsonify({'success': True, 'message': msg, 'is_enabled': config.is_enabled})


@store_bp.route('/admin/whatsapp/user-notify-prefs', methods=['GET'])
@admin_required
def list_whatsapp_user_notify_prefs():
    """Usuarios principales y si reciben resúmenes WhatsApp."""
    from app.store.whatsapp_user_notify_prefs import list_whatsapp_notify_pref_users

    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    users = list_whatsapp_notify_pref_users(admin_username)
    return jsonify({'success': True, 'users': users})


@store_bp.route('/admin/whatsapp/user-notify-prefs/<int:user_id>', methods=['PUT'])
@admin_required
def update_whatsapp_user_notify_pref(user_id):
    """Activa o desactiva WhatsApp para un usuario principal."""
    from app.store.whatsapp_user_notify_prefs import set_user_whatsapp_notify_enabled

    data = request.get_json(silent=True) or {}
    enabled = data.get('enabled')
    if enabled is None:
        enabled = data.get('whatsapp_notify_enabled')
    if isinstance(enabled, str):
        enabled = enabled.strip().lower() in ('1', 'true', 'yes', 'on')
    elif enabled is not None:
        enabled = bool(enabled)
    else:
        return jsonify({'success': False, 'error': 'Falta enabled.'}), 400

    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    ok, err = set_user_whatsapp_notify_enabled(user_id, enabled, admin_username)
    if not ok:
        return jsonify({'success': False, 'error': err}), 400
    return jsonify({'success': True, 'user_id': int(user_id), 'whatsapp_notify_enabled': bool(enabled)})


@store_bp.route('/admin/whatsapp/user-notify-prefs/<int:user_id>/phone', methods=['PUT'])
@admin_required
def update_whatsapp_user_phone(user_id):
    """Actualiza teléfono WhatsApp de un usuario principal."""
    from app.store.whatsapp_user_notify_prefs import set_user_whatsapp_phone

    data = request.get_json(silent=True) or {}
    phone = data.get('phone')
    if phone is None:
        phone = data.get('telefono')
    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    ok, err, saved = set_user_whatsapp_phone(user_id, phone, admin_username)
    if not ok:
        return jsonify({'success': False, 'error': err}), 400
    return jsonify({'success': True, 'user_id': int(user_id), 'phone': saved})


@store_bp.route('/admin/whatsapp_configs/test', methods=['POST'])
@admin_required
def test_whatsapp_connection():
    """Prueba reachability + estado de conexión Evolution."""
    whatsapp_ensure_schema()
    data = request.form if request.form else request.json
    api_key = (data.get('whatsapp_api_key') or '').strip()
    base_url = (data.get('whatsapp_base_url') or data.get('base_url') or '').strip()
    config_id = data.get('config_id')
    from app.store.whatsapp_web_service import (
        DEFAULT_INSTANCE,
        config_evolution_instance,
        default_evolution_api_key,
        default_evolution_base_url,
        fetch_connection_state,
        resolve_config_api_key,
        resolve_config_base_url,
        status_label_es,
    )

    cfg = None
    if config_id:
        cfg = WhatsAppConfig.query.get(int(config_id))
        if cfg:
            api_key = api_key or resolve_config_api_key(cfg)
            base_url = base_url or resolve_config_base_url(cfg)

    api_key = api_key or default_evolution_api_key()
    base_url = (base_url or '').strip() or default_evolution_base_url()

    if not api_key:
        return jsonify({'success': False, 'error': 'Falta API Key de Evolution'}), 400

    instance_name = config_evolution_instance(cfg) if cfg else DEFAULT_INSTANCE

    health = fetch_connection_state(base_url, api_key, instance_name)
    st = health.get('status')
    label = status_label_es(st)
    if st == 'unreachable':
        return jsonify({
            'success': False,
            'error': health.get('error') or 'Evolution API no responde',
            'health': health,
        }), 502
    return jsonify({
        'success': True,
        'message': f'Evolution API responde. Estado: {label}',
        'health': health,
    })


@store_bp.route('/admin/whatsapp_configs/<int:config_id>/health', methods=['POST'])
@admin_required
def refresh_whatsapp_health(config_id):
    whatsapp_ensure_schema()
    config = WhatsAppConfig.query.get_or_404(config_id)
    from app.store.whatsapp_web_service import refresh_config_health, serialize_whatsapp_config

    payload = refresh_config_health(config, send_alerts=False)
    return jsonify({
        'success': True,
        'message': f"Salud actualizada: {payload.get('status_label')}",
        'health': payload,
        'config': serialize_whatsapp_config(config, include_secrets=True),
    })


@store_bp.route('/admin/whatsapp_configs/<int:config_id>/health/stream')
@admin_required
def whatsapp_health_stream(config_id):
    """SSE: salud WhatsApp Web; consulta Evolution en ciclo y empuja si cambia el estado."""
    whatsapp_ensure_schema()
    cfg = WhatsAppConfig.query.get(config_id)
    if not cfg:
        return jsonify({'success': False, 'error': 'Configuración no encontrada.'}), 404

    from app.store.whatsapp_web_service import (
        refresh_config_health,
        serialize_whatsapp_config,
        whatsapp_config_health_fingerprint,
    )

    @stream_with_context
    def generate():
        last_rev = None
        yield f"data: {json.dumps({'type': 'connected'})}\n\n"
        for i in range(12):
            try:
                db.session.expire_all()
                config = WhatsAppConfig.query.get(config_id)
                if not config:
                    yield f"data: {json.dumps({'type': 'error', 'success': False, 'error': 'Configuración no encontrada'})}\n\n"
                    break
                if i == 0 or i == 6:
                    try:
                        refresh_config_health(config, send_alerts=False)
                    except Exception as exc:
                        current_app.logger.warning(
                            'whatsapp health stream refresh config %s: %s', config_id, exc
                        )
                health_rev = whatsapp_config_health_fingerprint(config)
                if health_rev != last_rev:
                    last_rev = health_rev
                    payload = json.dumps(
                        {
                            'type': 'whatsapp_health',
                            'success': True,
                            'health_rev': health_rev,
                            'config': serialize_whatsapp_config(config, include_secrets=True),
                        }
                    )
                    yield f"data: {payload}\n\n"
                else:
                    yield ": heartbeat\n\n"
            except Exception as e:
                current_app.logger.error('Error en stream salud WhatsApp: %s', e)
                yield f"data: {json.dumps({'type': 'error', 'success': False, 'error': str(e)})}\n\n"
            time.sleep(2.5)

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


@store_bp.route('/admin/whatsapp_configs/<int:config_id>/instance', methods=['POST'])
@admin_required
def create_whatsapp_instance(config_id):
    whatsapp_ensure_schema()
    config = WhatsAppConfig.query.get_or_404(config_id)
    from app.store.whatsapp_web_service import ensure_config_evolution_instance

    result = ensure_config_evolution_instance(config)
    if not result.get('success'):
        return jsonify({'success': False, 'error': 'No se pudo preparar la conexión', 'detail': result}), 502
    return jsonify({'success': True, 'message': 'Listo. Escaneá el QR para vincular tu número.', 'detail': result})


@store_bp.route('/admin/whatsapp_configs/<int:config_id>/qr', methods=['GET'])
@admin_required
def get_whatsapp_qr(config_id):
    whatsapp_ensure_schema()
    config = WhatsAppConfig.query.get_or_404(config_id)
    from app.store.whatsapp_web_service import (
        config_evolution_instance,
        ensure_config_evolution_instance,
        fetch_qr_code,
        resolve_config_api_key,
        resolve_config_base_url,
    )

    ensure_config_evolution_instance(config)
    result = fetch_qr_code(
        resolve_config_base_url(config),
        resolve_config_api_key(config),
        config_evolution_instance(config),
    )
    if not result.get('success'):
        return jsonify({'success': False, 'error': result.get('error') or 'QR no disponible', 'detail': result}), 502
    return jsonify({'success': True, 'qr_base64': result.get('qr_base64')})


@store_bp.route('/admin/whatsapp_configs/<int:config_id>/logout', methods=['POST'])
@admin_required
def logout_whatsapp_instance(config_id):
    whatsapp_ensure_schema()
    config = WhatsAppConfig.query.get_or_404(config_id)
    from app.store.whatsapp_web_service import (
        logout_config_evolution_instance,
        serialize_whatsapp_config,
    )

    result = logout_config_evolution_instance(config, send_alerts=False)
    if not result.get('success'):
        return jsonify(
            {
                'success': False,
                'error': result.get('error') or 'No se pudo desconectar',
                'detail': result,
            }
        ), 502

    health = result.get('health') or {}
    return jsonify(
        {
            'success': True,
            'message': 'WhatsApp Web desconectado. Podés escanear un nuevo QR.',
            'health': health,
            'config': serialize_whatsapp_config(config, include_secrets=True),
        }
    )


@store_bp.route('/admin/whatsapp_configs/<int:config_id>/send-test', methods=['POST'])
@admin_required
def send_whatsapp_test_message(config_id):
    """Envío manual de prueba al número indicado (no usa resúmenes ni usuarios)."""
    whatsapp_ensure_schema()
    config = WhatsAppConfig.query.get_or_404(config_id)
    data = request.get_json(silent=True) or {}
    to_number = (data.get('to_number') or '').strip()
    if not to_number:
        return jsonify({'success': False, 'error': 'Indicá un número para la prueba.'}), 400
    text = (data.get('text') or 'Prueba WhatsApp Web — IMAP tienda').strip()
    from app.store.whatsapp_web_service import (
        STATUS_CONNECTED,
        config_evolution_instance,
        refresh_config_health,
        resolve_config_api_key,
        resolve_config_base_url,
        send_text_message,
    )

    health = refresh_config_health(config, send_alerts=False)
    if health.get('status') != STATUS_CONNECTED:
        return jsonify({
            'success': False,
            'error': f"WhatsApp no conectado ({health.get('status_label')}). Escaneá el QR primero.",
        }), 409

    result = send_text_message(
        resolve_config_base_url(config),
        resolve_config_api_key(config),
        config_evolution_instance(config),
        to_number,
        text,
    )
    if not result.get('success'):
        return jsonify({'success': False, 'error': result.get('error') or 'Envío fallido', 'detail': result}), 502
    return jsonify({'success': True, 'message': f'Mensaje de prueba enviado a {to_number}.'})


@store_bp.route('/admin/whatsapp_configs/<int:config_id>/run-notify', methods=['POST'])
@admin_required
def whatsapp_run_license_notify(config_id):
    """Ejecuta manualmente el job de resúmenes WhatsApp (ignora hora del día)."""
    whatsapp_ensure_schema()
    config = WhatsAppConfig.query.get_or_404(config_id)
    try:
        from app.store.whatsapp_license_notify_job import run_whatsapp_license_notify_for_config
        from app.store.whatsapp_user_messages import (
            humanize_whatsapp_notify_reason,
            whatsapp_manual_run_user_message,
        )

        result = run_whatsapp_license_notify_for_config(config, force=True)
        if result.get('skipped'):
            return jsonify({
                'success': False,
                'error': humanize_whatsapp_notify_reason(
                    result.get('reason'),
                    connection_status=result.get('status') or result.get('connection_status'),
                ),
                'result': result,
            }), 409
        return jsonify({
            'success': True,
            'message': whatsapp_manual_run_user_message(result),
            'result': result,
        })
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('whatsapp_run_license_notify')
        return jsonify({'success': False, 'error': str(e)}), 500


@store_bp.route('/webhooks/whatsapp/evolution/<int:config_id>', methods=['POST'])
def whatsapp_evolution_webhook(config_id):
    """Webhook opcional Evolution (connection.update). Token en header o query."""
    whatsapp_ensure_schema()
    config = WhatsAppConfig.query.get_or_404(config_id)
    token = request.headers.get('X-Webhook-Token') or request.args.get('token') or ''
    if config.webhook_verify_token and token != config.webhook_verify_token:
        return jsonify({'success': False, 'error': 'Token inválido'}), 403

    payload = request.get_json(silent=True) or {}
    event = str(payload.get('event') or payload.get('type') or '').lower()
    if 'connection' in event or 'state' in event:
        from app.store.whatsapp_web_service import refresh_config_health

        refresh_config_health(config, send_alerts=True)
    return jsonify({'success': True})
