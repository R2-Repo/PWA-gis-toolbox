/**
 * Phase 5 — working-set geometry / coordinate budgets for GIS operations.
 *
 * Feature count alone underestimates dense lines/polygons. Estimate coords for
 * the same working-set modes Phase 3 already uses (layer / selection / viewport).
 *
 * @see docs/IMPORT_LARGE_FILES.md
 * @see js/import/dataset-profile.js
 */
import { countGeometryCoordinates } from './dataset-profile.js';
import {
    MATERIALIZE_MAX_COORDS_PER_FEATURE,
    MATERIALIZE_VERTEX_LIMIT
} from './import-limit-taxonomy.js';

/**
 * @param {object|null|undefined} layer
 * @returns {{
 *   coordCount: number|null,
 *   avgCoordsPerFeature: number,
 *   maxCoordsInFeature: number,
 *   featureCount: number
 * }}
 */
export function readLayerGeometryStats(layer) {
    const profile = layer?.datasetProfile || null;
    const featureCount = Number(profile?.featureCount)
        || Number(layer?.schema?.featureCount)
        || (Array.isArray(layer?.geojson?.features) ? layer.geojson.features.length : 0)
        || 0;
    const coordCount = profile?.coordCount != null && Number.isFinite(profile.coordCount)
        ? Number(profile.coordCount)
        : null;
    const avgCoordsPerFeature = profile?.avgCoordsPerFeature != null
        && Number.isFinite(profile.avgCoordsPerFeature)
        ? Number(profile.avgCoordsPerFeature)
        : (coordCount != null && featureCount > 0 ? coordCount / featureCount : 0);
    const maxCoordsInFeature = Number(profile?.maxCoordsInFeature) || 0;
    return { coordCount, avgCoordsPerFeature, maxCoordsInFeature, featureCount };
}

/**
 * Estimate coordinates in an operation working set.
 * @param {object|null|undefined} layer
 * @param {{
 *   mode?: 'layer'|'selection'|'viewport',
 *   count?: number,
 *   totalCount?: number,
 *   selectionCount?: number,
 *   viewportCount?: number
 * }} workingSet
 * @param {{
 *   getSelectedFeatures?: (id: string, geojson: object) => object|null
 * }} [mapApi]
 * @returns {{
 *   estimatedCoords: number|null,
 *   exact: boolean,
 *   source: 'profile'|'viewport'|'selection'|'estimate'|'unknown',
 *   maxCoordsInFeature: number
 * }}
 */
export function estimateWorkingSetCoords(layer, workingSet = {}, mapApi = {}) {
    const stats = readLayerGeometryStats(layer);
    const mode = workingSet.mode || 'layer';
    const maxCoordsInFeature = stats.maxCoordsInFeature || 0;

    if (mode === 'viewport') {
        const features = Array.isArray(layer?.geojson?.features) ? layer.geojson.features : [];
        let sum = 0;
        for (const feature of features) {
            sum += countGeometryCoordinates(feature?.geometry);
        }
        return {
            estimatedCoords: sum,
            exact: true,
            source: 'viewport',
            maxCoordsInFeature
        };
    }

    if (mode === 'selection') {
        const selectionCount = workingSet.selectionCount ?? workingSet.count ?? 0;
        const geojson = layer?.geojson;
        if (geojson && typeof mapApi.getSelectedFeatures === 'function' && layer?.id) {
            try {
                const selected = mapApi.getSelectedFeatures(layer.id, geojson);
                const features = selected?.features || [];
                if (features.length) {
                    let sum = 0;
                    for (const feature of features) {
                        sum += countGeometryCoordinates(feature?.geometry);
                    }
                    return {
                        estimatedCoords: sum,
                        exact: true,
                        source: 'selection',
                        maxCoordsInFeature
                    };
                }
            } catch { /* fall through to estimate */ }
        }
        const estimated = Math.round(selectionCount * (stats.avgCoordsPerFeature || 0));
        return {
            estimatedCoords: selectionCount > 0 ? estimated : 0,
            exact: false,
            source: 'estimate',
            maxCoordsInFeature
        };
    }

    // whole layer
    if (stats.coordCount != null) {
        return {
            estimatedCoords: stats.coordCount,
            exact: true,
            source: 'profile',
            maxCoordsInFeature
        };
    }

    // In-memory spatial layers without a profile — count live geojson.
    const features = Array.isArray(layer?.geojson?.features) ? layer.geojson.features : [];
    if (features.length) {
        let sum = 0;
        for (const feature of features) {
            sum += countGeometryCoordinates(feature?.geometry);
        }
        return {
            estimatedCoords: sum,
            exact: true,
            source: 'viewport',
            maxCoordsInFeature: Math.max(maxCoordsInFeature, ...features.map(
                (f) => countGeometryCoordinates(f?.geometry)
            ), 0)
        };
    }

    return {
        estimatedCoords: null,
        exact: false,
        source: 'unknown',
        maxCoordsInFeature
    };
}

/**
 * @param {{
 *   estimatedCoords?: number|null,
 *   maxCoordsInFeature?: number,
 *   vertexLimit?: number,
 *   maxCoordsPerFeature?: number,
 *   mode?: string
 * }} input
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function evaluateGeometryBudget(input = {}) {
    const vertexLimit = input.vertexLimit ?? MATERIALIZE_VERTEX_LIMIT;
    const maxPerFeature = input.maxCoordsPerFeature ?? MATERIALIZE_MAX_COORDS_PER_FEATURE;
    const estimatedCoords = input.estimatedCoords;
    const maxCoordsInFeature = input.maxCoordsInFeature || 0;
    const mode = input.mode || 'layer';

    if (mode === 'layer' && maxCoordsInFeature > maxPerFeature) {
        return {
            ok: false,
            reason: `This layer contains a feature with ${maxCoordsInFeature.toLocaleString()} coordinates — over the ${maxPerFeature.toLocaleString()} per-feature materialize budget. Select a smaller subset or simplify the geometry first.`
        };
    }

    if (estimatedCoords != null && Number.isFinite(estimatedCoords) && estimatedCoords > vertexLimit) {
        const scope = mode === 'layer' ? 'entire layer' : mode === 'selection' ? 'selection' : 'viewport';
        return {
            ok: false,
            reason: `This ${scope} has ~${estimatedCoords.toLocaleString()} coordinates — too dense to load into memory for this operation (limit ${vertexLimit.toLocaleString()}). Select fewer features, use the current viewport, or filter first.`
        };
    }

    return { ok: true, reason: null };
}

export default {
    readLayerGeometryStats,
    estimateWorkingSetCoords,
    evaluateGeometryBudget,
    MATERIALIZE_VERTEX_LIMIT,
    MATERIALIZE_MAX_COORDS_PER_FEATURE
};
