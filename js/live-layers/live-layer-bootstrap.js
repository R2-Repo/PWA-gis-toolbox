import { parseLiveEntry } from '../url/app-url-builder.js';
import { addLayer, getLayers, setActiveLayer } from '../core/state.js';
import { createServiceLayer, isServiceLayer } from '../core/data-model.js';
import { resolveLiveLayer } from './catalog-schema.js';
import { addServiceLayer, createServiceLayerFromUrl } from './live-layer-engine.js';

/**
 * @param {import('../url/app-url-schema.js').AppUrlConfig} config
 * @param {{ mapService: object }} deps
 */
export async function applyLiveLayerConfig(config, deps) {
    const entries = config.live || [];
    if (!entries.length) return;

    const datasets = [];
    for (const entry of entries) {
        const parsed = parseLiveEntry(entry);
        if (parsed.type === 'catalog') {
            const catalogEntry = resolveLiveLayer(parsed.id);
            if (!catalogEntry) continue;
            datasets.push(createServiceLayer({
                name: catalogEntry.name,
                kind: catalogEntry.kind,
                url: catalogEntry.url,
                refreshMs: catalogEntry.refreshMs,
                opacity: catalogEntry.opacity,
                attribution: catalogEntry.attribution,
                presetId: catalogEntry.id
            }));
        } else if (parsed.type === 'url') {
            datasets.push(createServiceLayerFromUrl('Custom Live Layer', parsed.url));
        }
    }

    for (let i = 0; i < datasets.length; i++) {
        const dataset = datasets[i];
        addLayer(dataset, { activate: i === datasets.length - 1 });
        await deps.mapService.addServiceLayer(dataset, getLayers().indexOf(dataset), { fit: i === 0 });
    }

    if (datasets.length) {
        setActiveLayer(datasets[datasets.length - 1].id);
    }
}

/**
 * @param {object} ctx - widget context
 * @param {import('../url/app-url-schema.js').AppUrlConfig} config
 */
export async function addLiveConfigToMap(ctx, config) {
    await applyLiveLayerConfig(config, { mapService: ctx.mapService });
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
