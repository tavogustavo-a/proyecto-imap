#!/usr/bin/env python3
"""
Diagnóstico de esquema BD vs modelos SQLAlchemy (tienda / herramientas).

Uso en el servidor (desde la raíz del proyecto, con el venv activo):

  python check_db_schema.py
  python check_db_schema.py --fix

Sin --fix solo lista lo que falta.
Con --fix aplica parches conocidos de herramientas-public y vuelve a reportar.
"""

from __future__ import annotations

import argparse
import sys
import traceback

from sqlalchemy import inspect, text


# Tablas críticas para /tienda/herramientas-public y hojas de cálculo
FOCUS_TABLES = {
    'store_tool_info',
    'html_info',
    'api_info',
    'store_youtube_listings',
    'store_production_links',
    'htmlinfo_users',
    'apiinfo_users',
    'youtube_listing_users',
    'toolinfo_users',
    'worksheet_templates',
    'worksheet_data',
}


def _col_type_name(col_type) -> str:
    try:
        return str(col_type)
    except Exception:
        return type(col_type).__name__


def collect_model_tables(db):
    """Mapa {table_name: {column_name: type_str}} desde metadata SQLAlchemy."""
    out = {}
    for table in db.metadata.sorted_tables:
        out[table.name] = {
            c.name: _col_type_name(c.type) for c in table.columns
        }
    return out


def collect_db_tables(engine):
    """Mapa {table_name: set(column_names)} desde la BD real."""
    insp = inspect(engine)
    out = {}
    for name in insp.get_table_names():
        out[name] = {c['name'] for c in insp.get_columns(name)}
    return out


def print_report(model_tables, db_tables, focus_only=False):
    missing_tables = []
    missing_columns = []  # (table, column, type)

    names = sorted(model_tables.keys())
    if focus_only:
        names = [n for n in names if n in FOCUS_TABLES] or sorted(FOCUS_TABLES)

    print('\n=== Comparación modelos ↔ base de datos ===\n')
    for table in names:
        expected = model_tables.get(table)
        if expected is None:
            # Solo en focus list y no está en metadata
            if table not in db_tables:
                print(f'[FALTA TABLA] {table}')
                missing_tables.append(table)
            continue

        if table not in db_tables:
            print(f'[FALTA TABLA] {table}  (modelo espera {len(expected)} columnas)')
            missing_tables.append(table)
            continue

        actual = {c.lower() for c in db_tables[table]}
        # comparar case-insensitive
        actual_map = {c.lower(): c for c in db_tables[table]}
        missing = []
        for col, typ in expected.items():
            if col.lower() not in actual:
                missing.append((col, typ))
        if missing:
            print(f'[FALTAN COLUMNAS] {table}:')
            for col, typ in missing:
                print(f'    - {col}  ({typ})')
                missing_columns.append((table, col, typ))
        else:
            print(f'[OK] {table} ({len(expected)} columnas)')

    print('\n=== Resumen ===')
    print(f'Tablas faltantes: {len(missing_tables)}')
    print(f'Columnas faltantes: {len(missing_columns)}')
    return missing_tables, missing_columns


def apply_known_fixes(app):
    print('\n=== Aplicando parches conocidos (herramientas-public) ===\n')
    from app.store.tool_info_schema import ensure_herramientas_public_schema

    ensure_herramientas_public_schema()
    print('Parches ensure_herramientas_public_schema() ejecutados.')


def smoke_herramientas_queries(app):
    """Prueba consultas típicas de la página herramientas-public."""
    print('\n=== Smoke test consultas herramientas-public ===\n')
    from app.store.models import ApiInfo, HtmlInfo, ToolInfo, YouTubeListing

    checks = [
        ('ToolInfo', lambda: ToolInfo.query.limit(1).all()),
        ('HtmlInfo', lambda: HtmlInfo.query.limit(1).all()),
        ('ApiInfo', lambda: ApiInfo.query.limit(1).all()),
        ('YouTubeListing', lambda: YouTubeListing.query.limit(1).all()),
        (
            'HtmlInfo.preset_key',
            lambda: HtmlInfo.query.with_entities(HtmlInfo.preset_key).limit(1).all(),
        ),
        (
            'ApiInfo.drive_subtitle_photos',
            lambda: ApiInfo.query.with_entities(
                ApiInfo.drive_subtitle_photos, ApiInfo.drive_subtitle_videos
            ).limit(1).all(),
        ),
        (
            'is_public flags',
            lambda: (
                ToolInfo.query.with_entities(ToolInfo.is_public).limit(1).all(),
                HtmlInfo.query.with_entities(HtmlInfo.is_public).limit(1).all(),
                ApiInfo.query.with_entities(ApiInfo.is_public).limit(1).all(),
            ),
        ),
    ]
    ok = True
    for name, fn in checks:
        try:
            fn()
            print(f'[OK] {name}')
        except Exception as exc:
            ok = False
            print(f'[ERROR] {name}: {exc}')
            traceback.print_exc()
    return ok


def suggest_sql(missing_columns, dialect: str):
    if not missing_columns:
        return
    print('\n=== SQL sugerido (revisar antes de ejecutar) ===\n')
    for table, col, typ in missing_columns:
        t = (typ or '').upper()
        if 'BOOL' in t:
            if dialect in ('postgresql', 'postgres'):
                ddl = f'ALTER TABLE {table} ADD COLUMN {col} BOOLEAN NOT NULL DEFAULT FALSE;'
            else:
                ddl = f'ALTER TABLE {table} ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0;'
        elif 'JSON' in t:
            ddl = f'ALTER TABLE {table} ADD COLUMN {col} JSON;'
        elif 'TEXT' in t or 'CLOB' in t:
            ddl = f'ALTER TABLE {table} ADD COLUMN {col} TEXT;'
        elif 'FLOAT' in t or 'REAL' in t or 'DOUBLE' in t or 'NUMERIC' in t or 'DECIMAL' in t:
            ddl = f'ALTER TABLE {table} ADD COLUMN {col} FLOAT;'
        elif 'INT' in t:
            ddl = f'ALTER TABLE {table} ADD COLUMN {col} INTEGER;'
        elif 'VARCHAR' in t or 'STRING' in t:
            # extraer longitud si existe
            ddl = f'ALTER TABLE {table} ADD COLUMN {col} VARCHAR(255);'
            if '(' in typ and ')' in typ:
                ddl = f'ALTER TABLE {table} ADD COLUMN {col} {typ};'
        elif 'DATE' in t or 'TIME' in t:
            if dialect in ('postgresql', 'postgres'):
                ddl = f'ALTER TABLE {table} ADD COLUMN {col} TIMESTAMP;'
            else:
                ddl = f'ALTER TABLE {table} ADD COLUMN {col} DATETIME;'
        else:
            ddl = f'ALTER TABLE {table} ADD COLUMN {col} TEXT;  -- revisar tipo ({typ})'
        print(ddl)


def main():
    parser = argparse.ArgumentParser(description='Diagnóstico de esquema BD vs modelos')
    parser.add_argument(
        '--fix',
        action='store_true',
        help='Aplica parches conocidos de herramientas-public',
    )
    parser.add_argument(
        '--all',
        action='store_true',
        help='Compara todas las tablas del metadata (no solo las de herramientas)',
    )
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv()

    from app import create_app, db

    app = create_app()
    with app.app_context():
        dialect = (getattr(db.engine.dialect, 'name', '') or '').lower()
        print(f'Dialecto BD: {dialect}')
        try:
            db.session.execute(text('SELECT 1'))
            print('Conexión BD: OK')
        except Exception as exc:
            print(f'Conexión BD: ERROR — {exc}')
            return 2

        if args.fix:
            try:
                apply_known_fixes(app)
            except Exception as exc:
                print(f'Error aplicando parches: {exc}')
                traceback.print_exc()
                try:
                    db.session.rollback()
                except Exception:
                    pass

        model_tables = collect_model_tables(db)
        db_tables = collect_db_tables(db.engine)
        _missing_tables, missing_columns = print_report(
            model_tables, db_tables, focus_only=not args.all
        )
        suggest_sql(missing_columns, dialect)

        smoke_ok = smoke_herramientas_queries(app)
        if not smoke_ok:
            print(
                '\nHay errores de consulta. Suele ser columna/tabla faltante.\n'
                'Ejecuta:  python check_db_schema.py --fix\n'
                'Luego reinicia la app (gunicorn/uwsgi/systemd).'
            )
            return 1

        if missing_columns:
            print(
                '\nAún faltan columnas respecto al modelo.\n'
                'Puedes aplicar el SQL sugerido o --fix para los parches conocidos.'
            )
            return 1

        print('\nEsquema de herramientas parece OK.')
        return 0


if __name__ == '__main__':
    sys.exit(main())
