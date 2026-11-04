import { test, expect } from '@playwright/test';
import {
    bootPrimary,
    installDualScreenHooks,
    messageCount,
    openMapWindow,
    postedMessages,
    trackPageErrors
} from './support.js';

installDualScreenHooks(test);

test('@tune dual screen opens the map window and completes handshake', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = trackPageErrors(page);
    await bootPrimary(page);

    const popup = await openMapWindow(page);
    const popupErrors = trackPageErrors(popup);

    await expect.poll(async () => {
        const layout = await page.evaluate(() => ({
            body: document.body.classList.contains('dual-screen-active'),
            hidden: !!document.getElementById('map-container')?.classList.contains('dual-screen-map-hidden'),
            placeholder: !!document.querySelector('.dual-screen-placeholder')
        }));
        return layout;
    }).toEqual({ body: true, hidden: true, placeholder: true });

    await expect.poll(() => popup.locator('canvas.maplibregl-canvas').count()).toBeGreaterThan(0);
    await expect.poll(async () => {
        const fromPopup = await postedMessages(popup);
        const fromPrimary = await postedMessages(page);
        return {
            hello: fromPopup.some((msg) => msg.type === 'HELLO'),
            snapshot: fromPrimary.some((msg) => msg.type === 'SNAPSHOT')
        };
    }).toEqual({ hello: true, snapshot: true });

    expect(await messageCount(popup)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(popupErrors).toEqual([]);
    await popup.close();
});
