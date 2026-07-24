import bus from '../../core/event-bus.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { listAvailableOptionalCapabilities } from '../../platform/contracts.js';
import { isTauriShellPresent } from '../../platform/create-platform.js';
import {
    chooseAnalysisProvider,
    NATIVE_ANALYSIS_MIN_FEATURES,
    nearestJoinLayersNative,
    resolveLayerNativePath
} from '../../library/desktop-analysis.js';
import {
    UNIT_LABELS,
    validateProximityJoinConfig,
    buildProximityPreview,
    runProximityJoin,
    unitAbbr
} from './engine.js';

export async function openProximityJoin(ctx) {
    const pythonAvailable = listAvailableOptionalCapabilities(
        ctx.platform,
        ['pythonCompute']
    ).includes('pythonCompute');

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
            pythonAvailable,
            accelThreshold: NATIVE_ANALYSIS_MIN_FEATURES,
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

                const { getLayerAnalysisFeatureCount } = await import('../../library/desktop-analysis.js');
                const featureCount = getLayerAnalysisFeatureCount(sourceLayer);
                const nativePath = resolveLayerNativePath(sourceLayer)
                    || resolveLayerNativePath(targetLayer);
                const usePython = chooseAnalysisProvider(
                    featureCount,
                    pythonAvailable && isTauriShellPresent(),
                    nativePath,
                    config.preferPython !== false
                ) === 'python'
                    && !config.selectionOnly;

                if (usePython) {
                    handlers.onProgress?.('Running Python nearest join…');
                    const raw = await nearestJoinLayersNative(sourceLayer, targetLayer, {
                        fieldMappings: validation.validMappings,
                        maxRadius: config.maxRadius,
                        units: config.units,
                        writeDistance: config.writeDistance,
                        writeMatchId: config.writeMatchId,
                        matchIdField: config.matchIdField,
                        writeMatchLayer: config.writeMatchLayer
                    }, {
                        onProgress: (p) => handlers.onProgress?.(p?.message || 'Python nearest join…')
                    });

                    const fc = raw?.geojson?.features?.length
                        ? raw.geojson
                        : raw?.previewGeojson;
                    if (fc?.features?.length && fc.features.length === (raw.featureCount || fc.features.length)) {
                        sourceLayer.geojson = {
                            type: 'FeatureCollection',
                            features: fc.features
                        };
                        sourceLayer.schema = ctx.analyzeSchema?.(sourceLayer.geojson);
                        ctx.mapService.refreshLayerData?.(sourceLayer);
                    } else if (fc?.features?.length) {
                        const dataset = ctx.createSpatialDataset(
                            `${sourceLayer.name}_nearest_join`,
                            fc,
                            {
                                format: 'derived',
                                nativeOutputPath: raw.outputPath,
                                fullFeatureCount: raw.featureCount
                            }
                        );
                        ctx.addLayer(dataset);
                        ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset), { fit: false });
                    }

                    ctx.refreshUI();
                    const matched = Number(raw?.matched) || 0;
                    const unmatched = Number(raw?.unmatched) || 0;
                    ctx.showToast(
                        `Proximity join (Python): ${matched} matched, ${unmatched} unmatched`,
                        unmatched === 0 ? 'success' : 'info'
                    );
                    return {
                        cancelled: false,
                        total: Number(raw?.featureCount) || featureCount,
                        processed: Number(raw?.featureCount) || featureCount,
                        matched,
                        unmatched,
                        minDist: 0,
                        maxDist: 0,
                        avgDist: 0,
                        warnings: fc?.features?.length < (raw?.featureCount || 0)
                            ? ['Full result saved to Local GIS Library; map shows a preview sample.']
                            : [],
                        unitsLabel: unitAbbr(config.units),
                        provider: 'python'
                    };
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
                    unitsLabel: unitAbbr(config.units),
                    provider: 'javascript'
                };
            }
        })
    });
}
