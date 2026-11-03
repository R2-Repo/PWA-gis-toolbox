import { describe, expect, it } from 'vitest';
import {
    lookupRenderedFeature,
    renderFeatureIndex
} from '../js/workspace/feature-identity.js';
import { tagFeatureBatch, tagFeaturesForMap } from '../js/map/feature-tag.js';

function point(coords, properties) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties
    };
}

describe('workspace feature identity on the map', () => {
    it('keeps a stored _featureIndex instead of the viewport batch position', () => {
        const dataset = {
            id: 'mileposts',
            geojson: {
                type: 'FeatureCollection',
                features: [
                    point([-111.9, 40.6], { _featureIndex: 40, name: 'mp40' }),
                    point([-111.8, 40.6], { _featureIndex: 2, name: 'mp2' })
                ]
            }
        };

        const tagged = tagFeaturesForMap(dataset);

        expect(tagged.map((f) => f.properties._featureIndex)).toEqual([40, 2]);
        expect(renderFeatureIndex(tagged[0], 0)).toBe(40);
        expect(lookupRenderedFeature(tagged, 2, { allowPositionalFallback: false })?.properties.name).toBe('mp2');
        // Batch position 0 is a different feature. Workspace identify must not use it.
        expect(lookupRenderedFeature(tagged, 0, { allowPositionalFallback: false })).toBeNull();
        expect(lookupRenderedFeature(tagged, 0, { allowPositionalFallback: true })).toBeNull();
    });

    it('still assigns array position when a feature has no stored index', () => {
        const dataset = {
            id: 'mem',
            geojson: {
                type: 'FeatureCollection',
                features: [
                    point([0, 0], { name: 'a' }),
                    point([1, 1], { name: 'b' })
                ]
            }
        };
        const tagged = tagFeaturesForMap(dataset);
        expect(tagged.map((f) => f.properties._featureIndex)).toEqual([0, 1]);
        expect(lookupRenderedFeature(tagged, 1)?.properties.name).toBe('b');
    });

    it('does not rewrite a stored index when appending a later batch', () => {
        const dataset = { id: 'mileposts' };
        const tagged = tagFeatureBatch(dataset, [
            point([0, 0], { _featureIndex: 500, route: '0015P' }),
            point([1, 1], { name: 'new' })
        ], 100);
        expect(tagged.map((f) => f.properties._featureIndex)).toEqual([500, 101]);
    });

    it('shares one stored index across geometry-collection parts', () => {
        const dataset = {
            id: 'mileposts',
            geojson: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: { _featureIndex: 7, name: 'split' },
                    geometry: {
                        type: 'GeometryCollection',
                        geometries: [
                            { type: 'Point', coordinates: [0, 0] },
                            { type: 'Point', coordinates: [1, 1] }
                        ]
                    }
                }]
            }
        };
        const tagged = tagFeaturesForMap(dataset);
        expect(tagged).toHaveLength(2);
        expect(tagged.every((f) => f.properties._featureIndex === 7)).toBe(true);
    });
});
