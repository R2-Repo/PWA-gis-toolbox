import bus from '../../core/event-bus.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { applyBulkUpdateToLayer } from './engine.js';
import {
    resolveLayerNativePath,
    getLayerAnalysisFeatureCount,
    chooseAnalysisProvider,
    updateAttributesLayerNative,
    markLayerEditsDirty
} from '../../library/desktop-analysis.js';
import { listAvailableOptionalCapabilities } from '../../platform/contracts.js';
import { isTauriShellPresent } from '../../platform/create-platform.js';
export async function openBulkUpdate(ctx) {
    const pythonAvailable = listAvailableOptionalCapabilities(
        ctx.platform,
        ['pythonCompute']
    ).includes('pythonCompute');

    await openReactIsland({
        title: 'Bulk Update',
        width: '480px',
        mountPath: '../../../react/widgets/mountBulkUpdateDialog.jsx',
        mountExport: 'mountBulkUpdateDialog',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: true }),
            onCancel: close,
            onLayerFocus: (layerId) => {
                if (!layerId) return;
                ctx.setActiveLayer?.(layerId);
                ctx.mapService.setActiveLayerId?.(layerId);
                ctx.refreshUI();
            },
            onSelectAll: (layerId) => {
                const layer = ctx.getLayers().find((entry) => entry.id === layerId);
                if (!layer) return;
                ctx.mapService.selectAll(layer.id, layer.geojson);
            },
            onInvertSelection: (layerId) => {
                const layer = ctx.getLayers().find((entry) => entry.id === layerId);
                if (!layer) return;
                ctx.mapService.invertSelection(layer.id, layer.geojson);
            },
            onClearSelection: (layerId) => {
                ctx.mapService.clearSelection(layerId || null);
            },
            onSubscribeSelection: (layerId, callback) => {
                const refresh = () => callback(ctx.mapService.getSelectionCount(layerId) || 0);
                refresh();
                const handler = () => refresh();
                bus.on('selection:changed', handler);
                return () => bus.off('selection:changed', handler);
            },
            onApply: async ({ layerId, updates, applyTo }) => {
                const layer = ctx.getLayers().find((entry) => entry.id === layerId);
                if (!layer) throw new Error('Target layer not found.');

                const updatesObj = {};
                for (const entry of updates || []) {
                    if (entry?.field) updatesObj[entry.field] = entry.value;
                }
                if (!Object.keys(updatesObj).length) {
                    throw new Error('Add at least one field update.');
                }

                const nativePath = resolveLayerNativePath(layer);
                const analysisCount = getLayerAnalysisFeatureCount(layer);
                const preferNativeAll = applyTo !== 'selection'
                    && nativePath
                    && pythonAvailable
                    && isTauriShellPresent()
                    && chooseAnalysisProvider(analysisCount, true, nativePath, true) === 'python';

                if (preferNativeAll) {
                    const derived = await updateAttributesLayerNative(layer, updatesObj);
                    ctx.addLayer?.(derived);
                    ctx.mapService.addLayer?.(derived, ctx.getLayers().indexOf(derived), { fit: true });
                    ctx.refreshUI();
                    ctx.showToast(
                        `Updated attributes on disk (${analysisCount.toLocaleString()} features) → new library layer`,
                        'success'
                    );
                    return {
                        updatedCount: derived?.source?.fullFeatureCount || analysisCount,
                        fieldCount: Object.keys(updatesObj).length,
                        provider: 'python'
                    };
                }

                if (!layer?.geojson?.features) throw new Error('Target layer not found.');

                let selectedIndices;
                if (applyTo === 'selection') {
                    selectedIndices = ctx.mapService.getSelectedIndices(layer.id) || [];
                    if (selectedIndices.length === 0) {
                        throw new Error('Select features on the map first.');
                    }
                } else {
                    selectedIndices = layer.geojson.features
                        .map((f) => f.properties?._featureIndex)
                        .filter((idx) => idx !== undefined);
                    if (!selectedIndices.length) {
                        selectedIndices = layer.geojson.features.map((_, i) => i);
                    }
                }

                const result = applyBulkUpdateToLayer({ layer, selectedIndices, updates });
                markLayerEditsDirty(layer);

                ctx.mapService.refreshLayerData(layer);
                ctx.mapService.clearSelection(layer.id);
                ctx.refreshUI();

                const dirtyHint = nativePath
                    ? ' — preview edited; use Save edits to library for disk'
                    : '';
                ctx.showToast(
                    `Updated ${result.fieldCount} field${result.fieldCount === 1 ? '' : 's'} on ${result.updatedCount} feature${result.updatedCount === 1 ? '' : 's'}${dirtyHint}`,
                    'success'
                );
                return result;
            }
        })
    });
}
