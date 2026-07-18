# Windows platform provider (reserved)

This folder is the **only** place allowed to import `@tauri-apps/*`.

It will host:

- `windows-platform.js`
- `windows-file-service.js`
- `windows-compute-service.js`
- `windows-job-service.js`
- `tauri-bridge.js`

Until Tauri is scaffolded (`src-tauri/`), the app falls back to the web platform provider
even when `VITE_GIS_RUNTIME=windows`. See `docs/PWA_DESKTOP_WORKFLOW_PLAN.md`.
