# PWA split status

This repository is the **browser-only PWA**. Desktop/Tauri/Atlas/Library code lives in a separate repo.

| Item | Value |
|------|--------|
| Original split baseline commit | `d707389b357c004a71e8451a13315ccdc75e1ddb` (2026-07-24) |
| Cleanup pass | Removed tracked `dist-desktop/` build artifact and remaining desktop-facing stubs/docs language |

## What was removed from this repo

| Area | Status |
|------|--------|
| `src-tauri/`, `desktop/`, `js/platform/windows/` | Removed (prior cleanup) |
| Network Atlas / Local GIS Library UI | Removed (prior cleanup) |
| `geojson-file-summary` (native caps) | Removed (prior cleanup) |
| Tracked `dist-desktop/` (desktop Vite build output) | Removed; gitignored |
| Dead desktop import path routing / stubs | Removed |
| Desktop-only user-facing copy | Reworded for browser PWA |

## Current platform shape

- `js/platform/create-platform.js` → web only
- `VITE_GIS_RUNTIME` forced to `"web"` in `vite.config.js`
- Capabilities object is empty; widgets that need native caps stay hidden

## Cloudflare Pages

- Config: `wrangler.jsonc`
- `pages_build_output_dir`: `./dist`
- Production build command: `npm run build`

## Verify before production

```bash
npm install
npm test
npm run build
```

Smoke in the browser: import + export one small GeoJSON/CSV, Dual Screen popup allow, UGRC key env on Cloudflare.
