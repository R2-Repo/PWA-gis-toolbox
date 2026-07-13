import { describe, expect, it } from 'vitest';
import {
    buildSheetPageTransform,
    computeClipBBoxFromPixelRing,
    computeSheetImagePlacement
} from '../js/widgets/sheet-cutting/sheet-pdf-placement.js';
import {
    parseHexColor,
    resolveVectorFeatureStyle
} from '../js/widgets/sheet-cutting/sheet-pdf-vector.js';

describe('sheet PDF placement', () => {
    it('computes landscape-flow image placement', () => {
        const placement = computeSheetImagePlacement(1224, 792, {
            left: 36,
            right: 36,
            top: 36,
            bottom: 36
        }, 4800, 3000, { preferLandscapeFlow: true });

        expect(placement.width).toBe(1152);
        expect(placement.height).toBeCloseTo(720, 0);
        expect(placement.x).toBe(36);
    });

    it('builds a device-pixel to PDF-point transform from a clip ring', () => {
        const pixelRing = [
            [100, 200],
            [500, 200],
            [500, 600],
            [100, 600]
        ];
        const bbox = computeClipBBoxFromPixelRing(pixelRing);
        expect(bbox.width).toBe(400);
        expect(bbox.height).toBe(400);

        const transform = buildSheetPageTransform(
            pixelRing,
            { left: 0, right: 0, top: 0, bottom: 0 },
            { width: 400, height: 400 },
            { preferLandscapeFlow: true }
        );

        const topLeft = transform.toPdf(100, 200);
        const bottomRight = transform.toPdf(500, 600);
        expect(topLeft.x).toBeCloseTo(0, 1);
        expect(topLeft.y).toBeCloseTo(0, 1);
        expect(bottomRight.x).toBeCloseTo(400, 1);
        expect(bottomRight.y).toBeCloseTo(400, 1);
    });
});

describe('sheet PDF vector styles', () => {
    it('parses hex colors', () => {
        expect(parseHexColor('#ff00aa')).toEqual({ r: 255, g: 0, b: 170 });
        expect(parseHexColor('#f0a')).toEqual({ r: 255, g: 0, b: 170 });
    });

    it('resolves stationing preview symbology', () => {
        const tick = resolveVectorFeatureStyle({
            properties: { _preview: 'station_tick' },
            geometry: { type: 'LineString' }
        });
        expect(tick.kind).toBe('line');
        expect(tick.strokeColor).toBe('#111111');

        const label = resolveVectorFeatureStyle({
            properties: { _preview: 'station_label', station_label: '10+00' },
            geometry: { type: 'Point' }
        });
        expect(label.kind).toBe('label');
        expect(label.field).toBe('station_label');
        expect(label.fontSize).toBe(11);
    });

    it('renders label-only stationing layers without a point marker', () => {
        const style = resolveVectorFeatureStyle(
            {
                properties: { station_label: '12+50' },
                geometry: { type: 'Point' }
            },
            {
                pointSize: 0,
                fillOpacity: 0,
                strokeOpacity: 0,
                strokeWidth: 0
            }
        );
        expect(style.kind).toBe('label');
        expect(style.field).toBe('station_label');
        expect(style.fontSize).toBe(11);
    });

    it('resolves sheet outline and route styles', () => {
        const outline = resolveVectorFeatureStyle({
            properties: { feature_type: 'sheet_outline' },
            geometry: { type: 'Polygon' }
        });
        expect(outline.kind).toBe('line');
        expect(outline.dash).toBeDefined();

        const route = resolveVectorFeatureStyle({
            properties: { feature_type: 'route' },
            geometry: { type: 'LineString' }
        });
        expect(route.strokeColor).toBe('#cc4444');
    });

    it('falls back to layer style for design features', () => {
        const style = resolveVectorFeatureStyle(
            { properties: {}, geometry: { type: 'LineString' } },
            { strokeColor: '#abcdef', strokeWidth: 4, strokeOpacity: 0.8 }
        );
        expect(style.strokeColor).toBe('#abcdef');
        expect(style.strokeWidth).toBe(4);
    });

    it('resolves overview sheet label symbology with halo', () => {
        const label = resolveVectorFeatureStyle({
            properties: { feature_type: 'overview_sheet_label', sheet_label: 'Sheet 01' },
            geometry: { type: 'Point' }
        });
        expect(label.kind).toBe('label');
        expect(label.field).toBe('sheet_label');
        expect(label.haloColor).toBe('#ffffff');
        expect(label.fontSize).toBe(11);
    });

    it('matches overview sheet outlines to map preview gold', () => {
        const outline = resolveVectorFeatureStyle({
            properties: { feature_type: 'overview_sheet_outline' },
            geometry: { type: 'Polygon' }
        });
        expect(outline.strokeColor).toBe('#d4a24e');
        expect(outline.fillOpacity).toBe(0);
    });
});
