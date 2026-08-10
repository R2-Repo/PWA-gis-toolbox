/**
 * Phase 3 — operation capability / working-set budget.
 *
 * Import may store up to ~1M features; whole-layer GIS tools still use the
 * MATERIALIZE_FEATURE_LIMIT (250k) budget. Prefer selection or viewport when
 * the full layer is too large to load into memory.
 *
 * @see docs/IMPORT_LARGE_FILES.md
 * @see js/import/import-limit-taxonomy.js
 */
import {
    getLayerFeatureCount,
    isLiveVectorLayer
} from '../core/data-model.js';
import { MATERIALIZE_FEATURE_LIMIT } from '../import/import-limit-taxonomy.js';
import {
    getAdaptiveMaterializeLimit,
    getAdaptiveMaterializeLimits
} from '../import/import-capacity-context.js';
import {
    estimateWorkingSetCoords,
    evaluateGeometryBudget
} from '../import/geometry-budget.js';

/** @typedef {'layer'|'selection'|'viewport'} WorkingSetMode */
/** @typedef {'auto'|'layer'|'selection'|'viewport'} ApplyToMode */

/**
 * Operations that typically need full geometries in memory.
 * Used for copy hints only — budget is still the materialize limit.
 */
export const HEAVY_OPERATIONS = new Set([
    'buffer',
    'dissolve',
    'union',
    'intersect',
    'clip',
    'spatial-join',
    'proximity-join',
    'simplify',
    'smooth',
    'offset',
    'bezier',
    'summary',
    'spatial-analysis',
    'reproject',
    'generic'
]);

/**
 * Resolve which working set would be used and how large it is.
 * @param {{
 *   layer: object,
 *   applyTo?: ApplyToMode,
 *   mapApi?: {
 *     getSelectionCount?: (id: string) => number,
 *     getSelectedIndices?: (id: string) => number[]
 *   },
 *   limitFeatures?: number,
 *   projectLayers?: object[]
 * }} input
 */
export function resolveWorkingSet(input = {}) {
    const layer = input.layer;
    const applyTo = input.applyTo || 'auto';
    const mapApi = input.mapApi || {};
    const limit = input.limitFeatures
        ?? getAdaptiveMaterializeLimit(input.projectLayers || (layer ? [layer] : []));

    const totalCount = layer ? getLayerFeatureCount(layer) : 0;
    const selectionCount = layer && mapApi.getSelectionCount
        ? (mapApi.getSelectionCount(layer.id) || 0)
        : 0;
    const viewportCount = Array.isArray(layer?.geojson?.features)
        ? layer.geojson.features.length
        : 0;

    /** @type {WorkingSetMode} */
    let mode = 'layer';
    let count = totalCount;

    if (applyTo === 'selection') {
        mode = 'selection';
        count = selectionCount;
    } else if (applyTo === 'viewport') {
        mode = 'viewport';
        count = viewportCount;
    } else if (applyTo === 'layer') {
        mode = 'layer';
        count = totalCount;
    } else {
        // auto: prefer selection when present; else if layer over limit and viewport
        // is available and under limit, prefer viewport; else whole layer.
        if (selectionCount > 0) {
            mode = 'selection';
            count = selectionCount;
        } else if (totalCount > limit && viewportCount > 0 && viewportCount <= limit) {
            mode = 'viewport';
            count = viewportCount;
        } else {
            mode = 'layer';
            count = totalCount;
        }
    }

    return {
        mode,
        count,
        totalCount,
        selectionCount,
        viewportCount,
        limit,
        underLimit: count <= limit && (mode !== 'selection' || selectionCount > 0)
            && (mode !== 'viewport' || viewportCount > 0)
    };
}

/**
 * @param {{
 *   operation?: string,
 *   layer?: object|null,
 *   layers?: Array<{ layer: object, role?: string }>,
 *   applyTo?: ApplyToMode,
 *   mapApi?: object,
 *   limitFeatures?: number,
 *   projectLayers?: object[]
 * }} input
 * @returns {{
 *   ok: boolean,
 *   kind: 'OPERATION',
 *   operation: string,
 *   workingSet: ReturnType<typeof resolveWorkingSet>,
 *   limit: number,
 *   vertexLimit: number,
 *   estimatedCoords: number|null,
 *   pressures: object|null,
 *   reason: string|null,
 *   suggestions: string[]
 * }}
 */
export function evaluateOperation(input = {}) {
    const operation = input.operation || 'generic';
    const primary = input.layer
        || input.layers?.[0]?.layer
        || null;
    const projectLayers = Array.isArray(input.projectLayers) && input.projectLayers.length
        ? input.projectLayers
        : Array.isArray(input.layers)
            ? input.layers.map((entry) => entry?.layer || entry).filter(Boolean)
            : (primary ? [primary] : []);
    const adaptive = getAdaptiveMaterializeLimits(projectLayers);
    const limit = input.limitFeatures ?? adaptive.featureLimit;
    const vertexLimit = input.limitVertices ?? adaptive.vertexLimit;

    if (!primary) {
        return {
            ok: false,
            kind: 'OPERATION',
            operation,
            workingSet: {
                mode: 'layer',
                count: 0,
                totalCount: 0,
                selectionCount: 0,
                viewportCount: 0,
                limit,
                underLimit: false
            },
            limit,
            vertexLimit,
            estimatedCoords: null,
            pressures: null,
            reason: 'No layer selected for this operation.',
            suggestions: []
        };
    }

    const workingSet = resolveWorkingSet({
        layer: primary,
        applyTo: input.applyTo || 'auto',
        mapApi: input.mapApi || {},
        limitFeatures: limit,
        projectLayers
    });

    const coordEstimate = estimateWorkingSetCoords(primary, workingSet, input.mapApi || {});
    const estimatedCoords = coordEstimate.estimatedCoords;
    const pressures = primary.datasetProfile?.pressures || null;
    const suggestions = [];

    if (workingSet.mode === 'selection' && workingSet.selectionCount === 0) {
        return {
            ok: false,
            kind: 'OPERATION',
            operation,
            workingSet,
            limit,
            vertexLimit,
            estimatedCoords,
            pressures,
            reason: 'No features are selected. Select features first, or run against a smaller layer.',
            suggestions: ['selection', 'filter']
        };
    }

    if (workingSet.mode === 'viewport' && workingSet.viewportCount === 0) {
        return {
            ok: false,
            kind: 'OPERATION',
            operation,
            workingSet,
            limit,
            vertexLimit,
            estimatedCoords,
            pressures,
            reason: 'No features in the current viewport. Pan/zoom to load data, or select features.',
            suggestions: ['viewport', 'selection']
        };
    }

    if (workingSet.count > limit) {
        if (workingSet.totalCount > limit && workingSet.selectionCount === 0) {
            suggestions.push('selection');
        }
        if (workingSet.viewportCount > 0 && workingSet.viewportCount <= limit) {
            suggestions.push('viewport');
        }
        suggestions.push('filter');

        const scope = workingSet.mode === 'layer'
            ? 'entire layer'
            : workingSet.mode === 'selection'
                ? 'selection'
                : 'viewport';
        return {
            ok: false,
            kind: 'OPERATION',
            operation,
            workingSet,
            limit,
            vertexLimit,
            estimatedCoords,
            pressures,
            reason: `"${primary.name}" ${scope} has ${workingSet.count.toLocaleString()} features — too many to load into memory for this operation (limit ${limit.toLocaleString()}). Select fewer features, use the current viewport, or filter the layer first.`,
            suggestions: [...new Set(suggestions)]
        };
    }

    const geometryCheck = evaluateGeometryBudget({
        estimatedCoords,
        maxCoordsInFeature: coordEstimate.maxCoordsInFeature,
        vertexLimit,
        mode: workingSet.mode
    });
    if (!geometryCheck.ok) {
        if (workingSet.mode === 'layer' && workingSet.selectionCount === 0) {
            suggestions.push('selection');
        }
        if (workingSet.viewportCount > 0) {
            suggestions.push('viewport');
        }
        suggestions.push('filter');
        return {
            ok: false,
            kind: 'OPERATION',
            operation,
            workingSet,
            limit,
            vertexLimit,
            estimatedCoords,
            pressures,
            reason: geometryCheck.reason,
            suggestions: [...new Set(suggestions)]
        };
    }

    // Multi-layer ops: also check additional layers when applyTo is layer/auto whole-layer.
    if (Array.isArray(input.layers) && input.layers.length > 1
        && (input.applyTo === 'layer' || (input.applyTo || 'auto') === 'auto' && workingSet.mode === 'layer')) {
        for (const entry of input.layers.slice(1)) {
            const other = entry?.layer;
            if (!other) continue;
            const otherCount = getLayerFeatureCount(other);
            if (otherCount > limit) {
                return {
                    ok: false,
                    kind: 'OPERATION',
                    operation,
                    workingSet,
                    limit,
                    vertexLimit,
                    estimatedCoords,
                    pressures: other.datasetProfile?.pressures || pressures,
                    reason: `"${other.name}" has ${otherCount.toLocaleString()} features — too many to load into memory for this operation (limit ${limit.toLocaleString()}). Use a smaller layer or filter first.`,
                    suggestions: ['filter', 'selection']
                };
            }
            const otherCoords = estimateWorkingSetCoords(other, {
                mode: 'layer',
                count: otherCount,
                totalCount: otherCount
            });
            const otherGeom = evaluateGeometryBudget({
                estimatedCoords: otherCoords.estimatedCoords,
                maxCoordsInFeature: otherCoords.maxCoordsInFeature,
                vertexLimit,
                mode: 'layer'
            });
            if (!otherGeom.ok) {
                return {
                    ok: false,
                    kind: 'OPERATION',
                    operation,
                    workingSet,
                    limit,
                    vertexLimit,
                    estimatedCoords: otherCoords.estimatedCoords,
                    pressures: other.datasetProfile?.pressures || pressures,
                    reason: otherGeom.reason,
                    suggestions: ['filter', 'selection']
                };
            }
        }
    }

    return {
        ok: true,
        kind: 'OPERATION',
        operation,
        workingSet,
        limit,
        vertexLimit,
        estimatedCoords,
        pressures,
        reason: null,
        suggestions: []
    };
}

/**
 * User-facing copy for a failed evaluation.
 * @param {ReturnType<typeof evaluateOperation>} evaluation
 */
export function formatOperationBlockMessage(evaluation) {
    if (!evaluation || evaluation.ok) return null;
    const tips = [];
    if (evaluation.suggestions?.includes('selection')) {
        tips.push('select features');
    }
    if (evaluation.suggestions?.includes('viewport')) {
        tips.push('limit to the current map view');
    }
    if (evaluation.suggestions?.includes('filter')) {
        tips.push('filter to a smaller subset');
    }
    const tipText = tips.length ? ` Try to ${tips.join(', or ')}.` : '';
    return `${evaluation.reason || 'This operation cannot run on the current working set.'}${tipText}`;
}

/**
 * Whether a layer needs a bounded working set for whole-layer tools.
 * @param {object|null|undefined} layer
 * @param {number} [limit]
 */
export function layerNeedsWorkingSet(layer, limit = null, projectLayers = null) {
    if (!layer) return false;
    if (isLiveVectorLayer(layer)) return false;
    const cap = limit ?? getAdaptiveMaterializeLimit(projectLayers || [layer]);
    return getLayerFeatureCount(layer) > cap;
}

export default {
    HEAVY_OPERATIONS,
    resolveWorkingSet,
    evaluateOperation,
    formatOperationBlockMessage,
    layerNeedsWorkingSet,
    MATERIALIZE_FEATURE_LIMIT
};
