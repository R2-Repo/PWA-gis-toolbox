import { describe, expect, it } from 'vitest';
import { styleFromDrawingInfo } from '../js/arcgis/drawing-info.js';
import { buildMapLegend, geometryKindFromLayer, legendItemsFromStyle, legendLayerRecords } from '../js/map/map-legend.js';

const SIMPLE = {
    mode: 'simple',
    strokeColor: '#112233',
    fillColor: '#abcdef',
    strokeWidth: 3,
    strokeOpacity: 1,
    fillOpacity: 0.4,
    pointSize: 9,
    pointSymbol: 'circle'
};

function uniqueStyle(labels) {
    return {
        mode: 'smart',
        strokeColor: '#336699',
        fillColor: '#336699',
        strokeWidth: 2,
        strokeOpacity: 1,
        fillOpacity: 0.4,
        pointSize: 6,
        pointSymbol: 'circle',
        smart: {
            defaultStyle: { strokeColor: '#336699', fillColor: '#336699' },
            visualVariables: [{
                id: 'vv-unique',
                type: 'unique',
                field: 'CARTO_CODE',
                channel: 'fill',
                defaultColor: '#94a3b8',
                classes: [
                    { value: '1', label: labels[0], color: '#73b2ff', style: {} },
                    { value: '2', label: labels[1], color: '#ff0000', style: {} }
                ]
            }],
            filterRules: []
        }
    };
}

describe('map legend', () => {
    it('reads geometry kind from the layer schema', () => {
        expect(geometryKindFromLayer({ schema: { geometryType: 'MultiPolygon' } })).toBe('polygon');
        expect(geometryKindFromLayer({ schema: { geometryType: 'MultiLineString' } })).toBe('line');
        expect(geometryKindFromLayer({ schema: { geometryType: 'MultiPoint' } })).toBe('point');
    });

    it('builds one single-symbol entry and leaves hidden layers out', () => {
        const legend = buildMapLegend([
            { id: 'shown', name: 'Parks', visible: true, geometryKind: 'polygon', style: SIMPLE },
            { id: 'hidden', name: 'Hidden parks', visible: false, geometryKind: 'polygon', style: SIMPLE },
            { id: 'implied', name: 'Roads', geometryKind: 'line', style: { ...SIMPLE, strokeColor: '#ff8800' } }
        ]);
        expect(legend.map((entry) => entry.name)).toEqual(['Parks', 'Roads']);
        expect(legend[0].symbology).toBe('single');
        expect(legend[0].items).toEqual([
            { label: '', color: '#abcdef', swatch: 'fill', size: null, width: null }
        ]);
        expect(legend[1].items[0]).toMatchObject({ color: '#ff8800', swatch: 'line', width: 3 });
    });

    it('uses editable class labels for unique values', () => {
        const before = legendItemsFromStyle(uniqueStyle(['1', '2']), 'polygon');
        const after = legendItemsFromStyle(uniqueStyle(['Interstate highway', 'US route']), 'polygon');
        expect(before.items.map((item) => item.label)).toEqual(['1', '2', 'Other']);
        expect(after.symbology).toBe('unique');
        expect(after.items.map((item) => item.label)).toEqual(['Interstate highway', 'US route', 'Other']);
        expect(after.items[0].color).toBe('#73b2ff');
        expect(after.items[2].color).toBe('#94a3b8');
    });

    it('uses graduated color class labels and a size ramp', () => {
        const colors = legendItemsFromStyle({
            mode: 'smart',
            fillColor: '#2563eb',
            strokeColor: '#2563eb',
            smart: {
                defaultStyle: { fillColor: '#2563eb', strokeColor: '#2563eb' },
                visualVariables: [{
                    id: 'breaks',
                    type: 'range',
                    field: 'AADT',
                    channel: 'fill',
                    classes: [
                        { value: '0–10', label: 'Quiet', color: '#ffffcc', min: 0, max: 10, style: {} },
                        { value: '10–20', label: 'Busy', color: '#e31a1c', min: 10, max: 20, style: {} }
                    ]
                }],
                filterRules: []
            }
        }, 'polygon');
        expect(colors.symbology).toBe('graduated-colors');
        expect(colors.items.map((item) => item.label)).toEqual(['Quiet', 'Busy']);

        const ramp = legendItemsFromStyle({
            mode: 'smart',
            strokeColor: '#2563eb',
            fillColor: '#2563eb',
            smart: {
                defaultStyle: {},
                visualVariables: [{
                    id: 'ramp',
                    type: 'ramp',
                    field: 'AADT',
                    channel: 'stroke',
                    ramp: 'ylOrRd',
                    min: 0,
                    max: 5000
                }],
                filterRules: []
            }
        }, 'line');
        expect(ramp.symbology).toBe('graduated-colors');
        expect(ramp.ramp).toBeNull();
        expect(ramp.items.map((item) => item.label)).toEqual([
            '0.0 \u2013 1000.0',
            '1000.0 \u2013 2000.0',
            '2000.0 \u2013 3000.0',
            '3000.0 \u2013 4000.0',
            '4000.0 \u2013 5000.0'
        ]);
        expect(ramp.items[0].label).not.toBe('0');
        expect(ramp.items[ramp.items.length - 1].label).not.toBe('5000');

        const size = legendItemsFromStyle({
            mode: 'smart',
            fillColor: '#2255aa',
            strokeColor: '#2255aa',
            pointSize: 6,
            smart: {
                defaultStyle: { fillColor: '#2255aa', pointSize: 6 },
                visualVariables: [{
                    id: 'sz',
                    type: 'size',
                    field: 'AADT',
                    min: 0,
                    max: 100,
                    sizeMin: 4,
                    sizeMax: 18
                }],
                filterRules: []
            }
        }, 'point');
        expect(size.symbology).toBe('graduated-size');
        expect(size.items.map((item) => item.label)).toEqual([
            '0.0 \u2013 20.0',
            '20.0 \u2013 40.0',
            '40.0 \u2013 60.0',
            '60.0 \u2013 80.0',
            '80.0 \u2013 100.0'
        ]);
        expect(size.items.map((item) => item.size)).toEqual([4, 7.5, 11, 14.5, 18]);
        expect(size.items[0].swatch).toBe('circle');

        const sizedClasses = legendItemsFromStyle({
            mode: 'smart',
            fillColor: '#2255aa',
            strokeColor: '#2255aa',
            pointSize: 6,
            smart: {
                defaultStyle: { fillColor: '#2255aa', pointSize: 6 },
                visualVariables: [{
                    id: 'sz-cls',
                    type: 'size',
                    field: 'AADT',
                    min: 0,
                    max: 100,
                    sizeMin: 4,
                    sizeMax: 18,
                    classes: [
                        { value: 'low', label: 'Low traffic', min: 0, max: 40, style: {} },
                        { value: 'high', label: 'High traffic', min: 40, max: 100, style: {} }
                    ]
                }],
                filterRules: []
            }
        }, 'point');
        expect(sizedClasses.items.map((item) => item.label)).toEqual(['Low traffic', 'High traffic']);
        expect(sizedClasses.items.map((item) => item.size)).toEqual([4, 18]);
    });

    it('builds the same labels from imported ArcGIS renderers', () => {
        const unique = styleFromDrawingInfo({
            renderer: {
                type: 'uniqueValue',
                field1: 'CARTO_CODE',
                uniqueValueInfos: [
                    { value: '1', label: 'Interstate', symbol: { type: 'esriSLS', color: [115, 178, 255, 255], width: 2 } },
                    { value: '2', label: 'US Route', symbol: { type: 'esriSLS', color: [255, 0, 0, 255], width: 2 } }
                ]
            }
        }, { geometryType: 'esriGeometryPolyline' });
        const uniqueLegend = buildMapLegend([
            { id: 'routes', name: 'Routes', visible: true, geometryKind: 'line', style: unique }
        ]);
        expect(uniqueLegend).toHaveLength(1);
        expect(uniqueLegend[0].symbology).toBe('unique');
        expect(uniqueLegend[0].items.map((item) => item.label)).toEqual(['Interstate', 'US Route', 'Other']);
        expect(uniqueLegend[0].items[0]).toMatchObject({ color: '#73b2ff', swatch: 'line' });

        const breaks = styleFromDrawingInfo({
            renderer: {
                type: 'classBreaks',
                field: 'AADT',
                minValue: 0,
                classBreakInfos: [
                    { classMinValue: 0, classMaxValue: 1000, label: 'Low traffic', symbol: { type: 'esriSLS', color: [0, 128, 0, 255], width: 1 } },
                    { classMinValue: 1000, classMaxValue: 5000, label: 'High traffic', symbol: { type: 'esriSLS', color: [200, 0, 0, 255], width: 4 } }
                ]
            }
        }, { geometryType: 'esriGeometryPolyline' });
        const breakLegend = buildMapLegend([
            { id: 'aadt', name: 'Traffic', visible: true, geometryKind: 'line', style: breaks }
        ]);
        expect(breakLegend[0].symbology).toBe('graduated-colors');
        expect(breakLegend[0].items.map((item) => item.label)).toEqual(['Low traffic', 'High traffic']);
        expect(breakLegend[0].items[1].color).toBe('#c80000');

        const simple = styleFromDrawingInfo({
            renderer: {
                type: 'simple',
                symbol: {
                    type: 'esriSFS',
                    color: [0, 0, 255, 255],
                    outline: { type: 'esriSLS', color: [0, 0, 0, 255], width: 1 }
                }
            }
        }, { geometryType: 'esriGeometryPolygon' });
        const simpleLegend = buildMapLegend([
            { id: 'parcels', name: 'Parcels', visible: true, geometryKind: 'polygon', style: simple }
        ]);
        expect(simpleLegend[0].symbology).toBe('single');
        expect(simpleLegend[0].name).toBe('Parcels');
        expect(simpleLegend[0].items[0].color).toBe('#0000ff');
        expect(simpleLegend[0].items[0].swatch).toBe('fill');
    });

    it('changes the legend when a class label changes', () => {
        const layer = {
            id: 'routes',
            name: 'Routes',
            visible: true,
            geometryKind: 'line',
            style: uniqueStyle(['Interstate', 'US Route'])
        };
        const first = buildMapLegend([layer]);
        const renamed = uniqueStyle(['Interstate highway', 'US Route']);
        const second = buildMapLegend([{ ...layer, style: renamed }]);
        expect(first[0].items[0].label).toBe('Interstate');
        expect(second[0].items[0].label).toBe('Interstate highway');
        expect(second[0].items[0].color).toBe(first[0].items[0].color);
    });

    it('gives imported service overlays a legend entry', () => {
        const records = legendLayerRecords([
            { id: 'table', type: 'table', name: 'Table', visible: true },
            {
                id: 'overlay',
                type: 'service',
                name: 'Imagery overlay',
                visible: true,
                service: { kind: 'arcgis-mapserver' },
                style: SIMPLE
            },
            {
                id: 'hidden-service',
                type: 'service',
                name: 'Hidden overlay',
                visible: false,
                style: SIMPLE
            }
        ], (layer) => layer.style);
        expect(records.map((entry) => entry.id)).toEqual(['overlay', 'hidden-service']);
        const legend = buildMapLegend(records);
        expect(legend.map((entry) => entry.name)).toEqual(['Imagery overlay']);
        expect(legend[0].symbology).toBe('single');
        expect(legend[0].items[0].color).toBe('#abcdef');
    });
});
