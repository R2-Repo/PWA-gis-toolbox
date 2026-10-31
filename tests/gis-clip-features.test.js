import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import * as turf from '@turf/turf';
import { createSpatialDataset } from '../js/core/data-model.js';
import { clipFeatures } from '../js/tools/gis-tools.js';
import { bboxToClipGeometry } from '../js/tools/spatial-bbox.js';
import { clipFeatureCollection } from '../js/tools/compute/spatial-operations.js';

beforeAll(() => {
    globalThis.turf = turf;
});

afterEach(() => {
    globalThis.turf = turf;
});

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const key of Object.keys(value)) {
            deepFreeze(value[key]);
        }
    }
    return value;
}

function datasetFrom(features) {
    return createSpatialDataset('clip-test', { type: 'FeatureCollection', features }, { format: 'derived' });
}

describe('clipFeatures', () => {
    it('clips MultiPoint to members inside the clip polygon', async () => {
        const clip = turf.bboxPolygon([-111.5, 40.5, -111.4, 40.6]);
        const mp = turf.multiPoint([
            [-111.55, 40.55],
            [-111.45, 40.55],
            [-111.35, 40.55]
        ], { id: 'mp' });
        const ds = datasetFrom([mp]);
        const result = await clipFeatures(ds, clip.geometry);
        expect(result.geojson.features).toHaveLength(1);
        expect(result.geojson.features[0].geometry.type).toBe('MultiPoint');
        expect(result.geojson.features[0].geometry.coordinates).toHaveLength(1);
        expect(result.geojson.features[0].geometry.coordinates[0][0]).toBeCloseTo(-111.45, 5);
    });

    it('does not pass through whole features when intersect throws', async () => {
        const clip = turf.bboxPolygon([-111.5, 40.5, -111.4, 40.6]);
        const line = turf.lineString([[-111.55, 40.55], [-111.35, 40.55]], { id: 'line' });
        const ds = datasetFrom([line]);
        const base = globalThis.turf;
        globalThis.turf = new Proxy(base, {
            get(target, prop) {
                if (prop === 'intersect') {
                    return () => {
                        throw new Error('intersect failed');
                    };
                }
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            }
        });
        const result = await clipFeatures(ds, clip.geometry);
        expect(result.geojson.features).toHaveLength(0);
    });

    it('skips empty MultiPoint geometry', async () => {
        const clip = turf.bboxPolygon([-111.5, 40.5, -111.4, 40.6]);
        const mp = { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [] } };
        const ds = datasetFrom([mp]);
        const result = await clipFeatures(ds, clip.geometry);
        expect(result.geojson.features).toHaveLength(0);
    });

    it('clips to a dateline-crossing extent on both sides of ±180°', async () => {
        const clipGeom = bboxToClipGeometry(170, -5, -170, 5);
        const east = turf.point([175, 0], { side: 'east' });
        const west = turf.point([-175, 0], { side: 'west' });
        const mid = turf.point([0, 0], { side: 'mid' });
        const ds = datasetFrom([east, west, mid]);
        const result = await clipFeatures(ds, clipGeom);
        const sides = result.geojson.features.map((f) => f.properties.side).sort();
        expect(sides).toEqual(['east', 'west']);
    });

    it('normal Utah extent clipping is unchanged', async () => {
        const clip = turf.bboxPolygon([-111.5, 40.5, -111.4, 40.6]).geometry;
        const inside = turf.point([-111.45, 40.55], { keep: true });
        const outside = turf.point([-111.35, 40.55], { keep: false });
        const ds = datasetFrom([inside, outside]);
        const result = await clipFeatures(ds, clip);
        expect(result.geojson.features).toHaveLength(1);
        expect(result.geojson.features[0].properties.keep).toBe(true);
    });

    it('does not mutate deep-frozen inputs (compute path)', () => {
        const clip = turf.bboxPolygon([170, -5, -170, 5]).geometry;
        const fc = deepFreeze({
            type: 'FeatureCollection',
            features: [turf.point([175, 0], { id: 1 })]
        });
        const before = structuredClone(fc);
        clipFeatureCollection(fc, clip);
        expect(fc).toEqual(before);
    });
});
