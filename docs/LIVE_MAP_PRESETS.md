# Live Map preset authoring

Add prebuilt maps by editing [`js/live-layers/catalog.js`](../js/live-layers/catalog.js).

Curated presets appear in **Import → Live Map** as card tiles. Clicking a preset opens its bookmark URL in a new browser tab. The **Create your own** card opens the custom Live Map builder in the right panel.

## Quick workflow

1. Open GIS Toolbox and configure the map (layers, basemap, 2D/3D, panels, view).
2. **Import → Live Map → Create your own** to open the custom builder.
3. Add your layer URLs, click **Use current map view** (under Advanced) if needed.
4. Click **Copy catalog entry (developer)** and paste the JSON into `LIVE_MAP_PRESETS` in `catalog.js`.
5. For reusable layer definitions, add entries to `LIVE_LAYERS` and reference them by id in the preset `layers` array.

## Catalog shapes

### `LIVE_LAYERS` entry

```javascript
{
  id: 'my-layer-id',
  name: 'Display Name',
  kind: 'arcgis-featureserver', // or arcgis-mapserver, geojson-feed, wms, wfs
  url: 'https://…',
  refreshMs: 300000,
  opacity: 0.85,
  attribution: 'Data provider'
}
```

### `LIVE_MAP_PRESETS` entry

```javascript
{
  id: 'my-preset-id',
  name: 'My Preset',
  description: 'Short description for the import card',
  icon: '🗺️', // optional — shown on the import preset card
  category: 'Reference', // optional — badge on the import card
  layers: ['my-layer-id'], // or inline { name, url } objects
  basemap: 'voyager',
  dim: '2d',
  panel: 'both',
  viewport: {
    center: [-111.5, 39.5],
    zoom: 6,
    pitch: 0,
    bearing: 0
  }
}
```

## URL parameters

| Param | Purpose |
|-------|---------|
| `?map=preset-id` | Load a catalog preset |
| `?live=layer-id,url:https%3A%2F%2F…` | Load individual live layers |
| `?view=zoom,lng,lat[,pitch,bearing]` | Camera |
| `?bounds=w,s,e,n` | Fit extent |
| `?basemap=voyager\|satellite` | Basemap |
| `?dim=2d\|3d` | Dimension |
| `?panel=both\|left\|right\|none` | Panel chrome |

## Spatial analysis

- **Vector live layers** (FeatureServer, GeoJSON): use layer context **Materialize viewport** (or `materializeServiceLayer` action) to snapshot visible features into a normal spatial layer for analysis.
- **Raster live layers** (MapServer, WMS): visual overlay only.

## Validation

Run `npm test` — `tests/live-layer-catalog.test.js` calls `validateCatalog()`.
