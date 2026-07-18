# Windows platform provider

**Only this folder may import `@tauri-apps/*` (via `tauri-bridge.js`).**

| File | Role |
|------|------|
| `tauri-bridge.js` | `invoke`, event listen, native dialog wrappers |
| `windows-file-service.js` | Open / save / folder / reveal in Explorer |
| `windows-compute-service.js` | Routes allow-listed ops through the job service |
| `windows-job-service.js` | Starts Rust jobs; streams progress/log/result events |
| `windows-platform.js` | Assembles `platform` + `services` for WidgetContext |

## Native operations

Allow-listed in `js/platform/jobs/allowed-operations.js` and `src-tauri/src/jobs.rs`:

- `echo`
- `summarize_geojson` — `{ path: string }` file path only

Shell IPC lives in `src-tauri/`. Python implementation: `desktop/sidecar/python/`.
