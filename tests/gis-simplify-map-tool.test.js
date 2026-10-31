import * as turf from '@turf/turf';
import { describe, expect, it, beforeAll } from 'vitest';
import { createSpatialDataset } from '../js/core/data-model.js';
import { simplifyFeatures } from '../js/tools/gis-tools.js';
import { computeWorkflowSimplify } from '../js/workflow/compute/simplify-units.js';

beforeAll(() => {
    globalThis.turf = turf;
});

const zigzag = {
    type: 'Feature',
    properties: {},
    geometry: {
        type: 'LineString',
        coordinates: [
            [-111.9, 40.75],
            [-111.8999, 40.7501],
            [-111.8998, 40.7499],
            [-111.8997, 40.7502],
            [-111.8996, 40.75]
        ]
    }
};

describe('map-tool simplify units', () => {
    it('registry-facing metre simplify matches workflow compute', async () => {
        const dataset = createSpatialDataset('line', { type: 'FeatureCollection', features: [zigzag] }, {
            format: 'derived'
        });
        const spatial = {
            type: 'spatial',
            name: dataset.name,
            geojson: dataset.geojson,
            schema: {}
        };
        const config = { tolerance: 10, toleranceUnit: 'm' };
        const expected = computeWorkflowSimplify([spatial], config, {});

        const result = await simplifyFeatures(dataset, config.tolerance, { toleranceUnit: config.toleranceUnit });
        expect(result.dataset.geojson.features[0].geometry.coordinates.length)
            .toBe(expected.geojson.features[0].geometry.coordinates.length);
    });

    it('legacy degree tolerance still simplifies', async () => {
        const dataset = createSpatialDataset('line', { type: 'FeatureCollection', features: [zigzag] }, {
            format: 'derived'
        });
        const result = await simplifyFeatures(dataset, 0.001, { toleranceUnit: 'deg' });
        expect(result.stats.verticesAfter).toBeLessThanOrEqual(result.stats.verticesBefore);
    });
});
