# GIS Widget Agent Playbook — gis-toolbox

> **Read this first** whenever you are adding, changing, or planning a new **GIS Widget** (left-panel multi-step wizard).
> Step-by-step checklist and anti-patterns: [`WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md).

---

## Standing rules (agents and tests)

- **No live API or REST calls** in agent work, tests, scripts, or the running app during automated runs (no ArcGIS REST, UGRC, geocoding, routing, tile, or data services). Use **local mocks and fixtures only**.
- **Git:** develop on **`staging` only**. Never edit, push to, or merge into **`main`**. Never edit **`.github/workflows/`**. Never **force-push**.
- Before pushing **`staging`**: **rebase** onto latest `origin/staging`, run **`npm ci`** then **`npm test`** (full Vitest suite), and push only when **green**.

---

## What "widget" means in this repo

In **gis-toolbox**, a "widget" is **not** an ArcGIS Experience Builder widget. It is a **multi-step GIS wizard** in the left panel:

- **Pure JS engine** (usually `js/widgets/<id>/engine.js`; large widgets split into multiple modules)
- **React dialog** (`react/widgets/<Widget>Dialog.jsx` or `PresentationLinkBuilder.jsx`)
- **Controller** (`js/widgets/<id>/controller.js` — wires map/layer callbacks)
- **Registry entry** (`js/widgets/registry.js` — panel visibility and `openWidget()` routing)

---

## Documentation in this repo

| Document | Path | Purpose |
|----------|------|---------|
| **This playbook** | [`docs/WIDGET_AGENT_PLAYBOOK.md`](WIDGET_AGENT_PLAYBOOK.md) | **Start here** — architecture, references, workflow |
| **Authoring checklist** | [`docs/WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md) | Step-by-step build checklist, smoke test list |
| **Agent guide** | [`AGENTS.md`](../AGENTS.md) | Git workflow, repo layout |
| **Development / deploy** | [`docs/DEVELOPMENT.md`](DEVELOPMENT.md) | Local setup, deployment |
| **Sheet cutting geometry** | [`docs/SHEET_CUTTING.md`](SHEET_CUTTING.md) | Clean sheet cutting model |

**Tests:** `tests/` holds **~130 Vitest files** (`npm test` → `vitest run`). Add or update tests when you change engine logic; keep the full suite green before pushing `staging`.

**Cursor rules:** `.cursor/rules/project-core.mdc`, `.cursor/rules/git-workflow.mdc`, `.cursor/rules/widget-authoring.mdc`

**New widgets:** copy the closest reference folder under `js/widgets/` (no `npm run new:widget` script in `package.json` today).

---

## When to build a widget (vs alternatives)

| Need | Build as | Location |
|------|----------|----------|
| One input → one operation → new layer | **GIS Tool** | `js/tools/gis-tools.js` + `react/tools/` |
| Multi-step wizard, map interaction, preview, bulk edits | **GIS Widget** | `js/widgets/<id>/` + `react/widgets/` |
| Reusable step in the visual workflow graph | **Pipeline node** | `js/workflow/nodes/` + `react/workflow/inspectors/` |

**Planned (not done):** a **shared tool registry** under `js/tools/` (likely evolving from `js/tools/tool-catalog.js`) to unify map tools, widgets, and workflow nodes and replace hand-maintained **`GIS_TOOL_V1_MODE`** allowlists. Widget registration stays in `js/widgets/registry.js` until that lands.

---

## Architecture at a glance

```
Left panel (react/panels/WidgetPanel.jsx)
    → getVisibleWidgets() from js/widgets/registry.js (capability filter)
    → data-app-action → APP_ACTIONS in js/tools/tool-handlers.js
    → buildWidgetActions() for visible widgets only
    → controller.js (js/widgets/<id>/)
    → openReactIsland() (js/ui/open-react-island.js)
    → mount*Dialog.jsx → *Dialog.jsx (react/widgets/)
    → engine (pure logic)

Hidden widgets: openWidget(type, ctx, options) — not panel APP_ACTIONS
Session restore: widget-state-store → restoreOpenWidget → openWidget(..., { restoreState })
```

**Typical folder layout:**

```
js/widgets/<widget-id>/
  engine.js           — pure logic (simple widgets)
  controller.js       — modal + map wiring
  …                   — complex widgets add modules (e.g. sheet-cutting, plan-set-callouts)

react/widgets/
  <Widget>Dialog.jsx
  mount<Widget>Dialog.jsx
  shared/             — WidgetPanelShell, WidgetStepWizard, RunPreviewFooter, …

js/widgets/registry.js   — SINGLE registration point (GIS_WIDGETS / GIS_WIDGETS_HIDDEN)
```

**Known exceptions in `tool-handlers.js` (prefer registry + controller over time):**

- **Project Stationing:** context menu imports `openImportStationTable`, `isProjectStationingCenterline` from widget modules.
- **Plan Set Callouts:** session bootstrap calls `hydratePlanSetCallouts`; context menu uses `plan-set-callouts/context-menu-bridge.js`.

Do **not** add new widget logic inline in `tool-handlers.js`.

---

## Shared React UX (`react/widgets/shared/`)

| Component | Role |
|-----------|------|
| **`WidgetPanelShell`** | Scroll body + footer slot. **Default footer is `RunPreviewFooter`** (Cancel + Run). |
| **`RunPreviewFooter`** | Standard Cancel / Run bar (`modal-footer`, `cancel-btn` / `apply-btn`). **Preferred for new widgets** — pass custom `runLabel` / `showRun` via shell props, or import directly when the footer is step-specific. |
| **`WidgetStepWizard`** | Step chrome. **`variant="full"`** (default): numbered step pills. **`variant="compact"`**: “Step N of M” + progress bar (used when horizontal pills would crowd). |
| **`LayerSelect`**, **`FieldSelect`**, **`CrsPicker`**, route search fields | Shared form controls |

**Current practice:** all 18 dialogs use `WidgetPanelShell`. Seven use `WidgetStepWizard` (mix of `full` and `compact`). Many multi-step dialogs still **hand-roll** `modal-footer` via the shell `footer=` prop instead of `RunPreviewFooter` — behavior works but labels/order drift. **New work:** use `RunPreviewFooter` (or shell defaults) unless Back/Next wizard navigation requires a custom footer.

**Multi-step without `WidgetStepWizard`:** Project Stationing (tabs), Sheet Cutting (phases).

Use class `gis-widget` (via `WidgetPanelShell`) for docked modal CSS.

---

## Five-phase pipeline

| Phase | Output | Gate |
|-------|--------|------|
| **0. Spec** | Inputs, steps, map interactions, output layer | Widget vs Tool decision |
| **1. Engine** | Pure modules under `js/widgets/<id>/` | Logic correct; add/update Vitest when engine changes |
| **2. Dialog** | `react/widgets/<Widget>Dialog.jsx` | Renders in modal |
| **3. Controller** | `controller.js` wires context → props | Opens from registry; accept `{ restoreState }` if persisting UI |
| **4. Register** | `GIS_WIDGETS` or `GIS_WIDGETS_HIDDEN` | Panel / `openWidget()` works |
| **5. Smoke** | Browser checklist ([`WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md)) | End-to-end on tablet+ viewport |

---

## Registry, capabilities, hidden widgets

- **`GIS_WIDGETS`** — shown in `WidgetPanel.jsx` after **`getVisibleWidgets()`** filters on **`requiredCapabilities`** (`js/platform/contracts.js`).
- **`GIS_WIDGETS_HIDDEN`** — implemented but not in the panel. **`buildWidgetActions()` only registers visible widgets** in `APP_ACTIONS`. Open hidden types via **`openWidget(type, ctx, options)`** (e.g. Sheet Cutter → Plan Set Callouts).
- **`requiredCapabilities`** — if missing on the platform, the panel hides the widget and `buildWidgetActions` shows a toast instead of opening.
- **`openWidget(type, ctx, options)`** — resolves **`ALL_GIS_WIDGETS`** (visible + hidden). Pass **`options.restoreState`** when restoring serialized wizard state.

**Session restore:** `js/widgets/widget-state-store.js` → **`restoreOpenWidget(type, ctx)`** → **`openWidget(type, ctx, { restoreState: entry.state })`**. Controllers that persist wizard UI should accept an optional second argument **`{ restoreState }`** (see sheet-cutting, plan-set-callouts, fiber-procurement-design, plan-production-export, query).

Optional registry fields: **`badge`**, **`optionalCapabilities`** (reserved).

---

## WidgetContext API

Built in **`getWidgetContext()`** (`js/tools/tool-handlers.js`); typedef in **`js/widgets/widget-types.js`**.

| Property | Purpose |
|----------|---------|
| `getLayers()`, `getLayerById(id)` | Workspace datasets |
| `getActiveLayer()` | Current active layer (runtime; extend typedef if documenting) |
| `mapService` | MapLibre facade (draw, temp features, selection) |
| `addLayer`, `createSpatialDataset` | Output layers |
| `removeLayers` | Remove layers (with confirm) |
| `showToast`, `refreshUI` | Feedback and panel refresh |
| `setActiveLayer(id)` | Focus layer in UI |
| `analyzeSchema` | Schema refresh after attribute writes |
| `openStorageManager` | OPFS / storage UI |
| `turf` | Turf.js |
| `platform`, `services` | Platform bundle (`getPlatformBundle`) |

Selection workflows: **`mapService.getSelectedIndices`**, **`setActiveLayer`**, **`refreshUI`** — not a separate `updateSelectionUI` on context.

Helper: **`getSpatialLayerOptions(ctx, opts)`** — `includeFields`, `requirePolygons`, `requireLines`, `requirePoints`, `includeSelectionCount`.

---

## Reference widgets (by complexity)

| Complexity | Widget | Folder | Why copy it |
|------------|--------|--------|-------------|
| **Simplest** | Find Features in Area | `spatial-analyzer/` | Area draw, layer select, single `engine.js` |
| **Simple** | Spatial Join | `spatial-join/` | Two-layer join, minimal UI |
| **Medium** | Bulk Update | `bulk-update/` | Selection + attributes; event bus |
| **Medium** | Proximity Join | `proximity-join/` | 3-step wizard (custom footer today) |
| **Medium** | Layer Match Assistant | `layer-match-assistant/` | Long wizard + engine tests |
| **Complex** | Route Centerline | `route-milepost-segment/` | Route search, REST-backed (mock in tests) |
| **Complex** | Sheet Cutter | `sheet-cutting/` | Many modules, `restoreState`, opens hidden callouts |
| **Most complex** | Project Stationing | `project-stationing/` | Large engine, import table sub-flow |
| **Hidden** | Plan Set Callouts | `plan-set-callouts/` | Opened from Sheet Cutter |
| **Hidden** | CRS Manager | `crs-manager/` | `GIS_WIDGETS_HIDDEN` pattern |

Re-export shims at `js/widgets/*-engine.js` are legacy import paths only.

### React dialogs (18)

| Dialog | Mount helper |
|--------|--------------|
| `SpatialAnalyzerDialog.jsx` | `mountSpatialAnalyzerDialog.jsx` |
| `BulkUpdateDialog.jsx` | `mountBulkUpdateDialog.jsx` |
| `ProximityJoinDialog.jsx` | `mountProximityJoinDialog.jsx` |
| `SpatialJoinDialog.jsx` | `mountSpatialJoinDialog.jsx` |
| `RouteMilepostSegmentDialog.jsx` | `mountRouteMilepostSegmentDialog.jsx` |
| `ProjectStationingDialog.jsx` | `mountProjectStationingDialog.jsx` |
| `LayerMatchAssistantDialog.jsx` | `mountLayerMatchAssistantDialog.jsx` |
| `SheetCuttingDialog.jsx` | `mountSheetCuttingDialog.jsx` |
| `GeoreferenceRasterDialog.jsx` | `mountGeoreferenceRasterDialog.jsx` |
| `PlanSetCalloutsDialog.jsx` | `mountPlanSetCalloutsDialog.jsx` |
| `FiberProcurementDesignDialog.jsx` | `mountFiberProcurementDesignDialog.jsx` |
| `LayerSummaryDialog.jsx` | `mountLayerSummaryDialog.jsx` |
| `QueryDialog.jsx` | `mountQueryDialog.jsx` |
| `CrsManagerDialog.jsx` | `mountCrsManagerDialog.jsx` |
| `WirelessSitePlanningDialog.jsx` | `mountWirelessSitePlanningDialog.jsx` |
| `FiberSlackOtdrHelperDialog.jsx` | `mountFiberSlackOtdrHelperDialog.jsx` |
| `PresentationLinkBuilder.jsx` | `mountPresentationLinkBuilder.jsx` |
| `PlanProductionExportDialog.jsx` | `mountPlanProductionExportDialog.jsx` |

---

## Currently registered widgets

**Visible (9):** Find Features in Area, Bulk Update, Proximity Join, Spatial Join, Route Centerline, Project Stationing, Layer Match Assistant, Sheet Cutter (Beta), Georeference Image / PDF.

**Hidden (9):** Plan Set Callouts, Fiber Procurement Design, Layer Summary, Query Features, CRS Manager, Wireless Site Planning, Fiber Slack / OTDR Helper, Presentation Link, Plan Production Export.

To re-enable a hidden widget in the panel, move its entry from **`GIS_WIDGETS_HIDDEN`** into **`GIS_WIDGETS`**.

---

## Agent workflow expectations

1. Read **this playbook**, then [`WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md), then the closest reference source.
2. Match existing patterns — one registry entry, controller owns wiring, pure engine modules.
3. Browser-check map/UI changes via `npm run dev` (viewport ≥768px; below that shows `MobileGate`).
4. **`npm test`** must stay green; add Vitest coverage when you change engine behavior.
5. Use `handleError` / `showToast` patterns from existing controllers.

### Do not

- Put **new** widget logic inline in `tool-handlers.js`
- Build a plugin framework — one folder + one registry entry is enough
- Require legacy `WidgetBase` (React-only for new widgets)
- Put MapLibre in the React render tree
- Call live external APIs from tests or agent automation

---

## Quick commands

```bash
npm install
npm run dev          # Vite (port 5174)
npm test             # full Vitest suite
npm run build        # production build
```

---

## Related docs

- [`WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md) — checklist
- [`AGENTS.md`](../AGENTS.md) — agent guide
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — local setup
