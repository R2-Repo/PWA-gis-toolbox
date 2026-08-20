import { addLayer, getLayers, setActiveLayer } from '../core/state.js';
import { createServiceLayer, isServiceLayer } from '../core/data-model.js';
import { assignLayersToGroup, createLayerGroup } from '../core/layer-groups.js';
import { expandCatalogEntry, resolveLiveLayer } from './catalog-schema.js';
import { ensureCatalogAccess } from './catalog-access.js';
import { FIREWATCH_CATALOG_ID } from './firewatch/constants.js';
import {
    fitUtahEnvelope,
    flushFirewatchSession,
    getUtahFitBounds,
    orderFirewatchLayersForSession
} from './firewatch/runtime.js';
import logger from '../core/logger.js';

/**
 * @param {import('./catalog-schema.js').LiveLayerServiceConfig} serviceConfig
 * @param {string} catalogId
 * @param {string} [sessionKey]
 */
function createServiceLayerFromConfig(serviceConfig, catalogId, sessionKey = null) {
    return createServiceLayer({
        name: serviceConfig.name,
        kind: serviceConfig.kind,
        url: serviceConfig.url,
        refreshMs: serviceConfig.refreshMs,
        minZoom: serviceConfig.minZoom,
        opacity: serviceConfig.opacity,
        attribution: serviceConfig.attribution,
        presetId: serviceConfig.id || catalogId,
        style: serviceConfig.style,
        firewatchPart: serviceConfig.firewatchPart || null,
        firewatchSessionKey: sessionKey
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

    const allowed = await ensureCatalogAccess(catalogEntry);
    if (!allowed) return null;

    const serviceConfigs = expandCatalogEntry(catalogEntry);
    if (!serviceConfigs.length) {
        throw new Error(`Live layer ${layerId} has no services`);
    }

    const isFirewatch = catalogEntry.id === FIREWATCH_CATALOG_ID;
    const sessionKey = isFirewatch ? `firewatch-${Date.now()}` : null;

    const datasets = serviceConfigs.map((config) => createServiceLayerFromConfig(
        config,
        catalogEntry.id,
        sessionKey
    ));

    for (const dataset of datasets) {
        addLayer(dataset, { activate: false });
    }

    if (datasets.length >= 2) {
        const group = createLayerGroup(
            catalogEntry.name,
            datasets.map((ds) => ds.id),
            { collapsed: false, source: 'import' }
        );
        if (group) {
            assignLayersToGroup(group.id, datasets);
            if (sessionKey) {
                for (const dataset of datasets) {
                    if (dataset.service) dataset.service.firewatchSessionKey = sessionKey;
                }
            }
        }
    }

    for (let i = 0; i < datasets.length; i++) {
        const dataset = datasets[i];
        const layerIdx = getLayers().indexOf(dataset);
        await ctx.mapService.addServiceLayer(dataset, layerIdx, { fit: false });
    }

    if (isFirewatch && sessionKey) {
        try {
            await flushFirewatchSession(sessionKey);
        } catch (error) {
            logger.warn('Firewatch', 'Initial fetch failed', { error: error?.message || String(error) });
            ctx.showToast?.(`Firewatch data load failed: ${error?.message || error}`, 'error');
        }
    }

    if (fit) {
        if (isFirewatch) {
            const map = ctx.mapService.getMap?.();
            if (map) fitUtahEnvelope(map);
            else {
                const bounds = getUtahFitBounds();
                ctx.mapService.fitBounds?.(bounds, { padding: 40, duration: 0 });
            }
        } else {
            fitDatasets(ctx, datasets);
        }
    }

    setActiveLayer(datasets[0].id);
    ctx.mapService.syncLayerOrder?.(getLayers().map((l) => l.id));
    if (isFirewatch && sessionKey) {
        orderFirewatchLayersForSession(sessionKey);
    }

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
