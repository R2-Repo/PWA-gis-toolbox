# Desktop GIS data plane

> **Status:** Phases 0–2 landed — path preview + Local GIS Library catalog (`gis-library/` + `gis-catalog.sqlite`). DuckDB/GDAL/tiles still later.  
> **Safety:** Must not break the public PWA or Network Atlas.

## Goal

Desktop is a **local GIS workstation**: path-based data, native jobs (Python sidecar + DuckDB/GDAL over time), SQLite **catalog metadata**, geometry on disk (GeoParquet / GeoPackage / COG). The PWA stays browser-safe with in-memory limits.

## Runtime split

| Layer | Owns |
|-------|------|
| Shared JS/React | UI, MapLibre, widgets — call platform services only |
| Rust / Tauri | Shell, IPC, jobs, SQLite catalogs, dialogs, Atlas ping |
| Python sidecar | Allow-listed ops: inspect/sample (now); DuckDB/GDAL (later) |
| Disk | Originals + working datasets + tiles — not the WebView heap |

## Storage

| Role | Store |
|------|--------|
| GIS item catalog | `{appData}/gis-library/catalog/gis-catalog.sqlite` (metadata only) |
| Network Atlas | `network-atlas.sqlite` — **do not merge** |
| UDOT Fiber cache | `udot-fiber-network.sqlite` — domain-specific |
| Large vector working | GeoParquet (Phase 3) |
| Small editable vector | GeoPackage |
| Large raster | COG (Phase 3) |
| Map preview (Phase 1) | Sample FeatureCollection from sidecar |

## Atlas firewall

```text
Desktop App
├── GIS Toolbox + Local GIS Library (future)
│     gis-catalog.sqlite · managed library folders · sidecar jobs
└── Network Atlas
      network-atlas.sqlite · inbox · ICMP ping
```

- No shared mutable tables between Atlas and GIS catalog
- No DuckDB for Atlas (see [`NETWORK_ATLAS.md`](./NETWORK_ATLAS.md))
- Do not route Atlas inbox through the GIS GeoParquet pipeline
- Optional later: read-only map adapter from Atlas exports

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
| `localSqlite` | no | yes (Atlas + future GIS catalog) |
| `icmpPing` | no | yes (Atlas) |
| `gisLibrary` | no | yes (Local GIS Library) |
| `localGdal` / `localPdal` | no | stub until packaged |

## Phase map

| Phase | Outcome |
|-------|---------|
| 0 | This doc + contract stubs |
| 1 | Path inspect/sample; large GeoJSON preview on desktop; PWA unchanged |
| 2 | Local GIS Library MVP (managed folders + catalog SQLite) — **done** |
| 3 | DuckDB Spatial + GDAL in sidecar; GeoParquet/COG |
| 4 | PMTiles/MBTiles; optional Martin on `127.0.0.1` |
| 5 | Dual-path analysis widgets + lineage |
| 6+ | Portal polish, MapServer, PostGIS, GeoServer |

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
