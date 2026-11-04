import { test, expect } from '@playwright/test';
import {
    bootPrimary,
    installDualScreenHooks,
    messageCount,
    openMapWindow,
    postedMessages,
    seedPointLayer,
    waitForSecondaryLayer
} from './support.js';

installDualScreenHooks(test);

async function readyPair(page) {
    await bootPrimary(page);
    await seedPointLayer(page);
    const popup = await openMapWindow(page);
    await waitForSecondaryLayer(popup, 'e2e-points');
    return popup;
}

async function zoomOf(popup) {
    return popup.evaluate(() => globalThis.__gisE2eMapService.getMap().getZoom());
}

test('@tune zoom and popup mode cross the dual-screen bridge both ways', async ({ page }) => {
    test.setTimeout(90_000);
    const popup = await readyPair(page);

    await popup.evaluate(() => {
        globalThis.__gisE2eMapService.getMap().jumpTo({ center: [-111.875, 40.725], zoom: 4 });
    });
    const beforePrimaryZoom = await zoomOf(popup);
    await page.getByRole('button', { name: 'Actions for E2E Points' }).click();
    await page.getByRole('menuitem', { name: 'Zoom to layer' }).click();
    await expect.poll(() => zoomOf(popup), { timeout: 15_000 }).toBeGreaterThan(beforePrimaryZoom + 1);
    const primaryCmds = await postedMessages(page);
    expect(primaryCmds.some((msg) => msg.type === 'MAP_CMD' && msg.payload?.method === 'fitToLayers')).toBe(true);

    const beforeSecondaryZoom = await zoomOf(popup);
    const beforeCtx = await messageCount(popup);
    const point = await popup.evaluate(() => new Promise((resolve) => {
        const map = globalThis.__gisE2eMapService.getMap();
        const finish = () => {
            const projected = map.project([-111.9, 40.7]);
            resolve({ x: projected.x, y: projected.y });
        };
        map.jumpTo({ center: [-111.9, 40.7], zoom: 16 });
        map.once('idle', finish);
    }));
    await popup.locator('canvas.maplibregl-canvas').click({
        button: 'right',
        position: point
    });
    await popup.locator('.ctx-item', { hasText: 'Zoom to layer' }).click();
    await expect.poll(() => zoomOf(popup), { timeout: 15_000 }).toBeGreaterThan(beforeSecondaryZoom + 1);
    const ctx = await postedMessages(popup, beforeCtx);
    expect(ctx.some((msg) => msg.type === 'CTX_CMD' && msg.payload?.action === 'zoomToLayer')).toBe(true);

    await page.locator('#btn-popup-mode').click();
    const beforeMode = await messageCount(page);
    await page.locator('#popup-mode-dropdown').getByRole('button', { name: /Minimal/ }).click();
    await expect.poll(() => popup.evaluate(() => globalThis.__gisE2eMapService.getPopupMode())).toBe('minimal');
    await expect.poll(() => page.evaluate(() => globalThis.__gisE2eMapService.getPopupMode())).toBe('minimal');
    const modeMsgs = await postedMessages(page, beforeMode);
    expect(modeMsgs.some((msg) => (
        msg.type === 'MAP_CMD'
        && msg.payload?.method === 'setPopupMode'
        && msg.payload?.args?.[0] === 'minimal'
    ))).toBe(true);

    await popup.close();
});

test('@tune box select and keyboard shortcuts cross the dual-screen bridge', async ({ page }) => {
    test.setTimeout(90_000);
    const popup = await readyPair(page);

    await popup.evaluate(() => new Promise((resolve) => {
        const map = globalThis.__gisE2eMapService.getMap();
        const finish = () => {
            const canvas = map.getCanvas();
            const rect = canvas.getBoundingClientRect();
            const start = { x: rect.left + 6, y: rect.top + 6 };
            const end = { x: rect.right - 6, y: rect.bottom - 6 };
            const fire = (mouseType, x, y, buttons) => {
                canvas.dispatchEvent(new MouseEvent(mouseType, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    button: 0,
                    buttons,
                    shiftKey: true,
                    view: window
                }));
            };
            fire('mousedown', start.x, start.y, 1);
            const steps = 12;
            for (let i = 1; i <= steps; i += 1) {
                const x = start.x + ((end.x - start.x) * i) / steps;
                const y = start.y + ((end.y - start.y) * i) / steps;
                fire('mousemove', x, y, 1);
            }
            fire('mouseup', end.x, end.y, 0);
            resolve(true);
        };
        map.jumpTo({ center: [-111.875, 40.725], zoom: 10 });
        map.once('idle', finish);
    }));

    await expect.poll(() => page.evaluate(() => globalThis.__gisE2eMapService.getTotalSelectionCount()), {
        timeout: 15_000
    }).toBeGreaterThan(0);
    await expect.poll(() => popup.evaluate(() => globalThis.__gisE2eMapService.getTotalSelectionCount())).toBeGreaterThan(0);
    const selectionMsgs = await postedMessages(popup);
    expect(selectionMsgs.some((msg) => msg.type === 'SELECTION' && msg.payload?.source === 'secondary')).toBe(true);

    const beforeClear = await messageCount(page);
    await page.evaluate(() => globalThis.__gisE2eMapService.clearSelection());
    await expect.poll(() => popup.evaluate(() => globalThis.__gisE2eMapService.getTotalSelectionCount()), {
        timeout: 15_000
    }).toBe(0);
    const clearMsgs = await postedMessages(page, beforeClear);
    expect(clearMsgs.some((msg) => msg.type === 'MAP_CMD' && msg.payload?.method === 'clearSelection')).toBe(true);

    const beforeKeys = await messageCount(popup);
    await popup.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'a',
            code: 'KeyA',
            ctrlKey: true,
            bubbles: true,
            cancelable: true
        }));
    });
    await expect.poll(async () => {
        const added = await postedMessages(popup, beforeKeys);
        return added.some((msg) => msg.type === 'CTX_CMD' && msg.payload?.shortcut === 'selectAll');
    }).toBe(true);
    await expect.poll(() => popup.evaluate(() => globalThis.__gisE2eMapService.getTotalSelectionCount()), {
        timeout: 15_000
    }).toBeGreaterThan(0);
    const selectAll = await postedMessages(page);
    expect(selectAll.some((msg) => msg.type === 'MAP_CMD' && msg.payload?.method === 'selectAll')).toBe(true);

    await popup.close();
});

test('@tune layer add and update arrive as map method calls', async ({ page }) => {
    test.setTimeout(90_000);
    const popup = await readyPair(page);
    const beforeAdd = await messageCount(page);

    await page.evaluate(async () => {
        const state = globalThis.__gisE2eState;
        const dataset = {
            id: 'e2e-extra',
            name: 'E2E Extra',
            type: 'spatial',
            visible: true,
            geojson: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: { NAME: 'C', _featureIndex: 0 },
                    geometry: { type: 'Point', coordinates: [-111.8, 40.8] }
                }]
            },
            source: { format: 'geojson' },
            schema: { geometryType: 'Point', featureCount: 1 }
        };
        state.addLayer(dataset, { activate: false });
    });

    await waitForSecondaryLayer(popup, 'e2e-extra');
    const added = await postedMessages(page, beforeAdd);
    expect(added.some((msg) => msg.type === 'SNAPSHOT')).toBe(false);
    expect(added.some((msg) => msg.type === 'MAP_CMD' && msg.payload?.method === 'addLayer')).toBe(true);

    const beforeUpdate = await messageCount(page);
    await page.evaluate(() => {
        const state = globalThis.__gisE2eState;
        const layer = state.getLayers().find((entry) => entry.id === 'e2e-points');
        const next = {
            type: 'FeatureCollection',
            features: [
                ...layer.geojson.features,
                {
                    type: 'Feature',
                    properties: { NAME: 'D', _featureIndex: 2 },
                    geometry: { type: 'Point', coordinates: [-111.82, 40.72] }
                }
            ]
        };
        state.updateLayer('e2e-points', { geojson: next });
    });

    await expect.poll(() => popup.evaluate(() => {
        return globalThis.__gisE2eMapService.getLayerRecord('e2e-points')?.geojson?.features?.length || 0;
    }), { timeout: 15_000 }).toBe(3);
    const updated = await postedMessages(page, beforeUpdate);
    expect(updated.some((msg) => msg.type === 'SNAPSHOT')).toBe(false);
    expect(updated.some((msg) => msg.type === 'MAP_CMD' && msg.payload?.method === 'refreshLayerData')).toBe(true);

    await popup.close();
});
