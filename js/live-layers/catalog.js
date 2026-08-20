/**
 * Live layer catalog — data-only entries for Import → Live Layers.
 */
import {
    UDOT_FIBER_STYLE,
    UDOT_CONDUIT_STYLE,
    UDOT_CABINETS_STYLE,
    UDOT_BOXES_STYLE,
    UDOT_SPLICES_STYLE,
    UDOT_BUILDING_STYLE
} from '../symbology/udot-fiber/styles.js';
import { layerUrl, UDOT_FIBER_CATALOG_ID, UDOT_FIBER_MIN_ZOOM } from '../symbology/udot-fiber/constants.js';
import {
    FIREWATCH_CATALOG_ID,
    FIREWATCH_KIND,
    FIREWATCH_REFRESH_MS,
    PART_ATTRIBUTION,
    PART_URLS
} from './firewatch/constants.js';

/** @type {import('./catalog-schema.js').LiveLayerEntry[]} */
export const LIVE_LAYERS = [
    {
        id: FIREWATCH_CATALOG_ID,
        name: 'Firewatch',
        description: 'Utah wildfire perimeters, incidents, and satellite hotspots (NIFC, NASA FIRMS, NOAA).',
        icon: '🔥',
        category: 'Wildfire',
        region: 'utah',
        refreshMs: FIREWATCH_REFRESH_MS,
        opacity: 1,
        subLayers: [
            {
                id: 'firewatch-incidents',
                name: 'Firewatch Incidents',
                kind: FIREWATCH_KIND,
                url: PART_URLS.incidents,
                firewatchPart: 'incidents',
                attribution: PART_ATTRIBUTION.incidents
            },
            {
                id: 'firewatch-perimeters',
                name: 'Firewatch Perimeters',
                kind: FIREWATCH_KIND,
                url: PART_URLS.perimeters,
                firewatchPart: 'perimeters',
                attribution: PART_ATTRIBUTION.perimeters
            },
            {
                id: 'firewatch-viirs',
                name: 'VIIRS Hotspots',
                kind: FIREWATCH_KIND,
                url: PART_URLS.viirs,
                firewatchPart: 'viirs',
                attribution: PART_ATTRIBUTION.viirs
            },
            {
                id: 'firewatch-modis',
                name: 'MODIS Hotspots',
                kind: FIREWATCH_KIND,
                url: PART_URLS.modis,
                firewatchPart: 'modis',
                attribution: PART_ATTRIBUTION.modis
            },
            {
                id: 'firewatch-noaa',
                name: 'NOAA Hotspots',
                kind: FIREWATCH_KIND,
                url: PART_URLS.noaa,
                firewatchPart: 'noaa',
                attribution: PART_ATTRIBUTION.noaa
            }
        ]
    },
    {
        id: UDOT_FIBER_CATALOG_ID,
        name: 'UDOT Fiber Network',
        description: 'Cabinets, splices, boxes, fiber, conduit, and buildings. Hidden until neighborhood zoom. Password required.',
        icon: '/icons/udot-fiber-network.png',
        category: 'Utilities',
        region: 'utah',
        // SHA-256 of the shared passphrase — look of security only (hash is in the client).
        access: {
            kind: 'password',
            hash: 'e74d3f8174265b01d207cdd015ace568d99a07d3ab1602b532df0381c97e66a3'
        },
        refreshMs: 0,
        minZoom: UDOT_FIBER_MIN_ZOOM,
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
