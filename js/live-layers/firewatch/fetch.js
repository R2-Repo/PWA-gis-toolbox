/**
 * Fetch Firewatch ArcGIS FeatureServer layers for the Utah AOI.
 */
import { ArcGISRestImporter } from '../../arcgis/rest-importer.js';
import logger from '../../core/logger.js';
import {
    FIREWATCH_SOURCES,
    UTAH_QUERY_ENVELOPE
} from './constants.js';
import { buildFirewatchCollections } from './normalize.js';

/**
 * @param {string} url
 * @param {string[]} outFields
 * @param {number} maxRecordCount
 * @param {object} envelope
 * @returns {Promise<object[]>}
 */
export async function queryFeatureServerEnvelope(url, outFields, maxRecordCount, envelope = UTAH_QUERY_ENVELOPE) {
    const importer = new ArcGISRestImporter();
    const cleanUrl = importer.normalizeUrl(url);
    const pageSize = Math.min(1000, maxRecordCount || 1000);
    let offset = 0;
    const features = [];

    while (features.length < maxRecordCount) {
        const remaining = maxRecordCount - features.length;
        const params = new URLSearchParams({
            f: 'geojson',
            where: '1=1',
            geometry: JSON.stringify(envelope),
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            outSR: '4326',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: Array.isArray(outFields) ? outFields.join(',') : String(outFields || '*'),
            returnGeometry: 'true',
            resultOffset: String(offset),
            resultRecordCount: String(Math.min(pageSize, remaining))
        });

        const resp = await fetch(`${cleanUrl}/query?${params}`);
        if (!resp.ok) throw new Error(`Firewatch query failed (${resp.status}) for ${cleanUrl}`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message || 'Firewatch FeatureServer query error');

        const page = data.type === 'FeatureCollection' ? (data.features || []) : [];
        features.push(...page);

        const exceeded = data.exceededTransferLimit === true || data.properties?.exceededTransferLimit === true;
        if (!page.length || !exceeded) break;
        offset += page.length;
    }

    return features.slice(0, maxRecordCount);
}

/**
 * Query all five sources and return normalized FeatureCollections.
 * @returns {Promise<{ perimeters: object, incidents: object, viirs: object, modis: object, noaa: object }>}
 */
export async function fetchFirewatchUtahCollections() {
    const byId = Object.fromEntries(FIREWATCH_SOURCES.map((s) => [s.id, s]));

    const results = await Promise.allSettled(
        FIREWATCH_SOURCES.map((src) => queryFeatureServerEnvelope(
            src.url,
            src.outFields,
            src.maxRecordCount
        ))
    );

    /** @type {Record<string, object[]>} */
    const packs = {
        perimeters: [],
        incidents: [],
        viirs: [],
        modis: [],
        noaa: []
    };

    FIREWATCH_SOURCES.forEach((src, i) => {
        const result = results[i];
        const features = result.status === 'fulfilled' ? result.value : [];
        if (result.status === 'rejected') {
            logger.warn('Firewatch', 'source failed', {
                id: src.id,
                error: result.reason?.message || String(result.reason)
            });
        }
        if (src.role === 'perimeters') packs.perimeters = features;
        else if (src.role === 'incidents') packs.incidents = features;
        else if (src.role === 'viirs') packs.viirs = features;
        else if (src.role === 'modis') packs.modis = features;
        else if (src.role === 'noaa') packs.noaa = features;
    });

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === FIREWATCH_SOURCES.length) {
        const first = results.find((r) => r.status === 'rejected');
        throw new Error(first?.reason?.message || 'All Firewatch sources failed');
    }

    return buildFirewatchCollections(packs, {
        viirsCredit: byId['viirs-hotspots']?.credit,
        modisCredit: byId['modis-hotspots']?.credit,
        noaaCredit: byId['noaa-hotspots']?.credit,
        viirsMax: byId['viirs-hotspots']?.maxRecordCount,
        modisMax: byId['modis-hotspots']?.maxRecordCount,
        noaaMax: byId['noaa-hotspots']?.maxRecordCount
    });
}
