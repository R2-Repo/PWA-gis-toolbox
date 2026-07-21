# UDOT Fiber Network symbology

Shared ArcGIS/Bentley style pack for the [UDOT Fiber Network MapServer](https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer).

## Runtime split

| Runtime | How to add layers | Feature storage |
|---------|-------------------|-----------------|
| **PWA** | Import → Live Layers → **UDOT Fiber Network** (vector viewport query) or ArcGIS REST import presets | Session / viewport only |
| **Desktop** | Same live catalog, **or** Live Layers → Sync / Add from local DB | SQLite `udot-fiber-network.sqlite` (app data), 24h sync |

Styles live in `js/symbology/udot-fiber/` and are shared. Desktop never requires the PWA service worker.

## Style sources

1. **ArcGIS `drawingInfo`** → `arcgis-drawing-info.json` (class colors / label fields)
2. **Bentley workbook** → `bentley-symbols.json` (MS/SP name → RGB)

Regenerate:

```bash
python scripts/build-udot-fiber-drawing-info.py
python scripts/build-udot-fiber-bentley-symbols.py "C:\path\to\NewSymbols.xlsx"
```

## Point glyphs

Procedural CAD glyphs (square-X, bowtie, dashed box) are ruled in `js/symbology/udot-fiber/glyphs.js`. Expand `UDOT_GLYPH_RULES` as you identify attributes.

## Platform

- Contract: `UdotFiberDbService` in `js/platform/contracts.js`
- Web stub: `js/platform/web/web-udot-fiber-db-service.js`
- Windows: `js/platform/windows/windows-udot-fiber-db-service.js` + `src-tauri/src/udot_fiber/`
