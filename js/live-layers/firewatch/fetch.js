/**
 * Fetch Firewatch ArcGIS FeatureServer layers for the Utah AOI.
 */
import { ArcGISRestImporter } from '../../arcgis/rest-importer.js';
import { arcgisQueryGeoJsonPages } from '../../arcgis/rest-client.js';
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

    const { features } = await arcgisQueryGeoJsonPages({
        layerUrl: cleanUrl,
        maxFeatures: maxRecordCount,
        query: {
            where: '1=1',
            geometry: envelope,
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            outSR: '4326',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: Array.isArray(outFields) ? outFields.join(',') : String(outFields || '*'),
            returnGeometry: true,
            pageSize: 1000
        }
    });

    return features;
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
