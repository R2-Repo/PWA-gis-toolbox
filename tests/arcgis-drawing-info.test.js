import { describe, expect, it } from 'vitest';
import {
    esriColorToCss,
    esriSymbolToFlat,
    geometryKindFromArcgis,
    parseArcgisLabelField,
    styleFromDrawingInfo,
    styleFromArcgisMetadata
} from '../js/arcgis/drawing-info.js';
import { compilePaint, resolveFeatureStyle } from '../js/map/style-engine.js';
import { suggestStyleChannel } from '../js/map/style-panel-helpers.js';
import { applyImportLayerStyles } from '../js/import/post-import.js';

const UDOT_ROUTES_RENDERER = {
    type: 'uniqueValue',
    field1: 'CARTO_CODE',
    fieldDelimiter: ', ',
    uniqueValueInfos: [
        { value: '1', label: 'Interstate', symbol: { type: 'esriSLS', style: 'esriSLSSolid', color: [115, 178, 255, 255], width: 2 } },
        { value: '2', label: 'US Route', symbol: { type: 'esriSLS', style: 'esriSLSSolid', color: [255, 0, 0, 255], width: 2 } },
        { value: '6', label: 'Ramp - (Interstate)', symbol: { type: 'esriSLS', style: 'esriSLSSolid', color: [104, 104, 104, 255], width: 0.5 } }
    ]
};

describe('ArcGIS drawingInfo → layer style', () => {
    it('converts ESRI [r,g,b,a] colors', () => {
        expect(esriColorToCss([115, 178, 255, 255])).toEqual({ hex: '#73b2ff', opacity: 1 });
        expect(esriColorToCss([255, 0, 0, 128]).opacity).toBeCloseTo(128 / 255);
        expect(esriColorToCss('#ff0000')).toEqual({ hex: '#ff0000', opacity: 1 });
    });

    it('maps geometry types', () => {
        expect(geometryKindFromArcgis('esriGeometryPolyline')).toBe('line');
        expect(geometryKindFromArcgis('LineString')).toBe('line');
        expect(geometryKindFromArcgis('esriGeometryPoint')).toBe('point');
        expect(geometryKindFromArcgis('esriGeometryPolygon')).toBe('polygon');
    });

    it('flattens simple line and fill symbols', () => {
        const line = esriSymbolToFlat({ type: 'esriSLS', color: [255, 0, 0, 255], width: 2 });
        expect(line).toMatchObject({ strokeColor: '#ff0000', strokeWidth: 2 });

        const fill = esriSymbolToFlat({
            type: 'esriSFS',
            color: [252, 229, 204, 255],
            outline: { type: 'esriSLS', color: [110, 110, 110, 255], width: 0.7 }
        });
        expect(fill.fillColor).toBe('#fce5cc');
        expect(fill.strokeColor).toBe('#6e6e6e');
        expect(fill.strokeWidth).toBe(0.7);
    });

    it('parses simple ArcGIS / Arcade label expressions', () => {
        expect(parseArcgisLabelField({ labelExpression: '[ROUTE_ID]' })).toBe('ROUTE_ID');
        expect(parseArcgisLabelField({ labelExpressionInfo: { expression: '$feature.NAME' } })).toBe('NAME');
        expect(parseArcgisLabelField({ labelExpressionInfo: { expression: '$feature["Full Name"]' } })).toBe('Full Name');
        expect(parseArcgisLabelField({ labelExpressionInfo: { expression: 'Concatenate($feature.A, $feature.B)' } })).toBeNull();
    });

    it('converts unique-value line renderers to smart stroke styles', () => {
        const style = styleFromDrawingInfo(
            { renderer: UDOT_ROUTES_RENDERER, labelingInfo: null },
            { geometryType: 'esriGeometryPolyline', displayField: 'ROUTE_ID' }
        );
        expect(style.mode).toBe('smart');
        const vv = style.smart.visualVariables[0];
        expect(vv.field).toBe('CARTO_CODE');
        expect(vv.channel).toBe('stroke');
        expect(vv.classes).toHaveLength(3);
        expect(vv.classes[0]).toMatchObject({ value: '1', label: 'Interstate', color: '#73b2ff' });
        expect(vv.classes[1].color).toBe('#ff0000');
        expect(vv.classes[2].style.strokeWidth).toBe(0.5);

        const paint = compilePaint(style, 'line');
        expect(paint.hasDataDriven).toBe(true);
        expect(paint.strokeColor[0]).toBe('match');
        expect(paint.strokeColor).toContain('#73b2ff');
        expect(paint.strokeWidth[0]).toBe('match');
        expect(paint.strokeWidth).toContain(0.5);

        const interstate = resolveFeatureStyle(style, { properties: { CARTO_CODE: 1 } }, 'line');
        expect(interstate.strokeColor).toBe('#73b2ff');
        expect(interstate.strokeWidth).toBe(2);
        const ramp = resolveFeatureStyle(style, { properties: { CARTO_CODE: '6' } }, 'line');
        expect(ramp.strokeColor).toBe('#686868');
        expect(ramp.strokeWidth).toBe(0.5);
    });

    it('enables labels from displayField on line layers when labelingInfo is empty', () => {
        const style = styleFromDrawingInfo(
            { renderer: UDOT_ROUTES_RENDERER },
            { geometryType: 'LineString', displayField: 'ROUTE_ID' }
        );
        expect(style.labels.enabled).toBe(true);
        expect(style.labels.field).toBe('ROUTE_ID');
        expect(style.labels.placement).toBe('line');
    });

    it('does not label OBJECTID display fields', () => {
        const style = styleFromDrawingInfo(
            { renderer: { type: 'simple', symbol: { type: 'esriSLS', color: [0, 0, 255, 255], width: 1 } } },
            { geometryType: 'line', displayField: 'OBJECTID' }
        );
        expect(style.labels).toBeUndefined();
        expect(style.mode).toBe('simple');
        expect(style.strokeColor).toBe('#0000ff');
    });

    it('converts simple polygon renderers', () => {
        const style = styleFromArcgisMetadata({
            geometryType: 'Polygon',
            displayField: 'NAME',
            drawingInfo: {
                renderer: {
                    type: 'simple',
                    symbol: {
                        type: 'esriSFS',
                        color: [252, 229, 204, 255],
                        outline: { type: 'esriSLS', color: [110, 110, 110, 255], width: 0.7 }
                    }
                }
            }
        });
        expect(style.mode).toBe('simple');
        expect(style.fillColor).toBe('#fce5cc');
        expect(style.strokeColor).toBe('#6e6e6e');
        expect(style.labels).toBeUndefined();
    });

    it('converts class-break renderers', () => {
        const style = styleFromDrawingInfo({
            renderer: {
                type: 'classBreaks',
                field: 'AADT',
                minValue: 0,
                classBreakInfos: [
                    { classMinValue: 0, classMaxValue: 1000, label: 'Low', symbol: { type: 'esriSLS', color: [0, 255, 0, 255], width: 1 } },
                    { classMinValue: 1000, classMaxValue: 5000, label: 'High', symbol: { type: 'esriSLS', color: [255, 0, 0, 255], width: 3 } }
                ]
            }
        }, { geometryType: 'line' });
        expect(style.mode).toBe('smart');
        expect(style.smart.visualVariables[0].type).toBe('range');
        expect(style.smart.visualVariables[0].field).toBe('AADT');
        expect(style.smart.visualVariables[0].classes).toHaveLength(2);
    });

    it('matches concatenated unique-value fields', () => {
        const style = styleFromDrawingInfo({
            renderer: {
                type: 'uniqueValue',
                field1: 'A',
                field2: 'B',
                fieldDelimiter: ', ',
                uniqueValueInfos: [
                    { value: 'x, y', label: 'XY', symbol: { type: 'esriSLS', color: [0, 128, 0, 255], width: 2 } }
                ]
            }
        }, { geometryType: 'line' });
        const vv = style.smart.visualVariables[0];
        expect(vv.fieldConcat).toEqual(['A', 'B']);
        const paint = compilePaint(style, 'line');
        expect(paint.strokeColor[1][0]).toBe('concat');
        const resolved = resolveFeatureStyle(style, { properties: { A: 'x', B: 'y' } }, 'line');
        expect(resolved.strokeColor).toBe('#008000');
    });

    it('returns null when drawingInfo is missing', () => {
        expect(styleFromDrawingInfo(null)).toBeNull();
        expect(styleFromArcgisMetadata({})).toBeNull();
    });
});

describe('smart unique colors on lines', () => {
    it('suggests stroke channel for line-only layers', () => {
        expect(suggestStyleChannel(new Set(['line']))).toBe('stroke');
        expect(suggestStyleChannel(new Set(['polygon']))).toBe('fill');
        expect(suggestStyleChannel(new Set(['line', 'polygon']))).toBe('both');
    });

    it('does not recolor lines when unique channel is fill', () => {
        const style = {
            mode: 'smart',
            strokeColor: '#2563eb',
            fillColor: '#2563eb',
            strokeWidth: 2,
            smart: {
                defaultStyle: { strokeColor: '#2563eb' },
                visualVariables: [{
                    type: 'unique',
                    field: 'CARTO_CODE',
                    channel: 'fill',
                    classes: [{ value: '1', color: '#ff0000' }],
                    defaultColor: '#94a3b8'
                }]
            }
        };
        const paint = compilePaint(style, 'line');
        expect(paint.strokeColor).toBe('#2563eb');
    });
});

describe('applyImportLayerStyles ArcGIS', () => {
    it('restyles from dataset._arcgisStyle', () => {
        const stored = new Map();
        const mapService = {
            getLayerStyle: (id) => stored.get(id) || null,
            setLayerStyle: (id, style) => stored.set(id, style),
            restyleLayer: (id, _ds, style) => stored.set(id, style)
        };
        const ds = {
            id: 'lyr-1',
            type: 'spatial',
            geojson: { type: 'FeatureCollection', features: [] },
            _arcgisStyle: styleFromDrawingInfo(
                { renderer: UDOT_ROUTES_RENDERER },
                { geometryType: 'line', displayField: 'ROUTE_ID' }
            )
        };
        applyImportLayerStyles(ds, { mapService, getLayers: () => [ds], layerIndex: 0 });
        const applied = stored.get('lyr-1');
        expect(applied.smart.visualVariables[0].field).toBe('CARTO_CODE');
        expect(ds._mapLabels.field).toBe('ROUTE_ID');
        expect(ds._mapLabels.placement).toBe('line');
    });
});
