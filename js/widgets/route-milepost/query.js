import { UDOT_ROUTE_SEGMENT_CONFIG } from '../route-milepost-segment/config.js';
import {
    buildRouteSearchWhere,
    groupRouteSearchResults,
    mapRouteSearchRows
} from '../route-milepost-segment/engine.js';
import {
    fetchLayerMetadata,
    queryAllFeatures,
    searchRoutes
} from '../route-milepost-segment/arcgis-client.js';
import {
    buildMilepostLayerName,
    buildMilepostOutputFeatures,
    buildMilepostPreviewFeatures,
    buildMilepostQueryWhere,
    fieldConfigForSource,
    isPositiveMilepostRoute,
    milepostQueryUrls,
    outFieldsForSource,
    selectMilepostFeatures,
    validateMilepostRequest
} from './engine.js';

function defaultServices() {
    return { fetchLayerMetadata, queryAllFeatures, searchRoutes };
}

/**
 * Route search. Called only from the Search action.
 * @param {string} term
 * @param {{ searchRoutes: Function }} [services]
 */
export async function searchMilepostRoutes(term, services = defaultServices()) {
    const cleaned = String(term ?? '').trim();
    if (cleaned.length < 2) return [];

    const where = buildRouteSearchWhere(cleaned, UDOT_ROUTE_SEGMENT_CONFIG);
    if (!where || where === '1=2') return [];

    const rows = await services.searchRoutes(where, UDOT_ROUTE_SEGMENT_CONFIG);
    const positiveRows = mapRouteSearchRows(rows, UDOT_ROUTE_SEGMENT_CONFIG)
        .filter((row) => isPositiveMilepostRoute(row));
    return groupRouteSearchResults(positiveRows, UDOT_ROUTE_SEGMENT_CONFIG);
}

/**
 * Milepost query. Called only from Preview (Add as layer reuses that result).
 * @param {object} input
 * @param {{ fetchLayerMetadata: Function, queryAllFeatures: Function }} [services]
 */
export async function fetchMilepostSelection(input, services = defaultServices()) {
    const request = validateMilepostRequest(input);
    if (!request.valid) {
        throw new Error(request.errors?.[0] || 'Invalid milepost request.');
    }

    const allowed = new Set(milepostQueryUrls());
    if (!allowed.has(request.source.url)) {
        throw new Error('Refusing milepost query for an unknown layer URL.');
    }

    let metadata = null;
    if (!request.source.knownFields) {
        metadata = await services.fetchLayerMetadata(request.source.url);
    }

    const fieldConfig = fieldConfigForSource(request.source, metadata);
    const where = buildMilepostQueryWhere(request, fieldConfig);
    const outFields = outFieldsForSource(request.source, fieldConfig, metadata);
    const features = await services.queryAllFeatures(request.source.url, {
        where,
        outFields,
        returnGeometry: true,
        orderByFields: fieldConfig.milepostValueField
    });

    const selected = selectMilepostFeatures(features, request, fieldConfig);
    if (!selected.ok) {
        throw new Error(selected.error || 'No mileposts found.');
    }

    const outputFeatures = buildMilepostOutputFeatures(selected.features, request, fieldConfig);
    return {
        layerName: buildMilepostLayerName(request),
        features: outputFeatures,
        preview: {
            type: 'FeatureCollection',
            features: buildMilepostPreviewFeatures(outputFeatures)
        },
        warnings: selected.warnings || [],
        summary: {
            count: outputFeatures.length,
            sourceId: request.source.id,
            sourceLabel: request.source.label,
            mode: request.mode,
            milepost: request.mode === 'point' ? request.milepost : null,
            startMp: request.startMp ?? null,
            endMp: request.endMp ?? null
        }
    };
}
