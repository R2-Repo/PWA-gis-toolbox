# Desktop GIS data plane

> **Status:** Phases 0–6c + **Desktop GIS Workstation (Phase A–C)** landed — path-first import, auto GeoParquet/PMTiles, dual-path core tools, viewport edit save-back. Enterprise (PostGIS/MapServer) still deferred.  
> **Safety:** Must not break the public PWA or Network Atlas.

## Goal

Desktop is a **local GIS workstation** (QGIS-like for large local data): full datasets stay on disk, the map uses tiles, analysis runs via the Python sidecar. The PWA stays browser-safe with in-memory limits.

```text
Disk originals / GeoParquet / GPKG
        ↓
Local GIS Library catalog
        ↓              ↓
Python sidecar     PMTiles / COG
(DuckDB/GDAL)           ↓
        ↓          MapLibre display
   derived files
```

## Desktop layer handle

Path-imported / library-backed vector layers carry a **disk analysis handle** (not a full FeatureCollection in RAM):

| Field | Meaning |
|-------|---------|
| `source.analysisPath` | Working path for tools (prefer GeoParquet / managed original) |
| `source.fullFeatureCount` | Catalog / inspect count (not preview FC length) |
| `source.previewOnly` | Map GeoJSON is a bounded sample |
| `source.displayMode` | `pmtiles` \| `geojson-preview` \| `cog` |
| `source.dirty` | In-memory viewport/selection edits not yet saved |

**Hard rules (desktop only):**

1. Tools resolve **analysis path** via `resolveLayerNativePath` — never require full FC in RAM
2. `chooseAnalysisProvider` uses presence of `analysisPath` / `fullFeatureCount` (ignore tiny preview counts)
3. Map prefers **PMTiles** when present; otherwise bounded preview + clear UI
4. Analysis outputs register as **library derived items** + preview (and tiles when generated)
5. Selection subsets (`_isSelection`) force in-memory Turf — native path is cleared

Layer list badges: `Preview` · `Tiles (full)` · `Library` · `COG` · `Dirty`

## Runtime split

| Layer | Owns |
|-------|------|
| Shared JS/React | UI, MapLibre, widgets — call platform services only |
| Rust / Tauri | Shell, IPC, jobs, SQLite catalogs, dialogs, Atlas ping |
| Python sidecar | Allow-listed ops (inspect/sample, analysis, tiles, save-back) |
| Disk | Originals + working datasets + tiles — not the WebView heap |

## Storage

| Role | Store |
|------|--------|
| GIS item catalog | `{appData}/gis-library/catalog/gis-catalog.sqlite` (metadata only) |
| Network Atlas | `network-atlas.sqlite` — **do not merge** |
| UDOT Fiber cache | `udot-fiber-network.sqlite` — domain-specific |
| Large vector working | GeoParquet (`datasets/<id>/data.parquet` when engines installed) |
| Small editable vector | GeoPackage (save-back) / GeoJSON derived |
| Large raster | COG + PNG overview on map (desktop; GDAL CLI) |
| Map preview | Sample FeatureCollection from sidecar (interim) |
| Large map display | PMTiles under `tiles/<id>/` + MapLibre `pmtiles://` protocol |

## Atlas firewall

```text
Desktop App
├── GIS Toolbox + Local GIS Library
│     gis-catalog.sqlite · managed library folders · sidecar jobs
└── Network Atlas
      network-atlas.sqlite · inbox · ICMP ping
```

- No shared mutable tables between Atlas and GIS catalog
- No DuckDB for Atlas (see [`NETWORK_ATLAS.md`](./NETWORK_ATLAS.md))
- Do not route Atlas inbox through the GIS GeoParquet pipeline
- Read-only map adapter: `js/atlas/network-atlas-layer-adapter.js` exposes hubs/drops as GIS layers in Toolbox mode only (no DB/catalog writes)

## PWA firewall

- Web import caps (~4–8 MB / memory budget) stay for `runtime === 'web'`
- Desktop path import only when `nativeFiles` + `largeDatasetProcessing` are available
- No `@tauri-apps/*` outside `js/platform/windows/`
- Widget `engine.js` stays free of Tauri/DuckDB/filesystem

## Capabilities

| Capability | Web | Desktop (typical) |
|------------|-----|-------------------|
| `nativeFiles` | no | yes |
| `pythonCompute` | no | yes when sidecar healthy |
| `largeDatasetProcessing` | no | yes when sidecar healthy |
| `localSqlite` | no | yes (Atlas + GIS catalog) |
| `icmpPing` | no | yes (Atlas) |
| `gisLibrary` | no | yes (Local GIS Library) |
| `localGdal` | no | yes when pyogrio installed in sidecar env |
| `duckdb` | no | yes when duckdb installed in sidecar env |
| `localMartin` | no | deferred — file PMTiles instead |
| `localPdal` | no | stub until packaged |

## Workstation phases (A–C)

| Phase | Outcome |
|-------|---------|
| **A** | Desktop layer handle; path import → library → auto GeoParquet → auto PMTiles; skip browser guards on path route; badges/toasts; native analysis when `analysisPath` exists |
| **B** | Dual-path simplify / dissolve / union / explode / sample; filter attributes; bulk update on disk; Layer Summary via `summarize_vector` on `analysisPath` |
| **C** | Viewport/selection edits mark `dirty`; **Save edits to library** (`save_vector` → GPKG/Parquet/GeoJSON derived item) |
| Later | Full COG tile protocol; PostGIS / MapServer (deferred) |

### Sidecar ops (analysis + edit)

Allow-list (keep in sync: `js/platform/jobs/allowed-operations.js`, `src-tauri/src/jobs.rs`, `operations.py`):

- Inspect / sample / summarize / checksum / GeoParquet / PMTiles / COG
- `buffer_vector`, `clip_vector`, `spatial_filter`, `spatial_join`, `nearest_join`, `reproject_vector`
- `simplify_vector`, `dissolve_vector`, `union_vector`, `explode_vector`, `sample_features`
- `filter_attributes`, `update_attributes`, `save_vector`

In-memory shapely ops currently cap ~80k features per load; prefer GeoParquet working copies from Optimize.

## Legacy phase map (0–6c)

| Phase | Outcome |
|-------|---------|
| 0 | This doc + contract stubs |
| 1 | Path inspect/sample; large GeoJSON preview on desktop; PWA unchanged |
| 2 | Local GIS Library MVP — **done** |
| 3 | DuckDB Spatial + pyogrio; GeoParquet; COG convert + overview — **done** |
| 4 | File PMTiles + MapLibre protocol — **done** |
| 5 | Dual-path analysis widgets + lineage — **done** |
| 6a–6c | Library portal, `.gispack`, proximity join, Spatial Join widget, NetworkAtlasLayerAdapter — **done** |

## Smoke (UtahRoads-scale)

1. Desktop → Local Files (native Open) → import large GeoJSON
2. Expect: library ingest, GeoParquet optimize, auto PMTiles, layer badge `Tiles (full)`, toast about disk tools
3. Buffer / Clip / Spatial Join / Reproject / Filter / Bulk Update (all) run against full file count
4. Edit preview attributes or delete selected → `Dirty` → Save edits → derived GPKG in library

## No-gos

- Merge Atlas + GIS databases
- Raise PWA limits to match desktop
- Widget engines calling DuckDB/Martin/files directly
- Required PostGIS/GeoServer for core desktop
- LAN-exposed local tile servers by default

## Related

- [`PWA_DESKTOP_COMPAT.md`](./PWA_DESKTOP_COMPAT.md) — blast radius
- [`PWA_DESKTOP_WORKFLOW_PLAN.md`](./PWA_DESKTOP_WORKFLOW_PLAN.md) — shell/workflow
- [`NETWORK_ATLAS.md`](./NETWORK_ATLAS.md) — Atlas locked decisions
