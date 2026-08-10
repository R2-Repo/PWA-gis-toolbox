/**
 * Resolve in-memory, workspace-backed, and live viewport layers for GIS tool operations.
 */
import {
    isSpatialLayer,
    isWorkspaceLayer,
    isLiveVectorLayer,
    isAnalyzableLayer,
    getLayerFeatureCount
} from '../core/data-model.js';
import { AppError, ErrorCategory } from '../core/error-handler.js';
import { MATERIALIZE_FEATURE_LIMIT } from '../import/import-limit-taxonomy.js';
import {
    loadAllWorkspaceFeatures,
    getWorkspaceFeaturesByIndices
} from '../workspace/workspace-store.js';
import {
    evaluateOperation,
    formatOperationBlockMessage,
    resolveWorkingSet
} from './operation-budget.js';

/**
 * Workspace layers above this cannot be fully loaded into memory for GIS
 * tools — streamed layers can exceed what the in-memory pipeline supports.
 * GeoJSON/CSV export uses the streamed path instead and is not bound by this cap.
 */
export const MAX_MATERIALIZE_FEATURES = MATERIALIZE_FEATURE_LIMIT;

/**
 * @param {object|null|undefined} layer
 * @returns {boolean}
 */
export function isGisToolLayer(layer) {
    return isAnalyzableLayer(layer);
}

/**
 * Load feature geometry for GIS tools (whole layer).
 * Workspace layers are read from IndexedDB; live services use the current viewport cache.
 * Prefer {@link materializeForOperation} when selection/viewport can shrink the set.
 * @param {object} layer
 * @returns {Promise<object|null>}
 */
export async function materializeSpatialLayer(layer) {
    if (isLiveVectorLayer(layer)) {
        return {
            ...layer,
            geojson: layer.geojson || { type: 'FeatureCollection', features: [] }
        };
    }

    if (!isSpatialLayer(layer)) return null;
    if (!isWorkspaceLayer(layer)) return layer;

    const featureCount = getLayerFeatureCount(layer);
    if (featureCount > MAX_MATERIALIZE_FEATURES) {
        throw new AppError(
            `"${layer.name}" has ${featureCount.toLocaleString()} features — too many to load into memory for this operation (limit ${MAX_MATERIALIZE_FEATURES.toLocaleString()}). Work with a selection or a smaller subset instead.`,
            ErrorCategory.OUT_OF_MEMORY,
            { layerId: layer.id, featureCount }
        );
    }

    const features = await loadAllWorkspaceFeatures(layer.workspaceLayerId || layer.id);
    return {
        ...layer,
        geojson: { type: 'FeatureCollection', features }
    };
}

/**
 * Materialize only the working set allowed for an operation (layer / selection / viewport).
 * @param {object} layer
 * @param {{
 *   operation?: string,
 *   applyTo?: 'auto'|'layer'|'selection'|'viewport',
 *   mapApi?: {
 *     getSelectionCount?: (id: string) => number,
 *     getSelectedIndices?: (id: string) => number[],
 *     getSelectedFeatures?: (id: string, geojson: object) => object|null
 *   },
 *   limitFeatures?: number
 * }} [options]
 * @returns {Promise<object|null>}
 */
export async function materializeForOperation(layer, options = {}) {
    if (!layer) return null;

    const evaluation = evaluateOperation({
        operation: options.operation || 'generic',
        layer,
        applyTo: options.applyTo || 'auto',
        mapApi: options.mapApi || {},
        limitFeatures: options.limitFeatures
    });

    if (!evaluation.ok) {
        throw new AppError(
            formatOperationBlockMessage(evaluation) || evaluation.reason,
            ErrorCategory.OUT_OF_MEMORY,
            {
                layerId: layer.id,
                evaluation
            }
        );
    }

    const { mode } = evaluation.workingSet;

    if (isLiveVectorLayer(layer)) {
        if (mode === 'selection') {
            const geojson = layer.geojson || { type: 'FeatureCollection', features: [] };
            const selected = options.mapApi?.getSelectedFeatures?.(layer.id, geojson);
            return {
                ...layer,
                geojson: selected || { type: 'FeatureCollection', features: [] },
                _operationWorkingSet: 'selection'
            };
        }
        return {
            ...layer,
            geojson: layer.geojson || { type: 'FeatureCollection', features: [] },
            _operationWorkingSet: mode
        };
    }

    if (!isSpatialLayer(layer)) return null;
    if (!isWorkspaceLayer(layer)) {
        if (mode === 'selection') {
            const geojson = layer.geojson || { type: 'FeatureCollection', features: [] };
            const selected = options.mapApi?.getSelectedFeatures?.(layer.id, geojson);
            return {
                ...layer,
                geojson: selected || { type: 'FeatureCollection', features: [] },
                _operationWorkingSet: 'selection'
            };
        }
        return { ...layer, _operationWorkingSet: mode };
    }

    const wsId = layer.workspaceLayerId || layer.id;

    if (mode === 'selection') {
        const indices = options.mapApi?.getSelectedIndices?.(layer.id) || [];
        const features = await getWorkspaceFeaturesByIndices(wsId, indices);
        return {
            ...layer,
            geojson: { type: 'FeatureCollection', features },
            _operationWorkingSet: 'selection',
            _selectionCount: features.length
        };
    }

    if (mode === 'viewport') {
        const features = Array.isArray(layer.geojson?.features) ? layer.geojson.features : [];
        return {
            ...layer,
            geojson: { type: 'FeatureCollection', features },
            _operationWorkingSet: 'viewport'
        };
    }

    const features = await loadAllWorkspaceFeatures(wsId);
    return {
        ...layer,
        geojson: { type: 'FeatureCollection', features },
        _operationWorkingSet: 'layer'
    };
}

/**
 * @param {object} layer materialized spatial layer
 * @param {'auto'|'layer'|'selection'|'viewport'} [applyTo]
 * @param {{ getSelectionCount?: (id: string) => number, getSelectedFeatures?: (id: string, geojson: object) => object|null }} mapApi
 */
export function getWorkingFeaturesFromLayer(layer, applyTo = 'auto', mapApi = {}) {
    if (!layer || !isGisToolLayer(layer)) return null;

    const geojson = layer.geojson || { type: 'FeatureCollection', features: [] };
    const totalCount = isWorkspaceLayer(layer)
        ? getLayerFeatureCount(layer)
        : (geojson.features?.length ?? 0);
    const selected = mapApi.getSelectedFeatures?.(layer.id, geojson);
    const selectionCount = selected?.features?.length ?? 0;

    if (applyTo === 'viewport' || layer._operationWorkingSet === 'viewport') {
        return {
            geojson,
            isSelection: false,
            isViewport: true,
            count: geojson.features?.length ?? 0,
            totalCount
        };
    }

    const useSelection = applyTo === 'selection'
        || (applyTo === 'auto' && (selectionCount > 0 || layer._operationWorkingSet === 'selection'));

    if (useSelection && (selectionCount > 0 || layer._operationWorkingSet === 'selection')) {
        const fc = selectionCount > 0
            ? selected
            : geojson;
        return {
            geojson: fc,
            isSelection: true,
            isViewport: false,
            count: fc?.features?.length ?? 0,
            totalCount
        };
    }

    return {
        geojson,
        isSelection: false,
        isViewport: false,
        count: geojson.features?.length ?? totalCount,
        totalCount
    };
}

/**
 * @param {object} layer
 * @param {'auto'|'layer'|'selection'|'viewport'} [applyTo]
 * @param {object} mapApi
 */
export function getWorkingDatasetFromLayer(layer, applyTo = 'auto', mapApi = {}) {
    const work = getWorkingFeaturesFromLayer(layer, applyTo, mapApi);
    if (!work) return null;
    return {
        ...layer,
        geojson: work.geojson,
        _isSelection: work.isSelection,
        _selectionCount: work.count
    };
}

export {
    evaluateOperation,
    formatOperationBlockMessage,
    resolveWorkingSet
};
