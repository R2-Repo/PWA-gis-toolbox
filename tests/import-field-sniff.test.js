import { describe, it, expect } from 'vitest';
import {
    sniffPropertyKeysFromGeoJsonText,
    propertyKeysFromObjectText,
    sniffGeoJsonFieldsStreaming,
    GEOJSON_FIELD_SNIFF_MAX_FEATURES
} from '../js/import/import-field-sniff.js';

describe('import-field-sniff geojson', () => {
    it('extracts nested property object keys with brace matching', () => {
        const keys = propertyKeysFromObjectText(
            '"id": 1, "meta": {"a": 1, "b": 2}, "name": "x"'
        );
        expect(keys).toEqual(expect.arrayContaining(['id', 'meta', 'name']));
    });

    it('finds properties after large geometry blocks in head text', () => {
        const coords = Array.from({ length: 2000 }, (_, i) => `[${i},0]`).join(',');
        const text = `{"type":"FeatureCollection","features":[{`
            + `"type":"Feature",`
            + `"geometry":{"type":"LineString","coordinates":[${coords}]},`
            + `"properties":{"ROUTE":"I-15","OWNER":"UDOT"}`
            + '}]}';
        const keys = sniffPropertyKeysFromGeoJsonText(text);
        expect(keys).toEqual(['OWNER', 'ROUTE']);
    });

    it('streams field names past multi-MB geometries', async () => {
        // ~1.5MB of coordinates before properties — old 384KB head sniff missed these.
        const coords = Array.from({ length: 80_000 }, (_, i) => `[${(i * 0.00001).toFixed(5)},40]`).join(',');
        const body = `{"type":"FeatureCollection","features":[`
            + `{"type":"Feature","geometry":{"type":"LineString","coordinates":[${coords}]},"properties":{"ROUTE":"A","SEG":"1"}},`
            + `{"type":"Feature","geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]},"properties":{"ROUTE":"B","COUNTY":"Utah"}}`
            + `]}`;
        const file = new File([body], 'long-lines.geojson', { type: 'application/geo+json' });
        const keys = await sniffGeoJsonFieldsStreaming(file, {
            maxFeatures: GEOJSON_FIELD_SNIFF_MAX_FEATURES,
            maxBytes: 8 * 1024 * 1024
        });
        expect(keys).toEqual(expect.arrayContaining(['COUNTY', 'ROUTE', 'SEG']));
    });
});
