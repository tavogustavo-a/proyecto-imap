"""Revisa las tablas del bot de Telegram. No modifica la base ni imprime tokens.

En el servidor, desde la raíz del proyecto:

    python scripts/check_telegram_bot_schema.py
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

EXPECTED = {
    'telegram_bot_configs': (
        'id',
        'bot_username',
        'bot_token',
        'is_enabled',
        'connection_status',
        'update_offset',
        'menu_buttons',
        'last_health_at',
        'last_health_error',
        'updated_at',
    ),
    'telegram_known_chats': (
        'id',
        'chat_id',
        'topic_id',
        'title',
        'chat_type',
        'member_count',
        'linked_chat_id',
        'removed',
        'is_forum',
        'updated_at',
    ),
}


def main() -> int:
    from sqlalchemy import inspect, text

    from app import create_app
    from app.extensions import db

    app = create_app()
    with app.app_context():
        insp = inspect(db.engine)
        names = set(insp.get_table_names())
        print('dialect:', getattr(db.engine.dialect, 'name', ''))
        print()
        missing_any = False
        for table, expected in EXPECTED.items():
            print('==', table, '==')
            if table not in names:
                print('NO EXISTE')
                missing_any = True
                print()
                continue
            cols = {column['name']: column for column in insp.get_columns(table)}
            present = list(cols)
            missing = [name for name in expected if name not in cols]
            extra = [name for name in present if name not in expected]
            print('columnas:', ', '.join(present))
            print('faltan:', ', '.join(missing) if missing else '(ninguna)')
            print('extra:', ', '.join(extra) if extra else '(ninguna)')
            if missing:
                missing_any = True
            with db.engine.connect() as conn:
                count = conn.execute(text(f'SELECT COUNT(*) FROM {table}')).scalar()
            print('filas:', count)
            if table == 'telegram_bot_configs' and 'bot_token' in cols:
                with db.engine.connect() as conn:
                    filled = conn.execute(
                        text(
                            "SELECT COUNT(*) FROM telegram_bot_configs "
                            "WHERE bot_token IS NOT NULL AND TRIM(bot_token) <> ''"
                        )
                    ).scalar()
                print('filas con token (sin mostrar el valor):', filled)
            print()
        if missing_any:
            print('RESULTADO: la tabla falta o le faltan columnas. Eso explica el 500 al guardar.')
            return 1
        print('RESULTADO: las columnas esperadas están. El 500 viene de otro lado; mira el log del servidor.')
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
