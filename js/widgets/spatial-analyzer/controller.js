import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { createAreaDrawHandlers } from '../map-draw-helpers.js';
import { listAvailableOptionalCapabilities } from '../../platform/contracts.js';
import { isTauriShellPresent } from '../../platform/create-platform.js';
import {
    chooseAnalysisProvider,
    NATIVE_ANALYSIS_MIN_FEATURES,
    resolveLayerNativePath,
    spatialFilterLayerNative
} from '../../library/desktop-analysis.js';
import { SPATIAL_RELATIONS, runSpatialAnalysis, computeMatchStats } from './engine.js';

export async function openSpatialAnalyzer(ctx) {
    const areaHandlers = createAreaDrawHandlers(ctx);
    const pythonAvailable = listAvailableOptionalCapabilities(
        ctx.platform,
        ['pythonCompute']
    ).includes('pythonCompute');

    await openReactIsland({
        title: 'Find Features in Area',
        width: '480px',
        mountPath: '../../../react/widgets/mountSpatialAnalyzerDialog.jsx',
        mountExport: 'mountSpatialAnalyzerDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { requirePolygons: true }),
            relationOptions: SPATIAL_RELATIONS,
            pythonAvailable,
            accelThreshold: NATIVE_ANALYSIS_MIN_FEATURES,
            onCancel: close,
            onDrawArea: areaHandlers.draw,
            onUseLayerArea: areaHandlers.useLayerArea,
            onRun: async ({ targetLayerId, analysisArea, spatialRelation, preferPython }) => {
                const targetLayer = ctx.getLayers().find((layer) => layer.id === targetLayerId);
                if (!targetLayer) {
                    throw new Error('Target layer not found.');
                }

                const featureCount = targetLayer.geojson?.features?.length
                    ?? targetLayer.pmtiles?.featureCount
                    ?? targetLayer.source?.fullFeatureCount
                    ?? 0;
                const nativePath = resolveLayerNativePath(targetLayer);
                const provider = chooseAnalysisProvider(
                    featureCount,
                    pythonAvailable && isTauriShellPresent(),
                    nativePath,
                    preferPython !== false
                );

                if (provider === 'python') {
                    const raw = await spatialFilterLayerNative(
                        targetLayer,
                        analysisArea,
                        spatialRelation
                    );
                    const matchedFeatures = raw?.previewGeojson?.features || [];
                    const matched = Number(raw?.featureCount) || matchedFeatures.length;
                    const stats = computeMatchStats(matchedFeatures);

                    ctx.mapService.showTempFeature(
                        { type: 'FeatureCollection', features: matchedFeatures },
                        15000
                    );

                    return {
                        matched,
                        total: Number(raw?.inputFeatureCount) || featureCount || matched,
                        features: matchedFeatures,
                        stats,
                        targetLayerName: targetLayer.name,
                        provider: 'python',
                        nativeOutputPath: raw?.outputPath
                    };
                }

                if (!targetLayer?.geojson?.features?.length) {
                    throw new Error('Target layer has no features.');
                }

                const { matchedFeatures, stats } = await runSpatialAnalysis({
                    features: targetLayer.geojson.features,
                    analysisArea,
                    spatialRelation
                });

                ctx.mapService.showTempFeature(
                    { type: 'FeatureCollection', features: matchedFeatures },
                    15000
                );

                return {
                    matched: matchedFeatures.length,
                    total: targetLayer.geojson.features.length,
                    features: matchedFeatures,
                    stats,
                    targetLayerName: targetLayer.name,
                    provider: 'javascript'
                };
            },
            onAddResults: (result) => {
                if (!result?.features?.length) {
                    ctx.showToast('No matching features to add', 'warning');
                    return;
                }

                const dataset = ctx.createSpatialDataset(
                    `${result.targetLayerName}_analysis_results`,
                    { type: 'FeatureCollection', features: result.features },
                    {
                        format: 'derived',
                        nativeOutputPath: result.nativeOutputPath,
                        fullFeatureCount: result.matched
                    }
                );
                ctx.addLayer(dataset);
                ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset), { fit: true });
                ctx.refreshUI();
                const note = result.matched > result.features.length
                    ? ` (preview ${result.features.length} of ${result.matched})`
                    : '';
                ctx.showToast(
                    `Added ${result.features.length} matched features as a new layer${note}`,
                    'success'
                );
            },
            onAddArea: ({ analysisArea, areaSource }) => {
                if (!analysisArea) {
                    ctx.showToast('No analysis area available', 'warning');
                    return;
                }
                const dataset = ctx.createSpatialDataset('Analysis_Area', {
                    type: 'FeatureCollection',
                    features: [{
                        ...analysisArea,
                        properties: {
                            ...(analysisArea.properties || {}),
                            name: 'Analysis Area',
                            source: areaSource || 'draw'
                        }
                    }]
                }, { format: 'derived' });
                ctx.addLayer(dataset);
                ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset), { fit: true });
                ctx.refreshUI();
                ctx.showToast('Analysis area added as new layer', 'success');
            }
        })
    });
}
