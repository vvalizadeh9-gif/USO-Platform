"""Build Explorer's mini map of Iran (UEP-28) from the coverage map's asset.

    python scripts/build-iran-mini.py

Reads ``frontend/src/pages/reports/iranMap.json`` (built by
``build-iran-map.py``) and writes ``frontend/src/pages/explorer/iranMini.json``:
the same 31 provinces in the same viewBox, simplified for a 112px drawing --
coordinates rounded to integers, and a point dropped when it is closer than
``MIN_STEP`` units to the last one kept -- with each province's centroid
precomputed for the pin. Run it again whenever the source asset changes.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frontend/src/pages/reports/iranMap.json"
TARGET = ROOT / "frontend/src/pages/explorer/iranMini.json"
MIN_STEP = 4

Ring = list[tuple[float, float]]


def rings(path: str) -> list[Ring]:
    """The path's closed rings (it only uses M, L and Z)."""
    out: list[Ring] = []
    for part in re.findall(r"M[^M]*", path):
        nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", part)]
        out.append(list(zip(nums[0::2], nums[1::2], strict=True)))
    return out


def simplify(ring: Ring) -> Ring:
    kept: Ring = []
    for x, y in ring:
        point = (round(x), round(y))
        if not kept or math.dist(point, kept[-1]) >= MIN_STEP:
            kept.append(point)
    return kept


def area_centroid(ring: Ring) -> tuple[float, float, float]:
    """Signed area and centroid of a polygon (shoelace)."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1], strict=True):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if a == 0:
        xs, ys = zip(*ring, strict=True)
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    return a / 2, cx / (3 * a), cy / (3 * a)


def province(path: str) -> dict:
    shapes = [simplify(r) for r in rings(path)]
    shapes = [s for s in shapes if len(s) >= 3]
    # The pin goes on the largest ring: the mainland, not an island.
    _, cx, cy = max((area_centroid(r) for r in rings(path)), key=lambda t: abs(t[0]))
    d = "".join("M" + "L".join(f"{x},{y}" for x, y in s) + "Z" for s in shapes)
    return {"d": d, "c": [round(cx), round(cy)]}


def main() -> None:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    out = {
        "source": source["source"],
        "viewBox": source["viewBox"],
        "provinces": {name: province(p["path"]) for name, p in source["provinces"].items()},
    }
    TARGET.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{TARGET.relative_to(ROOT)}: {TARGET.stat().st_size:,} bytes, {len(out['provinces'])} provinces")


if __name__ == "__main__":
    main()
