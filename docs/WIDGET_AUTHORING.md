# GIS Widget Authoring Guide

> Step-by-step checklist for building multi-step GIS widgets.
> **Agents:** read [`WIDGET_AGENT_PLAYBOOK.md`](WIDGET_AGENT_PLAYBOOK.md) **first**, then use this doc for the detailed checklist.

---

## Standing rules

Same as the playbook: **no live API/REST in tests or agent runs** (mocks/fixtures only); **`staging` only** (never `main`, never `.github/workflows/`); **rebase + green `npm test`** before push; **no force-push**.

---

## Widget vs GIS Tool vs Pipeline Node

| Need | Build as |
|------|----------|
| One input → one geospatial operation → new layer | **GIS Tool** (`js/tools/gis-tools.js` + `react/tools/`) |
| Multi-step wizard with map interaction, preview, bulk edits | **GIS Widget** (this guide) |
| Reusable step in the visual workflow graph | **Pipeline node** (`js/workflow/nodes/`) |

A **shared tool registry** lives in `js/tools/tool-registry.js` (v1). It lists map tools, widgets, and pipeline nodes with one stable id each, legacy **aliases**, per-entry **status** (`ga` | `beta` | `hidden`), **version**, typed **inputs** / **outputs** / **params**, and optional **`run`** (worker-safe compute under `js/tools/registry/compute-run-bridge.js`) or **`open`** (widgets). **`registerTool` / `getTool` / `listTools` / `isVisible`** replace hand-maintained visibility logic over time; **`tool-catalog.js`** still exports **`GIS_TOOL_V1_MODE`** and **`V1_*`** as compatibility wrappers. **`emitToolResult` / `onToolResult`** use the `result:produced` event on the core event bus. Register new widgets in `js/widgets/registry.js` as today — they are copied into the tool registry via `tool-registry-widgets.js`.

---

## Architecture (one folder per widget)

```
js/widgets/<widget-id>/
  engine.js (+ extra modules when complexity grows)
  controller.js

react/widgets/
  <Widget>Dialog.jsx
  mount<Widget>Dialog.jsx
  shared/         — WidgetPanelShell, WidgetStepWizard, RunPreviewFooter, …

js/widgets/registry.js   — SINGLE registration point
```

Shared infrastructure:

- `js/widgets/registry.js` — `GIS_WIDGETS`, `GIS_WIDGETS_HIDDEN`, `getVisibleWidgets()`, `buildWidgetActions()`, `openWidget()`
- `react/panels/WidgetPanel.jsx` — visible widgets only
- `js/widgets/widget-state-store.js` — session restore → `openWidget(..., { restoreState })`
- `js/widgets/widget-context.js` — `getSpatialLayerOptions()`, `createWidgetContext()`
- `js/widgets/map-draw-helpers.js` — area / centerline draw helpers
- `js/ui/open-react-island.js` — modal host
- `js/tools/tool-handlers.js` — `getWidgetContext()`, merges `buildWidgetActions()` (visible widgets only)

**Registry exceptions today:** project-stationing import menu and plan-set-callouts hydrate/context-menu hooks are wired from `tool-handlers.js` — do not add more bypasses.

App layout overview: [`AGENTS.md`](../AGENTS.md).

---

## Five-phase pipeline

| Phase | Output | Gate |
|-------|--------|------|
| 0. Spec | Inputs, steps, map interactions, output layer | Widget vs Tool decision |
| 1. Engine | Pure modules under `js/widgets/<id>/` | Update/add Vitest when logic changes |
| 2. Dialog | `*Dialog.jsx` using shared shell/footer | Renders via `mountIsland` |
| 3. Controller | Wires context → props; optional `{ restoreState }` | Opens from registry |
| 4. Register | `GIS_WIDGETS` or `GIS_WIDGETS_HIDDEN` | Panel and/or `openWidget()` |
| 5. Smoke | Browser checklist | Full workflow end-to-end |

---

## Shared UI conventions

- **`WidgetPanelShell`** — always use for new dialogs (`gis-widget` class).
- **`RunPreviewFooter`** — **required** for every footer (shell default or explicit `footer={<RunPreviewFooter … />}`). Order: Cancel · Back (optional) · middleActions · Preview (optional) · Run. Labels: Cancel / Close / Done; Run / Next / Preview / tool-specific primary. See playbook props table. Do not hand-roll `modal-footer`.
- **`SendToMenu` / `producedResult`** — when the wizard creates an output layer, call **`emitLayerProducedResult(widgetId, layer)`** from the controller, keep the typed **`producedResult`** in dialog state, and wire **`WidgetPanelShell`** `producedResult` + **`onSendToTarget`** → **`sendResultToTarget(ctx, targetId, result)`**. Declare **`outputs`** (and **`inputs`** if the widget consumes layers) in **`widget-registry-io.js`**.
- **`WidgetStepWizard`** — use for linear steps; pick **`variant="compact"`** when step labels need horizontal space (see Georeference, Fiber Procurement, Layer Match).

---

## Adding a new widget (checklist)

### 1. Scaffold

Copy the closest reference under `js/widgets/` and matching `react/widgets/*Dialog.jsx` + mount helper.

### 2. Engine

- Pure functions: validation, run, constants
- No DOM, `mapService`, or UI imports
- Add or extend `tests/<topic>.test.js` when you change behavior (see existing `*-engine.test.js` files)

### 3. React dialog

- Form state + step UI; side effects via props (`onRun`, `onCancel`, draw callbacks, …)
- Reuse `react/widgets/shared/`

### 4. Mount helper

```jsx
import { mountIsland } from '../mountIsland.jsx';
import { MyWidgetDialog } from './MyWidgetDialog.jsx';

export function mountMyWidgetDialog(element, props = {}) {
    return { unmount: mountIsland(element, MyWidgetDialog, props) };
}
```

### 5. Controller

```js
import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';

export async function openMyWidget(ctx, { restoreState = null, initialInput = null } = {}) {
    await openReactIsland({
        title: 'My Widget',
        width: '560px',
        mountPath: '../../../react/widgets/mountMyWidgetDialog.jsx',
        mountExport: 'mountMyWidgetDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: true }),
            initialState: restoreState,
            initialInput,
            onSendToTarget: (targetId, result) => sendResultToTarget(ctx, targetId, result),
            onCancel: close,
            onRun: async (input) => {
                /* ctx.addLayer … */
                /* emitLayerProducedResult('my-widget', outputLayer); return { producedResult }; */
            }
        })
    });
}
```

Add **`inputs` / `outputs`** for `my-widget` in **`js/widgets/widget-registry-io.js`**.

Implement **`restoreState`** only if the widget serializes open UI into `widget-state-store`.

### 6. Registry entry

```js
{
    type: 'my-widget',
    action: 'openMyWidget',
    label: 'My Widget',
    icon: '⚙️',
    tip: 'Short panel tooltip.',
    requiredCapabilities: [],  // optional; omit or [] for web
    open: openMyWidget
}
```

- **`GIS_WIDGETS`** — panel button + `APP_ACTIONS` entry (after capability filter).
- **`GIS_WIDGETS_HIDDEN`** — no panel button; open via **`openWidget('my-widget', ctx)`** from code.

### 7. Smoke test (browser)

See checklist below.

---

## WidgetContext (controllers)

From **`getWidgetContext()`** / **`widget-types.js`**:

- `getLayers()`, `getLayerById(id)`, `getActiveLayer()`
- `mapService`, `addLayer`, `createSpatialDataset`, `removeLayers`
- `showToast`, `refreshUI`, `setActiveLayer`
- `analyzeSchema`, `openStorageManager`
- `turf`, `platform`, `services`

Selection: use **`mapService.getSelectedIndices`** + **`refreshUI`** (no `updateSelectionUI` on context).

---

## Existing widgets (engine Vitest coverage)

| Widget | Folder | Example tests |
|--------|--------|----------------|
| Route Centerline | `route-milepost-segment/` | `route-milepost-segment-engine.test.js` |
| Sheet Cutter | `sheet-cutting/` | `sheet-cutting-engine.test.js` |
| Plan Set Callouts | `plan-set-callouts/` | `plan-set-callouts-engine.test.js`, … |
| Layer Match Assistant | `layer-match-assistant/` | `layer-match-assistant-engine.test.js` |
| Layer Summary | `layer-summary/` | `layer-summary-engine.test.js` |
| Georeference | `georeference-raster/` | `georeference-raster-engine.test.js` |
| Fiber Procurement | `fiber-procurement-design/` | `fiber-procurement-design-engine.test.js`, … |
| Fiber Slack / OTDR | `fiber-slack-otdr-helper/` | `fiber-slack-otdr-helper-engine.test.js` |
| Wireless Site Planning | `wireless-site-planning/` | `wireless-site-planning-engine.test.js` |

Simple widgets (spatial-analyzer, bulk-update, proximity-join, spatial-join, project-stationing, crs-manager, query) rely on integration tests elsewhere or manual smoke unless you add dedicated engine tests.

**Registered counts:** 9 visible + 9 hidden — see playbook for labels.

---

## Smoke checklist (browser)

1. Open widget from left panel **GIS Widgets** (or trigger hidden widget from its host flow)
2. Complete full workflow (all steps)
3. Verify map interactions (draw, select, preview temp features)
4. Verify output layer / attribute changes
5. Cancel mid-flow — no stuck draw mode; selection uses `mapService.getSelectedIndices` when idle
6. **`npm test`** still green

**Mobile:** viewports below 768px show `MobileGate` only — smoke on tablet or wider.

---

## What not to do

- Do not add **new** widget logic inline in `tool-handlers.js`
- Do not skip Vitest updates when changing engine behavior
- Do not build a plugin framework
- Do not require legacy `WidgetBase` (React-only)
- Do not call live external services from tests
