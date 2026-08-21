# Replicate UDOT Fiber Network on desktop

This repo is the **PWA**. Desktop lives in a separate tree (Tauri / Network Atlas were removed here). Use this guide to copy the live layer and the CAD style pack we built.

Source of truth: `js/symbology/udot-fiber/` plus the live-layer hooks listed below. Do not restyle from ArcGIS picture-marker PNGs or MapServer tiles.

Related: [`UDOT_FIBER_SYMBOLOGY.md`](UDOT_FIBER_SYMBOLOGY.md), [`LIVE_MAP_PRESETS.md`](LIVE_MAP_PRESETS.md), [`ARCGIS_REST_STYLING.md`](ARCGIS_REST_STYLING.md).

---

## What you are copying

A **six-layer viewport live overlay**, not a local SQLite dump.

| Piece | PWA behavior |
|-------|----------------|
| Data | ArcGIS MapServer vector query for the current map envelope |
| Persistence | Session / viewport only (unless the user materializes) |
| Paint | Custom MapLibre CAD pack (class colors stay published) |
| Identify | Hover tooltip only — no click popup |
| Idle refresh | Off (`refreshMs: 0`) |
| Visibility | Hidden below MapLibre zoom **14** (no query either) |

Do **not** merge this into Network Atlas / `udot-fiber-network.sqlite` unless you explicitly want an offline snapshot. Live Fiber and the old desktop atlas are different products.

---

## Fastest path

If desktop still shares this JS layout (Vite + MapLibre + `js/`):

1. Copy the whole style pack (files below).
2. Register the catalog composite.
3. Wire the engine hooks (query, paint, glyphs, hover, draw order).
4. Add the tooltip CSS.
5. Disable click popups for these six datasets.
6. Smoke-test at zooms 14, 17, 19.02, and 21.

If desktop is a fork with different live-layer code, implement the **behavior contract** in this doc and keep the style pack as a drop-in module.

---

## Service contract

**Root**

`https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer`

| Catalog id | Name | Layer | Geometry | Class field | Label field |
|------------|------|------:|----------|-------------|-------------|
| `udot-fiber-cabinets` | UDOT Cabinets | 0 | point | `MODEL` | — |
| `udot-fiber-splices` | UDOT Splices | 2 | point | `MODEL` (not `MODEL_1`) | — |
| `udot-fiber-boxes` | UDOT Boxes | 4 | point | `DT_RSCENCLOSURE_NAME` | `BOXLABELS` (in-icon) |
| `udot-fiber-lines` | UDOT Fiber | 6 | line | `FIBER_SYMBOLS` | `Fiber_Label` |
| `udot-fiber-conduit` | UDOT Conduit | 7 | line | `CONDUIT_SYM` | `CustNameRight` |
| `udot-fiber-building` | UDOT Building | 8 | point | `MODEL` | — |

Also query these on every Fiber feature: `Rotation`, plus hover fields below. PWA uses `outFields=*`.

**Kind:** `arcgis-mapserver-vector` (GeoJSON `/query`, not raster tiles).

**Catalog group:** `udot-fiber-network` — one Import card → one layer folder with six toggles.

**Password gate (look of security only):** SHA-256 hash in `js/live-layers/catalog.js` (`access.hash`). Success is remembered for the tab (`sessionStorage`). The REST URLs stay public. Copy the same hash/prompt if desktop should match.

**Icon:** `public/icons/udot-fiber-network.png`.

Detect a Fiber URL with `matchUdotFiberLayerUrl()` (`/udot_fiber_network/mapserver/{id}`).

---

## Query / runtime

Copy this from `js/live-layers/live-layer-engine.js`:

1. **Viewport envelope** — padded map bounds, `esriSpatialRelIntersects`, `outSR=4326`, paginate 1000 until the transfer limit clears or the render cap hits.
2. **`minZoom: 14`** — hide layers and **skip the server** below neighborhood zoom.
3. **`refreshMs: 0`** — no idle timer. Refresh only on pan/zoom when the envelope is new.
4. **Boxes hide list** — apply in the ArcGIS `where` **and** in JS before `setData`. Do **not** add a MapLibre `in`/`trim` filter (MapLibre 4 drops every Boxes feature).

```
DT_RSCENCLOSURE_NAME IS NULL OR DT_RSCENCLOSURE_NAME NOT IN (
  'POE','Pole','CCTV','Node','Power Source','Power Meter','RWIS',
  'Radio (Master)','Radio (Slave)','Ramp Meter','NID',
  'VMS Over-Head','VMS Road-Side','VSL Road-Side',
  'Transformer on Pole','UDOT Sign','ETC Gantry'
)
```

Exact trim match. Does not delete project data.

5. **Skip ArcGIS picture markers** for Fiber URLs. Use lookalike glyphs.
6. **Fiber only:** `applyUdotFiberDisplayOffsets()` — ~1.75 m perpendicular nudge per `MULTISHEATH` (or `Fiber_Label` matching multi/parallel) so parallel sheaths separate on the map.
7. **Points:** `decorateUdotFiberPointFeatures()` stamps `_udotGlyph`, `_udotEsriWidth`, and `_udotBoxLabel` (boxes with a `BOXLABELS` value on a landscape rect).
8. After add / reorder, call `orderUdotFiberLiveLayers()`.

---

## Advanced styling (must match PWA)

Class colors stay published (`FIBER_SYMBOLS`, `CONDUIT_SYM`, Bentley `Fiber_Label` when present). Everything else is the CAD pack in `paint.js` / `glyphs.js` / `zoom-scale.js`.

### Approved zoom (do not change)

| Constant | Value | Meaning |
|----------|------:|---------|
| `UDOT_FIBER_MIN_ZOOM` | **14** | Hidden + no query |
| High-elevation shrink start | **17** | Boxes / splices / cabinets get smaller as you zoom out |
| `UDOT_FIBER_GROUND_LOCK_ZOOM` | **19.02** | Approved close-to-ground size; then grow with the map |

Lock-zoom icon px: building **44**, cabinets **29**, splices **18**, boxes **18**.

- Boxes / splices: exponential grow after 19.02 (`px, 2×, 4×, 8×…`).
- Cabinets: flatter grow (`×1.45` per zoom after lock).
- Buildings: their own linear stops; always scale with zoom.

Sprites cap at **256 px**. Close-up uses `icon-size > 1`, not huge SVGs.

### Draw order (bottom → top)

1. Conduit + fiber **line paint** (shadow / casing / glow / core)
2. Those **line labels**
3. Buildings
4. Boxes
5. Splices
6. **Cabinets** (always on top)

Panel reorder must not bury cabinets. Implementation: `draw-order.js` — `moveLayer` bottom → top.

### Fiber lines

Stack per source:

1. Offset shadow (`#0a0a0a`, opacity 0.22, blur 1.15, translate `[1.15, 1.55]` viewport)
2. Dark casing (`#0a0a0a`, opacity 0.42, +0.8 px)
3. Soft class-color glow (blur 1.35, opacity 0.18, +1.55 px)
4. Core **2.35 px**, class color, round cap/join

Solid stroke (`esriSLSSolid`). Label: `Fiber_Label` along the line, class color + white halo (~4.2). Min zoom **15**. Spacing 360. Font: `Open Sans Regular` (Bold often fails silent on the glyph server).

### Conduit lines (pill dash)

Published style is `esriSLSDash` → MapLibre dash **`[3, 2]`**.

**Critical:** do **not** put a solid casing or glow under the dash. That reads as a grey dashed underlay. Conduit is:

1. Dashed offset shadow (same dash)
2. Dashed core **2.55 px**, class color, transparent gaps

Label: `CustNameRight`, slightly smaller than fiber (base 9 vs 10), halo ~4.6, min zoom **14**, spacing 190, allow overlap.

### Point lookalikes (not ArcGIS PNGs)

| Layer | Glyph | Notes |
|-------|--------|-------|
| Cabinets | green **square-X** | `MODEL` containing cabinet; ITS leftovers fall back to circle |
| Splices | red **bowtie** | Always bowtie. Class is `MODEL` enclosure type, **not** published `MODEL_1` (ButtSplice / RingCut) |
| Boxes | white **landscape rect** | Type I / II / other. `BOXLABELS` drawn **inside**, same `Rotation` as the icon |
| Vaults | red **circle / ring** | No in-rect label |
| Building | green **building** / UEN **square-X** | Scales with zoom |
| Hubs | orange **hex** | From class label text |

Icons: flat (no drop shadow). `icon-rotate` = `Rotation` (geographic, clockwise from north). Pitch: viewport. Rotation alignment: map.

Invisible hit circles: half the on-screen icon, min 3 px — not a fat halo.

### Hover identify (no click popup)

| Layer | Fields |
|-------|--------|
| Cabinets | `NAME_ADDRESS`, `CHANNEL`, `DROP__` (aliases `DROP_`, `DROP`) |
| Splices | `NAME`, `MODEL` |
| Boxes | `DT_RSCENCLOSURE_NAME` |
| Fiber | `Fiber_Label` |
| Conduit | `CustNameRight`, `CONDUIT_SYM` |
| Building | `NAME` |

Cursor-follow HTML tooltip (`.udot-fiber-hover-tooltip`). Query **paint** layers only — skip `-hit`, `-shadow`, and label ids. Pick the geometry closest to the cursor so a box halo cannot beat a nearby line.

In `map-manager`, drop Fiber live datasets from click-popup hit lists (`isUdotFiberLiveDataset` / `_excludeFiberLivePopupHits`).

---

## Files to copy

### Style pack (copy the folder)

```
js/symbology/udot-fiber/
  constants.js
  styles.js
  resolve-style.js
  paint.js
  zoom-scale.js
  glyphs.js
  lookalikes.js
  draw-order.js
  display-filters.js
  display-offsets.js
  hover-fields.js
  hover-tooltip.js
  splice-enclosures.js
  index.js
  download.js                  # optional (full-layer GeoJSON)
  arcgis-drawing-info.json
  bentley-symbols.json
```

Regenerate JSON only if the published service or Bentley workbook changed:

```bash
python scripts/build-udot-fiber-drawing-info.py
python scripts/build-udot-fiber-bentley-symbols.py /path/to/NewSymbols.xlsx
```

### Catalog + live runtime

| File | What to take |
|------|----------------|
| `js/live-layers/catalog.js` | `udot-fiber-network` composite (password, `minZoom`, `refreshMs: 0`, six sublayers + styles) |
| `js/live-layers/catalog-access.js` | Password prompt / session unlock |
| `js/live-layers/catalog-schema.js` | `access` validation + `expandCatalogEntry` inherits `minZoom` / `refreshMs` |
| `js/live-layers/live-layer-bootstrap.js` | Adds the group + six service datasets |
| `js/live-layers/live-layer-engine.js` | Fiber branches (paint, glyphs, where, offsets, hover, draw order) |
| `js/live-layers/live-layer-hits.js` | Closest-hit helper used by hover |
| `js/live-layers/live-layer-styles.js` | Re-exports Fiber styles |
| `js/map/map-manager.js` | Exclude Fiber from click popups; reorder after layer moves |
| `css/main.css` + `css/map-window.css` | `.udot-fiber-hover-tooltip*` |
| `public/icons/udot-fiber-network.png` | Catalog card |

### Tests to port

```
tests/udot-fiber-symbology.test.js
tests/udot-fiber-hover.test.js
tests/udot-fiber-draw-order.test.js
```

---

## Desktop wiring checklist

In the desktop live-layer / map path, Fiber URLs must:

- [ ] Add as **vector** MapServer queries, not MapServer image tiles
- [ ] Route paint through `addUdotFiberVectorLayers()` (not the generic fill/line/circle stack)
- [ ] Preload glyphs before `addLayer`
- [ ] Filter Boxes in `where` + JS; no MapLibre exclude expression
- [ ] Offset fiber geometry for multi-sheath
- [ ] Stamp `_udotGlyph` / `_udotBoxLabel` after fetch
- [ ] Register hover layers; unregister on remove
- [ ] Re-run draw-order after every Fiber add / panel reorder
- [ ] Strip Fiber live hits from click popups
- [ ] Inherit catalog `minZoom: 14` and `refreshMs: 0`
- [ ] Keep cabinets on top even if the user reorders the folder

`download.js` is optional. Use it only if desktop still wants a one-shot GeoJSON / SQLite snapshot. That snapshot must go through the **same** decorate + paint path or it will look like raw ArcGIS.

---

## What not to do

- Do not draw published `esriPMS` PNGs for cabinets / splices / boxes.
- Do not style splices from `MODEL_1`.
- Do not put solid casing/glow under dashed conduit.
- Do not change 14 / 17 / 19.02 without an explicit visual review.
- Do not treat this as Network Atlas / DuckDB / GeoParquet data.
- Do not add a MapLibre filter for the Boxes hide list.

---

## Smoke test

1. Import → Live Layers → **UDOT Fiber Network** (password if gated).
2. Below zoom 14: nothing draws, no ArcGIS traffic.
3. Neighborhood (~14–16): conduit dash has **transparent** gaps; fiber has casing/glow; cabinets sit above boxes/splices.
4. Zoom 17 → out: boxes/splices shrink; cabinets shrink less.
5. Zoom **19.02** and in: boxes/splices grow with the map; cabinets flatter.
6. Boxes: white landscape rect + `BOXLABELS` inside; vaults red circles, unlabeled.
7. Hover a cabinet / splice / box / fiber / conduit / building — tooltip fields match the table; click does not open a popup.
8. Reorder the group in the layer panel — cabinets stay on top.

PWA check: `npm test` (Fiber tests above).
