# Sheet Cutting — Clean Geometry Model

This document defines **clean sheet cutting** — the canonical way clipped sheet polygons are built in the Sheet Cutter widget.

**Implementation:** `js/widgets/sheet-cutting/export-builder.js` (`buildClippedSheetPolygon`, `buildBufferedStationCorridor`, `buildStationHalfPlanePolygon`).

**Tests:** `tests/sheet-cutting-engine.test.js` (geometry section).

---

## What “clean sheet cutting” means

Each detail sheet is a **single valid polygon** that:

1. **Tiles along the route** — contiguous station ranges, no overlap between neighbors.
2. **Shares exact match-line corners** — adjacent sheets use the **same left/right vertices** at every interior boundary.
3. **Has smooth curved sides on bends** — outer/inner edges follow the route (buffer), not jagged sawteeth.
4. **Uses flat match lines** — interior boundaries are perpendicular cuts at sheet stations, not round buffer end caps.
5. **Shows clipped coverage only in preview** — no dashed paper frames or match-line linework in the map preview layer.

If a future change breaks corner alignment, introduces self-intersections (kinks), or reintroduces overlap, it is **not** clean sheet cutting.

---

## Geometry model (three steps)

For each detail sheet with station range `[startFt, endFt)`:

### 1. Corridor — buffer the centerline segment

- Slice the route from `startFt` to `endFt` (`lineSliceAlongRoute`).
- Buffer by **half the map-frame height** (`mapFrameHeightFt / 2`).
- Use **flat end caps** (`endCapStyle: 'flat'`) so route ends are not semicircles.

This sets the **perpendicular width** of the sheet footprint. All sheets use the same corridor half-width, so offset sides are consistent on curves.

### 2. Match lines — perpendicular cuts at sheet boundaries

- At **interior** `startFt` (not route start): keep the forward side of a half-plane perpendicular to the route tangent at that station.
- At **interior** `endFt` (not route end): keep the backward side of the same kind of half-plane.

Adjacent sheets share the same cut at the boundary station, so **both polygons include the same cap edge** (same `left` and `right` corner coordinates). Corridor caps are registered in `buildCorridorMatchLineRegistry()` at corridor half-width.

### 3. Along-route limit — map-frame clip width

- Center on the sheet center station (`centerDistanceFt`).
- Clip with half-planes at `center ± (mapFrameWidthFt + mapFrameHeightFt) / 2` along the route.

This limits how far **along the route** the polygon extends (the printable map-frame clip width). It does **not** use a per-sheet rotated paper rectangle for perpendicular clipping.

---

## What we deliberately do **not** do

These approaches were tried and produce **non-clean** results:

| Anti-pattern | Why it fails |
|--------------|--------------|
| **Per-sheet rotated paper ∩ corridor** | Each sheet’s paper frame is rotated to its own center tangent; on curves, match-line corners drift and edges step. |
| **Manual left/right offset stitching** | Self-intersecting rings on curves (bow-tie polygons, sawtooth gaps). |
| **Snapping / forcing cap vertices after intersect** | Masks bad source geometry; creates spikes when the ring is already invalid. |
| **Overlap stepping** (`overlapFt`) | Duplicate coverage; sheets are no longer a partition of the route. |
| **Round buffer end caps on interior cuts** | Match lines must be flat perpendicular cuts, not semicircles. |

Wide match-line segments in `buildSharedMatchLineRegistry()` are for **labels and export metadata only**, not for building clipped polygons.

---

## Key functions

| Function | Role |
|----------|------|
| `buildBufferedStationCorridor()` | Buffer route slice at corridor half-width |
| `buildStationHalfPlanePolygon()` | Perpendicular clip at a station |
| `buildClippedSheetPolygon()` | Full clean sheet footprint for one sheet |
| `buildCorridorMatchLineRegistry()` | Shared cap corners at corridor width (geometry) |
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
- Map-frame ground dimensions come from `calculateMapFrameGroundDimensions()` (paper, margins, title block, legend, scale).
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

### PDF (map capture + jsPDF)

Sheet plan PDFs are **literal MapLibre screenshots** assembled with **jsPDF** (already in the project):

1. **Overview page** — `fitBounds` to all sheet frames, capture the live map (basemap + visible layers + sheet outlines).
2. **Detail pages** — one sheet at a time: `fitBounds` to that sheet polygon, capture the same map view.
3. **Assembly** — each capture is letterboxed onto a tabloid (or template) landscape page in jsPDF.

Implementation: `js/widgets/sheet-cutting/sheet-pdf-export.js`

The map camera is restored after export. Captures use the same high-resolution path as the header **Download PDF** map export (`captureMapCanvas`).

**Not used for PDF:** Canvas 2D GeoJSON drawing or pdf-lib — those would not match on-screen symbology.

---

## Related files

| Path | Purpose |
|------|---------|
| `js/widgets/sheet-cutting/engine.js` | Station stepping, match-line metadata, validation |
| `js/widgets/sheet-cutting/export-builder.js` | **Clean polygon geometry** |
| `js/widgets/sheet-cutting/controller.js` | Preview wiring |
| `react/widgets/SheetCuttingDialog.jsx` | Wizard UI |
