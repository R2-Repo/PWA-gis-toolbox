# ArcGIS REST endpoint styling

GIS Toolbox can style a **public ArcGIS REST layer URL** using metadata published on that same endpoint — the renderer and label rules ArcGIS Online uses, and the same source Google Earth uses when ArcGIS writes KML.

This is not a hand-authored color list. The app reads `drawingInfo` from the layer, downloads features with the renderer fields, and compiles them into Smart style + labels.

**Primary user path:** Import → ArcGIS REST Import → **Custom URL**.

A permanent Live Layers catalog entry is **not** required.

---

## What is possible

A layer URL such as:

`https://example.com/server/rest/services/…/MapServer/6`

or

`https://example.com/arcgis/rest/services/…/FeatureServer/0`

can render with the published class colors and label field when all of the following are true:

1. The URL is a **layer** endpoint (ends in `/MapServer/{id}` or `/FeatureServer/{id}`), not the service root.
2. The layer is **public** (anonymous `Query` + `Data`). Login-only services are not supported.
3. Layer metadata includes `drawingInfo.renderer` (and usually `drawingInfo.labelingInfo`).
4. Feature queries return the renderer / label **field names** as GeoJSON properties.
5. Those fields are present on **map features** (see [Workspace display fields](#workspace-display-fields)).

Worked example: [UDOT Fiber Network layer 6](https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6) publishes a unique-value renderer on `FIBER_SYMBOLS` and labels on `Fiber_Label`.

---

## Two styling models

| Model | What the app draws | Looks like | Restyle locally? |
|-------|-------------------|------------|------------------|
| **Vector + `drawingInfo`** | Queried features + Smart style | ArcGIS Online feature layer / Google Earth KML | Yes — Layer Style panel |
| **Server-drawn image** | MapServer / WMS tiles | ArcGIS Online map view | No — it is a picture |

This document is about the **vector** model.

Raster `arcgis-mapserver` / `wms` live layers stay visual overlays ([`docs/LIVE_MAP_PRESETS.md`](LIVE_MAP_PRESETS.md)). A pasted MapServer URL in **Custom URL** is treated as a queryable feature layer (download), not as image tiles.

---

## What the REST endpoint publishes

### Layer metadata — `GET {layerUrl}?f=json`

| Property | Role |
|----------|------|
| `drawingInfo.renderer` | How to color/size features (`uniqueValue`, `classBreaks`, or a single `symbol`) |
| `drawingInfo.labelingInfo` | Label field, text symbol, `minScale` / `maxScale` |
| `fields[]` | `{ name, alias, type }` — style expressions use **`name`**, not `alias` |
| `geometryType` | Maps to point / line / polygon paint |
| `displayField` | Fallback label field when `labelingInfo` is a simple field expression |
| `minScale` / `maxScale` | Layer visibility range |

Example unique-value renderer (Fiber):

```json
{
  "renderer": {
    "type": "uniqueValue",
    "field1": "FIBER_SYMBOLS",
    "uniqueValueInfos": [
      { "value": "48", "label": "48", "symbol": { "type": "esriSLS", "color": [105, 77, 0, 255], "width": 2 } }
    ]
  },
  "labelingInfo": [
    { "labelExpressionInfo": { "expression": "$feature.Fiber_Label" }, "minScale": 3000 }
  ]
}
```

Field aliases are display-only. Fiber uses `name: "Fiber_Label"` / `alias: "Fiber Label"`. The style and MapLibre `['get', …]` expressions must use `Fiber_Label`.

### Feature query — `GET {layerUrl}/query`

`outFields` must include the renderer and label fields (or `*`). Both `f=json` and `f=geojson` from ArcGIS Enterprise return those names on this class of layer.

If the query returns geometry but empty/missing class values, every feature paints as the Smart style **Other** color (`#94a3b8`).

---

## End-user: Custom URL import

1. Import → **ArcGIS REST Import**.
2. Choose **Custom URL** and paste the layer URL.
3. In the attribute picker, leave the renderer and label fields selected (the importer re-adds them if they were unchecked).
4. Use an **Import Fence** for a corridor/area, or download the published extent.
5. After import, Layer Style shows **Smart** with the published classes; Labels uses the published field.

Re-import after a styling-code change. An already-downloaded workspace layer does not pick up new map display fields until it is imported again.

### UDOT Fiber Custom URL

If the URL matches `…/UDOT_Fiber_Network/MapServer/{id}` for a known layer (cabinets, splices, boxes, fiber, conduit, building), Custom URL also applies the Fiber style pack (Bentley label colors, glyphs). See [`docs/UDOT_FIBER_SYMBOLOGY.md`](UDOT_FIBER_SYMBOLOGY.md).

That pack is an overlay on the same `drawingInfo` fields. It is not required for generic public layers.

---

## How the app applies the renderer

```
Custom URL
  → fetchMetadata (?f=json)
  → styleFromDrawingInfo(drawingInfo)  →  dataset._arcgisStyle
  → optional UDOT Fiber URL match     →  dataset._applyUdotFiberStyle
  → downloadFeatures (outFields includes style fields)
  → workspace append copies style fields onto map/tile props
  → applyImportLayerStyles()
  → MapLibre match / label expressions on field names
```

Conversion lives in [`js/arcgis/drawing-info.js`](../js/arcgis/drawing-info.js):

| ArcGIS renderer | GIS Toolbox style |
|-----------------|-------------------|
| `uniqueValue` | Smart `unique` visual variable (`field1`, optional `field2`/`field3` concat) |
| `classBreaks` | Smart `range` visual variable |
| `symbol` only | Simple (flat) stroke/fill |

Line unique-value colors use the **stroke** channel. Fill-only unique colors do not paint MapLibre lines.

Label expressions supported:

- Classic `[FIELD_NAME]`
- Arcade `$feature.FIELD_NAME`
- Arcade `$feature["Field Name"]`

Concatenations and Arcade functions are not parsed; the importer may fall back to `displayField` for lines and points.

`labelingInfo.minScale` is converted to MapLibre `minzoom` (Utah-centered default latitude). Fiber line labels typically appear only after zooming in (published `minScale` 3000).

Unique-value classes are capped at **200**.

---

## Workspace display fields

Large or fenced ArcGIS downloads go to the IndexedDB **workspace**. Map tiles and viewport packets store **identity props only** (`_featureIndex`, `__lgid`, …) plus a small **display field** list.

Without that list, Smart style and labels run on empty properties: the right-hand legend looks correct (it came from metadata) and the map is uniformly **Other**.

The importer copies renderer/label fields onto map features:

- `requiredStyleFieldsFromDrawingInfo()` — `field1` / `field2` / `field3` / `field` + parsed label field
- `source.mapDisplayFields` — persisted on the dataset
- `buildDisplayIdentityProps({ displayFields })` — written into workspace chunks

Full attributes remain in the workspace attribute store for the table, identify, and export. Only the style/label subset is promoted onto tiles.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Legend has classes; all lines gray **Other** | Style fields not on map features (old import, or fields dropped) — re-import via Custom URL |
| Labels on; “No sample values” / empty-field warning | Tiled workspace `geojson` is empty — the Labels panel samples in-memory features, not tiles. Zoom in; labels still draw from tile props when the field was promoted |
| Colors wrong after picking a subset of attributes | Renderer fields must stay in the pick — the importer merges them back |
| Looks styled in ArcGIS Online, flat color here | Custom URL download does not replay CAD picture markers. Use Import → Live Layers → UDOT Fiber Network for modern Fiber lookalike icons. |
| 401 / 403 on metadata | Layer is not public |
| URL opens the service but import fails | Need a **layer** id (`/MapServer/6`), not `/MapServer` |

---

## Limitations

- Public layers only — no tokens, IWA, or OAuth.
- Not a full ArcGIS renderer: no hatch fills or Arcade-driven labels.
- **Live Fiber layers** draw modern lookalike glyphs (not published PMS PNGs). Custom URL import still uses flat/Smart colors.
- CIM symbols: only a flat color/width is extracted when there is no `imageData`.
- Raster MapServer live layers do not use this path.
- Live Layers catalog styles are developer-authored except Fiber, which uses the modern Fiber paint pack ([`docs/UDOT_FIBER_SYMBOLOGY.md`](UDOT_FIBER_SYMBOLOGY.md)).

---

## Code map

| File | Role |
|------|------|
| [`js/arcgis/drawing-info.js`](../js/arcgis/drawing-info.js) | `drawingInfo` → Smart/simple style; style-field lists |
| [`js/arcgis/rest-importer.js`](../js/arcgis/rest-importer.js) | Metadata, query, `_arcgisStyle`, workspace `mapDisplayFields` |
| [`js/import/post-import.js`](../js/import/post-import.js) | `applyImportLayerStyles` — Fiber pack, then `_arcgisStyle` |
| [`js/workspace/feature-identity.js`](../js/workspace/feature-identity.js) | Display props on map/tiles |
| [`js/map/style-engine.js`](../js/map/style-engine.js) | Compile Smart rules to MapLibre expressions |
| [`react/tools/ArcGISImporterDialog.jsx`](../react/tools/ArcGISImporterDialog.jsx) | Custom URL UI |
| [`js/symbology/udot-fiber/`](../js/symbology/udot-fiber/) | Fiber-only pack (optional) |

**Tests:** [`tests/arcgis-drawing-info.test.js`](../tests/arcgis-drawing-info.test.js), [`tests/feature-identity.test.js`](../tests/feature-identity.test.js), [`tests/udot-fiber-symbology.test.js`](../tests/udot-fiber-symbology.test.js).

---

## Related

- [`docs/UDOT_FIBER_SYMBOLOGY.md`](UDOT_FIBER_SYMBOLOGY.md) — Fiber Bentley/glyph pack
- [`docs/LIVE_MAP_PRESETS.md`](LIVE_MAP_PRESETS.md) — curated live catalog (separate from Custom URL)
- [`docs/IMPORT_LARGE_FILES.md`](IMPORT_LARGE_FILES.md) — workspace / tile display for large downloads
