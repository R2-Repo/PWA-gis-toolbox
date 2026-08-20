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

## Point glyphs

Live Fiber uses modern lookalikes (`lookalikes.js` + shadowed SVGs in `glyphs.js`). Boxes are landscape rectangles; vaults are red circles (ArcGIS Online shapes). Expand families as you identify attributes.
