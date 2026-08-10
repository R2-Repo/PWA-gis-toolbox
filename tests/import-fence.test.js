import { describe, it, expect } from 'vitest';
import {
    featureIntersectsImportFence,
    geometryIntersectsImportFence,
    isImportFenceBbox
} from '../js/import/import-fence.js';
import { filterDatasetByFence } from '../js/import/post-import.js';

const FENCE = [-111.2, 40.4, -111.0, 40.6]; // Salt Lake area-ish

describe('import-fence', () => {
    it('validates fence bbox shape', () => {
        expect(isImportFenceBbox(FENCE)).toBe(true);
        expect(isImportFenceBbox([-111, 40, -110])).toBe(false);
    });

    it('excludes null geometry from a fence', () => {
        expect(featureIntersectsImportFence({ geometry: null }, FENCE)).toBe(false);
        expect(geometryIntersectsImportFence(null, FENCE)).toBe(false);
    });

    it('keeps points inside the fence', () => {
        const f = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-111.1, 40.5] },
            properties: {}
        };
        expect(featureIntersectsImportFence(f, FENCE)).toBe(true);
    });

    it('rejects points outside the fence', () => {
        const f = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-112, 41] },
            properties: {}
        };
        expect(featureIntersectsImportFence(f, FENCE)).toBe(false);
    });

    it('rejects long lines whose bbox overlaps but geometry misses the fence', () => {
        // Horizontal line north of the fence — envelope spans lon of fence but lat misses.
        const f = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[-111.15, 41.0], [-111.05, 41.0]]
            },
            properties: {}
        };
        expect(featureIntersectsImportFence(f, FENCE)).toBe(false);
    });

    it('keeps long lines that cross the fence even when endpoints are outside', () => {
        const f = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[-111.3, 40.5], [-110.9, 40.5]]
            },
            properties: {}
        };
        expect(featureIntersectsImportFence(f, FENCE)).toBe(true);
    });

    it('matches standard filterDatasetByFence results for the same fixtures', () => {
        const features = [
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-111.1, 40.5] }, properties: { id: 'in' } },
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-112, 41] }, properties: { id: 'out' } },
            { type: 'Feature', geometry: null, properties: { id: 'null' } },
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[-111.3, 40.5], [-110.9, 40.5]] },
                properties: { id: 'cross' }
            },
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[-111.15, 41.0], [-111.05, 41.0]] },
                properties: { id: 'miss' }
            }
        ];
        const sharedKept = features
            .filter((f) => featureIntersectsImportFence(f, FENCE))
            .map((f) => f.properties.id);
        const ds = {
            type: 'spatial',
            geojson: { type: 'FeatureCollection', features: features.map((f) => ({ ...f })) },
            schema: {}
        };
        filterDatasetByFence(ds, FENCE);
        const standardKept = ds.geojson.features.map((f) => f.properties.id);
        expect(standardKept).toEqual(sharedKept);
        expect(sharedKept).toEqual(['in', 'cross']);
    });
});
