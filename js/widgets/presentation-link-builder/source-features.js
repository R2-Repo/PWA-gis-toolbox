/**
 * Resolve presentation source features from the live map service.
 */
import { SCENE_LIMITS, summarizeFeatures } from '../../presentation/scene-validation.js';

export { SCENE_LIMITS };

export function cloneFeature(feature) {
    return JSON.parse(JSON.stringify(feature));
}

function resolveLayerGeojson(ctx, layerId, layer) {
    return ctx.mapService?.dataLayers?.get?.(layerId)?.geojson
        || layer?.geojson
        || null;
}

async function collectSelectedFeaturesForLayer(ctx, layerId, layer) {
    const indices = ctx.mapService?.getSelectedIndices?.(layerId) || [];
    if (!indices.length) return [];

    let resolvedCount = 0;
    let geojsonCount = 0;
    if (ctx.mapService?.resolveFeaturesByIndices) {
        const resolved = await ctx.mapService.resolveFeaturesByIndices(layerId, indices);
        resolvedCount = resolved.length;
        if (resolved.length) {
            // #region agent log
            fetch('http://127.0.0.1:7928/ingest/d3c9e78b-c7ff-4f7c-bb94-4a8dca6fee71',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c8639f'},body:JSON.stringify({sessionId:'c8639f',runId:'pre-fix',hypothesisId:'H-A',location:'source-features.js:collectSelectedFeaturesForLayer',message:'resolved via indices',data:{layerId,indices,resolvedCount,path:'resolveFeaturesByIndices'},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            return resolved;
        }
    }

    const geojson = resolveLayerGeojson(ctx, layerId, layer);
    if (!geojson) {
        // #region agent log
        fetch('http://127.0.0.1:7928/ingest/d3c9e78b-c7ff-4f7c-bb94-4a8dca6fee71',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c8639f'},body:JSON.stringify({sessionId:'c8639f',runId:'pre-fix',hypothesisId:'H-A',location:'source-features.js:collectSelectedFeaturesForLayer',message:'no geojson',data:{layerId,indices,resolvedCount,geojsonFeatureCount:0,path:'no-geojson'},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return [];
    }
    const selected = ctx.mapService.getSelectedFeatures(layerId, geojson);
    geojsonCount = selected?.features?.length || 0;
    // #region agent log
    fetch('http://127.0.0.1:7928/ingest/d3c9e78b-c7ff-4f7c-bb94-4a8dca6fee71',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c8639f'},body:JSON.stringify({sessionId:'c8639f',runId:'pre-fix',hypothesisId:'H-A',location:'source-features.js:collectSelectedFeaturesForLayer',message:'geojson fallback',data:{layerId,indices,resolvedCount,geojsonFeatureCount:geojson?.features?.length||0,geojsonCount,path:'getSelectedFeatures'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return selected?.features || [];
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
        if (selectionCount > 0) {
            const selectedFeatures = await collectSelectedFeaturesForLayer(ctx, layerId, layer);
            if (selectedFeatures.length) {
                return toFeatureCollection(selectedFeatures);
            }
        }
    }

    return collectSourceFeaturesAsync(ctx);
}

const PRESENTATION_LAYER_TAG = '_plLayer';

/**
 * Layer ids that currently have one or more map selections.
 * @param {object} ctx
 */
export function listLayerIdsWithSelections(ctx) {
    return (ctx.getLayers?.() || [])
        .filter((layer) => layer.type === 'spatial')
        .map((layer) => layer.id)
        .filter((layerId) => (ctx.mapService?.getSelectionCount?.(layerId) || 0) > 0);
}

/**
 * Collect selected features from every spatial layer that has a selection.
 * @param {object} ctx
 */
export async function collectAllSelectedPresentationFeatures(ctx) {
    const layerIds = listLayerIdsWithSelections(ctx);
    // #region agent log
    fetch('http://127.0.0.1:7928/ingest/d3c9e78b-c7ff-4f7c-bb94-4a8dca6fee71',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c8639f'},body:JSON.stringify({sessionId:'c8639f',runId:'pre-fix',hypothesisId:'H-E',location:'source-features.js:collectAllSelectedPresentationFeatures',message:'layer ids with selections',data:{layerIds,spatialLayerIds:(ctx.getLayers?.()||[]).filter(l=>l.type==='spatial').map(l=>l.id),totalSelectionCount:ctx.mapService?.getTotalSelectionCount?.()},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!layerIds.length) {
        return collectSourceFeaturesAsync(ctx);
    }
    return collectSourceFeaturesForLayers(ctx, layerIds);
}

/**
 * @param {object} ctx
 * @param {string[]} layerIds
 */
export async function collectSourceFeaturesForLayers(ctx, layerIds = []) {
    const ids = [...new Set((layerIds || []).filter(Boolean))];
    if (!ids.length) {
        return collectSourceFeaturesAsync(ctx);
    }

    const merged = [];
    for (const layerId of ids) {
        const layer = (ctx.getLayers?.() || []).find((entry) => entry.id === layerId);
        const selectionCount = ctx.mapService?.getSelectionCount?.(layerId) || 0;
        if (selectionCount <= 0) continue;

        const selectedFeatures = await collectSelectedFeaturesForLayer(ctx, layerId, layer);
        for (const feature of selectedFeatures) {
            merged.push({
                ...cloneFeature(feature),
                properties: {
                    ...(feature.properties || {}),
                    [PRESENTATION_LAYER_TAG]: layerId
                }
            });
        }
    }

    if (merged.length) {
        return toFeatureCollection(merged);
    }

    if (ids.length === 1) {
        return collectSourceFeaturesForLayer(ctx, ids[0]);
    }

    return toFeatureCollection([]);
}

export { PRESENTATION_LAYER_TAG };

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
    const layerIds = options.layerIds?.length
        ? options.layerIds
        : listLayerIdsWithSelections(ctx);
    const layers = ctx.getLayers?.() || [];
    const layerNames = options.layerNames?.length
        ? options.layerNames
        : layerIds.map((id) => layers.find((layer) => layer.id === id)?.name).filter(Boolean);
    const layerId = layerIds[0] || options.layerId || anchor?.layerId || '';
    const layerName = layerNames[0] || '';
    const selectedCount = ctx.mapService?.getTotalSelectionCount?.()
        || layerIds.reduce((sum, id) => sum + (ctx.mapService?.getSelectionCount?.(id) || 0), 0);
    const spatialLayerCount = layers.filter((layer) => layer.type === 'spatial').length;

    let sourceLabel = 'No features selected';
    if (featureCount > 0 && layerNames.length > 1) {
        sourceLabel = `${featureCount} feature${featureCount === 1 ? '' : 's'} from ${layerNames.length} layers`;
    } else if (featureCount > 0 && layerName) {
        sourceLabel = `${featureCount} feature${featureCount === 1 ? '' : 's'} from ${layerName}`;
    } else if (featureCount > 0) {
        sourceLabel = `${featureCount} feature${featureCount === 1 ? '' : 's'} ready`;
    } else if (selectedCount > 0) {
        sourceLabel = `${selectedCount} selected on map — choose an animation when ready`;
    } else {
        sourceLabel = 'Click features on the map or use the buttons below';
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
        layerIds,
        layerNames,
        isEmpty: featureCount === 0
    };
}

export {
    collectSourceFeaturesAsync as collectSourceFeatures,
    describePresentationSource as summarizeResolvedSource
};
