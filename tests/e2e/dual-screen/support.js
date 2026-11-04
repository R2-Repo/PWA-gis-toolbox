import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { bootApp } from '../helpers/app.js';
import { attachNetworkGuard, assertNoUnexpectedBlocks } from '../helpers/network-guard.js';

const NETWORK_LOG = path.join(process.cwd(), 'test-results/gis-report/network-log.jsonl');

export async function installDualScreenMessageTap(context) {
    await context.addInitScript(() => {
        const Orig = window.BroadcastChannel;
        if (!Orig || window.__gisDsTapInstalled) return;
        window.__gisDsTapInstalled = true;
        window.__gisDsMessages = [];
        window.BroadcastChannel = class extends Orig {
            constructor(name) {
                super(name);
                const orig = this.postMessage.bind(this);
                this.postMessage = (data) => {
                    try {
                        window.__gisDsMessages.push(JSON.parse(JSON.stringify(data)));
                    } catch {
                        window.__gisDsMessages.push({ type: 'unserializable' });
                    }
                    return orig(data);
                };
            }
        };
    });
}

/**
 * @param {import('@playwright/test').TestType<import('@playwright/test').PlaywrightTestArgs, import('@playwright/test').PlaywrightTestOptions>} test
 */
export function installDualScreenHooks(test) {
    /** @type {Map<string, import('../helpers/network-guard.js').NetworkGuardState>} */
    const networkByTest = new Map();

    test.beforeEach(async ({ context }, testInfo) => {
        await installDualScreenMessageTap(context);
        const guard = await attachNetworkGuard(context);
        networkByTest.set(testInfo.testId, guard);
    });

    test.afterEach(async ({}, testInfo) => {
        const guard = networkByTest.get(testInfo.testId);
        if (!guard) return;
        assertNoUnexpectedBlocks(guard);
        await fs.mkdir(path.dirname(NETWORK_LOG), { recursive: true });
        await fs.appendFile(
            NETWORK_LOG,
            `${JSON.stringify({
                test: testInfo.title,
                basemapBlocked: guard.basemapBlocked,
                telemetryBlocked: guard.telemetryBlocked,
                unexpectedBlocked: guard.unexpectedBlocked
            })}\n`
        );
    });

    return networkByTest;
}

export function trackPageErrors(page) {
    const errors = [];
    page.on('pageerror', (err) => {
        const text = String(err?.message || err);
        if (/ResizeObserver loop/i.test(text)) return;
        errors.push(text);
    });
    return errors;
}

export async function bootPrimary(page) {
    await bootApp(page, '/');
}

export async function seedPointLayer(page) {
    await page.evaluate(async () => {
        const state = globalThis.__gisE2eState;
        const map = globalThis.__gisE2eMapService;
        const dataset = {
            id: 'e2e-points',
            name: 'E2E Points',
            type: 'spatial',
            visible: true,
            geojson: {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { NAME: 'A', _featureIndex: 0 },
                        geometry: { type: 'Point', coordinates: [-111.9, 40.7] }
                    },
                    {
                        type: 'Feature',
                        properties: { NAME: 'B', _featureIndex: 1 },
                        geometry: { type: 'Point', coordinates: [-111.85, 40.75] }
                    }
                ]
            },
            source: { format: 'geojson' },
            schema: { geometryType: 'Point', featureCount: 2 }
        };
        state.addLayer(dataset, { activate: true });
        await map.addLayer(dataset, 0, { fit: true });
    });
    await expect(page.getByText('E2E Points').first()).toBeVisible();
}

export async function postedMessages(page, start = 0) {
    return page.evaluate((from) => (window.__gisDsMessages || []).slice(from), start);
}

export async function messageCount(page) {
    return page.evaluate(() => (window.__gisDsMessages || []).length);
}

/** @param {import('@playwright/test').Page} page */
export async function expectSingleScreen(page) {
    await expect.poll(async () => page.evaluate(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        const canvas = map?.getCanvas?.();
        return {
            dual: document.body.classList.contains('dual-screen-active'),
            hint: sessionStorage.getItem('dualScreenActive'),
            map: !!(canvas && canvas.width > 0 && (map.loaded?.() || map.isStyleLoaded?.()))
        };
    }), { timeout: 25_000 }).toEqual({ dual: false, hint: null, map: true });
}

/**
 * The preview build hashes the map-window entry (`assets/mapWindow-*.js`).
 * Dev serves `js/map-window-entry.js`. Block both so handshake cannot finish.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {(route: import('@playwright/test').Route) => Promise<void>} handler
 */
export async function routeMapWindowEntry(context, handler) {
    await context.route('**/js/map-window-entry.js', handler);
    await context.route('**/mapWindow*.js', handler);
}

/** @param {import('@playwright/test').BrowserContext} context */
export async function unrouteMapWindowEntry(context) {
    await context.unroute('**/js/map-window-entry.js');
    await context.unroute('**/mapWindow*.js');
}

/**
 * Failed activation clears on a 500ms poll or the 8s hello timeout.
 * A click during that window is ignored, so wait past the poll.
 * @param {import('@playwright/test').Page} page
 */
export async function waitForActivationSettled(page) {
    await expectSingleScreen(page);
    await page.waitForTimeout(1200);
}

/** @param {import('@playwright/test').Page} page */
export async function openMapWindow(page) {
    const context = page.context();
    /** @type {import('@playwright/test').Page | null} */
    let spawned = null;
    const onPage = (next) => {
        if (next !== page) spawned = next;
    };
    context.on('page', onPage);
    try {
        await page.locator('#btn-dual-screen').click();
        await expect.poll(() => !!(spawned && !spawned.isClosed()), { timeout: 15_000 }).toBe(true);
    } finally {
        context.off('page', onPage);
    }
    const popup = spawned;
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForFunction(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        return !!(map && (map.loaded?.() || map.isStyleLoaded?.()));
    }, null, { timeout: 30_000 });
    await expect.poll(
        () => page.evaluate(() => document.body.classList.contains('dual-screen-active')),
        { timeout: 15_000 }
    ).toBe(true);
    return popup;
}

export async function waitForSecondaryLayer(popup, layerId) {
    await expect.poll(() => popup.evaluate((id) => {
        return !!globalThis.__gisE2eMapService.getLayerRecord?.(id);
    }, layerId), { timeout: 20_000 }).toBe(true);
}

/** @param {import('@playwright/test').Page} page */
export async function expectCanReopen(page) {
    const popup = await openMapWindow(page);
    await page.locator('#btn-dual-screen').click();
    await expectSingleScreen(page);
    if (!popup.isClosed()) await popup.close().catch(() => {});
}
