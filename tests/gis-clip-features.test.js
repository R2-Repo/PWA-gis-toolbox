import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import * as turf from '@turf/turf';
import { createSpatialDataset } from '../js/core/data-model.js';
import { clipFeatures } from '../js/tools/gis-tools.js';

beforeAll(() => {
    globalThis.turf = turf;
});

afterEach(() => {
    globalThis.turf = turf;
});

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
});
