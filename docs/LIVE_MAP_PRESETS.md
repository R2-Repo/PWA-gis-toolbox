# Live Layers catalog

Curated live service layers appear in **Import → Live Layers**. Clicking a card adds the layer to the current map session with catalog styling applied.

## Add a new layer

Edit [`js/live-layers/catalog.js`](../js/live-layers/catalog.js) and append to `LIVE_LAYERS`:

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

## Styling

Assign a `style` object using the same schema as the main style engine (`mode: 'smart'` with visual variables, or simple flat style). Reuse presets from [`js/live-layers/live-layer-styles.js`](../js/live-layers/live-layer-styles.js) or define new exported constants there.

Paint is compiled in [`js/live-layers/live-layer-engine.js`](../js/live-layers/live-layer-engine.js) via `resolveServiceLayerStyle()` → `compilePaint()`.

## Runtime behavior

- Layers are `type: 'service'` — they stream for the current viewport and refresh on pan/zoom.
- Styles come from the catalog (not the layer style panel).
- Use **Materialize viewport** on a service layer when you need a normal spatial copy for GIS widgets.

## Validation

Run `npm test` — `tests/live-layer-catalog.test.js` calls `validateCatalog()`.
