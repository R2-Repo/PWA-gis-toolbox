# Agent Guide — GIS Toolbox

Instructions for AI agents working on this repository.

## Git workflow (CRITICAL — read first)

This project does **not** use pull requests or feature branches for day-to-day development.

### Model

```
Local edits on staging → user commits in GitHub Desktop → user pushes staging
→ when ready: user merges staging → main in GitHub Desktop
```

### Rules for agents

1. **Work locally only.** Make file changes on disk; iterate with the user until they are satisfied.
2. **Develop on `staging` only.** Do not check out, edit, or commit on `main` unless the user explicitly requests a production hotfix.
3. **No feature branches.** Only `main` and `staging` exist for this workflow. Do not create `feature/*`, `fix/*`, or similar branches.
4. **No PRs.** Do not run `gh pr create`, do not suggest GitHub pull requests, and do not push branches for review unless the user explicitly asks.
5. **No git writes by default.** Do not commit, push, merge, or rebase unless the user explicitly asks in that session.
6. **GitHub Desktop is the user's tool.** The user handles all commits and merges through GitHub Desktop, not the GitHub website and not the CLI (unless they ask otherwise).
7. **Local Agent mode only.** Prefer local editing over cloud agents or isolated worktrees that default to PR-based handoff.

### Branch purposes

| Branch | Purpose | Who touches it |
|--------|---------|----------------|
| `staging` | Active development and preview | User + agents (local edits only) |
| `main` | Production release | User only (merge from staging via GitHub Desktop) |

### Deployment

GitHub Actions deploys on push (see `.github/workflows/deploy-pages.yml`):

- **`staging`** → preview at `/gis-toolbox/staging/`
- **`main`** → production site

Agents do not need to trigger deploys manually; pushing the appropriate branch is enough.

### Ending a feature session

When work is complete:

1. Confirm local changes are ready
2. Tell the user to commit on `staging` in GitHub Desktop
3. Tell them to push `staging` to update the preview
4. Do **not** commit or push unless they explicitly ask

### What NOT to do (common mistakes)

- Do not create a feature branch and open a PR "for review"
- Do not push to remote after every small change
- Do not merge `staging` into `main` — the user does that in GitHub Desktop
- Do not use `gh pr create` even if user rules elsewhere mention PR workflows

## Code conventions

- Match existing patterns in surrounding files
- Minimize scope — focused changes only
- Reuse existing abstractions; don't reimplement similar logic
- Only add tests when requested or when they add meaningful coverage
- Comments only for non-obvious business logic

## PWA vs Desktop intents (CRITICAL for dual-runtime work)

GIS Toolbox is **one shared app** with two runtimes (public PWA + private Windows desktop). When the user says:

| User says… | Agent must… |
|------------|-------------|
| **fix / update the PWA** (web, browser, staging preview) — or `/fix-pwa` | Follow `.cursor/skills/fix-pwa/SKILL.md` + `.cursor/rules/fix-pwa.mdc` |
| **fix / update the desktop app** (Windows, Tauri, WebView2) — or `/fix-desktop` | Follow `.cursor/skills/fix-desktop/SKILL.md` + `.cursor/rules/fix-desktop.mdc` |
| **Feature for both** / works on PWA and desktop — or `/feature-both` | Follow `.cursor/skills/feature-both/SKILL.md` + `.cursor/rules/feature-both.mdc` |
| Dual smoke / “did we break the other?” — or `/smoke-both` | Blast-radius checks from `docs/PWA_DESKTOP_COMPAT.md` |
| QA / tests / dual-runtime docs after a change — or `/qa-both` | Delegate to subagent `.cursor/agents/dual-runtime-qa.md` (**Composer fast**, not the parent model) |
| Boundary / desktop security audit — or `/platform-boundary` | Readonly subagent `.cursor/agents/platform-boundary.md` (Composer fast) |
| After a widget **Build Plan** — or `/widget-scaffold` | Subagent `.cursor/agents/widget-scaffold.md` (Composer fast) reviews plan + PWA/desktop gating |
| Bug with **no** runtime named — or `/which-runtime` | Follow `.cursor/skills/pwa-desktop-compat/SKILL.md` — classify first |

**Slash commands** (type `/` in chat): `fix-pwa`, `fix-desktop`, `feature-both`, `smoke-both`, `qa-both`, `platform-boundary`, `widget-scaffold`, `which-runtime`.

**Cost tip:** Parent (expensive) model plans/implements. Composer subagents do QA, boundary/security scan, and widget plan review. Do not use Fable/Opus-class models for those mechanical passes.

**Always read** [`docs/PWA_DESKTOP_COMPAT.md`](docs/PWA_DESKTOP_COMPAT.md) for the path matrix and blast radius.

Implied constraints (user should not need to repeat):

- Desktop-only fixes start in `src-tauri/` / `js/platform/windows/` / `desktop/sidecar/`
- Shared changes use platform adapters — do not rewrite the other runtime’s path
- No `@tauri-apps/*` outside `js/platform/windows/`
- After shared or desktop work: keep **both** `npm run build` and `npm run build:desktop` green

## GIS Widgets (multi-step panel wizards)

When the user wants to **add or change a GIS Widget** (left panel → **GIS Widgets** section):

1. **Read first:** [`docs/WIDGET_AGENT_PLAYBOOK.md`](docs/WIDGET_AGENT_PLAYBOOK.md) — architecture, reference widgets, workflow
2. **Then:** [`docs/WIDGET_AUTHORING.md`](docs/WIDGET_AUTHORING.md) — step-by-step checklist and smoke test list
3. Register in `js/widgets/registry.js` only; wire through `js/widgets/<id>/controller.js` + `openReactIsland()`

Do not put widget logic inline in `js/tools/tool-handlers.js`. Copy the closest existing widget under `js/widgets/` (simplest: `spatial-analyzer/`).

**Sheet Cutter clipped polygons:** follow [`docs/SHEET_CUTTING.md`](docs/SHEET_CUTTING.md) — the **clean sheet cutting** model (buffer corridor + perpendicular match lines + along-route clip). Do not change geometry without reading that doc first.

## Project layout (quick reference)

| Path | Purpose |
|------|---------|
| `js/widgets/` | GIS Widget engines, controllers, registry |
| `react/widgets/` | Widget React dialogs and shared wizard UI |
| `js/platform/` | Web/Windows platform contracts and providers (no Tauri in shared code) |
| `src-tauri/` | Tauri 2 Windows shell (WebView2); packages `dist-desktop/` |
| `js/` | Core app logic (map, import, export, workflow, tools) |
| `react/` | React UI islands (tools, panels, workflow editor) |
| `css/` | Stylesheets |
| `pipelines/` | Saved workflow pipeline JSON |
| `public/` | Static assets |
| `docs/` | Development guide, widget playbook, authoring checklist, **sheet cutting geometry** (`SHEET_CUTTING.md`), **Network Atlas** (`NETWORK_ATLAS.md`), **UGRC API** (`UGRC.md`), PWA↔Desktop blast radius (`PWA_DESKTOP_COMPAT.md`), PWA+Windows plan (`PWA_DESKTOP_WORKFLOW_PLAN.md`) |
| `js/ugrc/` | UGRC API client (reverse route/milepost, key resolve) |
| `js/atlas/`, `react/atlas/` | ITS Network Atlas workspace (desktop-first; not a GIS widget) |
| `.cursor/skills/` | Agent skills: `fix-pwa`, `fix-desktop`, `feature-both`, `pwa-desktop-compat` |
| `.cursor/commands/` | Slash commands: `/fix-pwa`, `/fix-desktop`, `/feature-both`, `/smoke-both`, `/qa-both`, `/which-runtime` |
| `.cursor/agents/` | Custom subagents (Composer fast): `dual-runtime-qa`, `platform-boundary` (readonly + desktop security), `widget-scaffold` |

**Build targets:** `npm run build` → `dist/` (existing Pages deploy), `npm run build:web` → `dist-web/`, `npm run build:desktop` → `dist-desktop/` (no PWA service worker).

## Local development

```bash
npm install
npm run dev
```

See `docs/DEVELOPMENT.md` for the full workflow and deployment details.
