# GIS Toolbox — Windows desktop shell (Tauri 2)

Private Windows 11 application that hosts the same React/MapLibre frontend as the public PWA.

## Requirements (Windows 11)

- Node.js (same as the web app)
- [Rust](https://rustup.rs/) stable
- WebView2 (usually preinstalled on Windows 11)

## Commands (from repo root)

```bash
npm install
npm run dev:desktop        # Tauri window + desktop Vite (port 9417)
npm run build:desktop      # frontend only → dist-desktop/
npm run build:desktop:app  # package .msi / NSIS installer
```

Production packaging embeds `../dist-desktop` (built with **no** PWA service worker).

## Architecture

- Rust / Tauri config: this folder
- Frontend bridge: `js/platform/windows/` (only place that may import `@tauri-apps/*`)
- Shared GIS UI: `js/`, `react/` (unchanged)
- Python sidecar: `desktop/sidecar/python/` (allow-listed ops over stdin/stdout JSON)

### Native jobs

Frontend:

```js
const result = await ctx.services.compute.run('summarize_geojson', { path }, {
  onProgress: (p) => console.log(p),
  signal
});
```

Rust commands: `job_start`, `job_cancel`, `sidecar_health`, `platform_handshake`,
`write_temp_geojson`, `remove_temp_file`.

Dev mode launches `python -m gis_sidecar` with `PYTHONPATH=desktop/sidecar/python`.
Package a frozen `gis-sidecar.exe` later via `desktop/scripts/package-sidecar-windows.ps1`.

Shared **Layer Summary** widget uses JavaScript in the PWA and can accelerate large layers
via the sidecar on Windows.

See `docs/PWA_DESKTOP_WORKFLOW_PLAN.md`.
