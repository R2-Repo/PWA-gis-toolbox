/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/ui/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../js/export/exporter.js', () => ({
    downloadBlob: vi.fn()
}));

vi.mock('../js/core/libs.js', () => ({
    loadJsPDF: vi.fn()
}));

vi.mock('../js/map/map-export.js', () => ({
    ensureMapCaptureReady: vi.fn(async () => {}),
    captureLiveFrame: vi.fn(),
    captureMapCanvas: vi.fn(),
    canvasToPngBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    buildMapExportFilename: vi.fn((ext) => `map.${ext}`),
    willUseHighResExport: vi.fn(() => false),
    computeExportPixelRatio: vi.fn(() => 1)
}));

import { downloadBlob } from '../js/export/exporter.js';
import { loadJsPDF } from '../js/core/libs.js';
import { captureMapCanvas } from '../js/map/map-export.js';
import { exportHeaderMapView } from '../js/map/header-export.js';
import {
    HEADER_PDF_DOCUMENT_COMPRESS,
    HEADER_PDF_IMAGE_COMPRESSION,
    HEADER_PDF_JPEG_QUALITY,
    HEADER_PDF_MARGIN_PT,
    HEADER_PDF_NORTH_ARROW_INSET_PT,
    HEADER_PDF_NORTH_ARROW_SIZE_PT,
    HEADER_PDF_NORTH_ARROW_TIP,
    HEADER_PDF_SCALE_BAR_HEIGHT_PT,
    HEADER_PDF_SCALE_BAR_INSET_PT,
    HEADER_PDF_TITLE_BAND_PT,
    HEADER_PDF_TITLE_FONT_PT,
    HEADER_PDF_TITLE_GAP_PT,
    chooseScaleBarDistance,
    fitMapImageToPage,
    formatScaleDistance,
    groundWidthMetersFromView,
    layoutHeaderPdf,
    placeHeaderPdfTitle,
    placeNorthArrow,
    placeScaleBar,
    resolveHeaderPdfPage
} from '../js/map/header-pdf-layout.js';

function mapWithView(bearing = 0) {
    return {
        areTilesLoaded: () => true,
        getBounds: () => ({
            getWest: () => 0,
            getSouth: () => 0,
            getEast: () => 1,
            getNorth: () => 0
        }),
        getCenter: () => ({ lat: 0, lng: 0.5 }),
        getZoom: () => 10,
        getBearing: () => bearing,
        getContainer: () => ({ clientWidth: 800, clientHeight: 600 })
    };
}

function jpegCanvas(width, height, recorder) {
    return {
        width,
        height,
        toDataURL(type, quality) {
            recorder.push({ type, quality });
            return 'data:image/jpeg;base64,bWFw';
        }
    };
}

function installFakeJsPDF() {
    const calls = [];
    class FakeJsPDF {
        constructor(options) {
            this.options = options;
            calls.push({ type: 'construct', options });
        }
        setFont() {}
        setFontSize() {}
        setTextColor() {}
        setFillColor() {}
        setDrawColor() {}
        setLineWidth() {}
        text(...args) {
            calls.push({ type: 'text', args });
        }
        rect(...args) {
            calls.push({ type: 'rect', args });
        }
        triangle(...args) {
            calls.push({ type: 'triangle', args });
        }
        addImage(...args) {
            calls.push({ type: 'addImage', args });
        }
        output() {
            return new Blob(['pdf'], { type: 'application/pdf' });
        }
    }
    loadJsPDF.mockResolvedValue(FakeJsPDF);
    return calls;
}

describe('header PDF page sizes', () => {
    it('uses Letter and Tabloid point sizes and follows the map aspect', () => {
        expect(resolveHeaderPdfPage('letter', 1200, 800)).toEqual({
            pageSize: 'letter',
            orientation: 'landscape',
            pageW: 792,
            pageH: 612
        });
        expect(resolveHeaderPdfPage('Letter', 800, 1200)).toEqual({
            pageSize: 'letter',
            orientation: 'portrait',
            pageW: 612,
            pageH: 792
        });
        expect(resolveHeaderPdfPage('tabloid', 2000, 1000)).toEqual({
            pageSize: 'tabloid',
            orientation: 'landscape',
            pageW: 1224,
            pageH: 792
        });
        expect(resolveHeaderPdfPage('TABLOID', 1000, 2000)).toEqual({
            pageSize: 'tabloid',
            orientation: 'portrait',
            pageW: 792,
            pageH: 1224
        });
        expect(resolveHeaderPdfPage(undefined, 100, 100).pageSize).toBe('letter');
    });

    it('rejects an unknown page size', () => {
        expect(() => resolveHeaderPdfPage('a4', 100, 80)).toThrow(/Unknown page size/);
    });
});

describe('header PDF fit-to-page', () => {
    it('fits a wide map inside Letter landscape and keeps the aspect ratio', () => {
        const page = resolveHeaderPdfPage('letter', 2000, 500);
        const image = fitMapImageToPage({
            pageW: page.pageW,
            pageH: page.pageH,
            imageWidth: 2000,
            imageHeight: 500
        });
        expect(page).toMatchObject({ pageW: 792, pageH: 612 });
        expect(image.content).toEqual({ x: 36, y: 76, width: 720, height: 500 });
        expect(image.x).toBeCloseTo(36, 6);
        expect(image.y).toBeCloseTo(236, 6);
        expect(image.width).toBeCloseTo(720, 6);
        expect(image.height).toBeCloseTo(180, 6);
        expect(image.width / image.height).toBeCloseTo(2000 / 500, 8);
        expect(image.x).toBeGreaterThanOrEqual(image.content.x);
        expect(image.y).toBeGreaterThanOrEqual(image.content.y);
        expect(image.x + image.width).toBeLessThanOrEqual(image.content.x + image.content.width);
        expect(image.y + image.height).toBeLessThanOrEqual(image.content.y + image.content.height);
    });

    it('centers a tall map inside Tabloid portrait', () => {
        const page = resolveHeaderPdfPage('tabloid', 500, 2000);
        const image = fitMapImageToPage({
            pageW: page.pageW,
            pageH: page.pageH,
            imageWidth: 500,
            imageHeight: 2000
        });
        expect(page).toMatchObject({ pageW: 792, pageH: 1224, orientation: 'portrait' });
        const left = image.x - image.content.x;
        const right = image.content.x + image.content.width - (image.x + image.width);
        const top = image.y - image.content.y;
        const bottom = image.content.y + image.content.height - (image.y + image.height);
        expect(left).toBeCloseTo(right, 6);
        expect(top).toBeCloseTo(0, 6);
        expect(bottom).toBeCloseTo(0, 6);
        expect(image.width / image.height).toBeCloseTo(500 / 2000, 8);
        expect(image.width).toBeLessThanOrEqual(image.content.width + 1e-6);
        expect(image.height).toBeLessThanOrEqual(image.content.height + 1e-6);
    });

    it('uses the same content box for a large capture as for a small one', () => {
        const letter = resolveHeaderPdfPage('letter', 800, 600);
        const small = fitMapImageToPage({
            pageW: letter.pageW,
            pageH: letter.pageH,
            imageWidth: 80,
            imageHeight: 60
        });
        const large = fitMapImageToPage({
            pageW: letter.pageW,
            pageH: letter.pageH,
            imageWidth: 8000,
            imageHeight: 6000
        });
        expect(small.width).toBeCloseTo(large.width, 6);
        expect(small.height).toBeCloseTo(large.height, 6);
        expect(large.width).toBeLessThan(letter.pageW);
        expect(large.height).toBeLessThan(letter.pageH);
    });
});

describe('header PDF title, scale bar, and north arrow', () => {
    it('centers the title in the top band', () => {
        expect(HEADER_PDF_MARGIN_PT).toBe(36);
        expect(HEADER_PDF_TITLE_BAND_PT).toBe(32);
        expect(HEADER_PDF_TITLE_GAP_PT).toBe(8);
        const title = placeHeaderPdfTitle({ pageW: 792, title: '  Project overview  ' });
        expect(title).toMatchObject({
            text: 'Project overview',
            x: 396,
            y: HEADER_PDF_MARGIN_PT + HEADER_PDF_TITLE_FONT_PT,
            align: 'center'
        });
        expect(title.y).toBeGreaterThanOrEqual(HEADER_PDF_MARGIN_PT);
        expect(title.y).toBeLessThanOrEqual(HEADER_PDF_MARGIN_PT + HEADER_PDF_TITLE_BAND_PT);
        expect(placeHeaderPdfTitle({ pageW: 612, title: '   ' }).text).toBe('Map');
    });

    it('places a round scale bar inside the lower-left of the map', () => {
        expect(chooseScaleBarDistance(1400)).toBe(1000);
        expect(chooseScaleBarDistance(999)).toBe(500);
        expect(formatScaleDistance(1000)).toBe('1 km');
        expect(formatScaleDistance(250)).toBe('250 m');

        const imageBox = { x: 40, y: 80, width: 500, height: 300 };
        const bar = placeScaleBar({ imageBox, groundWidthMeters: 5000 });
        expect(bar.distanceMeters).toBe(1000);
        expect(bar.label).toBe('1 km');
        expect(bar.width).toBeCloseTo(100, 5);
        expect(bar.height).toBe(HEADER_PDF_SCALE_BAR_HEIGHT_PT);
        expect(bar.x).toBe(imageBox.x + HEADER_PDF_SCALE_BAR_INSET_PT);
        expect(bar.y).toBe(imageBox.y + imageBox.height - HEADER_PDF_SCALE_BAR_INSET_PT - bar.height);
        expect(bar.labelX).toBeCloseTo(bar.x + (bar.width / 2), 6);
        expect(bar.labelY).toBeLessThan(bar.y);
        expect(bar.x).toBeGreaterThanOrEqual(imageBox.x);
        expect(bar.x + bar.width).toBeLessThanOrEqual(imageBox.x + imageBox.width);
        expect(bar.y + bar.height).toBeLessThanOrEqual(imageBox.y + imageBox.height);
        expect(bar.x - imageBox.x).toBeLessThan(imageBox.width / 2);
        expect((imageBox.y + imageBox.height) - (bar.y + bar.height)).toBeLessThan(imageBox.height / 2);
    });

    it('places the north arrow in the upper-right and turns it with bearing', () => {
        const imageBox = { x: 40, y: 80, width: 500, height: 300 };
        const north = placeNorthArrow({ imageBox, bearingDeg: 0 });
        const size = HEADER_PDF_NORTH_ARROW_SIZE_PT;
        expect(north.size).toBe(size);
        expect(north.cx).toBe(imageBox.x + imageBox.width - HEADER_PDF_NORTH_ARROW_INSET_PT - (size / 2));
        expect(north.cy).toBe(imageBox.y + HEADER_PDF_NORTH_ARROW_INSET_PT + (size / 2));
        expect(north.tip.x).toBeCloseTo(north.cx, 6);
        expect(north.tip.y).toBeCloseTo(north.cy - (size * HEADER_PDF_NORTH_ARROW_TIP), 6);
        expect(north.tip.y).toBeLessThan(north.cy);
        expect(north.label.text).toBe('N');
        expect(north.label.y).toBeLessThan(north.tip.y);
        expect(north.cx).toBeGreaterThan(imageBox.x + (imageBox.width / 2));
        expect(north.cy).toBeLessThan(imageBox.y + (imageBox.height / 2));

        const turned = placeNorthArrow({ imageBox, bearingDeg: 90 });
        expect(turned.tip.x).toBeCloseTo(turned.cx - (size * HEADER_PDF_NORTH_ARROW_TIP), 5);
        expect(turned.tip.y).toBeCloseTo(turned.cy, 5);
        expect(turned.tip.x).toBeLessThan(turned.cx);
    });

    it('derives ground width from bounds, including the antimeridian', () => {
        const equator = groundWidthMetersFromView({
            bounds: { west: 0, south: 0, east: 1, north: 0 },
            imageWidthPx: 1000
        });
        expect(equator.groundWidthMeters).toBeCloseTo(111320, 6);

        const wrapped = groundWidthMetersFromView({
            bounds: { west: 179, south: 0, east: -179, north: 0 },
            imageWidthPx: 100
        });
        expect(wrapped.groundWidthMeters).toBeCloseTo(111320 * 2, 4);
    });
});

describe('header PDF compression and drawn placement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('enables JPEG and document compression and draws the fitted layout', async () => {
        expect(HEADER_PDF_DOCUMENT_COMPRESS).toBe(true);
        expect(['FAST', 'MEDIUM', 'SLOW']).toContain(HEADER_PDF_IMAGE_COMPRESSION);
        expect(HEADER_PDF_IMAGE_COMPRESSION).not.toBe('NONE');
        expect(HEADER_PDF_JPEG_QUALITY).toBeGreaterThan(0);
        expect(HEADER_PDF_JPEG_QUALITY).toBeLessThan(1);

        const calls = installFakeJsPDF();
        const jpegCalls = [];
        captureMapCanvas.mockImplementation(async (mapService, options) => {
            options?.beforeCapture?.(mapService.getMap());
            return jpegCanvas(2000, 500, jpegCalls);
        });

        const result = await exportHeaderMapView(
            { getMap: () => mapWithView(90) },
            'pdf',
            { pageSize: 'tabloid', title: 'Site map' }
        );

        const layout = layoutHeaderPdf({
            pageSize: 'tabloid',
            imageWidth: 2000,
            imageHeight: 500,
            title: 'Site map',
            groundWidthMeters: 111320,
            bearingDeg: 90
        });

        expect(result.pageSize).toBe('tabloid');
        expect(result.pageWidthPt).toBe(1224);
        expect(result.pageHeightPt).toBe(792);
        expect(jpegCalls).toEqual([{ type: 'image/jpeg', quality: HEADER_PDF_JPEG_QUALITY }]);

        const constructed = calls.find((call) => call.type === 'construct');
        expect(constructed.options).toMatchObject({
            orientation: 'landscape',
            unit: 'pt',
            format: [1224, 792],
            compress: true
        });

        const imageCall = calls.find((call) => call.type === 'addImage');
        expect(imageCall.args[0]).toMatch(/^data:image\/jpeg/);
        expect(imageCall.args[1]).toBe('JPEG');
        expect(imageCall.args[2]).toBeCloseTo(layout.image.x, 5);
        expect(imageCall.args[3]).toBeCloseTo(layout.image.y, 5);
        expect(imageCall.args[4]).toBeCloseTo(layout.image.width, 5);
        expect(imageCall.args[5]).toBeCloseTo(layout.image.height, 5);
        expect(imageCall.args[7]).toBe(HEADER_PDF_IMAGE_COMPRESSION);

        const texts = calls.filter((call) => call.type === 'text').map((call) => call.args);
        expect(texts).toEqual(expect.arrayContaining([
            [layout.title.text, layout.title.x, layout.title.y, { align: 'center' }],
            [layout.scaleBar.label, layout.scaleBar.labelX, layout.scaleBar.labelY, { align: 'center' }],
            [layout.north.label.text, layout.north.label.x, layout.north.label.y, { align: 'center' }]
        ]));

        const arrow = calls.find((call) => call.type === 'triangle');
        expect(arrow.args[0]).toBeCloseTo(layout.north.tip.x, 5);
        expect(arrow.args[1]).toBeCloseTo(layout.north.tip.y, 5);
        expect(arrow.args[2]).toBeCloseTo(layout.north.left.x, 5);
        expect(arrow.args[3]).toBeCloseTo(layout.north.left.y, 5);
        expect(arrow.args[4]).toBeCloseTo(layout.north.right.x, 5);
        expect(arrow.args[5]).toBeCloseTo(layout.north.right.y, 5);

        const barRect = calls.find((call) => call.type === 'rect'
            && call.args[4] === 'S'
            && Math.abs(call.args[0] - layout.scaleBar.x) < 1e-6
            && Math.abs(call.args[1] - layout.scaleBar.y) < 1e-6);
        expect(barRect).toBeTruthy();
        expect(barRect.args[2]).toBeCloseTo(layout.scaleBar.width, 5);
        expect(barRect.args[3]).toBeCloseTo(layout.scaleBar.height, 5);

        expect(layout.compression.document).toBe(true);
        expect(layout.compression.image).toBe(HEADER_PDF_IMAGE_COMPRESSION);
        expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'map.pdf');
    });

    it('defaults a header PDF to Letter when no page size is passed', async () => {
        const calls = installFakeJsPDF();
        captureMapCanvas.mockImplementation(async (mapService, options) => {
            options?.beforeCapture?.(mapService.getMap());
            return jpegCanvas(640, 480, []);
        });
        const result = await exportHeaderMapView(
            { getMap: () => mapWithView(0) },
            'pdf'
        );
        expect(result.pageSize).toBe('letter');
        expect(result.pageWidthPt).toBe(792);
        expect(result.pageHeightPt).toBe(612);
        expect(calls.find((call) => call.type === 'construct').options).toMatchObject({
            orientation: 'landscape',
            format: [792, 612],
            compress: true
        });
        expect(calls.find((call) => call.type === 'addImage').args[7]).toBe(HEADER_PDF_IMAGE_COMPRESSION);
    });
});
