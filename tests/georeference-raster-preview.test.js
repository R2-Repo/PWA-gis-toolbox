import { describe, expect, it } from 'vitest';
import { buildGeorefRasterPayload, stripGeoreferenceRasterUrl } from '../js/widgets/georeference-raster/georef-layer.js';
import {
    MARKER_SIZE_PX,
    PREVIEW_CANVAS_MAX_EDGE,
    PREVIEW_CANVAS_MAX_PIXELS,
    assignPreviewCanvas,
    clampGeorefOpacity,
    imageSampleRect,
    markerAnchorStyle,
    pdfPreviewPlacement,
    planZoomPreview,
    pointerToSourcePx,
    previewCanvasHelps,
    releasePreviewCanvas,
    sourcePxToViewport,
    visibleDisplayRect
} from '../js/widgets/georeference-raster/preview-view.js';

describe('georeference control-point markers', () => {
    it('places the anchor on the cursor content pixel, including the border', () => {
        const hit = pointerToSourcePx({
            clientX: 111.5,
            clientY: 80.25,
            rectLeft: 10,
            rectTop: 20,
            clientLeft: 1,
            clientTop: 2,
            viewX: 4,
            viewY: -6,
            viewScale: 2.5,
            displayWidth: 400,
            displayHeight: 300,
            sourceWidth: 800,
            sourceHeight: 600
        });
        expect(hit).not.toBeNull();
        expect(hit.x).not.toBe(Math.round(hit.x));
        expect(hit.y).not.toBe(Math.round(hit.y));

        const anchor = sourcePxToViewport({
            sourceX: hit.x,
            sourceY: hit.y,
            sourceWidth: 800,
            sourceHeight: 600,
            displayWidth: 400,
            displayHeight: 300,
            viewX: 4,
            viewY: -6,
            viewScale: 2.5
        });
        expect(anchor.x).toBeCloseTo(111.5 - 10 - 1, 8);
        expect(anchor.y).toBeCloseTo(80.25 - 20 - 2, 8);
    });

    it('keeps marker screen size constant while the image scale changes', () => {
        const shared = {
            sourceX: 120.5,
            sourceY: 40.25,
            sourceWidth: 1000,
            sourceHeight: 800,
            displayWidth: 500,
            displayHeight: 400,
            viewX: 12,
            viewY: -4
        };
        const near = markerAnchorStyle(sourcePxToViewport({ ...shared, viewScale: 1 }));
        const far = markerAnchorStyle(sourcePxToViewport({ ...shared, viewScale: 8 }));
        expect(near.screenSizePx).toBe(MARKER_SIZE_PX);
        expect(far.screenSizePx).toBe(MARKER_SIZE_PX);
        expect(far.left).toBeCloseTo(12 + (near.left - 12) * 8, 8);
        expect(far.top).toBeCloseTo(-4 + (near.top + 4) * 8, 8);
        expect(MARKER_SIZE_PX).toBeLessThan(20);
    });

    it('rejects clicks outside the image', () => {
        expect(pointerToSourcePx({
            clientX: 140,
            clientY: 10,
            rectLeft: 0,
            rectTop: 0,
            viewX: 0,
            viewY: 0,
            viewScale: 1,
            displayWidth: 100,
            displayHeight: 80,
            sourceWidth: 100,
            sourceHeight: 80
        })).toBeNull();
    });
});

describe('georeference zoom re-render', () => {
    it('maps the visible window into source pixels', () => {
        const visible = visibleDisplayRect({
            viewX: 0,
            viewY: -50,
            viewScale: 1,
            viewportWidth: 100,
            viewportHeight: 80,
            displayWidth: 500,
            displayHeight: 400
        });
        expect(visible).toEqual({ x: 0, y: 50, width: 100, height: 80 });
    });

    it('caps zoom canvas edge, pixels, and bytes', () => {
        const plan = planZoomPreview({
            viewScale: 80,
            viewportWidth: 4000,
            viewportHeight: 3000,
            displayWidth: 2000,
            displayHeight: 2000,
            sourceWidth: 8000,
            sourceHeight: 8000,
            devicePixelRatio: 2,
            limitToSourcePixels: false
        });
        expect(plan).not.toBeNull();
        expect(plan.capped).toBe(true);
        expect(plan.outputWidth).toBeLessThanOrEqual(PREVIEW_CANVAS_MAX_EDGE);
        expect(plan.outputHeight).toBeLessThanOrEqual(PREVIEW_CANVAS_MAX_EDGE);
        expect(plan.pixels).toBeLessThanOrEqual(PREVIEW_CANVAS_MAX_PIXELS);
        expect(plan.bytes).toBe(plan.pixels * 4);
        expect(plan.bytes).toBeLessThanOrEqual(PREVIEW_CANVAS_MAX_PIXELS * 4);
        expect(plan.sourceRect.x).toBeGreaterThanOrEqual(0);
        expect(plan.sourceRect.y).toBeGreaterThanOrEqual(0);
        expect(plan.sourceRect.x + plan.sourceRect.width).toBeLessThanOrEqual(8000);
        expect(plan.sourceRect.y + plan.sourceRect.height).toBeLessThanOrEqual(8000);
        expect(previewCanvasHelps(plan)).toBe(true);
    });

    it('does not request a canvas when the working image is already 1:1', () => {
        const plan = planZoomPreview({
            viewScale: 1,
            viewportWidth: 400,
            viewportHeight: 300,
            displayWidth: 800,
            displayHeight: 600,
            sourceWidth: 800,
            sourceHeight: 600,
            devicePixelRatio: 1,
            limitToSourcePixels: true
        });
        expect(previewCanvasHelps(plan)).toBe(false);
    });

    it('asks for more PDF pixels than the working raster when zoomed', () => {
        const plan = planZoomPreview({
            viewX: -200,
            viewY: -100,
            viewScale: 4,
            viewportWidth: 320,
            viewportHeight: 240,
            displayWidth: 1024,
            displayHeight: 768,
            sourceWidth: 1024,
            sourceHeight: 768,
            devicePixelRatio: 1,
            limitToSourcePixels: false
        });
        expect(plan.pixels).toBeGreaterThan(plan.displayRect.width * plan.displayRect.height * 2);
        expect(plan.pixels).toBeLessThanOrEqual(PREVIEW_CANVAS_MAX_PIXELS);
        expect(previewCanvasHelps(plan)).toBe(true);
    });

    it('limits image crops to original pixels and clamps the sample rect', () => {
        const plan = planZoomPreview({
            viewScale: 16,
            viewportWidth: 800,
            viewportHeight: 600,
            displayWidth: 200,
            displayHeight: 100,
            sourceWidth: 200,
            sourceHeight: 100,
            devicePixelRatio: 1,
            limitToSourcePixels: true
        });
        expect(plan.capped).toBe(true);
        expect(plan.outputWidth).toBeLessThanOrEqual(Math.ceil(plan.sourceRect.width));
        expect(plan.outputHeight).toBeLessThanOrEqual(Math.ceil(plan.sourceRect.height));
        const sample = imageSampleRect(
            { x: 199.2, y: 0.2, width: 40, height: 3.4 },
            200,
            100
        );
        expect(sample.x).toBeGreaterThanOrEqual(0);
        expect(sample.y).toBeGreaterThanOrEqual(0);
        expect(sample.x + sample.width).toBeLessThanOrEqual(200);
        expect(sample.y + sample.height).toBeLessThanOrEqual(100);
        expect(sample.width).toBeGreaterThan(0);
        expect(sample.height).toBeGreaterThan(0);
    });

    it('places a PDF crop so the source top-left maps to canvas origin', () => {
        const placement = pdfPreviewPlacement({
            baseWidth: 200,
            baseHeight: 100,
            sourceWidth: 200,
            sourceHeight: 100,
            sourceRect: { x: 50, y: 25, width: 100, height: 50 },
            outputWidth: 100,
            outputHeight: 50
        });
        expect(placement.scale).toBeCloseTo(1, 8);
        expect(placement.transform[4]).toBeCloseTo(-50, 8);
        expect(placement.transform[5]).toBeCloseTo(-25, 8);
        const originX = 50 + placement.transform[4];
        const originY = 25 + placement.transform[5];
        expect(originX).toBeCloseTo(0, 8);
        expect(originY).toBeCloseTo(0, 8);
    });

    it('releases the previous canvas buffer when the crop size changes', () => {
        const canvas = { width: 0, height: 0 };
        const first = assignPreviewCanvas(canvas, 800, 600);
        expect(first.releasedPixels).toBe(0);
        expect(first.pixels).toBe(480000);
        expect(canvas.width).toBe(800);
        const second = assignPreviewCanvas(canvas, 100, 80);
        expect(second.releasedPixels).toBe(480000);
        expect(second.pixels).toBe(8000);
        expect(second.pixels).toBeLessThan(first.pixels);
        expect(canvas.width).toBe(100);
        expect(canvas.height).toBe(80);
        const released = releasePreviewCanvas(canvas);
        expect(released.releasedPixels).toBe(8000);
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);
    });
});

describe('georeference overlay opacity', () => {
    it('stores opacity on the raster payload and keeps it after url strip', () => {
        const payload = buildGeorefRasterPayload({
            url: 'blob:http://local/preview',
            mime: 'image/png',
            width: 20,
            height: 10,
            coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]],
            file: 'sheet.png',
            opacity: 0.35
        });
        expect(payload.opacity).toBe(0.35);
        const stripped = stripGeoreferenceRasterUrl(payload);
        expect(stripped.opacity).toBe(0.35);
        expect(stripped.url).toBeUndefined();
        expect(stripped.dataUrl).toBeUndefined();
        expect(stripped.width).toBe(20);
    });

    it('clamps opacity into 0..1', () => {
        expect(clampGeorefOpacity(2)).toBe(1);
        expect(clampGeorefOpacity(-0.4)).toBe(0);
        expect(clampGeorefOpacity(0)).toBe(0);
        expect(clampGeorefOpacity('nope', 0.7)).toBe(0.7);
        const payload = buildGeorefRasterPayload({
            width: 2,
            height: 2,
            coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]],
            opacity: 4
        });
        expect(payload.opacity).toBe(1);
    });
});
