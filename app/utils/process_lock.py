# Bloqueo entre procesos (p. ej. workers Gunicorn) para un solo hilo de fondo por máquina.

import os


def try_acquire_process_lock(lock_path: str):
    """
    Intenta un lock exclusivo no bloqueante.
    Devuelve fd abierto si se obtuvo, None si otro proceso ya lo tiene,
    o -1 en entornos sin fcntl (desarrollo Windows).
    """
    try:
        import fcntl

        fd = os.open(lock_path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.write(fd, str(os.getpid()).encode())
        return fd
    except (ImportError, AttributeError, OSError, IOError):
        return -1


def process_lock_acquired(fd) -> bool:
    return fd is not None and fd != -1
