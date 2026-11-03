/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DualScreenChannel } from '../js/dual-screen/channel.js';
import dualScreenCoordinator from '../js/dual-screen/coordinator.js';
import { installDualScreenPrimaryHandlers } from '../js/dual-screen/primary-handlers.js';
import {
    applyForwardedMapCall,
    attachPopupSelectionBridges,
    installDualScreenMapServiceDecorator,
    runForwardedMapRpc,
    shiftClientPoint,
    zoomToLayerInDualMode
} from '../js/dual-screen/map-bridge.js';
import { createSecondaryProtocol } from '../js/dual-screen/secondary-protocol.js';
import { MessageType } from '../js/dual-screen/protocol.js';
import bus from '../js/core/event-bus.js';

const SESSION = 'sess-calls';

class MockBroadcastChannel {
    static hub = new Map();
    static traffic = [];

    constructor(name) {
        this.name = name;
        this.onmessage = null;
        this.closed = false;
        let peers = MockBroadcastChannel.hub.get(name);
        if (!peers) {
            peers = new Set();
            MockBroadcastChannel.hub.set(name, peers);
        }
        peers.add(this);
    }

    postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        MockBroadcastChannel.traffic.push(copy);
        const peers = [...(MockBroadcastChannel.hub.get(this.name) || [])];
        for (const peer of peers) {
            if (peer === this || peer.closed || typeof peer.onmessage !== 'function') continue;
            peer.onmessage({ data: JSON.parse(JSON.stringify(copy)) });
        }
    }

    close() {
        this.closed = true;
        MockBroadcastChannel.hub.get(this.name)?.delete(this);
    }
}

describe('dual-screen map call round trips', () => {
    /** @type {ReturnType<typeof createSecondaryProtocol> | null} */
    let protocol;
    /** @type {DualScreenChannel | null} */
    let secondary;
    /** @type {(() => void) | null} */
    let detachBridges;

    beforeEach(() => {
        MockBroadcastChannel.hub = new Map();
        MockBroadcastChannel.traffic = [];
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
        vi.spyOn(window, 'open').mockReturnValue(null);
        dualScreenCoordinator.isActive = false;
        dualScreenCoordinator._secondaryReady = true;
        dualScreenCoordinator._sessionId = SESSION;
        dualScreenCoordinator._selectionSyncInbound = false;
        dualScreenCoordinator._fenceBbox = null;
        dualScreenCoordinator._rpcPending?.clear?.();
        dualScreenCoordinator._channel = new DualScreenChannel('primary', (msg) => {
            if (msg.type === MessageType.HELLO || msg.type === MessageType.SNAPSHOT || msg.type === MessageType.BYE) return;
            dualScreenCoordinator._handleMessage(msg);
        }, { sessionId: SESSION });
        protocol = null;
        secondary = null;
        detachBridges = null;
    });

    afterEach(() => {
        detachBridges?.();
        detachBridges = null;
        try { dualScreenCoordinator._rejectAllMapRpc?.('test done'); } catch { /* reset */ }
        dualScreenCoordinator.isActive = false;
        dualScreenCoordinator._secondaryReady = false;
        dualScreenCoordinator._channel?.close();
        dualScreenCoordinator._channel = null;
        dualScreenCoordinator._sessionId = null;
        secondary?.close();
        secondary = null;
        protocol = null;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    /**
     * @param {object} popup
     */
    function connect(popup) {
        const next = createSecondaryProtocol({
            sessionId: SESSION,
            post: (message) => secondary?.post(message),
            onApply: (msg) => {
                if (msg.type === MessageType.MAP_CMD) applyForwardedMapCall(popup, msg.payload);
                else if (msg.type === MessageType.MAP_RPC) {
                    void runForwardedMapRpc(popup, msg.payload, (type, payload) => {
                        next.enqueueOutbound(type, payload);
                    });
                }
            }
        });
        protocol = next;
        secondary = new DualScreenChannel('secondary', (msg) => next.receive(msg), { sessionId: SESSION });
        next.markHandshakeReady();
        return next;
    }

    function activate(api) {
        installDualScreenMapServiceDecorator(api, dualScreenCoordinator);
        dualScreenCoordinator.isActive = false;
        return api;
    }

    it('focusFeatures round-trips onto the popup map', () => {
        const feature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-111, 40] },
            properties: { _featureIndex: 3 }
        };
        const local = vi.fn();
        const popup = { focusFeatures: vi.fn() };
        const api = activate({ focusFeatures: local });
        api.focusFeatures([feature], { layerId: 'layer-1', fit: true });
        expect(local).toHaveBeenCalledOnce();
        expect(MockBroadcastChannel.traffic).toEqual([]);

        connect(popup);
        dualScreenCoordinator.isActive = true;
        api.focusFeatures([feature], { layerId: 'layer-1', fit: true });
        expect(popup.focusFeatures).toHaveBeenCalledWith(
            [feature],
            { layerId: 'layer-1', fit: true }
        );
        expect(local).toHaveBeenCalledOnce();
    });

    it('fitToFeatureIndices round-trips onto the popup map', () => {
        const local = vi.fn();
        const popup = { fitToFeatureIndices: vi.fn() };
        const api = activate({ fitToFeatureIndices: local });
        api.fitToFeatureIndices('layer-1', [0, 2], { mode: 'first', padding: 48 });
        expect(local).toHaveBeenCalledOnce();
        expect(MockBroadcastChannel.traffic).toEqual([]);

        connect(popup);
        dualScreenCoordinator.isActive = true;
        api.fitToFeatureIndices('layer-1', [0, 2], { mode: 'first', padding: 48 });
        expect(popup.fitToFeatureIndices).toHaveBeenCalledWith(
            'layer-1',
            [0, 2],
            { mode: 'first', padding: 48 }
        );
    });

    it('scheduleFitToLayers round-trips onto the popup map', () => {
        const local = vi.fn(() => Promise.resolve());
        const popup = { scheduleFitToLayers: vi.fn(() => Promise.resolve()) };
        const api = activate({ scheduleFitToLayers: local });
        api.scheduleFitToLayers(['layer-a'], { allowZoomOut: false });
        expect(local).toHaveBeenCalledOnce();
        expect(MockBroadcastChannel.traffic).toEqual([]);

        connect(popup);
        dualScreenCoordinator.isActive = true;
        api.scheduleFitToLayers(['layer-a', 'layer-b'], { allowZoomOut: false });
        expect(popup.scheduleFitToLayers).toHaveBeenCalledWith(
            ['layer-a', 'layer-b'],
            { allowZoomOut: false }
        );
    });

    it('zoomToLayer round-trips as fitToLayers on the popup map', () => {
        const local = vi.fn();
        const popup = { fitToLayers: vi.fn() };
        const api = activate({ fitToLayers: local });
        expect(zoomToLayerInDualMode(api, 'layer-9', false)).toBe(false);
        expect(local).not.toHaveBeenCalled();
        expect(MockBroadcastChannel.traffic).toEqual([]);

        connect(popup);
        dualScreenCoordinator.isActive = true;
        installDualScreenPrimaryHandlers({
            zoomToLayer: (layerId) => { zoomToLayerInDualMode(api, layerId, true); }
        });
        expect(zoomToLayerInDualMode(api, 'layer-9', true)).toBe(true);
        protocol.enqueueOutbound(MessageType.CTX_CMD, { action: 'zoomToLayer', layerId: 'layer-4' });
        expect(popup.fitToLayers).toHaveBeenCalledWith(['layer-9']);
        expect(popup.fitToLayers).toHaveBeenCalledWith(['layer-4']);
        expect(local).not.toHaveBeenCalled();
    });

    it('setPopupMode round-trips onto the popup map and stays readable locally', () => {
        const local = vi.fn((mode) => mode);
        const popup = { setPopupMode: vi.fn((mode) => mode) };
        const api = activate({ setPopupMode: local });
        expect(api.setPopupMode('full')).toBe('full');
        expect(popup.setPopupMode).not.toHaveBeenCalled();
        expect(MockBroadcastChannel.traffic).toEqual([]);

        connect(popup);
        dualScreenCoordinator.isActive = true;
        expect(api.setPopupMode('minimal')).toBe('minimal');
        expect(local).toHaveBeenLastCalledWith('minimal');
        expect(popup.setPopupMode).toHaveBeenCalledWith('minimal');
    });

    it('continuous pick round-trips each click and finishes on the popup', async () => {
        const local = vi.fn(() => Promise.resolve());
        const popup = {
            startContinuousPointPick: vi.fn(async (prompt, onPoint) => {
                expect(prompt).toBe('Click clients');
                await onPoint([-111.5, 40.5]);
                await onPoint([-111.6, 40.6]);
            })
        };
        const api = activate({ startContinuousPointPick: local });
        await api.startContinuousPointPick('local', () => {});
        expect(local).toHaveBeenCalledOnce();
        expect(MockBroadcastChannel.traffic).toEqual([]);

        connect(popup);
        dualScreenCoordinator.isActive = true;
        const points = [];
        await api.startContinuousPointPick('Click clients', (coord) => {
            points.push(coord);
        });
        expect(points).toEqual([[-111.5, 40.5], [-111.6, 40.6]]);
        expect(popup.startContinuousPointPick).toHaveBeenCalledOnce();
        expect(local).toHaveBeenCalledOnce();
    });

    it('georeference round-trips image urls the popup can load', async () => {
        const png = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' });
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url).startsWith('blob:')) return { ok: true, blob: async () => png };
            throw new Error(`unexpected fetch ${url}`);
        }));
        const localPreview = vi.fn();
        const localAdd = vi.fn();
        const popup = { showGeoreferencePreview: vi.fn(), addGeoreferencedImageLayer: vi.fn() };
        const api = activate({
            showGeoreferencePreview: localPreview,
            addGeoreferencedImageLayer: localAdd
        });
        api.showGeoreferencePreview({ url: 'blob:http://local/preview', coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]] });
        expect(localPreview).toHaveBeenCalledOnce();
        expect(MockBroadcastChannel.traffic).toEqual([]);

        connect(popup);
        dualScreenCoordinator.isActive = true;
        api.showGeoreferencePreview({
            url: 'blob:http://local/preview',
            coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]],
            opacity: 0.7,
            visible: true,
            gcps: []
        });
        api.addGeoreferencedImageLayer({
            id: 'geo-1',
            name: 'Image',
            source: {
                georeferenceRaster: {
                    url: 'blob:http://local/layer',
                    coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]]
                }
            }
        }, 0, { fit: true });

        await vi.waitFor(() => {
            expect(popup.showGeoreferencePreview).toHaveBeenCalled();
            expect(popup.addGeoreferencedImageLayer).toHaveBeenCalled();
        });
        const preview = popup.showGeoreferencePreview.mock.calls[0][0];
        expect(preview.url.startsWith('data:image/png;base64,')).toBe(true);
        expect(preview.opacity).toBe(0.7);
        const dataset = popup.addGeoreferencedImageLayer.mock.calls[0][0];
        expect(dataset.source.georeferenceRaster.url.startsWith('data:image/png;base64,')).toBe(true);
        expect(popup.addGeoreferencedImageLayer.mock.calls[0][2]).toEqual({ fit: true });
        expect(localPreview).toHaveBeenCalledOnce();
    });

    it('heatmap round-trips the coverage raster data url', () => {
        const dataUrl = 'data:image/png;base64,aaaa';
        const raster = {
            dataUrl,
            coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]],
            bbox: [0, 0, 1, 1]
        };
        const local = vi.fn();
        const popup = { addCoverageHeatmapLayer: vi.fn() };
        const api = activate({ addCoverageHeatmapLayer: local });
        api.addCoverageHeatmapLayer({ id: 'heat-1', source: { coverageRasters: [raster] } }, 0, { fit: false });
        expect(local).toHaveBeenCalledOnce();
        expect(MockBroadcastChannel.traffic).toEqual([]);

        connect(popup);
        dualScreenCoordinator.isActive = true;
        api.addCoverageHeatmapLayer({ id: 'heat-1', name: 'Heat', source: { coverageRasters: [raster] } }, 1, { fit: false });
        const sent = popup.addCoverageHeatmapLayer.mock.calls[0];
        expect(sent[0].source.coverageRasters[0].dataUrl).toBe(dataUrl);
        expect(sent[1]).toBe(1);
        expect(sent[2]).toEqual({ fit: false });
    });

    it('box-select events round-trip from the popup back to the main window', () => {
        const posted = [];
        detachBridges = attachPopupSelectionBridges({
            post: (type, payload) => posted.push({ type, payload }),
            getSelectionCount: () => 0
        });
        bus.emit('selection:boxComplete', {
            layerId: 'layer-1',
            count: 2,
            bbox: [1, 2, 3, 4],
            screenBbox: { left: 10, top: 20, right: 40, bottom: 50 },
            clientX: 12,
            clientY: 22
        });
        bus.emit('selection:boxCleared');
        detachBridges();
        detachBridges = null;

        expect(posted.map((entry) => entry.type)).toEqual([MessageType.SELECTION, MessageType.SELECTION]);
        expect(posted.map((entry) => entry.payload.event)).toEqual(['boxComplete', 'boxCleared']);
        expect(posted[0].payload.syncSelection).toBe(false);
        expect(posted[0].payload.bbox).toEqual([1, 2, 3, 4]);
        expect(shiftClientPoint(
            { clientX: 5, clientY: 6, screenBbox: { left: 1, top: 2, right: 3, bottom: 4 } },
            100,
            40
        )).toEqual({
            clientX: 105,
            clientY: 46,
            screenBbox: { left: 101, top: 42, right: 103, bottom: 44 }
        });

        const completed = [];
        const cleared = [];
        const unsubComplete = bus.on('selection:boxComplete', (payload) => completed.push(payload));
        const unsubCleared = bus.on('selection:boxCleared', () => cleared.push(true));
        connect({});
        protocol.enqueueOutbound(MessageType.SELECTION, posted[0].payload);
        protocol.enqueueOutbound(MessageType.SELECTION, posted[1].payload);
        unsubComplete();
        unsubCleared();

        expect(completed).toHaveLength(1);
        expect(completed[0].layerId).toBe('layer-1');
        expect(completed[0].count).toBe(2);
        expect(completed[0].bbox).toEqual([1, 2, 3, 4]);
        expect(completed[0].clientX).toBe(12);
        expect(cleared).toEqual([true]);
    });

    it('keyboard shortcuts round-trip while the popup has focus', () => {
        const popup = {
            clearSelection: vi.fn(),
            selectAll: vi.fn(),
            invertSelection: vi.fn()
        };
        const api = activate({
            clearSelection: vi.fn(),
            selectAll: vi.fn(),
            invertSelection: vi.fn()
        });
        connect(popup);
        dualScreenCoordinator.isActive = true;
        const shortcuts = [];
        const geojson = { type: 'FeatureCollection', features: [] };
        installDualScreenPrimaryHandlers({
            onSelectionShortcut: (shortcut) => {
                shortcuts.push(shortcut);
                if (shortcut === 'clearSelection') api.clearSelection();
                else if (shortcut === 'selectAll') api.selectAll('layer-1', geojson);
                else if (shortcut === 'invertSelection') api.invertSelection('layer-1', geojson);
            }
        });
        detachBridges = attachPopupSelectionBridges({
            post: (type, payload) => protocol.enqueueOutbound(type, payload),
            getSelectionCount: () => 2
        });

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, shiftKey: true, bubbles: true }));

        expect(shortcuts).toEqual(['clearSelection', 'deleteSelected', 'selectAll', 'invertSelection']);
        expect(popup.clearSelection).toHaveBeenCalledOnce();
        expect(popup.selectAll).toHaveBeenCalledWith('layer-1', geojson);
        expect(popup.invertSelection).toHaveBeenCalledWith('layer-1', geojson);
    });
});
