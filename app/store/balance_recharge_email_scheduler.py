# Verificación automática de recargas por correo (buzón + IMAP) con reintentos programados.

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Any

from app.extensions import db
from app.models import User
from app.store.balance_recharge_email_review import get_email_review_settings
from app.store.balance_recharge_email_verify import (
    _regex_entries_for_payment_method,
    dispose_matched_review_email,
    dumps_email_verify_result,
    email_verify_single_check_only,
    resolve_email_scan_plan,
    verify_recharge_by_email,
)
from app.store.balance_recharge_imap import get_reachable_recarga_imap_adapters
from app.store.models import BalanceRecharge

from app.store.balance_recharge_credit import EMAIL_VERIFY_AUTO_ADMIN_NOTE

_LEGACY_EMAIL_VERIFY_AUTO_ADMIN_NOTES = frozenset({
    'Verificado automáticamente por correo bancario.',
})

# Motivos de omisión que no deben mostrarse en el admin (no hay nada que revisar por correo).
_EMAIL_VERIFY_SILENT_SKIP_MARKERS = (
    'no hay regex con patrón activo',
    'no hay regex con patrón configurado',
)


def _email_verify_skip_should_hide(message: str) -> bool:
    low = (message or '').strip().lower()
    if not low:
        return False
    return any(marker in low for marker in _EMAIL_VERIFY_SILENT_SKIP_MARKERS)


def normalize_admin_note_display(note: str | None) -> str:
    """Texto corto para notas automáticas (incluye registros guardados con el texto largo)."""
    n = (note or '').strip()
    if not n:
        return ''
    if n in _LEGACY_EMAIL_VERIFY_AUTO_ADMIN_NOTES:
        return EMAIL_VERIFY_AUTO_ADMIN_NOTE
    return n


def admin_note_for_end_user(note: str | None) -> str:
    """Notas internas de verificación por correo no se muestran al usuario."""
    n = normalize_admin_note_display(note)
    if not n:
        return ''
    if n == EMAIL_VERIFY_AUTO_ADMIN_NOTE:
        return ''
    return n

logger = logging.getLogger(__name__)

EMAIL_VERIFY_POLL_SEC = 30
STAGGER_BETWEEN_CHECKS_SEC = 60
EMAIL_VERIFY_MAX_ATTEMPTS = 3
FIRST_DELAY_MINUTES = 1
SINGLE_CHECK_DELAY_SECONDS = 45
SECOND_DELAY_MINUTES = 10
THIRD_DELAY_MINUTES = 30
MAX_DUE_BATCH = 50
EMAIL_VERIFY_ACTIVE_STATUSES = ('pending', 'auto_credited', 'auto_accumulated')
EMAIL_VERIFY_PROVISIONAL_STATUSES = ('auto_credited', 'auto_accumulated')

_loop_started = {'started': False}
_loop_lock = threading.Lock()
_verify_run_lock = threading.Lock()


def _format_email_verify_next_at_colombia_12h(next_at: datetime) -> str:
    """Instante UTC guardado en BD → fecha/hora Colombia, formato 12 h con segundos."""
    from app.utils.timezone import utc_to_colombia

    co = utc_to_colombia(next_at)
    h12 = co.hour % 12 or 12
    am_pm = 'p.\u00a0m.' if co.hour >= 12 else 'a.\u00a0m.'
    return f'{co.day:02d}/{co.month:02d}/{co.year % 100:02d} {h12}:{co.strftime("%M:%S")} {am_pm}'


def email_verify_sources_available() -> bool:
    settings = get_email_review_settings()
    if bool(settings.get('buzon_enabled')):
        return True
    from app.store.balance_recharge_imap import get_reachable_recarga_imap_adapters

    return bool(get_reachable_recarga_imap_adapters())


def can_schedule_email_verify(recharge_row) -> bool:
    plan = resolve_email_scan_plan(recharge_row)
    if plan.get('skip'):
        return False
    pm_id = str(getattr(recharge_row, 'payment_method_id', '') or '').strip().lower()
    if not pm_id:
        return False
    if not _regex_entries_for_payment_method(pm_id):
        return False
    if not email_verify_sources_available():
        return False
    status = (recharge_row.status or '').lower()
    if status not in EMAIL_VERIFY_ACTIVE_STATUSES:
        return False
    if status in EMAIL_VERIFY_PROVISIONAL_STATUSES and recharge_row.admin_verified is not None:
        return False
    return True


def _compute_first_check_at(recharge_row) -> datetime:
    now = datetime.utcnow()
    if email_verify_single_check_only(recharge_row):
        return now + timedelta(seconds=SINGLE_CHECK_DELAY_SECONDS)
    created = recharge_row.created_at or now
    return created + timedelta(minutes=FIRST_DELAY_MINUTES)


def _compute_next_check_at(attempts_after_run: int) -> datetime:
    """Tras intento 1 → +10 min; tras intento 2 → +30 min (solo hay 3 intentos en total)."""
    now = datetime.utcnow()
    if attempts_after_run == 1:
        return now + timedelta(minutes=SECOND_DELAY_MINUTES)
    return now + timedelta(minutes=THIRD_DELAY_MINUTES)


def _email_verify_max_attempts_reached(recharge_row) -> bool:
    return int(recharge_row.email_verify_attempts or 0) >= EMAIL_VERIFY_MAX_ATTEMPTS


def _apply_failed_verify_schedule(recharge_row, attempts: int) -> None:
    """Programa el siguiente intento o deja la recarga en revisión manual."""
    if email_verify_single_check_only(recharge_row):
        recharge_row.email_verify_status = 'pending_admin'
        recharge_row.email_verify_next_at = None
        return
    if _email_verify_max_attempts_reached(recharge_row):
        recharge_row.email_verify_status = 'pending_admin'
        recharge_row.email_verify_next_at = None
        return
    recharge_row.email_verify_status = 'scheduled'
    recharge_row.email_verify_next_at = _compute_next_check_at(attempts)


def _email_verify_skip_reason(recharge_row) -> str:
    pm_id = str(getattr(recharge_row, 'payment_method_id', '') or '').strip()
    if not pm_id:
        return 'Falta medio de pago en la solicitud.'
    if not _regex_entries_for_payment_method(pm_id):
        return 'No hay regex con patrón activo para este medio de pago.'
    if not email_verify_sources_available():
        return 'Sin buzón activo ni IMAP operativo.'
    status = (recharge_row.status or '').lower()
    if status not in EMAIL_VERIFY_ACTIVE_STATUSES:
        return f'Estado «{status}» no admite verificación por correo.'
    if status in EMAIL_VERIFY_PROVISIONAL_STATUSES and recharge_row.admin_verified is not None:
        return 'La recarga ya fue revisada por un administrador.'
    return 'No se pudo programar la verificación por correo.'


def schedule_email_verification_for_recharge(recharge_row) -> bool:
    plan = resolve_email_scan_plan(recharge_row)
    if plan.get('skip'):
        recharge_row.email_verify_status = 'skipped'
        recharge_row.email_verify_attempts = 0
        recharge_row.email_verify_next_at = None
        recharge_row.email_verify_json = json.dumps(
            {
                'status': 'skipped',
                'message': plan.get('message'),
                'checked': False,
                'scan_plan': plan,
            },
            ensure_ascii=False,
        )
        return True

    if not can_schedule_email_verify(recharge_row):
        return False
    recharge_row.email_verify_status = 'scheduled'
    recharge_row.email_verify_attempts = 0
    recharge_row.email_verify_next_at = _compute_first_check_at(recharge_row)
    recharge_row.email_verify_json = None
    return True


def ensure_email_verification_scheduled(recharge_row) -> bool:
    """Programa verificación por correo o deja constancia del motivo si no aplica."""
    if schedule_email_verification_for_recharge(recharge_row):
        return True
    if recharge_row.email_verify_status:
        return False
    recharge_row.email_verify_status = 'skipped'
    recharge_row.email_verify_attempts = 0
    recharge_row.email_verify_next_at = None
    recharge_row.email_verify_json = json.dumps(
        {
            'status': 'skipped',
            'message': _email_verify_skip_reason(recharge_row),
            'checked': False,
        },
        ensure_ascii=False,
    )
    return False


def _notify_recharge_realtime(recharge_row, *, reason: str = 'email_verify') -> None:
    try:
        from app.store.balance_recharge_events import notify_from_recharge_row

        notify_from_recharge_row(recharge_row, reason=reason)
    except Exception:
        pass


def apply_email_match_to_recharge(recharge_row, result: dict[str, Any] | None = None) -> tuple[bool, str | None]:
    """Acredita o confirma la recarga cuando el correo bancario coincide (con bloqueo de fila)."""
    from app.store.balance_recharge_credit import try_email_match_finalize

    recharge_id = getattr(recharge_row, 'id', None)
    if not recharge_id:
        return False, None
    return try_email_match_finalize(int(recharge_id), result)


def process_email_verification_for_recharge(
    recharge_row,
    *,
    apply_match: bool = True,
    update_schedule: bool = True,
) -> dict[str, Any]:
    """Ejecuta una verificación y opcionalmente actualiza reintentos."""
    try:
        result = verify_recharge_by_email(recharge_row)
    except Exception as exc:
        logger.warning('Email verify falló recarga %s: %s', recharge_row.id, exc)
        error_result = {
            'status': 'error',
            'message': 'Error al consultar correos.',
            'checked': False,
        }
        recharge_row.email_verify_json = dumps_email_verify_result(error_result)
        if update_schedule:
            attempts = int(recharge_row.email_verify_attempts or 0) + 1
            recharge_row.email_verify_attempts = attempts
            _apply_failed_verify_schedule(recharge_row, attempts)
            db.session.commit()
            _notify_recharge_realtime(recharge_row, reason='email_verify_error')
        return error_result

    recharge_row.email_verify_json = dumps_email_verify_result(result)

    if result.get('status') == 'matched':
        match_sse_reason = None
        if apply_match:
            _applied, match_sse_reason = apply_email_match_to_recharge(recharge_row, result)
        elif update_schedule:
            recharge_row.email_verify_status = 'matched'
            recharge_row.email_verify_next_at = None
        disposed = dispose_matched_review_email(result.get('matched_mail_ref'))
        if disposed:
            result = dict(result)
            result['email_disposed'] = True
            result['message'] = (
                (result.get('message') or 'Correo bancario encontrado y coincide con la recarga.')
                + ' El aviso bancario fue eliminado del buzón.'
            )
            recharge_row.email_verify_json = dumps_email_verify_result(result)
        db.session.commit()
        if match_sse_reason:
            _notify_recharge_realtime(recharge_row, reason=match_sse_reason)
        elif not apply_match:
            _notify_recharge_realtime(recharge_row, reason='email_matched')
        return result

    if result.get('status') == 'skipped':
        recharge_row.email_verify_status = 'skipped'
        recharge_row.email_verify_next_at = None
        db.session.commit()
        _notify_recharge_realtime(recharge_row, reason='email_verify_skipped')
        return result

    if not update_schedule:
        db.session.commit()
        _notify_recharge_realtime(recharge_row, reason='email_verify_checked')
        return result

    if result.get('status') in ('no_regex', 'no_source'):
        recharge_row.email_verify_status = 'skipped'
        recharge_row.email_verify_next_at = None
        db.session.commit()
        _notify_recharge_realtime(recharge_row, reason='email_verify_skipped')
        return result

    attempts = int(recharge_row.email_verify_attempts or 0) + 1
    recharge_row.email_verify_attempts = attempts
    _apply_failed_verify_schedule(recharge_row, attempts)

    if recharge_row.email_verify_status == 'pending_admin':
        base_msg = result.get('message') or 'No se confirmó por correo.'
        if _email_verify_max_attempts_reached(recharge_row) and not email_verify_single_check_only(
            recharge_row
        ):
            result = dict(result)
            result['message'] = (
                f'{base_msg} Tras {EMAIL_VERIFY_MAX_ATTEMPTS} intentos automáticos '
                '(1 min, 10 min y 30 min) queda revisión manual.'
            )
            recharge_row.email_verify_json = dumps_email_verify_result(result)

    db.session.commit()
    _notify_recharge_realtime(recharge_row, reason='email_verify_progress')
    return result


def run_email_verification_serialized(
    recharge_row,
    *,
    apply_match: bool = True,
    update_schedule: bool = True,
    blocking: bool = True,
) -> dict[str, Any] | None:
    """Ejecuta una verificación con candado global (solo 1 consulta a la vez)."""
    acquired = _verify_run_lock.acquire(blocking=blocking)
    if not acquired:
        return None
    try:
        return process_email_verification_for_recharge(
            recharge_row,
            apply_match=apply_match,
            update_schedule=update_schedule,
        )
    finally:
        _verify_run_lock.release()


def _stagger_due_recharges(eligible: list[BalanceRecharge], now: datetime) -> None:
    """Si varias recargas vencen juntas, espacia las siguientes para no saturar IMAP/buzón."""
    for idx, row in enumerate(eligible):
        if idx == 0:
            continue
        row.email_verify_next_at = now + timedelta(seconds=STAGGER_BETWEEN_CHECKS_SEC * idx)


def _ensure_recharge_email_verify_schema() -> None:
    try:
        from app.store.routes import _ensure_balance_recharges_table

        _ensure_balance_recharges_table()
    except Exception as exc:
        logger.warning('No se pudo asegurar columnas email_verify en recargas: %s', exc)


def _repair_unscheduled_auto_recharges() -> int:
    """Recargas auto-acreditadas/acumuladas sin cola de correo (p. ej. fallo al guardar tras el submit)."""
    rows = (
        BalanceRecharge.query.filter(
            BalanceRecharge.status.in_(EMAIL_VERIFY_PROVISIONAL_STATUSES),
            BalanceRecharge.admin_verified.is_(None),
            db.or_(
                BalanceRecharge.email_verify_status.is_(None),
                BalanceRecharge.email_verify_status == '',
            ),
        )
        .order_by(BalanceRecharge.id.asc())
        .limit(25)
        .all()
    )
    if not rows:
        return 0
    fixed = 0
    for row in rows:
        if ensure_email_verification_scheduled(row):
            fixed += 1
    if fixed:
        db.session.commit()
    return fixed


def email_verify_can_reverify(recharge_row) -> bool:
    """True si el medio tiene al menos un regex de correo habilitado con patrón."""
    pm_id = str(getattr(recharge_row, 'payment_method_id', '') or '').strip().lower()
    if not pm_id:
        return False
    return bool(_regex_entries_for_payment_method(pm_id))


def _email_verify_payload_with_flags(data: dict[str, Any], recharge_row) -> dict[str, Any]:
    payload = dict(data)
    payload['can_reverify'] = email_verify_can_reverify(recharge_row)
    return payload


def email_verify_display_for_row(recharge_row) -> dict[str, Any] | None:
    """Payload para el admin aunque aún no se haya ejecutado la primera consulta."""
    raw = getattr(recharge_row, 'email_verify_json', None)
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                payload = _email_verify_payload_with_flags(data, recharge_row)
                if (
                    (payload.get('status') or '').strip().lower() == 'skipped'
                    and _email_verify_skip_should_hide(str(payload.get('message') or ''))
                ):
                    return None
                return payload
        except (json.JSONDecodeError, TypeError):
            pass

    status = (getattr(recharge_row, 'email_verify_status', None) or '').strip().lower()
    if not status:
        return None

    message = 'Estado de verificación por correo.'
    if status == 'scheduled':
        next_at = getattr(recharge_row, 'email_verify_next_at', None)
        if next_at:
            message = (
                'Verificación por correo programada; '
                f'próximo intento ~{_format_email_verify_next_at_colombia_12h(next_at)} (hora Colombia).'
            )
        else:
            message = 'Verificación por correo programada (en cola).'
    elif status == 'pending_admin':
        tail = (
            ' Revisión manual o Reverificar.'
            if email_verify_can_reverify(recharge_row)
            else ' Revisión manual.'
        )
        message = (
            'No se confirmó por correo tras los intentos automáticos '
            f'({EMAIL_VERIFY_MAX_ATTEMPTS} en total: 1 min, 10 min y 30 min).'
            + tail
        )
    elif status == 'skipped':
        if raw:
            try:
                skipped = json.loads(raw)
                if isinstance(skipped, dict) and skipped.get('message'):
                    message = str(skipped['message'])
            except (json.JSONDecodeError, TypeError):
                pass
        else:
            message = _email_verify_skip_reason(recharge_row)
    elif status == 'matched':
        message = 'Correo verificado (coincide con la recarga).'

    payload = _email_verify_payload_with_flags(
        {
            'status': status,
            'message': message,
            'checked': status in ('matched', 'partial', 'not_found', 'pending_admin'),
        },
        recharge_row,
    )
    if (
        (payload.get('status') or '').strip().lower() == 'skipped'
        and _email_verify_skip_should_hide(str(payload.get('message') or ''))
    ):
        return None
    return payload


def process_due_email_verifications() -> int:
    """Procesa como máximo 1 recarga por ciclo; el resto queda en cola espaciada."""
    _ensure_recharge_email_verify_schema()
    _repair_unscheduled_auto_recharges()
    now = datetime.utcnow()
    due_rows = (
        BalanceRecharge.query.filter(
            BalanceRecharge.email_verify_status == 'scheduled',
            BalanceRecharge.email_verify_next_at.isnot(None),
            BalanceRecharge.email_verify_next_at <= now,
            BalanceRecharge.status.in_(EMAIL_VERIFY_ACTIVE_STATUSES),
        )
        .order_by(BalanceRecharge.email_verify_next_at.asc(), BalanceRecharge.id.asc())
        .limit(MAX_DUE_BATCH)
        .all()
    )
    if not due_rows:
        return 0

    eligible: list[BalanceRecharge] = []
    for row in due_rows:
        if row.status in EMAIL_VERIFY_PROVISIONAL_STATUSES and row.admin_verified is not None:
            row.email_verify_status = 'skipped'
            row.email_verify_next_at = None
            continue
        eligible.append(row)

    if not eligible:
        db.session.commit()
        return 0

    if len(eligible) > 1:
        _stagger_due_recharges(eligible, now)
        db.session.commit()

    result = run_email_verification_serialized(
        eligible[0],
        apply_match=True,
        update_schedule=True,
        blocking=False,
    )
    if result is None:
        eligible[0].email_verify_next_at = now + timedelta(seconds=STAGGER_BETWEEN_CHECKS_SEC)
        db.session.commit()
        return 0
    return 1


def _email_verify_loop(app) -> None:
    while True:
        try:
            with app.app_context():
                process_due_email_verifications()
        except Exception as exc:
            logger.exception('Error en loop de verificación email recargas: %s', exc)
            try:
                with app.app_context():
                    db.session.rollback()
            except Exception:
                pass
        time.sleep(EMAIL_VERIFY_POLL_SEC)


def start_balance_recharge_email_verify_loop(app) -> None:
    with _loop_lock:
        if _loop_started['started']:
            return
        _loop_started['started'] = True
    thread = threading.Thread(
        target=_email_verify_loop,
        args=(app,),
        daemon=True,
        name='balance-recharge-email-verify',
    )
    thread.start()
