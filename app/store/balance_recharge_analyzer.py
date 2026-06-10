# app/store/balance_recharge_analyzer.py
"""Análisis automático de comprobantes de recarga (OCR + patrones extensibles)."""

from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from datetime import date, datetime, time
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from app.extensions import db
from app.store.models import BalanceRecharge, StoreSetting

SETTING_KEY = 'balance_recharge_analyzer_patterns'

# Ventana para acreditar automático: comprobante hasta N días antes del envío (pago ayer, carga hoy).
RECHARGE_UPLOAD_DATE_MAX_DAYS_BEFORE = 5
RECHARGE_UPLOAD_DATE_MAX_DAYS_AFTER = 1

_SPANISH_MONTHS = {
    'ene': 1, 'enero': 1,
    'feb': 2, 'febrero': 2,
    'mar': 3, 'marzo': 3,
    'abr': 4, 'abril': 4,
    'may': 5, 'mayo': 5,
    'jun': 6, 'junio': 6,
    'jul': 7, 'julio': 7,
    'ago': 8, 'agosto': 8,
    'sep': 9, 'sept': 9, 'septiembre': 9,
    'oct': 10, 'octubre': 10,
    'nov': 11, 'noviembre': 11,
    'dic': 12, 'diciembre': 12,
}

# Patrones basados en comprobantes reales; el admin puede ampliarlos vía API.
DEFAULT_PATTERNS: list[dict[str, Any]] = [
    {
        'id': 'bancolombia_app_transfer',
        'label': 'App Bancolombia — Transferencia exitosa',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['bancolombia'],
        'text_must_contain': ['transferencia exitosa', 'comprobante'],
        'amount_regexes': [
            r'(?:valor de la transferencia)[^\$]{0,80}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
            r'(?:valor|monto|transferencia)[^\d]{0,25}(\d{4,9})',
        ],
        'receipt_regexes': [
            r'comprobante\s*no\.?\s*(\d{6,12})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
            r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
        ],
        'account_regexes': [
            r'(?:producto\s+destino|cuenta\s+destino|destino|ahorros)[^\d]{0,100}'
            r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
            r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
            r'\b(\d{11})\b',
        ],
    },
    {
        'id': 'bancolombia_app_transfer_exitosa',
        'label': 'App Bancolombia — Transferencia exitosa (secciones)',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['bancolombia'],
        'text_must_contain': [],
        'amount_regexes': [
            r'(?:valor\s+de\s+la\s+transferencia)[^\$]{0,80}\$\s*([\d][\d.\s,]*)',
            r'(?:datos\s+de\s+la\s+transferencia)[\s\S]{0,120}?\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'comprobante\s*no\.?\s*:?\s*([A-Za-z0-9]{6,14})\b',
            r'comprobante\s*no\.?\s*:?\s*(\d{6,14})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})\s*[-–—]?\s*'
            r'(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
        ],
        'account_regexes': [
            r'producto\s+destino[\s\S]{0,220}?ahorros[\s\S]{0,90}?'
            r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
            r'producto\s+destino[\s\S]{0,220}?(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
            r'(?:producto\s+destino|ahorros)[^\d]{0,120}(\d{11})\b',
        ],
    },
    {
        'id': 'bancolombia_to_nequi',
        'label': 'App Bancolombia — Transferencia a Nequi',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['nequi'],
        'text_must_contain': ['transferencia exitosa', 'comprobante'],
        'amount_regexes': [
            r'(?:datos\s+de\s+la\s+transferencia)[\s\S]{0,160}?\$\s*([\d][\d.\s,]*)',
            r'(?:valor\s+de\s+la\s+transferencia)[^\$]{0,80}\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'comprobante\s*no\.?\s*([A-Za-z0-9]{8,12})\b',
            r'comprobante\s*no\.?\s*(\d{6,12})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})\s*[-–—]?\s*'
            r'(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
        ],
        'account_regexes': [
            r'(?:producto\s+destino)[\s\S]{0,100}?nequi[\s\S]{0,60}?(\d{10})\b',
            r'(?:^|\n)\s*nequi\s*\n\s*(\d{10})\b',
        ],
    },
    {
        'id': 'bancolombia_email_notify',
        'label': 'Correo Bancolombia — Transferencia recibida',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['bancolombia'],
        'text_must_contain': ['bancolombia', 'recibiste una transferencia'],
        'amount_regexes': [
            r'(?:recibiste\s+una\s+transferencia\s+por)\s+\$\s*([\d][\d,.\s]*)',
            r'\$\s*([\d][\d,.\s]*)',
        ],
        'receipt_regexes': [],
        'date_regexes': [
            r'el\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+a\s+las',
        ],
        'time_regexes': [
            r'a\s+las\s+(\d{1,2}:\d{2})(?!\s*:\d)',
        ],
        'datetime_regexes': [
            r'el\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+a\s+las\s+(\d{1,2}:\d{2})',
        ],
        'account_regexes': [
            r'en\s+tu\s+cuenta\s*\*+(\d{2,4})',
            r'(?:en\s+tu\s+cuenta|cuenta)\s+\*+(\d{2,4})',
            r'conectada\s+a\s+la\s+llave\s+@?([a-z0-9]{4,32})',
        ],
    },
    {
        'id': 'kamin_breb_comprobante',
        'label': 'Kamin / Bre-B — Comprobante (envío a llave)',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['bre-b', 'breve', 'kamin', 'breb', 'bre_b'],
        'text_must_contain': ['kamin', 'comprobante'],
        'amount_regexes': [
            r'(?:^|\s)monto\s*\n?\s*\$?\s*([\d][\d.\s,]*)',
            r'monto[^\$\d]{0,60}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'(?:referencia)[^\w]{0,40}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
        ],
        'date_regexes': [
            r'(?:fecha\s+de\s+emisi[oó]n|data\s+y\s+hora\s+de\s+la\s+transacci[oó]n)\s*:\s*'
            r'(\d{1,2}/\d{1,2}/\d{4})',
            r'(\d{1,2}/\d{1,2}/\d{4})',
        ],
        'time_regexes': [
            r'(?:fecha\s+de\s+emisi[oó]n|data\s+y\s+hora)[^\d]{0,30}(\d{1,2}:\d{2})',
        ],
        'datetime_regexes': [
            r'(\d{1,2}/\d{1,2}/\d{4})\s+(\d{1,2}:\d{2})',
        ],
        'account_regexes': [
            r'(?:llave\s+bre-?\s*b|llave)\s*[:\s]*@?([a-z0-9]{4,32})',
        ],
    },
    {
        'id': 'nequi_comprobante_pago',
        'label': 'Nequi — Comprobante de pago',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['nequi'],
        'text_must_contain': ['nequi'],
        'amount_regexes': [
            r'(?:cu[aá]nto\??)[^\$\d]{0,50}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'(?:referencia)[\s\S]{0,50}?([Mm]\s*\d{7,10})',
            r'(?:referencia)[^\d]{0,25}(\d{6,14})',
            r'(?:comprobante|transaccion|transacción)\s*(?:no\.?|n[°o]\.?|#)?\s*(\d{6,14})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+\d{4})',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
            r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
            r'(\d{1,2}:\d{2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+\d{4})\s+'
            r'(?:a\s+las|alas)\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})\s+'
            r'(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
        ],
        'account_regexes': [
            r'(?:numero|n[uú]mero)\s+nequi[^\d]{0,50}(\d{3}\s*\d{3}\s*\d{4})',
        ],
    },
    {
        'id': 'nequi_corresponsal_redeban',
        'label': 'Nequi — Recarga en corresponsal Bancolombia (Redeban)',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['nequi'],
        'text_must_contain': ['recarga', 'nequ'],
        'amount_regexes': [
            r'(?:valor)[^\$\d\n]{0,40}\$\s*(\d{1,3}(?:\.\d{3})+)',
            r'(?:valor)[^\$\d\n]{0,40}\$\s*(\d{4,7})',
        ],
        'receipt_regexes': [
            r'(?:recib[cog]|recibo)\s*[:\s(]*(\d{5,8})',
            r'(?:rrn|rra)\s*[:\s]*(\d{5,8})',
            r'(?:apro|spro)\s*[:\s]*(\d{5,8})',
        ],
        'date_regexes': [
            r'((?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+\d{1,2}\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)',
        ],
        'datetime_regexes': [
            r'((?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+\d{1,2}\s+\d{4})\s+(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)',
        ],
        'account_regexes': [
            r'(?:producto)\s*[;:\s]*(\d{10})',
            r'(?:producto)[^\d]{0,20}(\d{3}\s*\d{3}\s*\d{4})',
        ],
    },
    {
        'id': 'nequi_envio_bancolombia',
        'label': 'Nequi — Envío a banco (Bancolombia)',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['bancolombia', 'nequi'],
        'text_must_contain': [],
        'amount_regexes': [
            r'(?:cu[aá]nto\??)[^\$\d]{0,50}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'(?:referencia|referen[cg][a-z]*|rela)[\s\S]{0,80}?([Mm]\s*\d{7,10})',
            r'(?:referencia|referen[cg][a-z]*|rela)[\s\S]{0,40}?(\d{7,10})\b',
            r'\b([Mm]\d{7,10})\b',
            r'(?:referencia)[^\d]{0,25}(\d{6,14})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+\d{4})',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+\d{4})\s+'
            r'(?:a\s+las|alas)\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
        ],
        'account_regexes': [
            r'(?:numero\s+de\s+cuenta|n[uú]mero\s+de\s+cuenta)[^\d]{0,60}(\d{10,12})',
            r'(?:banco)[^\d]{0,100}(\d{10,12})',
            r'(?<!\d)(\d{11})(?!\d)',
        ],
    },
    {
        'id': 'nequi_llave_bancolombia',
        'label': 'Nequi — Envío por llave Bre-B a Bancolombia',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': [
            'bre-b', 'breve', 'breb', 'bre_b', 'bancolombia', 'nequi',
        ],
        'text_must_contain': [],
        'amount_regexes': [
            r'(?:cu[aá]nto\??)[^\$\d]{0,50}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'(?:referencia|referen[cg][a-z]*|rela)[\s\S]{0,80}?([Mm]\s*\d{7,10})',
            r'(?:referencia|referen[cg][a-z]*|rela)[\s\S]{0,40}?(\d{7,10})\b',
            r'\b([Mm]\d{7,10})\b',
            r'(?:referencia)[^\d]{0,25}(\d{6,14})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+\d{4})',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+de\s+\d{4})\s+'
            r'(?:a\s+las|alas)\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
        ],
        'account_regexes': [
            r'(?:^|\n)\s*llave\s*[:\s]*@?([a-z][a-z0-9]{3,24})',
            r'(?:llave)\s*[:\s]*@?([a-z][a-z0-9]{3,24})',
            r'@([a-z][a-z0-9]{3,24})',
        ],
    },
    {
        'id': 'daviplata_app_transfer',
        'label': 'App DaviPlata — Transacción exitosa',
        'currencies': ['COP', 'USD'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['daviplata', 'davi plata'],
        'text_must_contain': ['daviplata', 'pasaste plata'],
        'amount_regexes': [
            r'(?:valor)[^\$\d]{0,50}\$\s*([\d][\d.\s,]*)',
            r'\$\s*([\d][\d.\s,]*)',
        ],
        'receipt_regexes': [
            r'(?:numero|ndmero|namero|n[uú]mero)\s+de\s+aprobaci[oó6n\w]{0,8}\s*[:\s]*(\d{4,12})',
            r'aprobaci[oó6n\w]{0,10}[^\d]{0,40}(\d{5,12})',
        ],
        'date_regexes': [
            r'((?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+\d{1,2}\s+(?:de\s+)?\d{4})',
            r'((?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+o[l1]de\s+\d{4})',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'((?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{1,2}\s+de\s+\d{4})\s*[-–—]\s*'
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})\s*[-–—]\s*'
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'account_regexes': [
            r'(?:pasaste\s+plata|otro\s+daviplata|plata\s+a)[^\d]{0,200}(\d{3}\s*\d{3}\s*\d{4})',
            r'(?:a\s+gustavo|patino|sanchez)[^\d]{0,120}(\d{3}\s*\d{3}\s*\d{4})',
        ],
    },
    {
        'id': 'daviplata_breb_comprobante',
        'label': 'DaviPlata — Pasaste plata por Bre-B (llave)',
        'currencies': ['COP', 'USD'],
        'payment_method_ids': [],
        'payment_method_label_keywords': [
            'bre-b', 'breve', 'kamin', 'breb', 'bre_b', 'daviplata', 'bancolombia',
        ],
        'text_must_contain': ['daviplata', 'bre'],
        'amount_regexes': [
            r'(?:valor)[^\$\d]{0,50}\$\s*(\d{1,3}(?:\.\d{3})+)(?:[.,]\d{2})?',
            r'(?:valor)[^\$\d]{0,50}\$\s*(\d{4,7})(?:[.,]\d{2})?',
            r'\$\s*(\d{1,3}(?:\.\d{3})+)(?:[.,]\d{2})?(?!\d)',
        ],
        'receipt_regexes': [
            r'(?:numero|ndmero|namero|n[uú]mero)\s+de\s+aprobaci[oó6n\w]{0,8}\s*[:\s]*(\d{4,12})',
            r'aprobaci[oó6n\w]{0,10}[^\d]{0,40}(\d{4,12})',
        ],
        'date_regexes': [
            r'((?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+\d{1,2}\s+de\s+\d{4})',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'((?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{1,2}\s+de\s+\d{4})\s*[-–—]\s*'
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'account_regexes': [
            r'(?:pasaste\s+plata|por\s+bre-?\s*b|entidad\s+destino)[^\d]{0,280}(\d{3}\s*\d{3}\s*\d{4})',
            r'@([a-z][a-z0-9]{3,24})',
        ],
    },
    {
        'id': 'breb_nequi_comprobante',
        'label': 'Bre-B Nequi — Banco de Bogotá / app (llave destino)',
        'currencies': ['COP'],
        'payment_method_ids': [],
        'payment_method_label_keywords': [
            'bre-b', 'breve', 'breb', 'bre_b', 'nequi', 'bogota', 'bogot',
        ],
        'text_must_contain': ['nequi', 'bre'],
        'amount_regexes': [
            r'(?:valor\s+de\s+la\s+transferencia)[^\$\d]{0,50}\$\s*(\d{1,3}(?:\.\d{3})+)(?:[.,]\d{2})?',
            r'(?:valor\s+de\s+la\s+transferencia)[^\$\d]{0,50}\$\s*(\d{4,7})(?:[.,]\d{2})?',
            r'(?:cu[aá]nto\??|valor|monto)[^\$\d]{0,50}\$\s*(\d{1,3}(?:\.\d{3})+)(?:[.,]\d{2})?',
            r'(?:cu[aá]nto\??|valor|monto)[^\$\d]{0,50}\$\s*(\d{4,7})(?:[.,]\d{2})?',
            r'\$\s*(\d{1,3}(?:\.\d{3})+)(?:[.,]\d{2})?(?!\d)',
        ],
        'receipt_regexes': [
            r'(?:comprobante)[^\d]{0,40}(\d{20,40})',
            r'(?:referencia)[\s\S]{0,50}?([Mm]\s*\d{7,10})',
            r'(?:referencia)[^\d]{0,25}(\d{6,14})',
            r'(?:transaccion|transacci[oó]n)\s*(?:no\.?|n[°o]\.?|#)?\s*(\d{6,14})',
            r'(?:numero|ndmero|namero|n[uú]mero)\s+de\s+aprobaci[oó6n\w]{0,8}\s*[:\s]*(\d{4,12})',
        ],
        'date_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+(?:de[l]?\s+)?\d{4})',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+\d{4})',
            r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
        ],
        'time_regexes': [
            r'(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
            r'(\d{1,2}:\d{2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
        ],
        'datetime_regexes': [
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+(?:de[l]?\s+)?\d{4})\s*'
            r'[-–—]\s*(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
            r'(\d{1,2}\s+de\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+(?:de[l]?\s+)?\d{4})\s+'
            r'(?:a\s+las|alas)\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
            r'(\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+\d{4})\s+'
            r'(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
        ],
        'account_regexes': [
            r'(?:a\s*la\s+llave|ala\s+llave)[^\d]{0,50}(\d{10})',
            r'(?:a\s*la\s+llave|ala\s+llave)[^\d]{0,50}@?([a-z][a-z0-9]{3,24})',
            r'(?:llave\s+bre-?\s*b|llave)\s*[:\s]*@?([a-z0-9]{4,24})',
            r'@([a-z][a-z0-9]{3,24})',
            r'(?:numero|n[uú]mero)\s+nequi[^\d]{0,50}(\d{3}\s*\d{3}\s*\d{4})',
            r'(?:celular|telefono|tel[eé]fono|para|destino)[^\d]{0,80}(\d{3}\s*\d{3}\s*\d{4})',
        ],
    },
    {
        'id': 'binance_usdt_erc20_detalle_pago',
        'label': 'Binance — Detalles del pago USDT ERC20',
        'currencies': ['USD', 'USDT'],
        'payment_method_ids': [],
        'payment_method_label_keywords': [
            'usdt', 'erc20', 'ethereum', 'usdt_erc20', 'binance',
        ],
        'text_must_contain': [],
        'amount_regexes': [
            r'(?:monto\s+transferido)[^\d]{0,100}(\d+(?:[.,]\d+)?)\s*u\s*s\s*p\s*t',
            r'(?:monto\s+del\s+pago)[^\d]{0,100}(\d+(?:[.,]\d+)?)\s*u\s*s\s*p\s*t',
            r'(?:^|\n)\s*(\d+(?:[.,]\d+)?)\s*u\s*s\s*p\s*t',
            r'(\d+(?:[.,]\d+)?)\s*usdt',
        ],
        'receipt_regexes': [
            r'(?:id\.?\s*de\s*(?:la\s+)?orden|id\s+de\s+orden)[^\d]{0,50}(\d{12,22})',
        ],
        'date_regexes': [],
        'time_regexes': [],
        'datetime_regexes': [],
        'account_regexes': [
            r'(?:direccion|dirección|direcci[oó]n)[^\w]{0,60}(0x[a-fA-F0-9]{40})',
            r'\b(0x[a-fA-F0-9]{40})\b',
        ],
    },
    {
        'id': 'binance_usdt_trc20_detalle_pago',
        'label': 'Binance — Detalles del pago USDT TRC20',
        'currencies': ['USD', 'USDT'],
        'payment_method_ids': [],
        'payment_method_label_keywords': [
            'usdt', 'trc20', 'tron', 'usdt_trc20', 'binance',
        ],
        'text_must_contain': [],
        'amount_regexes': [
            r'(?:monto\s+transferido)[^\d]{0,100}(\d+(?:[.,]\d+)?)\s*u\s*s\s*p\s*t',
            r'(?:monto\s+del\s+pago)[^\d]{0,100}(\d+(?:[.,]\d+)?)\s*u\s*s\s*p\s*t',
            r'(?:^|\n)\s*(\d+(?:[.,]\d+)?)\s*u\s*s\s*p\s*t',
            r'(\d+(?:[.,]\d+)?)\s*usdt',
        ],
        'receipt_regexes': [
            r'(?:id\.?\s*de\s*(?:la\s+)?orden|id\s+de\s+orden)[^\d]{0,50}(\d{12,22})',
        ],
        'date_regexes': [],
        'time_regexes': [],
        'datetime_regexes': [],
        'account_regexes': [
            r'(?:direccion|dirección|direcci[oó]n)[^\w]{0,60}(T[1-9A-HJ-NP-Za-km-z]{33})',
            r'\b(T[1-9A-HJ-NP-Za-km-z]{33})\b',
        ],
    },
    {
        'id': 'binance_pago_completado_usdt',
        'label': 'Binance Pay — Pago completado / exitoso (USDT)',
        'currencies': ['USD', 'USDT'],
        'payment_method_ids': [],
        'payment_method_label_keywords': ['usdt', 'binance', 'binanse'],
        'text_must_contain': ['usdt'],
        'amount_regexes': [
            r'monto\s*:\s*(\d+(?:[.,]\d+)?)\s*usdt',
            r'pagado\s+con[^\d]{0,25}(\d+(?:[.,]\d+)?)\s*usdt',
            r'pago\s+exitoso[^\d]{0,120}(\d+(?:[.,]\d+)?)\s*usdt',
            r'pago\s+completado[^\d]{0,120}(\d+(?:[.,]\d+)?)\s*usdt',
            r'(\d{1,7}(?:[.,]\d+)?)\s*usdt',
        ],
        'receipt_regexes': [
            r'Id\.\s*de\s+la\s+orden\s+(\d{12,22})',
            r'(?:id\.?\s*de\s+(?:la\s+)?orden|order\s+id)[^\d]{0,40}(\d{12,22})',
        ],
        'date_regexes': [
            r'(?:fecha\s+y\s+hora|fecha)\s*:\s*(\d{4}-\d{2}-\d{2})',
        ],
        'time_regexes': [
            r'(?:fecha\s+y\s+hora|fecha)\s*:\s*\d{4}-\d{2}-\d{2}\s+(\d{1,2}:\d{2}(?::\d{2})?)',
        ],
        'datetime_regexes': [],
        'account_regexes': [
            r'(?:ttavo\)|\bcolombia\b|brosito)[^\d]{0,120}(\d{8,12})\b',
            r'(?:^|\s)(\d{8,12})(?:\s+(?:id\.|metodo|método|se\s+pag|cuenta\s+de\s+spot))',
            r'(?:pago\s+completado|pago\s+exitoso)[^\d]{0,500}(\d{8,12})(?=[^\d]{0,80}(?:id\.|metodo|cuenta\s+de\s+spot))',
        ],
    },
]


def get_analyzer_patterns() -> list[dict[str, Any]]:
    """Patrones definidos en código (DEFAULT_PATTERNS). UI admin deshabilitada por ahora."""
    return list(DEFAULT_PATTERNS)


def save_analyzer_patterns(patterns: list[dict]) -> None:
    if not isinstance(patterns, list):
        raise ValueError('patterns debe ser una lista')
    row = StoreSetting.query.filter_by(key=SETTING_KEY).first()
    payload = json.dumps(patterns, ensure_ascii=False)
    if row:
        row.value = payload
    else:
        db.session.add(StoreSetting(key=SETTING_KEY, value=payload))
    db.session.commit()


def proof_image_hash(image_path: str) -> str:
    h = hashlib.sha256()
    with open(image_path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def digits_only(value: str) -> str:
    return re.sub(r'\D', '', str(value or ''))


def account_digits_from_details(details: str) -> str:
    """Extrae dígitos de cuenta esperados desde los datos del medio de pago (legacy)."""
    d = digits_only(details)
    return d if len(d) >= 8 else ''


def configured_account_digits_from_payment_method(method: dict | str) -> str:
    """Dígitos tal como están en admin (sin filtrar por longitud mínima)."""
    if isinstance(method, dict):
        from app.store.balance_recharge_payment import (
            payment_method_account_digits,
            payment_method_is_breb_nequi,
        )

        if payment_method_is_breb_nequi(method):
            acct = digits_only(payment_method_account_digits(method))
            if acct:
                return acct
        brand = str(method.get('payment_brand') or '').strip().lower()
        if brand == 'paypal':
            from app.store.balance_recharge_payment import _normalize_paypal_account

            email = _normalize_paypal_account(str(method.get('account_number') or ''))
            if email:
                return email
        if brand in ('usdt_erc20', 'usdt_trc20'):
            wallet = _normalize_crypto_wallet_for_match(
                str(method.get('account_number') or ''), brand
            )
            if wallet:
                return wallet
        acct = digits_only(str(method.get('account_number') or ''))
        if acct:
            return acct
        return account_digits_from_details(method.get('details') or '')
    return account_digits_from_details(str(method or ''))


_ACCOUNT_DIGIT_RULES: dict[str, tuple[int, int, str]] = {
    'binance': (8, 12, 'ID de cuenta Binance (8 a 12 dígitos)'),
    'binance_pay': (8, 12, 'ID de cuenta Binance (8 a 12 dígitos)'),
    'usdt': (8, 12, 'ID de cuenta Binance (8 a 12 dígitos)'),
    'usdt_erc20': (42, 42, 'dirección wallet USDT ERC20 (0x + 40 hex)'),
    'usdt_trc20': (34, 34, 'dirección wallet USDT TRC20 (T + 33 caracteres)'),
    'nequi': (10, 10, 'número Nequi (10 dígitos)'),
    'breb_nequi': (10, 10, 'llave Bre-B Nequi (10 dígitos si es celular)'),
    'daviplata': (10, 10, 'número DaviPlata (10 dígitos)'),
    'bancolombia': (10, 11, 'número de cuenta Bancolombia (10 u 11 dígitos)'),
    'paypal': (4, 64, 'correo electrónico de PayPal'),
}

_BRANDS_REQUIRING_ACCOUNT = frozenset(_ACCOUNT_DIGIT_RULES.keys())


def _payment_brand_requires_account_digits(brand: str) -> bool:
    return str(brand or '').strip().lower() in _BRANDS_REQUIRING_ACCOUNT


def _payment_brand_is_binance(brand: str) -> bool:
    b = str(brand or '').strip().lower()
    return b in ('binance', 'usdt', 'binance_pay')


def _normalize_crypto_wallet_for_match(value: str, brand: str = '') -> str:
    from app.store.balance_recharge_payment import _normalize_crypto_wallet

    return _normalize_crypto_wallet(value, brand)


def _crypto_wallet_is_valid_for_brand(value: str, brand: str) -> bool:
    from app.store.balance_recharge_payment import _crypto_wallet_is_valid

    return _crypto_wallet_is_valid(value, brand)


def resolve_crypto_wallet_match(
    expected_wallet: str,
    detected_wallets: list[str],
    *,
    brand: str = '',
) -> bool | None:
    """True/False/None para wallets ERC20/TRC20 en comprobantes."""
    brand_key = str(brand or '').strip().lower()
    exp = _normalize_crypto_wallet_for_match(expected_wallet, brand_key)
    if not exp:
        return None
    if brand_key and not _crypto_wallet_is_valid_for_brand(exp, brand_key):
        return None

    dets: list[str] = []
    for raw in detected_wallets or []:
        item = str(raw or '').strip()
        if not item:
            continue
        if item.lower().startswith('0x'):
            norm = item.lower()
        elif item.startswith('T'):
            norm = item
        else:
            continue
        if norm not in dets:
            dets.append(norm)
    if not dets:
        return None

    if brand_key == 'usdt_erc20':
        for det in dets:
            if _erc20_wallets_match(exp, det):
                return True
        return False

    if brand_key == 'usdt_trc20':
        for det in dets:
            if _trc20_wallets_match(exp, det):
                return True
        return False

    for det in dets:
        if det.lower() == exp.lower() or det == exp:
            return True
    return False


def resolve_account_config_for_brand(
    brand: str,
    configured_digits: str,
) -> tuple[str, bool, str | None]:
    """(dígitos válidos para comparar, config_inválida, texto de regla para error)."""
    brand_key = str(brand or '').strip().lower()
    if brand_key in ('usdt_erc20', 'usdt_trc20'):
        wallet = _normalize_crypto_wallet_for_match(configured_digits, brand_key)
        if not wallet:
            return '', False, None
        rule = _ACCOUNT_DIGIT_RULES.get(brand_key)
        if rule and _crypto_wallet_is_valid_for_brand(wallet, brand_key):
            return wallet, False, None
        if rule:
            return '', True, rule[2]
        return wallet, False, None
    if brand_key == 'paypal':
        email = str(configured_digits or '').strip().lower()
        if not email:
            return '', False, None
        rule = _ACCOUNT_DIGIT_RULES.get(brand_key)
        if rule:
            _min_len, max_len, hint = rule
            if '@' in email and _min_len <= len(email) <= max_len:
                return email, False, None
            return '', True, hint
        return email, False, None

    d = digits_only(configured_digits)
    if not d:
        return '', False, None

    rule = _ACCOUNT_DIGIT_RULES.get(brand_key)
    if rule:
        min_len, max_len, hint = rule
        if min_len <= len(d) <= max_len:
            return d, False, None
        return '', True, hint

    if len(d) >= 4:
        return d, False, None
    return '', True, 'número de cuenta (mínimo 4 dígitos)'


def account_digits_from_payment_method(method: dict | str) -> str:
    """Dígitos de cuenta del medio: prioriza account_number; fallback a details legacy."""
    if isinstance(method, dict):
        configured = configured_account_digits_from_payment_method(method)
        brand = payment_method_brand_token(method)
        expected, invalid, _hint = resolve_account_config_for_brand(brand, configured)
        if expected and not invalid:
            return expected
        if not configured:
            legacy = account_digits_from_details(method.get('details') or '')
            expected_legacy, invalid_legacy, _ = resolve_account_config_for_brand(brand, legacy)
            if expected_legacy and not invalid_legacy:
                return expected_legacy
        return ''
    legacy = account_digits_from_details(str(method or ''))
    return legacy if len(digits_only(legacy)) >= 4 else ''


def _recharge_duplicate_blocks(row: BalanceRecharge) -> bool:
    """True si la fila activa impide reutilizar el mismo comprobante/imagen."""
    st = (row.status or '').lower()
    if st == 'rejected':
        return False
    if st == 'auto_credited':
        return getattr(row, 'admin_verified', None) is None
    return st in ('pending', 'approved', 'accumulated', 'accum_converted')


def free_recharge_proof_identifiers(row: BalanceRecharge) -> None:
    """Libera hash/comprobante para permitir reenvío tras rechazo (índice único en hash)."""
    row.proof_image_hash = None
    row.receipt_number = None


def find_duplicate_recharge(
    *,
    receipt_number: str | None,
    proof_image_hash: str | None,
    user_id: int,
) -> dict[str, Any] | None:
    """
    Devuelve información del duplicado si la imagen o el comprobante ya existen
    en una solicitud activa. Rechazos del mismo cliente permiten reenvío marcado.
    """
    receipt = (receipt_number or '').strip()
    img_hash = (proof_image_hash or '').strip()

    prior: BalanceRecharge | None = None
    kind = 'image'
    if img_hash:
        prior = BalanceRecharge.query.filter_by(proof_image_hash=img_hash).first()
        kind = 'image'
    if not prior and receipt:
        prior = BalanceRecharge.query.filter_by(receipt_number=receipt).first()
        kind = 'receipt'

    if not prior:
        return None

    if _recharge_duplicate_blocks(prior):
        return _duplicate_payload(prior, user_id, kind, blocks=True)

    same_user = int(prior.user_id) == int(user_id)
    if (prior.status or '').lower() == 'rejected' and same_user:
        payload = _duplicate_payload(prior, user_id, kind, blocks=False)
        payload['resubmit_after_reject'] = True
        return payload

    return None


def _duplicate_payload(
    row: BalanceRecharge,
    user_id: int,
    kind: str,
    *,
    blocks: bool,
) -> dict[str, Any]:
    from app.models.user import User

    same_user = int(row.user_id) == int(user_id)
    other = User.query.get(row.user_id)
    other_name = other.username if other else 'otro usuario'
    if same_user:
        message = 'Esta imagen ya se envió.'
    else:
        message = f'Un usuario diferente ({other_name}) ya envió esta imagen.'
    return {
        'kind': kind,
        'blocks': blocks,
        'same_user': same_user,
        'message': message,
        'existing_id': row.id,
        'existing_user_id': row.user_id,
        'existing_username': other_name,
        'receipt_number': getattr(row, 'receipt_number', None),
        'existing_status': (row.status or '').lower(),
    }


def _normalize_amount(raw: str) -> Decimal | None:
    """Interpreta montos COP/USD con o sin separadores (. , espacio)."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    s = re.sub(r'^[\$\s]+|[\s]+$', '', s)
    s = s.replace(' ', '')
    if not s or not re.search(r'\d', s):
        return None

    if re.fullmatch(r'\d+', s):
        val = Decimal(s)
        return val if val > 0 else None

    if re.fullmatch(r'\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?', s):
        whole = s.split(',')[0].replace('.', '')
        val = Decimal(whole)
        return val if val > 0 else None

    if re.fullmatch(r'\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?', s):
        whole = s.split('.')[0].replace(',', '')
        val = Decimal(whole)
        return val if val > 0 else None

    if re.fullmatch(r'\d+\.\d+', s):
        whole, frac = s.split('.', 1)
        if len(frac) == 3:
            val = Decimal(whole + frac)
            return val if val > 0 else None
        val = Decimal(s)
        return val if val > 0 else None

    if re.fullmatch(r'\d+,\d+', s):
        whole, frac = s.split(',', 1)
        if len(frac) == 3:
            val = Decimal(whole + frac)
            return val if val > 0 else None
        val = Decimal(s.replace(',', '.'))
        return val if val > 0 else None

    digits = digits_only(s)
    if len(digits) >= 3:
        val = Decimal(digits)
        return val if val > 0 else None

    try:
        val = Decimal(s.replace(',', '.'))
    except (InvalidOperation, ValueError):
        return None
    return val if val > 0 else None


def parse_recharge_amount(raw: str | int | float | Decimal | None) -> Decimal | None:
    """Parsea monto declarado por el usuario (539,000 · 539.000 · 539000)."""
    if raw is None:
        return None
    if isinstance(raw, Decimal):
        return raw if raw > 0 else None
    if isinstance(raw, (int, float)):
        val = Decimal(str(raw))
        return val if val > 0 else None
    return _normalize_amount(str(raw))


def _amount_whole_units(value: Decimal | float) -> int:
    return int(round(float(value)))


def _quantize_money(value: Decimal | float, currency: str) -> Decimal:
    """COP: pesos enteros. USD/USDT: exactamente 2 decimales (centavos cuentan)."""
    cur = (currency or 'COP').upper()
    try:
        v = Decimal(str(value))
    except (InvalidOperation, ValueError):
        v = Decimal('0')
    if cur in ('USD', 'USDT'):
        return v.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return Decimal(_amount_whole_units(v))


# Máx. diferencia en pesos COP por redondeo OCR (no porcentaje del monto).
_COP_AMOUNT_TOLERANCE_PESOS = 99


def _amounts_equivalent(claimed: Decimal | float, detected: Decimal | float, currency: str = 'COP') -> bool:
    """Compara montos: COP con tolerancia fija pequeña; USD/USDT centavo a centavo."""
    cur = (currency or 'COP').upper()
    if cur in ('USD', 'USDT'):
        return _quantize_money(claimed, cur) == _quantize_money(detected, cur)
    ci = _amount_whole_units(claimed)
    di = _amount_whole_units(detected)
    if ci == di:
        return True
    return abs(ci - di) <= _COP_AMOUNT_TOLERANCE_PESOS


def _scan_amounts_in_text(text: str) -> list[Decimal]:
    """Busca montos en texto OCR con regex flexibles (con/sin . o ,)."""
    if _infer_nequi_corresponsal_receipt(text):
        found_corr = _nequi_corresponsal_amounts(text)
        if found_corr:
            return found_corr

    regexes = [
        r'(?:valor de la transferencia|valor|monto|total)[^\$\d]{0,40}\$\s*([\d][\d.\s,]*)',
        r'\$\s*([\d][\d.\s,]*)',
        r'(?:valor|monto|transferencia)[^\d]{0,25}(\d{4,9})\b',
        r'\b(\d{1,3}(?:[.,]\d{3})+)\b',
        r'\b(\d{5,9})\b',
    ]
    found: list[Decimal] = []
    for raw in _find_by_regexes(text, regexes, group=True):
        val = _normalize_amount(raw)
        if val is not None and val not in found:
            found.append(val)
    return found


def _normalize_ocr_text(text: str) -> str:
    """Corrige lecturas OCR frecuentes en comprobantes DaviPlata / Nequi / bancos."""
    if not text:
        return ''
    t = text
    t = re.sub(r'(?im)^IMG\s+\d+\s*x\s*\d+\s*\n?', '', t)
    t = re.sub(r'(?i)\bolde\b', '01 de', t)
    t = re.sub(r'(?i)\bo1\s*de\b', '01 de', t)
    t = re.sub(r'(?i)\bnamero\b', 'numero', t)
    t = re.sub(r'(?i)\bndmero\b', 'numero', t)
    t = re.sub(r'(?i)\balas\b', 'a las', t)
    t = re.sub(r'(?i)(referencia\s*\n?\s*)\d\s+([Mm]\d)', r'\1\2', t)
    t = re.sub(r'(?i)env[ií]o\s+a\s+banco', 'envio a banco', t)
    t = re.sub(r'(?i)\bbinanse\b', 'binance', t)
    t = re.sub(r'(?i)\bpago\s+exitos[o0]\b', 'pago exitoso', t)
    t = re.sub(r'(?i)id\.?\s*de\s+(?:la\s+)?orden', 'Id. de la orden', t)
    t = re.sub(r'(?i)(\d{1,2}:\d{2})(a\.m\.|p\.m\.)', r'\1 \2', t)
    t = re.sub(r'(?i)(\d{1,2})\s*,\s*de\b', r'\1 de', t)
    t = re.sub(r'(?i)~cu[aá]nto\??', 'cuanto?', t)
    t = re.sub(r'(?i)\brela\b', 'referencia', t)
    t = re.sub(
        r'(?i)(referencia)\s*\n+\s*M?\s*(\d{7,10})\b',
        r'Referencia M\2',
        t,
    )
    t = re.sub(
        r'(?<!\d)(\d{1,3})\s+(\d{3})\s+(\d{2})\b',
        r'\1.\2,\3',
        t,
    )
    t = re.sub(
        r'(?<!\d)(\d{1,3})\s+(\d{3})\b(?!\s*,\s*\d{2})',
        r'\1.\2',
        t,
    )
    return t


def _normalize_receipt_token(raw: str) -> str:
    """Referencia/comprobante: conserva prefijos alfanuméricos (ej. M20318884)."""
    s = re.sub(r'[^A-Za-z0-9]', '', str(raw or '').strip())
    return s.upper() if len(s) >= 4 else ''


def _filter_accounts_not_receipt_digits(
    accounts: list[str],
    receipt_numbers: list[str] | None,
) -> list[str]:
    """Evita confundir la parte numérica de referencias M… (ej. M13471419) con cuentas."""
    receipt_digit_only = {
        digits_only(r) for r in (receipt_numbers or []) if digits_only(r)
    }
    if not receipt_digit_only:
        return list(accounts or [])
    return [a for a in (accounts or []) if a not in receipt_digit_only]


def _normalize_text_for_match(text: str) -> str:
    t = unicodedata.normalize('NFD', (_normalize_ocr_text(text) or '').lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    for src, dst in (
        ('transacci6n', 'transaccion'),
        ('transacci0n', 'transaccion'),
    ):
        t = t.replace(src, dst)
    return re.sub(r'\s+', ' ', t)


def _text_contains_all(text: str, terms: list[str]) -> bool:
    norm = _normalize_text_for_match(text)
    return all(_normalize_text_for_match(term) in norm for term in terms if str(term).strip())


def payment_method_brand_token(
    payment_method: dict | None = None,
    *,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> str:
    """Marca del medio: nequi, binance, bancolombia, daviplata, breb, paypal o vacío."""
    pm_id = (payment_method_id or (payment_method or {}).get('id') or '').strip().lower()
    label = (payment_method_label or (payment_method or {}).get('label') or '').strip().lower()
    brand = str((payment_method or {}).get('payment_brand') or '').strip().lower()
    if brand in ('usdt_erc20', 'usdt_trc20'):
        return brand
    if brand in ('binance', 'binanse', 'usdt'):
        return 'binance'
    if brand == 'breb_nequi':
        return 'breb_nequi'
    if brand in ('breve', 'kamin', 'breb', 'breb_bancolombia'):
        return 'breb'
    if brand in ('nequi', 'daviplata', 'bancolombia', 'paypal'):
        return brand
    haystack = f'{pm_id} {label}'
    if ('bre-b' in haystack or 'breb' in haystack or 'breve' in haystack) and 'nequi' in haystack:
        return 'breb_nequi'
    if 'nequi' in haystack:
        return 'nequi'
    if 'daviplata' in haystack:
        return 'daviplata'
    if any(t in haystack for t in ('bre-b', 'breb', 'breve', 'kamin')):
        return 'breb'
    if 'bancolombia' in haystack:
        return 'bancolombia'
    if 'erc20' in haystack or ('usdt' in haystack and 'ethereum' in haystack):
        return 'usdt_erc20'
    if 'trc20' in haystack or ('usdt' in haystack and 'tron' in haystack):
        return 'usdt_trc20'
    if any(t in haystack for t in ('binance', 'binanse', 'usdt')):
        return 'binance'
    if 'paypal' in haystack:
        return 'paypal'
    return ''


def _text_looks_like_binance_usdt_comprobante(text: str) -> bool:
    """Comprobante Binance Pay / spot USDT (no Nequi, Bancolombia, etc.)."""
    if (
        _infer_binance_usdt_erc20_detalle_pago(text)
        or _infer_binance_usdt_trc20_detalle_pago(text)
    ):
        return False
    norm = _normalize_text_for_match(text)
    if 'usdt' not in norm:
        return False
    return any(
        tok in norm
        for tok in (
            'pago completado',
            'pago exitoso',
            'binance',
            'binanse',
            'cuenta de spot',
            'id de la orden',
            'pagado con',
            'metodo de pago',
        )
    )


def _digits_embedded_in_long_id(digits: str, text: str, min_run: int = 14) -> bool:
    """Evita tomar fragmentos del Id. de orden Binance (15+ dígitos) como cuenta."""
    d = digits_only(digits)
    if len(d) < 8:
        return False
    for m in re.finditer(r'[\d\s]{%d,}' % min_run, text or ''):
        run = digits_only(m.group(0))
        if len(run) < min_run:
            continue
        if d in run and d != run:
            return True
    return False


def _is_binance_order_id_digits(digits: str) -> bool:
    """Id. de la orden Binance (15+ dígitos); no es el ID de cuenta del destinatario."""
    return len(digits_only(digits)) >= 13


_BINANCE_RELATED_BRANDS = frozenset({'binance', 'usdt', 'binance_pay'})
_WALLET_CRYPTO_BRANDS = frozenset({'usdt_erc20', 'usdt_trc20'})


def _configure_tesseract() -> bool:
    """Configura ruta de Tesseract (instalación del sistema)."""
    try:
        import pytesseract
    except ImportError:
        return False

    if not getattr(_configure_tesseract, '_done', False):
        candidates = [
            os.environ.get('TESSERACT_CMD'),
            r'C:\Program Files\Tesseract-OCR\tesseract.exe',
            r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
        ]
        for path in candidates:
            if path and os.path.isfile(path):
                pytesseract.pytesseract.tesseract_cmd = path
                break

        _configure_tesseract._done = True

    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _load_image_rgb(image_path: str):
    from PIL import Image, ImageOps

    with Image.open(image_path) as img:
        return ImageOps.exif_transpose(img).convert('RGB')


def _ocr_base_images(img):
    """Imagen completa y recorte central (capturas con modal o UI alrededor)."""
    w, h = img.size
    bases = [img]
    if w >= 500 and h >= 500 and max(w, h) / max(min(w, h), 1) >= 1.12:
        mx = int(w * 0.18)
        my = int(h * 0.06)
        crop = img.crop((mx, my, w - mx, h - my))
        if crop.size[0] >= 200 and crop.size[1] >= 200:
            bases.append(crop)
    return bases


def _ocr_variants(img):
    from PIL import Image, ImageEnhance, ImageOps

    variants: list = []
    for base in _ocr_base_images(img):
        w, h = base.size
        gray = ImageOps.autocontrast(ImageOps.grayscale(base))
        gw = max(w // 4, 1)
        gh = max(h // 4, 1)
        small = gray.resize((gw, gh), Image.Resampling.BILINEAR)
        pixels = list(small.getdata())
        mean = sum(pixels) / max(len(pixels), 1)

        inverted = ImageOps.invert(base)
        inv_contrast = ImageEnhance.Contrast(inverted).enhance(2.0)
        up_w, up_h = int(w * 1.5), int(h * 1.5)
        variants.append(inv_contrast.resize((up_w, up_h), Image.Resampling.LANCZOS))

        sharp_gray = ImageEnhance.Sharpness(gray).enhance(2.0)
        if max(w, h) < 2000:
            scale = 2000 / max(w, h)
            variants.append(
                sharp_gray.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
            )
        bw = gray.point(lambda p: 255 if p > 128 else 0)
        variants.append(ImageOps.invert(bw))

        if mean >= 130:
            if max(w, h) < 1600:
                scale = 1600 / max(w, h)
                variants.append(
                    base.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
                )
        else:
            variants.append(inv_contrast)
            if max(w, h) < 1800:
                scale = 1800 / max(w, h)
                variants.append(
                    inv_contrast.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
                )

    return variants


def _ocr_quality_score(text: str) -> float:
    if not text or not str(text).strip():
        return 0.0
    t = _normalize_text_for_match(text)
    score = float(len(re.findall(r'[a-z0-9]', t, re.I)))
    if 'comprobante' in t:
        score += 500.0
    if 'transferencia' in t and 'exitosa' in t:
        score += 400.0
    if re.search(r'\$\s*[\d.,]+', text):
        score += 300.0
    if 'redeban' in t or 'multipag' in t:
        score += 450.0
    if 'recarga' in t and 'nequ' in t:
        score += 500.0
    if 'producto' in t and re.search(r'3\d{9}', text):
        score += 350.0
    if 'valor' in t:
        score += 220.0
    if 'pago exitoso' in t:
        score += 450.0
    if 'detalles del pago' in t or 'detalle del pago' in t:
        score += 900.0
    if 'ethereum' in t and 'erc20' in t:
        score += 500.0
    if 'tron' in t and 'trc20' in t:
        score += 500.0
    if 'monto transferido' in t:
        score += 400.0
    if re.search(r'\b0x[a-f0-9]', t, re.IGNORECASE):
        score += 650.0
    if re.search(r'\bT[1-9A-HJ-NP-Za-km-z]{10,}', text):
        score += 650.0
    if 'id de orden' in t and re.search(r'\d{12,22}', text):
        score += 500.0
    if re.search(r'\d+(?:[.,]\d+)?\s*u\s*s\s*p\s*t', t, re.IGNORECASE):
        score += 400.0
    if 'bancolombia' in t and 'numero de cuenta' in t:
        score += 420.0
    if 'nequi' in t and 'referencia' in t:
        score += 280.0
    if 'cuanto' in t and re.search(r'\$\s*[\d.,]+', text):
        score += 260.0
    if 'recibo' in t and re.search(r'\brrn\b', t):
        score += 280.0
    if re.search(r'\d{6,12}', text):
        score += 150.0
    if re.search(r'\d{3}\s*-\s*\d{6}\s*-\s*\d{2}', text):
        score += 120.0
    weird = len(re.findall(r'[^\w\s$.,:/\-áéíóúñ]', text, re.I))
    score -= weird * 3.0
    return score


_OCR_EARLY_EXIT_SCORE = 800.0


def _ocr_result_usable(text: str) -> bool:
    """True si el OCR ya trae monto y cuenta/referencia suficientes para validar."""
    if not text or not str(text).strip():
        return False
    norm = _normalize_text_for_match(text)
    if not re.search(r'\$\s*\d', text):
        return False
    if re.search(r'\d{10,12}', text):
        return True
    if re.search(r'referencia[\s\S]{0,50}?m\s*\d{7,10}', text, re.IGNORECASE):
        return True
    if re.search(r'\bM\d{7,10}\b', text, re.IGNORECASE):
        return True
    if _scan_nequi_pago_referencia_codes(text):
        return True
    if 'comprobante' in norm and re.search(r'\d{6,}', text):
        return True
    if re.search(r'\d+(?:[.,]\d+)?\s*u\s*s\s*p\s*t', norm, re.IGNORECASE):
        if re.search(r'\b0x[a-f0-9]', text, re.IGNORECASE):
            return True
        if re.search(r'\bT[1-9A-HJ-NP-Za-km-z]{10,}', text):
            return True
    if 'detalles del pago' in norm and re.search(r'\d{12,22}', text):
        return True
    return False


def _ocr_downscale_for_tesseract(img, max_dim: int = 1800):
    from PIL import Image

    w, h = img.size
    if max(w, h) <= max_dim:
        return img
    scale = max_dim / max(w, h)
    return img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)


def _ocr_quick_text(img) -> str:
    """Pasada rápida: recorte(s) + escala acotada + pocos Tesseract."""
    if not _configure_tesseract():
        return ''

    import pytesseract
    from PIL import ImageOps

    best_text = ''
    best_score = 0.0
    for base in _ocr_base_images(img):
        scaled = _ocr_downscale_for_tesseract(base)
        gray = ImageOps.autocontrast(ImageOps.grayscale(scaled))
        for cfg in ('--psm 6', '--psm 4'):
            try:
                text = (pytesseract.image_to_string(gray, lang='eng+spa', config=cfg) or '').strip()
                if not text:
                    continue
                score = _ocr_quality_score(text)
                if score > best_score:
                    best_score = score
                    best_text = text
                if score >= _OCR_EARLY_EXIT_SCORE and _ocr_result_usable(text):
                    return text
            except Exception:
                continue
    return best_text


def _ocr_text_from_image(img, *, max_variants: int | None = None) -> str:
    if not _configure_tesseract():
        return ''

    import pytesseract

    configs = ('--psm 6', '--psm 4', '--psm 11')
    langs = ('eng+spa',)
    best_text = ''
    best_score = 0.0

    variants = _ocr_variants(img)
    if max_variants is not None:
        variants = variants[:max_variants]
    for variant in variants:
        variant = _ocr_downscale_for_tesseract(variant)
        for cfg in configs:
            for lang in langs:
                try:
                    text = pytesseract.image_to_string(variant, lang=lang, config=cfg)
                    if not text or not text.strip():
                        continue
                    score = _ocr_quality_score(text)
                    if score > best_score:
                        best_score = score
                        best_text = text.strip()
                    if score >= _OCR_EARLY_EXIT_SCORE:
                        return best_text
                except Exception:
                    continue

    return best_text


def _extract_text_from_image(image_path: str) -> tuple[str, list[str]]:
    """OCR (varias orientaciones y preprocesado) + QR + metadatos."""
    sources: list[str] = []
    chunks: list[str] = []

    try:
        img = _load_image_rgb(image_path)
        chunks.append(f'IMG {img.size[0]}x{img.size[1]}')
        sources.append('image_meta')

        quick = _ocr_quick_text(img)
        quick_score = _ocr_quality_score(quick)
        best_ocr = quick
        best_score = quick_score
        if not (
            _ocr_result_usable(quick)
            and quick_score >= _OCR_EARLY_EXIT_SCORE
        ):
            angles = (0,) if quick_score >= 400 else (0, 90, 180, 270)
            variant_cap = (
                4
                if quick_score >= 250
                and quick_score < 700
                and not _ocr_text_looks_like_crypto_detalle(quick)
                else None
            )
            for angle in angles:
                rotated = img.rotate(angle, expand=True) if angle else img
                text = _ocr_text_from_image(rotated, max_variants=variant_cap)
                score = _ocr_quality_score(text)
                if score > best_score or (
                    score >= best_score
                    and _ocr_result_usable(text)
                    and not _ocr_result_usable(best_ocr)
                ):
                    best_score = score
                    best_ocr = text
                if score >= _OCR_EARLY_EXIT_SCORE and _ocr_result_usable(text):
                    break
        if best_ocr:
            chunks.append(best_ocr)
            sources.append('ocr')
    except Exception:
        pass

    try:
        from pyzbar.pyzbar import decode as qr_decode

        with open(image_path, 'rb') as fh:
            data = fh.read()
        for item in qr_decode(data):
            if item.data:
                text = item.data.decode('utf-8', errors='ignore').strip()
                if text:
                    chunks.append(text)
                    sources.append('qr')
    except Exception:
        pass

    return _normalize_ocr_text('\n'.join(chunks)), sources


def _pattern_applies(
    pattern: dict,
    currency: str,
    payment_method_id: str,
    payment_method_label: str = '',
) -> bool:
    cur = (currency or '').upper()
    allowed_cur = [c.upper() for c in (pattern.get('currencies') or [])]
    if allowed_cur and cur not in allowed_cur:
        return False

    pm_id = (payment_method_id or '').lower()
    pm_ids = [str(x).lower() for x in (pattern.get('payment_method_ids') or []) if str(x).strip()]
    label_lower = (payment_method_label or '').lower()
    label_keywords = [
        str(x).lower() for x in (pattern.get('payment_method_label_keywords') or []) if str(x).strip()
    ]

    if pm_ids or label_keywords:
        id_ok = pm_id in pm_ids if pm_ids else False
        label_ok = any(kw in label_lower for kw in label_keywords) if label_keywords else False
        id_kw_ok = any(kw in pm_id for kw in label_keywords) if label_keywords and pm_id else False
        if not (id_ok or label_ok or id_kw_ok):
            return False
    return True


def _patterns_for_payment_method(
    patterns: list[dict],
    currency: str,
    payment_method_id: str,
    payment_method_label: str,
) -> list[dict]:
    matched = [
        p for p in patterns
        if _pattern_applies(p, currency, payment_method_id, payment_method_label)
    ]
    if matched:
        return matched
    cur = (currency or '').upper()
    return [
        p for p in patterns
        if not p.get('currencies') or cur in [c.upper() for c in (p.get('currencies') or [])]
    ]


_GLOBAL_TIME_REGEXES = [
    r'(?<![\d:])(\d{1,2}\s*:\s*\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))',
    r'(?<![\d:])(\d{1,2}\s*:\s*\d{2})(?!\s*:\s*\d)',
    r'(?:a\s+las|hora)\s+(\d{1,2}\s*:\s*\d{2})',
]


def _strip_seconds_from_time_raw(raw: str) -> str:
    """Quita :ss del texto mostrado (solo se usa hora:minuto)."""
    s = re.sub(r'\s+', ' ', str(raw or '').strip())
    return re.sub(r'(\d{1,2}:\d{2}):\d{2}', r'\1', s)


def _find_by_regexes(text: str, regexes: list[str], group: bool = True) -> list[str]:
    found: list[str] = []
    for rx in regexes or []:
        try:
            for m in re.finditer(rx, text, re.IGNORECASE | re.MULTILINE):
                val = m.group(1) if group and m.lastindex else m.group(0)
                val = str(val).strip()
                if val and val not in found:
                    found.append(val)
        except re.error:
            continue
    return found


def _find_amounts_in_text(text: str, regexes: list[str]) -> list[Decimal]:
    found: list[Decimal] = []
    for raw in _find_by_regexes(text, regexes, group=True):
        val = _normalize_amount(raw)
        if val is not None and val not in found:
            found.append(val)
    return found


# Regex globales para cuentas Bancolombia (3-6-2 con guiones/espacios) y números planos.
_GLOBAL_ACCOUNT_REGEXES = [
    r'(?:producto\s+destino|cuenta\s+destino|destino|ahorros)[^\d]{0,100}'
    r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
    r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
    r'\b(\d{11})\b',
]


def _ocr_hex_char(ch: str) -> str:
    c = str(ch or '').lower()
    if c in '0123456789abcdef':
        return c
    if c == 'o':
        return '0'
    if c == 'l':
        return '1'
    if c == 's':
        return '5'
    return ''


def _scan_crypto_wallets_in_text(text: str) -> list[str]:
    found: list[str] = []
    for m in re.finditer(r'\b(0x[a-fA-F0-9]{40})\b', text or ''):
        wallet = m.group(1).lower()
        if wallet not in found:
            found.append(wallet)
    for m in re.finditer(r'\b(T[1-9A-HJ-NP-Za-km-z]{33})\b', text or ''):
        wallet = m.group(1)
        if wallet not in found:
            found.append(wallet)
    return found


def _erc20_wallet_line_is_continuation(line: str) -> bool:
    norm = _normalize_text_for_match(line)
    if not norm:
        return False
    if 'direcci' in norm or 'fia' in norm:
        return False
    if any(
        kw in norm
        for kw in (
            'direccion', 'txid', 'orden', 'atencion', 'metodo',
            'off-chain', 'off chain', 'procesado', 'monto', 'red ',
            'detalles', 'transferido', 'cuenta', 'fondos', 'ethereum',
            'binance', 'usdt', 'usp',
        )
    ):
        return False
    stripped = line.strip()
    hexish = sum(1 for ch in stripped if _ocr_hex_char(ch))
    compact = sum(1 for ch in stripped if not ch.isspace())
    if compact < 8 or hexish < 8:
        return False
    if not _ocr_hex_char(stripped.lstrip('- as').lstrip()[0:1] or ''):
        return False
    return hexish >= compact * 0.7


def _hex_chars_from_line_segment(segment: str) -> list[str]:
    chars: list[str] = []
    for ch in segment:
        h = _ocr_hex_char(ch)
        if h:
            chars.append(h)
        elif ch.isspace():
            continue
        elif chars:
            break
    return chars


def _scan_erc20_wallets_lenient(text: str) -> list[str]:
    """Wallet ERC20 en OCR (0x…, a veces partida en varias líneas o con S/s→5)."""
    found: list[str] = []
    lines = (text or '').splitlines()

    def _push_wallet(hex_chars: list[str]) -> None:
        if len(hex_chars) < 30:
            return
        wallet = '0x' + ''.join(hex_chars[:40])
        if wallet not in found:
            found.append(wallet)

    for idx, line in enumerate(lines):
        for m in re.finditer(r'0x', line, re.IGNORECASE):
            hex_chars = _hex_chars_from_line_segment(line[m.start() + 2:])
            for next_line in lines[idx + 1: idx + 5]:
                if not _erc20_wallet_line_is_continuation(next_line):
                    continue
                cont = _hex_chars_from_line_segment(next_line)
                if len(cont) < 8:
                    continue
                hex_chars.extend(cont)
                if len(hex_chars) >= 40:
                    break
            _push_wallet(hex_chars)

    for wallet in _scan_crypto_wallets_in_text(text):
        if wallet not in found:
            found.append(wallet)
    return found


_TRC20_BASE58_CHARS = frozenset('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')


def _ocr_trc20_char(ch: str) -> str:
    c = str(ch or '')
    if not c:
        return ''
    if c in _TRC20_BASE58_CHARS:
        return c
    low = c.lower()
    if low in ('l', 'i'):
        return '1'
    if low == 's':
        return '5'
    return ''


def _trc20_wallet_line_is_continuation(line: str) -> bool:
    norm = _normalize_text_for_match(line)
    if not norm:
        return False
    if 'direcci' in norm or 'fia' in norm:
        return False
    if any(
        kw in norm
        for kw in (
            'direccion', 'txid', 'orden', 'atencion', 'metodo',
            'off-chain', 'off chain', 'procesado', 'monto', 'red ',
            'detalles', 'transferido', 'cuenta', 'fondos', 'ethereum',
            'tron', 'trc20', 'binance', 'usdt', 'usp',
        )
    ):
        return False
    stripped = line.strip()
    base58ish = sum(1 for ch in stripped if _ocr_trc20_char(ch))
    compact = sum(1 for ch in stripped if not ch.isspace())
    if compact < 6 or base58ish < 6:
        return False
    if not _ocr_trc20_char(stripped.lstrip('- ;').lstrip()[0:1] or ''):
        return False
    return base58ish >= compact * 0.7


def _trc20_chars_from_line_segment(segment: str) -> list[str]:
    chars: list[str] = []
    for ch in segment:
        b = _ocr_trc20_char(ch)
        if b:
            chars.append(b)
        elif ch.isspace():
            continue
        elif chars:
            break
    return chars


def _scan_trc20_wallets_lenient(text: str) -> list[str]:
    """Wallet TRC20 en OCR (T…, a veces partida en varias líneas)."""
    found: list[str] = []
    lines = (text or '').splitlines()

    def _push_wallet(body_chars: list[str]) -> None:
        if len(body_chars) < 28:
            return
        body = ''.join(body_chars[:33])
        if 'irecci' in body.lower():
            return
        wallet = 'T' + body
        if wallet not in found:
            found.append(wallet)

    for idx, line in enumerate(lines):
        for m in re.finditer(r'(?<![A-Za-z0-9])T', line):
            body_chars = _trc20_chars_from_line_segment(line[m.start() + 1:])
            if len(body_chars) < 10:
                continue
            for next_line in lines[idx + 1: idx + 5]:
                if not _trc20_wallet_line_is_continuation(next_line):
                    continue
                cont = _trc20_chars_from_line_segment(next_line)
                if len(cont) < 6:
                    continue
                body_chars.extend(cont)
                if len(body_chars) >= 33:
                    break
            _push_wallet(body_chars)

    if len(found) > 1:
        found.sort(key=lambda w: (len(w), w), reverse=True)
        best = found[0]
        found = [best]

    for wallet in _scan_crypto_wallets_in_text(text):
        if wallet not in found:
            found.append(wallet)
    return found


def _scan_binance_detalle_pago_order_ids(text: str) -> list[str]:
    found: list[str] = []
    for m in re.finditer(
        r'id\.?\s*de\s*(?:la\s+)?orden[^\d]{0,50}(\d{12,22})',
        text or '',
        re.IGNORECASE,
    ):
        rec = digits_only(m.group(1))
        if rec and rec not in found:
            found.append(rec)
    return found


def _ocr_text_looks_like_crypto_detalle(text: str) -> bool:
    norm = _normalize_text_for_match(text)
    if not (
        ('detalles del pago' in norm or 'detalle del pago' in norm)
        and ('usdt' in norm or 'uspt' in norm)
    ):
        return False
    if re.search(r'\b0x', text or '', re.IGNORECASE):
        return True
    if ('tron' in norm or 'trc20' in norm) and _scan_trc20_wallets_lenient(text):
        return True
    return False


def _text_looks_like_binance_usdt_erc20_detalle_pago(text: str) -> bool:
    """Binance app — «Detalles del pago» retiro USDT red ERC20."""
    norm = _normalize_text_for_match(text)
    if 'detalles del pago' not in norm and 'detalle del pago' not in norm:
        return False
    if 'usdt' not in norm and 'uspt' not in norm:
        return False
    if 'erc20' not in norm and 'ethereum' not in norm:
        return False
    if not _scan_erc20_wallets_lenient(text):
        return False
    if not _scan_binance_detalle_pago_order_ids(text):
        return False
    return True


def _infer_binance_usdt_erc20_detalle_pago(
    text: str,
    matched_patterns: list[dict] | None = None,
) -> bool:
    if _text_looks_like_binance_usdt_trc20_detalle_pago(text):
        return False
    if _text_looks_like_binance_usdt_erc20_detalle_pago(text):
        return True
    norm = _normalize_text_for_match(text)
    if (
        _ocr_text_looks_like_crypto_detalle(text)
        and ('erc20' in norm or 'ethereum' in norm)
        and 'trc20' not in norm
        and 'tron' not in norm
        and _scan_erc20_wallets_lenient(text)
    ):
        return True
    if any(
        str(p.get('id') or '') == 'binance_usdt_erc20_detalle_pago'
        for p in (matched_patterns or [])
    ):
        return True
    return False


def _text_looks_like_binance_usdt_trc20_detalle_pago(text: str) -> bool:
    """Binance app — «Detalles del pago» retiro USDT red TRC20."""
    norm = _normalize_text_for_match(text)
    if 'detalles del pago' not in norm and 'detalle del pago' not in norm:
        return False
    if 'usdt' not in norm and 'uspt' not in norm:
        return False
    if 'trc20' not in norm and 'tron' not in norm:
        return False
    if not _scan_trc20_wallets_lenient(text):
        return False
    if not _scan_binance_detalle_pago_order_ids(text):
        return False
    return True


def _infer_binance_usdt_trc20_detalle_pago(
    text: str,
    matched_patterns: list[dict] | None = None,
) -> bool:
    if _text_looks_like_binance_usdt_trc20_detalle_pago(text):
        return True
    norm = _normalize_text_for_match(text)
    if (
        _ocr_text_looks_like_crypto_detalle(text)
        and ('trc20' in norm or 'tron' in norm)
        and _scan_trc20_wallets_lenient(text)
    ):
        return True
    if any(
        str(p.get('id') or '') == 'binance_usdt_trc20_detalle_pago'
        for p in (matched_patterns or [])
    ):
        return True
    return False


def _trc20_wallets_match(expected: str, detected: str) -> bool:
    exp = str(expected or '').strip()
    det = str(detected or '').strip()
    if not exp or not det:
        return False
    if exp == det or exp.lower() == det.lower():
        return True
    exp_body = exp[1:] if exp.startswith('T') else exp
    det_body = det[1:] if det.startswith('T') else det
    min_len = min(len(exp_body), len(det_body))
    if min_len >= 28:
        mism = sum(1 for a, b in zip(exp_body.lower(), det_body.lower()) if a != b)
        mism += abs(len(exp_body) - len(det_body))
        if mism <= 5:
            return True
    if (
        len(exp_body) >= 10
        and len(det_body) >= 10
        and exp_body[-10:].lower() == det_body[-10:].lower()
    ):
        return True
    return False


def _erc20_wallets_match(expected: str, detected: str) -> bool:
    exp = str(expected or '').strip().lower()
    det = str(detected or '').strip().lower()
    if not exp or not det:
        return False
    if exp == det:
        return True
    exp_body = exp[2:] if exp.startswith('0x') else exp
    det_body = det[2:] if det.startswith('0x') else det
    min_len = min(len(exp_body), len(det_body))
    if min_len >= 30:
        mism = sum(1 for a, b in zip(exp_body, det_body) if a != b)
        mism += abs(len(exp_body) - len(det_body))
        if mism <= 5:
            return True
    if len(exp_body) >= 12 and len(det_body) >= 12 and exp_body[-12:] == det_body[-12:]:
        return True
    if len(exp_body) >= 10 and det_body in exp_body:
        return True
    return False


def _scan_account_numbers_in_text(
    text: str,
    *,
    payment_method: dict | None = None,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> list[str]:
    """Detecta cuentas destino en texto OCR/correo según el medio elegido."""
    brand = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    norm = (text or '').lower()
    found: list[str] = []

    def _append(items: list[str]) -> None:
        for item in items:
            if item and item not in found:
                found.append(item)

    if brand == 'usdt_erc20':
        _append(_scan_erc20_wallets_lenient(text))
        return found
    if brand == 'usdt_trc20':
        _append(_scan_trc20_wallets_lenient(text))
        return found

    if brand == 'nequi' or ('nequi' in norm and brand != 'binance'):
        _append(_scan_nequi_destination_phones(text))
        _append(_scan_nequi_bancolombia_accounts(text))
        if brand == 'nequi':
            return found

    if brand == 'daviplata' or ('daviplata' in norm and brand != 'binance'):
        _append(_scan_daviplata_destination_phones(text))
        if brand == 'daviplata':
            return found

    if _text_looks_like_binance_usdt_comprobante(text) and brand in ('', 'binance'):
        return _scan_binance_pay_accounts(text)

    for raw in _find_by_regexes(text, _GLOBAL_ACCOUNT_REGEXES, group=True):
        norm_acct = digits_only(raw)
        if len(norm_acct) >= 10 and norm_acct not in found:
            if not _digits_embedded_in_long_id(norm_acct, text):
                found.append(norm_acct)
    _append(_scan_daviplata_destination_phones(text))
    _append(_scan_nequi_destination_phones(text))
    _append(_scan_nequi_bancolombia_accounts(text))
    _append(_scan_binance_pay_accounts(text))
    return found


def _binance_account_candidate_ok(digits: str, text: str, found: list[str]) -> bool:
    if not (8 <= len(digits) <= 12):
        return False
    if _is_binance_order_id_digits(digits):
        return False
    if digits in found:
        return False
    if _digits_embedded_in_long_id(digits, text):
        return False
    return True


def _scan_binance_pay_accounts(text: str) -> list[str]:
    """ID de cuenta Binance Pay (8-12 dígitos) debajo del nombre del destinatario."""
    norm = _normalize_text_for_match(text)
    if not _text_looks_like_binance_usdt_comprobante(text):
        if 'usdt' not in norm and 'pago completado' not in norm and 'pago exitoso' not in norm:
            return []
    found: list[str] = []

    def _collect_from_chunk(chunk: str) -> None:
        for m in re.finditer(r'(?<!\d)(\d{8,12})(?!\d)', chunk or ''):
            digits = digits_only(m.group(1))
            if _binance_account_candidate_ok(digits, text, found):
                found.append(digits)

    # Antes del bloque «Id. de la orden» suele ir el ID de cuenta del destinatario.
    before_order = re.split(
        r'id\.?\s*de\s*la\s*orden',
        norm,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    _collect_from_chunk(before_order)

    patterns = (
        r'(?:^|\s)(\d{8,12})(?:\s+(?:id\.|metodo|método|se\s+pag|cuenta\s+de\s+spot))',
        r'(?:pago\s+completado|pago\s+exitoso)[^\d]{0,500}(\d{8,12})(?=[^\d]{0,80}(?:id\.|metodo|cuenta\s+de\s+spot))',
        r'\ba\s+[a-z][^\d]{8,200}?(\d{8,12})(?=[^\d]{0,60}(?:id\.|metodo|cuenta\s+de\s+spot))',
    )
    for pat in patterns:
        for m in re.finditer(pat, norm, re.IGNORECASE):
            digits = digits_only(m.group(1))
            if _binance_account_candidate_ok(digits, text, found):
                found.append(digits)

    if not found:
        _collect_from_chunk(norm)
    return found


def _text_has_nequi_pago_exitoso(norm: str) -> bool:
    return 'pago exitoso' in norm or 'pago exitos' in norm


def _scan_nequi_pago_referencia_codes(text: str) -> list[str]:
    """Referencia Nequi «Pago exitoso» (ej. M13471419), aunque OCR omita la etiqueta."""
    found: list[str] = []
    for m in re.finditer(
        r'(?:referencia|referen[cg][a-z]*|rela)[\s\S]{0,80}?(?:M\s*)?(\d{7,10})\b',
        text or '',
        re.IGNORECASE | re.DOTALL,
    ):
        raw = str(m.group(1) or '').strip()
        tok = _normalize_receipt_token(raw if raw.upper().startswith('M') else f'M{raw}')
        if tok and tok not in found:
            found.append(tok)
    for m in re.finditer(r'\b([Mm]\d{7,10})\b', text or '', re.IGNORECASE):
        tok = _normalize_receipt_token(m.group(1))
        if tok and tok not in found:
            found.append(tok)
    return found


def _scan_nequi_pago_bancolombia_accounts(text: str) -> list[str]:
    """Cuenta destino en Nequi «Pago exitoso» → Bancolombia (OCR sin etiquetas)."""
    if _text_looks_like_bancolombia_to_nequi_receipt(text):
        return []
    norm = _normalize_text_for_match(text)
    if not (
        _text_has_nequi_pago_exitoso(norm)
        or 'envio a banco' in norm
        or ('nequi' in norm and 'bancolombia' in norm)
    ):
        return []
    found: list[str] = []
    for m in re.finditer(
        r'(?:numero\s+de\s+cuenta|n[uú]mero\s+de\s+cuenta)[^\d]{0,70}(\d{10,12})',
        text or '',
        re.IGNORECASE | re.DOTALL,
    ):
        digits = digits_only(m.group(1))
        if len(digits) >= 10 and digits not in found:
            found.append(digits)
    if _text_has_nequi_pago_exitoso(norm) or 'envio a banco' in norm:
        for m in re.finditer(r'(?<!\d)(\d{11})(?!\d)', text or ''):
            digits = digits_only(m.group(1))
            if len(digits) == 11 and digits not in found:
                found.append(digits)
    return found


def _scan_nequi_bancolombia_accounts(text: str) -> list[str]:
    """Cuenta destino (10-12 dígitos) en comprobante Nequi «Envío a banco» → Bancolombia."""
    found = _scan_nequi_pago_bancolombia_accounts(text)
    if found:
        return found
    norm = (text or '').lower()
    if 'nequi' not in norm or 'bancolombia' not in norm:
        return []
    for m in re.finditer(
        r'(?:numero\s+de\s+cuenta|n[uú]mero\s+de\s+cuenta)[^\d]{0,70}(\d{10,12})',
        text,
        re.IGNORECASE | re.DOTALL,
    ):
        digits = digits_only(m.group(1))
        if len(digits) >= 10 and digits not in found:
            found.append(digits)
    return found


def _scan_bancolombia_app_nequi_destination_phones(text: str) -> list[str]:
    """Celular Nequi bajo «Producto destino» en app Bancolombia («Transferencia exitosa»)."""
    found: list[str] = []
    for m in re.finditer(
        r'producto\s+destino[\s\S]{0,100}?nequi[\s\S]{0,60}?(\d{10})\b',
        text or '',
        re.IGNORECASE,
    ):
        norm = digits_only(m.group(1))
        if len(norm) == 10 and norm.startswith('3') and norm not in found:
            found.append(norm)
    for m in re.finditer(
        r'(?:^|\n)\s*nequi\s*\n\s*(\d{10})\b',
        text or '',
        re.IGNORECASE | re.MULTILINE,
    ):
        norm = digits_only(m.group(1))
        if len(norm) == 10 and norm.startswith('3') and norm not in found:
            found.append(norm)
    return found


def _scan_bancolombia_app_comprobante_numbers(text: str) -> list[str]:
    """Número de comprobante en app Bancolombia (alfanumérico o solo dígitos, ej. 0000046300)."""
    found: list[str] = []
    for pattern in (
        r'comprobante\s*no\.?\s*:?\s*([A-Za-z0-9]{6,14})\b',
        r'comprobante\s*no\.?\s*:?\s*(\d{6,14})',
    ):
        for m in re.finditer(pattern, text or '', re.IGNORECASE):
            tok = _normalize_receipt_token(m.group(1))
            if tok and tok not in found:
                found.append(tok)
    return found


def _scan_bancolombia_app_alphanumeric_receipt(text: str) -> list[str]:
    """Alias legado: comprobante app Bancolombia."""
    return _scan_bancolombia_app_comprobante_numbers(text)


def _scan_bancolombia_app_destination_accounts(text: str) -> list[str]:
    """Cuenta ahorros bajo «Producto destino» (app Bancolombia, pantalla de secciones)."""
    found: list[str] = []
    for m in re.finditer(
        r'producto\s+destino[\s\S]{0,220}?ahorros[\s\S]{0,90}?'
        r'(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
        text or '',
        re.IGNORECASE,
    ):
        digits = digits_only(m.group(1))
        if len(digits) == 11 and digits not in found:
            found.append(digits)
    for m in re.finditer(
        r'producto\s+destino[\s\S]{0,220}?(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
        text or '',
        re.IGNORECASE,
    ):
        digits = digits_only(m.group(1))
        if len(digits) == 11 and digits not in found:
            found.append(digits)
    if not found:
        norm = _normalize_text_for_match(text)
        if 'producto destino' in norm:
            for m in re.finditer(
                r'(?:^|\n)\s*ahorros\s*\n\s*(\d{3}\s*[-–—\s.]+\d{6}\s*[-–—\s.]+\d{2})',
                text or '',
                re.IGNORECASE | re.MULTILINE,
            ):
                digits = digits_only(m.group(1))
                if len(digits) == 11 and digits not in found:
                    found.append(digits)
    return found


def _text_looks_like_bancolombia_app_transfer_exitosa_receipt(text: str) -> bool:
    """App Bancolombia — «Transferencia exitosa» a contacto/cuenta (Producto destino/origen)."""
    if _text_looks_like_bancolombia_to_nequi_receipt(text):
        return False
    norm = _normalize_text_for_match(text)
    if 'transferencia exitosa' not in norm:
        return False
    if 'producto destino' not in norm or 'producto origen' not in norm:
        return False
    if not (
        'valor de la transferencia' in norm
        or 'datos de la transferencia' in norm
    ):
        return False
    if 'nequi' in norm or 'nequ' in norm:
        return False
    if any(
        tok in norm
        for tok in (
            'bre-b',
            'breb',
            'breve',
            'kamin',
            'llave',
            'envio realizado',
            'pago exitoso',
            'envio a banco',
            'banco destino',
        )
    ):
        return False
    return bool(_scan_bancolombia_app_destination_accounts(text))


def _infer_bancolombia_app_transfer_exitosa_receipt(
    text: str,
    matched_patterns: list[dict] | None = None,
) -> bool:
    if _text_looks_like_bancolombia_app_transfer_exitosa_receipt(text):
        return True
    if any(
        str(p.get('id') or '') == 'bancolombia_app_transfer_exitosa'
        for p in (matched_patterns or [])
    ):
        return True
    return False


def _text_looks_like_bancolombia_to_nequi_receipt(text: str) -> bool:
    """App Bancolombia → Nequi («¡Transferencia exitosa!», producto destino Nequi)."""
    norm = _normalize_text_for_match(text)
    if not ('transferencia exitosa' in norm and 'comprobante' in norm):
        return False
    if _text_has_nequi_pago_exitoso(norm):
        return False
    if 'producto destino' not in norm:
        return False
    if 'nequi' not in norm and 'nequ' not in norm:
        return False
    if _scan_nequi_pago_referencia_codes(text):
        return False
    return bool(_scan_bancolombia_app_nequi_destination_phones(text))


def _infer_bancolombia_to_nequi_receipt(
    text: str,
    matched_patterns: list[dict] | None = None,
) -> bool:
    if _text_looks_like_bancolombia_to_nequi_receipt(text):
        return True
    if any(
        str(p.get('id') or '') == 'bancolombia_to_nequi'
        for p in (matched_patterns or [])
    ):
        return True
    return False


def _nequi_producto_phones_in_text(text: str) -> list[str]:
    """Celular Nequi en campo PRODUCTO (tiquete corresponsal / Redeban)."""
    found: list[str] = []
    for m in re.finditer(
        r'(?:producto)\s*[;:\s]*(\d{10})\b',
        text or '',
        re.IGNORECASE,
    ):
        norm = digits_only(m.group(1))
        if len(norm) == 10 and norm.startswith('3') and norm not in found:
            found.append(norm)
    for m in re.finditer(
        r'(?:producto)[^\d]{0,32}(\d{3}\s*\d{3}\s*\d{4})',
        text or '',
        re.IGNORECASE | re.DOTALL,
    ):
        norm = digits_only(m.group(1))
        if len(norm) == 10 and norm.startswith('3') and norm not in found:
            found.append(norm)
    return found


def _text_looks_like_nequi_corresponsal_receipt(text: str) -> bool:
    norm = _normalize_text_for_match(text)
    if any(
        tok in norm
        for tok in (
            'recarga nequ',
            'recarga nequi',
            'corresponsal bancolombia',
            'corresponsal',
            'redeban',
        )
    ):
        return True
    if 'nequ' not in norm and 'recarga' not in norm:
        return False
    if not _nequi_producto_phones_in_text(text):
        return False
    return any(
        tok in norm
        for tok in (
            'recarga',
            'redeban',
            'corresponsal',
            'recibo',
            'rrn',
            'apro',
            'multipag',
            'comercio',
        )
    )


def _text_looks_like_nequi_llave_bancolombia_receipt(text: str) -> bool:
    """Nequi app → llave Bre-B en Bancolombia («Envío realizado», «Banco destino»)."""
    if _text_looks_like_bancolombia_app_transfer_exitosa_receipt(text):
        return False
    if _text_looks_like_nequi_corresponsal_receipt(text):
        return False
    if _text_looks_like_bancolombia_to_nequi_receipt(text):
        return False
    if _text_looks_like_breb_nequi_receipt(text):
        return False
    if _text_looks_like_daviplata_breb_receipt(text):
        return False
    norm = _normalize_text_for_match(text)
    if 'llave' not in norm or 'bancolombia' not in norm:
        return False
    if 'numero de cuenta' in norm and 'banco destino' not in norm:
        return False
    has_nequi_origin = (
        'envio realizado' in norm
        or 'pago exitoso' in norm
        or _text_has_nequi_pago_exitoso(norm)
        or ('nequi' in norm and 'escanea' in norm)
    )
    has_banco_destino = 'banco destino' in norm
    has_m_ref = bool(_scan_nequi_pago_referencia_codes(text))
    has_llave = bool(
        re.search(
            r'(?:^|\n)\s*llave\s*[:\s]*@?[a-z][a-z0-9]{3,24}',
            text or '',
            re.IGNORECASE | re.MULTILINE,
        )
        or re.search(r'@[a-z][a-z0-9]{3,24}\b', text or '', re.IGNORECASE)
    )
    if has_banco_destino and has_llave and (has_nequi_origin or has_m_ref):
        return True
    if has_nequi_origin and has_llave:
        return True
    return False


def _infer_nequi_llave_bancolombia_receipt(
    text: str,
    matched_patterns: list[dict] | None = None,
) -> bool:
    if _text_looks_like_bancolombia_app_transfer_exitosa_receipt(text):
        return False
    if _text_looks_like_nequi_llave_bancolombia_receipt(text):
        return True
    if any(
        str(p.get('id') or '') == 'nequi_llave_bancolombia'
        for p in (matched_patterns or [])
    ):
        return True
    return False


def _text_looks_like_nequi_envio_bancolombia_receipt(text: str) -> bool:
    """Nequi app → cuenta Bancolombia («Pago exitoso» o «Envío a banco»), no app Bancolombia ni Bre-B."""
    if _text_looks_like_bancolombia_app_transfer_exitosa_receipt(text):
        return False
    if _text_looks_like_nequi_llave_bancolombia_receipt(text):
        return False
    if _text_looks_like_nequi_corresponsal_receipt(text):
        return False
    norm = _normalize_text_for_match(text)
    if 'transferencia exitosa' in norm and 'comprobante' not in norm:
        if 'producto destino' in norm and 'producto origen' in norm:
            return False
    if 'transferencia exitosa' in norm and 'comprobante' in norm:
        return False
    if any(tok in norm for tok in ('bre-b', 'breb', 'breve', 'kamin', 'llave')):
        return False
    has_pago_exitoso = _text_has_nequi_pago_exitoso(norm)
    has_envio_banco = 'envio a banco' in norm
    m_refs = _scan_nequi_pago_referencia_codes(text)
    banco_accts = _scan_nequi_pago_bancolombia_accounts(text)
    if (has_pago_exitoso or has_envio_banco) and m_refs and banco_accts:
        return True
    if 'bancolombia' not in norm:
        return False
    has_cuenta = 'numero de cuenta' in norm
    has_referencia_m = bool(m_refs)
    if has_cuenta and (has_pago_exitoso or has_envio_banco or has_referencia_m):
        return True
    if banco_accts and (has_pago_exitoso or has_envio_banco):
        return True
    return False


def _infer_nequi_envio_bancolombia_receipt(
    text: str,
    matched_patterns: list[dict] | None = None,
) -> bool:
    if _text_looks_like_bancolombia_app_transfer_exitosa_receipt(text):
        return False
    if _text_looks_like_nequi_llave_bancolombia_receipt(text):
        return False
    if _text_looks_like_bancolombia_to_nequi_receipt(text):
        return False
    if _text_looks_like_nequi_envio_bancolombia_receipt(text):
        return True
    if any(
        str(p.get('id') or '') == 'nequi_envio_bancolombia'
        for p in (matched_patterns or [])
    ):
        return True
    return False


def _infer_nequi_corresponsal_receipt(
    text: str,
    matched_patterns: list[dict] | None = None,
    account_numbers: list[str] | None = None,
) -> bool:
    if _text_looks_like_nequi_corresponsal_receipt(text):
        return True
    if any(
        str(p.get('id') or '') == 'nequi_corresponsal_redeban'
        for p in (matched_patterns or [])
    ):
        return True
    if _nequi_producto_phones_in_text(text) and re.search(
        r'recarga|redeban|corresponsal|recibo|rrn|apro|multipag|comercio',
        text or '',
        re.IGNORECASE,
    ):
        return True
    if (
        _nequi_producto_phones_in_text(text)
        and re.search(r'valor', text or '', re.IGNORECASE)
        and re.search(r'\$', text or '')
    ):
        return True
    return False


def _amount_colombia_display_variants(whole: int) -> list[str]:
    variants = [str(whole)]
    if whole >= 1000:
        variants.append(f'{whole:,}'.replace(',', '.'))
        parts: list[str] = []
        n = whole
        while n:
            parts.append(f'{n % 1000:03d}')
            n //= 1000
        if parts:
            variants.append('.'.join(reversed(parts)))
    return variants


def _amount_near_valor_or_peso_marker(text: str, amt: Decimal) -> bool:
    whole = _amount_whole_units(amt)
    if whole <= 0:
        return False
    for variant in _amount_colombia_display_variants(whole):
        esc = re.escape(variant)
        if re.search(
            rf'(?:valor|monto|total|\$)\s*[^\d]{{0,16}}{esc}(?!\d)',
            text or '',
            re.IGNORECASE,
        ):
            return True
    return False


def _nequi_corresponsal_amounts(text: str) -> list[Decimal]:
    """Monto en barra VALOR del tiquete Redeban (evita RRN, APRO, C.UNICO)."""
    found: list[Decimal] = []
    patterns = (
        r'valor[\s\S]{0,120}?\$\s*(\d{1,3}(?:\.\d{3})+)(?!\d)',
        r'recarga\s+nequ\w*[\s\S]{0,160}?\$\s*(\d{1,3}(?:\.\d{3})+)(?!\d)',
        r'\$\s*(\d{1,3}(?:\.\d{3})+)(?!\d)',
    )
    for pat in patterns:
        for m in re.finditer(pat, text or '', re.IGNORECASE):
            raw = m.group(1)
            val = _normalize_amount(raw)
            if val is None:
                continue
            if not _amount_near_valor_or_peso_marker(text, val) and not re.search(
                r'valor',
                text[max(0, m.start() - 80): m.end() + 20],
                re.IGNORECASE,
            ):
                continue
            if val not in found:
                found.append(val)
    return found


def _scan_nequi_corresponsal_producto(text: str) -> list[str]:
    """Celular Nequi en tiquete Redeban / corresponsal (campo PRODUCTO)."""
    if not _infer_nequi_corresponsal_receipt(text):
        return []
    return _nequi_producto_phones_in_text(text)


def _pick_best_receipt_number(receipt_numbers: list[str] | None) -> str | None:
    """Prefiere el comprobante más largo (Bre-B Bogotá ~35 dígitos) frente a fragmentos OCR."""
    best = ''
    for raw in receipt_numbers or []:
        tok = _normalize_receipt_token(raw)
        if len(tok) > len(best):
            best = tok
    return best or None


def _receipt_patterns_for_ocr_text(text: str) -> list[dict]:
    patterns = get_analyzer_patterns()
    if _infer_binance_usdt_trc20_detalle_pago(text):
        narrowed = [
            p for p in patterns
            if str(p.get('id') or '') == 'binance_usdt_trc20_detalle_pago'
        ]
        if narrowed:
            return narrowed
    if _infer_binance_usdt_erc20_detalle_pago(text):
        narrowed = [
            p for p in patterns
            if str(p.get('id') or '') == 'binance_usdt_erc20_detalle_pago'
        ]
        if narrowed:
            return narrowed
    if _infer_bancolombia_app_transfer_exitosa_receipt(text):
        narrowed = [
            p for p in patterns
            if str(p.get('id') or '') == 'bancolombia_app_transfer_exitosa'
        ]
        if narrowed:
            return narrowed
    if _infer_bancolombia_to_nequi_receipt(text):
        narrowed = [p for p in patterns if str(p.get('id') or '') == 'bancolombia_to_nequi']
        if narrowed:
            return narrowed
    if _infer_breb_nequi_receipt(text):
        narrowed = [p for p in patterns if str(p.get('id') or '') == 'breb_nequi_comprobante']
        if narrowed:
            return narrowed
    if _infer_nequi_llave_bancolombia_receipt(text):
        narrowed = [p for p in patterns if str(p.get('id') or '') == 'nequi_llave_bancolombia']
        if narrowed:
            return narrowed
    if _infer_nequi_envio_bancolombia_receipt(text):
        narrowed = [p for p in patterns if str(p.get('id') or '') == 'nequi_envio_bancolombia']
        if narrowed:
            return narrowed
    if _infer_nequi_corresponsal_receipt(text):
        narrowed = [p for p in patterns if str(p.get('id') or '') == 'nequi_corresponsal_redeban']
        if narrowed:
            return narrowed
    if _infer_daviplata_breb_receipt(text):
        narrowed = [p for p in patterns if str(p.get('id') or '') == 'daviplata_breb_comprobante']
        if narrowed:
            return narrowed
    return patterns


def _apply_extracted_receipt_datetime(out: dict[str, Any], extracted: dict[str, Any]) -> None:
    time_parsed, time_raw = _select_best_receipt_time(
        extracted.get('receipt_times_raw') or [],
        extracted.get('receipt_times_parsed') or [],
        extracted.get('receipt_times_datetime_pair_parsed'),
    )
    if time_parsed:
        out['receipt_time_display'] = _format_receipt_time_display(time_parsed)
        out['receipt_time_parsed'] = time_parsed.isoformat()
    elif time_raw:
        out['receipt_time_display'] = time_raw
    if time_raw:
        out['receipt_time_raw'] = time_raw
    date_disp = (
        (extracted.get('receipt_dates_raw') or [None])[0]
        or (extracted.get('receipt_dates_parsed') or [None])[0]
        or out.get('receipt_date_raw')
        or out.get('receipt_date_parsed')
    )
    if date_disp:
        out['receipt_date_raw'] = (
            (extracted.get('receipt_dates_raw') or [None])[0] or out.get('receipt_date_raw')
        )
        parsed_dates = extracted.get('receipt_dates_parsed') or []
        if parsed_dates:
            out['receipt_date_parsed'] = parsed_dates[0]
        time_label = str(out.get('receipt_time_display') or '').strip()
        if time_label:
            out['receipt_datetime_display'] = f'{date_disp} · {time_label}'
        else:
            out['receipt_datetime_display'] = str(date_disp)


def supplement_analyzer_display_fields(analysis: dict[str, Any] | None) -> dict[str, Any] | None:
    """Rellena comprobante, fecha y hora al mostrar filas guardadas (o OCR incompleto)."""
    if not analysis or not isinstance(analysis, dict):
        return analysis
    out = dict(analysis)
    if not str(out.get('receipt_time_display') or '').strip():
        for key in ('receipt_time_raw', 'receipt_time_parsed'):
            candidate = str(out.get(key) or '').strip()
            if candidate:
                parsed = _parse_receipt_time(candidate)
                if parsed:
                    out['receipt_time_display'] = _format_receipt_time_display(parsed)
                    break
    text = str(out.get('raw_text_preview') or '').strip()
    if not text:
        return out
    need_receipt = not str(out.get('receipt_number') or '').strip()
    need_dt = (
        not str(out.get('receipt_datetime_display') or '').strip()
        or not receipt_when_text_has_clock(str(out.get('receipt_datetime_display') or ''))
    )
    if not need_receipt and not need_dt:
        return out
    extracted = _extract_fields_from_patterns(text, _receipt_patterns_for_ocr_text(text))
    _enrich_receipt_datetime_from_ocr(text, extracted)
    if need_receipt:
        for ref in _scan_nequi_pago_referencia_codes(text):
            if ref not in extracted['receipt_numbers']:
                extracted['receipt_numbers'].append(ref)
        best = _pick_best_receipt_number(extracted.get('receipt_numbers'))
        if best:
            out['receipt_number'] = best
            if str(best).upper().startswith('M'):
                out['receipt_number_kind'] = 'referencia'
    if need_dt and (
        extracted.get('receipt_dates_raw')
        or extracted.get('receipt_times_raw')
        or extracted.get('receipt_times_datetime_pair_parsed')
    ):
        _apply_extracted_receipt_datetime(out, extracted)
    return out


def receipt_when_text_has_clock(text: str) -> bool:
    return bool(re.search(r'\d{1,2}:\d{2}', str(text or '')))


def _enrich_receipt_datetime_from_ocr(text: str, extracted: dict[str, Any]) -> None:
    """Fechas OCR: Redeban térmico, Nequi→Bancolombia o Bre-B Bogotá."""
    month = r'(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*'
    bancolombia_app = re.search(
        r'(\d{1,2}\s+' + month + r'\s+\d{4})\s*[-–—]?\s*'
        r'(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
        text or '',
        re.IGNORECASE,
    )
    if bancolombia_app:
        _register_receipt_date(
            bancolombia_app.group(1),
            extracted['receipt_dates_raw'],
            extracted['receipt_dates_parsed'],
            extracted['receipt_times_raw'],
            extracted['receipt_times_parsed'],
        )
        _register_receipt_time(
            bancolombia_app.group(2),
            extracted['receipt_times_raw'],
            extracted['receipt_times_parsed'],
        )
        return
    nequi_banco = re.search(
        r'(\d{1,2}\s+de\s+' + month + r'\s+de\s+\d{4})\s+'
        r'(?:a\s+las|alas)\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
        text or '',
        re.IGNORECASE,
    )
    if nequi_banco:
        _register_receipt_date(
            nequi_banco.group(1),
            extracted['receipt_dates_raw'],
            extracted['receipt_dates_parsed'],
            extracted['receipt_times_raw'],
            extracted['receipt_times_parsed'],
        )
        _register_receipt_time(
            nequi_banco.group(2),
            extracted['receipt_times_raw'],
            extracted['receipt_times_parsed'],
        )
        return
    bogota = re.search(
        r'(\d{1,2}\s+de\s+' + month + r'\s+(?:de[l]?\s+)?\d{4})\s*'
        r'[-–—]\s*(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?|AM|PM))',
        text or '',
        re.IGNORECASE,
    )
    if bogota:
        _register_receipt_date(
            bogota.group(1),
            extracted['receipt_dates_raw'],
            extracted['receipt_dates_parsed'],
            extracted['receipt_times_raw'],
            extracted['receipt_times_parsed'],
        )
        _register_receipt_time(
            bogota.group(2),
            extracted['receipt_times_raw'],
            extracted['receipt_times_parsed'],
        )
        return
    m = re.search(
        rf'({month}\s+\d{{1,2}}\s+\d{{4}})\s+(\d{{1,2}}\s*:\s*\d{{2}}(?:\s*:\s*\d{{2}})?)',
        text or '',
        re.IGNORECASE,
    )
    if not m:
        return
    _register_receipt_date(
        m.group(1),
        extracted['receipt_dates_raw'],
        extracted['receipt_dates_parsed'],
        extracted['receipt_times_raw'],
        extracted['receipt_times_parsed'],
    )
    _register_receipt_time(
        m.group(2),
        extracted['receipt_times_raw'],
        extracted['receipt_times_parsed'],
    )


def _scan_nequi_corresponsal_receipt_numbers(text: str) -> list[str]:
    """RECIBO / RRN / APRO en tiquete Redeban (tolera errores frecuentes de OCR)."""
    if not _infer_nequi_corresponsal_receipt(text):
        return []
    found: list[str] = []
    patterns = (
        r'(?:recib[cog]|recibo)\s*[:\s(]*(\d{5,8})',
        r'(?:rrn|rra)\s*[:\s]*(\d{5,8})',
        r'(?:apro|spro)\s*[:\s]*(\d{5,8})',
    )
    for pat in patterns:
        for m in re.finditer(pat, text or '', re.IGNORECASE):
            tok = _normalize_receipt_token(m.group(1))
            if tok and tok not in found:
                found.append(tok)
    return found


def _nequi_corresponsal_amount_claimed_ok(
    text: str,
    amount_claimed: float,
    currency: str,
    detected_amounts: list[float],
) -> bool:
    """Acepta monto declarado si OCR no leyó VALOR pero no hay otro monto contradictorio."""
    if amount_claimed <= 0:
        return False
    for amt in detected_amounts:
        if _amount_near_valor_or_peso_marker(text, Decimal(str(amt))):
            if not _amounts_equivalent(amount_claimed, amt, currency):
                return False
    return True


def _scan_nequi_destination_phones(text: str) -> list[str]:
    """Celular destino Nequi (10 dígitos) bajo «Número Nequi» o PRODUCTO (corresponsal)."""
    found: list[str] = []
    found.extend(_scan_nequi_corresponsal_producto(text))
    if found:
        return found
    norm_low = (text or '').lower()
    if 'nequi' not in norm_low and 'nequ' not in norm_low:
        return []
    for m in re.finditer(
        r'(?:numero|n[uú]mero)\s+nequi[^\d]{0,60}(\d{3}\s*\d{3}\s*\d{4})',
        text,
        re.IGNORECASE | re.DOTALL,
    ):
        norm = digits_only(m.group(1))
        if len(norm) == 10 and norm.startswith('3') and norm not in found:
            found.append(norm)
    for ph in _scan_bancolombia_app_nequi_destination_phones(text):
        if ph not in found:
            found.append(ph)
    return found


def _daviplata_breb_destination_brand(text: str) -> str:
    """Marca destino en comprobante DaviPlata «Pasaste plata por Bre-B»: nequi o bancolombia."""
    norm = _normalize_text_for_match(text)
    if 'daviplata' not in norm or not re.search(r'bre\s*b|bre-b|breve', norm):
        return ''
    m = re.search(
        r'entidad\s+destino[^\w]{0,30}(nequi|nequ|bancolombia|bogota|bogot[aá])',
        norm,
    )
    if m:
        tok = m.group(1)
        if 'nequi' in tok or 'nequ' in tok:
            return 'nequi'
        if 'bancolombia' in tok or 'bogot' in tok:
            return 'bancolombia'
    return ''


def _scan_daviplata_destination_phones(text: str) -> list[str]:
    """Celular destino DaviPlata (10 dígitos); excluye línea «Desde» del comprobante."""
    if 'daviplata' not in (text or '').lower():
        return []
    found: list[str] = []
    prefer = re.search(
        r'(?:pasaste\s+plata|otro\s+daviplata|plata\s+a|por\s+bre-?\s*b)[^\d]{0,280}(\d{3}\s*\d{3}\s*\d{4})',
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if prefer:
        norm = digits_only(prefer.group(1))
        if len(norm) == 10 and norm.startswith('3'):
            found.append(norm)
    for m in re.finditer(r'(\d{3}\s*\d{3}\s*\d{4})', text):
        window = text[max(0, m.start() - 50): m.start()].lower()
        if 'desde' in window or re.search(r'daviplata\s*[-–—]\s*$', window):
            continue
        norm = digits_only(m.group(1))
        if len(norm) == 10 and norm.startswith('3') and norm not in found:
            found.append(norm)
    return found


_GLOBAL_ACCOUNT_SUFFIX_REGEXES = [
    r'(?:en\s+tu\s+cuenta|cuenta\s+destino|producto\s+destino|cuenta|ahorros)[^\d*]{0,100}\*{2,}(\d{2,4})\b',
    r'\*{3,}(\d{2,4})\b',
    r'(?:termina\s+en|ultimos\s+digitos|últimos\s+dígitos)[^\d]{0,25}(\d{2,4})\b',
]


def receipt_date_matches_upload_day(
    receipt_date: date | None,
    upload_day: date | None,
    *,
    max_days_before: int = RECHARGE_UPLOAD_DATE_MAX_DAYS_BEFORE,
    max_days_after: int = RECHARGE_UPLOAD_DATE_MAX_DAYS_AFTER,
) -> bool | None:
    """True si la fecha del comprobante es coherente con el día en que se envió la solicitud."""
    if not receipt_date or not upload_day:
        return None
    delta = (upload_day - receipt_date).days
    if -max_days_after <= delta <= max_days_before:
        return True
    return False


def _normalize_breb_llave(raw: str) -> str:
    return re.sub(r'[^A-Za-z0-9]', '', str(raw or '')).upper()


def _text_has_ordenante_sas_noise(text: str) -> bool:
    """S.A.S. del ordenante (Kamin suele leer «GROUPS.AS» sin espacios)."""
    return bool(
        re.search(
            r'(?:\bS\.?\s*A\.?\s*S\.?\b|GROUPS\.A\.?S\b|GROUP\s+S\.A\.S)',
            text or '',
            re.IGNORECASE,
        )
    )


def _sanitize_breb_llave_token(val: str, text: str) -> str:
    """Quita sufijos espurios del OCR (p. ej. «SS» pegado desde S.A.S. del ordenante)."""
    val = _normalize_breb_llave(val)
    if not val:
        return val
    # OCR fusiona llave + «S.A.S»: GUSTAVOP8514S.A.S
    sas_merge = re.match(r'^([A-Z][A-Z0-9]{5,22})S\.A\.S$', val, re.IGNORECASE)
    if sas_merge:
        return sas_merge.group(1).upper()
    if not val.endswith('SS') or len(val) < 8:
        return val
    base = val[:-2]
    if len(base) < 6:
        return val
    ctx = text or ''
    if re.search(
        r'(?:llave\s+bre-?\s*b|llave\s+bre\s*b)\s*[:\s]*@?\s*' + re.escape(base) + r'(?:\b|[^a-z0-9])',
        ctx,
        re.IGNORECASE,
    ):
        return base
    if re.search(
        r'@?\s*' + re.escape(base) + r'(?:\b|[^A-Za-z0-9])',
        ctx,
        re.IGNORECASE,
    ):
        return base
    if _text_has_ordenante_sas_noise(ctx) and re.search(r'llave\s+bre', ctx, re.IGNORECASE):
        return base
    return val


def _text_looks_like_breb_nequi_receipt(text: str) -> bool:
    """Comprobante Bre-B → Nequi (app Nequi, Banco de Bogotá, etc.), no corresponsal Redeban."""
    if _text_looks_like_nequi_corresponsal_receipt(text):
        return False
    norm = _normalize_text_for_match(text)
    if 'nequi' not in norm and 'nequ' not in norm:
        return False
    if 'daviplata' in norm:
        return False
    if not re.search(r'bre\s*b|bre-b|breve', norm):
        return False
    if (
        ('transferencia' in norm and 'exitosa' in norm)
        or ('banco' in norm and 'bogot' in norm)
        or 'a la llave' in norm
        or 'ala llave' in norm
        or ('entidad' in norm and 'nequi' in norm)
        or 'valor de la transferencia' in norm
    ):
        return True
    return (
        'llave' in norm
        or 'enviaste' in norm
        or 'comprobante' in norm
        or 'transaccion' in norm
        or 'transacci' in norm
        or 'pasaste' in norm
        or '@' in (text or '')
    )


def _infer_breb_nequi_receipt(
    text: str,
    matched_patterns: list[dict] | None = None,
) -> bool:
    if _text_looks_like_breb_nequi_receipt(text):
        return True
    if any(
        str(p.get('id') or '') == 'breb_nequi_comprobante'
        for p in (matched_patterns or [])
    ):
        return True
    return False


def _text_looks_like_daviplata_breb_receipt(text: str) -> bool:
    norm = _normalize_text_for_match(text)
    if 'daviplata' not in norm:
        return False
    if not re.search(r'bre\s*b|bre-b|breve', norm):
        return False
    return 'pasaste plata' in norm or 'transaccion exitosa' in norm or 'transacci' in norm


def _infer_daviplata_breb_receipt(
    text: str,
    matched_patterns: list[dict] | None = None,
) -> bool:
    if _text_looks_like_daviplata_breb_receipt(text):
        return True
    if any(
        str(p.get('id') or '') == 'daviplata_breb_comprobante'
        for p in (matched_patterns or [])
    ):
        return True
    return False


def _scan_breb_llaves_in_text(text: str) -> list[str]:
    """Llaves Bre-B: Kamin, correo Bancolombia o comprobante DaviPlata «Pasaste plata por Bre-B»."""
    found: list[str] = []
    patterns = [
        r'(?:llave\s+bre-?\s*b|llave\s+bre\s*b)\s*[:\s]*@?([a-z][a-z0-9]{3,24})',
        r'(?:^|\n)\s*llave\s*[:\s]*@?([a-z][a-z0-9]{3,24})',
        r'conectada\s+a\s+la\s+llave\s+@?([a-z][a-z0-9]{3,24})',
    ]
    for raw in _find_by_regexes(text, patterns, group=True):
        val = _sanitize_breb_llave_token(raw, text)
        if val and val not in found:
            found.append(val)
    if _text_looks_like_breb_nequi_receipt(text):
        for m in re.finditer(
            r'(?:a\s*la\s+llave|ala\s+llave)[^\d]{0,50}(\d{10})\b',
            text or '',
            re.IGNORECASE,
        ):
            val = digits_only(m.group(1))
            if len(val) == 10 and val not in found:
                found.append(val)
        for m in re.finditer(
            r'(?:a\s*la\s+llave|ala\s+llave)[^\d@]{0,30}@?([a-z][a-z0-9]{3,24})\b',
            text or '',
            re.IGNORECASE,
        ):
            val = _sanitize_breb_llave_token(m.group(1), text)
            if val and val not in found:
                found.append(val)
        for m in re.finditer(r'\b(3[0-9]{9})\b', text or ''):
            val = digits_only(m.group(1))
            if len(val) == 10 and val not in found:
                found.append(val)
    if (
        _text_looks_like_daviplata_breb_receipt(text)
        or _text_looks_like_breb_nequi_receipt(text)
        or _text_looks_like_nequi_llave_bancolombia_receipt(text)
    ):
        for m in re.finditer(r'@([a-z][a-z0-9]{3,24})\b', text or '', re.IGNORECASE):
            val = _sanitize_breb_llave_token(m.group(1), text)
            if val and val not in found:
                found.append(val)
    if _text_looks_like_daviplata_breb_receipt(text):
        if _daviplata_breb_destination_brand(text) == 'nequi':
            for ph in _scan_daviplata_destination_phones(text):
                if ph not in found:
                    found.append(ph)
    return found


def _scan_account_suffixes_in_text(text: str) -> list[str]:
    """Detecta sufijos enmascarados (****1948) en texto OCR o correo."""
    found: list[str] = []
    for raw in _find_by_regexes(text, _GLOBAL_ACCOUNT_SUFFIX_REGEXES, group=True):
        val = digits_only(raw)
        if val and val not in found:
            found.append(val)
    return found


def _format_account_display(digits: str) -> str:
    d = digits_only(digits)
    if len(d) == 11:
        return f'{d[:3]} - {d[3:9]} - {d[9:]}'
    if len(d) == 10:
        return f'{d[:3]} {d[3:6]} {d[6:]}'
    if len(d) >= 4:
        return '****' + d[-4:]
    return d or '—'


def resolve_account_match(
    expected_digits: str,
    full_accounts: list[str],
    suffixes: list[str] | None = None,
) -> bool | None:
    """
    True: la cuenta del comprobante coincide (número completo o últimos dígitos).
    False: se detectó cuenta en el comprobante y NO coincide con la configurada.
    None: no hay cuenta configurada o no se detectó cuenta en el comprobante.
    """
    raw_expected = str(expected_digits or '').strip()
    if '@' in raw_expected:
        full = [digits_only(a) for a in (full_accounts or []) if digits_only(a)]
        sufs = [digits_only(s) for s in (suffixes or []) if digits_only(s)]
        if not full and not sufs:
            return None
        return False

    exp = digits_only(expected_digits)
    if not exp:
        return None

    full = [digits_only(a) for a in (full_accounts or []) if digits_only(a)]
    sufs = [digits_only(s) for s in (suffixes or []) if digits_only(s)]
    if not full and not sufs:
        return None

    if len(exp) < 4:
        for det in full:
            if len(det) >= 8:
                return False
        return None

    if len(exp) < 8:
        for det in full:
            if len(det) >= 8:
                if det == exp:
                    return True
                if len(exp) >= 4 and det.endswith(exp):
                    return True
                return False
        return None

    for det in full:
        if 8 <= len(det) <= 12 and 8 <= len(exp) <= 12 and det == exp:
            return True
        if len(det) >= 8 and det == exp:
            return True
        if len(det) == 10 and len(exp) == 10 and det == exp:
            return True
        if 2 <= len(det) < 8 and exp.endswith(det):
            return True

    for suf in sufs:
        if len(suf) >= 2 and exp.endswith(suf):
            return True

    return False


def _accounts_match_configured(
    expected_digits: str,
    detected_accounts: list[str],
    suffixes: list[str] | None = None,
) -> bool | None:
    """Compat: delega en resolve_account_match (None si no hay evidencia en comprobante)."""
    return resolve_account_match(expected_digits, detected_accounts, suffixes)


def _filter_amount_false_positives(
    amounts: list[Decimal],
    account_numbers: list[str],
    receipt_numbers: list[str] | None = None,
    *,
    text: str = '',
) -> list[Decimal]:
    """Excluye montos que son fragmentos de cuenta o el número de aprobación/comprobante."""
    acct = [digits_only(a) for a in (account_numbers or []) if digits_only(a)]
    receipts = [digits_only(r) for r in (receipt_numbers or []) if digits_only(r)]
    out: list[Decimal] = []
    for amt in amounts:
        amt_str = str(_amount_whole_units(amt))
        if not amt_str:
            continue
        skip = False
        for acc in acct:
            if len(amt_str) >= 5 and amt_str in acc:
                skip = True
                break
        if not skip:
            for rec in receipts:
                rec_digits = digits_only(rec)
                if amt_str == rec or amt_str == rec_digits:
                    skip = True
                    break
                if rec_digits and len(amt_str) >= 5 and amt_str in rec_digits:
                    skip = True
                    break
        if not skip and text and float(amt) < 1000:
            if not _amount_near_valor_or_peso_marker(text, amt):
                skip = True
        if not skip and text and float(amt) >= 10_000:
            if not _amount_near_valor_or_peso_marker(text, amt):
                skip = True
        if not skip and float(amt) > 500_000:
            if not _amount_near_valor_or_peso_marker(text, amt):
                skip = True
        if not skip:
            out.append(amt)
    return out


def _parse_receipt_date(raw: str) -> date | None:
    s = str(raw or '').strip().lower()
    if not s:
        return None

    m_iso = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})\b', s)
    if m_iso:
        try:
            return date(int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3)))
        except ValueError:
            pass

    m = re.search(
        r'(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+(\d{4})',
        s,
        re.IGNORECASE,
    )
    if m:
        day = int(m.group(1))
        month = _SPANISH_MONTHS.get(m.group(2).lower()[:4], _SPANISH_MONTHS.get(m.group(2).lower()[:3]))
        year = int(m.group(3))
        if month:
            try:
                return date(year, month, day)
            except ValueError:
                return None

    m_day_de_month = re.search(
        r'(\d{1,2})\s+de\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+(?:de[l]?\s+)?(\d{4})',
        s,
        re.IGNORECASE,
    )
    if m_day_de_month:
        day = int(m_day_de_month.group(1))
        month = _SPANISH_MONTHS.get(
            m_day_de_month.group(2).lower()[:4],
            _SPANISH_MONTHS.get(m_day_de_month.group(2).lower()[:3]),
        )
        year = int(m_day_de_month.group(3))
        if month:
            try:
                return date(year, month, day)
            except ValueError:
                return None

    m_month_first = re.search(
        r'(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\s+(\d{1,2}|o[l1]de)\s+(?:de\s+)?(\d{4})',
        s,
        re.IGNORECASE,
    )
    if m_month_first:
        month = _SPANISH_MONTHS.get(
            m_month_first.group(1).lower()[:4],
            _SPANISH_MONTHS.get(m_month_first.group(1).lower()[:3]),
        )
        day_raw = m_month_first.group(2).lower()
        day = 1 if re.fullmatch(r'o[l1]de', day_raw) else int(day_raw)
        year = int(m_month_first.group(3))
        if month:
            try:
                return date(year, month, day)
            except ValueError:
                return None

    m2 = re.search(r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})', s)
    if m2:
        d, mo, y = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        if y < 100:
            y += 2000
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    return None


def _time_to_minute(t: time | None) -> time | None:
    """Normaliza a hora:minuto (sin segundos) para comparar y mostrar."""
    if t is None:
        return None
    return t.replace(second=0, microsecond=0)


def _parse_receipt_time(raw: str) -> time | None:
    s = str(raw or '').strip().lower()
    if not s:
        return None
    s = re.sub(r'\s+', ' ', s)

    m = re.search(
        r'(\d{1,2})\s*:\s*(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?',
        s,
        re.IGNORECASE,
    )
    if m:
        hour, minute = int(m.group(1)), int(m.group(2))
        ampm = re.sub(r'[\s.]', '', (m.group(3) or '')).lower()
        if ampm:
            if ampm.startswith('p') and hour < 12:
                hour += 12
            elif ampm.startswith('a') and hour == 12:
                hour = 0
        elif hour > 23:
            return None
        try:
            return _time_to_minute(time(hour, minute, 0))
        except ValueError:
            return None
    return None


def _format_receipt_time_display(t: time) -> str:
    t = _time_to_minute(t) or t
    hour12 = t.hour % 12 or 12
    ampm = 'AM' if t.hour < 12 else 'PM'
    return f'{hour12:02d}:{t.minute:02d} {ampm}'


def _select_best_receipt_time(
    raw_times: list[str],
    parsed_times: list[str],
    preferred_parsed_isos: list[str] | None = None,
) -> tuple[time | None, str | None]:
    preferred = {str(x) for x in (preferred_parsed_isos or []) if x}
    best_t: time | None = None
    best_raw: str | None = None
    best_score = -1
    for i, pt_iso in enumerate(parsed_times or []):
        try:
            t = time.fromisoformat(str(pt_iso))
        except ValueError:
            continue
        raw = raw_times[i] if i < len(raw_times) else ''
        t = _time_to_minute(t) or t
        score = 0
        if str(pt_iso) in preferred or t.isoformat() in preferred:
            score += 10
        if re.search(r'[ap]\.?\s*m', str(raw), re.I):
            score += 2
        if score > best_score:
            best_score = score
            best_t = t
            best_raw = raw or None
    if best_t is None and raw_times:
        for raw in raw_times:
            t = _parse_receipt_time(raw)
            if t:
                return t, raw
    return best_t, best_raw


def _split_date_time_blob(blob: str) -> tuple[str, str | None]:
    """Separa fecha y hora si vinieron en la misma captura OCR."""
    s = str(blob or '').strip()
    if not s:
        return s, None
    month = r'(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*'
    patterns = [
        rf'({month}\s+\d{{1,2}}\s+\d{{4}})\s+(\d{{1,2}}\s*:\s*\d{{2}}(?:\s*:\s*\d{{2}})?\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
        rf'(\d{{1,2}}\s+{month}\s+\d{{4}})\s+(\d{{1,2}}\s*:\s*\d{{2}}(?:\s*:\s*\d{{2}})?\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
        r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s*(?:[ap]\.?\s*m\.?|AM|PM)?)',
    ]
    for rx in patterns:
        m = re.search(rx, s, re.IGNORECASE)
        if m:
            return m.group(1).strip(), m.group(2).strip()
    return s, None


def _register_receipt_time(
    raw_time: str,
    receipt_times: list[str],
    parsed_times: list[str],
) -> None:
    t = _strip_seconds_from_time_raw(raw_time)
    if not t or t in receipt_times:
        return
    receipt_times.append(t)
    pt = _parse_receipt_time(t)
    if pt and pt.isoformat() not in parsed_times:
        parsed_times.append(pt.isoformat())


def _register_receipt_date(
    raw_date: str,
    receipt_dates: list[str],
    parsed_dates: list[str],
    receipt_times: list[str],
    parsed_times: list[str],
) -> None:
    d_raw, t_raw = _split_date_time_blob(raw_date)
    d = str(d_raw or '').strip()
    if not d:
        return
    if d not in receipt_dates:
        receipt_dates.append(d)
        parsed = _parse_receipt_date(d)
        if parsed and parsed.isoformat() not in parsed_dates:
            parsed_dates.append(parsed.isoformat())
    if t_raw:
        _register_receipt_time(t_raw, receipt_times, parsed_times)


def _find_datetime_pairs(text: str, regexes: list[str]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for rx in regexes or []:
        try:
            for m in re.finditer(rx, text, re.IGNORECASE | re.MULTILINE):
                if not m.lastindex or m.lastindex < 2:
                    continue
                d = str(m.group(1)).strip()
                t = str(m.group(2)).strip()
                if d and t and (d, t) not in pairs:
                    pairs.append((d, t))
        except re.error:
            continue
    return pairs


def _scan_times_near_dates(text: str, date_strs: list[str], time_regexes: list[str]) -> list[str]:
    found: list[str] = []
    rxs = list(dict.fromkeys((time_regexes or []) + _GLOBAL_TIME_REGEXES))
    for d in date_strs:
        needle = str(d).lower()
        start = 0
        while True:
            idx = text.lower().find(needle, start)
            if idx < 0:
                break
            win_start = max(0, idx - 50)
            win_end = min(len(text), idx + len(d) + 260)
            window = text[win_start:win_end]
            for t in _find_by_regexes(window, rxs, group=True):
                if t not in found:
                    found.append(t)
            start = idx + max(len(needle), 1)
    return found


def _extract_fields_from_patterns(text: str, patterns: list[dict]) -> dict[str, Any]:
    receipt_numbers: list[str] = []
    receipt_dates: list[str] = []
    parsed_dates: list[str] = []
    receipt_times: list[str] = []
    parsed_times: list[str] = []
    datetime_pair_parsed_isos: list[str] = []
    account_numbers: list[str] = []

    for pat in patterns:
        for r in _find_by_regexes(text, pat.get('receipt_regexes') or [], group=True):
            tok = _normalize_receipt_token(r)
            if tok and tok not in receipt_numbers:
                receipt_numbers.append(tok)
        for d, t in _find_datetime_pairs(text, pat.get('datetime_regexes') or []):
            _register_receipt_date(d, receipt_dates, parsed_dates, receipt_times, parsed_times)
            _register_receipt_time(t, receipt_times, parsed_times)
            pt = _parse_receipt_time(t)
            if pt:
                iso = pt.isoformat()
                if iso not in datetime_pair_parsed_isos:
                    datetime_pair_parsed_isos.append(iso)
        for d in _find_by_regexes(text, pat.get('date_regexes') or [], group=True):
            _register_receipt_date(d, receipt_dates, parsed_dates, receipt_times, parsed_times)
        for t in _find_by_regexes(text, pat.get('time_regexes') or [], group=True):
            _register_receipt_time(t, receipt_times, parsed_times)
        for t in _scan_times_near_dates(
            text,
            receipt_dates,
            (pat.get('time_regexes') or []) + _GLOBAL_TIME_REGEXES,
        ):
            _register_receipt_time(t, receipt_times, parsed_times)
        pat_id = str(pat.get('id') or '').lower()
        min_acct_len = 8 if 'binance' in pat_id else 10
        for a in _find_by_regexes(text, pat.get('account_regexes') or [], group=True):
            norm = digits_only(a)
            if len(norm) < min_acct_len or norm in account_numbers:
                continue
            if _is_binance_order_id_digits(norm):
                continue
            if _digits_embedded_in_long_id(norm, text):
                continue
            account_numbers.append(norm)

    if receipt_dates and not receipt_times:
        for t in _find_by_regexes(text, _GLOBAL_TIME_REGEXES, group=True):
            _register_receipt_time(t, receipt_times, parsed_times)

    for norm in _scan_account_numbers_in_text(text):
        if norm not in account_numbers:
            account_numbers.append(norm)

    receipt_set = set(receipt_numbers)
    account_numbers = _filter_accounts_not_receipt_digits(
        [a for a in account_numbers if a not in receipt_set],
        receipt_numbers,
    )

    return {
        'receipt_numbers': receipt_numbers,
        'receipt_dates_raw': receipt_dates,
        'receipt_dates_parsed': parsed_dates,
        'receipt_times_raw': receipt_times,
        'receipt_times_parsed': parsed_times,
        'receipt_times_datetime_pair_parsed': datetime_pair_parsed_isos,
        'account_numbers': account_numbers,
    }


def _auto_credit_destination_ok(
    *,
    account_match: bool | None,
    expected_account: str,
    is_breb_payment_method: bool,
    is_breb_nequi_payment_method: bool = False,
    breb_llave_match: bool | None,
    payment_method: dict | None,
    payment_method_id: str,
    payment_method_label: str,
) -> bool:
    """Exige evidencia positiva de destino para auto-crédito (no basta con account_match=None)."""
    if is_breb_nequi_payment_method:
        if expected_account:
            return breb_llave_match is True and account_match is True
        return breb_llave_match is True
    if is_breb_payment_method:
        return breb_llave_match is True
    if expected_account:
        return account_match is True
    from app.store.balance_recharge_payment import payment_method_is_generic

    if payment_method_is_generic(payment_method, payment_method_id, payment_method_label):
        return account_match is not False
    return False


def analyze_recharge_proof(
    image_path: str,
    amount_claimed: Decimal,
    currency: str,
    payment_method_id: str,
    *,
    payment_method_label: str = '',
    payment_method_details: str = '',
    payment_method: dict | None = None,
    upload_date: date | None = None,
) -> dict[str, Any]:
    """Analiza comprobante: OCR, montos, comprobante, fecha, cuenta y patrones."""
    text, sources = _extract_text_from_image(image_path)
    patterns = get_analyzer_patterns()
    applicable_pm = _patterns_for_payment_method(
        patterns, currency, payment_method_id, payment_method_label
    )
    nequi_corr_patterns = [
        p for p in patterns
        if str(p.get('id') or '') == 'nequi_corresponsal_redeban'
    ]
    davi_breb_patterns = [
        p for p in patterns
        if str(p.get('id') or '') == 'daviplata_breb_comprobante'
    ]
    breb_nequi_patterns = [
        p for p in patterns
        if str(p.get('id') or '') == 'breb_nequi_comprobante'
    ]
    nequi_banco_patterns = [
        p for p in patterns
        if str(p.get('id') or '') == 'nequi_envio_bancolombia'
    ]
    nequi_llave_banco_patterns = [
        p for p in patterns
        if str(p.get('id') or '') == 'nequi_llave_bancolombia'
    ]
    bancolombia_nequi_patterns = [
        p for p in patterns
        if str(p.get('id') or '') == 'bancolombia_to_nequi'
    ]
    bancolombia_exitosa_patterns = [
        p for p in patterns
        if str(p.get('id') or '') == 'bancolombia_app_transfer_exitosa'
    ]
    binance_erc20_patterns = [
        p for p in patterns
        if str(p.get('id') or '') == 'binance_usdt_erc20_detalle_pago'
    ]
    binance_trc20_patterns = [
        p for p in patterns
        if str(p.get('id') or '') == 'binance_usdt_trc20_detalle_pago'
    ]
    if _infer_binance_usdt_trc20_detalle_pago(text) and binance_trc20_patterns:
        applicable = binance_trc20_patterns
    elif _infer_binance_usdt_erc20_detalle_pago(text) and binance_erc20_patterns:
        applicable = binance_erc20_patterns
    elif _infer_bancolombia_app_transfer_exitosa_receipt(text) and bancolombia_exitosa_patterns:
        applicable = bancolombia_exitosa_patterns
    elif _infer_bancolombia_to_nequi_receipt(text) and bancolombia_nequi_patterns:
        applicable = bancolombia_nequi_patterns
    elif _infer_nequi_corresponsal_receipt(text) and nequi_corr_patterns:
        applicable = nequi_corr_patterns
    elif _infer_nequi_llave_bancolombia_receipt(text) and nequi_llave_banco_patterns:
        applicable = nequi_llave_banco_patterns
    elif _infer_nequi_envio_bancolombia_receipt(text) and nequi_banco_patterns:
        applicable = nequi_banco_patterns
    elif _infer_breb_nequi_receipt(text) and breb_nequi_patterns:
        applicable = breb_nequi_patterns
    elif _infer_daviplata_breb_receipt(text) and davi_breb_patterns:
        applicable = davi_breb_patterns
    else:
        applicable = applicable_pm
        narrowed: list[dict] = []
        for pat in applicable:
            must = [str(x) for x in (pat.get('text_must_contain') or []) if str(x).strip()]
            if not must or _text_contains_all(text, must):
                narrowed.append(pat)
        if narrowed:
            applicable = narrowed
        elif _text_looks_like_bancolombia_app_transfer_exitosa_receipt(text) and bancolombia_exitosa_patterns:
            applicable = bancolombia_exitosa_patterns
        elif _text_looks_like_bancolombia_to_nequi_receipt(text) and bancolombia_nequi_patterns:
            applicable = bancolombia_nequi_patterns
        elif _text_looks_like_nequi_corresponsal_receipt(text) and nequi_corr_patterns:
            applicable = nequi_corr_patterns
        elif _text_looks_like_nequi_llave_bancolombia_receipt(text) and nequi_llave_banco_patterns:
            applicable = nequi_llave_banco_patterns
        elif _text_looks_like_nequi_envio_bancolombia_receipt(text) and nequi_banco_patterns:
            applicable = nequi_banco_patterns
        elif _text_looks_like_breb_nequi_receipt(text) and breb_nequi_patterns:
            applicable = breb_nequi_patterns
        elif _text_looks_like_daviplata_breb_receipt(text) and davi_breb_patterns:
            applicable = davi_breb_patterns
        elif (
            _text_looks_like_binance_usdt_trc20_detalle_pago(text)
            and binance_trc20_patterns
        ):
            applicable = binance_trc20_patterns
        elif (
            _text_looks_like_binance_usdt_erc20_detalle_pago(text)
            and binance_erc20_patterns
        ):
            applicable = binance_erc20_patterns
    pm_token_early = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    if (
        not _infer_binance_usdt_trc20_detalle_pago(text)
        and not _infer_binance_usdt_erc20_detalle_pago(text)
        and not _infer_bancolombia_app_transfer_exitosa_receipt(text)
        and not _infer_bancolombia_to_nequi_receipt(text)
        and not _infer_nequi_corresponsal_receipt(text)
        and not _infer_nequi_llave_bancolombia_receipt(text)
        and not _infer_nequi_envio_bancolombia_receipt(text)
        and not _infer_breb_nequi_receipt(text)
        and not _infer_daviplata_breb_receipt(text)
        and _text_looks_like_binance_usdt_comprobante(text)
        and pm_token_early not in ('nequi', 'daviplata', 'bancolombia', 'breb', 'usdt_erc20', 'usdt_trc20')
    ):
        binance_only = [
            p for p in patterns
            if str(p.get('id') or '') == 'binance_pago_completado_usdt'
            or 'binance' in _normalize_text_for_match(str(p.get('label') or ''))
        ]
        if binance_only:
            applicable = binance_only

    extracted = _extract_fields_from_patterns(text, applicable)
    if _infer_nequi_corresponsal_receipt(text):
        for rec in _scan_nequi_corresponsal_receipt_numbers(text):
            if rec not in extracted['receipt_numbers']:
                extracted['receipt_numbers'].append(rec)
        for ph in _nequi_producto_phones_in_text(text):
            if ph not in extracted['account_numbers']:
                extracted['account_numbers'].append(ph)
    if _infer_bancolombia_app_transfer_exitosa_receipt(text) or _text_looks_like_bancolombia_app_transfer_exitosa_receipt(text):
        for acct in _scan_bancolombia_app_destination_accounts(text):
            if acct not in extracted['account_numbers']:
                extracted['account_numbers'].append(acct)
        for rec in _scan_bancolombia_app_comprobante_numbers(text):
            if rec not in extracted['receipt_numbers']:
                extracted['receipt_numbers'].append(rec)
    if _infer_bancolombia_to_nequi_receipt(text):
        for rec in _scan_bancolombia_app_comprobante_numbers(text):
            if rec not in extracted['receipt_numbers']:
                extracted['receipt_numbers'].append(rec)
        for ph in _scan_bancolombia_app_nequi_destination_phones(text):
            if ph not in extracted['account_numbers']:
                extracted['account_numbers'].append(ph)
    if _infer_binance_usdt_erc20_detalle_pago(text) or _text_looks_like_binance_usdt_erc20_detalle_pago(text):
        for wallet in _scan_erc20_wallets_lenient(text):
            if wallet not in extracted['account_numbers']:
                extracted['account_numbers'].append(wallet)
        for rec in _scan_binance_detalle_pago_order_ids(text):
            if rec not in extracted['receipt_numbers']:
                extracted['receipt_numbers'].append(rec)
    if _infer_binance_usdt_trc20_detalle_pago(text) or _text_looks_like_binance_usdt_trc20_detalle_pago(text):
        for wallet in _scan_trc20_wallets_lenient(text):
            if wallet not in extracted['account_numbers']:
                extracted['account_numbers'].append(wallet)
        for rec in _scan_binance_detalle_pago_order_ids(text):
            if rec not in extracted['receipt_numbers']:
                extracted['receipt_numbers'].append(rec)
    if _infer_nequi_llave_bancolombia_receipt(text) or _text_looks_like_nequi_llave_bancolombia_receipt(text):
        for ref in _scan_nequi_pago_referencia_codes(text):
            if ref not in extracted['receipt_numbers']:
                extracted['receipt_numbers'].append(ref)
        for llave in _scan_breb_llaves_in_text(text):
            if llave not in extracted['account_numbers']:
                extracted['account_numbers'].append(llave)
    if _infer_nequi_envio_bancolombia_receipt(text) or _text_looks_like_nequi_envio_bancolombia_receipt(text):
        for ref in _scan_nequi_pago_referencia_codes(text):
            if ref not in extracted['receipt_numbers']:
                extracted['receipt_numbers'].append(ref)
        for acct in _scan_nequi_pago_bancolombia_accounts(text):
            if acct not in extracted['account_numbers']:
                extracted['account_numbers'].append(acct)
    if _infer_daviplata_breb_receipt(text) or _text_looks_like_daviplata_breb_receipt(text):
        for ph in _scan_daviplata_destination_phones(text):
            if ph not in extracted['account_numbers']:
                extracted['account_numbers'].append(ph)
        for llave in _scan_breb_llaves_in_text(text):
            if llave not in extracted['account_numbers']:
                extracted['account_numbers'].append(llave)
    _enrich_receipt_datetime_from_ocr(text, extracted)
    receipt_number = _pick_best_receipt_number(extracted.get('receipt_numbers'))
    receipt_number_kind = (
        'referencia'
        if receipt_number and str(receipt_number).upper().startswith('M')
        else 'comprobante'
    )
    receipt_date_parsed = None
    if extracted['receipt_dates_parsed']:
        try:
            receipt_date_parsed = date.fromisoformat(extracted['receipt_dates_parsed'][0])
        except ValueError:
            receipt_date_parsed = None

    receipt_time_parsed, receipt_time_raw = _select_best_receipt_time(
        extracted['receipt_times_raw'],
        extracted['receipt_times_parsed'],
        extracted.get('receipt_times_datetime_pair_parsed'),
    )
    receipt_time_display = (
        _format_receipt_time_display(receipt_time_parsed) if receipt_time_parsed else receipt_time_raw
    )
    receipt_date_display = (
        extracted['receipt_dates_raw'][0]
        if extracted['receipt_dates_raw']
        else (receipt_date_parsed.isoformat() if receipt_date_parsed else None)
    )
    receipt_datetime_display = None
    receipt_datetime_parsed = None
    if receipt_date_display and receipt_time_display:
        receipt_datetime_display = f'{receipt_date_display} · {receipt_time_display}'
    elif receipt_date_display:
        receipt_datetime_display = receipt_date_display
    elif receipt_time_display:
        receipt_datetime_display = receipt_time_display
    if receipt_time_parsed:
        receipt_time_parsed = _time_to_minute(receipt_time_parsed)
    if receipt_date_parsed and receipt_time_parsed:
        receipt_datetime_parsed = datetime.combine(receipt_date_parsed, receipt_time_parsed).isoformat()

    from app.store.balance_recharge_payment import (
        build_payment_method_snapshot,
        payment_method_is_generic,
    )

    pm_brand_token = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    account_configured = ''
    account_config_invalid = False
    account_config_rule_hint = None
    if payment_method is not None:
        account_configured = configured_account_digits_from_payment_method(payment_method)
    else:
        account_configured = account_digits_from_details(payment_method_details)
    expected_account, account_config_invalid, account_config_rule_hint = (
        resolve_account_config_for_brand(pm_brand_token, account_configured)
    )
    pm_is_generic = payment_method_is_generic(
        payment_method,
        payment_method_id,
        payment_method_label,
    )
    account_suffixes = _scan_account_suffixes_in_text(text)
    for norm in _scan_account_numbers_in_text(
        text,
        payment_method=payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    ):
        if norm not in extracted['account_numbers']:
            extracted['account_numbers'].append(norm)
    extracted['account_numbers'] = _filter_accounts_not_receipt_digits(
        extracted.get('account_numbers') or [],
        extracted.get('receipt_numbers') or [],
    )
    breb_llave_match = None
    breb_llave_expected = None
    breb_llave_expected_display = None
    breb_llaves_detected: list[str] = []
    is_breb_payment_method = False
    is_breb_nequi_payment_method = False
    is_daviplata_breb = _infer_daviplata_breb_receipt(text)
    is_breb_nequi_receipt = _infer_breb_nequi_receipt(text)
    is_nequi_llave_bancolombia = _infer_nequi_llave_bancolombia_receipt(text)
    if payment_method is not None:
        from app.store.balance_recharge_payment import (
            breb_llave_matches_expected,
            payment_method_breb_llave_display,
            payment_method_breb_llave_normalized,
            payment_method_is_breb_bancolombia,
            payment_method_is_breb_nequi,
        )

        if payment_method_is_breb_nequi(payment_method):
            is_breb_nequi_payment_method = True
            breb_llave_expected = payment_method_breb_llave_normalized(payment_method)
            breb_llave_expected_display = payment_method_breb_llave_display(payment_method)
        elif payment_method_is_breb_bancolombia(payment_method):
            is_breb_payment_method = True
            breb_llave_expected = payment_method_breb_llave_normalized(payment_method)
            breb_llave_expected_display = payment_method_breb_llave_display(payment_method)
        if (
            is_breb_payment_method
            or is_breb_nequi_payment_method
            or is_daviplata_breb
            or is_breb_nequi_receipt
            or is_nequi_llave_bancolombia
        ):
            breb_llaves_detected = _scan_breb_llaves_in_text(text)
        if is_breb_nequi_payment_method and breb_llave_expected:
            exp_phone = digits_only(str(breb_llave_expected))
            if len(exp_phone) == 10 and exp_phone.startswith('3'):
                for acc in (extracted.get('account_numbers') or []) + (account_suffixes or []):
                    if digits_only(str(acc)) == exp_phone and exp_phone not in breb_llaves_detected:
                        breb_llaves_detected.append(exp_phone)
                        break
        uses_breb_llave = is_breb_payment_method or is_breb_nequi_payment_method
        if uses_breb_llave and breb_llave_expected:
            breb_llave_match = breb_llave_matches_expected(
                breb_llave_expected, breb_llaves_detected
            )
        elif uses_breb_llave and breb_llaves_detected:
            breb_llave_match = False

    account_match = None
    if is_breb_payment_method:
        # Los 4 dígitos de cuenta (ej. 1948) no bloquean al usuario; solo la llave Bre-B.
        if breb_llave_match is True:
            account_match = True
        elif breb_llave_match is False:
            account_match = False
    elif is_breb_nequi_payment_method and expected_account:
        account_match = resolve_account_match(
            expected_account,
            extracted['account_numbers'],
            account_suffixes,
        )
    elif expected_account and pm_brand_token in ('usdt_erc20', 'usdt_trc20'):
        account_match = resolve_crypto_wallet_match(
            expected_account,
            extracted['account_numbers'],
            brand=pm_brand_token,
        )
    elif expected_account:
        account_match = resolve_account_match(
            expected_account,
            extracted['account_numbers'],
            account_suffixes,
        )

    upload_day = upload_date
    date_matches_upload = receipt_date_matches_upload_day(receipt_date_parsed, upload_day)

    matched: list[dict] = []
    failed: list[dict] = []
    detected_amounts: list[float] = []

    for pat in applicable:
        pid = pat.get('id') or pat.get('label') or 'pattern'
        must = [str(x) for x in (pat.get('text_must_contain') or []) if str(x).strip()]
        if must and not _text_contains_all(text, must):
            failed.append({'id': pid, 'label': pat.get('label'), 'reason': 'texto_clave_ausente'})
            continue
        amounts = _find_amounts_in_text(text, pat.get('amount_regexes') or [])
        for a in amounts:
            fv = float(a)
            if fv not in detected_amounts:
                detected_amounts.append(fv)
        if amounts:
            matched.append({'id': pid, 'label': pat.get('label'), 'amounts': [float(x) for x in amounts]})
        else:
            failed.append({'id': pid, 'label': pat.get('label'), 'reason': 'monto_no_detectado'})

    receipt_nums_for_filter = list(extracted.get('receipt_numbers') or [])
    if receipt_number and digits_only(receipt_number) not in receipt_nums_for_filter:
        receipt_nums_for_filter.append(digits_only(receipt_number))

    for extra in _filter_amount_false_positives(
        _scan_amounts_in_text(text),
        extracted.get('account_numbers') or [],
        receipt_nums_for_filter,
        text=text,
    ):
        fv = float(extra)
        if fv not in detected_amounts:
            detected_amounts.append(fv)

    detected_amounts = [
        float(x)
        for x in _filter_amount_false_positives(
            [Decimal(str(v)) for v in detected_amounts],
            extracted.get('account_numbers') or [],
            receipt_nums_for_filter,
            text=text,
        )
    ]

    is_nequi_corresponsal = _infer_nequi_corresponsal_receipt(
        text,
        matched,
        extracted.get('account_numbers') or [],
    )
    is_binance_usdt_trc20_detalle = _infer_binance_usdt_trc20_detalle_pago(text, matched)
    is_binance_usdt_erc20_detalle = _infer_binance_usdt_erc20_detalle_pago(text, matched)
    if is_binance_usdt_trc20_detalle:
        matched = [
            p for p in matched
            if str(p.get('id') or '') != 'binance_pago_completado_usdt'
        ]
        trc20_wallets = _scan_trc20_wallets_lenient(text)
        if trc20_wallets:
            extracted['account_numbers'] = list(trc20_wallets)
    if is_binance_usdt_erc20_detalle:
        matched = [
            p for p in matched
            if str(p.get('id') or '') != 'binance_pago_completado_usdt'
        ]
        erc20_wallets = _scan_erc20_wallets_lenient(text)
        if erc20_wallets:
            extracted['account_numbers'] = list(erc20_wallets)
    is_bancolombia_app_transfer_exitosa = _infer_bancolombia_app_transfer_exitosa_receipt(
        text, matched
    )
    is_bancolombia_to_nequi = _infer_bancolombia_to_nequi_receipt(text, matched)
    is_nequi_envio_bancolombia = _infer_nequi_envio_bancolombia_receipt(text, matched)
    is_nequi_llave_bancolombia = _infer_nequi_llave_bancolombia_receipt(text, matched)
    is_daviplata_breb = _infer_daviplata_breb_receipt(text, matched)
    is_daviplata_breb_nequi = (
        is_daviplata_breb and _daviplata_breb_destination_brand(text) == 'nequi'
    )
    is_breb_nequi_receipt = _infer_breb_nequi_receipt(text, matched)
    if is_nequi_corresponsal:
        for ph in _nequi_producto_phones_in_text(text):
            if ph not in (extracted.get('account_numbers') or []):
                extracted.setdefault('account_numbers', []).append(ph)
        for extra_amt in _nequi_corresponsal_amounts(text):
            fv = float(extra_amt)
            if fv not in detected_amounts:
                detected_amounts.append(fv)
        detected_amounts = [
            float(x)
            for x in _filter_amount_false_positives(
                [Decimal(str(v)) for v in detected_amounts],
                extracted.get('account_numbers') or [],
                receipt_nums_for_filter,
                text=text,
            )
        ]

    claimed = float(amount_claimed)
    amount_match = any(_amounts_equivalent(claimed, a, currency) for a in detected_amounts)
    amount_match_via_claimed_fallback = False
    if (
        is_nequi_corresponsal
        and not amount_match
        and account_match is True
        and _nequi_corresponsal_amount_claimed_ok(text, claimed, currency, detected_amounts)
    ):
        amount_match = True
        amount_match_via_claimed_fallback = True

    patterns_ok = len(matched) > 0 and not failed
    if (
        is_nequi_corresponsal
        and account_match is True
        and _nequi_producto_phones_in_text(text)
    ):
        patterns_ok = True
    if (
        is_nequi_llave_bancolombia
        and amount_match
        and breb_llave_match is True
    ):
        patterns_ok = True
    if (
        is_daviplata_breb_nequi
        and amount_match
        and breb_llave_match is True
        and _scan_daviplata_destination_phones(text)
    ):
        patterns_ok = True
    if (
        is_nequi_envio_bancolombia
        and account_match is True
        and amount_match
        and _scan_nequi_bancolombia_accounts(text)
    ):
        patterns_ok = True
    if (
        is_bancolombia_to_nequi
        and account_match is True
        and amount_match
        and _scan_bancolombia_app_nequi_destination_phones(text)
    ):
        patterns_ok = True
    if is_bancolombia_app_transfer_exitosa:
        patterns_ok = bool(
            account_match is True
            and amount_match
            and receipt_number
            and _scan_bancolombia_app_destination_accounts(text)
        )
    if is_binance_usdt_erc20_detalle:
        patterns_ok = bool(
            account_match is True
            and amount_match
            and receipt_number
            and _scan_erc20_wallets_lenient(text)
        )
    if is_binance_usdt_trc20_detalle:
        patterns_ok = bool(
            account_match is True
            and amount_match
            and receipt_number
            and _scan_trc20_wallets_lenient(text)
        )

    ocr_available = _configure_tesseract() and 'ocr' in sources
    notes: list[str] = []
    if not ocr_available:
        notes.append('OCR no disponible en el servidor; revisión manual recomendada.')
    if amount_match_via_claimed_fallback:
        notes.append(
            'Monto declarado aceptado (barra VALOR ilegible en OCR; cuenta Nequi verificada).'
        )
    elif not detected_amounts:
        notes.append('No se detectó monto en la imagen.')
    elif amount_match:
        notes.append('Monto coincide con lo declarado.')
    else:
        notes.append('El monto detectado no coincide con lo declarado.')
    if is_bancolombia_app_transfer_exitosa:
        if amount_match and account_match is True and receipt_number:
            notes.append(
                'Cuenta, monto y comprobante verificados en app Bancolombia.'
            )
        elif amount_match and account_match is True:
            notes.append('Cuenta y monto verificados en app Bancolombia.')
        else:
            notes.append('Comprobante app Bancolombia (transferencia exitosa).')
    if is_binance_usdt_erc20_detalle:
        if amount_match and account_match is True and receipt_number:
            notes.append(
                'USDT ERC20: monto, wallet y ID de orden verificados en Binance.'
            )
        else:
            notes.append('Comprobante Binance USDT ERC20 (detalles del pago).')
    if is_binance_usdt_trc20_detalle:
        if amount_match and account_match is True and receipt_number:
            notes.append(
                'USDT TRC20: monto, wallet y ID de orden verificados en Binance.'
            )
        else:
            notes.append('Comprobante Binance USDT TRC20 (detalles del pago).')
    if receipt_number:
        ref_label = 'Referencia' if receipt_number_kind == 'referencia' else 'Comprobante'
        notes.append(f'{ref_label} detectada: {receipt_number}.')
    if receipt_date_parsed:
        if date_matches_upload is True:
            if upload_day and receipt_date_parsed == upload_day:
                notes.append('La fecha del comprobante coincide con el día del envío (Colombia).')
            else:
                notes.append(
                    'La fecha del comprobante está dentro del plazo permitido respecto al envío.'
                )
        elif date_matches_upload is False:
            notes.append(
                'La fecha del comprobante está fuera del plazo permitido respecto al envío. '
                'Se hará una sola consulta automática al correo desde esa fecha (máx. 7 días).'
            )
    if receipt_time_parsed or receipt_time_raw:
        if receipt_time_display:
            notes.append(f'Hora del comprobante detectada: {receipt_time_display}.')
    if breb_llave_expected:
        expected_label = breb_llave_expected_display or breb_llave_expected
        if breb_llave_match is True:
            notes.append(f'La llave Bre-B coincide ({expected_label}).')
        elif breb_llave_match is False:
            det_label = (
                ', '.join(_breb_llaves_detected_labels(breb_llaves_detected))
                if breb_llaves_detected
                else 'no detectada en la foto'
            )
            notes.append(
                f'La llave Bre-B del comprobante no coincide (en foto: {det_label}; '
                f'medio elegido: {expected_label}).'
            )
    if expected_account and not is_breb_payment_method and not (
        breb_llave_expected and breb_llave_match is False
    ):
        if account_match is True:
            notes.append('La cuenta destino coincide con el medio de pago.')
        elif account_match is False:
            detected = extracted['account_numbers'][0] if extracted['account_numbers'] else None
            if not detected and account_suffixes:
                detected = account_suffixes[0]
            if detected:
                notes.append(
                    f'La cuenta destino no coincide (detectada: {detected}, '
                    f'configurada: {expected_account}).'
                )
            else:
                notes.append(
                    f'No se detectó cuenta en la imagen (esperada: {expected_account}).'
                )

    return {
        'amount_claimed': claimed,
        'amounts_detected': detected_amounts,
        'amount_matches_claimed': amount_match,
        'is_nequi_corresponsal_receipt': is_nequi_corresponsal,
        'is_binance_usdt_erc20_detalle_receipt': is_binance_usdt_erc20_detalle,
        'is_binance_usdt_trc20_detalle_receipt': is_binance_usdt_trc20_detalle,
        'is_bancolombia_app_transfer_exitosa_receipt': is_bancolombia_app_transfer_exitosa,
        'is_bancolombia_to_nequi_receipt': is_bancolombia_to_nequi,
        'is_nequi_envio_bancolombia_receipt': is_nequi_envio_bancolombia,
        'is_nequi_llave_bancolombia_receipt': is_nequi_llave_bancolombia,
        'is_daviplata_breb_receipt': is_daviplata_breb,
        'is_daviplata_breb_nequi_receipt': is_daviplata_breb_nequi,
        'is_breb_nequi_receipt': is_breb_nequi_receipt,
        'patterns_matched': matched,
        'patterns_failed': failed,
        'patterns_ok': patterns_ok,
        'sources': sources,
        'ocr_available': ocr_available,
        'receipt_number': receipt_number,
        'receipt_number_kind': receipt_number_kind if receipt_number else None,
        'receipt_date_raw': extracted['receipt_dates_raw'][0] if extracted['receipt_dates_raw'] else None,
        'receipt_date_parsed': receipt_date_parsed.isoformat() if receipt_date_parsed else None,
        'receipt_time_raw': receipt_time_raw,
        'receipt_time_parsed': receipt_time_parsed.isoformat() if receipt_time_parsed else None,
        'receipt_time_display': receipt_time_display,
        'receipt_datetime_display': receipt_datetime_display,
        'receipt_datetime_parsed': receipt_datetime_parsed,
        'date_matches_upload': date_matches_upload,
        'account_numbers_detected': extracted['account_numbers'],
        'account_suffixes_detected': account_suffixes,
        'account_configured_digits': account_configured or None,
        'account_config_invalid': account_config_invalid,
        'account_config_rule_hint': account_config_rule_hint,
        'account_expected_digits': expected_account or None,
        'account_matches_configured': account_match,
        'is_breb_bancolombia': is_breb_payment_method,
        'is_breb_nequi': is_breb_nequi_payment_method,
        'bre_b_llave_expected': breb_llave_expected or None,
        'bre_b_llave_expected_display': breb_llave_expected_display or None,
        'bre_b_llaves_detected': breb_llaves_detected,
        'bre_b_llave_matches_configured': breb_llave_match,
        'payment_method_label': payment_method_label or None,
        'payment_method_id': payment_method_id or None,
        'payment_brand': pm_brand_token or None,
        'payment_method_is_generic': pm_is_generic,
        'payment_method_snapshot': build_payment_method_snapshot(
            payment_method_id=payment_method_id,
            payment_method_label=payment_method_label,
            payment_method=payment_method,
            currency=currency,
            expected_account=expected_account,
            breb_llave_expected=breb_llave_expected or '',
            is_breb_bancolombia=is_breb_payment_method,
            is_breb_nequi=is_breb_nequi_payment_method,
        ),
        'detected_brands': sorted(_brands_in_text(text)),
        'raw_text_preview': (text[:2000] if text else ''),
        'ready_for_auto': bool(
            amount_match
            and patterns_ok
            and (date_matches_upload is not False)
            and _auto_credit_destination_ok(
                account_match=account_match,
                expected_account=expected_account,
                is_breb_payment_method=is_breb_payment_method,
                is_breb_nequi_payment_method=is_breb_nequi_payment_method,
                breb_llave_match=breb_llave_match,
                payment_method=payment_method,
                payment_method_id=payment_method_id,
                payment_method_label=payment_method_label,
            )
        ),
        'note': ' '.join(notes),
    }


def proof_daviplata_breb_wrong_method_message(
    analysis: dict[str, Any],
    payment_method: dict | None = None,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> str | None:
    """Comprobante DaviPlata «Pasaste plata por Bre-B» exige medio Bre-B con esa llave."""
    from app.store.balance_recharge_payment import (
        payment_method_is_breb_bancolombia,
        payment_method_is_breb_nequi,
    )

    preview = str(analysis.get('raw_text_preview') or '')
    if not (
        analysis.get('is_daviplata_breb_receipt')
        or _infer_daviplata_breb_receipt(
            preview,
            analysis.get('patterns_matched') or [],
        )
    ):
        return None
    dest_nequi = bool(
        analysis.get('is_daviplata_breb_nequi_receipt')
        or _daviplata_breb_destination_brand(preview) == 'nequi'
    )
    if dest_nequi:
        if payment_method_is_breb_nequi(payment_method):
            return None
    elif payment_method_is_breb_bancolombia(payment_method):
        return None
    brand = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    if not dest_nequi and brand in ('breb', 'breve'):
        return None
    chosen = (payment_method_label or payment_method_id or 'otro medio').strip()
    llave = ''
    if dest_nequi:
        llave = _breb_nequi_llave_hint_from_analysis(analysis)
    if not llave:
        for key in analysis.get('bre_b_llaves_detected') or []:
            llave = str(key).strip()
            if llave:
                break
    if not llave:
        for acc in analysis.get('account_numbers_detected') or []:
            d = re.sub(r'[^A-Za-z0-9]', '', str(acc))
            if d and not d.isdigit():
                llave = d
                break
    hint = f' (llave {llave})' if llave else ''
    if dest_nequi:
        return (
            'El comprobante es un envío DaviPlata por Bre-B hacia Nequi'
            f'{hint}, pero seleccionaste «{chosen}». '
            'Elige el medio Bre-B Nequi con esa llave e intenta de nuevo.'
        )
    return (
        'El comprobante es un envío DaviPlata por Bre-B a una llave Bancolombia'
        f'{hint}, pero seleccionaste «{chosen}». '
        'Elige el medio Bre-B Bancolombia con esa llave e intenta de nuevo.'
    )


def _breb_llave_user_label(token: str) -> str:
    """Llave para mensajes al usuario: tal como está, sin anteponer @."""
    return str(token or '').strip()


def _breb_llaves_detected_labels(llaves: list | None) -> list[str]:
    out: list[str] = []
    for raw in llaves or []:
        label = _breb_llave_user_label(raw)
        if label and label not in out:
            out.append(label)
    return out


def _breb_llave_expected_display_from_analysis(analysis: dict[str, Any]) -> str:
    disp = _breb_llave_user_label(analysis.get('bre_b_llave_expected_display'))
    if disp:
        return disp
    return _breb_llave_user_label(analysis.get('bre_b_llave_expected'))


def _account_expected_label_from_analysis(analysis: dict[str, Any]) -> str:
    """Cuenta/correo/wallet del medio para mensajes al usuario (no solo dígitos OCR)."""
    raw = str(analysis.get('account_expected_digits') or '').strip()
    brand = str(analysis.get('payment_brand') or '').strip().lower()
    pm_label = str(analysis.get('payment_method_label') or '').strip().lower()
    is_crypto_wallet = bool(
        raw
        and (
            raw.lower().startswith('0x')
            or (raw.startswith('T') and len(raw) >= 30)
        )
    )
    is_crypto_medium = brand in ('usdt_erc20', 'usdt_trc20') or any(
        tok in pm_label for tok in ('erc20', 'trc20', 'usdt', 'acumulador')
    )
    if raw and (
        '@' in raw
        or brand in ('paypal', 'usdt_erc20', 'usdt_trc20')
        or is_crypto_wallet
        or (is_crypto_medium and len(raw) >= 20)
    ):
        return raw
    configured = str(analysis.get('account_configured_digits') or '').strip()
    if configured and '@' in configured:
        return configured
    d = digits_only(raw or configured)
    if d:
        return _format_account_display(d)
    pm_label = str(analysis.get('payment_method_label') or '').strip()
    return pm_label or '—'


def _breb_nequi_llave_hint_from_analysis(analysis: dict[str, Any]) -> str:
    """Llave destino detectada en comprobante Bre-B Nequi (sin @ ni duplicar celular)."""
    for key in analysis.get('bre_b_llaves_detected') or []:
        val = str(key).strip().lstrip('@')
        if val:
            return val
    for acc in analysis.get('account_numbers_detected') or []:
        d = digits_only(str(acc))
        if len(d) == 10 and d.startswith('3'):
            return d
    return ''


def proof_breb_nequi_wrong_method_message(
    analysis: dict[str, Any],
    payment_method: dict | None = None,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> str | None:
    """Comprobante Nequi por Bre-B exige medio Bre-B Nequi con la llave destino."""
    from app.store.balance_recharge_payment import payment_method_is_breb_nequi

    preview = str(analysis.get('raw_text_preview') or '')
    if (
        analysis.get('is_nequi_llave_bancolombia_receipt')
        or _infer_nequi_llave_bancolombia_receipt(
            preview,
            analysis.get('patterns_matched') or [],
        )
    ):
        return None
    if not (
        analysis.get('is_breb_nequi_receipt')
        or _infer_breb_nequi_receipt(
            preview,
            analysis.get('patterns_matched') or [],
        )
    ):
        return None
    if payment_method_is_breb_nequi(payment_method):
        return None
    brand = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    llave = _breb_nequi_llave_hint_from_analysis(analysis)
    hint = f' (llave {llave})' if llave else ''
    if brand == 'nequi':
        chosen = (payment_method_label or payment_method_id or 'Nequi').strip()
        return (
            'El comprobante es un envío Nequi por Bre-B'
            f'{hint}, pero seleccionaste «{chosen}» (Nequi clásico). '
            'Elige el medio «Bre-B Nequi» con esa llave e intenta de nuevo.'
        )
    chosen = (payment_method_label or payment_method_id or 'otro medio').strip()
    return (
        'El comprobante es un envío Nequi por Bre-B'
        f'{hint}, pero seleccionaste «{chosen}». '
        'Elige el medio Bre-B Nequi con esa llave e intenta de nuevo.'
    )


def proof_bancolombia_to_nequi_wrong_method_message(
    analysis: dict[str, Any],
    payment_method: dict | None = None,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> str | None:
    """Comprobante app Bancolombia → Nequi exige medio Nequi con ese celular."""
    preview = str(analysis.get('raw_text_preview') or '')
    if not (
        analysis.get('is_bancolombia_to_nequi_receipt')
        or _text_looks_like_bancolombia_to_nequi_receipt(preview)
    ):
        return None
    brand = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    if brand == 'nequi':
        return None
    celular = ''
    for acc in analysis.get('account_numbers_detected') or []:
        d = digits_only(str(acc))
        if len(d) == 10 and d.startswith('3'):
            celular = d
            break
    hint = f' (celular {celular})' if celular else ''
    chosen = (payment_method_label or payment_method_id or 'otro medio').strip()
    if brand == 'bancolombia':
        return (
            'El comprobante es una transferencia desde la app Bancolombia hacia Nequi'
            f'{hint}, pero seleccionaste «{chosen}» (Bancolombia). '
            'Elige el medio Nequi con ese número de celular e intenta de nuevo.'
        )
    return (
        'El comprobante es una transferencia desde la app Bancolombia hacia Nequi'
        f'{hint}, pero seleccionaste «{chosen}». '
        'Elige el medio Nequi con ese número de celular e intenta de nuevo.'
    )


def _nequi_llave_bancolombia_llave_hint_from_analysis(analysis: dict[str, Any]) -> str:
    for key in analysis.get('bre_b_llaves_detected') or []:
        val = str(key).strip().lstrip('@')
        if val:
            return val
    for acc in analysis.get('account_numbers_detected') or []:
        raw = str(acc).strip().lstrip('@')
        if raw and not raw.isdigit():
            return raw
    return ''


def proof_nequi_llave_bancolombia_wrong_method_message(
    analysis: dict[str, Any],
    payment_method: dict | None = None,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> str | None:
    """Nequi → llave Bre-B en Bancolombia exige medio «Bre-B Bancolombia» con esa llave."""
    from app.store.balance_recharge_payment import payment_method_is_breb_bancolombia

    preview = str(analysis.get('raw_text_preview') or '')
    if not (
        analysis.get('is_nequi_llave_bancolombia_receipt')
        or _infer_nequi_llave_bancolombia_receipt(
            preview,
            analysis.get('patterns_matched') or [],
        )
    ):
        return None
    if payment_method_is_breb_bancolombia(payment_method):
        return None
    llave = _nequi_llave_bancolombia_llave_hint_from_analysis(analysis)
    hint = f' (llave @{llave})' if llave else ''
    chosen = (payment_method_label or payment_method_id or 'otro medio').strip()
    brand = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    if brand == 'bancolombia':
        return (
            'El comprobante es un envío desde Nequi por llave Bre-B hacia Bancolombia'
            f'{hint}, pero seleccionaste «{chosen}» (cuenta Bancolombia tradicional). '
            'Elige el medio «Bre-B Bancolombia» con esa llave e intenta de nuevo.'
        )
    if brand == 'nequi':
        return (
            'El comprobante es un envío desde Nequi por llave Bre-B hacia Bancolombia'
            f'{hint}, pero seleccionaste «{chosen}» (Nequi clásico). '
            'Elige el medio «Bre-B Bancolombia» con esa llave e intenta de nuevo.'
        )
    return (
        'El comprobante es un envío desde Nequi por llave Bre-B hacia Bancolombia'
        f'{hint}, pero seleccionaste «{chosen}». '
        'Elige el medio «Bre-B Bancolombia» con esa llave e intenta de nuevo.'
    )


def proof_nequi_envio_bancolombia_wrong_method_message(
    analysis: dict[str, Any],
    payment_method: dict | None = None,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> str | None:
    """Comprobante Nequi → cuenta Bancolombia exige medio Bancolombia con esa cuenta."""
    preview = str(analysis.get('raw_text_preview') or '')
    if (
        analysis.get('is_bancolombia_to_nequi_receipt')
        or _text_looks_like_bancolombia_to_nequi_receipt(preview)
    ):
        return None
    if (
        analysis.get('is_nequi_llave_bancolombia_receipt')
        or _infer_nequi_llave_bancolombia_receipt(
            preview,
            analysis.get('patterns_matched') or [],
        )
    ):
        return None
    if not (
        analysis.get('is_nequi_envio_bancolombia_receipt')
        or _infer_nequi_envio_bancolombia_receipt(
            preview,
            analysis.get('patterns_matched') or [],
        )
    ):
        return None
    brand = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    if brand == 'bancolombia':
        return None
    cuenta = ''
    for acc in analysis.get('account_numbers_detected') or []:
        d = digits_only(str(acc))
        if len(d) >= 10:
            cuenta = _format_account_display(d)
            break
    hint = f' (cuenta {cuenta})' if cuenta else ''
    chosen = (payment_method_label or payment_method_id or 'otro medio').strip()
    if brand == 'nequi':
        return (
            'El comprobante es un envío desde Nequi hacia una cuenta Bancolombia'
            f'{hint}, pero seleccionaste «{chosen}» (Nequi clásico). '
            'Elige el medio Bancolombia con ese número de cuenta e intenta de nuevo.'
        )
    return (
        'El comprobante es un envío desde Nequi hacia una cuenta Bancolombia'
        f'{hint}, pero seleccionaste «{chosen}». '
        'Elige el medio Bancolombia con ese número de cuenta e intenta de nuevo.'
    )


def _analysis_crypto_wallet_receipt_kind(analysis: dict[str, Any], text: str = '') -> str:
    """'erc20', 'trc20' o '' según comprobante «Detalles del pago» wallet."""
    if analysis.get('is_binance_usdt_trc20_detalle_receipt'):
        return 'trc20'
    if analysis.get('is_binance_usdt_erc20_detalle_receipt'):
        return 'erc20'
    preview = text or str(analysis.get('raw_text_preview') or '')
    if _infer_binance_usdt_trc20_detalle_pago(
        preview, analysis.get('patterns_matched') or []
    ):
        return 'trc20'
    if _infer_binance_usdt_erc20_detalle_pago(
        preview, analysis.get('patterns_matched') or []
    ):
        return 'erc20'
    return ''


def _crypto_network_label(kind: str) -> str:
    return 'ERC20 (Ethereum)' if kind == 'erc20' else 'TRC20 (Tron)'


def _crypto_medium_label_for_kind(kind: str, chosen_label: str = '') -> str:
    """Nombre del medio que debe elegir (incluye Acumulador si aplica)."""
    base = 'USDT ERC20' if kind == 'erc20' else 'USDT TRC20'
    chosen = str(chosen_label or '').strip().lower()
    if chosen.startswith('acumulador '):
        return f'Acumulador {base}'
    return base


def _detected_crypto_wallet(analysis: dict[str, Any]) -> str:
    for acc in analysis.get('account_numbers_detected') or []:
        item = str(acc or '').strip()
        if item.lower().startswith('0x') or item.startswith('T'):
            return item
    return ''


def proof_crypto_wallet_wrong_method_message(
    analysis: dict[str, Any],
    payment_method: dict | None = None,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> str | None:
    """Bloquea si el comprobante es retiro USDT a wallet pero eligieron red/medio distinto."""
    kind = _analysis_crypto_wallet_receipt_kind(analysis)
    if not kind:
        return None
    brand = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    if kind == 'erc20' and brand == 'usdt_erc20':
        return None
    if kind == 'trc20' and brand == 'usdt_trc20':
        return None

    chosen = (payment_method_label or payment_method_id or 'otro medio').strip()
    network = _crypto_network_label(kind)
    correct = _crypto_medium_label_for_kind(kind, chosen)
    wallet = _detected_crypto_wallet(analysis)
    wallet_hint = f' (wallet {wallet})' if wallet else ''
    amount_hint = ' Verifica que el monto coincida exactamente con el de la foto.'

    if brand in ('usdt_erc20', 'usdt_trc20'):
        selected_network = _crypto_network_label(
            'erc20' if brand == 'usdt_erc20' else 'trc20'
        )
        return (
            f'El comprobante es USDT red {network}, pero seleccionaste «{chosen}» '
            f'(red {selected_network}). '
            f'Elige «{correct}»{wallet_hint} e intenta de nuevo.{amount_hint}'
        )

    if brand in ('binance', 'usdt', 'binance_pay'):
        return (
            f'El comprobante es transferencia USDT a wallet {network}, '
            f'no pago por ID de cuenta Binance. '
            f'Seleccionaste «{chosen}»; elige «{correct}»{wallet_hint} e intenta de nuevo.{amount_hint}'
        )

    return (
        f'El comprobante es transferencia USDT a wallet {network}. '
        f'Seleccionaste «{chosen}»; elige «{correct}»{wallet_hint} e intenta de nuevo.{amount_hint}'
    )


def proof_binance_id_wrong_method_message(
    analysis: dict[str, Any],
    payment_method: dict | None = None,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> str | None:
    """Bloquea si el comprobante es pago Binance por ID pero eligieron wallet ERC20/TRC20."""
    if _analysis_crypto_wallet_receipt_kind(analysis):
        return None
    preview = str(analysis.get('raw_text_preview') or '')
    if not _text_looks_like_binance_usdt_comprobante(preview):
        return None
    brand = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    if brand not in ('usdt_erc20', 'usdt_trc20'):
        return None
    chosen = (payment_method_label or payment_method_id or 'wallet USDT').strip()
    selected_network = _crypto_network_label(
        'erc20' if brand == 'usdt_erc20' else 'trc20'
    )
    return (
        'El comprobante es un pago Binance por ID de cuenta (número del destinatario), '
        f'no transferencia a wallet {selected_network}. '
        f'Seleccionaste «{chosen}»; elige «Binance (USDT)» con el ID numérico del destinatario.'
    )


def proof_nequi_corresponsal_wrong_method_message(
    analysis: dict[str, Any],
    payment_method: dict | None = None,
    payment_method_id: str = '',
    payment_method_label: str = '',
) -> str | None:
    """Tiquete Redeban «RECARGA NEQUI» exige medio Nequi, no Bancolombia u otro banco."""
    preview = str(analysis.get('raw_text_preview') or '')
    if not (
        analysis.get('is_nequi_corresponsal_receipt')
        or _infer_nequi_corresponsal_receipt(
            preview,
            analysis.get('patterns_matched') or [],
            analysis.get('account_numbers_detected') or [],
        )
    ):
        return None
    brand = payment_method_brand_token(
        payment_method,
        payment_method_id=payment_method_id,
        payment_method_label=payment_method_label,
    )
    if brand == 'nequi':
        return None
    chosen = (payment_method_label or payment_method_id or 'otro medio').strip()
    producto = ''
    for acc in analysis.get('account_numbers_detected') or []:
        d = digits_only(str(acc))
        if len(d) == 10 and d.startswith('3'):
            producto = d
            break
    hint = f' (PRODUCTO {producto})' if producto else ''
    return (
        'El comprobante es una recarga Nequi en corresponsal Bancolombia (tiquete Redeban)'
        f'{hint}, pero seleccionaste «{chosen}». '
        'Elige el medio Nequi con ese número de celular e intenta de nuevo.'
    )


def proof_amount_mismatch_message(analysis: dict[str, Any], currency: str = 'COP') -> str | None:
    """Devuelve mensaje de error si el OCR detectó montos distintos al declarado."""
    detected = list(analysis.get('amounts_detected') or [])
    if analysis.get('is_nequi_corresponsal_receipt') and detected:
        preview = str(analysis.get('raw_text_preview') or '')
        near_valor = [
            float(x)
            for x in detected
            if _amount_near_valor_or_peso_marker(preview, Decimal(str(x)))
        ]
        if near_valor:
            detected = near_valor
    if not detected:
        return None
    if analysis.get('amount_matches_claimed'):
        return None
    cur = (currency or 'COP').upper()

    def _fmt_amount(value: float) -> str:
        if cur == 'USD':
            return f'${float(value):,.2f} {cur}'
        whole = int(round(float(value)))
        return f'${whole:,}'.replace(',', '.') + f' {cur}'

    claimed = float(analysis.get('amount_claimed') or 0)
    if claimed > 0:
        primary = min(
            detected,
            key=lambda x: abs(float(x) - claimed),
        )
    else:
        primary = min(float(x) for x in detected)
    extra = (
        ' En USDT los centavos deben coincidir exactamente (ej. 333,64, no 333,6).'
        if cur == 'USD'
        else ''
    )
    return (
        'La foto y el monto ingresado son diferentes. '
        f'En el comprobante detectamos {_fmt_amount(primary)}. '
        'Verifica el monto e intenta de nuevo.'
        + extra
    )


_BRAND_KEYWORDS: dict[str, list[str]] = {
    'daviplata': ['daviplata', 'davi plata'],
    'bancolombia': ['bancolombia'],
    'nequi': ['nequi'],
    'breve': ['bre-b', 'breve', 'bre b'],
    'breb_bancolombia': ['bre-b', 'breve', 'bre b', 'kamin'],
    'breb_nequi': ['bre-b', 'breve', 'bre b', 'nequi'],
    'binance_pay': ['binance pay', 'binancepay'],
    'binance': ['binance'],
    'paypal': ['paypal'],
    'usdt': ['usdt', 'tether'],
    'usdt_erc20': ['usdt', 'erc20', 'ethereum'],
    'usdt_trc20': ['usdt', 'trc20', 'tron', 'trx'],
}

_BRAND_DISPLAY_LABELS: dict[str, str] = {
    'daviplata': 'DaviPlata',
    'bancolombia': 'Bancolombia',
    'nequi': 'Nequi',
    'breve': 'Bre-B',
    'breb_bancolombia': 'Bre-B Bancolombia',
    'breb_nequi': 'Bre-B Nequi',
    'binance_pay': 'Binance Pay',
    'binance': 'Binance',
    'paypal': 'PayPal',
    'usdt': 'USDT',
    'usdt_erc20': 'USDT ERC20',
    'usdt_trc20': 'USDT TRC20',
}


def _brands_in_text(text: str) -> set[str]:
    if _infer_bancolombia_app_transfer_exitosa_receipt(text):
        return {'bancolombia'}
    if _infer_nequi_corresponsal_receipt(text):
        return {'nequi'}
    if _infer_nequi_llave_bancolombia_receipt(text):
        return {'breb_bancolombia', 'nequi'}
    if _infer_breb_nequi_receipt(text):
        return {'breb_nequi', 'nequi'}
    if _infer_daviplata_breb_receipt(text):
        if _daviplata_breb_destination_brand(text) == 'nequi':
            return {'breb_nequi', 'nequi', 'daviplata'}
        return {'breb_bancolombia', 'daviplata'}

    norm = _normalize_text_for_match(text)
    if _infer_binance_usdt_trc20_detalle_pago(text):
        return {'usdt_trc20', 'usdt'}
    if _infer_binance_usdt_erc20_detalle_pago(text):
        return {'usdt_erc20', 'usdt'}
    if _text_looks_like_binance_usdt_comprobante(text):
        found: set[str] = {'binance', 'usdt'}
        if 'binance pay' in norm or 'binancepay' in norm.replace(' ', ''):
            found.add('binance_pay')
        return found

    found: set[str] = set()
    for brand, keywords in _BRAND_KEYWORDS.items():
        for kw in keywords:
            if _normalize_text_for_match(kw) in norm:
                found.add(brand)
                break
    if _text_looks_like_breb_kamin_comprobante(text):
        found.add('breb_bancolombia')
    return found


def _is_classic_bancolombia_payment(
    payment_method_id: str,
    payment_method_label: str,
    payment_method: dict | None,
) -> bool:
    """Cuenta Bancolombia tradicional (no medio Bre-B Bancolombia)."""
    from app.store.balance_recharge_payment import payment_method_is_breb_bancolombia

    if payment_method_is_breb_bancolombia(payment_method):
        return False
    pb = str((payment_method or {}).get('payment_brand') or '').strip().lower()
    if pb and pb != 'bancolombia':
        return False
    combined = _normalize_text_for_match(f'{payment_method_id} {payment_method_label}')
    if not combined:
        return False
    if any(x in combined for x in ('bre-b', 'bre b', 'breb', 'breve', 'kamin')):
        return False
    return 'bancolombia' in combined


def _text_looks_like_breb_kamin_comprobante(text: str) -> bool:
    """Comprobante Bre-B / Kamin / DaviPlata (no app Bancolombia clásica)."""
    if _text_looks_like_breb_nequi_receipt(text):
        return False
    if _text_looks_like_daviplata_breb_receipt(text):
        return True
    norm = _normalize_text_for_match(text)
    if not norm:
        return False
    if 'kamin' in norm and 'comprobante' in norm:
        return True
    if any(m in norm for m in ('bre b', 'bre-b', 'breve')) and 'comprobante' in norm:
        return 'llave' in norm or 'kamin' in norm
    return False


def _brands_for_payment_method(
    payment_method_id: str,
    payment_method_label: str,
    payment_method: dict | None = None,
) -> set[str]:
    combined = _normalize_text_for_match(f'{payment_method_id} {payment_method_label}')
    found: set[str] = set()
    for brand, keywords in _BRAND_KEYWORDS.items():
        for kw in keywords:
            if _normalize_text_for_match(kw) in combined:
                found.add(brand)
                break
    if payment_method:
        from app.store.balance_recharge_payment import (
            PAYMENT_BRAND_SPEC,
            _linked_brands_from_brand,
        )

        pb = str(payment_method.get('payment_brand') or '').strip().lower()
        if pb in PAYMENT_BRAND_SPEC:
            found.add(pb)
            for b in _linked_brands_from_brand(pb):
                if b in _BRAND_KEYWORDS:
                    found.add(b)
        for brand in payment_method.get('linked_brands') or []:
            b = str(brand or '').strip().lower()
            if b in _BRAND_KEYWORDS:
                found.add(b)
    return found


def _is_accumulator_payment_method(payment_method: dict | None) -> bool:
    if not payment_method:
        return False
    if str(payment_method.get('currency') or '').upper() == 'ACCUM':
        return True
    from app.store.balance_recharge_payment import is_accumulator_method_id

    return is_accumulator_method_id(str(payment_method.get('id') or ''))


def proof_payment_brand_mismatch_message(
    analysis: dict[str, Any],
    payment_method_id: str = '',
    payment_method_label: str = '',
    payment_method: dict | None = None,
) -> str | None:
    """Bloquea si el comprobante es de otro medio (ej. DaviPlata en foto, Bancolombia seleccionado)."""
    from app.store.balance_recharge_payment import (
        payment_method_brand_configured,
        payment_method_is_generic,
    )

    if payment_method_is_generic(payment_method, payment_method_id, payment_method_label):
        return None

    if not payment_method_brand_configured(payment_method):
        chosen = (payment_method_label or payment_method_id or 'este medio').strip()
        return (
            f'El medio «{chosen}» no está configurado: en admin debe elegirse un Medio '
            '(Binance, Nequi, Bancolombia, etc.), no dejar «— Medio de pago —».'
        )

    text = str(analysis.get('raw_text_preview') or '')
    detected_brands: set[str] = set()
    for b in analysis.get('detected_brands') or []:
        key = str(b or '').strip().lower()
        if key:
            detected_brands.add(key)
    if text.strip():
        detected_brands |= _brands_in_text(text)

    if not detected_brands and not text.strip():
        return None

    expected_brands_early = _brands_for_payment_method(
        payment_method_id,
        payment_method_label,
        payment_method,
    )
    is_nequi_corr = bool(
        analysis.get('is_nequi_corresponsal_receipt')
        or _infer_nequi_corresponsal_receipt(
            text,
            analysis.get('patterns_matched') or [],
            analysis.get('account_numbers_detected') or [],
        )
    )
    if is_nequi_corr and 'nequi' in expected_brands_early:
        return None

    is_breb_nequi_corr = bool(
        analysis.get('is_breb_nequi_receipt')
        or _infer_breb_nequi_receipt(
            text,
            analysis.get('patterns_matched') or [],
        )
    )
    if is_breb_nequi_corr and 'breb_nequi' in expected_brands_early:
        return None

    is_nequi_llave_banco = bool(
        analysis.get('is_nequi_llave_bancolombia_receipt')
        or _infer_nequi_llave_bancolombia_receipt(
            text,
            analysis.get('patterns_matched') or [],
        )
    )
    if is_nequi_llave_banco and 'breb_bancolombia' in expected_brands_early:
        return None

    if _is_classic_bancolombia_payment(
        payment_method_id, payment_method_label, payment_method
    ) and _text_looks_like_breb_kamin_comprobante(text):
        chosen = (payment_method_label or payment_method_id or 'Bancolombia').strip()
        return (
            f'El comprobante es de Bre-B / Kamin, pero seleccionaste «{chosen}» '
            '(cuenta Bancolombia tradicional). Elige el medio «Bre-B Bancolombia» e intenta de nuevo.'
        )

    if not detected_brands:
        return None
    expected_brands = _brands_for_payment_method(
        payment_method_id,
        payment_method_label,
        payment_method,
    )
    is_accum = _is_accumulator_payment_method(payment_method)

    if not expected_brands:
        if is_accum and detected_brands:
            shown = ', '.join(
                _BRAND_DISPLAY_LABELS.get(b, b) for b in sorted(detected_brands)
            )
            chosen = (payment_method_label or payment_method_id or 'acumulador').strip()
            return (
                f'El comprobante corresponde a {shown}, pero elegiste el acumulador «{chosen}» '
                'que no está vinculado a ese medio. Usa el acumulador correcto (DaviPlata, Binance, '
                'PayPal, etc.) en Medios de pago.'
            )
        return None

    if detected_brands & expected_brands:
        return None

    if (
        not (detected_brands & _WALLET_CRYPTO_BRANDS)
        and not (expected_brands & _WALLET_CRYPTO_BRANDS)
        and detected_brands & _BINANCE_RELATED_BRANDS
        and expected_brands & _BINANCE_RELATED_BRANDS
    ):
        return None

    shown = ', '.join(_BRAND_DISPLAY_LABELS.get(b, b) for b in sorted(detected_brands))
    chosen = (payment_method_label or payment_method_id or 'otro medio').strip()
    return (
        f'El comprobante parece ser de {shown}, pero seleccionaste {chosen}. '
        'Elige el medio de pago correcto e intenta de nuevo.'
    )


def _receipt_implies_breb_llave_check(analysis: dict[str, Any]) -> bool:
    """True si el comprobante parece Bre-B y debe cruzarse la llave del medio."""
    preview = str(analysis.get('raw_text_preview') or '')
    patterns = analysis.get('patterns_matched') or []
    return bool(
        analysis.get('is_breb_nequi_receipt')
        or _infer_breb_nequi_receipt(preview, patterns)
        or analysis.get('is_nequi_llave_bancolombia_receipt')
        or _infer_nequi_llave_bancolombia_receipt(preview, patterns)
        or analysis.get('is_daviplata_breb_receipt')
        or _infer_daviplata_breb_receipt(preview, patterns)
        or _text_looks_like_breb_kamin_comprobante(preview)
    )


def proof_breb_llave_mismatch_message(analysis: dict[str, Any]) -> str | None:
    """Bloquea el envío si la llave del comprobante no coincide con el medio Bre-B elegido."""
    is_breb = bool(analysis.get('is_breb_bancolombia'))
    is_breb_nequi = bool(analysis.get('is_breb_nequi'))
    uses_breb_llave = is_breb or is_breb_nequi
    expected = str(analysis.get('bre_b_llave_expected') or '').strip().upper()
    if not uses_breb_llave and not expected:
        return None
    if uses_breb_llave and not expected:
        medium = 'Bre-B Nequi' if is_breb_nequi else 'Bre-B'
        return (
            f'El medio {medium} seleccionado no tiene llave configurada. '
            'Contacta al administrador para corregir el medio de pago.'
        )
    if analysis.get('bre_b_llave_matches_configured') is True:
        return None
    detected_labels = _breb_llaves_detected_labels(analysis.get('bre_b_llaves_detected'))
    expected_label = _breb_llave_expected_display_from_analysis(analysis) or expected
    if detected_labels:
        detected_label = ', '.join(detected_labels)
        return (
            'La llave del comprobante no coincide con el medio de pago que seleccionaste. '
            f'En la foto: {detected_label}; medio de pago elegido: {expected_label}. '
            'Verifica el medio de pago e intenta de nuevo.'
        )
    if analysis.get('is_bancolombia_app_transfer_exitosa_receipt'):
        chosen = str(
            analysis.get('payment_method_label')
            or analysis.get('payment_method_id')
            or 'otro medio'
        ).strip()
        return (
            'El comprobante es una transferencia Bancolombia, pero seleccionaste '
            f'«{chosen}». Elige el medio de pago correcto e intenta de nuevo.'
        )
    if not _receipt_implies_breb_llave_check(analysis):
        return None
    return (
        f'No se detectó la llave del medio de pago elegido ({expected_label}). '
        'Verifica el medio de pago e intenta de nuevo.'
    )


def _analysis_requires_account_proof(analysis: dict[str, Any]) -> bool:
    """True si el envío debe exigir ID/cuenta visible y coincidente en la foto."""
    if analysis.get('is_breb_bancolombia') and not analysis.get('is_breb_nequi'):
        return False
    if analysis.get('is_breb_nequi') and not digits_only(
        str(analysis.get('account_expected_digits') or '')
    ):
        return False
    if analysis.get('payment_method_is_generic'):
        return False
    if analysis.get('account_config_invalid'):
        return True
    expected_raw = str(analysis.get('account_expected_digits') or '').strip()
    if expected_raw:
        if '@' in expected_raw:
            return True
        if digits_only(expected_raw):
            return True
    configured_raw = str(analysis.get('account_configured_digits') or '').strip()
    if configured_raw:
        if '@' in configured_raw:
            return True
        if digits_only(configured_raw):
            return True
    return _payment_brand_requires_account_digits(str(analysis.get('payment_brand') or ''))


def proof_account_config_invalid_message(analysis: dict[str, Any]) -> str | None:
    """Bloquea si el admin configuró una cuenta/celular con formato inválido."""
    if not analysis.get('account_config_invalid'):
        return None
    configured = digits_only(str(analysis.get('account_configured_digits') or ''))
    shown = _format_account_display(configured) if configured else '—'
    rule_hint = str(analysis.get('account_config_rule_hint') or 'número de cuenta válido').strip()
    pm_label = str(analysis.get('payment_method_label') or '').strip()
    medium_hint = f' («{pm_label}»)' if pm_label else ''
    return (
        f'El medio de pago{medium_hint} no tiene una cuenta configurada válida en el sistema '
        f'({shown}; se requiere {rule_hint}). Contacta al administrador.'
    )


def proof_account_missing_config_message(analysis: dict[str, Any]) -> str | None:
    """Bloquea medios con marca que exigen cuenta pero sin número en admin."""
    if (
        analysis.get('is_breb_bancolombia')
        and not analysis.get('is_breb_nequi')
    ) or analysis.get('payment_method_is_generic'):
        return None
    if analysis.get('is_breb_nequi'):
        if str(analysis.get('bre_b_llave_expected') or '').strip():
            return None
        pm_label = str(analysis.get('payment_method_label') or '').strip()
        medium_hint = f' («{pm_label}»)' if pm_label else ''
        return (
            f'El medio de pago{medium_hint} no tiene llave Bre-B configurada. '
            'Contacta al administrador antes de enviar comprobantes.'
        )
    if analysis.get('account_config_invalid'):
        return None
    brand = str(analysis.get('payment_brand') or '').strip().lower()
    if not _payment_brand_requires_account_digits(brand):
        return None
    if digits_only(str(analysis.get('account_expected_digits') or '')):
        return None
    if digits_only(str(analysis.get('account_configured_digits') or '')):
        return None
    rule_hint = _ACCOUNT_DIGIT_RULES.get(brand, (0, 0, 'número de cuenta'))[2]
    pm_label = str(analysis.get('payment_method_label') or '').strip()
    medium_hint = f' («{pm_label}»)' if pm_label else ''
    return (
        f'El medio de pago{medium_hint} no tiene {rule_hint} configurado. '
        'Contacta al administrador antes de enviar comprobantes.'
    )


def _receipt_looks_like_bank_transfer(analysis: dict[str, Any]) -> bool:
    """True si el OCR ya identificó un comprobante bancario (no un problema de nitidez)."""
    preview = str(analysis.get('raw_text_preview') or '')
    if analysis.get('is_bancolombia_app_transfer_exitosa_receipt'):
        return True
    if _infer_bancolombia_app_transfer_exitosa_receipt(
        preview,
        analysis.get('patterns_matched') or [],
    ):
        return True
    detected_brands = {str(b or '').strip().lower() for b in (analysis.get('detected_brands') or [])}
    if detected_brands & {'bancolombia', 'nequi', 'daviplata', 'breb_nequi', 'breb_bancolombia'}:
        return True
    for acc in analysis.get('account_numbers_detected') or []:
        d = digits_only(str(acc))
        if len(d) in (10, 11):
            return True
    return False


def _proof_wrong_medium_readable_receipt_message(analysis: dict[str, Any]) -> str | None:
    """Comprobante legible pero de otro medio (p. ej. Bancolombia vs acumulador USDT)."""
    brand = str(analysis.get('payment_brand') or '').strip().lower()
    pm_label = str(analysis.get('payment_method_label') or '').strip()
    pm_label_low = pm_label.lower()
    is_crypto_or_paypal = brand in (
        'usdt_erc20',
        'usdt_trc20',
        'binance',
        'binance_pay',
        'usdt',
        'paypal',
    ) or any(tok in pm_label_low for tok in ('erc20', 'trc20', 'usdt', 'paypal', 'acumulador'))

    if not is_crypto_or_paypal:
        return None
    if not _receipt_looks_like_bank_transfer(analysis):
        return None

    chosen = pm_label or _account_expected_label_from_analysis(analysis)
    detected_parts: list[str] = []
    for acc in analysis.get('account_numbers_detected') or []:
        display = _format_account_display(str(acc))
        if display not in detected_parts:
            detected_parts.append(display)
    if detected_parts:
        detected_label = ', '.join(detected_parts)
        return (
            'El comprobante no corresponde al medio de pago que seleccionaste. '
            f'En la foto detectamos una cuenta bancaria ({detected_label}); '
            f'el medio de pago elegido es «{chosen}». '
            'Elige el medio correcto e intenta de nuevo.'
        )
    return (
        'El comprobante no corresponde al medio de pago que seleccionaste. '
        f'El medio de pago elegido es «{chosen}». '
        'Elige el medio correcto según la foto e intenta de nuevo.'
    )


def proof_account_not_recognized_message(analysis: dict[str, Any]) -> str | None:
    """Bloquea el envío si el medio tiene cuenta configurada pero la foto no la reconoce."""
    if analysis.get('is_breb_bancolombia') and not analysis.get('is_breb_nequi'):
        return None
    if analysis.get('account_config_invalid'):
        return None

    if not _analysis_requires_account_proof(analysis):
        return None

    expected_raw = str(analysis.get('account_expected_digits') or '').strip()
    if not expected_raw:
        return None

    if not analysis.get('ocr_available'):
        return (
            'No se pudo leer la imagen del comprobante. '
            'Sube una captura nítida donde se vea el dato del medio de pago.'
        )

    account_match = analysis.get('account_matches_configured')
    if account_match is True:
        return None
    if account_match is False:
        return None

    wrong_medium_msg = _proof_wrong_medium_readable_receipt_message(analysis)
    if wrong_medium_msg:
        return wrong_medium_msg

    expected_label = _account_expected_label_from_analysis(analysis)
    pm_label = str(analysis.get('payment_method_label') or '').strip()
    medium_hint = f' («{pm_label}»)' if pm_label else ''
    preview = str(analysis.get('raw_text_preview') or '')
    brand = str(analysis.get('payment_brand') or '').strip().lower()
    is_wallet = brand in ('usdt_erc20', 'usdt_trc20') or expected_label.lower().startswith('0x') or (
        expected_label.startswith('T') and len(expected_label) >= 30
    )
    field_hint = 'la dirección o dato del medio' if is_wallet else 'el número o celular del medio'
    binance_hint = ''
    if _text_looks_like_binance_usdt_comprobante(preview):
        binance_hint = (
            ' En Binance USDT debe verse el ID numérico del destinatario (debajo del nombre), '
            'no el Id. de la orden.'
        )
    return (
        'No se reconoció la cuenta del medio de pago en la foto del comprobante. '
        f'Verifica que se vea {field_hint}{medium_hint} ({expected_label}).'
        f'{binance_hint} Luego intenta de nuevo.'
    )


def proof_account_mismatch_message(analysis: dict[str, Any]) -> str | None:
    """Devuelve mensaje de error si el OCR detectó una cuenta distinta a la seleccionada."""
    if analysis.get('is_breb_bancolombia') and not analysis.get('is_breb_nequi'):
        return None
    expected_raw = str(analysis.get('account_expected_digits') or '').strip()
    if not expected_raw:
        return None

    account_match = analysis.get('account_matches_configured')
    if account_match is not False:
        return None

    detected_parts: list[str] = []
    for acc in analysis.get('account_numbers_detected') or []:
        display = _format_account_display(str(acc))
        if display not in detected_parts:
            detected_parts.append(display)
    for suf in analysis.get('account_suffixes_detected') or []:
        display = _format_account_display(str(suf))
        if display not in detected_parts:
            detected_parts.append(display)

    detected_label = ', '.join(detected_parts) if detected_parts else 'otra cuenta'
    expected_label = _account_expected_label_from_analysis(analysis)
    brand = str(analysis.get('payment_brand') or '').strip().lower()
    detected_brands = set(analysis.get('detected_brands') or [])
    if brand == 'paypal' and (
        analysis.get('is_bancolombia_app_transfer_exitosa_receipt')
        or 'bancolombia' in detected_brands
    ):
        chosen = str(analysis.get('payment_method_label') or expected_label).strip()
        return (
            'El comprobante parece ser de Bancolombia, pero seleccionaste '
            f'«{chosen}». Elige el medio de pago correcto e intenta de nuevo.'
        )
    if brand in ('usdt_erc20', 'usdt_trc20') and _receipt_looks_like_bank_transfer(analysis):
        chosen = str(analysis.get('payment_method_label') or expected_label).strip()
        detected_label = ', '.join(detected_parts) if detected_parts else 'una cuenta bancaria'
        return (
            'El comprobante no corresponde al medio de pago que seleccionaste. '
            f'En la foto detectamos {detected_label}; '
            f'el medio de pago elegido es «{chosen}». '
            'Elige el medio correcto e intenta de nuevo.'
        )
    return (
        'La cuenta del comprobante no coincide con el medio de pago que seleccionaste. '
        f'En la foto detectamos {detected_label}; el medio de pago elegido es {expected_label}. '
        'Verifica que hayas seleccionado la cuenta correcta e intenta de nuevo.'
    )
