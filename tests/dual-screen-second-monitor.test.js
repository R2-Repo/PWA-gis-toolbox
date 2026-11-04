/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FORWARDED_MAP_METHODS, LOCAL_ONLY_MAP_METHODS } from '../js/dual-screen/map-bridge.js';
import {
    SECOND_MONITOR_NOTICES,
    resolveSecondMonitorPlacement
} from '../js/dual-screen/second-monitor.js';
import {
    MAP_WINDOW_NAME,
    MAP_WINDOW_PATH,
    buildFullscreenMapWindowFeatures,
    buildMapWindowFeatures,
    openSecondaryMapWindow
} from '../js/dual-screen/window-open.js';

const primary = {
    isPrimary: true,
    availLeft: 0,
    availTop: 0,
    availWidth: 1920,
    availHeight: 1080
};

const secondary = {
    isPrimary: false,
    availLeft: 1920,
    availTop: 0,
    availWidth: 2560,
    availHeight: 1440
};

function fakeWindow() {
    return { closed: false, focus() {}, close() {} };
}

describe('second monitor placement', () => {
    it('uses the non-primary screen when getScreenDetails is supported', async () => {
        const getScreenDetails = vi.fn(async () => ({
            screens: [primary, secondary],
            currentScreen: primary
        }));
        const result = await resolveSecondMonitorPlacement({ getScreenDetails });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.screen).toEqual({
            availLeft: 1920,
            availTop: 0,
            availWidth: 2560,
            availHeight: 1440
        });
        const features = buildFullscreenMapWindowFeatures(result.screen);
        expect(features).toContain('left=1920');
        expect(features).toContain('top=0');
        expect(features).toContain('width=2560');
        expect(features).toContain('height=1440');
        expect(getScreenDetails).toHaveBeenCalledOnce();
    });

    it('falls back when permission is denied', async () => {
        const getScreenDetails = vi.fn(async () => {
            throw new Error('NotAllowedError');
        });
        const result = await resolveSecondMonitorPlacement({ getScreenDetails });
        expect(result).toEqual({
            ok: false,
            reason: 'denied',
            notice: SECOND_MONITOR_NOTICES.denied
        });
    });

    it('falls back when getScreenDetails is missing', async () => {
        await expect(resolveSecondMonitorPlacement({})).resolves.toEqual({
            ok: false,
            reason: 'unsupported',
            notice: SECOND_MONITOR_NOTICES.unsupported
        });
        await expect(resolveSecondMonitorPlacement(null)).resolves.toMatchObject({
            ok: false,
            reason: 'unsupported'
        });
        await expect(resolveSecondMonitorPlacement({ getScreenDetails: 'nope' })).resolves.toMatchObject({
            reason: 'unsupported'
        });
    });

    it('falls back when only one screen is present', async () => {
        const getScreenDetails = vi.fn(async () => ({ screens: [primary], currentScreen: primary }));
        const result = await resolveSecondMonitorPlacement({ getScreenDetails });
        expect(result).toEqual({
            ok: false,
            reason: 'single',
            notice: SECOND_MONITOR_NOTICES.single
        });
    });

    it('does not throw when screen details reject or the getter throws', async () => {
        const rejecting = {
            getScreenDetails: () => Promise.reject('denied')
        };
        await expect(resolveSecondMonitorPlacement(rejecting)).resolves.toMatchObject({
            ok: false,
            reason: 'denied'
        });

        const host = {};
        Object.defineProperty(host, 'getScreenDetails', {
            get() {
                throw new Error('blocked');
            }
        });
        await expect(resolveSecondMonitorPlacement(host)).resolves.toMatchObject({
            ok: false,
            reason: 'unsupported'
        });
    });

    it('keeps a negative origin for a monitor left of the primary', () => {
        const features = buildFullscreenMapWindowFeatures({
            availLeft: -1920,
            availTop: -80,
            availWidth: 1920,
            availHeight: 1080
        });
        expect(features).toContain('left=-1920');
        expect(features).toContain('top=-80');
        expect(features).toContain('width=1920');
        expect(features).toContain('height=1080');
    });
});

describe('pop-out window features', () => {
    it('keeps the normal centered pop-out when no screen is requested', async () => {
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow());
        const handle = await openSecondaryMapWindow('sess-plain');
        expect(handle).toBeTruthy();
        expect(openSpy).toHaveBeenCalledWith(
            `${MAP_WINDOW_PATH}?session=sess-plain`,
            MAP_WINDOW_NAME,
            buildMapWindowFeatures()
        );
        openSpy.mockRestore();
    });

    it('fills the supplied screen instead of the centered pop-out', async () => {
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow());
        await openSecondaryMapWindow('sess-full', { screen: secondary });
        const features = openSpy.mock.calls[0][2];
        expect(openSpy.mock.calls[0][0]).toBe(`${MAP_WINDOW_PATH}?session=sess-full`);
        expect(openSpy.mock.calls[0][1]).toBe(MAP_WINDOW_NAME);
        expect(features).toContain('left=1920');
        expect(features).toContain('width=2560');
        expect(features).toContain('height=1440');
        expect(features).not.toBe(buildMapWindowFeatures());
        openSpy.mockRestore();
    });
});

describe('dual-screen mode doc', () => {
    it('lists every local-only method and both bridge counts', () => {
        const doc = readFileSync(path.join(process.cwd(), 'docs/DUAL_SCREEN_MODE.md'), 'utf8');
        const localNames = Object.keys(LOCAL_ONLY_MAP_METHODS);
        expect(doc).toContain(`**${FORWARDED_MAP_METHODS.size}** forwarded`);
        expect(doc).toContain(`**${localNames.length}** local-only`);
        for (const name of localNames) {
            expect(doc, name).toContain(`\`${name}\``);
        }
        for (const name of FORWARDED_MAP_METHODS) {
            expect(doc, name).toContain(`\`${name}\``);
        }
    });
});
