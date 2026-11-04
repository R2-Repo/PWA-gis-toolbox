import { test, expect } from '@playwright/test';
import {
    bootPrimary,
    expectCanReopen,
    expectSingleScreen,
    installDualScreenHooks,
    routeMapWindowEntry,
    trackPageErrors,
    unrouteMapWindowEntry,
    waitForActivationSettled
} from './support.js';

installDualScreenHooks(test);

const TIMEOUT_NOTICE = 'The map window did not connect in time. Dual Screen is off, and the map stays in this window.';

test('@tune dual screen rolls back when the popup is blocked', async ({ page }) => {
    test.setTimeout(40_000);
    const errors = trackPageErrors(page);
    await bootPrimary(page);
    await page.evaluate(() => {
        window.__e2eOpen = window.open.bind(window);
        window.open = () => null;
    });

    await page.locator('#btn-dual-screen').click();
    await expect(page.getByText(TIMEOUT_NOTICE)).toBeVisible({ timeout: 20_000 });
    await expectSingleScreen(page);
    expect(errors).toEqual([]);

    await page.evaluate(() => {
        window.open = window.__e2eOpen;
    });
    await expectCanReopen(page);
});

test('@tune dual screen rolls back when the map window closes before handshake', async ({ page, context }) => {
    test.setTimeout(60_000);
    let release = () => {};
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    await routeMapWindowEntry(context, async (route) => {
        await gate;
        try {
            await route.abort();
        } catch {
            /* popup closed and cancelled the request */
        }
    });

    const errors = trackPageErrors(page);
    await bootPrimary(page);
    const popupPromise = page.waitForEvent('popup', { timeout: 15_000 });
    await page.locator('#btn-dual-screen').click();
    const popup = await popupPromise;
    await popup.close();
    release();

    await waitForActivationSettled(page);
    expect(errors).toEqual([]);
    await unrouteMapWindowEntry(context);
    await expectCanReopen(page);
});

test('@tune dual screen rolls back when the map window never handshakes', async ({ page, context }) => {
    test.setTimeout(50_000);
    await routeMapWindowEntry(context, (route) => route.abort());
    const errors = trackPageErrors(page);
    await bootPrimary(page);

    const popupPromise = page.waitForEvent('popup', { timeout: 15_000 });
    await page.locator('#btn-dual-screen').click();
    const popup = await popupPromise;
    await expect(page.getByText(TIMEOUT_NOTICE)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => popup.isClosed(), { timeout: 10_000 }).toBe(true);
    await expectSingleScreen(page);
    expect(errors).toEqual([]);

    await unrouteMapWindowEntry(context);
    await waitForActivationSettled(page);
    await expectCanReopen(page);
});
