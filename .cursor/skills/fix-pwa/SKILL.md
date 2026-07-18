---
name: fix-pwa
description: Fix or update the GIS Toolbox public PWA (web/browser app). Use when the user says fix/update/debug/change the PWA, web app, browser app, staging preview, or progressive web app — without requiring them to spell out platform constraints.
---

# Fix / update PWA

## When this skill applies

Use immediately when the user intent is about the **public web/PWA** runtime, including phrases like:

- “fix the PWA”
- “update the web app”
- “browser version is broken”
- “staging preview …”
- “progressive web app”

If they only say something is broken with **no** runtime named, classify first using [`docs/PWA_DESKTOP_COMPAT.md`](../../../docs/PWA_DESKTOP_COMPAT.md) (browser reproduce? → this skill; desktop-only? → `fix-desktop`).

## Read first

1. [`docs/PWA_DESKTOP_COMPAT.md`](../../../docs/PWA_DESKTOP_COMPAT.md)
2. `.cursor/rules/fix-pwa.mdc` and `platform-shared.mdc`

## Default plan

1. Reproduce / locate in **browser** terms (`npm run dev` or preview).
2. Prefer:
   - shared `js/` + `react/` if the bug is real in the browser
   - `js/platform/web/` for browser-only APIs (files, jobs stubs, etc.)
3. Keep Windows providers compiling and behavior-compatible.
4. Do **not** introduce Tauri, sidecar, or native-only code paths into the PWA.

## Hard constraints (implied — user should not need to repeat)

- No `@tauri-apps/*` outside `js/platform/windows/`
- No Python/sidecar imports in shared app modules
- No “make web work” changes that remove or break desktop build modes
- Desktop build (`npm run build:desktop`) must stay green

## Done checks

Prefer delegating mechanical verification to subagent **`dual-runtime-qa`** (Composer fast — `.cursor/agents/dual-runtime-qa.md`) with the changed-file list. Parent should not burn expensive tokens on test logs/docs.

Minimum if no subagent available:

```bash
npm test
npm run build
# or: npm run build:web
```

Smoke in **browser** only for the changed flow (unless you also edited desktop-only paths, which you usually should not for this intent).

## Dual-screen / map notes

- Dual-screen PWA path uses browser `window.open` (`js/dual-screen/window-open.js`). Preserve it.
- Map zoom/pan fixes that only fail on desktop belong under **fix-desktop**, not here.
