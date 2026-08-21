#!/usr/bin/env python3
"""Build the dashboard handoff catalog for distinct booster-wrapper fronts."""

from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COUNTS_PATH = ROOT / "data" / "booster_wrapper_art_counts.csv"
OUTPUT_PATH = ROOT / "data" / "booster_wrapper_art_catalog.json"
FORGE_BASE = "https://raw.githubusercontent.com/Card-Forge/forge-extras/refs/heads/main/images/boosters"
CATALOG_AS_OF = "2026-08-14"
EXPECTED_SET_COUNT = 96
EXPECTED_ARTWORK_COUNT = 378

FORGE_CODE_ALIASES = {"IMA": "ICO"}
SPECIAL_IMAGES = {
    "UNH": {
        "status": "group_reference",
        "urls": ["https://i.ebayimg.com/images/g/-v8AAOSwjyBcfXlM/s-l1200.jpg"] * 3,
        "positions": ["left", "center", "right"],
        "note": "One reference photo contains all three fronts; create reviewed crops or replace with durable individual images before treating thumbnails as exact.",
    },
    "UST": {
        "status": "review_only",
        "urls": [
            "https://www.radartoys.com/cdn/shop/products/Magic_The_Gathering_Unstable_Booster_Pack_Trading_Card_Game_d6f94dda-ed31-4fc5-b049-eacb2914ba95_grande.jpg?v=1546890040",
            "https://www.bazaargames.nl/images/products/480x427/bp_unstable_2.jpg",
            "https://www.bazaargames.nl/images/products/480x427/bp_unstable_3.jpg",
        ],
        "note": "Three distinct retailer-hosted candidates; visually verify and replace with a durable source before production use.",
    },
    "BBD": {
        "status": "group_reference",
        "urls": ["https://2.bp.blogspot.com/-ZRo-oOGkNDg/WvMdOnUSu_I/AAAAAAAAhiQ/J93CM43XmnkwCxYHfI0Rj2i5GpnkWqSXwCLcBGAs/s1600/mtg%2Bbattlebond%2Bbooster%2Bpkg.jpg"] * 3,
        "positions": ["top", "middle", "bottom"],
        "note": "One reference image contains all three fronts; create reviewed crops or replace with durable individual images.",
    },
    "2XM": {
        "status": "pending_image_source",
        "urls": [None, None, None],
        "note": "The three Draft Booster fronts need a trustworthy image source; do not substitute VIP Edition or outer sleeved-pack art.",
    },
}


def forge_extension(code: str) -> str:
    return "png" if code in {"IMA"} else "jpg"


def build_artworks(code: str, count: int) -> tuple[list[dict], str | None]:
    special = SPECIAL_IMAGES.get(code)
    if special:
        artworks = []
        for index, image_url in enumerate(special["urls"], start=1):
            art = {
                "id": f"{code}-{index}",
                "label": f"Art {index}",
                "imageUrl": image_url,
                "imageStatus": special["status"],
                "source": "curated_reference" if image_url else "pending",
            }
            if special.get("positions"):
                art["positionHint"] = special["positions"][index - 1]
            artworks.append(art)
        return artworks, special["note"]

    forge_code = FORGE_CODE_ALIASES.get(code, code)
    extension = forge_extension(code)
    artworks = [
        {
            "id": f"{code}-{index}",
            "label": f"Art {index}",
            "imageUrl": f"{FORGE_BASE}/{forge_code}_{index}.{extension}",
            "imageStatus": "exact_individual",
            "source": "forge-extras",
        }
        for index in range(1, count + 1)
    ]
    note = None
    if code == "IMA":
        note = "Forge uses the legacy filename prefix ICO for Iconic Masters."
    if code == "POR":
        note = "The acquisition count is four English fronts. Forge also exposes POR_5.jpg; verify the four physical fronts against the dedicated Portal reference before production labeling."
    return artworks, note


def main() -> None:
    sets = []
    with COUNTS_PATH.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            code = row["set_code"]
            count = int(row["art_count"])
            artworks, note = build_artworks(code, count)
            record = {
                "setCode": code,
                "setName": row["set_name"],
                "releaseYear": int(row["release_year"]),
                "artCount": count,
                "artworks": artworks,
            }
            if note:
                record["validationNote"] = note
            sets.append(record)

    total_artworks = sum(item["artCount"] for item in sets)
    if len(sets) != EXPECTED_SET_COUNT or total_artworks != EXPECTED_ARTWORK_COUNT:
        raise SystemExit(f"Unexpected catalog totals: {len(sets)} sets / {total_artworks} artworks")

    image_status_counts: dict[str, int] = {}
    for item in sets:
        for art in item["artworks"]:
            status = art["imageStatus"]
            image_status_counts[status] = image_status_counts.get(status, 0) + 1

    catalog = {
        "schema": "mtg-booster-wrapper-art-catalog/v1",
        "catalogAsOf": CATALOG_AS_OF,
        "scope": {
            "language": "English",
            "product": "regular retail booster pack",
            "range": "Revised onward through Double Masters (2020)",
            "filter": "sets with more than one distinct wrapper-art front",
            "exclusions": [
                "single-art or non-card-art wrappers",
                "Collector, Set, Theme, VIP, faction, promo, sample, and outer sleeved packaging",
            ],
        },
        "totals": {
            "sets": len(sets),
            "artworks": total_artworks,
            "imageStatusCounts": image_status_counts,
        },
        "sources": {
            "countManifest": "https://raw.githubusercontent.com/Card-Forge/forge/master/forge-gui/res/lists/booster-images.txt",
            "imageRepository": "https://github.com/Card-Forge/forge-extras/tree/main/images/boosters",
            "boosterReference": "https://mtg.fandom.com/wiki/Booster_pack",
            "portalReference": "https://mtg.fandom.com/wiki/Portal",
            "unstableReference": "https://mtg.fandom.com/wiki/Unstable",
            "battlebondReference": "https://mtg.fandom.com/wiki/Battlebond",
            "doubleMastersReference": "https://mtg.fandom.com/wiki/Double_Masters",
            "marketWorkbook": "outputs/019fe7d2-ce14-7c22-83f9-375a014d5e3a/MTG_Booster_Wrapper_Art_Budget_2026-08-14.xlsx",
        },
        "sets": sets,
    }
    OUTPUT_PATH.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}: {len(sets)} sets / {total_artworks} artworks / {image_status_counts}")


if __name__ == "__main__":
    main()
