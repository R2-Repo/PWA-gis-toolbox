import { describe, expect, it } from 'vitest';
import { exportGeoJSON } from '../js/export/geojson-exporter.js';

function pointFeature(i, extraProps = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i, 0] },
        properties: { id: i, ...extraProps }
    };
}

describe('exportGeoJSON (in-memory)', () => {
    it('exports a small FeatureCollection and strips internal props', async () => {
        const result = await exportGeoJSON({
            type: 'spatial',
            name: 'demo',
            geojson: {
                type: 'FeatureCollection',
                features: [
                    pointFeature(1, { name: 'A', _internal: 1, __lgid: 'lg-1' })
                ]
            }
        });

        expect(result.mimeType).toBe('application/geo+json');
        const parsed = JSON.parse(result.text);
        expect(parsed.type).toBe('FeatureCollection');
        expect(parsed.features).toHaveLength(1);
        expect(parsed.features[0].properties).toEqual({ id: 1, name: 'A', __lgid: 'lg-1' });
    });

    it('exports more than 500 features without throwing', async () => {
        const features = Array.from({ length: 501 }, (_, i) => pointFeature(i));
        const result = await exportGeoJSON({
            type: 'spatial',
            geojson: { type: 'FeatureCollection', features }
        });
        const parsed = JSON.parse(result.text);
        expect(parsed.features).toHaveLength(501);
        expect(parsed.features[500].properties.id).toBe(500);
    });
});
