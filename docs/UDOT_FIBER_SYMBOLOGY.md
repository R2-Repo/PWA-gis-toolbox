# UDOT Fiber Network symbology

Shared ArcGIS/Bentley style pack for the [UDOT Fiber Network MapServer](https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer).

How a REST layer URL is styled from published `drawingInfo` (including Custom URL import): [`docs/ARCGIS_REST_STYLING.md`](ARCGIS_REST_STYLING.md).

## Adding layers (PWA)

Import → Live Layers → **UDOT Fiber Network** (password-gated composite). Adds six viewport-query layers from the MapServer. Hidden below neighborhood zoom (14); no idle refresh. Features are session / viewport only.

Live Fiber uses a modern CAD paint pack: class-colored line stacks (casing + soft glow + core), dual-halo labels, and procedural lookalike icons. Published unique-value colors stay the same (`FIBER_SYMBOLS`, `CONDUIT_SYM`, Bentley `Fiber_Label`). Boxes are landscape rectangles. Boxes, splices, and cabinets shrink as you zoom out through **17** (approved high-elevation look). From zoom **19.02** (approved close-to-ground look) boxes/splices grow with the map; cabinets use a flatter scale. Buildings still scale with zoom.

Draw order is fixed (bottom → top): conduit and fiber **line paint**, then those line labels, then buildings, boxes, splices, **cabinets**. Conduit is a pill-dashed stroke (transparent gaps — no grey casing underlay) with a matching dashed offset shadow. Fiber keeps casing/glow plus a soft offset shadow. Fiber/conduit labels use the line class color plus a white halo; conduit type is slightly smaller than fiber. Panel reorder does not bury cabinets. Hover a Fiber live feature for a cursor tooltip (cabinets: `NAME_ADDRESS`, `CHANNEL`, `DROP__`; splices: `NAME`, `MODEL`; boxes: `DT_RSCENCLOSURE_NAME`; fiber: `Fiber_Label`; conduit: `CustNameRight`, `CONDUIT_SYM`; building: `NAME`). Click popups are off for these live layers.

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

Live Fiber does not draw published ArcGIS picture-marker PNGs. Class labels map to modern lookalikes (square-X, bowtie, hex, building) in `glyphs.js` with no drop shadow. Boxes match the ArcGIS Online shapes: white landscape rectangles for Type I / Type II / other boxes, red circles for vaults. `BOXLABELS` is drawn inside those rectangles (same `Rotation` as the icon; vaults stay unlabeled). Sheet PDFs keep that landscape aspect at map scale, use a transparent fill, wrap/shrink long names, and rotate in-box text with the rectangle. Cabinets keep the map lookalike color (green square-X). Fiber/Conduit along-line labels are not exported on sheet PDFs. Point icons follow the published `Rotation` field (geographic, clockwise from north). Expand `lookalikes.js` families as you identify attributes.

## Platform

Browser-only. Styles apply on ArcGIS / live-layer import via `js/symbology/udot-fiber/` (no local SQLite sync in this repo).

To copy this live layer and CAD pack onto the desktop app: [`UDOT_FIBER_DESKTOP_REPLICATION.md`](UDOT_FIBER_DESKTOP_REPLICATION.md).
