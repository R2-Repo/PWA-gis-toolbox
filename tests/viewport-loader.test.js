import { describe, expect, it } from 'vitest';
import {
    countGeometryVertices,
    featureIntersectsViewport
} from '../js/workspace/viewport-loader.js';

describe('viewport-loader feature selection', () => {
    const view = [-111.95, 40.55, -111.85, 40.65];

    it('keeps lines that cross the viewport even when endpoints are outside', () => {
        const line = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [
                    [-112.5, 40.6],
                    [-111.0, 40.6]
                ]
            },
            properties: { _featureIndex: 1 }
        };
        expect(featureIntersectsViewport(line, view)).toBe(true);
    });

    it('rejects features fully outside the viewport', () => {
        const elsewhere = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [
                    [-110.2, 41.2],
                    [-110.1, 41.3]
                ]
            },
            properties: { _featureIndex: 2 }
        };
        expect(featureIntersectsViewport(elsewhere, view)).toBe(false);
    });

    it('keeps points inside the viewport', () => {
        const pt = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-111.9, 40.6] },
            properties: {}
        };
        expect(featureIntersectsViewport(pt, view)).toBe(true);
    });

    it('rejects envelope-only lines that miss the viewport geometrically', () => {
        const view = [-111.1, 40.0, -111.0, 40.1];
        const miss = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[-112, 40.05], [-110, 39.5]]
            },
            properties: { id: 'miss' }
        };
        expect(featureIntersectsViewport(miss, view)).toBe(false);
    });

    it('counts line vertices', () => {
        expect(countGeometryVertices({
            type: 'LineString',
            coordinates: [[0, 0], [1, 1], [2, 2]]
        })).toBe(3);
        expect(countGeometryVertices(null)).toBe(0);
    });
});

/**
 * Behavioral contract for the bug: when a chunk bbox intersects the view but
 * most features lie outside, only in-view features should be selected.
 * Implemented as a pure simulation of the fixed selection loop.
 */
describe('viewport fill prefers in-view features', () => {
    it('does not fill the cap with out-of-view geometry from a large chunk', () => {
        const view = [-111.1, 40.0, -111.0, 40.1];
        const features = [];
        // 50 long lines far away (would previously consume the budget first)
        for (let i = 0; i < 50; i++) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [[-120, 45 + i * 0.01], [-119, 45 + i * 0.01]]
                },
                properties: { _featureIndex: i }
            });
        }
        // One local line in the zoomed view
        features.push({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[-111.08, 40.05], [-111.02, 40.05]]
            },
            properties: { _featureIndex: 99 }
        });

        const maxFeatures = 10;
        const selected = [];
        for (const f of features) {
            if (!featureIntersectsViewport(f, view)) continue;
            if (selected.length >= maxFeatures) break;
            selected.push(f);
        }

        expect(selected).toHaveLength(1);
        expect(selected[0].properties._featureIndex).toBe(99);
    });
});
