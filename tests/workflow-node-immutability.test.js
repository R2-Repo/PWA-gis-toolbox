import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FilterRowsNode } from '../js/workflow/nodes/transform-nodes.js';
import { SplitByGeometryNode } from '../js/workflow/nodes/spatial-nodes.js';
import { AddElevationNode } from '../js/workflow/nodes/enrichment-nodes.js';

const sampleGeojson = JSON.parse(
    readFileSync(new URL('./fixtures/sample-point.geojson', import.meta.url), 'utf8')
);

function deepFreeze(value) {
    if (value == null || typeof value !== 'object') return value;
    Object.freeze(value);
    for (const key of Object.values(value)) {
        deepFreeze(key);
    }
    return value;
}

function makeSpatialDataset() {
    return deepFreeze({
        type: 'spatial',
        name: 'frozen',
        geojson: {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { id: 1, group: 'a', val: 10 },
                    geometry: sampleGeojson.features[0].geometry
                },
                {
                    type: 'Feature',
                    properties: { id: 2, group: 'b', val: 20 },
                    geometry: sampleGeojson.features[0].geometry
                }
            ]
        },
        schema: {
            featureCount: 2,
            fields: [{ name: 'id', type: 'integer' }, { name: 'group', type: 'string' }]
        }
    });
}

function snapshotDataset(dataset) {
    return JSON.stringify(dataset);
}

describe('workflow node input immutability', () => {
    it('transform, spatial, and enrichment nodes leave a deep-frozen input unchanged', async () => {
        const input = makeSpatialDataset();
        const before = snapshotDataset(input);

        const filter = new FilterRowsNode();
        filter.config.rules = [{ field: 'group', operator: 'equals', value: 'a' }];
        await filter.execute([input], {});

        const split = new SplitByGeometryNode();
        await split.execute([input], {});

        const elev = new AddElevationNode();
        elev.config.fieldName = 'elevation_m';
        await elev.execute([input], {
            queryElevations: async () => [100, 200]
        });

        expect(snapshotDataset(input)).toBe(before);
    });
});
