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

PWA hosting is **Cloudflare Pages** (Git-connected), not GitHub Pages:

- **`staging`** → Cloudflare Pages preview
- **`main`** → Cloudflare Pages production

Build env vars (e.g. `VITE_UGRC_API_KEY`) are set in the Cloudflare project settings — see [`docs/UGRC.md`](docs/UGRC.md). Agents do not need to trigger deploys manually; pushing the appropriate branch is enough.

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

## PWA intents

GIS Toolbox is a **browser-only progressive web app**. When the user says **fix / update the PWA** (web, browser, staging preview) — or `/fix-pwa`:

- Follow `.cursor/skills/fix-pwa/SKILL.md` + `.cursor/rules/fix-pwa.mdc`
- After a widget **Build Plan** — or `/widget-scaffold` — delegate to `.cursor/agents/widget-scaffold.md` (Composer fast) for playbook compliance review

**Slash commands** (type `/` in chat): `fix-pwa`, `widget-scaffold`.

## GIS Widgets (multi-step panel wizards)

When the user wants to **add or change a GIS Widget** (left panel → **GIS Widgets** section):

1. **Read first:** [`docs/WIDGET_AGENT_PLAYBOOK.md`](docs/WIDGET_AGENT_PLAYBOOK.md) — architecture, reference widgets, workflow
2. **Then:** [`docs/WIDGET_AUTHORING.md`](docs/WIDGET_AUTHORING.md) — step-by-step checklist and smoke test list
3. Register in `js/widgets/registry.js` only; wire through `js/widgets/<id>/controller.js` + `openReactIsland()`

Do not put widget logic inline in `js/tools/tool-handlers.js`. Copy the closest existing widget under `js/widgets/` (simplest: `spatial-analyzer/`).

**Sheet Cutter clipped polygons:** follow [`docs/SHEET_CUTTING.md`](docs/SHEET_CUTTING.md) — the **clean sheet cutting** model (buffer corridor + perpendicular match lines + along-route clip). Do not change geometry without reading that doc first.

**Import limits (end-user):** see [`docs/IMPORT_LARGE_FILES.md`](docs/IMPORT_LARGE_FILES.md) **End-user import gates** and [`js/import/import-limit-taxonomy.js`](js/import/import-limit-taxonomy.js). Gate A = in-memory (&lt;~4/5 MB, ≤250k). Gate B store unlock ≈ **1M** features. **250k** = materialize / heavy-tool budget (OPERATION), not “cannot import.” 2 GB = source-open SAFETY. Never conflate ROUTING / SAFETY / OPERATION.

**Dataset profile (Phase 2):** stream/convert builds `datasetProfile` on workspace layers (`js/import/dataset-profile.js`) — feature/geometry/attribute/storage pressures, not a single score. Used lightly for early MVT preference.

**Operation budgets (Phase 3):** `evaluateOperation` / `materializeForOperation` (`js/tools/operation-budget.js`, `gis-layer-context.js`) — GIS tools run on selection/viewport/layer working sets against the 250k materialize budget; oversized whole-layer ops suggest selection/viewport/filter.

**Capacity context (Phase 4):** `js/import/import-capacity-context.js` — device + project pressures may tighten Gate B store unlock and materialize budgets (never raise taxonomy max; SAFETY ceilings unchanged).

## Project layout (quick reference)

| Path | Purpose |
|------|---------|
| `js/widgets/` | GIS Widget engines, controllers, registry |
| `react/widgets/` | Widget React dialogs and shared wizard UI |
| `js/platform/` | Web platform contracts and providers |
| `js/` | Core app logic (map, import, export, workflow, tools) |
| `react/` | React UI islands (tools, panels, workflow editor) |
| `css/` | Stylesheets |
| `pipelines/` | Saved workflow pipeline JSON |
| `public/` | Static assets |
| `docs/` | Development guide, widget playbook, authoring checklist, **sheet cutting geometry** (`SHEET_CUTTING.md`), **UGRC API** (`UGRC.md`), **large-file import** (`IMPORT_LARGE_FILES.md`) |
| `js/ugrc/` | UGRC API client (reverse route/milepost, key resolve) |
| `.cursor/skills/` | Agent skills: `fix-pwa` |
| `.cursor/commands/` | Slash commands: `/fix-pwa`, `/widget-scaffold` |
| `.cursor/agents/` | Custom subagents (Composer fast): `widget-scaffold` |

**Build targets:** `npm run build` → `dist/` (Cloudflare Pages deploy), `npm run build:web` → `dist-web/`.

## Local development

```bash
npm install
npm run dev
npm test
```

See `docs/DEVELOPMENT.md` for the full workflow and deployment details.
