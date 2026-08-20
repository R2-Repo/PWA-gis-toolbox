# Live Layers catalog

Curated live service layers appear in **Import → Live Layers**. Clicking a card adds the layer (or a group of sublayers) to the current map session with catalog styling applied.

## Add a new layer

Edit [`js/live-layers/catalog.js`](../js/live-layers/catalog.js) and append to `LIVE_LAYERS`.

### Single service

```javascript
{
  id: 'my-layer-id',
  name: 'Display Name',
  description: 'Short description for the Import card.',
  icon: '🔥',
  category: 'Wildfire',
  kind: 'arcgis-featureserver',
  url: 'https://…/FeatureServer/0',
  refreshMs: 300000,
  opacity: 1,
  attribution: 'Source agency',
  style: MY_LAYER_STYLE   // optional — see live-layer-styles.js
}
```

### Composite (multiple sublayers in one folder)

```javascript
{
  id: 'wildfire-watch',
  name: 'Wildfire Watch',
  description: 'Perimeters and detections as separate layers.',
  icon: '🔥',
  category: 'Wildfire',
  subLayers: [
    {
      id: 'fire-perimeters',
      name: 'Fire Perimeters',
      kind: 'arcgis-featureserver',
      url: 'https://…/FeatureServer/0',
      style: PERIMETER_STYLE
    },
    {
      id: 'fire-detections',
      name: 'Fire Detections',
      kind: 'arcgis-featureserver',
      url: 'https://…/FeatureServer/1',
      style: FIREWATCH_STYLE
    }
  ]
}
```

Composite cards create an expandable **layer group** in the left panel (same folder UX as multi-file imports). Each sublayer is its own `type: 'service'` dataset with its own style and refresh.

### Password gate (look of security)

Optional. Clicking the card prompts for a password before layers are added. This is **not** real security — the hash ships in the client and the REST URLs stay public.

```javascript
access: {
  kind: 'password',
  hash: '<sha256-hex of the shared passphrase>'
}
```

Success is remembered for the current browser tab (`sessionStorage`). Cancel leaves the catalog picker open.

**UDOT Fiber Network** is a six-sublayer composite with this gate.

## Styling

Assign a `style` object using the same schema as the main style engine (`mode: 'smart'` with visual variables, or simple flat style). Reuse presets from [`js/live-layers/live-layer-styles.js`](../js/live-layers/live-layer-styles.js) or define new exported constants there.

Ad-hoc styling from a pasted layer URL (no catalog entry) is **Import → ArcGIS REST → Custom URL**, which reads the service `drawingInfo`. See [`docs/ARCGIS_REST_STYLING.md`](ARCGIS_REST_STYLING.md).

Paint is compiled in [`js/live-layers/live-layer-engine.js`](../js/live-layers/live-layer-engine.js) via `resolveServiceLayerStyle()` → `compilePaint()`.

Styles are **developer-authored in the catalog** (not the layer style panel).

## Runtime behavior

- Vector layers (`arcgis-featureserver`, `arcgis-mapserver-vector`, `geojson-feed`, `wfs`) query the **current map viewport**. A padded envelope is cached so zoom-in / small pans reuse data. `minZoom` hides the layer and skips the server. `refreshMs: 0` disables the idle timer.
- Features are tagged with stable `_featureIndex` values (ArcGIS `OBJECTID` when available) so selection, popups, GIS tools, and widgets can use them like normal spatial layers.
- Analysis, selection, and widget pickers are **viewport-scoped** — they operate on features currently loaded in view, not the full national feed.
- Dense viewports may be capped by map render limits; zoom in if counts look truncated.
- Raster kinds (`arcgis-mapserver`, `wms`) remain visual overlays only (not analyzable as features).
- Optional: **Materialize viewport** creates a permanent `type: 'spatial'` snapshot for offline/export workflows.

### Firewatch (Utah composite)

**Firewatch** is a special composite live layer (`kind: 'firewatch'`):

- Queries **five** public ArcGIS FeatureServers and adds **five** toggleable layers:
  1. NIFC perimeters
  2. NIFC incidents
  3. VIIRS hotspots
  4. MODIS hotspots
  5. NOAA hotspots
- Clips to **Utah ± 0.8°** (fixed AOI — not map viewport)
- Paints MapLibre layers per part (perimeter glow/fill/outline; heatmap+core per hotspot feed; flame icon + labels for incidents)
- Implementation: [`js/live-layers/firewatch/`](../js/live-layers/firewatch/)

## Validation

Run `npm test` — `tests/live-layer-catalog.test.js`, `tests/live-layer-viewport.test.js`, and `tests/firewatch-normalize.test.js` cover catalog validation, tagging, and Firewatch normalization.
