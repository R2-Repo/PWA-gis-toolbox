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

## GIS Widgets (multi-step panel wizards)

When the user wants to **add or change a GIS Widget** (left panel → **GIS Widgets** section):

1. **Read first:** [`docs/WIDGET_AGENT_PLAYBOOK.md`](docs/WIDGET_AGENT_PLAYBOOK.md) — architecture, reference widgets, workflow
2. **Then:** [`docs/WIDGET_AUTHORING.md`](docs/WIDGET_AUTHORING.md) — step-by-step checklist and smoke test list
3. Register in `js/widgets/registry.js` only; wire through `js/widgets/<id>/controller.js` + `openReactIsland()`

Do not put widget logic inline in `js/tools/tool-handlers.js`. Copy the closest existing widget under `js/widgets/` (simplest: `spatial-analyzer/`).

## Project layout (quick reference)

| Path | Purpose |
|------|---------|
| `js/widgets/` | GIS Widget engines, controllers, registry |
| `react/widgets/` | Widget React dialogs and shared wizard UI |
| `js/` | Core app logic (map, import, export, workflow, tools) |
| `react/` | React UI islands (tools, panels, workflow editor) |
| `css/` | Stylesheets |
| `pipelines/` | Saved workflow pipeline JSON |
| `public/` | Static assets |
| `docs/` | Development guide, widget playbook, authoring checklist, feature plans |

## Local development

```bash
npm install
npm run dev
```

See `docs/DEVELOPMENT.md` for the full workflow and deployment details.
