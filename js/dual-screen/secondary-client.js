/**
 * Dual Screen Mode — secondary window interactions (draw, fence, popups, drop)
 */
import bus from '../core/event-bus.js';
import mapService from '../map/map-service.js';
import drawManager from '../map/draw-manager.js';
import { MessageType, createMessage, buildViewportPayload } from './protocol.js';
import { camerasNearlyEqual, suppressViewportEcho } from './viewport-echo.js';
import {
    buildSelectionPayload,
    applySelectionPayload,
    shouldApplySelection
} from './selection-sync.js';
import { attachPopupSelectionBridges } from './map-bridge.js';

const ROLE = 'secondary';
let _selectionSyncInbound = false;
let _selectionUnsub = null;
let _popupBridgeUnsub = null;

/**
 * @param {object} opts
 * @param {(type: string, payload: object) => void} opts.post
 * @param {() => import('./channel.js').DualScreenChannel | null} opts.getChannel
 */
export function initSecondaryClient({ post, getChannel }) {
    setupDrawRelay(post);
    setupPopupBridge(post);
    setupCoordSearchBridge(post);
    setupSelectionBridge(post);
    setupPopupMapBridges(post);
    setupFileDrop(post);
    setupDrawCmdHandler();
    setupFenceHandlers(post);
    setupToastHandler();
    enhanceViewportBroadcast(post);

    return {
        teardown: () => {
            teardownDrawRelay();
            teardownSelectionBridge();
            teardownPopupMapBridges();
        }
    };
}

let _drawUnsubs = [];

function setupDrawRelay(post) {
    const relay = (event, payload) => {
        post(MessageType.DRAW_EVENT, { event, ...payload });
    };
    _drawUnsubs = [
        bus.on('draw:featureCreated', (p) => relay('featureCreated', p)),
        bus.on('draw:featureEdited', (p) => relay('featureEdited', p)),
        bus.on('draw:featureDeleted', (p) => relay('featureDeleted', p))
    ];
}

function teardownDrawRelay() {
    _drawUnsubs.forEach(fn => fn());
    _drawUnsubs = [];
}

function setupPopupBridge(post) {
    bus.on('map:popup:edit', (hit) => {
        if (!hit) return;
        mapService.closePopup();
        post(MessageType.POPUP_ACTION, {
            action: 'editFeature',
            layerId: hit.layerId,
            featureIndex: hit.featureIndex
        });
    });
}

function setupCoordSearchBridge(post) {
    bus.on('coord-search:add-new', () => {
        const searchInfo = mapService.getSearchLatLng();
        if (!searchInfo) return;
        post(MessageType.POPUP_ACTION, { action: 'coordSearchAddNew', searchInfo });
    });
    bus.on('coord-search:add-existing', () => {
        const searchInfo = mapService.getSearchLatLng();
        if (!searchInfo) return;
        post(MessageType.POPUP_ACTION, { action: 'coordSearchAddExisting', searchInfo });
    });
    bus.on('coord-search:clear', () => {
        mapService.clearSearchMarker();
    });
}

function setupSelectionBridge(post) {
    teardownSelectionBridge();
    _selectionUnsub = bus.on('selection:changed', (detail) => {
        if (_selectionSyncInbound) return;
        post(MessageType.SELECTION, buildSelectionPayload('secondary', mapService, detail));
    });
}

function teardownSelectionBridge() {
    _selectionUnsub?.();
    _selectionUnsub = null;
}

function setupPopupMapBridges(post) {
    teardownPopupMapBridges();
    _popupBridgeUnsub = attachPopupSelectionBridges({
        post,
        getSelectionCount: () => {
            const id = mapService.getActiveLayerId?.();
            if (id) return mapService.getSelectionCount?.(id) ?? 0;
            return mapService.getTotalSelectionCount?.() ?? 0;
        },
        isDrawToolActive: () => !!drawManager.activeTool
    });
}

function teardownPopupMapBridges() {
    _popupBridgeUnsub?.();
    _popupBridgeUnsub = null;
}

export function applyRemoteSelection(payload) {
    if (!shouldApplySelection({ payload }, 'secondary')) return;
    applySelectionPayload(mapService, payload, {
        setInbound: (v) => { _selectionSyncInbound = v; }
    });
}

function setupFileDrop(post) {
    const container = document.getElementById('map-container');
    if (!container) return;

    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    container.addEventListener('dragover', prevent);
    container.addEventListener('drop', async (e) => {
        prevent(e);
        const files = Array.from(e.dataTransfer?.files || []);
        if (!files.length) return;

        const serialized = await Promise.all(files.map(async (file) => {
            const buffer = await file.arrayBuffer();
            return {
                name: file.name,
                type: file.type,
                lastModified: file.lastModified,
                buffer
            };
        }));

        post(MessageType.FILE_DROP, { files: serialized });
    });
}

const _toastEl = () => {
    let el = document.getElementById('map-window-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'map-window-toast';
        el.className = 'map-window-toast hidden';
        document.body.appendChild(el);
    }
    return el;
};

function showMapToast(message, type = 'info') {
    const el = _toastEl();
    el.textContent = message;
    el.className = `map-window-toast map-window-toast--${type}`;
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.classList.add('hidden'); }, 4000);
}

function setupToastHandler() {
    // handled in handleMessage via applyToast
}

export function applyMapToast(payload) {
    if (!payload?.message) return;
    showMapToast(payload.message, payload.type || 'info');
}

function setupDrawCmdHandler() {
    // registered via export handleDrawCmd
}

export function handleDrawCmd(payload) {
    const { action, layerId, layerName, startTool } = payload || {};
    if (action === 'showToolbar' && layerId) {
        drawManager.showToolbar(layerId, layerName || 'Layer');
        if (startTool) drawManager.startTool(startTool);
        showMapToast('Draw tools active on map window', 'info');
        return;
    }
    if (action === 'hideToolbar') {
        drawManager.hideToolbar();
    }
}

async function setupFenceHandlers(post) {
    // fence draw triggered via DRAW_CMD action startFence
}

export async function handleFenceDrawCmd(post) {
    const bbox = await mapService.startImportFenceDraw();
    if (!bbox) {
        showMapToast('Fence cancelled', 'info');
        return;
    }
    post(MessageType.FENCE_SET, { bbox });
    showMapToast('Import fence placed', 'success');
}

export function handleFenceClearCmd() {
    mapService.clearImportFence();
}

export function handleDrawCmdMessage(payload, post) {
    if (payload?.action === 'startFence') {
        handleFenceDrawCmd(post);
        return;
    }
    if (payload?.action === 'clearFence') {
        handleFenceClearCmd();
        return;
    }
    if (payload?.action === 'applyFence' && payload.bbox) {
        mapService.setImportFenceFromBbox(payload.bbox);
        return;
    }
    if (payload?.action === 'clearSearchMarker') {
        mapService.clearSearchMarker();
        return;
    }
    handleDrawCmd(payload);
}

function enhanceViewportBroadcast() {
    guardRemoteMapJumps(mapService.getMap?.());
}

/**
 * A remote jumpTo must not bounce moveend back as another viewport message.
 * MapLibre fires that event after jumpTo returns.
 * @param {object | null | undefined} map
 */
export function guardRemoteMapJumps(map) {
    if (!map || map.__gisViewportEchoGuard || typeof map.jumpTo !== 'function') return;
    map.__gisViewportEchoGuard = true;
    const jumpTo = map.jumpTo.bind(map);
    map.jumpTo = (camera, eventData) => {
        const center = map.getCenter?.();
        const zoom = Number(map.getZoom?.());
        const current = center && Number.isFinite(zoom) ? {
            center: [center.lng, center.lat],
            zoom,
            bearing: Number(map.getBearing?.()) || 0,
            pitch: Number(map.getPitch?.()) || 0
        } : null;
        if (camerasNearlyEqual(current, camera)) return undefined;
        const release = suppressViewportEcho(map);
        try {
            return jumpTo(camera, eventData);
        } catch (err) {
            release();
            throw err;
        }
    };
}

export function broadcastViewportFromMap(map) {
    if (!map) return null;
    return buildViewportPayload(map, ROLE);
}
