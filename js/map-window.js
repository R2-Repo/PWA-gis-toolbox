/**
 * Dual Screen Mode — secondary map window entry
 */
import mapService from './map/map-service.js';
import { DualScreenChannel } from './dual-screen/channel.js';
import bus from './core/event-bus.js';
import {
    MessageType,
    readDualSessionId,
    shouldApplyViewport
} from './dual-screen/protocol.js';
import { PROTOCOL_MISMATCH_NOTICE } from './dual-screen/storage-hint.js';
import { createSecondaryProtocol } from './dual-screen/secondary-protocol.js';
import { createSpatialDataset } from './core/data-model.js';
import {
    initSecondaryClient,
    applyMapToast,
    handleDrawCmdMessage,
    broadcastViewportFromMap,
    applyRemoteSelection
} from './dual-screen/secondary-client.js';
import { applyForwardedMapCall, runForwardedMapRpc, warnDualScreenDev } from './dual-screen/map-bridge.js';
import { mountBasemapToggle, syncBasemapToggleActive } from './map/basemap-catalog.js';
import { exportPopoutMapView } from './dual-screen/popout-export.js';
import {
    catalogEntryFromDataset,
    notePopoutMapCommand,
    removePopoutLayer,
    reorderPopoutLayers,
    replacePopoutLayers,
    upsertPopoutLayer,
    patchPopoutLayer
} from './dual-screen/popout-layer-catalog.js';
import {
    bindPopoutContextMenu,
    buildPopoutContextMenuItems,
    requestPopoutCommand
} from './dual-screen/popout-context-menu.js';

const ROLE = 'secondary';

let channel = null;
/** @type {ReturnType<typeof createSecondaryProtocol> | null} */
let protocol = null;
let suppressViewportBroadcast = false;
let lastAppliedViewportId = null;
let viewportDebounce = null;
let mapReady = false;
let versionNoticeShown = false;

function post(type, payload) {
    protocol?.enqueueOutbound(type, payload);
}

function sendBye() {
    protocol?.sendGoodbye();
}

function showProtocolMismatch() {
    if (versionNoticeShown) return;
    versionNoticeShown = true;
    applyMapToast({ message: PROTOCOL_MISMATCH_NOTICE, type: 'error' });
}

/** Close this secondary map window. */
function closeSelfWindow() {
    try {
        window.close();
    } catch (_) { /* ignore */ }
}

function isWorkspaceLayerMeta(entry) {
    return entry?.storage === 'workspace' || entry?.type === 'spatial-chunked';
}

function isPmtilesEntry(entry) {
    return entry?.type === 'pmtiles' || entry?.source?.format === 'pmtiles' || !!entry?.pmtiles?.url;
}

function canApplyMapEntry(entry) {
    if (!entry?.id) return false;
    if (entry.geojson) return true;
    if (isWorkspaceLayerMeta(entry)) return true;
    if (entry.type === 'service' && entry.service?.url) return true;
    if (isPmtilesEntry(entry)) return true;
    return false;
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
    if (entry.service) dataset.service = entry.service;
    if (entry.pmtiles) dataset.pmtiles = entry.pmtiles;
    if (entry.schema) dataset.schema = entry.schema;
    if (entry.datasetProfile) dataset.datasetProfile = entry.datasetProfile;
    if (entry.workspaceAttributeFilter) dataset.workspaceAttributeFilter = entry.workspaceAttributeFilter;
    if (Array.isArray(entry.workspaceFilterIndices)) {
        dataset._workspaceFilterIndices = entry.workspaceFilterIndices;
    }
    if (entry.activeFilter) dataset._activeFilter = entry.activeFilter;
    if (entry.pictureMarkers) dataset._arcgisPictureMarkers = entry.pictureMarkers;
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
    if (layerMeta) upsertPopoutLayer({ ...layerMeta, style });
    else patchPopoutLayer(layerId, { style });
}

function applySnapshot(payload) {
    if (!payload) return;
    const { layers, viewport, basemap, is3d, basemapTone } = payload;
    replacePopoutLayers(layers || []);

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
        if (!canApplyMapEntry(entry)) return;
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
    if (payload.preserveViewport) {
        mapService.reconcile3DState({ emitEvent: true });
    } else if (viewport && map) {
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

    if (basemapTone) {
        mapService.setBasemapTone(basemapTone, { emitEvent: false });
    }
}

function applyLayerAdd(payload) {
    const { dataset: raw, colorIndex, fit, style } = payload || {};
    if (!canApplyMapEntry(raw)) return;
    const layer = entryToDataset(raw);
    if (!layer) return;
    mapService.removeLayer(layer.id);
    if (style) {
        mapService.setLayerStyle(layer.id, style);
    }
    mapService.addLayer(layer, colorIndex ?? 0, { fit: !!fit });
    const entry = catalogEntryFromDataset(raw);
    if (entry) {
        if (style) entry.style = style;
        upsertPopoutLayer(entry);
    }
}

function applyLayerRemove(payload) {
    if (payload?.id) {
        mapService.removeLayer(payload.id);
        removePopoutLayer(payload.id);
    }
}

function applyLayerOrder(payload) {
    const { orderedIds } = payload || {};
    if (!orderedIds?.length) return;
    mapService.syncLayerOrder(orderedIds);
    reorderPopoutLayers(orderedIds);
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
    if (!basemap) return;
    syncBasemapToggleActive(basemap);
}

function syncDimensionToggle(is3d) {
    document.querySelectorAll('#dimension-toggle .header-toggle-option').forEach(b => {
        const isActive = b.dataset.value === (is3d ? '3d' : '2d');
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', String(isActive));
    });
}

function broadcastViewport() {
    const map = mapService.getMap();
    if (suppressViewportBroadcast || !map) return;
    post(MessageType.VIEWPORT, broadcastViewportFromMap(map));
}

function onMapReady() {
    const map = mapService.getMap();
    if (!map || mapReady) return;
    map.on('moveend', () => {
        clearTimeout(viewportDebounce);
        viewportDebounce = setTimeout(broadcastViewport, 80);
    });
    mapReady = true;
    protocol?.markHandshakeReady();
}

let mapCmdChain = Promise.resolve();

function applyMapCmd(payload) {
    // Async adds (service refresh, PMTiles header) must finish before the next
    // style, filter, or remove, or the pop-out applies them to a layer that
    // is still being built.
    mapCmdChain = mapCmdChain.then(async () => {
        notePopoutMapCommand(payload?.method, payload?.args);
        const result = applyForwardedMapCall(mapService, payload);
        if (result && typeof result.then === 'function') await result;
    }).catch((err) => {
        warnDualScreenDev(`[DualScreen] map call failed: ${err?.message || err}`);
    });
}

async function handleMapRpc(payload, postFn) {
    await runForwardedMapRpc(mapService, payload, postFn);
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
            closeSelfWindow();
            break;
        default:
            break;
    }
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
        closeSelfWindow();
    });

    mountBasemapToggle(document.getElementById('basemap-toggle'), {
        getCurrentKey: () => mapService.getCurrentBasemap?.() || 'voyager',
        onSelect: (key) => {
            syncBasemapToggle(key);
            mapService.setBasemap(key);
            post(MessageType.MAP_CHROME, { basemap: key });
        }
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
}

async function onExportMapView(format, options) {
    try {
        const result = await exportPopoutMapView(mapService, format, {
            ...options,
            onInfo: (message) => showMapWindowToast(message, 'info'),
            onWarning: (message) => showMapWindowToast(message, 'warning')
        });
        const label = format === 'gif' ? 'GIF' : format.toUpperCase();
        showMapWindowToast(`${label} saved.`, 'success');
        return result;
    } catch (err) {
        showMapWindowToast(err?.message || 'Map export failed.', 'error');
        throw err;
    }
}

async function mountPopoutChrome() {
    const [{ mountMapPrintMenu }, { mountMapContextMenu }, { mountPopoutLegend }] = await Promise.all([
        import('../react/header/mountMapPrintMenu.jsx'),
        import('../react/map/mountMapContextMenu.jsx'),
        import('../react/map/mountPopoutLegend.jsx')
    ]);
    const printHost = document.getElementById('map-print-host');
    if (printHost) {
        mountMapPrintMenu(printHost, {
            onExportMapView,
            onPresentationLink: () => requestPopoutCommand({ action: 'presentationLink' })
        });
    }
    const menuHost = document.createElement('div');
    menuHost.id = 'map-window-context-menu-host';
    document.body.appendChild(menuHost);
    mountMapContextMenu(menuHost, { buildItems: buildPopoutContextMenuItems });
    const legendHost = document.createElement('div');
    legendHost.id = 'map-window-legend-host';
    document.getElementById('map-container')?.appendChild(legendHost);
    mountPopoutLegend(legendHost);
}

function boot() {
    if (typeof BroadcastChannel === 'undefined') {
        document.body.innerHTML = '<p style="padding:24px">Dual Screen requires BroadcastChannel (modern browser).</p>';
        return;
    }

    const sessionId = readDualSessionId(window.location);
    protocol = createSecondaryProtocol({
        sessionId,
        post: (message) => channel?.post(message),
        onApply: dispatchMessage
    });
    channel = new DualScreenChannel(ROLE, (msg) => protocol.receive(msg), {
        sessionId,
        onProtocolMismatch: showProtocolMismatch
    });
    mapService.init('map-container');
    bindPopoutContextMenu(post);
    bus.on('map:3dChanged', (is3d) => {
        syncDimensionToggle(!!is3d);
        post(MessageType.MAP_CHROME, { is3d: !!is3d });
    });
    setupHeaderControls();
    void setupModalHost();
    void mountPopoutChrome();
    initSecondaryClient({ post, getChannel: () => channel });

    const map = mapService.getMap();
    if (map?.loaded()) onMapReady();
    else map?.once('load', onMapReady);

    window.addEventListener('pagehide', () => {
        protocol?.handlePageHide();
        channel?.close();
        channel = null;
    });
    window.addEventListener('beforeunload', () => {
        protocol?.handlePageHide();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
