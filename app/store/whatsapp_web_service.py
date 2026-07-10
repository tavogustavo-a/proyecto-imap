"""Cliente Evolution API (WhatsApp Web) + salud + alertas por correo."""

from __future__ import annotations

import logging
import os
import random
import time
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urljoin

import requests

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = 'http://127.0.0.1:8080'
DEFAULT_API_KEY = 'imap-evolution-change-me'
DEFAULT_INSTANCE = 'imap'
REQUEST_TIMEOUT = 18

STATUS_CONNECTED = 'connected'
STATUS_DISCONNECTED = 'disconnected'
STATUS_CONNECTING = 'connecting'
STATUS_QR_PENDING = 'qr_pending'
STATUS_UNREACHABLE = 'unreachable'
STATUS_UNKNOWN = 'unknown'

DISCONNECT_ALERT_COOLDOWN = timedelta(hours=1)

DEFAULT_SEND_PAUSE_MIN_SEC = 3.0
DEFAULT_SEND_PAUSE_MAX_SEC = 10.0


def resolve_send_pause_bounds(config=None) -> tuple[float, float]:
    """Pausa entre mensajes: 3–10 s (fijo en código)."""
    del config
    return DEFAULT_SEND_PAUSE_MIN_SEC, DEFAULT_SEND_PAUSE_MAX_SEC


def random_send_pause_sec(config=None) -> float:
    """Pausa aleatoria uniforme entre 3 y 10 segundos."""
    min_s, max_s = resolve_send_pause_bounds(config)
    return random.uniform(min_s, max_s)


def get_whatsapp_singleton_config():
    """Única configuración WhatsApp Web de la tienda."""
    from app.store.models import WhatsAppConfig

    return WhatsAppConfig.query.order_by(WhatsAppConfig.id.asc()).first()


def consolidate_extra_whatsapp_configs(keep=None):
    """Elimina filas duplicadas; conserva la primera (o la indicada)."""
    from app.extensions import db
    from app.store.models import WhatsAppConfig

    configs = WhatsAppConfig.query.order_by(WhatsAppConfig.id.asc()).all()
    if not configs:
        return None
    keep = keep or configs[0]
    for cfg in configs:
        if cfg.id != keep.id:
            db.session.delete(cfg)
    return keep


def _norm_base_url(raw: str | None) -> str:
    base = (raw or DEFAULT_BASE_URL).strip().rstrip('/')
    return base or DEFAULT_BASE_URL


def _norm_instance(raw: str | None) -> str:
    name = (raw or DEFAULT_INSTANCE).strip()
    return name or DEFAULT_INSTANCE


def config_evolution_instance(config) -> str:
    """Identificador interno en Evolution API (fijo; no se muestra en la UI)."""
    return _norm_instance(getattr(config, 'instance_name', None))


def default_evolution_base_url() -> str:
    return _norm_base_url(os.getenv('EVOLUTION_API_URL'))


def _flask_env_is_development() -> bool:
    return (os.getenv('FLASK_ENV') or 'development').strip().lower() == 'development'


def default_evolution_api_key() -> str:
    """
    API key de Evolution.
    En desarrollo puede caer al placeholder; en producción exige EVOLUTION_API_KEY real.
    """
    key = (os.getenv('EVOLUTION_API_KEY') or '').strip()
    if key:
        if not _flask_env_is_development() and key == DEFAULT_API_KEY:
            raise RuntimeError(
                'EVOLUTION_API_KEY insegura en producción (valor por defecto). '
                'Definí una clave distinta de imap-evolution-change-me.'
            )
        return key
    if _flask_env_is_development():
        return DEFAULT_API_KEY
    return ''


def default_evolution_webhook_token() -> str:
    return (os.getenv('EVOLUTION_WEBHOOK_TOKEN') or '').strip()


def default_evolution_server_url() -> str:
    raw = (os.getenv('EVOLUTION_SERVER_URL') or os.getenv('EVOLUTION_API_URL') or '').strip()
    return _norm_base_url(raw) if raw else default_evolution_base_url()


def new_whatsapp_webhook_token() -> str:
    token = default_evolution_webhook_token()
    if token:
        return token
    import secrets

    return secrets.token_urlsafe(32)


def apply_whatsapp_config_env_secrets(config) -> None:
    """Aplica URL, API key y webhook desde .env (producción)."""
    if config is None:
        return
    env_key = default_evolution_api_key()
    if env_key:
        config.api_key = env_key
    config.base_url = default_evolution_base_url()
    webhook = default_evolution_webhook_token()
    if webhook:
        config.webhook_verify_token = webhook


def whatsapp_using_default_api_key(config=None) -> bool:
    key = resolve_config_api_key(config) if config is not None else default_evolution_api_key()
    return (not key) or key == DEFAULT_API_KEY


def resolve_config_base_url(config) -> str:
    raw = (getattr(config, 'base_url', None) or '').strip() if config is not None else ''
    return _norm_base_url(raw) if raw else default_evolution_base_url()


def resolve_config_api_key(config) -> str:
    raw = (getattr(config, 'api_key', None) or '').strip() if config is not None else ''
    if raw:
        if not _flask_env_is_development() and raw == DEFAULT_API_KEY:
            return ''
        return raw
    return default_evolution_api_key()


def humanize_evolution_error(raw: str | None, *, base_url: str | None = None) -> str:
    """Convierte errores técnicos de requests/Evolution en mensajes claros para la UI."""
    msg = (raw or '').strip()
    base = _norm_base_url(base_url) if base_url else default_evolution_base_url()
    lower = msg.lower()

    if not msg:
        return (
            f'Evolution API no respondió ({base}). '
            'Verificá que el servicio esté corriendo e intentá de nuevo.'
        )

    connection_markers = (
        'connection refused',
        'failed to establish a new connection',
        'max retries exceeded',
        'connectionerror',
        'newconnectionerror',
        '10061',
        'actively refused',
        'equipo de destino denegó',
    )
    if any(marker in lower for marker in connection_markers):
        return (
            f'Evolution API no está disponible en {base}. '
            'Iniciá el servicio (Docker: docker compose -f docker-compose.evolution.yml up -d) '
            'y volvé a intentar.'
        )

    if 'timeout' in lower or 'timed out' in lower:
        return (
            f'Evolution API tardó demasiado en responder ({base}). '
            'Revisá que el servicio esté activo.'
        )

    if len(msg) > 160 or 'httpconnectionpool' in lower or 'urllib3' in lower:
        return (
            f'No se pudo conectar con Evolution API ({base}). '
            'Verificá que el servicio esté corriendo e intentá de nuevo.'
        )

    return msg


def _headers(api_key: str) -> dict[str, str]:
    key = (api_key or '').strip()
    return {'apikey': key, 'Content-Type': 'application/json'}


def _request(
    method: str,
    base_url: str,
    path: str,
    api_key: str,
    *,
    json_body: dict | None = None,
) -> tuple[int | None, Any]:
    url = urljoin(base_url.rstrip('/') + '/', path.lstrip('/'))
    try:
        resp = requests.request(
            method,
            url,
            headers=_headers(api_key),
            json=json_body,
            timeout=REQUEST_TIMEOUT,
        )
        try:
            data = resp.json()
        except Exception:
            data = {'raw': resp.text[:500]}
        return resp.status_code, data
    except requests.RequestException as exc:
        logger.warning('Evolution API %s %s: %s', method, path, exc)
        return None, {'error': humanize_evolution_error(str(exc), base_url=base_url)}


def parse_connection_state(payload: Any) -> str:
    """Normaliza estados Evolution/Baileys a connected|disconnected|connecting|qr_pending|unknown."""
    if payload is None:
        return STATUS_UNKNOWN
    if isinstance(payload, list) and payload:
        return parse_connection_state(payload[0])
    if not isinstance(payload, dict):
        return STATUS_UNKNOWN

    candidates = []
    inst = payload.get('instance')
    if isinstance(inst, dict):
        candidates.extend(
            [
                inst.get('state'),
                inst.get('connectionStatus'),
                inst.get('status'),
            ]
        )
    candidates.extend(
        [
            payload.get('state'),
            payload.get('connectionStatus'),
            payload.get('status'),
            payload.get('instance', {}).get('state') if isinstance(payload.get('instance'), dict) else None,
        ]
    )
    for raw in candidates:
        if raw is None:
            continue
        s = str(raw).lower().strip()
        if s in ('open', 'connected', 'online'):
            return STATUS_CONNECTED
        if s in ('close', 'closed', 'disconnected', 'offline'):
            return STATUS_DISCONNECTED
        if s in ('connecting', 'pairing', 'loading'):
            return STATUS_CONNECTING
        if 'qr' in s or s in ('qrcode', 'scan_qr'):
            return STATUS_QR_PENDING
    return STATUS_UNKNOWN


def fetch_connection_state(base_url: str, api_key: str, instance_name: str) -> dict[str, Any]:
    """Consulta salud de la instancia Evolution."""
    base = _norm_base_url(base_url)
    instance = _norm_instance(instance_name)
    result: dict[str, Any] = {
        'status': STATUS_UNKNOWN,
        'linked_phone': None,
        'error': None,
        'raw': None,
    }

    code, data = _request('GET', base, f'/instance/connectionState/{instance}', api_key)
    if code == 200 and data:
        result['status'] = parse_connection_state(data)
        result['raw'] = data
        inst = data.get('instance') if isinstance(data, dict) else None
        if isinstance(inst, dict):
            phone = inst.get('owner') or inst.get('number') or inst.get('phone')
            if phone:
                result['linked_phone'] = str(phone).replace('@s.whatsapp.net', '').strip()
        if result['status'] != STATUS_UNKNOWN:
            return result

    code2, data2 = _request('GET', base, '/instance/fetchInstances', api_key)
    if code2 == 200 and isinstance(data2, list):
        for item in data2:
            if not isinstance(item, dict):
                continue
            name = item.get('name') or item.get('instanceName')
            if name and str(name) != instance:
                continue
            result['status'] = parse_connection_state(item)
            result['raw'] = item
            phone = item.get('owner') or item.get('number') or item.get('profileName')
            if item.get('ownerJid'):
                result['linked_phone'] = str(item['ownerJid']).split('@')[0]
            elif phone:
                result['linked_phone'] = str(phone)
            return result

    if code is None and code2 is None:
        result['status'] = STATUS_UNREACHABLE
        err = None
        if isinstance(data, dict):
            err = data.get('error')
        if not err and isinstance(data2, dict):
            err = data2.get('error')
        result['error'] = humanize_evolution_error(
            err or 'No se pudo contactar Evolution API',
            base_url=base,
        )
    elif code == 404 or code2 == 404:
        result['status'] = STATUS_QR_PENDING
        result['error'] = 'Instancia no encontrada; creá la instancia y escaneá el QR.'
    else:
        result['error'] = f'HTTP {code or code2}'
    return result


def create_instance(base_url: str, api_key: str, instance_name: str) -> dict[str, Any]:
    base = _norm_base_url(base_url)
    instance = _norm_instance(instance_name)
    code, data = _request(
        'POST',
        base,
        '/instance/create',
        api_key,
        json_body={
            'instanceName': instance,
            'integration': 'WHATSAPP-BAILEYS',
            'qrcode': True,
        },
    )
    ok = code in (200, 201)
    return {'success': ok, 'status_code': code, 'data': data}


def _instance_exists(base_url: str, api_key: str, instance_name: str) -> bool:
    base = _norm_base_url(base_url)
    instance = _norm_instance(instance_name)
    code, data = _request('GET', base, '/instance/fetchInstances', api_key)
    if code != 200 or not isinstance(data, list):
        return False
    for item in data:
        if not isinstance(item, dict):
            continue
        name = item.get('name') or item.get('instanceName')
        if name and str(name) == instance:
            return True
    return False


def ensure_evolution_instance(base_url: str, api_key: str, instance_name: str) -> dict[str, Any]:
    """Crea la instancia Evolution si no existe (idempotente)."""
    base = _norm_base_url(base_url)
    instance = _norm_instance(instance_name)
    if _instance_exists(base, api_key, instance):
        return {'success': True, 'already_exists': True}

    result = create_instance(base, api_key, instance)
    if result.get('success'):
        return {'success': True, 'created': True, **result}

    if _instance_exists(base, api_key, instance):
        return {'success': True, 'already_exists': True}

    return result


def ensure_config_evolution_instance(config) -> dict[str, Any]:
    return ensure_evolution_instance(
        resolve_config_base_url(config),
        resolve_config_api_key(config),
        config_evolution_instance(config),
    )


def restart_evolution_instance(base_url: str, api_key: str, instance_name: str) -> dict[str, Any]:
    base = _norm_base_url(base_url)
    instance = _norm_instance(instance_name)
    code, data = _request('POST', base, f'/instance/restart/{instance}', api_key)
    return {'success': code in (200, 201), 'status_code': code, 'data': data}


def _looks_like_base64_image(value: str) -> bool:
    sample = value.replace('\n', '').strip()[:240]
    if len(sample) < 80:
        return False
    allowed = set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')
    return all(ch in allowed for ch in sample)


def _extract_qr_base64_from_connect_payload(data: Any) -> str | None:
    if not isinstance(data, dict):
        return None

    def normalize(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        text = value.strip()
        if not text:
            return None
        if text.startswith('data:image'):
            return text
        if _looks_like_base64_image(text):
            return f'data:image/png;base64,{text}'
        return None

    buckets: list[dict[str, Any]] = [data]
    response = data.get('response')
    if isinstance(response, dict):
        buckets.append(response)
    qrcode = data.get('qrcode')
    if isinstance(qrcode, dict):
        buckets.append(qrcode)

    for bucket in buckets:
        for key in ('base64', 'qrcode', 'code'):
            found = normalize(bucket.get(key))
            if found:
                return found
    return None


def fetch_qr_code(base_url: str, api_key: str, instance_name: str) -> dict[str, Any]:
    base = _norm_base_url(base_url)
    instance = _norm_instance(instance_name)
    ensure_evolution_instance(base, api_key, instance)

    state_code, state_data = _request('GET', base, f'/instance/connectionState/{instance}', api_key)
    state = parse_connection_state(state_data if state_code == 200 else None)
    if state in (STATUS_DISCONNECTED, STATUS_CONNECTING, STATUS_QR_PENDING, STATUS_UNKNOWN):
        restart_evolution_instance(base, api_key, instance)
        time.sleep(1.5)

    last_data: Any = None
    last_code: int | None = None
    for attempt in range(8):
        last_code, last_data = _request('GET', base, f'/instance/connect/{instance}', api_key)
        if last_code == 200 and isinstance(last_data, dict):
            qr_b64 = _extract_qr_base64_from_connect_payload(last_data)
            if qr_b64:
                return {'success': True, 'qr_base64': qr_b64, 'data': last_data}
            count = last_data.get('count')
            if count in (0, None) and attempt < 7:
                time.sleep(2)
                continue
        elif attempt < 7:
            time.sleep(2)
            continue
        break

    raw_err = last_data.get('error') if isinstance(last_data, dict) else 'Sin QR'
    if isinstance(last_data, dict) and last_data.get('count') == 0:
        raw_err = (
            'Evolution no generó el QR (respuesta vacía). '
            'Reiniciá Evolution con docker compose -f docker-compose.evolution.yml up -d '
            'y volvé a intentar.'
        )
    return {
        'success': False,
        'error': humanize_evolution_error(raw_err, base_url=base),
        'data': last_data,
        'status_code': last_code,
    }


def logout_evolution_instance(base_url: str, api_key: str, instance_name: str) -> dict[str, Any]:
    """Cierra sesión WhatsApp en Evolution sin borrar la instancia."""
    base = _norm_base_url(base_url)
    instance = _norm_instance(instance_name)
    code, data = _request('DELETE', base, f'/instance/logout/{instance}', api_key)
    ok = code in (200, 201, 204)
    err = None
    if isinstance(data, dict):
        err = data.get('error') or data.get('message')
        if data.get('status') == 'error':
            ok = False
    if not ok and code not in (404,):
        err = humanize_evolution_error(err or 'No se pudo desconectar', base_url=base)
        return {'success': False, 'error': err, 'status_code': code, 'data': data}
    return {'success': True, 'status_code': code, 'data': data}


def logout_config_evolution_instance(config, *, send_alerts: bool = False) -> dict[str, Any]:
    """Desconecta la instancia Evolution y actualiza salud en BD."""
    from app.extensions import db

    result = logout_evolution_instance(
        resolve_config_base_url(config),
        resolve_config_api_key(config),
        config_evolution_instance(config),
    )
    if not result.get('success'):
        return result

    config.connection_status = STATUS_DISCONNECTED
    config.linked_phone = None
    config.last_health_at = datetime.utcnow()
    config.last_health_error = None
    db.session.commit()
    health = refresh_config_health(config, send_alerts=send_alerts)
    result['health'] = health
    return result


def send_text_message(
    base_url: str,
    api_key: str,
    instance_name: str,
    to_number: str,
    text: str,
) -> dict[str, Any]:
    base = _norm_base_url(base_url)
    instance = _norm_instance(instance_name)
    digits = ''.join(ch for ch in str(to_number or '') if ch.isdigit())
    if len(digits) < 10:
        return {'success': False, 'error': 'Número destino inválido'}
    code, data = _request(
        'POST',
        base,
        f'/message/sendText/{instance}',
        api_key,
        json_body={'number': digits, 'text': str(text or '')},
    )
    ok = code in (200, 201)
    err = None
    if isinstance(data, dict):
        err = data.get('error') or data.get('message')
        if data.get('status') == 'error':
            ok = False
    if not ok and err:
        err = humanize_evolution_error(err, base_url=base)
    return {'success': ok, 'status_code': code, 'error': err, 'data': data}


def status_label_es(status: str | None) -> str:
    mapping = {
        STATUS_CONNECTED: 'Conectado',
        STATUS_DISCONNECTED: 'Desconectado',
        STATUS_CONNECTING: 'Conectando…',
        STATUS_QR_PENDING: 'Esperando QR',
        STATUS_UNREACHABLE: 'Servicio no disponible',
        STATUS_UNKNOWN: 'Desconocido',
    }
    return mapping.get(str(status or '').lower(), 'Desconocido')


def resolve_whatsapp_admin_alert_email() -> str | None:
    """Correo del usuario admin (ADMIN_USER) si tiene email o recovery_email configurado."""
    try:
        from flask import current_app
        from app.models.user import User

        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        admin = User.query.filter_by(username=admin_username, parent_id=None).first()
        if not admin:
            return None
        for attr in ('email', 'recovery_email'):
            raw = getattr(admin, attr, None)
            if raw and '@' in str(raw):
                return str(raw).strip()
    except Exception as exc:
        logger.warning('resolve_whatsapp_admin_alert_email: %s', exc)
    return None


def send_whatsapp_alert_email(to_email: str, subject: str, body: str) -> bool:
    """Envía alerta admin usando el mismo pipeline transaccional (texto + cabeceras)."""
    try:
        from app.services.email_service import send_transactional_email

        paragraphs = [ln.strip() for ln in (body or '').split('\n') if ln.strip()]
        body_html = None
        try:
            from app.services.email_service import render_transactional_email_html

            title = (subject or 'Aviso Tu Premium').split('—')[0].strip() or 'Aviso Tu Premium'
            body_html = render_transactional_email_html(
                title,
                '',
                paragraphs or [body or subject or ''],
            )
        except Exception:
            body_html = None
        return send_transactional_email(
            to_email=to_email,
            subject=subject,
            body_text=body or subject or '',
            body_html=body_html,
            from_display_name='Tu Premium — Avisos',
        )
    except Exception as exc:
        logger.exception('Error enviando alerta por correo: %s', exc)
        return False


def refresh_config_health(config, *, send_alerts: bool = True) -> dict[str, Any]:
    """Actualiza salud en BD y opcionalmente envía correo al desconectar/reconectar."""
    from app.extensions import db

    prev_status = (config.connection_status or STATUS_UNKNOWN).lower()
    health = fetch_connection_state(
        resolve_config_base_url(config),
        resolve_config_api_key(config),
        config_evolution_instance(config),
    )
    new_status = health.get('status') or STATUS_UNKNOWN
    config.connection_status = new_status
    config.last_health_at = datetime.utcnow()
    config.last_health_error = health.get('error')
    if health.get('linked_phone'):
        config.linked_phone = health['linked_phone']

    alert_sent = False
    alert_to = resolve_whatsapp_admin_alert_email()
    if send_alerts and alert_to:
        now = datetime.utcnow()
        cooldown_ok = (
            not config.last_disconnect_alert_at
            or (now - config.last_disconnect_alert_at) >= DISCONNECT_ALERT_COOLDOWN
        )
        if (
            prev_status == STATUS_CONNECTED
            and new_status in (STATUS_DISCONNECTED, STATUS_UNREACHABLE, STATUS_QR_PENDING)
            and cooldown_ok
        ):
            body = (
                'WhatsApp Web se desconectó en tu tienda IMAP.\n\n'
                f'Estado: {status_label_es(new_status)}\n'
                f'Número: {config.linked_phone or config.phone_number or "—"}\n'
                f'Error: {config.last_health_error or "—"}\n\n'
                'Entrá a Configuraciones → WhatsApp Web y escaneá el QR de nuevo.\n'
            )
            if send_whatsapp_alert_email(
                alert_to,
                '[IMAP] WhatsApp Web desconectado',
                body,
            ):
                config.last_disconnect_alert_at = now
                alert_sent = True
        elif prev_status in (STATUS_DISCONNECTED, STATUS_UNREACHABLE, STATUS_QR_PENDING) and new_status == STATUS_CONNECTED:
            body = (
                'WhatsApp Web volvió a conectarse en tu tienda IMAP.\n\n'
                f'Número vinculado: {config.linked_phone or config.phone_number or "—"}\n'
            )
            send_whatsapp_alert_email(
                alert_to,
                '[IMAP] WhatsApp Web conectado de nuevo',
                body,
            )
            try:
                from app.store.whatsapp_license_notify_job import schedule_reconnect_catchup
                from app.utils.timezone import get_colombia_datetime

                schedule_reconnect_catchup(config, get_colombia_datetime())
            except Exception as exc:
                logger.warning('schedule_reconnect_catchup: %s', exc)

    db.session.commit()
    return {
        'status': new_status,
        'status_label': status_label_es(new_status),
        'linked_phone': config.linked_phone,
        'last_health_at': config.last_health_at.isoformat() + 'Z' if config.last_health_at else None,
        'last_health_error': config.last_health_error,
        'alert_sent': alert_sent,
        'raw': health.get('raw'),
    }


def serialize_whatsapp_config(config, *, include_secrets: bool = False) -> dict[str, Any]:
    from app.store.whatsapp_license_notify_log import serialize_notify_run_log_for_api

    return {
        'id': config.id,
        'api_key': config.api_key if include_secrets else _mask_secret(config.api_key),
        'phone_number': config.phone_number,
        'base_url': config.base_url or DEFAULT_BASE_URL,
        'connection_status': config.connection_status or STATUS_UNKNOWN,
        'connection_status_label': status_label_es(config.connection_status),
        'linked_phone': config.linked_phone,
        'last_health_at': config.last_health_at.isoformat() + 'Z' if config.last_health_at else None,
        'last_health_error': config.last_health_error,
        'alert_email': resolve_whatsapp_admin_alert_email(),
        'health_alert_enabled': True,
        'webhook_verify_token': config.webhook_verify_token if include_secrets else _mask_secret(config.webhook_verify_token),
        'notification_time': config.notification_time.strftime('%H:%M') if config.notification_time else None,
        'is_enabled': config.is_enabled,
        'last_sent': config.last_sent.isoformat() + 'Z' if config.last_sent else None,
        'last_notify_at': config.last_notify_at.isoformat() + 'Z' if config.last_notify_at else None,
        'notify_run_log': serialize_notify_run_log_for_api(config),
        'created_at': config.created_at.isoformat() if config.created_at else None,
    }


def whatsapp_config_health_fingerprint(config) -> str:
    """Hash ligero para SSE de salud WhatsApp (BD + log de notify)."""
    import hashlib

    if not config:
        return hashlib.sha256(b'none').hexdigest()[:24]
    log_sig = hashlib.sha256(str(config.notify_run_log_json or '').encode('utf-8')).hexdigest()[:16]
    parts = '|'.join(
        [
            str(config.id),
            str(config.connection_status or ''),
            str(config.linked_phone or ''),
            str(config.last_health_at or ''),
            str(config.last_health_error or ''),
            '1' if config.is_enabled else '0',
            str(config.last_notify_at or ''),
            str(config.last_sent or ''),
            str(config.updated_at or ''),
            log_sig,
        ]
    )
    return hashlib.sha256(parts.encode('utf-8')).hexdigest()[:24]


def _mask_secret(value: str | None) -> str:
    if not value:
        return ''
    v = str(value)
    if len(v) <= 6:
        return '••••'
    return v[:3] + '•••' + v[-3:]
