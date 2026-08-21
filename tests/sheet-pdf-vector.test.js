// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
    buildSheetPageTransform,
    computeClipBBoxFromPixelRing,
    computeSheetImagePlacement,
    pointInPdfRing
} from '../js/widgets/sheet-cutting/sheet-pdf-placement.js';
import {
    parseHexColor,
    resolveVectorFeatureStyle,
    computeMatchlineSeeLabelPdfPlacement,
    placeMatchlineLabelOnGoldOutline,
    pickJsPdfAngleWithCapsOutward,
    udotFiberPdfBoxTextAngle,
    MATCHLINE_SEE_LABEL_FONT_PT
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

    it('keeps a short remnant at the same scale as a full-length sheet', () => {
        const margins = { left: 36, right: 36, top: 36, bottom: 36 };
        const full = computeSheetImagePlacement(1224, 792, margins, 4800, 1500, {
            preferLandscapeFlow: true
        });
        const remnant = computeSheetImagePlacement(1224, 792, margins, 1600, 1500, {
            preferLandscapeFlow: true,
            referenceWidthPx: 4800,
            referenceHeightPx: 1500
        });
        const blownUp = computeSheetImagePlacement(1224, 792, margins, 1600, 1500, {
            preferLandscapeFlow: true
        });

        expect(remnant.scale).toBeCloseTo(full.scale, 8);
        expect(remnant.height).toBeCloseTo(full.height, 5);
        expect(remnant.width).toBeCloseTo(full.width * (1600 / 4800), 5);
        expect(remnant.height).toBeLessThan(blownUp.height);
        expect(blownUp.height).toBeCloseTo(720, 0);
    });

    it('maps a remnant clip to the same PDF height as a full sheet when referenced', () => {
        const margins = { left: 36, right: 36, top: 36, bottom: 36 };
        const pageSize = { width: 1224, height: 792 };
        const fullRing = [
            [0, 0],
            [4800, 0],
            [4800, 1500],
            [0, 1500]
        ];
        const remnantRing = [
            [0, 0],
            [1600, 0],
            [1600, 1500],
            [0, 1500]
        ];
        const reference = { preferLandscapeFlow: true, referenceWidthPx: 4800, referenceHeightPx: 1500 };
        const full = buildSheetPageTransform(fullRing, margins, pageSize, { preferLandscapeFlow: true });
        const remnant = buildSheetPageTransform(remnantRing, margins, pageSize, reference);

        expect(remnant.placedRect.scale).toBeCloseTo(full.placedRect.scale, 8);
        expect(remnant.placedRect.height).toBeCloseTo(full.placedRect.height, 5);
        expect(remnant.placedRect.width).toBeCloseTo(full.placedRect.width * (1600 / 4800), 5);
        expect(remnant.toPdf(1600, 1500).y - remnant.toPdf(0, 0).y).toBeCloseTo(full.placedRect.height, 5);
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
                strokeWidth: 0,
                labels: {
                    enabled: true,
                    field: 'station_label',
                    size: 10,
                    color: '#222222',
                    haloColor: '#ffffff',
                    haloWidth: 1.5
                }
            }
        );
        expect(style.kind).toBe('label');
        expect(style.field).toBe('station_label');
        expect(style.fontSize).toBe(10);
        expect(style.haloColor).toBe('#ffffff');
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

        const styledRoute = resolveVectorFeatureStyle(
            {
                properties: { feature_type: 'route' },
                geometry: { type: 'LineString' }
            },
            { strokeColor: '#336699', strokeWidth: 3, strokeOpacity: 0.4 }
        );
        expect(styledRoute.strokeColor).toBe('#336699');
        expect(styledRoute.strokeWidth).toBe(3);
        expect(styledRoute.strokeOpacity).toBe(0.4);
    });

    it('draws Fiber lines as vector without along-line labels', () => {
        const style = resolveVectorFeatureStyle(
            {
                properties: { Fiber_Label: '2 IMD 10mm', _udotFiberKey: 'fiber' },
                geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
            },
            { _udotFiber: { layerKey: 'fiber' }, labels: { enabled: true, field: 'Fiber_Label' } }
        );
        expect(style.kind).toBe('fiber_line');
        expect(style.labelField).toBeNull();
    });

    it('aligns box label jsPDF angle with the rotated rectangle', () => {
        expect(udotFiberPdfBoxTextAngle(0)).toBeCloseTo(0, 5);
        const tilted = udotFiberPdfBoxTextAngle(30);
        const rad = (tilted * Math.PI) / 180;
        expect(Math.cos(rad)).toBeCloseTo(Math.cos(Math.PI / 6), 5);
        expect(-Math.sin(rad)).toBeCloseTo(Math.sin(Math.PI / 6), 5);
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

    it('offsets matchline text outside along the projected outward vector', () => {
        const placed = computeMatchlineSeeLabelPdfPlacement(
            { x: 500, y: 300 },
            { x: 520, y: 300 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            MATCHLINE_SEE_LABEL_FONT_PT
        );
        expect(placed.x).toBeCloseTo(500 + MATCHLINE_SEE_LABEL_FONT_PT * 0.5, 5);
        expect(placed.y).toBeCloseTo(300, 5);
        expect(placed.x).toBeGreaterThan(500);
    });

    it('flips matchline text outside when the outward vector points into the cutout', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const placed = computeMatchlineSeeLabelPdfPlacement(
            { x: 500, y: 300 },
            { x: 480, y: 300 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            MATCHLINE_SEE_LABEL_FONT_PT,
            pdfRing
        );
        expect(placed.x).toBeGreaterThan(500);
    });

    it('styles matchline SEE SHEET labels as rotated overlay text', () => {
        const style = resolveVectorFeatureStyle({
            properties: { feature_type: 'matchline_see_label', text: 'SEE SHEET 07' },
            geometry: { type: 'Point' }
        });
        expect(style.kind).toBe('matchline_see_label');
        expect(style.fontSize).toBe(MATCHLINE_SEE_LABEL_FONT_PT);
    });
});

function glyphCapSample(x, y, angleDeg, fontPt = MATCHLINE_SEE_LABEL_FONT_PT) {
    const rad = (angleDeg * Math.PI) / 180;
    const capH = fontPt * 0.7;
    return { x: x - Math.sin(rad) * capH, y: y - Math.cos(rad) * capH };
}

describe('matchline labels on the gold outline', () => {
    // Caps in page y-down are (−sin θ, −cos θ). See docs/SHEET_CUTTING.md.
    it('keeps right-edge glyphs outside a rectangle (not just the baseline)', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const placed = placeMatchlineLabelOnGoldOutline(
            { x: 500, y: 300 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            MATCHLINE_SEE_LABEL_FONT_PT,
            pdfRing
        );
        const cap = glyphCapSample(placed.x, placed.y, placed.angle);
        expect(placed.x).toBeGreaterThan(500);
        expect(pointInPdfRing(placed.x, placed.y, pdfRing)).toBe(false);
        expect(pointInPdfRing(cap.x, cap.y, pdfRing)).toBe(false);
        expect(cap.x).toBeGreaterThan(placed.x);
    });

    it('keeps left-edge glyphs outside a rectangle', () => {
        const pdfRing = [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 400 },
            { x: 100, y: 400 }
        ];
        const placed = placeMatchlineLabelOnGoldOutline(
            { x: 100, y: 300 },
            { x: 100, y: 400 },
            { x: 100, y: 200 },
            MATCHLINE_SEE_LABEL_FONT_PT,
            pdfRing
        );
        const cap = glyphCapSample(placed.x, placed.y, placed.angle);
        expect(placed.x).toBeLessThan(100);
        expect(pointInPdfRing(placed.x, placed.y, pdfRing)).toBe(false);
        expect(pointInPdfRing(cap.x, cap.y, pdfRing)).toBe(false);
        expect(cap.x).toBeLessThan(placed.x);
    });

    it('keeps glyphs outside a parallelogram right edge, not the page-right bbox', () => {
        const pdfRing = [
            { x: 150, y: 100 },
            { x: 450, y: 100 },
            { x: 500, y: 400 },
            { x: 200, y: 400 }
        ];
        const placed = placeMatchlineLabelOnGoldOutline(
            { x: 475, y: 250 },
            { x: 450, y: 100 },
            { x: 500, y: 400 },
            MATCHLINE_SEE_LABEL_FONT_PT,
            pdfRing
        );
        const cap = glyphCapSample(placed.x, placed.y, placed.angle);
        expect(pointInPdfRing(placed.x, placed.y, pdfRing)).toBe(false);
        expect(pointInPdfRing(cap.x, cap.y, pdfRing)).toBe(false);
        const edgeXAtY = 450 + (placed.y - 100) / 6;
        expect(placed.x).toBeGreaterThan(edgeXAtY);
        expect(cap.x).toBeGreaterThan(edgeXAtY);
        expect(placed.outward.x * (cap.x - placed.x) + placed.outward.y * (cap.y - placed.y)).toBeGreaterThan(0);
    });

    it('keeps glyphs outside a 20° rotated rectangle right edge', () => {
        const pdfRing = [
            { x: 146.26, y: 137.63 },
            { x: 522.14, y: 274.43 },
            { x: 453.74, y: 462.37 },
            { x: 77.86, y: 325.57 }
        ];
        const placed = placeMatchlineLabelOnGoldOutline(
            { x: 487.94, y: 368.4 },
            { x: 522.14, y: 274.43 },
            { x: 453.74, y: 462.37 },
            MATCHLINE_SEE_LABEL_FONT_PT,
            pdfRing
        );
        const cap = glyphCapSample(placed.x, placed.y, placed.angle);
        expect(pointInPdfRing(placed.x, placed.y, pdfRing)).toBe(false);
        expect(pointInPdfRing(cap.x, cap.y, pdfRing)).toBe(false);
    });
});

describe('jsPDF matchline cap direction', () => {
    // Regression: (sin, −cos) looked fine on vertical left edges and failed on diagonals.
    it('picks the parallel angle whose jsPDF caps follow the outward normal', () => {
        const outward = { x: 0.654, y: -0.756 };
        const angle = pickJsPdfAngleWithCapsOutward(40.86, outward);
        const rad = (angle * Math.PI) / 180;
        const capDot = (-Math.sin(rad)) * outward.x + (-Math.cos(rad)) * outward.y;
        expect(capDot).toBeGreaterThan(0.9);
    });
});
