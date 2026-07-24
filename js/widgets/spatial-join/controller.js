import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { listAvailableOptionalCapabilities } from '../../platform/contracts.js';
import { isTauriShellPresent } from '../../platform/create-platform.js';
import {
    chooseAnalysisProvider,
    NATIVE_ANALYSIS_MIN_FEATURES,
    resolveLayerNativePath,
    spatialJoinLayersNative
} from '../../library/desktop-analysis.js';
import { spatialJoinPointsInPolygons } from '../../tools/gis-tools.js';
import { PREDICATE_OPTIONS, validateSpatialJoinConfig } from './engine.js';

export async function openSpatialJoin(ctx) {
    const pythonAvailable = listAvailableOptionalCapabilities(
        ctx.platform,
        ['pythonCompute']
    ).includes('pythonCompute');

    await openReactIsland({
        title: 'Spatial Join',
        width: '520px',
        mountPath: '../../../react/widgets/mountSpatialJoinDialog.jsx',
        mountExport: 'mountSpatialJoinDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: true }),
            predicateOptions: PREDICATE_OPTIONS,
            pythonAvailable,
            accelThreshold: NATIVE_ANALYSIS_MIN_FEATURES,
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

                const { getLayerAnalysisFeatureCount } = await import('../../library/desktop-analysis.js');
                const featureCount = getLayerAnalysisFeatureCount(leftLayer);
                const nativePath = resolveLayerNativePath(leftLayer)
                    || resolveLayerNativePath(rightLayer);
                const usePython = chooseAnalysisProvider(
                    featureCount,
                    pythonAvailable && isTauriShellPresent(),
                    nativePath,
                    config.preferPython !== false
                ) === 'python';

                if (usePython) {
                    handlers.onProgress?.('Running Python spatial join…');
                    const raw = await spatialJoinLayersNative(leftLayer, rightLayer, {
                        predicate: validation.predicate
                    }, {
                        onProgress: (p) => handlers.onProgress?.(p?.message || 'Python spatial join…')
                    });
                    const fc = raw?.geojson?.features?.length
                        ? raw.geojson
                        : raw?.previewGeojson;
                    if (!fc?.features?.length) {
                        throw new Error('Spatial join produced no features');
                    }
                    const dataset = ctx.createSpatialDataset(
                        config.outputName || `${leftLayer.name}_spatial_join`,
                        fc,
                        {
                            format: 'derived',
                            nativeOutputPath: raw.outputPath,
                            fullFeatureCount: raw.featureCount
                        }
                    );
                    ctx.addLayer(dataset);
                    ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset), { fit: true });
                    ctx.refreshUI();
                    const joined = Number(raw?.joinedCount) || 0;
                    ctx.showToast(
                        `Spatial join (Python): ${joined.toLocaleString()} matched of ${(raw.featureCount || fc.features.length).toLocaleString()}`,
                        'success'
                    );
                    return { provider: 'python', joinedCount: joined, featureCount: raw.featureCount };
                }

                handlers.onProgress?.('Running spatial join…');
                const result = await spatialJoinPointsInPolygons(
                    leftLayer,
                    rightLayer,
                    config.joinFields || [],
                    config.prefix || ''
                );
                ctx.addLayer(result);
                ctx.mapService.addLayer(result, ctx.getLayers().indexOf(result), { fit: true });
                ctx.refreshUI();
                ctx.showToast(`Spatial join complete — "${result.name}"`, 'success');
                return { provider: 'javascript', featureCount: result.geojson?.features?.length || 0 };
            }
        })
    });
}
