# PWA ↔ Desktop compatibility (blast radius)

> **One shared app, two runtimes.** Use this when deciding where a fix belongs and what else it can break.
>
> Agents: if the user says **fix/update PWA** or **fix/update desktop**, follow the matching skill under `.cursor/skills/` and the rules in `.cursor/rules/fix-*.mdc`.

## Runtimes

| Runtime | Who uses it | Dev | Build |
|---------|-------------|-----|-------|
| **PWA (web)** | Public users in the browser | `npm run dev` | `npm run build` / `build:web` |
| **Desktop (Windows)** | Private Windows 11 app (Tauri / WebView2) | `npm run dev:desktop` | `npm run build:desktop` |

Same `js/` + `react/` source. Different shell, file APIs, and (on desktop) Python jobs.

---

## Path matrix — where to edit

| Path | Touches | Safe intent |
|------|---------|-------------|
| `js/map/`, `js/tools/`, `js/widgets/`, `react/`, `css/` | **Both** | Shared product fix — verify both runtimes if UI/map behavior changes |
| `js/dual-screen/` (protocol, coordinator, layout) | **Both** | Shared dual-screen logic — do not Tauri-specialize here |
| `js/dual-screen/window-open.js` | **Both** (adapter edge) | Open second window via platform API; keep browser `window.open` for PWA |
| `js/platform/contracts.js` | **Both** (API shape) | Change carefully; update web + windows providers + tests |
| `js/platform/web/` | **PWA only** | Browser file/job/compute providers |
| `js/platform/windows/`, `src-tauri/`, `desktop/sidecar/` | **Desktop only** | Native shell, dialogs, Python — must not break `build:web` |
| PWA plugin / service worker / `MobileGate` / install UX | **PWA only** | Must not be required by desktop build |
| `vite.config.js` build modes | **Both** | Desktop mode must stay **without** SW registration |

---

## Intent → default strategy

### “Fix / update the PWA” (or web app / browser / staging preview)

1. Prefer `js/platform/web/` for browser-only APIs.
2. Shared fixes are OK when the bug exists in the browser — keep desktop providers working.
3. **Do not** add `@tauri-apps/*`, sidecar, or Windows-only assumptions.
4. Verify: `npm test` + `npm run build` (or `build:web`).
5. Smoke (browser): load app → pan/zoom → one import or widget relevant to the change.

### “Fix / update the desktop app” (or Windows / Tauri / WebView2)

1. If the bug is **desktop-only**, start in `src-tauri/` or `js/platform/windows/`.
2. If shared UI/logic must change, **add a platform adapter** — do not rewrite the PWA path.
3. Hard rule: `@tauri-apps/*` only in `js/platform/windows/` (via `tauri-bridge.js`).
4. Verify: `npm test` + `npm run build` / `build:web` + `npm run build:desktop`.
5. Smoke: desktop for the bug; **also browser** if any shared file changed.

### Ambiguous (“zoom is broken”, “dual screen is broken”)

1. Ask: does it fail in the **browser PWA** too?
2. Browser-only → PWA / shared web path.
3. Desktop-only → shell or Windows platform provider first.
4. Both → shared fix with dual smoke.

---

## High-risk examples

| Symptom | Likely bucket | Safe approach |
|---------|---------------|---------------|
| Map zoom works in browser, not in Tauri | Desktop shell / WebView2 input | Fix shell or platform; avoid changing shared MapLibre zoom rates unless browser also wrong |
| Dual screen works in browser, not desktop | Adapter (`window.open` vs Tauri webview) | Platform window API; keep PWA on `window.open` |
| Native file dialog / Python job | Desktop only | `js/platform/windows/` + `src-tauri/` / sidecar allow-list |
| Widget logic wrong everywhere | Shared | Engine/controller/React; no OS imports |

---

## Hard rules (never skip)

1. **No** `@tauri-apps/*` outside `js/platform/windows/`.
2. **No** duplicate Windows copies of shared widgets.
3. Prefer `requiredCapabilities` / `optionalCapabilities` over scattered `if (desktop)`.
4. Desktop production build must **not** register the PWA service worker.
5. Do not point the installed Windows app at the PWA `dist/` artifact.

---

## Minimal smoke (not full QA)

| Changed | Check |
|---------|--------|
| Desktop-only paths | Desktop: reproduce fix. Web build still green. |
| PWA-only paths | Browser: reproduce fix. Desktop build still green. |
| Shared map / tools / dual-screen / widgets | Browser + desktop: the affected flow only |

You do **not** need to retest the entire product after every change — only the blast radius above.

---

## Related

- Plan / architecture: [`PWA_DESKTOP_WORKFLOW_PLAN.md`](./PWA_DESKTOP_WORKFLOW_PLAN.md)
- Contracts: `js/platform/contracts.js`
- Skills: `.cursor/skills/fix-pwa/`, `.cursor/skills/fix-desktop/`
- Rules: `.cursor/rules/fix-pwa.mdc`, `.cursor/rules/fix-desktop.mdc`, `platform-shared.mdc`
