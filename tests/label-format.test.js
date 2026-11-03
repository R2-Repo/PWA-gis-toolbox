import { describe, expect, it } from 'vitest';
import { styleFromDrawingInfo } from '../js/arcgis/drawing-info.js';
import { buildProjectKitSnapshot } from '../js/core/project-kit.js';
import { normalizeStyle } from '../js/map/style-engine.js';
import {
    annotateSimplifiedArcgisLabels,
    buildLabelTextField,
    buildMapLabelLayerSpec,
    formatLabelText,
    normalizeLayerLabels,
    simplifiedArcgisLabelNote
} from '../js/map/map-labels.js';

const PROPS = { length: 12.3456, code: 'A1', name: 'Station' };

describe('label formatting', () => {
    it('leaves a plain field as a to-string expression', () => {
        expect(buildLabelTextField({ field: 'name' })).toEqual(['to-string', ['get', 'name']]);
        const spec = buildMapLabelLayerSpec('roads', 'src', { field: 'name', placement: 'line' }, false);
        expect(spec.layout['text-field']).toEqual(['to-string', ['get', 'name']]);
        expect(spec.paint['text-halo-color']).toBe('#ffffff');
        expect(spec.paint['text-halo-width']).toBe(1.5);
    });

    it('formats decimals, prefix, suffix, and a second field', () => {
        const labels = {
            field: 'length',
            field2: 'code',
            decimals: 2,
            prefix: 'L ',
            suffix: ' m'
        };
        expect(formatLabelText(PROPS, labels)).toBe('L 12.35 A1 m');
        const expr = buildLabelTextField(labels);
        expect(expr[0]).toBe('concat');
        expect(expr).toContain('L ');
        expect(expr).toContain(' m');
        expect(JSON.stringify(expr)).toContain('number-format');
        expect(JSON.stringify(expr)).toContain('code');

        const spec = buildMapLabelLayerSpec('pts', 'src', {
            ...labels,
            haloColor: '#ff00aa',
            haloWidth: 2.5
        }, false);
        expect(spec.paint['text-halo-color']).toBe('#ff00aa');
        expect(spec.paint['text-halo-width']).toBe(2.5);
        expect(spec.layout['text-field'][0]).toBe('concat');
    });

    it('uses a template instead of prefix and suffix', () => {
        const labels = {
            field: 'length',
            field2: 'code',
            decimals: 1,
            prefix: 'ignored ',
            suffix: ' ignored',
            template: '{value} ({value2})'
        };
        expect(formatLabelText(PROPS, labels)).toBe('12.3 (A1)');
        const expr = buildLabelTextField(labels);
        expect(expr[0]).toBe('concat');
        expect(expr).toContain(' (');
        expect(expr).not.toContain('ignored');
    });

    it('keeps non-numeric text when decimals are set', () => {
        expect(formatLabelText({ name: 'Station' }, { field: 'name', decimals: 2 })).toBe('Station');
    });

    it('round-trips formatting through normalize and a project snapshot', async () => {
        const labels = {
            enabled: true,
            field: 'length',
            field2: 'code',
            decimals: 2,
            prefix: 'L ',
            suffix: ' m',
            template: '',
            haloColor: '#112233',
            haloWidth: 2,
            expressionNote: 'The ArcGIS label expression was simplified to the field length.'
        };
        const normalized = normalizeLayerLabels(JSON.parse(JSON.stringify(labels)));
        expect(normalized).toMatchObject(labels);
        const style = normalizeStyle({ mode: 'simple', strokeColor: '#abcdef', labels });
        expect(style.labels.decimals).toBe(2);
        expect(style.labels.prefix).toBe('L ');
        expect(style.labels.expressionNote).toContain('simplified');
        expect(style.strokeColor).toBe('#abcdef');

        const snap = await buildProjectKitSnapshot({
            sections: ['layers'],
            layers: [{
                id: 'pts',
                name: 'Points',
                type: 'spatial',
                geojson: { type: 'FeatureCollection', features: [] }
            }],
            layerStyles: { pts: style }
        });
        expect(snap.layers.styles.pts.labels).toMatchObject({
            field: 'length',
            field2: 'code',
            decimals: 2,
            prefix: 'L ',
            suffix: ' m',
            haloColor: '#112233',
            haloWidth: 2,
            expressionNote: labels.expressionNote
        });
    });
});

describe('simplified ArcGIS label note', () => {
    it('stays quiet for a single field expression', () => {
        const entry = { labelExpression: '[NAME]' };
        expect(simplifiedArcgisLabelNote(entry, 'NAME')).toBe('');
        const style = styleFromDrawingInfo({
            renderer: { type: 'simple', symbol: { type: 'esriSLS', color: [0, 0, 255, 255], width: 1 } },
            labelingInfo: [entry]
        }, { geometryType: 'line', displayField: 'NAME' });
        annotateSimplifiedArcgisLabels(style, { labelingInfo: [entry] });
        expect(style.labels.expressionNote).toBeUndefined();
        expect(style.labels.field).toBe('NAME');
    });

    it('explains a concatenation that became one field', () => {
        const entry = { labelExpressionInfo: { expression: 'Concatenate($feature.NAME, $feature.CODE)' } };
        const style = styleFromDrawingInfo({
            renderer: { type: 'simple', symbol: { type: 'esriSLS', color: [0, 0, 255, 255], width: 1 } },
            labelingInfo: [entry]
        }, { geometryType: 'line', displayField: 'NAME' });
        expect(style.labels.field).toBe('NAME');
        annotateSimplifiedArcgisLabels(style, { labelingInfo: [entry] });
        expect(style.labels.expressionNote).toBe('The ArcGIS label expression was simplified to the field NAME.');
    });

    it('explains a polygon expression that was not applied', () => {
        const entry = { labelExpression: '[NAME] & " (" & [CODE] & ")"' };
        const style = styleFromDrawingInfo({
            renderer: {
                type: 'simple',
                symbol: { type: 'esriSFS', color: [1, 2, 3, 255], outline: { color: [0, 0, 0, 255], width: 1 } }
            },
            labelingInfo: [entry]
        }, { geometryType: 'polygon', displayField: 'NAME' });
        expect(style.labels).toBeUndefined();
        annotateSimplifiedArcgisLabels(style, { labelingInfo: [entry] });
        expect(style.labels.enabled).toBe(false);
        expect(style.labels.expressionNote).toBe('The ArcGIS label expression was simplified and was not applied.');
    });
});
