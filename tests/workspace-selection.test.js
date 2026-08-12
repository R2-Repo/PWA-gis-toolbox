import { describe, expect, it, vi } from 'vitest';

vi.mock('../js/workspace/viewport-loader.js', () => ({
    buildViewportGeoJSON: vi.fn(async (_layerId, bbox) => {
        const [w, s, e, n] = bbox;
        return {
            type: 'FeatureCollection',
            truncated: false,
            candidateCount: 3,
            features: [
                {
                    type: 'Feature',
                    properties: { _featureIndex: 1 },
                    geometry: { type: 'Point', coordinates: [(w + e) / 2, (s + n) / 2] }
                },
                {
                    type: 'Feature',
                    properties: { _featureIndex: 2 },
                    geometry: { type: 'Point', coordinates: [w + 0.01, s + 0.01] }
                },
                {
                    type: 'Feature',
                    properties: { _featureIndex: 99 },
                    geometry: { type: 'Point', coordinates: [e + 10, n + 10] }
                }
            ]
        };
    })
}));

vi.mock('../js/workspace/workspace-store.js', () => ({
    getWorkspaceFeaturesByIndices: vi.fn(async (_id, indices) =>
        indices.map((idx) => ({
            type: 'Feature',
            properties: { _featureIndex: idx },
            geometry: { type: 'Point', coordinates: [0, 0] }
        }))
    ),
    getWorkspaceFeatureByIndex: vi.fn(async (_id, idx) => ({
        type: 'Feature',
        properties: { _featureIndex: idx },
        geometry: { type: 'Point', coordinates: [1, 2] }
    }))
}));

import {
    mapEntryNeedsStoreSelection,
    queryWorkspaceIndicesInBbox,
    loadWorkspaceSelectionFeatures,
    resolveWorkspaceHighlightFeature,
    SELECTION_HIGHLIGHT_MAX_FEATURES
} from '../js/map/workspace-selection.js';
import { buildViewportGeoJSON } from '../js/workspace/viewport-loader.js';
import { getWorkspaceFeaturesByIndices } from '../js/workspace/workspace-store.js';

describe('workspace-selection', () => {
    it('detects tiled / empty workspace map entries', () => {
        expect(mapEntryNeedsStoreSelection({ tiled: true, geojson: { features: [] } })).toBe(true);
        expect(mapEntryNeedsStoreSelection({ workspace: true, geojson: { features: [] } })).toBe(true);
        expect(mapEntryNeedsStoreSelection({
            workspace: true,
            geojson: { features: [{ type: 'Feature', geometry: null, properties: {} }] }
        })).toBe(false);
        expect(mapEntryNeedsStoreSelection({ geojson: { features: [{ type: 'Feature' }] } })).toBe(false);
    });

    it('queries workspace indices in a bbox via viewport packet', async () => {
        const turfLib = {
            booleanIntersects: () => true,
            bboxPolygon: () => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] } })
        };
        // featureIntersectsGeographicBbox uses turf booleanIntersects when present;
        // stub always-true so both in-box points are kept. Out-of-box point still
        // comes from the mock packet — filter uses turf on each feature.
        const { indices } = await queryWorkspaceIndicesInBbox('ws-1', [-1, -1, 1, 1], { turfLib });
        expect(buildViewportGeoJSON).toHaveBeenCalled();
        expect(indices).toContain(1);
        expect(indices).toContain(2);
    });

    it('caps highlight feature loads', async () => {
        const many = Array.from({ length: SELECTION_HIGHLIGHT_MAX_FEATURES + 50 }, (_, i) => i);
        const features = await loadWorkspaceSelectionFeatures('ws-1', many);
        expect(features.length).toBe(SELECTION_HIGHLIGHT_MAX_FEATURES);
        expect(getWorkspaceFeaturesByIndices).toHaveBeenCalled();
        const passed = getWorkspaceFeaturesByIndices.mock.calls.at(-1)[1];
        expect(passed.length).toBe(SELECTION_HIGHLIGHT_MAX_FEATURES);
    });

    it('resolves a highlight feature from the workspace store', async () => {
        const feature = await resolveWorkspaceHighlightFeature('ws-1', 7);
        expect(feature.properties._featureIndex).toBe(7);
        expect(feature.geometry.coordinates).toEqual([1, 2]);
    });
});
