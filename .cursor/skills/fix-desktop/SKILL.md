---
name: fix-desktop
description: Fix or update the GIS Toolbox private Windows desktop app (Tauri/WebView2). Use when the user says fix/update/debug/change the desktop app, Windows app, Tauri, WebView2, or desktop-only native features — without requiring them to spell out how to protect the PWA.
---

# Fix / update desktop (Windows)

## When this skill applies

Use immediately when the user intent is about the **Windows desktop** runtime, including phrases like:

- “fix the desktop app”
- “Windows / Tauri / WebView2 is broken”
- “desktop dual screen”
- “native file dialog / Python job on desktop”

If ambiguous, read [`docs/PWA_DESKTOP_COMPAT.md`](../../../docs/PWA_DESKTOP_COMPAT.md) and classify desktop-only vs shared.

## Read first

1. [`docs/PWA_DESKTOP_COMPAT.md`](../../../docs/PWA_DESKTOP_COMPAT.md)
2. `.cursor/rules/fix-desktop.mdc` and `windows-native.mdc`
3. `js/platform/windows/README.md` when touching native bridge

## Default plan

1. Confirm whether the bug fails in the **browser** too.
2. **Desktop-only** → start in:
   - `src-tauri/` (shell, windows, IPC)
   - `js/platform/windows/` (only place for `@tauri-apps/*`)
   - `desktop/sidecar/` (allow-listed Python ops)
3. **Needs shared change** → add/extend a **platform contract + providers**; leave the web provider behavior intact.
4. Never rewrite shared widgets/map/dual-screen “for Tauri” without an adapter.

## Hard constraints (implied — user should not need to repeat)

- `@tauri-apps/*` only via `js/platform/windows/tauri-bridge.js`
- Do not break PWA: web build must stay green; browser dual-screen/`window.open` path must remain
- No duplicate Windows widget trees; use `requiredCapabilities` for desktop-only widgets
- Desktop Vite build must not register the PWA service worker
- Native ops stay allow-listed, typed, cancellable — no arbitrary shell/Python execution

## Done checks

Prefer delegating mechanical verification to subagent **`dual-runtime-qa`** (Composer fast — `.cursor/agents/dual-runtime-qa.md`) with the changed-file list. Parent should not burn expensive tokens on test logs/docs.

Minimum if no subagent available:

```bash
npm test
npm run build          # PWA / Pages artifact must still work
npm run build:desktop  # desktop bundle
```

Smoke:

- Desktop: the failing flow
- Browser: **required** if any shared file under `js/` / `react/` (outside `js/platform/windows/`) changed

## Example: desktop dual screen

Safe: platform window-open service — web uses `window.open`, Windows uses Tauri `WebviewWindow`; coordinator stays shared.

Unsafe: replacing shared dual-screen with Tauri-only window APIs inside `js/dual-screen/` with no web provider.
