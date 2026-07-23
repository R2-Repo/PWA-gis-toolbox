# UGRC API integration

GIS Toolbox uses the [Utah Geospatial Resource Center (UGRC) API](https://api.mapserv.utah.gov/docs/) for reverse **route & milepost** lookup.

## v1 behavior

- Map right-click → **Get route & milepost**
- Calls `GET /api/v1/reverse/milepost/{lng}/{lat}` with `spatialReference=4326` and `buffer=100`
- Copies a compact label (e.g. `Route 15P · MP 299.312`) and shows a toast with offset distance when available

**Important:** This endpoint only matches **UDOT highways and state routes**. City streets and local roads usually return no match. The UI states this in the menu tooltip and in the no-match toast — we do not hard-block clicks.

This is separate from the **Route Centerline** GIS Widget, which uses public UDOT ArcGIS REST (no UGRC key).

## API keys

| Runtime | Key source |
|---------|------------|
| PWA / browser builds | App-owned **browser** key via `VITE_UGRC_API_KEY` (referrer-locked). No key popup on the PWA. |
| Desktop | User pastes a personal key in **Info → UGRC API key…** (`localStorage` key `ugrc.apiKey`) |
| Override | Saved user key (desktop) wins over the env key |

**Important:** Adding a GitHub secret does not update a site that is already deployed. Push again (or re-run **Deploy Pages**) so CI rebuilds with the secret.

Create keys at [developer.mapserv.utah.gov](https://developer.mapserv.utah.gov). See [Getting started](https://api.mapserv.utah.gov/getting-started/) for browser vs desktop key types.

### Browser key referrer patterns

Typical patterns for this app:

- Production Pages host / path (e.g. `your-org.github.io/gis-toolbox/*`)
- Staging preview (`…/gis-toolbox/staging/*`)
- Local Vite: use a **Development** browser key that allows `localhost`

### Local / CI setup

1. Copy `.env.example` → `.env` (or `.env.local`)
2. Set `VITE_UGRC_API_KEY=…`
3. For GitHub Actions Pages builds, add the same value as a repository secret and pass it into the build `env` (see workflow notes in `.env.example`)

Do **not** commit real keys.

## Code map

| Path | Role |
|------|------|
| `js/ugrc/client.js` | HTTP client + format helpers |
| `js/ugrc/keys.js` | User / env key resolve |
| `js/ugrc/lookup.js` | Toast + clipboard orchestration |
| `react/tools/UgrcKeySettingsDialog.jsx` | Settings UI |

## Roadmap (not in v1)

- County / municipality via SGID search (`boundaries.county_boundaries`, `boundaries.municipal_boundaries`)
- Coord-search marker popup action
- Reverse address geocode
- Forward route/milepost geocode
- Optional Cloudflare proxy if desktop key friction becomes painful
