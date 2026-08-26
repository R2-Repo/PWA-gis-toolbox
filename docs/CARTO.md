# CARTO basemaps

GIS Toolbox uses [CARTO vector basemaps](https://docs.carto.com/faqs/carto-basemaps) for Voyager, Dark Matter, and Positron, plus street labels on **Satellite + Labels**. Esri World Imagery stays on Esri (no CARTO key).

CARTO’s older raster PNG tiles now watermark unauthenticated requests. This app uses the vector styles and an app-owned API key.

## API key

The PWA uses an app-owned **browser** key via `VITE_CARTO_API_KEY`. Users never enter or see a key. Do not add key UI to the tool guide, splash, settings, or anywhere else in the app.

Request a free key (no CARTO account) at [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey). Fair use is 5 million tile requests per calendar month. Tell CARTO the Cloudflare Pages host and that this is a public GIS PWA.

A missing key still loads vector tiles today (they are not watermarked yet). Set the key anyway so raster leftovers and a future vector key requirement do not break the map.

### Cloudflare Pages (PWA deploy)

1. Cloudflare Dashboard → **Workers & Pages** → your GIS Toolbox project
2. **Settings** → **Environment variables**
3. Add `VITE_CARTO_API_KEY` = your CARTO basemap key
4. Apply to **Production** and **Preview** (preview builds from `staging`)
5. **Redeploy** the latest deployment (or push a new commit) so the variable is baked into the Vite build

Adding the variable alone does not update an already-built deploy — Cloudflare must rebuild.

### Local setup

1. Copy `.env.example` → `.env` (or `.env.local`)
2. Set `VITE_CARTO_API_KEY=…`
3. Restart `npm run dev`

Do **not** commit real keys.

## Code map

| Path | Role |
|------|------|
| `js/map/carto-key.js` | Env key resolve + `withCartoKey` |
| `js/map/carto-style.js` | Fetch / prefix / cache CARTO style JSON |
| `js/map/basemap-catalog.js` | Voyager / Dark Matter / Positron / satellite catalog |
| `js/map/map-manager.js` | Inject vector layers under GIS data (no `setStyle`) |
