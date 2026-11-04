import ARCGIS_ENDPOINTS from '../../arcgis/endpoints.js';
import { UDOT_ROUTE_SEGMENT_CONFIG } from '../route-milepost-segment/config.js';
import {
    buildMilepostPointWhere,
    buildMilepostRangeWhere,
    buildMilepostSnapWarnings,
    formatMilepost,
    resolveMilepostPoint,
    validateMilepostRange,
    validateMilepostValue
} from '../route-milepost-segment/engine.js';

const BASE_CONFIG = UDOT_ROUTE_SEGMENT_CONFIG;

function endpointUrl(urlPart) {
    const hit = ARCGIS_ENDPOINTS.find((entry) => String(entry?.url || '').includes(urlPart));
    if (!hit?.url) {
        throw new Error(`ArcGIS endpoint not found: ${urlPart}`);
    }
    return hit.url;
}

/** LR Mile, LR Tenth Mile, and Physical Mile Post — URLs already defined in the app. */
export const MILEPOST_SOURCES = Object.freeze([
    Object.freeze({
        id: 'lr-mile',
        label: 'LR Mile',
        url: BASE_CONFIG.milepostWholeLayerUrl,
        snapLayerKey: 'whole',
        knownFields: true
    }),
    Object.freeze({
        id: 'lr-tenth',
        label: 'LR Tenth Mile',
        url: BASE_CONFIG.milepostTenthLayerUrl,
        snapLayerKey: 'tenth',
        knownFields: true
    }),
    Object.freeze({
        id: 'physical',
        label: 'Physical Mile Post',
        url: endpointUrl('Physical_Location_of_Reference_Post_RP'),
        snapLayerKey: 'whole',
        knownFields: false
    })
]);

export function getMilepostSource(id) {
    return MILEPOST_SOURCES.find((source) => source.id === id) || null;
}

export function milepostQueryUrls() {
    return MILEPOST_SOURCES.map((source) => source.url);
}

/**
 * @param {object} input
 */
export function validateMilepostRequest(input = {}) {
    const routeId = String(input.routeId ?? '').trim();
    if (!routeId) return { valid: false, errors: ['Route is required.'] };

    const source = getMilepostSource(input.sourceId);
    if (!source) return { valid: false, errors: ['Choose a milepost source.'] };

    const mode = input.mode === 'range' ? 'range' : (input.mode === 'point' ? 'point' : '');
    if (!mode) return { valid: false, errors: ['Choose a milepost point or a from/to range.'] };

    const base = {
        routeId,
        routeAlias: String(input.routeAlias ?? '').trim() || routeId,
        routeDirection: String(input.routeDirection ?? '').trim().toUpperCase(),
        source,
        mode
    };

    if (mode === 'point') {
        const point = validateMilepostValue(input.milepost);
        if (!point.valid) return { valid: false, errors: [point.error || 'Invalid milepost.'] };
        return { valid: true, errors: [], ...base, milepost: point.value };
    }

    const range = validateMilepostRange(input.startMilepost, input.endMilepost);
    if (!range.valid) return { valid: false, errors: range.errors || ['Invalid milepost range.'] };
    return {
        valid: true,
        errors: [],
        ...base,
        startMp: range.startMp,
        endMp: range.endMp,
        reversed: range.reversed
    };
}

/**
 * Map layer metadata onto the shared milepost field config.
 * Known LR layers keep the route-centerline field names when metadata is absent.
 * @param {object} source
 * @param {object} [metadata]
 * @param {typeof BASE_CONFIG} [baseConfig]
 */
export function fieldConfigForSource(source, metadata, baseConfig = BASE_CONFIG) {
    const fields = metadata?.fields;
    if (source?.knownFields && (!fields || fields.length === 0)) {
        return { ...baseConfig };
    }
    return resolveMilepostFieldConfig(metadata, baseConfig);
}

/**
 * @param {object} metadata
 * @param {typeof BASE_CONFIG} [baseConfig]
 */
export function resolveMilepostFieldConfig(metadata, baseConfig = BASE_CONFIG) {
    const fields = metadata?.fields || [];
    const routeIdField = findField(fields, [
        baseConfig.milepostRouteIdField,
        'ROUTE_ID',
        'RouteID',
        'Route_ID'
    ]) || baseConfig.milepostRouteIdField;
    const valueField = findField(fields, [
        baseConfig.milepostValueField,
        'Measure',
        'MILEPOST',
        'Milepost',
        'MILEPOINT',
        'MP'
    ]);
    if (!valueField) {
        throw new Error('Milepost layer is missing a measure field.');
    }
    const directionField = findField(fields, [
        baseConfig.milepostDirectionField,
        'RouteDir',
        'ROUTE_DIR',
        'DIRECTION'
    ]) || baseConfig.milepostDirectionField;

    return {
        ...baseConfig,
        milepostRouteIdField: routeIdField,
        milepostValueField: valueField,
        milepostDirectionField: directionField
    };
}

function findField(fields, candidates) {
    const list = fields || [];
    for (const candidate of candidates) {
        const exact = list.find((field) => field?.name === candidate || field?.alias === candidate);
        if (exact?.name) return exact.name;
    }
    const wanted = new Set(candidates.map((candidate) => String(candidate).toLowerCase()));
    const loose = list.find((field) =>
        wanted.has(String(field?.name || '').toLowerCase())
        || wanted.has(String(field?.alias || '').toLowerCase())
    );
    return loose?.name || null;
}

/**
 * @param {object} request validated request
 * @param {typeof BASE_CONFIG} fieldConfig
 */
export function buildMilepostQueryWhere(request, fieldConfig) {
    if (request.mode === 'point') {
        return buildMilepostPointWhere(
            request.routeId,
            request.milepost,
            fieldConfig,
            request.source.snapLayerKey
        );
    }
    return buildMilepostRangeWhere(
        request.routeId,
        request.startMp,
        request.endMp,
        fieldConfig,
        request.source.snapLayerKey
    );
}

export function outFieldsForSource(source, fieldConfig, metadata) {
    if (source?.knownFields) return [...BASE_CONFIG.milepostOutFields];
    const available = new Set((metadata?.fields || []).map((field) => field.name));
    if (available.size === 0) return '*';
    const names = [
        fieldConfig.milepostRouteIdField,
        fieldConfig.milepostValueField,
        fieldConfig.milepostDirectionField
    ].filter((name) => available.has(name));
    return names.length ? names : '*';
}

function isPointFeature(feature) {
    const type = feature?.geometry?.type;
    return type === 'Point' || type === 'MultiPoint';
}

function filterByDirection(features, direction, directionField) {
    if (!direction) return features;
    const hasDirection = features.some((feature) => {
        const value = feature?.properties?.[directionField];
        return value != null && String(value).trim() !== '';
    });
    if (!hasDirection) return features;
    return features.filter((feature) =>
        String(feature?.properties?.[directionField] ?? '').trim().toUpperCase() === direction
    );
}

function readMeasure(feature, valueField) {
    const measure = Number(feature?.properties?.[valueField]);
    return Number.isFinite(measure) ? measure : null;
}

/**
 * @param {import('geojson').Feature[]} features
 * @param {object} request
 * @param {typeof BASE_CONFIG} fieldConfig
 */
export function selectMilepostFeatures(features, request, fieldConfig) {
    const valueField = fieldConfig.milepostValueField;
    const points = filterByDirection(
        (features || []).filter(isPointFeature),
        request.routeDirection,
        fieldConfig.milepostDirectionField
    );

    if (request.mode === 'point') {
        const snapTolerance = request.source.snapLayerKey === 'whole'
            ? (fieldConfig.milepostWholeSnapTolerance ?? 0.51)
            : (fieldConfig.milepostSnapTolerance ?? 0.051);
        const resolved = resolveMilepostPoint(
            points,
            request.milepost,
            fieldConfig.milepostTolerance ?? 0.001,
            snapTolerance,
            valueField
        );
        if (!resolved) {
            return {
                ok: false,
                error: `No ${request.source.label} milepost found at MP ${formatMilepost(request.milepost)}.`
            };
        }
        return {
            ok: true,
            features: [resolved.point],
            warnings: buildMilepostSnapWarnings(resolved.snapped ? [resolved] : [])
        };
    }

    const tolerance = fieldConfig.milepostTolerance ?? 0.001;
    const selected = points
        .filter((feature) => {
            const measure = readMeasure(feature, valueField);
            return measure != null
                && measure >= request.startMp - tolerance
                && measure <= request.endMp + tolerance;
        })
        .sort((a, b) => readMeasure(a, valueField) - readMeasure(b, valueField));

    if (selected.length === 0) {
        return {
            ok: false,
            error: `No ${request.source.label} mileposts found between MP ${formatMilepost(request.startMp)} and ${formatMilepost(request.endMp)}.`
        };
    }

    return { ok: true, features: selected, warnings: [] };
}

/**
 * @param {import('geojson').Feature[]} features
 * @param {object} request
 * @param {typeof BASE_CONFIG} fieldConfig
 */
export function buildMilepostOutputFeatures(features, request, fieldConfig) {
    const valueField = fieldConfig.milepostValueField;
    return (features || []).map((feature) => {
        const measure = readMeasure(feature, valueField);
        return {
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...(feature.properties || {}),
                route_id: request.routeId,
                route_alias: request.routeAlias,
                milepost: measure,
                source: request.source.id,
                source_label: request.source.label
            }
        };
    });
}

export function buildMilepostPreviewFeatures(outputFeatures) {
    return (outputFeatures || []).map((feature) => ({
        ...feature,
        properties: {
            ...(feature.properties || {}),
            _preview: 'milepost'
        }
    }));
}

/**
 * @param {object} request
 */
export function buildMilepostLayerName(request) {
    const alias = request.routeAlias || 'Route';
    const sourceLabel = request.source?.label || 'Milepost';
    if (request.mode === 'point') {
        return `${alias} MP ${formatMilepost(request.milepost)} ${sourceLabel}`;
    }
    return `${alias} MP ${formatMilepost(request.startMp)} to ${formatMilepost(request.endMp)} ${sourceLabel}`;
}
