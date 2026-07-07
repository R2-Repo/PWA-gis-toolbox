/**
 * Live layer catalog — data-only entries for Import → Live Layers.
 */
import { FIREWATCH_STYLE } from './live-layer-styles.js';

/** @type {import('./catalog-schema.js').LiveLayerEntry[]} */
export const LIVE_LAYERS = [
    {
        id: 'firewatch',
        name: 'Firewatch',
        description: 'NOAA satellite fire detections sized and colored by fire intensity (FRP).',
        icon: '🔥',
        category: 'Wildfire',
        region: 'us',
        kind: 'arcgis-featureserver',
        url: 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/ArcGIS/rest/services/NOAA_Satellite_Fire_Detections_(v1)/FeatureServer/0',
        refreshMs: 300000,
        opacity: 1,
        attribution: 'NOAA',
        style: FIREWATCH_STYLE
    }
];

export default { LIVE_LAYERS };
