# UDOT Fiber Network symbology

Shared style pack for the [UDOT Fiber Network MapServer](https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer).

REST `drawingInfo` → Smart style (any public layer, Custom URL): [`docs/ARCGIS_REST_STYLING.md`](../../../docs/ARCGIS_REST_STYLING.md).

## Regenerate data files

```bash
# ArcGIS drawingInfo (network required)
python scripts/build-udot-fiber-drawing-info.py

# Bentley RGB/label map from workbook
python scripts/build-udot-fiber-bentley-symbols.py /path/to/NewSymbols.xlsx
```

## Runtime

| Path | Data | Style |
|------|------|--------|
| PWA | Live vector MapServer query / ArcGIS import | This style pack |

Desktop port: [`docs/UDOT_FIBER_DESKTOP_REPLICATION.md`](../../../docs/UDOT_FIBER_DESKTOP_REPLICATION.md).

## Point glyphs

Live Fiber uses modern lookalikes (`lookalikes.js` + SVGs in `glyphs.js`). Point icons are flat (no drop shadow). Boxes are white landscape rectangles with `BOXLABELS` inside; vaults are red circles. Expand families as you identify attributes.
