import { describe, it, expect } from 'vitest';
import {
    stripInternalFeatureProps,
    featuresFromSelection,
    remainingFeaturesAfterSelection,
    layerHasLineGeometry,
    buildSelectionActionItems
} from '../js/tools/selection-actions.js';
import { isBoxSelectClickMove, BOX_SELECT_CLICK_MAX_MOVE_PX } from '../js/map/map-interaction-utils.js';

describe('selection-actions helpers', () => {
    const layer = {
        id: 'L1',
        name: 'Roads',
        schema: { geometryType: 'LineString' },
        geojson: {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
                    properties: { _featureIndex: 0, _datasetId: 'L1', name: 'a' }
                },
                {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [[2, 2], [3, 3]] },
                    properties: { _featureIndex: 1, _datasetId: 'L1', name: 'b' }
                }
            ]
        }
    };

    it('strips internal props', () => {
        const out = stripInternalFeatureProps(layer.geojson.features[0]);
        expect(out.properties).toEqual({ name: 'a' });
        expect(out.geometry.type).toBe('LineString');
    });

    it('featuresFromSelection returns stripped selected features', () => {
        const feats = featuresFromSelection(layer, [1]);
        expect(feats).toHaveLength(1);
        expect(feats[0].properties.name).toBe('b');
        expect(feats[0].properties._featureIndex).toBeUndefined();
    });

    it('remainingFeaturesAfterSelection keeps unselected', () => {
        const remaining = remainingFeaturesAfterSelection(layer, [0]);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].properties.name).toBe('b');
    });

    it('layerHasLineGeometry detects lines', () => {
        expect(layerHasLineGeometry(layer)).toBe(true);
        expect(layerHasLineGeometry({ schema: { geometryType: 'Point' }, geojson: { features: [] } })).toBe(false);
    });

    it('buildSelectionActionItems includes core actions and clear hint', () => {
        const { items, layerName } = buildSelectionActionItems({
            layer,
            count: 2,
            bbox: [-1, -1, 1, 1],
            formats: [{ key: 'geojson', label: 'GeoJSON' }],
            targetLayers: [
                layer,
                { id: 'L2', name: 'Other', type: 'spatial' }
            ],
            onInvert: () => {},
            onDelete: () => {},
            onNewLayer: () => {},
            onClip: () => {},
            onBulkEdit: () => {},
            onExport: () => {},
            onCopyToLayer: () => {},
            onMoveToLayer: () => {},
            onClear: () => {}
        });

        expect(layerName).toContain('Roads');
        const labels = items.filter((i) => !i.sep).map((i) => i.label);
        expect(labels).toContain('Invert selection');
        expect(labels).toContain('Delete selected');
        expect(labels).toContain('New layer from selected');
        expect(labels).toContain('Clip selected (lines)');
        expect(labels).toContain('Bulk edit attributes');
        expect(labels).toContain('Export selected');
        expect(labels).toContain('Copy to existing layer');
        expect(labels).toContain('Move to existing layer');
        expect(labels).toContain('Clear selection');
        const clear = items.find((i) => i.label === 'Clear selection');
        expect(clear.hint).toMatch(/Esc/i);
    });

    it('hides clip when no bbox or non-line layer', () => {
        const { items } = buildSelectionActionItems({
            layer: { ...layer, schema: { geometryType: 'Point' }, geojson: { features: [] } },
            count: 1,
            bbox: null,
            formats: [],
            targetLayers: []
        });
        expect(items.some((i) => i.label === 'Clip selected (lines)')).toBe(false);
    });
});

describe('isBoxSelectClickMove', () => {
    it('treats small moves as clicks', () => {
        expect(isBoxSelectClickMove({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
        expect(isBoxSelectClickMove({ x: 0, y: 0 }, { x: BOX_SELECT_CLICK_MAX_MOVE_PX + 1, y: 0 })).toBe(false);
    });
});
