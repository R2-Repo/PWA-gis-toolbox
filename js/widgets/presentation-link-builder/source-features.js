/**
 * Resolve presentation source features from the live map service.
 */
import { summarizeFeatures } from '../../presentation/scene-validation.js';

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
 * @param {import('geojson').FeatureCollection} features
 */
export function describePresentationSource(ctx, features) {
    const featureCount = features?.features?.length || 0;
    const geometrySummary = summarizeFeatures(features);
    const anchor = ctx.mapService?.getPresentationAnchor?.();
    const selectedCount = ctx.mapService?.getTotalSelectionCount?.() || 0;
    const spatialLayerCount = (ctx.getLayers?.() || []).filter((layer) => layer.type === 'spatial').length;

    let sourceLabel = 'No feature yet';
    if (featureCount > 0 && anchor?.layerName) {
        sourceLabel = `${featureCount} feature${featureCount === 1 ? '' : 's'} from ${anchor.layerName}`;
    } else if (featureCount > 0) {
        sourceLabel = `${featureCount} feature${featureCount === 1 ? '' : 's'} ready`;
    } else if (selectedCount > 0) {
        sourceLabel = `${selectedCount} selected — click Pick on map if count stays zero`;
    } else {
        sourceLabel = 'Click Pick on map or select a feature first';
    }

    return {
        featureCount,
        geometryTypes: geometrySummary.geometryTypes,
        vertexCount: geometrySummary.vertexCount,
        spatialLayerCount,
        selectedCount,
        sourceLabel,
        layerName: anchor?.layerName || '',
        isEmpty: featureCount === 0
    };
}

export {
    collectSourceFeaturesAsync as collectSourceFeatures,
    describePresentationSource as summarizeResolvedSource
};
