// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MapManager } from '../js/map/map-manager.js';

function createMap({
    terrain = { source: 'terrain-source', exaggeration: 1.2 },
    pitch = 30,
    bearing = 0,
    center = { lng: -111, lat: 39 },
    zoom = 7
} = {}) {
    const layers = new Map();
    const sources = new Map();
    let terrainState = terrain;

    const seedLayer = (spec) => layers.set(spec.id, spec);
    const seedSource = (id, spec) => sources.set(id, spec);

    seedSource('basemap', { type: 'raster', tiles: ['voyager/{z}/{x}/{y}.png'] });
    seedSource('terrain-source', { type: 'raster-dem' });
    seedSource('hillshade-source', { type: 'raster-dem' });
    seedLayer({ id: 'basemap-backdrop', type: 'background' });
    seedLayer({ id: 'basemap-layer', type: 'raster', source: 'basemap' });
    seedLayer({ id: 'hillshade', type: 'hillshade', source: 'hillshade-source' });
    seedLayer({ id: 'sky', type: 'sky' });
    seedLayer({ id: '3d-buildings', type: 'fill-extrusion', source: 'openfreemap' });

    return {
        getTerrain: () => terrainState,
        setTerrain: vi.fn((spec) => { terrainState = spec; }),
        setStyle: vi.fn(),
        setPaintProperty: vi.fn(),
        setLayerZoomRange: vi.fn(),
        setFilter: vi.fn(),
        getPitch: () => pitch,
        getBearing: () => bearing,
        getCenter: () => center,
        getZoom: () => zoom,
        getLayer: (id) => layers.get(id),
        getSource: (id) => sources.get(id),
        addSource: vi.fn((id, spec) => { sources.set(id, spec); }),
        removeSource: vi.fn((id) => { sources.delete(id); }),
        addLayer: vi.fn((spec) => { layers.set(spec.id, spec); }),
        removeLayer: vi.fn((id) => { layers.delete(id); }),
        getStyle: () => ({
            sources: Object.fromEntries(sources),
            layers: [...layers.values()]
        }),
        jumpTo: vi.fn(),
        easeTo: vi.fn(),
        once: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        dragRotate: { enable: vi.fn(), disable: vi.fn() },
        touchZoomRotate: { enableRotation: vi.fn(), disableRotation: vi.fn() }
    };
}

function createManager(mapOptions) {
    const manager = new MapManager();
    manager._3dEnabled = true;
    manager._terrainEnabled = true;
    manager._buildingsEnabled = true;
    manager.currentBasemap = 'voyager';
    manager._basemapTone = { tint: 'default', opacity: 1 };
    manager.map = createMap(mapOptions);
    return manager;
}

describe('MapManager 3D basemap swap', () => {
    it('swaps raster sources in 3D without setStyle or setTerrain', () => {
        const manager = createManager();

        manager.setBasemap('dark-matter');

        expect(manager.currentBasemap).toBe('dark-matter');
        expect(manager.map.setStyle).not.toHaveBeenCalled();
        expect(manager.map.setTerrain).not.toHaveBeenCalled();
        expect(manager.map.removeSource).toHaveBeenCalledWith('basemap');
        expect(manager.map.addSource).toHaveBeenCalledWith(
            'basemap',
            expect.objectContaining({ type: 'raster', tiles: expect.any(Array) })
        );
        expect(manager.map.getLayer('hillshade')?.source).toBe('hillshade-source');
        expect(manager.map.getLayer('3d-buildings')).toBeTruthy();
    });

    it('is a no-op when the same basemap is already active', () => {
        const manager = createManager();

        manager.setBasemap('voyager');

        expect(manager.map.setStyle).not.toHaveBeenCalled();
        expect(manager.map.removeSource).not.toHaveBeenCalled();
        expect(manager.map.addSource).not.toHaveBeenCalled();
    });

    it('adds an overlay for satellite-labels and removes hillshade', () => {
        const manager = createManager();

        manager.setBasemap('satellite-labels');

        expect(manager.map.addSource).toHaveBeenCalledWith(
            'basemap-overlay',
            expect.objectContaining({ type: 'raster', tiles: expect.any(Array) })
        );
        expect(manager.map.getLayer('basemap-overlay-layer')).toBeTruthy();
        expect(manager.map.getLayer('hillshade')).toBeUndefined();
        expect(manager.map.setTerrain).not.toHaveBeenCalled();
    });

    it('restores hillshade from its own DEM source when leaving satellite', () => {
        const manager = createManager();
        manager.setBasemap('satellite');
        expect(manager.map.getLayer('hillshade')).toBeUndefined();

        manager.setBasemap('positron');

        expect(manager.map.getLayer('hillshade')?.source).toBe('hillshade-source');
        expect(manager.map.getSource('hillshade-source')).toBeTruthy();
        expect(manager.map.setStyle).not.toHaveBeenCalled();
    });

    it('reapplies tone paint after an in-place swap', () => {
        const manager = createManager();
        manager._basemapTone = { tint: 'dark', opacity: 0.7 };

        manager.setBasemap('positron');

        expect(manager.map.setPaintProperty).toHaveBeenCalledWith(
            'basemap-layer',
            'raster-opacity',
            0.7
        );
    });
});

describe('MapManager 3D apply', () => {
    it('does not call setTerrain when terrain is already active', () => {
        const manager = createManager();

        manager._apply3D();

        expect(manager.map.setTerrain).not.toHaveBeenCalled();
        expect(manager.map.getLayer('hillshade')?.source).toBe('hillshade-source');
    });

    it('sets terrain only when it is missing', () => {
        const manager = createManager({ terrain: null });

        manager._apply3D();

        expect(manager.map.setTerrain).toHaveBeenCalledWith({
            source: 'terrain-source',
            exaggeration: 1.2
        });
    });

    it('teardown removes the dedicated hillshade DEM source', () => {
        const manager = createManager();

        manager._teardown3DAssetsSync();

        expect(manager.map.setTerrain).toHaveBeenCalledWith(null);
        expect(manager.map.getSource('hillshade-source')).toBeUndefined();
        expect(manager.map.getSource('terrain-source')).toBeUndefined();
        expect(manager.map.getLayer('hillshade')).toBeUndefined();
    });
});
