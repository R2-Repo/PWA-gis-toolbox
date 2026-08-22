/**
 * ArcGIS envelope query for Sheet Cutter Fiber snapshots.
 * Separate from live-layer refresh so PDF/live Fiber workflows stay unchanged.
 */

import { ArcGISRestImporter } from '../../arcgis/rest-importer.js';
import { RENDER_LIMITS } from '../../map/render-limits.js';
import { padEnvelope } from '../../live-layers/live-layer-cache.js';
import { buildUdotFiberExcludeWhere } from '../../symbology/udot-fiber/display-filters.js';

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
    const cleanUrl = importer.normalizeUrl(url);
    const padded = padEnvelope(envelope, 0.02);
    const geometry = {
        xmin: padded.west,
        ymin: padded.south,
        xmax: padded.east,
        ymax: padded.north,
        spatialReference: { wkid: 4326 }
    };

    const pageSize = 1000;
    const maxFeatures = RENDER_LIMITS.maxFeaturesPerSource;
    let offset = 0;
    const features = [];
    let truncated = false;

    while (features.length < maxFeatures) {
        const remaining = maxFeatures - features.length;
        const params = new URLSearchParams({
            f: 'geojson',
            where: buildUdotFiberExcludeWhere(fiberKey),
            geometry: JSON.stringify(geometry),
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            outSR: '4326',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: '*',
            returnGeometry: 'true',
            resultOffset: String(offset),
            resultRecordCount: String(Math.min(pageSize, remaining))
        });

        const resp = await fetch(`${cleanUrl}/query?${params}`);
        if (!resp.ok) throw new Error(`Fiber query failed (${resp.status})`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message || 'Fiber query error');

        const page = data.type === 'FeatureCollection' ? (data.features || []) : [];
        features.push(...page);

        const exceeded = data.exceededTransferLimit === true || data.properties?.exceededTransferLimit === true;
        if (!page.length || !exceeded) break;

        offset += page.length;
        if (features.length >= maxFeatures) {
            truncated = true;
            break;
        }
    }

    return { features, truncated };
}
