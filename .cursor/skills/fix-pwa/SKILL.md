---
name: fix-pwa
description: Fix or update the GIS Toolbox public PWA (web/browser app). Use when the user says fix/update/debug/change the PWA, web app, browser app, staging preview, or progressive web app.
---

# Fix / update PWA

## When this skill applies

Use immediately when the user intent is about the **public web/PWA**, including phrases like:

- “fix the PWA”
- “update the web app”
- “browser version is broken”
- “staging preview …”
- “progressive web app”

This repository is **browser-only** — there is no separate desktop shell to preserve.

## Default plan

1. Reproduce / locate in **browser** terms (`npm run dev` or preview).
2. Prefer:
   - `js/` + `react/` for app logic and UI
   - `js/platform/web/` for browser APIs (files, jobs, etc.)
3. Keep widget engines pure JavaScript — no native or server-side dependencies.

## Done checks

```bash
npm test
npm run build
# or: npm run build:web
```

Smoke in **browser** only for the changed flow.

## Dual-screen / map notes

- Dual-screen path uses browser `window.open` (`js/dual-screen/window-open.js`). Preserve it.
- Map zoom/pan fixes should be verified in the browser dev server and preview build.
