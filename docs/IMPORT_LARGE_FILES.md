# Large File Import — Architecture & Build Plan

How GIS Toolbox imports files bigger than the browser's in-memory pipeline can
hold, and the phased plan for the full import refactor. Companion to the
"PWA Import and Large File Optimization Master Plan" (ChatGPT scope doc).

## Review of the master plan

The master plan's core rules are correct and adopted:

> MapLibre renders the current view; it is not the database for the dataset.
> Large layers must never require the whole decoded dataset in memory at once.

Two adjustments against the actual codebase:

1. **Much of the plan already exists.** The guard → scan → route → optimizer →
   workspace(IndexedDB) → viewport-render pipeline was already built
   (`js/import/import-guard.js`, `import-routing.js`, `ImportOptimizerDialog`,
   `js/workspace/workspace-store.js`, `viewport-loader.js`, one parse worker).
   The refactor **extends** this architecture instead of replacing it. Phases
   1–2 and about half of phases 3–5 of the master plan were already done before
   this effort started.
2. **The real blocker was the hard caps, not the architecture.** Files above
   ~4–6 MB (text) / 5–8 MB (binary) were rejected outright, and even accepted
   files were fully decoded (whole text → whole FeatureCollection → clone to
   main thread) before being chunked to IndexedDB. Fixing that is the highest
   value work, and it ships first.

Everything else in the master plan (preflight wizard, hot/cold attributes,
`__lgid`, DuckDB-WASM + MVT, streamed export, `.gispack`) stays on the roadmap,
sequenced below.

## Build 1 (this build): streaming high-capacity import

### What it does

Large **GeoJSON / JSON-FeatureCollection / CSV / KML / KMZ / zipped-KML**
files that the standard pipeline would reject now import through a streaming
path:

```
File (drag-drop or Import dialog)
  → stream-policy partition (standard | streaming | rejected)
  → stream-import.worker  (reads File incrementally, never whole-file)
      GeoJSON: incremental FeatureCollection parser (feature-at-a-time)
      CSV:     PapaParse chunk streaming (rows → point features)
      KML:     incremental placemark scanner → batched DOM+toGeoJSON convert
      KMZ/zip: central-directory lookup → DecompressionStream on the main
               KML entry only (icons/overlays are never extracted)
  → batches of ~1000 features posted to main thread (ack backpressure)
  → appendWorkspaceBatch → IndexedDB chunks + grid spatial index
  → original file preserved in OPFS (import-sources/)
  → workspace layer on map (viewport-only rendering, existing path)
```

The user experience is unchanged: drop the file or pick it in the Import
dialog, watch one progress bar, get a layer. No new dialogs.

### Key properties

- **Flat memory.** Only one batch exists in transit at a time; the worker
  waits for an `ack` before parsing further (backpressure). Peak main-thread
  memory is a batch (~1000 features / ≤8 MB), regardless of file size.
- **Zero change to existing paths.** Streaming only activates for files that
  previously hard-failed (`PREFLIGHT_LEVEL.REJECT`, streamable formats).
  Small/medium files use the exact same code as before.
- **Source preservation.** The original file is copied into OPFS
  (`js/workspace/source-file-store.js`) and referenced by
  `dataset.source.opfsKey`; deleted when the last referencing layer is removed.
  Skipped gracefully when OPFS or quota is unavailable (Safari fallback).
- **Cancel + rollback.** Cancel terminates the worker and removes any
  partially-written workspace chunks and the OPFS copy.
- **Mixed geometry** splits into per-class layers (`Name - Points/Lines/
  Polygons`), matching the standard import convention.
- **Fence imports** filter per-feature in the worker (bbox test).

### Limits (v1)

| Limit | Value | Where |
|---|---|---|
| Streaming trigger | text ≥ 4 MB (standard reject point) | `stream-policy.js` |
| Max streamed file | 512 MB | `STREAM_MAX_BYTES` |
| Max streamed features | 1,000,000 | `STREAM_MAX_FEATURES` |
| Max single feature | 24 MB JSON | `geojson-stream-parser.js` |
| GIS tools / export materialization | 250,000 features | `gis-layer-context.js` |
| Toolbox Kit bundle per layer | 250,000 features | `workspace-store.js` |

Streamed layers above the materialization cap are **view/inspect/identify**
layers: GIS tools and full export refuse with a clear message instead of
crashing the tab. Streamed export lifts this in a later build.

Known constraints (deliberate scope):

- Large CSV must contain coordinate columns (pure tables are refused with a
  clear message — table storage streams in a later build). Projected
  easting/northing CSVs prompt for a source CRS and reproject in the worker.
- Large KML/KMZ import as **simplified GIS layers** (`importMode: 'gis'`):
  descriptions/balloon HTML, styleUrl, and embedded icons/overlays are not
  kept — matching the Import Optimizer's recommendation for KML. Small/medium
  KML keeps the existing preserve-mode path.
- Streaming KMZ requires `DecompressionStream` (all evergreen browsers);
  otherwise the archive falls back to the standard caps. ZIP64 archives are
  not supported.
- Large Excel keeps the existing caps (whole-workbook format cannot stream);
  streamed shapefiles support one shapefile per archive.
- Workflow-editor file-import nodes keep the standard-path caps.

### Files

| File | Role |
|---|---|
| `js/import/stream/stream-policy.js` | Eligibility + partition (stream / standard / reject) |
| `js/import/stream/stream-constants.js` | Tuning constants (dependency-free, shared with worker) |
| `js/import/stream/geojson-stream-parser.js` | Incremental FeatureCollection parser (pure, tested) |
| `js/import/stream/kml-stream-parser.js` | Incremental KML placemark/style scanner (CDATA/comment safe) |
| `js/import/stream/kml-stream-convert.js` | Placemark blocks → GeoJSON (batched mini-docs, style context) |
| `js/import/stream/zip-central-directory.js` | ZIP central-directory reader + per-entry DecompressionStream |
| `js/import/stream/stream-import-service.js` | Worker orchestration, per-geometry-class workspace writes |
| `js/workers/stream-import.worker.js` | Streaming parse (GeoJSON, CSV, KML, KMZ), batch/ack protocol |
| `js/tools/stream-import-flow.js` | Progress UI, map wiring, rollback, toasts |
| `js/workspace/source-file-store.js` | OPFS original-source preservation |
| `js/core/data-model.js` | `createSchemaAccumulator()` (incremental schema) |

Also in this build: workspace spatial-index `removeLayer` regression fix
(removing one layer wiped other layers' cell entries), key-range attribute
deletion (layer removal no longer loads every attribute record), workspace
layers excluded from the in-memory import budget, and materialization guards.

## Build 2 (shipped): streaming KML/KMZ + import choices

- Streaming KML via an incremental placemark scanner (CDATA/comment/quote
  safe) with batched DOM + toGeoJSON conversion in the worker; shared
  Style/StyleMap/Schema context preserved for wrapping.
- Streaming KMZ / zipped KML: the ZIP central directory is read from the file
  tail, and only the main KML entry is stream-decompressed
  (`DecompressionStream`) — embedded icons/images are never extracted.
- Large KML/KMZ import as simplified GIS layers (gis mode strip).
- Import dialog: stream files now show a high-capacity notice + the standard
  field-selection step (head-sniffed fields); the filter is applied per
  feature in the worker. A full-fields import is used when nothing is
  deselected, so late-appearing fields are never dropped by accident.
- KMZ field sniffing now uses the central directory, so it also works for
  archives of any size.

## Build 3 (shipped): streaming shapefile + projected CSV

- Streaming zipped shapefile: `.shp` records and `.dbf` rows parse in lockstep
  from per-entry `DecompressionStream`s (`byte-reader.js`,
  `shp-stream-parser.js`, `dbf-stream-parser.js`, `shapefile-stream.js`).
  `.prj` WKT reprojects to WGS84 via proj4 in the worker (matching shpjs
  output within 1e-6 in differential tests); `.cpg` selects the DBF text
  encoding (latin1 default, like shpjs). Polygon rings assemble by winding
  with a containment fallback for non-spec writers. Z/M values are dropped
  (2D display data; the original archive is preserved in OPFS).
- One shapefile per archive on the streaming path; multi-shapefile archives
  keep the standard path.
- Projected CSV (easting/northing): the flow now prompts for the source CRS
  (existing CRS dialog + registry proj4 defs) and retries with in-worker
  reprojection — previously refused outright.
- The Import dialog's high-capacity notice shows the head-sniffed feature
  estimate.

## Roadmap (subsequent builds)

Notes: streaming Excel remains impractical (whole-workbook format) —
convert-to-CSV guidance stands.

### Build 4 — DuckDB-WASM + local MVT tiles (the Re:Earth pattern)

- `js/data/duckdb/` internal infrastructure: lazy-loaded DuckDB-WASM manager
  (workers + OPFS-backed database), importer, spatial queries.
- Custom MapLibre protocol (`duckdb://`) → tile bbox SQL → MVT encode in
  worker → tile bytes to MapLibre. Isolated proof of concept first, behind a
  hidden flag, compared against the workspace/viewport path for memory and
  interaction quality before it becomes a default for very large layers.
- This replaces the 10k-feature viewport cap as the display path for heavy
  layers; the workspace store stays the source of truth (or migrates to
  Parquet in OPFS where beneficial).

### Build 5 — Identity, cold attributes, streamed export

- `__lgid` immutable UID assigned at import, linking workspace records,
  display features, edits, and export restoration (master plan §5).
- Hot/cold attribute split with "Detach for export" (§10) — the attributes
  store already exists; add a cold sidecar store + join-on-demand.
- Streamed export: batch-read workspace chunks → incremental
  GeoJSON/CSV writer → OPFS staging file → download. Lifts the 250k export cap.
- Edit sessions for heavy layers (§23): edit a selection, write back to
  workspace chunks, invalidate affected viewport/tiles.

### Build 6 — Workspace packaging & cleanup wizard

- Large Dataset Cleanup Wizard as a GIS Widget (per `docs/WIDGET_AGENT_PLAYBOOK.md`)
  once Builds 2–4 provide the primitives it needs.
- `.gis-toolbox` kit: reference OPFS sources + chunked layers without
  materializing bundles (lifts the 250k kit cap).
- Storage manager UI: list/remove preserved sources (`listSourceFiles()`),
  quota display.

## Governing rules (unchanged from master plan)

1. Never require the whole decoded dataset in memory.
2. MapLibre renders the view; IndexedDB/OPFS hold the data.
3. Preserve the authoritative source separately from display data.
4. Prevention over recovery: guards and caps stay, streaming raises them.
