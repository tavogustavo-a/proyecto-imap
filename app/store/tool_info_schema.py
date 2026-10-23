# Schema helpers para ToolInfo (herramientas de cálculo).

from __future__ import annotations

import logging

from sqlalchemy import inspect, text

from app.extensions import db

logger = logging.getLogger(__name__)


def ensure_is_public_column(table_name: str) -> None:
    """Añade is_public a una tabla de herramientas si todavía no existe."""
    try:
        insp = inspect(db.engine)
        if table_name not in insp.get_table_names():
            return
        cols = {c['name'].lower() for c in insp.get_columns(table_name)}
        if 'is_public' in cols:
            return
        dialect = (getattr(db.engine.dialect, 'name', '') or '').lower()
        bool_sql = (
            'BOOLEAN NOT NULL DEFAULT FALSE'
            if dialect in ('postgresql', 'postgres')
            else 'INTEGER DEFAULT 0 NOT NULL'
        )
        db.session.execute(
            text(f'ALTER TABLE {table_name} ADD COLUMN is_public {bool_sql}')
        )
        db.session.commit()
        logger.info('Esquema: columna is_public añadida a %s', table_name)
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        logger.warning('ensure_is_public_column(%s): %s', table_name, exc)


def ensure_tool_info_is_public_column() -> None:
    """Añade is_public en las herramientas que se pueden abrir sin login."""
    for table_name in (
        'store_tool_info',
        'html_info',
        'store_youtube_listings',
        'api_info',
    ):
        ensure_is_public_column(table_name)


def ensure_html_preset_key_column() -> None:
    """Añade preset_key en html_info para plantillas preconfiguradas."""
    table_name = 'html_info'
    try:
        insp = inspect(db.engine)
        if table_name not in insp.get_table_names():
            return
        cols = {c['name'].lower() for c in insp.get_columns(table_name)}
        if 'preset_key' in cols:
            return
        db.session.execute(
            text('ALTER TABLE html_info ADD COLUMN preset_key VARCHAR(64)')
        )
        db.session.commit()
        logger.info('Esquema: columna preset_key añadida a %s', table_name)
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        logger.warning('ensure_html_preset_key_column: %s', exc)
