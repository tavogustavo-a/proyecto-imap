# Servidores IMAP exclusivos para revisión de recargas (medios de pago).

from __future__ import annotations

import ssl
from dataclasses import dataclass
from imaplib import IMAP4
from socket import gaierror, timeout
from typing import Any

from imapclient import IMAPClient, exceptions as imap_exceptions

from app.services.imap_crypto import decrypt_password, encrypt_password
from app.store.balance_recharge_email_review import get_email_review_settings, _persist_settings


@dataclass
class RecargaIMAPAdapter:
    """Objeto compatible con search_emails_for_observer."""

    id: int
    host: str
    port: int
    username: str
    password_enc: str
    folders: str
    enabled: bool = True
    description: str = ''


def _normalize_imap_server(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    try:
        sid = int(raw.get('id'))
    except (TypeError, ValueError):
        return None
    if sid <= 0:
        return None
    host = str(raw.get('host') or '').strip()
    username = str(raw.get('username') or '').strip()
    password_enc = str(raw.get('password_enc') or '').strip()
    if not host or not username or not password_enc:
        return None
    try:
        port = int(raw.get('port') or 993)
    except (TypeError, ValueError):
        port = 993
    if port <= 0:
        port = 993
    folders = str(raw.get('folders') or 'INBOX').strip() or 'INBOX'
    enabled = raw.get('enabled')
    if enabled is None:
        enabled = True
    return {
        'id': sid,
        'description': str(raw.get('description') or '').strip(),
        'host': host,
        'port': port,
        'username': username,
        'password_enc': password_enc,
        'folders': folders,
        'enabled': bool(enabled),
    }


def _public_server(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': row['id'],
        'description': row.get('description') or '',
        'host': row.get('host') or '',
        'port': int(row.get('port') or 993),
        'username': row.get('username') or '',
        'folders': row.get('folders') or 'INBOX',
        'enabled': bool(row.get('enabled', True)),
    }


def _load_imap_servers_raw() -> list[dict[str, Any]]:
    data = get_email_review_settings()
    rows: list[dict[str, Any]] = []
    for item in data.get('imap_servers') or []:
        normalized = _normalize_imap_server(item)
        if normalized and not any(x['id'] == normalized['id'] for x in rows):
            rows.append(normalized)
    return rows


def _save_imap_servers_raw(servers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    data = get_email_review_settings()
    data['imap_servers'] = servers
    _persist_settings(data)
    return servers


def _next_imap_id(servers: list[dict[str, Any]]) -> int:
    if not servers:
        return 1
    return max(int(s['id']) for s in servers) + 1


def list_recarga_imap_servers() -> list[dict[str, Any]]:
    return [_public_server(s) for s in _load_imap_servers_raw()]


def get_recarga_imap_server(server_id: int) -> dict[str, Any] | None:
    for row in _load_imap_servers_raw():
        if int(row['id']) == int(server_id):
            return row
    return None


def get_enabled_recarga_imap_adapters() -> list[RecargaIMAPAdapter]:
    out: list[RecargaIMAPAdapter] = []
    for row in _load_imap_servers_raw():
        if not row.get('enabled', True):
            continue
        out.append(
            RecargaIMAPAdapter(
                id=int(row['id']),
                host=row['host'],
                port=int(row.get('port') or 993),
                username=row['username'],
                password_enc=row['password_enc'],
                folders=row.get('folders') or 'INBOX',
                enabled=True,
                description=row.get('description') or '',
            )
        )
    return out


def get_reachable_recarga_imap_adapters() -> list[RecargaIMAPAdapter]:
    """Servidores IMAP encendidos que responden (login OK). Omite los dañados."""
    reachable: list[RecargaIMAPAdapter] = []
    for adapter in get_enabled_recarga_imap_adapters():
        try:
            password = decrypt_password(adapter.password_enc)
        except Exception:
            continue
        ok, _ = _test_imap_credentials(
            adapter.host,
            int(adapter.port or 993),
            adapter.username,
            password,
        )
        if ok:
            reachable.append(adapter)
    return reachable


def get_recarga_imap_adapters(server_ids: list[int]) -> list[RecargaIMAPAdapter]:
    ids = {int(x) for x in server_ids if str(x).strip().isdigit() or isinstance(x, int)}
    out: list[RecargaIMAPAdapter] = []
    for row in _load_imap_servers_raw():
        if row['id'] not in ids or not row.get('enabled', True):
            continue
        out.append(
            RecargaIMAPAdapter(
                id=int(row['id']),
                host=row['host'],
                port=int(row.get('port') or 993),
                username=row['username'],
                password_enc=row['password_enc'],
                folders=row.get('folders') or 'INBOX',
                enabled=bool(row.get('enabled', True)),
                description=row.get('description') or '',
            )
        )
    return out


def create_recarga_imap_server(
    *,
    host: str,
    username: str,
    password: str,
    port: int = 993,
    folders: str = 'INBOX',
    description: str = '',
) -> dict[str, Any]:
    host = (host or '').strip()
    username = (username or '').strip()
    password = password or ''
    folders = (folders or 'INBOX').strip() or 'INBOX'
    description = (description or '').strip()
    if not host:
        raise ValueError('El host es obligatorio.')
    if not username:
        raise ValueError('El usuario es obligatorio.')
    if not password.strip():
        raise ValueError('La contraseña es obligatoria al crear el servidor.')
    try:
        port = int(port or 993)
    except (TypeError, ValueError):
        port = 993
    if port <= 0:
        port = 993

    servers = _load_imap_servers_raw()
    row = {
        'id': _next_imap_id(servers),
        'description': description,
        'host': host,
        'port': port,
        'username': username,
        'password_enc': encrypt_password(password),
        'folders': folders,
        'enabled': True,
    }
    servers.append(row)
    _save_imap_servers_raw(servers)
    return _public_server(row)


def update_recarga_imap_server(
    server_id: int,
    *,
    host: str,
    username: str,
    password: str = '',
    port: int = 993,
    folders: str = 'INBOX',
    description: str = '',
) -> dict[str, Any]:
    host = (host or '').strip()
    username = (username or '').strip()
    folders = (folders or 'INBOX').strip() or 'INBOX'
    description = (description or '').strip()
    if not host:
        raise ValueError('El host es obligatorio.')
    if not username:
        raise ValueError('El usuario es obligatorio.')
    try:
        port = int(port or 993)
    except (TypeError, ValueError):
        port = 993
    if port <= 0:
        port = 993

    servers = _load_imap_servers_raw()
    found = None
    for row in servers:
        if int(row['id']) == int(server_id):
            row['host'] = host
            row['username'] = username
            row['port'] = port
            row['folders'] = folders
            row['description'] = description
            if (password or '').strip():
                row['password_enc'] = encrypt_password(password)
            found = row
            break
    if not found:
        raise ValueError('Servidor IMAP no encontrado.')
    _save_imap_servers_raw(servers)
    return _public_server(found)


def delete_recarga_imap_server(server_id: int) -> bool:
    servers = _load_imap_servers_raw()
    new_servers = [s for s in servers if int(s['id']) != int(server_id)]
    if len(new_servers) == len(servers):
        return False
    _save_imap_servers_raw(new_servers)
    return True


def set_recarga_imap_enabled(server_id: int, enabled: bool) -> dict[str, Any]:
    servers = _load_imap_servers_raw()
    found = None
    for row in servers:
        if int(row['id']) == int(server_id):
            row['enabled'] = bool(enabled)
            found = row
            break
    if not found:
        raise ValueError('Servidor IMAP no encontrado.')
    _save_imap_servers_raw(servers)
    return _public_server(found)


def _test_imap_credentials(host: str, port: int, username: str, password: str) -> tuple[bool, str]:
    context = ssl.create_default_context()
    try:
        with IMAPClient(host=host, port=port, ssl=True, ssl_context=context, timeout=10) as client:
            client.login(username, password)
        return True, 'Conexión y login exitosos.'
    except gaierror:
        return False, 'Servidor incorrecto.'
    except timeout:
        return False, 'Tiempo de espera agotado al conectar.'
    except ConnectionRefusedError:
        return False, 'Conexión rechazada por el servidor.'
    except imap_exceptions.LoginError:
        return False, 'Usuario o contraseña incorrectos.'
    except imap_exceptions.IMAPClientError as exc:
        return False, f'Error IMAP: {exc}'
    except SSLError as exc:
        return False, f'Error SSL: {exc}'
    except IMAP4.error as exc:
        return False, f'Error IMAP: {exc}'
    except Exception as exc:
        return False, f'Error inesperado: {exc}'


def test_recarga_imap_server(server_id: int) -> tuple[bool, str]:
    row = get_recarga_imap_server(server_id)
    if not row:
        return False, 'Servidor IMAP no encontrado.'
    try:
        password = decrypt_password(row['password_enc'])
    except Exception as exc:
        return False, f'Error al leer la contraseña guardada: {exc}'
    return _test_imap_credentials(
        row['host'],
        int(row.get('port') or 993),
        row['username'],
        password,
    )
