"""Columnas SQLite para WhatsApp Web (Evolution API)."""

from __future__ import annotations

from flask import current_app

from app.extensions import db


def ensure_whatsapp_web_columns():
    """Añade columnas de WhatsApp Web si la tabla ya existía sin ellas."""
    try:
        from sqlalchemy import inspect, text

        inspector = inspect(db.engine)
        if 'whatsapp_configs' not in inspector.get_table_names():
            return
        dialect = getattr(db.engine.dialect, 'name', '') or ''
        dt_type = 'TIMESTAMP' if dialect == 'postgresql' else 'DATETIME'
        cols = {c['name'] for c in inspector.get_columns('whatsapp_configs')}

        additions = [
            ('base_url', "ALTER TABLE whatsapp_configs ADD COLUMN base_url VARCHAR(512)"),
            ('instance_name', "ALTER TABLE whatsapp_configs ADD COLUMN instance_name VARCHAR(120)"),
            ('connection_status', "ALTER TABLE whatsapp_configs ADD COLUMN connection_status VARCHAR(40)"),
            ('linked_phone', "ALTER TABLE whatsapp_configs ADD COLUMN linked_phone VARCHAR(40)"),
            ('last_health_at', f"ALTER TABLE whatsapp_configs ADD COLUMN last_health_at {dt_type}"),
            ('last_health_error', "ALTER TABLE whatsapp_configs ADD COLUMN last_health_error TEXT"),
            (
                'last_disconnect_alert_at',
                f"ALTER TABLE whatsapp_configs ADD COLUMN last_disconnect_alert_at {dt_type}",
            ),
            ('alert_email', "ALTER TABLE whatsapp_configs ADD COLUMN alert_email VARCHAR(255)"),
            (
                'health_alert_enabled',
                'ALTER TABLE whatsapp_configs ADD COLUMN health_alert_enabled INTEGER DEFAULT 1 NOT NULL',
            ),
            ('last_notify_at', f"ALTER TABLE whatsapp_configs ADD COLUMN last_notify_at {dt_type}"),
            ('notify_run_log_json', 'ALTER TABLE whatsapp_configs ADD COLUMN notify_run_log_json TEXT'),
            (
                'notify_catchup_after',
                f"ALTER TABLE whatsapp_configs ADD COLUMN notify_catchup_after {dt_type}",
            ),
            (
                'last_notify_fail_alert_at',
                f"ALTER TABLE whatsapp_configs ADD COLUMN last_notify_fail_alert_at {dt_type}",
            ),
        ]
        for col_name, ddl in additions:
            if col_name in cols:
                continue
            try:
                db.session.execute(text(ddl))
                db.session.commit()
                cols.add(col_name)
            except Exception as col_exc:
                try:
                    db.session.rollback()
                except Exception:
                    pass
                cols = {c['name'] for c in inspect(db.engine).get_columns('whatsapp_configs')}
                if col_name not in cols:
                    current_app.logger.warning(
                        'No se pudo añadir columna whatsapp_configs.%s: %s',
                        col_name,
                        col_exc,
                    )
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        current_app.logger.warning('No se pudo asegurar columnas whatsapp_web: %s', exc)
