import { describe, expect, it } from 'vitest';
import { detectGeometryKinds } from '../js/map/style-engine.js';
import { geometryPresence, layerGeometryKinds } from '../js/map/geometry-kind.js';
import { labelGeometryPresence } from '../js/map/map-labels.js';

describe('shared geometry kinds', () => {
    it('caches a features array for style and label lookups', () => {
        const features = [
            { geometry: { type: 'Polygon' } },
            { geometry: { type: 'LineString' } }
        ];
        const layer = {
            geojson: { features },
            schema: { geometryType: 'Polygon' }
        };
        const first = geometryPresence(features);
        const second = geometryPresence(features);
        expect(second).toBe(first);
        expect(labelGeometryPresence(features)).toBe(first);
        expect(detectGeometryKinds(layer)).toEqual(new Set(['polygon', 'line']));
        expect(layerGeometryKinds({ geojson: { features: [] }, schema: { geometryType: 'Point' } }).has('point')).toBe(true);

        const replaced = [{ geometry: { type: 'Point' } }];
        expect(geometryPresence(replaced)).not.toBe(first);
        expect(geometryPresence(replaced).hasPoints).toBe(true);
    });
});
