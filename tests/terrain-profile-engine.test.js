import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    SAMPLE_ELEVATIONS_CLOSED_ERROR,
    SAMPLE_ELEVATIONS_TIMEOUT_ERROR
} from '../js/dual-screen/map-bridge.js';
import {
    EARTH_RADIUS_M,
    MAX_PROFILE_SAMPLES,
    REFRACTION_K,
    buildElevationProfile,
    buildLineOfSight,
    buildSightBeam,
    buildTerrainFeatureCollection,
    densifyCoordinates,
    earthBulgeMeters,
    evaluateLineOfSight,
    haversineMeters,
    profileChartSegments,
    summarizeElevations,
    terrainViewsMatch
} from '../js/widgets/terrain-profile/engine.js';
import { beamRibbonPositions } from '../js/widgets/terrain-profile/beam-layer.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function flatSampler(elevation) {
    return async (points) => points.map(() => elevation);
}

describe('terrain profile distances and densify', () => {
    it('measures equatorial distance with the shared earth radius', () => {
        const expected = EARTH_RADIUS_M * (0.001 * Math.PI / 180);
        expect(haversineMeters(0, 0, 0.001, 0)).toBeCloseTo(expected, 6);
    });

    it('densifies a line to the spacing and keeps the total distance', () => {
        const end = [0.001, 0];
        const total = haversineMeters(0, 0, end[0], end[1]);
        const samples = densifyCoordinates([[0, 0], end], total / 2);
        expect(samples).toHaveLength(3);
        expect(samples[0]).toMatchObject({ lng: 0, lat: 0, distanceM: 0 });
        expect(samples[1].lng).toBeCloseTo(0.0005, 8);
        expect(samples[1].distanceM).toBeCloseTo(total / 2, 5);
        expect(samples[2].lng).toBeCloseTo(end[0], 8);
        expect(samples[2].lat).toBe(0);
        expect(samples[2].distanceM).toBeCloseTo(total, 5);
    });

    it('keeps original vertices on a two-segment line', () => {
        const bend = [0.001, 0];
        const end = [0.001, 0.001];
        const samples = densifyCoordinates([[0, 0], bend, end], 80);
        const vertex = samples.find((sample) => sample.lng === bend[0] && sample.lat === bend[1]);
        expect(vertex).toBeTruthy();
        expect(vertex.distanceM).toBeCloseTo(haversineMeters(0, 0, bend[0], bend[1]), 5);
        expect(samples.at(-1).distanceM).toBeCloseTo(
            haversineMeters(0, 0, bend[0], bend[1]) + haversineMeters(bend[0], bend[1], end[0], end[1]),
            4
        );
    });

    it('rejects a zero-length line and an oversized sample count', () => {
        expect(() => densifyCoordinates([[10, 10], [10, 10]], 30)).toThrow(/no length/);
        expect(() => densifyCoordinates([[0, 0]], 30)).toThrow(/at least two points/);
        expect(() => densifyCoordinates([[0, 0], [0, 1]], 1)).toThrow(new RegExp(String(MAX_PROFILE_SAMPLES)));
    });
});

describe('terrain profile elevation stats', () => {
    it('sums gain and loss and ignores nothing on a continuous profile', () => {
        const stats = summarizeElevations([
            { distanceM: 0, elevationM: 5 },
            { distanceM: 10, elevationM: 9 },
            { distanceM: 20, elevationM: 7 },
            { distanceM: 30, elevationM: 8 }
        ]);
        expect(stats.min).toBe(5);
        expect(stats.max).toBe(9);
        expect(stats.gain).toBe(5);
        expect(stats.loss).toBe(2);
        expect(stats.gapCount).toBe(0);
        expect(stats.totalDistanceM).toBe(30);
    });

    it('does not carry gain or loss across null gaps', () => {
        const samples = [
            { distanceM: 0, elevationM: 10 },
            { distanceM: 10, elevationM: null },
            { distanceM: 20, elevationM: 100 },
            { distanceM: 30, elevationM: 90 }
        ];
        const stats = summarizeElevations(samples);
        expect(stats.gain).toBe(0);
        expect(stats.loss).toBe(10);
        expect(stats.min).toBe(10);
        expect(stats.max).toBe(100);
        expect(stats.gapCount).toBe(1);
        expect(stats.validCount).toBe(3);
        expect(profileChartSegments(samples)).toEqual([
            [{ distanceM: 0, elevationM: 10 }],
            [{ distanceM: 20, elevationM: 100 }, { distanceM: 30, elevationM: 90 }]
        ]);
    });

    it('zips sampler nulls into the profile without inventing elevations', async () => {
        let received = null;
        const profile = await buildElevationProfile({
            coordinates: [[0, 0], [0.001, 0]],
            spacingM: 1000,
            sampleElevations: async (points) => {
                received = points;
                return [20, null];
            }
        });
        expect(received).toEqual([[0, 0], [0.001, 0]]);
        expect(profile.samples.map((sample) => sample.elevationM)).toEqual([20, null]);
        expect(profile.stats.gain).toBe(0);
        expect(profile.stats.loss).toBe(0);
        expect(profile.stats.min).toBe(20);
        expect(profile.stats.max).toBe(20);
        expect(profile.stats.gapCount).toBe(1);
        expect(profile.segments).toEqual([[{ distanceM: 0, elevationM: 20 }]]);
    });

    it('reports a closed map window and a timeout with the bridge messages', async () => {
        const input = {
            coordinates: [[0, 0], [0.001, 0]],
            spacingM: 1000
        };
        await expect(buildElevationProfile({
            ...input,
            sampleElevations: async () => {
                throw new Error(SAMPLE_ELEVATIONS_TIMEOUT_ERROR);
            }
        })).rejects.toThrow(SAMPLE_ELEVATIONS_TIMEOUT_ERROR);
        await expect(buildElevationProfile({
            ...input,
            sampleElevations: async () => {
                throw new Error(SAMPLE_ELEVATIONS_CLOSED_ERROR);
            }
        })).rejects.toThrow(SAMPLE_ELEVATIONS_CLOSED_ERROR);
    });
});

describe('line of sight', () => {
    const hill = [
        { lng: -111.5, lat: 40.5, distanceM: 0, elevationM: 1000 },
        { lng: -111.4, lat: 40.5, distanceM: 500, elevationM: 1200 },
        { lng: -111.3, lat: 40.52, distanceM: 1500, elevationM: 1000 },
        { lng: -111.2, lat: 40.55, distanceM: 3000, elevationM: 1000 }
    ];

    it('is visible when the sight line clears the terrain', () => {
        const sight = evaluateLineOfSight({
            samples: hill,
            observerHeightM: 300,
            targetHeightM: 0,
            curvature: false
        });
        expect(sight.visible).toBe(true);
        expect(sight.obstruction).toBeNull();
    });

    it('is blocked at the first obstructing sample', () => {
        const sight = evaluateLineOfSight({
            samples: hill,
            observerHeightM: 2,
            targetHeightM: 2,
            curvature: false
        });
        expect(sight.visible).toBe(false);
        expect(sight.obstruction.index).toBe(1);
        expect(sight.obstruction.lng).toBe(-111.4);
        expect(sight.obstruction.lat).toBe(40.5);
        expect(sight.obstruction.distanceM).toBe(500);
        expect(sight.obstruction.elevationM).toBe(1200);
        expect(sight.obstruction.losM).toBeCloseTo(1002, 5);
    });

    it('uses observer and target heights above ground', () => {
        const low = evaluateLineOfSight({
            samples: hill,
            observerHeightM: 10,
            targetHeightM: 0,
            curvature: false
        });
        const high = evaluateLineOfSight({
            samples: hill,
            observerHeightM: 300,
            targetHeightM: 0,
            curvature: false
        });
        expect(low.visible).toBe(false);
        expect(low.obstruction.losM).toBeCloseTo(1008.333, 2);
        expect(high.visible).toBe(true);
        expect(high.observerAbsoluteM).toBe(1300);
        expect(high.targetAbsoluteM).toBe(1000);
    });

    it('skips null samples and still finds a later obstruction', () => {
        const samples = [
            { lng: 0, lat: 0, distanceM: 0, elevationM: 0 },
            { lng: 0.01, lat: 0, distanceM: 100, elevationM: null },
            { lng: 0.02, lat: 0, distanceM: 200, elevationM: 50 },
            { lng: 0.03, lat: 0, distanceM: 300, elevationM: 0 }
        ];
        const blocked = evaluateLineOfSight({
            samples,
            observerHeightM: 1,
            targetHeightM: 1,
            curvature: false
        });
        expect(blocked.visible).toBe(false);
        expect(blocked.obstruction.index).toBe(2);
        expect(blocked.obstruction.lng).toBe(0.02);

        const open = evaluateLineOfSight({
            samples: samples.map((sample, index) => (
                index === 2 ? { ...sample, elevationM: null } : sample
            )),
            observerHeightM: 1,
            targetHeightM: 1,
            curvature: false
        });
        expect(open.visible).toBe(true);
    });

    it('applies earth curvature and refraction only when asked', () => {
        const d = 10_000;
        expect(earthBulgeMeters(d, d)).toBeCloseTo((d * d * (1 - REFRACTION_K)) / (2 * EARTH_RADIUS_M), 6);
        expect(earthBulgeMeters(0, d)).toBe(0);

        const path = densifyCoordinates([[0, 0], [0, 1]], 60_000);
        const samples = path.map((sample) => ({ ...sample, elevationM: 100 }));
        const straight = evaluateLineOfSight({
            samples,
            observerHeightM: 2,
            targetHeightM: 2,
            curvature: false
        });
        const curved = evaluateLineOfSight({
            samples,
            observerHeightM: 2,
            targetHeightM: 2,
            curvature: true
        });
        const cleared = evaluateLineOfSight({
            samples,
            observerHeightM: 500,
            targetHeightM: 500,
            curvature: true
        });
        expect(straight.visible).toBe(true);
        expect(curved.visible).toBe(false);
        expect(curved.obstruction.index).toBe(1);
        expect(curved.obstruction.lng).toBe(path[1].lng);
        expect(curved.obstruction.lat).toBe(path[1].lat);
        expect(curved.obstruction.effectiveM).toBeGreaterThan(curved.obstruction.losM);
        expect(cleared.visible).toBe(true);
    });

    it('samples the sight path and marks the obstruction on the result layer', async () => {
        let received = null;
        const result = await buildLineOfSight({
            observer: [-111.5, 40.5],
            target: [-111.2, 40.55],
            observerHeightM: 2,
            targetHeightM: 2,
            spacingM: 5000,
            curvature: false,
            sampleElevations: async (points) => {
                received = points;
                return points.map((_, index) => (index === 0 || index === points.length - 1 ? 1000 : 1400));
            }
        });
        expect(received[0]).toEqual([-111.5, 40.5]);
        expect(received.at(-1)).toEqual([-111.2, 40.55]);
        expect(received.length).toBeGreaterThan(2);
        expect(result.visible).toBe(false);
        const geojson = buildTerrainFeatureCollection(result);
        const point = geojson.features.find((feature) => feature.geometry.type === 'Point');
        expect(point.properties.kind).toBe('obstruction');
        expect(point.geometry.coordinates).toEqual([result.obstruction.lng, result.obstruction.lat]);
        expect(geojson.features.some((feature) => feature.geometry.type === 'LineString')).toBe(true);
    });

    it('rejects line of sight when an endpoint has no elevation', async () => {
        await expect(buildLineOfSight({
            observer: [0, 0],
            target: [0.001, 0],
            observerHeightM: 1.7,
            targetHeightM: 0,
            spacingM: 1000,
            sampleElevations: async (points) => points.map((_, index) => (index === 0 ? null : 10))
        })).rejects.toThrow(/observer or target/);
    });

    it('splits the beam at the first obstruction and keeps heights above ground', () => {
        const blocked = evaluateLineOfSight({
            samples: hill,
            observerHeightM: 10,
            targetHeightM: 0,
            curvature: false
        });
        const beam = buildSightBeam(blocked);
        expect(beam.visible).toHaveLength(2);
        expect(beam.blocked.length).toBeGreaterThan(1);
        expect(beam.visible[0].altitudeM).toBe(1010);
        expect(beam.visible.at(-1)).toMatchObject({
            lng: hill[1].lng,
            lat: hill[1].lat,
            distanceM: 500
        });
        expect(beam.visible.at(-1).altitudeM).toBeCloseTo(blocked.obstruction.losM, 5);
        expect(beam.blocked[0]).toEqual(beam.visible.at(-1));
        expect(beam.blocked.at(-1).altitudeM).toBe(1000);
        expect(beam.blocked.at(-1).altitudeM).toBe(hill.at(-1).elevationM + 0);

        const clear = evaluateLineOfSight({
            samples: hill,
            observerHeightM: 300,
            targetHeightM: 0,
            curvature: false
        });
        const openBeam = buildSightBeam(clear);
        expect(openBeam.blocked).toEqual([]);
        expect(openBeam.visible[0].altitudeM).toBe(1300);
        expect(openBeam.visible.at(-1).altitudeM).toBe(1000);
        const mid = openBeam.visible[1];
        const t = mid.distanceM / hill.at(-1).distanceM;
        expect(mid.altitudeM).toBeCloseTo(1300 + t * (1000 - 1300), 5);
    });

    it('keeps a straight beam when curvature blocks the path', () => {
        const path = densifyCoordinates([[0, 0], [0, 1]], 60_000);
        const samples = path.map((sample) => ({ ...sample, elevationM: 100 }));
        const curved = evaluateLineOfSight({
            samples,
            observerHeightM: 2,
            targetHeightM: 2,
            curvature: true
        });
        const beam = buildSightBeam(curved);
        expect(curved.visible).toBe(false);
        expect(beam.visible.length).toBeGreaterThan(1);
        expect(beam.blocked.length).toBeGreaterThan(1);
        expect(beam.visible[0].altitudeM).toBe(102);
        expect(beam.blocked.at(-1).altitudeM).toBe(102);
        for (const point of [...beam.visible, ...beam.blocked]) {
            expect(point.altitudeM).toBeCloseTo(102, 5);
        }
        expect(beam.visible.at(-1).distanceM).toBe(curved.obstruction.distanceM);
    });

    it('feeds absolute altitude to the mercator beam ribbon', () => {
        const calls = [];
        const fromLngLat = (lngLat, altitude) => {
            calls.push({ lngLat: [...lngLat], altitude });
            return { x: lngLat[0], y: lngLat[1], z: altitude, meterInMercatorCoordinateUnits: () => 0 };
        };
        const data = beamRibbonPositions([
            { lng: 1, lat: 2, altitudeM: 10 },
            { lng: 3, lat: 4, altitudeM: 30 }
        ], fromLngLat, 4);
        expect(calls).toEqual([
            { lngLat: [1, 2], altitude: 10 },
            { lngLat: [3, 4], altitude: 30 }
        ]);
        expect(data.length).toBe(12);
        expect(data[2]).toBe(10);
        expect(data[8]).toBe(30);
    });

    it('restores a terrain view only when pitch, bearing, and 3D flags still match', () => {
        const owned = { is3d: true, terrain: true, pitch: 30, bearing: 12 };
        expect(terrainViewsMatch(owned, { ...owned, pitch: 30.4 })).toBe(true);
        expect(terrainViewsMatch(owned, { ...owned, pitch: 48 })).toBe(false);
        expect(terrainViewsMatch(owned, { ...owned, bearing: 20 })).toBe(false);
        expect(terrainViewsMatch(owned, { ...owned, is3d: false })).toBe(false);
        expect(terrainViewsMatch(owned, { ...owned, terrain: false })).toBe(false);
        expect(terrainViewsMatch(null, { is3d: false, terrain: false, pitch: 0, bearing: 0 })).toBe(true);
    });

    it('can sample a flat visible path from the injected sampler', async () => {
        const result = await buildLineOfSight({
            observer: [0, 0],
            target: [0.001, 0],
            observerHeightM: 1.7,
            targetHeightM: 1,
            spacingM: 40,
            curvature: false,
            sampleElevations: flatSampler(250)
        });
        expect(result.visible).toBe(true);
        expect(result.beam.blocked).toEqual([]);
        expect(result.beam.visible[0].altitudeM).toBe(251.7);
        expect(result.beam.visible.at(-1).altitudeM).toBe(251);
        expect(result.stats.min).toBe(250);
        expect(result.stats.max).toBe(250);
        expect(result.stats.gain).toBe(0);
        expect(result.stats.loss).toBe(0);
    });
});

describe('terrain profile elevation access', () => {
    it('calls only sampleElevations on the map service', () => {
        const source = [
            'js/widgets/terrain-profile/engine.js',
            'js/widgets/terrain-profile/controller.js',
            'js/widgets/terrain-profile/beam-layer.js',
            'react/widgets/TerrainProfileDialog.jsx',
            'react/widgets/mountTerrainProfileDialog.jsx'
        ].map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
        expect(source).not.toMatch(/queryElevationAt/);
        expect(source).not.toMatch(/queryTerrainElevation/);
        expect(source).not.toMatch(/\.getMap\s*\(/);
        expect(source).toMatch(/sampleElevations/);
    });
});
