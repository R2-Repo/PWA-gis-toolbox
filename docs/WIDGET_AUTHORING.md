# GIS Widget Authoring Guide

> Step-by-step checklist for building multi-step GIS widgets.
> **Agents:** read [`WIDGET_AGENT_PLAYBOOK.md`](WIDGET_AGENT_PLAYBOOK.md) **first**, then use this doc for the detailed checklist.

---

## Widget vs GIS Tool vs Pipeline Node

| Need | Build as |
|------|----------|
| One input → one geospatial operation → new layer | **GIS Tool** (`js/tools/gis-tools.js` + `react/tools/`) |
| Multi-step wizard with map interaction, preview, bulk edits | **GIS Widget** (this guide) |
| Reusable step in the visual workflow graph | **Pipeline node** (`js/workflow/nodes/`) |

---

## Architecture (one folder per widget)

```
js/widgets/<widget-id>/
  engine.js       — pure logic (Vitest first)
  controller.js   — opens modal, wires map/layer callbacks

react/widgets/
  <Widget>Dialog.jsx
  mount<Widget>Dialog.jsx
  shared/         — LayerSelect, FieldSelect, WidgetStepWizard, RunPreviewFooter

js/widgets/registry.js   — SINGLE registration point
```

Shared infrastructure:

- `js/widgets/registry.js` — `GIS_WIDGETS` array, `buildWidgetActions()`, `openWidget()`
- `react/panels/WidgetPanel.jsx` — panel buttons (reads `GIS_WIDGETS`)
- `js/widgets/widget-context.js` — `getSpatialLayerOptions()`, `createWidgetContext()`
- `js/widgets/map-draw-helpers.js` — `createAreaDrawHandlers()` for area draw workflows
- `js/ui/open-react-island.js` — modal host + dynamic React dialog mount
- `js/tools/tool-handlers.js` — merges `buildWidgetActions(getWidgetContext)` into `APP_ACTIONS`

Controllers receive `WidgetContext` from `getWidgetContext()` in `tool-handlers.js`. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full app layout.

---

## Five-phase pipeline

| Phase | Output | Gate |
|-------|--------|------|
| 0. Spec | Inputs, steps, map interactions, output layer | Widget vs Tool decision |
| 1. Engine | `engine.js` + `tests/<widget>-engine.test.js` | `npm test` green |
| 2. Dialog | `react/widgets/<Widget>Dialog.jsx` using shared primitives | Renders in modal via `mountIsland` |
| 3. Controller | `controller.js` wires context → props | Opens from registry |
| 4. Register | Entry in `GIS_WIDGETS` array | Panel + `APP_ACTIONS` work |
| 5. Smoke | Browser checklist | Full workflow end-to-end |

---

## Adding a new widget (checklist)

### 1. Scaffold (optional)

```bash
npm run new:widget -- --id my-widget --steps 3
```

### 2. Engine (`js/widgets/my-widget/engine.js`)

- Export pure functions: validation, run, constants
- No DOM, no `mapService`, no UI imports
- Add `tests/my-widget-engine.test.js`

### 3. React dialog (`react/widgets/MyWidgetDialog.jsx`)

- Form state + step UI only
- Side effects via callback props (`onRun`, `onCancel`, `onDrawArea`, …)
- Reuse `react/widgets/shared/` components where possible

### 4. Mount helper (`react/widgets/mountMyWidgetDialog.jsx`)

```jsx
import { mountIsland } from '../mountIsland.jsx';
import { MyWidgetDialog } from './MyWidgetDialog.jsx';

export function mountMyWidgetDialog(element, props = {}) {
    return { unmount: mountIsland(element, MyWidgetDialog, props) };
}
```

### 5. Controller (`js/widgets/my-widget/controller.js`)

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
            onRun: async (input) => { /* use ctx.mapService, ctx.getLayers, etc. */ }
        })
    });
}
```

### 6. Registry entry (`js/widgets/registry.js`)

```js
import { openMyWidget } from './my-widget/controller.js';

// Add to GIS_WIDGETS array:
{
    type: 'my-widget',
    action: 'openMyWidget',
    label: 'My Widget',
    icon: '⚙️',
    tip: 'Short description for the panel tooltip.',
    open: openMyWidget
}
```

That's it — `WidgetPanel` and `APP_ACTIONS` update automatically from the registry entry.

### Hidden widgets

Some widgets stay in the repo but are omitted from `GIS_WIDGETS` (panel + `APP_ACTIONS`). They live in `GIS_WIDGETS_HIDDEN` in `js/widgets/registry.js`. Example: **CRS Manager**. **Plan Set Callouts** is hidden and launched from Sheet Cutter after generate. To re-enable a hidden widget in the panel, move the entry from `GIS_WIDGETS_HIDDEN` into `GIS_WIDGETS`.

### 7. Re-export shim (optional, for old import paths)

If anything still imports from `react/tools/`, add:

```js
export { mountMyWidgetDialog } from '../widgets/mountMyWidgetDialog.jsx';
```

---

## WidgetContext (available in controllers)

Defined in `js/widgets/widget-types.js`:

- `getLayers()`, `getLayerById(id)`
- `mapService`, `addLayer`, `createSpatialDataset`
- `showToast`
- `setActiveLayer`, `updateSelectionUI` (selection workflows)
- `analyzeSchema` (schema refresh after attribute writes)
- `turf`

---

## Existing widgets

| Widget | Folder | Engine tests |
|--------|--------|--------------|
| Find Features in Area | `spatial-analyzer/` | `spatial-analyzer-engine.test.js` |
| Bulk Update | `bulk-update/` | `bulk-update-engine.test.js` |
| Route Centerline | `route-milepost-segment/` | `route-milepost-segment-engine.test.js` |
| Project Stationing | `project-stationing/` | `project-stationing-engine.test.js` |

---

## Smoke checklist (browser)

1. Open widget from left panel **GIS Widgets** section
2. Complete full workflow (all steps)
3. Verify map interactions (draw, select, preview temp features)
4. Verify output layer / attribute changes
5. Cancel mid-flow — no stuck draw mode; map selection is always-on when idle (use `mapService.getSelectedIndices`, not local selection state)
6. `npm test` still green

> **Mobile:** viewports below 768px show `MobileGate` (splash only). Widget smoke is tablet-or-wider only.

---

## What not to do

- Do not add widget logic inline in `tool-handlers.js` — use `controller.js`
- Do not skip engine tests and go straight to UI
- Do not build a plugin framework — one registry entry + one folder is enough
- Do not require legacy `WidgetBase` for new widgets (React-only)
