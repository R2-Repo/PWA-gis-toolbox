import { describe, it, expect } from 'vitest';
import {
    stripInternalFeatureProps,
    featuresFromSelection,
    remainingFeaturesAfterSelection,
    layerHasLineGeometry,
    buildSelectionActionItems,
    isCopyableAttributeValue,
    attributeFieldsFromSelection,
    attributeValuesFromSelection
} from '../js/tools/selection-actions.js';
import { isBoxSelectClickMove, BOX_SELECT_CLICK_MAX_MOVE_PX } from '../js/map/map-interaction-utils.js';

describe('selection-actions helpers', () => {
    const layer = {
        id: 'L1',
        name: 'Roads',
        schema: {
            geometryType: 'LineString',
            fields: [{ name: 'name' }, { name: 'meta' }]
        },
        geojson: {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
                    properties: { _featureIndex: 0, _datasetId: 'L1', name: 'a', meta: { nested: true } }
                },
                {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [[2, 2], [3, 3]] },
                    properties: { _featureIndex: 1, _datasetId: 'L1', name: 'b', meta: null }
                },
                {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [[4, 4], [5, 5]] },
                    properties: { _featureIndex: 2, _datasetId: 'L1', name: '', code: 'X' }
                }
            ]
        }
    };

    it('strips internal props', () => {
        const out = stripInternalFeatureProps(layer.geojson.features[0]);
        expect(out.properties).toEqual({ name: 'a', meta: { nested: true } });
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
        expect(remaining).toHaveLength(2);
        expect(remaining.map((f) => f.properties.name)).toEqual(['b', '']);
    });

    it('layerHasLineGeometry detects lines', () => {
        expect(layerHasLineGeometry(layer)).toBe(true);
        expect(layerHasLineGeometry({ schema: { geometryType: 'Point' }, geojson: { features: [] } })).toBe(false);
    });

    it('isCopyableAttributeValue skips empty and objects', () => {
        expect(isCopyableAttributeValue('a')).toBe(true);
        expect(isCopyableAttributeValue(0)).toBe(true);
        expect(isCopyableAttributeValue(false)).toBe(true);
        expect(isCopyableAttributeValue('')).toBe(false);
        expect(isCopyableAttributeValue(null)).toBe(false);
        expect(isCopyableAttributeValue({ a: 1 })).toBe(false);
        expect(isCopyableAttributeValue([1])).toBe(false);
    });

    it('attributeValuesFromSelection keeps selection order and skips empty/objects', () => {
        // indices [2,0,1]: '' skipped, then a, then b
        expect(attributeValuesFromSelection(layer, [2, 0, 1], 'name')).toEqual(['a', 'b']);
        expect(attributeValuesFromSelection(layer, [2, 0], 'code')).toEqual(['X']);
        expect(attributeValuesFromSelection(layer, [0, 1], 'meta')).toEqual([]);
    });

    it('attributeValuesFromSelection falls back to array index when _featureIndex missing', () => {
        const bare = {
            geojson: {
                features: [
                    { properties: { name: 'first' } },
                    { properties: { name: 'second' } }
                ]
            }
        };
        expect(attributeValuesFromSelection(bare, [1, 0], 'name')).toEqual(['second', 'first']);
    });

    it('attributeFieldsFromSelection lists schema fields without internals', () => {
        const fields = attributeFieldsFromSelection(layer, [0, 2]);
        expect(fields).toContain('name');
        expect(fields).toContain('meta');
        expect(fields).toContain('code');
        expect(fields).not.toContain('_featureIndex');
    });

    it('buildSelectionActionItems includes copy-attribute submenu and clear hint', () => {
        const { items, layerName } = buildSelectionActionItems({
            layer,
            count: 2,
            bbox: [-1, -1, 1, 1],
            formats: [{ key: 'geojson', label: 'GeoJSON' }],
            targetLayers: [
                layer,
                { id: 'L2', name: 'Other', type: 'spatial' }
            ],
            attributeFields: ['name', 'code'],
            onInvert: () => {},
            onDelete: () => {},
            onNewLayer: () => {},
            onClip: () => {},
            onBulkEdit: () => {},
            onExport: () => {},
            onCopyAttribute: () => {},
            onCopyToLayer: () => {},
            onMoveToLayer: () => {},
            onClear: () => {}
        });

        expect(layerName).toBe('Roads');
        const labels = items.filter((i) => !i.sep).map((i) => i.label);
        expect(labels).toContain('Invert selection');
        expect(labels).toContain('Delete selected');
        expect(labels).toContain('New layer from selected');
        expect(labels).toContain('Clip selected (lines)');
        expect(labels).toContain('Bulk edit attributes');
        expect(labels).toContain('Copy attribute to clipboard');
        expect(labels).toContain('Export selected');
        expect(labels).toContain('Copy to existing layer');
        expect(labels).toContain('Move to existing layer');
        expect(labels).toContain('Clear selection');
        const copyAttr = items.find((i) => i.label === 'Copy attribute to clipboard');
        expect(copyAttr.children.map((c) => c.label)).toEqual(['name', 'code']);
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

describe('placeMenuOutsideSelectionBox', () => {
    it('places to the right of the selection box when space allows', async () => {
        const { placeMenuOutsideSelectionBox } = await import('../js/map/map-interaction-utils.js');
        const pos = placeMenuOutsideSelectionBox({
            box: { left: 100, top: 100, right: 300, bottom: 250 },
            menuWidth: 220,
            menuHeight: 280,
            cursorX: 280,
            cursorY: 200,
            viewportWidth: 1200,
            viewportHeight: 800,
            gap: 14,
            pad: 8
        });
        expect(pos.x).toBe(314);
        expect(pos.y).toBe(60);
        expect(pos.x).toBeGreaterThanOrEqual(300 + 14);
    });

    it('falls back below the box when sides are blocked', async () => {
        const { placeMenuOutsideSelectionBox } = await import('../js/map/map-interaction-utils.js');
        const pos = placeMenuOutsideSelectionBox({
            box: { left: 40, top: 40, right: 900, bottom: 200 },
            menuWidth: 220,
            menuHeight: 200,
            cursorX: 400,
            cursorY: 120,
            viewportWidth: 960,
            viewportHeight: 800,
            gap: 14,
            pad: 8
        });
        expect(pos.y).toBe(214);
    });
});

describe('isBoxSelectClickMove', () => {
    it('treats small moves as clicks', () => {
        expect(isBoxSelectClickMove({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
        expect(isBoxSelectClickMove({ x: 0, y: 0 }, { x: BOX_SELECT_CLICK_MAX_MOVE_PX + 1, y: 0 })).toBe(false);
    });
});

describe('featureIntersectsGeographicBbox', () => {
    it('uses point coordinates, not rendered marker size', async () => {
        const { featureIntersectsGeographicBbox } = await import('../js/map/map-interaction-utils.js');
        const bbox = [-111.90, 40.50, -111.80, 40.60];
        const inside = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-111.85, 40.55] },
            properties: {}
        };
        // Just north of the box — would often still be hit by a large zoomed-out circle
        const outsideNorth = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-111.85, 40.601] },
            properties: {}
        };
        expect(featureIntersectsGeographicBbox(inside, bbox)).toBe(true);
        expect(featureIntersectsGeographicBbox(outsideNorth, bbox)).toBe(false);
    });
});
