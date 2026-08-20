# UDOT Fiber Network symbology

Shared ArcGIS/Bentley style pack for the [UDOT Fiber Network MapServer](https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer).

How a REST layer URL is styled from published `drawingInfo` (including Custom URL import): [`docs/ARCGIS_REST_STYLING.md`](ARCGIS_REST_STYLING.md).

## Adding layers (PWA)

Import → Live Layers → **UDOT Fiber Network** (password-gated composite). Adds six viewport-query layers from the MapServer. Hidden below neighborhood zoom (14); no idle refresh. Features are session / viewport only.

Live Fiber uses a modern CAD paint pack: class-colored line stacks (casing + soft glow + core), dual-halo labels, and procedural lookalike icons. Published unique-value colors stay the same (`FIBER_SYMBOLS`, `CONDUIT_SYM`, Bentley `Fiber_Label`).

Styles live in `js/symbology/udot-fiber/`. Live MapLibre specs: [`js/symbology/udot-fiber/paint.js`](../js/symbology/udot-fiber/paint.js). Lookalike icons: [`js/symbology/udot-fiber/lookalikes.js`](../js/symbology/udot-fiber/lookalikes.js).

## Style sources

1. **ArcGIS `drawingInfo`** → `arcgis-drawing-info.json` (class colors / label fields)
2. **Bentley workbook** → `bentley-symbols.json` (MS/SP name → RGB)

Regenerate:

```bash
python scripts/build-udot-fiber-drawing-info.py
python scripts/build-udot-fiber-bentley-symbols.py /path/to/NewSymbols.xlsx
```

## Point glyphs

Live Fiber does not draw published ArcGIS picture-marker PNGs. Class labels map to modern lookalikes (square-X, bowtie, hex, building) with baked shadow/highlight in `glyphs.js`. Boxes match the ArcGIS Online shapes: landscape rectangles for Type I / Type II / other boxes, red circles for vaults. Point icons follow the published `Rotation` field (geographic, clockwise from north). Expand `lookalikes.js` families as you identify attributes.

## Platform

Browser-only. Styles apply on ArcGIS / live-layer import via `js/symbology/udot-fiber/` (no local SQLite sync in this repo).
