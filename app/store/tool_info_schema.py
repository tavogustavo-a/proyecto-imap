# Schema helpers para ToolInfo (herramientas de cálculo).

from __future__ import annotations

import logging

from sqlalchemy import inspect, text

from app.extensions import db

logger = logging.getLogger(__name__)


def ensure_tool_info_is_public_column() -> None:
    """Añade store_tool_info.is_public si la tabla ya existía sin esa columna."""
    try:
        insp = inspect(db.engine)
        if 'store_tool_info' not in insp.get_table_names():
            return
        cols = {c['name'].lower() for c in insp.get_columns('store_tool_info')}
        if 'is_public' in cols:
            return
        dialect = (getattr(db.engine.dialect, 'name', '') or '').lower()
        bool_sql = (
            'BOOLEAN NOT NULL DEFAULT FALSE'
            if dialect in ('postgresql', 'postgres')
            else 'INTEGER DEFAULT 0 NOT NULL'
        )
        db.session.execute(
            text(f'ALTER TABLE store_tool_info ADD COLUMN is_public {bool_sql}')
        )
        db.session.commit()
        logger.info('Esquema: columna is_public añadida a store_tool_info')
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        logger.warning('ensure_tool_info_is_public_column: %s', exc)
