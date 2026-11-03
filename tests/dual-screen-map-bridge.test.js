/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DualScreenChannel } from '../js/dual-screen/channel.js';
import dualScreenCoordinator from '../js/dual-screen/coordinator.js';
import {
    applyForwardedMapCall,
    classifyMapMethod,
    FORWARDED_MAP_METHODS,
    installDualScreenMapServiceDecorator,
    layerContentStamp,
    listPublicMapMethods,
    LOCAL_ONLY_MAP_METHODS,
    planLayerDelta
} from '../js/dual-screen/map-bridge.js';
import { createMapService } from '../js/map/map-service.js';
import { MessageType } from '../js/dual-screen/protocol.js';
import { addLayer, getLayers, removeLayer } from '../js/core/state.js';
import { createSpatialDataset } from '../js/core/data-model.js';

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

function pointCollection(lng) {
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, 40] },
            properties: {}
        }]
    };
}

describe('dual-screen map bridge', () => {
    /** @type {DualScreenChannel | null} */
    let secondary;

    beforeEach(() => {
        MockBroadcastChannel.hub = new Map();
        MockBroadcastChannel.traffic = [];
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
        vi.spyOn(window, 'open').mockReturnValue(null);
        secondary = new DualScreenChannel('secondary', () => {}, { sessionId: 'sess-test' });
        dualScreenCoordinator.isActive = false;
        dualScreenCoordinator._secondaryReady = true;
        dualScreenCoordinator._sessionId = 'sess-test';
        dualScreenCoordinator._channel = new DualScreenChannel('primary', () => {}, { sessionId: 'sess-test' });
        dualScreenCoordinator._layerStamps = new Map();
        dualScreenCoordinator._layerOrder = [];
        dualScreenCoordinator._deltaScheduled = false;
        dualScreenCoordinator._selectionSyncInbound = false;
        dualScreenCoordinator._fenceBbox = null;
    });

    afterEach(() => {
        if (dualScreenCoordinator.isActive) {
            try { dualScreenCoordinator.deactivate(); } catch { /* test reset */ }
        }
        dualScreenCoordinator.isActive = false;
        dualScreenCoordinator._secondaryReady = false;
        dualScreenCoordinator._channel?.close();
        dualScreenCoordinator._channel = null;
        dualScreenCoordinator._sessionId = null;
        secondary?.close();
        secondary = null;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('classifies every public map-service method as forwarded or local-only', () => {
        const api = createMapService({ mapAdapter: {} });
        const names = listPublicMapMethods(api);
        const local = Object.keys(LOCAL_ONLY_MAP_METHODS);
        const forwarded = [...FORWARDED_MAP_METHODS];
        const classified = new Set([...local, ...forwarded]);

        expect(names.length).toBeGreaterThan(0);
        expect(local.filter((name) => FORWARDED_MAP_METHODS.has(name))).toEqual([]);
        expect(names.filter((name) => !classified.has(name))).toEqual([]);
        expect(forwarded.filter((name) => !names.includes(name))).toEqual([]);
        expect(local.filter((name) => !names.includes(name))).toEqual([]);
        for (const name of names) {
            expect(classifyMapMethod(name)).not.toBe('unbridged');
        }
    });

    it('leaves single-screen calls on the local map', () => {
        const addLayerFn = vi.fn(() => 'stayed');
        const api = { addLayer: addLayerFn, getMap: vi.fn(() => ({ id: 'local' })) };
        installDualScreenMapServiceDecorator(api, dualScreenCoordinator);

        expect(api.addLayer({ id: 'a' }, 0, {})).toBe('stayed');
        expect(addLayerFn).toHaveBeenCalledOnce();
        expect(api.getMap()).toEqual({ id: 'local' });
        expect(MockBroadcastChannel.traffic).toEqual([]);
    });

    it('forwards an active map call as one method delta', () => {
        const addLayerFn = vi.fn();
        const api = {
            addLayer: addLayerFn,
            setLayerStyle: vi.fn(),
            getLayerStyle: vi.fn(() => null)
        };
        installDualScreenMapServiceDecorator(api, dualScreenCoordinator);
        dualScreenCoordinator.isActive = true;

        const dataset = { id: 'layer-1', name: 'One', type: 'spatial', geojson: pointCollection(-111) };
        api.addLayer(dataset, 2, { fit: true });

        expect(addLayerFn).not.toHaveBeenCalled();
        const cmds = MockBroadcastChannel.traffic.filter((msg) => msg.type === MessageType.MAP_CMD);
        const snapshots = MockBroadcastChannel.traffic.filter((msg) => msg.type === MessageType.SNAPSHOT);
        expect(snapshots).toEqual([]);
        expect(cmds).toHaveLength(1);
        expect(cmds[0].payload.method).toBe('addLayer');
        expect(cmds[0].payload.args[0].id).toBe('layer-1');
        expect(cmds[0].payload.args[1]).toBe(2);
        expect(cmds[0].payload.args[2]).toEqual({ fit: true });
        expect(cmds[0].sessionId).toBe('sess-test');
    });

    it('warns for getMap, unbridged calls, and values the bridge cannot send', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const getMap = vi.fn(() => ({ id: 'hidden' }));
        const mystery = vi.fn(() => 'nope');
        const api = {
            getMap,
            addLayer: vi.fn(),
            startSketchPolygon: vi.fn(),
            startContinuousPointPick: vi.fn(),
            mystery
        };
        installDualScreenMapServiceDecorator(api, dualScreenCoordinator);
        dualScreenCoordinator.isActive = true;

        expect(api.getMap()).toBeNull();
        expect(getMap).not.toHaveBeenCalled();
        expect(warn.mock.calls.some((args) => String(args[0]).includes('getMap'))).toBe(true);

        expect(api.mystery()).toBeUndefined();
        expect(mystery).not.toHaveBeenCalled();
        expect(warn.mock.calls.some((args) => String(args[0]).includes('mystery'))).toBe(true);

        const loop = { id: 'loop' };
        loop.self = loop;
        api.addLayer(loop, 0, {});
        expect(MockBroadcastChannel.traffic.filter((msg) => msg.payload?.method === 'addLayer')).toEqual([]);
        expect(warn.mock.calls.some((args) => String(args[0]).includes('cannot forward addLayer'))).toBe(true);

        const pending = api.startSketchPolygon({
            bannerText: 'Draw',
            onInsufficientVertices: () => {}
        });
        expect(warn.mock.calls.some((args) => String(args[0]).includes('dropped non-serializable'))).toBe(true);
        const rpc = MockBroadcastChannel.traffic.filter((msg) => msg.type === MessageType.MAP_RPC);
        expect(rpc).toHaveLength(1);
        expect(rpc[0].payload.method).toBe('startSketchPolygon');
        expect(rpc[0].payload.args[0].bannerText).toBe('Draw');
        expect(rpc[0].payload.args[0].onInsufficientVertices).toBeUndefined();

        await expect(api.startContinuousPointPick('click', () => {})).rejects.toThrow(/Cannot forward/);
        expect(warn.mock.calls.some((args) => String(args[0]).includes('startContinuousPointPick'))).toBe(true);
        pending.catch(() => {});
    });

    it('turns a temp-feature remove into a clear on the popup', () => {
        const removeTempFeature = vi.fn();
        const api = { removeTempFeature, clearTempFeatures: vi.fn() };
        installDualScreenMapServiceDecorator(api, dualScreenCoordinator);
        dualScreenCoordinator.isActive = true;
        api.removeTempFeature({ srcId: 'temp-1' });
        const cmds = MockBroadcastChannel.traffic.filter((msg) => msg.type === MessageType.MAP_CMD);
        expect(cmds.map((msg) => msg.payload.method)).toEqual(['clearTempFeatures']);
        expect(removeTempFeature).not.toHaveBeenCalled();
    });

    it('does not echo a selection apply back across the bridge', () => {
        const selectFeatures = vi.fn();
        const api = { selectFeatures };
        installDualScreenMapServiceDecorator(api, dualScreenCoordinator);
        dualScreenCoordinator.isActive = true;
        dualScreenCoordinator._selectionSyncInbound = true;
        api.selectFeatures('layer-1', [0, 1]);
        expect(selectFeatures).toHaveBeenCalledWith('layer-1', [0, 1]);
        expect(MockBroadcastChannel.traffic.filter((msg) => msg.type === MessageType.MAP_CMD)).toEqual([]);
    });

    it('plans a one-layer delta instead of a full copy', () => {
        const alpha = {
            id: 'alpha',
            name: 'Alpha',
            type: 'spatial',
            visible: true,
            geojson: pointCollection(1)
        };
        const beta = {
            id: 'beta',
            name: 'Beta',
            type: 'spatial',
            visible: true,
            geojson: pointCollection(2)
        };
        const baseline = planLayerDelta(new Map(), [], [alpha, beta]);
        beta.visible = false;
        beta.geojson = pointCollection(2);
        const next = planLayerDelta(baseline.stamps, baseline.order, [alpha, beta]);
        expect(next.calls.map((call) => call.method)).toEqual(['toggleLayer']);
        expect(next.calls[0].args).toEqual(['beta', false]);
        expect(JSON.stringify(next.calls)).not.toContain('alpha');

        const moved = {
            ...beta,
            visible: false,
            geojson: pointCollection(8)
        };
        const edited = planLayerDelta(baseline.stamps, baseline.order, [alpha, moved]);
        expect(edited.calls.map((call) => call.method)).toEqual(['refreshLayerData', 'toggleLayer']);
        expect(edited.calls[0].args[0].id).toBe('beta');
        expect(layerContentStamp(alpha).hash).toBe(baseline.stamps.get('alpha').hash);

        const line = {
            id: 'line',
            name: 'Line',
            type: 'spatial',
            visible: true,
            geojson: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] },
                    properties: { name: 'a' }
                }]
            }
        };
        const before = layerContentStamp(line);
        line.geojson.features[0].geometry.coordinates[1][0] = 9;
        expect(layerContentStamp(line).hash).not.toBe(before.hash);
        line.geojson.features[0].geometry.coordinates[1][0] = 3;
        line.geojson.features[0].properties.name = 'b';
        expect(layerContentStamp(line).hash).not.toBe(before.hash);
    });

    it('posts a layer delta over the channel and does not resend every layer', async () => {
        const alpha = createSpatialDataset('Alpha', pointCollection(1), { format: 'test' });
        const beta = createSpatialDataset('Beta', pointCollection(2), { format: 'test' });
        addLayer(alpha);
        addLayer(beta);
        try {
            dualScreenCoordinator.isActive = true;
            dualScreenCoordinator._captureLayerSyncBaseline();
            MockBroadcastChannel.traffic = [];
            beta.geojson.features[0].geometry.coordinates[0] = 9;
            dualScreenCoordinator.syncLayersChanged();
            await Promise.resolve();

            const types = MockBroadcastChannel.traffic.map((msg) => msg.type);
            expect(types).not.toContain(MessageType.SNAPSHOT);
            const cmds = MockBroadcastChannel.traffic.filter((msg) => msg.type === MessageType.MAP_CMD);
            expect(cmds).toHaveLength(1);
            expect(cmds[0].payload.method).toBe('refreshLayerData');
            expect(cmds[0].payload.args[0].id).toBe(beta.id);
            expect(JSON.stringify(cmds[0].payload.args)).not.toContain(alpha.id);
        } finally {
            removeLayer(alpha.id);
            removeLayer(beta.id);
        }
    });

    it('warns when the popup cannot apply a call', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const api = { fitToAll: vi.fn() };
        expect(applyForwardedMapCall(api, { method: 'missing', args: [] })).toBeUndefined();
        expect(warn.mock.calls.some((args) => String(args[0]).includes('missing'))).toBe(true);
        applyForwardedMapCall(api, { method: 'fitToAll', args: [] });
        expect(api.fitToAll).toHaveBeenCalledOnce();
    });
});
