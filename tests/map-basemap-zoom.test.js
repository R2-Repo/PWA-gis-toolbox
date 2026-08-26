// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MapManager } from '../js/map/map-manager.js';
import { MAP_CAMERA_MAX_ZOOM } from '../js/map/scale-range.js';

vi.mock('../js/map/carto-style.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        loadCartoVectorStyle: vi.fn(async (_url, options = {}) => ({
            glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
            sprite: 'https://tiles.basemaps.cartocdn.com/gl/voyager-gl-style/sprite',
            backgroundColor: '#fbf8f3',
            sources: {
                'basemap-v-carto': {
                    type: 'vector',
                    url: 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json'
                }
            },
            layers: options.labelsOnly
                ? [{ id: 'basemap-v-place_city', type: 'symbol', source: 'basemap-v-carto' }]
                : [{ id: 'basemap-v-water', type: 'fill', source: 'basemap-v-carto', paint: { 'fill-opacity': 1 } }]
        }))
    };
});

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
        setLayoutProperty: vi.fn(),
        setGlyphs: vi.fn(),
        setSprite: vi.fn(),
        getStyle: () => ({
            sources: Object.fromEntries(sources),
            layers: [...layers.values()]
        })
    };
}

describe('basemap zoom overscale', () => {
    it('starts vector map styles with a backdrop and no raster source', () => {
        const manager = new MapManager();
        const style = manager._buildStyle('voyager');

        expect(style.sources.basemap).toBeUndefined();
        expect(style.layers.find((entry) => entry.id === 'basemap-backdrop')).toBeTruthy();
        expect(style.layers.find((entry) => entry.id === 'basemap-layer')).toBeUndefined();
        expect(style.glyphs).toContain('tiles.basemaps.cartocdn.com/fonts');
        expect(MAP_CAMERA_MAX_ZOOM).toBe(24);
    });

    it('keeps satellite sources at Esri native zoom', () => {
        const manager = new MapManager();
        const style = manager._buildStyle('satellite');

        expect(style.sources.basemap.maxzoom).toBe(19);
        expect(style.layers.find((entry) => entry.id === 'basemap-layer').maxzoom).toBeUndefined();
    });

    it('unlocks raster visibility past the camera ceiling after an in-place swap', async () => {
        const manager = new MapManager();
        manager.currentBasemap = 'voyager';
        manager._basemapTone = { tint: 'default', opacity: 1 };
        manager.map = createMap();

        await manager.setBasemap('satellite-labels');

        expect(manager.map.addSource).toHaveBeenCalledWith(
            'basemap',
            expect.objectContaining({ maxzoom: 19 })
        );
        expect(manager.map.setLayerZoomRange).toHaveBeenCalledWith(
            'basemap-layer',
            0,
            MAP_CAMERA_MAX_ZOOM + 1
        );
        expect(manager.map.getLayer('basemap-overlay-layer')).toBeUndefined();
        expect(manager.map.getLayer('basemap-v-place_city')).toBeTruthy();
    });
});
