/**
 * Dual Screen Mode — secondary map window entry
 */
import mapService from './map/map-service.js';
import { DualScreenChannel } from './dual-screen/channel.js';
import {
    MessageType,
    createMessage,
    shouldApplyViewport
} from './dual-screen/protocol.js';
import { createSpatialDataset } from './core/data-model.js';
import {
    initSecondaryClient,
    applyMapToast,
    handleDrawCmdMessage,
    broadcastViewportFromMap,
    applyRemoteSelection
} from './dual-screen/secondary-client.js';
import { setupMapPrintMenu } from './map/map-export.js';

const ROLE = 'secondary';
const QUEUED_MESSAGE_TYPES = new Set([
    MessageType.SNAPSHOT,
    MessageType.LAYER_ADD,
    MessageType.LAYER_STYLE
]);

let channel = null;
let suppressViewportBroadcast = false;
let lastAppliedViewportId = null;
let viewportDebounce = null;
let byeSent = false;
let mapReady = false;
/** @type {object[]} */
const pendingMessages = [];

function post(type, payload) {
    channel?.post(createMessage(ROLE, type, payload));
}

function sendBye() {
    if (byeSent) return;
    byeSent = true;
    post(MessageType.BYE, {});
}

function isWorkspaceLayerMeta(entry) {
    return entry?.storage === 'workspace' || entry?.type === 'spatial-chunked';
}

function entryToDataset(entry) {
    if (!entry?.id) return null;
    const geojson = entry.geojson || { type: 'FeatureCollection', features: [] };
    const dataset = createSpatialDataset(entry.name || entry.id, geojson, entry.source || { format: 'sync' });
    dataset.id = entry.id;
    dataset.type = entry.type || 'spatial';
    dataset.visible = entry.visible !== false;
    if (entry.storage) dataset.storage = entry.storage;
    if (entry.workspaceLayerId) dataset.workspaceLayerId = entry.workspaceLayerId;
    if (entry.scaleRangeEnabled) {
        dataset.scaleRangeEnabled = true;
        dataset.minScale = entry.minScale ?? null;
        dataset.maxScale = entry.maxScale ?? null;
    }
    if (entry.mapLabels) dataset._mapLabels = entry.mapLabels;
    if (entry.kmlExport) dataset._kmlExport = entry.kmlExport;
    return dataset;
}

function applyLayerStyle(layerId, dataset, style) {
    if (!layerId || !style) return;
    mapService.setLayerStyle(layerId, style);
    if (!dataset) return;
    mapService.restyleLayer?.(layerId, dataset, style);
}

function applyLayerStyleMessage(payload) {
    const { layerId, style, layerMeta } = payload || {};
    if (!layerId || !style) return;
    const dataset = layerMeta ? entryToDataset(layerMeta) : null;
    applyLayerStyle(layerId, dataset, style);
}

function applySnapshot(payload) {
    if (!payload) return;
    const { layers, viewport, basemap, is3d } = payload;

    if (basemap && basemap !== mapService.getCurrentBasemap()) {
        mapService.setBasemap(basemap);
        syncBasemapToggle(basemap);
    }

    if (mapService.getMap()) {
        for (const id of mapService.getLayerIds()) {
            mapService.removeLayer(id);
        }
    }

    (layers || []).forEach((entry, i) => {
        if (!entry.geojson && !isWorkspaceLayerMeta(entry)) return;
        const dataset = entryToDataset(entry);
        if (!dataset) return;
        if (entry.style) {
            applyLayerStyle(entry.id, dataset, entry.style);
        } else {
            mapService.addLayer(dataset, i, { fit: false });
        }
    });

    mapService.set3DEnabled(!!is3d);
    syncDimensionToggle(!!is3d);

    const map = mapService.getMap();
    if (viewport && map) {
        suppressViewportBroadcast = true;
        mapService.reconcile3DState({
            camera: {
                center: viewport.center,
                zoom: viewport.zoom,
                bearing: viewport.bearing ?? 0,
                pitch: is3d ? (viewport.pitch ?? 30) : 0
            },
            emitEvent: true
        });
        suppressViewportBroadcast = false;
    } else {
        mapService.reconcile3DState({ emitEvent: true });
    }

    if (payload.activeLayerId) {
        mapService.setActiveLayerId(payload.activeLayerId);
    }
}

function applyLayerAdd(payload) {
    const { dataset: raw, colorIndex, fit, style } = payload || {};
    if (!raw?.geojson && !isWorkspaceLayerMeta(raw)) return;
    const layer = entryToDataset(raw);
    if (!layer) return;
    mapService.removeLayer(layer.id);
    if (style) {
        applyLayerStyle(layer.id, layer, style);
    } else {
        mapService.addLayer(layer, colorIndex ?? 0, { fit: !!fit });
    }
}

function applyLayerRemove(payload) {
    if (payload?.id) mapService.removeLayer(payload.id);
}

function applyLayerOrder(payload) {
    const { orderedIds } = payload || {};
    if (!orderedIds?.length) return;
    mapService.syncLayerOrder(orderedIds);
}

function applyViewport(payload) {
    const map = mapService.getMap();
    if (!payload || !map) return;
    if (payload.command === 'fitAll') {
        mapService.fitToAll();
        return;
    }
    if (payload.command === 'fitLayers' && payload.layerIds?.length) {
        mapService.fitToLayers(payload.layerIds);
        return;
    }
    if (payload.command === 'fitBounds' && payload.bounds) {
        mapService.fitBounds(payload.bounds, payload.options || {});
        return;
    }
    if (payload.center) {
        map.jumpTo({
            center: payload.center,
            zoom: payload.zoom ?? map.getZoom(),
            bearing: payload.bearing ?? 0,
            pitch: payload.pitch ?? 0
        });
    }
}

function syncBasemapToggle(basemap) {
    document.querySelectorAll('#basemap-toggle .header-toggle-option').forEach(b => {
        b.classList.toggle('active', b.dataset.value === basemap);
    });
}

function syncDimensionToggle(is3d) {
    document.querySelectorAll('#dimension-toggle .header-toggle-option').forEach(b => {
        b.classList.toggle('active', b.dataset.value === (is3d ? '3d' : '2d'));
    });
}

function broadcastViewport() {
    const map = mapService.getMap();
    if (suppressViewportBroadcast || !map) return;
    post(MessageType.VIEWPORT, broadcastViewportFromMap(map));
}

function flushPendingMessages() {
    const queue = pendingMessages.splice(0, pendingMessages.length);
    for (const msg of queue) {
        dispatchMessage(msg);
    }
}

function onMapReady() {
    const map = mapService.getMap();
    if (!map) return;
    map.on('moveend', () => {
        clearTimeout(viewportDebounce);
        viewportDebounce = setTimeout(broadcastViewport, 80);
    });
    mapReady = true;
    flushPendingMessages();
    post(MessageType.HELLO, {});
}

function applyMapCmd(payload) {
    const { action, geojson, duration, options, layerId, range, latitude, style, dataset } = payload || {};
    switch (action) {
        case 'showTempFeature':
            mapService.showTempFeature(geojson, duration ?? 10000, options);
            break;
        case 'showRouteMilepostPreview':
            mapService.showRouteMilepostPreview?.(geojson, duration ?? 0);
            break;
        case 'showWirelessPlanningPreview':
            mapService.showWirelessPlanningPreview?.(geojson, duration ?? 0);
            break;
        case 'showProjectStationingPreview':
            mapService.showProjectStationingPreview?.(geojson, duration ?? 0);
            break;
        case 'clearTempFeatures':
            mapService.clearTempFeatures?.();
            break;
        case 'cancelInteraction':
            mapService.cancelInteraction?.();
            break;
        case 'setLayerScaleRange': {
            const map = mapService.getMap();
            if (!layerId || !range || !map) break;
            mapService.setLayerScaleRange(
                layerId,
                range,
                latitude ?? map.getCenter().lat
            );
            break;
        }
        case 'restyleLayer':
            if (layerId && style) {
                applyLayerStyle(layerId, dataset, style);
            }
            break;
        default:
            break;
    }
}

async function handleMapRpc(payload, postFn) {
    const { requestId, method, args = [] } = payload || {};
    try {
        const fn = mapService[method];
        if (typeof fn !== 'function') {
            throw new Error(`Unknown map method: ${method}`);
        }
        const result = await fn.apply(mapService, args);
        postFn(MessageType.MAP_RPC_RESULT, { requestId, result });
    } catch (err) {
        postFn(MessageType.MAP_RPC_RESULT, {
            requestId,
            error: err?.message || String(err)
        });
    }
}

function dispatchMessage(msg) {
    switch (msg.type) {
        case MessageType.SNAPSHOT:
            applySnapshot(msg.payload);
            break;
        case MessageType.LAYER_ADD:
            applyLayerAdd(msg.payload);
            break;
        case MessageType.LAYER_STYLE:
            applyLayerStyleMessage(msg.payload);
            break;
        case MessageType.LAYER_REMOVE:
            applyLayerRemove(msg.payload);
            break;
        case MessageType.LAYER_ORDER:
            applyLayerOrder(msg.payload);
            break;
        case MessageType.VIEWPORT:
            if (shouldApplyViewport(msg, ROLE, lastAppliedViewportId)) {
                lastAppliedViewportId = msg.msgId;
                suppressViewportBroadcast = true;
                applyViewport(msg.payload);
                suppressViewportBroadcast = false;
            }
            break;
        case MessageType.DRAW_CMD:
            handleDrawCmdMessage(msg.payload, post);
            break;
        case MessageType.TOAST:
            applyMapToast(msg.payload);
            break;
        case MessageType.SELECTION:
            applyRemoteSelection(msg.payload);
            break;
        case MessageType.MAP_RPC:
            void handleMapRpc(msg.payload, post);
            break;
        case MessageType.MAP_CMD:
            applyMapCmd(msg.payload);
            break;
        case MessageType.BYE:
            window.close();
            break;
        default:
            break;
    }
}

function handleMessage(msg) {
    if (!mapReady && QUEUED_MESSAGE_TYPES.has(msg.type)) {
        pendingMessages.push(msg);
        return;
    }
    dispatchMessage(msg);
}

function showMapWindowToast(message, type = 'info') {
    applyMapToast({ message, type });
}

async function setupModalHost() {
    const host = document.createElement('div');
    host.id = 'map-window-modal-host';
    document.body.appendChild(host);
    const { mountModalHost } = await import('../react/ui/mountModalHost.jsx');
    mountModalHost(host);
}

function setupHeaderControls() {
    document.getElementById('btn-exit-dual-screen')?.addEventListener('click', () => {
        sendBye();
        try {
            if (window.opener && !window.opener.closed) {
                window.opener.postMessage({ type: 'gis-toolbox-dual-screen-exit' }, window.location.origin);
            }
        } catch (_) { /* ignore */ }
        window.close();
    });

    document.getElementById('basemap-toggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-value]');
        if (!btn) return;
        syncBasemapToggle(btn.dataset.value);
        mapService.setBasemap(btn.dataset.value);
        post(MessageType.MAP_CHROME, { basemap: btn.dataset.value });
    });

    document.getElementById('dimension-toggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-value]');
        if (!btn) return;
        const is3d = btn.dataset.value === '3d';
        syncDimensionToggle(is3d);
        if (is3d) mapService.enable3D();
        else mapService.disable3D();
        post(MessageType.MAP_CHROME, { is3d });
    });

    setupMapPrintMenu({
        menuRoot: document.getElementById('map-print-menu'),
        mapService,
        showToast: showMapWindowToast,
        blockWhenDualScreen: false
    });
}

function boot() {
    if (typeof BroadcastChannel === 'undefined') {
        document.body.innerHTML = '<p style="padding:24px">Dual Screen requires BroadcastChannel (modern browser).</p>';
        return;
    }

    channel = new DualScreenChannel(ROLE, handleMessage);
    mapService.init('map-container');
    setupHeaderControls();
    void setupModalHost();
    initSecondaryClient({ post, getChannel: () => channel });

    const map = mapService.getMap();
    if (map?.loaded()) onMapReady();
    else map?.once('load', onMapReady);

    post(MessageType.HELLO, {});

    const teardownSecondary = () => {
        sendBye();
        channel?.close();
        channel = null;
    };

    window.addEventListener('beforeunload', teardownSecondary);
    window.addEventListener('pagehide', (e) => {
        if (!e.persisted) teardownSecondary();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
