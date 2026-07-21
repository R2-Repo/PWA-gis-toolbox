"""Fetch ArcGIS MapServer drawingInfo for UDOT Fiber Network layers → JSON."""
from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

BASE = "https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer"
LAYERS = [
    (0, "cabinets", "Cabinets"),
    (2, "splices", "Splices"),
    (4, "boxes", "Boxes"),
    (6, "fiber", "Fiber"),
    (7, "conduit", "Conduit"),
    (8, "building", "Building"),
]
OUT = Path(__file__).resolve().parents[1] / "js" / "symbology" / "udot-fiber" / "arcgis-drawing-info.json"


def rgba_to_hex(color):
    if not color or len(color) < 3:
        return "#94a3b8"
    r, g, b = int(color[0]), int(color[1]), int(color[2])
    return f"#{r:02x}{g:02x}{b:02x}"


def extract_label_field(labeling_info):
    for li in labeling_info or []:
        expr = (li.get("labelExpressionInfo") or {}).get("expression") or li.get("labelExpression")
        if not expr:
            continue
        m = re.search(r"\$feature\.([A-Za-z0-9_]+)", expr)
        if m:
            return m.group(1), li.get("minScale")
        m = re.search(r"\[([^\]]+)\]", expr)
        if m:
            return m.group(1), li.get("minScale")
    return None, None


def collect_classes(renderer):
    field = renderer.get("field1")
    classes = []
    infos = renderer.get("uniqueValueInfos") or []
    if infos:
        for info in infos:
            sym = info.get("symbol") or {}
            classes.append(
                {
                    "value": str(info.get("value")),
                    "label": info.get("label") or str(info.get("value")),
                    "color": rgba_to_hex(sym.get("color")),
                    "width": sym.get("width") or sym.get("size") or 2,
                    "style": sym.get("style"),
                    "symbolType": sym.get("type"),
                }
            )
        return field, classes

    for group in renderer.get("uniqueValueGroups") or []:
        for cls in group.get("classes") or []:
            vals = cls.get("values") or []
            value = vals[0][0] if vals and vals[0] else cls.get("label")
            sym = cls.get("symbol") or {}
            classes.append(
                {
                    "value": str(value),
                    "label": cls.get("label") or str(value),
                    "color": rgba_to_hex(sym.get("color")),
                    "width": sym.get("width") or sym.get("size") or 2,
                    "style": sym.get("style"),
                    "symbolType": sym.get("type"),
                }
            )
    if classes:
        return field, classes

    sym = renderer.get("symbol")
    if sym:
        return "*", [
            {
                "value": "*",
                "label": "default",
                "color": rgba_to_hex(sym.get("color")),
                "width": sym.get("width") or sym.get("size") or 2,
                "style": sym.get("style"),
                "symbolType": sym.get("type"),
            }
        ]
    return field, classes


def main():
    out = {"serviceUrl": BASE, "layers": {}}
    for lid, key, name in LAYERS:
        url = f"{BASE}/{lid}?f=pjson"
        print("fetch", url)
        with urllib.request.urlopen(url, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        di = data.get("drawingInfo") or {}
        field, classes = collect_classes(di.get("renderer") or {})
        label_field, label_min_scale = extract_label_field(di.get("labelingInfo"))
        out["layers"][key] = {
            "id": lid,
            "name": name,
            "geometryType": data.get("geometryType"),
            "url": f"{BASE}/{lid}",
            "classField": field,
            "classes": classes,
            "labelField": label_field,
            "labelMinScale": label_min_scale,
            "minScale": data.get("minScale") or 0,
            "maxScale": data.get("maxScale") or 0,
        }
        print(f"  {key}: field={field} classes={len(classes)} label={label_field}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
