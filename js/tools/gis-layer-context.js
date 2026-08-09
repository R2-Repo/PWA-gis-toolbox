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
import { MAX_IMPORT_FEATURES } from '../import/import-preflight.js';
import { loadAllWorkspaceFeatures } from '../workspace/workspace-store.js';

/**
 * Workspace layers above this cannot be fully loaded into memory for GIS
 * tools/export — streamed high-capacity layers can exceed what the in-memory
 * pipeline supports.
 */
export const MAX_MATERIALIZE_FEATURES = MAX_IMPORT_FEATURES;

/**
 * @param {object|null|undefined} layer
 * @returns {boolean}
 */
export function isGisToolLayer(layer) {
    return isAnalyzableLayer(layer);
}

/**
 * Load feature geometry for GIS tools.
 * Workspace layers are read from IndexedDB; live services use the current viewport cache.
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
 * @param {object} layer materialized spatial layer
 * @param {'auto'|'layer'|'selection'} [applyTo]
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

    const useSelection = applyTo === 'selection'
        || (applyTo === 'auto' && selectionCount > 0);

    if (useSelection && selectionCount > 0) {
        return {
            geojson: selected,
            isSelection: true,
            count: selectionCount,
            totalCount
        };
    }

    return {
        geojson,
        isSelection: false,
        count: geojson.features?.length ?? totalCount,
        totalCount
    };
}

/**
 * @param {object} layer
 * @param {'auto'|'layer'|'selection'} [applyTo]
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
