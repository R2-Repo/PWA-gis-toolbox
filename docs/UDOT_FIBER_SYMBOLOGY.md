# UDOT Fiber Network symbology

Shared ArcGIS/Bentley style pack for the [UDOT Fiber Network MapServer](https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer).

## Adding layers (PWA)

Import → Live Layers → **UDOT Fiber Network** (vector viewport query). Features are session / viewport only in the browser.

Styles live in `js/symbology/udot-fiber/`.

## Style sources

1. **ArcGIS `drawingInfo`** → `arcgis-drawing-info.json` (class colors / label fields)
2. **Bentley workbook** → `bentley-symbols.json` (MS/SP name → RGB)

Regenerate:

```bash
python scripts/build-udot-fiber-drawing-info.py
python scripts/build-udot-fiber-bentley-symbols.py /path/to/NewSymbols.xlsx
```

## Point glyphs

Procedural CAD glyphs (square-X, bowtie, dashed box) are ruled in `js/symbology/udot-fiber/glyphs.js`. Expand `UDOT_GLYPH_RULES` as you identify attributes.

## Platform

Browser-only. Styles apply on ArcGIS / live-layer import via `js/symbology/udot-fiber/` (no local SQLite sync in this repo).
