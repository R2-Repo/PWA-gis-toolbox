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
| `layers.perSheet[]` | Per-sheet GeoJSON: `sheet_outline` + design features **clipped to the sheet polygon** |
| `pdf` | Page plan (overview + detail pages) — renderer not yet implemented |

Feature assignment for export uses **polygon intersection** (`clipFeaturesToSheetFrame`), not station distance alone.

### PDF (polygon-clipped map capture + folder export)

Sheet PDFs are **MapLibre map captures** clipped to each sheet polygon, placed on tabloid (or template) pages with modest margins, and written **one file at a time** to a folder the user picks (File System Access API — Chrome/Edge).

1. **Overview** (optional) — `fitBounds` to all sheet frames; rectangular capture saved as `{project}_overview.pdf`.
2. **Detail pages** — per sheet: camera aligned to `rotationDeg`, map captured at **150 DPI**, **polygon clip mask** applied, fitted into printable margins on tabloid landscape, saved as `{project}_sheet_01.pdf`, etc.
3. **No multipage PDF** — each page is written immediately so memory stays flat on long routes.

Implementation: `js/widgets/sheet-cutting/sheet-pdf-export.js`, `js/export/folder-export.js`

The map camera and 3D state are restored after export. 3D is temporarily flattened for consistent plan-sheet output.

**Not used for PDF:** Canvas 2D GeoJSON drawing or pdf-lib — those would not match on-screen symbology.

---

## Related files

| Path | Purpose |
|------|---------|
| `js/widgets/sheet-cutting/engine.js` | Station stepping, match-line metadata, validation |
| `js/widgets/sheet-cutting/export-builder.js` | **Clean polygon geometry** |
| `js/widgets/sheet-cutting/controller.js` | Preview wiring |
| `react/widgets/SheetCuttingDialog.jsx` | Wizard UI |
| `js/widgets/sheet-cutting/sheet-pdf-export.js` | Polygon-clipped PDF export to folder |
| `js/export/folder-export.js` | File System Access API folder writer |
