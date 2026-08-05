import bus from '../../core/event-bus.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import {
    UNIT_LABELS,
    validateProximityJoinConfig,
    buildProximityPreview,
    runProximityJoin,
    unitAbbr
} from './engine.js';

export async function openProximityJoin(ctx) {
    await openReactIsland({
        title: 'Proximity Join',
        width: '520px',
        mountPath: '../../../react/widgets/mountProximityJoinDialog.jsx',
        mountExport: 'mountProximityJoinDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: true, includeSelectionCount: true }),
            unitOptions: UNIT_LABELS.map((entry) => ({
                value: entry.value,
                label: `${entry.label} (${entry.abbr})`
            })),
            onCancel: close,
            onLayerFocus: (layerId) => {
                if (!layerId) return;
                ctx.setActiveLayer?.(layerId);
                ctx.mapService.setActiveLayerId?.(layerId);
                ctx.refreshUI();
            },
            onSubscribeSelection: (layerId, callback) => {
                const refresh = () => callback(ctx.mapService.getSelectionCount(layerId) || 0);
                refresh();
                const handler = () => refresh();
                bus.on('selection:changed', handler);
                return () => bus.off('selection:changed', handler);
            },
            onPreview: async (config) => {
                const sourceLayer = ctx.getLayers().find((layer) => layer.id === config.sourceLayerId);
                const targetLayer = ctx.getLayers().find((layer) => layer.id === config.targetLayerId);
                const validation = validateProximityJoinConfig({
                    sourceLayer,
                    targetLayer,
                    fieldMappings: config.fieldMappings,
                    maxRadius: config.maxRadius,
                    writeDistance: config.writeDistance,
                    writeMatchId: config.writeMatchId,
                    writeMatchLayer: config.writeMatchLayer,
                    matchIdField: config.matchIdField
                });
                if (validation.errors.length > 0) {
                    throw new Error(validation.errors[0]);
                }

                const sourceFeatures = config.selectionOnly
                    ? (ctx.mapService.getSelectedIndices?.(sourceLayer.id) || [])
                        .map((index) => sourceLayer.geojson.features[index])
                        .filter(Boolean)
                    : sourceLayer.geojson.features;

                return buildProximityPreview({
                    sourceFeatures,
                    targetFeatures: targetLayer.geojson.features,
                    fieldMappings: validation.validMappings,
                    units: config.units,
                    maxRadius: config.maxRadius,
                    writeDistance: config.writeDistance
                });
            },
            onRun: async (config, handlers = {}) => {
                const sourceLayer = ctx.getLayers().find((layer) => layer.id === config.sourceLayerId);
                const targetLayer = ctx.getLayers().find((layer) => layer.id === config.targetLayerId);
                const validation = validateProximityJoinConfig({
                    sourceLayer,
                    targetLayer,
                    fieldMappings: config.fieldMappings,
                    maxRadius: config.maxRadius,
                    writeDistance: config.writeDistance,
                    writeMatchId: config.writeMatchId,
                    writeMatchLayer: config.writeMatchLayer,
                    matchIdField: config.matchIdField
                });
                if (validation.errors.length > 0) {
                    throw new Error(validation.errors[0]);
                }

                const featureIndices = config.selectionOnly
                    ? (ctx.mapService.getSelectedIndices?.(sourceLayer.id) || [])
                    : sourceLayer.geojson.features.map((_, index) => index);

                if (featureIndices.length === 0) {
                    throw new Error(config.selectionOnly
                        ? 'No selected features found on the layer to update.'
                        : 'The layer to update has no features.');
                }

                const result = await runProximityJoin({
                    allSourceFeatures: sourceLayer.geojson.features,
                    featureIndices,
                    targetFeatures: targetLayer.geojson.features,
                    fieldMappings: validation.validMappings,
                    units: config.units,
                    maxRadius: config.maxRadius,
                    writeDistance: config.writeDistance,
                    writeMatchId: config.writeMatchId,
                    matchIdField: config.matchIdField,
                    writeMatchLayer: config.writeMatchLayer,
                    targetLayerName: targetLayer.name,
                    onProgress: handlers.onProgress,
                    isCancelled: handlers.isCancelled
                });

                if (result.cancelled) {
                    ctx.showToast('Proximity join cancelled', 'warning');
                    return result;
                }

                sourceLayer.schema = ctx.analyzeSchema?.(sourceLayer.geojson);
                ctx.mapService.refreshLayerData?.(sourceLayer);
                ctx.refreshUI();
                ctx.showToast(
                    `Proximity join complete: ${result.matched} matched, ${result.unmatched} unmatched`,
                    result.unmatched === 0 ? 'success' : 'info'
                );

                return {
                    ...result,
                    unitsLabel: unitAbbr(config.units)
                };
            }
        })
    });
}
