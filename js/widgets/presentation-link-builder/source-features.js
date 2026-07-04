/**
 * Resolve presentation source features from map state, selections, highlights, and workspace storage.
 */
import { isSpatialLayer, isWorkspaceLayer } from '../../core/data-model.js';
import { iterateWorkspaceFeatures } from '../../workspace/workspace-store.js';

/**
 * @param {import('geojson').Feature} feature
 */
export function cloneFeature(feature) {
    return JSON.parse(JSON.stringify(feature));
}

/**
 * @param {import('geojson').Feature[]} features
 */
export function toFeatureCollection(features = []) {
    return {
        type: 'FeatureCollection',
        features: features.map(cloneFeature)
    };
}

/**
 * @param {object} ctx
 * @returns {object[]}
 */
export function getSpatialLayersFromContext(ctx) {
    return (ctx.getLayers?.() || []).filter((layer) => isSpatialLayer(layer));
}

/**
 * Prefer map-backed geojson (includes workspace viewport features) over app-state geojson.
 * @param {object} ctx
 * @param {object} layer
 */
export function getLayerGeojson(ctx, layer) {
    const record = ctx.mapService?.getLayerRecord?.(layer.id);
    if (record?.geojson?.features?.length) {
        return record.geojson;
    }
    if (layer.geojson?.features?.length) {
        return layer.geojson;
    }
    return layer.geojson || { type: 'FeatureCollection', features: [] };
}

/**
 * @param {object} ctx
 */
export function getHighlightedFeature(ctx) {
    return ctx.mapService?.getHighlightedFeature?.() || null;
}

/**
 * @param {import('geojson').FeatureCollection} geojson
 * @param {number[]} indices
 */
export function pickFeaturesByIndices(geojson, indices) {
    const wanted = new Set(indices);
    return (geojson?.features || []).filter((feature) => wanted.has(feature.properties?._featureIndex));
}

/**
 * @param {string} workspaceLayerId
 * @param {number[]} indices
 */
export async function loadWorkspaceFeaturesByIndices(workspaceLayerId, indices) {
    const wanted = new Set(indices);
    const found = [];
    if (!wanted.size) return found;

    let offset = 0;
    const batchSize = 1000;
    while (wanted.size > 0) {
        const batch = await iterateWorkspaceFeatures(workspaceLayerId, offset, batchSize);
        if (!batch.length) break;

        for (const feature of batch) {
            const idx = feature.properties?._featureIndex;
            if (wanted.has(idx)) {
                found.push(feature);
                wanted.delete(idx);
            }
        }

        offset += batch.length;
        if (batch.length < batchSize) break;
    }

    return found;
}

/**
 * @param {object} ctx
 * @param {object} layer
 * @param {number[]} indices
 */
export async function resolveSelectedFeaturesForLayer(ctx, layer, indices) {
    if (!indices.length) return [];

    const geojson = getLayerGeojson(ctx, layer);
    const fromMap = pickFeaturesByIndices(geojson, indices);
    if (fromMap.length === indices.length) {
        return fromMap;
    }

    const foundIndices = new Set(fromMap.map((feature) => feature.properties?._featureIndex));
    const missing = indices.filter((index) => !foundIndices.has(index));
    if (!missing.length) return fromMap;

    if (!isWorkspaceLayer(layer)) {
        return fromMap;
    }

    const workspaceLayerId = layer.workspaceLayerId || layer.id;
    const fromWorkspace = await loadWorkspaceFeaturesByIndices(workspaceLayerId, missing);
    return [...fromMap, ...fromWorkspace];
}

/**
 * @param {object} ctx
 */
export async function collectAllSelectedFeatures(ctx) {
    const layers = getSpatialLayersFromContext(ctx);
    const features = [];

    for (const layer of layers) {
        const indices = ctx.mapService?.getSelectedIndices?.(layer.id) || [];
        if (!indices.length) continue;
        const selected = await resolveSelectedFeaturesForLayer(ctx, layer, indices);
        features.push(...selected);
    }

    return features;
}

/**
 * @param {object} ctx
 * @param {'selection'|'drawn'|'active-layer-selection'|'highlighted'} sourceMode
 */
export async function collectSourceFeaturesAsync(ctx, sourceMode) {
    if (sourceMode === 'drawn') {
        const drawn = ctx.getDrawnFeature?.();
        return toFeatureCollection(drawn?.feature ? [drawn.feature] : []);
    }

    if (sourceMode === 'highlighted') {
        const highlighted = getHighlightedFeature(ctx);
        return toFeatureCollection(highlighted?.feature ? [highlighted.feature] : []);
    }

    const layers = getSpatialLayersFromContext(ctx);
    const activeLayer = ctx.getActiveLayer?.()
        || layers.find((layer) => layer.id === ctx.mapService?.getActiveLayerId?.());

    if (sourceMode === 'active-layer-selection' && activeLayer) {
        const indices = ctx.mapService?.getSelectedIndices?.(activeLayer.id) || [];
        const features = await resolveSelectedFeaturesForLayer(ctx, activeLayer, indices);
        return toFeatureCollection(features);
    }

    let features = await collectAllSelectedFeatures(ctx);

    if (!features.length) {
        const highlighted = getHighlightedFeature(ctx);
        if (highlighted?.feature) {
            features = [highlighted.feature];
        }
    }

    return toFeatureCollection(features);
}

/**
 * @param {object} ctx
 */
export function summarizeSourceContext(ctx) {
    const layers = getSpatialLayersFromContext(ctx);
    const mapLayerCount = layers.filter((layer) => ctx.mapService?.getLayerRecord?.(layer.id)).length;
    const selectedCount = ctx.mapService?.getTotalSelectionCount?.() || 0;
    const highlighted = !!getHighlightedFeature(ctx);
    const drawn = !!ctx.getDrawnFeature?.()?.feature;

    return {
        spatialLayerCount: layers.length,
        mapLayerCount,
        selectedCount,
        hasHighlightedFeature: highlighted,
        hasDrawnFeature: drawn
    };
}

/**
 * @param {object} ctx
 * @param {import('geojson').FeatureCollection} features
 */
export function summarizeResolvedSource(ctx, features) {
    const context = summarizeSourceContext(ctx);
    const featureCount = features?.features?.length || 0;
    return {
        ...context,
        featureCount,
        isEmpty: featureCount === 0
    };
}
