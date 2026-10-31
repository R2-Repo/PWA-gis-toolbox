import { describe, expect, it, beforeAll } from 'vitest';
import * as turf from '@turf/turf';
import { createSpatialDataset } from '../js/core/data-model.js';
import { unionFeatures } from '../js/tools/gis-tools.js';
import { unionFeatureCollection } from '../js/tools/compute/spatial-operations.js';

beforeAll(() => {
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
    return createSpatialDataset('union-test', { type: 'FeatureCollection', features }, { format: 'derived' });
}

describe('unionFeatures attributes', () => {
    it('keeps the first polygon properties on the merged result', async () => {
        const p1 = turf.polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], { name: 'first', id: 1 });
        const p2 = turf.polygon([[[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]], { name: 'second', id: 2 });
        const ds = datasetFrom([p1, p2]);
        const result = await unionFeatures(ds);
        expect(result.geojson.features).toHaveLength(1);
        expect(result.geojson.features[0].properties).toEqual({ name: 'first', id: 1 });
    });

    it('handles null and mixed properties', async () => {
        const withNull = turf.polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], null);
        const withProps = turf.polygon([[[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]], { z: 9 });
        const ds = datasetFrom([withNull, withProps]);
        const result = await unionFeatures(ds);
        expect(result.geojson.features[0].properties).toEqual({});

        const ds2 = datasetFrom([withProps, withNull]);
        const result2 = await unionFeatures(ds2);
        expect(result2.geojson.features[0].properties).toEqual({ z: 9 });
    });

    it('does not mutate deep-frozen inputs (compute path)', () => {
        const fc = deepFreeze({
            type: 'FeatureCollection',
            features: [
                turf.polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], { a: 1 }),
                turf.polygon([[[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]], { b: 2 })
            ]
        });
        const before = structuredClone(fc);
        const { stats } = unionFeatureCollection(fc);
        expect(fc).toEqual(before);
        expect(stats.unionInputCount).toBe(2);
        expect(stats.failed).toBe(0);
    });
});
