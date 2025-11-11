# app/imap/parser.py
import email
import quopri
from bs4 import BeautifulSoup
from email.header import decode_header, make_header
import urllib.parse
try:
    import chardet
    HAS_CHARDET = True
except ImportError:
    HAS_CHARDET = False

def safe_decode(raw_payload, default_encoding='utf-8'):
    """Decodifica payload de manera segura, detectando la codificación si es necesario."""
    if not raw_payload:
        return ""
    
    # Si ya es string, devolverlo
    if isinstance(raw_payload, str):
        return raw_payload
    
    # Intentar con la codificación por defecto
    try:
        return raw_payload.decode(default_encoding, errors='replace')
    except (UnicodeDecodeError, AttributeError):
        pass
    
    # Intentar detectar la codificación si chardet está disponible
    if HAS_CHARDET:
        try:
            detected = chardet.detect(raw_payload)
            if detected and detected.get('encoding'):
                encoding = detected['encoding']
                confidence = detected.get('confidence', 0)
                # Solo usar la detección si tiene alta confianza
                if confidence > 0.7:
                    return raw_payload.decode(encoding, errors='replace')
        except:
            pass
    
    # Fallback: intentar codificaciones comunes
    for encoding in ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']:
        try:
            return raw_payload.decode(encoding, errors='replace')
        except (UnicodeDecodeError, LookupError):
            continue
    
    # Último fallback: forzar UTF-8 con replace
    return str(raw_payload, errors='replace')

def parse_raw_email(raw_bytes):
    """Parsea el correo crudo (bytes) y extrae from/subject/date/text/html/message_id."""
    try:
        # Intentar múltiples codificaciones para manejar caracteres especiales
        if isinstance(raw_bytes, str):
            raw_bytes = raw_bytes.encode('utf-8', errors='replace')
        elif not isinstance(raw_bytes, bytes):
            raw_bytes = str(raw_bytes).encode('utf-8', errors='replace')
        
        msg = email.message_from_bytes(raw_bytes)
    except UnicodeDecodeError:
        # Fallback: intentar con diferentes codificaciones
        for encoding in ['utf-8', 'latin-1', 'ascii', 'cp1252']:
            try:
                if isinstance(raw_bytes, str):
                    raw_bytes = raw_bytes.encode(encoding, errors='replace')
                msg = email.message_from_bytes(raw_bytes)
                break
            except (UnicodeDecodeError, UnicodeEncodeError):
                continue
        else:
            # Si todo falla, usar replace para caracteres problemáticos
            if isinstance(raw_bytes, str):
                raw_bytes = raw_bytes.encode('utf-8', errors='replace')
            msg = email.message_from_bytes(raw_bytes)
    from_ = msg.get("From", "")
    raw_subj = msg.get("Subject", "")
    date_ = msg.get("Date", None)
    message_id = msg.get("Message-ID", None)

    # Decodificar subject con mejor manejo de errores
    try:
        subject_decoded = str(make_header(decode_header(raw_subj)))
    except (UnicodeDecodeError, UnicodeEncodeError, LookupError):
        # Intentar decodificación manual con diferentes codificaciones
        try:
            # Primero intentar UTF-8
            if isinstance(raw_subj, bytes):
                subject_decoded = raw_subj.decode('utf-8', errors='replace')
            else:
                subject_decoded = raw_subj
        except:
            # Fallback: usar el subject original con caracteres problemáticos reemplazados
            subject_decoded = str(raw_subj).encode('utf-8', errors='replace').decode('utf-8', errors='replace')
    except Exception:
        # Último fallback
        subject_decoded = str(raw_subj)

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
                    decoded_str = safe_decode(raw_payload)
                    cte = (part.get("Content-Transfer-Encoding") or "").lower()
                    if "quoted-printable" in cte or "=3d" in decoded_str.lower():
                        try:
                            decoded_str = quopri.decodestring(
                                decoded_str.encode("utf-8", errors="replace")
                            ).decode("utf-8", errors="replace")
                        except:
                            # Si falla quopri, mantener el string original
                            pass
                    text_part += decoded_str
                except Exception:
                    # En caso de cualquier error, continuar sin agregar esta parte
                    pass
            elif ctype == "text/html":
                try:
                    raw_payload = part.get_payload(decode=True) or b""
                    decoded_html = safe_decode(raw_payload)
                    html_part += decoded_html
                except Exception:
                    # En caso de cualquier error, continuar sin agregar esta parte
                    pass
    else:
        ctype = msg.get_content_type()
        if ctype == "text/plain":
            try:
                raw_payload = msg.get_payload(decode=True) or b""
                decoded_str = safe_decode(raw_payload)
                cte = (msg.get("Content-Transfer-Encoding") or "").lower()
                if "quoted-printable" in cte or "=3d" in decoded_str.lower():
                    try:
                        decoded_str = quopri.decodestring(
                            decoded_str.encode("utf-8", errors="replace")
                        ).decode("utf-8", errors="replace")
                    except:
                        # Si falla quopri, mantener el string original
                        pass
                text_part = decoded_str.strip()
            except Exception:
                text_part = ""
        elif ctype == "text/html":
            try:
                raw_payload = msg.get_payload(decode=True) or b""
                decoded_html = safe_decode(raw_payload)
                html_part = decoded_html.strip()
            except Exception:
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
