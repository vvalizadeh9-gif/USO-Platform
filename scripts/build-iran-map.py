"""Build the Iran province and CRA-region map the Coverage map tab draws.

    pip install shapely          # this script only; not a runtime dependency
    python3 scripts/build-iran-map.py

Writes frontend/src/pages/reports/iranMap.json: one SVG path per province,
keyed by the Persian name exactly as ``backend/app/core/province_directory.py``
(and so the ``provinces`` table) spells it, and one path per CRA region,
dissolved from its provinces.

Source
------
geoBoundaries IRN ADM1 (gbOpen), simplified release, built from
OpenStreetMap. Licence: Open Data Commons Open Database License 1.0 -- the
page must show "© OpenStreetMap contributors, ODbL", and it does.

The file is downloaded, checked against SOURCE_SHA256 and then only read:
the result is committed, so neither the build nor the page ever fetches
boundary data at runtime.

Why the join is by name, through one explicit table
---------------------------------------------------
The source's ISO 3166-2 codes cannot be trusted as a key: Tehran has none,
and the rest follow an older numbering (Hormozgan carries IR-23, which is
Tehran's code in the current list). So each source name is mapped to one of
our 31 Persian names in SOURCE_TO_FA below, written out by hand and read by a
person, and the script refuses to write anything unless all 31 are matched
exactly once. The browser then joins on the Persian name the API sends -- the
same string, never a fuzzy match.

Why the regions are built here
------------------------------
Dissolving 31 provinces into nine regions is geometry that never changes
between page loads, so it is done once, here. The grouping is the directory's.
If a province is later moved to another region in the mapping screen, the page
compares the live mapping against the ``region`` stored per province below and
says so, rather than silently drawing the old border.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
import urllib.request
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import polylabel, transform, unary_union

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.core.province_directory import PROVINCE_DIRECTORY  # noqa: E402

SOURCE_URL = (
    "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/"
    "releaseData/gbOpen/IRN/ADM1/geoBoundaries-IRN-ADM1_simplified.geojson"
)
SOURCE_SHA256 = "bed64f34847d707d6448d11afed74e87b594b37edd61c77622746c54efd3d970"
OUT = ROOT / "frontend" / "src" / "pages" / "reports" / "iranMap.json"

#: geoBoundaries shapeName -> the Persian name in province_directory.py.
SOURCE_TO_FA = {
    "Alborz": "البرز",
    "Ardabil": "اردبیل",
    "Bushehr": "بوشهر",
    "Chaharmahal and Bakhtiari": "چهارمحال و بختیاری",
    "East Azerbaijan": "آذربایجان شرقی",
    "Fars": "فارس",
    "Gilan": "گیلان",
    "Golestan": "گلستان",
    "Hamadan": "همدان",
    "Hormozgan": "هرمزگان",
    "Ilam": "ایلام",
    "Isfahan": "اصفهان",
    "Kerman": "کرمان",
    "Kermanshah": "کرمانشاه",
    "Khuzestan": "خوزستان",
    "Kohgiluyeh and Boyer-Ahmad": "کهگیلویه و بویراحمد",
    "Kurdistan": "کردستان",
    "Lorestan": "لرستان",
    "Markazi": "مرکزی",
    "Mazandaran": "مازندران",
    "North Khorasan": "خراسان شمالی",
    "Qazvin": "قزوین",
    "Qom": "قم",
    "Razavi Khorasan": "خراسان رضوی",
    "Semnan": "سمنان",
    "Sistan and Baluchestan": "سیستان و بلوچستان",
    "South Khorasan": "خراسان جنوبی",
    "Tehran": "تهران",
    "West Azerbaijan": "آذربایجان غربی",
    "Yazd": "یزد",
    "Zanjan": "زنجان",
}

#: SVG width. Height follows from the projection.
WIDTH = 1000
#: Simplification tolerance, in SVG units (about 2 km). Below a stroke's width.
TOLERANCE = 0.6
#: Longitude is squeezed by cos(latitude) at Iran's middle, so shapes keep
#: their proportions (equirectangular, which is fine at one country's scale).
LAT0 = 32.5


def load() -> dict:
    with urllib.request.urlopen(SOURCE_URL) as response:
        raw = response.read()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SOURCE_SHA256:
        sys.exit(
            f"Source changed: sha256 {digest}, expected {SOURCE_SHA256}. "
            "Read the new file, re-check SOURCE_TO_FA, then update the hash."
        )
    return json.loads(raw)


def provinces_by_fa(source: dict) -> dict[str, Polygon | MultiPolygon]:
    """Every source feature under its Persian name. A province the source
    splits into pieces (Mazandaran is two features) is unioned back into one."""
    pieces: dict[str, list] = {}
    for feature in source["features"]:
        name = feature["properties"]["shapeName"]
        if name not in SOURCE_TO_FA:
            sys.exit(f"Source province {name!r} is not in SOURCE_TO_FA.")
        pieces.setdefault(SOURCE_TO_FA[name], []).append(shape(feature["geometry"]))

    ours = {row.fa for row in PROVINCE_DIRECTORY}
    missing = ours - set(pieces)
    extra = set(pieces) - ours
    if missing or extra or len(ours) != 31:
        sys.exit(f"Province join failed. Missing: {missing}. Unknown: {extra}.")
    return {fa: unary_union(parts) for fa, parts in pieces.items()}


def projector(geoms):
    minx, miny, maxx, maxy = unary_union(list(geoms)).bounds
    kx = math.cos(math.radians(LAT0))
    scale = WIDTH / ((maxx - minx) * kx)

    def project(x, y, z=None):
        return ((x - minx) * kx * scale, (maxy - y) * scale)

    height = (maxy - miny) * scale
    return project, height


def path(geom) -> str:
    """SVG path data, one subpath per ring, holes included (evenodd)."""
    polygons = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    parts = []
    for polygon in polygons:
        for ring in (polygon.exterior, *polygon.interiors):
            coords = list(ring.coords)[:-1]
            parts.append(
                "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in coords) + "Z"
            )
    return "".join(parts)


def label_at(geom) -> list[float]:
    """Where the name and figure sit: the pole of inaccessibility of the
    largest piece, so a label lands inside even a crescent-shaped province."""
    largest = max(getattr(geom, "geoms", [geom]), key=lambda g: g.area)
    point = polylabel(largest, tolerance=1.0)
    return [round(point.x, 1), round(point.y, 1)]


def drop_slivers(geom, min_area: float):
    """The union of 31 independently drawn provinces leaves hairline gaps and
    specks where two borders do not quite meet. Keep real islands, drop dust."""
    polygons = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    kept = [
        Polygon(p.exterior, [h for h in p.interiors if Polygon(h).area >= min_area])
        for p in polygons
        if p.area >= min_area
    ]
    return kept[0] if len(kept) == 1 else MultiPolygon(kept)


def main() -> None:
    by_fa = provinces_by_fa(load())
    project, height = projector(by_fa.values())
    projected = {fa: transform(project, geom) for fa, geom in by_fa.items()}

    region_of = {row.fa: row.cra_region for row in PROVINCE_DIRECTORY}
    english = {row.fa: row.en for row in PROVINCE_DIRECTORY}

    provinces = {}
    for row in PROVINCE_DIRECTORY:
        geom = projected[row.fa].simplify(TOLERANCE, preserve_topology=True)
        provinces[row.fa] = {
            "en": english[row.fa],
            "region": region_of[row.fa],
            "path": path(geom),
            "label": label_at(geom),
        }

    regions = {}
    for region in sorted(set(region_of.values())):
        members = [projected[fa] for fa, r in region_of.items() if r == region]
        # Grow, union, shrink: closes the hairline gaps between neighbours so
        # the region is one shape with no seams inside it.
        merged = unary_union([m.buffer(0.8) for m in members]).buffer(-0.8)
        merged = drop_slivers(merged.simplify(TOLERANCE, preserve_topology=True), 4.0)
        regions[region] = {"path": path(merged), "label": label_at(merged)}

    if len(regions) != 9:
        sys.exit(f"Expected 9 CRA regions, built {len(regions)}.")

    OUT.write_text(
        json.dumps(
            {
                "source": "geoBoundaries IRN ADM1 (OpenStreetMap), ODbL 1.0",
                "viewBox": f"0 0 {WIDTH} {height:.0f}",
                "provinces": provinces,
                "regions": regions,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
