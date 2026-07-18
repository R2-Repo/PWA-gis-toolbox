import { openReactIsland } from '../../ui/open-react-island.js';
import { NATIVE_OPERATIONS } from '../../platform/jobs/allowed-operations.js';
import { hasRequiredCapabilities } from '../../platform/contracts.js';
import {
    GEOJSON_FILE_FILTERS,
    basenameFromPath,
    formatSummaryResult,
    validateGeoJsonPath
} from './engine.js';

const REQUIRED = ['pythonCompute', 'nativeFiles'];

/**
 * Desktop-only widget: summarize a GeoJSON file via the Python sidecar.
 * @param {import('../widget-types.js').WidgetContext} ctx
 */
export async function openGeoJsonFileSummary(ctx) {
    const platform = ctx.platform;
    if (!hasRequiredCapabilities(platform, REQUIRED)) {
        ctx.showToast?.(
            'GeoJSON File Summary requires the Windows desktop app with Python support.',
            'warning'
        );
        return;
    }

    await openReactIsland({
        title: 'GeoJSON File Summary',
        width: '520px',
        mountPath: '../../../react/widgets/mountGeoJsonFileSummaryDialog.jsx',
        mountExport: 'mountGeoJsonFileSummaryDialog',
        getProps: (close) => ({
            onCancel: close,
            onPickFile: async () => {
                const result = await ctx.services.files.open({
                    title: 'Open GeoJSON file',
                    multiple: false,
                    filters: GEOJSON_FILE_FILTERS
                });
                if (result?.canceled || !result?.path) {
                    return { canceled: true };
                }
                const validation = validateGeoJsonPath(result.path);
                if (!validation.ok) {
                    throw new Error(validation.error);
                }
                return {
                    canceled: false,
                    path: result.path,
                    fileName: basenameFromPath(result.path)
                };
            },
            onRun: async ({ path, onProgress }) => {
                const validation = validateGeoJsonPath(path);
                if (!validation.ok) {
                    throw new Error(validation.error);
                }
                const raw = await ctx.services.compute.run(
                    NATIVE_OPERATIONS.SUMMARIZE_GEOJSON,
                    { path },
                    { onProgress }
                );
                return formatSummaryResult(raw || {});
            },
            onReveal: async (path) => {
                if (!path) return;
                await ctx.services.files.revealInExplorer(path);
            }
        })
    });
}
