import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { spatialJoinPointsInPolygons } from '../../tools/gis-tools.js';
import { PREDICATE_OPTIONS, validateSpatialJoinConfig } from './engine.js';
import { materializeLayersForWidget } from '../widget-operation.js';

export async function openSpatialJoin(ctx) {
    await openReactIsland({
        title: 'Spatial Join',
        width: '520px',
        mountPath: '../../../react/widgets/mountSpatialJoinDialog.jsx',
        mountExport: 'mountSpatialJoinDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: true }),
            predicateOptions: PREDICATE_OPTIONS,
            onCancel: close,
            onLayerFocus: (layerId) => {
                if (!layerId) return;
                ctx.setActiveLayer?.(layerId);
                ctx.mapService.setActiveLayerId?.(layerId);
                ctx.refreshUI();
            },
            onRun: async (config, handlers = {}) => {
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
                return { featureCount: result.geojson?.features?.length || 0 };
            }
        })
    });
}
