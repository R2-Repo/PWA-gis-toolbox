# GIS Toolbox — Windows desktop shell (Tauri 2)

Private Windows 11 application that hosts the same React/MapLibre frontend as the public PWA.

## Requirements (Windows 11)

- Node.js (same as the web app)
- [Rust](https://rustup.rs/) stable
- WebView2 (usually preinstalled on Windows 11)

## Commands (from repo root)

```bash
npm install
npm run dev:desktop        # Tauri window + desktop Vite (port 5174)
npm run build:desktop      # frontend only → dist-desktop/
npm run build:desktop:app  # package .msi / NSIS installer
```

Production packaging embeds `../dist-desktop` (built with **no** PWA service worker).

## Architecture

- Rust / Tauri config: this folder
- Frontend bridge: `js/platform/windows/` (only place that may import `@tauri-apps/*`)
- Shared GIS UI: `js/`, `react/` (unchanged)

See `docs/PWA_DESKTOP_WORKFLOW_PLAN.md`.
