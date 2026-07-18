Fix / update the **Windows desktop app** (Tauri / WebView2).

Follow `.cursor/skills/fix-desktop/SKILL.md` and read `docs/PWA_DESKTOP_COMPAT.md` first.

Hard constraints (do not ask me to repeat these):
- If desktop-only: start in `src-tauri/` or `js/platform/windows/` (or `desktop/sidecar/`)
- If shared code must change: use a platform adapter — keep the PWA path working
- `@tauri-apps/*` only via `js/platform/windows/tauri-bridge.js`
- Do not break browser dual-screen `window.open` or the web build
- No duplicate Windows widget trees; use `requiredCapabilities` for desktop-only widgets

Verify with `npm test`, `npm run build`, and `npm run build:desktop`. Desktop-smoke the bug; also browser-smoke if any shared file changed.

My request:
