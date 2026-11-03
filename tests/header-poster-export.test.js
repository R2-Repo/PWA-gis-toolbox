/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/ui/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../js/export/exporter.js', () => ({
    downloadBlob: vi.fn()
}));

vi.mock('../js/map/map-export.js', () => ({
    ensureMapCaptureReady: vi.fn(async () => {}),
    captureLiveFrame: vi.fn(),
    captureMapCanvas: vi.fn(),
    canvasToPngBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    buildMapExportFilename: vi.fn((ext) => `map.${ext}`),
    willUseHighResExport: vi.fn(() => false),
    computeExportPixelRatio: vi.fn(() => 1),
    GIF_MAX_WIDTH: 1280,
    buildGifBlob: vi.fn(),
    ensureMapFrameReady: vi.fn(async () => {}),
    scaleCanvasToImageData: vi.fn(),
    suspendMapInteractions: vi.fn(() => () => {})
}));

import { showToast } from '../js/ui/toast.js';
import { downloadBlob } from '../js/export/exporter.js';
import { captureLiveFrame, captureMapCanvas, ensureMapCaptureReady } from '../js/map/map-export.js';
import {
    EXPORT_CANVAS_MAX_PIXELS,
    TILE_READINESS_TIMEOUT_WARNING,
    didTileReadinessTimeOut,
    fitExportPixelSize
} from '../js/map/export-canvas-guard.js';
import { exportHeaderMapView } from '../js/map/header-export.js';
import { exportPresentationPoster } from '../js/presentation/presentation-export.js';
import { EXPORT_PROFILES } from '../js/presentation/presentation-export-profiles.js';

function fakeCanvas(width, height) {
    return {
        width,
        height,
        toBlob(callback) {
            callback(new Blob(['png'], { type: 'image/png' }));
        }
    };
}

describe('export canvas cap', () => {
    it('leaves a canvas under the cap unchanged', () => {
        expect(fitExportPixelSize(640, 480)).toEqual({
            width: 640,
            height: 480,
            scaled: false
        });
        expect(fitExportPixelSize(4000, 4000)).toMatchObject({
            width: 4000,
            height: 4000,
            scaled: false
        });
        expect(4000 * 4000).toBe(EXPORT_CANVAS_MAX_PIXELS);
    });

    it('scales down when the pixel area is over about 16 million', () => {
        const fitted = fitExportPixelSize(8000, 8000);
        expect(fitted).toEqual({ width: 4000, height: 4000, scaled: true });
        expect(fitted.width * fitted.height).toBeLessThanOrEqual(EXPORT_CANVAS_MAX_PIXELS);
    });

    it('honors maxWidth before the area cap', () => {
        const wide = fitExportPixelSize(8000, 2000, { maxWidth: 4096 });
        expect(wide).toEqual({ width: 4096, height: 1024, scaled: true });
        expect(wide.width).toBeLessThanOrEqual(4096);
        expect(wide.width * wide.height).toBeLessThanOrEqual(EXPORT_CANVAS_MAX_PIXELS);

        const both = fitExportPixelSize(8000, 8000, { maxWidth: 4096 });
        expect(both.width).toBeLessThanOrEqual(4096);
        expect(both.height).toBeLessThanOrEqual(4096);
        expect(both.width * both.height).toBeLessThanOrEqual(EXPORT_CANVAS_MAX_PIXELS);
        expect(both).toEqual({ width: 4000, height: 4000, scaled: true });
    });

    it('shrinks a size that is only one pixel over the cap', () => {
        const fitted = fitExportPixelSize(4000, 4001);
        expect(fitted.scaled).toBe(true);
        expect(fitted.width * fitted.height).toBeLessThanOrEqual(EXPORT_CANVAS_MAX_PIXELS);
        expect(fitted.width).toBeGreaterThan(1);
        expect(fitted.height).toBeGreaterThan(1);
    });
});

describe('tile readiness timeout warning', () => {
    it('treats tiles that are still unloaded as a timed-out wait', () => {
        expect(didTileReadinessTimeOut({ areTilesLoaded: () => false })).toBe(true);
        expect(didTileReadinessTimeOut({ areTilesLoaded: () => true })).toBe(false);
        expect(didTileReadinessTimeOut({})).toBe(false);
        expect(didTileReadinessTimeOut(null)).toBe(false);
        expect(TILE_READINESS_TIMEOUT_WARNING).toBe(
            'The map did not finish loading in time. The saved image may look incomplete.'
        );
    });
});

describe('header and poster export wrappers', () => {
    let getContext;
    let toBlob;

    beforeEach(() => {
        getContext = HTMLCanvasElement.prototype.getContext;
        toBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.getContext = function getContext2d() {
            return {
                imageSmoothingEnabled: false,
                drawImage() {}
            };
        };
        HTMLCanvasElement.prototype.toBlob = function toBlobPng(callback) {
            callback(new Blob(['png'], { type: 'image/png' }));
        };
        captureMapCanvas.mockImplementation(async (mapService, options) => {
            options?.beforeCapture?.(mapService.getMap());
            return fakeCanvas(200, 200);
        });
        captureLiveFrame.mockImplementation(() => fakeCanvas(10, 10));
        ensureMapCaptureReady.mockImplementation(async () => {});
    });

    afterEach(() => {
        HTMLCanvasElement.prototype.getContext = getContext;
        HTMLCanvasElement.prototype.toBlob = toBlob;
        vi.clearAllMocks();
    });

    it('caps the header export canvas and still saves the file', async () => {
        const map = { areTilesLoaded: () => true };
        const result = await exportHeaderMapView(
            { getMap: () => map },
            'png',
            { maxPixels: 100 }
        );

        expect(captureMapCanvas).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                highResCapture: true,
                rewaitAfterBeforeCapture: false
            })
        );
        expect(result.width * result.height).toBeLessThanOrEqual(100);
        expect(result.tileReadinessTimedOut).toBe(false);
        expect(downloadBlob).toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('honors maxWidth on the header capture when one is passed', async () => {
        captureMapCanvas.mockImplementation(async (mapService, options) => {
            options?.beforeCapture?.(mapService.getMap());
            return fakeCanvas(200, 40);
        });
        const result = await exportHeaderMapView(
            { getMap: () => ({ areTilesLoaded: () => true }) },
            'png',
            { maxWidth: 100 }
        );
        expect(result.width).toBe(100);
        expect(result.height).toBe(20);
    });

    it('warns in plain words when the header tile wait times out and still exports', async () => {
        const onWarning = vi.fn();
        const result = await exportHeaderMapView(
            { getMap: () => ({ areTilesLoaded: () => false }) },
            'png',
            { onWarning }
        );

        expect(result.tileReadinessTimedOut).toBe(true);
        expect(onWarning).toHaveBeenCalledWith(TILE_READINESS_TIMEOUT_WARNING, 'warning');
        expect(showToast).not.toHaveBeenCalled();
        expect(downloadBlob).toHaveBeenCalled();
    });

    it('shows the header timeout warning when no custom notifier is passed', async () => {
        await exportHeaderMapView(
            { getMap: () => ({ areTilesLoaded: () => false }) },
            'png'
        );
        expect(showToast).toHaveBeenCalledWith(TILE_READINESS_TIMEOUT_WARNING, 'warning');
    });

    it('honors poster maxWidth from the profile and from the caller', async () => {
        captureLiveFrame.mockImplementation(() => fakeCanvas(8000, 2000));
        const profileWidth = EXPORT_PROFILES.poster.maxWidth;
        const withProfile = await exportPresentationPoster({
            scene: { animations: [] },
            map: { areTilesLoaded: () => true },
            mapService: {}
        });
        expect(profileWidth).toBe(4096);
        expect(withProfile.width).toBe(4096);
        expect(withProfile.height).toBe(1024);
        expect(withProfile.width * withProfile.height).toBeLessThanOrEqual(EXPORT_CANVAS_MAX_PIXELS);

        captureLiveFrame.mockImplementation(() => fakeCanvas(8000, 8000));
        const tight = await exportPresentationPoster({
            scene: { animations: [] },
            map: { areTilesLoaded: () => true },
            mapService: {},
            maxWidth: 1000
        });
        expect(tight.width).toBeLessThanOrEqual(1000);
        expect(tight.width * tight.height).toBeLessThanOrEqual(EXPORT_CANVAS_MAX_PIXELS);
    });

    it('waits for tiles after the poster animation, warns on timeout, and still saves', async () => {
        const events = [];
        ensureMapCaptureReady.mockImplementation(async () => {
            events.push('ready');
        });
        captureLiveFrame.mockImplementation(() => {
            events.push('capture');
            return fakeCanvas(20, 10);
        });
        const onWarning = vi.fn();
        const result = await exportPresentationPoster({
            scene: { animations: [{ type: 'flyToFeature', durationMs: 10 }] },
            map: { areTilesLoaded: () => false },
            mapService: {},
            engine: {
                playSequence: async () => {
                    events.push('play');
                }
            },
            onWarning
        });

        expect(events).toEqual(['play', 'ready', 'capture']);
        expect(result.tileReadinessTimedOut).toBe(true);
        expect(onWarning).toHaveBeenCalledWith(TILE_READINESS_TIMEOUT_WARNING, 'warning');
        expect(downloadBlob).toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('uses the visible warning for a poster timeout when the caller does not handle it', async () => {
        captureLiveFrame.mockImplementation(() => fakeCanvas(20, 10));
        await exportPresentationPoster({
            scene: { animations: [] },
            map: { areTilesLoaded: () => false },
            mapService: {}
        });
        expect(showToast).toHaveBeenCalledWith(TILE_READINESS_TIMEOUT_WARNING, 'warning');
        expect(downloadBlob).toHaveBeenCalled();
    });
});
