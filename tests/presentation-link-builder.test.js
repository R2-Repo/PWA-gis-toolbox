import { describe, expect, it, beforeAll } from 'vitest';
import * as turf from '@turf/turf';
import { buildSceneFromConfig, buildLimitSummary, COMBO_PACE_MS, ORBIT_PACE_MS, splitComboDurations, validateSceneForUrl } from '../js/widgets/presentation-link-builder/engine.js';
import {
    computeFeatureFitCamera,
    computeOverviewCamera
} from '../js/presentation/animation-engine.js';

beforeAll(() => {
    globalThis.turf = turf;
});

const sampleFeatures = {
    type: 'FeatureCollection',
    features: [{
        type: 'Feature',
        properties: { name: 'Site A' },
        geometry: {
            type: 'Polygon',
            coordinates: [[
                [-111.91, 40.69],
                [-111.89, 40.69],
                [-111.89, 40.71],
                [-111.91, 40.71],
                [-111.91, 40.69]
            ]]
        }
    }]
};

function createMockMap({ overviewZoom = 10, finalZoom = 16 } = {}) {
    let currentZoom = overviewZoom;
    return {
        getCenter: () => ({ lng: -111.9, lat: 40.7 }),
        getZoom: () => currentZoom,
        getPitch: () => 45,
        getBearing: () => 30,
        fitBounds(_bounds, options = {}) {
            currentZoom = options.maxZoom ?? currentZoom;
        },
        jumpTo(state) {
            if (state.zoom != null) currentZoom = state.zoom;
        }
    };
}

describe('buildSceneFromConfig camera strategy', () => {
    it('sets fitToFeatures for none animation', () => {
        const scene = buildSceneFromConfig({
            features: sampleFeatures,
            map: createMockMap(),
            mapService: { getCurrentBasemap: () => 'voyager', is3DEnabled: () => true },
            animation: { presetId: 'none' }
        });
        expect(scene.camera.fitToFeatures).toBe(true);
        expect(scene.animations).toHaveLength(0);
    });

    it('keeps the saved builder camera for orbit animation', () => {
        const map = createMockMap();
        map.getCenter = () => ({ lng: -111.85, lat: 40.72 });
        map.getZoom = () => 15;
        map.getPitch = () => 60;
        map.getBearing = () => 45;
        const scene = buildSceneFromConfig({
            features: sampleFeatures,
            map,
            mapService: { getCurrentBasemap: () => 'voyager', is3DEnabled: () => true },
            animation: {
                presetId: 'rotateAroundFeature',
                durationMs: ORBIT_PACE_MS.slow
            }
        });
        expect(scene.camera.fitToFeatures).toBe(false);
        expect(scene.camera.center[0]).toBeCloseTo(-111.85, 2);
        expect(scene.camera.center[1]).toBeCloseTo(40.72, 2);
        expect(scene.camera.zoom).toBe(15);
        expect(scene.camera.pitch).toBe(60);
        expect(scene.camera.bearing).toBe(45);
        expect(scene.animations).toHaveLength(1);
        expect(scene.animations[0].type).toBe('rotateAroundFeature');
        expect(scene.animations[0].durationMs).toBe(ORBIT_PACE_MS.slow);
    });

    it('uses a wider overview camera than the final fly-to fit', () => {
        const map = createMockMap({ overviewZoom: 10, finalZoom: 16 });
        const scene = buildSceneFromConfig({
            features: sampleFeatures,
            map,
            mapService: { getCurrentBasemap: () => 'voyager', is3DEnabled: () => true },
            animation: {
                presetId: 'flyToFeature',
                durationMs: 8000
            }
        });
        expect(scene.camera.fitToFeatures).toBe(false);
        expect(scene.camera.center[0]).toBeCloseTo(-111.9, 2);
        expect(scene.camera.center[1]).toBeCloseTo(40.7, 2);
        expect(scene.camera.zoom).toBeLessThanOrEqual(11);
        expect(scene.camera.pitch).toBe(0);
        expect(scene.animations).toHaveLength(1);
        expect(scene.animations[0].type).toBe('flyToFeature');
        expect(scene.animations[0].durationMs).toBe(8000);
        expect(scene.animations[0].options.pitch).toBe(45);
    });

    it('uses overview camera and split durations for fly-then-orbit', () => {
        const map = createMockMap({ overviewZoom: 10, finalZoom: 16 });
        const scene = buildSceneFromConfig({
            features: sampleFeatures,
            map,
            mapService: { getCurrentBasemap: () => 'voyager', is3DEnabled: () => true },
            animation: {
                presetId: 'flyToFeatureThenOrbit',
                durationMs: COMBO_PACE_MS.normal
            }
        });
        const { flyDurationMs, orbitDurationMs } = splitComboDurations(COMBO_PACE_MS.normal);
        expect(scene.camera.fitToFeatures).toBe(false);
        expect(scene.camera.pitch).toBe(0);
        expect(scene.animations).toHaveLength(1);
        expect(scene.animations[0].type).toBe('flyToFeatureThenOrbit');
        expect(scene.animations[0].durationMs).toBe(COMBO_PACE_MS.normal);
        expect(scene.animations[0].options.flyDurationMs).toBe(flyDurationMs);
        expect(scene.animations[0].options.orbitDurationMs).toBe(orbitDurationMs);
    });
});

describe('presentation link validation summary', () => {
    it('blocks scenes with too many vertices', () => {
        const dense = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: Array.from({ length: 1200 }, (_, i) => [-111.9 + i * 0.0001, 40.7])
                }
            }]
        };
        const scene = buildSceneFromConfig({
            features: dense,
            map: createMockMap(),
            mapService: { getCurrentBasemap: () => 'voyager', is3DEnabled: () => true },
            animation: { presetId: 'none' }
        });
        const validation = validateSceneForUrl(scene);
        const limits = buildLimitSummary(validation);

        expect(validation.ok).toBe(false);
        expect(limits.verticesOk).toBe(false);
        expect(limits.vertexCount).toBeGreaterThan(limits.maxVertices);
    });
});

describe('fly-to camera helpers', () => {
    it('returns overview zoom below the tight feature fit zoom', () => {
        const map = createMockMap({ overviewZoom: 10, finalZoom: 16 });
        const targetFit = computeFeatureFitCamera(map, sampleFeatures, { padding: 80, pitch: 45, bearing: 30 });
        const overview = computeOverviewCamera(sampleFeatures, {
            map,
            padding: 120,
            targetZoom: targetFit?.zoom
        });
        expect(targetFit).not.toBeNull();
        expect(overview).not.toBeNull();
        expect(overview.zoom).toBeLessThan(targetFit.zoom);
        expect(overview.pitch).toBe(0);
        expect(overview.center).toHaveLength(2);
    });
});
