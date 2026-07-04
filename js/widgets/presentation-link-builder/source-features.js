/**
 * Resolve presentation source features from the live map service.
 */
import { SCENE_LIMITS, summarizeFeatures } from '../../presentation/scene-validation.js';

export { SCENE_LIMITS };

export function cloneFeature(feature) {
    return JSON.parse(JSON.stringify(feature));
}

export function toFeatureCollection(features = []) {
    return {
        type: 'FeatureCollection',
        features: features.map(cloneFeature)
    };
}

/**
 * @param {object} ctx
 */
export async function collectSourceFeaturesAsync(ctx) {
    const fromMap = await ctx.mapService?.getPresentationSourceFeatures?.();
    if (fromMap?.features?.length) {
        return toFeatureCollection(fromMap.features);
    }

    const drawn = ctx.getDrawnFeature?.();
    if (drawn?.feature?.geometry) {
        return toFeatureCollection([drawn.feature]);
    }

    return toFeatureCollection([]);
}

/**
 * @param {object} ctx
 * @param {string} [layerId]
 */
export async function collectSourceFeaturesForLayer(ctx, layerId) {
    if (layerId) {
        const layer = (ctx.getLayers?.() || []).find((entry) => entry.id === layerId);
        const selectionCount = ctx.mapService?.getSelectionCount?.(layerId) || 0;
        if (layer?.geojson && selectionCount > 0) {
            const selected = ctx.mapService.getSelectedFeatures(layerId, layer.geojson);
            if (selected?.features?.length) {
                return toFeatureCollection(selected.features);
            }
        }
    }

    return collectSourceFeaturesAsync(ctx);
}

/**
 * @param {object} validation
 */
export function buildLimitSummary(validation = {}) {
    const summary = validation.summary || {};
    return {
        featureCount: summary.featureCount ?? 0,
        maxFeatures: SCENE_LIMITS.maxFeatures,
        vertexCount: summary.vertexCount ?? 0,
        maxVertices: SCENE_LIMITS.maxVertices,
        estimatedUrlLength: validation.estimatedUrlLength ?? 0,
        maxEncodedLength: SCENE_LIMITS.maxEncodedLength,
        featuresOk: (summary.featureCount ?? 0) <= SCENE_LIMITS.maxFeatures && (summary.featureCount ?? 0) > 0,
        verticesOk: (summary.vertexCount ?? 0) <= SCENE_LIMITS.maxVertices,
        urlOk: (validation.estimatedUrlLength ?? 0) <= SCENE_LIMITS.maxEncodedLength
    };
}

/**
 * @param {object} ctx
 * @param {import('geojson').FeatureCollection} features
 * @param {object} [options]
 * @param {string} [options.layerId]
 * @param {string} [options.layerName]
 */
export function describePresentationSource(ctx, features, options = {}) {
    const featureCount = features?.features?.length || 0;
    const geometrySummary = summarizeFeatures(features);
    const anchor = ctx.mapService?.getPresentationAnchor?.();
    const layerId = options.layerId || anchor?.layerId || '';
    const layerName = options.layerName
        || (layerId ? (ctx.getLayers?.() || []).find((layer) => layer.id === layerId)?.name : '')
        || anchor?.layerName
        || '';
    const selectedCount = layerId
        ? (ctx.mapService?.getSelectionCount?.(layerId) || 0)
        : (ctx.mapService?.getTotalSelectionCount?.() || 0);
    const spatialLayerCount = (ctx.getLayers?.() || []).filter((layer) => layer.type === 'spatial').length;

    let sourceLabel = 'No features selected';
    if (featureCount > 0 && layerName) {
        sourceLabel = `${featureCount} feature${featureCount === 1 ? '' : 's'} from ${layerName}`;
    } else if (featureCount > 0) {
        sourceLabel = `${featureCount} feature${featureCount === 1 ? '' : 's'} ready`;
    } else if (selectedCount > 0) {
        sourceLabel = `${selectedCount} selected on map — add more or choose an animation`;
    } else {
        sourceLabel = 'Select features on the map or use Add on map';
    }

    return {
        featureCount,
        geometryTypes: geometrySummary.geometryTypes,
        vertexCount: geometrySummary.vertexCount,
        spatialLayerCount,
        selectedCount,
        sourceLabel,
        layerId,
        layerName,
        isEmpty: featureCount === 0
    };
}

export {
    collectSourceFeaturesAsync as collectSourceFeatures,
    describePresentationSource as summarizeResolvedSource
};
