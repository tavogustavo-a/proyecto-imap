# -*- coding: utf-8 -*-
"""
Copias de seguridad de la base SQLite (diaria + panel admin).
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


def _disk_free_bytes(path: str) -> int | None:
    try:
        return shutil.disk_usage(str(path)).free
    except OSError:
        return None


def _notify_admins_disk_low(free_bytes: int, required_bytes: int) -> None:
    """Aviso en la campana de la tienda (admin + soporte) cuando queda poco disco."""
    try:
        from app.extensions import db
        from app.store.store_event_notify import notify_admins_app

        free_mb = int(free_bytes // (1024 * 1024))
        req_mb = int(required_bytes // (1024 * 1024))
        notify_admins_app(
            kind='admin_disk_space_low',
            title='⚠ Espacio en disco bajo en el servidor',
            body=(
                f'Quedan {free_mb} MB libres y se necesitan al menos {req_mb} MB. '
                'La copia de seguridad automática se omitió. '
                'Libera espacio en el servidor: si el disco se llena, la tienda no podrá '
                'registrar ventas, reservas ni recargas.'
            ),
            payload={'free_mb': free_mb, 'required_mb': req_mb, 'url': '/tienda/admin'},
        )
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
    except Exception as ex:
        log.warning('aviso disco bajo: %s', ex)


def check_free_disk_for_backup(app=None, db_size_bytes: int = 0) -> tuple[bool, int, int]:
    """
    Verifica el espacio libre en el disco de los backups.
    Requiere lo mayor entre MIN_FREE_DISK_MB y 3× el tamaño de la BD.
    Retorna (hay_espacio, libres_bytes, requerido_bytes).
    """
    app = app or current_app
    min_free_mb = max(50, int(app.config.get('MIN_FREE_DISK_MB', 500)))
    required = max(int(min_free_mb) * 1024 * 1024, 3 * int(db_size_bytes or 0))
    bd = backups_directory(app)
    free = _disk_free_bytes(str(bd))
    if free is None:
        # Sin lectura fiable del disco: no bloquear el backup.
        return True, -1, required
    return free >= required, free, required


def create_auto_backup_now(app=None) -> str | None:
    """
    Crea un backup automático con nombre auto_YYYYMMDD_HHMMSS.db y aplica rotación.
    Si queda poco espacio en disco, omite la copia y avisa al admin en la tienda.
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
        try:
            db_size = os.path.getsize(src)
        except OSError:
            db_size = 0
        ok_space, free, required = check_free_disk_for_backup(app, db_size)
        if not ok_space:
            log.warning(
                'Auto backup omitido: poco espacio en disco (libres %s MB, requerido %s MB).',
                free // (1024 * 1024),
                required // (1024 * 1024),
            )
            # Rotar igualmente por si liberar copias viejas ayuda.
            prune_auto_backups(app)
            _notify_admins_disk_low(free, required)
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
    try:
        db_size = os.path.getsize(src)
    except OSError:
        db_size = 0
    ok_space, free, required = check_free_disk_for_backup(app, db_size)
    if not ok_space:
        log.warning(
            'Backup manual rechazado: poco espacio en disco (libres %s MB, requerido %s MB).',
            free // (1024 * 1024),
            required // (1024 * 1024),
        )
        _notify_admins_disk_low(free, required)
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


def delete_all_backups_except_latest(app=None) -> tuple[bool, str]:
    """
    Elimina todas las copias guardadas excepto la más reciente (por fecha de modificación).
    Retorna (éxito, mensaje).
    """
    app = app or current_app
    rows = list_backup_files(app)
    if not rows:
        return False, 'No hay copias para eliminar.'
    if len(rows) == 1:
        return True, f'Solo hay una copia ({rows[0]["name"]}); no se eliminó nada.'

    keep_name = rows[0]['name']
    deleted = 0
    errors: list[str] = []
    for row in rows[1:]:
        ok, msg = delete_backup_file(row['name'], app)
        if ok:
            deleted += 1
        else:
            errors.append(f'{row["name"]}: {msg}')

    if deleted == 0 and errors:
        return False, 'No se pudo eliminar ninguna copia. ' + '; '.join(errors[:3])

    out = f'Se eliminaron {deleted} copia(s). Se conservó la más reciente: {keep_name}.'
    if errors:
        out += ' Algunas copias no se pudieron borrar: ' + '; '.join(errors[:3])
        if len(errors) > 3:
            out += f' (+{len(errors) - 3} más)'
    return True, out


def scheduled_backup_tick(app=None):
    """Llamada desde APScheduler (diaria)."""
    create_auto_backup_now(app)
