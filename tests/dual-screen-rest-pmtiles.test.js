/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attributeRulesToMapFilter } from '../js/map/attribute-map-filter.js';
import {
    ensurePmtilesProtocol,
    publishPmtilesDataset,
    putPmtilesArchive
} from '../js/map/pmtiles-protocol.js';
import { serializeLayerForSync } from '../js/dual-screen/protocol.js';
import {
    installDualScreenMapServiceDecorator,
    planLayerDelta
} from '../js/dual-screen/map-bridge.js';
import { DualScreenChannel } from '../js/dual-screen/channel.js';
import dualScreenCoordinator from '../js/dual-screen/coordinator.js';
import { MessageType } from '../js/dual-screen/protocol.js';
import mapManager from '../js/map/map-manager.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/e2e/dual-screen-point.pmtiles');

function pointCollection(lng) {
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, 40] },
            properties: { NAME: 'Feature 1' }
        }]
    };
}

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

describe('dual-screen REST and PMTiles', () => {
    beforeEach(() => {
        MockBroadcastChannel.hub = new Map();
        MockBroadcastChannel.traffic = [];
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
        dualScreenCoordinator.isActive = false;
        dualScreenCoordinator._secondaryReady = true;
        dualScreenCoordinator._sessionId = 'sess-rest';
        dualScreenCoordinator._channel = new DualScreenChannel('primary', () => {}, { sessionId: 'sess-rest' });
        dualScreenCoordinator._layerStamps = new Map();
        dualScreenCoordinator._layerOrder = [];
        dualScreenCoordinator._deltaScheduled = false;
        dualScreenCoordinator._selectionSyncInbound = false;
    });

    afterEach(() => {
        dualScreenCoordinator.isActive = false;
        dualScreenCoordinator._secondaryReady = false;
        dualScreenCoordinator._channel?.close();
        dualScreenCoordinator._channel = null;
        dualScreenCoordinator._sessionId = null;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('serializes service, PMTiles, workspace filter, and picture markers', () => {
        const entry = serializeLayerForSync({
            id: 'svc-1',
            name: 'Live',
            type: 'service',
            service: { kind: 'arcgis-featureserver', url: 'http://127.0.0.1:18765/layer', style: { fillColor: '#112233' } },
            source: { format: 'live-service', url: 'http://127.0.0.1:18765/layer' },
            schema: { geometryType: 'Point', featureCount: 3 },
            workspaceAttributeFilter: { rules: [{ field: 'NAME', operator: 'equals', value: 'A' }], logic: 'AND' },
            _workspaceFilterIndices: [1, 4],
            _arcgisPictureMarkers: { field: 'MODEL', matchMode: 'unique', markers: [{ imageId: 'pms-1', imageData: 'abc', contentType: 'image/png' }] },
            pmtiles: null
        }, 0);

        expect(entry.service.url).toBe('http://127.0.0.1:18765/layer');
        expect(entry.service.style.fillColor).toBe('#112233');
        expect(entry.schema.geometryType).toBe('Point');
        expect(entry.workspaceAttributeFilter.rules[0].field).toBe('NAME');
        expect(entry.workspaceFilterIndices).toEqual([1, 4]);
        expect(entry.pictureMarkers.markers[0].imageId).toBe('pms-1');

        const tiles = serializeLayerForSync({
            id: 'pmt-1',
            name: 'Tiles',
            type: 'pmtiles',
            pmtiles: { url: 'idb:pmt-1', sourceLayer: 'features' },
            source: { format: 'pmtiles', url: 'idb:pmt-1' }
        }, 1);
        expect(tiles.pmtiles.url).toBe('idb:pmt-1');
        expect(tiles.source.url).toBe('idb:pmt-1');
    });

    it('plans service refresh, style rebuild, and attribute filter deltas', () => {
        const service = {
            id: 'svc',
            name: 'Live',
            type: 'service',
            visible: true,
            service: { url: 'http://127.0.0.1:18765/layer', kind: 'arcgis-featureserver' },
            geojson: pointCollection(1)
        };
        const added = planLayerDelta(new Map(), [], [service]);
        expect(added.calls.map((call) => call.method)).toEqual(['addLayer']);

        const refreshed = planLayerDelta(added.stamps, added.order, [{
            ...service,
            geojson: pointCollection(2)
        }]);
        expect(refreshed.calls.map((call) => call.method)).toEqual(['refreshServiceLayer']);
        expect(refreshed.calls[0].args).toEqual(['svc']);

        const styled = planLayerDelta(added.stamps, added.order, [{
            ...service,
            service: { ...service.service, style: { fillColor: '#ff0000' } }
        }]);
        expect(styled.calls.map((call) => call.method)).toEqual(['addLayer']);

        const filtered = planLayerDelta(added.stamps, added.order, [{
            ...service,
            _activeFilter: { rules: [{ field: 'NAME', operator: 'equals', value: 'Feature 1' }], logic: 'AND' }
        }]);
        expect(filtered.calls.map((call) => call.method)).toEqual(['syncWorkspaceAttributeFilter']);
    });

    it('stores a blob PMTiles archive and forwards an idb URL', async () => {
        const file = readFileSync(FIXTURE);
        const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            arrayBuffer: async () => bytes.slice(0)
        })));
        const addLayer = vi.fn();
        const api = { addLayer, setLayerStyle: vi.fn(), getLayerStyle: vi.fn(() => null) };
        installDualScreenMapServiceDecorator(api, dualScreenCoordinator);
        dualScreenCoordinator.isActive = true;

        const dataset = {
            id: 'pmt-blob',
            name: 'Blob',
            type: 'pmtiles',
            pmtiles: { url: 'blob:http://127.0.0.1/local-archive' },
            source: { format: 'pmtiles', url: 'blob:http://127.0.0.1/local-archive' }
        };
        api.addLayer(dataset, 0, { fit: false });
        await vi.waitFor(() => {
            const cmds = MockBroadcastChannel.traffic.filter((msg) => msg.type === MessageType.MAP_CMD);
            expect(cmds.some((msg) => msg.payload?.method === 'addLayer')).toBe(true);
        });

        const cmd = MockBroadcastChannel.traffic.find((msg) => msg.payload?.method === 'addLayer');
        expect(cmd.payload.args[0].pmtiles.url).toBe('idb:pmt-blob');
        expect(cmd.payload.args[0].source.url).toBe('idb:pmt-blob');
        expect(addLayer).not.toHaveBeenCalled();
        const published = await publishPmtilesDataset(dataset);
        expect(published.pmtiles.url).toBe('idb:pmt-blob');
    });

    it('adds a PMTiles layer through the protocol with a shared archive key', async () => {
        const file = readFileSync(FIXTURE);
        const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
        await putPmtilesArchive('point', bytes);
        const addProtocol = vi.fn();
        vi.stubGlobal('maplibregl', { addProtocol });
        ensurePmtilesProtocol();
        expect(addProtocol).toHaveBeenCalledWith('pmtiles', expect.any(Function));

        const sources = [];
        const fake = {
            map: {
                addSource: vi.fn((id, spec) => sources.push({ id, spec })),
                addLayer: vi.fn(),
                getLayer: vi.fn(() => ({ filter: ['==', ['geometry-type'], 'Point'] })),
                getSource: vi.fn(() => null),
                setFilter: vi.fn()
            },
            dataLayers: new Map(),
            _layerStyles: new Map(),
            _layerNames: new Map(),
            removeLayer: vi.fn(),
            _installVectorTileLayerSet: vi.fn(() => ['pmt-point']),
            _storeLayerScaleRange: vi.fn(),
            _applyDatasetVisibility: vi.fn(),
            _applyDatasetLock: vi.fn(),
            _applyAttributeFilter: mapManager._applyAttributeFilter
        };
        const dataset = {
            id: 'pmt-point',
            name: 'Points',
            type: 'pmtiles',
            pmtiles: { url: 'idb:point', sourceLayer: 'features' },
            source: { format: 'pmtiles', url: 'idb:point' },
            schema: { geometryType: 'Point', featureCount: 1 },
            _activeFilter: { rules: [{ field: 'NAME', operator: 'equals', value: 'Feature 1' }], logic: 'AND' }
        };
        await mapManager.addPmTilesLayer.call(fake, dataset, 0, { fit: false });
        expect(sources[0].spec.type).toBe('vector');
        expect(sources[0].spec.url).toBe('pmtiles://idb:point');
        expect(fake._installVectorTileLayerSet).toHaveBeenCalledWith(
            dataset,
            'src-pmt-point',
            expect.any(Object),
            'features'
        );
        expect(fake.map.setFilter).toHaveBeenCalled();
        const filter = fake.map.setFilter.mock.calls.at(-1)[1];
        expect(JSON.stringify(filter)).toContain('Feature 1');
    });

    it('builds a map filter that matches text or numeric properties', () => {
        const expr = attributeRulesToMapFilter([
            { field: 'NAME', operator: 'equals', value: 'Feature 1' },
            { field: 'SCORE', operator: 'greater_than', value: 0 }
        ], 'AND');
        expect(expr[0]).toBe('all');
        expect(JSON.stringify(expr)).toContain('Feature 1');
        expect(JSON.stringify(expr)).toContain('SCORE');
    });
});
