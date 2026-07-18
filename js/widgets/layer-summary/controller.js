import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { listAvailableOptionalCapabilities } from '../../platform/contracts.js';
import { NATIVE_OPERATIONS } from '../../platform/jobs/allowed-operations.js';
import { isTauriShellPresent } from '../../platform/create-platform.js';
import { formatSummaryResult } from '../geojson-file-summary/engine.js';
import {
    PYTHON_ACCEL_MIN_FEATURES,
    chooseSummaryProvider,
    providerLabel,
    summarizeFeatureCollection,
    validateLayerGeoJson
} from './engine.js';

/**
 * Shared widget: summarize a workspace layer.
 * Uses JavaScript by default; optionally accelerates large layers via Python on Windows.
 *
 * @param {import('../widget-types.js').WidgetContext} ctx
 */
export async function openLayerSummary(ctx) {
    const pythonAvailable = listAvailableOptionalCapabilities(
        ctx.platform,
        ['pythonCompute']
    ).includes('pythonCompute');

    await openReactIsland({
        title: 'Layer Summary',
        width: '520px',
        mountPath: '../../../react/widgets/mountLayerSummaryDialog.jsx',
        mountExport: 'mountLayerSummaryDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: false }),
            pythonAvailable,
            accelThreshold: PYTHON_ACCEL_MIN_FEATURES,
            onCancel: close,
            onRun: async ({ layerId, preferPython, onProgress }) => {
                const layer = ctx.getLayers().find((entry) => entry.id === layerId);
                if (!layer) throw new Error('Layer not found.');

                const validation = validateLayerGeoJson(layer.geojson);
                if (!validation.ok) throw new Error(validation.error);

                const provider = chooseSummaryProvider(
                    validation.featureCount,
                    pythonAvailable && isTauriShellPresent(),
                    preferPython !== false
                );

                onProgress?.({
                    percent: 5,
                    stage: 'provider',
                    message: `Using ${providerLabel(provider)}`
                });

                if (provider === 'javascript') {
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

                onProgress?.({ percent: 15, stage: 'materialize', message: 'Writing temporary GeoJSON' });
                const contents = JSON.stringify(layer.geojson);
                const tempPath = await ctx.services.files.writeTempGeoJson(contents);
                try {
                    onProgress?.({ percent: 30, stage: 'sidecar', message: 'Running Python sidecar' });
                    const raw = await ctx.services.compute.run(
                        NATIVE_OPERATIONS.SUMMARIZE_GEOJSON,
                        { path: tempPath },
                        { onProgress }
                    );
                    const summary = formatSummaryResult(raw || {});
                    return {
                        ...summary,
                        provider,
                        providerLabel: providerLabel(provider),
                        layerName: layer.name
                    };
                } finally {
                    try {
                        await ctx.services.files.removeTempFile(tempPath);
                    } catch {
                        /* best-effort cleanup */
                    }
                }
            }
        })
    });
}
