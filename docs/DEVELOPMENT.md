# Development Guide — GIS Toolbox

## Workflow overview

This project uses a **local-first, two-branch** workflow. There are no feature branches and no pull requests for normal development.

```
┌─────────────────────────────────────────────────────────┐
│  1. Edit locally on staging (Cursor, editor, etc.)      │
│  2. Commit on staging via GitHub Desktop                │
│  3. Push staging → preview site updates                 │
│  4. Promote staging → main (GitHub Actions button)      │
└─────────────────────────────────────────────────────────┘
```

## Branches

### `staging` (development)

- All feature work and bug fixes happen here
- Agents and editors make local file changes on this branch
- Push to deploy the staging preview at `/gis-toolbox/staging/`

### `main` (production)

- Production release branch only
- **Do not develop on `main`**
- Promote from `staging` via the **Promote to Production** GitHub Actions workflow when ready to release

## What we do NOT use

- Feature branches (`feature/*`, `fix/*`, etc.)
- Pull requests for solo development
- GitHub website for merges (use GitHub Desktop)
- Agent-initiated commits or pushes (unless explicitly requested)

## GitHub Desktop steps

### Daily development

1. Ensure you are on the `staging` branch
2. Make changes locally (with or without Cursor)
3. Review changes in GitHub Desktop
4. Write a commit message and commit
5. Push `staging` to origin

### Releasing to production

1. Ensure `staging` is pushed and tested on the preview site
2. On GitHub.com, open **Actions → Promote to Production → Run workflow**
3. Set **Use workflow from** to **`staging`**
4. Type `promote` in the confirmation field and run the workflow
5. The workflow runs tests on `staging`, merges `staging` into `main`, pushes `main`, then syncs `staging` with `main`
6. The **Deploy Pages** workflow runs automatically and production updates

You do not need to switch to or merge `main` locally, and you do not need to open or merge a PR yourself.

**If promotion fails with a merge conflict:** merge `main` into `staging` in GitHub Desktop, resolve conflicts, commit, push `staging`, then run **Promote to Production** again.

**If you re-enable branch protection on `main`:** direct pushes from Actions will be blocked again. Either keep protection off for this two-branch workflow, or merge `staging` → `main` manually in GitHub Desktop instead of using the button.

## AI agents (Cursor)

Project rules live in `.cursor/rules/` and apply to every agent session:

| File | Purpose |
|------|---------|
| `git-workflow.mdc` | Mandatory git workflow — always applied |
| `project-core.mdc` | Project entry point and code standards |

Full agent instructions: [AGENTS.md](../AGENTS.md)

### Agent do's

- Edit files locally on `staging`
- Iterate with the user until changes are ready
- Remind the user to commit/push via GitHub Desktop when done

### Agent don'ts

- Create feature branches
- Open pull requests
- Commit, push, or merge without explicit user request
- Edit `main` during normal development

## Deployment

Workflows:

| Workflow | Trigger | Result |
|----------|---------|--------|
| `deploy-pages.yml` | Push to `staging` | Staging preview built and deployed |
| `deploy-pages.yml` | Push to `main` | Production site built and deployed |
| `promote-staging.yml` | Manual (Actions button) | Tests `staging`, merges into `main`, syncs `staging` |

No manual deploy step is required.

## Local setup

```bash
npm install
npm run dev              # web/PWA dev server
npm run build            # production web build → dist/ (used by Pages deploy)
npm run build:web        # explicit web build → dist-web/
npm run build:desktop    # Windows frontend build → dist-desktop/ (no PWA SW)
npm run dev:desktop:ui   # desktop Vite mode in a browser (no Tauri window)
npm run dev:desktop      # Tauri Windows shell + desktop Vite (requires Rust + Windows)
npm run build:desktop:app # package Windows installer via Tauri (Windows machine)
npm test                 # run tests
```

### Dual runtime (PWA + Windows desktop)

GIS Toolbox is one shared frontend with two build targets. See
[`docs/PWA_DESKTOP_COMPAT.md`](PWA_DESKTOP_COMPAT.md) for the blast-radius matrix
(what breaks what), and [`docs/PWA_DESKTOP_WORKFLOW_PLAN.md`](PWA_DESKTOP_WORKFLOW_PLAN.md)
for architecture and packaging.

**Agent shortcuts** (or type `/` in chat):

- “fix/update PWA” → `/fix-pwa`
- “fix/update desktop” → `/fix-desktop`
- “feature for both” → `/feature-both`
- dual smoke → `/smoke-both`
- cheap tests/docs QA → `/qa-both` (Composer subagent `dual-runtime-qa`)

| Target | Command | Output |
|--------|---------|--------|
| Public PWA (existing deploy) | `npm run build` | `dist/` |
| Explicit web | `npm run build:web` | `dist-web/` |
| Windows shell frontend | `npm run build:desktop` | `dist-desktop/` |
| Windows installed app | `npm run build:desktop:app` | installer under `src-tauri/target/` |

Platform contracts live in `js/platform/`. Widget controllers receive `ctx.platform` and
`ctx.services` via `getWidgetContext()`. Do not import Tauri APIs outside `js/platform/windows/`.

The Tauri shell lives in `src-tauri/` (Windows 11 / WebView2). Day-to-day widget work still
uses `npm run dev` in the browser. Use `npm run dev:desktop` on a Windows machine when you
need the native window, file dialogs, or sidecar features.

### Desktop jobs + Python sidecar

Long-running native work uses `ctx.services.jobs` / `ctx.services.compute` with allow-listed
operations (`echo`, `summarize_geojson`). The Python sidecar is under
`desktop/sidecar/python/` (stdlib only for v0.1).

```bash
# Smoke the sidecar without Tauri
cd desktop/sidecar/python
printf '%s\n' '{"id":"1","op":"health","input":{}}' | python3 -m gis_sidecar
```

On Windows, package a frozen binary later with:

`powershell -File desktop/scripts/package-sidecar-windows.ps1`

### Desktop-only GIS Widget

**GeoJSON File Summary** (`js/widgets/geojson-file-summary/`) appears in the GIS Widgets
panel only when `pythonCompute` and `nativeFiles` capabilities are available (Windows
desktop shell with a healthy Python sidecar). It is hidden in the public PWA.

### Shared accelerated widget

**Layer Summary** (`js/widgets/layer-summary/`) works in the public PWA and desktop app.
It always has a JavaScript provider. On Windows, layers with ≥ 2,500 features can optionally
use the Python sidecar (`optionalCapabilities: ['pythonCompute']`). The dialog shows
**Mode: JavaScript** or **Mode: Python (accelerated)**.

### Windows CI

| Workflow | Trigger | Result |
|----------|---------|--------|
| `build-windows-preview.yml` | Push to `staging` | Tests + `build:desktop` + `cargo check` → Actions artifact |
| `build-windows-release.yml` | Push to `main` (after Promote) | Tauri NSIS/MSI → GitHub Release |

Web deploy via `deploy-pages.yml` is unchanged.

**Git workflow is unchanged:** develop on `staging`, push for preview, Promote to Production for `main`.

## Planned features

| Document | Description |
|----------|-------------|
| [`docs/LIVE_MAP_FEATURE_PLAN.md`](LIVE_MAP_FEATURE_PLAN.md) | App URL config, live/service layers, Live Map widget (Import entry). |
| [`docs/LIVE_MAP_PRESETS.md`](LIVE_MAP_PRESETS.md) | Catalog authoring for Import → Live Layers. |

## Optional: Cursor User Rules note

If you have global Cursor User Rules that mention pull requests or `gh pr create`, add this line to your **User Rules** in Cursor Settings so they do not conflict with this repo:

> For the **gis-toolbox** repository, follow project rules in `.cursor/rules/` — local staging workflow only, no PRs, no feature branches.

Project rules in `.cursor/rules/` take precedence when working in this repo.
