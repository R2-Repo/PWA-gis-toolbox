/**
 * Widget helpers for Phase 3 operation budgets.
 */
import {
    materializeForOperation,
    evaluateOperation,
    formatOperationBlockMessage
} from '../tools/gis-layer-context.js';

/**
 * @param {import('./widget-types.js').WidgetContext} ctx
 */
export function widgetMapApi(ctx) {
    return {
        getSelectionCount: (layerId) => ctx.mapService.getSelectionCount?.(layerId) || 0,
        getSelectedIndices: (layerId) => ctx.mapService.getSelectedIndices?.(layerId) || [],
        getSelectedFeatures: (layerId, geojson) => ctx.mapService.getSelectedFeatures?.(layerId, geojson)
    };
}

/**
 * Materialize one or more layers for a GIS widget operation.
 * @param {import('./widget-types.js').WidgetContext} ctx
 * @param {object[]} layers
 * @param {{ operation?: string, applyTo?: string }} [options]
 */
export async function materializeLayersForWidget(ctx, layers, options = {}) {
    const mapApi = widgetMapApi(ctx);
    const operation = options.operation || 'generic';
    const applyTo = options.applyTo || 'auto';
    const out = [];
    for (const layer of layers) {
        if (!layer) continue;
        const evaluation = evaluateOperation({
            operation,
            layer,
            applyTo,
            mapApi
        });
        if (!evaluation.ok) {
            throw new Error(formatOperationBlockMessage(evaluation) || evaluation.reason);
        }
        out.push(await materializeForOperation(layer, { operation, applyTo, mapApi }));
    }
    return out;
}

export default {
    widgetMapApi,
    materializeLayersForWidget
};
