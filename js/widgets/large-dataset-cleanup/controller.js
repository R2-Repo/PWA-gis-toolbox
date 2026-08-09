import { openReactIsland } from '../../ui/open-react-island.js';
import { isWorkspaceLayer, getLayerFeatureCount } from '../../core/data-model.js';
import { detachFieldsForExport, getWorkspaceLayer } from '../../workspace/workspace-store.js';
import {
    getStorageQuotaSummary,
    listPreservedSourcesWithRefs,
    removePreservedSource,
    formatBytes
} from '../../workspace/storage-summary.js';
import { TILED_RENDER_THRESHOLD } from '../../map/tiles/tile-constants.js';
import {
    WIZARD_STEPS,
    validateLayerSelection,
    buildFootprintSummary,
    validateCleanupPlan,
    planCleanupOrder,
    listDetachableFieldNames
} from './engine.js';

function workspaceLayerOptions(ctx) {
    return (ctx.getLayers() || [])
        .filter((layer) => isWorkspaceLayer(layer))
        .map((layer) => ({
            id: layer.id,
            name: layer.name,
            featureCount: getLayerFeatureCount(layer),
            fields: listDetachableFieldNames(layer.schema?.fields || []),
            coldFields: layer.schema?.coldFields || layer.coldFields || [],
            sourceFile: layer.source?.file || null,
            sourcePreserved: !!layer.source?.sourcePreserved || !!layer.source?.opfsKey,
            opfsKey: layer.source?.opfsKey || null,
            tiled: getLayerFeatureCount(layer) >= TILED_RENDER_THRESHOLD
        }));
}

export async function openLargeDatasetCleanup(ctx) {
    await openReactIsland({
        title: 'Large Dataset Cleanup',
        width: '520px',
        mountPath: '../../../react/widgets/mountLargeDatasetCleanupDialog.jsx',
        mountExport: 'mountLargeDatasetCleanupDialog',
        getProps: (close) => ({
            steps: WIZARD_STEPS,
            layers: workspaceLayerOptions(ctx),
            formatBytes,
            onCancel: close,
            onOpenStorageManager: () => {
                ctx.openStorageManager?.();
            },
            onLayerFocus: (layerId) => {
                if (!layerId) return;
                ctx.setActiveLayer?.(layerId);
                ctx.mapService.setActiveLayerId?.(layerId);
                ctx.refreshUI();
            },
            onLoadFootprint: async (layerId) => {
                const layer = ctx.getLayers().find((entry) => entry.id === layerId);
                const check = validateLayerSelection(layer);
                if (!check.valid) throw new Error(check.error);

                const wsId = layer.workspaceLayerId || layer.id;
                const meta = await getWorkspaceLayer(wsId);
                const sources = await listPreservedSourcesWithRefs(ctx.getLayers());
                const sourceEntry = sources.find((s) => s.key === layer.source?.opfsKey) || null;
                const quota = await getStorageQuotaSummary();
                const hotFieldCount = (layer.schema?.fields || []).filter((f) => !f.cold).length;
                const coldFieldCount = (layer.schema?.coldFields || layer.coldFields || []).length
                    || (layer.schema?.fields || []).filter((f) => f.cold).length;

                return buildFootprintSummary({
                    layerName: layer.name,
                    featureCount: getLayerFeatureCount(layer) || meta?.featureCount || 0,
                    hotFieldCount,
                    coldFieldCount,
                    sourceName: sourceEntry?.name || layer.source?.file || null,
                    sourceSize: sourceEntry?.size || 0,
                    sourcePreserved: !!sourceEntry || !!layer.source?.opfsKey,
                    storageUsage: quota.usage,
                    storageQuota: quota.quota,
                    tiled: getLayerFeatureCount(layer) >= TILED_RENDER_THRESHOLD
                });
            },
            onRun: async ({ layerId, detachFields, removeLayer, deleteSource }) => {
                const layer = ctx.getLayers().find((entry) => entry.id === layerId);
                const check = validateLayerSelection(layer);
                if (!check.valid) throw new Error(check.error);

                const planCheck = validateCleanupPlan({ detachFields, removeLayer, deleteSource });
                if (!planCheck.valid) throw new Error(planCheck.error);

                const wsId = layer.workspaceLayerId || layer.id;
                const opfsKey = layer.source?.opfsKey || null;
                const steps = planCleanupOrder({ detachFields, removeLayer, deleteSource });
                const results = { detached: 0, removedLayer: false, deletedSource: false };

                for (const step of steps) {
                    if (step.type === 'detach') {
                        const result = await detachFieldsForExport(wsId, step.fields);
                        results.detached = result.movedFields.length;
                        const meta = await getWorkspaceLayer(wsId);
                        if (meta?.schema) {
                            layer.schema = meta.schema;
                            layer.coldFields = meta.coldFields || meta.schema.coldFields;
                        }
                        ctx.refreshUI();
                    } else if (step.type === 'removeLayer') {
                        const removed = await ctx.removeLayers?.([layer.id]);
                        if (removed === false) throw new Error('Layer removal cancelled.');
                        results.removedLayer = true;
                    } else if (step.type === 'deleteSource' && opfsKey) {
                        const remaining = ctx.getLayers();
                        const outcome = await removePreservedSource(opfsKey, remaining, { force: false });
                        if (!outcome.ok && outcome.reason === 'referenced') {
                            // Layer already gone — force orphan cleanup.
                            await removePreservedSource(opfsKey, remaining, { force: true });
                        }
                        results.deletedSource = true;
                    }
                }

                ctx.refreshUI();
                return results;
            }
        })
    });
}
