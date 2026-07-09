/**
 * Dual Screen Mode — secondary window interactions (draw, fence, popups, drop, context menu)
 */
import bus from '../core/event-bus.js';
import mapService, { formatElevationLabel } from '../map/map-service.js';
import drawManager from '../map/draw-manager.js';
import { MessageType, createMessage, buildViewportPayload } from './protocol.js';
import {
    buildSelectionPayload,
    applySelectionPayload,
    shouldApplySelection
} from './selection-sync.js';

const ROLE = 'secondary';
let _selectionSyncInbound = false;
let _selectionUnsub = null;

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
    setupFileDrop(post);
    setupContextMenu(post);
    setupDrawCmdHandler();
    setupFenceHandlers(post);
    setupToastHandler();
    enhanceViewportBroadcast(post);

    return { teardown: () => { teardownDrawRelay(); teardownSelectionBridge(); } };
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

let _ctxDismissAC = null;

function dismissContextMenu() {
    document.querySelector('.map-context-menu')?.remove();
    if (_ctxDismissAC) { _ctxDismissAC.abort(); _ctxDismissAC = null; }
}

function setupContextMenu(post) {
    bus.on('map:contextmenu', (detail) => showSecondaryContextMenu(detail, post));
}

function showSecondaryContextMenu({ latlng, originalEvent, layerId, featureIndex, feature }, post) {
    dismissContextMenu();
    const menu = document.createElement('div');
    menu.className = 'map-context-menu';

    const items = [];

    if (feature && layerId != null) {
        items.push({ icon: '📋', label: 'View attributes', action: () => {
            const nearby = mapService.findFeaturesNearClick(latlng, layerId, featureIndex);
            const popupOptions = { forceFull: true };
            if (nearby.length > 0) mapService.showMultiPopup(nearby, latlng, popupOptions);
            else mapService.showPopup(feature, null, latlng, popupOptions);
        }});
        items.push({ icon: '✏️', label: 'Edit feature', action: () => {
            post(MessageType.POPUP_ACTION, { action: 'editFeature', layerId, featureIndex });
        }});
    }

    items.push({ icon: '📍', label: 'Copy coordinates', action: () => {
        const text = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        navigator.clipboard.writeText(text).then(() => showMapToast(`Copied: ${text}`, 'success'))
            .catch(() => showMapToast(text, 'info'));
    }});

    if (mapService.is3DEnabled()) {
        items.push({ icon: '⛰️', label: 'Get elevation', action: () => {
            const meters = mapService.queryElevationAt(latlng.lat, latlng.lng);
            if (meters == null) {
                showMapToast('Elevation unavailable — terrain tiles may still be loading', 'warning');
                return;
            }
            const text = formatElevationLabel(meters);
            const message = `Elevation: ${text}`;
            navigator.clipboard.writeText(text)
                .then(() => showMapToast(message, 'success'))
                .catch(() => showMapToast(message, 'info'));
        }});
    }

    if (mapService.isOrbiting()) {
        items.push({ icon: '⏹️', label: 'Stop camera orbit', action: () => {
            mapService.stopCameraOrbit();
            showMapToast('Camera orbit stopped', 'info');
        }});
    } else {
        items.push({ icon: '🎥', label: 'Orbit camera around point', action: () => {
            mapService.startCameraOrbit({ lat: latlng.lat, lng: latlng.lng });
            showMapToast('Camera orbiting — right-click to stop', 'info');
        }});
    }

    items.push({ icon: '🛣️', label: 'Open in Google Street View', action: () => {
        window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latlng.lat},${latlng.lng}`, '_blank', 'noopener');
    }});

    if (layerId) {
        items.push({ sep: true });
        items.push({ icon: '👁️', label: 'Toggle layer visibility', action: () => {
            post(MessageType.CTX_CMD, { action: 'toggleVisibility', layerId });
        }});
        items.push({ icon: '🔍', label: 'Zoom to layer', action: () => {
            post(MessageType.CTX_CMD, { action: 'zoomToLayer', layerId });
        }});
        items.push({ icon: '✦', label: 'Set as active layer', action: () => {
            post(MessageType.CTX_CMD, { action: 'setActiveLayer', layerId });
        }});
    }

    items.forEach(item => {
        if (item.sep) {
            menu.innerHTML += '<div class="ctx-sep"></div>';
            return;
        }
        const el = document.createElement('div');
        el.className = 'ctx-item';
        el.innerHTML = `<span class="ctx-icon">${item.icon}</span>${item.label}`;
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            dismissContextMenu();
            item.action();
        });
        menu.appendChild(el);
    });

    let x = originalEvent.clientX;
    let y = originalEvent.clientY;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    _ctxDismissAC = new AbortController();
    const sig = _ctxDismissAC.signal;
    requestAnimationFrame(() => {
        if (sig.aborted) return;
        document.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('.map-context-menu')) dismissContextMenu();
        }, { signal: sig });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') dismissContextMenu();
        }, { signal: sig });
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
    const { action, layerId, layerName } = payload || {};
    if (action === 'showToolbar' && layerId) {
        drawManager.showToolbar(layerId, layerName || 'Layer');
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

function enhanceViewportBroadcast(post) {
    // map-window.js calls broadcastViewport — patch via exported helper
}

export function broadcastViewportFromMap(map) {
    if (!map) return null;
    return buildViewportPayload(map, ROLE);
}
