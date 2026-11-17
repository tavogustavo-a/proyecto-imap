"""Inserta regex y servicios de app/data/default_catalog_seed.json en una base vacía."""
import json
import os

from sqlalchemy import inspect

from app.extensions import db
from app.models import RegexModel, ServiceModel, SiteSettings, service_regex


def _as_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, str) and value.isdigit():
        return bool(int(value))
    if isinstance(value, int) and not isinstance(value, bool):
        return bool(value)
    return bool(value)


def _load_bundle():
    json_path = os.path.join(os.path.dirname(__file__), "data", "default_catalog_seed.json")
    if not os.path.isfile(json_path):
        return None
    with open(json_path, encoding="utf-8") as handle:
        return json.load(handle)


def seed_default_regexes_if_empty():
    """Crea regex, servicios y párrafos si el proyecto todavía está vacío."""
    skip = os.getenv("SKIP_CATALOG_SEED", "").strip().lower()
    if skip in ("1", "true", "yes"):
        return {"regexes": 0, "services": 0, "paragraphs": 0}

    try:
        bundle = _load_bundle()
    except Exception:
        return {"regexes": 0, "services": 0, "paragraphs": 0}
    if not bundle:
        return {"regexes": 0, "services": 0, "paragraphs": 0}

    try:
        insp = inspect(db.engine)
        has_regex = insp.has_table(RegexModel.__tablename__)
        has_services = insp.has_table(ServiceModel.__tablename__)
        has_links = insp.has_table("service_regex")
        has_settings = insp.has_table("site_settings")
    except Exception:
        db.session.rollback()
        return {"regexes": 0, "services": 0, "paragraphs": 0}

    regex_rows = bundle.get("regexes") or []
    service_rows = bundle.get("services") or []
    pairs = bundle.get("service_regex_pairs") or []
    regex_by_seed_id = {row.get("id"): row for row in regex_rows}

    created_regexes = 0
    created_services = 0
    created_paragraphs = 0
    regex_ids_by_description = {}
    service_ids_by_seed = {}

    try:
        if has_regex and db.session.query(RegexModel.id).first() is None:
            for row in sorted(regex_rows, key=lambda item: item.get("id") or 0):
                obj = RegexModel(
                    sender=row.get("sender"),
                    pattern=row.get("pattern") or "",
                    enabled=_as_bool(row.get("enabled"), True),
                    description=row.get("description"),
                    is_default=_as_bool(row.get("is_default"), False),
                    protected=_as_bool(row.get("protected"), False),
                )
                db.session.add(obj)
                db.session.flush()
                created_regexes += 1
                if row.get("description"):
                    regex_ids_by_description[row["description"]] = obj.id
        elif has_regex:
            for obj in RegexModel.query.all():
                if obj.description and obj.description not in regex_ids_by_description:
                    regex_ids_by_description[obj.description] = obj.id

        if has_services and db.session.query(ServiceModel.id).first() is None:
            for row in sorted(service_rows, key=lambda item: item.get("position") or item.get("id") or 0):
                obj = ServiceModel(
                    name=row.get("name"),
                    color=row.get("color") or "black",
                    border_color=row.get("border_color"),
                    gradient_color=row.get("gradient_color"),
                    click_color1=row.get("click_color1"),
                    click_color2=row.get("click_color2"),
                    position=row.get("position") or 1,
                    match_key=row.get("match_key") or None,
                    enabled=_as_bool(row.get("enabled"), True),
                    protected=_as_bool(row.get("protected"), False),
                    visibility_mode=row.get("visibility_mode") or "off",
                )
                db.session.add(obj)
                db.session.flush()
                created_services += 1
                service_ids_by_seed[row.get("id")] = obj.id

            if has_links and created_services:
                seen = set()
                for pair in pairs:
                    service_id = service_ids_by_seed.get(pair.get("service_id"))
                    seed_regex = regex_by_seed_id.get(pair.get("regex_id")) or {}
                    regex_id = regex_ids_by_description.get(seed_regex.get("description"))
                    key = (service_id, regex_id)
                    if not service_id or not regex_id or key in seen:
                        continue
                    seen.add(key)
                    db.session.execute(
                        service_regex.insert().values(service_id=service_id, regex_id=regex_id)
                    )

        if has_settings:
            paragraphs = bundle.get("paragraphs") or {}
            guest = (paragraphs.get("search_message") or "").strip()
            logged = (paragraphs.get("search_message2") or "").strip()
            if guest or logged:
                def _setting_blank(key):
                    row = SiteSettings.query.filter_by(key=key).first()
                    return row is None or not (row.value or "").strip()

                if _setting_blank("search_message") and _setting_blank("search_message2"):
                    for key in (
                        "search_message",
                        "search_message_mode",
                        "search_message2",
                        "search_message2_mode",
                    ):
                        if key not in paragraphs:
                            continue
                        row = SiteSettings.query.filter_by(key=key).first()
                        if row is None:
                            db.session.add(SiteSettings(key=key, value=paragraphs.get(key) or ""))
                        else:
                            row.value = paragraphs.get(key) or ""
                        created_paragraphs += 1

        if created_regexes or created_services or created_paragraphs:
            db.session.commit()
        else:
            db.session.rollback()
    except Exception:
        db.session.rollback()
        return {"regexes": 0, "services": 0, "paragraphs": 0}

    return {
        "regexes": created_regexes,
        "services": created_services,
        "paragraphs": created_paragraphs,
    }
