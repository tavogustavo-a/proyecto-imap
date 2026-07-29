# -*- coding: utf-8 -*-
"""Tokens FCM de la app Capacitor y envío de push al crear notificaciones de tienda."""
from __future__ import annotations

import json
import logging
from datetime import datetime

import requests
from flask import current_app
from sqlalchemy import event, inspect, text

from app.extensions import db

logger = logging.getLogger(__name__)

# Evita martillar CREATE TABLE en cada notificación / cancelación.
_mobile_push_schema_ready = False


def _is_transient_sqlite_schema_error(ex) -> bool:
    msg = str(ex or '').lower()
    return (
        'database is locked' in msg
        or 'no such table' in msg
        or 'locked' in msg
    )


def ensure_mobile_push_schema():
    """Crea solo store_mobile_push_tokens (nunca db.create_all: spamea otras tablas)."""
    global _mobile_push_schema_ready
    if _mobile_push_schema_ready:
        return True
    try:
        insp = inspect(db.engine)
        if 'store_mobile_push_tokens' in set(insp.get_table_names()):
            _mobile_push_schema_ready = True
            return True
        dialect = getattr(db.engine.dialect, 'name', '') or ''
        if dialect == 'postgresql':
            ddl = """
                CREATE TABLE IF NOT EXISTS store_mobile_push_tokens (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token VARCHAR(512) NOT NULL,
                    platform VARCHAR(20) NOT NULL DEFAULT 'android',
                    device_label VARCHAR(120),
                    created_at TIMESTAMP WITHOUT TIME ZONE,
                    updated_at TIMESTAMP WITHOUT TIME ZONE,
                    CONSTRAINT uq_store_mobile_push_token UNIQUE (token)
                )
            """
        else:
            ddl = """
                CREATE TABLE IF NOT EXISTS store_mobile_push_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token VARCHAR(512) NOT NULL UNIQUE,
                    platform VARCHAR(20) NOT NULL DEFAULT 'android',
                    device_label VARCHAR(120),
                    created_at DATETIME,
                    updated_at DATETIME,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """
        with db.engine.begin() as conn:
            conn.execute(text(ddl))
        _mobile_push_schema_ready = True
        return True
    except Exception as ex:
        try:
            db.session.rollback()
        except Exception:
            pass
        # Lock / tabla aún no lista: silencio (no dump de SQL de otras tablas).
        if _is_transient_sqlite_schema_error(ex):
            return False
        try:
            current_app.logger.debug('ensure_mobile_push_schema: %s', ex)
        except Exception:
            logger.debug('ensure_mobile_push_schema: %s', ex)
        return False


def upsert_push_token(user_id: int, token: str, platform: str = 'android', device_label: str | None = None):
    from app.store.models import MobilePushToken

    if not ensure_mobile_push_schema():
        return None
    token = (token or '').strip()
    if not token or not user_id:
        return None
    platform = (platform or 'android').strip().lower()[:20] or 'android'
    try:
        row = MobilePushToken.query.filter_by(token=token).first()
        now = datetime.utcnow()
        if row:
            row.user_id = int(user_id)
            row.platform = platform
            if device_label:
                row.device_label = device_label[:120]
            row.updated_at = now
        else:
            row = MobilePushToken(
                user_id=int(user_id),
                token=token,
                platform=platform,
                device_label=(device_label or '')[:120] or None,
                created_at=now,
                updated_at=now,
            )
            db.session.add(row)
        db.session.commit()
        return row
    except Exception as ex:
        try:
            db.session.rollback()
        except Exception:
            pass
        if _is_transient_sqlite_schema_error(ex):
            return None
        raise


def send_fcm_to_user(user_id: int, title: str, body: str, data: dict | None = None) -> int:
    """Envía push FCM (HTTP v1 con service account, o legacy si hay FCM_SERVER_KEY)."""
    if not ensure_mobile_push_schema():
        return 0

    from app.store.models import MobilePushToken

    try:
        tokens = [
            r.token
            for r in MobilePushToken.query.filter_by(user_id=int(user_id)).all()
            if (r.token or '').strip()
        ]
    except Exception as ex:
        try:
            db.session.rollback()
        except Exception:
            pass
        if _is_transient_sqlite_schema_error(ex):
            return 0
        raise
    if not tokens:
        return 0

    data_payload = {str(k): str(v) for k, v in (data or {}).items()}
    data_payload.setdefault('click_action', 'FLUTTER_NOTIFICATION_CLICK')
    title_s = (title or 'Aviso')[:200]
    body_s = (body or '')[:1000]

    # Preferir HTTP v1 (proyectos Firebase actuales)
    v1 = _send_fcm_v1(tokens, title_s, body_s, data_payload)
    if v1 is not None:
        return v1

    return _send_fcm_legacy(tokens, title_s, body_s, data_payload)


def _fcm_service_account_path():
    import os

    path = (current_app.config.get('FCM_SERVICE_ACCOUNT_FILE') or '').strip()
    if not path:
        path = (os.getenv('GOOGLE_APPLICATION_CREDENTIALS') or '').strip()
    if not path:
        return None
    if not os.path.isabs(path):
        # Relativo a la raíz del proyecto Flask
        root = os.path.abspath(os.path.join(current_app.root_path, '..'))
        path = os.path.join(root, path)
    return path if os.path.isfile(path) else None


def _send_fcm_v1(tokens, title, body, data_payload):
    """FCM HTTP v1. Retorna enviados, o None si no hay credenciales v1."""
    import os

    sa_path = _fcm_service_account_path()
    if not sa_path:
        return None

    try:
        from google.auth.transport.requests import Request as GoogleAuthRequest
        from google.oauth2 import service_account
    except Exception as ex:
        current_app.logger.warning('FCM v1: falta google-auth (%s)', ex)
        return None

    try:
        scopes = ['https://www.googleapis.com/auth/firebase.messaging']
        creds = service_account.Credentials.from_service_account_file(sa_path, scopes=scopes)
        project_id = getattr(creds, 'project_id', None) or ''
        if not project_id:
            with open(sa_path, 'r', encoding='utf-8') as fh:
                project_id = (json.load(fh) or {}).get('project_id') or ''
        if not project_id:
            current_app.logger.warning('FCM v1: project_id vacío en service account')
            return 0
        creds.refresh(GoogleAuthRequest())
        access_token = creds.token
    except Exception as ex:
        current_app.logger.warning('FCM v1 auth: %s', ex)
        return 0

    url = f'https://fcm.googleapis.com/v1/projects/{project_id}/messages:send'
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json; charset=UTF-8',
    }
    sent = 0
    stale = []
    for token in tokens:
        payload = {
            'message': {
                'token': token,
                'notification': {
                    'title': title,
                    'body': body,
                },
                'data': data_payload,
                'android': {
                    'priority': 'HIGH',
                    'notification': {
                        'sound': 'default',
                        'channel_id': 'store_push',
                    },
                },
            }
        }
        try:
            resp = requests.post(url, headers=headers, data=json.dumps(payload), timeout=10)
            if resp.status_code == 200:
                sent += 1
            else:
                text = (resp.text or '')[:300]
                current_app.logger.warning('FCM v1 HTTP %s: %s', resp.status_code, text)
                if resp.status_code == 404 or 'UNREGISTERED' in text or 'NOT_FOUND' in text:
                    stale.append(token)
        except Exception as ex:
            current_app.logger.warning('FCM v1 send error: %s', ex)

    _purge_stale_tokens(stale)
    return sent


def _send_fcm_legacy(tokens, title, body, data_payload):
    server_key = (current_app.config.get('FCM_SERVER_KEY') or '').strip()
    if not server_key:
        return 0

    sent = 0
    stale = []
    headers = {
        'Authorization': f'key={server_key}',
        'Content-Type': 'application/json',
    }
    for token in tokens:
        payload = {
            'to': token,
            'priority': 'high',
            'notification': {
                'title': title,
                'body': body,
                'sound': 'default',
            },
            'data': data_payload,
        }
        try:
            resp = requests.post(
                'https://fcm.googleapis.com/fcm/send',
                headers=headers,
                data=json.dumps(payload),
                timeout=8,
            )
            if resp.status_code == 200:
                body_json = resp.json() if resp.content else {}
                if body_json.get('failure'):
                    results = body_json.get('results') or []
                    if results and (results[0] or {}).get('error') in (
                        'NotRegistered',
                        'InvalidRegistration',
                    ):
                        stale.append(token)
                else:
                    sent += 1
            else:
                current_app.logger.warning(
                    'FCM HTTP %s: %s', resp.status_code, (resp.text or '')[:200]
                )
        except Exception as ex:
            current_app.logger.warning('FCM send error: %s', ex)

    _purge_stale_tokens(stale)
    return sent


def _purge_stale_tokens(stale):
    if not stale:
        return
    try:
        from app.store.models import MobilePushToken

        MobilePushToken.query.filter(MobilePushToken.token.in_(stale)).delete(
            synchronize_session=False
        )
        db.session.commit()
    except Exception:
        db.session.rollback()


def _on_store_notification_insert(mapper, connection, target):
    """Tras crear StoreUserNotification, intenta push nativo (best-effort)."""
    try:
        import threading

        from flask import has_app_context

        user_id = int(getattr(target, 'user_id'))
        title = getattr(target, 'title', None) or 'Aviso de la tienda'
        body = getattr(target, 'body', None) or ''
        kind = getattr(target, 'kind', None) or ''
        notif_id = getattr(target, 'id', None)
        data = {
            'kind': kind,
            'notification_id': str(notif_id or ''),
            'url': (
              '/tienda/admin'
              if str(kind) in (
                  'admin_license_report_new',
                  'admin_product_reservation',
                  'admin_customer_account_renewal',
                  'admin_verificar_arreglar_done',
              )
              else (
                  '/tienda/licencias'
                  if (
                      str(kind).startswith('license_')
                      or str(kind) in (
                          'store_purchase',
                          'store_renewal',
                          'proveedor_product_reservation',
                          'proveedor_customer_account_renewal',
                          'customer_account_renewal_received',
                          'customer_account_renewal_completed',
                          'customer_account_renewal_rejected',
                          'customer_account_renewal_batch',
                      )
                  )
                  else (
                      '/tienda/admin/recargas-saldo'
                      if str(kind) == 'admin_balance_recharge'
                      else (
                          '/tienda/recargas'
                          if str(kind) == 'balance_recharge'
                          else (
                              '/tienda/historial'
                              if str(kind) in (
                                  'whatsapp_digest_fallback',
                                  'admin_whatsapp_digest_fallback',
                              )
                              else '/tienda/'
                          )
                      )
                  )
              )
          ),
        }

        if has_app_context():
            app = current_app._get_current_object()

            def _job():
                with app.app_context():
                    try:
                        from app.models.user import User
                        from app.store.email_notify_prefs import (
                            user_receives_push_notifications,
                        )

                        u = User.query.get(user_id)
                        if not user_receives_push_notifications(u):
                            return
                        send_fcm_to_user(user_id, title, body, data=data)
                    except Exception as ex:
                        # Lock / tabla push ausente: ruido esperado en SQLite concurrente.
                        if not _is_transient_sqlite_schema_error(ex):
                            app.logger.debug('mobile push after_insert: %s', ex)

            threading.Thread(target=_job, daemon=True).start()
    except Exception:
        pass


_listener_ready = False


def register_mobile_push_listeners():
    global _listener_ready
    if _listener_ready:
        return
    from app.store.models import StoreUserNotification

    event.listen(StoreUserNotification, 'after_insert', _on_store_notification_insert)
    _listener_ready = True
    # Intentar crear la tabla al arrancar (si hay lock, se reintenta en silencio después).
    try:
        ensure_mobile_push_schema()
    except Exception:
        pass
