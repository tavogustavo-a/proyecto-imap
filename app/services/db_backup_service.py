# -*- coding: utf-8 -*-
"""
Copias de seguridad de la base SQLite (horario + panel admin).
Mantiene hasta N archivos auto_*.db (FIFO: al superar el máximo se borran los más antiguos).
"""
import logging
import os
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app
from werkzeug.utils import secure_filename

log = logging.getLogger(__name__)

_AUTO_RE = re.compile(r'^auto_\d{8}_\d{6}\.db$', re.IGNORECASE)


def _is_sqlite_uri(uri: str) -> bool:
    if not uri:
        return False
    u = uri.split('?')[0].lower()
    return u.startswith('sqlite:') and '://' in u


def _sqlite_main_file_via_pragma(app) -> str | None:
    """Archivo físico actual de la BD 'main' según SQLite (coincide con SQLAlchemy)."""
    try:
        from sqlalchemy import text

        from app.extensions import db

        rows = db.session.execute(text('PRAGMA database_list')).fetchall()
        for row in rows:
            if len(row) < 3:
                continue
            name = row[1]
            filepath = row[2]
            if name == 'main' and filepath:
                return os.path.abspath(str(filepath))
    except Exception as ex:
        log.debug('PRAGMA database_list no disponible: %s', ex)
    return None


def get_sqlite_database_path(app=None) -> str | None:
    """Solo configuración/aproximación; para backup/restaurar usar get_resolved_sqlite_database_path."""
    app = app or current_app
    p = app.config.get('DATABASE_PATH')
    if p:
        p = os.path.abspath(os.path.normpath(p))
        if os.path.isfile(p):
            return p
        # Puede no existir todavía el fichero; devolvemos destino previsto
        return p
    uri = app.config.get('SQLALCHEMY_DATABASE_URI') or ''
    if not _is_sqlite_uri(uri):
        return None
    raw = uri.replace('sqlite:///', '', 1).split('?')[0]
    if not raw:
        return None
    raw = os.path.normpath(raw)
    if os.path.isabs(raw):
        return raw
    root = os.path.abspath(os.path.dirname(app.root_path))
    return os.path.abspath(os.path.join(root, raw))


def get_resolved_sqlite_database_path(app=None) -> str | None:
    """
    Ruta absoluta del .db que realmente usa la app (PRAGMA database_list sobre la conexión activa).
    Evita hacer backup/restauración de otro archivo distinto al de Flask-SQLAlchemy.
    Si aún no hubo ninguna consulta que abra SQLite, usa get_sqlite_database_path().
    """
    app = app or current_app
    uri = app.config.get('SQLALCHEMY_DATABASE_URI') or ''
    if not _is_sqlite_uri(uri):
        return None

    from flask import has_app_context

    resolved: str | None = None
    if has_app_context():
        resolved = _sqlite_main_file_via_pragma(app)
    else:
        with app.app_context():
            resolved = _sqlite_main_file_via_pragma(app)
    if resolved:
        return resolved
    return get_sqlite_database_path(app)


def _remove_sqlite_wal_shm(main_db_path: str) -> None:
    """Tras reemplazar el .db hay que borrar -wal/-shm viejos o SQLite podría mezclar estados."""
    if not main_db_path.endswith('.db'):
        return
    for suffix in ('-wal', '-shm'):
        aux = main_db_path + suffix
        try:
            if os.path.isfile(aux):
                os.unlink(aux)
        except OSError as e:
            log.warning('No se pudo eliminar auxiliar SQLite %s: %s', aux, e)


def backups_directory(app=None) -> Path:
    app = app or current_app
    d = app.config.get('BACKUPS_DIR')
    if d:
        bd = Path(os.path.abspath(d))
    else:
        bd = Path(app.root_path).parent / 'instance' / 'backups'
    bd.mkdir(parents=True, exist_ok=True)
    return bd


def _sqlite_backup_file(src_path: str, dest_path: str) -> None:
    """Copia segura con API backup (coherente incluso con WAL)."""
    Path(os.path.dirname(dest_path)).mkdir(parents=True, exist_ok=True)
    uri = Path(src_path).resolve().as_uri() + '?mode=ro'
    src = sqlite3.connect(uri, uri=True)
    try:
        dst = sqlite3.connect(dest_path)
        try:
            src.backup(dst)
            dst.commit()
        finally:
            dst.close()
    finally:
        src.close()


def prune_auto_backups(app=None) -> int:
    """Elimina auto_*.db más antiguos hasta quedar <= AUTO_BACKUP_MAX_FILES. Retorna cuántos borró."""
    app = app or current_app
    max_n = max(1, int(app.config.get('AUTO_BACKUP_MAX_FILES', 100)))
    bd = backups_directory(app)
    auto_files = []
    for fp in bd.iterdir():
        if not fp.is_file():
            continue
        if _AUTO_RE.match(fp.name):
            try:
                auto_files.append((fp.stat().st_mtime, fp))
            except OSError:
                continue
    auto_files.sort(key=lambda x: x[0])
    removed = 0
    while len(auto_files) > max_n:
        oldest = auto_files.pop(0)[1]
        try:
            oldest.unlink()
            removed += 1
        except OSError as e:
            log.warning('No se pudo borrar backup antiguo %s: %s', oldest, e)
    return removed


def create_auto_backup_now(app=None) -> str | None:
    """
    Crea un backup automático con nombre auto_YYYYMMDD_HHMMSS.db y aplica rotación.
    Retorna ruta absoluta del fichero creado, o None si no aplica (no SQLite / error).
    """
    app = app or current_app
    src = get_resolved_sqlite_database_path(app)
    if not src or not _is_sqlite_uri(app.config.get('SQLALCHEMY_DATABASE_URI') or ''):
        log.info('Auto backup omitido: BD no es SQLite o no hay ruta.')
        return None
    ts = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    name = f'auto_{ts}.db'
    bd = backups_directory(app)
    dest = bd / name
    try:
        if not os.path.isfile(src):
            log.warning('Auto backup: no existe el fichero BD en %s — se omite.', src)
            return None
        _sqlite_backup_file(src, str(dest))
        prune_auto_backups(app)
        return str(dest.resolve())
    except Exception as e:
        log.warning('Error al crear auto backup: %s', e, exc_info=True)
        try:
            if dest.exists():
                dest.unlink()
        except OSError:
            pass
        return None


def create_manual_backup_now(app=None) -> str | None:
    app = app or current_app
    src = get_resolved_sqlite_database_path(app)
    if not src or not os.path.isfile(src):
        return None
    ts = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    bd = backups_directory(app)
    name = f'manual_{ts}.db'
    dest = bd / name
    _sqlite_backup_file(src, str(dest))
    return str(dest.resolve())


def list_backup_files(app=None) -> list[dict]:
    app = app or current_app
    bd = backups_directory(app)
    out = []
    for fp in bd.iterdir():
        if not fp.is_file() or not fp.suffix.lower() == '.db':
            continue
        if not (fp.name.startswith('auto_') or fp.name.startswith('manual_')):
            continue
        try:
            st = fp.stat()
            out.append({
                'name': fp.name,
                'size': st.st_size,
                'mtime': st.st_mtime,
            })
        except OSError:
            continue
    out.sort(key=lambda x: x['mtime'], reverse=True)
    return out


def restore_from_backup_file(filename: str, app=None) -> tuple[bool, str]:
    """
    Sustituye el SQLite activo por una copia guardada. Cierra conexiones previas.
    Retorna (éxito, mensaje).
    """
    app = app or current_app
    safe = secure_filename(filename)
    if safe != filename or not safe.endswith('.db'):
        return False, 'Nombre de archivo no válido.'
    bd = backups_directory(app)
    src = (bd / safe).resolve()
    if not src.is_file():
        return False, 'No existe la copia solicitada.'
    # Evitar path traversal
    try:
        bd_r = os.path.normcase(str(bd.resolve()))
        src_n = os.path.normcase(str(src))
        if not (src_n == bd_r or src_n.startswith(bd_r + os.sep)):
            return False, 'Ruta ilegal.'
    except (OSError, ValueError):
        return False, 'Ruta ilegal.'

    dest = get_resolved_sqlite_database_path(app)
    if not dest:
        return False, 'La base de datos no es SQLite o no hay ruta configurada.'

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    guardian: str | None = None
    if os.path.isfile(dest):
        guardian = dest + f'.antes_restaurar_{stamp}.db'
        try:
            shutil.copy2(dest, guardian)
        except OSError as e:
            return False, f'No se pudo guardar copia previa: {e}'

    try:
        from app.extensions import db

        db.session.remove()
        db.engine.dispose()
        shutil.copyfile(str(src), dest)
        _remove_sqlite_wal_shm(dest)
        db.session.remove()
        db.engine.dispose()
        msg = (
            f'Base restaurada desde {safe}. Estado completo hasta la fecha de esa copia '
            '(licencias, usuarios/admin, tienda, archivos archivados, etc., todo lo que vivía en SQLite). '
        )
        if guardian:
            msg += f'Copia previa: {os.path.basename(guardian)}.'
        return True, msg
    except Exception as e:
        log.exception('Fallo al restaurar BD')
        try:
            if guardian and os.path.isfile(guardian):
                shutil.copyfile(guardian, dest)
                _remove_sqlite_wal_shm(dest)
        except OSError:
            pass
        return False, str(e)


def delete_backup_file(filename: str, app=None) -> tuple[bool, str]:
    """
    Borra un archivo de copia dentro de BACKUPS_DIR (auto_*/manual_* .db).
    No toca la base de datos activa.
    """
    app = app or current_app
    safe = secure_filename(filename)
    if safe != filename or not safe.endswith('.db'):
        return False, 'Nombre de archivo no válido.'
    if not (safe.startswith('auto_') or safe.startswith('manual_')):
        return False, 'Solo se pueden eliminar copias auto_ o manual_.'
    bd = backups_directory(app)
    target = (bd / safe).resolve()
    if not target.is_file():
        return False, 'No existe ese archivo de copia.'
    try:
        bd_r = os.path.normcase(str(bd.resolve()))
        tgt_n = os.path.normcase(str(target))
        if not (tgt_n == bd_r or tgt_n.startswith(bd_r + os.sep)):
            return False, 'Ruta ilegal.'
    except (OSError, ValueError):
        return False, 'Ruta ilegal.'
    try:
        os.unlink(str(target))
        return True, f'Copia eliminada: {safe}'
    except OSError as e:
        return False, f'No se pudo eliminar: {e}'


def scheduled_backup_tick(app=None):
    """Llamada desde APScheduler (hourly)."""
    create_auto_backup_now(app)
