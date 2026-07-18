---
name: feature-both
description: Add or change a GIS Toolbox feature for both the public PWA and Windows desktop app without breaking either. Use when the user wants a shared feature, “works on both”, dual-runtime work, or /feature-both.
---

# Feature for both runtimes (PWA + Desktop)

## Goal

Ship **one shared feature** that works in the browser PWA and the Windows Tauri app, without forking UI or arguing about platform constraints mid-flight.

## Read first

1. [`docs/PWA_DESKTOP_COMPAT.md`](../../../docs/PWA_DESKTOP_COMPAT.md)
2. `.cursor/rules/platform-shared.mdc`
3. Widget work also: `docs/WIDGET_AGENT_PLAYBOOK.md` + `docs/WIDGET_AUTHORING.md`

## Non-negotiable process (do this in order)

### 1. Classify the surface (30 seconds)

Split the feature into:

| Layer | Goes in | Examples |
|-------|---------|----------|
| **Shared product** | `js/`, `react/`, widgets | UI, map, engine, protocol |
| **Browser provider** | `js/platform/web/` | `window.open`, browser file pickers, JS fallbacks |
| **Windows provider** | `js/platform/windows/`, maybe `src-tauri/`, `desktop/sidecar/` | Tauri windows, native dialogs, Python jobs |
| **Web-only chrome** | PWA/SW/MobileGate | Never required for desktop |

If something needs OS power, **extend a contract** in `js/platform/contracts.js` and implement **both** providers. Do not put `@tauri-apps/*` in shared modules.

### 2. Design for degradation (before coding)

State explicitly in your plan:

- What works on **web** (always)
- What is **enhanced** on Windows (`optionalCapabilities`) vs **required** on Windows only (`requiredCapabilities` — rare for “both”)
- What the PWA shows when a native capability is missing (hide, disable, or JS fallback — never crash)

Default for “works on both”: shared UI + JS path on web; optional acceleration on desktop.

### 3. Implement shared first, providers second

1. Pure engine / shared UI / controller using `ctx.platform` / `ctx.services` only
2. Web provider behavior (must work alone)
3. Windows provider behavior (must not change web semantics)
4. Registry capabilities if needed
5. Tests for engine + platform contracts

### 4. Definition of done (must all pass — do not claim finished early)

```bash
npm test
npm run build          # or build:web — PWA artifact
npm run build:desktop  # desktop frontend bundle
```

**Smoke (same feature, both runtimes):**

| Check | PWA (`npm run dev` or preview) | Desktop (`npm run dev:desktop`) |
|-------|--------------------------------|----------------------------------|
| Feature opens / runs | ✓ | ✓ |
| Happy path completes | ✓ | ✓ |
| No console/runtime hard fail | ✓ | ✓ |
| Capability missing UI (if any) | ✓ (degrades) | N/A or enhanced path |

If you cannot run desktop in this environment, still keep web green, keep Windows providers compiling, and list exact desktop smoke steps for the user — do **not** invent “it works on desktop” without evidence.

### 5. Communication style (avoid thrash)

- Lead with the layer split and done criteria, then implement
- Do not rewrite shared code mid-task to “make Tauri easier”
- Do not ask the user to re-explain PWA vs desktop rules — they are in this skill
- If blocked, ask **one** concrete question (e.g. “JS fallback OK on web, or hide the control?”)

## Hard constraints

- No `@tauri-apps/*` outside `js/platform/windows/`
- No Windows-only fork of widgets under a second tree
- No pointing desktop at the PWA service-worker build
- Prefer adapters over `if (desktop)` scattered in engines
- Dual-screen / second window / files / compute → platform services, not raw APIs in widgets

## Anti-patterns (cause hours of troubleshooting)

- Implementing only in Tauri, then “porting” to web later
- Changing shared MapLibre / dual-screen defaults for a desktop-only glitch
- Desktop feature that silently no-ops on web with no UI explanation
- Skipping `build:desktop` because “it’s just a web change”
