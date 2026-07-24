# GIS Widget Agent Playbook — gis-toolbox

> **Read this first** whenever you are adding, changing, or planning a new **GIS Widget** (left-panel multi-step wizard).
> Step-by-step checklist and anti-patterns: [`WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md).

---

## What "widget" means in this repo

In **gis-toolbox**, a "widget" is **not** an ArcGIS Experience Builder widget. It is a **multi-step GIS wizard** in the left panel:

- **Pure JS engine** (`js/widgets/<id>/engine.js`)
- **React dialog** (`react/widgets/<Widget>Dialog.jsx`)
- **Controller** (`js/widgets/<id>/controller.js` — wires map/layer callbacks)
- **Registry entry** (`js/widgets/registry.js` — makes it appear in the UI)

---

## Documentation in this repo

| Document | Path | Status | Purpose |
|----------|------|--------|---------|
| **This playbook** | [`docs/WIDGET_AGENT_PLAYBOOK.md`](WIDGET_AGENT_PLAYBOOK.md) | Present | **Start here** for widget work — architecture, references, workflow |
| **Authoring checklist** | [`docs/WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md) | Present | Step-by-step build checklist, smoke test list, anti-patterns |
| **Agent guide** | [`AGENTS.md`](../AGENTS.md) | Present | Git workflow, repo layout, links to widget docs |
| **Development / deploy** | [`docs/DEVELOPMENT.md`](DEVELOPMENT.md) | Present | Local setup, GitHub Desktop workflow, deployment |
| **Sheet cutting geometry** | [`docs/SHEET_CUTTING.md`](SHEET_CUTTING.md) | Present | **Clean sheet cutting** — canonical clipped-polygon model |
| **Human overview** | [`README.md`](../README.md) | Present | Project summary + branch workflow |

**Not in this repo yet** (do not assume these paths exist):

- `docs/ARCHITECTURE.md`, `docs/CRS_MANAGER.md`, `HANDOFF.md`
- `tests/` (Vitest engine tests — add when requested or when restoring test harness)
- `scripts/new-widget.mjs` (`npm run new:widget` is defined in `package.json` but the script file is missing)

**Cursor rules** (always applied): `.cursor/rules/project-core.mdc`, `.cursor/rules/git-workflow.mdc`, `.cursor/rules/widget-authoring.mdc`

---

## When to build a widget (vs alternatives)

| Need | Build as | Location |
|------|----------|----------|
| One input → one operation → new layer | **GIS Tool** | `js/tools/gis-tools.js` + `react/tools/` |
| Multi-step wizard, map interaction, preview, bulk edits | **GIS Widget** | `js/widgets/<id>/` + `react/widgets/` |
| Reusable step in the visual workflow graph | **Pipeline node** | `js/workflow/nodes/` + `react/workflow/inspectors/` |

---

## Architecture at a glance

```
Left panel (react/panels/WidgetPanel.jsx)
    → reads GIS_WIDGETS from js/widgets/registry.js
    → data-app-action triggers APP_ACTIONS in js/tools/tool-handlers.js
    → controller.js (js/widgets/<id>/)
    → openReactIsland() (js/ui/open-react-island.js) — docked modal
    → mount*Dialog.jsx → *Dialog.jsx (react/widgets/)
    → engine.js (pure logic)
```

**Folder layout per widget:**

```
js/widgets/<widget-id>/
  engine.js       — pure logic (no DOM, no mapService, no UI)
  controller.js   — opens modal, wires map/layer callbacks

react/widgets/
  <Widget>Dialog.jsx
  mount<Widget>Dialog.jsx
  shared/         — reusable wizard primitives

js/widgets/registry.js   — SINGLE registration point
```

**Shared infrastructure:**

| File | Role |
|------|------|
| `js/widgets/registry.js` | `GIS_WIDGETS`, `GIS_WIDGETS_HIDDEN`, `buildWidgetActions()`, `openWidget()` |
| `react/panels/WidgetPanel.jsx` | Panel buttons (reads `GIS_WIDGETS`) |
| `js/widgets/widget-context.js` | `getSpatialLayerOptions()`, `createWidgetContext()` |
| `js/widgets/map-draw-helpers.js` | `createAreaDrawHandlers()`, `createCenterlineDrawHandlers()` |
| `js/ui/open-react-island.js` | Modal host + Vite-bundled React mount |
| `js/tools/tool-handlers.js` | `getWidgetContext()`, merges `buildWidgetActions()` into `APP_ACTIONS` |
| `react/ui/DockedWidgetModal.jsx` | Single-screen: right panel dock; dual-screen: centered modal |

Controllers receive `WidgetContext` from `getWidgetContext()` in `tool-handlers.js`.

---

## Five-phase pipeline

| Phase | Output | Gate |
|-------|--------|------|
| **0. Spec** | Inputs, steps, map interactions, output layer | Widget vs Tool decision |
| **1. Engine** | `engine.js` (+ optional `tests/<id>-engine.test.js`) | Logic correct; run tests if harness exists |
| **2. Dialog** | `react/widgets/<Widget>Dialog.jsx` | Renders in modal |
| **3. Controller** | `controller.js` wires context → props | Opens from registry |
| **4. Register** | Entry in `GIS_WIDGETS` (or `GIS_WIDGETS_HIDDEN`) | Panel button works |
| **5. Smoke** | Browser checklist (see [`WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md)) | Full workflow end-to-end |

---

## Step-by-step: creating a new widget

### Step 0 — Scaffold

**Preferred (when restored):**

```bash
npm run new:widget -- --id my-widget --steps 3
```

**Today:** copy the closest reference widget folder and rename (see [Reference widgets](#reference-widgets-by-complexity)). Simplest starting point: duplicate `js/widgets/spatial-analyzer/` + `SpatialAnalyzerDialog.jsx` / `mountSpatialAnalyzerDialog.jsx`.

### Step 1 — Engine (`js/widgets/my-widget/engine.js`)

- Export **pure functions**: validation, run, constants
- **No** DOM, `mapService`, or UI imports
- Add `tests/my-widget-engine.test.js` when the test harness is available

### Step 2 — React dialog (`react/widgets/MyWidgetDialog.jsx`)

- Form state + step UI only
- Side effects via callback props: `onRun`, `onCancel`, `onDrawArea`, etc.
- Reuse `react/widgets/shared/`:

| File | Purpose |
|------|---------|
| `WidgetPanelShell.jsx` | Dialog shell + footer slot |
| `WidgetStepWizard.jsx` | Multi-step chrome |
| `RunPreviewFooter.jsx` | Run/Next/Cancel footer |
| `LayerSelect.jsx` | Layer picker |
| `FieldSelect.jsx` | Field picker |
| `CrsPicker.jsx` | CRS picker |
| `RouteSearchField.jsx`, `RouteSearchResults.jsx` | Route search (Route Centerline) |

Use class `gis-widget` (via `WidgetPanelShell`) so docked panel CSS applies.

### Step 3 — Mount helper (`react/widgets/mountMyWidgetDialog.jsx`)

```jsx
import { mountIsland } from '../mountIsland.jsx';
import { MyWidgetDialog } from './MyWidgetDialog.jsx';

export function mountMyWidgetDialog(element, props = {}) {
    return { unmount: mountIsland(element, MyWidgetDialog, props) };
}
```

### Step 4 — Controller (`js/widgets/my-widget/controller.js`)

```js
import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';

export async function openMyWidget(ctx) {
    await openReactIsland({
        title: 'My Widget',
        width: '560px',
        mountPath: '../../../react/widgets/mountMyWidgetDialog.jsx',
        mountExport: 'mountMyWidgetDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: true }),
            onCancel: close,
            onRun: async (input) => { /* ctx.mapService, ctx.getLayers, ctx.addLayer, etc. */ }
        })
    });
}
```

**Map drawing:** `js/widgets/map-draw-helpers.js`

- `createAreaDrawHandlers(ctx)` — rectangle / polygon / circle + use-layer-as-area
- `createCenterlineDrawHandlers(ctx)` — polyline centerline draw

**Reference:** `js/widgets/spatial-analyzer/controller.js` (area draw + run + results).

**Selection workflows:** use `ctx.mapService.getSelectedIndices`, `ctx.setActiveLayer`, `ctx.refreshUI` — see `js/widgets/bulk-update/controller.js`.

### Step 5 — Registry (`js/widgets/registry.js`)

```js
import { openMyWidget } from './my-widget/controller.js';

// Add to GIS_WIDGETS:
{
    type: 'my-widget',
    action: 'openMyWidget',
    label: 'My Widget',
    icon: '⚙️',
    tip: 'Short description for the panel tooltip.',
    open: openMyWidget
}
```

`WidgetPanel.jsx` and `APP_ACTIONS` update automatically.

**Hidden widgets:** add to `GIS_WIDGETS_HIDDEN` instead of `GIS_WIDGETS`. Example: **CRS Manager** (`crs-manager`) — implemented but not shown in the panel. To re-enable, move its entry into `GIS_WIDGETS`.

### Step 6 — Re-export shim (optional)

Legacy import paths only — see `js/widgets/spatial-analyzer-engine.js`.

### Step 7 — Smoke test (browser)

See checklist in [`WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md). Run `npm run dev`, tablet-or-wider viewport (mobile shows `MobileGate` only).

---

## WidgetContext API

Built in `getWidgetContext()` (`js/tools/tool-handlers.js`); types in `js/widgets/widget-types.js`.

| Property | Purpose |
|----------|---------|
| `getLayers()`, `getLayerById(id)` | Access datasets |
| `mapService` | MapLibre facade (draw, temp features, selection) |
| `addLayer`, `createSpatialDataset` | Create/add output layers |
| `showToast` | User feedback |
| `refreshUI` | Refresh panels after mutations |
| `setActiveLayer(id)` | Focus a layer in the UI |
| `analyzeSchema` | Schema refresh after attribute writes |
| `turf` | Turf.js geospatial ops |

Helper: `getSpatialLayerOptions(ctx, opts)` — layer picker options (`includeFields`, `requirePolygons`, `requireLines`, `includeSelectionCount`).

---

## Reference widgets (by complexity)

| Complexity | Widget | Folder | Why copy it |
|------------|--------|--------|-------------|
| **Simplest** | Find Features in Area | `js/widgets/spatial-analyzer/` | Area draw, layer select, basic engine |
| **Medium** | Bulk Update | `js/widgets/bulk-update/` | Selection + attribute bulk edit |
| **Medium** | Proximity Join | `js/widgets/proximity-join/` | 3-step wizard, field checklist, preview |
| **Complex** | Route Centerline | `js/widgets/route-milepost-segment/` | ArcGIS REST, route search components |
| **Most complex** | Project Stationing | `js/widgets/project-stationing/` | Large engine, table import sub-module |
| **Hidden pattern** | CRS Manager | `js/widgets/crs-manager/` | `GIS_WIDGETS_HIDDEN` only |

Re-export shims at `js/widgets/` root (`*-engine.js`) are for old import paths only.

### React dialog layer

| Dialog | Mount helper |
|--------|--------------|
| `SpatialAnalyzerDialog.jsx` | `mountSpatialAnalyzerDialog.jsx` |
| `BulkUpdateDialog.jsx` | `mountBulkUpdateDialog.jsx` |
| `ProximityJoinDialog.jsx` | `mountProximityJoinDialog.jsx` |
| `RouteMilepostSegmentDialog.jsx` | `mountRouteMilepostSegmentDialog.jsx` |
| `ProjectStationingDialog.jsx` | `mountProjectStationingDialog.jsx` |
| `CrsManagerDialog.jsx` | `mountCrsManagerDialog.jsx` |

---

## Currently registered widgets

**Visible (5):** Find Features in Area, Bulk Update, Proximity Join, Route Centerline, Project Stationing.

**Hidden (1):** CRS Manager (`crs-manager`).

---

## Agent workflow expectations

1. **Read this playbook first**, then [`WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md), then the closest reference widget source.
2. **Match existing patterns** — one folder per widget, one registry entry, controller owns wiring.
3. **Browser check** — map/UI changes need manual verification via `npm run dev`.
4. **Git** — local edits on `staging` only; user commits via GitHub Desktop (see [`AGENTS.md`](../AGENTS.md)).
5. **Errors** — use `handleError` / `showToast` patterns from existing controllers and tools.
6. **Tests** — add engine tests when the user asks or when restoring the `tests/` harness; not required for every widget by default in this repo.

### Do not

- Put widget logic inline in `tool-handlers.js` — use `controller.js`
- Build a plugin framework — one registry entry + one folder is enough
- Require legacy `WidgetBase` (React-only for new widgets)
- Put MapLibre in the React render tree

---

## Suggested reading order

1. **This playbook** — scope and file map
2. [`docs/WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md) — checklist + smoke steps
3. `js/widgets/spatial-analyzer/` — simplest end-to-end example
4. `react/widgets/shared/` — reusable UI primitives
5. `js/widgets/registry.js` — register your widget

---

## Quick commands

```bash
npm install          # once
npm run dev          # Vite dev server (port 5174)
npm run build        # production build
npm run preview      # preview build + manual smoke
npm test             # Vitest (no tests/ folder yet — will no-op or fail until restored)
```

---

## Related docs

- [`WIDGET_AUTHORING.md`](WIDGET_AUTHORING.md) — step-by-step authoring checklist
- [`AGENTS.md`](../AGENTS.md) — agent guide + git workflow
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — local setup and deployment
