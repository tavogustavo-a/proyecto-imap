# -*- coding: utf-8 -*-
"""
Compatibilidad: la lógica de vencidas y renovación por día está en license_day_renewal_job.
"""
from app.store.license_day_renewal_job import (  # noqa: F401
    sync_expired_accounts_by_renewal_policy,
    sync_month_to_month_expired_accounts_to_changes,
)
