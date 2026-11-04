import { test, expect } from '@playwright/test';
import {
    bootPrimary,
    expectSingleScreen,
    installDualScreenHooks,
    messageCount,
    openMapWindow,
    postedMessages,
    seedPointLayer,
    trackPageErrors,
    waitForSecondaryLayer
} from './support.js';

installDualScreenHooks(test);

test('@tune closing the map window returns the primary to single-screen', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackPageErrors(page);
    await bootPrimary(page);
    await seedPointLayer(page);

    const first = await openMapWindow(page);
    const firstErrors = trackPageErrors(first);
    await waitForSecondaryLayer(first, 'e2e-points');
    await first.locator('#btn-exit-dual-screen').click();
    await expectSingleScreen(page);
    expect(first.isClosed()).toBe(true);

    const second = await openMapWindow(page);
    const secondErrors = trackPageErrors(second);
    await waitForSecondaryLayer(second, 'e2e-points');
    const before = await messageCount(second);
    await second.evaluate(() => {
        globalThis.__gisE2eMapService.selectFeatures('e2e-points', [0]);
    });
    await expect.poll(async () => {
        const added = await postedMessages(second, before);
        return added.filter((msg) => msg.type === 'SELECTION').length;
    }).toBe(1);

    await second.close();
    await expectSingleScreen(page);
    expect(errors).toEqual([]);
    expect(firstErrors).toEqual([]);
    expect(secondErrors).toEqual([]);
});

test('@tune primary goodbye closes the map window', async ({ page }) => {
    test.setTimeout(70_000);
    const errors = trackPageErrors(page);
    await bootPrimary(page);
    const popup = await openMapWindow(page);
    const popupErrors = trackPageErrors(popup);

    await page.locator('#btn-dual-screen').click();
    await expectSingleScreen(page);
    await expect.poll(() => popup.isClosed()).toBe(true);
    expect(errors).toEqual([]);
    expect(popupErrors).toEqual([]);
});
