"""Pide a Bloc que cree un cupón de saldo.

La pantalla donde se usa se conecta después. Desde el programa de IMAP
se llama create_coupon(monto) y Bloc guarda el cupón.
"""
import json
import os
import urllib.error
import urllib.request


def create_coupon(amount, code="", note=""):
    url = os.environ.get("BLOC_API_URL", "http://127.0.0.1:8754/api/partner/coupons")
    key = os.environ.get("BLOC_PARTNER_KEY", "").strip()
    if not key:
        raise RuntimeError("Falta BLOC_PARTNER_KEY.")
    body = json.dumps({
        "amount": amount,
        "code": code,
        "note": note or "imap",
    }).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "X-Bloc-Key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise RuntimeError(detail or "Bloc no creó el cupón.") from error
