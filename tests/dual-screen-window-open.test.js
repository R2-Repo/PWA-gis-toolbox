/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    buildMapWindowBounds,
    buildMapWindowFeatures,
    isSecondaryMapWindowOpen,
    openSecondaryMapWindow,
    MAP_WINDOW_PATH,
    MAP_WINDOW_NAME,
    MAP_WEBVIEW_LABEL
} from '../js/dual-screen/window-open.js';
import { createWebWindowService } from '../js/platform/web/web-window-service.js';

describe('dual-screen window-open', () => {
    it('builds centered bounds within screen avail size', () => {
        const bounds = buildMapWindowBounds({
            availWidth: 1920,
            availHeight: 1080,
            availLeft: 0,
            availTop: 0
        });
        expect(bounds.width).toBe(1600);
        expect(bounds.height).toBe(960);
        expect(bounds.x).toBe(160);
        expect(bounds.y).toBe(60);
    });

    it('builds window.open features from bounds', () => {
        const features = buildMapWindowFeatures({
            availWidth: 1280,
            availHeight: 800,
            availLeft: 0,
            availTop: 0
        });
        expect(features).toContain('width=1232');
        expect(features).toContain('height=752');
        expect(features).toContain('menubar=no');
    });

    it('treats missing/closed handles as not open', () => {
        expect(isSecondaryMapWindowOpen(null)).toBe(false);
        expect(isSecondaryMapWindowOpen({ closed: true })).toBe(false);
        expect(isSecondaryMapWindowOpen({ closed: false })).toBe(true);
    });
});

describe('web window service', () => {
    let openSpy;

    beforeEach(() => {
        openSpy = vi.spyOn(window, 'open');
    });

    afterEach(() => {
        openSpy.mockRestore();
    });

    it('wraps window.open and clears opener', async () => {
        const fakeWin = { closed: false, opener: window, focus: vi.fn(), close: vi.fn() };
        openSpy.mockReturnValue(fakeWin);

        const svc = createWebWindowService();
        const handle = await svc.openMapWindow({
            url: MAP_WINDOW_PATH,
            name: MAP_WINDOW_NAME,
            features: 'width=800,height=600'
        });

        expect(openSpy).toHaveBeenCalledWith(MAP_WINDOW_PATH, MAP_WINDOW_NAME, 'width=800,height=600');
        expect(handle).toBeTruthy();
        expect(handle.closed).toBe(false);
        expect(fakeWin.opener).toBeNull();
        handle.focus();
        expect(fakeWin.focus).toHaveBeenCalled();
        handle.close();
        expect(fakeWin.close).toHaveBeenCalled();
    });

    it('returns null when popup is blocked', async () => {
        openSpy.mockReturnValue(null);
        const svc = createWebWindowService();
        await expect(svc.openMapWindow({ url: MAP_WINDOW_PATH })).resolves.toBeNull();
    });
});

describe('openSecondaryMapWindow (web platform)', () => {
    it('uses the web window service in Node/test', async () => {
        const fakeWin = { closed: false, opener: window, focus: vi.fn(), close: vi.fn() };
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin);
        const handle = await openSecondaryMapWindow();
        expect(handle).toBeTruthy();
        expect(handle.closed).toBe(false);
        expect(openSpy).toHaveBeenCalledWith(
            MAP_WINDOW_PATH,
            MAP_WINDOW_NAME,
            expect.stringContaining('width=')
        );
        expect(MAP_WEBVIEW_LABEL).toBe('map');
        openSpy.mockRestore();
    });
});
