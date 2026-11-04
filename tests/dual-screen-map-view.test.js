/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { createMapService } from '../js/map/map-service.js';
import { resolveSessionRestoreCamera, sessionMetaRecord } from '../js/core/session-store.js';

function fakeMap(view) {
    return {
        getCenter: () => ({ lng: view.center[0], lat: view.center[1] }),
        getZoom: () => view.zoom,
        getBearing: () => view.bearing,
        getPitch: () => view.pitch,
        jumpTo: (camera) => {
            view.applied = camera;
        }
    };
}

describe('map view bridge helpers', () => {
    it('reads and applies a view on the local map', () => {
        const state = { center: [-111.25, 40.5], zoom: 11, bearing: 15, pitch: 25, applied: null };
        const map = fakeMap(state);
        const api = createMapService({ mapAdapter: { getMap: () => map } });
        expect(api.getMapView()).toEqual({
            center: [-111.25, 40.5],
            zoom: 11,
            bearing: 15,
            pitch: 25
        });
        expect(api.applyMapView({ center: [-112, 41], zoom: 8, bearing: 0, pitch: 0 })).toBe(true);
        expect(state.applied).toEqual({
            center: [-112, 41],
            zoom: 8,
            bearing: 0,
            pitch: 0
        });
    });

    it('keeps single-screen session restore on fit or skip', () => {
        expect(resolveSessionRestoreCamera({
            dualActive: false,
            mapView: { center: [-111, 40], zoom: 10, bearing: 1, pitch: 2 },
            userMovedCamera: false
        }).action).toBe('fit');
        expect(resolveSessionRestoreCamera({
            dualActive: false,
            mapView: { center: [-111, 40], zoom: 10 },
            userMovedCamera: true
        }).action).toBe('skip');
    });

    it('applies a saved view only when dual-screen is active', () => {
        const plan = resolveSessionRestoreCamera({
            dualActive: true,
            mapView: { center: [-111.1, 40.2], zoom: 13, bearing: 4, pitch: 35 },
            userMovedCamera: true
        });
        expect(plan.action).toBe('apply');
        expect(plan.mapView).toEqual({
            center: [-111.1, 40.2],
            zoom: 13,
            bearing: 4,
            pitch: 35
        });
        expect(resolveSessionRestoreCamera({ dualActive: true, mapView: null }).action).toBe('fit');
    });
});

describe('session map view persistence', () => {
    it('stores a map view on the session meta and omits it when absent', () => {
        const layers = [{ id: 'layer-a', active: true }];
        const saved = sessionMetaRecord(layers, {
            center: [-111.4, 40.6],
            zoom: 12,
            bearing: 8,
            pitch: 20
        }, 10);
        expect(saved.mapView).toEqual({
            center: [-111.4, 40.6],
            zoom: 12,
            bearing: 8,
            pitch: 20
        });
        expect(saved.activeLayerId).toBe('layer-a');
        expect(sessionMetaRecord(layers, null, 10).mapView).toBeUndefined();
    });
});
