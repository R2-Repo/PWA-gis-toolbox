/**
 * Read-only Network Atlas → GIS map layer bridge (Phase 6+).
 *
 * - Reads in-memory Atlas snapshot / map payload only
 * - Never writes network-atlas.sqlite or gis-catalog.sqlite
 * - Does not merge catalogs or route Atlas through GeoParquet
 */
import bus from '../core/event-bus.js';
import { createSpatialDataset } from '../core/data-model.js';
import { getAtlasSnapshot } from './store.js';

/** Lazy imports — avoid `window` / map-manager at module load in unit tests. */
async function layerState() {
    return import('../core/state.js');
}

async function workspaceApi() {
    return import('./workspace.js');
}

/**
 * Minimal hub/drop FeatureCollections (no map-layers import — keeps Atlas overlays separate).
 * @param {import('./types.js').AtlasSnapshot} snap
 */
function buildHubDropFeatures(snap) {
    const hubs = [];
    for (const hub of snap.hubs || []) {
        if (hub.lat == null || hub.lon == null) continue;
        hubs.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [hub.lon, hub.lat] },
            properties: {
                atlasKind: 'hub',
                id: hub.id,
                hubCode: hub.hubCode || '',
                label: hub.aka || hub.name || hub.hubCode || ''
            }
        });
    }
    const drops = [];
    for (const drop of snap.drops || []) {
        if (drop.lat == null || drop.lon == null) continue;
        drops.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [drop.lon, drop.lat] },
            properties: {
                atlasKind: 'drop',
                id: drop.id,
                channelId: drop.channelId || '',
                dropNumber: drop.dropNumber ?? '',
                label: drop.inventoryName || `D${drop.dropNumber ?? '?'}`,
                ip: drop.ip || ''
            }
        });
    }
    return { hubs, drops };
}

export const NETWORK_ATLAS_ADAPTER = 'network-atlas-readonly';

const STABLE_IDS = Object.freeze({
    hubs: '__network_atlas_readonly_hubs',
    drops: '__network_atlas_readonly_drops'
});

let started = false;
/** @type {null | (() => void)} */
let unsub = null;
/** @type {null | { mapService?: any, refreshUI?: Function }} */
let bridgeCtx = null;

/**
 * @param {object} layer
 * @returns {boolean}
 */
export function isNetworkAtlasReadonlyLayer(layer) {
    return layer?.source?.adapter === NETWORK_ATLAS_ADAPTER
        || layer?.id === STABLE_IDS.hubs
        || layer?.id === STABLE_IDS.drops;
}

/**
 * Build ephemeral FeatureCollections from Atlas snapshot (hubs + drops only).
 * @param {import('./types.js').AtlasSnapshot} [snap]
 * @returns {{ hubs: object, drops: object } | null}
 */
export function buildNetworkAtlasReadonlyDatasets(snap = getAtlasSnapshot()) {
    if (!snap?.loaded) return null;
    const { hubs: hubFeatures, drops: dropFeatures } = buildHubDropFeatures(snap);

    const hubs = createSpatialDataset(
        'Atlas hubs (read-only)',
        { type: 'FeatureCollection', features: hubFeatures },
        {
            format: 'atlas-readonly',
            adapter: NETWORK_ATLAS_ADAPTER,
            atlasKind: 'hub',
            readOnly: true,
            importRoute: 'network-atlas-bridge'
        }
    );
    hubs.id = STABLE_IDS.hubs;

    const drops = createSpatialDataset(
        'Atlas drops (read-only)',
        { type: 'FeatureCollection', features: dropFeatures },
        {
            format: 'atlas-readonly',
            adapter: NETWORK_ATLAS_ADAPTER,
            atlasKind: 'drop',
            readOnly: true,
            importRoute: 'network-atlas-bridge'
        }
    );
    drops.id = STABLE_IDS.drops;

    return { hubs, drops };
}

async function removeBridgeLayers(mapService) {
    const { getLayers, removeLayer } = await layerState();
    for (const id of Object.values(STABLE_IDS)) {
        if (getLayers().some((l) => l.id === id)) {
            removeLayer(id);
            mapService?.removeLayer?.(id);
        }
    }
}

/**
 * Sync read-only GIS layers when Atlas is loaded and workspace is GIS mode.
 * In Atlas mode, remove GIS bridge layers to avoid double rendering with Atlas overlays.
 *
 * @param {{ mapService?: any, refreshUI?: Function }} [ctx]
 */
export async function syncNetworkAtlasGisLayers(ctx = bridgeCtx || {}) {
    const { mapService, refreshUI } = ctx;
    const { isAtlasAvailable, getWorkspaceMode } = await workspaceApi();
    if (!isAtlasAvailable()) {
        await removeBridgeLayers(mapService);
        return;
    }

    const snap = getAtlasSnapshot();
    if (!snap?.loaded || getWorkspaceMode() === 'atlas') {
        await removeBridgeLayers(mapService);
        refreshUI?.();
        return;
    }

    const built = buildNetworkAtlasReadonlyDatasets(snap);
    if (!built) {
        await removeBridgeLayers(mapService);
        refreshUI?.();
        return;
    }

    const { addLayer, getLayers, updateLayerData } = await layerState();
    for (const dataset of [built.hubs, built.drops]) {
        const existing = getLayers().find((l) => l.id === dataset.id);
        if (existing) {
            updateLayerData(dataset.id, dataset.geojson);
            mapService?.refreshLayerData?.(existing);
        } else {
            addLayer(dataset, { activate: false });
            mapService?.addLayer?.(dataset, getLayers().indexOf(dataset), { fit: false });
        }
    }
    refreshUI?.();
}

/**
 * Start listening for Atlas / workspace events. Safe to call repeatedly.
 * @param {{ mapService?: any, refreshUI?: Function }} ctx
 */
export function startNetworkAtlasLayerBridge(ctx = {}) {
    bridgeCtx = ctx;
    void (async () => {
        const { isAtlasAvailable } = await workspaceApi();
        if (!isAtlasAvailable()) return;
        if (started) {
            void syncNetworkAtlasGisLayers(ctx);
            return;
        }
        started = true;

        const sync = () => {
            void syncNetworkAtlasGisLayers(bridgeCtx || ctx);
        };
        bus.on('atlas:opened', sync);
        bus.on('atlas:changed', sync);
        bus.on('atlas:ping', sync);
        bus.on('atlas:closed', sync);
        bus.on('workspace:mode', sync);
        unsub = () => {
            bus.off('atlas:opened', sync);
            bus.off('atlas:changed', sync);
            bus.off('atlas:ping', sync);
            bus.off('atlas:closed', sync);
            bus.off('workspace:mode', sync);
        };
        sync();
    })();
}

export async function stopNetworkAtlasLayerBridge() {
    if (unsub) {
        unsub();
        unsub = null;
    }
    await removeBridgeLayers(bridgeCtx?.mapService);
    started = false;
    bridgeCtx = null;
}
