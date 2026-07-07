// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MapManager } from '../js/map/map-manager.js';

function createMockMap({
    terrain = null,
    pitch = 0,
    bearing = 0,
    center = { lng: -111, lat: 39 },
    zoom = 7
} = {}) {
    const layers = new Map();
    const sources = new Map();
    let terrainState = terrain;

    return {
        getTerrain: () => terrainState,
        setTerrain: vi.fn((spec) => { terrainState = spec; }),
        getPitch: () => pitch,
        getBearing: () => bearing,
        getCenter: () => center,
        getZoom: () => zoom,
        getLayer: (id) => (layers.has(id) ? { id } : undefined),
        getSource: (id) => (sources.has(id) ? { id } : undefined),
        addSource: vi.fn((id, spec) => { sources.set(id, spec); }),
        removeSource: vi.fn((id) => { sources.delete(id); }),
        addLayer: vi.fn((spec) => { layers.set(spec.id, spec); }),
        removeLayer: vi.fn((id) => { layers.delete(id); }),
        getStyle: () => ({ layers: [{ id: 'basemap-layer' }] }),
        jumpTo: vi.fn((opts) => {
            if (opts.pitch != null) pitch = opts.pitch;
            if (opts.bearing != null) bearing = opts.bearing;
        }),
        easeTo: vi.fn((opts) => {
            if (opts.pitch != null) pitch = opts.pitch;
            if (opts.bearing != null) bearing = opts.bearing;
        }),
        once: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        dragRotate: { enable: vi.fn(), disable: vi.fn() },
        touchZoomRotate: { enableRotation: vi.fn(), disableRotation: vi.fn() }
    };
}

describe('MapManager 3D reconcile', () => {
    it('re-applies terrain when _3dEnabled is true but the map has no terrain (post-destroy)', () => {
        const manager = new MapManager();
        manager._3dEnabled = true;
        manager._terrainEnabled = true;
        manager._buildingsEnabled = true;
        manager.map = createMockMap({ terrain: null });
        manager._setAllAnnotationMapLibreVisibility = vi.fn();
        manager._annotationOverlay = { setActive: vi.fn() };
        manager._apply3D = vi.fn(() => {
            manager.map.setTerrain({ source: 'terrain-source', exaggeration: 1.5 });
            manager._terrainEnabled = true;
        });

        manager.reconcile3DState({
            camera: { pitch: 45, center: [-111, 39], zoom: 10, bearing: 12 },
            emitEvent: false
        });

        expect(manager._apply3D).toHaveBeenCalled();
        expect(manager.map.dragRotate.enable).toHaveBeenCalled();
        expect(manager.map.jumpTo).toHaveBeenCalledWith(expect.objectContaining({
            pitch: 45,
            bearing: 12,
            freezeElevation: true
        }));
    });

    it('resets stale asset flags on destroy while preserving _3dEnabled intent', () => {
        const manager = new MapManager();
        manager._3dEnabled = true;
        manager._terrainEnabled = true;
        manager._buildingsEnabled = true;
        manager.map = createMockMap();
        manager.map.remove = vi.fn();
        manager._annotationOverlay = { destroy: vi.fn() };

        manager.destroy();

        expect(manager._3dEnabled).toBe(true);
        expect(manager._terrainEnabled).toBe(false);
        expect(manager._buildingsEnabled).toBe(false);
        expect(manager.map).toBeNull();
    });

    it('flattens camera without terrain when disabling from a pitched orphan view', () => {
        const manager = new MapManager();
        manager._3dEnabled = true;
        manager.map = createMockMap({ pitch: 30, bearing: 15, terrain: null });
        manager._setAllAnnotationMapLibreVisibility = vi.fn();
        manager._annotationOverlay = { setActive: vi.fn() };

        manager.disable3D({ animate: false });

        expect(manager._3dEnabled).toBe(false);
        expect(manager.map.jumpTo).toHaveBeenCalledWith(expect.objectContaining({
            pitch: 0,
            bearing: 0,
            freezeElevation: true
        }));
        expect(manager.map.dragRotate.disable).toHaveBeenCalled();
    });

    it('sync teardowns terrain immediately when disabling without animation', () => {
        const manager = new MapManager();
        manager._3dEnabled = true;
        manager._terrainEnabled = true;
        manager.map = createMockMap({ pitch: 45, bearing: 20, terrain: { source: 'terrain-source' } });
        manager._setAllAnnotationMapLibreVisibility = vi.fn();
        manager._annotationOverlay = { setActive: vi.fn() };
        manager._teardown3DAssetsSync = vi.fn(() => {
            manager.map.setTerrain(null);
        });

        manager.disable3D({ animate: false });

        expect(manager._teardown3DAssetsSync).toHaveBeenCalled();
        expect(manager.map.jumpTo).toHaveBeenCalledWith(expect.objectContaining({
            pitch: 0,
            bearing: 0
        }));
        expect(manager._3dEnabled).toBe(false);
    });

    it('enable3D applies assets when flag is already true but terrain is missing', () => {
        const manager = new MapManager();
        manager._3dEnabled = true;
        manager._terrainEnabled = true;
        manager._buildingsEnabled = true;
        manager.map = createMockMap({ terrain: null });
        manager._setAllAnnotationMapLibreVisibility = vi.fn();
        manager._annotationOverlay = { setActive: vi.fn() };
        manager._apply3D = vi.fn(() => {
            manager.map.setTerrain({ source: 'terrain-source' });
        });

        manager.enable3D({ skipCamera: true });

        expect(manager._apply3D).toHaveBeenCalled();
    });

    it('re-applies buildings when terrain is active but the buildings layer is missing', () => {
        const manager = new MapManager();
        manager._3dEnabled = true;
        manager._terrainEnabled = true;
        manager._buildingsEnabled = true;
        manager.map = createMockMap({ terrain: { source: 'terrain-source' } });
        manager._setAllAnnotationMapLibreVisibility = vi.fn();
        manager._annotationOverlay = { setActive: vi.fn() };
        manager._apply3D = vi.fn(() => {
            manager.map.addLayer({ id: '3d-buildings', type: 'fill-extrusion' });
            manager._buildingsEnabled = true;
        });

        manager.reconcile3DState({ emitEvent: false });

        expect(manager._apply3D).toHaveBeenCalled();
    });
});
