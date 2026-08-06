# PWA-only status

This repository is the **browser-only PWA**. There is no desktop/Tauri runtime in this tree.

| Item | Value |
|------|--------|
| Original split baseline | `d707389` (2026-07-24) |
| Cleanup | Removed desktop build artifacts, stubs, Python/native accel UI, and desktop-facing copy |

## Removed from this repo

| Area | Status |
|------|--------|
| `src-tauri/`, `desktop/`, `js/platform/windows/` | Gone |
| Network Atlas / Local GIS Library | Gone |
| Native-only widgets (`geojson-file-summary`, etc.) | Gone |
| Tracked `dist-desktop/` | Gone (gitignored) |
| Python sidecar / preferPython / accelThreshold UI | Gone |
| Desktop import path routing | Gone |

## Current platform shape

- `js/platform/create-platform.js` → web only
- `VITE_GIS_RUNTIME` forced to `"web"` in `vite.config.js`
- Empty capabilities object; Dual Screen uses browser `window.open`

## Cloudflare Pages

- Config: `wrangler.jsonc`
- `pages_build_output_dir`: `./dist`
- Build: `npm run build`

## Verify

```bash
npm install
npm test
npm run build
```

Smoke: import/export GeoJSON or CSV, Dual Screen popups, UGRC key env on Cloudflare.
