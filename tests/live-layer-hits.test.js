import { describe, expect, it } from 'vitest';
import {
    featurePixelDistance,
    mergeLiveLayerHitsNearClick,
    pixelDistanceToSegment
} from '../js/live-layers/live-layer-hits.js';

describe('live-layer identify hits', () => {
    it('measures pixel distance to a segment', () => {
        expect(pixelDistanceToSegment({ x: 5, y: 2 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(2);
        expect(pixelDistanceToSegment({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(4);
    });

    it('measures point and line feature distance', () => {
        const project = ([lng, lat]) => ({ x: lng, y: lat });
        expect(featurePixelDistance(project, {
            geometry: { type: 'Point', coordinates: [10, 8] }
        }, { x: 10, y: 10 })).toBeCloseTo(2);

        expect(featurePixelDistance(project, {
            geometry: { type: 'LineString', coordinates: [[0, 0], [20, 0]] }
        }, { x: 8, y: 3 })).toBeCloseTo(3);
    });

    it('merges stacked live-layer features missed by the rendered query', () => {
        const project = ([lng, lat]) => ({ x: lng * 10, y: lat * 10 });
        const dataLayers = new Map([
            ['cab', {
                liveService: true,
                geojson: {
                    features: [{
                        type: 'Feature',
                        properties: { _featureIndex: 1, MODEL: 'Cabinet' },
                        geometry: { type: 'Point', coordinates: [1, 2] }
                    }]
                }
            }],
            ['box', {
                liveService: true,
                geojson: {
                    features: [{
                        type: 'Feature',
                        properties: { _featureIndex: 9, NAME: 'Vault' },
                        geometry: { type: 'Point', coordinates: [1.05, 2] }
                    }]
                }
            }],
            ['workspace', {
                liveService: false,
                geojson: {
                    features: [{
                        type: 'Feature',
                        properties: { _featureIndex: 3 },
                        geometry: { type: 'Point', coordinates: [1, 2] }
                    }]
                }
            }]
        ]);

        const results = [];
        const seen = new Set();
        mergeLiveLayerHitsNearClick({
            map: { project },
            dataLayers,
            pixel: { x: 10, y: 20 },
            results,
            seen,
            bufferPx: 8,
            layerName: (id) => id,
            layerColor: () => '#111'
        });

        expect(results.map((hit) => hit.layerId).sort()).toEqual(['box', 'cab']);
        expect(seen.has('cab-1')).toBe(true);
        expect(seen.has('workspace-3')).toBe(false);
    });

    it('can skip a live layer from identify merge', () => {
        const project = ([lng, lat]) => ({ x: lng * 10, y: lat * 10 });
        const dataLayers = new Map([
            ['cab', {
                liveService: true,
                geojson: {
                    features: [{
                        type: 'Feature',
                        properties: { _featureIndex: 1 },
                        geometry: { type: 'Point', coordinates: [1, 2] }
                    }]
                }
            }]
        ]);
        const results = [];
        mergeLiveLayerHitsNearClick({
            map: { project },
            dataLayers,
            pixel: { x: 10, y: 20 },
            results,
            seen: new Set(),
            skipLayer: (id) => id === 'cab'
        });
        expect(results).toEqual([]);
    });
});
