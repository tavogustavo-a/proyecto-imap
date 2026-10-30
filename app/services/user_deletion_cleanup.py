# Limpieza de archivos en disco antes de borrar usuarios en BD (CASCADE no borra ficheros).

import logging
from typing import Iterable, List, Union

logger = logging.getLogger(__name__)


def _normalize_user_ids(user_ids: Union[int, Iterable[int], None]) -> List[int]:
    if user_ids is None:
        return []
    if isinstance(user_ids, int):
        return [int(user_ids)]
    out = []
    for x in user_ids:
        try:
            i = int(x)
            if i not in out:
                out.append(i)
        except (TypeError, ValueError):
            continue
    return out


def cleanup_disk_assets_for_user_ids(app, user_ids: Union[int, Iterable[int], None]) -> dict:
    """
    Borra adjuntos de chat y comprobantes de recarga ligados a user_id
    ANTES de db.session.delete(user) o User.query.delete().
    """
    ids = _normalize_user_ids(user_ids)
    if not ids:
        return {'chat_files': 0, 'recharge_files': 0}

    chat_files = 0
    recharge_files = 0
    try:
        from app.models.chat import ChatMessage
        from app.store.balance_recharge_cleanup import delete_proof_files_for_user_ids

        for uid in ids:
            chat_files += ChatMessage.delete_attachment_files_for_user(uid) or 0
        recharge_files = delete_proof_files_for_user_ids(app, ids) or 0
    except Exception as exc:
        logger.exception('Error limpiando archivos de usuario(s) %s: %s', ids, exc)

    return {'chat_files': chat_files, 'recharge_files': recharge_files}


def release_refunds_blocking_user_delete(user_ids: Union[int, Iterable[int], None]) -> int:
    """Quita las devoluciones que impedirían borrar al usuario.

    Las del cliente se borran con él. Si solo figura como quien registró la
    devolución, el comprobante se conserva y queda a nombre del admin.
    """
    ids = _normalize_user_ids(user_ids)
    if not ids:
        return 0
    from sqlalchemy import or_

    from app.models.user import User
    from app.store.models import LicenseAccountRefund

    removed = LicenseAccountRefund.query.filter(
        or_(
            LicenseAccountRefund.user_id.in_(ids),
            LicenseAccountRefund.billing_user_id.in_(ids),
        )
    ).delete(synchronize_session=False)
    actors = LicenseAccountRefund.query.filter(
        LicenseAccountRefund.actor_admin_user_id.in_(ids)
    ).all()
    if not actors:
        return int(removed or 0)
    from flask import current_app

    admin_username = current_app.config.get('ADMIN_USER', 'admin')
    keeper = User.query.filter(
        User.username == admin_username,
        ~User.id.in_(ids),
    ).first()
    if keeper is None:
        removed += LicenseAccountRefund.query.filter(
            LicenseAccountRefund.actor_admin_user_id.in_(ids)
        ).delete(synchronize_session=False)
        return int(removed or 0)
    for row in actors:
        row.actor_admin_user_id = int(keeper.id)
    return int(removed or 0)


def prepare_users_for_deletion(app, user_ids: Union[int, Iterable[int], None]) -> dict:
    """Archivos, sesión, Telegram y devoluciones, antes de borrar los usuarios."""
    ids = _normalize_user_ids(user_ids)
    stats = cleanup_disk_assets_for_user_ids(app, ids)
    if not ids:
        stats['refunds_removed'] = 0
        return stats
    from app.auth.session_tokens import revoke_all_user_tokens
    from app.models.user import User

    for uid in ids:
        try:
            revoke_all_user_tokens(uid)
        except Exception:
            logger.exception('No se pudo cerrar la sesión del usuario %s', uid)
    try:
        from app.store.drive_telegram_send import remove_chat_from_telegram_groups

        rows = User.query.filter(User.id.in_(ids)).all()
        for user in rows:
            remove_chat_from_telegram_groups(getattr(user, 'telegram_chat_id', None))
    except Exception:
        logger.exception('No se pudo sacar de Telegram a %s', ids)
    try:
        stats['refunds_removed'] = release_refunds_blocking_user_delete(ids)
    except Exception:
        logger.exception('No se pudieron liberar devoluciones de %s', ids)
        stats['refunds_removed'] = 0
    try:
        from app.extensions import db
        from app.store.models import (
            apiinfo_users,
            htmlinfo_users,
            toolinfo_users,
            youtube_listing_users,
        )

        for table in (toolinfo_users, htmlinfo_users, youtube_listing_users, apiinfo_users):
            db.session.execute(table.delete().where(table.c.user_id.in_(ids)))
        from app.models.user import (
            AllowedEmail,
            parent_default_filter,
            parent_default_regex,
            user_filter,
            user_regex,
            user_service,
        )

        db.session.execute(user_service.delete().where(user_service.c.user_id.in_(ids)))
        db.session.execute(user_regex.delete().where(user_regex.c.user_id.in_(ids)))
        db.session.execute(user_filter.delete().where(user_filter.c.user_id.in_(ids)))
        db.session.execute(
            parent_default_regex.delete().where(parent_default_regex.c.parent_user_id.in_(ids))
        )
        db.session.execute(
            parent_default_filter.delete().where(parent_default_filter.c.parent_user_id.in_(ids))
        )
        AllowedEmail.query.filter(AllowedEmail.user_id.in_(ids)).delete(synchronize_session=False)
    except Exception:
        logger.exception('No se pudieron soltar herramientas, correos o permisos de %s', ids)
    try:
        from app.extensions import db
        from app.models.imap2 import imap2_users
        from app.store.models import role_users, worksheet_permission_users

        db.session.execute(imap2_users.delete().where(imap2_users.c.user_id.in_(ids)))
        db.session.execute(
            worksheet_permission_users.delete().where(
                worksheet_permission_users.c.user_id.in_(ids)
            )
        )
        db.session.execute(role_users.delete().where(role_users.c.user_id.in_(ids)))
        from app.store.api import close_worksheet_shares_without_users

        close_worksheet_shares_without_users()
    except Exception:
        logger.exception('No se pudieron soltar IMAP2, hojas o roles de %s', ids)
    try:
        from app.extensions import db
        from app.models.trigger_log import TriggerLog
        from app.models.user import RememberDevice

        RememberDevice.query.filter(RememberDevice.user_id.in_(ids)).delete(synchronize_session=False)
        TriggerLog.query.filter(TriggerLog.user_id.in_(ids)).delete(synchronize_session=False)
    except Exception:
        logger.exception('No se pudieron borrar dispositivos o logs de %s', ids)
    try:
        from app.extensions import db
        from app.models.user import LinkedProject
        from app.store.models import MobilePushToken, StoreUserNotification

        LinkedProject.query.filter(LinkedProject.user_id.in_(ids)).delete(synchronize_session=False)
        StoreUserNotification.query.filter(StoreUserNotification.user_id.in_(ids)).delete(
            synchronize_session=False
        )
        MobilePushToken.query.filter(MobilePushToken.user_id.in_(ids)).delete(synchronize_session=False)
    except Exception:
        logger.exception('No se pudieron borrar proyectos, avisos o tokens de %s', ids)
    try:
        from app.store.partner_api import drop_partner_ips_for_user_ids

        drop_partner_ips_for_user_ids(ids)
    except Exception:
        logger.exception('No se pudieron quitar las IPs de API de %s', ids)
    try:
        from app.store.models import CustomerRenewalNotifyBatch, LicenseReportAnswerEmailBatch

        CustomerRenewalNotifyBatch.query.filter(
            CustomerRenewalNotifyBatch.user_id.in_(ids)
        ).delete(synchronize_session=False)
        LicenseReportAnswerEmailBatch.query.filter(
            LicenseReportAnswerEmailBatch.user_id.in_(ids)
        ).delete(synchronize_session=False)
    except Exception:
        logger.exception('No se pudieron borrar las colas de correo de %s', ids)
    try:
        from app.store.customer_account_renewals import release_customer_renewal_orders_for_user_ids

        release_customer_renewal_orders_for_user_ids(ids)
    except Exception:
        logger.exception('No se pudieron borrar los pedidos de renovación de %s', ids)
    try:
        from app.store.product_reservations import release_product_reservations_for_user_ids

        release_product_reservations_for_user_ids(ids)
    except Exception:
        logger.exception('No se pudieron soltar las reservas de %s', ids)
    try:
        _release_delivered_account_buyers(ids)
    except Exception:
        logger.exception('No se pudo soltar el comprador de las cuentas entregadas de %s', ids)
    try:
        from app.store.models import (
            BalanceRecharge,
            BalanceRechargeHistorialSnapshot,
            CouponRedemption,
            Sale,
            SalePurchaseSnapshot,
        )

        SalePurchaseSnapshot.query.filter(
            SalePurchaseSnapshot.user_id.in_(ids)
        ).delete(synchronize_session=False)
        BalanceRechargeHistorialSnapshot.query.filter(
            BalanceRechargeHistorialSnapshot.user_id.in_(ids)
        ).delete(synchronize_session=False)
        CouponRedemption.query.filter(
            CouponRedemption.user_id.in_(ids)
        ).delete(synchronize_session=False)
        Sale.query.filter(Sale.user_id.in_(ids)).delete(synchronize_session=False)
        BalanceRecharge.query.filter(BalanceRecharge.user_id.in_(ids)).delete(
            synchronize_session=False
        )
    except Exception:
        logger.exception('No se pudo borrar el historial de compras o recargas de %s', ids)
    return stats


def _release_delivered_account_buyers(user_ids: List[int]) -> None:
    """La cuenta sigue en inventario. Se quita el nombre del comprador que se borra."""
    import json

    from sqlalchemy.orm.attributes import flag_modified

    from app.extensions import db
    from app.models.user import User
    from app.store.models import License, LicenseAccount, Sale
    from app.store.user_license_line_parse import LICENSE_LINE_FIELD_SEP

    names = set()
    for user in User.query.filter(User.id.in_(user_ids)).all():
        uname = (getattr(user, 'username', None) or '').strip().lower()
        if uname:
            names.add(uname)

    accounts = LicenseAccount.query.filter(
        LicenseAccount.assigned_to_user_id.in_(user_ids)
    ).all()
    for acc in accounts:
        acc.assigned_to_user_id = None
        acc.client_notes = None

    sale_ids = [
        row[0]
        for row in db.session.query(Sale.id).filter(Sale.user_id.in_(user_ids)).all()
    ]
    if sale_ids:
        for acc in LicenseAccount.query.filter(LicenseAccount.sale_id.in_(sale_ids)).all():
            acc.sale_id = None

    def _blank_buyer(text):
        if not text or not names or LICENSE_LINE_FIELD_SEP not in text:
            return text, False
        changed = False
        lines = []
        for line in str(text).replace('\r\n', '\n').split('\n'):
            if LICENSE_LINE_FIELD_SEP not in line:
                lines.append(line)
                continue
            parts = line.split(LICENSE_LINE_FIELD_SEP)
            if len(parts) > 1 and parts[1].strip().lower() in names:
                parts[1] = 'anonimo'
                line = LICENSE_LINE_FIELD_SEP.join(parts)
                changed = True
            lines.append(line)
        return '\n'.join(lines), changed

    text_fields = (
        'license_notes',
        'changes_notes',
        'suspended_notes',
        'expired_notes',
        'customer_renewal_notes',
    )
    licenses = License.query.all()
    id_keys = {str(i) for i in user_ids}
    for lic in licenses:
        lic_changed = False
        for field in text_fields:
            updated, changed = _blank_buyer(getattr(lic, field, None))
            if changed:
                setattr(lic, field, updated)
                lic_changed = True
        raw_days = getattr(lic, 'day_notepads_json', None)
        if raw_days and names:
            try:
                days = json.loads(raw_days)
            except (json.JSONDecodeError, TypeError):
                days = None
            if isinstance(days, dict):
                days_changed = False
                for key, value in list(days.items()):
                    if not isinstance(value, str):
                        continue
                    updated, changed = _blank_buyer(value)
                    if changed:
                        days[key] = updated
                        days_changed = True
                if days_changed:
                    lic.day_notepads_json = json.dumps(days, ensure_ascii=False)
                    lic_changed = True
        raw_portal = getattr(lic, 'portal_day_row_notes_json', None)
        if raw_portal:
            try:
                blob = json.loads(raw_portal)
            except (json.JSONDecodeError, TypeError):
                blob = None
            if isinstance(blob, dict) and any(key in blob for key in id_keys):
                for key in id_keys:
                    blob.pop(key, None)
                lic.portal_day_row_notes_json = (
                    json.dumps(blob, ensure_ascii=False) if blob else None
                )
                lic_changed = True
        if lic_changed:
            flag_modified(lic, 'license_notes')
            flag_modified(lic, 'day_notepads_json')
            flag_modified(lic, 'portal_day_row_notes_json')
