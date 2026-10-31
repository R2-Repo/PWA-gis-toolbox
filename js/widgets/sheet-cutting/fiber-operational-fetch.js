/**
 * ArcGIS envelope query for Sheet Cutter Fiber snapshots.
 * Separate from live-layer refresh so PDF/live Fiber workflows stay unchanged.
 */

import { ArcGISRestImporter } from '../../arcgis/rest-importer.js';
import { arcgisQueryGeoJsonPages } from '../../arcgis/rest-client.js';
import { RENDER_LIMITS } from '../../map/render-limits.js';
import { padEnvelope } from '../../live-layers/live-layer-cache.js';
import { buildUdotFiberExcludeWhere } from '../../symbology/udot-fiber/display-filters.js';
import { canonicalUdotFiberLayerUrl } from '../../symbology/udot-fiber/constants.js';

/**
 * @param {string} url
 * @param {{ west: number, south: number, east: number, north: number }} envelope
 * @param {string} [fiberKey]
 * @returns {Promise<{ features: object[], truncated: boolean }>}
 */
export async function queryFiberFeaturesByEnvelope(url, envelope, fiberKey) {
    if (!url || !envelope) {
        return { features: [], truncated: false };
    }

    const importer = new ArcGISRestImporter();
    const cleanUrl = importer.normalizeUrl(canonicalUdotFiberLayerUrl(url, fiberKey));
    const padded = padEnvelope(envelope, 0.02);
    const geometry = {
        xmin: padded.west,
        ymin: padded.south,
        xmax: padded.east,
        ymax: padded.north,
        spatialReference: { wkid: 4326 }
    };

    const { features, truncated } = await arcgisQueryGeoJsonPages({
        layerUrl: cleanUrl,
        maxFeatures: RENDER_LIMITS.maxFeaturesPerSource,
        query: {
            where: buildUdotFiberExcludeWhere(fiberKey),
            geometry,
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            outSR: '4326',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: '*',
            returnGeometry: true,
            pageSize: 1000
        }
    });

    return { features, truncated };
}
