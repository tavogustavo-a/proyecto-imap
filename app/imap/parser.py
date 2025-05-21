# app/imap/parser.py
import email
import quopri
from bs4 import BeautifulSoup
from email.header import decode_header, make_header
import urllib.parse

def parse_raw_email(raw_bytes):
    """Parsea el correo crudo (bytes) y extrae from/subject/date/text/html/message_id."""
    msg = email.message_from_bytes(raw_bytes)
    from_ = msg.get("From", "")
    raw_subj = msg.get("Subject", "")
    date_ = msg.get("Date", None)
    message_id = msg.get("Message-ID", None)

    # Decodificar subject
    try:
        subject_decoded = str(make_header(decode_header(raw_subj)))
    except:
        subject_decoded = raw_subj

    text_part = ""
    html_part = ""

    # Extraer partes
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            if "attachment" in disp.lower():
                continue

            if ctype == "text/plain":
                try:
                    raw_payload = part.get_payload(decode=True) or b""
                    decoded_str = raw_payload.decode("utf-8", errors="replace")
                    cte = (part.get("Content-Transfer-Encoding") or "").lower()
                    if "quoted-printable" in cte or "=3d" in decoded_str.lower():
                        decoded_str = quopri.decodestring(
                            decoded_str.encode("utf-8", errors="replace")
                        ).decode("utf-8", errors="replace")
                    text_part += decoded_str
                except:
                    pass
            elif ctype == "text/html":
                try:
                    raw_payload = part.get_payload(decode=True) or b""
                    decoded_html = raw_payload.decode("utf-8", errors="replace")
                    html_part += decoded_html
                except:
                    pass
    else:
        ctype = msg.get_content_type()
        if ctype == "text/plain":
            try:
                raw_payload = msg.get_payload(decode=True) or b""
                decoded_str = raw_payload.decode("utf-8", errors="replace")
                cte = (msg.get("Content-Transfer-Encoding") or "").lower()
                if "quoted-printable" in cte or "=3d" in decoded_str.lower():
                    decoded_str = quopri.decodestring(
                        decoded_str.encode("utf-8", errors="replace")
                    ).decode("utf-8", errors="replace")
                text_part = decoded_str.strip()
            except:
                text_part = ""
        elif ctype == "text/html":
            try:
                raw_payload = msg.get_payload(decode=True) or b""
                decoded_html = raw_payload.decode("utf-8", errors="replace")
                html_part = decoded_html.strip()
            except:
                html_part = ""

    text_part = text_part.strip()
    html_part = html_part.strip()

    # Reescribir enlaces salvo Paramount
    # Si from_ contiene "noreply@paramountplus.com" => no reescribimos
    is_paramount = ("noreply@paramountplus.com" in from_.lower())

    if html_part and not is_paramount:
        soup = BeautifulSoup(html_part, "html.parser")
        for a in soup.find_all("a", href=True):
            original_href = a["href"].strip()
            # ignoramos mailto o anchors
            if original_href.lower().startswith("mailto:") or original_href.startswith("#"):
                continue
            encoded = urllib.parse.quote(original_href, safe="")
            a["href"] = f"/admin/redirect_to?url={encoded}"
            a["target"] = "_blank"

        html_part = str(soup)

    return {
        "from": from_,
        "subject": subject_decoded,
        "date": date_,
        "text": text_part,
        "html": html_part,
        "message_id": message_id
    }
