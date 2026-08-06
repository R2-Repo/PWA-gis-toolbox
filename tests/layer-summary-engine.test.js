import { describe, expect, it } from 'vitest';
import {
    formatByteSize,
    summarizeFeatureCollection,
    validateLayerGeoJson
} from '../js/widgets/layer-summary/engine.js';

describe('layer-summary engine', () => {
    const sample = {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                properties: { name: 'A' },
                geometry: { type: 'Point', coordinates: [0, 0] }
            },
            {
                type: 'Feature',
                properties: { name: 'B', kind: 'road' },
                geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
            }
        ]
    };

    it('validates layers and summarizes in the browser', () => {
        expect(validateLayerGeoJson(null).ok).toBe(false);
        expect(validateLayerGeoJson(sample).ok).toBe(true);

        const summary = summarizeFeatureCollection(sample, { layerName: 'Demo' });
        expect(summary.featureCount).toBe(2);
        expect(summary.geometryTypes.Point).toBe(1);
        expect(summary.geometryTypes.LineString).toBe(1);
        expect(summary.propertyKeys).toEqual(['kind', 'name']);
        expect(summary.path).toBe('layer:Demo');
    });

    it('formats byte sizes for summary display', () => {
        expect(formatByteSize(2048)).toBe('2.0 KB');
    });
});
