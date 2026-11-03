/**
 * Dual Screen Mode — primary-window lifecycle & sync orchestration
 */
import { getLayers, getActiveLayer, getMapLayerOrderIds } from '../core/state.js';
import { isSpatialLayer, isWorkspaceLayer } from '../core/data-model.js';
import mapService from '../map/map-service.js';
import { DualScreenChannel } from './channel.js';
import {
    MessageType,
    createMessage,
    createDualSessionId,
    HELLO_TIMEOUT_MS,
    buildSnapshotPayload,
    boundsFromViewportPayload,
    serializeMapRpcArgs,
    serializeLayerMetaForRestyle
} from './protocol.js';
import {
    setDualScreenActiveHint,
    HELLO_TIMEOUT_NOTICE,
    PROTOCOL_MISMATCH_NOTICE
} from './storage-hint.js';
import { showToast } from '../ui/toast.js';
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
import {
    ADD_LAYER_METHODS,
    LAYER_STAMP_METHODS,
    serializeMapCallArgs,
    stampSpatialLayers,
    planLayerDelta,
    warnDualScreenDev
} from './map-bridge.js';

const POLL_MS = 500;

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
        /** @type {string | null} */
        this._sessionId = null;
        /** @type {'timeout' | 'version' | 'bye' | null} */
        this._activationNotice = null;
        this._versionNoticeShown = false;
        this._selectionSyncInbound = false;
        /** @type {(() => void) | null} */
        this._selectionSyncTeardown = null;
        this._rpcSeq = 0;
        /** @type {Map<string, { resolve: Function, reject: Function, timeout: ReturnType<typeof setTimeout> }>} */
        this._rpcPending = new Map();
        /** @type {Map<string, object>} */
        this._layerStamps = new Map();
        /** @type {string[]} */
        this._layerOrder = [];
        this._deltaScheduled = false;
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

    /**
     * Why the last activate() returned false, if a notice was already shown
     * or the popup left on its own. Cleared when read.
     * @returns {'timeout' | 'version' | 'bye' | null}
     */
    consumeActivationNotice() {
        const notice = this._activationNotice;
        this._activationNotice = null;
        return notice;
    }

    _post(type, payload = {}) {
        if (!this._channel || !this._sessionId) return;
        this._channel.post(createMessage('primary', type, payload, this._sessionId));
    }

    /**
     * Drop the pending popup attempt. The main map was never removed.
     * @param {'timeout' | 'version' | 'bye'} reason
     */
    _failActivation(reason) {
        if (!this._pendingActivation) return;
        this._pendingActivation = false;
        this._clearActivateTimeout();
        this._stopPoll();
        this._activationNotice = reason;

        if (reason === 'timeout') {
            showToast(HELLO_TIMEOUT_NOTICE, 'warning', { duration: 8000 });
        }

        this._post(MessageType.BYE, {});
        if (this._channel) {
            this._channel.close();
            this._channel = null;
        }
        if (isSecondaryMapWindowOpen(this._mapWindow)) {
            try { void this._mapWindow.close(); } catch (_) { /* ignore */ }
        }
        this._mapWindow = null;
        this._sessionId = null;
        this._secondaryReady = false;
        setDualScreenActiveHint(typeof sessionStorage !== 'undefined' ? sessionStorage : null, false);
        const resolve = this._activateResolve;
        this._activateResolve = null;
        resolve?.(false);
    }

    _noticeProtocolMismatch() {
        if (!this._versionNoticeShown) {
            this._versionNoticeShown = true;
            showToast(PROTOCOL_MISMATCH_NOTICE, 'error', { duration: 8000 });
        }
        if (this._pendingActivation) this._failActivation('version');
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

        // Keep this window's map until the popup says hello for this session.
        return new Promise((resolve) => {
            this._activateResolve = resolve;
            this._activationNotice = null;
            this._versionNoticeShown = false;
            this._sessionId = createDualSessionId();
            this._pendingActivation = true;
            this._secondaryReady = false;
            this._channel = new DualScreenChannel('primary', (msg) => this._handleMessage(msg), {
                sessionId: this._sessionId,
                onProtocolMismatch: () => this._noticeProtocolMismatch()
            });
            this._activateTimeout = setTimeout(() => {
                if (this._pendingActivation) this._failActivation('timeout');
            }, HELLO_TIMEOUT_MS);

            openSecondaryMapWindow(this._sessionId).then((handle) => {
                if (this.isActive) {
                    this._mapWindow = handle;
                    this._startPoll();
                    return;
                }
                if (!this._pendingActivation) {
                    if (isSecondaryMapWindowOpen(handle)) {
                        try { void handle.close(); } catch (_) { /* ignore */ }
                    }
                    return;
                }
                this._mapWindow = handle;
                this._startPoll();
            }).catch((err) => {
                console.warn('[DualScreen] open map window failed', err);
            });
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
            this._channel = new DualScreenChannel('primary', (msg) => this._handleMessage(msg), {
                sessionId: this._sessionId,
                onProtocolMismatch: () => this._noticeProtocolMismatch()
            });
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
            this._failActivation('bye');
            return;
        }
        if (!this.isActive || this._deactivating) return;

        this._deactivating = true;
        try {
            this._stopPoll();
            this._selectionSyncTeardown?.();
            this._selectionSyncTeardown = null;

            if (!options.fromSecondaryBye) {
                this._post(MessageType.BYE, {});
                if (isSecondaryMapWindowOpen(this._mapWindow)) {
                    try { void this._mapWindow.close(); } catch (_) { /* ignore */ }
                }
            }

            if (this._channel) {
                this._channel.close();
                this._channel = null;
            }

            this._mapWindow = null;
            this._sessionId = null;
            this.isActive = false;
            this._secondaryReady = false;
            this._lastBounds = null;
            this._layerStamps = new Map();
            this._layerOrder = [];
            this._deltaScheduled = false;
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
            if (!this._mapWindow?.closed) return;
            if (this._pendingActivation) this._failActivation('bye');
            else if (this.isActive) this.deactivate({ fromSecondaryBye: true });
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
                if (!this._pendingActivation && !this.isActive) return;
                if (this._pendingActivation) {
                    this._completeActivation();
                    const resolve = this._activateResolve;
                    this._activateResolve = null;
                    resolve?.(true);
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
                if (this._pendingActivation) {
                    this._failActivation('bye');
                    return;
                }
                if (!this.isActive) return;
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
        this._post(MessageType.SNAPSHOT, payload);
        this._captureLayerSyncBaseline();
    }

    /**
     * Layer-list changes after the popup is up. Sends only the layers that
     * changed. The hello snapshot is still the one full copy.
     */
    syncLayersChanged() {
        if (!this.isActive || !this._secondaryReady) return;
        if (this._deltaScheduled) return;
        this._deltaScheduled = true;
        queueMicrotask(() => {
            this._deltaScheduled = false;
            this._sendLayerDelta();
        });
    }

    _spatialLayersInMapOrder() {
        const spatial = getLayers().filter(isSpatialLayer);
        const rank = new Map(getMapLayerOrderIds().map((id, index) => [id, index]));
        return spatial.slice().sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }

    _captureLayerSyncBaseline() {
        const stamped = stampSpatialLayers(this._spatialLayersInMapOrder());
        this._layerStamps = stamped.stamps;
        this._layerOrder = stamped.order;
    }

    _sendLayerDelta() {
        if (!this.isActive || !this._secondaryReady || !this._channel || !this._sessionId) return;
        const spatial = this._spatialLayersInMapOrder();
        const plan = planLayerDelta(this._layerStamps, this._layerOrder, spatial);
        for (const call of plan.calls) {
            this.forwardMapCall(call.method, call.args, { focusMap: false, fromDelta: true });
        }
        this._layerStamps = plan.stamps;
        this._layerOrder = plan.order;
    }

    /**
     * One sender for every dual-mode map-service call.
     * @param {string} method
     * @param {unknown[]} [args]
     * @param {{ rpc?: boolean, focusMap?: boolean, fromDelta?: boolean }} [options]
     */
    forwardMapCall(method, args = [], options = {}) {
        let callMethod = method;
        let callArgs = args;
        if (method === 'removeTempFeature') {
            callMethod = 'clearTempFeatures';
            callArgs = [];
        }
        if (ADD_LAYER_METHODS.has(method)) {
            const dataset = args?.[0];
            const style = args?.[2]?.style || mapService.getLayerStyle?.(dataset?.id);
            if (dataset?.id && style) {
                this._dispatchMapCall('setLayerStyle', [dataset.id, style], {
                    rpc: false,
                    focusMap: false,
                    fromDelta: true
                });
            }
        }
        return this._dispatchMapCall(callMethod, callArgs, options);
    }

    /**
     * @param {string} method
     * @param {unknown[]} args
     * @param {{ rpc?: boolean, focusMap?: boolean, fromDelta?: boolean }} options
     */
    _dispatchMapCall(method, args, options) {
        const packed = serializeMapCallArgs(args);
        if (packed.dropped.length) {
            warnDualScreenDev(
                `[DualScreen] map call ${method} dropped non-serializable values (${packed.dropped.join(', ')})`
            );
        }
        if (!packed.ok) {
            warnDualScreenDev(`[DualScreen] cannot forward ${method}: ${packed.error?.message || 'not serializable'}`);
            if (options.rpc) return Promise.reject(new Error(`Cannot forward ${method}`));
            return undefined;
        }
        if (!this._channel || !this._sessionId) {
            warnDualScreenDev(`[DualScreen] cannot forward ${method}: bridge is not open`);
            if (options.rpc) return Promise.reject(new Error('Dual screen map is not active'));
            return undefined;
        }
        const focusMap = options.focusMap === true;
        const result = options.rpc
            ? this.invokeMapRpc(method, packed.args, { focusMap })
            : this.broadcastMapCmd(method, { method, args: packed.args }, { focusMap });
        if (!options.fromDelta && LAYER_STAMP_METHODS.has(method)) {
            this._captureLayerSyncBaseline();
        }
        return result;
    }

    broadcastLayerAdd(dataset, colorIndex, options = {}) {
        if (!this._channel) return;
        const style = options.style
            ?? mapService.getLayerStyles()?.get?.(dataset.id)
            ?? null;
        this._post(MessageType.LAYER_ADD, {
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
        });
    }

    broadcastLayerRemove(id) {
        if (!this._channel) return;
        this._post(MessageType.LAYER_REMOVE, { id });
    }

    broadcastLayerOrder(orderedIds) {
        if (!this._channel) return;
        this._post(MessageType.LAYER_ORDER, { orderedIds });
    }

    broadcastLayerStyle(layerId, style, layerMeta = null) {
        if (!this._channel || !layerId || !style) return;
        const meta = layerMeta ?? getLayers().find((l) => l.id === layerId) ?? null;
        this._post(MessageType.LAYER_STYLE, {
            layerId,
            style: JSON.parse(JSON.stringify(style)),
            layerMeta: meta ? serializeLayerMetaForRestyle(meta) : null
        });
    }

    broadcastFit(command, payload = {}) {
        if (!this._channel) return;
        this._post(MessageType.VIEWPORT, {
            source: 'primary',
            command,
            ...payload
        });
    }

    broadcastDrawCmd(payload) {
        if (!this._channel) return;
        this._post(MessageType.DRAW_CMD, payload);
    }

    broadcastToast(message, type = 'info') {
        if (!this._channel) return;
        this._post(MessageType.TOAST, { message, type });
    }

    broadcastSelection(payload) {
        if (!this._channel) return;
        this._post(MessageType.SELECTION, payload);
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
            this._post(MessageType.MAP_RPC, {
                requestId,
                method,
                args: serializeMapRpcArgs(args)
            });
        });
    }

    /**
     * @param {string} action
     * @param {object} [data]
     * @param {{ focusMap?: boolean }} [options]
     */
    broadcastMapCmd(action, data = {}, options = {}) {
        if (!this._channel || !this._sessionId) return;
        if (this.isActive && options.focusMap === true) this.focusMapWindow();
        const payload = data && data.method
            ? { method: data.method, args: Array.isArray(data.args) ? data.args : [] }
            : { action, ...data };
        this._post(MessageType.MAP_CMD, payload);
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

    isSelectionSyncInbound() {
        return !!this._selectionSyncInbound;
    }

    getBounds() {
        if (this._lastBounds) return this._lastBounds;
        if (!this._lastViewport) return null;
        if (!this.isActive) {
            const map = mapService.getMap();
            if (map) return mapService.getBounds();
        }
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
