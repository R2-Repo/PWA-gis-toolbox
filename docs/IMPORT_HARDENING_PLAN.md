# Import Hardening Plan — Post-Build Assessment

Follow-on to Builds 1–7 in [`IMPORT_LARGE_FILES.md`](IMPORT_LARGE_FILES.md).

Source: static review of `staging` @ `6831557` (`import_refactor_review_staging.md`). Findings were re-checked against the current tree. **Do not revert the import refactor** — keep the streaming → IndexedDB workspace → viewport/MVT architecture.

This plan is for **correctness, consistency, and data integrity**. Spatial chunking and DuckDB/Parquet remain later optimizations.

---

## Verdict

| Review priority | Status in code | Action |
|---|---|---|
| P1 Admission centralization | Confirmed — policy split across preflight / routing / stream-policy / React / workers; `preflightConfirmed` skips full guard | **Build 8** |
| P2 250k vs 1M limits + fence bypass | Confirmed — UI/estimate uses `MAX_IMPORT_FEATURES` (250k); stream worker uses `STREAM_MAX_FEATURES` (1M); fence `canImport` ignores feature count; hooks use `files[0]`; Optimizer confirm not gated | **Build 8** |
| P3 Attribute IDB string key ranges | Confirmed — `_loadAttributeRecordsRange` uses string `IDBKeyRange` on `layer:f:N` | **Build 8** (must-fix) |
| P4 Spatial-index save race | Confirmed — `_indexDirty` cleared by older save; `flushSpatialIndexSave` does not await in-flight save | **Build 8** (must-fix) |
| P5 Cancel / rollback transactional | Confirmed risks — `appendWorkspaceBatch` recreates missing layer; `saveSourceFile` has no `AbortSignal`; registration-after-state ordering | **Build 8–9** |
| P6 Repeated full-file scans | Confirmed — separate sniff / value-scan / count-scan / import | **Build 10** |
| P7 Fence consistency | Confirmed — standard uses Turf intersect; stream uses bbox only; null geom passes stream fence | **Build 9** |
| P8 Shapefile CRS safety | Confirmed directionally — missing `.prj` can silently assume geographic | **Build 9** |
| P9 KML GIS-mode cleanup | Confirmed risk — prefix/`stroke`/`fill`/`marker-` + long-string rules | **Build 9** |
| P10 CSV identifier typing | Confirmed — `dynamicTyping: true` in standard + stream CSV | **Build 9** |
| P11 Picker extensions | Confirmed — `LOCAL_FILE_ACCEPT` includes `.tif/.tiff/.gpkg/.shp/.parquet` without routes | **Build 9** (cheap) |
| P12 KML importMode forwarding | Partial — KML/KMZ wired; XML/ZIP-disguised paths need audit | **Build 9** |
| Spatial chunking | Optimization only | **Build 11** (optional) |

---

## Documented limit model (adopt and enforce)

These already appear in `IMPORT_LARGE_FILES.md`; make them the single source of truth in code + UI copy:

| Concern | Cap | Constant / module |
|---|---|---|
| Standard in-memory import | 250,000 features | `MAX_IMPORT_FEATURES` |
| Workspace streaming storage (per file) | 1,000,000 features | `STREAM_MAX_FEATURES` |
| Streamed file size plumbing | 2 GB | `STREAM_MAX_BYTES` (internal; not the user-facing “import limit”) |
| GIS-tool full materialization | 250,000 features | existing materialize guards |
| Viewport packet | `RENDER_LIMITS.maxFeaturesPerSource` | `render-limits.js` |
| Tile render | per-tile budgets | `tile-constants.js` / select helpers |
| Streamed export | up to workspace storage | stream export service |

**User-facing rule (keep):** large files may stream only when the **estimated stored** feature count after reduction (fields / filter / fence) is ≤ **250,000**. The 1M stream ceiling is a hard abort inside the worker for runaway files — not the unlock gauge.

---

## Build 8 status (in progress on this branch)

Shipped in code (this PR):

- [x] `js/import/import-admission.js` — documented 250k / 1M limits + `canAdmitStoredImport`
- [x] Fence no longer bypasses the stored-feature limit (`useImportStoreEstimate`)
- [x] Multi-file estimate aggregation + fence bounds passed to recount worker
- [x] Import Optimizer confirm gated on `storeEstimate.canImport`
- [x] IndexedDB attributes `by-layer-feature` compound index (DB v3)
- [x] Versioned spatial-index persist + flush awaits in-flight save
- [x] `appendWorkspaceBatch` refuses to recreate a deleted layer
- [x] Abortable OPFS `saveSourceFile({ signal })`; stream path registers `opfsKey` before copy completes
- [x] Stream cancel stops batch routing; map-registration failure rolls back that file’s layers
- [x] `convertSpatialDatasetToWorkspace` rolls back + flushes spatial index

Still open for a follow-up pass:

- [ ] Full entry-point wiring so every path (drag-drop, dual-screen, programmatic) calls one admission decision object end-to-end
- [ ] Stronger import-transaction object covering group ids / active write tracking as a single module
- [ ] Browser smoke for cancel-during-OPFS and fence-over-limit UX

---

# Build 8 — Correctness & safety (do first)

Goal: no silent data loss, no wrong attribute ranges, one admission story.

### 8.1 Authoritative import admission

Create `js/import/import-admission.js` (name flexible) that returns a single policy object:

```js
{
  route: 'standard-memory' | 'stream-workspace' | 'unsupported' | 'rejected',
  fileResults: [],
  maxStoredFeatures: number,   // 250_000 for user-facing unlock
  maxStreamFeatures: number,   // 1_000_000 worker abort
  maxFileBytes: number,
  useWorkspace: boolean,
  requiresReduction: boolean,
  selectedFields: string[] | null,
  featureFilter: object | null,
  fenceBbox: number[] | null,
  reasons: string[]
}
```

Wire every entry point through it:

- Import Flow
- Import Optimizer
- Drag-and-drop / file picker
- Dual-screen import
- Programmatic `handleFileImport` (stop treating `preflightConfirmed` as a full bypass — confirm only means “UI already showed the wizard”, not “skip limits”)
- Workflow import only if intentionally different (document the exception)

Execution layer must enforce the returned policy; UI alone is insufficient.

**Touch:** `import-preflight.js`, `import-routing.js`, `stream-policy.js`, `import-policy.js`, `tool-handlers.js`, `stream-import-flow.js`, Import Flow / Optimizer dialogs.

### 8.2 Fix limit / estimate bugs (same build)

1. Remove fence bypass in `useImportStoreEstimate`: fence imports must still satisfy `underFeatureLimit` (exact or conservative count).
2. Pass fence bounds into the exact-count worker when fence drives admission.
3. Aggregate estimates across **all** selected files (`files[0]` → sum / per-file rollup).
4. Gate Import Optimizer confirm on `storeEstimate.canImport` (Import Flow already does).
5. Align UI copy with the table above; worker abort message should say “storage ceiling (1M)” not imply the UI unlock is 1M.

**Touch:** `useImportStoreEstimate.js`, `import-store-estimate.js`, `import-filter-estimate.js`, `ImportOptimizerDialog.jsx`, `ImportFlowDialog.jsx`, stream worker limit messaging.

### 8.3 IndexedDB attribute range fix (must-fix)

String keys `layer:f:0` … `layer:f:999` lexicographically include `…:1000`, `…:10000`, etc. `_loadAttributeRecordsRange` + `detachFieldsForExport` are affected.

- Bump workspace DB version.
- Add unique index `by-layer-feature` on `['layerId', 'featureIndex']` (records already store those fields).
- Query with `IDBKeyRange.bound([layerId, start], [layerId, start + count - 1])`.
- Keep string `id` if useful as primary key, or migrate carefully.
- Migrate existing DBs on upgrade.

**Regression:** ranges covering indexes `0, 1, 99, 999, 1000, 9999, 10000` return only intended rows; detach-for-export visits each feature once.

**Touch:** `js/workspace/workspace-store.js` (+ tests).

### 8.4 Spatial-index save serialization (must-fix)

Replace boolean `_indexDirty` with versioned saves:

```js
indexMutationVersion++
// save snapshots current version; on complete:
indexPersistedVersion = max(persisted, saveVersion)
```

`flushSpatialIndexSave()` must:

1. Await any in-flight save.
2. Re-save if mutation version > persisted version.
3. Loop until current.

**Regression:** mutation during save A survives flush + reload.

**Touch:** `workspace-store.js` (+ tests).

### 8.5 Import transaction / rollback (core)

Introduce an import-transaction tracker used by streaming + standard→workspace paths:

Tracked: OPFS source keys, workspace layer ids, app-state layer ids, map layer ids, groups, workers, in-flight writes, `aborted` flag.

Rules:

1. Register resources **when created**, not after map registration succeeds.
2. `saveSourceFile(key, file, { signal })` — abortable copy; cancel never leaves an orphan OPFS file.
3. `appendWorkspaceBatch` must **not** recreate a deleted/missing layer unless an explicit import/restore flag is set.
4. On abort/failure: stop workers → await writes → remove map/state/groups/workspace/OPFS → flush spatial index.
5. `convertSpatialDatasetToWorkspace` rolls back partial chunks on failure and flushes the spatial index on success.

**Touch:** `source-file-store.js`, `stream-import-service.js`, `stream-import-flow.js`, `workspace-store.js`, conversion helpers.

### Build 8 acceptance

- [ ] Fence-only import above 250k stored features blocked
- [ ] Filter-only above limit blocked
- [ ] Multi-file estimates aggregate
- [ ] Exact count cannot replace multi-file with first file only
- [ ] Drag-drop and Import Flow share admission decision
- [ ] Attribute numeric ranges correct across decade boundaries
- [ ] Index mutation during save survives flush/reload
- [ ] Cancel during OPFS copy / batch write / pre-map-registration leaves no orphans
- [ ] `npm test` + smoke large GeoJSON cancel + fence import in browser

---

## Build 9 status (this branch)

- [x] Shared fence intersection (`import-fence.js`) for standard + stream
- [x] Null geometry excluded from fenced imports
- [x] CSV identifier strings preserved (`csvDynamicTypingForField`)
- [x] KML GIS strip uses exact presentation-key allowlist (keeps `fill_status` / long notes)
- [x] KML `importMode` forwarded for `.xml` and ZIP-disguised KML
- [x] Missing shapefile `.prj` + projected coords → CRS prompt (stream + standard)
- [x] File picker accept list limited to supported formats

---

# Build 9 — Consistency & format integrity

### 9.1 Shared fence intersection

One worker-safe geometry-vs-bbox (or geometry-vs-polygon) helper used by:

- standard import (`post-import.js`)
- stream worker
- estimate / count workers

Null geometry: **exclude** from fenced imports; report count in summary.

### 9.2 Shapefile CRS

If coordinates look projected and `.prj` is missing/unusable: pause and request CRS — do not silently claim WGS84. Surface `crsDetected` / `crsWarning` on source metadata.

### 9.3 CSV identifiers

Default string parse; `dynamicTyping` only for known numeric/coord/boolean/date fields. Preserve leading zeros and unsafe integers.

### 9.4 KML GIS cleanup

Replace prefix rules with an allowlist of known KML/presentation style keys. Long strings → cold detach (preferred) or explicit “permanently removed” in import summary — not silent delete of `fill_*` / `stroke_*` user fields.

### 9.5 KML importMode

Normalize `{ originalFormat, contentFormat, importMode }` before dispatch so `.xml` KML and ZIP-disguised KML honor the selected mode.

### 9.6 File picker honesty

`LOCAL_FILE_ACCEPT` in `ImportFlowDialog.jsx`: remove unsupported `.tif/.tiff/.gpkg/.shp/.parquet` **or** add clear unsupported/guidance routes. Prefer remove until handlers exist (raw `.shp` → message to ZIP the sidecar set).

### Build 9 acceptance

- [x] Stream vs standard fence same result for sample point/line/polygon fixtures
- [x] CSV `"00123"` stays `"00123"`
- [x] Missing `.prj` + projected coords prompts CRS
- [x] `fill_status` / `stroke_count` survive GIS-mode KML
- [x] XML/ZIP KML honor import mode
- [x] Picker only advertises supported formats (or guided refuse)

---

## Build 10 status (this branch)

- [x] Sampled value scan caps: 10k features / 16 MB (`VALUE_SCAN_MAX_*`)
- [x] Exact filter/fence estimates cached by file + filter + fence identity
- [x] Value-scan results cached; identical requests reuse cache
- [x] Scan/estimate workers tracked; cancel/unmount terminates orphans
- [x] Rapid filter changes still cancel prior estimate jobs (existing debounce + cancel)

---

# Build 10 — Scan performance

Three scan levels:

1. **Sniff** — small head sample (fields, coords, rough counts) — already mostly exists.
2. **Sampled values** — cap (e.g. first 10k features or 16 MB decoded) for filter UI suggestions.
3. **Exact admission count** — full pass only when filter/fence must prove ≤ limit.

Cache by `name + size + lastModified + filter + fence`. Cancel prior jobs on rapid filter changes; no orphan workers on dialog close.

Optional: one worker pass returning `{ totalCount, matchedCount, fenceMatchedCount, fields, sampledValues, geometryCounts }`.

---

# Build 11 — Optional: spatial workspace chunks

Not a correctness blocker. During import, bucket features into coarse grid-cell buffers (LRU-capped), flush when full → tighter chunk bboxes → fewer IndexedDB reads for viewport/tiles. Defer until Builds 8–9 are green and real-world tile cost still hurts.

---

## Suggested sequencing

```text
Build 8  → admission + limits + IDB ranges + index save + rollback core
Build 9  → fence / CRS / CSV / KML / picker
Build 10 → scan caching & sampling
Build 11 → spatial chunking (optional)
```

Ship Build 8 before treating multi-hundred-MB imports as production-safe.

---

## Out of scope (for now)

- Reverting streaming / workspace / MVT architecture
- DuckDB-WASM / Parquet import
- Raster / GeoPackage importers (unless Build 9 guidance stubs)
- Changing the 250k stored unlock or 1M stream abort without product sign-off
- Workflow-editor node caps (remain standard-path unless explicitly included)

---

## Reference files (current)

| Area | Primary files |
|---|---|
| Limits | `import-preflight.js`, `stream-constants.js`, `import-store-estimate.js` |
| Estimate UI | `useImportStoreEstimate.js`, `ImportFlowDialog.jsx`, `ImportOptimizerDialog.jsx` |
| Stream path | `stream-import-service.js`, `stream-import-flow.js`, `stream-import.worker.js` |
| Workspace | `workspace-store.js`, `source-file-store.js` |
| Fence (standard) | `post-import.js` |
| Docs | `IMPORT_LARGE_FILES.md` (Builds 1–7 shipped) |
