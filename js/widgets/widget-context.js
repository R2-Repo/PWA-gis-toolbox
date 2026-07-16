/**
 * Shared helpers for building widget layer options and context.
 */
import {
    isWorkspaceLayer,
    isAnalyzableLayer,
    isLiveVectorLayer,
    getLayerFeatureCount
} from '../core/data-model.js';

const DEFAULT_FIELD_SAMPLE = 200;

function layerHasLineGeometry(features, sampleSize = DEFAULT_FIELD_SAMPLE) {
    return (features || []).slice(0, sampleSize).some((feature) => {
        const type = feature?.geometry?.type;
        return type === 'LineString' || type === 'MultiLineString';
    });
}

function layerHasPointGeometry(features, sampleSize = DEFAULT_FIELD_SAMPLE) {
    return (features || []).slice(0, sampleSize).some((feature) => {
        const type = feature?.geometry?.type;
        return type === 'Point' || type === 'MultiPoint';
    });
}

function layerHasPolygonGeometry(features, sampleSize = DEFAULT_FIELD_SAMPLE) {
    return (features || []).slice(0, sampleSize).some((feature) => {
        const type = feature?.geometry?.type;
        return type === 'Polygon' || type === 'MultiPolygon';
    });
}

function collectFieldNames(features, schemaFields, sampleSize = DEFAULT_FIELD_SAMPLE) {
    if (schemaFields?.length) {
        return schemaFields.map((f) => f.name).filter(Boolean).sort();
    }
    const fields = new Set();
    (features || []).slice(0, sampleSize).forEach((feature) => {
        Object.keys(feature?.properties || {}).forEach((key) => {
            if (!key.startsWith('_')) fields.add(key);
        });
    });
    return [...fields].sort();
}

function geometryTypeAllows(layer, kind) {
    const geom = layer.schema?.geometryType;
    if (!geom) return null;
    if (kind === 'polygon') return geom === 'Polygon' || geom === 'MultiPolygon';
    if (kind === 'line') return geom === 'LineString' || geom === 'MultiLineString';
    if (kind === 'point') return geom === 'Point' || geom === 'MultiPoint';
    return null;
}

/**
 * @param {import('./widget-types.js').WidgetContext} ctx
 * @param {object} [opts]
 * @param {boolean} [opts.includeFields]
 * @param {boolean} [opts.requirePolygons]
 * @param {boolean} [opts.includeSelectionCount]
 * @returns {import('./widget-types.js').LayerOption[]}
 */
export function getSpatialLayerOptions(ctx, opts = {}) {
    const {
        includeFields = false,
        requirePolygons = false,
        requireLines = false,
        requirePoints = false,
        includeSelectionCount = false
    } = opts;
    const spatialLayers = (ctx.getLayers() || []).filter((layer) => isAnalyzableLayer(layer));

    const options = spatialLayers.map((layer) => {
        const features = layer.geojson?.features || [];
        const option = {
            id: layer.id,
            name: layer.name,
            featureCount: getLayerFeatureCount(layer)
        };

        if (requirePolygons || includeFields) {
            const fromSchema = geometryTypeAllows(layer, 'polygon');
            option.hasPolygons = fromSchema != null
                ? fromSchema
                : (!features.length && (isWorkspaceLayer(layer) || isLiveVectorLayer(layer))
                    ? true
                    : layerHasPolygonGeometry(features));
        }

        if (requireLines) {
            const fromSchema = geometryTypeAllows(layer, 'line');
            option.hasLines = fromSchema != null
                ? fromSchema
                : (!features.length && (isWorkspaceLayer(layer) || isLiveVectorLayer(layer))
                    ? true
                    : layerHasLineGeometry(features));
        }

        if (requirePoints) {
            const fromSchema = geometryTypeAllows(layer, 'point');
            option.hasPoints = fromSchema != null
                ? fromSchema
                : (!features.length && (isWorkspaceLayer(layer) || isLiveVectorLayer(layer))
                    ? true
                    : layerHasPointGeometry(features));
        }

        if (includeFields) {
            option.fields = collectFieldNames(features, layer.schema?.fields);
        }

        if (includeSelectionCount) {
            option.selectedCount = ctx.mapService.getSelectionCount?.(layer.id) || 0;
        }

        return option;
    });

    if (requireLines) {
        return options.filter((option) => option.hasLines);
    }

    if (requirePoints) {
        return options.filter((option) => option.hasPoints);
    }

    return options;
}

/**
 * @param {Partial<import('./widget-types.js').WidgetContext>} deps
 * @returns {import('./widget-types.js').WidgetContext}
 */
export function createWidgetContext(deps) {
    return /** @type {import('./widget-types.js').WidgetContext} */ (deps);
}
