import { describe, it, expect } from 'vitest';
import {
    stripKmlPresentationFromGeoJSON,
    stripKmlPresentationFromGeoJSONWithReport,
    isKmlPresentationKey
} from '../js/import/parsers/kml-strip.js';
import {
    csvDynamicTypingForField,
    isCsvCoordinateFieldName
} from '../js/import/csv-typing.js';
import { shapefileCrsFromPrj } from '../js/import/import-crs.js';

describe('kml-strip GIS mode', () => {
    it('removes known presentation keys only', () => {
        expect(isKmlPresentationKey('stroke')).toBe(true);
        expect(isKmlPresentationKey('fill_status')).toBe(false);
        expect(isKmlPresentationKey('stroke_count')).toBe(false);
        expect(isKmlPresentationKey('marker-condition')).toBe(false);

        const fc = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: {
                    name: 'A',
                    stroke: '#ff0000',
                    fill: '#00ff00',
                    'marker-color': '#000',
                    fill_status: 'open',
                    stroke_count: 3,
                    'marker-condition': 'good',
                    notes: 'x'.repeat(2500)
                }
            }]
        };
        const { geojson, removedKeys, longStringFields } = stripKmlPresentationFromGeoJSONWithReport(fc);
        const props = geojson.features[0].properties;
        expect(props.fill_status).toBe('open');
        expect(props.stroke_count).toBe(3);
        expect(props['marker-condition']).toBe('good');
        expect(props.notes.length).toBe(2500);
        expect(props.stroke).toBeUndefined();
        expect(props.fill).toBeUndefined();
        expect(removedKeys).toEqual(expect.arrayContaining(['stroke', 'fill', 'marker-color']));
        expect(longStringFields).toContain('notes');
        expect(stripKmlPresentationFromGeoJSON(fc).features[0].properties.fill_status).toBe('open');
    });
});

describe('csv typing', () => {
    it('types only coordinate-like field names', () => {
        expect(isCsvCoordinateFieldName('latitude')).toBe(true);
        expect(isCsvCoordinateFieldName('ID')).toBe(false);
        expect(csvDynamicTypingForField('lon')).toBe(true);
        expect(csvDynamicTypingForField('asset_id')).toBe(false);
        expect(csvDynamicTypingForField('00123')).toBe(false);
    });
});

describe('shapefileCrsFromPrj', () => {
    it('does not silently claim WGS84 when coords look projected and .prj is missing', () => {
        const geojson = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [420000, 4500000] },
                properties: {}
            }]
        };
        const meta = shapefileCrsFromPrj(null, geojson);
        expect(meta.crs).toBe('UNKNOWN');
        expect(meta.crsDetected).toBe('unknown');
        expect(meta.crsWarning).toBeTruthy();
    });

    it('assumes WGS84 from extent when coords look geographic and .prj is missing', () => {
        const geojson = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-111.5, 40.2] },
                properties: {}
            }]
        };
        const meta = shapefileCrsFromPrj(null, geojson);
        expect(meta.crs).toBe('EPSG:4326');
        expect(meta.crsDetected).toBe('extent');
        expect(meta.crsWarning).toBeUndefined();
    });
});
