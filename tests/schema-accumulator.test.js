import { describe, expect, it } from 'vitest';
import { analyzeSchema, createSchemaAccumulator } from '../js/core/data-model.js';

const FEATURES = [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 1, name: 'A', height: 10.5, active: true } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { id: 2, name: 'B', height: 20, active: false } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { id: 3, name: null, height: 5, extra: 'only here' } }
];

describe('createSchemaAccumulator', () => {
    it('matches analyzeSchema output for the same features', () => {
        const geojson = { type: 'FeatureCollection', features: FEATURES };
        const expected = analyzeSchema(geojson);

        const acc = createSchemaAccumulator();
        for (const f of FEATURES) acc.addFeature(f);
        const actual = acc.build();

        expect(actual).toEqual(expected);
    });

    it('accumulates across batches identically to one pass', () => {
        const acc = createSchemaAccumulator();
        for (const f of FEATURES.slice(0, 1)) acc.addFeature(f);
        for (const f of FEATURES.slice(1)) acc.addFeature(f);
        const schema = acc.build();

        expect(schema.featureCount).toBe(3);
        expect(schema.geometryType).toBe('Mixed');
        expect(schema.fields.map((f) => f.name).sort()).toEqual(['active', 'extra', 'height', 'id', 'name']);
        const height = schema.fields.find((f) => f.name === 'height');
        expect(height.min).toBe(5);
        expect(height.max).toBe(20);
    });

    it('exposes a running feature count', () => {
        const acc = createSchemaAccumulator();
        expect(acc.featureCount).toBe(0);
        acc.addFeature(FEATURES[0]);
        expect(acc.featureCount).toBe(1);
    });

    it('respects crs options like analyzeSchema', () => {
        const acc = createSchemaAccumulator({ crs: 'EPSG:26912' });
        acc.addFeature(FEATURES[0]);
        expect(acc.build().crs).toBe('EPSG:26912');
    });
});
