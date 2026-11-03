/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../js/workspace/viewport-loader.js', () => ({
    buildViewportGeoJSON: vi.fn()
}));

import { MapManager } from '../js/map/map-manager.js';
import { buildViewportGeoJSON } from '../js/workspace/viewport-loader.js';

function createMockMap() {
    const layers = new Map();
    const sources = new Map();
    return {
        getCenter: () => ({ lng: -111.5, lat: 40.5 }),
        getZoom: () => 10,
        getBounds: () => ({
            getWest: () => -112,
            getSouth: () => 40,
            getEast: () => -111,
            getNorth: () => 41
        }),
        getLayer: (id) => layers.get(id),
        getSource: (id) => sources.get(id),
        addSource: (id, spec) => {
            sources.set(id, {
                ...spec,
                setData(data) {
                    this.data = data;
                }
            });
        },
        addLayer: (spec) => { layers.set(spec.id, spec); },
        removeLayer: (id) => { layers.delete(id); },
        setLayerZoomRange: vi.fn(),
        setLayoutProperty: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        getCanvas: () => ({ style: {} })
    };
}

const polygonFeature = {
    type: 'Feature',
    properties: { name: 'A' },
    geometry: {
        type: 'Polygon',
        coordinates: [[[-111.2, 40.2], [-111.1, 40.2], [-111.1, 40.3], [-111.2, 40.2]]]
    }
};

function workspaceDataset(geometryType = 'Polygon') {
    return {
        id: 'parcels',
        name: 'Parcels',
        type: 'spatial-chunked',
        storage: 'workspace',
        workspaceLayerId: 'parcels',
        schema: { geometryType, fields: [{ name: 'name', type: 'string' }] },
        geojson: { type: 'FeatureCollection', features: [] }
    };
}

const labelStyle = {
    mode: 'simple',
    labels: {
        enabled: true,
        field: 'name',
        placement: 'point',
        minZoom: 12,
        maxZoom: 18
    }
};

describe('empty workspace viewport label layers', () => {
    it('creates a label layer from schema when the first batch has no features', () => {
        const manager = new MapManager();
        manager.map = createMockMap();
        const ids = manager._installGeoJsonChunk(workspaceDataset(), [], 0, labelStyle);
        expect(ids).toContain('parcels-labels');
        expect(manager.map.getSource('src-parcels')).toBeTruthy();
        const label = manager.map.getLayer('parcels-labels');
        expect(label.minzoom).toBe(12);
        expect(label.maxzoom).toBe(18);
    });

    it('adds the label layer when a later batch arrives after an empty install', async () => {
        buildViewportGeoJSON.mockResolvedValue({
            type: 'FeatureCollection',
            truncated: false,
            features: [polygonFeature]
        });
        const manager = new MapManager();
        manager.map = createMockMap();
        const dataset = workspaceDataset(null);
        manager._workspaceDatasets = new Map([[dataset.id, dataset]]);
        manager._layerStyles.set(dataset.id, labelStyle);
        manager.dataLayers.set(dataset.id, {
            sourceId: 'src-parcels',
            layerIds: [],
            chunkSources: [],
            colorIndex: 0,
            workspace: true,
            geojson: { type: 'FeatureCollection', features: [] }
        });

        await manager.refreshWorkspaceLayerViewport(dataset.id);

        expect(manager.map.getSource('src-parcels')).toBeTruthy();
        const label = manager.map.getLayer('parcels-labels');
        expect(label).toBeTruthy();
        expect(label.minzoom).toBe(12);
        expect(label.maxzoom).toBe(18);
        expect(manager.dataLayers.get(dataset.id).layerIds).toContain('parcels-labels');
    });
});
