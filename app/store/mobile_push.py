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


def ensure_mobile_push_schema():
    try:
        from app.store.models import MobilePushToken  # noqa: F401

        insp = inspect(db.engine)
        tables = set(insp.get_table_names())
        if 'store_mobile_push_tokens' not in tables:
            db.create_all()
            # create_all may no-op if metadata already loaded partially
            if 'store_mobile_push_tokens' not in set(inspect(db.engine).get_table_names()):
                dialect = getattr(db.engine.dialect, 'name', '') or ''
                if dialect == 'postgresql':
                    db.session.execute(
                        text(
                            """
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
                        )
                    )
                else:
                    db.session.execute(
                        text(
                            """
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
                        )
                    )
                db.session.commit()
    except Exception as ex:
        try:
            db.session.rollback()
        except Exception:
            pass
        try:
            current_app.logger.warning('ensure_mobile_push_schema: %s', ex)
        except Exception:
            logger.warning('ensure_mobile_push_schema: %s', ex)


def upsert_push_token(user_id: int, token: str, platform: str = 'android', device_label: str | None = None):
    from app.store.models import MobilePushToken

    ensure_mobile_push_schema()
    token = (token or '').strip()
    if not token or not user_id:
        return None
    platform = (platform or 'android').strip().lower()[:20] or 'android'
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


def send_fcm_to_user(user_id: int, title: str, body: str, data: dict | None = None) -> int:
    """Envía FCM legacy si hay FCM_SERVER_KEY. Retorna cantidad de envíos OK."""
    ensure_mobile_push_schema()
    server_key = (current_app.config.get('FCM_SERVER_KEY') or '').strip()
    if not server_key:
        return 0

    from app.store.models import MobilePushToken

    tokens = [
        r.token
        for r in MobilePushToken.query.filter_by(user_id=int(user_id)).all()
        if (r.token or '').strip()
    ]
    if not tokens:
        return 0

    sent = 0
    stale = []
    headers = {
        'Authorization': f'key={server_key}',
        'Content-Type': 'application/json',
    }
    data_payload = {str(k): str(v) for k, v in (data or {}).items()}
    data_payload.setdefault('click_action', 'FLUTTER_NOTIFICATION_CLICK')

    for token in tokens:
        payload = {
            'to': token,
            'priority': 'high',
            'notification': {
                'title': (title or 'Aviso')[:200],
                'body': (body or '')[:1000],
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

    if stale:
        try:
            MobilePushToken.query.filter(MobilePushToken.token.in_(stale)).delete(
                synchronize_session=False
            )
            db.session.commit()
        except Exception:
            db.session.rollback()

    return sent


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
            'url': '/tienda/',
        }

        if has_app_context():
            app = current_app._get_current_object()

            def _job():
                with app.app_context():
                    try:
                        send_fcm_to_user(user_id, title, body, data=data)
                    except Exception as ex:
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
