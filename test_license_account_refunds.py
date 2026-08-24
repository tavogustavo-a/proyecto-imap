# -*- coding: utf-8 -*-
"""Pruebas unitarias del cálculo y presentación de devoluciones de licencias."""
import unittest
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

from app.store.license_account_refunds import (
    RefundError,
    _clean_custom_message,
    _refund_period,
    _strict_charged_days,
    calculate_prorated_refund,
)
from app.store.whatsapp_daily_sales import (
    _format_refund_summary_lines,
    _refund_row_to_event,
    _refund_total_for_currency,
)


class LicenseAccountRefundTests(unittest.TestCase):
    def test_prorates_usd_from_historical_unit_price(self):
        self.assertEqual(calculate_prorated_refund('30.00', 10), Decimal('20.00'))

    def test_prorates_cop_and_rounds_to_currency_precision(self):
        self.assertEqual(
            calculate_prorated_refund(Decimal('10000') / Decimal('3'), 15),
            Decimal('1666.67'),
        )

    def test_day_boundaries_and_invalid_values(self):
        self.assertEqual(calculate_prorated_refund('12.50', 0), Decimal('12.50'))
        self.assertEqual(calculate_prorated_refund('12.50', 30), Decimal('0.00'))
        for value in (-1, 31, '2.5', True, None):
            with self.assertRaises(RefundError):
                _strict_charged_days(value)

    def test_prorates_multi_month_license_over_its_full_term(self):
        self.assertEqual(
            calculate_prorated_refund('90.00', 5, 90),
            Decimal('85.00'),
        )
        self.assertEqual(_strict_charged_days(45, 90), 45)
        with self.assertRaises(RefundError):
            _strict_charged_days(91, 90)

    def test_detects_used_days_in_current_renewed_period(self):
        now = datetime(2026, 7, 30, 17, 0, 0)
        account = SimpleNamespace(
            assigned_at=now - timedelta(days=65),
            expires_at=now + timedelta(days=25),
            license=SimpleNamespace(license_term_days=30),
        )
        period = _refund_period(account, now)
        self.assertEqual(period['total_days'], 30)
        self.assertEqual(period['detected_charged_days'], 5)

    def test_detects_used_days_for_multi_month_license(self):
        now = datetime(2026, 7, 30, 17, 0, 0)
        account = SimpleNamespace(
            assigned_at=now - timedelta(days=5),
            expires_at=now + timedelta(days=85),
            license=SimpleNamespace(license_term_days=90),
        )
        period = _refund_period(account, now)
        self.assertEqual(period['total_days'], 90)
        self.assertEqual(period['detected_charged_days'], 5)

    def test_future_day_bloc_is_understood_as_previous_month(self):
        now = datetime(2026, 7, 5, 17, 0, 0)
        assigned = datetime(2026, 7, 28, 17, 0, 0)
        account = SimpleNamespace(
            assigned_at=assigned,
            expires_at=assigned + timedelta(days=90),
            license=SimpleNamespace(license_term_days=90),
        )
        period = _refund_period(account, now)
        self.assertEqual(period['period_started_at'].date(), datetime(2026, 6, 28).date())
        self.assertEqual(period['detected_charged_days'], 7)

    def test_custom_message_is_trimmed_and_limited(self):
        self.assertEqual(_clean_custom_message('  Mensaje\r\ncliente  '), 'Mensaje\ncliente')
        with self.assertRaises(RefundError):
            _clean_custom_message('x' * 2001)

    def test_manual_delivery_stamped_price_is_used_as_historical(self):
        from app.store.license_account_refunds import _manual_delivery_price

        account = SimpleNamespace(
            id=11,
            sold_unit_price='15.00',
            sold_currency='USD',
            license=None,
        )
        event = _manual_delivery_price(account, billing_user=SimpleNamespace())
        self.assertTrue(event['available'])
        self.assertEqual(event['source'], 'manual_delivery')
        self.assertEqual(event['unit_price'], Decimal('15.000000'))
        self.assertEqual(event['currency'], 'USD')

    def test_manual_delivery_is_stamped_and_can_refresh_after_renewal(self):
        from app.store.routes_licencias import _stamp_license_account_sold_price

        product = SimpleNamespace(id=8, price_cop=30000, price_usd=10)
        license_row = SimpleNamespace(product=product, product_id=8)
        billing = SimpleNamespace(
            user_prices={
                'tipo_precio': 'COP',
                'descuentos_productos': {'8': {'cop': 5000}},
            }
        )
        account = SimpleNamespace(
            sale_id=None,
            sold_unit_price=None,
            sold_currency=None,
            assigned_to_user_id=3,
            license=license_row,
        )
        self.assertTrue(
            _stamp_license_account_sold_price(account, license_row, billing)
        )
        self.assertEqual(account.sold_unit_price, 25000)
        self.assertEqual(account.sold_currency, 'COP')

        product.price_cop = 32000
        self.assertFalse(
            _stamp_license_account_sold_price(account, license_row, billing)
        )
        self.assertTrue(
            _stamp_license_account_sold_price(
                account,
                license_row,
                billing,
                force=True,
            )
        )
        self.assertEqual(account.sold_unit_price, 27000)

    def test_actual_model_field_names_are_normalized_for_daily_summary(self):
        row = SimpleNamespace(
            id=7,
            user_id=2,
            billing_user_id=1,
            license_id=4,
            license_account_id=9,
            sale_id=3,
            product_name='Netflix',
            charged_days=10,
            returned_days=20,
            historical_unit_price=30,
            refund_amount=20,
            prepaid_applied=5,
            debt_applied=15,
            currency='USD',
            custom_message='Listo',
            created_at=None,
        )
        event = _refund_row_to_event(row)
        self.assertEqual(event['refunded_days'], 20)
        self.assertEqual(event['account_id'], 9)
        self.assertEqual(event['unit_price'], 30)
        self.assertEqual(
            _format_refund_summary_lines([event]),
            ['Devolución de 20 días · $20 USD'],
        )
        self.assertEqual(_refund_total_for_currency([event], 'USD'), 5)
        self.assertEqual(_refund_total_for_currency([event], 'COP'), 0)

    def test_manual_day_override_is_visible_in_daily_summary(self):
        row = SimpleNamespace(
            id=8,
            user_id=2,
            billing_user_id=2,
            license_id=4,
            license_account_id=10,
            sale_id=None,
            product_name='Netflix',
            billing_period_days=90,
            detected_charged_days=5,
            charged_days=8,
            charged_days_overridden=True,
            returned_days=82,
            historical_unit_price=90,
            refund_amount=82,
            prepaid_applied=82,
            debt_applied=0,
            currency='USD',
            custom_message='',
            created_at=None,
        )
        event = _refund_row_to_event(row)
        self.assertTrue(event['charged_days_overridden'])
        self.assertEqual(
            _format_refund_summary_lines([event]),
            ['Devolución de 82 días · $82 USD · ajuste manual: 5 → 8 días cobrados'],
        )


if __name__ == '__main__':
    unittest.main()
