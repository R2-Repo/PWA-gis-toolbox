# Unified PWA + Windows 11 Desktop Cursor Workflow

> **Scope:** Public PWA for everyone. Private native Windows 11 desktop app for you and a small trusted group. One shared source tree, two production builds.

---

## Current state (what you already have)

GIS Toolbox is already well-positioned for this:

- **One Vite/React app** with PWA via `vite-plugin-pwa` (`vite.config.js`)
- **Clean separation inside widgets**: pure `engine.js` → `controller.js` → React dialog → `registry.js`
- **WidgetContext already exists** — controllers receive deps via `createWidgetContext()` in `js/tools/tool-handlers.js`
- **No desktop shell yet** — no Electron/Tauri
- **Cursor rules already guide widget work** (`.cursor/rules/widget-authoring.mdc`, `docs/WIDGET_AGENT_PLAYBOOK.md`)

The goal is not two apps — it is **one app, two runtimes**.

---

## Core architecture (merged recommendation)

```
One shared GIS application
    ↓
Shared widgets, map, tools, React UI, engines
    ↓
Platform-neutral service contracts (js/platform/contracts.js)
    ↓
Public web provider  OR  Private Windows provider
    ↓
Browser APIs  OR  Tauri / Rust / Python / GPU
```

### What stays shared (write once, runs in both)

- `js/widgets/*/engine.js`
- `js/widgets/*/controller.js`
- `react/widgets/*`
- MapLibre, layer management, GIS tools, styling, app state
- `js/widgets/registry.js`

### Windows-only (never duplicated into shared UI)

- `src-tauri/` — Tauri 2 shell, WebView2 window, installer, IPC commands
- `js/platform/windows/` — only place allowed to import `@tauri-apps/*`
- `desktop/sidecar/` — packaged Python + GDAL/PDAL, narrow typed operations
- Native file dialogs, job runner, GPU backends

**Critical rule:** The Windows app is a **native installed program** (taskbar, Start menu, installer) rendering the same React UI inside **WebView2** — not Chrome/Edge opened as a browser tab.

---

## Key refinement: separate production builds

Both targets compile from the same source, but use **different Vite build modes**:

| Command | Output | Purpose |
|---------|--------|---------|
| `npm run dev` | dev server | PWA development |
| `npm run dev:desktop` | dev server + Tauri | Windows development |
| `npm run build:web` | `dist-web/` | Public PWA deploy |
| `npm run build:desktop` | `dist-desktop/` | Windows installer bundle |

**Web build includes:** PWA service worker, offline caching, install prompts, MobileGate, browser file handling.

**Desktop build excludes:** PWA service-worker registration, install prompts, browser-only launch behavior.

Do **not** point the production Windows app at the PWA build artifact. Same source, different runtime config.

---

## Platform services via WidgetContext (not scattered if-checks)

Extend the existing `WidgetContext` model instead of letting widgets import Tauri directly.

```javascript
ctx.platform = {
  runtime: 'web' | 'windows',
  os: 'browser' | 'windows',
  capabilities: {
    nativeFiles: { available: true },
    pythonCompute: { available: true, version: '1.0.0' },
    gpuCompute: { available: false, reason: 'No supported GPU backend' }
  }
};

ctx.services = {
  files,    // open/save/reveal in Explorer
  compute,  // run('viewshed', input, { signal, onProgress })
  jobs,     // long-running cancellable work
  notifications
};
```

**Hard Cursor rule:** No widget engine, controller, React dialog, or shared module may import `@tauri-apps/*`. Only `js/platform/windows/` may.

Controllers call:

```javascript
const result = await ctx.services.compute.run('generate-contours', input, { signal, onProgress });
```

They do not need to know whether JS, Python, or GPU ran the operation.

---

## Registry capability metadata

Extend `registry.js` with required and optional capabilities:

**Desktop-only widget:**
```javascript
{
  type: 'point-cloud-classifier',
  requiredCapabilities: ['pythonCompute', 'localPdal'],
  open: openPointCloudClassifier
}
```

**Shared widget with optional Windows acceleration:**
```javascript
{
  type: 'terrain-analysis',
  requiredCapabilities: [],
  optionalCapabilities: ['pythonCompute', 'gpuCompute'],
  open: openTerrainAnalysis
}
```

| Situation | Behavior |
|-----------|----------|
| Missing **required** capability | Hide widget or show unavailable |
| Missing **optional** capability | Use web-compatible implementation |
| Optional capability present | Use accelerated Windows path |

---

## Runtime capability detection (startup handshake)

Do not assume Windows desktop = all capabilities available.

On startup, detect:
- Python sidecar launched and version
- GDAL / PDAL availability
- GPU backend (if any)
- Writable working directories
- Required data packages installed

This beats simply checking `window.__TAURI__`.

---

## Python sidecar design

Package Python with the Windows installer. Users should **not** install Python, GDAL, PDAL, or venvs separately.

```
React/controller → typed Windows bridge → Tauri Rust command → validated sidecar request → packaged Python exe
```

**Do not expose:** `runPythonScript(name, args)` or arbitrary shell execution.

**Do expose narrow operations:** `generateContours`, `classifyPointCloud`, `runViewshed`, etc.

Each operation needs: validated input, output schema, versioned protocol, structured errors, progress, cancellation, timeout, logging, temp-file cleanup.

Pass **file paths / dataset handles** through IPC — not giant JSON rasters.

---

## Job system for long GIS work

Long operations use `ctx.services.jobs`, not a single blocking IPC call:

```javascript
const job = await ctx.services.jobs.start({ operation: 'generate-contours', input });
job.onProgress((p) => {});
job.onLog((msg) => {});
job.cancel();
const result = await job.result;
```

Includes: job ID, progress stages, cancellation, crash detection, schema versioning, cleanup.

---

## GPU strategy

Treat GPU as a **separate capability** from Python. A machine may have Python but no usable GPU.

Capability names: `nativeFiles`, `pythonCompute`, `gpuCompute`, `localGdal`, `localPdal`, `largeDatasetProcessing`.

Defer GPU infrastructure until a specific operation needs it. Test on the actual Windows 11 machines you will use. Always keep CPU fallback where practical.

---

## Private Windows 11 distribution

Simple is fine for a small trusted group:
- Windows installer, direct private sharing, manual version control
- No app store, no public download page, no desktop user accounts initially
- No auto-updater required at first (add code signing + updates later if useful)

**Security:** Private distribution does not make embedded secrets safe. Do not put API keys in React, Tauri config, or Python source. Use your Cloudflare/backend proxy, short-lived credentials, Windows Credential Manager, or user-provided credentials.

---

## Repository structure

```
js/                          # shared (existing)
react/                       # shared (existing)
css/                         # shared (existing)

js/platform/
  contracts.js
  create-platform.js
  web/
    web-platform.js
    web-file-service.js
    web-compute-service.js
  windows/
    windows-platform.js
    windows-file-service.js
    windows-compute-service.js
    windows-job-service.js
    tauri-bridge.js          # ONLY place for @tauri-apps imports

src-tauri/                   # Tauri 2 shell (Windows 11 / WebView2)
  src/
  capabilities/
  Cargo.toml
  tauri.conf.json

desktop/
  sidecar/
    python/
    packaging/
    protocol/
  scripts/
```

Use `windows` naming (not generic `desktop`) since macOS/Linux are out of scope.

---

## Cursor agent rules

**Living blast-radius doc:** [`docs/PWA_DESKTOP_COMPAT.md`](PWA_DESKTOP_COMPAT.md)

**Intent skills** (user does not need to spell out constraints):

| User says | Skill |
|-----------|--------|
| fix/update PWA / web / browser | `.cursor/skills/fix-pwa/SKILL.md` + `fix-pwa.mdc` |
| fix/update desktop / Windows / Tauri | `.cursor/skills/fix-desktop/SKILL.md` + `fix-desktop.mdc` |
| feature for both / works on both | `.cursor/skills/feature-both/SKILL.md` + `feature-both.mdc` |
| unclear which runtime | `.cursor/skills/pwa-desktop-compat/SKILL.md` |

### platform-shared.mdc (always on)
- Default all widget, map, tool, UI, and bug-fix work to shared code
- Never create Windows copies of shared widgets
- Engines stay platform-independent
- Use WidgetContext services for platform behavior
- No Tauri or Python imports in shared modules
- Route “fix PWA” / “fix desktop” intents to the skills above

### windows-native.mdc (when editing src-tauri/, desktop/sidecar/, js/platform/windows/)
- Expose native behavior through narrow typed service operations
- No arbitrary shell execution or generic Python script execution
- Every native operation: input validation, structured errors, progress, cancellation, temp-file cleanup
- Must not break the public web build

### build-target.mdc
- PWA and Windows compile from same source, separate Vite modes
- Windows build must not register PWA service worker
- After shared changes, both build targets must stay green

### Prompt templates

**Short forms (preferred):**
> Fix the PWA: [issue]
> Fix the desktop app: [issue]

**Slash commands** (type `/` in Agent chat — no need to remember wording):
- `/fix-pwa` — then describe the PWA issue
- `/fix-desktop` — then describe the desktop issue
- `/feature-both` — new/changed feature that must work on PWA **and** desktop
- `/smoke-both` — dual-runtime blast-radius check after a change
- `/qa-both` — cheap Composer subagent: tests, builds, boundary audit, minimal docs
- `/which-runtime` — classify before fixing

**Subagent:** `.cursor/agents/dual-runtime-qa.md` pinned to `composer-2.5-fast` so expensive parent models do not spend tokens on test logs and doc maintenance.

**Shared widget or bug fix:**
> Add/fix [X] following WIDGET_AGENT_PLAYBOOK. Engine stays pure. No Tauri imports. Platform behavior via ctx.services only.

**Windows-only feature:**
> Add [Y] with requiredCapabilities. Native work in src-tauri/ and desktop/sidecar/. Shared UI in react/widgets must degrade on web.

**Accelerated shared widget:**
> Keep UI/controller shared. Web provider uses JS/workers. Windows provider uses ctx.services.compute. Register optionalCapabilities.

### Task acceptance checks

**Shared work:** vitest, build:web, build:desktop, smoke in browser + Tauri, no Tauri imports outside js/platform/windows/, no duplicate Windows widget folders.

**Windows-native work:** both builds green, cargo check, sidecar health check, missing capability → controlled UI, cancellation cleans temp files, no shell execution exposed.

### Cursor sessions

- **Session A (90%):** shared GIS — widgets, map, tools
- **Session B:** Tauri, sidecar, IPC, packaging

Do not combine major native work with unrelated widget work in one prompt.

**Parallel agents:** use separate git worktrees or branches — separate Cursor conversations do not isolate filesystem edits.

### Git workflow

Keep `staging` as integration branch (per AGENTS.md). Test both targets before promoting.

---

## GitHub workflow — same branches, one extra deploy path

Your current workflow stays the same. You do **not** need feature branches, PRs, or a separate desktop branch.

### What you already do (unchanged)

| Step | You do | What happens |
|------|--------|--------------|
| 1 | Edit locally on `staging` | Nothing automatic yet |
| 2 | Commit + push `staging` in GitHub Desktop | **Web preview** rebuilds and deploys |
| 3 | Test preview site | Staging PWA at `/gis-toolbox/staging/` |
| 4 | Actions → **Promote to Production** → type `promote` | Tests run, `staging` merges into `main`, `staging` syncs |
| 5 | (automatic) | **Web production** rebuilds and deploys |

> **Note:** This repo’s workflows deploy via **GitHub Pages** (`.github/workflows/deploy-pages.yml`). If you front that with Cloudflare, the branch model is identical — push `staging` = preview, push `main` = production.

### What gets added for Windows (mirrors the web pattern)

| Step | You do | What happens (new) |
|------|--------|-------------------|
| 2b | *(same push to `staging`)* | **Optional:** CI builds a **preview Windows installer** → downloadable artifact in Actions |
| 3b | Test desktop locally on your PC | `npm run dev:desktop` while developing; install preview `.msi` when you want a packaged test |
| 5b | *(automatic after promote)* | CI builds **production Windows installer** → attached to a **private GitHub Release** |

**You still only use one promote button.** Desktop production builds happen automatically when `main` updates — same moment as web production.

### Your day-to-day stays simple

```
Edit on staging  →  push staging  →  test web preview + test desktop locally
                                              ↓
                              Promote to Production (same button as today)
                                              ↓
                         main updates  →  web production + Windows release build
                                              ↓
                         share .msi link with trusted associates (private repo)
```

### What you do NOT need to learn

- No new branches for desktop
- No separate “desktop promote” button (unless you want an optional manual preview build)
- No merging web and desktop separately — one `staging` → `main` promote updates both
- No git commands beyond what GitHub Desktop already handles

### Local testing (your machine)

Most desktop testing happens **locally on your Windows 11 PC** before you push:

```bash
npm run dev              # web — same as today
npm run dev:desktop      # Windows app loading live dev server
npm run build:web        # verify web build
npm run build:desktop    # verify desktop build
npm test                 # same tests for shared code
```

You only rely on CI for **packaged installers** (`.msi`/`.exe`), not for day-to-day widget work.

### CI workflows to add (later, when Tauri exists)

Three small additions — each mirrors something you already have:

**1. Update `deploy-pages.yml`** (tiny change)

- Change `npm run build` → `npm run build:web`
- Output stays `dist/` or rename to `dist-web/` — web deploy unchanged

**2. New `build-windows-preview.yml`** (optional but recommended)

- **Trigger:** push to `staging` (same as web preview)
- **Runs on:** `windows-latest` (Windows builds require a Windows runner)
- **Does:** `npm run build:desktop` + Tauri package → upload `.msi` as Actions artifact (kept ~7–14 days)
- **You download** from GitHub → Actions → latest staging run → Artifacts

This is the desktop equivalent of your web preview URL.

**3. New `build-windows-release.yml`**

- **Trigger:** push to `main` (same as web production — fires after Promote)
- **Runs on:** `windows-latest`
- **Does:** build signed/unsigned production installer → attach to GitHub Release tagged e.g. `v2026.07.18` or semver
- **Associates download** from Releases tab (private repo = collaborators only)

**Optional: extend `promote-staging.yml`**

- Keep existing `npm test` on Ubuntu (fast)
- Do **not** block promote on Windows build — let the release workflow run after `main` pushes (simpler, same as web deploy today)

### Versioning (keep it simple)

Pick one approach and stick with it:

| Approach | How | Good for |
|----------|-----|----------|
| **Date tags** | `v2026.07.18` auto-set by CI | Low friction, small team |
| **Manual semver** | bump `version` in `src-tauri/tauri.conf.json` before promote | When associates need clear “which version am I on?” |

Both work with private GitHub Releases. No app store required.

### Distribution to associates

1. Repo stays **private**
2. Add associates as **collaborators** on the GitHub repo (read access is enough for Releases)
3. After promote, send them the **GitHub Release link** or the direct `.msi` download
4. No public download page needed

### Failure scenarios (simple fixes)

| Problem | Fix |
|---------|-----|
| Promote fails tests | Fix on `staging`, push, promote again (same as today) |
| Web preview works, desktop broken | Fix on `staging`, test with `npm run dev:desktop`, push |
| Windows CI build fails after promote | Web is already live; fix desktop on `staging`, promote again — associates keep previous `.msi` until new release |
| Merge conflict on promote | Same as today: merge `main` into `staging` in GitHub Desktop, resolve, push, promote again |

### Summary: one workflow, two outputs

```
                    staging branch
                         │
           ┌─────────────┴─────────────┐
           ▼                           ▼
    deploy-pages.yml          build-windows-preview.yml
    (web preview)             (optional .msi artifact)
           │                           │
           └─────────────┬─────────────┘
                         ▼
              Promote to Production
                         │
           ┌─────────────┴─────────────┐
           ▼                           ▼
    deploy-pages.yml          build-windows-release.yml
    (web production)          (GitHub Release .msi)
```

**Branches:** unchanged (`staging` + `main` only)  
**Your habit:** unchanged (GitHub Desktop + Promote button)  
**New part:** Windows installer appears automatically alongside web production — download and share privately


### Phase 1: Build separation
1. Add web and desktop Vite build modes
2. Produce `dist-web/` and `dist-desktop/`
3. Desktop build skips PWA service worker registration
4. Existing web behavior unchanged

### Phase 2: Platform contracts
1. Add `js/platform/contracts.js`
2. Add web platform provider
3. Extend WidgetContext with platform + services
4. Registry: requiredCapabilities + optionalCapabilities
5. All current widgets still work

### Phase 3: Empty Windows app
1. Scaffold Tauri 2 under `src-tauri/`
2. Dev: load Vite dev server; prod: load `dist-desktop/`
3. Confirm normal Windows window (taskbar, WebView2)
4. Smoke test: MapLibre, dialogs, layers, keyboard, export, drag/drop
5. Confirm existing shared widget works without duplication

### Phase 4: First native capability (before Python)
- Native open/save/folder dialogs
- Recent projects list
- Reveal in File Explorer

Validates IPC, permissions, and platform services with minimal risk.

### Phase 5: Job infrastructure
- Typed job contracts, progress, cancellation, logs, temp files
- Tests with mock Windows provider

### Phase 6: Python sidecar
1. Trivial packaged sidecar + health-check handshake
2. Bundle in Windows installer
3. One narrow GIS operation end-to-end
4. Verify progress, cancellation, errors, cleanup

### Phase 7: First desktop-only widget
- requiredCapabilities gating
- Hidden on public PWA
- Shared React structure, native processing via ctx.services

### Phase 8: Accelerated shared widget
- Existing widget gains optional Windows acceleration
- Web and Windows compute providers
- UI indicates when accelerated mode is active

### Phase 9: Windows packaging
- Installer, WebView2 runtime, bundled Python sidecar
- Test clean Windows 11 install, uninstall, upgrade
- Code signing + auto-update later if needed

---

## What NOT to do

- Two frontends (copying `react/widgets` into a Windows folder)
- Full monorepo split before a working shell exists
- Generic `runPythonScript()` or shell execution APIs
- Direct Tauri imports in shared code
- Assuming all capabilities exist just because runtime is Windows
- Embedding secrets in packaged desktop files
- Pointing production Windows app at the PWA build artifact

---

## Summary

Treat GIS Toolbox as one modular web app. Add a thin **Windows 11 Tauri shell** hosting a **separate desktop frontend build** from the same source. Inject platform behavior through **WidgetContext services** and **capability-gated registry entries**. Native work stays in `src-tauri/` + `desktop/sidecar/` with **narrow typed operations** and a **cancellable job system**. Cursor agents default to shared paths; Windows-native work is a separate session with hard import boundaries.

---

## Implementation todos

- [x] Phase 1: web + desktop Vite build modes → dist-web/ and dist-desktop/ (`npm run build` still → `dist/` for Pages)
- [x] Phase 2: js/platform/ contracts + web provider + WidgetContext extension + registry capabilities
- [x] Cursor rules: platform-shared.mdc, windows-native.mdc, build-target.mdc
- [x] PWA↔Desktop compat doc + fix-pwa / fix-desktop / feature-both / pwa-desktop-compat skills + rules + slash commands
- [x] Phase 3: src-tauri/ Tauri 2 shell loading dist-desktop/ (`npm run dev:desktop` / `build:desktop:app`)
- [x] Phase 4: native file dialogs via ctx.services.files (Tauri dialog plugin + reveal_in_explorer)
- [x] Phase 5: ctx.services.jobs infrastructure (shared handles + Windows IPC events + tests)
- [x] Phase 6: Python sidecar + health-check + `summarize_geojson` (dev: `python -m gis_sidecar`; Windows freeze script included)
- [x] Phase 7: first desktop-only widget — GeoJSON File Summary (`requiredCapabilities: ['pythonCompute','nativeFiles']`)
- [x] Phase 8: first accelerated shared widget — Layer Summary (JS always; Python optional for large layers)
- [x] Phase 9 lite: Windows CI preview + release workflows (full clean-machine QA still manual)
- [ ] CI: update deploy-pages.yml to use build:web (optional — current `npm run build` → `dist/` still works)
- [x] CI: add build-windows-preview.yml (push to staging → artifact)
- [x] CI: add build-windows-release.yml (push to main → GitHub Release)
