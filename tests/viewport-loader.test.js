import { describe, expect, it } from 'vitest';
import {
    countGeometryVertices,
    featureIntersectsViewport,
    centerFocusBounds,
    selectViewportFeaturesCenterFirst,
    spreadFeaturesSpatially,
    VIEWPORT_CENTER_FOCUS_FRACTION
} from '../js/workspace/viewport-loader.js';
import { tileFocusScore, setGisTileFocus, getGisTileFocus } from '../js/map/tiles/tile-protocol.js';

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

describe('viewport center focus', () => {
    it('shrinks bounds toward the center', () => {
        const focus = centerFocusBounds([0, 0, 10, 10], 0.5);
        expect(focus[0]).toBeCloseTo(2.5);
        expect(focus[1]).toBeCloseTo(2.5);
        expect(focus[2]).toBeCloseTo(7.5);
        expect(focus[3]).toBeCloseTo(7.5);
        expect(VIEWPORT_CENTER_FOCUS_FRACTION).toBe(0.5);
    });

    it('keeps center features when the render cap is tight', () => {
        const view = [0, 0, 10, 10];
        const focus = centerFocusBounds(view, 0.5);
        const edge = [];
        const center = [];
        for (let i = 0; i < 20; i++) {
            edge.push({
                type: 'Feature',
                properties: { id: `edge-${i}` },
                geometry: {
                    type: 'LineString',
                    coordinates: [[0.1, 0.1 + i * 0.01], [0.2, 0.1 + i * 0.01]]
                }
            });
        }
        center.push({
            type: 'Feature',
            properties: { id: 'center-main' },
            geometry: {
                type: 'LineString',
                coordinates: [[4.5, 5], [5.5, 5]]
            }
        });
        expect(featureIntersectsViewport(center[0], focus)).toBe(true);
        expect(featureIntersectsViewport(edge[0], focus)).toBe(false);

        const { features, truncated } = selectViewportFeaturesCenterFirst(center, edge, {
            maxFeatures: 5,
            maxVertices: 250_000
        });
        expect(truncated).toBe(true);
        expect(features[0].properties.id).toBe('center-main');
        expect(features).toHaveLength(5);
        expect(features.filter((f) => String(f.properties.id).startsWith('edge-'))).toHaveLength(4);
    });

    it('spatially spreads an oversized center tier instead of chunk-order prefix', () => {
        const center = [];
        for (let x = 0; x < 10; x++) {
            for (let y = 0; y < 10; y++) {
                center.push({
                    type: 'Feature',
                    properties: { id: `${x}-${y}`, _featureIndex: x * 10 + y },
                    geometry: { type: 'Point', coordinates: [x, y] }
                });
            }
        }
        const { features, truncated } = selectViewportFeaturesCenterFirst(center, [], {
            maxFeatures: 8,
            maxVertices: 250_000
        });
        expect(truncated).toBe(true);
        expect(features).toHaveLength(8);
        const xs = features.map((f) => f.geometry.coordinates[0]);
        const ys = features.map((f) => f.geometry.coordinates[1]);
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(4);
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(4);
    });

    it('spreadFeaturesSpatially covers the envelope', () => {
        const features = [];
        for (let x = 0; x < 10; x++) {
            for (let y = 0; y < 10; y++) {
                features.push({
                    type: 'Feature',
                    properties: { id: `${x}-${y}` },
                    geometry: { type: 'Point', coordinates: [x * 10, y * 10] }
                });
            }
        }
        const picked = spreadFeaturesSpatially(features, 8);
        expect(picked).toHaveLength(8);
        const xs = picked.map((f) => f.geometry.coordinates[0]);
        const ys = picked.map((f) => f.geometry.coordinates[1]);
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40);
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(40);
    });
});

describe('gis tile focus score', () => {
    it('scores tiles nearer the focus lower', () => {
        setGisTileFocus(-111.89, 40.76);
        expect(getGisTileFocus()).toEqual({ lon: -111.89, lat: 40.76 });
        // SLC-ish z12 tile vs a far tile
        const near = tileFocusScore(12, 774, 1539);
        const far = tileFocusScore(12, 100, 100);
        expect(near).toBeLessThan(far);
    });
});
