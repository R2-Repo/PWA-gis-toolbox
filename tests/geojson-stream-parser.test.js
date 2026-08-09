import { describe, expect, it } from 'vitest';
import { GeoJSONFeatureStreamParser } from '../js/import/stream/geojson-stream-parser.js';

function parseAll(text, chunkSize) {
    const features = [];
    const parser = new GeoJSONFeatureStreamParser({
        onFeature: (f) => features.push(f)
    });
    if (chunkSize == null) {
        parser.push(text);
    } else {
        for (let i = 0; i < text.length; i += chunkSize) {
            parser.push(text.slice(i, i + chunkSize));
        }
    }
    const result = parser.finish();
    return { features, result, parser };
}

const SIMPLE_FC = {
    type: 'FeatureCollection',
    name: 'test layer',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-111.9, 40.7] }, properties: { id: 1, name: 'A' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-111.9, 40.7], [-111.8, 40.8]] }, properties: { id: 2, name: 'B "quoted"' } },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, -1]]] }, properties: { id: 3, note: 'braces } inside { strings', nested: { a: [1, 2, { b: 'c' }] } } }
    ]
};

describe('GeoJSONFeatureStreamParser', () => {
    it('parses all features from a single chunk', () => {
        const { features } = parseAll(JSON.stringify(SIMPLE_FC));
        expect(features).toEqual(SIMPLE_FC.features);
    });

    it.each([1, 2, 3, 7, 16, 64, 1024])('parses identically with chunk size %d', (chunkSize) => {
        const { features, result } = parseAll(JSON.stringify(SIMPLE_FC), chunkSize);
        expect(features).toEqual(SIMPLE_FC.features);
        expect(result.featureCount).toBe(3);
    });

    it('parses pretty-printed GeoJSON', () => {
        const { features } = parseAll(JSON.stringify(SIMPLE_FC, null, 2), 13);
        expect(features).toEqual(SIMPLE_FC.features);
    });

    it('handles root keys after the features array', () => {
        const fc = { features: SIMPLE_FC.features, type: 'FeatureCollection', bbox: [-180, -90, 180, 90] };
        const { features, parser } = parseAll(JSON.stringify(fc), 5);
        expect(features).toEqual(SIMPLE_FC.features);
        expect(parser.rootType).toBe('FeatureCollection');
    });

    it('handles escaped quotes and backslashes in strings', () => {
        const fc = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [0, 0] },
                    properties: { desc: 'He said \\"features\\": [ ... ] \\\\ done', path: 'C:\\\\temp\\\\file' }
                }
            ]
        };
        const text = JSON.stringify(fc);
        for (const size of [1, 4, 11, null]) {
            const { features } = parseAll(text, size);
            expect(features).toEqual(fc.features);
        }
    });

    it('handles a "features" string appearing in property values before the real array', () => {
        const fc = {
            type: 'FeatureCollection',
            name: 'contains "features" in name',
            features: [
                { type: 'Feature', geometry: null, properties: { note: '"features": [fake]' } }
            ]
        };
        const { features } = parseAll(JSON.stringify(fc), 3);
        expect(features).toEqual(fc.features);
    });

    it('handles unicode content', () => {
        const fc = {
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', geometry: { type: 'Point', coordinates: [12.5, 41.9] }, properties: { name: 'Città 東京 → ✓' } }
            ]
        };
        const { features } = parseAll(JSON.stringify(fc), 2);
        expect(features).toEqual(fc.features);
    });

    it('tolerates null entries inside the features array', () => {
        const text = '{"type":"FeatureCollection","features":[null,{"type":"Feature","geometry":null,"properties":{}},null]}';
        const { features, result } = parseAll(text, 4);
        expect(features).toHaveLength(1);
        expect(result.featureCount).toBe(1);
    });

    it('handles an empty features array', () => {
        const { features, result } = parseAll('{"type":"FeatureCollection","features":[]}');
        expect(features).toHaveLength(0);
        expect(result.featureCount).toBe(0);
    });

    it('throws when there is no features array', () => {
        const parser = new GeoJSONFeatureStreamParser({ onFeature: () => {} });
        parser.push('{"type":"Feature","geometry":null,"properties":{}}');
        expect(() => parser.finish()).toThrow(/not a GeoJSON FeatureCollection/);
    });

    it('throws when root type is not FeatureCollection', () => {
        const parser = new GeoJSONFeatureStreamParser({ onFeature: () => {} });
        parser.push('{"type":"Wrong","features":[]}');
        expect(() => parser.finish()).toThrow(/expected "FeatureCollection"/);
    });

    it('throws for non-object input', () => {
        const parser = new GeoJSONFeatureStreamParser({ onFeature: () => {} });
        expect(() => parser.push('[1,2,3]')).toThrow(/JSON object/);
    });

    it('enforces the single-feature size guard', () => {
        const parser = new GeoJSONFeatureStreamParser({ onFeature: () => {}, maxFeatureChars: 50 });
        const big = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"x":"' + 'a'.repeat(100) + '"}}]}';
        expect(() => {
            for (let i = 0; i < big.length; i += 8) parser.push(big.slice(i, i + 8));
        }).toThrow(/exceeds the maximum/);
    });

    it('parses a large generated collection without holding the whole text', () => {
        const features = [];
        for (let i = 0; i < 5000; i++) {
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-120 + (i % 100) / 100, 35 + Math.floor(i / 100) / 100] },
                properties: { id: i, name: `pt-${i}`, even: i % 2 === 0 }
            });
        }
        const text = JSON.stringify({ type: 'FeatureCollection', features });
        const { features: parsed, result } = parseAll(text, 4096);
        expect(result.featureCount).toBe(5000);
        expect(parsed[0]).toEqual(features[0]);
        expect(parsed[4999]).toEqual(features[4999]);
    });
});
