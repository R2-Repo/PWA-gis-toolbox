/**
 * Live layer catalog — data-only entries.
 * Add new prebuilt maps by appending to LIVE_MAP_PRESETS.
 */
import { FIREWATCH_STYLE } from './live-layer-styles.js';

/** @type {import('./catalog-schema.js').LiveLayerEntry[]} */
export const LIVE_LAYERS = [
    {
        id: 'utah-counties',
        name: 'Utah County Boundaries',
        kind: 'arcgis-featureserver',
        url: 'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahCountyBoundaries/FeatureServer/0',
        refreshMs: 300000,
        opacity: 0.85,
        attribution: 'Utah AGRC'
    },
    {
        id: 'usgs-quakes-7d',
        name: 'USGS Earthquakes (7 days)',
        kind: 'geojson-feed',
        url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson',
        refreshMs: 300000,
        opacity: 1,
        attribution: 'USGS'
    },
    {
        id: 'noaa-fire-detections',
        name: 'NOAA Satellite Fire Detections',
        kind: 'arcgis-featureserver',
        url: 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/ArcGIS/rest/services/NOAA_Satellite_Fire_Detections_(v1)/FeatureServer/0',
        refreshMs: 300000,
        opacity: 1,
        attribution: 'NOAA',
        style: FIREWATCH_STYLE
    }
];

/** @type {import('./catalog-schema.js').LiveMapPreset[]} */
export const LIVE_MAP_PRESETS = [
    {
        id: 'utah-overview',
        name: 'Utah Overview',
        icon: '🏔️',
        description: 'County boundaries over the state with a bookmark-friendly default view.',
        region: 'utah',
        category: 'Reference',
        layers: ['utah-counties'],
        basemap: 'voyager',
        dim: '2d',
        panel: 'both',
        viewport: {
            center: [-111.5, 39.5],
            zoom: 6,
            pitch: 0,
            bearing: 0
        }
    },
    {
        id: 'usgs-quakes',
        name: 'USGS Recent Earthquakes',
        icon: '🌋',
        description: 'Live earthquake feed from USGS (last 7 days).',
        region: 'global',
        category: 'Hazards',
        layers: ['usgs-quakes-7d'],
        basemap: 'satellite',
        dim: '2d',
        panel: 'right',
        viewport: {
            center: [-111.09, 39.32],
            zoom: 4,
            pitch: 0,
            bearing: 0
        }
    },
    {
        id: 'firewatch',
        name: 'Firewatch',
        icon: '🔥',
        description: 'NOAA satellite fire detections sized and colored by fire intensity (FRP).',
        region: 'us',
        category: 'Wildfire',
        layers: ['noaa-fire-detections'],
        basemap: 'satellite',
        dim: '2d',
        panel: 'right',
        viewport: {
            center: [-98, 39],
            zoom: 4,
            pitch: 0,
            bearing: 0
        }
    }
];

export default { LIVE_LAYERS, LIVE_MAP_PRESETS };
