# app/admin/regex.py
import re

FLAGS = re.IGNORECASE | re.MULTILINE | re.DOTALL

def passes_any_regex(mail_dict, regexes):
    """
    Determina si el mail_dict hace match con
    alguna regex habilitada (y con el sender si corresponde).
    """
    body_raw = mail_dict.get("text", "") + mail_dict.get("html", "")
    sender_lower = mail_dict.get("from", "").lower()

    for r in regexes:
        if not r.enabled:
            continue
        if r.sender and (r.sender.lower() not in sender_lower):
            continue

        try:
            found = re.findall(r.pattern, body_raw, FLAGS)
            if found:
                return True
        except re.error:
            pass
    return False

def extract_regex(mail_dict, regexes):
    """
    Retorna un dict {regex_id: [coincidencias, ...], ...}
    con todos los matches de cada regex.
    """
    results = {}
    body_raw = mail_dict.get("text", "") + mail_dict.get("html", "")
    sender_lower = mail_dict.get("from", "").lower()

    for r in regexes:
        if not r.enabled:
            continue
        if r.sender and (r.sender.lower() not in sender_lower):
            continue

        try:
            found = re.findall(r.pattern, body_raw, FLAGS)
            if found:
                results[r.id] = found
        except re.error:
            pass

    return results
