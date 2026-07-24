# PWA split baseline

Recorded before desktop/Tauri/Atlas/Library cleanup.

| Item | Value |
|------|--------|
| Branch | `staging` |
| Commit | `d707389b357c004a71e8451a13315ccdc75e1ddb` |
| Remote | `https://github.com/R2-Repo/WPA-gis-toolbox.git` |
| Date | 2026-07-24 |
| Split tag | None present at baseline time |

## Commands run

| Command | Result |
|---------|--------|
| `npm install` | OK (701 packages; audit advisories present, not blocking) |
| `npm test` | OK — 73 files, 560 tests passed |
| `npm run build` | OK — `dist/` + PWA SW (`sw.js`, workbox) |
| `npm run build:web` | OK — `dist-web/` + PWA SW |
| `npm run dev` | OK — Vite starts (port 5174) |

## Known warnings (non-blocking)

- Vite circular chunk: `app-domain` ↔ `vendor`
- Vite dynamic/static import overlap notices (atlas, platform, library, task-runner, etc.)
- Chunk size > 500 kB for `app-domain` / `vendor`
- `npm audit`: 12 vulnerabilities reported (not addressed in this baseline)

## Cloudflare Pages

- Config: `wrangler.jsonc`
- `pages_build_output_dir`: `./dist`
- Production build command: `npm run build`

## PWA-visible GIS Widgets panel

From `GIS_WIDGETS` with empty/missing `requiredCapabilities` (web platform has no native caps):

1. Find Features in Area (`spatial-analyzer`)
2. Bulk Update (`bulk-update`)
3. Proximity Join (`proximity-join`)
4. Spatial Join (`spatial-join`)
5. Route Centerline (`route-milepost-segment`)
6. Project Stationing (`project-stationing`)
7. Layer Match Assistant (`layer-match-assistant`)
8. Fiber Procurement Design (`fiber-procurement-design`)
9. Plan Set Callouts (`plan-set-callouts`)
10. Sheet Cutter (`sheet-cutting`)
11. Layer Summary (`layer-summary`)

**Hidden on PWA:** GeoJSON File Summary (`geojson-file-summary` — requires `pythonCompute` + `nativeFiles`).

**Hidden registry (implemented, not in panel):** query, crs-manager, wireless-site-planning, fiber-slack-otdr-helper, presentation-link-builder, plan-production-export.

## Interface sections (PWA)

- Header: Import, Undo/Redo, Merge Layers, Workflow, Dual Screen, Map print/export, Logs, Info
- Network Atlas header button: gated off (`showNetworkAtlas` / `localSqlite` unavailable on web)
- Left: Layers & Fields (Local GIS Library section gated off)
- Center: MapLibre map
- Right: Output & Export
- GIS Widgets panel (list above)

## Manual import/export smoke

Automated baseline does not drive the browser UI. Post-cleanup acceptance should re-check import + export of one small GeoJSON/CSV in `npm run dev` or staging preview.

## Post-cleanup acceptance (same session)

| Check | Result |
|-------|--------|
| `npm test` | OK — 50 files, 451 tests |
| `npm run build` | OK — `dist/` + PWA SW |
| `npm run build:web` | OK — `dist-web/` + PWA SW |
| Removed trees | `src-tauri/`, `desktop/`, `js/platform/windows/`, Atlas, Library, `geojson-file-summary` |
| App source guards | No `@tauri-apps`, `createWindowsPlatform`, `src-tauri`, Atlas/Library UI wiring |

PWA-visible GIS Widgets panel unchanged except GeoJSON File Summary removed (was already hidden on web).
