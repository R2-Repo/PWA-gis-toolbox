// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MapManager } from '../js/map/map-manager.js';
import { MAP_CAMERA_MAX_ZOOM } from '../js/map/scale-range.js';

function createMap() {
    const layers = new Map();
    const sources = new Map();

    return {
        getLayer: (id) => layers.get(id),
        getSource: (id) => sources.get(id),
        addSource: vi.fn((id, spec) => { sources.set(id, spec); }),
        removeSource: vi.fn((id) => { sources.delete(id); }),
        addLayer: vi.fn((spec) => { layers.set(spec.id, spec); }),
        removeLayer: vi.fn((id) => { layers.delete(id); }),
        setLayerZoomRange: vi.fn(),
        setPaintProperty: vi.fn(),
        getStyle: () => ({
            sources: Object.fromEntries(sources),
            layers: [...layers.values()]
        })
    };
}

describe('basemap zoom overscale', () => {
    it('caps raster sources at native tile zoom and does not hide layers at camera max', () => {
        const manager = new MapManager();
        const style = manager._buildStyle('voyager');
        const layer = style.layers.find((entry) => entry.id === 'basemap-layer');

        expect(style.sources.basemap.maxzoom).toBe(20);
        expect(layer.maxzoom).toBeUndefined();
        expect(MAP_CAMERA_MAX_ZOOM).toBe(24);
    });

    it('keeps satellite sources at Esri native zoom', () => {
        const manager = new MapManager();
        const style = manager._buildStyle('satellite');

        expect(style.sources.basemap.maxzoom).toBe(19);
        expect(style.layers.find((entry) => entry.id === 'basemap-layer').maxzoom).toBeUndefined();
    });

    it('unlocks raster visibility past the camera ceiling after an in-place swap', () => {
        const manager = new MapManager();
        manager.currentBasemap = 'voyager';
        manager._basemapTone = { tint: 'default', opacity: 1 };
        manager.map = createMap();

        manager.setBasemap('satellite-labels');

        expect(manager.map.addSource).toHaveBeenCalledWith(
            'basemap',
            expect.objectContaining({ maxzoom: 19 })
        );
        expect(manager.map.setLayerZoomRange).toHaveBeenCalledWith(
            'basemap-layer',
            0,
            MAP_CAMERA_MAX_ZOOM + 1
        );
        expect(manager.map.setLayerZoomRange).toHaveBeenCalledWith(
            'basemap-overlay-layer',
            0,
            MAP_CAMERA_MAX_ZOOM + 1
        );
    });
});
