# UDOT Fiber Network symbology

Shared style pack for the [UDOT Fiber Network MapServer](https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer).

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

Edit rules in `glyphs.js` (`UDOT_GLYPH_RULES`) as you identify attribute → symbol mappings.
