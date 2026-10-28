"""Migraciones puntuales de herramientas (API → HTML personalizado)."""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


def migrate_busqueda_medios_api_to_html(db, ApiInfo, HtmlInfo, preset_key: str) -> int:
    """
    Copia cada ApiInfo «Búsqueda de Medios» a HtmlInfo con preset busqueda_medios
    y desactiva la API legacy. Idempotente por título + preset.
    """
    migrated = 0
    apis = ApiInfo.query.filter_by(api_type='Búsqueda de Medios').all()
    for api in apis:
        if HtmlInfo.query.filter_by(preset_key=preset_key, title=api.title).first():
            if api.enabled:
                api.enabled = False
            continue
        payload = json.dumps({'api_key': api.api_key or ''}, ensure_ascii=False)
        html = HtmlInfo(
            title=api.title,
            text=payload,
            preset_key=preset_key,
            enabled=api.enabled,
            is_public=bool(getattr(api, 'is_public', False)),
        )
        db.session.add(html)
        db.session.flush()
        for user in api.users.all():
            if user not in html.users.all():
                html.users.append(user)
        api.enabled = False
        migrated += 1
    if migrated or apis:
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            logger.exception('migrate_busqueda_medios_api_to_html failed')
            raise
    return migrated


def migrate_drive_api_to_html(db, ApiInfo, HtmlInfo, preset_key: str) -> int:
    """Copia ApiInfo Drive → HtmlInfo drive_fotos_peliculas y desactiva la API."""
    migrated = 0
    apis = ApiInfo.query.filter_by(api_type='Drive').all()
    for api in apis:
        if HtmlInfo.query.filter_by(preset_key=preset_key, title=api.title).first():
            if api.enabled:
                api.enabled = False
            continue
        payload = json.dumps(
            {
                'api_key': api.api_key or '',
                'api_url': api.api_url or '',
                'drive_subtitle_photos': api.drive_subtitle_photos or '',
                'drive_subtitle_videos': api.drive_subtitle_videos or '',
            },
            ensure_ascii=False,
        )
        html = HtmlInfo(
            title=api.title,
            text=payload,
            preset_key=preset_key,
            enabled=api.enabled,
            is_public=bool(getattr(api, 'is_public', False)),
        )
        db.session.add(html)
        db.session.flush()
        for user in api.users.all():
            if user not in html.users.all():
                html.users.append(user)
        api.enabled = False
        migrated += 1
    if migrated or apis:
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            logger.exception('migrate_drive_api_to_html failed')
            raise
    return migrated
