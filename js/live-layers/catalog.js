/**
 * Live layer catalog — data-only entries for Import → Live Layers.
 */
import { FIREWATCH_STYLE } from './live-layer-styles.js';
import {
    UDOT_FIBER_STYLE,
    UDOT_CONDUIT_STYLE,
    UDOT_CABINETS_STYLE,
    UDOT_BOXES_STYLE,
    UDOT_SPLICES_STYLE,
    UDOT_BUILDING_STYLE
} from '../symbology/udot-fiber/styles.js';
import { layerUrl, UDOT_FIBER_CATALOG_ID } from '../symbology/udot-fiber/constants.js';

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
    },
    {
        id: UDOT_FIBER_CATALOG_ID,
        name: 'UDOT Fiber Network',
        description: 'UDOT Fiber Network MapServer with ArcGIS/Bentley style pack (vector query).',
        icon: '🧵',
        category: 'Utilities',
        region: 'utah',
        refreshMs: 300000,
        opacity: 1,
        attribution: 'UDOT',
        subLayers: [
            {
                id: 'udot-fiber-cabinets',
                name: 'UDOT Cabinets',
                kind: 'arcgis-mapserver-vector',
                url: layerUrl(0),
                style: UDOT_CABINETS_STYLE
            },
            {
                id: 'udot-fiber-splices',
                name: 'UDOT Splices',
                kind: 'arcgis-mapserver-vector',
                url: layerUrl(2),
                style: UDOT_SPLICES_STYLE
            },
            {
                id: 'udot-fiber-boxes',
                name: 'UDOT Boxes',
                kind: 'arcgis-mapserver-vector',
                url: layerUrl(4),
                style: UDOT_BOXES_STYLE
            },
            {
                id: 'udot-fiber-lines',
                name: 'UDOT Fiber',
                kind: 'arcgis-mapserver-vector',
                url: layerUrl(6),
                style: UDOT_FIBER_STYLE
            },
            {
                id: 'udot-fiber-conduit',
                name: 'UDOT Conduit',
                kind: 'arcgis-mapserver-vector',
                url: layerUrl(7),
                style: UDOT_CONDUIT_STYLE
            },
            {
                id: 'udot-fiber-building',
                name: 'UDOT Building',
                kind: 'arcgis-mapserver-vector',
                url: layerUrl(8),
                style: UDOT_BUILDING_STYLE
            }
        ]
    }
];

export default { LIVE_LAYERS };
