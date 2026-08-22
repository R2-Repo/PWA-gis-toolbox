# Sheet Cutting — Clean Geometry Model

This document defines **clean sheet cutting** — the canonical way clipped sheet polygons are built in the Sheet Cutter widget.

**Implementation:** `js/widgets/sheet-cutting/export-builder.js` (`buildSymmetricSheetPolygon`, `buildSymmetricCorridorCap`, `buildClippedSheetPolygon`).

**Tests:** `tests/sheet-cutting-engine.test.js` (geometry section).

---

## What “clean sheet cutting” means

Each detail sheet is a **single valid polygon** that:

1. **Tiles along the route** — contiguous station ranges, no overlap between neighbors.
2. **Shares exact match-line corners** — adjacent sheets use the **same left/right vertices** at every interior boundary.
3. **Mirrors corridor width about the centerline** — left and right sides are equal `lineOffset` distances from the route (symmetric on curves).
4. **Uses flat match lines** — interior boundaries are perpendicular cuts at sheet stations, not round buffer end caps.
5. **Shows clipped coverage only in preview** — no dashed paper frames or match-line linework in the map preview layer.

If a future change breaks corner alignment, introduces self-intersections (kinks), breaks mirror symmetry, or reintroduces overlap, it is **not** clean sheet cutting.

---

## Geometry model (three steps)

For each detail sheet with station range `[startFt, endFt)`:

### 1. Corridor sides — perpendicular offsets at each station

- Sample the route at regular stations across `[startFt, endFt]` (typically every 20–40 ft).
- At each station, offset **±halfHeight** perpendicular to the local route tangent (`getLocalTangentBearing`).
- This keeps the centerline centered in the corridor on curves (equal half-width each side).

Do **not** rely on sparse `turf.lineOffset` + simplify alone — on curves that collapses to a trapezoid with straight chords and uneven inner/outer width.

### 2. Match lines — perpendicular caps at sheet boundaries

- At each sheet `startFt` and `endFt`, build a flat perpendicular segment through the centerline at **halfHeight** (`buildSymmetricCorridorCap`).
- Interior boundaries use one registry entry per station so neighbors share identical cap vertices.

**Do not** derive cap corners from the buffer outer boundary (`buildCapFromCorridorBoundary`) — that widens unevenly on curves and breaks mirror symmetry.

### 3. Close the ring with square caps

- Each narrow end is exactly **one straight line** from `left` to `right` at the station (perpendicular to the route).
- Offset curve endpoints are not used for caps — only interior side vertices are kept.
- Do **not** build sheet polygons from `turf.buffer()` output; Turf ignores `endCapStyle: 'flat'` in this stack and produces round ends.

---

## What we deliberately do **not** do

These approaches were tried and produce **non-clean** results:

| Anti-pattern | Why it fails |
|--------------|--------------|
| **Per-sheet rotated paper ∩ corridor** | Each sheet’s paper frame is rotated to its own center tangent; on curves, match-line corners drift and edges step. |
| **Full-route buffer + half-plane clip** | Half-plane wedge skews on curves; one corridor side clips away entirely. |
| **Per-segment buffer for sheet polygons** | Produces round end caps (Turf `endCapStyle: 'flat'` not honored); overlapping capsule shapes at interior boundaries. |
| **Boundary-derived cap corners** (`buildCapFromCorridorBoundary`) | Extends caps to buffer outer edge; widens one side more than the other on bends. |
| **Snapping / forcing cap vertices after intersect** | Masks bad source geometry; creates spikes when the ring is already invalid. |
| **Overlap stepping** (`overlapFt`) | Duplicate coverage; sheets are no longer a partition of the route. |
| **Round buffer end caps on interior cuts** | Match lines must be flat perpendicular cuts, not semicircles. |

`buildFullRouteCorridor()` and `buildBufferedStationCorridor()` remain for legacy helpers and validation; **sheet frame polygons** are built from symmetric offsets.

Wide match-line segments in `buildSharedMatchLineRegistry()` are for **labels and export metadata only**, not for building clipped polygons.

---

## Key functions

| Function | Role |
|----------|------|
| `buildSymmetricSheetPolygon()` | Mirrored offset sides + perpendicular caps |
| `buildSymmetricCorridorCap()` | Shared left/right cap corners at a station |
| `buildClippedSheetPolygon()` | Public entry — delegates to symmetric builder |
| `buildCorridorMatchLineRegistry()` | Shared cap corners for all interior sheet boundaries |
| `buildMatchLineSegment()` | Perpendicular segment at a station |
| `buildBufferedStationCorridor()` | Legacy per-segment buffer helper |
| `buildFullRouteCorridor()` | Legacy full-route buffer helper |
| `buildSharedMatchLineRegistry()` | Wide match lines for labels / PDF annotations (metadata) |
| `buildSheetFramesGeoJson()` | Preview/export `sheet_frame` features |
| `buildPerSheetLayerExports()` | Per-sheet outline + clipped design features |
| `buildSheetExportPackage()` | GIS layer package + PDF page plan |
| `buildSheetPdfPagePlan()` | Overview + detail page order for PDF |

---

## Validation expectations

Clean sheet cutting should satisfy:

- `turf.kinks(frame)` — zero self-intersections on every sheet polygon.
- `validateClippedSheetOverlap()` — negligible area between neighbors.
- `validateCenterlinePolygonCoverage()` — every sample along the centerline (and offset samples) lies in exactly one sheet.
- Adjacent frames share corridor cap `left` and `right` vertices (`buildCorridorMatchLineRegistry` + `coordsEqual`).
- `sharedBoundaryEdgesOverlap()` — shared edge length along match lines.
- Probes at `halfHeight − ε` inside and `halfHeight + ε` outside on **both** sides of the centerline.

---

## Export model

Sheet Cutter produces **two deliverable types** only:

1. **GIS layers** (GeoJSON) — for map use, QA, and as the source for PDF rendering.
2. **PDF plan set** (planned) — one multi-page PDF:
   - **Page 1:** overview — full route with all sheet outlines.
   - **Pages 2+:** one detail sheet per page — sheet polygon outline plus design features clipped to that polygon.

### Not exported

- Sheet index CSV, match-line CSV, and other tabular sidecars are **not** part of the sheet-cutting export. Match-line metadata remains in the session for future PDF annotations but is not downloaded.

### Paper target

- Default template: **Tabloid landscape** (`TABLOID`, 11×17 in).
- Map-frame ground dimensions come from **`sheetLengthFt`** (along-route sheet length) and **`corridorWidthFt`** (perpendicular corridor width), defaulting to **1100 ft × 350 ft**.
- Legacy sessions that only store `scale` still resolve dimensions via `calculateMapFrameGroundDimensions()` (paper, margins, title block, legend, scale).
- Clean sheet polygons define the **map clipping boundary** in ground feet; PDF rendering maps that boundary onto the printable map frame on tabloid paper.

### GIS layer package (`buildSheetExportPackage`)

| Layer | Contents |
|-------|----------|
| `layers.route` | Route centerline |
| `layers.sheetFrames` | Clean clipped `sheet_frame` polygons |
| `layers.overview` | Route + all sheet outlines (for overview page) |
| `layers.perSheet[]` | Per-sheet GeoJSON: gold `sheet_outline`, matchline labels, and design features **clipped to the sheet polygon**. Does **not** include the widget centerline — that stays on the overview only. |
| `pdf` | Page plan (overview + corridor pages + optional 4-up details pages) |

Feature assignment for export uses **polygon intersection** (`clipFeaturesToSheetFrame`), not station distance alone.

### PDF (hybrid vector + basemap underlay)

Sheet PDFs combine a **modest-resolution basemap image** (whatever basemap is active on the map, including future basemaps) with **vector-drawn linework, labels, route, and sheet outlines** on top. Pages are written **one file at a time** to a folder the user picks (File System Access API — Chrome/Edge).

1. **Overview** (optional) — `fitBounds` to all sheet frames; **north-up** (`bearing: 0`); basemap captured at **basemap DPI** (default 150); sheet frames and route drawn as vector; saved as `{project}_overview.pdf`.
2. **Detail pages** — per sheet: camera aligned to **export bearing** (landscape-align by default); design layers hidden; **basemap-only** capture clipped to the sheet polygon at **basemap DPI** (120–200); selected design layers + sheet outline drawn as **vector PDF** on top (no widget centerline overlay); saved as `{project}_sheet_01.pdf`, etc.
   **UDOT Fiber** is refreshed for that sheet, then drawn as **vector** (class colors, thin fiber/conduit strokes, point marks). Fiber/Conduit **along-line labels are not exported**. Box `BOXLABELS` stay inside landscape rectangles (map-scale size, transparent fill, jsPDF text angle follows the box). Cabinets use the same lookalike color as the map.
   Corridor pages also draw any **detail boxes** that belong to that sheet (`DETAIL A` + `SEE DETAILS nn`).
3. **Details pages** (optional) — after corridor sheets, packed **4-up** zoomed cutouts (`{project}_details_01.pdf`). Each quadrant is north-up, fitted to that box, with its own scale. Leftover 1–3 boxes leave empty cells (same remnant rule: do not stretch to fill the page). Footer uses a **DETAILS nn of N** series, separate from **Sheet NN of N**.
4. **No multipage PDF** — each page is written immediately so memory stays flat on long routes.

| Layer | Technology | Zoom behavior |
|-------|------------|---------------|
| Basemap underlay | MapLibre capture at basemap DPI | Soft when zoomed far (background context) |
| UDOT Fiber (live overlay, or converted operational copy) | jsPDF vector (thin lines; no Fiber/Conduit line labels) | Infinite zoom — always crisp |
| Other design + stationing + sheet outline (overview also draws the widget route) | jsPDF vector paths + text | Infinite zoom — always crisp |
| North arrow / footer | jsPDF vector | Crisp |

**Basemap quality** (`basemapDpi`, default 150) affects only the background image and file size. The underlay is JPEG (~88% quality) so a combined 10-sheet set usually stays emailable. Linework and labels are vector regardless of this setting.

**Remnant (short last) sheets** keep the **same map scale and corridor height** as full-length sheets. Placement fits a **nominal** frame (`sheetLengthFt` × `corridorWidthFt` at the current zoom), then draws the actual clip at that scale — a shorter remnant is a shorter image, not a zoomed-up fill of the page. Without that reference, a square leftover would scale to page height.

**Design layers must be selected** in the Sheet Cutter wizard for their features to appear in vector export. Layer styles are resolved from `mapService.getLayerStyle()` using `_sourceLayerId` stamped at collection time. **UDOT Fiber** that is on the map is drawn as vector on detail sheets (hide the group first if you do not want it).

### Editable Fiber from sheets

If live **UDOT Fiber** is selected under **Add Current map layers to sheets**, the wizard offers:

1. **Keep live overlay** (default) — yesterday’s behavior. Live Fiber stays on the map and is refreshed/drawn on sheet PDFs with the existing jsPDF Fiber rules.
2. **Convert to editable map layer** — on **Generate Sheets**, selected live Fiber that intersects the sheet polygons is copied onto the map (grouped as `{project} Fiber (editable)`), the live overlay is turned off, and that operational copy is used for editing **and** PDF export.

The copy uses the same CAD paint as live Fiber (class colors, sheath offsets, glyphs, box labels). Nothing is written back to ArcGIS. If you skip convert, PDFs still use live Fiber only.

After convert, **Export sheet PDFs** collects the operational copy (or remaining live Fiber for keys you did not convert) and draws it with the same `buildUdotFiberPdfStyle` / box-layout path as live Fiber. Edits on the operational layer are what appear in the PDFs.

A **Convert selected Fiber to editable map layers** button remains after generate if live Fiber is still selected (for example after generating with **Keep live overlay**).

### Detail boxes / DETAILS sheets

After sheets are generated, **Draw detail box** lets you drag a north-up rectangle that overlaps a gold sheet polygon. Boxes are labeled **DETAIL A, B, C…**, stored on the sheet session (`insetViews`), and shown on the map in blue. Regenerating corridor sheets clears the boxes.

Export then:

1. Draws each box on its parent corridor PDF with `SEE DETAILS nn`.
2. Adds packed **DETAILS** pages, four boxes per tabloid landscape sheet (`pageType: 'inset'`). Fiber uses the same live-or-converted path as corridor pages, clipped to the box.

Do **not** change clean sheet-cutting polygons for this feature — boxes are overlay annotations plus extra PDF pages.

Implementation: `js/widgets/sheet-cutting/inset-views.js`, `js/widgets/sheet-cutting/controller.js`, `js/widgets/sheet-cutting/sheet-pdf-export.js`

### Plan Set Callouts overlay

**Plan Set Callouts** (GIS Widgets, Beta) draws numbered circle leaders and a **PROJECT KEY NOTES** table on corridor PDFs (`pageType === 'detail'`). Callouts start **off**; turn them on from the widget Review step or by right-clicking a feature. After **Done**, leaders stay on the map (drag the numbered circle; the feature anchor stays put) and the widget can be reopened to continue. Features inside a Sheet Cutter **detail box** hide on the corridor sheet and appear on that box’s **DETAILS** page instead. Overview pages are unchanged. Callout geometry is an overlay — it does **not** change clean sheet polygons.

Implementation: `js/widgets/plan-set-callouts/`, hooked from `buildHybridPagePdfBlob` in `sheet-pdf-export.js`.

The map camera and 3D state are restored after export. 3D is temporarily flattened for consistent plan-sheet output.

### PDF orientation

Detail pages default to **landscape-align**: each sheet polygon is rotated so its **long axis runs along the tabloid landscape width**, while **north stays upright** (never flipped 180°). The north arrow rotates on every sheet to show true north for that view.

| Mode | Template key | Behavior |
|------|----------------|----------|
| **Landscape-align** (default) | `pdfMapBearingMode: 'landscape-align'` | Route along page length; north upright; compass adjusts per sheet. |
| **North-up** | `pdfMapBearingMode: 'north-up'` | Same orientation as the map preview (bearing 0). |
| **Match-line flow** (optional) | `pdfMapBearingMode: 'match-line-flow'` | Forces left → right station flow; may flip 180° (north can point down). |

| Rule | Behavior |
|------|----------|
| **North arrow** | Top-right margin; rotated **−exportBearingDeg** from page up so it shows true north relative to the map. |
| **Title-block footer** | Flush to the bottom of the page (within side margins): bordered 5-cell bar — **Project** (wizard name), **Date** (export `MM/DD/YYYY`), two empty spare cells for post-export edits, and **Sheet NN of N**. Station range and continuation arrows are not drawn on the PDF. |
| **Edge SEE SHEET labels** | Detail pages only. See **PDF matchline SEE SHEET labels** below. |
| **Overview** | Always north-up. |

Landscape-align picks between two bearings 180° apart (`tangent − 90°` and `tangent + 90°`), keeps the one where north points up, and prefers left → right when both qualify.

Key functions: `resolveSheetPdfBearing()`, `resolveLandscapeAlignBearing()`, `resolveSheetPdfBearings()`, `buildSheetTitleBlockFooterModel()`, `buildSheetContinuationLabels()` in `sheet-pdf-orientation.js`.

---

## PDF matchline SEE SHEET labels

Detail pages draw `SEE SHEET NN` on each interior match-line cap (previous sheet at start, next sheet at end). The label must sit **just outside the gold cutout**, parallel to that cap, on **every** sheet — including the right-hand cap and non-rectangular (parallelogram / curved-corridor) cutouts.

**Live draw path** (do not revive `drawSheetEdgeSeeLabels` for this):

1. `buildMatchlineSeeLabelFeatures()` stores a point at the cap midpoint plus `cap_left` / `cap_right`.
2. `renderFeatureCollectionToPdf()` projects the gold `sheet_outline` to a PDF ring.
3. `placeMatchlineLabelOnGoldOutline()` puts the alphabetic baseline ~2 pt outside that cap edge, caps facing out.
4. `drawRotatedHaloText()` draws with `align:'left'`, `baseline:'alphabetic'`, and `computeRotatedTextAnchor()`.

### jsPDF rotation (the part that breaks right-side / skewed labels)

jsPDF builds `Tm` as `Matrix(cos θ, sin θ, −sin θ, cos θ)` in **PDF y-up**. In **page y-down** that means:

| Quantity | Page y-down vector | Code |
|----------|--------------------|------|
| Text run (along the string) | `(cos θ, −sin θ)` | `computeRotatedTextAnchor`: `x − half·cos`, `y + half·sin` |
| Glyph caps (up from the baseline) | `(−sin θ, −cos θ)` | `pickJsPdfAngleWithCapsOutward` |

**Do not** use `(sin θ, −cos θ)` for caps, `(cos θ, sin θ)` for the half-width Y shift, `align:'center'` with `angle`, or `baseline:'middle'`. Those look fine on a vertical **left** edge and pull **right-hand and diagonal** labels into the cutout.

`baseline:'middle'` is applied in unrotated page Y **before** rotation — same right-edge failure.

### Placement rules

- Origin is the **match-line cap edge** (projected `cap_left` → `cap_right`), not the page bounding box and not “page-right = +X”.
- Outward is the perpendicular that leaves the gold outline (`probeOutwardUnitNormal`).
- Text stays parallel to that edge; pick the 180° that makes **actual** jsPDF caps follow outward.
- Standoff is a few points along that normal so the inner glyph edge sits on the gold stroke.

### Tests (must keep passing)

`tests/sheet-pdf-vector.test.js` — rectangle left/right, parallelogram right edge, 20° rotated right edge, and `pickJsPdfAngleWithCapsOutward` on a diagonal outward.

`tests/sheet-pdf-export.test.js` — `computeRotatedTextAnchor` uses `(cos, −sin)` run direction.

If a future change makes right-side or skewed labels drift again, check the jsPDF vectors in the table before changing snap / walk-out logic.

---

## Related files

| Path | Purpose |
|------|---------|
| `js/widgets/sheet-cutting/engine.js` | Station stepping, match-line metadata, validation |
| `js/widgets/sheet-cutting/export-builder.js` | **Clean polygon geometry** |
| `js/widgets/sheet-cutting/controller.js` | Preview wiring |
| `react/widgets/SheetCuttingDialog.jsx` | Wizard UI |
| `js/widgets/sheet-cutting/inset-views.js` | Detail-box session, 4-up packing, callout features |
| `js/widgets/sheet-cutting/sheet-pdf-export.js` | Hybrid PDF export to folder |
| `js/widgets/sheet-cutting/sheet-pdf-fiber.js` | Keep live Fiber paint in the detail underlay |
| `js/widgets/sheet-cutting/sheet-pdf-vector.js` | Vector GeoJSON → jsPDF renderer; **matchline SEE SHEET draw** (`placeMatchlineLabelOnGoldOutline`) |
| `js/widgets/sheet-cutting/sheet-matchline-labels.js` | Geographic SEE SHEET point features (cap midpoint + outward probe) |
| `js/widgets/sheet-cutting/sheet-pdf-placement.js` | Shared map-pixel → PDF-point placement |
| `js/widgets/sheet-cutting/sheet-pdf-orientation.js` | PDF export bearing + continuation labels |
| `js/export/folder-export.js` | File System Access API folder writer |
