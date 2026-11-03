import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { bootApp, dismissOpenModals } from '../helpers/app.js';
import { importLocalFile } from '../helpers/import.js';
import { readActiveLayerMapStyle } from '../helpers/arcgis-import.js';
import { attachNetworkGuard, assertNoUnexpectedBlocks } from '../helpers/network-guard.js';
import { installE2eBrowserShims } from '../helpers/e2e-browser-shims.js';

const fixturePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../fixtures/e2e/label-format.geojson'
);

/** @type {Map<string, { basemapBlocked: string[], unexpectedBlocked: string[] }>} */
const networkByTest = new Map();

test.beforeEach(async ({ context }, testInfo) => {
    await installE2eBrowserShims(context);
    const guard = await attachNetworkGuard(context);
    networkByTest.set(testInfo.testId, guard);
});

test.afterEach(async ({}, testInfo) => {
    const guard = networkByTest.get(testInfo.testId);
    if (!guard) return;
    assertNoUnexpectedBlocks(guard);
    const logPath = path.join(process.cwd(), 'test-results/gis-report/network-log.jsonl');
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(
        logPath,
        `${JSON.stringify({
            test: testInfo.title,
            basemapBlocked: guard.basemapBlocked,
            telemetryBlocked: guard.telemetryBlocked,
            unexpectedBlocked: guard.unexpectedBlocked
        })}\n`
    );
});

/** Offline e2e styles omit glyphs; a same-origin URL lets text layers attach without remote fonts. */
async function allowLocalTextGlyphs(page) {
    await page.evaluate(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        if (map && !map.getStyle()?.glyphs) {
            map.setGlyphs(`${location.origin}/glyphs/{fontstack}/{range}.pbf`);
        }
    });
}

async function openLabels(page) {
    const header = page.locator('.labels-panel .panel-section-header');
    await header.waitFor({ state: 'visible', timeout: 30_000 });
    if (await header.evaluate((el) => el.classList.contains('collapsed'))) {
        await header.click();
    }
    const checkbox = page.locator('.labels-panel input[type="checkbox"]').first();
    if (!(await checkbox.isChecked())) {
        await page.locator('.labels-panel').getByText('Show labels').click();
    }
}

test('@tune label formatting survives a reload', async ({ page }) => {
    test.setTimeout(120_000);
    await bootApp(page, '/');
    await allowLocalTextGlyphs(page);
    await importLocalFile(page, fixturePath);
    await dismissOpenModals(page);

    await page.locator('.layer-item').first().click();
    await openLabels(page);

    const panel = page.locator('.labels-panel');
    await panel.getByLabel('Label field').selectOption('length');
    await panel.getByLabel('Second field').selectOption('code');
    await panel.getByLabel('Decimals').selectOption('2');
    await panel.getByLabel('Prefix').fill('L ');
    await panel.getByLabel('Suffix').fill(' m');
    await panel.getByLabel('Halo color').fill('#ff00aa');
    await panel.getByLabel('Halo width').fill('2.5');
    await expect(panel).toContainText('Preview: L 12.35 A1 m');
    await expect(panel.locator('details')).not.toContainText('Halo');

    await page.waitForFunction(() => {
        const map = globalThis.__gisE2eMapService?.getMap?.();
        const layer = (map?.getStyle?.()?.layers || []).find((item) => String(item.id).endsWith('-labels')
            && !String(item.id).endsWith('-line-labels'));
        const text = JSON.stringify(layer?.layout?.['text-field'] || null);
        const halo = JSON.stringify(layer?.paint?.['text-halo-color'] || '').toLowerCase();
        return text.includes('number-format')
            && text.includes('L ')
            && halo.includes('ff00aa')
            && Number(layer?.paint?.['text-halo-width']) === 2.5;
    });

    await page.waitForTimeout(2500);
    const saved = await readActiveLayerMapStyle(page);
    expect(saved?.labels).toMatchObject({
        field: 'length',
        field2: 'code',
        decimals: 2,
        prefix: 'L ',
        suffix: ' m',
        haloColor: '#ff00aa',
        haloWidth: 2.5
    });

    await page.goto('/');
    await page.waitForFunction(() => globalThis.__gisE2eMapService?.getMap?.(), null, { timeout: 60_000 });
    await allowLocalTextGlyphs(page);
    const closeGuide = page.locator('.modal-overlay--splash .close-modal');
    await closeGuide.first().waitFor({ state: 'visible', timeout: 60_000 });
    await closeGuide.first().click();
    await page.getByText('Restore Previous Session?').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('.modal-footer .confirm-btn').click();

    await page.locator('.layer-item').first().click();
    await openLabels(page);
    await expect(panel.getByLabel('Label field')).toHaveValue('length');
    await expect(panel.getByLabel('Second field')).toHaveValue('code');
    await expect(panel.getByLabel('Decimals')).toHaveValue('2');
    await expect(panel.getByLabel('Prefix')).toHaveValue('L ');
    await expect(panel.getByLabel('Suffix')).toHaveValue(' m');
    await expect(panel.getByLabel('Halo color')).toHaveValue('#ff00aa');
    await expect(panel.getByLabel('Halo width')).toHaveValue('2.5');
    await expect(panel).toContainText('Preview: L 12.35 A1 m');
});
