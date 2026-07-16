import { addLayer, getLayers, setActiveLayer } from '../core/state.js';
import { createServiceLayer, isServiceLayer } from '../core/data-model.js';
import { assignLayersToGroup, createLayerGroup } from '../core/layer-groups.js';
import { expandCatalogEntry, resolveLiveLayer } from './catalog-schema.js';

/**
 * @param {import('./catalog-schema.js').LiveLayerServiceConfig} serviceConfig
 * @param {string} catalogId
 */
function createServiceLayerFromConfig(serviceConfig, catalogId) {
    return createServiceLayer({
        name: serviceConfig.name,
        kind: serviceConfig.kind,
        url: serviceConfig.url,
        refreshMs: serviceConfig.refreshMs,
        opacity: serviceConfig.opacity,
        attribution: serviceConfig.attribution,
        presetId: serviceConfig.id || catalogId,
        style: serviceConfig.style
    });
}

/**
 * Add a catalog live layer (single or multi-sublayer group) to the current map session.
 * @param {{ mapService: object, showToast?: (msg: string, type?: string) => void, refreshUI?: () => void }} ctx
 * @param {string} layerId
 * @param {{ fit?: boolean }} [options]
 */
export async function addCatalogLayerToMap(ctx, layerId, { fit = true } = {}) {
    const catalogEntry = resolveLiveLayer(layerId);
    if (!catalogEntry) {
        throw new Error(`Unknown live layer: ${layerId}`);
    }

    const serviceConfigs = expandCatalogEntry(catalogEntry);
    if (!serviceConfigs.length) {
        throw new Error(`Live layer ${layerId} has no services`);
    }

    const datasets = serviceConfigs.map((config) => createServiceLayerFromConfig(config, catalogEntry.id));

    for (const dataset of datasets) {
        addLayer(dataset, { activate: false });
    }

    if (datasets.length >= 2) {
        const group = createLayerGroup(
            catalogEntry.name,
            datasets.map((ds) => ds.id),
            { collapsed: false, source: 'import' }
        );
        if (group) assignLayersToGroup(group.id, datasets);
    }

    for (let i = 0; i < datasets.length; i++) {
        const dataset = datasets[i];
        const layerIdx = getLayers().indexOf(dataset);
        await ctx.mapService.addServiceLayer(dataset, layerIdx, { fit: false });
    }

    if (fit) {
        fitDatasets(ctx, datasets);
    }

    setActiveLayer(datasets[0].id);
    ctx.mapService.syncLayerOrder?.(getLayers().map((l) => l.id));

    const label = datasets.length > 1
        ? `Added ${catalogEntry.name} (${datasets.length} layers)`
        : `Added ${catalogEntry.name}`;
    ctx.showToast?.(label, 'success');
    ctx.refreshUI?.();
    return datasets.length === 1 ? datasets[0] : datasets;
}

/**
 * @param {{ mapService: object }} ctx
 * @param {object[]} datasets
 */
function fitDatasets(ctx, datasets) {
    const map = ctx.mapService.getMap?.();
    if (!map || typeof globalThis.turf === 'undefined') return;

    const allFeatures = datasets.flatMap((ds) => ds.geojson?.features || []);
    if (!allFeatures.length) return;

    try {
        const bbox = globalThis.turf.bbox({ type: 'FeatureCollection', features: allFeatures });
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 0 });
    } catch { /* ignore fit errors */ }
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
        source: layer.source || { format: 'live-service', url: layer.service?.url },
        ...(layer.groupId ? { groupId: layer.groupId } : {})
    };
}
