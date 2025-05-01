# app/imap/advanced_imap.py
import gevent
from gevent.pool import Pool
from gevent.lock import BoundedSemaphore
import ssl
from imapclient import exceptions as imap_exceptions

CONNECTION_LIMIT = 5  # Máx. conexiones IMAP simultáneas
CONNECTION_LOCK = BoundedSemaphore(value=CONNECTION_LIMIT)

def search_in_all_servers(app, to_address, servers, limit_days=2):
    """
    Realiza la búsqueda en paralelo (gevent) sobre cada servidor IMAP.
    - limit_days=2 => busca correos de los últimos 2 días.
    - limit_days=None => sin límite.
    Usa un BoundedSemaphore para no exceder X conexiones simultáneas.
    Si detecta error "Too many simultaneous connections", hace sleep(2) y reintenta.
    """
    if not servers:
        return []

    pool_size = app.config.get("GEVENT_POOL_SIZE", 5)
    pool = Pool(min(len(servers), pool_size))

    def worker(server):
        from flask import current_app
        from app.services.imap_service import search_imap_with_days
        import gevent

        attempts = 2
        while attempts > 0:
            with app.app_context():
                try:
                    with CONNECTION_LOCK:
                        return search_imap_with_days(server, to_address, limit_days)
                except imap_exceptions.IMAPClientError as e:
                    if "Too many simultaneous connections" in str(e):
                        current_app.logger.warning(
                            f"[IMAP concurrency error] => {server.host}: {e}, reintentando..."
                        )
                        gevent.sleep(2)
                        attempts -= 1
                        continue
                    else:
                        current_app.logger.error(f"[ERROR hilo IMAP] => {server.host} => {e}")
                        return []
                except Exception as ex:
                    current_app.logger.error(f"[ERROR hilo IMAP] => {server.host} => {ex}")
                    return []
        return []

    jobs = [pool.spawn(worker, srv) for srv in servers]
    gevent.joinall(jobs)

    results = []
    for job in jobs:
        if job.value:
            results.extend(job.value)
    return results
