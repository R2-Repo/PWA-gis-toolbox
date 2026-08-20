# UDOT Fiber Network symbology

Shared ArcGIS/Bentley style pack for the [UDOT Fiber Network MapServer](https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer).

How a REST layer URL is styled from published `drawingInfo` (including Custom URL import): [`docs/ARCGIS_REST_STYLING.md`](ARCGIS_REST_STYLING.md).

## Adding layers (PWA)

Import → Live Layers → **UDOT Fiber Network** (password-gated composite). Adds six viewport-query layers from the MapServer. Hidden below neighborhood zoom (14); no idle refresh. Features are session / viewport only.

Point layers use the published ArcGIS picture-marker PNGs (`drawingInfo` `imageData`). Line layers use unique-value colors, dash styles, along-line labels, and a light parallel offset.

Styles live in `js/symbology/udot-fiber/`. Picture-marker load: [`js/arcgis/picture-markers.js`](../js/arcgis/picture-markers.js).

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
