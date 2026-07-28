#!/usr/bin/env python3
"""Import only trustworthy product images from the older Cursor project.

The old resolver cached several kinds of fallback image. Card art and set icons
are intentionally excluded: they are not images of the sealed product the row
claims to show.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Optional, Tuple

TRUSTED_SOURCES = {"override", "slightlymagic", "mtg_wiki", "tcgplayer"}
SOURCE_LABELS = {
    "override": "Curated",
    "slightlymagic": "SlightlyMagic archive",
    "mtg_wiki": "MTG Wiki",
    "tcgplayer": "TCGplayer",
}
BOX_GROUPS = {
    "Booster Box": "Booster",
    "Draft Booster Box": "Draft",
    "Set Booster Box": "Set",
    "Play Booster Box": "Play",
}


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def current_items(data: dict, checklist_id: str, code: str, name: str) -> list[dict]:
    checklist = next(item for item in data["checklists"] if item["id"] == checklist_id)
    matches = [
        item
        for era in checklist["eras"]
        for item in era["items"]
        if item.get("code") == code
    ]
    if len(matches) <= 1:
        return matches
    named = [item for item in matches if norm(item.get("name")) == norm(name)]
    return named or matches


def stable_slot_key(slot: dict) -> str:
    return slot.get("k") or slot.get("g") or slot.get("l") or ""


def has_slot(item: dict, *, group: Optional[str] = None, key: Optional[str] = None) -> bool:
    return any(
        (group is None or slot.get("g") == group)
        and (key is None or stable_slot_key(slot) == key)
        for slot in item.get("slots", [])
    )


def first_trusted_image(product: dict, image_cache: dict) -> Optional[Tuple[dict, dict]]:
    variants = image_cache.get("variants", {})
    for variant in product.get("variants", []):
        cached = variants.get(variant["id"])
        if not cached or cached.get("source") not in TRUSTED_SOURCES:
            continue
        if cached.get("image_url"):
            return variant, cached
    return None


def map_product(set_record: dict, product: dict, binder: dict) -> Optional[dict]:
    kind = product.get("kind")
    target = product.get("target_box") or product.get("label")
    code, name = set_record["code"], set_record["name"]

    if kind == "playable_booster_art":
        checklist, group, slot_key = "packs", BOX_GROUPS.get(target), BOX_GROUPS.get(target)
        caption = (
            "Booster pack"
            if group == "Booster"
            else f"{group} booster pack" if group else None
        )
    elif kind == "playable_booster_box":
        checklist, group, slot_key = "boxes", BOX_GROUPS.get(target), "Box"
        caption = (
            "Booster display"
            if group == "Booster"
            else f"{group} booster display" if group else None
        )
    elif kind == "collector_booster_art":
        checklist, group, slot_key = "packs", "Collector", "Collector"
        caption = "Collector booster pack"
    elif kind == "collector_booster_box":
        checklist, group, slot_key = "collector", "Display", "Display"
        caption = "Collector booster display"
    elif kind == "prerelease_box":
        checklist, group, slot_key = "prerelease", "Variant", "Variant"
        caption = "Prerelease kit"
    else:
        return None

    if not group or not caption:
        return None
    items = current_items(binder, checklist, code, name)
    item = next((candidate for candidate in items if has_slot(candidate, group=group, key=slot_key)), None)
    if item is None:
        return None
    return {
        "checklist": checklist,
        "code": code,
        "name": item["name"],
        "slot_key": slot_key,
        "caption": caption,
    }


def build_import(cursor_root: Path, binder_path: Path) -> dict:
    catalog = json.loads((cursor_root / "data" / "catalog.json").read_text(encoding="utf-8"))
    image_cache = json.loads((cursor_root / "data" / "image_cache.json").read_text(encoding="utf-8"))
    binder = json.loads(binder_path.read_text(encoding="utf-8"))
    images = []

    for set_record in catalog.get("sets", []):
        for product in set_record.get("products", []):
            found = first_trusted_image(product, image_cache)
            mapped = map_product(set_record, product, binder)
            if not found or not mapped:
                continue
            _variant, cached = found
            images.append(
                {
                    **mapped,
                    "url": cached["image_url"],
                    "source": SOURCE_LABELS[cached["source"]],
                    "source_kind": cached["source"],
                }
            )

    images.sort(key=lambda item: (item["checklist"], item["name"], item["slot_key"]))
    return {
        "schema_version": 1,
        "policy": "Exact sealed-product images only; card-art and set-icon fallbacks excluded.",
        "images": images,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cursor-root", type=Path, required=True)
    parser.add_argument("--binder-data", type=Path, default=Path("../data/binder_data.json"))
    parser.add_argument("--output", type=Path, default=Path("../data/product_images.json"))
    args = parser.parse_args()

    payload = build_import(args.cursor_root.resolve(), args.binder_data.resolve())
    args.output.resolve().write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(payload['images'])} trusted image mappings -> {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
