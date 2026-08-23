// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SHEET_FIBER_SNAPSHOT_FORMAT } from '../js/symbology/udot-fiber/constants.js';
import {
    UDOT_PIP_COLOR,
    UDOT_PROTECT_IN_PLACE_PROP,
    excludeProtectInPlaceFilter,
    isProtectInPlaceFeature,
    makeProtectInPlaceSvg,
    setProtectInPlaceFlag
} from '../js/symbology/udot-fiber/protect-in-place.js';
import { decorateUdotFiberPointFeatures } from '../js/symbology/udot-fiber/glyphs.js';
import {
    getProtectInPlaceContextMenuItems,
    getProtectInPlaceSelectionItems,
    setProtectInPlaceOnLayerFeatures
} from '../js/widgets/sheet-cutting/protect-in-place.js';
import { buildSelectionActionItems } from '../js/tools/selection-actions.js';
import { buildUdotFiberPdfStyle } from '../js/widgets/sheet-cutting/sheet-pdf-fiber.js';

function snapshotLayer(features) {
    return {
        id: 'snap-fiber',
        name: 'Sheets UDOT Fiber',
        type: 'spatial',
        source: { format: SHEET_FIBER_SNAPSHOT_FORMAT, fiberKey: 'fiber' },
        geojson: { type: 'FeatureCollection', features }
    };
}

describe('existing protect in place', () => {
    it('toggles the operational flag without changing geometry', () => {
        const line = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { OBJECTID: 9, FIBER_SYMBOLS: '48' }
        };
        const on = setProtectInPlaceFlag(line, true);
        expect(isProtectInPlaceFeature(on)).toBe(true);
        expect(on.properties.FIBER_SYMBOLS).toBe('48');
        expect(on.geometry).toEqual(line.geometry);
        const off = setProtectInPlaceFlag(on, false);
        expect(isProtectInPlaceFeature(off)).toBe(false);
        expect(off.properties[UDOT_PROTECT_IN_PLACE_PROP]).toBeUndefined();
    });

    it('applies only to selected snapshot features and is reversible', () => {
        const layer = snapshotLayer([
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
                properties: { _featureIndex: 0, OBJECTID: 1 }
            },
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[2, 2], [3, 3]] },
                properties: { _featureIndex: 1, OBJECTID: 2 }
            }
        ]);
        const first = setProtectInPlaceOnLayerFeatures(layer, [1], true);
        expect(first.changed).toBe(1);
        expect(isProtectInPlaceFeature(first.features[0])).toBe(false);
        expect(isProtectInPlaceFeature(first.features[1])).toBe(true);
        layer.geojson.features = first.features;
        const again = setProtectInPlaceOnLayerFeatures(layer, [1], true);
        expect(again.changed).toBe(0);
        const restored = setProtectInPlaceOnLayerFeatures(layer, [1], false);
        expect(restored.changed).toBe(1);
        expect(isProtectInPlaceFeature(restored.features[1])).toBe(false);
    });

    it('offers a right-click toggle only on Fiber operational layers', () => {
        const layer = snapshotLayer([{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { _featureIndex: 4, OBJECTID: 4 }
        }]);
        const items = getProtectInPlaceContextMenuItems({
            layer,
            feature: layer.geojson.features[0],
            featureIndex: 4
        });
        expect(items).toHaveLength(1);
        expect(items[0].label).toBe('Existing protect in place');

        const live = getProtectInPlaceContextMenuItems({
            layer: { id: 'live', type: 'service', source: { format: 'arcgis' } },
            feature: layer.geojson.features[0],
            featureIndex: 4
        });
        expect(live).toEqual([]);
    });

    it('offers box-select apply and restore only while Sheet Cutter is open', () => {
        const layer = snapshotLayer([{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { _featureIndex: 0 }
        }]);
        expect(getProtectInPlaceSelectionItems({
            layer,
            count: 1,
            sheetCuttingOpen: false
        })).toEqual([]);
        const items = getProtectInPlaceSelectionItems({
            layer,
            count: 2,
            sheetCuttingOpen: true
        });
        expect(items.map((item) => item.label)).toEqual([
            'Existing protect in place',
            'Restore original style'
        ]);
    });

    it('puts protect-in-place actions at the top of the selection menu', () => {
        const extra = getProtectInPlaceSelectionItems({
            layer: snapshotLayer([]),
            count: 1,
            sheetCuttingOpen: true
        });
        const { items } = buildSelectionActionItems({
            layer: {
                id: 'snap-fiber',
                name: 'Sheets UDOT Fiber',
                schema: { geometryType: 'LineString' },
                geojson: { features: [{ properties: { _featureIndex: 0 } }] }
            },
            count: 1,
            extraItems: extra
        });
        expect(items[0].label).toBe('Existing protect in place');
        expect(items[1].label).toBe('Restore original style');
        expect(items[2].label).toBe('Invert selection');
    });

    it('excludes protect-in-place features from class-color filters', () => {
        const filter = excludeProtectInPlaceFilter(
            ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
        );
        expect(filter[0]).toBe('all');
        expect(JSON.stringify(filter)).toContain(UDOT_PROTECT_IN_PLACE_PROP);
        expect(JSON.stringify(filter)).toContain('LineString');
    });

    it('builds a hollow dashed outline SVG with no fill', () => {
        const svg = makeProtectInPlaceSvg('circle', 24);
        expect(svg).toContain('fill="none"');
        expect(svg).toContain(`stroke="${UDOT_PIP_COLOR}"`);
        expect(svg).toContain('stroke-dasharray');
        expect(makeProtectInPlaceSvg('rect', 24)).toContain('<rect');
    });

    it('stamps a PIP outline on operational point features and skips box labels', () => {
        const features = decorateUdotFiberPointFeatures('boxes', [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: {
                DT_RSCENCLOSURE_NAME: 'Exist Type I PC-R1',
                BOXLABELS: 'II',
                [UDOT_PROTECT_IN_PLACE_PROP]: 1
            }
        }], null);
        expect(features[0].properties._udotPipGlyph).toMatch(/^udot-pip-rect-/);
        expect(features[0].properties._udotBoxLabel).toBeUndefined();
    });

    it('exports dashed black PDF styles without class color or box labels', () => {
        const fiber = buildUdotFiberPdfStyle({
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: {
                FIBER_SYMBOLS: '48',
                _udotFiberKey: 'fiber',
                [UDOT_PROTECT_IN_PLACE_PROP]: 1
            }
        }, { _udotFiber: { layerKey: 'fiber' } });
        expect(fiber.protectInPlace).toBe(true);
        expect(fiber.strokes[0].strokeColor).toBe('#000000');
        expect(fiber.strokes[0].dash).toEqual([2.4, 1.8]);

        const box = buildUdotFiberPdfStyle({
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: {
                DT_RSCENCLOSURE_NAME: 'Exist Type I PC-R1',
                BOXLABELS: 'First Digital',
                _udotBoxLabel: 1,
                _udotFiberKey: 'boxes',
                [UDOT_PROTECT_IN_PLACE_PROP]: 1
            }
        }, { _udotFiber: { layerKey: 'boxes' } });
        expect(box.protectInPlace).toBe(true);
        expect(box.fillColor).toBeNull();
        expect(box.strokeColor).toBe('#000000');
        expect(box.boxLabel).toBeNull();
        expect(box.glyph).toBe('rect');
    });
});
