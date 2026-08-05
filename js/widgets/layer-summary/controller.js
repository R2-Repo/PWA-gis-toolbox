import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import {
    summarizeFeatureCollection,
    validateLayerGeoJson
} from './engine.js';

/**
 * Summarize a workspace layer in the browser.
 *
 * @param {import('../widget-types.js').WidgetContext} ctx
 */
export async function openLayerSummary(ctx) {
    await openReactIsland({
        title: 'Layer Summary',
        width: '520px',
        mountPath: '../../../react/widgets/mountLayerSummaryDialog.jsx',
        mountExport: 'mountLayerSummaryDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: false }),
            onCancel: close,
            onRun: async ({ layerId, onProgress }) => {
                const layer = ctx.getLayers().find((entry) => entry.id === layerId);
                if (!layer) throw new Error('Layer not found.');

                const validation = validateLayerGeoJson(layer.geojson);
                if (!validation.ok) {
                    throw new Error(validation.error);
                }

                onProgress?.({ percent: 60, stage: 'analyze', message: 'Summarizing…' });
                const summary = summarizeFeatureCollection(layer.geojson, {
                    layerName: layer.name
                });
                onProgress?.({ percent: 100, stage: 'done', message: 'Complete' });
                return {
                    ...summary,
                    layerName: layer.name
                };
            }
        })
    });
}
