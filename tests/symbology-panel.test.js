/**
 * @vitest-environment jsdom
 */
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { SmartStylePanel } from '../react/panels/SmartStylePanel.jsx';
import {
    SYMBOLOGY_TYPES,
    VISUAL_VARIABLE_TYPES,
    compilePaint,
    resolveFeatureStyle
} from '../js/map/style-engine.js';
import {
    styleFromDrawingInfo
} from '../js/arcgis/drawing-info.js';
import {
    styleForHighlightRules,
    styleForSymbologyField,
    styleForSymbologyType,
    symbologyTypeFromStyle,
    variableTypeForSymbology
} from '../js/map/style-panel-helpers.js';

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

const CLASS_BREAKS = {
    type: 'classBreaks',
    field: 'AADT',
    minValue: 0,
    classBreakInfos: [
        { classMinValue: 0, classMaxValue: 1000, label: 'Low', symbol: { type: 'esriSLS', color: [0, 255, 0, 255], width: 1 } },
        { classMinValue: 1000, classMaxValue: 5000, label: 'High', symbol: { type: 'esriSLS', color: [255, 0, 0, 255], width: 3 } }
    ]
};

function lineLayer(features, fields) {
    return {
        id: 'roads',
        name: 'Roads',
        schema: { geometryType: 'LineString', fields },
        geojson: { type: 'FeatureCollection', features }
    };
}

const roadFeatures = [
    { type: 'Feature', properties: { NAME: 'Main', CARTO_CODE: '1', AADT: 100 }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
    { type: 'Feature', properties: { NAME: 'Side', CARTO_CODE: '6', AADT: 4000 }, geometry: { type: 'LineString', coordinates: [[1, 1], [2, 1]] } }
];

const roadFields = [
    { name: 'NAME', type: 'string', selected: true },
    { name: 'CARTO_CODE', type: 'string', selected: true },
    { name: 'AADT', type: 'number', selected: true }
];

function paints(style) {
    return {
        line: compilePaint(style, 'line'),
        point: compilePaint(style, 'point'),
        polygon: compilePaint(style, 'polygon'),
        interstate: resolveFeatureStyle(style, { properties: { CARTO_CODE: '1', AADT: 100, NAME: 'Main' } }, 'line'),
        ramp: resolveFeatureStyle(style, { properties: { CARTO_CODE: '6', AADT: 4000, NAME: 'Side' } }, 'line')
    };
}

async function renderPanel({ layer, style, onStyleChange = vi.fn() }) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(h(SmartStylePanel, {
            layer,
            style,
            defaultColor: '#2563eb',
            onStyleChange
        }));
    });
    return {
        container,
        onStyleChange,
        async rerender(nextStyle) {
            await act(async () => {
                root.render(h(SmartStylePanel, {
                    layer,
                    style: nextStyle,
                    defaultColor: '#2563eb',
                    onStyleChange
                }));
            });
        },
        async unmount() {
            await act(async () => root.unmount());
            container.remove();
        }
    };
}

async function choose(select, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    await act(async () => {
        setter.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

describe('symbology dropdown mapping', () => {
    it('lists the plain symbology types and keeps saved variable ids', () => {
        expect(SYMBOLOGY_TYPES.map((t) => t.id)).toEqual([
            'single', 'unique', 'graduated-colors', 'graduated-size'
        ]);
        expect(SYMBOLOGY_TYPES.map((t) => t.label)).toEqual([
            'Single symbol', 'Unique values', 'Graduated colors', 'Graduated size'
        ]);
        expect(SYMBOLOGY_TYPES.some((t) => /heat/i.test(t.id + t.label))).toBe(false);
        expect(VISUAL_VARIABLE_TYPES.map((t) => t.id)).toEqual([
            'unique', 'range', 'ramp', 'size', 'width', 'opacity'
        ]);
    });

    it('maps geometry to a size variable without renaming a saved ramp', () => {
        expect(variableTypeForSymbology('graduated-size', new Set(['point']))).toBe('size');
        expect(variableTypeForSymbology('graduated-size', new Set(['line']))).toBe('width');
        expect(variableTypeForSymbology('graduated-size', new Set(['polygon']))).toBe('width');
        expect(variableTypeForSymbology('graduated-colors', new Set(['line']), 'ramp')).toBe('ramp');
        expect(variableTypeForSymbology('graduated-colors', new Set(['line']), null)).toBe('range');
    });

    it('does not invent a field when the type changes', () => {
        const simple = { mode: 'simple', strokeColor: '#336699', fillColor: '#336699' };
        expect(styleForSymbologyType(simple, 'unique', {
            fields: roadFields,
            features: roadFeatures,
            geomTypes: new Set(['line'])
        })).toBeNull();
        expect(styleForSymbologyType(simple, 'graduated-colors', {
            fields: roadFields,
            features: roadFeatures,
            geomTypes: new Set(['line'])
        })).toBeNull();
        expect(symbologyTypeFromStyle(simple)).toBe('single');
    });

    it('parks a saved classification on single symbol and restores the same paint', () => {
        const saved = styleFromDrawingInfo(
            { renderer: UDOT_ROUTES_RENDERER },
            { geometryType: 'esriGeometryPolyline' }
        );
        const before = paints(saved);
        const parked = styleForSymbologyType(saved, 'single', {});
        expect(parked.mode).toBe('simple');
        expect(parked.smart.visualVariables[0].field).toBe('CARTO_CODE');
        expect(parked.smart.visualVariables[0].classes).toEqual(saved.smart.visualVariables[0].classes);
        const restored = styleForSymbologyType(parked, 'unique', {});
        expect(restored.mode).toBe('smart');
        expect(restored.smart.visualVariables[0]).toBe(saved.smart.visualVariables[0]);
        expect(paints(restored)).toEqual(before);
        expect(symbologyTypeFromStyle(saved)).toBe('unique');
    });

    it('keeps the saved field when the user changes type', () => {
        const saved = styleFromDrawingInfo(
            { renderer: UDOT_ROUTES_RENDERER },
            { geometryType: 'esriGeometryPolyline' }
        );
        const next = styleForSymbologyType(saved, 'graduated-colors', {
            fields: roadFields,
            features: roadFeatures,
            geomTypes: new Set(['line']),
            channel: 'stroke'
        });
        expect(next.smart.visualVariables[0].field).toBe('CARTO_CODE');
        expect(next.smart.visualVariables[0].type).toBe('range');
        expect(symbologyTypeFromStyle(next)).toBe('graduated-colors');
    });

    it('applies only the field the user picked', () => {
        const simple = { mode: 'simple', strokeColor: '#336699', fillColor: '#112233', strokeWidth: 2 };
        const next = styleForSymbologyField(simple, 'AADT', 'graduated-colors', {
            fields: roadFields,
            features: roadFeatures,
            geomTypes: new Set(['line']),
            channel: 'stroke'
        });
        expect(next.mode).toBe('smart');
        expect(next.smart.visualVariables).toHaveLength(1);
        expect(next.smart.visualVariables[0].field).toBe('AADT');
        expect(next.smart.visualVariables[0].type).toBe('range');
        expect(next.strokeColor).toBe('#336699');
    });

    it('keeps a single-symbol dropdown when a highlight is added', () => {
        const simple = { mode: 'simple', strokeColor: '#112233', fillColor: '#112233', strokeWidth: 2, fillOpacity: 0.3 };
        const next = styleForHighlightRules(simple, [{
            id: 'h1',
            filter: { logic: 'AND', rules: [{ field: 'NAME', operator: 'equals', value: 'Side' }] },
            style: { fillColor: '#ff00ff', strokeWidth: 9 }
        }]);
        expect(symbologyTypeFromStyle(next)).toBe('single');
        expect(next.smart.visualVariables).toEqual([]);
        const plain = resolveFeatureStyle(next, { properties: { NAME: 'Main' } }, 'line');
        expect(plain.strokeColor).toBe('#112233');
        expect(plain.strokeWidth).toBe(2);
        const hit = resolveFeatureStyle(next, { properties: { NAME: 'Side' } }, 'line');
        expect(hit.strokeWidth).toBe(9);
    });
});

describe('symbology panel', () => {
    const layer = lineLayer(roadFeatures, roadFields);

    it('shows saved simple, unique, graduated, and size styles without rewriting paint', async () => {
        const simple = { mode: 'simple', strokeColor: '#336699', fillColor: '#336699', strokeWidth: 4 };
        const unique = styleFromDrawingInfo(
            { renderer: UDOT_ROUTES_RENDERER },
            { geometryType: 'esriGeometryPolyline' }
        );
        const breaks = styleFromDrawingInfo(
            { renderer: CLASS_BREAKS },
            { geometryType: 'line' }
        );
        const ramp = {
            mode: 'smart',
            strokeColor: '#2563eb',
            fillColor: '#2563eb',
            smart: {
                defaultStyle: { strokeColor: '#2563eb' },
                filterRules: [],
                visualVariables: [{ id: 'ramp', type: 'ramp', field: 'AADT', channel: 'stroke', ramp: 'ylOrRd', min: 0, max: 5000 }]
            }
        };
        const sized = {
            mode: 'smart',
            strokeColor: '#2563eb',
            pointSize: 6,
            smart: {
                defaultStyle: { pointSize: 6 },
                filterRules: [],
                visualVariables: [{ id: 'sz', type: 'size', field: 'AADT', min: 0, max: 100, sizeMin: 4, sizeMax: 18 }]
            }
        };
        const cases = [
            [simple, 'single'],
            [unique, 'unique'],
            [breaks, 'graduated-colors'],
            [ramp, 'graduated-colors'],
            [sized, 'graduated-size']
        ];
        for (const [style, type] of cases) {
            const before = paints(style);
            const onStyleChange = vi.fn();
            const view = await renderPanel({ layer, style, onStyleChange });
            expect(view.container.querySelector('[aria-label="Symbology"]').value).toBe(type);
            expect(onStyleChange).not.toHaveBeenCalled();
            expect(paints(style)).toEqual(before);
            expect(view.container.querySelector('.symbology-symbol').closest('details')).toBeNull();
            expect(view.container.querySelector('.symbology-symbol').textContent).toContain('Symbol');
            const text = view.container.querySelector('.style-panel').textContent;
            expect(text).not.toContain('Smart');
            expect(text).not.toContain('Color by');
            expect(text).not.toContain('Styling rule');
            expect(text).not.toContain('Update from data');
            expect(text).not.toContain('Default style');
            expect(view.container.querySelector('.symbology-highlight').textContent).toContain('does not hide features');
            await view.unmount();
        }

        const uniqueView = await renderPanel({ layer, style: unique });
        const labels = [...uniqueView.container.querySelectorAll('.smart-style-legend-label-input')].map((el) => el.value);
        expect(labels).toEqual(['Interstate', 'US Route', 'Ramp - (Interstate)']);
        expect(uniqueView.container.querySelector('[aria-label="Field"]').value).toBe('CARTO_CODE');
        expect(uniqueView.container.querySelector('[aria-label="Color"]').value).toBe('stroke');
        expect(uniqueView.container.textContent).toContain('Reclassify');
        await uniqueView.unmount();

        const breakView = await renderPanel({ layer, style: breaks });
        expect([...breakView.container.querySelectorAll('.smart-style-legend-label-input')].map((el) => el.value))
            .toEqual(['Low', 'High']);
        expect(breakView.container.querySelector('[aria-label="Field"]').value).toBe('AADT');
        await breakView.unmount();

        expect(compilePaint(ramp, 'line').strokeColor[0]).toBe('interpolate');
        expect(compilePaint(sized, 'point').circleRadius[0]).toBe('interpolate');
    });

    it('keeps an ArcGIS renderer paint expression until the user edits', async () => {
        const style = styleFromDrawingInfo(
            { renderer: UDOT_ROUTES_RENDERER },
            { geometryType: 'esriGeometryPolyline' }
        );
        const before = paints(style);
        const view = await renderPanel({ layer, style });
        expect(view.container.querySelector('[aria-label="Symbology"]').value).toBe('unique');
        expect(paints(style)).toEqual(before);
        expect(view.onStyleChange).not.toHaveBeenCalled();
        await view.unmount();

        const simple = styleFromDrawingInfo(
            { renderer: { type: 'simple', symbol: { type: 'esriSLS', color: [0, 0, 255, 255], width: 1 } } },
            { geometryType: 'line' }
        );
        const simpleBefore = paints(simple);
        const simpleView = await renderPanel({ layer, style: simple });
        expect(simpleView.container.querySelector('[aria-label="Symbology"]').value).toBe('single');
        expect(paints(simple)).toEqual(simpleBefore);
        await simpleView.unmount();
    });

    it('does not apply a field until the user picks one or confirms the preview', async () => {
        const style = { mode: 'simple', strokeColor: '#336699', fillColor: '#336699', strokeWidth: 2 };
        const before = paints(style);
        const view = await renderPanel({ layer, style });
        await choose(view.container.querySelector('[aria-label="Symbology"]'), 'unique');
        expect(view.onStyleChange).not.toHaveBeenCalled();
        expect(paints(style)).toEqual(before);
        expect(view.container.querySelector('[data-symbology-preview="true"]').textContent).toContain('Preview for NAME');
        expect(view.container.querySelector('[aria-label="Field"]').value).toBe('');

        await choose(view.container.querySelector('[aria-label="Symbology"]'), 'graduated-colors');
        expect(view.onStyleChange).not.toHaveBeenCalled();
        expect(view.container.querySelector('[data-symbology-preview="true"]')).toBeTruthy();

        await choose(view.container.querySelector('[aria-label="Field"]'), 'AADT');
        expect(view.onStyleChange).toHaveBeenCalledTimes(1);
        const next = view.onStyleChange.mock.calls[0][0];
        expect(next.mode).toBe('smart');
        expect(next.smart.visualVariables[0].field).toBe('AADT');
        expect(next.smart.visualVariables[0].type).toBe('range');
        expect(next.strokeColor).toBe('#336699');
        await view.unmount();
    });

    it('edits class labels without changing paint colors', async () => {
        const style = styleFromDrawingInfo(
            { renderer: UDOT_ROUTES_RENDERER },
            { geometryType: 'esriGeometryPolyline' }
        );
        const before = paints(style);
        const view = await renderPanel({ layer, style });
        const input = view.container.querySelector('[aria-label="Label for 1"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        await act(async () => {
            setter.call(input, 'Interstate highway');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const next = view.onStyleChange.mock.calls.at(-1)[0];
        expect(next.smart.visualVariables[0].classes[0].label).toBe('Interstate highway');
        expect(next.smart.visualVariables[0].classes[0].color).toBe(style.smart.visualVariables[0].classes[0].color);
        expect(next.smart.visualVariables[0].classes[0].value).toBe('1');
        expect(paints(style)).toEqual(before);
        expect(compilePaint(next, 'line').strokeColor).toEqual(before.line.strokeColor);
        await view.unmount();
    });

    it('shows a second saved variable without dropping it', async () => {
        const style = {
            mode: 'smart',
            strokeColor: '#2563eb',
            fillColor: '#2563eb',
            smart: {
                defaultStyle: { strokeColor: '#2563eb' },
                filterRules: [],
                visualVariables: [
                    {
                        id: 'u',
                        type: 'unique',
                        field: 'CARTO_CODE',
                        channel: 'stroke',
                        classes: [{ value: '1', label: 'Interstate', color: '#73b2ff', style: {} }],
                        defaultColor: '#94a3b8'
                    },
                    { id: 'sz', type: 'size', field: 'AADT', min: 0, max: 100, sizeMin: 4, sizeMax: 16 }
                ]
            }
        };
        const before = paints(style);
        const view = await renderPanel({ layer, style });
        expect(view.container.querySelector('[aria-label="Symbology"]').value).toBe('unique');
        expect(view.container.textContent).toContain('Size also follows AADT');
        expect(view.onStyleChange).not.toHaveBeenCalled();
        expect(paints(style)).toEqual(before);
        expect(compilePaint(style, 'point').circleRadius[0]).toBe('interpolate');
        await view.unmount();
    });
});
