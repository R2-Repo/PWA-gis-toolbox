import { openReactIsland } from '../../ui/open-react-island.js';
import { withActivity } from '../../ui/app-activity.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { spatialJoinPointsInPolygons } from '../../tools/gis-tools.js';
import {
    buildProducedResult,
    emitProducedResult,
    inferLayerGeometryTypes,
    sendResultToTarget
} from '../../tools/tool-result-interop.js';
import { PREDICATE_OPTIONS, validateSpatialJoinConfig } from './engine.js';
import { materializeLayersForWidget } from '../widget-operation.js';

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ initialInput?: object, restoreState?: object }} [options]
 */
export async function openSpatialJoin(ctx, options = {}) {
    const { initialInput = null } = options;

    await openReactIsland({
        title: 'Spatial Join',
        width: '520px',
        mountPath: '../../../react/widgets/mountSpatialJoinDialog.jsx',
        mountExport: 'mountSpatialJoinDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: true }),
            predicateOptions: PREDICATE_OPTIONS,
            initialInput,
            onCancel: close,
            onSendToTarget: (targetId, result) => sendResultToTarget(ctx, targetId, result),
            onLayerFocus: (layerId) => {
                if (!layerId) return;
                ctx.setActiveLayer?.(layerId);
                ctx.mapService.setActiveLayerId?.(layerId);
                ctx.refreshUI();
            },
            onRun: async (config, handlers = {}) => {
                return withActivity('Spatial join…', async () => {
                    const leftLayer = ctx.getLayers().find((layer) => layer.id === config.leftLayerId);
                    const rightLayer = ctx.getLayers().find((layer) => layer.id === config.rightLayerId);
                    const validation = validateSpatialJoinConfig({
                        leftLayer,
                        rightLayer,
                        predicate: config.predicate
                    });
                    if (validation.errors.length > 0) {
                        throw new Error(validation.errors[0]);
                    }

                    handlers.onProgress?.('Preparing layers…');
                    const [left, right] = await materializeLayersForWidget(
                        ctx,
                        [leftLayer, rightLayer],
                        { operation: 'spatial-join', applyTo: 'auto' }
                    );

                    handlers.onProgress?.('Running spatial join…');
                    const result = await spatialJoinPointsInPolygons(
                        left,
                        right,
                        config.joinFields || [],
                        config.prefix || ''
                    );
                    ctx.addLayer(result);
                    ctx.mapService.addLayer(result, ctx.getLayers().indexOf(result), { fit: true });
                    ctx.refreshUI();
                    ctx.showToast(`Spatial join complete — "${result.name}"`, 'success');

                    const geometry = inferLayerGeometryTypes(result);
                    const producedResult = buildProducedResult('spatial-join', {
                        layerIds: [result.id],
                        outputs: [{
                            name: 'out',
                            type: 'layer',
                            ...(geometry ? { geometry } : {})
                        }],
                        stats: { outCount: result.geojson?.features?.length || 0 }
                    });
                    emitProducedResult(producedResult);
                    return { featureCount: result.geojson?.features?.length || 0, producedResult };
                });
            }
        })
    });
}
