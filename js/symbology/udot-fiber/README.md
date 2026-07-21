# UDOT Fiber Network symbology

Shared style pack for the [UDOT Fiber Network MapServer](https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer).

## Regenerate data files

```bash
# ArcGIS drawingInfo (network required)
python scripts/build-udot-fiber-drawing-info.py

# Bentley RGB/label map from workbook
python scripts/build-udot-fiber-bentley-symbols.py "C:\path\to\NewSymbols.xlsx"
```

## Runtime split

| Runtime | Data path | Style |
|---------|-----------|--------|
| PWA | Live vector MapServer query / ArcGIS import | Same style pack |
| Desktop | SQLite `udot-fiber-network.sqlite` (24h sync) | Same style pack |

## Point glyphs

Edit rules in `glyphs.js` (`UDOT_GLYPH_RULES`) as you identify attribute → symbol mappings.
