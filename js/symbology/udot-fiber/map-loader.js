/**
 * Add UDOT Fiber Network layers from desktop SQLite to the map session.
 */
import { addLayer, getLayers, setActiveLayer } from '../../core/state.js';
import { assignLayersToGroup, createLayerGroup } from '../../core/layer-groups.js';
import { loadUdotFiberLayersFromDb, syncUdotFiberDbIfStale } from './desktop-sync.js';

/**
 * @param {{ mapService: object, showToast?: Function, refreshUI?: Function }} ctx
 * @param {{ syncFirst?: boolean, forceSync?: boolean }} [options]
 */
export async function addUdotFiberFromLocalDb(ctx, options = {}) {
    if (options.syncFirst) {
        ctx.showToast?.('Syncing UDOT Fiber Network…', 'info');
        await syncUdotFiberDbIfStale({ force: !!options.forceSync });
    }

    const datasets = await loadUdotFiberLayersFromDb({ applyOffsets: true });
    if (!datasets.length) {
        throw new Error('No UDOT Fiber layers in local database — run Sync first');
    }

    for (const dataset of datasets) {
        addLayer(dataset, { activate: false });
    }

    const group = createLayerGroup(
        'UDOT Fiber Network (local)',
        datasets.map((ds) => ds.id),
        { collapsed: false, source: 'import' }
    );
    if (group) assignLayersToGroup(group.id, datasets);

    for (let i = 0; i < datasets.length; i++) {
        const dataset = datasets[i];
        const layerIdx = getLayers().indexOf(dataset);
        const style = dataset._pendingStyle;
        ctx.mapService.addLayer(dataset, layerIdx, { fit: false });
        if (style) {
            ctx.mapService.restyleLayer(dataset.id, dataset, style);
        }
        delete dataset._pendingStyle;
    }

    setActiveLayer(datasets[0].id);
    ctx.mapService.syncLayerOrder?.(getLayers().map((l) => l.id));
    ctx.mapService.fitToLayers?.(datasets.map((d) => d.id));
    ctx.showToast?.(`Added UDOT Fiber Network (${datasets.length} local layers)`, 'success');
    ctx.refreshUI?.();
    return datasets;
}
