import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import {
    providerLabel,
    summarizeFeatureCollection,
    validateLayerGeoJson
} from './engine.js';

/**
 * Shared widget: summarize a workspace layer.
 * Uses JavaScript by default; optionally accelerates large in-memory layers via Python.
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

                const provider = 'javascript';

                onProgress?.({
                    percent: 5,
                    stage: 'provider',
                    message: `Using ${providerLabel(provider)}`
                });

                onProgress?.({ percent: 60, stage: 'analyze', message: 'Summarizing in JavaScript' });
                const summary = summarizeFeatureCollection(layer.geojson, {
                    layerName: layer.name
                });
                onProgress?.({ percent: 100, stage: 'done', message: 'Complete' });
                return {
                    ...summary,
                    provider,
                    providerLabel: providerLabel(provider),
                    layerName: layer.name
                };
            }
        })
    });
}
