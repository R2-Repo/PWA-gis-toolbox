import { describe, expect, it } from 'vitest';
import {
    NETWORK_ATLAS_ADAPTER,
    buildNetworkAtlasReadonlyDatasets,
    isNetworkAtlasReadonlyLayer
} from '../js/atlas/network-atlas-layer-adapter.js';

describe('NetworkAtlasLayerAdapter', () => {
    it('builds read-only hubs/drops datasets from a snapshot', () => {
        const snap = {
            loaded: true,
            selection: null,
            prefs: { mapPingFilter: 'all' },
            hubs: [
                { id: 'h1', lat: 40.5, lon: -111.8, hubCode: 'H1', name: 'Hub One', hubIp: '' }
            ],
            drops: [
                { id: 'd1', lat: 40.51, lon: -111.81, dropNumber: 1, inventoryName: 'Drop 1', ip: '' }
            ],
            connectedBuildings: [],
            pingResults: {}
        };
        const built = buildNetworkAtlasReadonlyDatasets(snap);
        expect(built).toBeTruthy();
        expect(built.hubs.source.adapter).toBe(NETWORK_ATLAS_ADAPTER);
        expect(built.hubs.source.readOnly).toBe(true);
        expect(built.hubs.geojson.features).toHaveLength(1);
        expect(built.drops.geojson.features).toHaveLength(1);
        expect(isNetworkAtlasReadonlyLayer(built.hubs)).toBe(true);
    });

    it('returns null when Atlas is not loaded', () => {
        expect(buildNetworkAtlasReadonlyDatasets({ loaded: false })).toBeNull();
    });
});
