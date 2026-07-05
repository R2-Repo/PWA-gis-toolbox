# Presentation Link — adding animations

The Presentation Link widget uses a **single registry** so new animations do not require hunting through four files.

## Architecture

| Layer | File | Role |
|-------|------|------|
| Registry | `js/presentation/presentation-link-animations.js` | Widget options, UI config, camera strategy, step builder |
| Engine preset | `js/presentation/animation-presets.js` | Full catalog (widget + advanced); geometry `requires` |
| Playback handler | `js/presentation/presentation-animation-handlers.js` | Maps step `type` → `PresentationAnimationEngine` method |
| Runtime | `js/presentation/animation-engine.js` | Camera math + `_flyToFeature`, `_rotateAroundFeature`, etc. |
| Widget scene | `js/widgets/presentation-link-builder/engine.js` | `buildSceneFromConfig` delegates to registry |
| Widget UI | `react/widgets/PresentationLinkBuilder.jsx` | Reads `listLinkAnimations()` — no hardcoded preset IDs |

## Checklist: add a widget animation

### 1. Engine preset (if new type)

In `js/presentation/animation-presets.js`, add an entry to `ANIMATION_PRESETS` with `id`, `label`, `requires`, and defaults.

### 2. Playback handler

In `js/presentation/presentation-animation-handlers.js`, register the type:

```js
myNewAnimation: '_myNewAnimation',
```

Implement `_myNewAnimation(step)` on `PresentationAnimationEngine` in `animation-engine.js`.

### 3. Widget registry entry

In `js/presentation/presentation-link-animations.js`, add one object to `LINK_ANIMATIONS`:

```js
{
    id: 'myNewAnimation',           // must match preset + handler
    label: 'My new animation',
    usageHint: 'User-facing help text…',
    requires: ['any'],              // mirrors preset
    cameraStrategy: 'saved',        // 'fit' | 'saved' | 'overview'
    animated: true,
    ui: {
        showDuration: true,
        durationLabel: 'Duration (seconds)',
        defaultDurationMs: 12000,
        showPace: false             // optional pace dropdown
    },
    resolveDurationMs: (animation) => animation.durationMs ?? 12000,
    extendStepOptions(stepOptions, animation) {
        // optional: add fields to step.options
        return { ...stepOptions, customFlag: true };
    }
}
```

**Camera strategies**

- `fit` — open framed on feature (`fitToFeatures: true`)
- `saved` — use builder viewport as-is (orbit-only behavior)
- `overview` — wide top-down start before fly-in (fly-to / combo)

### 4. Tests

- Scene builder: add a case in `tests/presentation-link-builder.test.js` for camera + step shape.
- Registry: `tests/presentation-link-animations.test.js` verifies every link animation has a preset and handler.

No changes needed in `PresentationLinkBuilder.jsx` or `buildSceneFromConfig` if you only extend the registry.

## Advanced-only animations

Presets that should **not** appear in the widget (e.g. `flyAlongPath`) belong only in `animation-presets.js` + `presentation-animation-handlers.js`. Do not add them to `LINK_ANIMATIONS`.

## Pace presets

For animations with a pace dropdown, set `ui.showPace: true`, `ui.pacePresetsMs`, and `ui.paceOptionLabels`. The React UI reads these automatically.

Combined timelines (fly + orbit) can use `extendStepOptions` + `resolveDurationMs` — see `flyToFeatureThenOrbit` in the registry.

## Custom sequences

Users can switch to **Custom sequence** in the widget to build an ordered list (max 5 steps) with per-step durations and optional **Hold** rows.

- Authoring state: `animation.mode = 'sequence'` + `animation.steps[]`
- Compilation: `js/presentation/presentation-sequence-compiler.js` merges fly+orbit into the cinematic combo handler
- Scene stores `metadata.authoring` for round-trip editing
- Sequence step options: `listSequenceStepOptions()` (includes hold)

## Orbit GIF removed

The legacy print-menu orbit GIF was removed. Capture helpers remain in `js/map/map-export.js` for presentation export.

## Share & export (widget)

Export profiles live in `js/presentation/presentation-export-profiles.js`. Capture and file output in `presentation-capture.js` and `presentation-export.js`.

| Export | Profile limits |
|--------|----------------|
| URL / Embed | Same as scene limits (interactive) |
| GIF | ≤3 steps, ≤20s, 1280px wide |
| Video (WebM/MP4) | ≤5 steps, ≤60s, 1920px wide |
| Poster PNG | Final frame after playback |

GIF and video record by playing `PresentationAnimationEngine` — same motion as Preview.
