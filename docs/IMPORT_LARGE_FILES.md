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
  → spatial chunk writer (coarse degree-grid buckets) → appendWorkspaceBatch
    → IndexedDB chunks + grid spatial index
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

### End-user import gates (authoritative — read this first)

Agents and docs must describe **what can actually land in the app**, not
source-read plumbing. There are **two** product gates:

#### Gate A — Small / standard (in-memory, no streaming IndexedDB write)

| | Min | Max (what lands) |
|---|---|---|
| File size | none | **&lt; ~4 MB** text / **&lt; ~5 MB** binary |
| Features | none | **250,000** |

Above those sizes the standard path refuses; streamable formats move to Gate B.

#### Gate B — Large / streaming → IndexedDB (what lands on the map)

| | Min | Max (what lands) |
|---|---|---|
| Source file size | ~**≥ 4 MB** text / **≥ 5 MB** binary (enters this path) | Source may be large so the user can **filter**; completing import still requires Gate B feature max |
| **Features stored in the app** | none | **250,000** after fields / filter / fence |

**Product max for large import = 250,000 stored features.** That is the only
feature ceiling that matters for “can this import finish and live in my app?”

Do **not** say the app’s large-import max is “2 GB / 1,000,000 features.”
Those numbers are **internal source-read / worker-abort plumbing** so a big
file is not rejected before the user can reduce it. A 2 GB / 1M-feature file
is only importable if reduction brings **stored** features to ≤ 250,000.

#### Internal plumbing (not the product max — do not lead with these)

| Plumbing | Value | Role |
|---|---|---|
| `STREAM_MAX_BYTES` | 2 GB | Max source bytes the stream reader will open |
| `STREAM_MAX_FEATURES` | 1,000,000 | Worker hard abort (runaway safety), **not** the unlock |
| Streaming trigger | text ≥ 4 MB / binary ≥ 5 MB | When Gate A rejects → Gate B |
| Tiled rendering | ≥ 50,000 features | Render path, not import unlock |
| GIS-tool full materialize | 250,000 | Tools needing whole FeatureCollection in RAM |
| Toolbox Kit in-memory pack | 250,000 | Kit bundle path |

Streamed layers above the materialization cap are **view/inspect/identify/
edit-selection/export-stream** layers: GIS tools that need a full in-memory
FeatureCollection still refuse with a clear message. GeoJSON and CSV export
stream from IndexedDB (Build 5) and are not bound by the 250k materialize cap.

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

## Build 4 (shipped): local vector tiles for heavy layers

The Re:Earth pattern — query by tile bounds locally, generate MVT on the fly,
serve through a custom MapLibre protocol — applied to the app's own workspace
store:

```
MapLibre requests gis-tiles://<layerId>/{z}/{x}/{y}.pbf
  → tile-protocol (main thread) forwards to the tile worker
  → worker: grid spatial index snapshot → chunk ids for the tile bbox
  → IndexedDB chunk reads (LRU cache) → feature selection with budgets
    (bbox intersect, sub-pixel drop at low zoom, stride sampling above the
     20k/tile cap, chunk-level sampling for overview tiles)
  → geojson-vt (clip + simplify) → vt-pbf (MVT encode) → tile bytes
```

- Workspace layers with **≥ 50,000 features** (`TILED_RENDER_THRESHOLD`)
  render as vector tiles: the whole layer is visible at every zoom instead of
  a 10k-feature viewport packet, with flat memory and no `setData` churn.
  Layers below the threshold keep the existing viewport path unchanged, and
  any tile-path failure falls back to viewport rendering automatically.
- Feature identity (`_featureIndex`/`_datasetId`) rides in tile properties, so
  the existing click/popup path (attributes fetched from IndexedDB) works
  unchanged.
- Files: `js/map/tiles/` (`tile-constants.js`, `tile-math.js`,
  `tile-feature-select.js`, `tile-builder.js`, `tile-protocol.js`) and
  `js/workers/tile-render.worker.js`; map integration in
  `_installTiledWorkspaceLayer` / `_installVectorTileLayerSet`.
- Known limits: selection highlight overlays are not drawn for tiled layers
  (popups and identify work); overview tiles above the per-tile cap show an
  evenly-sampled subset by design.

**DuckDB-WASM note:** the original plan named DuckDB as the tile query engine.
The workspace store + grid index already answer "features by tile bbox"
locally, so tiles ship without the ~10 MB WASM dependency, its network-fetched
spatial extension, and a duplicate copy of every dataset. The protocol/worker
architecture is engine-agnostic — a DuckDB/Parquet-backed source can slot
behind the same `gis-tiles://` protocol later if SQL analytics or Parquet
import justify it.

## Build 5 (shipped): identity, cold attributes, streamed export

Stable feature identity and write/export paths for workspace layers:

- **`__lgid`** — UUID assigned in `appendWorkspaceBatch()` for every import
  path (streaming, standard→workspace, ArcGIS). Stored on the hot attribute
  record and in chunk display properties alongside `_featureIndex` /
  `_datasetId`. Kept on GeoJSON/CSV export for restoration.
- **Hot/cold attributes** — IndexedDB `cold_attributes` store (DB v2).
  Fields panel → **Detach for export** moves unchecked fields hot→cold.
  Identify/edit use the hot set; streamed export joins cold on demand.
- **Streamed export** — `stream-export-service.js` batch-reads workspace
  features (with cold join), writes GeoJSON/CSV through OPFS
  `export-staging/` (Blob-parts fallback). Lifts the practical GeoJSON/CSV
  export ceiling past the 250k materialize cap. Other formats on oversized
  workspace layers get a clear refuse message.
- **Edit sessions** — workspace feature editor + Bulk Update write back via
  `edit-session.js` / attribute batch updates, then
  `refreshLayerData` / `refreshWorkspaceLayerViewport` (tiles invalidate).

### Files (Build 5)

| File | Role |
|---|---|
| `js/workspace/feature-identity.js` | `__lgid` mint/stamp helpers |
| `js/workspace/cold-attributes.js` | Pure hot/cold split + join |
| `js/workspace/export-staging-store.js` | OPFS export staging sessions |
| `js/workspace/edit-session.js` | Selection load + attribute writeback |
| `js/export/stream-export-service.js` | Streamed GeoJSON/CSV orchestration |
| `js/workspace/workspace-store.js` | DB v2, lgid write, cold detach, attr updates |

## Build 6 (shipped): workspace packaging & cleanup

- **Toolbox Kit v2** — workspace layers above the 250k in-memory bundle
  threshold pack via `writeWorkspaceLayerToKitZip` (chunk-at-a-time + sharded
  `attributes/part-*.json` + `cold/` parts). OPFS originals ride along under
  `sources/{opfsKey}/`. v1 kits still import. Deferred workspace folders
  restore through `importDeferredWorkspaceFromZip` without assembling a full
  bundle in RAM.
- **Storage Manager** — Guide → **Storage…**. Lists preserved OPFS sources
  with layer refs, quota bar, remove / remove-unreferenced.

### Files (Build 6)

| File | Role |
|---|---|
| `js/workspace/workspace-store.js` | `writeWorkspaceLayerToKitZip`, `importWorkspaceLayerFromParts` |
| `js/core/project-kit.js` | Kit format v2, deferred workspace pack/parse, sources |
| `js/core/layer-restore.js` | Deferred workspace + OPFS source restore on kit import |
| `js/workspace/storage-summary.js` | Quota + source inventory helpers |
| `react/tools/StorageManagerDialog.jsx` | Storage manager UI |

Notes: streaming Excel remains impractical (whole-workbook format) —
convert-to-CSV guidance stands. Kit bundle materialization cap remains for
the legacy small-layer path; large layers use the streamed packer.

## Build 7 (shipped): pre-import feature filters

Large-file Import Flow and Import Optimizer now support **row filters** in
addition to attribute deselection and Import Fence:

1. **Distinct-value scan** — a worker pass (`scan-values`) streams the file and
   collects up to 2,000 distinct values per field (CSV / DBF-only shapefile /
   GeoJSON properties / KML ExtendedData). Progress is shown; cancel aborts.
2. **Geometry type toggles** — Points / Lines / Polygons (all on by default).
3. **Attribute rules** — same operators as Filter Builder / Query (`equals`,
   `in`, `not_in`, …) with multi-select checklists from the scan when cardinality
   is under the cap; otherwise free-text entry.
4. **Apply at ingest** — stream worker `addFeature` drops non-matching features
   before IndexedDB write; standard path applies the same matcher in
   `finalizeImportedDatasets`. Toasts report `featureFiltered` counts.

| File | Role |
|---|---|
| `js/import/import-feature-filter.js` | Geometry + rule matcher (`evaluateRule`) |
| `js/import/import-value-accumulator.js` | Capped distinct-value sets + KML property extract |
| `js/import/import-value-scan.js` | Main-thread scan orchestration |
| `js/workers/stream-import.worker.js` | `scan-values` + import-time feature filter |
| `react/tools/ImportFeatureFilterPanel.jsx` | Filter UI |
| `react/tools/useImportValueScan.js` | Scan hook for Flow + Optimizer |
| `js/import/import-store-estimate.js` | Stored size/feature estimate vs import limits |
| `js/import/import-filter-estimate.js` | Count-only worker pass for live filter match count |
| `react/tools/ImportEstimateGauge.jsx` | Live estimate gauge (red / amber / green) |
| `react/tools/useImportStoreEstimate.js` | Debounced estimate hook |
| `react/tools/ImportFencePlaceControl.jsx` | Place / clear fence on configure step |

Out of scope: preview map of matches, spatial predicates beyond fence, Excel
value lists.

**Note:** Filters reduce what is **stored** (IndexedDB / map). The source file
is still streamed from disk, so it must stay under `STREAM_MAX_BYTES` (2 GB)
internally — that plumbing ceiling is **not** shown as the user-facing import
limit. The UI shows the real unchanged-import limits (`TEXT_STRONG_BYTES` ≈
4 MB, `MAX_IMPORT_FEATURES` = 250,000).

An 800+ MB statewide roads GeoJSON is eligible for the filter UI, but **Import
is blocked until**:

1. The user reduces attributes, sets a feature filter, or uses an import fence, and
2. The live **estimated stored feature count** is ≤ 250,000

The gauge shows approximate stored bytes + feature count as selections change.
Source disk size never shrinks. Estimated byte size vs 4 MB is color guidance
(amber = features OK, size still large → stream import allowed); feature count
is the hard unlock gate. Drag-drop / file picker open the same filter UI
instead of streaming unchanged. Multi‑GB exports still need an external split.

**Place fence from configure:** Import Optimizer and Import Flow’s large-file
step include **Place Import Fence**. The dialog closes while the map draw tool
is active, then reopens with the same files, attribute selection, and feature
filters. Clear / replace keep that session. (Choosing Import Fence from the
Import chooser still works as a pre-file shortcut.)

## Governing rules (unchanged from master plan)

1. Never require the whole decoded dataset in memory.
2. MapLibre renders the view; IndexedDB/OPFS hold the data.
3. Preserve the authoritative source separately from display data.
4. Prevention over recovery: guards and caps stay, streaming raises them.

## Next: hardening (Builds 8+)

Post-build assessment of the current import stack: see
[`IMPORT_HARDENING_PLAN.md`](IMPORT_HARDENING_PLAN.md). Keep the architecture;
fix admission/limits consistency, IndexedDB attribute ranges, spatial-index
save races, and transactional cancel/rollback before treating very large
imports as production-safe.

**Build 8–11** are implemented — admission/IDB/rollback, fence/CRS/CSV/KML/
picker integrity, sampled scan caching, and spatial workspace chunking. See
[`IMPORT_HARDENING_PLAN.md`](IMPORT_HARDENING_PLAN.md) for status checklists.
