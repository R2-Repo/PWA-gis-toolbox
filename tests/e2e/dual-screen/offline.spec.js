import { test, expect } from '@playwright/test';
import {
    bootPrimary,
    installDualScreenHooks,
    openMapWindow
} from './support.js';

const guards = installDualScreenHooks(test);

test('@tune map window loads offline from the local basemap and glyph bundle', async ({ page, context }, testInfo) => {
    test.setTimeout(70_000);
    await bootPrimary(page);
    const popup = await openMapWindow(page);

    const style = await popup.evaluate(() => {
        const map = globalThis.__gisE2eMapService.getMap();
        const glyphs = map.getStyle?.()?.glyphs || '';
        const basemap = globalThis.__gisE2eMapService.getCurrentBasemap?.() || '';
        return { glyphs, basemap, canvas: map.getCanvas?.()?.width > 0 };
    });
    expect(style.canvas).toBe(true);
    expect(style.basemap).toBe('offline');
    expect(style.glyphs).toMatch(/fonts\//);
    expect(style.glyphs).not.toMatch(/cartocdn|basemaps\.carto|arcgisonline/i);

    await context.setOffline(true);
    const stillRendered = await popup.evaluate(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        const canvas = map?.getCanvas?.();
        return !!(canvas && canvas.width > 0);
    }).catch(() => false);
    await context.setOffline(false);
    expect(stillRendered).toBe(true);

    const guard = guards.get(testInfo.testId);
    expect(guard?.basemapBlocked || []).toEqual([]);
    expect(guard?.telemetryBlocked || []).toEqual([]);
    expect(guard?.unexpectedBlocked || []).toEqual([]);
    await popup.close();
});
