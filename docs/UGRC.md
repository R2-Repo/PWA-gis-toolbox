# UGRC API integration

GIS Toolbox uses the [Utah Geospatial Resource Center (UGRC) API](https://api.mapserv.utah.gov/docs/) for reverse **route & milepost** lookup.

## v1 behavior

- Map right-click → **Get route & milepost**
- Projects the click from WGS84 to NAD83 UTM zone 12N (`EPSG:26912`)
- Calls `GET /api/v1/geocode/reversemilepost/{x}/{y}` with `spatialReference=26912`, `buffer=100`, `suggest=0`, `includeRampSystem=false`
- Copies a compact label (e.g. `Route 15P · MP 299.312`) and shows a toast with offset distance when available

**Important:** This endpoint only matches **UDOT highways and state routes**. City streets and local roads usually return no match. The UI states this in the menu tooltip and in the no-match toast — we do not hard-block clicks.

This is separate from the **Route Centerline** GIS Widget, which uses public UDOT ArcGIS REST (no UGRC key).

## API keys

The PWA uses an app-owned **browser** key via `VITE_UGRC_API_KEY` (referrer-locked). Users never enter or see a key. Do not add key UI to the tool guide, splash, settings, or anywhere else in the app.

Create keys at [developer.mapserv.utah.gov](https://developer.mapserv.utah.gov). See [Getting started](https://api.mapserv.utah.gov/getting-started/) for browser key setup.

### Cloudflare Pages (PWA deploy)

The public PWA is built and hosted on **Cloudflare Pages** (not GitHub Pages).

1. Cloudflare Dashboard → **Workers & Pages** → your GIS Toolbox project  
2. **Settings** → **Environment variables**  
3. Add `VITE_UGRC_API_KEY` = your UGRC browser key  
4. Apply to **Production** and **Preview** (preview builds from `staging`)  
5. **Redeploy** the latest deployment (or push a new commit) so the variable is baked into the Vite build  

Adding the variable alone does not update an already-built deploy — Cloudflare must rebuild.

### Browser key referrer patterns

Typical patterns for this app:

- Your Cloudflare Pages production hostname (e.g. `your-project.pages.dev/*` or custom domain)
- Preview hostnames if you use them
- Local Vite: use a **Development** browser key that allows `localhost`

### Local setup

1. Copy `.env.example` → `.env` (or `.env.local`)
2. Set `VITE_UGRC_API_KEY=…`
3. Restart `npm run dev`

Do **not** commit real keys.

## Code map

| Path | Role |
|------|------|
| `js/ugrc/client.js` | HTTP client + format helpers |
| `js/ugrc/keys.js` | Env key resolve |
| `js/ugrc/lookup.js` | Toast + clipboard orchestration |

## Roadmap (not in v1)

- County / municipality via SGID search (`boundaries.county_boundaries`, `boundaries.municipal_boundaries`)
- Coord-search marker popup action
- Reverse address geocode
- Forward route/milepost geocode
- Optional Cloudflare Worker proxy if key friction becomes painful
