import { addLayer, getLayers, setActiveLayer } from '../core/state.js';
import { createServiceLayer, isServiceLayer } from '../core/data-model.js';
import { resolveLiveLayer } from './catalog-schema.js';
import { addServiceLayer } from './live-layer-engine.js';

/**
 * @param {object} catalogEntry
 */
function createServiceLayerFromCatalogEntry(catalogEntry) {
    return createServiceLayer({
        name: catalogEntry.name,
        kind: catalogEntry.kind,
        url: catalogEntry.url,
        refreshMs: catalogEntry.refreshMs,
        opacity: catalogEntry.opacity,
        attribution: catalogEntry.attribution,
        presetId: catalogEntry.id,
        style: catalogEntry.style
    });
}

/**
 * Add a catalog live layer to the current map session.
 * @param {{ mapService: object, showToast?: (msg: string, type?: string) => void, refreshUI?: () => void }} ctx
 * @param {string} layerId
 * @param {{ fit?: boolean }} [options]
 */
export async function addCatalogLayerToMap(ctx, layerId, { fit = true } = {}) {
    const catalogEntry = resolveLiveLayer(layerId);
    if (!catalogEntry) {
        throw new Error(`Unknown live layer: ${layerId}`);
    }

    const dataset = createServiceLayerFromCatalogEntry(catalogEntry);
    addLayer(dataset, { activate: true });
    await ctx.mapService.addServiceLayer(dataset, getLayers().indexOf(dataset), { fit });
    setActiveLayer(dataset.id);

    ctx.showToast?.(`Added ${catalogEntry.name}`, 'success');
    ctx.refreshUI?.();
    return dataset;
}

/**
 * @param {object} layer
 */
export function buildServiceLayerRecord(layer) {
    if (!isServiceLayer(layer)) return layer;
    return {
        id: layer.id,
        name: layer.name,
        type: 'service',
        visible: layer.visible !== false,
        active: false,
        created: layer.created || new Date().toISOString(),
        service: { ...layer.service },
        source: layer.source || { format: 'live-service', url: layer.service?.url }
    };
}
