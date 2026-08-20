/**
 * Dual Screen Mode — primary-window lifecycle & sync orchestration
 */
import { getLayers, getActiveLayer } from '../core/state.js';
import { isSpatialLayer, isWorkspaceLayer } from '../core/data-model.js';
import mapService from '../map/map-service.js';
import { DualScreenChannel } from './channel.js';
import {
    MessageType,
    createMessage,
    buildSnapshotPayload,
    boundsFromViewportPayload,
    serializeMapRpcArgs,
    serializeLayerMetaForRestyle
} from './protocol.js';
import { setDualScreenActiveHint } from './storage-hint.js';
import { scheduleMapResizeAfterLayout, syncDualScreenPrimaryUi } from './layout.js';
import {
    applySelectionPayload,
    installPrimarySelectionSync,
    shouldApplySelection
} from './selection-sync.js';
import {
    isSecondaryMapWindowOpen,
    openSecondaryMapWindow
} from './window-open.js';
import { syncBasemapToggleActive } from '../map/basemap-catalog.js';
import bus from '../core/event-bus.js';

const POLL_MS = 500;
const ACTIVATE_HANDSHAKE_MS = 5000;

class DualScreenCoordinator {
    constructor() {
        this.isActive = false;
        this._mapWindow = null;
        this._channel = null;
        this._pollTimer = null;
        this._lastViewport = null;
        this._lastBounds = null;
        this._secondaryReady = false;
        /** @type {Set<(active: boolean) => void>} */
        this._stateListeners = new Set();
        this._handlers = {};
        /** @type {[number, number, number, number] | null} */
        this._fenceBbox = null;
        this._deactivating = false;
        this._pendingActivation = false;
        /** @type {ReturnType<typeof setTimeout> | null} */
        this._activateTimeout = null;
        /** @type {((ok: boolean) => void) | null} */
        this._activateResolve = null;
        this._selectionSyncInbound = false;
        /** @type {(() => void) | null} */
        this._selectionSyncTeardown = null;
        this._rpcSeq = 0;
        /** @type {Map<string, { resolve: Function, reject: Function, timeout: ReturnType<typeof setTimeout> }>} */
        this._rpcPending = new Map();
    }

    setFenceBbox(bbox) {
        this._fenceBbox = bbox || null;
    }

    /**
     * Subscribe to dual-screen active state changes.
     * @param {(active: boolean) => void} fn
     * @returns {() => void} unsubscribe
     */
    onStateChange(fn) {
        if (typeof fn !== 'function') return () => {};
        this._stateListeners.add(fn);
        return () => { this._stateListeners.delete(fn); };
    }

    /** @param {Partial<Record<string, Function>>} handlers */
    setHandlers(handlers) {
        this._handlers = { ...this._handlers, ...handlers };
    }

    _notify() {
        syncDualScreenPrimaryUi(this.isActive);
        for (const fn of this._stateListeners) {
            try { fn(this.isActive); } catch (err) {
                console.warn('[DualScreen] state listener failed', err);
            }
        }
    }

    _isMobile() {
        return window.innerWidth < 768;
    }

    _clearActivateTimeout() {
        if (this._activateTimeout) {
            clearTimeout(this._activateTimeout);
            this._activateTimeout = null;
        }
    }

    _abortPendingActivation() {
        this._clearActivateTimeout();
        this._pendingActivation = false;
        if (this._channel) {
            this._channel.post(createMessage('primary', MessageType.BYE, {}));
            this._channel.close();
            this._channel = null;
        }
        this._mapWindow = null;
        const resolve = this._activateResolve;
        this._activateResolve = null;
        resolve?.(false);
    }

    /**
     * @returns {Promise<boolean>} true if dual mode activated
     */
    async activate() {
        if (this.isActive) {
            await this._focusMapWindow();
            return true;
        }
        if (this._isMobile()) return false;
        if (typeof BroadcastChannel === 'undefined') {
            console.warn('[DualScreen] BroadcastChannel not supported');
            return false;
        }
        if (this._pendingActivation) return false;

        this._mapWindow = await openSecondaryMapWindow();

        if (isSecondaryMapWindowOpen(this._mapWindow)) {
            this._completeActivation();
            return true;
        }

        // Popup may have opened without a Window ref (e.g. cached script used noreferrer).
        this._pendingActivation = true;
        this._channel = new DualScreenChannel('primary', (msg) => this._handleMessage(msg));

        return new Promise((resolve) => {
            this._activateResolve = resolve;
            this._activateTimeout = setTimeout(() => {
                if (this._pendingActivation) this._abortPendingActivation();
            }, ACTIVATE_HANDSHAKE_MS);
        });
    }

    _completeActivation() {
        if (this.isActive) return;

        this._pendingActivation = false;
        this._clearActivateTimeout();

        // Tear down primary map before isActive — getMap() returns null once dual-screen is active.
        if (mapService.getMap()) {
            this._lastViewport = this._captureViewport();
            mapService.destroy();
        }

        this.isActive = true;
        setDualScreenActiveHint(typeof sessionStorage !== 'undefined' ? sessionStorage : null, true);
        this._secondaryReady = false;

        if (!this._channel) {
            this._channel = new DualScreenChannel('primary', (msg) => this._handleMessage(msg));
        }

        this._startPoll();
        this._selectionSyncTeardown = installPrimarySelectionSync(
            mapService,
            (payload) => this.broadcastSelection(payload),
            () => this.isActive,
            () => this._selectionSyncInbound
        );
        this._notify();
    }

    /**
     * @param {{ fromSecondaryBye?: boolean }} [options]
     */
    deactivate(options = {}) {
        if (this._pendingActivation) {
            this._abortPendingActivation();
            return;
        }
        if (!this.isActive || this._deactivating) return;

        this._deactivating = true;
        try {
            this._stopPoll();
            this._selectionSyncTeardown?.();
            this._selectionSyncTeardown = null;

            if (!options.fromSecondaryBye) {
                if (this._channel) {
                    this._channel.post(createMessage('primary', MessageType.BYE, {}));
                }
                if (isSecondaryMapWindowOpen(this._mapWindow)) {
                    try { void this._mapWindow.close(); } catch (_) { /* ignore */ }
                }
            }

            if (this._channel) {
                this._channel.close();
                this._channel = null;
            }

            this._mapWindow = null;
            this.isActive = false;
            this._secondaryReady = false;
            this._lastBounds = null;
            this._rejectAllMapRpc('Dual screen deactivated');
            setDualScreenActiveHint(typeof sessionStorage !== 'undefined' ? sessionStorage : null, false);

            // Restore normal 3-panel layout before MapLibre init so canvas size is correct.
            this._notify();
            this._restorePrimaryMap();
        } finally {
            this._deactivating = false;
        }
    }

    _startPoll() {
        this._stopPoll();
        this._pollTimer = setInterval(() => {
            if (this._mapWindow?.closed) {
                this.deactivate({ fromSecondaryBye: true });
            }
        }, POLL_MS);
    }

    _stopPoll() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    _captureViewport() {
        const map = mapService.getMap();
        if (!map) return this._lastViewport;
        const c = map.getCenter();
        const b = map.getBounds();
        return {
            center: [c.lng, c.lat],
            zoom: map.getZoom(),
            bearing: map.getBearing(),
            pitch: map.getPitch(),
            bounds: {
                west: b.getWest(),
                south: b.getSouth(),
                east: b.getEast(),
                north: b.getNorth()
            }
        };
    }

    _restorePrimaryMap() {
        const container = document.getElementById('map-container');
        if (!container) return;

        const placeholder = container.querySelector('.dual-screen-placeholder');
        if (placeholder) placeholder.remove();
        container.classList.remove('dual-screen-map-hidden');

        const applyRestoredLayers = () => {
            const allLayers = getLayers();
            const mapLayers = allLayers.filter(isSpatialLayer);
            const restoredIds = [];
            for (const layer of mapLayers) {
                const layerIdx = allLayers.indexOf(layer);
                try {
                    if (isWorkspaceLayer(layer)) {
                        restoredIds.push(layer.id);
                        void mapService.addWorkspaceLayer(layer, layerIdx, { fit: false });
                    } else if (layer.geojson) {
                        restoredIds.push(layer.id);
                        mapService.addLayer(layer, layerIdx, { fit: false });
                    }
                } catch (err) {
                    console.warn('[DualScreen] restore layer failed', layer.id, err);
                }
            }

            const map = mapService.getMap();
            if (this._lastViewport && map) {
                mapService.reconcile3DState({
                    camera: {
                        center: this._lastViewport.center,
                        zoom: this._lastViewport.zoom,
                        bearing: this._lastViewport.bearing ?? 0,
                        pitch: mapService.is3DEnabled()
                            ? (this._lastViewport.pitch ?? 0)
                            : 0
                    },
                    emitEvent: true
                });
            } else if (restoredIds.length) {
                mapService.fitToAll();
                mapService.reconcile3DState({ emitEvent: true });
            } else {
                mapService.reconcile3DState({ emitEvent: true });
            }

            mapService.setBasemapTone(mapService.getBasemapTone(), { emitEvent: false });

            bus.emit('map:chrome', {
                basemap: mapService.getCurrentBasemap(),
                is3d: mapService.is3DEnabled(),
                basemapTone: mapService.getBasemapTone()
            });

            scheduleMapResizeAfterLayout(mapService);
            bus.emit('dual-screen:primary-restored');
        };

        if (!mapService.getMap()) {
            mapService.init('map-container');
        }

        const map = mapService.getMap();
        if (map && typeof map.loaded === 'function' && !map.loaded()) {
            map.once('load', applyRestoredLayers);
            return;
        }
        applyRestoredLayers();
    }

    _applyMapChrome(payload) {
        if (!payload) return;
        if (payload.basemap && payload.basemap !== mapService.getCurrentBasemap()) {
            mapService.setCurrentBasemap(payload.basemap);
            syncBasemapToggleActive(payload.basemap);
        }
        if (payload.is3d !== undefined) {
            mapService.set3DEnabled(!!payload.is3d);
            document.querySelectorAll('#dimension-toggle .header-toggle-option').forEach(btn => {
                const isActive = btn.dataset.value === (payload.is3d ? '3d' : '2d');
                btn.classList.toggle('active', isActive);
                btn.setAttribute('aria-pressed', String(isActive));
            });
        }
        if (payload.basemapTone) {
            mapService.setBasemapTone(payload.basemapTone, { emitEvent: false });
        }
        bus.emit('map:chrome', {
            basemap: payload.basemap,
            is3d: payload.is3d,
            basemapTone: payload.basemapTone ?? mapService.getBasemapTone()
        });
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case MessageType.HELLO:
                if (this._pendingActivation) {
                    this._completeActivation();
                    const resolve = this._activateResolve;
                    this._activateResolve = null;
                    resolve?.(true);
                    // Secondary is live; mirror the GIS snapshot.
                    this._secondaryReady = true;
                    this.sendSnapshot();
                    bus.emit('dual-screen:secondary-ready');
                    return;
                }
                this._secondaryReady = true;
                this.sendSnapshot();
                bus.emit('dual-screen:secondary-ready');
                break;
            case MessageType.VIEWPORT:
                if (msg.payload) {
                    this._lastViewport = msg.payload;
                    this._lastBounds = boundsFromViewportPayload(msg.payload);
                }
                break;
            case MessageType.MAP_CHROME:
                this._applyMapChrome(msg.payload);
                break;
            case MessageType.DRAW_EVENT:
                this._handlers.onDrawEvent?.(msg.payload);
                break;
            case MessageType.POPUP_ACTION:
                this._handlers.onPopupAction?.(msg.payload);
                break;
            case MessageType.FILE_DROP:
                this._handlers.onFileDrop?.(msg.payload);
                break;
            case MessageType.FENCE_SET:
                this._handlers.onFenceSet?.(msg.payload);
                break;
            case MessageType.FENCE_CLEAR:
                this._handlers.onFenceClear?.(msg.payload);
                break;
            case MessageType.CTX_CMD:
                this._handlers.onCtxCmd?.(msg.payload);
                break;
            case MessageType.SELECTION:
                if (shouldApplySelection(msg, 'primary')) {
                    this._applyRemoteSelection(msg.payload);
                }
                break;
            case MessageType.MAP_RPC_RESULT:
                this._resolveMapRpcResult(msg.payload);
                break;
            case MessageType.BYE:
                this.deactivate({ fromSecondaryBye: true });
                break;
            default:
                break;
        }
    }

    sendSnapshot(options = {}) {
        if (!this._channel || !this._secondaryReady) return;
        const layers = getLayers();
        const spatialLayers = layers.filter(isSpatialLayer);
        const preserveViewport = !!options.preserveViewport;
        const payload = buildSnapshotPayload({
            layers: spatialLayers,
            viewport: preserveViewport ? null : this._lastViewport,
            basemap: mapService.getCurrentBasemap() || 'voyager',
            is3d: mapService.is3DEnabled(),
            basemapTone: mapService.getBasemapTone(),
            layerStyles: mapService.getLayerStyles(),
            activeLayerId: getActiveLayer()?.id ?? null,
            preserveViewport
        });
        this._channel.post(createMessage('primary', MessageType.SNAPSHOT, payload));
    }

    syncLayersChanged() {
        if (!this.isActive || !this._secondaryReady) return;
        this.sendSnapshot({ preserveViewport: true });
    }

    broadcastLayerAdd(dataset, colorIndex, options = {}) {
        if (!this._channel) return;
        const style = options.style
            ?? mapService.getLayerStyles()?.get?.(dataset.id)
            ?? null;
        this._channel.post(createMessage('primary', MessageType.LAYER_ADD, {
            dataset: {
                id: dataset.id,
                name: dataset.name,
                type: dataset.type,
                storage: dataset.storage ?? null,
                workspaceLayerId: dataset.workspaceLayerId ?? null,
                visible: dataset.visible !== false,
                geojson: dataset.geojson ? JSON.parse(JSON.stringify(dataset.geojson)) : null,
                source: dataset.source ? JSON.parse(JSON.stringify(dataset.source)) : null,
                mapLabels: dataset._mapLabels ?? null,
                kmlExport: dataset._kmlExport ?? null,
                scaleRangeEnabled: !!dataset.scaleRangeEnabled,
                minScale: dataset.minScale ?? null,
                maxScale: dataset.maxScale ?? null
            },
            colorIndex,
            fit: !!options.fit,
            style: style ? JSON.parse(JSON.stringify(style)) : null
        }));
    }

    broadcastLayerRemove(id) {
        if (!this._channel) return;
        this._channel.post(createMessage('primary', MessageType.LAYER_REMOVE, { id }));
    }

    broadcastLayerOrder(orderedIds) {
        if (!this._channel) return;
        this._channel.post(createMessage('primary', MessageType.LAYER_ORDER, { orderedIds }));
    }

    broadcastLayerStyle(layerId, style, layerMeta = null) {
        if (!this._channel || !layerId || !style) return;
        const meta = layerMeta ?? getLayers().find((l) => l.id === layerId) ?? null;
        this._channel.post(createMessage('primary', MessageType.LAYER_STYLE, {
            layerId,
            style: JSON.parse(JSON.stringify(style)),
            layerMeta: meta ? serializeLayerMetaForRestyle(meta) : null
        }));
    }

    broadcastFit(command, payload = {}) {
        if (!this._channel) return;
        this._channel.post(createMessage('primary', MessageType.VIEWPORT, {
            source: 'primary',
            command,
            ...payload
        }));
    }

    broadcastDrawCmd(payload) {
        if (!this._channel) return;
        this._channel.post(createMessage('primary', MessageType.DRAW_CMD, payload));
    }

    broadcastToast(message, type = 'info') {
        if (!this._channel) return;
        this._channel.post(createMessage('primary', MessageType.TOAST, { message, type }));
    }

    broadcastSelection(payload) {
        if (!this._channel) return;
        this._channel.post(createMessage('primary', MessageType.SELECTION, payload));
    }

    /**
     * Run an async mapService method on the secondary map window.
     * @param {string} method
     * @param {unknown[]} [args]
     * @param {{ focusMap?: boolean, timeoutMs?: number }} [options]
     */
    invokeMapRpc(method, args = [], options = {}) {
        if (!this.isActive || !this._channel) {
            return Promise.reject(new Error('Dual screen map is not active'));
        }
        return new Promise((resolve, reject) => {
            const requestId = `rpc-${Date.now()}-${++this._rpcSeq}`;
            const timeout = setTimeout(() => {
                if (!this._rpcPending.has(requestId)) return;
                this._rpcPending.delete(requestId);
                reject(new Error(`Map interaction timed out (${method})`));
            }, options.timeoutMs ?? 600000);

            this._rpcPending.set(requestId, { resolve, reject, timeout });
            if (options.focusMap !== false) this.focusMapWindow();
            this._channel.post(createMessage('primary', MessageType.MAP_RPC, {
                requestId,
                method,
                args: serializeMapRpcArgs(args)
            }));
        });
    }

    /**
     * @param {string} action
     * @param {object} [data]
     * @param {{ focusMap?: boolean }} [options]
     */
    broadcastMapCmd(action, data = {}, options = {}) {
        if (!this._channel) return;
        if (this.isActive && options.focusMap !== false) this.focusMapWindow();
        this._channel.post(createMessage('primary', MessageType.MAP_CMD, { action, ...data }));
    }

    _resolveMapRpcResult(payload) {
        const pending = payload?.requestId ? this._rpcPending.get(payload.requestId) : null;
        if (!pending) return;
        clearTimeout(pending.timeout);
        this._rpcPending.delete(payload.requestId);
        if (payload.error) pending.reject(new Error(payload.error));
        else pending.resolve(payload.result);
    }

    _rejectAllMapRpc(reason) {
        for (const [requestId, pending] of this._rpcPending.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(reason));
            this._rpcPending.delete(requestId);
        }
    }

    _applyRemoteSelection(payload) {
        applySelectionPayload(mapService, payload, {
            setInbound: (v) => { this._selectionSyncInbound = v; }
        });
    }

    getBounds() {
        if (this._lastBounds) return this._lastBounds;
        if (!this._lastViewport) return null;
        const map = mapService.getMap();
        if (map) return mapService.getBounds();
        return boundsFromViewportPayload(this._lastViewport);
    }

    async _focusMapWindow() {
        if (!isSecondaryMapWindowOpen(this._mapWindow)) {
            this._mapWindow = await openSecondaryMapWindow();
        }
        if (isSecondaryMapWindowOpen(this._mapWindow)) {
            try { await this._mapWindow.focus(); } catch (_) { /* ignore */ }
        }
    }

    focusMapWindow() {
        void this._focusMapWindow();
    }
}

export const dualScreenCoordinator = new DualScreenCoordinator();
export default dualScreenCoordinator;
